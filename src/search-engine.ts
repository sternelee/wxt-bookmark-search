/**
 * Orama search engine wrapper — 统一全文/向量/混合搜索
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
import { REMOTE_VECTOR_DIM } from "./embedding-space";
import type { BookmarkRecord } from "./types";
import { getFreqCache } from "./freq";

/**
 * Orama schema（字符串简写形式）
 *
 * embedding 维度由 `getEmbeddingDim(settings)` 决定，随 embedding 后端变化：
 * local = 384，remote = 1024。索引与查询向量必须使用同一维度。
 */
function buildBookmarkSchema(dim: number) {
  return {
    id: "string",
    url: "string",
    title: "string",
    summary: "string",
    tags: "string[]",
    source: "enum",
    status: "enum",
    indexedAt: "number",
    embedding: `vector[${dim}]`,
    freq: "number",
    linkStatus: "number",
    linkCheckedAt: "number",
    error: "string",
    tweetId: "string",
    authorHandle: "string",
    authorName: "string",
    postedAt: "string",
    engagement_likeCount: "number",
    engagement_repostCount: "number",
    quotedTweetText: "string",
    media: "string[]",
  } as const;
}

type BookmarkDocument = {
  id: string;
  url: string;
  title: string;
  summary: string;
  tags: string[];
  source: string;
  status: string;
  indexedAt: number;
  embedding: number[];
  freq: number;
  linkStatus: number;
  linkCheckedAt: number;
  error: string;
  tweetId: string;
  authorHandle: string;
  authorName: string;
  postedAt: string;
  engagement_likeCount: number;
  engagement_repostCount: number;
  quotedTweetText: string;
  media: string[];
};

let engine: AnyOrama | null = null;
/** 当前引擎的向量维度（决定 schema 与查询向量长度） */
let currentDim: number = REMOTE_VECTOR_DIM;
export const ORAMA_INDEX_STORAGE_KEY = "orama_index";
/** 与 ORAMA_INDEX_STORAGE_KEY 配套的向量空间指纹 — 不匹配时必须重建而非加载 */
export const ORAMA_INDEX_SPACE_KEY = "orama_index_space";

/** 当前引擎向量维度 */
export function getSearchEngineDim(): number {
  return currentDim;
}

/** 初始化搜索引擎（dim 省略时沿用上一次的维度） */
export async function initSearchEngine(dim?: number): Promise<void> {
  if (dim && dim > 0) currentDim = dim;
  engine = create({
    schema: buildBookmarkSchema(currentDim) as any,
    id: "flowsearch",
  });
}

/** 从序列化数据恢复搜索引擎（dim 必须与当前引擎一致，否则抛错） */
export function loadSearchEngine(raw: RawData, dim?: number): void {
  if (dim && dim !== currentDim) {
    throw new Error(
      `Orama index dim mismatch: stored=${dim} current=${currentDim}`,
    );
  }
  if (!engine) {
    engine = create({ schema: buildBookmarkSchema(currentDim) as any, id: "flowsearch" });
  }
  load(engine, raw);
}

/** 序列化搜索引擎 */
export function saveSearchEngine(): RawData | null {
  if (!engine) return null;
  return save(engine);
}

/** 是否已初始化 */
export function isSearchEngineReady(): boolean {
  return engine !== null;
}

function recordToDoc(r: BookmarkRecord): BookmarkDocument {
  return {
    id: r.id,
    url: r.url,
    title: r.title,
    summary: r.summary || "",
    tags: r.tags || [],
    source: r.source || "bookmark",
    status: r.status,
    indexedAt: r.indexedAt || 0,
    embedding: r.embedding || [],
    freq: 0,
    linkStatus: r.linkStatus || 0,
    linkCheckedAt: r.linkCheckedAt || 0,
    error: r.error || "",
    tweetId: r.tweetId || "",
    authorHandle: r.authorHandle || "",
    authorName: r.authorName || "",
    postedAt: r.postedAt || "",
    engagement_likeCount: r.engagement?.likeCount || 0,
    engagement_repostCount: r.engagement?.repostCount || 0,
    quotedTweetText: r.quotedTweetText || "",
    media: r.media || [],
  };
}

