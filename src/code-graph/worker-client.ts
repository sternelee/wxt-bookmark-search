/**
 * SW-side worker pool client — splits heavy work across N Web Workers.
 *
 * Strategy:
 * 1. On first use, create an offscreen document hosting a pool of N workers
 *    (N = navigator.hardwareConcurrency / 2, clamped to [1, 8]).
 * 2. For parse/chunk tasks: split the file list into N contiguous batches,
 *    dispatch each batch to a different worker in parallel via Promise.all.
 * 3. Merge per-worker results into the unified output.
 * 4. Progress events aggregate done counts across all batches.
 * 5. If offscreen fails (Firefox, no permission): fall back to in-SW
 *    cooperative yielding (the existing parseFiles / chunkFiles).
 *
 * Public API:
 *   parseViaWorker(files, repoUrl, branch, onProgress?): Promise<{symbols, edges}>
 *   chunkViaWorker(files, symbols, repoUrl, branch, onProgress?): Promise<chunks>
 *   getPoolStatus(): Promise<{size, busy, queued}>
 *   shutdownWorker(): closes the offscreen document.
 */

import { parseFiles } from "./parser";
import { chunkFiles } from "../embed-code/chunk";
import type { CodeSymbol, CodeEdge, CodeChunk } from "../types";

type WorkerRequest = import("./parser.worker").WorkerRequest;
type WorkerResponse = import("./parser.worker").WorkerResponse;

declare const chrome: {
  offscreen?: {
    createDocument: (params: {
      url: string;
      reasons: ("WORKERS" | string)[];
      justification?: string;
    }) => Promise<void>;
    closeDocument?: (params: { url: string }) => Promise<void>;
  };
  runtime: {
    getURL: (path: string) => string;
    sendMessage: (message: unknown) => Promise<unknown> | unknown;
    onMessage: {
      addListener: (
        listener: (
          message: {
            type?: string;
            message?: WorkerResponse;
          },
          sender: unknown,
          sendResponse: (response?: unknown) => void,
        ) => void,
      ) => void;
    };
  };
};

const OFFSCREEN_URL = "offscreen.html";

/** Worker availability cache: null=not tested, true=available, false=fallback */
let workerAvailable: boolean | null = null;

/** Pool size (set after first POOL_INFO response) */
let poolSizeCache: number | null = null;

/** Pending tasks, keyed by taskId */
const pendingTasks = new Map<
  string,
  {
    resolve: (value: unknown) => void;
    reject: (error: Error) => void;
    onProgress?: (done: number, total: number) => void;
  }
>();

let taskCounter = 0;
function nextTaskId(prefix: string): string {
  taskCounter += 1;
  return `${prefix}-${Date.now()}-${taskCounter}`;
}

let listenerInstalled = false;
function installListener() {
  if (listenerInstalled) return;
  listenerInstalled = true;
  try {
    chrome.runtime.onMessage.addListener((message) => {
      if (message?.type === "TASK_MESSAGE" && message.message) {
        const msg = message.message as WorkerResponse;
        if (msg.type === "ready") return;
        const taskId = extractTaskId(msg);
        if (!taskId) return;
        const pending = pendingTasks.get(taskId);
        if (!pending) return;
        if (msg.type === "parse_progress" || msg.type === "chunk_progress") {
          pending.onProgress?.(msg.done, msg.total);
          return;
        }
        if (msg.type === "parse_result") {
          pendingTasks.delete(taskId);
          pending.resolve({ symbols: msg.symbols, edges: msg.edges });
          return;
        }
        if (msg.type === "chunk_result") {
          pendingTasks.delete(taskId);
          pending.resolve(msg.chunks);
          return;
        }
        if (msg.type === "parse_error" || msg.type === "chunk_error") {
          pendingTasks.delete(taskId);
          pending.reject(new Error(msg.error));
          return;
        }
      }
    });
  } catch (e) {
    console.warn(
      "[worker-client] failed to install listener:",
      e instanceof Error ? e.message : String(e),
    );
  }
}

