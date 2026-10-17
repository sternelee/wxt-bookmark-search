/**
 * Duplicate bookmark detector — 查找并处理重复 URL 的书签
 */
import type { DuplicateGroup, BookmarkRecord } from "./types";
import { getAllIndexedUrls, db } from "./db";

export interface BookmarkTreeNode {
  id: string;
  title: string;
  url?: string;
  children?: BookmarkTreeNode[];
}

/**
 * 构建书签 ID → 文件夹路径映射
 * 由调用方传入浏览器书签树
 */
export function buildFolderPathMapFromTree(
  tree: BookmarkTreeNode[],
): Map<string, string[]> {
  const idToPath = new Map<string, string[]>();

  function walk(nodes: BookmarkTreeNode[], path: string[]): void {
    for (const node of nodes) {
      if (node.url && node.id) {
        const cleanPath = path.filter(Boolean);
        idToPath.set(node.id, cleanPath);
      }
      if (node.children) {
        walk(node.children, [...path, node.title]);
      }
    }
  }

  // 跳过合成根节点
  if (tree.length === 1 && !tree[0].url && tree[0].children) {
    walk(tree[0].children, []);
  } else {
    walk(tree, []);
  }

  return idToPath;
}

/** 查找重复书签组 */
export async function findDuplicates(
  folderPathMap: Map<string, string[]>,
): Promise<DuplicateGroup[]> {
  const urlGroups = await getAllIndexedUrls();
  if (urlGroups.length === 0) return [];

  const allIds = urlGroups.flatMap((g) => g.ids);
  const records = await db.bookmarks.bulkGet(allIds);

  const recordMap = new Map<string, BookmarkRecord>();
  for (const r of records) {
    if (r) recordMap.set(r.id, r);
  }

  const groups: DuplicateGroup[] = [];
  for (const { url, ids } of urlGroups) {
    const bookmarks: BookmarkRecord[] = [];
    const folderPaths: string[][] = [];

    for (const id of ids) {
      const record = recordMap.get(id);
      // 只保留浏览器书签树里真实存在的记录。GitHub / Twitter / 历史 的合成 ID
      // （gh-… / tw-… / hi-…）不是合法的 browser bookmark id，对它们调用
      // browser.bookmarks.remove 会抛 "Bookmark id is invalid."（见 resolveDuplicates）。
      // folderPathMap 由浏览器书签树构建，因此能精确区分真实书签与其它来源。
      if (!record || !folderPathMap.has(record.id)) continue;
      bookmarks.push(record);
      folderPaths.push(folderPathMap.get(record.id) ?? []);
    }

    if (bookmarks.length >= 2) {
      groups.push({ url, bookmarks, folderPaths });
    }
  }

  return groups;
}

/** 重复组解析结果，供调用方判断是否真的删掉了东西 */
export interface DuplicateResolveResult {
  /** 已从浏览器书签树中成功移除的 ID */
  removed: string[];
  /** 浏览器中已不存在（或本就不是浏览器书签）的 ID */
  alreadyGone: string[];
  /** 移除失败（权限等）的 ID 与原因 */
  failed: { id: string; reason: string }[];
  /** 确实从 DB 中删除的记录 ID（仅含确认已从浏览器移除的） */
  deletedFromDb: string[];
}

/** 解析重复组：保留一个，删除其余；返回每一步的实际结果 */
export async function resolveDuplicates(
  keepId: string,
  deleteIds: string[],
  removeBookmark: (id: string) => Promise<void>,
  bookmarkExists: (id: string) => Promise<boolean>,
): Promise<DuplicateResolveResult> {
  const result: DuplicateResolveResult = {
    removed: [],
    alreadyGone: [],
    failed: [],
    deletedFromDb: [],
  };

  // 从浏览器书签中删除。remove() 不抛错不代表真的删了（受管书签、只读文件夹、
  // 浏览器同步恢复等场景会静默保留），报错 "not found" 也不代表不在（错误文案
  // 各浏览器不一），因此每一步都回读确认真实状态，分类完全以回读结果为准。
  for (const id of deleteIds) {
    let removeError: string | null = null;
    try {
      await removeBookmark(id);
    } catch (err) {
      removeError = err instanceof Error ? err.message : String(err);
    }

    let exists = true;
    try {
      exists = await bookmarkExists(id);
    } catch (err) {
      // 回读本身失败：按仍存在处理，宁可保留也不误报成功
      console.warn("[dedup] bookmarkExists check failed for", id, err);
    }

    if (exists) {
      const reason =
        removeError ??
        "browser.bookmarks.remove returned ok but bookmark still exists";
      result.failed.push({ id, reason });
      console.warn("[dedup] Failed to remove bookmark", id, ":", reason);
    } else if (removeError) {
      result.alreadyGone.push(id);
      console.debug("[dedup] Bookmark already removed:", id);
    } else {
      result.removed.push(id);
    }
  }

  // 只清理确认已从浏览器移除的记录。删除失败的记录保留在 DB：重新扫描时如实
  // 显示，而不是“悄悄删 DB → SW 重启全量索引时又把浏览器里的书签索引进来”
  // 造成“删了又重新出现”的假象。
  const confirmedIds = [...result.removed, ...result.alreadyGone];
  if (confirmedIds.length > 0) {
    await db.bookmarks.bulkDelete(confirmedIds);
    // 清理索引队列中的残留任务，否则 processQueue 会从过期任务重建 DB 记录
    await db.indexQueue.bulkDelete(confirmedIds).catch(() => {});
    const stillThereSet = new Set(
      (await db.bookmarks.bulkGet(confirmedIds))
        .filter((r): r is NonNullable<typeof r> => Boolean(r))
        .map((r) => r.id),
    );
    result.deletedFromDb = confirmedIds.filter((id) => !stillThereSet.has(id));

    const { removeFromSearchEngine, flushSaveSearchEngine } =
      await import("./search-engine");
    for (const id of confirmedIds) {
      try {
        await removeFromSearchEngine(id);
      } catch (err) {
        console.warn("[dedup] Failed to remove from search engine:", id, err);
      }
    }
    await flushSaveSearchEngine();
  }

  return result;
}
