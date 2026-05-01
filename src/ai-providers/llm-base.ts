import type { LLMProvider } from "./types";
import type { Settings } from "../types";
import { detectChromeAI } from "./detect";
import { createRemoteLLMProvider } from "./llm-remote";
import { createChromeLLMProvider } from "./llm-chrome";

let _provider: LLMProvider | null = null;

/** 设置当前 LLM provider（background.ts 启动时调用） */
export function setLLMProvider(provider: LLMProvider | null): void {
  if (_provider && _provider !== provider) {
    _provider.destroy();
  }
  _provider = provider;
}

/** 获取当前 LLM provider */
export function getLLMProvider(): LLMProvider | null {
  return _provider;
}

/** 自动选择并创建 LLM provider */
export async function autoCreateLLMProvider(
  settings: Settings,
): Promise<LLMProvider | null> {
  // 用户手动选择 "disabled"
  if (settings.aiProvider === "disabled") {
    return null;
  }

  // 用户手动选择 "chrome" 或未设置时自动检测
  if (settings.aiProvider === "chrome" || !settings.aiProvider) {
    // 尝试 Chrome AI
    const detection = await detectChromeAI();
    if (detection.available) {
      const provider = await createChromeLLMProvider();
      if (provider) return provider;
    }
  }

  // 降级到远程 API（需要 apiKey）
  if (settings.openaiApiKey) {
    return createRemoteLLMProvider(
      settings.openaiApiKey,
      settings.llmModel || "gpt-4o-mini",
      settings.baseURL || "https://api.openai.com",
    );
  }

  return null;
}