function extractTaskId(msg: WorkerResponse): string | undefined {
  switch (msg.type) {
    case "parse_progress":
    case "parse_result":
    case "parse_error":
    case "chunk_progress":
    case "chunk_result":
    case "chunk_error":
      return msg.taskId;
    default:
      return undefined;
  }
}

async function ensureOffscreenDocument(): Promise<boolean> {
  if (workerAvailable !== null) return workerAvailable;
  if (typeof chrome === "undefined" || !chrome.offscreen) {
    workerAvailable = false;
    return false;
  }
  try {
    await chrome.offscreen.createDocument({
      url: chrome.runtime.getURL(OFFSCREEN_URL),
      reasons: ["WORKERS"],
      justification:
        "AST parsing for Code Wiki uses the TypeScript Compiler API which is CPU-bound.",
    });
    workerAvailable = true;
    installListener();
    return true;
  } catch (e) {
    console.warn(
      "[worker-client] offscreen createDocument failed:",
      e instanceof Error ? e.message : String(e),
    );
    workerAvailable = false;
    return false;
  }
}

/** Query the offscreen page for its pool size. */
async function getPoolSize(): Promise<number> {
  if (poolSizeCache !== null) return poolSizeCache;
  try {
    const reply = await chrome.runtime.sendMessage({ type: "POOL_QUERY" });
    const info = reply as { size?: number } | undefined;
    if (info && typeof info.size === "number" && info.size > 0) {
      poolSizeCache = info.size;
      return info.size;
    }
  } catch {
    /* fall through to default */
  }
  poolSizeCache = 1;
  return 1;
}

/** Split array into N contiguous chunks (last chunk may be smaller). */
function splitIntoChunks<T>(items: T[], n: number): T[][] {
  const size = Math.max(1, Math.min(n, items.length));
  if (size <= 1 || items.length === 0) return [items];
  const chunks: T[][] = [];
  const baseSize = Math.floor(items.length / size);
  const remainder = items.length % size;
  let offset = 0;
  for (let i = 0; i < size; i++) {
    const chunkSize = baseSize + (i < remainder ? 1 : 0);
    chunks.push(items.slice(offset, offset + chunkSize));
    offset += chunkSize;
  }
  return chunks;
}

function sendTask(req: WorkerRequest): Promise<unknown> {
  return new Promise((resolve, reject) => {
    pendingTasks.set(req.taskId, { resolve, reject });
    try {
      void chrome.runtime.sendMessage({
        type: "SEND_TASK",
        task: req,
      });
    } catch (e) {
      pendingTasks.delete(req.taskId);
      reject(e instanceof Error ? e : new Error(String(e)));
    }
  });
}

/**
 * Parse files using the worker pool (if available) or in-SW fallback.
 * Splits the file list across N workers for true parallel CPU usage.
 */
export async function parseViaWorker(
  files: { path: string; content: string }[],
  repoUrl: string,
  branch: string,
  onProgress?: (done: number, total: number) => void,
): Promise<{ symbols: CodeSymbol[]; edges: CodeEdge[] }> {
  if (files.length === 0) {
    return { symbols: [], edges: [] };
  }

  const useWorker = await ensureOffscreenDocument();
  if (!useWorker) {
    return parseFiles(files, repoUrl, branch);
  }

  const size = await getPoolSize();
  const batches = splitIntoChunks(files, size);
  const total = files.length;
  let completedBatches = 0;
  // Per-batch partial done (what each batch's worker has reported so far).
  const batchDone = new Array<number>(batches.length).fill(0);

  const aggregateProgress = () => {
    const partial = batchDone.reduce((a, b) => a + b, 0);
    onProgress?.(
      Math.min(total, completedBatches === batches.length ? total : partial),
      total,
    );
  };

  const promises = batches.map(async (batch, i) => {
    const taskId = nextTaskId("parse");
    pendingTasks.set(taskId, {
      resolve: () => {
        completedBatches++;
        batchDone[i] = batch.length;
        aggregateProgress();
      },
      reject: () => {
        completedBatches++;
        batchDone[i] = batch.length;
        aggregateProgress();
      },
      onProgress: (done) => {
        batchDone[i] = done;
        aggregateProgress();
      },
    });
    void chrome.runtime.sendMessage({
      type: "SEND_TASK",
      task: {
        type: "parse",
        taskId,
        files: batch,
        repoUrl,
        branch,
      } as WorkerRequest,
    });
    return new Promise<{ symbols: CodeSymbol[]; edges: CodeEdge[] }>(
      (resolve, reject) => {
        const pending = pendingTasks.get(taskId);
        if (pending) {
          pending.resolve = ((v: unknown) => {
            resolve(v as { symbols: CodeSymbol[]; edges: CodeEdge[] });
          }) as (value: unknown) => void;
          pending.reject = (e: Error) => reject(e);
        }
      },
    );
  });

  const results = await Promise.all(promises);
  const allSymbols: CodeSymbol[] = [];
  const allEdges: CodeEdge[] = [];
  for (const r of results) {
    allSymbols.push(...r.symbols);
    allEdges.push(...r.edges);
  }
  return { symbols: allSymbols, edges: allEdges };
}

