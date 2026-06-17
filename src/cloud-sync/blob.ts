/**
 * Cloud sync blob — 序列化 / 反序列化 / 导入导出
 */
import { db, getSettings, saveSettings } from "../db";
import {
  saveSearchEngine,
  loadSearchEngine,
  initSearchEngine,
  isSearchEngineReady,
  populateSearchEngine,
  scheduleSaveSearchEngine,
} from "../search-engine";
import type { BookmarkRecord } from "../types";
import {
  CloudSyncError,
  type CloudSyncBlob,
  type CloudSyncSettingsSubset,
  MAX_UPLOAD_SIZE,
} from "./types";

const BLOB_VERSION = 1 as const;

/** 生成设备 UUID（沿用 gist-sync 模式） */
export function generateDeviceId(): string {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/** 提取可同步的 settings 字段（剔除 API key / token） */
function extractSyncableSettings(
  settings: Awaited<ReturnType<typeof getSettings>>,
): CloudSyncSettingsSubset {
  return {
    searchMode: settings.searchMode,
    vectorWeight: settings.vectorWeight,
    language: settings.language,
    embeddingModel: settings.embeddingModel,
    llmModel: settings.llmModel,
    baseURL: settings.baseURL,
    embedBaseURL: settings.embedBaseURL,
    llmBaseURL: settings.llmBaseURL,
    selectedFolderIds: settings.selectedFolderIds,
    categoryFolderMap: settings.categoryFolderMap,
    categoryRules: settings.categoryRules,
    historyDays: settings.historyDays,
  };
}

/** 构建本地完整同步 blob */
export async function buildSyncBlob(deviceId: string): Promise<CloudSyncBlob> {
  const [bookmarks, settings] = await Promise.all([
    db.bookmarks.toArray(),
    getSettings(),
  ]);
  const oramaIndex = saveSearchEngine();
  return {
    version: BLOB_VERSION,
    exportedAt: Date.now(),
    deviceId,
    bookmarks,
    oramaIndex,
    settings: extractSyncableSettings(settings),
  };
}

/** 将远程 blob 导入本地（全量替换） */
export async function importSyncBlob(blob: CloudSyncBlob): Promise<{
  bookmarkCount: number;
}> {
  if (blob.version !== BLOB_VERSION) {
    throw new CloudSyncError(
      `Unsupported blob version: ${blob.version}`,
      "VERSION",
    );
  }
  if (!Array.isArray(blob.bookmarks)) {
    throw new CloudSyncError("Invalid blob: bookmarks missing", "VERSION");
  }

  // 清空 + 导入 Dexie
  await db.bookmarks.clear();
  if (blob.bookmarks.length > 0) {
    // 剥离内存专用字段
    const records: BookmarkRecord[] = blob.bookmarks.map((b) => {
      const { _embeddingNorm, ...rest } = b;
      void _embeddingNorm;
      return rest as BookmarkRecord;
    });
    await db.bookmarks.bulkPut(records);
  }

  // 重新初始化搜索引擎并加载 Orama 状态
  await initSearchEngine();
  if (blob.oramaIndex) {
    try {
      loadSearchEngine(blob.oramaIndex);
    } catch (e) {
      console.warn(
        "[cloud-sync] loadSearchEngine failed, repopulating from Dexie:",
        e,
      );
      const indexed = await db.bookmarks
        .where("status")
        .equals("indexed")
        .toArray();
      await populateSearchEngine(indexed);
    }
  } else {
    const indexed = await db.bookmarks
      .where("status")
      .equals("indexed")
      .toArray();
    await populateSearchEngine(indexed);
  }
  scheduleSaveSearchEngine();

  // 合并 settings 子集（保留本地 token / api key）
  if (blob.settings) {
    await saveSettings(blob.settings);
  }

  return { bookmarkCount: blob.bookmarks.length };
}

/** 将 blob 序列化为 gzip Uint8Array */
export async function serializeSyncBlob(
  blob: CloudSyncBlob,
): Promise<Uint8Array> {
  const json = JSON.stringify(blob);
  const encoded = new TextEncoder().encode(json);
  const compressed = await gzipCompress(encoded);
  if (compressed.byteLength > MAX_UPLOAD_SIZE) {
    throw new CloudSyncError(
      `Sync blob too large: ${compressed.byteLength} bytes (limit ${MAX_UPLOAD_SIZE})`,
      "SIZE",
    );
  }
  return compressed;
}

/** 解压并解析 gzip Uint8Array → blob */
export async function deserializeSyncBlob(
  data: Uint8Array,
): Promise<CloudSyncBlob> {
  let json: string;
  try {
    const decompressed = await gzipDecompress(data);
    json = new TextDecoder().decode(decompressed);
  } catch (e) {
    throw new CloudSyncError(
      `Failed to decompress: ${e instanceof Error ? e.message : String(e)}`,
      "VERSION",
    );
  }
  try {
    const parsed = JSON.parse(json) as CloudSyncBlob;
    if (parsed.version !== BLOB_VERSION) {
      throw new CloudSyncError(
        `Unsupported blob version: ${parsed.version}`,
        "VERSION",
      );
    }
    return parsed;
  } catch (e) {
    if (e instanceof CloudSyncError) throw e;
    throw new CloudSyncError(
      `Failed to parse blob: ${e instanceof Error ? e.message : String(e)}`,
      "VERSION",
    );
  }
}

/** gzip 压缩（原生 CompressionStream） */
async function gzipCompress(input: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([input as BlobPart]).stream().pipeThrough(
    new CompressionStream("gzip"),
  );
  const buf = await new Response(stream).arrayBuffer();
  return new Uint8Array(buf);
}

/** gzip 解压（原生 DecompressionStream） */
async function gzipDecompress(input: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([input as BlobPart]).stream().pipeThrough(
    new DecompressionStream("gzip"),
  );
  const buf = await new Response(stream).arrayBuffer();
  return new Uint8Array(buf);
}

/** 暴露：确保搜索引擎已初始化（导入前调用，避免空 engine 状态） */
export async function ensureSearchEngineReady(): Promise<void> {
  if (!isSearchEngineReady()) {
    await initSearchEngine();
  }
}
