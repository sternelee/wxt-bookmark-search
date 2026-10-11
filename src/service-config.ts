/**
 * Service config resolution — 让 Embedding 和 LLM 可以指向不同的服务。
 *
 * 优先级：per-service override > 共享 openaiApiKey/baseURL。
 * 设置项未填写时，自动回退到共享配置，保证向后兼容。
 */

import type { Settings } from "./types";

/**
 * 规范化 Base URL：去除首尾空白与末尾斜杠，并确保以 `/v1` 结尾。
 * 与 OpenAI SDK 约定一致：配置值包含 `/v1`（如 https://api.openai.com/v1），
 * 端点构造只拼接 `/chat/completions`、`/embeddings` 等资源路径。
 * 用户漏写 `/v1` 时自动补上；已包含时不重复添加。
 */
export function normalizeBaseURL(url: string): string {
  const base = url.trim().replace(/\/+$/, "");
  return /\/v1$/i.test(base) ? base : `${base}/v1`;
}

/** Embedding 服务解析后的有效配置 */
export interface EmbedConfig {
  apiKey: string;
  baseURL: string;
  model?: string;
  /** 后端: "local" = on-device WASM, "remote" = HTTP API */
  backend: "local" | "remote";
}

/** LLM 服务解析后的有效配置 */
export interface LLMConfig {
  apiKey: string;
  baseURL: string;
  model?: string;
}

/** 解析 Embedding 服务配置（override > shared） */
export function resolveEmbedConfig(settings: Settings): EmbedConfig {
  return {
    backend: settings.embedBackend === "local" ? "local" : "remote",
    apiKey: (settings.embedApiKey || settings.openaiApiKey || "").trim(),
    baseURL: normalizeBaseURL(
      settings.embedBaseURL ||
        settings.baseURL ||
        "https://api.siliconflow.cn/v1",
    ),
    model: settings.embeddingModel?.trim() || undefined,
  };
}

/** 解析 LLM 服务配置（override > shared） */
export function resolveLLMConfig(settings: Settings): LLMConfig {
  return {
    apiKey: (settings.llmApiKey || settings.openaiApiKey || "").trim(),
    baseURL: normalizeBaseURL(
      settings.llmBaseURL ||
        settings.baseURL ||
        "https://api.siliconflow.cn/v1",
    ),
    model: settings.llmModel?.trim() || undefined,
  };
}

/**
 * 判断 Embedding 是否可直接使用。
 * 本地（on-device）后端不需要 API Key；远程后端必须有 Key。
 */
export function isEmbedConfigured(settings: Settings): boolean {
  const cfg = resolveEmbedConfig(settings);
  return cfg.backend === "local" || !!cfg.apiKey;
}

/** 判断 LLM 是否可直接使用（远程服务必须有 API Key） */
export function isLLMConfigured(settings: Settings): boolean {
  return !!resolveLLMConfig(settings).apiKey;
}

/** 判断 Embedding 配置是否已变更（用于触发重建索引） */
export function isEmbedConfigChanged(
  prev: Settings,
  next: Partial<Settings>,
): boolean {
  const a = resolveEmbedConfig({ ...prev, ...next } as Settings);
  const b = resolveEmbedConfig(prev);

  return (
    a.backend !== b.backend ||
    a.baseURL !== b.baseURL ||
    (a.model || "") !== (b.model || "")
  );
}