function docToRecord(doc: BookmarkDocument): BookmarkRecord {
  return {
    id: doc.id,
    url: doc.url,
    title: doc.title,
    summary: doc.summary,
    tags: doc.tags,
    source: (doc.source as BookmarkRecord["source"]) || "bookmark",
    status: (doc.status as BookmarkRecord["status"]) || "indexed",
    indexedAt: doc.indexedAt,
    embedding: doc.embedding,
    tweetId: doc.tweetId || undefined,
    authorHandle: doc.authorHandle || undefined,
    authorName: doc.authorName || undefined,
    postedAt: doc.postedAt || undefined,
    engagement:
      doc.engagement_likeCount !== 0 || doc.engagement_repostCount !== 0
        ? {
            likeCount:
              doc.engagement_likeCount !== 0
                ? doc.engagement_likeCount
                : undefined,
            repostCount:
              doc.engagement_repostCount !== 0
                ? doc.engagement_repostCount
                : undefined,
          }
        : undefined,
    quotedTweetText: doc.quotedTweetText || undefined,
    media: doc.media.length > 0 ? doc.media : undefined,
    linkStatus: doc.linkStatus,
    linkCheckedAt: doc.linkCheckedAt,
    error: doc.error || undefined,
  };
}

/** 批量导入书签到搜索引擎 */
export async function populateSearchEngine(
  records: BookmarkRecord[],
): Promise<number> {
  if (!engine) throw new Error("Search engine not initialized");
  if (records.length === 0) return 0;
  const docs = records
    .filter((r) => r.status === "indexed" && r.embedding?.length)
    .map(recordToDoc);
  if (docs.length === 0) return 0;
  await insertMultiple(engine, docs as any, 500);
  return docs.length;
}

/** 添加或更新书签 */
export async function upsertSearchEngine(
  record: BookmarkRecord,
): Promise<void> {
  if (!engine) return;
  if (record.status !== "indexed" || !record.embedding?.length) return;
  try {
    await removeMultiple(engine, [record.id]);
  } catch {
    /* not found */
  }
  await insertMultiple(engine, [recordToDoc(record) as any], 500);
}

/** 批量添加或更新书签 */
export async function upsertSearchEngineBatch(
  records: BookmarkRecord[],
): Promise<void> {
  if (!engine) return;
  const validDocs = records
    .filter((r) => r.status === "indexed" && r.embedding?.length)
    .map(recordToDoc);
  if (validDocs.length === 0) return;
  // 先批量删除旧记录
  const ids = validDocs.map((d) => d.id);
  try {
    await removeMultiple(engine, ids);
  } catch {
    /* some may not exist */
  }
  await insertMultiple(engine, validDocs as any, 500);
}

/** 删除书签 */
export async function removeFromSearchEngine(id: string): Promise<void> {
  if (!engine) return;
  try {
    await removeMultiple(engine, [id]);
  } catch {
    /* ignore */
  }
}

/** 频率排序后处理的最大权重 */
const FREQ_BOOST_MAX = 0.15;

/** 将访问频率权重融入 Orama 搜索结果 */
function applyFreqBoost(
  hits: Array<{ document: unknown; score: number }>,
): BookmarkRecord[] {
  const freqCache = getFreqCache();
  const maxFreq = Math.max(1, ...Object.values(freqCache));

  const boosted = hits.map((hit) => {
    const doc = hit.document as unknown as BookmarkDocument;
    const freq = freqCache[doc.url] ?? 0;
    const boost = (freq / maxFreq) * FREQ_BOOST_MAX;
    return { record: docToRecord(doc), score: hit.score + boost };
  });

  boosted.sort((a, b) => b.score - a.score);
  return boosted.map((b) => b.record);
}

/** 持久化回调注入 */
type SaveFn = () => Promise<void>;
let _saveFn: SaveFn | null = null;
let _saveTimer: ReturnType<typeof setTimeout> | null = null;

/** 注册搜索引擎持久化回调（由 entrypoint 注入 browser.storage 逻辑） */
export function registerSaveFn(fn: SaveFn): void {
  _saveFn = fn;
}

