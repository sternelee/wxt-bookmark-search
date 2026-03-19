/**
 * 混合搜索 - RRF (Reciprocal Rank Fusion) 算法
 * 结合关键词搜索和向量语义搜索
 */

import type { BookmarkRecord, SearchOptions } from './types';
import { cosineSimilarity } from './vector';

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
 * RRF 混合搜索
 * 结合关键词匹配和向量语义相似度
 */
export function hybridSearch(
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

  // 构建合并结果
  const merged = new Map<string, MergedResult>();

  // 处理所有有向量索引的书签
  for (const [url, vectorResult] of vectorScores) {
    const keywordEntry = keywordScores.get(url);

    // 向量得分归一化 (相似度本身就是 0-1)
    const vectorScore = vectorResult.similarity;

    // 关键词得分归一化
    let keywordScore = 0;
    if (keywordEntry) {
      // RRF 得分已经在 0-1 范围内
      keywordScore = keywordEntry.score * (RRF_K + 1); // 归一化到约 0-1
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

    const keywordScore = keywordEntry.score * (RRF_K + 1);
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
 * 纯向量搜索
 */
export function vectorSearch(
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
