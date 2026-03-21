/**
 * 书签索引器
 * 负责提取网页内容并生成向量索引
 */

import type { BookmarkRecord, Settings } from "./types";
import {
  getSettings,
  upsertBookmarks,
  updateBookmark,
  getIndexedBookmarks,
  getIndexStats,
  getIndexedUrls,
  getFailedBookmarks,
  db,
  saveSettings,
} from "./db";
import { getEmbedding, batchEmbedTexts, testApiKey } from "./embedding";

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
let isPaused = false; // 暂停标志
let totalToProcess = 0; // 总待处理数
let processedCount = 0; // 已处理数
const MAX_RETRIES = 2;

/** 自适应限流配置 */
const RATE_LIMIT_CONFIG = {
  minDelay: 200, // 最小延迟 200ms
  maxDelay: 10000, // 最大延迟 10s
  currentDelay: 500, // 当前延迟
  baseDelay: 500, // 基础延迟
  backoffMultiplier: 2, // 退避倍数
  recoveryMultiplier: 0.9, // 恢复倍数 (每次成功稍微加快)
  consecutiveSuccesses: 0, // 连续成功次数
  successThreshold: 5, // 连续成功 N 次后开始加速
};

/** 进度信息 */
export interface IndexingProgress {
  total: number;
  processed: number;
  current?: string; // 当前正在处理的 URL
  status: "processing" | "complete" | "error" | "paused";
  error?: string;
}

/** 进度监听器 */
type ProgressListener = (progress: IndexingProgress) => void;
const progressListeners: ProgressListener[] = [];

/** 注册进度监听器 */
export function onProgress(listener: ProgressListener): () => void {
  progressListeners.push(listener);
  return () => {
    const index = progressListeners.indexOf(listener);
    if (index > -1) progressListeners.splice(index, 1);
  };
}

/** 通知进度监听器 */
function notifyProgress(progress: IndexingProgress): void {
  for (const listener of progressListeners) {
    listener(progress);
  }
  // 同时广播到其他页面 (如 Options)
  browser.runtime
    .sendMessage({ type: "INDEXING_PROGRESS", progress })
    .catch(() => {});
}

/**
 * 从 Markdown 提取标题和摘要
 */
