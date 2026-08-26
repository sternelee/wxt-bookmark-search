/**
 * Embedding 统一入口 — 根据 `embedBackend` 路由到本地 (on-device) 或远程 (API) 实现
 *
 * - "local"  → @ternlight/mini (WASM, 384 维, 无网络)
 * - "remote" → OpenAI-compatible HTTP API（默认，向后兼容）
 *
 * 公共 API 与 0.x 完全一致，仅新增最后一个可选参数 `embedBackend`。
 * 旧调用方未传该参数时默认 "remote"，行为不变。
 */

import { EMBEDDING_VECTOR_DIM } from "./types";
import type { Settings } from "./types";
import {
  localEmbed,
  localBatchEmbed,
  testLocalEmbedding,
  LOCAL_EMBEDDING_DIM,
  LOCAL_MODEL_NAME,
} from "./embedding-local";

export const DEFAULT_BASE_URL = "https://api.openai.com/v1";
export const DEFAULT_MODEL = "text-embedding-3-small";
const MAX_INPUT_LENGTH = 8000;

/** 嵌入后端选择 */
export type EmbedBackend = "local" | "remote";

/**
 * 将本地 384 维向量零填充到 EMBEDDING_VECTOR_DIM (1024)。
 * 零填充不改变余弦相似度（点积/模长不变），使 local 与 remote 向量可在同一 Orama 索引中共存。
 */
function padLocalVector(v: number[]): number[] {
  if (v.length >= EMBEDDING_VECTOR_DIM) return v;
  const padded = new Array<number>(EMBEDDING_VECTOR_DIM).fill(0);
  for (let i = 0; i < v.length; i++) padded[i] = v[i];
  return padded;
}

/** 缓存配置 */
const CACHE_CONFIG = {
  maxSize: 100, // 最大缓存条目数
  ttlMs: 30 * 60 * 1000, // 缓存过期时间 30 分钟
};

/** 缓存条目 */
interface CacheEntry {
  embedding: number[];
  timestamp: number;
}

/** LRU 缓存 */
class EmbeddingCache {
  private cache = new Map<string, CacheEntry>();
  private maxSize: number;
  private ttlMs: number;

  constructor(maxSize: number, ttlMs: number) {
    this.maxSize = maxSize;
    this.ttlMs = ttlMs;
  }

  /** 生成缓存 key，加入 backend/context/model 前缀避免混用 */
  private hash(
    text: string,
    context: "query" | "doc" = "doc",
    model: string = DEFAULT_MODEL,
    backend: EmbedBackend = "remote",
  ): string {
    return `${backend}:${model}:${context}:${text.trim().toLowerCase()}`;
  }

  get(
    text: string,
    context: "query" | "doc" = "doc",
    model: string = DEFAULT_MODEL,
    backend: EmbedBackend = "remote",
  ): number[] | null {
    const key = this.hash(text, context, model, backend);
    const entry = this.cache.get(key);

    if (!entry) return null;

    if (Date.now() - entry.timestamp > this.ttlMs) {
      this.cache.delete(key);
      return null;
    }

    this.cache.delete(key);
    this.cache.set(key, entry);

    return entry.embedding;
  }

  set(
    text: string,
    embedding: number[],
    context: "query" | "doc" = "doc",
    model: string = DEFAULT_MODEL,
    backend: EmbedBackend = "remote",
  ): void {
    const key = this.hash(text, context, model, backend);

    if (this.cache.has(key)) {
      this.cache.delete(key);
    }

    while (this.cache.size >= this.maxSize) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey !== undefined) {
        this.cache.delete(firstKey);
      }
    }

    this.cache.set(key, {
      embedding,
      timestamp: Date.now(),
    });
  }

  clear(): void {
    this.cache.clear();
  }

  stats(): { size: number; maxSize: number } {
    return {
      size: this.cache.size,
      maxSize: this.maxSize,
    };
  }

  has(
    text: string,
    context: "query" | "doc" = "doc",
    model: string = DEFAULT_MODEL,
    backend: EmbedBackend = "remote",
  ): boolean {
    const key = this.hash(text, context, model, backend);
    const entry = this.cache.get(key);
    if (!entry) return false;
    if (Date.now() - entry.timestamp > this.ttlMs) {
      this.cache.delete(key);
      return false;
    }
    return true;
  }
}

