/**
 * IndexedDB 数据库封装 - 使用 Dexie.js
 * 存储书签向量索引数据
 */

import Dexie, { Table } from "dexie";
import type { BookmarkRecord, IndexQueueRecord, Settings } from "./types";

const SETTINGS_KEY = "settings";

class BookmarkDB extends Dexie {
  bookmarks!: Table<BookmarkRecord, string>;
  indexQueue!: Table<IndexQueueRecord, string>;

  constructor() {
    super("FlowSearch");
    // v1: original schema (Dexie 3 installs stored IDB version as-is)
    this.version(1).stores({
      bookmarks: "id, url, status, indexedAt",
    });
    // v2: added vectorId index (Dexie 4 stores IDB version as version*10)
    this.version(2).stores({
      bookmarks: "id, url, status, indexedAt, vectorId",
    });
    // v3: remove unused vectorId index (EdgeVec removed; pure cosine similarity)
    this.version(3).stores({
      bookmarks: "id, url, status, indexedAt",
    });
    // v4: add indexQueue for persistent indexing queue
    this.version(4).stores({
      bookmarks: "id, url, status, indexedAt",
      indexQueue: "bookmarkId, url, enqueuedAt",
    });
    // v5: add aiProvider default to storage.local settings
    this.version(5)
      .stores({
        bookmarks: "id, url, status, indexedAt",
        indexQueue: "bookmarkId, url, enqueuedAt",
      })
      .upgrade(async () => {
        try {
          const result = await browser.storage.local.get(SETTINGS_KEY);
          const stored = result[SETTINGS_KEY] as
            | Record<string, unknown>
            | undefined;
          if (stored && stored.aiProvider === undefined) {
            await browser.storage.local.set({
              [SETTINGS_KEY]: { ...stored, aiProvider: "remote" },
            });
          }
        } catch (e) {
          console.warn("[db] v5 migration skipped:", e);
        }
      });
    // v6: migrate aiProvider "chrome" to "remote" (Chrome AI support removed)
    this.version(6)
      .stores({
        bookmarks: "id, url, status, indexedAt",
        indexQueue: "bookmarkId, url, enqueuedAt",
      })
      .upgrade(async () => {
        try {
          const result = await browser.storage.local.get(SETTINGS_KEY);
          const stored = result[SETTINGS_KEY] as
            | Record<string, unknown>
            | undefined;
          if (stored && stored.aiProvider === "chrome") {
            await browser.storage.local.set({
              [SETTINGS_KEY]: { ...stored, aiProvider: "remote" },
            });
            console.log("[db] v6 migration: aiProvider 'chrome' -> 'remote'");
          }
        } catch (e) {
          console.warn("[db] v6 migration skipped:", e);
        }
      });
  }
}

export const db = new BookmarkDB();

/** 获取所有待索引的书签 */
export async function getPendingBookmarks(): Promise<BookmarkRecord[]> {
  return db.bookmarks.where("status").equals("pending").toArray();
}

/** 获取所有已索引的书签 */
export async function getIndexedBookmarks(): Promise<BookmarkRecord[]> {
  return db.bookmarks.where("status").equals("indexed").toArray();
}

/** 获取所有已索引的书签记录（用于重建搜索引擎） */
export async function getAllIndexedRecords(): Promise<BookmarkRecord[]> {
  return db.bookmarks.where("status").equals("indexed").toArray();
}

/** 根据 URL 查找记录 */
export async function getBookmarkByUrl(
  url: string,
): Promise<BookmarkRecord | undefined> {
  return db.bookmarks.where("url").equals(url).first();
}

/** 批量查询 URL 是否已索引 (返回已索引的 URL Set) */
export async function getIndexedUrls(urls: string[]): Promise<Set<string>> {
  const indexedUrls = new Set<string>();

  // 批量查询，每次最多 100 个避免性能问题
  const BATCH_SIZE = 100;
  for (let i = 0; i < urls.length; i += BATCH_SIZE) {
    const batch = urls.slice(i, i + BATCH_SIZE);
    const records = await db.bookmarks
      .where("url")
      .anyOf(batch)
      .filter((r) => r.status === "indexed")
      .toArray();

    for (const r of records) {
      indexedUrls.add(r.url);
    }
  }

  return indexedUrls;
}

/** 批量插入或更新书签记录 */
export async function upsertBookmarks(
  records: BookmarkRecord[],
): Promise<void> {
  await db.bookmarks.bulkPut(records);
}

/** 更新单条记录 */
export async function updateBookmark(
  id: string,
  updates: Partial<BookmarkRecord>,
): Promise<void> {
  await db.bookmarks.update(id, updates);
}

/** 删除书签记录 */
export async function deleteBookmark(id: string): Promise<void> {
  await db.bookmarks.delete(id);
}

/** 获取索引统计 */
export async function getIndexStats(): Promise<{
  total: number;
  indexed: number;
  pending: number;
  failed: number;
}> {
  const [total, indexed, pending, failed] = await Promise.all([
    db.bookmarks.count(),
    db.bookmarks.where("status").equals("indexed").count(),
    db.bookmarks.where("status").equals("pending").count(),
    db.bookmarks.where("status").equals("failed").count(),
  ]);
  return { total, indexed, pending, failed };
}

