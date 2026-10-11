/**
 * Flow Search · Markdown Reader Worker
 *
 * 自托管的 URL → Markdown 转换服务，替代不稳定的第三方服务
 * （markdown.new 限流 429/439、Jina Reader 限流）。
 *
 * 方案参考 Cloudflare「Markdown for Agents」：
 * https://blog.cloudflare.com/markdown-for-agents/
 *
 * 流程：
 * 1. 校验 URL（仅公网 http/https，拒绝内网/私网地址，防 SSRF）
 * 2. 服务端抓取上游页面，请求头带 Accept: text/markdown —— 若上游
 *    是启用了 Markdown for Agents 的 Cloudflare 站点，直接拿回 markdown
 *    （零成本快速路径）；否则拿到 HTML
 * 3. 通过 Workers AI env.AI.toMarkdown() 把 HTML（或 PDF 等任意文档）转成 markdown
 *
 * 部署后建议立即设置访问令牌防止被盗用：
 *   npx wrangler secret put AUTH_TOKEN
 */

/** Workers AI toMarkdown 的最小结构类型（避免依赖生成的类型文件） */
interface ToMarkdownInput {
  name: string;
  blob: Blob;
}

interface ConversionResult {
  name: string;
  format: "markdown" | "text" | "error";
  mimetype: string;
  tokens?: number;
  data?: string;
  error?: string;
}

interface Env {
  AI: {
    toMarkdown: (inputs?: ToMarkdownInput[]) => Promise<ConversionResult[]>;
  };
  /** 可选共享令牌；设置后请求必须带 Authorization: Bearer <token> */
  AUTH_TOKEN?: string;
}

/** 上游响应体大小上限（10 MB），防御超大页面拖垮转换 */
const MAX_BODY_BYTES = 10 * 1024 * 1024;

/** 上游抓取与转换的总超时 */
const FETCH_TIMEOUT_MS = 20_000;

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

function json(
  body: Record<string, unknown>,
  status = 200,
  extra: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...CORS_HEADERS,
      ...extra,
    },
  });
}

function errorResponse(message: string, status: number): Response {
  return json({ success: false, error: message }, status);
}

/** IPv4 私网段判断 */
function isPrivateIpv4Host(host: string): boolean {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!m) return false;
  const octets = m.slice(1).map(Number);
  if (octets.some((n) => n > 255)) return false;
  const [a, b] = octets as [number, number, number, number];
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168)
  );
}

/** 内网/私网主机判断（Worker 从 Cloudflare 边缘发起请求，命中也到不了，此为防御性校验） */
function isPrivateHost(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  return (
    normalized === "localhost" ||
    normalized.endsWith(".localhost") ||
    normalized === "0.0.0.0" ||
    normalized === "::1" ||
    normalized === "fe80::1" ||
    normalized.startsWith("fc") ||
    normalized.startsWith("fd") ||
    normalized.endsWith(".local") ||
    normalized.endsWith(".internal") ||
    normalized.endsWith(".home.arpa") ||
    isPrivateIpv4Host(normalized)
  );
}

/** 校验请求的目标 URL：仅允许公网 http/https */
function sanitizeTargetUrl(raw: string): { url: URL } | { error: string } {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return { error: "invalid url" };
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { error: `unsupported protocol: ${parsed.protocol}` };
  }
  if (isPrivateHost(parsed.hostname)) {
    return { error: "private addresses are not allowed" };
  }
  // 非标准端口拒绝（80/443 及省略端口之外）
  if (parsed.port && parsed.port !== "80" && parsed.port !== "443") {
    return { error: `unsupported port: ${parsed.port}` };
  }
  return { url: parsed };
}

function checkAuth(request: Request, env: Env): boolean {
  if (!env.AUTH_TOKEN) return true;
  const header = request.headers.get("Authorization") ?? "";
  return header === `Bearer ${env.AUTH_TOKEN}`;
}

