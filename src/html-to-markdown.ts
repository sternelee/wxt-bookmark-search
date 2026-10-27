/**
 * 本地 HTML → Markdown 转换 — 封装 @xberg-io/html-to-markdown-wasm (/web 入口)
 *
 * 设计要点：
 * - Rust 核心的 WASM 转换器（CommonMark + GFM 表格），三层引擎自动分级，
 *   对畸形 HTML / 嵌套表格 / 混合编码等真实页面鲁棒
 * - 完全在设备端运行，无网络请求（readerBackend = "wasm" 的核心）
 * - 内置 metadata 提取（title / description / keywords）与 preprocessing
 *   （移除导航、表单等样板内容），弥补 Readability 在非文章页的不足
 * - 单例初始化，懒加载（首次调用时编译 wasm ≈ 4.3MB，之后缓存）
 * - wasm 由 wxt.config.ts 构建钩子复制到 public/，运行时经
 *   chrome.runtime.getURL 获取（MV3 SW / offscreen / options 通用）
 *
 * 与第三方 reader（markdown.new / Jina / 自建 Cloudflare）通过
 * `settings.readerBackend` 设置切换
 */

import wasmPkg, {
  convert as wasmConvert,
  WasmConversionOptions,
  WasmHeadingStyle,
  WasmPreprocessingOptions,
  WasmPreprocessingPreset,
} from "@xberg-io/html-to-markdown-wasm";

/**
 * 类型收窄说明：包的 `exports["."].types` 指向 nodejs 构建（无 default init），
 * 而浏览器运行时经 browser 条件加载 web 构建（default = 异步 init 函数，
 * 接受 fetch(request) 结果）。此差异为 wasm-bindgen 多目标产物所致，
 * 需显式收窄（同 untyped browser API 处理方式）。
 */
type WasmInitFn = (input?: unknown) => Promise<unknown>;
const wasmInit = wasmPkg as unknown as WasmInitFn;

/** public/ 下的 wasm 资源路径（WXT getURL 要求带前导 / 的 PublicPath） */
const WASM_URL = "/html_to_markdown_wasm_bg.wasm" as const;

/** 失败后的冷却时间：期间直接返回缓存错误，过后允许重试（避免永久毒化） */
const INIT_RETRY_COOLDOWN_MS = 60_000;

let initPromise: Promise<void> | null = null;
let initError: Error | null = null;
let initFailedAt = 0;
/** init 是否仍未 settle（用于 isHtmlToMarkdownReady 区分“加载中”与“已就绪”） */
let initPending = false;

