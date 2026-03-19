/**
 * 向量工具函数
 */

/** 计算余弦相似度 (Cosine Similarity) */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error('Vectors must have the same length');
  }

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
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

/** 批量计算相似度并排序 */
export function rankBySimilarity(
  queryVector: number[],
  candidates: Array<{ embedding: number[]; [key: string]: any }>,
  options?: { limit?: number; threshold?: number }
): Array<{ item: any; similarity: number }> {
  const results = candidates.map(item => ({
    item,
    similarity: cosineSimilarity(queryVector, item.embedding),
  }));

  results.sort((a, b) => b.similarity - a.similarity);

  if (options?.threshold !== undefined) {
    const filtered = results.filter(r => r.similarity >= options.threshold!);
    return options.limit ? filtered.slice(0, options.limit) : filtered;
  }

  return options?.limit ? results.slice(0, options.limit) : results;
}
