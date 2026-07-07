import type { OmniboxSuggestion } from "./types.js";
import { highlightBookmark, highlightBookmarkPlain } from "./highlight.js";
import { getFreqCache } from "./freq.js";

/** 书签类型 (兼容 browser.bookmarks.BookmarkTreeNode) */
type BookmarkInput = {
  id: string;
  title: string;
  url?: string;
  dateAdded?: number;
};

/** Split query into lowercase words. */
function queryWords(query: string): string[] {
  return query.toLowerCase().trim().split(/\s+/).filter(Boolean);
}

/**
 * Returns true only if every word in the query appears
 * somewhere in either the title or the URL.
 */
export function queryWordsMatch(
  query: string,
  title: string,
  url: string,
): boolean {
  const words = queryWords(query);
  if (words.length <= 1) return true; // single word: handled by Chrome search
  const haystack = (title + " " + url).toLowerCase();
  return words.every((w) => haystack.includes(w));
}

/** 关键词匹配质量等级 */
export interface MatchQuality {
  /** 0=无匹配, 1=部分词, 2=全词匹配, 3=短语精确匹配 */
  score: number;
  matchedWordCount: number;
  totalWordCount: number;
  hasPhraseMatch: boolean;
  /** 短语精确匹配次数 */
  phraseCount: number;
}

/**
 * 计算查询与标题+URL+摘要+标签 的关键词匹配质量
 *
 * - score = 0: 没有任何词匹配
 * - score = 1: 部分词匹配（但不是全部）
 * - score = 2: 所有词都匹配（分散在文本中）
 * - score = 3: 短语精确匹配（所有词按顺序连续出现）
 */
export function getMatchQuality(
  query: string,
  title: string,
  url: string,
  summary?: string,
  tags?: string[],
): MatchQuality {
  const words = queryWords(query);
  const haystack = (title + " " + url).toLowerCase();
  const extraHaystack = [
    summary?.toLowerCase() ?? "",
    ...(tags?.map((t) => t.toLowerCase()) ?? []),
  ].join(" ");
  const fullHaystack = haystack + " " + extraHaystack;

  if (words.length === 0) {
    return { score: 0, matchedWordCount: 0, totalWordCount: 0, hasPhraseMatch: false, phraseCount: 0 };
  }

  if (words.length === 1) {
    const has = fullHaystack.includes(words[0]);
    return {
      score: has ? 2 : 0,
      matchedWordCount: has ? 1 : 0,
      totalWordCount: 1,
      hasPhraseMatch: has,
      phraseCount: has ? 1 : 0,
    };
  }

  const matchedWords = words.filter((w) => fullHaystack.includes(w));
  const matchedWordCount = matchedWords.length;
  const totalWordCount = words.length;

  if (matchedWordCount === 0) {
    return { score: 0, matchedWordCount: 0, totalWordCount, hasPhraseMatch: false, phraseCount: 0 };
  }

  if (matchedWordCount < totalWordCount) {
    return {
      score: 1,
      matchedWordCount,
      totalWordCount,
      hasPhraseMatch: false,
      phraseCount: 0,
    };
  }

  // 所有词都匹配 — 检查是否有短语精确匹配（按顺序连续出现）
  const queryPhrase = query.toLowerCase().trim();
  let phraseCount = 0;
  let hasPhraseMatch = false;

  // 完整短语匹配（含摘要和标签）
  if (fullHaystack.includes(queryPhrase)) {
    phraseCount++;
    hasPhraseMatch = true;
  }

  // 也检查标题独立匹配（标题中的短语比 URL/摘要 中的更有价值）
  const titleLower = title.toLowerCase();
  if (titleLower.includes(queryPhrase)) {
    if (!hasPhraseMatch) phraseCount++;
    hasPhraseMatch = true;
  }

  return {
    score: hasPhraseMatch ? 3 : 2,
    matchedWordCount,
    totalWordCount,
    hasPhraseMatch,
    phraseCount,
  };
}

/**
 * Standard Levenshtein edit distance between two strings.
 * Returns the minimum number of single-character edits needed to
 * transform `a` into `b`.
 */
export function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;

  // Use a flat array for O(m*n) / O(min(m,n)) space
  // Two-row rolling buffer: prev[j] = dp[i-1][j], cur[j] = dp[i][j]
  let prev: number[] = Array.from({ length: n + 1 }, (_, j) => j);
  let cur: number[] = new Array(n + 1);

  for (let i = 1; i <= m; i++) {
    cur[0] = i;
    for (let j = 1; j <= n; j++) {
      cur[j] =
        a[i - 1] === b[j - 1]
          ? prev[j - 1]
          : 1 + Math.min(prev[j], prev[j - 1], cur[j - 1]);
    }
    [prev, cur] = [cur, prev];
  }

  return prev[n];
}

/** Base scores — lower is better. */
const SCORE_URL_EXACT = 0;
const SCORE_TITLE_PREFIX = 1;
const SCORE_PHRASE_EXACT = 2;   // 短语精确匹配（所有词按顺序连续出现）
const SCORE_MULTI_WORD = 5;     // 所有词都匹配但不连续
const SCORE_PARTIAL_MATCH = 8;  // 仅部分词匹配
const SCORE_TITLE_CONTAINS = 10;
const SCORE_CHROME_FALLBACK = 15;
const SCORE_LEVENSHTEIN = 20; // applied only when query.length >= 3

