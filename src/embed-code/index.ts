/**
 * Orama code search engine — 独立实例，与 bookmark 引擎隔离
 * 这是代码搜索引擎的**唯一所有者**。其他模块应通过此模块的 barrel export 使用。
 */
import {
  create,
  insertMultiple,
  removeMultiple,
  save,
  load,
  search,
} from "@orama/orama";
import type { AnyOrama, RawData } from "@orama/orama";
import { EMBEDDING_VECTOR_DIM } from "../types";
import type { CodeSearchResult, CodeChunk } from "../types";

/** Orama schema（code 专用） */
const codeSchema = {
  id: "string",
  content: "string",
  language: "string",
  filePath: "string",
  symbolName: "string",
  kind: "enum",
  lineStart: "number",
  lineEnd: "number",
  repoUrl: "string",
  branch: "string",
  embedding: `vector[${EMBEDDING_VECTOR_DIM}]`,
} as const;

type CodeDocument = {
  id: string;
  content: string;
  language: string;
  filePath: string;
  symbolName: string;
  kind: string;
  lineStart: number;
  lineEnd: number;
  repoUrl: string;
  branch: string;
  embedding: number[];
};

let codeEngine: AnyOrama | null = null;
export const ORAMA_CODE_INDEX_STORAGE_KEY = "orama_code_index";

/** 初始化代码搜索引擎 */
export async function initCodeSearchEngine(): Promise<void> {
  codeEngine = create({
    schema: codeSchema as any,
    id: "flowsearch_code",
  });
}

/** 从序列化数据恢复代码搜索引擎 */
export function loadCodeSearchEngine(raw: RawData): void {
  if (!codeEngine) {
    codeEngine = create({ schema: codeSchema as any, id: "flowsearch_code" });
  }
  load(codeEngine, raw);
}

/** 序列化代码搜索引擎 */
export function saveCodeSearchEngine(): RawData | null {
  if (!codeEngine) return null;
  return save(codeEngine);
}

/** 是否已初始化 */
export function isCodeSearchEngineReady(): boolean {
  return codeEngine !== null;
}

/** 确保代码搜索引擎已初始化（懒初始化） */
export async function ensureCodeSearchEngine(): Promise<void> {
  if (!codeEngine) await initCodeSearchEngine();
}

function chunkToDoc(chunk: CodeChunk, embedding: number[]): CodeDocument {
  return {
    id: chunk.id,
    content: chunk.content,
    language: chunk.language,
    filePath: chunk.filePath,
    symbolName: chunk.symbolName,
    kind: chunk.kind,
    lineStart: chunk.lineStart,
    lineEnd: chunk.lineEnd,
    repoUrl: chunk.repoUrl,
    branch: chunk.branch,
    embedding,
  };
}

function docToResult(doc: CodeDocument, score?: number): CodeSearchResult {
  return {
    id: doc.id,
    name: doc.symbolName,
    kind: doc.kind as CodeSearchResult["kind"],
    filePath: doc.filePath,
    lineStart: doc.lineStart,
    lineEnd: doc.lineEnd,
    repoUrl: doc.repoUrl,
    score: score ?? 0,
    excerpt: doc.content,
  };
}

/**
 * 批量导入代码块到搜索引擎（需预计算 embedding）
 *
 * @param records - { chunk, embedding }[]
 * @returns 导入数量
 */
export async function populateCodeSearchEngine(
  records: { chunk: CodeChunk; embedding: number[] }[],
): Promise<number> {
  if (!codeEngine) throw new Error("Code search engine not initialized");
  if (records.length === 0) return 0;
  const docs = records.map((r) => chunkToDoc(r.chunk, r.embedding));
  await insertMultiple(codeEngine, docs as any, 500);
  return docs.length;
}

/**
 * 批量 upsert 代码块（先删后插）
 *
 * @param records - { chunk, embedding }[]
 */
export async function upsertCodeSearchBatch(
  records: { chunk: CodeChunk; embedding: number[] }[],
): Promise<void> {
  if (!codeEngine) return;
  if (records.length === 0) return;
  const docs = records.map((r) => chunkToDoc(r.chunk, r.embedding));
  const ids = docs.map((d) => d.id);
  try {
    await removeMultiple(codeEngine, ids);
  } catch {
    /* some may not exist */
  }
  await insertMultiple(codeEngine, docs as any, 500);
}

/**
 * 按文件路径删除所有相关代码块
 *
 * @param filePath - 文件路径
 */
export async function removeCodeSearchByFile(filePath: string): Promise<void> {
  if (!codeEngine) return;
  try {
    const results = await search(codeEngine, {
      term: filePath,
      properties: ["filePath"],
      exact: true,
      limit: 1000,
    });
    const ids = results.hits.map((h) => (h.document as CodeDocument).id);
    if (ids.length > 0) {
      await removeMultiple(codeEngine, ids);
    }
  } catch (e) {
    console.warn("[embed-code] removeCodeSearchByFile failed:", e instanceof Error ? e.message : String(e));
  }
}

