/**
 * SiliconFlow Embedding API 封装
 * 包含查询向量缓存
 */

import type { Settings } from './types';

export const DEFAULT_BASE_URL = 'https://api.siliconflow.cn';
export const DEFAULT_MODEL = 'BAAI/bge-m3';
const MAX_INPUT_LENGTH = 8000; // 字符数限制

/** 缓存配置 */
const CACHE_CONFIG = {
  maxSize: 100,           // 最大缓存条目数
  ttlMs: 30 * 60 * 1000,  // 缓存过期时间 30 分钟
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

  /** 生成缓存 key，加入 context 前缀避免查询/文档混用 */
  private hash(text: string, context: 'query' | 'doc' = 'doc'): string {
    return `${context}:${text.trim().toLowerCase()}`;
  }

  /** 获取缓存 */
  get(text: string, context: 'query' | 'doc' = 'doc'): number[] | null {
    const key = this.hash(text, context);
    const entry = this.cache.get(key);

    if (!entry) return null;

    // 检查是否过期
    if (Date.now() - entry.timestamp > this.ttlMs) {
      this.cache.delete(key);
      return null;
    }

    // LRU: 移到最后（最近使用）
    this.cache.delete(key);
    this.cache.set(key, entry);

    return entry.embedding;
  }

  /** 设置缓存 */
  set(text: string, embedding: number[], context: 'query' | 'doc' = 'doc'): void {
    const key = this.hash(text, context);

    // 如果已存在，先删除
    if (this.cache.has(key)) {
      this.cache.delete(key);
    }

    // LRU 淘汰
    while (this.cache.size >= this.maxSize) {
      // 删除最旧的（Map 的第一个元素）
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

  /** 清空缓存 */
  clear(): void {
    this.cache.clear();
  }

  /** 获取缓存统计 */
  stats(): { size: number; maxSize: number } {
    return {
      size: this.cache.size,
      maxSize: this.maxSize,
    };
  }

  /** 检查 key 是否存在且未过期 */
  has(text: string, context: 'query' | 'doc' = 'doc'): boolean {
    const key = this.hash(text, context);
    const entry = this.cache.get(key);
    if (!entry) return false;
    if (Date.now() - entry.timestamp > this.ttlMs) {
      this.cache.delete(key);
      return false;
    }
    return true;
  }
}

/** 全局缓存实例 */
const embeddingCache = new EmbeddingCache(CACHE_CONFIG.maxSize, CACHE_CONFIG.ttlMs);

export interface EmbeddingResponse {
  object: string;
  data: Array<{
    object: string;
    index: number;
    embedding: number[];
  }>;
  model: string;
  usage: {
    prompt_tokens: number;
    total_tokens: number;
  };
}

export interface EmbeddingError {
  error: {
    message: string;
    type: string;
    code: string;
  };
}

/** 调用 SiliconFlow Embedding API (带缓存) */
export async function getEmbedding(
  text: string,
  apiKey: string,
  signal?: AbortSignal,
  model: string = DEFAULT_MODEL,
  baseURL: string = DEFAULT_BASE_URL,
  context: 'query' | 'doc' = 'doc'
): Promise<{ embedding: number[]; tokens: number; cached: boolean }> {
  // 检查缓存
  const cached = embeddingCache.get(text, context);
  if (cached) {
    return { embedding: cached, tokens: 0, cached: true };
  }

  const truncatedText = text.slice(0, MAX_INPUT_LENGTH);
  const endpoint = `${baseURL}/v1/embeddings`;

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      input: truncatedText,
      encoding_format: 'float',
    }),
    signal,
  });

  if (!response.ok) {
    const error = await response.json() as EmbeddingError;
    throw new Error(error.error?.message || `API error: ${response.status}`);
  }

  const data = await response.json() as EmbeddingResponse;
  const embedding = data.data[0].embedding;

  // 存入缓存
  embeddingCache.set(text, embedding, context);

  return {
    embedding,
    tokens: data.usage.total_tokens,
    cached: false,
  };
}

/** 批量生成向量 — 使用 SiliconFlow 原生批量 input 接口 (单次请求多个向量) + 缓存优化 */
/** 单次 API 请求最大批量条数 — 防止超过 SiliconFlow 每请求 token 限制 */
const MAX_BATCH_CHUNK = 32;

export async function batchEmbedTexts(
  texts: string[],
  apiKey: string,
  model: string = DEFAULT_MODEL,
  baseURL: string = DEFAULT_BASE_URL
): Promise<number[][]> {
  if (texts.length === 0) return [];

  const results: number[][] = new Array(texts.length);
  const uncachedIndices: number[] = [];
  const uncachedTexts: string[] = [];

  // 1. 检查缓存
  texts.forEach((text, i) => {
    const cached = embeddingCache.get(text, 'doc');
    if (cached) {
      results[i] = cached;
    } else {
      uncachedIndices.push(i);
      uncachedTexts.push(text);
    }
  });

  // 2. 如果全部命中缓存，直接返回
  if (uncachedTexts.length === 0) {
    return results;
  }

  console.log(`[embedding] Cache hit: ${texts.length - uncachedTexts.length}/${texts.length}`);

  const truncated = uncachedTexts.map((t) => t.slice(0, MAX_INPUT_LENGTH));
  const endpoint = `${baseURL}/v1/embeddings`;

  // 3. 分批请求，避免超过 API 单次 token/item 限制
  for (let chunkStart = 0; chunkStart < truncated.length; chunkStart += MAX_BATCH_CHUNK) {
    const chunkTexts = truncated.slice(chunkStart, chunkStart + MAX_BATCH_CHUNK);
    const chunkOriginals = uncachedTexts.slice(chunkStart, chunkStart + MAX_BATCH_CHUNK);
    const chunkIndices = uncachedIndices.slice(chunkStart, chunkStart + MAX_BATCH_CHUNK);

    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        input: chunkTexts,
        encoding_format: "float",
      }),
    });

    if (!response.ok) {
      const error = await response.json() as EmbeddingError;
      throw new Error(error.error?.message || `API error: ${response.status}`);
    }

    const data = await response.json() as EmbeddingResponse;
    const embeddings = data.data
      .sort((a, b) => a.index - b.index)
      .map((d) => d.embedding);

    // 4. 写入缓存并填充结果
    embeddings.forEach((embedding, i) => {
      const globalIdx = chunkIndices[i];
      results[globalIdx] = embedding;
      embeddingCache.set(chunkOriginals[i], embedding, 'doc');
    });
  }

  return results;
}

/** 生成查询向量 (优先使用缓存，使用 query 上下文) */
export async function getQueryEmbedding(
  query: string,
  apiKey: string,
  signal?: AbortSignal,
  model: string = DEFAULT_MODEL,
  baseURL: string = DEFAULT_BASE_URL
): Promise<number[]> {
  const { embedding } = await getEmbedding(query, apiKey, signal, model, baseURL, 'query');
  return embedding;
}

/** 测试 API Key 有效性 */
export async function testApiKey(apiKey: string, model: string = DEFAULT_MODEL, baseURL: string = DEFAULT_BASE_URL): Promise<boolean> {
  try {
    await getEmbedding('test', apiKey, undefined, model, baseURL);
    return true;
  } catch {
    return false;
  }
}

/** 清空向量缓存 */
export function clearEmbeddingCache(): void {
  embeddingCache.clear();
}

/** 获取缓存统计 */
export function getCacheStats(): { size: number; maxSize: number } {
  return embeddingCache.stats();
}

/** 检查查询向量是否已缓存 */
export function hasCachedQuery(query: string): boolean {
  return embeddingCache.has(query, 'query');
}
