/**
 * Dead link detector — 定期扫描已索引书签，标记 HTTP 错误状态
 */
import type { LinkCheckResult } from "./types";
import {
  getUncheckedBookmarks,
  updateLinkStatus,
  getLinkHealthStats,
  getDeadLinks,
} from "./db";

const CONCURRENCY = 5;
const REQUEST_TIMEOUT_MS = 8000;
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
async function checkUrl(url: string, signal: AbortSignal): Promise<number> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
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

  for (let i = 0; i < bookmarks.length; i += CONCURRENCY) {
    if (internalSignal.aborted) break;

    const chunk = bookmarks.slice(i, i + CONCURRENCY);
    const results = await Promise.allSettled(
      chunk.map((b) => checkUrl(b.url, internalSignal)),
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

    if (i + CONCURRENCY < bookmarks.length && !internalSignal.aborted) {
      const nextUrl = bookmarks[i + CONCURRENCY]?.url;
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
