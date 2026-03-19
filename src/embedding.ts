/**
 * SiliconFlow Embedding API 封装
 * 包含查询向量缓存
 */

import type { Settings } from './types';

const API_ENDPOINT = 'https://api.siliconflow.cn/v1/embeddings';
const MODEL = 'BAAI/bge-m3';
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

  /** 生成缓存 key */
  private hash(text: string): string {
    // 简单 hash：使用文本的 trimmed lowercase 版本
    // 对于向量语义搜索，大小写差异通常不影响结果
    return text.trim().toLowerCase();
  }

  /** 获取缓存 */
  get(text: string): number[] | null {
    const key = this.hash(text);
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
  set(text: string, embedding: number[]): void {
    const key = this.hash(text);

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
  apiKey: string
): Promise<{ embedding: number[]; tokens: number; cached: boolean }> {
  // 检查缓存
  const cached = embeddingCache.get(text);
  if (cached) {
    return { embedding: cached, tokens: 0, cached: true };
  }

  const truncatedText = text.slice(0, MAX_INPUT_LENGTH);

  const response = await fetch(API_ENDPOINT, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: MODEL,
      input: truncatedText,
      encoding_format: 'float',
    }),
  });

  if (!response.ok) {
    const error = await response.json() as EmbeddingError;
    throw new Error(error.error?.message || `API error: ${response.status}`);
  }

  const data = await response.json() as EmbeddingResponse;
  const embedding = data.data[0].embedding;

  // 存入缓存
  embeddingCache.set(text, embedding);

  return {
    embedding,
    tokens: data.usage.total_tokens,
    cached: false,
  };
}

/** 批量生成向量 (带并发控制) */
export async function batchEmbed(
  texts: string[],
  apiKey: string,
  options?: { concurrency?: number; onProgress?: (done: number, total: number) => void }
): Promise<Array<{ embedding?: number[]; error?: string }>> {
  const { concurrency = 5, onProgress } = options || {};
  const results: Array<{ embedding?: number[]; error?: string }> = new Array(texts.length);
  let done = 0;

  // 分批处理
  for (let i = 0; i < texts.length; i += concurrency) {
    const batch = texts.slice(i, i + concurrency);
    const batchPromises = batch.map(async (text, batchIndex) => {
      const globalIndex = i + batchIndex;
      try {
        const { embedding } = await getEmbedding(text, apiKey);
        results[globalIndex] = { embedding };
      } catch (err) {
        results[globalIndex] = { error: String(err) };
      }
      done++;
      onProgress?.(done, texts.length);
    });

    await Promise.all(batchPromises);
  }

  return results;
}

/** 生成查询向量 (优先使用缓存) */
export async function getQueryEmbedding(
  query: string,
  apiKey: string
): Promise<number[]> {
  const { embedding } = await getEmbedding(query, apiKey);
  return embedding;
}

/** 测试 API Key 有效性 */
export async function testApiKey(apiKey: string): Promise<boolean> {
  try {
    await getEmbedding('test', apiKey);
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
