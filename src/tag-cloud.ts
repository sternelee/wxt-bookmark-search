/**
 * Tag cloud aggregation — 标签云探索引擎
 *
 * 基于已有书签的 tags 字段做共现聚合，支持：
 * - 根标签云：聚合所有书签的顶级标签
 * - 钻取：给定已选标签，计算共现子标签云
 * - 书签关联：给定标签组合，实时返回交集书签
 */
import type { BookmarkRecord } from "./types";

/** 标签节点 */
export interface TagNode {
  tag: string;
  count: number;           // 包含此标签的书签数量
  weight: number;          // 归一化 0-1，决定字体/圆圈大小
  bookmarkIds: string[];   // 关联书签 ID 列表
}

/** 标签标准化：转小写、去复数、统一符号 */
export function normalizeTag(tag: string): string {
  return tag
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9一-龥+#.-]/g, "-")  // 统一特殊字符
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

/** 停用词表：常见无意义词，不应作为标签 */
const STOP_WORDS = new Set([
  "the", "a", "an", "is", "are", "was", "were", "be", "been", "being",
  "have", "has", "had", "do", "does", "did", "will", "would", "could",
  "should", "may", "might", "can", "shall", "to", "of", "in", "for",
  "on", "with", "at", "by", "from", "as", "into", "through", "during",
  "before", "after", "above", "below", "between", "under", "and",
  "but", "or", "nor", "not", "so", "yet", "both", "either", "neither",
  "each", "every", "all", "any", "few", "more", "most", "other", "some",
  "such", "no", "only", "own", "same", "than", "too", "very", "just",
  "this", "that", "these", "those", "it", "its", "he", "she", "they",
  "them", "their", "his", "her", "my", "your", "our", "we", "you", "i",
  "me", "us", "about", "up", "out", "if", "then", "here", "there",
  "when", "where", "why", "how", "which", "who", "whom", "what",
  "http", "https", "www", "com", "org", "net", "io", "dev", "html",
]);

/** 公共技术关键词库（用于标题匹配提取标签） */
const TECH_KEYWORDS = [
  "react", "vue", "angular", "svelte", "next.js", "nextjs", "nuxt", "remix",
  "typescript", "javascript", "python", "rust", "go", "golang", "java",
  "kotlin", "swift", "c++", "c#", "ruby", "php", "elixir", "scala",
  "node.js", "nodejs", "deno", "bun", "express", "fastify", "hono",
  "graphql", "rest", "api", "grpc", "websocket", "postgres", "postgresql",
  "mysql", "mongodb", "redis", "sqlite", "prisma", "drizzle", "kysely",
  "docker", "kubernetes", "k8s", "aws", "gcp", "azure", "vercel",
  "cloudflare", "nginx", "ci/cd", "github", "gitlab", "github-actions",
  "tailwind", "css", "sass", "webpack", "vite", "esbuild", "turbopack",
  "testing", "jest", "vitest", "playwright", "cypress", "storybook",
  "llm", "ai", "ml", "openai", "langchain", "huggingface", "transformers",
  "linux", "macos", "windows", "android", "ios", "flutter", "react-native",
  "security", "auth", "oauth", "jwt", "ssl", "tls", "encryption",
  "blockchain", "web3", "solidity", "ethereum", "database", "sql", "nosql",
  "serverless", "microservices", "monorepo", "cli", "vscode", "extension",
  "browser", "chrome", "firefox", "safari", "edge", "pwa", "wasm",
];

/** 从标题中提取技术关键词作为 fallback 标签 */
function extractTechKeywords(title: string): string[] {
  const lower = title.toLowerCase();
  const matched: string[] = [];
  for (const kw of TECH_KEYWORDS) {
    if (matched.length >= 5) break;
    // 用词边界匹配，避免 "react" 匹配到 "reactive"
    const escaped = kw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, "i");
    if (re.test(lower) && !matched.some((m) => m.toLowerCase() === kw)) {
      matched.push(kw);
    }
  }
  return matched;
}

/** 从 URL 中提取域名作为标签 */
function extractDomainTag(url: string): string {
  try {
    const hostname = new URL(url).hostname;
    return hostname.replace(/^www\./, "").split(".")[0] || hostname;
  } catch {
    return "";
  }
}

/** 为无标签记录生成 fallback 标签（标题关键词 + 域名） */
export function getFallbackTags(record: { title: string; url: string; tags?: string[] }): string[] {
  // 如果已有 LLM 标签，直接返回
  if (record.tags && record.tags.length > 0) return [];

  const tags: string[] = [];
  const keywords = extractTechKeywords(record.title);
  for (const kw of keywords) {
    const n = normalizeTag(kw);
    if (n && !STOP_WORDS.has(n)) tags.push(n);
  }

  const domain = extractDomainTag(record.url);
  if (domain && !STOP_WORDS.has(domain) && domain.length > 2) {
    tags.push(normalizeTag(domain));
  }

  return tags.slice(0, 6);
}

/**
 * 构建根标签云 — 聚合所有书签的 tags 字段
 */
