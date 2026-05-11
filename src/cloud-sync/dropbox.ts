/**
 * Dropbox provider — 使用手动 Access Token 调用 Dropbox API v2
 */
import {
  CloudSyncError,
  type CloudProvider,
  type CloudFileInfo,
  type CloudUploadResult,
  type CloudDownloadResult,
} from "./types";

const DROPBOX_API_BASE = "https://api.dropboxapi.com/2";
const DROPBOX_CONTENT_BASE = "https://content.dropboxapi.com/2";
const DROPBOX_FOLDER = "/flow-search";

const MAX_RETRIES = 3;
const RETRY_BASE_MS = 1500;

interface DropboxMetadata {
  ".tag": "file" | "folder" | "deleted";
  id: string;
  name: string;
  path_lower?: string;
  path_display?: string;
  server_modified?: string;
  client_modified?: string;
  size?: number;
}

/** 创建 Dropbox provider */
export function createDropboxProvider(token: string): CloudProvider {
  if (!token) {
    throw new CloudSyncError("Dropbox access token missing", "AUTH");
  }

  return {
    name: "dropbox",

    async testConnection(signal?: AbortSignal): Promise<boolean> {
      const res = await fetchWithRetry(
        `${DROPBOX_API_BASE}/users/get_current_account`,
        {
          method: "POST",
          headers: {
            ...authHeader(token),
            "Content-Type": "application/json",
          },
          body: "null",
        },
        signal,
      );
      if (res.status === 401) {
        throw new CloudSyncError(
          "Dropbox token unauthorized",
          "AUTH",
        );
      }
      return res.ok;
    },

    async getFileInfo(filename, _fileId, signal): Promise<CloudFileInfo | null> {
      const path = `${DROPBOX_FOLDER}/${filename}`;
      const res = await fetchWithRetry(
        `${DROPBOX_API_BASE}/files/get_metadata`,
        {
          method: "POST",
          headers: {
            ...authHeader(token),
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ path }),
        },
        signal,
      );
      if (res.status === 409) return null; // path/not_found
      if (!res.ok) {
        const detail = await readError(res);
        if (
          res.status === 409 ||
          /not_found/i.test(detail) ||
          /missing/i.test(detail)
        ) {
          return null;
        }
        if (res.status === 401) {
          throw new CloudSyncError(
            `Dropbox auth failed: ${detail}`,
            "AUTH",
          );
        }
        throw new CloudSyncError(
          `Dropbox error ${res.status}: ${detail}`,
          "NETWORK",
        );
      }
      const meta = (await res.json()) as DropboxMetadata;
      return metadataToInfo(meta, path);
    },

    async upload(
      filename,
      data,
      _existingFileId,
      signal,
    ): Promise<CloudUploadResult> {
      const path = `${DROPBOX_FOLDER}/${filename}`;
      const arg = JSON.stringify({
        path,
        mode: "overwrite",
        autorename: false,
        mute: true,
        strict_conflict: false,
      });
      const res = await fetchWithRetry(
        `${DROPBOX_CONTENT_BASE}/files/upload`,
        {
          method: "POST",
          headers: {
            ...authHeader(token),
            "Content-Type": "application/octet-stream",
            "Dropbox-API-Arg": arg,
          },
          body: data as BodyInit,
        },
        signal,
      );
      if (!res.ok) {
        const detail = await readError(res);
        if (res.status === 401) {
          throw new CloudSyncError(`Dropbox auth failed: ${detail}`, "AUTH");
        }
        throw new CloudSyncError(
          `Dropbox upload error ${res.status}: ${detail}`,
          "NETWORK",
        );
      }
      const meta = (await res.json()) as DropboxMetadata;
      const info = metadataToInfo(meta, path);
      return {
        fileId: info.fileId,
        uploadedAt: info.modifiedAt,
        size: info.size ?? data.byteLength,
      };
    },

    async download(fileId, signal): Promise<CloudDownloadResult> {
      // 对于 Dropbox，fileId 即为 path
      const arg = JSON.stringify({ path: fileId });
      const res = await fetchWithRetry(
        `${DROPBOX_CONTENT_BASE}/files/download`,
        {
          method: "POST",
          headers: {
            ...authHeader(token),
            "Dropbox-API-Arg": arg,
          },
        },
        signal,
      );
      if (res.status === 409) {
        throw new CloudSyncError("Remote file not found", "NOT_FOUND");
      }
      if (!res.ok) {
        const detail = await readError(res);
        if (res.status === 401) {
          throw new CloudSyncError(`Dropbox auth failed: ${detail}`, "AUTH");
        }
        throw new CloudSyncError(
          `Dropbox download error ${res.status}: ${detail}`,
          "NETWORK",
        );
      }
      const meta = res.headers.get("Dropbox-API-Result");
      let modifiedAt = Date.now();
      if (meta) {
        try {
          const parsed = JSON.parse(meta) as DropboxMetadata;
          modifiedAt = parsed.server_modified
            ? Date.parse(parsed.server_modified)
            : Date.now();
        } catch {
          /* keep default */
        }
      }
      const buf = await res.arrayBuffer();
      return { data: new Uint8Array(buf), modifiedAt };
    },

    async deleteFile(fileId, signal): Promise<void> {
      const res = await fetchWithRetry(
        `${DROPBOX_API_BASE}/files/delete_v2`,
        {
          method: "POST",
          headers: {
            ...authHeader(token),
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ path: fileId }),
        },
        signal,
      );
      if (res.ok || res.status === 409) return;
      const detail = await readError(res);
      throw new CloudSyncError(
        `Dropbox delete error ${res.status}: ${detail}`,
        "NETWORK",
      );
    },
  };
}

function authHeader(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}` };
}

function metadataToInfo(meta: DropboxMetadata, path: string): CloudFileInfo {
  const modifiedAt = meta.server_modified
    ? Date.parse(meta.server_modified)
    : meta.client_modified
      ? Date.parse(meta.client_modified)
      : 0;
  return {
    fileId: meta.path_display || meta.path_lower || path,
    name: meta.name,
    modifiedAt,
    size: meta.size,
  };
}

async function readError(res: Response): Promise<string> {
  try {
    const json = await res.json();
    return typeof json === "string" ? json : JSON.stringify(json);
  } catch {
    return res.statusText || `HTTP ${res.status}`;
  }
}

async function fetchWithRetry(
  url: string,
  init: RequestInit,
  signal?: AbortSignal,
): Promise<Response> {
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(url, { ...init, signal });
      if (res.status === 429 || (res.status >= 500 && res.status < 600)) {
        if (attempt < MAX_RETRIES) {
          const delay = RETRY_BASE_MS * Math.pow(2, attempt);
          console.warn(
            `[dropbox] ${res.status}, retry ${attempt + 1}/${MAX_RETRIES} in ${delay}ms`,
          );
          await sleep(delay, signal);
          continue;
        }
      }
      return res;
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") throw e;
      if (attempt >= MAX_RETRIES) {
        throw new CloudSyncError(
          `Network error: ${e instanceof Error ? e.message : String(e)}`,
          "NETWORK",
        );
      }
      await sleep(RETRY_BASE_MS * Math.pow(2, attempt), signal);
    }
  }
  throw new CloudSyncError("Max retries exceeded", "NETWORK");
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    if (signal) {
      signal.addEventListener(
        "abort",
        () => {
          clearTimeout(t);
          reject(new DOMException("Aborted", "AbortError"));
        },
        { once: true },
      );
    }
  });
}
