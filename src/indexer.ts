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
import { getLLMProvider } from "./ai-providers/llm-base";
import {
  upsertSearchEngineBatch,
  removeFromSearchEngine,
  scheduleSaveSearchEngine,
} from "./search-engine";

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
 * 对 GitHub README 进行 XML/HTML 噪声裁剪，保留 Markdown 结构
 * 裁剪顺序: HTML注释 → SVG块 → details/summary块 → 带布局属性HTML标签(剥离保留内文)
 *            → 剩余HTML标签 → Badge图片链接 → 纯URL行
 */
export function sanitizeReadme(raw: string): string {
  return (
    raw
      // 1. HTML 注释（badge 配置、隐藏元数据，无语义）
      .replace(/<!--[\s\S]*?-->/g, " ")
      // 2. SVG 整块（图标/图表 XML 原始数据）
      .replace(/<svg[\s\S]*?<\/svg>/gi, " ")
      // 3. <details>/<summary> 块（折叠内容，结构混乱）
      .replace(/<details[\s\S]*?<\/details>/gi, " ")
      // 4. 带布局属性的 HTML 标签 → 剥离标签保留内文
      .replace(
        /<([a-zA-Z][a-zA-Z0-9]*)\s[^>]*(align|width|height|style|class)[^>]*>([\s\S]*?)<\/\1>/gi,
        "$3",
      )
      // 5. 所有剩余 HTML/XML 标签 → 保留内文
      .replace(/<\/?[a-zA-Z][^>]*>/g, " ")
      // 6. Badge 图片链接 [![...](img)](url)（纯装饰，语义为零）
      .replace(/\[!\[[^\]]*\]\([^)]*\)\]\([^)]*\)/g, " ")
      // 7. 纯 URL 行（行内容仅为 URL，无描述上下文）
      .replace(/^https?:\/\/\S+$/gm, " ")
      // 合并多余空白行（最多保留两个连续换行）
      .replace(/\n{3,}/g, "\n\n")
      .trim()
  );
}

/**
 * 从 README 中提取结构化语义内容，用于 BGE-M3 向量化（最大利用 8192 token 窗口）
 * 流程: sanitizeReadme → 按H2/H3划分section → 语义分类 → 按配额填充 → 结构化文档
 * @param readme 原始 README 文本（Markdown 格式）
 * @returns 结构化纯文本，总长不超过 7500 字符
 */
