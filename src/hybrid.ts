/**
 * 混合搜索 - RRF (Reciprocal Rank Fusion) 算法
 * 结合关键词搜索和向量语义搜索
 *
 * 使用 EdgeVec HNSW 索引实现 O(log n) 向量搜索
 */

import type { BookmarkRecord, SearchOptions } from './types';
import { searchVectors, searchVectorsBQ } from './vectorIndex';

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

/** 向量搜索结果 */
interface VectorSearchResult {
  url: string;
  score: number;
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
      score: 1 / (RRF_K + index + 1),
    });
  });

  return scores;
}

/**
 * RRF 混合搜索
 * 使用 EdgeVec HNSW 进行向量搜索，然后与关键词结果融合
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

  const keywordWeight = 1 - vectorWeight;

  const keywordScores = scoreKeywordResults(keywordResults);

  const recordMap = new Map<string, BookmarkRecord>();
  for (const r of allRecords) {
    recordMap.set(r.url, r);
  }

  let vectorResults: VectorSearchResult[] = [];
  try {
    vectorResults = await searchVectorsBQ(queryVector, limit * 3, 5);
  } catch (error) {
    console.warn('[hybrid] EdgeVec search failed:', error);
    vectorResults = [];
  }

  // Min-Max 归一化
  let vecMin = Infinity, vecMax = -Infinity;
  for (const vr of vectorResults) {
    if (vr.score < vecMin) vecMin = vr.score;
    if (vr.score > vecMax) vecMax = vr.score;
  }
  const vecRange = vecMax - vecMin;

  let kwMin = Infinity, kwMax = -Infinity;
  for (const [, kr] of keywordScores) {
    const raw = kr.score * (RRF_K + 1);
    if (raw < kwMin) kwMin = raw;
    if (raw > kwMax) kwMax = raw;
  }
  const kwRange = kwMax - kwMin;

  const merged = new Map<string, MergedResult>();

  for (const vr of vectorResults) {
    const record = recordMap.get(vr.url);
    if (!record) continue;

    const keywordEntry = keywordScores.get(vr.url);

    const normalizedVector = vecRange > 0
      ? (vr.score - vecMin) / vecRange
      : 0.5;

    let keywordScore = 0;
    if (keywordEntry) {
      const rawKwScore = keywordEntry.score * (RRF_K + 1);
      keywordScore = kwRange > 0
        ? (rawKwScore - kwMin) / kwRange
        : 0.5;
    }

    const finalScore = keywordWeight * keywordScore + vectorWeight * normalizedVector;

    merged.set(vr.url, {
      record,
      keywordScore,
      vectorScore: normalizedVector,
      finalScore,
    });
  }

  for (const [url, keywordEntry] of keywordScores) {
    if (merged.has(url)) continue;

    const record = recordMap.get(url);
    if (!record) {
      const newRecord: BookmarkRecord = {
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
        record: newRecord,
        keywordScore,
        vectorScore: 0,
        finalScore,
      });
    }
  }

  const sorted = [...merged.values()].sort((a, b) => b.finalScore - a.finalScore);

  return sorted.slice(0, limit).map(m => m.record);
}

/**
 * 纯向量搜索 (使用 EdgeVec HNSW)
 */
export async function vectorSearch(
  allRecords: BookmarkRecord[],
  queryVector: number[],
  options: SearchOptions = {}
): Promise<BookmarkRecord[]> {
  const { limit = 9 } = options;

  const recordMap = new Map<string, BookmarkRecord>();
  for (const r of allRecords) {
    recordMap.set(r.url, r);
  }

  let results: VectorSearchResult[] = [];
  try {
    results = await searchVectorsBQ(queryVector, limit, 5);
  } catch (error) {
    console.warn('[vectorSearch] EdgeVec search failed:', error);
    results = [];
  }

  return results
    .map(r => recordMap.get(r.url))
    .filter((r): r is BookmarkRecord => r !== undefined);
}
