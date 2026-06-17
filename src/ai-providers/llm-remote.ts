import type { LLMProvider, LLMResult } from "./types";

const MAX_RETRIES = 2;
const RETRY_BASE_MS = 2000;

function isRetryableStatus(status: number): boolean {
  return status === 429 || (status >= 500 && status < 600);
}

/** 内容类型检测：基于 URL 和文本特征推断 */
function detectContentType(url: string, text: string): string {
  const urlLower = url.toLowerCase();
  if (urlLower.includes("github.com")) return "repo";
  if (urlLower.includes("x.com") || urlLower.includes("twitter.com")) return "tweet";
  if (urlLower.includes("docs.") || urlLower.includes("/documentation")) return "doc";
  if (urlLower.includes("youtube.com") || urlLower.includes("bilibili.com")) return "video";
  if (text.includes("npm install") || text.includes("pip install") || text.includes("cargo add")) return "tool";
  return "article";
}

function buildSystemPrompt(): string {
  return `You are an expert bookmark analysis assistant. Analyze the provided web content and return a structured JSON object.

Required fields:
1. 'summary': A 2-3 sentence summary in the original language. CRITICAL: preserve key technical terms, product names, framework names. Do NOT over-generalize.
2. 'tags': 4-6 specific keywords/tags in the original language.
3. 'quickSummary': A ONE-line summary (max 15 words) that captures the essence. Must be in the original language.
4. 'contentType': One of "article" | "repo" | "tweet" | "doc" | "video" | "tool" | "other"
5. 'keyPoints': 3-5 bullet points of the most important takeaways. Each point should be concise (max 30 words). In the original language.
6. 'readingTime': Estimated reading time in minutes (integer).
7. 'difficulty': One of "beginner" | "intermediate" | "advanced" — based on assumed prior knowledge.
8. 'technologies': List of specific technologies, frameworks, languages, or tools mentioned (e.g. ["React", "TypeScript", "Docker"]).

Content-type specific guidelines:
- For repos: Focus on what it does, tech stack, and why it matters. Key points should highlight unique features.
- For articles: Identify the core argument or insight. Key points should be the main claims.
- For tweets: Capture the key statement and context. Keep it brief.
- For docs: Identify what's being documented and key concepts.
- For tools: Focus on use cases and integration.

Output MUST be a valid JSON object with ALL required fields.`;
}