async function handleMarkdown(request: Request, env: Env): Promise<Response> {
  const params = new URL(request.url).searchParams;
  const target = params.get("url");
  if (!target) {
    return errorResponse("missing required query param: url", 400);
  }

  const sanitized = sanitizeTargetUrl(target);
  if ("error" in sanitized) {
    return errorResponse(sanitized.error, 403);
  }
  const { url: targetUrl } = sanitized;

  console.log(`[markdown-reader] fetching ${targetUrl.toString()}`);
  let upstream: Response;
  try {
    upstream = await fetch(targetUrl.toString(), {
      // Markdown for Agents 内容协商：上游是启用了该功能的 Cloudflare 站点时
      // 直接返回 text/markdown，跳过转换
      headers: {
        Accept: "text/markdown, text/html",
        "User-Agent":
          "Mozilla/5.0 (compatible; FlowSearchMarkdownReader/1.0; +https://github.com/sternelee/wxt-bookmark-search)",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
  } catch (e) {
    return errorResponse(
      `upstream fetch failed: ${e instanceof Error ? e.message : String(e)}`,
      502,
    );
  }

  if (!upstream.ok) {
    return errorResponse(`upstream HTTP ${upstream.status}`, 502);
  }

  const declaredLength = Number(upstream.headers.get("Content-Length") ?? "0");
  if (declaredLength > MAX_BODY_BYTES) {
    return errorResponse("upstream document too large", 413);
  }

  const body = await upstream.arrayBuffer();
  if (body.byteLength > MAX_BODY_BYTES) {
    return errorResponse("upstream document too large", 413);
  }
  if (body.byteLength === 0) {
    return errorResponse("upstream returned empty body", 502);
  }

  const contentType = (
    upstream.headers.get("Content-Type") ?? ""
  ).toLowerCase();
  const name =
    targetUrl.pathname.split("/").filter(Boolean).pop() ?? "document";

  // 快速路径：上游已经是 markdown（Markdown for Agents 站点）
  if (contentType.startsWith("text/markdown")) {
    const markdown = new TextDecoder("utf-8").decode(body);
    return json(
      { success: true, markdown, mimetype: "text/markdown" },
      200,
      // 与 Cloudflare 官方响应对齐，方便调用方做 token 预算
      { "x-markdown-tokens": String(Math.ceil(markdown.length / 4)) },
    );
  }

  // 主路径：Workers AI toMarkdown 转换（HTML / PDF / 图片等均支持）
  let results: ConversionResult[];
  try {
    results = await env.AI.toMarkdown([
      {
        name: name.includes(".") ? name : `${name}.html`,
        blob: new Blob([body], { type: contentType || "text/html" }),
      },
    ]);
  } catch (e) {
    return errorResponse(
      `toMarkdown failed: ${e instanceof Error ? e.message : String(e)}`,
      500,
    );
  }

  const result = results[0];
  if (!result) {
    return errorResponse("toMarkdown returned no result", 500);
  }
  if (result.format === "error") {
    return errorResponse(
      `conversion failed: ${result.error ?? "unknown"}`,
      422,
    );
  }

  const markdown = result.data ?? "";
  if (markdown.trim().length === 0) {
    return errorResponse("converted markdown is empty", 422);
  }

  return json(
    { success: true, markdown, mimetype: result.mimetype },
    200,
    result.tokens !== undefined
      ? { "x-markdown-tokens": String(result.tokens) }
      : {},
  );
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    const path = new URL(request.url).pathname;

    if (path === "/health") {
      return json({ ok: true, service: "markdown-reader" });
    }

    if (path === "/markdown") {
      if (request.method !== "GET" && request.method !== "POST") {
        return errorResponse("method not allowed", 405);
      }
      if (!checkAuth(request, env)) {
        return errorResponse("unauthorized", 401);
      }
      try {
        return await handleMarkdown(request, env);
      } catch (e) {
        console.error("[markdown-reader] unexpected error:", e);
        return errorResponse(
          `unexpected error: ${e instanceof Error ? e.message : String(e)}`,
          500,
        );
      }
    }

    return errorResponse("not found", 404);
  },
};
