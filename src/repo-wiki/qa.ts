/**
 * 基于代码嵌入的 RAG 问答
 * 复用 src/embedding.ts 的 getQueryEmbedding；余弦相似度内联（src/vector.ts 尚无）
 */
import type { CodeChunk } from "../types";
import { getQueryEmbedding } from "../embedding";

const MAX_RETRIES = 2;
const RETRY_BASE_MS = 2000;
const MAX_CONTEXT_LENGTH = 6000;
const TOP_K_CHUNKS = 8;

/** 余弦相似度（内联：src/vector.ts 尚未存在） */
function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    const av = a[i] ?? 0;
    const bv = b[i] ?? 0;
    dot += av * bv;
    normA += av * av;
    normB += bv * bv;
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

/** 代码向量搜索结果 */
export interface CodeVectorResult {
  chunk: CodeChunk;
  score: number;
}

/** 从 LLM 响应中提取 JSON */
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

function isRetryableStatus(status: number): boolean {
  return status === 429 || (status >= 500 && status < 600);
}

/**
 * 搜索代码向量
 * 接收 chunk 列表和对应的向量映射（chunkId -> vector）
 * @param queryEmbedding 查询向量
 * @param chunks 代码块列表
 * @param embeddings chunkId -> 向量映射
 * @param topK 返回数量
 */
export function searchCodeVector(
  queryEmbedding: number[],
  chunks: CodeChunk[],
  embeddings: Map<string, number[]>,
  topK: number = TOP_K_CHUNKS,
): CodeVectorResult[] {
  const scored: CodeVectorResult[] = [];
  for (const chunk of chunks) {
    const vector = embeddings.get(chunk.id);
    if (!vector) continue;
    const score = cosineSimilarity(queryEmbedding, vector);
    scored.push({ chunk, score });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, topK);
}

interface CodeCitation {
  index: number;
  title: string;
  filePath: string;
  excerpt: string;
}

interface CodeQAResponse {
  answer: string;
  citations: CodeCitation[];
}

/** 构建代码问答的 system prompt */
function buildCodeQASystemPrompt(): string {
  return `You are a codebase expert. Answer the user's question using ONLY the provided code context below.

Rules:
- Answer based strictly on the code snippets provided — do not use external knowledge
- Cite sources inline using [1], [2], etc. format
- If the answer is not in the provided code, respond with "I couldn't find relevant information in the codebase."
- Be concise but technically accurate
- Return your response as a JSON object: { "answer": "...", "citations": [{ "index": number, "title": "...", "filePath": "...", "excerpt": "..." }] }

Example output:
{
  "answer": "The search function uses a hybrid approach combining keyword and vector search [1]. The RRF fusion is implemented in hybrid.ts [2].",
  "citations": [
    { "index": 1, "title": "search-engine.ts", "filePath": "src/search-engine.ts", "excerpt": "export async function searchHybrid(...)" },
    { "index": 2, "title": "hybrid.ts", "filePath": "src/hybrid.ts", "excerpt": "function rrfFusion(...)" }
  ]
}`;
}

/** 将代码块格式化为上下文 */
function formatCodeContext(chunks: CodeVectorResult[]): string {
  return chunks
    .map(
      (r, i) =>
        `[${i + 1}] File: ${r.chunk.filePath}\n` +
        `Symbol: ${r.chunk.symbolName} (${r.chunk.kind})\n` +
        `Language: ${r.chunk.language}\n` +
        `Content:\n${r.chunk.content.slice(0, 800)}`,
    )
    .join("\n\n---\n\n");
}

/**
 * 对代码库提问，返回带引用的回答
 * @param question 用户问题
 * @param chunks 代码块列表
 * @param embeddings chunkId -> 向量映射
 * @param apiKey API Key
 * @param baseURL API 基础地址（可选，默认 SiliconFlow）
 * @param embedModel 嵌入模型名（可选，默认 BGE-M3）
 * @param llmModel LLM 模型名（可选，默认 DeepSeek-V3）
 * @param apiKeyForLLM LLM 专用 API Key（可选，默认复用 apiKey）
 * @returns 回答和引用
 */
