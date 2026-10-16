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
  /** 确实从 DB 中删除的记录 ID */
  deletedFromDb: string[];
}

/** 书签已不存在，或该 ID 本就不是浏览器书签（合成 ID），都属预期 */
function isExpectedRemovalError(msg: string): boolean {
  return (
    msg.includes("not found") ||
    msg.includes("Can't find") ||
    msg.toLowerCase().includes("invalid")
  );
}

/** 解析重复组：保留一个，删除其余；返回每一步的实际结果 */
export async function resolveDuplicates(
  keepId: string,
  deleteIds: string[],
  removeBookmark: (id: string) => Promise<void>,
): Promise<DuplicateResolveResult> {
  const result: DuplicateResolveResult = {
    removed: [],
    alreadyGone: [],
    failed: [],
    deletedFromDb: [],
  };

  // 从浏览器书签中删除
  for (const id of deleteIds) {
    try {
      await removeBookmark(id);
      result.removed.push(id);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (isExpectedRemovalError(msg)) {
        result.alreadyGone.push(id);
        console.debug("[dedup] Bookmark already removed:", id);
      } else {
        // 非预期（权限 / 只读文件夹等）：记录下来，不再静默成功
        result.failed.push({ id, reason: msg });
        console.warn("[dedup] Failed to remove bookmark", id, ":", msg);
      }
    }
  }

  // 从 DB 中删除，然后回读确认真的删掉了
  await db.bookmarks.bulkDelete(deleteIds);
  const stillThere = (await db.bookmarks.bulkGet(deleteIds))
    .filter((r): r is NonNullable<typeof r> => Boolean(r))
    .map((r) => r.id);
  const stillThereSet = new Set(stillThere);
  result.deletedFromDb = deleteIds.filter((id) => !stillThereSet.has(id));

  // 从搜索引擎中移除
  const { removeFromSearchEngine, flushSaveSearchEngine } =
    await import("./search-engine");
  for (const id of deleteIds) {
    try {
      await removeFromSearchEngine(id);
    } catch (err) {
      console.warn("[dedup] Failed to remove from search engine:", id, err);
    }
  }
  await flushSaveSearchEngine();

  return result;
}