function extractFromMarkdown(
  markdown: string,
  fallbackTitle: string,
): { title: string; summary: string } {
  const lines = markdown.split("\n").filter((line) => line.trim());

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
  let summary = "";
  let started = false;
  const contentLines: string[] = [];

  for (const line of lines) {
    // 跳过标题行
    if (line.startsWith("#") && !started) {
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

  summary = contentLines.join(" ").slice(0, 1000);

  return { title, summary };
}

import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";
import TurndownService from "turndown";
import { fetchAllStarredRepos, fetchRepoReadme } from "./github";

/** enrichment 任务 — 后台慢慢丰富化 GitHub README */
interface EnrichmentJob {
  bookmarkId: string;
  url: string;
  owner: string;
  repo: string;
  token: string;
}

const enrichmentQueue: EnrichmentJob[] = [];
let isEnriching = false;

/** 后台串行处理 enrichment 队列（低优先级） */
async function processEnrichmentQueue(): Promise<void> {
  if (isEnriching || enrichmentQueue.length === 0) return;
  isEnriching = true;

  const settings = await getSettings();
  if (!settings.openaiApiKey) {
    isEnriching = false;
    return;
  }

  while (enrichmentQueue.length > 0) {
    const job = enrichmentQueue.shift()!;
    try {
      const readme = await fetchRepoReadme(job.token, job.owner, job.repo);
      if (readme && readme.length > 10) {
        const textToEmbed = `${job.owner}/${job.repo}\n${readme.slice(0, 2000)}`;
        const { embedding } = await getEmbedding(textToEmbed, settings.openaiApiKey!);
        await updateBookmark(job.bookmarkId, {
          summary: readme.slice(0, 500),
          embedding,
          needsEnrichment: false,
          indexedAt: Date.now(),
        });
        console.log(`[indexer] Enriched: ${job.owner}/${job.repo}`);
      }
    } catch (err) {
      console.warn(`[indexer] Enrichment failed for ${job.owner}/${job.repo}:`, err);
    }
    // 低优先级：慢速处理，避免抢占主队列
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }

  isEnriching = false;
}

/**
 * 同步 GitHub Stars 到索引队列
 * 快速路径：用 description+language 立即 embed，后台异步丰富 README
 */
export async function syncGithubStars(): Promise<{
  total: number;
  queued: number;
}> {
  const settings = await getSettings();
  if (!settings.githubToken) {
    throw new Error("GitHub Token not configured");
  }
  if (!settings.openaiApiKey) {
    throw new Error("API Key not configured");
  }

  console.log("[FlowSearch] Starting fast-path sync for GitHub Stars...");
  let totalCount = 0;
  let totalQueued = 0;

  await fetchAllStarredRepos(settings.githubToken, async (pageRepos) => {
    totalCount += pageRepos.length;

    // 快速路径：用 description + language 立即批量 embed
    const texts = pageRepos.map(
      (r) => `${r.full_name}\n${r.description || ""} (Main language: ${r.language || "Unknown"})`
    );

    let embeddings: number[][] = [];
    try {
      embeddings = await batchEmbedTexts(texts, settings.openaiApiKey!);
    } catch (err) {
      console.warn("[FlowSearch] Batch embed failed, falling back to title-only:", err);
      // 批量失败时 embeddings 保持空数组，写入 pending 状态等主队列处理
    }

    const records: BookmarkRecord[] = pageRepos.map((repo, i) => ({
      id: `gh-${repo.id}`,
      url: repo.html_url,
      title: repo.full_name,
      summary: `${repo.description || ""} (Main language: ${repo.language || "Unknown"})`,
      embedding: embeddings[i],
      status: embeddings[i] ? "indexed" : "pending",
      indexedAt: embeddings[i] ? Date.now() : undefined,
      needsEnrichment: !!embeddings[i],
    } as BookmarkRecord));

    await upsertBookmarks(records);
    totalQueued += records.length;

    // 把成功快速索引的 repos 加入 enrichment 队列（后台慢慢补 README）
    for (const repo of pageRepos) {
      const match = repo.html_url.match(/github\.com\/([^/]+)\/([^/]+)/);
      if (match) {
        enrichmentQueue.push({
          bookmarkId: `gh-${repo.id}`,
          url: repo.html_url,
          owner: match[1],
          repo: match[2],
          token: settings.githubToken!,
        });
      }
    }

    // 未能 embed 的 fallback 到主队列
    const failedJobs = records
      .filter((r) => r.status === "pending")
      .map((r) => ({ bookmarkId: r.id, url: r.url, title: r.title, retryCount: 0 }));
    if (failedJobs.length > 0) {
      queue.push(...failedJobs);
      processQueue();
    }

    console.log(
      `[FlowSearch] Fast-path: ${records.filter((r) => r.status === "indexed").length}/${records.length} embedded instantly`
    );
  });

  // 更新同步时间
  await saveSettings({ lastGithubSync: Date.now() });

  // 后台启动 enrichment（不 await）
  processEnrichmentQueue().catch(() => {});

  return { total: totalCount, queued: totalQueued };
}

/**
 * 核心内容提取策略器
 */
async function fetchPageContent(
  url: string,
  settings: Settings,
): Promise<{ markdown: string; title?: string; summary?: string } | null> {
  let localBestEffort: {
    markdown: string;
    title?: string;
    summary?: string;
  } | null = null;

  try {
    console.log(`[FlowSearch] fetchPageContent starting for: ${url}`);
    
    // --- 策略 0: GitHub 专用 API 提取 ---
    const isGithub = url.includes('github.com');
    if (isGithub && settings.githubToken) {
      // 更加鲁棒的正则解析 owner/repo
      const match = url.match(/github\.com\/([^/]+)\/([^/]+)/);
      if (match) {
        const owner = match[1];
        const repo = match[2].replace(/\/$/, ""); // 移除末尾斜杠
        
        console.log(`[FlowSearch] Strategy 0: GitHub API target identified: ${owner}/${repo}`);
        
        try {
          const readme = await fetchRepoReadme(settings.githubToken, owner, repo);
          if (readme && readme.length > 10) {
            console.log(`[FlowSearch] Strategy 0: GitHub README fetch success (${readme.length} chars)`);
            return {
              markdown: readme,
              title: `${owner}/${repo}`,
              summary: readme.slice(0, 500)
            };
          } else {
            console.warn(`[FlowSearch] Strategy 0: GitHub README empty or too short, trying fallback`);
          }
        } catch (ghError) {
          console.error(`[FlowSearch] Strategy 0: GitHub API README request failed:`, ghError);
        }
      }
    }

    // 策略 1: 检查活跃标签页 (利用已登录的权限)
    const tabs = await browser.tabs.query({ url });
    for (const tab of tabs) {
      if (tab.id) {
        try {
          const result = await browser.tabs.sendMessage(tab.id, {
            type: "EXTRACT_CONTENT",
          });
          if (result && result.success) {
            console.log(`[indexer] Strategy 1: Active tab success: ${url}`);
            return {
              markdown: result.markdown,
              title: result.title,
              summary: result.excerpt,
            };
          }
        } catch (e) {
          console.debug(`[indexer] Tab extraction failed for ${url}`);
        }
      }
    }

    // 策略 2: 后台本地 Fetch + Readability (via linkedom)
    try {
      console.log(`[indexer] Strategy 2: Attempting local fetch for ${url}`);
      const response = await fetch(url, {
        signal: AbortSignal.timeout(5000),
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        },
      });

      if (response.ok) {
        const html = await response.text();
        const { document } = parseHTML(html);

        // 尝试提取元数据作为兜底
        const metaDescription =
          document
            .querySelector('meta[name="description"]')
            ?.getAttribute("content") ||
          document
            .querySelector('meta[property="og:description"]')
            ?.getAttribute("content");

        const reader = new Readability(document as unknown as Document);
        const article = reader.parse();

        if (article && article.content) {
          const turndown = new TurndownService({
            headingStyle: "atx",
            codeBlockStyle: "fenced",
          });
          const markdown = `# ${article.title}\n\n${turndown.turndown(article.content)}`;

          localBestEffort = {
            markdown,
            title: article.title ?? undefined,
            summary: article.excerpt || metaDescription || "",
          };

          const textLen = article.textContent?.length ?? 0;
          if (textLen > 150) {
            console.log(
              `[indexer] Strategy 2: High quality local extraction (${textLen} chars)`,
            );
            return localBestEffort;
          }
          console.log(
            `[indexer] Strategy 2: Local extraction successful but short (${textLen} chars), will try Jina as backup`,
          );
        }
      }
    } catch (e) {
      console.debug(`[indexer] Strategy 2: Local fetch failed:`, e);
    }

    // 策略 3: 回退到 Jina Reader (r.jina.ai)
    try {
      console.log(`[indexer] Strategy 3: Requesting Jina Reader for ${url}`);
      const readerUrl = `https://r.jina.ai/${encodeURIComponent(url)}`;
      const jinaResponse = await fetch(readerUrl, {
        headers: { Accept: "text/markdown" },
        signal: AbortSignal.timeout(8000),
      });

      if (jinaResponse.ok) {
        const markdown = await jinaResponse.text();
        const { title, summary } = extractFromMarkdown(markdown, "");
        console.log(`[indexer] Strategy 3: Jina Reader success`);
        return { markdown, title, summary };
      }
    } catch (e) {
      console.warn(`[indexer] Strategy 3: Jina Reader failed:`, e);
    }

    // 最终兜底：如果 Jina 失败了，但我们有本地的 Best Effort 结果，就用它
    if (localBestEffort) {
      console.log(`[indexer] Using local best-effort result as final fallback`);
      return localBestEffort;
    }

    return null;
  } catch (error) {
    console.warn(`[indexer] fetchPageContent failed for ${url}:`, error);
    return null;
  }
}

/**
 * 处理单个书签索引
 */
async function indexBookmark(
  job: IndexJob,
  settings: Settings,
): Promise<{ success: boolean; error?: string }> {
  if (!settings.openaiApiKey) {
    return { success: false, error: "No API key configured" };
  }

  try {
    // 1. 根据优先级策略获取网页内容
    const pageContent = await fetchPageContent(job.url, settings);

    const title = pageContent?.title || job.title;
    const summary = pageContent?.summary || "";
    const textToEmbed = pageContent ? `${title}\n${summary}` : job.title;

    const { embedding } = await getEmbedding(
      textToEmbed,
      settings.openaiApiKey,
    );

    // 3. 更新数据库
    const record: BookmarkRecord = {
      id: job.bookmarkId,
      url: job.url,
      title: title,
      summary: summary,
      embedding,
      status: "indexed",
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
 * 计算下一个延迟
 */
function calculateDelay(): number {
  return Math.min(
    Math.max(RATE_LIMIT_CONFIG.currentDelay, RATE_LIMIT_CONFIG.minDelay),
    RATE_LIMIT_CONFIG.maxDelay,
  );
}

/**
 * 请求成功，逐渐加速
 */
function onSuccess(): void {
  RATE_LIMIT_CONFIG.consecutiveSuccesses++;

  if (
    RATE_LIMIT_CONFIG.consecutiveSuccesses >= RATE_LIMIT_CONFIG.successThreshold
  ) {
    // 连续成功多次，可以加速
    RATE_LIMIT_CONFIG.currentDelay = Math.max(
      RATE_LIMIT_CONFIG.minDelay,
      RATE_LIMIT_CONFIG.currentDelay * RATE_LIMIT_CONFIG.recoveryMultiplier,
    );
    RATE_LIMIT_CONFIG.consecutiveSuccesses = 0;
  }
}

/**
 * 遇到限流错误，指数退避
 */
function onRateLimit(): void {
  RATE_LIMIT_CONFIG.currentDelay = Math.min(
    RATE_LIMIT_CONFIG.maxDelay,
    RATE_LIMIT_CONFIG.currentDelay * RATE_LIMIT_CONFIG.backoffMultiplier,
  );
  RATE_LIMIT_CONFIG.consecutiveSuccesses = 0;
  console.warn(
    `[indexer] Rate limit detected, increasing delay to ${RATE_LIMIT_CONFIG.currentDelay}ms`,
  );
}

/**
 * 检查是否是限流错误
 */
function isRateLimitError(error: string): boolean {
  return (
    error.includes("429") ||
    error.includes("rate limit") ||
    error.includes("too many requests") ||
    error.includes("quota")
  );
}

/**
 * 处理索引队列
 */
const CONCURRENCY = 3;

async function processQueue(): Promise<void> {
  if (isProcessing || queue.length === 0) return;

  isProcessing = true;
  totalToProcess = queue.length;
  processedCount = 0;

  const settings = await getSettings();

  if (!settings.openaiApiKey) {
    console.warn("[indexer] No API key, skipping queue processing");
    isProcessing = false;
    notifyProgress({
      total: 0,
      processed: 0,
      status: "error",
      error: "No API key configured",
    });
    return;
  }

  console.log(`[indexer] Processing ${totalToProcess} items with ${CONCURRENCY} workers`);
  notifyProgress({ total: totalToProcess, processed: 0, status: "processing" });

  async function worker(): Promise<void> {
    while (true) {
      if (isPaused) {
        notifyProgress({
          total: totalToProcess,
          processed: processedCount,
          status: "paused",
        });
        return;
      }

      const job = queue.shift();
      if (!job) break;

      notifyProgress({
        total: totalToProcess,
        processed: processedCount,
        current: job.url,
        status: "processing",
      });

      const result = await indexBookmark(job, settings);
      processedCount++;

      if (!result.success) {
        const errorMessage = result.error || "";
        console.warn(`[indexer] Failed to index ${job.url}:`, errorMessage);

        if (isRateLimitError(errorMessage)) {
          onRateLimit();
          queue.unshift({ ...job, retryCount: job.retryCount + 1 });
          const delay = calculateDelay();
          await new Promise((resolve) => setTimeout(resolve, delay));
          continue;
        }

        if (job.retryCount < MAX_RETRIES) {
          queue.push({ ...job, retryCount: job.retryCount + 1 });
          totalToProcess++;
        } else {
          await updateBookmark(job.bookmarkId, {
            status: "failed",
            error: result.error,
          });
        }
      } else {
        console.log(`[indexer] Indexed: ${job.url}`);
        onSuccess();
      }

      notifyProgress({
        total: totalToProcess,
        processed: processedCount,
        status: "processing",
      });

      const delay = calculateDelay();
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));

  isProcessing = false;

  if (isPaused) return;

  console.log("[indexer] Queue processing complete");
  notifyProgress({
    total: totalToProcess,
    processed: processedCount,
    status: "complete",
  });
  browser.runtime.sendMessage({ type: "INDEXING_COMPLETE" }).catch(() => {});
}

/**
 * 添加书签到索引队列 (增量索引)
 * 检查是否已索引，避免重复处理
 */
export async function enqueueBookmark(bookmark: {
  id: string;
  url: string;
  title: string;
}): Promise<boolean> {
  // 检查是否已在队列中
  const existsInQueue = queue.some((j) => j.url === bookmark.url);
  if (existsInQueue) return false;

  // 检查是否已索引
  const indexedUrls = await getIndexedUrls([bookmark.url]);
  if (indexedUrls.has(bookmark.url)) {
    console.log(`[indexer] Skip already indexed: ${bookmark.url}`);
    return false;
  }

  queue.push({
    bookmarkId: bookmark.id,
    url: bookmark.url,
    title: bookmark.title,
    retryCount: 0,
  });

  // 触发队列处理
  processQueue();
  return true;
}

/**
 * 批量添加书签到队列 (增量索引)
 * 自动过滤已索引的书签
 */
export async function enqueueBookmarks(
  bookmarks: Array<{ id: string; url: string; title: string }>,
): Promise<number> {
  if (bookmarks.length === 0) return 0;

  // 批量查询已索引的 URL
  const urls = bookmarks.map((b) => b.url);
  const indexedUrls = await getIndexedUrls(urls);

  // 过滤出未索引的书签
  const toIndex = bookmarks.filter((b) => !indexedUrls.has(b.url));

  // 过滤已在队列中的
  const queuedUrls = new Set(queue.map((j) => j.url));
  const newBookmarks = toIndex.filter((b) => !queuedUrls.has(b.url));

  // 加入队列
  for (const bookmark of newBookmarks) {
    queue.push({
      bookmarkId: bookmark.id,
      url: bookmark.url,
      title: bookmark.title,
      retryCount: 0,
    });
  }

  console.log(
    `[indexer] ${bookmarks.length} total, ${indexedUrls.size} indexed, ${newBookmarks.length} to queue`,
  );

  // 触发队列处理
  if (newBookmarks.length > 0) {
    processQueue();
  }

  return newBookmarks.length;
}

/**
 * 获取索引状态
 */
export function getIndexingStatus(): {
  queueLength: number;
  isProcessing: boolean;
  isPaused: boolean;
  progress: IndexingProgress | null;
} {
  return {
    queueLength: queue.length,
    isProcessing,
    isPaused,
    progress: isProcessing
      ? {
          total: totalToProcess,
          processed: processedCount,
          status: isPaused ? "paused" : "processing",
        }
      : null,
  };
}

/** 暂停索引 */
export function pauseIndexing(): void {
  if (isProcessing) {
    isPaused = true;
    console.log("[indexer] Pause requested");
  }
}

/** 恢复索引 */
export function resumeIndexing(): void {
  if (isPaused) {
    isPaused = false;
    console.log("[indexer] Resuming indexing");
    processQueue();
  }
}

/**
 * 获取所有书签文件夹（树形结构）
 */
export async function getBookmarkFolders(): Promise<
  Array<{ id: string; title: string; path: string; children?: any[] }>
> {
  const allBookmarks = await browser.bookmarks.getTree();
  const folders: Array<{
    id: string;
    title: string;
    path: string;
    children?: any[];
  }> = [];

  type BookmarkNode = {
    id: string;
    title?: string;
    url?: string;
    children?: BookmarkNode[];
  };

  function buildTree(
    nodes: BookmarkNode[],
    parentPath: string = "",
  ): Array<{ id: string; title: string; path: string; children?: any[] }> {
    const result: Array<{
      id: string;
      title: string;
      path: string;
      children?: any[];
    }> = [];

    for (const node of nodes) {
      // 如果是文件夹（有 children 且没有 url）
      if (node.children && !node.url) {
        const title = node.title || "根目录";
        const currentPath = parentPath ? `${parentPath}/${title}` : title;

        const folderItem: {
          id: string;
          title: string;
          path: string;
          children?: any[];
        } = {
          id: node.id,
          title: title,
          path: currentPath,
        };

        // 递归处理子文件夹
        const childFolders = buildTree(node.children, currentPath);
        if (childFolders.length > 0) {
          folderItem.children = childFolders;
        }

        result.push(folderItem);
      }
    }

    return result;
  }

  // 从根节点开始构建树
  folders.push(...buildTree(allBookmarks));

  console.log(
    `[indexer] Built folder tree with ${folders.length} root folders`,
  );
  return folders;
}

/**
 * 索引指定文件夹的书签
 */
export async function indexFolders(
  folderIds: string[],
): Promise<{ total: number; skipped: number; queued: number }> {
  const allBookmarks = await browser.bookmarks.getTree();
  const flatBookmarks: Array<{ id: string; url: string; title: string }> = [];

  // 如果没有选中任何文件夹，直接返回（交由 indexAllBookmarks 处理或提示）
  if (folderIds.length === 0) {
    return { total: 0, skipped: 0, queued: 0 };
  }

  type BookmarkNode = {
    id: string;
    title?: string;
    url?: string;
    children?: BookmarkNode[];
  };

  /**
   * 递归遍历：如果当前节点在 folderIds 中，则收集其下所有书签
   * 如果当前节点不在，但其祖先在，也收集（由 collect 参数控制）
   */
  function traverse(nodes: BookmarkNode[], collect: boolean = false) {
    for (const node of nodes) {
      // 当前节点被选中，或者父辈已被选中
      const isSelected = folderIds.includes(node.id);
      const shouldCollect = collect || isSelected;

      if (node.url && shouldCollect) {
        flatBookmarks.push({
          id: node.id,
          url: node.url,
          title: node.title || "",
        });
      }

      if (node.children) {
        // 递归处理子节点，如果当前节点已选中，子节点全部 collect=true
        traverse(node.children, shouldCollect);
      }
    }
  }

  traverse(allBookmarks);

  console.log(
    `[indexer] Selective Indexing: Found ${flatBookmarks.length} bookmarks in ${folderIds.length} target folders`,
  );

  // 执行增量索引：过滤掉已存在且状态为 indexed 的
  const queued = await enqueueBookmarks(flatBookmarks);

  return {
    total: flatBookmarks.length,
    skipped: flatBookmarks.length - queued,
    queued,
  };
}

/**
 * 增量索引：只索引新增或未索引的书签
 */
export async function indexAllBookmarks(): Promise<{
  total: number;
  skipped: number;
  queued: number;
}> {
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
          title: node.title || "",
        });
      }
      if (node.children) {
        traverse(node.children);
      }
    }
  }

  traverse(allBookmarks);

  console.log(`[indexer] Found ${flatBookmarks.length} bookmarks total`);

  // 增量索引：自动过滤已索引的书签
  const queued = await enqueueBookmarks(flatBookmarks);

  return {
    total: flatBookmarks.length,
    skipped: flatBookmarks.length - queued,
    queued,
  };
}

