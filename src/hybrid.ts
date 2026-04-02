/**
 * 混合搜索 - RRF (Reciprocal Rank Fusion) 算法
 * 结合关键词搜索和向量语义搜索
 */

import type { BookmarkRecord, SearchOptions } from './types';
import { cosineSimilarity } from './vector';
import {
  isWorkerAvailable,
  hybridSearchInWorker,
  vectorSearchInWorker,
  terminateWorker,
} from './vectorWorkerManager';

/** RRF 常数 K (通常取 60) */
const RRF_K = 60;

/** 书签类型 (兼容 browser.bookmarks.BookmarkTreeNode) */
type BookmarkInput = {
  id: string;
  title: string;
  url?: string;
  dateAdded?: number;
};

/** 关键词搜索结果带排名 */
interface KeywordResult {
  bookmark: BookmarkInput;
  rank: number;
  score: number;
}

/** 向量搜索结果带相似度 */
interface VectorResult {
  record: BookmarkRecord;
  similarity: number;
}

/** RRF 融合结果 */
interface MergedResult {
  record: BookmarkRecord;
  keywordScore: number;
  vectorScore: number;
  finalScore: number;
}

/**
 * 计算关键词搜索得分
 * 基于现有 rerankBookmarks 的排名
 */
function scoreKeywordResults(
  keywordResults: BookmarkInput[]
): Map<string, KeywordResult> {
  const scores = new Map<string, KeywordResult>();

  keywordResults.forEach((bookmark, index) => {
    if (!bookmark.url) return;
    scores.set(bookmark.url, {
      bookmark,
      rank: index + 1,
      score: 1 / (RRF_K + index + 1), // RRF 公式
    });
  });

  return scores;
}

/**
 * 计算向量相似度得分
 */
function scoreVectorResults(
  allRecords: BookmarkRecord[],
  queryVector: number[]
): Map<string, VectorResult> {
  const scores = new Map<string, VectorResult>();

  for (const record of allRecords) {
    if (!record.embedding || record.status !== 'indexed') continue;

    const similarity = cosineSimilarity(queryVector, record.embedding);
    scores.set(record.url, {
      record,
      similarity,
    });
  }

  return scores;
}

/**
 * RRF 混合搜索 (主线程版本)
 */
function hybridSearchMainThread(
  keywordResults: BookmarkInput[],
  allRecords: BookmarkRecord[],
  queryVector: number[],
  options: SearchOptions = {}
): BookmarkRecord[] {
  const {
    vectorWeight = 0.4,
    limit = 9,
  } = options;

  const keywordWeight = 1 - vectorWeight;

  // 计算各维度得分
  const keywordScores = scoreKeywordResults(keywordResults);
  const vectorScores = scoreVectorResults(allRecords, queryVector);

  // === Min-Max 归一化 ===
  // 向量相似度归一化
  let vecMin = Infinity, vecMax = -Infinity;
  for (const [, vr] of vectorScores) {
    if (vr.similarity < vecMin) vecMin = vr.similarity;
    if (vr.similarity > vecMax) vecMax = vr.similarity;
  }
  const vecRange = vecMax - vecMin;

  // 关键词得分归一化
  let kwMin = Infinity, kwMax = -Infinity;
  for (const [, kr] of keywordScores) {
    const raw = kr.score * (RRF_K + 1);
    if (raw < kwMin) kwMin = raw;
    if (raw > kwMax) kwMax = raw;
  }
  const kwRange = kwMax - kwMin;

  // 构建合并结果
  const merged = new Map<string, MergedResult>();

  // 处理所有有向量索引的书签
  for (const [url, vectorResult] of vectorScores) {
    const keywordEntry = keywordScores.get(url);

    // 向量得分归一化
    const rawVectorScore = vectorResult.similarity;
    const vectorScore = vecRange > 0
      ? (rawVectorScore - vecMin) / vecRange
      : 0.5;

    // 关键词得分归一化
    let keywordScore = 0;
    if (keywordEntry) {
      const rawKwScore = keywordEntry.score * (RRF_K + 1);
      keywordScore = kwRange > 0
        ? (rawKwScore - kwMin) / kwRange
        : 0.5;
    }

    // 加权融合
    const finalScore = keywordWeight * keywordScore + vectorWeight * vectorScore;

    merged.set(url, {
      record: vectorResult.record,
      keywordScore,
      vectorScore,
      finalScore,
    });
  }

  // 处理只有关键词匹配的书签 (无向量索引)
  for (const [url, keywordEntry] of keywordScores) {
    if (merged.has(url)) continue;

    const record: BookmarkRecord = {
      id: keywordEntry.bookmark.id,
      url: keywordEntry.bookmark.url!,
      title: keywordEntry.bookmark.title,
      summary: '',
      status: 'pending',
    };

    const rawKwScore = keywordEntry.score * (RRF_K + 1);
    const keywordScore = kwRange > 0
      ? (rawKwScore - kwMin) / kwRange
      : 0.5;
    const finalScore = keywordWeight * keywordScore;

    merged.set(url, {
      record,
      keywordScore,
      vectorScore: 0,
      finalScore,
    });
  }

  // 按最终得分排序
  const sorted = [...merged.values()].sort((a, b) => b.finalScore - a.finalScore);

  return sorted.slice(0, limit).map(m => m.record);
}