/** 按 repo 清空代码块（用于重建） */
export async function clearCodeSearchByRepo(repoUrl: string): Promise<void> {
  if (!codeEngine) return;
  try {
    const results = await search(codeEngine, {
      term: "",
      where: { repoUrl },
      limit: 100000,
    } as any);
    const ids = (results.hits as unknown as Array<{ document: CodeDocument }>).map(
      (h) => h.document.id,
    );
    if (ids.length > 0) {
      await removeMultiple(codeEngine, ids);
    }
  } catch (e) {
    console.warn("[embed-code] clearCodeSearchByRepo failed:", e instanceof Error ? e.message : String(e));
  }
}

/**
 * 混合搜索（全文 + 向量）
 */
export async function searchCodeHybrid(
  query: string,
  queryEmbedding: number[],
  options: {
    limit?: number;
    vectorWeight?: number;
    repoUrl?: string;
  } = {},
): Promise<CodeSearchResult[]> {
  if (!codeEngine) return [];

  const limit = options.limit || 10;
  const vectorWeight = options.vectorWeight || 0.5;
  const textWeight = 1 - vectorWeight;

  const where: Record<string, unknown> = {};
  if (options.repoUrl) {
    where.repoUrl = options.repoUrl;
  }

  const results = await search(codeEngine, {
    term: query,
    mode: "hybrid",
    vector: { value: queryEmbedding, property: "embedding" },
    limit,
    properties: ["content", "symbolName", "filePath"],
    hybridWeights: { text: textWeight, vector: vectorWeight },
    tolerance: 1,
    ...(Object.keys(where).length > 0 ? ({ where } as any) : {}),
  });

  return results.hits.map((h) =>
    docToResult(h.document as CodeDocument, h.score),
  );
}

/** 纯向量搜索 */
export async function searchCodeVector(
  queryEmbedding: number[],
  options: {
    limit?: number;
    repoUrl?: string;
  } = {},
): Promise<CodeSearchResult[]> {
  if (!codeEngine) return [];

  const limit = options.limit || 10;
  const where: Record<string, unknown> = {};
  if (options.repoUrl) {
    where.repoUrl = options.repoUrl;
  }

  const results = await search(codeEngine, {
    mode: "vector",
    vector: { value: queryEmbedding, property: "embedding" },
    limit,
    ...(Object.keys(where).length > 0 ? ({ where } as any) : {}),
  });

  return results.hits.map((h) =>
    docToResult(h.document as CodeDocument, h.score),
  );
}

/** 纯关键词搜索（无 API key fallback） */
export async function searchCodeKeyword(
  query: string,
  options: {
    limit?: number;
    repoUrl?: string;
  } = {},
): Promise<CodeSearchResult[]> {
  if (!codeEngine) return [];

  const limit = options.limit || 10;
  const where: Record<string, unknown> = {};
  if (options.repoUrl) {
    where.repoUrl = options.repoUrl;
  }

  const results = await search(codeEngine, {
    term: query,
    limit,
    properties: ["content", "symbolName", "filePath"],
    tolerance: 1,
    ...(Object.keys(where).length > 0 ? ({ where } as any) : {}),
  });

  return results.hits.map((h) =>
    docToResult(h.document as CodeDocument, h.score),
  );
}

/** 持久化回调注入 */
type SaveFn = () => Promise<void>;
let _codeSaveFn: SaveFn | null = null;
let _codeSaveTimer: ReturnType<typeof setTimeout> | null = null;

/** 注册代码搜索引擎持久化回调 */
export function registerCodeSaveFn(fn: SaveFn): void {
  _codeSaveFn = fn;
}

function clearPendingCodeSaveTimer(): void {
  if (_codeSaveTimer) {
    clearTimeout(_codeSaveTimer);
    _codeSaveTimer = null;
  }
}

/** 调度代码搜索引擎持久化（5s 去抖） */
export function scheduleSaveCodeSearchEngine(): void {
  if (!_codeSaveFn) return;
  clearPendingCodeSaveTimer();
  _codeSaveTimer = setTimeout(() => {
    _codeSaveFn!().catch(() => {});
    _codeSaveTimer = null;
  }, 5000);
}

/** 立即持久化 */
export async function flushSaveCodeSearchEngine(): Promise<void> {
  if (!_codeSaveFn) return;
  clearPendingCodeSaveTimer();
  await _codeSaveFn();
}

/** 重置代码搜索引擎 */
export async function resetCodeSearchEngine(): Promise<void> {
  clearPendingCodeSaveTimer();
  await initCodeSearchEngine();
}
