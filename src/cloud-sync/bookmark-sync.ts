/**
 * 云端书签同步 — 复用 CloudProvider + gist-sync 合并逻辑
 * 通过统一的云盘 provider（Google Drive / Dropbox / WebDAV）同步浏览器书签树
 */

import type { CloudProvider } from "./types";
import { CLOUD_SYNC_BOOKMARK_FILENAME, CloudSyncError, MAX_UPLOAD_SIZE } from "./types";
import {
  exportBookmarkTree,
  mergeBookmarks,
  getDeletedBookmarks,
  removeFromDeletedBookmarks,
  countUrls,
  clearLocalBookmarks,
  ensureDeviceId,
  getWritableRoot,
  restoreBookmarkTree,
  validateBookmarkTreeData,
} from "../gist-sync";
import type { GistBookmarkData, GistBookmarkNode } from "../types";
import type { SyncResult } from "../gist-sync";

type BrowserBookmarkNode = {
  id: string;
  title?: string;
  url?: string;
  dateAdded?: number;
  children?: BrowserBookmarkNode[];
};

/**
 * 双向同步：合并本地与远程书签树，上传合并结果
 */
export async function syncCloudBookmarks(
  provider: CloudProvider,
  deviceId: string,
  localTree: BrowserBookmarkNode[],
  createBookmark: (
    folderPath: string[],
    node: GistBookmarkNode,
  ) => Promise<void>,
): Promise<SyncResult> {
  const localGistTree = exportBookmarkTree(localTree);
  const deletedEntries = await getDeletedBookmarks();

  // 尝试拉取远程数据
  let remoteData: GistBookmarkData | null = null;
  try {
    const remoteInfo = await provider.getFileInfo(CLOUD_SYNC_BOOKMARK_FILENAME);
    if (remoteInfo) {
      const download = await provider.download(remoteInfo.fileId);
      const text = new TextDecoder().decode(download.data);
      const parsed = JSON.parse(text);
      if (parsed.version === 1) {
        remoteData = parsed as GistBookmarkData;
      }
    }
  } catch (e) {
    console.warn("[cloud-sync-bookmark] No remote data:", e);
  }

  if (remoteData) {
    const result = mergeBookmarks(
      localGistTree,
      remoteData.bookmarks,
      deletedEntries,
    );

    let added = 0;
    for (const entry of result.toAddLocal) {
      try {
        await createBookmark(entry.folderPath, entry.node);
        added++;
      } catch (err) {
        console.warn("[cloud-sync-bookmark] Failed to create bookmark:", err);
      }
    }

    if (result.toRemoveRemote.length > 0) {
      await removeFromDeletedBookmarks(result.toRemoveRemote);
    }

    const uploadData: GistBookmarkData = {
      version: 1,
      exportedAt: Date.now(),
      deviceId,
      bookmarks: result.merged,
    };
    const encoded = new TextEncoder().encode(
      JSON.stringify(uploadData, null, 2),
    );
    if (encoded.byteLength > MAX_UPLOAD_SIZE) {
      throw new CloudSyncError(
        `Bookmark sync data too large: ${(encoded.byteLength / 1024 / 1024).toFixed(1)} MB (limit ${(MAX_UPLOAD_SIZE / 1024 / 1024).toFixed(0)} MB) — try reducing bookmark count or folder scope`,
        "SIZE",
      );
    }
    await provider.upload(CLOUD_SYNC_BOOKMARK_FILENAME, encoded);

    return {
      added,
      removed: result.toRemoveRemote.length,
      uploaded: countUrls(result.merged),
      gistId: provider.name,
    };
  }

  // 首次上传
  const uploadData: GistBookmarkData = {
    version: 1,
    exportedAt: Date.now(),
    deviceId,
    bookmarks: localGistTree,
  };
  const encoded = new TextEncoder().encode(
    JSON.stringify(uploadData, null, 2),
  );
  if (encoded.byteLength > MAX_UPLOAD_SIZE) {
    throw new CloudSyncError(
      `Bookmark sync data too large: ${(encoded.byteLength / 1024 / 1024).toFixed(1)} MB (limit ${(MAX_UPLOAD_SIZE / 1024 / 1024).toFixed(0)} MB) — try reducing bookmark count or folder scope`,
      "SIZE",
    );
  }
  await provider.upload(CLOUD_SYNC_BOOKMARK_FILENAME, encoded);

  return {
    added: 0,
    removed: 0,
    uploaded: countUrls(localGistTree),
    gistId: provider.name,
  };
}