/**
 * RRF 混合搜索 (自动选择 Worker 或主线程)
 */
export async function hybridSearch(
  keywordResults: BookmarkInput[],
  allRecords: BookmarkRecord[],
  queryVector: number[],
  options: SearchOptions = {}
): Promise<BookmarkRecord[]> {
  const {
    vectorWeight = 0.4,
    limit = 9,
  } = options;

  // 准备数据
  const keywordResultsForWorker = keywordResults
    .filter(b => b.url)
    .map((b, i) => ({ url: b.url!, rank: i + 1 }));

  const recordsWithEmbedding = allRecords
    .filter(r => r.embedding && r.status === 'indexed')
    .map(r => ({ url: r.url, embedding: r.embedding! }));

  // 创建 URL 到 record 的映射
  const recordMap = new Map<string, BookmarkRecord>();
  for (const r of allRecords) {
    recordMap.set(r.url, r);
  }

  // 尝试使用 Worker
  if (isWorkerAvailable() && recordsWithEmbedding.length > 100) {
    try {
      const results = await hybridSearchInWorker({
        records: recordsWithEmbedding,
        queryVector,
        keywordResults: keywordResultsForWorker,
        vectorWeight,
        limit,
      });

      // 转换结果
      return results.map(r => {
        const record = recordMap.get(r.url);
        if (record) return record;

        // 从关键词结果创建
        const kr = keywordResults.find(k => k.url === r.url);
        return {
          id: kr?.id || '',
          url: r.url,
          title: kr?.title || '',
          summary: '',
          status: 'pending' as const,
        };
      });
    } catch (error) {
      console.warn('[hybrid] Worker failed, falling back to main thread:', error);
    }
  }

  // 回退到主线程
  return hybridSearchMainThread(keywordResults, allRecords, queryVector, options);
}

/**
 * 纯向量搜索 (主线程版本)
 */
function vectorSearchMainThread(
  allRecords: BookmarkRecord[],
  queryVector: number[],
  options: SearchOptions = {}
): BookmarkRecord[] {
  const { limit = 9 } = options;

  const results: Array<{ record: BookmarkRecord; similarity: number }> = [];

  for (const record of allRecords) {
    if (!record.embedding || record.status !== 'indexed') continue;

    const similarity = cosineSimilarity(queryVector, record.embedding);
    results.push({ record, similarity });
  }

  results.sort((a, b) => b.similarity - a.similarity);

  return results.slice(0, limit).map(r => r.record);
}

/**
 * 纯向量搜索 (自动选择 Worker 或主线程)
 */
export async function vectorSearch(
  allRecords: BookmarkRecord[],
  queryVector: number[],
  options: SearchOptions = {}
): Promise<BookmarkRecord[]> {
  const { limit = 9 } = options;

  const recordsWithEmbedding = allRecords
    .filter(r => r.embedding && r.status === 'indexed')
    .map(r => ({ url: r.url, embedding: r.embedding! }));

  const recordMap = new Map<string, BookmarkRecord>();
  for (const r of allRecords) {
    recordMap.set(r.url, r);
  }

  // 尝试使用 Worker
  if (isWorkerAvailable() && recordsWithEmbedding.length > 100) {
    try {
      const results = await vectorSearchInWorker({
        records: recordsWithEmbedding,
        queryVector,
        limit,
      });

      return results.map(r => recordMap.get(r.url)!).filter(Boolean);
    } catch (error) {
      console.warn('[vectorSearch] Worker failed, falling back:', error);
    }
  }

  // 回退到主线程
  return vectorSearchMainThread(allRecords, queryVector, options);
}

/** 导出 Worker 管理 */
export { terminateWorker };
