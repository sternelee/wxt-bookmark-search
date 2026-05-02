/**
 * Chrome AI Prompt API 检测 — 已废弃。
 *
 * Chrome AI 在扩展环境中不可靠，已移除支持。
 * 保留此模块作为向后兼容占位符。
 */

export interface ChromeAIDetectionResult {
  available: false;
  needsDownload: false;
  errorMessage?: string;
}

/** 检测 Chrome AI — 始终返回不可用 */
export async function detectChromeAI(): Promise<ChromeAIDetectionResult> {
  return {
    available: false,
    needsDownload: false,
    errorMessage:
      "Chrome AI 已在扩展中移除支持。请使用 Remote API (SiliconFlow/OpenAI)。",
  };
}

/** 获取 Chrome AI 工厂 — 始终返回 null */
export async function getChromeAIFactory(): Promise<null> {
  return null;
}
