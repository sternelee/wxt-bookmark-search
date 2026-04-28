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
import { generateDeepContent } from "./llm";

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

/** 自适应限流器 */
class RateLimiter {
  private currentDelay: number;
  private consecutiveSuccesses = 0;

  constructor(
    private readonly name: string,
    private readonly config: {
      minDelay: number;
      maxDelay: number;
      baseDelay: number;
      backoffMultiplier: number;
      recoveryMultiplier: number;
      successThreshold: number;
    },
  ) {
    this.currentDelay = config.baseDelay;
  }

  getDelay(): number {
    return Math.min(
      Math.max(this.currentDelay, this.config.minDelay),
      this.config.maxDelay,
    );
  }

  onSuccess(): void {
    this.consecutiveSuccesses++;
    if (this.consecutiveSuccesses >= this.config.successThreshold) {
      this.currentDelay = Math.max(
        this.config.minDelay,
        this.currentDelay * this.config.recoveryMultiplier,
      );
      this.consecutiveSuccesses = 0;
    }
  }

  onRateLimit(): void {
    this.currentDelay = Math.min(
      this.config.maxDelay,
      this.currentDelay * this.config.backoffMultiplier,
    );
    this.consecutiveSuccesses = 0;
    console.warn(
      `[indexer] [${this.name}] Rate limit, delay → ${this.currentDelay}ms`,
    );
  }
}

const RATE_LIMITER_DEFAULTS = {
  minDelay: 200,
  maxDelay: 10000,
  baseDelay: 500,
  backoffMultiplier: 2,
  recoveryMultiplier: 0.9,
  successThreshold: 5,
};

/** 各端点独立限流器，避免某端点 429 拖累其他请求 */
const embeddingLimiter = new RateLimiter("embedding", RATE_LIMITER_DEFAULTS);
const jinaLimiter = new RateLimiter("jina", {
  ...RATE_LIMITER_DEFAULTS,
  minDelay: 500,
});
const githubLimiter = new RateLimiter("github", {
  ...RATE_LIMITER_DEFAULTS,
  maxDelay: 30000,
});

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
 * 跳过代码块、表格分隔符、图片、徽章行，清理 Markdown 格式符号
 */
