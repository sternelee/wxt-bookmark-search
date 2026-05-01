/** LLM 返回结果 — 与现有 AIResult 接口兼容 */
export interface LLMResult {
  summary: string;
  tags: string[];
}

/** LLM Provider — 统一接口 */
export interface LLMProvider {
  readonly name: string;
  readonly available: boolean;
  /** 销毁会话资源（Chrome Prompt API 专属，Remote 为 no-op） */
  destroy(): void;
  /** 生成摘要和标签 */
  generateDeepContent(
    text: string,
    signal?: AbortSignal,
  ): Promise<LLMResult>;
}

export type LLMProviderType = "chrome" | "remote" | "disabled";
