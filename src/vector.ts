/**
 * 向量工具函数
 */

/** 计算余弦相似度 (Cosine Similarity)
 *  支持传入预计算的 normB（文档向量模长），避免重复开方
 */
export function cosineSimilarity(
  a: number[],
  b: number[],
  normB?: number
): number {
  if (a.length !== b.length) {
    throw new Error('Vectors must have the same length');
  }

  let dotProduct = 0;
  let normA = 0;
  let normBSquared = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normBSquared += b[i] * b[i];
  }

  const denominator = Math.sqrt(normA) * (normB ?? Math.sqrt(normBSquared));
  if (denominator === 0) return 0;

  return dotProduct / denominator;
}

/** 计算欧几里得距离 */
export function euclideanDistance(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error('Vectors must have the same length');
  }

  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    const diff = a[i] - b[i];
    sum += diff * diff;
  }

  return Math.sqrt(sum);
}

/** 向量归一化 */
export function normalizeVector(vec: number[]): number[] {
  let norm = 0;
  for (const v of vec) {
    norm += v * v;
  }
  norm = Math.sqrt(norm);

  if (norm === 0) return vec;

  return vec.map(v => v / norm);
}

/** 批量计算相似度并排序
 *  利用预计算模长跳过重复的 sqrt(normB)
 *  每 256 个候选检查一次 AbortSignal，保持响应性
 */
export function rankBySimilarity(
  queryVector: number[],
  candidates: Array<{ embedding: number[]; _embeddingNorm?: number; [key: string]: any }>,
  options?: { limit?: number; threshold?: number; signal?: AbortSignal }
): Array<{ item: any; similarity: number }> {
  const results: Array<{ item: any; similarity: number }> = [];

  for (let i = 0; i < candidates.length; i++) {
    // 每 256 个检查一次中断信号，避免大数据集阻塞主线程
    if ((i & 0xFF) === 0 && options?.signal?.aborted) {
      return [];
    }

    const item = candidates[i];
    const sim = cosineSimilarity(queryVector, item.embedding, item._embeddingNorm);
    results.push({ item, similarity: sim });
  }

  results.sort((a, b) => b.similarity - a.similarity);

  if (options?.threshold !== undefined) {
    const filtered = results.filter(r => r.similarity >= options.threshold!);
    return options.limit ? filtered.slice(0, options.limit) : filtered;
  }

  return options?.limit ? results.slice(0, options.limit) : results;
}
