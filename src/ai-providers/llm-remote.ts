import type { LLMProvider, LLMResult } from "./types";

const MAX_RETRIES = 2;
const RETRY_BASE_MS = 2000;

function isRetryableStatus(status: number): boolean {
  return status === 429 || (status >= 500 && status < 600);
}

function buildSystemPrompt(): string {
  return `You are a helpful bookmark assistant. Analyze the provided web content and return a JSON object containing:
1. 'summary': A 2-3 sentence summary in the original language of the text. CRITICAL: preserve key technical terms, product names, framework names, and distinguishing concepts. Do NOT over-generalize. If the text compares "React" and "React Native", the summary must mention BOTH terms, not just "React frameworks".
2. 'tags': 4-6 specific keywords/tags in the original language of the text. Include the main topic, key technologies mentioned, and any frameworks or libraries.

The output MUST be a valid JSON object. Example:
{
  "summary": "This article compares React and React Native, explaining their differences in rendering (DOM vs native UI), development workflow, and when to choose each for building cross-platform applications.",
  "tags": ["React", "React Native", "Cross-platform", "Mobile Development", "JavaScript", "Comparison"]
}`;
}

/** 创建远程 OpenAI 兼容的 LLM Provider */
export function createRemoteLLMProvider(
  apiKey: string,
  model: string,
  baseURL: string,
): LLMProvider {
  const endpoint = `${baseURL}/v1/chat/completions`;
  const systemPrompt = buildSystemPrompt();

  return {
    name: "Remote (OpenAI-compatible)",
    get available() {
      return true;
    },
    destroy() {
      // no-op
    },
    async generateDeepContent(
      text: string,
      signal?: AbortSignal,
    ): Promise<LLMResult> {
      const userPrompt = `Content to analyze:\n\n${text.slice(0, 4000)}`;

      for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
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
            signal,
          });

          if (!response.ok) {
            if (isRetryableStatus(response.status) && attempt < MAX_RETRIES) {
              const delay = RETRY_BASE_MS * Math.pow(2, attempt);
              console.warn(
                `[LLM-remote] ${response.status} error, retrying in ${delay}ms (${attempt + 1}/${MAX_RETRIES})`,
              );
              await new Promise((r) => setTimeout(r, delay));
              continue;
            }
            throw new Error(`LLM API error: ${response.status}`);
          }

          const data = await response.json();
          const content = data.choices[0].message.content;
          const result = JSON.parse(content) as LLMResult;
          result.tags = (result.tags || [])
            .map((t: string) => t.trim())
            .filter(Boolean);
          return result;
        } catch (error: unknown) {
          if (error instanceof DOMException && error.name === "AbortError") {
            throw error;
          }
          if (attempt >= MAX_RETRIES) {
            console.error("[LLM-remote] Failed:", error);
            break;
          }
          console.warn(`[LLM-remote] Attempt ${attempt + 1} failed:`, (error as Error).message);
          await new Promise((r) => setTimeout(r, RETRY_BASE_MS));
        }
      }

      // 降级
      return {
        summary: text.slice(0, 200).trim() + "...",
        tags: [],
      };
    },
  };
}
