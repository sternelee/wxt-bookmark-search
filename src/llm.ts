/**
 * OpenAI-compatible Chat Completion API 封装
 * 用于生成网页摘要和标签
 */

export type { LLMResult } from "./ai-providers/types";

export const DEFAULT_BASE_URL = "https://api.openai.com/v1";
export const DEFAULT_MODEL = "gpt-4o-mini"; // 默认使用 OpenAI 模型

const MAX_LLM_RETRIES = 2;
const LLM_RETRY_BASE_MS = 2000;

import type { LLMResult } from "./ai-providers/types";

export type { LLMResult as AIResult } from "./ai-providers/types";

/** 判断 HTTP 状态码是否可重试 (429 限流 / 5xx 服务错误) */
function isRetryableLlmStatus(status: number): boolean {
  return status === 429 || (status >= 500 && status < 600);
}

/** 调用 LLM 生成摘要和标签，含指数退避重试
 * @deprecated 使用 src/ai-providers/ 中的 LLMProvider 替代 */
export async function generateDeepContent(
  text: string,
  apiKey: string,
  model: string = DEFAULT_MODEL,
  baseURL: string = DEFAULT_BASE_URL,
): Promise<LLMResult> {
  const systemPrompt = `You are a helpful bookmark assistant. Analyze the provided web content and return a JSON object containing:
1. 'summary': A 2-3 sentence summary in the original language of the text. CRITICAL: preserve key technical terms, product names, framework names, and distinguishing concepts. Do NOT over-generalize. If the text compares "React" and "React Native", the summary must mention BOTH terms, not just "React frameworks".
2. 'tags': 4-6 specific keywords/tags in the original language of the text. Include the main topic, key technologies mentioned, and any frameworks or libraries.

The output MUST be a valid JSON object. Example:
{
  "summary": "This article compares React and React Native, explaining their differences in rendering (DOM vs native UI), development workflow, and when to choose each for building cross-platform applications.",
  "tags": ["React", "React Native", "Cross-platform", "Mobile Development", "JavaScript", "Comparison"]
}`;

  const userPrompt = `Content to analyze:\n\n${text.slice(0, 4000)}`; // 截取前 4k 字符避免超长
  const endpoint = `${baseURL}/v1/chat/completions`;

  for (let attempt = 0; attempt <= MAX_LLM_RETRIES; attempt++) {
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
          ],
          response_format: { type: "json_object" },
          temperature: 0.3,
        }),
      });

      if (!response.ok) {
        if (
          isRetryableLlmStatus(response.status) &&
          attempt < MAX_LLM_RETRIES
        ) {
          const delay =
            response.status === 429
              ? LLM_RETRY_BASE_MS * Math.pow(2, attempt)
              : LLM_RETRY_BASE_MS;
          console.warn(
            `[LLM] ${response.status} error, retrying in ${delay}ms (${attempt + 1}/${MAX_LLM_RETRIES})`,
          );
          await new Promise((r) => setTimeout(r, delay));
          continue;
        }
        const errBody = (await response.json().catch(() => ({}))) as {
          message?: string;
          error?: { message?: string };
        };
        throw new Error(
          errBody.error?.message ||
            errBody.message ||
            `LLM API error: ${response.status}`,
        );
      }

      const data = await response.json();
      const content = data.choices[0].message.content;

      // 解析 JSON
      const result = JSON.parse(content) as LLMResult;

      // 清理标签：去除引号、空格等
      result.tags = (result.tags || [])
        .map((t: string) => t.trim())
        .filter(Boolean);
      return result;
    } catch (error: any) {
      // AbortError 及非重试错误直接失败
      if (error.name === "AbortError" || attempt >= MAX_LLM_RETRIES) {
        console.error("[LLM] Failed to generate deep content:", error);
        break;
      }
      console.warn(
        `[LLM] Attempt ${attempt + 1} failed, retrying:`,
        error.message,
      );
      await new Promise((r) => setTimeout(r, LLM_RETRY_BASE_MS));
    }
  }

  // 降级处理：返回原始文本截取
  return {
    summary: text.slice(0, 200).trim() + "...",
    tags: [],
  };
}

/** 测试 LLM 模型可用性。成功返回 true，失败抛出包含服务端 message 的 Error */
export async function testLlmModel(
  apiKey: string,
  model: string = DEFAULT_MODEL,
  baseURL: string = DEFAULT_BASE_URL,
): Promise<true> {
  const endpoint = `${baseURL}/v1/chat/completions`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: "hi" }],
      max_tokens: 1,
    }),
  });

  if (!response.ok) {
    const errBody = (await response.json().catch(() => ({}))) as {
      message?: string;
      error?: { message?: string };
    };
    throw new Error(
      errBody.error?.message ||
        errBody.message ||
        `LLM API error: ${response.status}`,
    );
  }
  return true;
}
