/**
 * Code Wiki parser worker — Web Worker module
 *
 * Runs in a dedicated worker thread (spawned by entrypoints/offscreen.ts).
 * Receives parse / chunk tasks via `postMessage` and returns results.
 *
 * Why a worker: AST parsing via `typescript` Compiler API is CPU-bound.
 * Running it in the service worker blocks message handling and omnibox.
 * Offloading to a real worker thread keeps the SW responsive.
 *
 * Message protocol:
 *   →  { type: "parse", taskId, files, repoUrl, branch }
 *   ←  { type: "parse_result", taskId, symbols, edges }
 *   ←  { type: "parse_progress", taskId, done, total }
 *   ←  { type: "parse_error", taskId, error }
 *
 *   →  { type: "chunk", taskId, files, symbols, repoUrl, branch }
 *   ←  { type: "chunk_result", taskId, chunks }
 *   ←  { type: "chunk_progress", taskId, done, total }
 *   ←  { type: "chunk_error", taskId, error }
 */

import { parseFiles } from "./parser";
import { chunkFiles } from "../embed-code/chunk";
import type { CodeSymbol, CodeEdge, CodeChunk } from "../types";

/** Yield to event loop every N files so worker stays responsive */
const YIELD_EVERY = 10;

/** Worker request message shape */
export type WorkerRequest =
  | {
      type: "parse";
      taskId: string;
      files: { path: string; content: string }[];
      repoUrl: string;
      branch: string;
    }
  | {
      type: "chunk";
      taskId: string;
      files: { path: string; content: string }[];
      symbols: CodeSymbol[];
      repoUrl: string;
      branch: string;
    }
  | {
      type: "search";
      taskId: string;
      queryEmbedding: number[];
      chunkIds: string[];
      /** id → 1024-dim vector. Workers compute cosine sim for their slice. */
      embeddings: Record<string, number[]>;
      topK: number;
    };

/** Worker response message shape (exported for the host/client typing) */
export type WorkerResponse =
  | { type: "ready" }
  | { type: "PONG" }
  | { type: "parse_result"; taskId: string; symbols: CodeSymbol[]; edges: CodeEdge[] }
  | { type: "parse_progress"; taskId: string; done: number; total: number }
  | { type: "parse_error"; taskId: string; error: string }
  | { type: "chunk_result"; taskId: string; chunks: CodeChunk[] }
  | { type: "chunk_progress"; taskId: string; done: number; total: number }
  | { type: "chunk_error"; taskId: string; error: string }
  | { type: "search_result"; taskId: string; results: Array<{ id: string; score: number }> }
  | { type: "search_error"; taskId: string; error: string };

