/**
 * WebDAV provider — 使用 Basic Auth 通过 WebDAV 协议同步
 *
 * 兼容 Nextcloud / ownCloud / Nginx WebDAV / Caddy WebDAV 等实现。
 * - serverUrl: WebDAV 目录 URL，例如 https://dav.example.com/dav/files/user/
 * - username + password: Basic Auth 凭据
 *
 * 文件命名：直接在 serverUrl 目录下存放 CLOUD_SYNC_FILENAME
 */
import {
  CloudSyncError,
  CLOUD_SYNC_FILENAME,
  type CloudProvider,
  type CloudFileInfo,
  type CloudUploadResult,
  type CloudDownloadResult,
} from "./types";

const MAX_RETRIES = 3;
const RETRY_BASE_MS = 1500;

/** 创建 WebDAV provider */
export function createWebDAVProvider(
  serverUrl: string,
  username: string,
  password: string,
  filename: string = CLOUD_SYNC_FILENAME,
): CloudProvider {
  if (!serverUrl || !username || !password) {
    throw new CloudSyncError("WebDAV configuration incomplete", "AUTH");
  }

  // 确保 serverUrl 以 / 结尾
  const baseUrl = serverUrl.endsWith("/") ? serverUrl : serverUrl + "/";
  const authHeader = "Basic " + btoa(`${username}:${password}`);

  return {
    name: "webdav",

    async testConnection(signal?: AbortSignal): Promise<boolean> {
      // OPTIONS 请求验证连接，不需要文件存在
      const res = await fetchWithRetry(
        baseUrl,
        { method: "OPTIONS", headers: { Authorization: authHeader } },
        signal,
      );
      if (res.status === 401 || res.status === 403) {
        throw new CloudSyncError(
          `WebDAV auth failed (${res.status})`,
          "AUTH",
        );
      }
      // 部分服务器对根目录返回 404/405，但实际可写；只要非 auth 错误都视为成功
      return res.status !== 401 && res.status !== 403;
    },

    async getFileInfo(
      targetFilename: string,
      _fileId?: string,
      signal?: AbortSignal,
    ): Promise<CloudFileInfo | null> {
      const targetFileUrl = baseUrl + encodeURIComponent(targetFilename);
      // PROPFIND depth:0 获取文件元信息
      const res = await fetchWithRetry(
        targetFileUrl,
        {
          method: "PROPFIND",
          headers: {
            Authorization: authHeader,
            Depth: "0",
            "Content-Type": "application/xml; charset=utf-8",
          },
          body: PROPFIND_BODY,
        },
        signal,
      );

      if (res.status === 404) return null;
      if (res.status === 401 || res.status === 403) {
        throw new CloudSyncError(
          `WebDAV auth failed (${res.status})`,
          "AUTH",
        );
      }
      if (!res.ok && res.status !== 207) {
        throw new CloudSyncError(
          `WebDAV PROPFIND error ${res.status}`,
          "NETWORK",
        );
      }

      const text = await res.text();
      const modifiedAt = parseLastModified(text);
      const size = parseContentLength(text);

      return {
        fileId: targetFileUrl,
        name: targetFilename,
        modifiedAt,
        size,
      };
    },

    async upload(
      targetFilename: string,
      data: Uint8Array,
      _existingFileId?: string,
      signal?: AbortSignal,
    ): Promise<CloudUploadResult> {
      const targetFileUrl = baseUrl + encodeURIComponent(targetFilename);
      // PUT 直接覆写（WebDAV PUT 语义天然幂等）
      const res = await fetchWithRetry(
        targetFileUrl,
        {
          method: "PUT",
          headers: {
            Authorization: authHeader,
            "Content-Type": "application/octet-stream",
            "Content-Length": String(data.byteLength),
          },
          body: data as BodyInit,
        },
        signal,
      );

      if (res.status === 401 || res.status === 403) {
        throw new CloudSyncError(
          `WebDAV auth failed (${res.status})`,
          "AUTH",
        );
      }
      // 201 Created / 204 No Content 都是成功
      if (!res.ok) {
        throw new CloudSyncError(
          `WebDAV PUT error ${res.status}: ${res.statusText}`,
          "NETWORK",
        );
      }

      // PUT 响应通常无 body，用当前时间作为 modifiedAt
      return {
        fileId: targetFileUrl,
        uploadedAt: Date.now(),
        size: data.byteLength,
      };
    },

    async download(
      fileId: string,
      signal?: AbortSignal,
    ): Promise<CloudDownloadResult> {
      const res = await fetchWithRetry(
        fileId,
        {
          method: "GET",
          headers: { Authorization: authHeader },
        },
        signal,
      );

      if (res.status === 404) {
        throw new CloudSyncError("Remote sync file not found", "NOT_FOUND");
      }
      if (res.status === 401 || res.status === 403) {
        throw new CloudSyncError(
          `WebDAV auth failed (${res.status})`,
          "AUTH",
        );
      }
      if (!res.ok) {
        throw new CloudSyncError(
          `WebDAV GET error ${res.status}: ${res.statusText}`,
          "NETWORK",
        );
      }

      const buf = await res.arrayBuffer();
      // Last-Modified header 转时间戳
      const lastModifiedHeader = res.headers.get("Last-Modified");
      const modifiedAt = lastModifiedHeader
        ? Date.parse(lastModifiedHeader)
        : Date.now();

      return { data: new Uint8Array(buf), modifiedAt };
    },

    async deleteFile(fileId: string, signal?: AbortSignal): Promise<void> {
      const res = await fetchWithRetry(
        fileId,
        {
          method: "DELETE",
          headers: { Authorization: authHeader },
        },
        signal,
      );

      if (res.status === 404) return; // 已不存在，忽略
      if (res.status === 401 || res.status === 403) {
        throw new CloudSyncError(
          `WebDAV auth failed (${res.status})`,
          "AUTH",
        );
      }
      if (!res.ok) {
        throw new CloudSyncError(
          `WebDAV DELETE error ${res.status}: ${res.statusText}`,
          "NETWORK",
        );
      }
    },
  };
}

/** PROPFIND 请求体，获取 getlastmodified + getcontentlength */
const PROPFIND_BODY = `<?xml version="1.0" encoding="utf-8"?>
<D:propfind xmlns:D="DAV:">
  <D:prop>
    <D:getlastmodified/>
    <D:getcontentlength/>
  </D:prop>
</D:propfind>`;

/** 从 PROPFIND XML 响应中提取 Last-Modified */
function parseLastModified(xml: string): number {
  const match = xml.match(/<[^:>]*:?getlastmodified[^>]*>([^<]+)<\/[^>]+>/i);
  if (match?.[1]) {
    const ts = Date.parse(match[1].trim());
    if (!Number.isNaN(ts)) return ts;
  }
  return Date.now();
}

/** 从 PROPFIND XML 响应中提取 Content-Length */
function parseContentLength(xml: string): number | undefined {
  const match = xml.match(/<[^:>]*:?getcontentlength[^>]*>(\d+)<\/[^>]+>/i);
  if (match?.[1]) return Number(match[1]);
  return undefined;
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
            `[webdav] ${res.status}, retry ${attempt + 1}/${MAX_RETRIES} in ${delay}ms`,
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
          `WebDAV network error: ${e instanceof Error ? e.message : String(e)}`,
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
