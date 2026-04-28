/**
 * 混合搜索 - RRF (Reciprocal Rank Fusion) 算法
 * 结合关键词搜索和向量语义搜索
 *
 * 向量搜索使用纯 JS 余弦相似度（基于内存缓存），无需 WASM 或额外 IDB
 */

import type { BookmarkRecord, SearchOptions } from "./types";
import { rankBySimilarity } from "./vector";
import { getFreqCache } from "./freq";

/** RRF 常数 K (通常取 60) */
const RRF_K = 60;

/** 频率权重在混合搜索中的最大加分 */
const FREQ_BOOST_MAX = 0.15;

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
 * 安全 Min-Max 归一化
 * 处理空数组、单元素、全同值等边界情况 — 避免 0/0 和 Infinity
 */
function safeNormalize(values: number[]): number[] {
  if (values.length === 0) return [];
  if (values.length === 1) return [0.5];
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min;
  if (range === 0) return values.map(() => 0.5);
  return values.map((v) => (v - min) / range);
}

/**
 * 计算关键词搜索得分 (RRF: 1 / (K + rank))
 */
function scoreKeywordResults(
  keywordResults: BookmarkInput[],
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
 * 使用纯 JS 余弦相似度进行向量搜索，然后与关键词结果融合
 */
export async function hybridSearch(
  keywordResults: BookmarkInput[],
  allRecords: BookmarkRecord[],
  queryVector: number[],
  options: SearchOptions = {},
  signal?: AbortSignal,
): Promise<BookmarkRecord[]> {
  const { vectorWeight = 0.4, limit = 9 } = options;

  const keywordWeight = 1 - vectorWeight;
  const keywordScores = scoreKeywordResults(keywordResults);

  const recordMap = new Map<string, BookmarkRecord>();
  for (const r of allRecords) {
    recordMap.set(r.url, r);
  }

  let vectorResults: VectorSearchResult[] = [];
  try {
    // 直接对内存缓存中的书签做余弦相似度，无需 WASM/IDB
    const withEmbedding = allRecords.filter(
      (r) => r.embedding && r.embedding.length > 0,
    );
    vectorResults = rankBySimilarity(queryVector, withEmbedding as any, {
      limit: limit * 3,
      signal,
    }).map((r) => ({ url: r.item.url as string, score: r.similarity }));
  } catch (error) {
    console.warn("[hybrid] Vector search failed:", error);
  }

  if (signal?.aborted) return [];

  // 对关键词和向量分数分别进行 Min-Max 归一化
  const kwUrls = [...keywordScores.keys()];
  const kwNorm = safeNormalize(
    kwUrls.map((url) => keywordScores.get(url)!.score),
  );
  const kwScoreNorm = new Map(kwUrls.map((url, i) => [url, kwNorm[i]]));

  const vecNorm = safeNormalize(vectorResults.map((r) => r.score));
  const vecScoreNorm = new Map(
    vectorResults.map((r, i) => [r.url, vecNorm[i]]),
  );

  // 合并所有候选 URL（向量命中 + 关键词命中）
  const allUrls = new Set([...kwScoreNorm.keys(), ...vecScoreNorm.keys()]);
  const merged = new Map<string, MergedResult>();

  for (const url of allUrls) {
    const kwScore = kwScoreNorm.get(url) ?? 0;
    const vecScore = vecScoreNorm.get(url) ?? 0;
    const finalScore = keywordWeight * kwScore + vectorWeight * vecScore;

    const record = recordMap.get(url);
    if (record) {
      merged.set(url, {
        record,
        keywordScore: kwScore,
        vectorScore: vecScore,
        finalScore,
      });
    } else {
      // 关键词命中但尚未索引 — 以基础记录形式加入（无 AI 前缀）
      const kwEntry = keywordScores.get(url);
      if (kwEntry) {
        merged.set(url, {
          record: {
            id: kwEntry.bookmark.id,
            url: kwEntry.bookmark.url!,
            title: kwEntry.bookmark.title,
            summary: "",
            status: "pending",
          },
          keywordScore: kwScore,
          vectorScore: 0,
          finalScore: keywordWeight * kwScore,
        });
      }
    }
  }

  // 融入访问频率权重（时间衰减）
  const freqCache = getFreqCache();
  const maxFreq = Math.max(1, ...Object.values(freqCache));

  const withFreq = [...merged.values()].map((m) => {
    const freq = freqCache[m.record.url] ?? 0;
    const freqBoost = (freq / maxFreq) * FREQ_BOOST_MAX;
    return { ...m, finalScore: m.finalScore + freqBoost };
  });

  const sorted = withFreq.sort((a, b) => b.finalScore - a.finalScore);
  return sorted.slice(0, limit).map((m) => m.record);
}

/**
 * 纯向量搜索（余弦相似度）
 */
export async function vectorSearch(
  allRecords: BookmarkRecord[],
  queryVector: number[],
  options: SearchOptions = {},
  signal?: AbortSignal,
): Promise<BookmarkRecord[]> {
  const { limit = 9 } = options;

  const recordMap = new Map<string, BookmarkRecord>();
  for (const r of allRecords) {
    recordMap.set(r.url, r);
  }

  let results: VectorSearchResult[] = [];
  try {
    // 直接对内存缓存中的书签做余弦相似度
    const withEmbedding = allRecords.filter(
      (r) => r.embedding && r.embedding.length > 0,
    );
    results = rankBySimilarity(queryVector, withEmbedding as any, {
      limit,
      signal,
    }).map((r) => ({ url: r.item.url as string, score: r.similarity }));
  } catch (error) {
    console.warn("[vectorSearch] Vector search failed:", error);
  }

  if (signal?.aborted) return [];

  // 融入访问频率权重
  const freqCache = getFreqCache();
  const maxFreq = Math.max(1, ...Object.values(freqCache));

  const boosted = results
    .map((r) => {
      const record = recordMap.get(r.url);
      if (!record) return null;
      const freq = freqCache[record.url] ?? 0;
      const freqBoost = (freq / maxFreq) * FREQ_BOOST_MAX;
      return { record, score: r.score + freqBoost };
    })
    .filter((r): r is NonNullable<typeof r> => r !== null);

  boosted.sort((a, b) => b.score - a.score);
  return boosted.map((b) => b.record);
}
