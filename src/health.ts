/**
 * Dead link detector — 定期扫描已索引书签，标记 HTTP 错误状态
 */
import type { LinkCheckResult } from "./types";
import {
  getUncheckedBookmarks,
  updateLinkStatus,
  getLinkHealthStats,
  getDeadLinks,
  getSettings,
} from "./db";

/** 批间延迟固定；并发与超时可由 settings.linkCheckConcurrency / linkCheckTimeoutMs 配置 */
const DEFAULT_CONCURRENCY = 5;
const DEFAULT_TIMEOUT_MS = 8000;
const BATCH_DELAY_MS = 100;

export interface LinkCheckProgress {
  total: number;
  checked: number;
  alive: number;
  dead: number;
  status: "scanning" | "complete" | "cancelled";
  currentUrl?: string;
}

let abortController: AbortController | null = null;
let progressCallback: ((p: LinkCheckProgress) => void) | null = null;

/** 注册进度回调 */
export function onLinkCheckProgress(cb: (p: LinkCheckProgress) => void): void {
  progressCallback = cb;
}

/** 广播进度到所有 runtime listeners */
function broadcastProgress(progress: LinkCheckProgress): void {
  if (progressCallback) progressCallback(progress);
  try {
    browser.runtime
      .sendMessage({
        type: "LINK_CHECK_PROGRESS",
        ...progress,
      })
      .catch(() => {});
  } catch {}
}

/** 对一批书签执行 HEAD 请求，返回 HTTP 状态码（0=网络错误/超时） */
async function checkUrl(
  url: string,
  signal: AbortSignal,
  timeoutMs: number,
): Promise<number> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  const linkedSignal = signal
    ? (() => {
        if (signal.aborted) return signal;
        signal.addEventListener("abort", () => controller.abort());
        return controller.signal;
      })()
    : controller.signal;

  try {
    const response = await fetch(url, {
      method: "HEAD",
      signal: linkedSignal,
      redirect: "follow",
    });
    clearTimeout(timeoutId);
    return response.status;
  } catch {
    clearTimeout(timeoutId);
    return 0;
  }
}

/**
 * 扫描所有已索引书签的链接健康状态
 * @param signal 可用于取消扫描
 */
export async function checkLinks(
  signal?: AbortSignal,
): Promise<LinkCheckResult> {
  abortController = new AbortController();
  const internalSignal = abortController.signal;

  if (signal) {
    signal.addEventListener("abort", () => abortController?.abort());
  }

  const bookmarks = await getUncheckedBookmarks();
  const settings = await getSettings();
  const concurrency = Math.min(
    20,
    Math.max(1, settings.linkCheckConcurrency ?? DEFAULT_CONCURRENCY),
  );
  const timeoutMs = Math.min(
    60000,
    Math.max(1000, settings.linkCheckTimeoutMs ?? DEFAULT_TIMEOUT_MS),
  );
  const total = bookmarks.length;
  let checked = 0;
  let alive = 0;
  let dead = 0;
  const startTime = Date.now();

  broadcastProgress({
    total,
    checked: 0,
    alive: 0,
    dead: 0,
    status: "scanning",
  });

  for (let i = 0; i < bookmarks.length; i += concurrency) {
    if (internalSignal.aborted) break;

    const chunk = bookmarks.slice(i, i + concurrency);
    const results = await Promise.allSettled(
      chunk.map((b) => checkUrl(b.url, internalSignal, timeoutMs)),
    );

    const updates: {
      id: string;
      linkStatus: number;
      linkCheckedAt: number;
    }[] = [];

    for (let j = 0; j < chunk.length; j++) {
      const result = results[j];
      const linkStatus = result.status === "fulfilled" ? result.value : 0;
      updates.push({
        id: chunk[j].id,
        linkStatus,
        linkCheckedAt: Date.now(),
      });

      if (linkStatus >= 200 && linkStatus < 400) {
        alive++;
      } else {
        dead++;
      }
      checked++;
    }

    await updateLinkStatus(updates);

    if (i + concurrency < bookmarks.length && !internalSignal.aborted) {
      const nextUrl = bookmarks[i + concurrency]?.url;
      broadcastProgress({
        total,
        checked,
        alive,
        dead,
        status: "scanning",
        currentUrl: nextUrl,
      });
      await new Promise((resolve) => setTimeout(resolve, BATCH_DELAY_MS));
    }
  }

  abortController = null;
  const result: LinkCheckResult = {
    total,
    checked,
    alive,
    dead,
    elapsedMs: Date.now() - startTime,
  };
  broadcastProgress({
    total,
    checked,
    alive,
    dead,
    status: internalSignal.aborted ? "cancelled" : "complete",
  });
  return result;
}

/** 获取当前链接健康统计 */
export { getLinkHealthStats, getDeadLinks };