/**
 * Chunk files using the worker pool (if available) or in-SW fallback.
 * Splits the file list across N workers for true parallel CPU usage.
 */
export async function chunkViaWorker(
  files: { path: string; content: string; symbols?: CodeSymbol[] }[],
  symbols: CodeSymbol[],
  repoUrl: string,
  branch: string,
  onProgress?: (done: number, total: number) => void,
): Promise<CodeChunk[]> {
  if (files.length === 0) return [];

  const useWorker = await ensureOffscreenDocument();
  if (!useWorker) {
    return chunkFiles(files, repoUrl, branch);
  }

  const size = await getPoolSize();
  const batches = splitIntoChunks(files, size);
  const total = files.length;
  let completedBatches = 0;
  const batchDone = new Array<number>(batches.length).fill(0);

  const aggregateProgress = () => {
    const partial = batchDone.reduce((a, b) => a + b, 0);
    onProgress?.(
      Math.min(total, completedBatches === batches.length ? total : partial),
      total,
    );
  };

  const promises = batches.map(async (batch, i) => {
    const taskId = nextTaskId("chunk");
    pendingTasks.set(taskId, {
      resolve: () => {
        completedBatches++;
        batchDone[i] = batch.length;
        aggregateProgress();
      },
      reject: () => {
        completedBatches++;
        batchDone[i] = batch.length;
        aggregateProgress();
      },
      onProgress: (done) => {
        batchDone[i] = done;
        aggregateProgress();
      },
    });
    void chrome.runtime.sendMessage({
      type: "SEND_TASK",
      task: {
        type: "chunk",
        taskId,
        files: batch.map((f) => ({ path: f.path, content: f.content })),
        symbols: symbols.filter((s) => batch.some((b) => b.path === s.filePath)),
        repoUrl,
        branch,
      } as WorkerRequest,
    });
    return new Promise<CodeChunk[]>((resolve, reject) => {
      const pending = pendingTasks.get(taskId);
      if (pending) {
        const origResolve = pending.resolve;
        const origReject = pending.reject;
        pending.resolve = ((v: unknown) => {
          origResolve(v);
          resolve(v as CodeChunk[]);
        }) as (value: unknown) => void;
        pending.reject = (e: Error) => {
          origReject(e);
          reject(e);
        };
      }
    });
  });

  const results = await Promise.all(promises);
  const all: CodeChunk[] = [];
  for (const r of results) all.push(...r);
  return all;
}

/** Query current pool status (size, busy, queued). */
export async function getPoolStatus(): Promise<{
  size: number;
  busy: number;
  queued: number;
}> {
  if (!(await ensureOffscreenDocument())) {
    return { size: 0, busy: 0, queued: 0 };
  }
  try {
    const reply = (await chrome.runtime.sendMessage({
      type: "POOL_QUERY",
    })) as { size?: number; busy?: number; queued?: number } | undefined;
    if (reply) {
      return {
        size: reply.size ?? 0,
        busy: reply.busy ?? 0,
        queued: reply.queued ?? 0,
      };
    }
  } catch {
    /* ignore */
  }
  return { size: 0, busy: 0, queued: 0 };
}

