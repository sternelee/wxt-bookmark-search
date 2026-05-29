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
      if (record) {
        bookmarks.push(record);
        folderPaths.push(folderPathMap.get(record.id) ?? []);
      }
    }

    if (bookmarks.length >= 2) {
      groups.push({ url, bookmarks, folderPaths });
    }
  }

  return groups;
}

/** 解析重复组：保留一个，删除其余 */
export async function resolveDuplicates(
  keepId: string,
  deleteIds: string[],
  removeBookmark: (id: string) => Promise<void>,
): Promise<void> {
  // 从浏览器书签中删除
  for (const id of deleteIds) {
    try {
      await removeBookmark(id);
    } catch {
      console.debug("[dedup] Bookmark already removed:", id);
    }
  }

  // 从 DB 中删除
  await db.bookmarks.bulkDelete(deleteIds);

  // 从搜索引擎中移除
  const { removeFromSearchEngine, flushSaveSearchEngine } =
    await import("./search-engine");
  for (const id of deleteIds) {
    try {
      await removeFromSearchEngine(id);
    } catch {}
  }
  await flushSaveSearchEngine();
}
