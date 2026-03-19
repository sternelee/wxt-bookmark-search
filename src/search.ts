import type { ChromeBookmark, OmniboxSuggestion } from "./types.js";
import { highlightBookmark } from "./highlight.js";
import { getFreqCache } from "./freq.js";

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
const SCORE_MULTI_WORD = 5;
const SCORE_TITLE_CONTAINS = 10;
const SCORE_CHROME_FALLBACK = 15;
const SCORE_LEVENSHTEIN = 20; // applied only when query.length >= 3

interface ScoredBookmark {
  bookmark: ChromeBookmark;
  baseScore: number;
  /** For ties, sort by highlight order (prefix > contains) */
  tieBreaker: number;
}

/**
 * Score a single bookmark given the query and its position in Chrome results.
 */
function scoreBookmark(
  bookmark: ChromeBookmark,
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

  // 3. Multi-word all-match
  if (queryWordsMatch(q, title, url) && q.includes(" ")) {
    return { bookmark, baseScore: SCORE_MULTI_WORD, tieBreaker: 0 };
  }

  // 4. Title contains (case-insensitive)
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
  chromeResults: ChromeBookmark[],
): OmniboxSuggestion[] {
  const freqCache = getFreqCache();
  const maxFreq = Math.max(1, ...Object.values(freqCache));

  const scored: ScoredBookmark[] = [];

  for (let i = 0; i < chromeResults.length; i++) {
    const scored_ = scoreBookmark(chromeResults[i], query, i);
    if (scored_) scored.push(scored_);
  }

  // Levenshtein fuzzy pass — for query.length >= 3, scan all scored
  // items that haven't been matched by earlier rules and add/edit their score.
  if (query.length >= 3) {
    for (const entry of scored) {
      if (entry.baseScore < SCORE_LEVENSHTEIN) continue;
      const tl = entry.bookmark.title.toLowerCase();
      const ql = query.toLowerCase();
      if (tl.length < ql.length) continue;
      // Check fuzzy match: find if any substring of title within edit distance 1
      // of query. Simple approach: check Levenshtein of the query against
      // the shortest window in title that could contain it.
      const dist = levenshtein(ql, tl.slice(0, ql.length + 1));
      if (dist <= 1) {
        entry.baseScore = SCORE_LEVENSHTEIN;
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
    description: highlightBookmark(
      entry.bookmark.title,
      query,
      entry.bookmark.url!,
    ),
  }));
}
