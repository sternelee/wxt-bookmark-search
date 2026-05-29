/**
 * RAG (Retrieval-Augmented Generation) — 基于书签语料库的问答
 */
const MAX_CONTEXT_LENGTH = 6000;

interface BookmarkContext {
  title: string;
  url: string;
  summary: string;
}

function normalizeCitations(
  citations: Array<{
    index?: number;
    title?: string;
    url?: string;
    excerpt?: string;
  }>,
  bookmarks: BookmarkContext[],
): { title: string; url: string; excerpt: string }[] {
  const seen = new Set<number>();
  const normalized: { title: string; url: string; excerpt: string }[] = [];

  for (const citation of citations) {
    if (
      typeof citation.index !== "number" ||
      !Number.isInteger(citation.index) ||
      citation.index < 1
    ) {
      continue;
    }

    const bookmark = bookmarks[citation.index - 1];
    if (!bookmark || seen.has(citation.index)) {
      continue;
    }
    if (citation.url && citation.url !== bookmark.url) {
      continue;
    }

    seen.add(citation.index);
    normalized.push({
      title: bookmark.title,
      url: bookmark.url,
      excerpt: citation.excerpt || bookmark.summary.slice(0, 160),
    });
  }

  return normalized;
}

/**
 * 对书签语料库提问，返回带引用的回答
 * @param question 用户问题
 * @param bookmarks 相关书签列表
 * @param apiKey API Key
 * @param model LLM 模型名
 * @param baseURL API 基础地址
 */
export async function askBookmarks(
  question: string,
  bookmarks: BookmarkContext[],
  apiKey: string,
  model?: string,
  baseURL?: string,
): Promise<{
  answer: string;
  citations: { title: string; url: string; excerpt: string }[];
}> {
  const apiUrl = `${(baseURL || "https://api.openai.com").replace(/\/$/, "")}/v1/chat/completions`;
  const llmModel = model || "gpt-4o-mini";

  // 构建上下文
  let contextText = bookmarks
    .map(
      (b, i) =>
        `[${i + 1}] Title: ${b.title}\nURL: ${b.url}\nSummary: ${b.summary.slice(0, 300)}`,
    )
    .join("\n\n");

  if (contextText.length > MAX_CONTEXT_LENGTH) {
    contextText =
      contextText.slice(0, MAX_CONTEXT_LENGTH) + "\n... (truncated)";
  }

  const systemPrompt = `You are a bookmark search assistant. Answer the user's question using ONLY the information in the provided bookmarks below.

Rules:
- If the answer is in the bookmarks, give a concise answer with inline citations like [1], [2]
- If multiple bookmarks are relevant, synthesize information from all of them
- If NONE of the bookmarks contain relevant information, respond with "I couldn't find relevant information in your bookmarks."
- Do NOT make up information or use external knowledge
- Return your response as a JSON object: { "answer": "...", "citations": [{ "index": number, "title": "...", "url": "..." }] }

Example output:
{
  "answer": "Two articles discuss Tauri performance. [1] covers general optimization techniques while [2] specifically mentions GPU rendering for canvas operations.",
  "citations": [
    { "index": 1, "title": "Tauri Performance Optimization Guide", "url": "https://example.com/tauri-perf" },
    { "index": 2, "title": "GPU Rendering in Tauri", "url": "https://example.com/tauri-gpu" }
  ]
}`;

  const response = await fetch(apiUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: llmModel,
      messages: [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content: `Bookmarks:\n\n${contextText}\n\nQuestion: ${question}`,
        },
      ],
      response_format: { type: "json_object" },
      temperature: 0.3,
    }),
  });

  if (!response.ok) {
    throw new Error(`RAG API error: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error("Empty RAG response");
  }

  try {
    const parsed = JSON.parse(content);
    return {
      answer: parsed.answer || "No answer generated.",
      citations: normalizeCitations(
        parsed.citations || [],
        bookmarks,
      ),
    };
  } catch {
    // 如果 JSON 解析失败，返回原始回答
    return {
      answer: content,
      citations: [],
    };
  }
}