const embeddingCache = new EmbeddingCache(
  CACHE_CONFIG.maxSize,
  CACHE_CONFIG.ttlMs,
);

export interface EmbeddingResponse {
  object: string;
  data: Array<{
    object: string;
    embedding: number[];
    index: number;
  }>;
  model: string;
  usage: {
    prompt_tokens: number;
    total_tokens: number;
  };
}

export interface EmbeddingError {
  error?: { message?: string; type?: string; code?: number };
  message?: string;
}

/**
 * 解析 embedding 模型名称（本地后端始终返回本地模型标签）
 */
function resolveModel(model: string | undefined, backend: EmbedBackend): string {
  if (backend === "local") return LOCAL_MODEL_NAME;
  return model || DEFAULT_MODEL;
}

/**
 * 单条 embedding — 根据 backend 分派
 *
 * 返回 shape 保持 { embedding, tokens, cached } 不变
 */
export async function getEmbedding(
  text: string,
  apiKey: string,
  signal?: AbortSignal,
  model: string = DEFAULT_MODEL,
  baseURL: string = DEFAULT_BASE_URL,
  context: "query" | "doc" = "doc",
  backend: EmbedBackend = "remote",
): Promise<{ embedding: number[]; tokens: number; cached: boolean }> {
  const effectiveModel = resolveModel(model, backend);

  // 缓存查询
  const cached = embeddingCache.get(text, context, effectiveModel, backend);
  if (cached) {
    return { embedding: cached, tokens: 0, cached: true };
  }

  let embedding: number[];
  let tokens = 0;

  if (backend === "local") {
    // 本地后端：忽略 apiKey / baseURL / model；忽略 signal（同步 CPU 调用）
    embedding = padLocalVector(await localEmbed(text));
  } else {
    // 远程后端
    const truncatedText = text.slice(0, MAX_INPUT_LENGTH);
    const endpoint = `${baseURL}/v1/embeddings`;

    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        input: truncatedText,
      }),
      signal,
    });

    if (!response.ok) {
      const error = (await response.json().catch(() => ({}))) as EmbeddingError;
      throw new Error(
        error.error?.message || error.message || `API error: ${response.status}`,
      );
    }

    const data = (await response.json()) as EmbeddingResponse;
    embedding = data.data[0].embedding;
    tokens = data.usage.total_tokens;
  }

  embeddingCache.set(text, embedding, context, effectiveModel, backend);

  return { embedding, tokens, cached: false };
}

/** 单次 API 请求最大批量条数（仅远程后端使用） */
const MAX_BATCH_CHUNK = 32;

/**
 * 批量 embedding — 根据 backend 分派
 */