export function buildRootTagCloud(records: BookmarkRecord[]): TagNode[] {
  const tagMap = new Map<string, Set<string>>();

  for (const record of records) {
    if (record.status !== "indexed") continue;
    // 优先使用 LLM 标签，无标签时 fallback 到标题+域名提取
    let tags = record.tags ?? [];
    if (tags.length === 0) {
      tags = getFallbackTags(record);
    }
    for (const tag of tags) {
      const normalized = normalizeTag(tag);
      if (!normalized || STOP_WORDS.has(normalized)) continue;
      if (!tagMap.has(normalized)) tagMap.set(normalized, new Set());
      tagMap.get(normalized)!.add(record.id);
    }
  }

  if (tagMap.size === 0) return [];

  let maxCount = 1;
  for (const ids of tagMap.values()) {
    if (ids.size > maxCount) maxCount = ids.size;
  }

  return Array.from(tagMap.entries())
    .map(([tag, ids]) => ({
      tag,
      count: ids.size,
      weight: ids.size / maxCount,
      bookmarkIds: Array.from(ids),
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 80); // 根标签最多展示 80 个
}

/**
 * 钻取：给定已选标签，计算共现子标签云
 * 原理：在满足 activeTags 的书签子集中，找出其他高频 co-tag
 */
export function drillDown(
  activeTags: string[],
  allRecords: BookmarkRecord[],
): TagNode[] {
  if (activeTags.length === 0) return buildRootTagCloud(allRecords);

  const activeSet = new Set(activeTags.map(normalizeTag));

  // 1. 找到包含所有 activeTags 的书签子集
  const filtered = allRecords.filter((r) => {
    if (r.status !== "indexed") return false;
    let recordTags = (r.tags ?? []).map(normalizeTag);
    if (recordTags.length === 0) {
      recordTags = getFallbackTags(r).map(normalizeTag);
    }
    return activeSet.size === 0 || activeSet.isSubsetOf(new Set(recordTags));
  });

  if (filtered.length === 0) return [];

  // 2. 在子集中统计其他标签的共现频率
  const coTagMap = new Map<string, Set<string>>();
  for (const record of filtered) {
    for (const tag of record.tags ?? []) {
      const normalized = normalizeTag(tag);
      if (!normalized) continue;
      if (activeSet.has(normalized)) continue; // 排除已选标签
      if (!coTagMap.has(normalized)) coTagMap.set(normalized, new Set());
      coTagMap.get(normalized)!.add(record.id);
    }
    // fallback: 无 LLM 标签时从标题提取
    if ((record.tags ?? []).length === 0) {
      for (const ftag of getFallbackTags(record)) {
        const normalized = normalizeTag(ftag);
        if (!normalized || activeSet.has(normalized)) continue;
        if (!coTagMap.has(normalized)) coTagMap.set(normalized, new Set());
        coTagMap.get(normalized)!.add(record.id);
      }
    }
  }

  if (coTagMap.size === 0) return [];

  let maxCount = 1;
  for (const ids of coTagMap.values()) {
    if (ids.size > maxCount) maxCount = ids.size;
  }

  return Array.from(coTagMap.entries())
    .map(([tag, ids]) => ({
      tag,
      count: ids.size,
      weight: ids.size / maxCount,
      bookmarkIds: Array.from(ids),
    }))
    .filter((n) => n.count >= 2)  // 至少 2 个书签才出现
    .sort((a, b) => b.count - a.count)
    .slice(0, 40); // 子标签最多 40 个
}

/**
 * 获取 activeTags 交集对应的书签（实时更新用）
 */
export function getBookmarksByTags(
  activeTags: string[],
  allRecords: BookmarkRecord[],
): BookmarkRecord[] {
  if (activeTags.length === 0) return [];

  const activeSet = new Set(activeTags.map(normalizeTag));

  return allRecords
    .filter((r) => {
      if (r.status !== "indexed") return false;
      let recordTags = (r.tags ?? []).map(normalizeTag);
      if (recordTags.length === 0) {
        recordTags = getFallbackTags(r).map(normalizeTag);
      }
      return activeSet.isSubsetOf(new Set(recordTags));
    })
    .sort((a, b) => (b.indexedAt ?? 0) - (a.indexedAt ?? 0))
    .slice(0, 50);
}

/**
 * 获取标签云统计信息
 */
export function getTagCloudStats(records: BookmarkRecord[]): {
  totalTags: number;
  totalBookmarks: number;
  topTag: string | null;
  maxCooccurrence: number;
} {
  const nodes = buildRootTagCloud(records);
  const indexedCount = records.filter((r) => r.status === "indexed").length;

  // 找最大共现数
  let maxCo = 0;
  for (const node of nodes) {
    maxCo = Math.max(maxCo, node.count);
  }

  return {
    totalTags: nodes.length,
    totalBookmarks: indexedCount,
    topTag: nodes[0]?.tag ?? null,
    maxCooccurrence: maxCo,
  };
}

// Helper: Set.isSubsetOf polyfill for older targets
declare global {
  interface Set<T> {
    isSubsetOf(other: Set<T>): boolean;
  }
}

if (!Set.prototype.isSubsetOf) {
  Set.prototype.isSubsetOf = function (other) {
    for (const item of this) {
      if (!other.has(item)) return false;
    }
    return true;
  };
}