interface ScoredBookmark {
  bookmark: BookmarkInput;
  baseScore: number;
  /** For ties, sort by highlight order (prefix > contains) */
  tieBreaker: number;
}

/**
 * Score a single bookmark given the query and its position in Chrome results.
 */
function scoreBookmark(
  bookmark: BookmarkInput,
  query: string,
  chromeResultIndex: number,
): ScoredBookmark | null {
  const title = bookmark.title;
  const url = bookmark.url ?? "";
  const q = query;
  const ql = q.toLowerCase();
  const tl = title.toLowerCase();
  const ul = url.toLowerCase();

  // Skip folder nodes (no URL)
  if (!url) return null;

  // 1. Exact URL match
  if (ul === ql) {
    return { bookmark, baseScore: SCORE_URL_EXACT, tieBreaker: 0 };
  }

  // 2. Title prefix match
  if (tl.startsWith(ql)) {
    return { bookmark, baseScore: SCORE_TITLE_PREFIX, tieBreaker: 0 };
  }

  // 3. 短语精确匹配或全词匹配（多词查询）
  const quality = getMatchQuality(q, title, url);
  if (q.includes(" ")) {
    if (quality.score >= 3) {
      // 短语精确匹配 — 奖励（分数更低 = 更好）
      return { bookmark, baseScore: SCORE_PHRASE_EXACT, tieBreaker: 0 };
    }
    if (quality.score === 2) {
      // 所有词都匹配但不连续
      return { bookmark, baseScore: SCORE_MULTI_WORD, tieBreaker: 0 };
    }
    if (quality.score === 1) {
      // 仅部分词匹配 — 惩罚（分数更高 = 更差）
      return { bookmark, baseScore: SCORE_PARTIAL_MATCH, tieBreaker: 1 };
    }
  }

  // 4. Title contains (case-insensitive) — 单字查询或上述未命中
  if (tl.includes(ql)) {
    return { bookmark, baseScore: SCORE_TITLE_CONTAINS, tieBreaker: 0 };
  }

  // 5. Chrome search fallback (still in results but no semantic match)
  //    Give each result a slightly different score based on its index
  //    so the final order still loosely follows Chrome's ordering.
  return {
    bookmark,
    baseScore: SCORE_CHROME_FALLBACK + chromeResultIndex * 0.01,
    tieBreaker: 1,
  };
}

/**
 * Re-rank Chrome's bookmark search results using frequency data
 * and a richer scoring algorithm.
 *
 * Final score = baseScore * 10000 + freqWeight * 100 - url.length
 * (lower is better; freqWeight in [0, 1])
 */
export function rerankBookmarks(
  query: string,
  chromeResults: BookmarkInput[],
  plainMode = false,
): OmniboxSuggestion[] {
  const freqCache = getFreqCache();
  const freqValues = Object.values(freqCache);
  let maxFreq = 1;
  for (const f of freqValues) {
    if (f > maxFreq) maxFreq = f;
  }
  const fmt = plainMode ? highlightBookmarkPlain : highlightBookmark;

  const scored: ScoredBookmark[] = [];

  for (let i = 0; i < chromeResults.length; i++) {
    const scored_ = scoreBookmark(chromeResults[i], query, i);
    if (scored_) scored.push(scored_);
  }

  // Levenshtein fuzzy pass — for query.length >= 3, scan all scored
  // items that haven't been matched by earlier rules and add/edit their score.
  // Uses sliding window to find fuzzy match anywhere in title.
  if (query.length >= 3) {
    const ql = query.toLowerCase();
    const qLen = ql.length;
    const MAX_TITLE_LEN = 200; // Guard against O(n*m) on very long titles

    for (const entry of scored) {
      if (entry.baseScore < SCORE_LEVENSHTEIN) continue;
      const tl = entry.bookmark.title.toLowerCase();
      if (tl.length < qLen) continue;

      // Limit title length to avoid pathological cases
      const searchTitle =
        tl.length > MAX_TITLE_LEN ? tl.slice(0, MAX_TITLE_LEN) : tl;

      // Slide windows of size qLen to qLen+2 across the title
      let matched = false;
      for (
        let windowSize = qLen;
        windowSize <= qLen + 2 && !matched;
        windowSize++
      ) {
        for (let start = 0; start + windowSize <= searchTitle.length; start++) {
          const window = searchTitle.slice(start, start + windowSize);
          const dist = levenshtein(ql, window);
          if (dist <= 1) {
            entry.baseScore = SCORE_LEVENSHTEIN;
            matched = true;
            break;
          }
        }
      }
    }
  }

  // Sort by final score
  scored.sort((a, b) => {
    const freqA = freqCache[a.bookmark.url ?? ""] ?? 0;
    const freqB = freqCache[b.bookmark.url ?? ""] ?? 0;
    const normA = freqA / maxFreq;
    const normB = freqB / maxFreq;

    const scoreA =
      a.baseScore * 10000 + (1 - normA) * 100 - (a.bookmark.url ?? "").length;
    const scoreB =
      b.baseScore * 10000 + (1 - normB) * 100 - (b.bookmark.url ?? "").length;

    if (scoreA !== scoreB) return scoreA - scoreB;
    if (a.tieBreaker !== b.tieBreaker) return a.tieBreaker - b.tieBreaker;
    return a.bookmark.title.localeCompare(b.bookmark.title);
  });

  return scored.map((entry) => ({
    content: entry.bookmark.url!,
    description: fmt(entry.bookmark.title, query, entry.bookmark.url!),
  }));
}
