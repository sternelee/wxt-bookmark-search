/**
 * 向量计算 Worker 管理器
 * 提供 Promise-based API 来调用 Worker
 */

import type { BookmarkRecord } from './types';

// Worker 代码作为字符串内联
const workerCode = `
// 向量计算 Worker 代码

/** 余弦相似度 */
function cosineSimilarity(a, b) {
  if (a.length !== b.length) return 0;
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  return denominator === 0 ? 0 : dotProduct / denominator;
}

/** 向量搜索 */
function vectorSearch(payload) {
  const { records, queryVector, limit } = payload;
  const results = [];
  for (const record of records) {
    const similarity = cosineSimilarity(queryVector, record.embedding);
    results.push({ url: record.url, similarity });
  }
  results.sort((a, b) => b.similarity - a.similarity);
  return results.slice(0, limit);
}

/** 混合搜索 RRF */
function hybridSearch(payload) {
  const { records, queryVector, keywordResults, vectorWeight, limit } = payload;
  const keywordWeight = 1 - vectorWeight;
  const RRF_K = 60;

  const keywordScores = new Map();
  for (const kr of keywordResults) {
    keywordScores.set(kr.url, 1 / (RRF_K + kr.rank));
  }

  const vectorScores = new Map();
  for (const record of records) {
    const similarity = cosineSimilarity(queryVector, record.embedding);
    vectorScores.set(record.url, similarity);
  }

  const merged = new Map();
  for (const [url, vectorScore] of vectorScores) {
    const keywordScore = keywordScores.get(url) || 0;
    const normalizedKeywordScore = keywordScore * (RRF_K + 1);
    const finalScore = keywordWeight * normalizedKeywordScore + vectorWeight * vectorScore;
    merged.set(url, finalScore);
  }

  for (const [url, keywordScore] of keywordScores) {
    if (merged.has(url)) continue;
    const normalizedKeywordScore = keywordScore * (RRF_K + 1);
    merged.set(url, keywordWeight * normalizedKeywordScore);
  }

  return [...merged.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([url, finalScore]) => ({ url, finalScore }));
}

self.onmessage = (event) => {
  const { type, payload, id } = event.data;
  try {
    let result;
    switch (type) {
      case 'vectorSearch':
        result = vectorSearch(payload);
        break;
      case 'hybridSearch':
        result = hybridSearch(payload);
        break;
      default:
        throw new Error('Unknown type: ' + type);
    }
    self.postMessage({ type: 'result', payload: result, id });
  } catch (error) {
    self.postMessage({ type: 'error', payload: error.message, id });
  }
};
`;

/** Worker 实例 (懒加载) */
let worker: Worker | null = null;
let messageId = 0;
const pendingMessages = new Map<number, { resolve: Function; reject: Function }>();

/** 获取或创建 Worker */
function getWorker(): Worker {
  if (!worker) {
    const blob = new Blob([workerCode], { type: 'application/javascript' });
    const url = URL.createObjectURL(blob);
    worker = new Worker(url);

    worker.onmessage = (event) => {
      const { type, payload, id } = event.data;
      const pending = pendingMessages.get(id);
      if (pending) {
        pendingMessages.delete(id);
        if (type === 'result') {
          pending.resolve(payload);
        } else {
          pending.reject(new Error(payload));
        }
      }
    };

    worker.onerror = (error) => {
      console.error('[VectorWorker] Error:', error);
    };
  }
  return worker;
}

/** 向 Worker 发送消息并等待结果 */
function sendMessage<T>(type: string, payload: any): Promise<T> {
  return new Promise((resolve, reject) => {
    const id = ++messageId;
    pendingMessages.set(id, { resolve, reject });

    const w = getWorker();
    w.postMessage({ type, payload, id });
  });
}

/** 向量搜索参数 */
interface VectorSearchParams {
  records: Array<{ url: string; embedding: number[] }>;
  queryVector: number[];
  limit: number;
}

/** 向量搜索结果 */
interface VectorSearchResult {
  url: string;
  similarity: number;
}

/** 在 Worker 中执行向量搜索 */
export async function vectorSearchInWorker(
  params: VectorSearchParams
): Promise<VectorSearchResult[]> {
  return sendMessage<VectorSearchResult[]>('vectorSearch', params);
}

/** 混合搜索参数 */
interface HybridSearchParams {
  records: Array<{ url: string; embedding: number[] }>;
  queryVector: number[];
  keywordResults: Array<{ url: string; rank: number }>;
  vectorWeight: number;
  limit: number;
}

/** 混合搜索结果 */
interface HybridSearchResult {
  url: string;
  finalScore: number;
}

/** 在 Worker 中执行混合搜索 */
export async function hybridSearchInWorker(
  params: HybridSearchParams
): Promise<HybridSearchResult[]> {
  return sendMessage<HybridSearchResult[]>('hybridSearch', params);
}

/** 终止 Worker (释放资源) */
export function terminateWorker(): void {
  if (worker) {
    worker.terminate();
    worker = null;
    pendingMessages.clear();
  }
}

/** 检查 Worker 是否可用 */
export function isWorkerAvailable(): boolean {
  return typeof Worker !== 'undefined';
}