/** 清空数据库 */
export async function clearAll(): Promise<void> {
  await db.bookmarks.clear();
}

/** 获取所有失败的书签 */
export async function getFailedBookmarks(): Promise<BookmarkRecord[]> {
  return db.bookmarks.where("status").equals("failed").toArray();
}

/** 获取可进行链接检查的书签（已索引，按上次检查时间升序，未检查的优先） */
export async function getUncheckedBookmarks(
  limit?: number,
): Promise<BookmarkRecord[]> {
  const indexed = await db.bookmarks
    .where("status")
    .equals("indexed")
    .toArray();
  const sorted = indexed.sort((a, b) => {
    const aChecked = a.linkCheckedAt ?? 0;
    const bChecked = b.linkCheckedAt ?? 0;
    return aChecked - bChecked;
  });
  return limit ? sorted.slice(0, limit) : sorted;
}

/** 获取所有已索引书签的 URL 统计（用于重复检测） */
export async function getAllIndexedUrls(): Promise<
  { url: string; ids: string[] }[]
> {
  const indexed = await db.bookmarks
    .where("status")
    .equals("indexed")
    .toArray();
  const urlMap = new Map<string, string[]>();
  for (const r of indexed) {
    const ids = urlMap.get(r.url);
    if (ids) {
      ids.push(r.id);
    } else {
      urlMap.set(r.url, [r.id]);
    }
  }
  const groups: { url: string; ids: string[] }[] = [];
  for (const [url, ids] of urlMap) {
    if (ids.length >= 2) {
      groups.push({ url, ids });
    }
  }
  return groups;
}

/** 批量更新链接健康状态 */
export async function updateLinkStatus(
  updates: { id: string; linkStatus: number; linkCheckedAt: number }[],
): Promise<void> {
  await db.transaction("rw", db.bookmarks, async () => {
    for (const { id, linkStatus, linkCheckedAt } of updates) {
      await db.bookmarks.update(id, { linkStatus, linkCheckedAt });
    }
  });
}

/** 获取死链书签（linkStatus >= 400 或 0/超时） */
export async function getDeadLinks(): Promise<BookmarkRecord[]> {
  const indexed = await db.bookmarks
    .where("status")
    .equals("indexed")
    .toArray();
  return indexed.filter((r) => {
    if (r.linkStatus === undefined) return false;
    return r.linkStatus >= 400 || r.linkStatus === 0;
  });
}

/** 获取链接健康统计 */
export async function getLinkHealthStats(): Promise<{
  total: number;
  alive: number;
  dead: number;
  unchecked: number;
  lastCheckAt?: number;
}> {
  const indexed = await getIndexedBookmarks();
  let alive = 0;
  let dead = 0;
  let unchecked = 0;
  let lastCheckAt: number | undefined;

  for (const r of indexed) {
    if (r.linkStatus === undefined) {
      unchecked++;
    } else if (r.linkStatus >= 200 && r.linkStatus < 400) {
      alive++;
    } else {
      dead++;
    }
    if (r.linkCheckedAt && (!lastCheckAt || r.linkCheckedAt > lastCheckAt)) {
      lastCheckAt = r.linkCheckedAt;
    }
  }

  return {
    total: indexed.length,
    alive,
    dead,
    unchecked,
    lastCheckAt,
  };
}

// === 设置管理 ===

const defaultSettings: Settings = {
  openaiApiKey: undefined,
  baseURL: "https://api.openai.com",
  searchMode: "hybrid",
  vectorWeight: 0.4,
  selectedFolderIds: [],
  githubToken: undefined,
  githubSyncEnabled: false,
  twitterSyncEnabled: false,
  enableLLMEnrichment: true, // 默认启用 LLM 增强
  embeddingModel: "text-embedding-3-small", // 默认 embedding 模型
  llmModel: "gpt-4o-mini", // 默认 LLM 模型
  gistSyncEnabled: false,
  gistId: undefined,
  gistDeviceId: undefined,
  lastGistSync: undefined,
  historySyncEnabled: false,
  historyDays: 30,
  language: "en",
  aiProvider: "remote",
  githubReadmeVersion: 0,
  linkCheckEnabled: false,
  linkCheckInterval: 24,
  autoCategorizeEnabled: false,
  categoryRules: "",
  categoryFolderMap: {},
};

/** 获取设置 */
export async function getSettings(): Promise<Settings> {
  const result = await browser.storage.local.get(SETTINGS_KEY);
  return { ...defaultSettings, ...(result[SETTINGS_KEY] as Settings) };
}

/** 保存设置 */
export async function saveSettings(settings: Partial<Settings>): Promise<void> {
  const current = await getSettings();
  await browser.storage.local.set({
    [SETTINGS_KEY]: { ...current, ...settings },
  });
}

/** 检查是否已配置 API Key */
export async function hasApiKey(): Promise<boolean> {
  const settings = await getSettings();
  return !!settings.openaiApiKey;
}