/**
 * Pool-based vector search for code QA. Splits the chunk list across N
 * workers, each computing cosine similarity for its slice, then merges
 * results via Reciprocal Rank Fusion (RRF).
 */
export async function searchViaWorkerPool(
  queryEmbedding: number[],
  chunks: { id: string }[],
  embeddings: Map<string, number[]>,
  topK: number = 8,
  onProgress?: (phase: string) => void,
): Promise<Array<{ id: string; score: number }>> {
  if (chunks.length === 0 || queryEmbedding.length === 0) return [];

  const useWorker = await ensureOffscreenDocument();
  if (!useWorker) {
    onProgress?.("searching (in-SW)");
    return cosineSimInSW(queryEmbedding, chunks, embeddings, topK);
  }

  onProgress?.("searching (pool)");
  const size = await getPoolSize();
  const batches = splitIntoChunks(chunks, size);

  const embeddingsRecord: Record<string, number[]> = {};
  for (const [k, v] of embeddings) embeddingsRecord[k] = v;

  const promises = batches.map(async (batch) => {
    const taskId = nextTaskId("search");
    return new Promise<Array<{ id: string; score: number }>>((resolve, reject) => {
      pendingTasks.set(taskId, {
        resolve: (v) => resolve(v as Array<{ id: string; score: number }>),
        reject,
      });
      void chrome.runtime.sendMessage({
        type: "SEND_TASK",
        task: {
          type: "search",
          taskId,
          queryEmbedding,
          chunkIds: batch.map((c) => c.id),
          embeddings: embeddingsRecord,
          topK,
        } as WorkerRequest,
      });
    });
  });

  const results = await Promise.all(promises);

  const RRF_K = 60;
  const rrf = new Map<string, number>();
  const meta = new Map<string, number>();
  for (const batchResults of results) {
    for (let i = 0; i < batchResults.length; i++) {
      const r = batchResults[i];
      const rank = i + 1;
      const score = 1 / (RRF_K + rank);
      rrf.set(r.id, (rrf.get(r.id) ?? 0) + score);
      const prev = meta.get(r.id);
      if (prev === undefined || r.score > prev) meta.set(r.id, r.score);
    }
  }
  return [...rrf.entries()]
    .map(([id, score]) => ({ id, score, cosineScore: meta.get(id) ?? 0 }))
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
}

/** In-SW cosine similarity fallback (single-threaded). */
function cosineSimInSW(
  queryEmbedding: number[],
  chunks: { id: string }[],
  embeddings: Map<string, number[]>,
  topK: number,
): Array<{ id: string; score: number }> {
  const qLen = queryEmbedding.length;
  let qNormSq = 0;
  for (let i = 0; i < qLen; i++) qNormSq += queryEmbedding[i] * queryEmbedding[i];
  const qNorm = Math.sqrt(qNormSq) || 1;
  const scored: Array<{ id: string; score: number }> = [];
  for (const chunk of chunks) {
    const v = embeddings.get(chunk.id);
    if (!v || v.length !== qLen) continue;
    let dot = 0;
    let vNormSq = 0;
    for (let i = 0; i < qLen; i++) {
      const a = queryEmbedding[i];
      const b = v[i];
      dot += a * b;
      vNormSq += b * b;
    }
    const vNorm = Math.sqrt(vNormSq) || 1;
    scored.push({ id: chunk.id, score: dot / (qNorm * vNorm) });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, topK);
}

/** Close the offscreen document if it was created. */
export async function shutdownWorker(): Promise<void> {
  if (!workerAvailable) return;
  try {
    await chrome.offscreen?.closeDocument?.({
      url: chrome.runtime.getURL(OFFSCREEN_URL),
    });
  } catch {
    /* ignore */
  }
  workerAvailable = null;
  poolSizeCache = null;
}