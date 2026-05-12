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
    .replace(/s$/, "")      // 去复数: servers → server
    .replace(/[^a-z0-9一-龥+#.-]/g, "-")  // 统一特殊字符
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

/**
 * 构建根标签云 — 聚合所有书签的 tags 字段
 */
export function buildRootTagCloud(records: BookmarkRecord[]): TagNode[] {
  const tagMap = new Map<string, Set<string>>();

  for (const record of records) {
    if (record.status !== "indexed") continue;
    for (const tag of record.tags ?? []) {
      const normalized = normalizeTag(tag);
      if (!normalized) continue;
      if (!tagMap.has(normalized)) tagMap.set(normalized, new Set());
      tagMap.get(normalized)!.add(record.id);
    }
  }

  if (tagMap.size === 0) return [];

  const maxCount = Math.max(1, ...Array.from(tagMap.values()).map((s) => s.size));

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
    const recordTags = (r.tags ?? []).map(normalizeTag);
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
  }

  if (coTagMap.size === 0) return [];

  const maxCount = Math.max(1, ...Array.from(coTagMap.values()).map((s) => s.size));

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
      const recordTags = (r.tags ?? []).map(normalizeTag);
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