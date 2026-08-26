/**
 * 本地 (on-device) Embedding 适配 — 封装 @ternlight/mini (/web 入口)
 *
 * 设计要点：
 * - 同步 CPU 推理 (WASM)，无网络调用
 * - 单例初始化，懒加载（首次调用时编译 wasm，之后缓存）
 * - 输出 384 维 L2-normalized Float32Array
 * - wasm 由 wxt.config.ts 构建钩子复制到 public/，运行时经
 *   chrome.runtime.getURL 获取（MV3 SW / offscreen / options 通用）
 *
 * 与 src/embedding.ts (远程 API) 通过 `embedBackend` 设置切换
 */

import init, {
  embed as _embed,
  config_summary as _configSummary,
} from "@ternlight/mini/web";

/** Ternlight 引擎输出维度（hard-coded by @ternlight/mini） */
export const LOCAL_EMBEDDING_DIM = 384;

/** 引擎信息（dimensions/format/vocab 等） */
export const LOCAL_MODEL_NAME = "ternlight/mini";

const WASM_URL = "tern_engine_bg.wasm";

let initPromise: Promise<void> | null = null;
let initError: Error | null = null;

/** 解析扩展内 wasm 资源的绝对 URL（兼容测试环境回退到相对路径） */
function resolveWasmUrl(): string {
  try {
    const g = globalThis as unknown as {
      chrome?: { runtime?: { getURL?: (p: string) => string } };
    };
    if (typeof g.chrome?.runtime?.getURL === "function") {
      return g.chrome.runtime.getURL(WASM_URL);
    }
  } catch {
    /* fall through */
  }
  return WASM_URL;
}

/**
 * 懒加载并初始化 ternlight WASM 引擎（幂等，返回同一 Promise）。
 * 失败时缓存错误，避免重复下载/编译。
 */
export function ensureLocalEmbedding(): Promise<void> {
  if (initError) {
    return Promise.reject(initError);
  }
  if (!initPromise) {
    initPromise = init(fetch(resolveWasmUrl())).then(
      () => undefined,
      (err) => {
        const e = err instanceof Error ? err : new Error(String(err));
        initError = e;
        initPromise = null;
        throw e;
      },
    );
  }
  return initPromise;
}

/** 引擎是否已就绪（init 完成且无错误） */
export function isLocalEmbeddingReady(): boolean {
  return initPromise !== null && initError === null;
}

/** 重置初始化状态（仅供测试 / 重建使用） */
export function resetLocalEmbedding(): void {
  initPromise = null;
  initError = null;
}

/** 引擎描述字符串（dimensions / format / vocab 等） */
export function getLocalEngineInfo(): string {
  return _configSummary();
}

/**
 * 单条 embedding 异步入口（确保 init 后调用）。
 * 返回普通 number[]，方便与远程 API 输出一致。
 */
export async function localEmbed(text: string): Promise<number[]> {
  await ensureLocalEmbedding();
  if (!text) return new Array(LOCAL_EMBEDDING_DIM).fill(0);
  return Array.from(_embed(text));
}

/**
 * 批量 embedding（串行执行）。
 * ternlight 是同步 CPU 推理，串行 32 条 ≈ 80ms，无需 worker pool。
 * 跳过空串以避免无意义计算。
 */
export async function localBatchEmbed(texts: string[]): Promise<number[][]> {
  await ensureLocalEmbedding();
  const out: number[][] = new Array(texts.length);
  for (let i = 0; i < texts.length; i++) {
    const t = texts[i];
    if (!t || t.length === 0) {
      out[i] = new Array(LOCAL_EMBEDDING_DIM).fill(0);
      continue;
    }
    out[i] = Array.from(_embed(t));
  }
  return out;
}

/**
 * 单条 embedding 同步入口（不返回 Promise）。
 * 适用于 hot path（避免 await 开销）。调用方需自行捕获错误。
 */
export function localEmbedSync(text: string): number[] {
  return Array.from(_embed(text));
}

/** 测试本地 embedding 是否可用 — 仅做一次 embed 试运行 */
export async function testLocalEmbedding(): Promise<true> {
  await ensureLocalEmbedding();
  const v = _embed("test");
  if (!(v instanceof Float32Array) || v.length !== LOCAL_EMBEDDING_DIM) {
    throw new Error(
      `local embedding returned invalid output: ${v?.constructor?.name} len=${v?.length}`,
    );
  }
  return true;
}
