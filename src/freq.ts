/**
 * Frequency cache — persists visit counts in browser.storage.local.
 * Each URL key maps to { count, lastVisit } with time-decay weighting.
 *
 * Time-decay multipliers:
 *   - visited within 7 days:  ×3
 *   - visited within 30 days: ×2
 *   - older:                  ×1
 */

const STORAGE_KEY = "bookmark_freq";
const PERSIST_DEBOUNCE_MS = 500;

interface FreqEntry {
  count: number;
  lastVisit: number;
}

/** Raw in-memory cache (count + lastVisit). */
let rawCache: Record<string, FreqEntry> = {};
let persistTimer: ReturnType<typeof setTimeout> | null = null;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** 计算时间衰减权重 */
function timeDecayMultiplier(lastVisit: number): number {
  const days = (Date.now() - lastVisit) / MS_PER_DAY;
  if (days <= 7) return 3;
  if (days <= 30) return 2;
  return 1;
}

/** 从原始缓存生成加权分数表 */
function buildWeightedCache(): Record<string, number> {
  const weighted: Record<string, number> = {};
  for (const [url, entry] of Object.entries(rawCache)) {
    weighted[url] = entry.count * timeDecayMultiplier(entry.lastVisit);
  }
  return weighted;
}

/**
 * Load frequency cache from persistent storage.
 * Backward-compatible: old format { [url]: number } is auto-migrated.
 */
export async function loadFreqCache(): Promise<Record<string, number>> {
  const result = await browser.storage.local.get(STORAGE_KEY);
  const stored = result[STORAGE_KEY];

  if (!stored) {
    rawCache = {};
    return {};
  }

  const firstValue = Object.values(stored)[0];
  if (typeof firstValue === "number") {
    // 旧格式迁移
    const now = Date.now();
    const old = stored as Record<string, number>;
    rawCache = {};
    for (const [url, count] of Object.entries(old)) {
      rawCache[url] = { count, lastVisit: now };
    }
    // 迁移后立即持久化新格式
    await persistFreqCache();
  } else {
    rawCache = stored as Record<string, FreqEntry>;
  }

  return buildWeightedCache();
}

/**
 * Persist the in-memory cache back to storage.
 */
export async function persistFreqCache(): Promise<void> {
  await browser.storage.local.set({ [STORAGE_KEY]: rawCache });
}

/**
 * Increment the frequency counter for a URL.
 * Updates memory immediately and schedules debounced persistence.
 */
export function incrementFreq(url: string): void {
  const entry = rawCache[url];
  if (entry) {
    entry.count += 1;
    entry.lastVisit = Date.now();
  } else {
    rawCache[url] = { count: 1, lastVisit: Date.now() };
  }
  // Debounced persistence — coalesce rapid increments
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    persistFreqCache().catch(() => {});
    persistTimer = null;
  }, PERSIST_DEBOUNCE_MS);
}

/**
 * Read the current weighted cache (for use by search/ranking logic).
 */
export function getFreqCache(): Record<string, number> {
  return buildWeightedCache();
}

/**
 * Get the top-N most frequent bookmarks for the empty-query default suggestion.
 */
export function getRecentBookmarks(
  n = 8,
): Array<{ url: string; freq: number }> {
  return Object.entries(buildWeightedCache())
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([url, freq]) => ({ url, freq }));
}