/** Batched parse with cooperative yielding + progress events. */
async function parseBatched(
  files: { path: string; content: string }[],
  repoUrl: string,
  branch: string,
  taskId: string,
  post: (m: WorkerResponse) => void,
): Promise<{ symbols: CodeSymbol[]; edges: CodeEdge[] }> {
  const allSymbols: CodeSymbol[] = [];
  const allEdges: CodeEdge[] = [];
  const total = files.length;

  for (let start = 0; start < total; start += YIELD_EVERY) {
    const end = Math.min(start + YIELD_EVERY, total);
    const batch = files.slice(start, end);
    const { symbols, edges } = await parseFiles(batch, repoUrl, branch);
    allSymbols.push(...symbols);
    allEdges.push(...edges);
    post({ type: "parse_progress", taskId, done: end, total });
    if (end < total) {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
  }

  return { symbols: allSymbols, edges: allEdges };
}

/** Compute cosine similarity for a slice of chunk ids. Returns top-K by score. */
function searchSlice(
  queryEmbedding: number[],
  chunkIds: string[],
  embeddings: Record<string, number[]>,
  topK: number,
): Array<{ id: string; score: number }> {
  const qLen = queryEmbedding.length;
  let qNormSq = 0;
  for (let i = 0; i < qLen; i++) qNormSq += queryEmbedding[i] * queryEmbedding[i];
  const qNorm = Math.sqrt(qNormSq) || 1;
  const scored: Array<{ id: string; score: number }> = [];
  for (const id of chunkIds) {
    const v = embeddings[id];
    if (!v) continue;
    if (v.length !== qLen) continue;
    let dot = 0;
    let vNormSq = 0;
    for (let i = 0; i < qLen; i++) {
      const a = queryEmbedding[i];
      const b = v[i];
      dot += a * b;
      vNormSq += b * b;
    }
    const vNorm = Math.sqrt(vNormSq) || 1;
    const score = dot / (qNorm * vNorm);
    scored.push({ id, score });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, topK);
}

async function chunkBatched(
  files: { path: string; content: string; symbols?: CodeSymbol[] }[],
  repoUrl: string,
  branch: string,
  taskId: string,
  post: (m: WorkerResponse) => void,
): Promise<CodeChunk[]> {
  const all: CodeChunk[] = [];
  const total = files.length;
  for (let start = 0; start < total; start += YIELD_EVERY) {
    const end = Math.min(start + YIELD_EVERY, total);
    const batch = files.slice(start, end);
    const batchChunks = await chunkFiles(batch, repoUrl, branch);
    all.push(...batchChunks);
    post({ type: "chunk_progress", taskId, done: end, total });
    if (end < total) {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
  }
  return all;
}

/** Attach message handler and signal ready. */
function attachHandler() {
  // Web Worker 上下文的 self 是 DedicatedWorkerGlobalScope
  const ctx = self as unknown as {
    addEventListener: (
      type: string,
      listener: (event: MessageEvent<WorkerRequest>) => void,
    ) => void;
    postMessage: (data: unknown) => void;
  };
  const post = (m: WorkerResponse) => ctx.postMessage(m);

  ctx.addEventListener("message", async (event: MessageEvent<WorkerRequest | { type: "PING" }>) => {
    const msg = event.data;
    if (!msg || typeof msg !== "object" || !("type" in msg)) return;

    // Heartbeat: respond with PONG so host knows worker is alive
    if (msg.type === "PING") {
      post({ type: "PONG" });
      return;
    }

    if (msg.type === "parse") {
      try {
        const { symbols, edges } = await parseBatched(
          msg.files,
          msg.repoUrl,
          msg.branch,
          msg.taskId,
          post,
        );
        post({ type: "parse_result", taskId: msg.taskId, symbols, edges });
      } catch (e) {
        post({
          type: "parse_error",
          taskId: msg.taskId,
          error: e instanceof Error ? e.message : String(e),
        });
      }
      return;
    }

    if (msg.type === "chunk") {
      try {
        const filesWithSymbols = msg.files.map((f) => {
          const syms = (msg.symbols ?? []).filter(
            (s: CodeSymbol) => s.filePath === f.path,
          );
          return { path: f.path, content: f.content, symbols: syms };
        });
        const chunks = await chunkBatched(
          filesWithSymbols,
          msg.repoUrl,
          msg.branch,
          msg.taskId,
          post,
        );
        post({ type: "chunk_result", taskId: msg.taskId, chunks });
      } catch (e) {
        post({
          type: "chunk_error",
          taskId: msg.taskId,
          error: e instanceof Error ? e.message : String(e),
        });
      }
      return;
    }

    if (msg.type === "search") {
      try {
        const results = searchSlice(
          msg.queryEmbedding,
          msg.chunkIds,
          msg.embeddings,
          msg.topK,
        );
        post({ type: "search_result", taskId: msg.taskId, results });
      } catch (e) {
        post({
          type: "search_error",
          taskId: msg.taskId,
          error: e instanceof Error ? e.message : String(e),
        });
      }
      return;
    }
  });

  post({ type: "ready" });
}

attachHandler();