/** 解析扩展内 wasm 资源的绝对 URL（非扩展上下文回退到相对路径） */
function resolveWasmUrl(): string {
  try {
    if (typeof browser !== "undefined" && browser.runtime?.getURL) {
      return browser.runtime.getURL(WASM_URL);
    }
  } catch {
    /* fall through */
  }
  // 非扩展上下文（如单测）回退为相对路径
  return WASM_URL.replace(/^\//, "");
}

/**
 * 懒加载并初始化 html-to-markdown WASM 引擎（幂等，返回同一 Promise）。
 * 失败后进入冷却期（冷却内快速失败，避免重复拉 4.5MB），冷却结束自动重试，
 * 因此一次瞬时失败不会永久禁用 wasm 后端。
 */
export async function ensureHtmlToMarkdown(): Promise<void> {
  if (initError) {
    if (Date.now() - initFailedAt < INIT_RETRY_COOLDOWN_MS) {
      throw initError;
    }
    console.warn("[html-to-markdown] retrying wasm init after cooldown");
    initError = null;
  }
  if (!initPromise) {
    initPending = true;
    initPromise = (async () => {
      try {
        await wasmInit({ module_or_path: fetch(resolveWasmUrl()) });
        initPending = false;
      } catch (err) {
        const e = err instanceof Error ? err : new Error(String(err));
        console.error("[html-to-markdown] wasm init failed:", e);
        initError = e;
        initFailedAt = Date.now();
        initPromise = null;
        initPending = false;
        throw e;
      }
    })();
    return initPromise;
  }
  return initPromise;
}

/** 引擎是否已就绪（init 已 resolve；加载中或已失败均返回 false） */
export function isHtmlToMarkdownReady(): boolean {
  return initPromise !== null && initError === null && !initPending;
}

/** 重置初始化状态（下次调用重新加载 wasm） */
export function resetHtmlToMarkdown(): void {
  initPromise = null;
  initError = null;
  initFailedAt = 0;
  initPending = false;
}

/** 本地转换结果：markdown 正文 + 页面 metadata */
export interface LocalMarkdownConversion {
  markdown: string;
  title?: string;
  description?: string;
}

/**
 * 转换输入上限（8 MiB）。库默认 2 MiB，对长文档站过小；按字节计的
 * CJK 页面在 ~70 万字符就会触顶，而本后端的目标场景正是长非文章页。
 */
const MAX_INPUT_BYTES = 8 * 1024 * 1024;

/** 一次转换的预处理档位 */
interface ConvertMode {
  preset: WasmPreprocessingPreset;
  removeNavigation: boolean;
  removeForms: boolean;
}

const STANDARD_MODE: ConvertMode = {
  preset: WasmPreprocessingPreset.Standard,
  removeNavigation: true,
  removeForms: true,
};

/** 正文被 Standard 预设清空时的保守重试档位（保留导航/表单区域内的正文） */
const MINIMAL_MODE: ConvertMode = {
  preset: WasmPreprocessingPreset.Minimal,
  removeNavigation: false,
  removeForms: false,
};

/** 超出上限时按字节截断到最后一个完整标签边界 */
function truncateToByteLimit(html: string): string {
  const encoder = new TextEncoder();
  const bytes = encoder.encode(html);
  if (bytes.byteLength <= MAX_INPUT_BYTES) return html;

  // 粗截断后回退到最后一个 '>'，避免把标签从中间切断
  const rough = new TextDecoder().decode(bytes.slice(0, MAX_INPUT_BYTES));
  const lastTag = rough.lastIndexOf(">");
  return lastTag > 0 ? rough.slice(0, lastTag + 1) : rough;
}

/** 单次转换（含 metadata 提取），负责全部 wasm 句柄释放 */
function convertOnce(
  html: string,
  mode: ConvertMode,
): { markdown: string; title?: string; description?: string } {
  const preprocessing = WasmPreprocessingOptions.default();
  const options = WasmConversionOptions.default();
  let result: ReturnType<typeof wasmConvert> | null = null;
  try {
    preprocessing.enabled = true;
    preprocessing.preset = mode.preset;
    preprocessing.removeNavigation = mode.removeNavigation;
    preprocessing.removeForms = mode.removeForms;

    options.headingStyle = WasmHeadingStyle.Atx;
    options.skipImages = true;
    options.maxInputSize = BigInt(MAX_INPUT_BYTES);
    // setter 借用（JS 保留所有权），preprocessing 在 finally 统一释放
    options.preprocessing = preprocessing;

    // convert 按值消费 options（ownership transfer），无需手动 free
    result = wasmConvert(html, options);

    const markdown = result.content ?? "";
    if (!markdown.trim()) {
      return { markdown: "" };
    }

    // metadata / document getter 返回分离副本（各自持有内存），需逐层释放
    const meta = result.metadata;
    try {
      const doc = meta.document;
      try {
        return {
          markdown,
          title: doc.title || undefined,
          description: doc.description || undefined,
        };
      } finally {
        doc.free();
      }
    } finally {
      meta.free();
    }
  } finally {
    result?.free();
    preprocessing.free();
  }
}

/**
 * 去掉开头的 YAML frontmatter，返回正文（用于判断是否真的没抽到内容）。
 * 转换器总会在有 metadata 时输出 frontmatter，因此不能直接对整串 trim() 判空。
 */
function bodyOf(markdown: string): string {
  return markdown.replace(/^\uFEFF?---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, "");
}

/**
 * 将页面 HTML 转换为 Markdown（内部会确保 init）。
 *
 * 转换配置：
 * - ATX 标题（`#`），与 Readability+Turndown 路径输出风格一致
 * - preprocessing Standard 预设 + 移除导航/表单（去页面样板，保留正文）
 * - 跳过图片（索引用文本，图片 URL 是噪音；摘要生成亦会剔除图片）
 * - 提取 metadata（title / description），供索引器回填
 * - 超大页面先按 8 MiB 字节上限截断到标签边界，不直接失败
 * - 正文为空时用 Minimal 预设重试一次（正文可能整段位于 nav/header/form 内）
 */
export async function convertHtmlToMarkdown(
  html: string,
): Promise<LocalMarkdownConversion> {
  await ensureHtmlToMarkdown();

  const input = truncateToByteLimit(html);
  const first = convertOnce(input, STANDARD_MODE);
  // 必须按剥离 frontmatter 后的正文判空：转换器只要页有 <title> 就会输出
  // frontmatter，直接 trim() 整串会让“正文被 Standard 预设清空”永不触发重试。
  if (bodyOf(first.markdown).trim()) return first;

  console.warn(
    "[html-to-markdown] Standard preset produced empty body, retrying with Minimal",
  );
  return convertOnce(input, MINIMAL_MODE);
}
