/**
 * GitHub Gist 书签同步模块
 * 通过 Gist 实现多设备书签同步（union 合并策略）
 */

import { Octokit } from "octokit";
import type { GistBookmarkData, GistBookmarkNode, DeletedBookmarkEntry } from "./types";

/** Gist 文件名 */
export const GIST_FILENAME = "flow-search-bookmarks.json";
const DELETED_BOOKMARKS_KEY = "gist_deleted_bookmarks";
const DELETION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 天

// === 删除记录管理 ===

/** 获取本地删除记录 */
export async function getDeletedBookmarks(): Promise<DeletedBookmarkEntry[]> {
  const data = await browser.storage.local.get(DELETED_BOOKMARKS_KEY);
  const entries = (data[DELETED_BOOKMARKS_KEY] as DeletedBookmarkEntry[]) || [];
  // 自动清理超过 30 天的记录
  const now = Date.now();
  return entries.filter(e => now - e.deletedAt < DELETION_TTL_MS);
}

/** 记录一条书签删除 */
export async function recordBookmarkDeletion(
  url: string,
  title: string,
  folderPath: string[],
): Promise<void> {
  const entries = await getDeletedBookmarks();
  const key = buildBookmarkKey(url, title, folderPath);
  if (entries.some((e) => e.key === key)) return;
  entries.push({
    key,
    url,
    title,
    folderPath: normalizeFolderPath(folderPath),
    deletedAt: Date.now(),
  });
  await browser.storage.local.set({ [DELETED_BOOKMARKS_KEY]: entries });
}

