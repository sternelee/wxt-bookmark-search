/**
 * Cloud sync types — provider 抽象 + 同步 blob 结构
 */
import type { RawData } from "@orama/orama";
import type { BookmarkRecord, SearchMode } from "../types";

/** Provider 名称 */
export type CloudProviderName = "google-drive" | "dropbox" | "webdav";

/** 远程文件元信息 */
export interface CloudFileInfo {
  /** Provider 侧 ID（Google Drive fileId / Dropbox path） */
  fileId: string;
  /** 文件名 */
  name: string;
  /** 修改时间戳（毫秒） */
  modifiedAt: number;
  /** 文件大小（字节，可选） */
  size?: number;
}

/** 上传结果 */
export interface CloudUploadResult {
  fileId: string;
  uploadedAt: number;
  size: number;
}

/** 下载结果 */
export interface CloudDownloadResult {
  data: Uint8Array;
  modifiedAt: number;
}

/**
 * 云存储 provider 接口 — 所有 provider 实现统一 API
 */
export interface CloudProvider {
  readonly name: CloudProviderName;
  /** 测试连接（验证 token 是否有效） */
  testConnection(signal?: AbortSignal): Promise<boolean>;
  /** 获取目标文件元信息（若存在） */
  getFileInfo(
    filename: string,
    fileId?: string,
    signal?: AbortSignal,
  ): Promise<CloudFileInfo | null>;
  /** 上传文件（自动 create or update） */
  upload(
    filename: string,
    data: Uint8Array,
    existingFileId?: string,
    signal?: AbortSignal,
  ): Promise<CloudUploadResult>;
  /** 下载文件 */
  download(
    fileId: string,
    signal?: AbortSignal,
  ): Promise<CloudDownloadResult>;
  /** 删除文件 */
  deleteFile(fileId: string, signal?: AbortSignal): Promise<void>;
}

/** 同步 blob 内嵌的设置字段（不含密钥） */
export interface CloudSyncSettingsSubset {
  searchMode?: SearchMode;
  vectorWeight?: number;
  language?: string;
  embeddingModel?: string;
  llmModel?: string;
  baseURL?: string;
  embedBaseURL?: string;
  llmBaseURL?: string;
  selectedFolderIds?: string[];
  categoryFolderMap?: Record<string, string>;
  categoryRules?: string;
  historyDays?: number;
}

/** 云同步 blob 结构 */
export interface CloudSyncBlob {
  version: 1;
  exportedAt: number;
  deviceId: string;
  bookmarks: BookmarkRecord[];
  oramaIndex: RawData | null;
  settings: CloudSyncSettingsSubset;
}

/** 云同步错误 */
export class CloudSyncError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "AUTH"
      | "NETWORK"
      | "NOT_FOUND"
      | "VERSION"
      | "SIZE"
      | "UNKNOWN",
  ) {
    super(message);
    this.name = "CloudSyncError";
  }
}

/** 远程文件名（向量数据库同步） */
export const CLOUD_SYNC_FILENAME = "flow-search-sync.json.gz";

/** 远程文件名（书签树同步） */
export const CLOUD_SYNC_BOOKMARK_FILENAME = "flow-search-bookmarks.json";

/** 单次上传大小硬上限（防止 OOM 或异常数据） */
export const MAX_UPLOAD_SIZE = 100 * 1024 * 1024; // 100 MB