export async function batchEmbedTexts(
  texts: string[],
  apiKey: string,
  model: string = DEFAULT_MODEL,
  baseURL: string = DEFAULT_BASE_URL,
  backend: EmbedBackend = "remote",
): Promise<number[][]> {
  if (texts.length === 0) return [];

  const effectiveModel = resolveModel(model, backend);
  const results: number[][] = new Array(texts.length);
  const uncachedIndices: number[] = [];
  const uncachedTexts: string[] = [];

  // 1. 检查缓存
  texts.forEach((text, i) => {
    const cached = embeddingCache.get(text, "doc", effectiveModel, backend);
    if (cached) {
      results[i] = cached;
    } else {
      uncachedIndices.push(i);
      uncachedTexts.push(text);
    }
  });

  if (uncachedTexts.length === 0) return results;

  console.log(
    `[embedding] Cache hit: ${texts.length - uncachedTexts.length}/${texts.length} (backend=${backend})`,
  );

  // 2. 本地后端：串行推理，零填充到 EMBEDDING_VECTOR_DIM
  if (backend === "local") {
    const vectors = await localBatchEmbed(uncachedTexts);
    vectors.forEach((vec, i) => {
      const globalIdx = uncachedIndices[i];
      const padded = padLocalVector(vec);
      results[globalIdx] = padded;
      embeddingCache.set(uncachedTexts[i], padded, "doc", effectiveModel, backend);
    });
    return results;
  }

  // 3. 远程后端：分批 HTTP 请求
  const truncated = uncachedTexts.map((t) => t.slice(0, MAX_INPUT_LENGTH));
  const endpoint = `${baseURL}/v1/embeddings`;

  for (
    let chunkStart = 0;
    chunkStart < truncated.length;
    chunkStart += MAX_BATCH_CHUNK
  ) {
    const chunkTexts = truncated.slice(
      chunkStart,
      chunkStart + MAX_BATCH_CHUNK,
    );
    const chunkOriginals = uncachedTexts.slice(
      chunkStart,
      chunkStart + MAX_BATCH_CHUNK,
    );
    const chunkIndices = uncachedIndices.slice(
      chunkStart,
      chunkStart + MAX_BATCH_CHUNK,
    );

    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        input: chunkTexts,
      }),
    });

    if (!response.ok) {
      const error = (await response.json().catch(() => ({}))) as EmbeddingError;
      throw new Error(
        error.error?.message ||
          error.message ||
          `API error: ${response.status}`,
      );
    }

    const data = (await response.json()) as EmbeddingResponse;
    const embeddings = data.data
      .sort((a, b) => a.index - b.index)
      .map((d) => d.embedding);

    embeddings.forEach((embedding, i) => {
      const globalIdx = chunkIndices[i];
      results[globalIdx] = embedding;
      embeddingCache.set(chunkOriginals[i], embedding, "doc", effectiveModel, backend);
    });
  }

  return results;
}

/**
 * BGE-M3 等指令型 embedding 模型需要查询前缀才能正确对齐 query-doc 向量空间。
 * 本地后端使用 MiniLM 蒸馏模型，不加前缀。
 */
function getQueryInstructionPrefix(model: string, backend: EmbedBackend): string {
  if (backend === "local") return "";
  const lower = model.toLowerCase();
  if (
    lower.includes("bge") ||
    lower.includes("gte") ||
    lower.includes("e5") ||
    lower.includes("m3")
  ) {
    return "Represent this sentence for searching relevant passages: ";
  }
  return "";
}

/** 生成查询向量 (优先使用缓存，使用 query 上下文) */
export async function getQueryEmbedding(
  query: string,
  apiKey: string,
  signal?: AbortSignal,
  model: string = DEFAULT_MODEL,
  baseURL: string = DEFAULT_BASE_URL,
  backend: EmbedBackend = "remote",
): Promise<number[]> {
  const effectiveModel = resolveModel(model, backend);
  const instruction = getQueryInstructionPrefix(effectiveModel, backend);
  const { embedding } = await getEmbedding(
    instruction + query,
    apiKey,
    signal,
    model,
    baseURL,
    "query",
    backend,
  );
  return embedding;
}

/**
 * 测试 API Key / 本地引擎可用性
 *
 * - local: 直接调用本地引擎一次，确认输出维度正确
 * - remote: 发送一次测试 embedding 请求
 */
export async function testApiKey(
  apiKey: string,
  model: string = DEFAULT_MODEL,
  baseURL: string = DEFAULT_BASE_URL,
  backend: EmbedBackend = "remote",
): Promise<true> {
  if (backend === "local") {
    return testLocalEmbedding();
  }
  await getEmbedding("test", apiKey, undefined, model, baseURL, "doc", backend);
  return true;
}

/** 清空向量缓存（local + remote 共享同一缓存实例，键含 backend 前缀互不干扰） */
export function clearEmbeddingCache(): void {
  embeddingCache.clear();
}

/** 获取缓存统计 */
export function getCacheStats(): { size: number; maxSize: number } {
  return embeddingCache.stats();
}

/** 检查查询向量是否已缓存 */
export function hasCachedQuery(
  query: string,
  model: string = DEFAULT_MODEL,
  backend: EmbedBackend = "remote",
): boolean {
  const effectiveModel = resolveModel(model, backend);
  return embeddingCache.has(query, "query", effectiveModel, backend);
}

/** 重新导出本地模型元数据（供 UI 展示） */
export { LOCAL_EMBEDDING_DIM, LOCAL_MODEL_NAME };
