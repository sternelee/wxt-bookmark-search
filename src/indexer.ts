/**
 * 书签索引器
 * 负责提取网页内容并生成向量索引
 */

import type { BookmarkRecord, Settings } from './types';
import {
  getSettings,
  upsertBookmarks,
  updateBookmark,
  getIndexedBookmarks,
  getIndexStats,
} from './db';
import { getEmbedding, testApiKey } from './embedding';

/** 索引任务状态 */
interface IndexJob {
  bookmarkId: string;
  url: string;
  title: string;
  retryCount: number;
}

/** 索引队列 */
const queue: IndexJob[] = [];
let isProcessing = false;
const MAX_RETRIES = 2;
const BATCH_SIZE = 5;
const DELAY_BETWEEN_BATCHES = 1000; // 1秒

/**
 * 使用 Jina AI Reader 获取网页 Markdown 内容
 * https://r.jina.ai/ 提取网页正文并转为 Markdown
 */
async function fetchPageMarkdown(url: string): Promise<string> {
  const readerUrl = `https://r.jina.ai/${encodeURIComponent(url)}`;

  const response = await fetch(readerUrl, {
    headers: {
      'Accept': 'text/markdown',
    },
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  const markdown = await response.text();
  return markdown;
}

/**
 * 从 Markdown 提取标题和摘要
 */
function extractFromMarkdown(markdown: string, fallbackTitle: string): { title: string; summary: string } {
  const lines = markdown.split('\n').filter(line => line.trim());

  // 提取标题 (第一个 # 开头的行)
  let title = fallbackTitle;
  for (const line of lines) {
    const match = line.match(/^#\s+(.+)$/);
    if (match) {
      title = match[1].trim();
      break;
    }
  }

  // 提取摘要 (跳过标题，取前几段有效内容)
  let summary = '';
  let started = false;
  const contentLines: string[] = [];

  for (const line of lines) {
    // 跳过标题行
    if (line.startsWith('#') && !started) {
      started = true;
      continue;
    }
    // 跳过空行和图片
    if (!line.trim() || line.match(/^!\[.*\]\(.*\)$/)) {
      continue;
    }
    contentLines.push(line.trim());
    if (contentLines.length >= 10) break; // 取前 10 行有效内容
  }

  summary = contentLines.join(' ').slice(0, 1000);

  return { title, summary };
}

/**
 * 处理单个书签索引
 */
async function indexBookmark(
  job: IndexJob,
  settings: Settings
): Promise<{ success: boolean; error?: string }> {
  if (!settings.openaiApiKey) {
    return { success: false, error: 'No API key configured' };
  }

  try {
    // 1. 获取网页 Markdown 内容
    const markdown = await fetchPageMarkdown(job.url);

    // 2. 提取标题和摘要
    const { title, summary } = extractFromMarkdown(markdown, job.title);

    // 3. 生成向量
    const textToEmbed = `${title}\n${summary}`;
    const { embedding } = await getEmbedding(textToEmbed, settings.openaiApiKey);

    // 4. 更新数据库
    const record: BookmarkRecord = {
      id: job.bookmarkId,
      url: job.url,
      title: job.title || title,
      summary,
      embedding,
      status: 'indexed',
      indexedAt: Date.now(),
    };

    await upsertBookmarks([record]);

    return { success: true };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return { success: false, error: errorMessage };
  }
}

/**
 * 处理索引队列
 */
async function processQueue(): Promise<void> {
  if (isProcessing || queue.length === 0) return;

  isProcessing = true;
  const settings = await getSettings();

  if (!settings.openaiApiKey) {
    console.warn('[indexer] No API key, skipping queue processing');
    isProcessing = false;
    return;
  }

  console.log(`[indexer] Processing ${queue.length} items in queue`);

  while (queue.length > 0) {
    const batch = queue.splice(0, BATCH_SIZE);

    for (const job of batch) {
      const result = await indexBookmark(job, settings);

      if (!result.success) {
        console.warn(`[indexer] Failed to index ${job.url}:`, result.error);

        // 重试逻辑
        if (job.retryCount < MAX_RETRIES) {
          queue.push({ ...job, retryCount: job.retryCount + 1 });
        } else {
          // 标记失败
          await updateBookmark(job.bookmarkId, {
            status: 'failed',
            error: result.error,
          });
        }
      } else {
        console.log(`[indexer] Indexed: ${job.url}`);
      }
    }

    // 批次间延迟，避免 API 限流
    if (queue.length > 0) {
      await new Promise(resolve => setTimeout(resolve, DELAY_BETWEEN_BATCHES));
    }
  }

  isProcessing = false;
  console.log('[indexer] Queue processing complete');

  // 广播索引完成事件
  browser.runtime.sendMessage({ type: 'INDEXING_COMPLETE' }).catch(() => {});
}

/**
 * 添加书签到索引队列
 */
export function enqueueBookmark(bookmark: { id: string; url: string; title: string }): void {
  // 检查是否已在队列中
  const exists = queue.some(j => j.url === bookmark.url);
  if (exists) return;

  queue.push({
    bookmarkId: bookmark.id,
    url: bookmark.url,
    title: bookmark.title,
    retryCount: 0,
  });

  // 触发队列处理
  processQueue();
}

/**
 * 批量添加书签到队列
 */
export function enqueueBookmarks(bookmarks: Array<{ id: string; url: string; title: string }>): void {
  for (const bookmark of bookmarks) {
    enqueueBookmark(bookmark);
  }
}

/**
 * 获取索引状态
 */
export function getIndexingStatus(): { queueLength: number; isProcessing: boolean } {
  return {
    queueLength: queue.length,
    isProcessing,
  };
}

/**
 * 全量索引所有书签
 */
export async function indexAllBookmarks(): Promise<void> {
  const allBookmarks = await browser.bookmarks.getTree();
  const flatBookmarks: Array<{ id: string; url: string; title: string }> = [];

  type BookmarkNode = {
    id: string;
    title?: string;
    url?: string;
    children?: BookmarkNode[];
  };

  function traverse(nodes: BookmarkNode[]) {
    for (const node of nodes) {
      if (node.url) {
        flatBookmarks.push({
          id: node.id,
          url: node.url,
          title: node.title || '',
        });
      }
      if (node.children) {
        traverse(node.children);
      }
    }
  }

  traverse(allBookmarks);

  console.log(`[indexer] Found ${flatBookmarks.length} bookmarks to index`);

  // 先创建待索引记录
  const records: BookmarkRecord[] = flatBookmarks.map(bm => ({
    id: bm.id,
    url: bm.url,
    title: bm.title,
    summary: '',
    status: 'pending' as const,
  }));

  await upsertBookmarks(records);

  // 加入队列
  enqueueBookmarks(flatBookmarks);
}

/**
 * 重新索引失败的书签
 */
export async function retryFailed(): Promise<void> {
  const stats = await getIndexStats();
  console.log(`[indexer] Retrying ${stats.failed} failed bookmarks`);

  // 这里需要重新获取所有失败的书签并加入队列
  // 简化实现：直接触发全量索引
  await indexAllBookmarks();
}

/**
 * 初始化：监听书签变更
 */
export function initIndexer(): void {
  // 新增书签
  browser.bookmarks.onCreated.addListener((id, bookmark) => {
    if (bookmark.url) {
      enqueueBookmark({
        id: bookmark.id,
        url: bookmark.url,
        title: bookmark.title || '',
      });
    }
  });

  // 书签更新
  browser.bookmarks.onChanged.addListener((id, changeInfo) => {
    if (changeInfo.url) {
      enqueueBookmark({
        id,
        url: changeInfo.url,
        title: changeInfo.title || '',
      });
    }
  });

  // 书签删除
  browser.bookmarks.onRemoved.addListener(async (id) => {
    const { deleteBookmark } = await import('./db');
    await deleteBookmark(id);
  });

  console.log('[indexer] Initialized');
}