function extractFromMarkdown(
  markdown: string,
  fallbackTitle: string,
): { title: string; summary: string } {
  const lines = markdown.split("\n");

  let title = fallbackTitle;
  let titleFound = false;
  let inCodeBlock = false;
  const contentLines: string[] = [];

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();

    // 跟踪代码围栏状态
    if (/^[`~]{3}/.test(line)) {
      inCodeBlock = !inCodeBlock;
      continue;
    }
    if (inCodeBlock) continue;

    const trimmed = line.trim();
    if (!trimmed) continue;

    // 提取第一个 H1 作为标题
    if (!titleFound && trimmed.startsWith("# ")) {
      title = trimmed.slice(2).trim();
      titleFound = true;
      continue;
    }

    // 跳过其他标题行
    if (/^#{1,6}\s/.test(trimmed)) continue;
    // 跳过表格分隔符行 (|---|---|)
    if (/^\|[-| :]+\|/.test(trimmed)) continue;
    // 跳过图片行
    if (/^!\[.*?\]\(.*?\)/.test(trimmed)) continue;
    // 跳过徽章行 (shield.io 等)
    if (/^\[!\[/.test(trimmed)) continue;

    // 清理 Markdown 格式符号
    const cleaned = trimmed
      .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1") // 链接 → 纯文本
      .replace(/[*_`~]{1,2}([^*_`~\n]+?)[*_`~]{1,2}/g, "$1") // 粗体/斜体/行内代码
      .replace(/^\s*[-*+]\s+/, "") // 无序列表
      .replace(/^\s*\d+\.\s+/, "") // 有序列表
      .replace(/^>\s*/, "") // 引用块
      .trim();

    if (cleaned.length > 10) {
      contentLines.push(cleaned);
      if (contentLines.length >= 10) break;
    }
  }

  const summary = contentLines.join(" ").slice(0, 1000);
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

const ENRICHMENT_QUEUE_KEY = "enrichment_queue";
const ENRICHMENT_QUEUE_VERSION = 1;
const enrichmentQueue: EnrichmentJob[] = [];
let isEnriching = false;

/** 持久化 enrichment 队列到 storage（带版本号和去重） */
async function persistEnrichmentQueue(): Promise<void> {
  try {
    // 按 URL 去重后再持久化
    const seen = new Set<string>();
    const deduped = enrichmentQueue.filter((job) => {
      if (seen.has(job.url)) return false;
      seen.add(job.url);
      return true;
    });
    await browser.storage.local.set({
      [ENRICHMENT_QUEUE_KEY]: {
        version: ENRICHMENT_QUEUE_VERSION,
        jobs: deduped,
      },
    });
  } catch (err) {
    console.warn("[indexer] Failed to persist enrichment queue:", err);
  }
}

/** 从 storage 恢复 enrichment 队列 */
async function restoreEnrichmentQueue(): Promise<void> {
  try {
    const data = await browser.storage.local.get(ENRICHMENT_QUEUE_KEY);
    const stored = data[ENRICHMENT_QUEUE_KEY] as any;
    if (!stored) return;

    let jobs: EnrichmentJob[];
    if (Array.isArray(stored)) {
      // 旧格式兼容
      jobs = stored as EnrichmentJob[];
    } else if (
      stored &&
      stored.version === ENRICHMENT_QUEUE_VERSION &&
      Array.isArray(stored.jobs)
    ) {
      jobs = stored.jobs as EnrichmentJob[];
    } else {
      console.warn("[indexer] Unknown enrichment queue format, discarding");
      return;
    }

    enrichmentQueue.length = 0;
    enrichmentQueue.push(...jobs);
    console.log(
      `[indexer] Restored ${jobs.length} enrichment jobs from storage`,
    );
  } catch (err) {
    console.warn("[indexer] Failed to restore enrichment queue:", err);
  }
}

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
    await persistEnrichmentQueue(); // 持久化队列状态

    try {
      const readme = await fetchRepoReadme(job.token, job.owner, job.repo);
      if (readme && readme.length > 10) {
        const textToEmbed = `${job.owner}/${job.repo}\n${readme.slice(0, 2000)}`;
        const { embedding } = await getEmbedding(
          textToEmbed,
          settings.openaiApiKey!,
          undefined,
          settings.embeddingModel,
          settings.baseURL,
        );
        await updateBookmark(job.bookmarkId, {
          summary: readme.slice(0, 500),
          embedding,
          needsEnrichment: false,
          indexedAt: Date.now(),
        });
        console.log(`[indexer] Enriched: ${job.owner}/${job.repo}`);
      }
    } catch (err) {
      console.warn(
        `[indexer] Enrichment failed for ${job.owner}/${job.repo}:`,
        err,
      );
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

  await fetchAllStarredRepos(
    settings.githubToken,
    async (pageRepos) => {
      totalCount += pageRepos.length;

      // 快速路径：用 description + language 立即批量 embed
      const texts = pageRepos.map(
        (r) =>
          `${r.full_name}\n${r.description || ""} (Main language: ${r.language || "Unknown"})`,
      );

      let embeddings: number[][] = [];
      try {
        embeddings = await batchEmbedTexts(
          texts,
          settings.openaiApiKey!,
          settings.embeddingModel,
          settings.baseURL,
        );
      } catch (err) {
        console.warn(
          "[FlowSearch] Batch embed failed, falling back to title-only:",
          err,
        );
        // 批量失败时 embeddings 保持空数组，写入 pending 状态等主队列处理
      }

      const records: BookmarkRecord[] = pageRepos.map(
        (repo, i) =>
          ({
            id: `gh-${repo.id}`,
            url: repo.html_url,
            title: repo.full_name,
            summary: `${repo.description || ""} (Main language: ${repo.language || "Unknown"})`,
            embedding: embeddings[i],
            status: embeddings[i] ? "indexed" : "pending",
            indexedAt: embeddings[i] ? Date.now() : undefined,
            needsEnrichment: !!embeddings[i],
          }) as BookmarkRecord,
      );

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
      await persistEnrichmentQueue(); // 持久化队列

      // 未能 embed 的 fallback 到主队列
      const failedJobs = records
        .filter((r) => r.status === "pending")
        .map((r) => ({
          bookmarkId: r.id,
          url: r.url,
          title: r.title,
          retryCount: 0,
        }));
      if (failedJobs.length > 0) {
        queue.push(...failedJobs);
        processQueue();
      }

      console.log(
        `[FlowSearch] Fast-path: ${records.filter((r) => r.status === "indexed").length}/${records.length} embedded instantly`,
      );
    },
    undefined,
    async (pageRepos) => {
      // 增量同步：如果当前页所有 URL 都已索引，则停止
      const urls = pageRepos.map((r) => r.html_url);
      const indexedUrls = await getIndexedUrls(urls);
      return urls.every((u) => indexedUrls.has(u));
    },
  );

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
  try {
    console.log(`[FlowSearch] fetchPageContent starting for: ${url}`);

    // --- 策略 0: GitHub 专用 API 提取 ---
    const isGithub = url.includes("github.com");
    if (isGithub && settings.githubToken) {
      const match = url.match(/github\.com\/([^/]+)\/([^/]+)/);
      if (match) {
        const owner = match[1];
        const repo = match[2].replace(/\/$/, "");
        try {
          const readme = await fetchRepoReadme(
            settings.githubToken,
            owner,
            repo,
          );
          if (readme && readme.length > 10) {
            return {
              markdown: readme,
              title: `${owner}/${repo}`,
              summary: readme.slice(0, 500),
            };
          }
        } catch (ghError) {
          console.error(
            `[FlowSearch] Strategy 0: GitHub API README request failed:`,
            ghError,
          );
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

    // 策略 2 和 3 并行执行：本地 Fetch + Jina Reader
    const localPromise = (async () => {
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
            const { document: contentDoc } = parseHTML(article.content);
            const markdown = `# ${article.title}\n\n${turndown.turndown(contentDoc.body as unknown as HTMLElement)}`;

            const content = {
              markdown,
              title: article.title ?? undefined,
              summary: article.excerpt || metaDescription || "",
            };

            const textLen = article.textContent?.length ?? 0;
            const isHighQuality = textLen > 150;
            console.log(
              `[indexer] Strategy 2: Local extraction ${isHighQuality ? "high quality" : "short"} (${textLen} chars)`,
            );
            return { content, isHighQuality };
          }
        }
      } catch (e) {
        console.debug(`[indexer] Strategy 2: Local fetch failed:`, e);
      }
      return null;
    })();

    const jinaPromise = (async () => {
      try {
        console.log(`[indexer] Strategy 3: Requesting Jina Reader for ${url}`);
        const readerUrl = `https://r.jina.ai/${encodeURIComponent(url)}`;
        const jinaResponse = await fetch(readerUrl, {
          headers: { Accept: "text/markdown" },
          signal: AbortSignal.timeout(8000),
        });

        if (jinaResponse.status === 429) {
          jinaLimiter.onRateLimit();
        } else if (jinaResponse.ok) {
          jinaLimiter.onSuccess();
          const markdown = await jinaResponse.text();
          const { title, summary } = extractFromMarkdown(markdown, "");
          console.log(`[indexer] Strategy 3: Jina Reader success`);
          return { markdown, title, summary };
        }
      } catch (e) {
        console.warn(`[indexer] Strategy 3: Jina Reader failed:`, e);
      }
      return null;
    })();

    // 先等本地结果；高质量则直接返回
    const localResult = await localPromise;
    if (localResult && localResult.isHighQuality) {
      return localResult.content;
    }

    // 本地不够高或失败，等 Jina
    const jinaResult = await jinaPromise;
    if (jinaResult) {
      return jinaResult;
    }

    // 最终兜底：回退到本地 best-effort
    if (localResult) {
      console.log(`[indexer] Using local best-effort result as final fallback`);
      return localResult.content;
    }

    return null;
  } catch (error) {
    console.warn(`[indexer] fetchPageContent failed for ${url}:`, error);
    return null;
  }
}

/**
 * 计算下一个延迟
 */
function calculateDelay(): number {
  return embeddingLimiter.getDelay();
}

/**
 * 请求成功，逐渐加速
 */
function onSuccess(): void {
  embeddingLimiter.onSuccess();
}

/**
 * 遇到限流错误，指数退避
 */
function onRateLimit(): void {
  embeddingLimiter.onRateLimit();
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
 * 处理索引队列 — 批量优化版本
 */
const BATCH_SIZE = 10; // 每批处理 10 个书签

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

  console.log(
    `[indexer] Processing ${totalToProcess} items with batch size ${BATCH_SIZE}`,
  );
  notifyProgress({ total: totalToProcess, processed: 0, status: "processing" });

  while (queue.length > 0) {
    if (isPaused) {
      notifyProgress({
        total: totalToProcess,
        processed: processedCount,
        status: "paused",
      });
      return;
    }

    // 1. 取出一批任务
    const batch = queue.splice(0, BATCH_SIZE);

    // 从持久化队列中删除
    try {
      await db.indexQueue.bulkDelete(batch.map((j) => j.bookmarkId));
    } catch (err) {
      console.warn("[indexer] Failed to remove queued items from DB:", err);
    }

    notifyProgress({
      total: totalToProcess,
      processed: processedCount,
      current: batch[0]?.url,
      status: "processing",
    });

    // 2. 并发提取内容（IO 密集型）
    const contents = await Promise.all(
      batch.map(async (job) => {
        try {
          const content = await fetchPageContent(job.url, settings);
          let text: string;
          let summary = content?.summary || "";
          let tags: string[] = [];

          // LLM 增强（如果启用且有足够内容）
          if (
            settings.enableLLMEnrichment &&
            content?.markdown &&
            content.markdown.length > 100
          ) {
            try {
              const llmResult = await generateDeepContent(
                content.markdown.slice(0, 4000),
                settings.openaiApiKey!,
                settings.llmModel,
                settings.baseURL,
              );
              summary = llmResult.summary;
              tags = llmResult.tags;
              // 向量化文本：标题 + 摘要 + 标签
              text = `${content.title || job.title}\n${summary}\n${tags.join(" ")}`;
            } catch (llmError) {
              console.warn(
                `[indexer] LLM enhancement failed for ${job.url}:`,
                llmError,
              );
              // 降级：使用原始摘要
              text = content
                ? `${content.title || job.title}\n${summary}`
                : job.title;
            }
          } else {
            text = content
              ? `${content.title || job.title}\n${summary}`
              : job.title;
          }

          return {
            job,
            content,
            text,
            summary,
            tags,
            llmEnhanced: tags.length > 0,
          };
        } catch (error) {
          console.warn(
            `[indexer] Failed to fetch content for ${job.url}:`,
            error,
          );
          return {
            job,
            content: null,
            text: job.title,
            summary: "",
            tags: [],
            llmEnhanced: false,
          };
        }
      }),
    );

    // 3. 批量嵌入（单次 API 调用）
    const texts = contents.map((c) => c.text);
    let embeddings: number[][];

    try {
      embeddings = await batchEmbedTexts(
        texts,
        settings.openaiApiKey,
        settings.embeddingModel,
        settings.baseURL,
      );
      onSuccess(); // 成功则加速
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      console.warn("[indexer] Batch embed failed:", errorMessage);

      if (isRateLimitError(errorMessage)) {
        onRateLimit();
        // 失败的任务重新入队
        for (const { job } of contents) {
          if (job.retryCount < MAX_RETRIES) {
            queue.unshift({ ...job, retryCount: job.retryCount + 1 });
            totalToProcess++;
          } else {
            await updateBookmark(job.bookmarkId, {
              status: "failed",
              error: errorMessage,
            });
          }
        }

        const delay = calculateDelay();
        await new Promise((resolve) => setTimeout(resolve, delay));
        continue;
      }

      // 非限流错误，标记失败
      for (const { job } of contents) {
        if (job.retryCount < MAX_RETRIES) {
          queue.push({ ...job, retryCount: job.retryCount + 1 });
          totalToProcess++;
        } else {
          await updateBookmark(job.bookmarkId, {
            status: "failed",
            error: errorMessage,
          });
        }
      }

      processedCount += batch.length;
      continue;
    }

    // 4. 批量写入 DB
    const records: BookmarkRecord[] = contents.map(
      ({ job, content, summary, tags, llmEnhanced }, i) => ({
        id: job.bookmarkId,
        url: job.url,
        title: content?.title || job.title,
        summary,
        tags,
        embedding: embeddings[i],
        status: "indexed" as const,
        indexedAt: Date.now(),
        llmEnhanced,
      }),
    );

    try {
      await upsertBookmarks(records);
      console.log(`[indexer] Batch indexed: ${batch.length} items`);
      processedCount += batch.length;

      notifyProgress({
        total: totalToProcess,
        processed: processedCount,
        status: "processing",
      });
    } catch (error) {
      console.error("[indexer] Failed to upsert batch:", error);
      // 写入失败，重新入队
      for (const { job } of contents) {
        if (job.retryCount < MAX_RETRIES) {
          queue.push({ ...job, retryCount: job.retryCount + 1 });
          totalToProcess++;
        } else {
          await updateBookmark(job.bookmarkId, {
            status: "failed",
            error: "Database write failed",
          });
        }
      }
    }

    // 限流延迟
    const delay = calculateDelay();
    await new Promise((resolve) => setTimeout(resolve, delay));
  }

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

  // 持久化到 IndexedDB
  try {
    await db.indexQueue.put({
      bookmarkId: bookmark.id,
      url: bookmark.url,
      title: bookmark.title,
      retryCount: 0,
      enqueuedAt: Date.now(),
    });
  } catch (err) {
    console.warn("[indexer] Failed to persist queue item:", err);
  }

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

  // 持久化到 IndexedDB
  if (newBookmarks.length > 0) {
    try {
      await db.indexQueue.bulkPut(
        newBookmarks.map((b) => ({
          bookmarkId: b.id,
          url: b.url,
          title: b.title,
          retryCount: 0,
          enqueuedAt: Date.now(),
        })),
      );
    } catch (err) {
      console.warn("[indexer] Failed to persist queue batch:", err);
    }
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
export async function initIndexer(): Promise<void> {
  // === 恢复索引队列 ===
  try {
    const persistedQueue = await db.indexQueue.toArray();
    for (const item of persistedQueue) {
      if (!queue.some((j) => j.bookmarkId === item.bookmarkId)) {
        queue.push({
          bookmarkId: item.bookmarkId,
          url: item.url,
          title: item.title,
          retryCount: item.retryCount,
        });
      }
    }
    if (persistedQueue.length > 0) {
      console.log(
        `[indexer] Restored ${persistedQueue.length} items from persistent queue`,
      );
      processQueue();
    }
  } catch (err) {
    console.warn("[indexer] Failed to restore persistent queue:", err);
  }

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

  // === 恢复 enrichment 队列 ===
  const settings = await getSettings();
  if (settings.githubToken && settings.openaiApiKey) {
    // 1. 先从 storage 恢复队列
    await restoreEnrichmentQueue();

    // 2. 从 DB 中恢复需要 enrichment 的记录（避免重复）
    try {
      const needsEnrich = await db.bookmarks
        .filter((r) => r.needsEnrichment === true)
        .toArray();

      let addedCount = 0;
      for (const record of needsEnrich) {
        // 检查是否已存在
        if (enrichmentQueue.some((j) => j.bookmarkId === record.id)) continue;

        const match = record.url.match(/github\.com\/([^/]+)\/([^/]+)/);
        if (match) {
          enrichmentQueue.push({
            bookmarkId: record.id,
            url: record.url,
            owner: match[1],
            repo: match[2],
            token: settings.githubToken!,
          });
          addedCount++;
        }
      }

      if (addedCount > 0) {
        await persistEnrichmentQueue();
        console.log(`[indexer] Added ${addedCount} enrichment jobs from DB`);
      }

      if (enrichmentQueue.length > 0) {
        console.log(
          `[indexer] Total ${enrichmentQueue.length} enrichment jobs ready`,
        );
        processEnrichmentQueue().catch(() => {});
      }
    } catch (err) {
      console.warn(
        "[indexer] Failed to restore enrichment queue from DB:",
        err,
      );
    }
  }

  console.log("[indexer] Initialized");
}

/**
 * 同步 Twitter/X 书签
 */
export async function syncTwitterBookmarks(): Promise<{
  total: number;
  queued: number;
  error?: string;
}> {
  const settings = await getSettings();
  if (!settings.openaiApiKey) {
    throw new Error("API Key 未配置");
  }

  // 动态导入 Twitter 相关模块
  const { extractTwitterCookies } = await import("./twitter-cookies");
  const { fetchTwitterBookmarks, convertToBookmarkRecord } =
    await import("./twitter");

  // 1. 尝试自动提取 cookies
  let cookies = await extractTwitterCookies();

  // 2. 如果失败，使用手动输入的 cookies
  if (!cookies && settings.twitterCookies) {
    cookies = {
      ct0: settings.twitterCookies.ct0,
      authToken: settings.twitterCookies.authToken,
    };
  }

  if (!cookies) {
    throw new Error(
      "无法获取 Twitter cookies。请确保已在浏览器中登录 Twitter，或在设置中手动输入 cookies。",
    );
  }

  // 3. 同步书签
  let totalCount = 0;
  let cursor: string | undefined;
  const maxPages = 100;

  try {
    for (let page = 0; page < maxPages; page++) {
      const {
        bookmarks,
        cursor: nextCursor,
        hasMore,
      } = await fetchTwitterBookmarks({
        csrfToken: cookies.ct0,
        authToken: cookies.authToken,
        cursor,
      });

      if (bookmarks.length === 0) break;

      // 增量同步：检查是否已索引
      for (const bookmark of bookmarks) {
        const existing = await db.bookmarks.get(`tw-${bookmark.tweetId}`);
        if (existing?.status === "indexed") {
          console.log("[FlowSearch] 已到达已索引的书签，停止同步");
          await saveSettings({ lastTwitterSync: Date.now() });
          return { total: totalCount, queued: totalCount };
        }
      }

      // 快速路径：批量嵌入
      const texts = bookmarks.map((b) => {
        let text = `@${b.authorHandle || "unknown"}: ${b.text}`;
        if (b.quotedTweetText) {
          text += `\n\n引用: ${b.quotedTweetText}`;
        }
        return text;
      });

      // 尝试批量嵌入，失败时降级到单个嵌入
      let embeddings: (number[] | undefined)[] = new Array(texts.length);
      let batchFailed = false;

      try {
        embeddings = await batchEmbedTexts(
          texts,
          settings.openaiApiKey,
          settings.embeddingModel,
          settings.baseURL,
        );
      } catch (batchError) {
        console.warn(
          "[FlowSearch] Twitter batch embed failed, fallback to individual:",
          batchError,
        );
        batchFailed = true;

        // 降级策略：逐个嵌入（有缓存保护）
        for (let i = 0; i < texts.length; i++) {
          try {
            const { embedding } = await getEmbedding(
              texts[i],
              settings.openaiApiKey!,
              undefined,
              settings.embeddingModel,
              settings.baseURL,
            );
            embeddings[i] = embedding;
          } catch (err) {
            console.warn(
              `[FlowSearch] Failed to embed tweet ${bookmarks[i].tweetId}:`,
              err,
            );
            embeddings[i] = undefined;
          }
        }
      }

      const records: BookmarkRecord[] = bookmarks.map((bookmark, i) => {
        const record = convertToBookmarkRecord(bookmark, embeddings[i]);
        // 如果嵌入失败，标记为 pending 以便后续重试
        if (!embeddings[i]) {
          record.status = "pending";
        }
        return record;
      });

      await upsertBookmarks(records);
      totalCount += bookmarks.length;

      const successCount = records.filter((r) => r.status === "indexed").length;
      console.log(
        `[FlowSearch] Twitter page ${page + 1}: ${successCount}/${bookmarks.length} indexed ${batchFailed ? "(fallback mode)" : ""}`,
      );

      if (!hasMore) break;

      // 速率限制：600ms 延迟
      await new Promise((resolve) => setTimeout(resolve, 600));
      cursor = nextCursor;
    }
  } catch (error: any) {
    console.error("[FlowSearch] Twitter 同步失败:", error);
    if (error.message?.includes("401") || error.message?.includes("403")) {
      return {
        total: 0,
        queued: 0,
        error:
          "Cookie 已过期。请在浏览器中重新登录 Twitter，或手动输入新的 cookies。",
      };
    }
    throw error;
  }

  await saveSettings({ lastTwitterSync: Date.now() });
  return { total: totalCount, queued: totalCount };
}