function clearPendingSaveTimer(): void {
  if (_saveTimer) {
    clearTimeout(_saveTimer);
    _saveTimer = null;
  }
}

/** 调度搜索引擎持久化（5s 去抖） */
export function scheduleSaveSearchEngine(): void {
  if (!_saveFn) return;
  clearPendingSaveTimer();
  _saveTimer = setTimeout(() => {
    _saveFn!().catch(() => {});
    _saveTimer = null;
  }, 5000);
}

/** 立即持久化当前搜索引擎并清空待执行的去抖保存。 */
export async function flushSaveSearchEngine(): Promise<void> {
  if (!_saveFn) return;
  clearPendingSaveTimer();
  await _saveFn();
}

/**
 * 重置内存中的搜索引擎状态，并取消任何待执行的保存。
 * 传 dim 时同时切换索引维度（切换 embedding 后端后必须调用）。
 */
export async function resetSearchEngine(dim?: number): Promise<void> {
  clearPendingSaveTimer();
  await initSearchEngine(dim);
}

/** 混合搜索 */
export async function searchHybrid(
  query: string,
  queryEmbedding: number[],
  options: {
    limit?: number;
    vectorWeight?: number;
    sourceFilter?: BookmarkRecord["source"];
    idFilter?: string[];
  } = {},
): Promise<BookmarkRecord[]> {
  if (!engine) return [];

  const limit = options.limit || 9;
  const vectorWeight = options.vectorWeight || 0.4;
  const textWeight = 1 - vectorWeight;

  const where: any = {};
  if (options.sourceFilter) {
    where.source = { eq: options.sourceFilter };
  }
  if (options.idFilter && options.idFilter.length > 0) {
    where.id = options.idFilter;
  }

  const results = await search(engine, {
    term: query,
    mode: "hybrid",
    vector: { value: queryEmbedding, property: "embedding" },
    limit,
    properties: ["url", "title", "summary", "tags"],
    hybridWeights: { text: textWeight, vector: vectorWeight },
    tolerance: 1,
    ...(Object.keys(where).length > 0 ? ({ where } as any) : {}),
  });

  return applyFreqBoost(results.hits);
}

/** 纯向量搜索（用于 RAG 问答） */
export async function searchVector(
  queryEmbedding: number[],
  options: {
    limit?: number;
    sourceFilter?: BookmarkRecord["source"];
    idFilter?: string[];
  } = {},
): Promise<BookmarkRecord[]> {
  if (!engine) return [];

  const limit = options.limit || 8;

  const where: any = {};
  if (options.sourceFilter) {
    where.source = { eq: options.sourceFilter };
  }
  if (options.idFilter && options.idFilter.length > 0) {
    where.id = { in: options.idFilter };
  }

  const results = await search(engine, {
    mode: "vector",
    vector: { value: queryEmbedding, property: "embedding" },
    limit,
    ...(Object.keys(where).length > 0 ? ({ where } as any) : {}),
  });

  return applyFreqBoost(results.hits);
}

/** 纯全文搜索（无 API key 时的 fallback） */
export async function searchKeyword(
  query: string,
  options: {
    limit?: number;
    sourceFilter?: BookmarkRecord["source"];
    idFilter?: string[];
  } = {},
): Promise<BookmarkRecord[]> {
  if (!engine) return [];
  const where: { source?: { eq: BookmarkRecord["source"] }; id?: string[] } = {};
  if (options.sourceFilter) {
    where.source = { eq: options.sourceFilter };
  }
  if (options.idFilter && options.idFilter.length > 0) {
    where.id = options.idFilter;
  }

  const results = await search(engine, {
    term: query,
    limit: options.limit || 9,
    properties: ["url", "title", "summary", "tags"],
    tolerance: 1,
    ...(Object.keys(where).length > 0 ? ({ where } as any) : {}),
  });

  return applyFreqBoost(results.hits);
}

// Code Wiki 搜索引擎已迁移至 src/embed-code/index.ts（避免重复实例）。
// 原代码块已删除；任何残留 import 见 embed-code 模块的 barrel re-export。
