/**
 * 批量 LLM 代码符号摘要生成
 * 复用 src/llm.ts 和 src/ai-providers/llm-remote.ts 的远程调用模式
 */
import type { CodeSymbol, WikiDoc } from "../types";

const MAX_RETRIES = 2;
const RETRY_BASE_MS = 2000;
const SYMBOLS_PER_BATCH = 20;

function isRetryableStatus(status: number): boolean {
  return status === 429 || (status >= 500 && status < 600);
}

/** 从 LLM 响应中提取 JSON 对象（复用 llm-remote.ts 的容错解析） */
function extractJSONObject<T = unknown>(raw: string): T | null {
  if (!raw) return null;
  let text = raw.trim();
  const fenceMatch = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```\s*$/i);
  if (fenceMatch) {
    text = fenceMatch[1].trim();
  }
  if (!text.startsWith("{")) {
    const first = text.indexOf("{");
    const last = text.lastIndexOf("}");
    if (first !== -1 && last > first) text = text.slice(first, last + 1);
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

/** 构建符号摘要的 system prompt */
function buildSymbolSummaryPrompt(uiLanguage: string): string {
  return `You are a codebase documentation assistant. Summarize the provided code symbols for a developer wiki.

For each symbol, provide in JSON format:
{
  "summaries": [
    {
      "symbolName": "exact symbol name",
      "purpose": "1-2 sentence description of what this symbol does",
      "parameters": "key parameters and return types (if applicable)",
      "usageNotes": "important usage considerations, side effects, or gotchas"
    }
  ]
}

Rules:
- Output language: ${uiLanguage}
- Preserve all technical terms, API names, and framework names in original form
- Be concise but specific — avoid generic descriptions like "this is a function"
- If a symbol is a class, describe its role and key public methods
- If a symbol is an interface/type, describe its shape and use cases
- If a symbol is a variable/export, describe its purpose and type
- Return ONLY valid JSON, no markdown or extra text`;
}

/** 将符号列表格式化为 LLM 输入 */
function formatSymbolsForLLM(symbols: CodeSymbol[]): string {
  return symbols
    .map((s) => {
      const parts = [
        `--- ${s.name} (${s.kind}) ---`,
        `File: ${s.filePath} (lines ${s.lineStart}-${s.lineEnd})`,
      ];
      if (s.signature) parts.push(`Signature: ${s.signature}`);
      if (s.jsdoc) parts.push(`JSDoc: ${s.jsdoc}`);
      return parts.join("\n");
    })
    .join("\n\n");
}

interface SymbolSummaryEntry {
  symbolName: string;
  purpose: string;
  parameters: string;
  usageNotes: string;
}

interface SymbolSummaryBatch {
  summaries: SymbolSummaryEntry[];
}

/** 对一批符号调用 LLM 生成摘要 */
async function summarizeBatch(
  symbols: CodeSymbol[],
  apiKey: string,
  baseURL: string,
  model: string,
  uiLanguage: string,
): Promise<SymbolSummaryEntry[]> {
  const endpoint = `${baseURL}/v1/chat/completions`;
  const systemPrompt = buildSymbolSummaryPrompt(uiLanguage);
  const userPrompt = formatSymbolsForLLM(symbols);

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
      });

      if (!response.ok) {
        if (isRetryableStatus(response.status) && attempt < MAX_RETRIES) {
          const delay = RETRY_BASE_MS * Math.pow(2, attempt);
          console.warn(
            `[repo-wiki] ${response.status} error, retrying in ${delay}ms (${attempt + 1}/${MAX_RETRIES})`,
          );
          const { promise, resolve } = Promise.withResolvers<void>();
          setTimeout(resolve, delay);
          await promise;
          continue;
        }
        const errBody = (await response.json().catch(() => ({}))) as {
          message?: string;
          error?: { message?: string };
        };
        throw new Error(
          errBody.error?.message || errBody.message || `LLM API error: ${response.status}`,
        );
      }

      const data = await response.json();
      const content = data.choices?.[0]?.message?.content;
      if (!content) {
        throw new Error("Empty LLM response");
      }

      const result = extractJSONObject<SymbolSummaryBatch>(content);
      if (!result || !Array.isArray(result.summaries)) {
        console.warn(
          "[repo-wiki] Invalid JSON structure in LLM response, retrying:",
          content.slice(0, 200),
        );
        if (attempt < MAX_RETRIES) {
          const { promise, resolve } = Promise.withResolvers<void>();
          setTimeout(resolve, RETRY_BASE_MS);
          await promise;
          continue;
        }
        throw new Error("Failed to parse LLM response as JSON");
      }

      return result.summaries;
    } catch (error: unknown) {
      if (error instanceof DOMException && error.name === "AbortError") {
        throw error;
      }
      if (attempt >= MAX_RETRIES) {
        console.error("[repo-wiki] Failed to summarize batch:", error);
        throw error;
      }
      console.warn(
        `[repo-wiki] Attempt ${attempt + 1} failed:`,
        error instanceof Error ? error.message : String(error),
      );
      const { promise, resolve } = Promise.withResolvers<void>();
      setTimeout(resolve, RETRY_BASE_MS);
      await promise;
    }
  }

  return [];
}

/**
 * 批量 LLM 符号摘要生成
 * @param symbols 代码符号列表
 * @param apiKey API Key
 * @param baseURL API 基础地址（可选，默认 OpenAI）
 * @param model LLM 模型名（可选）
 * @param uiLanguage 界面语言（可选，默认 English）
 * @returns 部分 WikiDoc 记录数组（不含完整 content，由 wiki-builder 组装）
 */
export async function summarizeSymbols(
  symbols: CodeSymbol[],
  apiKey: string,
  baseURL: string = "https://api.siliconflow.cn/v1",
  model: string = "deepseek-ai/DeepSeek-V3",
  uiLanguage: string = "English",
): Promise<WikiDoc[]> {
  if (!symbols.length) return [];

  const docs: WikiDoc[] = [];

  for (let i = 0; i < symbols.length; i += SYMBOLS_PER_BATCH) {
    const batch = symbols.slice(i, i + SYMBOLS_PER_BATCH);
    try {
      const summaries = await summarizeBatch(
        batch,
        apiKey,
        baseURL,
        model,
        uiLanguage,
      );

      for (const summary of summaries) {
        const symbol = batch.find((s) => s.name === summary.symbolName);
        if (!symbol) continue;

        const content = [
          `## ${symbol.name}`,
          "",
          `**Kind**: ${symbol.kind}`,
          `**File**: ${symbol.filePath}`,
          "",
          `### Purpose`,
          summary.purpose || "No description available.",
          "",
        ];
        if (summary.parameters) {
          content.push(`### Parameters / Returns`, summary.parameters, "");
        }
        if (summary.usageNotes) {
          content.push(`### Usage Notes`, summary.usageNotes, "");
        }
        if (symbol.signature) {
          content.push(`### Signature`, "```typescript", symbol.signature, "```", "");
        }

        docs.push({
          id: symbol.id,
          title: symbol.name,
          content: content.join("\n"),
          summary: summary.purpose || "",
          symbols: [symbol.id],
          repoUrl: symbol.repoUrl,
          updatedAt: Date.now(),
          kind: "symbol",
        });
      }
    } catch (error) {
      console.warn(
        `[repo-wiki] Batch ${i / SYMBOLS_PER_BATCH + 1} failed, falling back to basic docs:`,
        error instanceof Error ? error.message : String(error),
      );

      // 降级：为这批符号生成基础文档
      for (const symbol of batch) {
        docs.push({
          id: symbol.id,
          title: symbol.name,
          content: [
            `## ${symbol.name}`,
            "",
            `**Kind**: ${symbol.kind}`,
            `**File**: ${symbol.filePath}`,
            "",
            symbol.signature ? `\`\`\`typescript\n${symbol.signature}\n\`\`\`` : "",
          ].join("\n"),
          summary: `${symbol.kind} in ${symbol.filePath}`,
          symbols: [symbol.id],
          repoUrl: symbol.repoUrl,
          updatedAt: Date.now(),
          kind: "symbol",
        });
      }
    }
  }

  return docs;
}
