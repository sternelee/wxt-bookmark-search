/**
 * 浏览器历史同步模块
 * 从 browser.history API 抓取访问记录，过滤后转换为 BookmarkRecord
 */

import type { BookmarkRecord } from "./types";
import { getSettings, upsertBookmarks } from "./db";

/** 需要跳过的 URL 协议前缀 */
const SKIP_PROTOCOLS = [
  "chrome://",
  "chrome-extension://",
  "about:",
  "file://",
  "data:",
  "javascript:",
];

/**
 * 判断 URL 是否应被跳过（系统页面或无效 URL）
 */
function shouldSkipUrl(url: string): boolean {
  return SKIP_PROTOCOLS.some((prefix) => url.startsWith(prefix));
}

/** 浏览器历史条目类型（兼容 Chrome/Firefox） */
interface HistoryItem {
  id: string;
  url?: string;
  title?: string;
  lastVisitTime?: number;
  visitCount?: number;
}

/**
 * 将浏览器历史条目转换为 BookmarkRecord
 */
function historyItemToRecord(item: HistoryItem): BookmarkRecord {
  const url = item.url!;
  // id: "hi-" + encodeURIComponent(url) 截取前 200 字符确保唯一可读
  const id = "hi-" + encodeURIComponent(url).slice(0, 200);
  return {
    id,
    url,
    title: item.title || url,
    summary: "",
    tags: [],
    status: "pending",
    indexedAt: Date.now(),
  };
}

/**
 * 同步浏览器访问历史到 IndexedDB
 * 跳过已索引 URL 和系统页面
 */
export async function syncHistoryBookmarks(): Promise<{
  added: number;
  skipped: number;
  error?: string;
}> {
  try {
    const settings = await getSettings();
    const days = settings.historyDays ?? 30;
    const startTime = Date.now() - days * 24 * 60 * 60 * 1000;

    // 从 browser.history 获取历史记录
    const historyItems = await browser.history.search({
      text: "",
      startTime,
      maxResults: 5000,
    });

    // 过滤无效 URL
    const validItems = historyItems.filter(
      (item) => item.url && !shouldSkipUrl(item.url),
    );

    if (validItems.length === 0) {
      return { added: 0, skipped: 0 };
    }

    // 获取已存在于 DB 的 URL 集合（任意来源）
    const { db } = await import("./db");
    const allUrls = validItems.map((item) => item.url!);

    // 分批查询已存在的 URL
    const BATCH_SIZE = 200;
    const existingUrls = new Set<string>();
    for (let i = 0; i < allUrls.length; i += BATCH_SIZE) {
      const batch = allUrls.slice(i, i + BATCH_SIZE);
      const existing = await db.bookmarks
        .where("url")
        .anyOf(batch)
        .toArray();
      for (const r of existing) {
        existingUrls.add(r.url);
      }
    }

    // 过滤已存在的 URL
    const newItems = validItems.filter(
      (item) => !existingUrls.has(item.url!),
    );

    if (newItems.length === 0) {
      return { added: 0, skipped: validItems.length };
    }

    // 转换并写入 DB
    const records = newItems.map(historyItemToRecord);
    await upsertBookmarks(records);

    console.log(
      `[history] 同步完成: 新增 ${records.length} 条，跳过 ${validItems.length - records.length} 条`,
    );

    return {
      added: records.length,
      skipped: validItems.length - records.length,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[history] syncHistoryBookmarks 失败:", error);
    return { added: 0, skipped: 0, error: message };
  }
}
