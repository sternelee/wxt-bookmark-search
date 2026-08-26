/**
 * Service config resolution — 让 Embedding 和 LLM 可以指向不同的服务。
 *
 * 优先级：per-service override > 共享 openaiApiKey/baseURL。
 * 设置项未填写时，自动回退到共享配置，保证向后兼容。
 */

import type { Settings } from "./types";

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
    baseURL: (
      settings.embedBaseURL ||
      settings.baseURL ||
      "https://api.siliconflow.cn"
    )
      .trim()
      .replace(/\/+$/, ""),
    model: settings.embeddingModel?.trim() || undefined,
  };
}

/** 解析 LLM 服务配置（override > shared） */
export function resolveLLMConfig(settings: Settings): LLMConfig {
  return {
    apiKey: (settings.llmApiKey || settings.openaiApiKey || "").trim(),
    baseURL: (
      settings.llmBaseURL ||
      settings.baseURL ||
      "https://api.siliconflow.cn"
    )
      .trim()
      .replace(/\/+$/, ""),
    model: settings.llmModel?.trim() || undefined,
  };
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
