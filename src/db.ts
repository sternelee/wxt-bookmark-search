/**
 * IndexedDB 数据库封装 - 使用 Dexie.js
 * 存储书签向量索引数据
 */

import Dexie, { Table } from 'dexie';
import type { BookmarkRecord, Settings } from './types';

const SETTINGS_KEY = 'settings';

// === 已索引书签内存缓存 ===
let _indexedCache: BookmarkRecord[] | null = null;

/** 从 DB 加载已索引书签到缓存 */
async function loadIndexedCache(): Promise<BookmarkRecord[]> {
  _indexedCache = await db.bookmarks.where('status').equals('indexed').toArray();
  return _indexedCache;
}

/** 获取已索引书签（优先使用缓存） */
export async function ensureCachedIndexedBookmarks(): Promise<BookmarkRecord[]> {
  if (_indexedCache === null) {
    return loadIndexedCache();
  }
  return _indexedCache;
}

/** 使缓存失效（供 clearAll 调用） */
export function invalidateIndexedCache(): void {
  _indexedCache = null;
}

/** 内部：同步缓存中的单条记录 */
function syncCacheRecord(record: BookmarkRecord): void {
  if (_indexedCache === null) return;

  const idx = _indexedCache.findIndex(r => r.id === record.id);
  if (record.status === 'indexed') {
    if (idx >= 0) {
      _indexedCache[idx] = record;
    } else {
      _indexedCache.push(record);
    }
  } else {
    if (idx >= 0) {
      _indexedCache.splice(idx, 1);
    }
  }
}

/** 内部：从缓存中移除记录 */
function removeCacheRecord(id: string): void {
  if (_indexedCache === null) return;
  const idx = _indexedCache.findIndex(r => r.id === id);
  if (idx >= 0) {
    _indexedCache.splice(idx, 1);
  }
}

class BookmarkDB extends Dexie {
  bookmarks!: Table<BookmarkRecord, string>;

  constructor() {
    super('FlowSearch');
    this.version(1).stores({
      bookmarks: 'id, url, status, indexedAt'
    });
  }
}

export const db = new BookmarkDB();

/** 获取所有待索引的书签 */
export async function getPendingBookmarks(): Promise<BookmarkRecord[]> {
  return db.bookmarks.where('status').equals('pending').toArray();
}

/** 获取所有已索引的书签 */
export async function getIndexedBookmarks(): Promise<BookmarkRecord[]> {
  return db.bookmarks.where('status').equals('indexed').toArray();
}

/** 根据 URL 查找记录 */
export async function getBookmarkByUrl(url: string): Promise<BookmarkRecord | undefined> {
  return db.bookmarks.where('url').equals(url).first();
}

/** 批量查询 URL 是否已索引 (返回已索引的 URL Set) */
export async function getIndexedUrls(urls: string[]): Promise<Set<string>> {
  const indexedUrls = new Set<string>();

  // 批量查询，每次最多 100 个避免性能问题
  const BATCH_SIZE = 100;
  for (let i = 0; i < urls.length; i += BATCH_SIZE) {
    const batch = urls.slice(i, i + BATCH_SIZE);
    const records = await db.bookmarks
      .where('url')
      .anyOf(batch)
      .filter(r => r.status === 'indexed')
      .toArray();

    for (const r of records) {
      indexedUrls.add(r.url);
    }
  }

  return indexedUrls;
}

/** 批量插入或更新书签记录 */
export async function upsertBookmarks(records: BookmarkRecord[]): Promise<void> {
  await db.transaction('rw', db.bookmarks, async () => {
    for (const record of records) {
      await db.bookmarks.put(record);
    }
  });
  // 同步缓存
  for (const record of records) {
    syncCacheRecord(record);
  }
}

/** 更新单条记录 */
export async function updateBookmark(id: string, updates: Partial<BookmarkRecord>): Promise<void> {
  await db.bookmarks.update(id, updates);

  // 同步缓存
  if (_indexedCache !== null) {
    const idx = _indexedCache.findIndex(r => r.id === id);
    const newStatus = updates.status as string | undefined;
    if (newStatus === 'indexed') {
      // 状态变为 indexed，从 DB 读取完整记录或更新现有
      if (idx >= 0) {
        _indexedCache[idx] = { ..._indexedCache[idx], ...updates };
      } else {
        const fullRecord = await db.bookmarks.get(id);
        if (fullRecord) _indexedCache.push(fullRecord);
      }
    } else if (newStatus && newStatus !== 'indexed') {
      // 状态变为非 indexed，移除
      if (idx >= 0) _indexedCache.splice(idx, 1);
    } else if (idx >= 0) {
      // 状态未变，仅更新其他字段
      _indexedCache[idx] = { ..._indexedCache[idx], ...updates };
    }
  }
}

/** 删除书签记录 */
export async function deleteBookmark(id: string): Promise<void> {
  await db.bookmarks.delete(id);
  removeCacheRecord(id);
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
    db.bookmarks.where('status').equals('indexed').count(),
    db.bookmarks.where('status').equals('pending').count(),
    db.bookmarks.where('status').equals('failed').count(),
  ]);
  return { total, indexed, pending, failed };
}

/** 清空数据库 */
export async function clearAll(): Promise<void> {
  await db.bookmarks.clear();
  invalidateIndexedCache();
}

/** 获取所有失败的书签 */
export async function getFailedBookmarks(): Promise<BookmarkRecord[]> {
  return db.bookmarks.where('status').equals('failed').toArray();
}

// === 设置管理 ===

const defaultSettings: Settings = {
  openaiApiKey: undefined,
  searchMode: 'hybrid',
  vectorWeight: 0.4,
  selectedFolderIds: [],
  githubToken: undefined,
  githubSyncEnabled: false,
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
    [SETTINGS_KEY]: { ...current, ...settings }
  });
}

/** 检查是否已配置 API Key */
export async function hasApiKey(): Promise<boolean> {
  const settings = await getSettings();
  return !!settings.openaiApiKey;
}