function buildKnowledgeExtractionPrompt(): string {
  return `You are a knowledge extraction expert. Analyze the provided web content and extract structured knowledge.

Required fields:
1. 'summary': A 2-3 sentence summary in the original language.
2. 'quickSummary': A ONE-line summary (max 15 words).
3. 'keyPoints': 3-5 bullet points of the most important takeaways.
4. 'concepts': Array of key concepts mentioned, each with:
   - 'name': Concept name (in original language)
   - 'definition': Brief definition (1-2 sentences)
   - 'category': One of "技术" | "理论" | "方法论" | "工具" | "其他"
   - 'relatedConcepts': Array of related concept names
5. 'claims': Array of core arguments/claims, each with:
   - 'text': The claim statement
   - 'confidence': "high" | "medium" | "low"
   - 'source': Brief source or context
6. 'dataPoints': Array of key facts/data, each with:
   - 'fact': The fact or data point
   - 'context': Why this matters
7. 'technologies': List of specific technologies mentioned.
8. 'contentType': One of "article" | "repo" | "tweet" | "doc" | "video" | "tool" | "other"
9. 'difficulty': "beginner" | "intermediate" | "advanced"
10. 'readingTime': Estimated reading time in minutes (integer).
11. 'language': ISO 639-1 language code (e.g. "en", "zh", "ja")

Guidelines:
- Extract 3-8 concepts that are central to understanding the content
- Claims should be the main arguments or insights, not minor points
- DataPoints should be specific numbers, statistics, or concrete facts
- Related concepts should capture how ideas connect

Output MUST be a valid JSON object.`;
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
      url?: string,
    ): Promise<LLMResult> {
      const contentHint = url
        ? `\nSource URL: ${url}\nDetected type: ${detectContentType(url, text)}`
        : "";
      const userPrompt = `Content to analyze:${contentHint}\n\n${text.slice(0, 8000)}`;

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
              const { promise, resolve } = Promise.withResolvers<void>();
              setTimeout(resolve, delay);
              await promise;
              continue;
            }
            // 非可重试错误：直接降级
            const errBody = (await response.json().catch(() => ({}))) as {
              message?: string;
              error?: { message?: string };
            };
            console.error(
              `[LLM-remote] Non-retryable error ${response.status}:`,
              errBody.error?.message || errBody.message || response.status,
            );
            break;
          }

          const data = await response.json();
          const content = data.choices[0].message.content;
          const result = JSON.parse(content) as LLMResult;
          // 清理和验证字段
          result.tags = (result.tags || [])
            .map((t: string) => t.trim())
            .filter(Boolean);
          result.keyPoints = (result.keyPoints || [])
            .map((p: string) => p.trim())
            .filter(Boolean)
            .slice(0, 5);
          result.technologies = (result.technologies || [])
            .map((t: string) => t.trim())
            .filter(Boolean);
          if (result.quickSummary && result.quickSummary.length > 30) {
            result.quickSummary = result.quickSummary.slice(0, 27) + "...";
          }
          return result;
        } catch (error: unknown) {
          if (error instanceof DOMException && error.name === "AbortError") {
            throw error;
          }
          if (attempt >= MAX_RETRIES) {
            console.error("[LLM-remote] Failed:", error);
            break;
          }
          console.warn(
            `[LLM-remote] Attempt ${attempt + 1} failed:`,
            error instanceof Error ? error.message : String(error),
          );
          const { promise, resolve } = Promise.withResolvers<void>();
          setTimeout(resolve, RETRY_BASE_MS);
          await promise;
        }
      }

      // 降级
      return {
        summary: text.slice(0, 200).trim() + "...",
        tags: [],
      };
    },
    async extractKnowledge(
      text: string,
      signal?: AbortSignal,
      url?: string,
    ): Promise<import("./types").KnowledgeEntry> {
      const contentHint = url
        ? `\nSource URL: ${url}\nDetected type: ${detectContentType(url, text)}`
        : "";
      const userPrompt = `Content to analyze:${contentHint}\n\n${text.slice(0, 10000)}`;
      const knowledgePrompt = buildKnowledgeExtractionPrompt();

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
                { role: "system", content: knowledgePrompt },
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
              const { promise, resolve } = Promise.withResolvers<void>();
              setTimeout(resolve, delay);
              await promise;
              continue;
            }
            break;
          }

          const data = await response.json();
          const content = data.choices[0].message.content;
          const result = JSON.parse(content) as import("./types").KnowledgeEntry;
          // 清理字段
          result.concepts = (result.concepts || []).slice(0, 8);
          result.claims = (result.claims || []).slice(0, 5);
          result.dataPoints = (result.dataPoints || []).slice(0, 5);
          result.keyPoints = (result.keyPoints || []).slice(0, 5);
          result.technologies = (result.technologies || []).filter(Boolean);
          return result;
        } catch (error: unknown) {
          if (error instanceof DOMException && error.name === "AbortError") {
            throw error;
          }
          if (attempt >= MAX_RETRIES) {
            console.error("[LLM-remote] extractKnowledge failed:", error);
            break;
          }
          const { promise, resolve } = Promise.withResolvers<void>();
          setTimeout(resolve, RETRY_BASE_MS);
          await promise;
        }
      }

      // 降级
      return {
        summary: text.slice(0, 200).trim() + "...",
        quickSummary: "",
        keyPoints: [],
        concepts: [],
        claims: [],
        dataPoints: [],
        technologies: [],
        contentType: "other",
        difficulty: "intermediate",
        readingTime: Math.ceil(text.length / 1000),
        language: "en",
      };
    },
  };
}
