/**
 * Frequency cache — persists visit counts in browser.storage.local.
 * Each URL key maps to a visit count (higher = more frequent).
 */

const STORAGE_KEY = "bookmark_freq";
const PERSIST_DEBOUNCE_MS = 500;

/** In-memory cache, populated at startup. */
let cache: Record<string, number> = {};
let persistTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Load frequency cache from persistent storage.
 * Called once at background service worker startup.
 */
export async function loadFreqCache(): Promise<Record<string, number>> {
  const result = await browser.storage.local.get(STORAGE_KEY);
  cache = (result[STORAGE_KEY] as Record<string, number>) ?? {};
  return cache;
}

/**
 * Persist the in-memory cache back to storage.
 */
export async function persistFreqCache(): Promise<void> {
  await browser.storage.local.set({ [STORAGE_KEY]: cache });
}

/**
 * Increment the frequency counter for a URL.
 * Updates memory immediately and schedules debounced persistence.
 */
export function incrementFreq(url: string): void {
  cache[url] = (cache[url] ?? 0) + 1;
  // Debounced persistence — coalesce rapid increments
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    persistFreqCache().catch(() => {});
    persistTimer = null;
  }, PERSIST_DEBOUNCE_MS);
}

/**
 * Read the current in-memory cache (for use by search/ranking logic).
 */
export function getFreqCache(): Record<string, number> {
  return cache;
}

/**
 * Get the top-N most frequent bookmarks for the empty-query default suggestion.
 */
export function getRecentBookmarks(n = 8): Array<{ url: string; freq: number }> {
  return Object.entries(cache)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([url, freq]) => ({ url, freq }));
}