/**
 * 上传覆盖：用本地书签全量替换远程内容
 */
export async function uploadCloudBookmarks(
  provider: CloudProvider,
  deviceId: string,
  localTree: BrowserBookmarkNode[],
): Promise<SyncResult> {
  const localGistTree = exportBookmarkTree(localTree);
  const uploadData: GistBookmarkData = {
    version: 1,
    exportedAt: Date.now(),
    deviceId,
    bookmarks: localGistTree,
  };
  const encoded = new TextEncoder().encode(
    JSON.stringify(uploadData, null, 2),
  );
  if (encoded.byteLength > MAX_UPLOAD_SIZE) {
    throw new CloudSyncError(
      `Bookmark sync data too large: ${(encoded.byteLength / 1024 / 1024).toFixed(1)} MB (limit ${(MAX_UPLOAD_SIZE / 1024 / 1024).toFixed(0)} MB) — try reducing bookmark count or folder scope`,
      "SIZE",
    );
  }
  await provider.upload(CLOUD_SYNC_BOOKMARK_FILENAME, encoded);

  return {
    added: 0,
    removed: 0,
    uploaded: countUrls(localGistTree),
    gistId: provider.name,
  };
}

/**
 * 下载覆盖：用远程内容全量替换本地书签
 */
export async function downloadCloudBookmarks(
  provider: CloudProvider,
  localTree: BrowserBookmarkNode[],
  getLocalTree: () => Promise<BrowserBookmarkNode[]>,
  removeTree: (id: string) => Promise<void>,
  createBookmark: (
    folderPath: string[],
    node: GistBookmarkNode,
  ) => Promise<void>,
): Promise<SyncResult> {
  const remoteInfo = await provider.getFileInfo(CLOUD_SYNC_BOOKMARK_FILENAME);
  if (!remoteInfo) {
    throw new CloudSyncError(
      "Remote bookmark file not found",
      "NOT_FOUND",
    );
  }

  const download = await provider.download(remoteInfo.fileId);
  const text = new TextDecoder().decode(download.data);
  const remoteData = JSON.parse(text) as GistBookmarkData;
  if (remoteData.version !== 1) {
    throw new CloudSyncError(
      `Unsupported version: ${remoteData.version}`,
      "VERSION",
    );
  }

  const localSnapshot = exportBookmarkTree(localTree);
  const remoteRoots = getWritableRoot(validateBookmarkTreeData(remoteData.bookmarks));

  let cleared = 0;
  let added = 0;
  try {
    cleared = await clearLocalBookmarks(localTree, removeTree);
    added = await restoreBookmarkTree(remoteRoots, createBookmark);
  } catch (error) {
    console.error(
      "[cloud-sync-bookmark] Download restore failed, rolling back local snapshot:",
      error,
    );
    try {
      const currentTree = await getLocalTree();
      await clearLocalBookmarks(currentTree, removeTree);
      await restoreBookmarkTree(localSnapshot, createBookmark);
    } catch (rollbackError) {
      throw new CloudSyncError(
        `Cloud bookmark download failed and rollback was unsuccessful: ${
          rollbackError instanceof Error ? rollbackError.message : String(rollbackError)
        }`,
        "UNKNOWN",
      );
    }
    throw new CloudSyncError(
      `Cloud bookmark download failed after restoring the previous local snapshot: ${
        error instanceof Error ? error.message : String(error)
      }`,
      "UNKNOWN",
    );
  }

  return {
    added,
    removed: cleared,
    uploaded: 0,
    gistId: provider.name,
  };
}

export { ensureDeviceId };