export async function askCodebase(
  question: string,
  chunks: CodeChunk[],
  embeddings: Map<string, number[]>,
  apiKey: string,
  baseURL: string = "https://api.siliconflow.cn/v1",
  embedModel: string = "BAAI/bge-m3",
  llmModel: string = "deepseek-ai/DeepSeek-V3",
  apiKeyForLLM?: string,
): Promise<{
  answer: string;
  citations: { title: string; filePath: string; excerpt: string }[];
}> {
  if (!chunks.length) {
    return {
      answer: "No code chunks available to answer the question.",
      citations: [],
    };
  }

  // 1) 获取查询向量（使用 embedModel）
  const queryEmbedding = await getQueryEmbedding(
    question,
    apiKey,
    undefined,
    embedModel,
    baseURL,
  );

  // 2) 搜索最相关的代码块
  const topChunks = searchCodeVector(queryEmbedding, chunks, embeddings, TOP_K_CHUNKS);

  if (!topChunks.length) {
    return {
      answer: "I couldn't find relevant code for this question.",
      citations: [],
    };
  }

  // 3) 构建上下文
  let contextText = formatCodeContext(topChunks);
  if (contextText.length > MAX_CONTEXT_LENGTH) {
    contextText = contextText.slice(0, MAX_CONTEXT_LENGTH) + "\n... (truncated)";
  }

  // 4) 调用 LLM（使用 llmModel；llmApiKey 可独立于 embed apiKey）
  const endpoint = `${baseURL}/chat/completions`;
  const systemPrompt = buildCodeQASystemPrompt();
  const llmApiKey = apiKeyForLLM || apiKey;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${llmApiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: llmModel,
          messages: [
            { role: "system", content: systemPrompt },
            {
              role: "user",
              content: `Code context:\n\n${contextText}\n\nQuestion: ${question}`,
            },
          ],
          response_format: { type: "json_object" },
          temperature: 0.3,
        }),
      });

      if (!response.ok) {
        if (isRetryableStatus(response.status) && attempt < MAX_RETRIES) {
          const delay = RETRY_BASE_MS * Math.pow(2, attempt);
          console.warn(
            `[repo-wiki-qa] ${response.status} error, retrying in ${delay}ms (${attempt + 1}/${MAX_RETRIES})`,
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

      const parsed = extractJSONObject<CodeQAResponse>(content);
      if (!parsed || !parsed.answer) {
        return {
          answer: content,
          citations: topChunks.map((r, i) => ({
            title: r.chunk.filePath.split("/").pop() || r.chunk.filePath,
            filePath: r.chunk.filePath,
            excerpt: r.chunk.content.slice(0, 200),
          })),
        };
      }

      // 规范化引用：使用 topChunks 索引，避免 LLM 幻觉的 filePath
      const normalizedCitations = (parsed.citations || [])
        .map((c) => {
          const matched = topChunks[c.index - 1]?.chunk;
          if (!matched) return null;
          return {
            title: c.title || matched.filePath.split("/").pop() || matched.filePath,
            filePath: c.filePath || matched.filePath,
            excerpt: c.excerpt || matched.content.slice(0, 200),
          };
        })
        .filter((c): c is { title: string; filePath: string; excerpt: string } => Boolean(c));

      return {
        answer: parsed.answer,
        citations: normalizedCitations.length
          ? normalizedCitations
          : topChunks.map((r) => ({
              title: r.chunk.filePath.split("/").pop() || r.chunk.filePath,
              filePath: r.chunk.filePath,
              excerpt: r.chunk.content.slice(0, 200),
            })),
      };
    } catch (error: unknown) {
      if (error instanceof DOMException && error.name === "AbortError") {
        throw error;
      }
      if (attempt >= MAX_RETRIES) {
        console.error("[repo-wiki-qa] Failed to answer question:", error);
        break;
      }
      console.warn(
        `[repo-wiki-qa] Attempt ${attempt + 1} failed:`,
        error instanceof Error ? error.message : String(error),
      );
      const { promise, resolve } = Promise.withResolvers<void>();
      setTimeout(resolve, RETRY_BASE_MS);
      await promise;
    }
  }

  // 降级：返回搜索结果摘要
  return {
    answer: `I found ${topChunks.length} relevant code snippets but was unable to generate a detailed answer.`,
    citations: topChunks.map((r) => ({
      title: r.chunk.filePath.split("/").pop() || r.chunk.filePath,
      filePath: r.chunk.filePath,
      excerpt: r.chunk.content.slice(0, 200),
    })),
  };
}
