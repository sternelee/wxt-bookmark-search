/**
 * Cloud sync — orchestration layer
 * 将 provider + blob 序列化 + settings 持久化粘合在一起
 */
import { getSettings, saveSettings } from "../db";
import { createDropboxProvider } from "./dropbox";
import { createGoogleDriveProvider } from "./google-drive";
import { createWebDAVProvider } from "./webdav";
import {
  buildSyncBlob,
  deserializeSyncBlob,
  ensureSearchEngineReady,
  generateDeviceId,
  importSyncBlob,
  serializeSyncBlob,
} from "./blob";
import {
  CLOUD_SYNC_FILENAME,
  CloudSyncError,
  type CloudFileInfo,
  type CloudProvider,
  type CloudProviderName,
} from "./types";

export type { CloudProvider, CloudProviderName } from "./types";
export { CloudSyncError } from "./types";
export {
  syncCloudBookmarks,
  uploadCloudBookmarks,
  downloadCloudBookmarks,
  ensureDeviceId as ensureCloudBookmarkDeviceId,
} from "./bookmark-sync";

/** 上传结果 */
export interface CloudUploadOutcome {
  fileId: string;
  uploadedAt: number;
  size: number;
}

/** 下载结果（已 import 到本地） */
export interface CloudDownloadOutcome {
  bookmarkCount: number;
  modifiedAt: number;
  fileId: string;
}

/** 远程状态 */
export interface CloudRemoteStatus {
  exists: boolean;
  fileId?: string;
  modifiedAt?: number;
  size?: number;
}

/**
 * 基于 settings 创建 provider 实例，若未配置返回 null
 */
export function getCloudProvider(settings: {
  cloudSyncProvider?: CloudProviderName | null;
  cloudSyncToken?: string;         // Dropbox/Google token; also WebDAV password
  cloudSyncWebdavUrl?: string;
  cloudSyncWebdavUsername?: string;
}): CloudProvider | null {
  const name = settings.cloudSyncProvider;
  if (!name) return null;
  switch (name) {
    case "google-drive": {
      if (!settings.cloudSyncToken) return null;
      return createGoogleDriveProvider(settings.cloudSyncToken);
    }
    case "dropbox": {
      if (!settings.cloudSyncToken) return null;
      return createDropboxProvider(settings.cloudSyncToken);
    }
    case "webdav": {
      const { cloudSyncWebdavUrl, cloudSyncWebdavUsername, cloudSyncToken } =
        settings;
      if (
        !cloudSyncWebdavUrl ||
        !cloudSyncWebdavUsername ||
        !cloudSyncToken
      )
        return null;
      return createWebDAVProvider(
        cloudSyncWebdavUrl,
        cloudSyncWebdavUsername,
        cloudSyncToken,
      );
    }
    default:
      return null;
  }
}

/** 确保 settings.cloudSyncDeviceId 存在 */
async function ensureDeviceId(): Promise<string> {
  const settings = await getSettings();
  if (settings.cloudSyncDeviceId) return settings.cloudSyncDeviceId;
  const deviceId = generateDeviceId();
  await saveSettings({ cloudSyncDeviceId: deviceId });
  return deviceId;
}

/** 测试 provider 连接 */
export async function testCloudConnection(
  provider: CloudProvider,
  signal?: AbortSignal,
): Promise<boolean> {
  return provider.testConnection(signal);
}

/** 获取远程文件元信息 */
export async function getCloudSyncStatus(
  provider: CloudProvider,
  signal?: AbortSignal,
): Promise<CloudRemoteStatus> {
  const settings = await getSettings();
  const info = await provider.getFileInfo(
    CLOUD_SYNC_FILENAME,
    settings.cloudSyncFileId,
    signal,
  );
  if (!info) return { exists: false };
  return {
    exists: true,
    fileId: info.fileId,
    modifiedAt: info.modifiedAt,
    size: info.size,
  };
}

/** 上传当前本地数据 */
export async function uploadCloudSync(
  provider: CloudProvider,
  signal?: AbortSignal,
): Promise<CloudUploadOutcome> {
  await ensureSearchEngineReady();
  const deviceId = await ensureDeviceId();
  const blob = await buildSyncBlob(deviceId);
  const payload = await serializeSyncBlob(blob);

  const settings = await getSettings();
  const result = await provider.upload(
    CLOUD_SYNC_FILENAME,
    payload,
    settings.cloudSyncFileId,
    signal,
  );

  await saveSettings({
    cloudSyncFileId: result.fileId,
    lastCloudSync: result.uploadedAt,
  });

  return {
    fileId: result.fileId,
    uploadedAt: result.uploadedAt,
    size: result.size,
  };
}

/** 从远程下载并全量替换本地 */
export async function downloadCloudSync(
  provider: CloudProvider,
  signal?: AbortSignal,
): Promise<CloudDownloadOutcome> {
  await ensureSearchEngineReady();
  const settings = await getSettings();
  const info: CloudFileInfo | null = await provider.getFileInfo(
    CLOUD_SYNC_FILENAME,
    settings.cloudSyncFileId,
    signal,
  );
  if (!info) {
    throw new CloudSyncError("Remote sync file not found", "NOT_FOUND");
  }
  const { data, modifiedAt } = await provider.download(info.fileId, signal);
  const blob = await deserializeSyncBlob(data);
  const { bookmarkCount } = await importSyncBlob(blob);

  await saveSettings({
    cloudSyncFileId: info.fileId,
    lastCloudSync: modifiedAt,
  });

  return {
    bookmarkCount,
    modifiedAt,
    fileId: info.fileId,
  };
}

/** 删除远程同步文件，并清空本地相关 settings */
export async function deleteCloudSync(
  provider: CloudProvider,
  signal?: AbortSignal,
): Promise<void> {
  const settings = await getSettings();
  const fileId =
    settings.cloudSyncFileId ??
    (await provider.getFileInfo(CLOUD_SYNC_FILENAME, undefined, signal))?.fileId;
  if (fileId) {
    try {
      await provider.deleteFile(fileId, signal);
    } catch (e) {
      if (e instanceof CloudSyncError && e.code === "NOT_FOUND") {
        // 已不存在，忽略
      } else {
        throw e;
      }
    }
  }
  await saveSettings({
    cloudSyncFileId: undefined,
    lastCloudSync: undefined,
  });
}
