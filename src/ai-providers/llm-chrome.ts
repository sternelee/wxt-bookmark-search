/**
 * Chrome Prompt API (Gemini Nano) LLM Provider。
 *
 * 注意：chrome.aiOriginTrial 是 Chrome 专属实验性 API，
 * WXT 的 browser.* polyfill 不包含此命名空间，因此必须
 * 直接使用 chrome.aiOriginTrial。这是经过评审的例外。
 */
import type { LLMProvider, LLMResult } from "./types";

/**
 * Chrome AI LanguageModel 类型声明（Origin Trial）。
 * 类型定义基于 Chrome AI Prompt API 公开文档。
 */
interface AILanguageModel {
  prompt(input: string, options?: { signal?: AbortSignal }): Promise<string>;
  destroy(): void;
}

interface AILanguageModelFactory {
  capabilities(): Promise<{
    available: "readily" | "after-download" | "no";
  }>;
  create(options?: {
    temperature?: number;
    topK?: number;
    signal?: AbortSignal;
  }): Promise<AILanguageModel>;
}

declare const chrome:
  | {
      aiOriginTrial: {
        languageModel: AILanguageModelFactory;
      };
    }
  | undefined;

function buildSummaryPrompt(text: string): string {
  return `Analyze the following webpage content and return a JSON object containing:
1. "summary": A 2-3 sentence summary in the original language of the text. CRITICAL: preserve key technical terms, product names, framework names, and distinguishing concepts.
2. "tags": 4-6 specific keywords/tags in the original language of the text. Include main topic, key technologies, frameworks.

Content:
${text.slice(0, 4000)}

Return ONLY valid JSON, no markdown formatting. Example:
{"summary": "...", "tags": ["...", "..."]}`;
}

function parseJsonResponse(raw: string, fallbackText: string): LLMResult {
  const cleaned = raw
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  try {
    const parsed = JSON.parse(cleaned) as LLMResult;
    return {
      summary: parsed.summary || fallbackText.slice(0, 200).trim() + "...",
      tags: (parsed.tags || []).map((t: string) => t.trim()).filter(Boolean),
    };
  } catch {
    return { summary: fallbackText.slice(0, 200).trim() + "...", tags: [] };
  }
}

export async function createChromeLLMProvider(): Promise<LLMProvider | null> {
  if (typeof chrome === "undefined" || !("aiOriginTrial" in chrome)) {
    return null;
  }

  const ai = chrome.aiOriginTrial;
  let session: Awaited<ReturnType<typeof ai.languageModel.create>> | null = null;

  try {
    session = await ai.languageModel.create({
      temperature: 0.3,
      topK: 1,
    });
  } catch {
    return null;
  }

  return {
    name: "Chrome AI (Gemini Nano)",
    get available() {
      return session !== null;
    },
    destroy() {
      if (session) {
        session.destroy();
        session = null;
      }
    },
    async generateDeepContent(
      text: string,
      signal?: AbortSignal,
    ): Promise<LLMResult> {
      if (!session) {
        throw new Error("Chrome AI session not initialized");
      }

      try {
        const prompt = buildSummaryPrompt(text);
        const response = await session.prompt(prompt, { signal });
        return parseJsonResponse(response, text);
      } catch (error: unknown) {
        if (error instanceof DOMException && error.name === "AbortError") {
          throw error;
        }
        console.error("[LLM-chrome] Failed:", error);
        return { summary: text.slice(0, 200).trim() + "...", tags: [] };
      }
    },
  };
}
