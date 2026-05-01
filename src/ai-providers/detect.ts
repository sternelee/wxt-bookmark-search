/**
 * Chrome AI Prompt API 能力检测。
 *
 * 注意：chrome.aiOriginTrial 是 Chrome 专属实验性 API，
 * WXT 的 browser.* polyfill 不包含此命名空间，因此必须
 * 直接使用 chrome.aiOriginTrial。这是经过评审的例外。
 */

export interface ChromeAICapabilities {
  available: "readily" | "after-download" | "no";
  defaultTemperature?: number;
  defaultTopK?: number;
  maxTopK?: number;
}

declare const chrome:
  | {
      aiOriginTrial: {
        languageModel: {
          capabilities(): Promise<ChromeAICapabilities>;
        };
      };
    }
  | undefined;

export interface ChromeAIDetectionResult {
  available: boolean;
  needsDownload: boolean;
  capabilities?: ChromeAICapabilities;
}

/** 检测 Chrome AI Prompt API 是否可用 */
export async function detectChromeAI(): Promise<ChromeAIDetectionResult> {
  if (typeof chrome === "undefined") {
    return { available: false, needsDownload: false };
  }
  if (!("aiOriginTrial" in chrome)) {
    return { available: false, needsDownload: false };
  }
  try {
    const ai = chrome.aiOriginTrial as {
      languageModel: {
        capabilities(): Promise<ChromeAICapabilities>;
      };
    };
    const caps = await ai.languageModel.capabilities();
    return {
      available: caps.available !== "no",
      needsDownload: caps.available === "after-download",
      capabilities: caps,
    };
  } catch {
    return { available: false, needsDownload: false };
  }
}
