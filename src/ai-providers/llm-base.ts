import type { LLMProvider } from "./types";
import type { Settings } from "../types";
import { createRemoteLLMProvider } from "./llm-remote";
import { resolveLLMConfig } from "../service-config";

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

  // 创建远程 API provider（需要 apiKey）— 使用 per-service override 或 shared
  const llm = resolveLLMConfig(settings);
  if (llm.apiKey) {
    return createRemoteLLMProvider(
      llm.apiKey,
      llm.model || "gpt-4o-mini",
      llm.baseURL,
    );
  }

  return null;
}