/**
 * 重新索引失败的书签
 */
export async function retryFailed(): Promise<number> {
  const failedRecords = await getFailedBookmarks();
  console.log(`[indexer] Retrying ${failedRecords.length} failed bookmarks`);

  if (failedRecords.length === 0) return 0;

  // 将失败状态重置为 pending，然后加入队列
  const toRetry = failedRecords.map((r) => ({
    id: r.id,
    url: r.url,
    title: r.title,
  }));

  // 批量更新状态为 pending
  await db.bookmarks
    .where("status")
    .equals("failed")
    .modify({ status: "pending" });

  // 加入队列
  for (const bookmark of toRetry) {
    queue.push({
      bookmarkId: bookmark.id,
      url: bookmark.url,
      title: bookmark.title,
      retryCount: 0,
    });
  }

  processQueue();
  return toRetry.length;
}

/**
 * 初始化：监听书签变更
 */
export function initIndexer(): void {
  // 新增书签
  browser.bookmarks.onCreated.addListener((id, bookmark) => {
    if (bookmark.url) {
      // 异步入队，不等待结果
      enqueueBookmark({
        id: bookmark.id,
        url: bookmark.url,
        title: bookmark.title || "",
      });
    }
  });

  // 书签更新
  browser.bookmarks.onChanged.addListener((id, changeInfo) => {
    if (changeInfo.url) {
      enqueueBookmark({
        id,
        url: changeInfo.url,
        title: changeInfo.title || "",
      });
    }
  });

  // 书签删除
  browser.bookmarks.onRemoved.addListener(async (id) => {
    const { deleteBookmark } = await import("./db");
    await deleteBookmark(id);
  });

  console.log("[indexer] Initialized");
}
