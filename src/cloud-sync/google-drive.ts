/**
 * Google Drive provider — 使用手动 Access Token 调用 Drive v3 REST API
 */
import {
  CloudSyncError,
  type CloudProvider,
  type CloudFileInfo,
  type CloudUploadResult,
  type CloudDownloadResult,
} from "./types";

const DRIVE_API_BASE = "https://www.googleapis.com/drive/v3";
const DRIVE_UPLOAD_BASE = "https://www.googleapis.com/upload/drive/v3";

const MAX_RETRIES = 3;
const RETRY_BASE_MS = 1500;

interface DriveFile {
  id: string;
  name: string;
  modifiedTime?: string;
  size?: string;
}

interface DriveListResponse {
  files?: DriveFile[];
}

/** 创建 Google Drive provider */
export function createGoogleDriveProvider(token: string): CloudProvider {
  if (!token) {
    throw new CloudSyncError("Google Drive access token missing", "AUTH");
  }

  return {
    name: "google-drive",

    async testConnection(signal?: AbortSignal): Promise<boolean> {
      const res = await fetchWithRetry(
        `${DRIVE_API_BASE}/about?fields=user(emailAddress)`,
        { headers: authHeader(token) },
        signal,
      );
      if (res.status === 401 || res.status === 403) {
        throw new CloudSyncError(
          "Google Drive token unauthorized",
          "AUTH",
        );
      }
      return res.ok;
    },

    async getFileInfo(
      filename,
      fileId,
      signal,
    ): Promise<CloudFileInfo | null> {
      if (fileId) {
        const res = await fetchWithRetry(
          `${DRIVE_API_BASE}/files/${encodeURIComponent(
            fileId,
          )}?fields=id,name,modifiedTime,size`,
          { headers: authHeader(token) },
          signal,
        );
        if (res.status === 404) return null;
        await assertOk(res);
        const file = (await res.json()) as DriveFile;
        return driveFileToInfo(file);
      }
      // 按文件名查找
      const q = encodeURIComponent(`name='${filename}' and trashed=false`);
      const res = await fetchWithRetry(
        `${DRIVE_API_BASE}/files?q=${q}&fields=files(id,name,modifiedTime,size)&pageSize=10&orderBy=modifiedTime desc`,
        { headers: authHeader(token) },
        signal,
      );
      await assertOk(res);
      const data = (await res.json()) as DriveListResponse;
      const file = data.files?.[0];
      return file ? driveFileToInfo(file) : null;
    },

    async upload(
      filename,
      data,
      existingFileId,
      signal,
    ): Promise<CloudUploadResult> {
      const boundary = `flowsearch-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2)}`;
      const metadata = existingFileId
        ? {}
        : { name: filename, mimeType: "application/gzip" };
      const body = buildMultipartBody(boundary, metadata, data);

      const url = existingFileId
        ? `${DRIVE_UPLOAD_BASE}/files/${encodeURIComponent(
            existingFileId,
          )}?uploadType=multipart&fields=id,modifiedTime,size`
        : `${DRIVE_UPLOAD_BASE}/files?uploadType=multipart&fields=id,modifiedTime,size`;

      const method = existingFileId ? "PATCH" : "POST";

      const res = await fetchWithRetry(
        url,
        {
          method,
          headers: {
            ...authHeader(token),
            "Content-Type": `multipart/related; boundary=${boundary}`,
          },
          body: body as BodyInit,
        },
        signal,
      );
      await assertOk(res);
      const file = (await res.json()) as DriveFile;
      const info = driveFileToInfo(file);
      return {
        fileId: info.fileId,
        uploadedAt: info.modifiedAt,
        size: info.size ?? data.byteLength,
      };
    },

    async download(fileId, signal): Promise<CloudDownloadResult> {
      const [metaRes, dataRes] = await Promise.all([
        fetchWithRetry(
          `${DRIVE_API_BASE}/files/${encodeURIComponent(
            fileId,
          )}?fields=modifiedTime,size`,
          { headers: authHeader(token) },
          signal,
        ),
        fetchWithRetry(
          `${DRIVE_API_BASE}/files/${encodeURIComponent(
            fileId,
          )}?alt=media`,
          { headers: authHeader(token) },
          signal,
        ),
      ]);
      if (metaRes.status === 404 || dataRes.status === 404) {
        throw new CloudSyncError("Remote file not found", "NOT_FOUND");
      }
      await assertOk(metaRes);
      await assertOk(dataRes);
      const meta = (await metaRes.json()) as DriveFile;
      const buf = await dataRes.arrayBuffer();
      return {
        data: new Uint8Array(buf),
        modifiedAt: meta.modifiedTime
          ? Date.parse(meta.modifiedTime)
          : Date.now(),
      };
    },

    async deleteFile(fileId, signal): Promise<void> {
      const res = await fetchWithRetry(
        `${DRIVE_API_BASE}/files/${encodeURIComponent(fileId)}`,
        { method: "DELETE", headers: authHeader(token) },
        signal,
      );
      if (res.status === 404) return;
      await assertOk(res);
    },
  };
}

function authHeader(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}` };
}

function driveFileToInfo(file: DriveFile): CloudFileInfo {
  return {
    fileId: file.id,
    name: file.name,
    modifiedAt: file.modifiedTime ? Date.parse(file.modifiedTime) : 0,
    size: file.size ? Number(file.size) : undefined,
  };
}

/** 构造 multipart/related body（Google 推荐的多部分上传格式） */
function buildMultipartBody(
  boundary: string,
  metadata: Record<string, unknown>,
  data: Uint8Array,
): Uint8Array {
  const enc = new TextEncoder();
  const head =
    `--${boundary}\r\n` +
    `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
    `${JSON.stringify(metadata)}\r\n` +
    `--${boundary}\r\n` +
    `Content-Type: application/gzip\r\n` +
    `Content-Transfer-Encoding: base64\r\n\r\n`;
  const tail = `\r\n--${boundary}--\r\n`;
  const base64Body = uint8ToBase64(data);

  const headBytes = enc.encode(head);
  const bodyBytes = enc.encode(base64Body);
  const tailBytes = enc.encode(tail);

  const out = new Uint8Array(
    headBytes.byteLength + bodyBytes.byteLength + tailBytes.byteLength,
  );
  out.set(headBytes, 0);
  out.set(bodyBytes, headBytes.byteLength);
  out.set(tailBytes, headBytes.byteLength + bodyBytes.byteLength);
  return out;
}

function uint8ToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.byteLength; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

async function assertOk(res: Response): Promise<void> {
  if (res.ok) return;
  let detail = "";
  try {
    const body = (await res.json()) as {
      error?: { message?: string };
    };
    detail = body.error?.message || "";
  } catch {
    detail = await res.text().catch(() => "");
  }
  if (res.status === 401 || res.status === 403) {
    throw new CloudSyncError(
      `Google Drive auth failed (${res.status}): ${detail}`,
      "AUTH",
    );
  }
  if (res.status === 404) {
    throw new CloudSyncError(`Not found (${res.status}): ${detail}`, "NOT_FOUND");
  }
  throw new CloudSyncError(
    `Google Drive error ${res.status}: ${detail}`,
    "NETWORK",
  );
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
            `[gdrive] ${res.status}, retry ${attempt + 1}/${MAX_RETRIES} in ${delay}ms`,
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
