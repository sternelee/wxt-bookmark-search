/**
 * SiliconFlow Embedding API 封装
 */

import type { Settings } from './types';

const API_ENDPOINT = 'https://api.siliconflow.cn/v1/embeddings';
const MODEL = 'BAAI/bge-m3';
const MAX_INPUT_LENGTH = 8000; // 字符数限制

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

/** 调用 SiliconFlow Embedding API */
export async function getEmbedding(
  text: string,
  apiKey: string
): Promise<{ embedding: number[]; tokens: number }> {
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
  return {
    embedding: data.data[0].embedding,
    tokens: data.usage.total_tokens,
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

/** 生成查询向量 */
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