/** 从删除记录中移除指定键（同步完成后清理） */
async function removeFromDeletedBookmarks(keys: string[]): Promise<void> {
  if (keys.length === 0) return;
  const keySet = new Set(keys);
  const entries = await getDeletedBookmarks();
  const filtered = entries.filter((e) => !keySet.has(e.key));
  await browser.storage.local.set({ [DELETED_BOOKMARKS_KEY]: filtered });
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

/** 创建新 Gist */
export async function createGist(
  octokit: InstanceType<typeof Octokit>,
  data: GistBookmarkData,
): Promise<string> {
  const response = await octokit.rest.gists.create({
    description: "Flow Search - Bookmark Sync",
    public: false,
    files: {
      [GIST_FILENAME]: {
        content: JSON.stringify(data, null, 2),
      },
    },
  });
  return response.data.id!;
}

/** 更新已有 Gist */
export async function updateGist(
  octokit: InstanceType<typeof Octokit>,
  gistId: string,
  data: GistBookmarkData,
): Promise<void> {
  await octokit.rest.gists.update({
    gist_id: gistId,
    files: {
      [GIST_FILENAME]: {
        content: JSON.stringify(data, null, 2),
      },
    },
  });
}

/** 从 Gist 获取书签数据 */
export async function fetchGistData(
  octokit: InstanceType<typeof Octokit>,
  gistId: string,
): Promise<GistBookmarkData | null> {
  try {
    const response = await octokit.rest.gists.get({ gist_id: gistId });
    const file = response.data.files?.[GIST_FILENAME];
    if (!file?.content) return null;
    const parsed = JSON.parse(file.content);
    if (parsed.version !== 1) {
      console.warn("[gist-sync] Unknown gist data version:", parsed.version);
      return null;
    }
    return parsed as GistBookmarkData;
  } catch (error: unknown) {
    const message = getErrorMessage(error);
    if (message.includes("404")) {
      console.warn("[gist-sync] Gist not found:", gistId);
      return null;
    }
    throw error;
  }
}

// === 书签树导出 ===

type BrowserBookmarkNode = {
  id: string;
  title?: string;
  url?: string;
  dateAdded?: number;
  children?: BrowserBookmarkNode[];
};

/** 将浏览器书签树转换为 Gist 格式 */
export function exportBookmarkTree(
  tree: BrowserBookmarkNode[],
): GistBookmarkNode[] {
  return tree.map(node => {
    const gistNode: GistBookmarkNode = {
      id: node.id,
      title: node.title || "",
    };
    if (node.url) {
      gistNode.url = node.url;
    }
    if (node.dateAdded) {
      gistNode.dateAdded = node.dateAdded;
    }
    if (node.children && node.children.length > 0) {
      gistNode.children = exportBookmarkTree(node.children);
    }
    return gistNode;
  });
}

// === 合并逻辑 ===

interface BookmarkEntry {
  key: string;
  node: GistBookmarkNode;
  folderPath: string[];
}

function normalizeFolderPath(folderPath: string[]): string[] {
  return folderPath.filter(Boolean);
}

export function buildBookmarkKey(
  url: string,
  title: string,
  folderPath: string[],
): string {
  return JSON.stringify({
    url,
    title: title.trim(),
    folderPath: normalizeFolderPath(folderPath),
  });
}

/** 递归收集所有书签条目映射 */
function collectUrls(
  nodes: GistBookmarkNode[],
  map: Map<string, BookmarkEntry>,
  folderPath: string[] = [],
): void {
  for (const node of nodes) {
    if (node.id === "0") {
      if (node.children) {
        collectUrls(node.children, map, folderPath);
      }
      continue;
    }

    if (node.url) {
      const normalizedPath = normalizeFolderPath(folderPath);
      const key = buildBookmarkKey(node.url, node.title, normalizedPath);
      map.set(key, { key, node, folderPath: normalizedPath });
      continue;
    }

    const nextPath = node.title ? [...folderPath, node.title] : folderPath;
    if (node.children) {
      collectUrls(node.children, map, nextPath);
    }
  }
}

/** 取得真正可写入书签的根 children（跳过 Chrome synthetic root） */
function getWritableRoot(nodes: GistBookmarkNode[]): GistBookmarkNode[] {
  if (nodes.length === 1 && !nodes[0].url && nodes[0].children) {
    return nodes[0].children;
  }
  return nodes;
}

/** 在指定路径下追加书签，必要时自动创建文件夹 */
function appendBookmarkAtPath(
  tree: GistBookmarkNode[],
  folderPath: string[],
  node: GistBookmarkNode,
): void {
  let current = getWritableRoot(tree);

  for (const segment of folderPath) {
    let folder = current.find((item) => !item.url && item.title === segment);
    if (!folder) {
      folder = {
        id: `gist-folder:${folderPath.slice(0, folderPath.indexOf(segment) + 1).join("/")}`,
        title: segment,
        children: [],
      };
      current.push(folder);
    }

    if (!folder.children) {
      folder.children = [];
    }
    current = folder.children;
  }

  const normalizedPath = normalizeFolderPath(folderPath);

  if (!current.some((item) => {
    if (!item.url || !node.url) return false;
    return buildBookmarkKey(item.url, item.title, normalizedPath) ===
      buildBookmarkKey(node.url, node.title, normalizedPath);
  })) {
    current.push({
      id: node.id,
      title: node.title,
      url: node.url,
      dateAdded: node.dateAdded,
    });
  }
}

/** 合并结果 */
export interface MergeResult {
  /** 远程独有、需要添加到本地的书签 */
  toAddLocal: BookmarkEntry[];
  /** 本地已删除、需要从远程移除的书签 key */
  toRemoveRemote: string[];
  /** 合并后的完整树（用于上传到 Gist） */
  merged: GistBookmarkNode[];
}

/**
 * Union 合并本地和远程书签
 * - 双方都有的书签：保留本地版本
 * - 远程独有的：如果不在本地删除记录中，添加到本地
 * - 本地独有的：保留（自然包含在上传数据中）
 */
export function mergeBookmarks(
  localTree: GistBookmarkNode[],
  remoteTree: GistBookmarkNode[],
  deletedEntries: DeletedBookmarkEntry[],
): MergeResult {
  const localEntries = new Map<string, BookmarkEntry>();
  collectUrls(localTree, localEntries);

  const remoteEntries = new Map<string, BookmarkEntry>();
  collectUrls(remoteTree, remoteEntries);

  const deletedKeySet = new Set(deletedEntries.map((e) => e.key));

  const toAddLocal: BookmarkEntry[] = [];
  const toRemoveRemote: string[] = [];

  for (const [key, remoteEntry] of remoteEntries) {
    if (localEntries.has(key)) {
      continue;
    }
    if (deletedKeySet.has(key)) {
      toRemoveRemote.push(key);
    } else {
      toAddLocal.push(remoteEntry);
    }
  }

  const merged = cloneTreeExcluding(localTree, new Set());
  for (const entry of toAddLocal) {
    appendBookmarkAtPath(merged, entry.folderPath, entry.node);
  }

  const removeSet = new Set(toRemoveRemote);
  const finalMerged = filterTreeByKey(merged, removeSet);

  return { toAddLocal, toRemoveRemote, merged: finalMerged };
}

/** 深拷贝书签树，排除指定 URL */
function cloneTreeExcluding(
  nodes: GistBookmarkNode[],
  excludeUrls: Set<string>,
): GistBookmarkNode[] {
  return nodes
    .filter(node => !node.url || !excludeUrls.has(node.url))
    .map(node => ({
      ...node,
      children: node.children
        ? cloneTreeExcluding(node.children, excludeUrls)
        : undefined,
    }));
}

/** 从树中过滤掉指定 key 的节点 */
function filterTreeByKey(
  nodes: GistBookmarkNode[],
  removeKeys: Set<string>,
  folderPath: string[] = [],
): GistBookmarkNode[] {
  if (removeKeys.size === 0) return nodes;
  return nodes
    .filter((node) => {
      if (!node.url) return true;
      const key = buildBookmarkKey(node.url, node.title, folderPath);
      return !removeKeys.has(key);
    })
    .map((node) => ({
      ...node,
      children: node.children
        ? filterTreeByKey(
            node.children,
            removeKeys,
            node.title ? [...folderPath, node.title] : folderPath,
          )
        : undefined,
    }));
}

// === 全量同步入口 ===

/** 生成设备 UUID */
function generateDeviceId(): string {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/** 同步结果 */
export interface SyncResult {
  added: number;    // 从远程添加到本地的数量
  removed: number;  // 从远程删除的数量
  uploaded: number; // 上传到 Gist 的总书签数
  gistId: string;
}

/**
 * 执行全量 Gist 同步
 * @param token GitHub PAT
 * @param gistId 已有的 Gist ID（为空则创建新 Gist）
 * @param deviceId 设备 ID
 * @param localTree 浏览器书签树（browser.bookmarks.getTree() 的结果）
 * @param createBookmark 创建本地书签的回调（browser.bookmarks.create 的封装）
 */
export async function fullGistSync(
  token: string,
  gistId: string | undefined,
  deviceId: string,
  localTree: BrowserBookmarkNode[],
  createBookmark: (folderPath: string[], node: GistBookmarkNode) => Promise<void>,
): Promise<SyncResult> {
  const octokit = new Octokit({ auth: token });
  const localGistTree = exportBookmarkTree(localTree);
  const deletedEntries = await getDeletedBookmarks();

  let remoteData: GistBookmarkData | null = null;
  let currentGistId = gistId;
  if (gistId) {
    remoteData = await fetchGistData(octokit, gistId);
    if (!remoteData) {
      console.warn("[gist-sync] Existing gist is unavailable, creating a new gist on next upload");
      currentGistId = undefined;
    }
  }

  let added = 0;
  let removed = 0;

  if (remoteData && currentGistId) {
    const result = mergeBookmarks(localGistTree, remoteData.bookmarks, deletedEntries);

    for (const entry of result.toAddLocal) {
      try {
        await createBookmark(entry.folderPath, entry.node);
        added++;
      } catch (err) {
        console.warn("[gist-sync] Failed to create local bookmark:", entry.node.url, err);
      }
    }

    if (result.toRemoveRemote.length > 0) {
      removed = result.toRemoveRemote.length;
      await removeFromDeletedBookmarks(result.toRemoveRemote);
    }

    const uploadData: GistBookmarkData = {
      version: 1,
      exportedAt: Date.now(),
      deviceId,
      bookmarks: result.merged,
    };
    await updateGist(octokit, currentGistId, uploadData);

    return { added, removed, uploaded: countUrls(result.merged), gistId: currentGistId };
  } else {
    const uploadData: GistBookmarkData = {
      version: 1,
      exportedAt: Date.now(),
      deviceId,
      bookmarks: localGistTree,
    };

    const newGistId = currentGistId
      ? (await updateGist(octokit, currentGistId, uploadData), currentGistId)
      : await createGist(octokit, uploadData);

    return { added: 0, removed: 0, uploaded: countUrls(localGistTree), gistId: newGistId };
  }
}

/** 统计树中的书签 URL 数量 */
function countUrls(nodes: GistBookmarkNode[]): number {
  let count = 0;
  for (const node of nodes) {
    if (node.url) count++;
    if (node.children) count += countUrls(node.children);
  }
  return count;
}

/** 获取或生成设备 ID */
export async function ensureDeviceId(currentId?: string): Promise<string> {
  if (currentId) return currentId;
  return generateDeviceId();
}