export function extractReadmeSemanticContent(readme: string): string {
  const TOTAL_BUDGET = 7500;

  // 1. HTML/XML 净化，保留 Markdown 结构
  const sanitized = sanitizeReadme(readme);

  // 2. 提取仓库描述行（Title 从首行 H1 提取）
  const titleMatch = sanitized.match(/^#\s+(.+)$/m);
  const repoTitle = titleMatch ? titleMatch[1].trim() : "";

  // 3. 按 H2/H3 边界划分 section
  const sectionPattern = /^(#{2,3})\s+(.+)$/gm;
  const sections: Array<{ title: string; content: string; start: number }> = [];
  let lastMatch: RegExpExecArray | null = null;

  let m: RegExpExecArray | null;
  while ((m = sectionPattern.exec(sanitized)) !== null) {
    if (lastMatch !== null) {
      sections.push({
        title: lastMatch[2].trim(),
        content: sanitized
          .slice(lastMatch.index + lastMatch[0].length, m.index)
          .trim(),
        start: lastMatch.index,
      });
    }
    lastMatch = m;
  }
  if (lastMatch !== null) {
    sections.push({
      title: lastMatch[2].trim(),
      content: sanitized.slice(lastMatch.index + lastMatch[0].length).trim(),
      start: lastMatch.index,
    });
  }

  // 4. 平铺 README 兜底：无 H2/H3 时直接取 stripMarkdownToPlainText 前 7500 字符
  if (sections.length === 0) {
    const flat = stripMarkdownToPlainText(sanitized);
    return flat.slice(0, TOTAL_BUDGET);
  }

  // 5. 标题汇总
  const allTitles = sections.map((s) => s.title).join(", ");

  // 6. 提取 H1 下首段落（到第一个 H2/H3 之前）作为 Overview
  const firstSectionStart = sections[0].start;
  const preH2Text = sanitized.slice(0, firstSectionStart);
  const overviewRaw = preH2Text.replace(/^#\s+.+$/m, "").trim();
  const overview = stripMarkdownToPlainText(overviewRaw);

  // 7. 语义分类关键词
  const FEATURE_KW =
    /features?|功能|特性|highlights?|what'?s included|capabilities/i;
  const USECASE_KW =
    /use[- ]cases?|scenarios?|使用场景|应用场景|who uses|motivation/i;
  const QUICKSTART_KW =
    /quick[- ]?start|getting[- ]?started|快速开始|installation|install|安装|setup/i;

  // 8. 去除 fenced 代码块（避免命令行污染语义）
  function stripCodeBlocks(text: string): string {
    return text.replace(/```[\s\S]*?```/g, " ").replace(/`[^`]+`/g, " ");
  }

  let featuresText = "";
  let useCaseText = "";
  let quickStartText = "";
  const bodyLines: string[] = [];

  for (const sec of sections) {
    const plain = stripMarkdownToPlainText(sec.content);
    if (FEATURE_KW.test(sec.title)) {
      featuresText += (featuresText ? "\n" : "") + plain;
    } else if (USECASE_KW.test(sec.title)) {
      useCaseText += (useCaseText ? "\n" : "") + plain;
    } else if (QUICKSTART_KW.test(sec.title)) {
      // Quick Start: 额外去掉代码块，避免命令行污染语义
      const stripped = stripMarkdownToPlainText(stripCodeBlocks(sec.content));
      quickStartText += (quickStartText ? "\n" : "") + stripped;
    } else {
      // 兜底：取非空的高密度正文段落（字符数 > 30）
      if (plain.length > 30) {
        bodyLines.push(plain);
      }
    }
  }

  // 9. 按配额构建输出
  const QUOTA = {
    description: 200,
    titles: 400,
    overview: 1500,
    features: 1500,
    useCases: 1000,
    quickStart: 600,
  };

  const parts: string[] = [];
  let remaining = TOTAL_BUDGET;

  function addPart(label: string, text: string, quota: number): void {
    if (!text || remaining <= 0) return;
    const allowed = Math.min(quota, remaining);
    const slice = text.slice(0, allowed);
    if (slice.trim()) {
      parts.push(`${label}: ${slice.trim()}`);
      remaining -= slice.length + label.length + 2;
    }
  }

  addPart("Title", repoTitle, QUOTA.description);
  addPart("Sections", allTitles, QUOTA.titles);
  addPart("Overview", overview, QUOTA.overview);
  addPart("Features", featuresText, QUOTA.features);
  addPart("Use Cases", useCaseText, QUOTA.useCases);
  addPart("Quick Start", quickStartText, QUOTA.quickStart);

  // 兜底：高密度正文行
  if (remaining > 50 && bodyLines.length > 0) {
    const body = bodyLines.join(" ").slice(0, remaining);
    if (body.trim()) {
      parts.push(`Content: ${body.trim()}`);
    }
  }

  return parts.join("\n");
}

/**
 * 将 Markdown 转为纯文本，去掉格式符号、HTML 标签、链接语法、代码块等
 * 保留所有可读性内容，用于 embedding 前的文本净化
 */
export function stripMarkdownToPlainText(markdown: string): string {
  return (
    markdown
      // 去掉 HTML 标签（包括被截断的不完整标签）
      .replace(/<\/?[a-zA-Z][^>]*>?/gi, " ")
      // 去掉 fenced 代码块（含语言标识）
      .replace(/```[\s\S]*?```/g, " ")
      // 去掉行内代码
      .replace(/`([^`]+)`/g, "$1")
      // 图片标签完全去掉（必须在链接之前处理）
      .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
      // 链接 → 纯文本 [text](url) → text
      .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
      // 标题符号 # ## ### 等
      .replace(/^#{1,6}\s+/gm, "")
      // 粗体 **text** __text__
      .replace(/(\*\*|__)(.*?)\1/g, "$2")
      // 斜体 *text* _text_
      .replace(/(\*|_)(.*?)\1/g, "$2")
      // 引用块 >
      .replace(/^>\s?/gm, "")
      // 无序列表符号
      .replace(/^[-*+]\s+/gm, "")
      // 有序列表符号
      .replace(/^\d+\.\s+/gm, "")
      // 水平分隔线
      .replace(/^[-=*]{3,}\s*$/gm, "")
      // 表格分隔符行 |---|---|
      .replace(/^\|[-| :\s]+\|/gm, "")
      // 表格竖线 → 空格
      .replace(/\|/g, " ")
      // 合并多余空白
      .replace(/\s+/g, " ")
      .trim()
  );
}

/**
 * 从 Markdown 提取标题和摘要
 * 先用 linkedom 去掉 HTML 标签，再提取有效文本行
 */
function extractFromMarkdown(
  markdown: string,
  fallbackTitle: string,
): { title: string; summary: string } {
  // 用正则去掉 HTML 标签（包括被截断的不完整标签）
  const plainText = markdown.replace(/<\/?[a-zA-Z][^>]*>?/gi, " ");

  const lines = plainText.split("\n");

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

    // 清理 Markdown 格式符号（HTML 已由上一步正则去掉）
    const cleaned = trimmed
      .replace(/!\[[^\]]*\]\([^)]*\)/g, "") // 图片完全去掉（必须在链接之前）
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
        // 语义内容提取（用于 embedding，充分利用 BGE-M3 的 8192 token 窗口）
        const semanticContent = extractReadmeSemanticContent(readme);
        const plainText = stripMarkdownToPlainText(readme);
        let summary = plainText.slice(0, 800); // 展示用摘要（关键词搜索 + UI）
        let tags: string[] = [];
        let llmEnhanced = false;

        // LLM 增强（仅影响 summary + tags，不影响 embedding）
        if (settings.enableLLMEnrichment && plainText.length > 100) {
          try {
            const provider = getLLMProvider();
            if (provider) {
              const llmResult = await provider.generateDeepContent(
                plainText.slice(0, 4000),
              );
              summary = llmResult.summary; // UI 展示摘要来自 LLM
              tags = llmResult.tags;
              llmEnhanced = true;
            }
          } catch (llmError) {
            console.warn(
              `[indexer] LLM enrichment failed for ${job.owner}/${job.repo}:`,
              llmError,
            );
            // 降级：使用原始摘要
          }
        }

        // embedding 始终使用 semanticContent（与 LLM 开关无关）
        // 不通过 buildEmbeddingText，避免 "Summary:" 标签重复嵌套已结构化的内容
        const textToEmbed = semanticContent.slice(0, 8000);
        const { embedding } = await getEmbedding(
          textToEmbed,
          settings.openaiApiKey!,
          undefined,
          settings.embeddingModel,
          settings.baseURL,
        );
        await updateBookmark(job.bookmarkId, {
          summary,
          tags,
          embedding,
          needsEnrichment: false,
          indexedAt: Date.now(),
          llmEnhanced,
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
            source: "github",
          }) as BookmarkRecord,
      );

      await upsertBookmarks(records);
      totalQueued += records.length;

      upsertSearchEngineBatch(records)
        .then(() => scheduleSaveSearchEngine())
        .catch((e) => {
          console.warn("[indexer] Search engine sync failed:", e);
        });

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

/** 提取 URL 域名（去掉 www. 前缀） */
function getUrlDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

/** 构造用于 embedding 的结构化文档文本 */
function buildEmbeddingText(
  title: string,
  summary: string,
  tags: string[],
  url: string,
): string {
  const parts: string[] = [];
  if (title) parts.push(`Title: ${title}`);
  if (summary) parts.push(`Summary: ${summary}`);
  if (tags.length > 0) parts.push(`Tags: ${tags.join(", ")}`);
  const domain = getUrlDomain(url);
  if (domain) parts.push(`Source: ${domain}`);
  return parts.length > 0 ? parts.join("\n") : title;
}

/**
 * 核心内容提取策略器
 */
export async function fetchPageContent(
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
            const plainText = stripMarkdownToPlainText(readme);
            return {
              markdown: readme,
              title: `${owner}/${repo}`,
              summary: plainText.slice(0, 500),
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
              const provider = getLLMProvider();
              if (provider) {
                const llmResult = await provider.generateDeepContent(
                  content.markdown.slice(0, 4000),
                );
                summary = llmResult.summary;
                tags = llmResult.tags;
                text = buildEmbeddingText(
                  content.title || job.title,
                  summary,
                  tags,
                  job.url,
                );
              } else {
                // 无可用 provider，降级到原始摘要
                text = content
                  ? buildEmbeddingText(
                      content.title || job.title,
                      summary || "",
                      [],
                      job.url,
                    )
                  : buildEmbeddingText(job.title, "", [], job.url);
              }
            } catch (llmError) {
              console.warn(
                `[indexer] LLM enhancement failed for ${job.url}:`,
                llmError,
              );
              // 降级：使用原始摘要
              text = content
                ? buildEmbeddingText(
                    content.title || job.title,
                    summary || "",
                    [],
                    job.url,
                  )
                : buildEmbeddingText(job.title, "", [], job.url);
            }
          } else {
            text = content
              ? buildEmbeddingText(
                  content.title || job.title,
                  summary || "",
                  [],
                  job.url,
                )
              : buildEmbeddingText(job.title, "", [], job.url);
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

      upsertSearchEngineBatch(records)
        .then(() => scheduleSaveSearchEngine())
        .catch((e) => {
          console.warn("[indexer] Search engine sync failed:", e);
        });
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
    if (persistedQueue.length > 0) {
      // 获取已索引的 URL，跳过已完成的条目
      const urlsToCheck = persistedQueue.map((i) => i.url);
      const indexedUrls = await getIndexedUrls(urlsToCheck);

      let restored = 0;
      const staleIds: string[] = [];
      for (const item of persistedQueue) {
        if (indexedUrls.has(item.url)) {
          // 已索引，不需要重新入队
          staleIds.push(item.bookmarkId);
        } else if (!queue.some((j) => j.bookmarkId === item.bookmarkId)) {
          queue.push({
            bookmarkId: item.bookmarkId,
            url: item.url,
            title: item.title,
            retryCount: item.retryCount,
          });
          restored++;
        }
      }

      // 清理 DB 中的过期队列条目
      if (staleIds.length > 0) {
        try {
          await db.indexQueue.bulkDelete(staleIds);
        } catch {
          // 静默失败
        }
      }

      if (restored > 0) {
        console.log(
          `[indexer] Restored ${restored} items from persistent queue (skipped ${staleIds.length} already indexed)`,
        );
        processQueue();
      } else if (staleIds.length > 0) {
        console.log(
          `[indexer] Skipped ${staleIds.length} stale queue items (already indexed)`,
        );
      }
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
    await removeFromSearchEngine(id).catch(() => {});
    scheduleSaveSearchEngine();
  });

  // === 恢复 enrichment 队列 ===
  const settings = await getSettings();
  if (settings.githubToken && settings.openaiApiKey) {
    // 1. 先从 storage 恢复队列
    await restoreEnrichmentQueue();

    // === README 向量版本检查：存量重建 ===
    const CURRENT_README_VERSION = 1;
    // 仅在 githubToken 存在时才做重建（无 token 无法拉 README，保留旧版本号等待下次启动）
    if (
      settings.githubToken &&
      (settings.githubReadmeVersion ?? 0) < CURRENT_README_VERSION
    ) {
      const githubRecords = await db.bookmarks
        .filter((r) => r.source === "github" && r.status === "indexed")
        .toArray();

      let versionAdded = 0;
      for (const record of githubRecords) {
        if (enrichmentQueue.some((j) => j.bookmarkId === record.id)) continue;
        const match = record.url.match(/github\.com\/([^/]+)\/([^/?#]+)/);
        if (match) {
          enrichmentQueue.push({
            bookmarkId: record.id,
            url: record.url,
            owner: match[1],
            repo: match[2].replace(/\/$/, ""),
            token: settings.githubToken,
          });
          versionAdded++;
        }
      }

      if (versionAdded > 0) {
        await persistEnrichmentQueue();
        console.log(
          `[indexer] Queued ${versionAdded} GitHub repos for README re-indexing (v${CURRENT_README_VERSION})`,
        );
      }

      // 仅在 token 存在时推进版本（无 token 时保留旧值，等待下次启动时重试）
      await saveSettings({ githubReadmeVersion: CURRENT_README_VERSION });
    }
    // === 版本检查结束 ===

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

      upsertSearchEngineBatch(records)
        .then(() => scheduleSaveSearchEngine())
        .catch((e) => {
          console.warn("[indexer] Search engine sync failed:", e);
        });

      // LLM 增强（如果启用）
      if (settings.enableLLMEnrichment) {
        const provider = getLLMProvider();
        if (provider) {
          for (let i = 0; i < bookmarks.length; i++) {
            if (!embeddings[i]) continue; // 跳过嵌入失败的
            const bookmark = bookmarks[i];
            const text = texts[i];
            try {
              const llmResult = await provider.generateDeepContent(
                text.slice(0, 4000),
              );
              const newText = buildEmbeddingText(
                `@${bookmark.authorHandle || "unknown"}`,
                llmResult.summary,
                llmResult.tags,
                `https://x.com/${bookmark.authorHandle || "i"}/status/${bookmark.tweetId}`,
              );
              const { embedding } = await getEmbedding(
                newText,
                settings.openaiApiKey!,
                undefined,
                settings.embeddingModel,
                settings.baseURL,
              );
              await updateBookmark(`tw-${bookmark.tweetId}`, {
                summary: llmResult.summary,
                tags: llmResult.tags,
                embedding,
                llmEnhanced: true,
              });
            } catch (llmError) {
              console.warn(
                `[indexer] LLM enhancement failed for tweet ${bookmark.tweetId}:`,
                llmError,
              );
            }
          }
        }
      }

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
