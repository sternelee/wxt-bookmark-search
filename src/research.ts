import type { BookmarkRecord } from "./types";
import type { ConceptRecord } from "./db";
import { db, getSettings } from "./db";
import { resolveLLMConfig } from "./service-config";


/** 研究报告 */
export interface ResearchReport {
  question: string;
  generatedAt: number;
  process: {
    subQuestions: string[];
    sourcesSearched: number;
    internalSources: number;
    conceptsUsed: string[];
  };
  findings: {
    summary: string;
    keyInsights: string[];
    consensus: string[];
    divergences: string[];
  };
  citations: {
    id: number;
    title: string;
    url: string;
    excerpt: string;
    relevance: "high" | "medium" | "low";
  }[];
  report: string;
}

/** 子问题分解结果 */
interface DecomposedQuestions {
  subQuestions: string[];
  searchQueries: string[];
}

/** 内部搜索结果 */
interface InternalSearchResult {
  bookmarks: BookmarkRecord[];
  concepts: ConceptRecord[];
  relevantFacts: string[];
}

/** 调用 LLM */
async function callLLM(
  apiKey: string,
  model: string,
  baseURL: string,
  systemPrompt: string,
  userPrompt: string,
  signal?: AbortSignal,
): Promise<string> {
  const response = await fetch(`${baseURL}/v1/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.4,
      max_tokens: 2000,
    }),
    signal,
  });

  if (!response.ok) {
    throw new Error(`LLM request failed: ${response.status}`);
  }

  const data = await response.json();
  return data.choices[0].message.content;
}

/** Step 1: 分解问题 */
async function decomposeQuestion(
  question: string,
  apiKey: string,
  model: string,
  baseURL: string,
  signal?: AbortSignal,
): Promise<DecomposedQuestions> {
  const prompt = `将以下研究问题分解为 3-5 个子问题，用于搜索知识库。

原始问题: ${question}

输出 JSON:
{
  "subQuestions": ["子问题1", "子问题2", ...],
  "searchQueries": ["搜索关键词1", "搜索关键词2", ...]
}

要求:
- subQuestions 应该覆盖问题的不同方面
- searchQueries 应该是简洁的搜索关键词，用于在知识库中检索
- 保持简洁，不要过度分解`;

  try {
    const result = await callLLM(
      apiKey,
      model,
      baseURL,
      "你是一个研究问题分解专家。",
      prompt,
      signal,
    );
    const parsed = JSON.parse(result);
    return {
      subQuestions: (parsed.subQuestions || [question]).slice(0, 5),
      searchQueries: (parsed.searchQueries || [question]).slice(0, 8),
    };
  } catch {
    return {
      subQuestions: [question],
      searchQueries: [question],
    };
  }
}

/** Step 2: 搜索内部知识库（基于概念索引，非全表扫描） */
async function searchInternalKnowledge(
  queries: string[],
  signal?: AbortSignal,
): Promise<InternalSearchResult> {
  const matchedBookmarks = new Map<string, BookmarkRecord>();
  const matchedConcepts = new Map<string, ConceptRecord>();
  const relevantFacts: string[] = [];

  // 搜索概念（使用索引字段）
  for (const query of queries) {
    if (signal?.aborted) throw new Error("Aborted");

    const lower = query.toLowerCase();
    const concepts = await db.concepts
      .filter((c) => c.name.toLowerCase().includes(lower))
      .limit(5)
      .toArray();

    for (const c of concepts) {
      matchedConcepts.set(c.id, c);
      relevantFacts.push(`${c.name}: ${c.definition}`);
    }
  }

  // 从概念的 occurrence 中获取关联书签 ID，批量查询
  const bookmarkIds = new Set<string>();
  for (const concept of matchedConcepts.values()) {
    for (const occ of concept.occurrences) {
      bookmarkIds.add(occ.bookmarkId);
    }
  }

  if (bookmarkIds.size > 0) {
    const ids = [...bookmarkIds].slice(0, 20);
    const records = await db.bookmarks.bulkGet(ids);
    for (const r of records) {
      if (r && r.status === "indexed") {
        matchedBookmarks.set(r.id, r);
      }
    }
  }

  // 如果概念匹配不足，补充关键词搜索
  if (matchedBookmarks.size < 3) {
    for (const query of queries) {
      if (signal?.aborted) throw new Error("Aborted");
      const lower = query.toLowerCase();
      const results = await db.bookmarks
        .filter((b) => b.status === "indexed" && b.title.toLowerCase().includes(lower))
        .limit(3)
        .toArray();
      for (const r of results) {
        matchedBookmarks.set(r.id, r);
      }
    }
  }

  return {
    bookmarks: [...matchedBookmarks.values()].slice(0, 10),
    concepts: [...matchedConcepts.values()],
    relevantFacts,
  };
}

/** Step 3: 综合分析 */
async function synthesizeFindings(
  question: string,
  subQuestions: string[],
  internalResults: InternalSearchResult,
  apiKey: string,
  model: string,
  baseURL: string,
  signal?: AbortSignal,
): Promise<ResearchReport["findings"]> {
  const bookmarkContext = internalResults.bookmarks
    .map((b) => `标题: ${b.title}\nURL: ${b.url}\n摘要: ${b.quickSummary || b.summary.slice(0, 200)}\n标签: ${(b.tags || []).join(", ")}`)
    .join("\n\n");

  const conceptContext = internalResults.relevantFacts.join("\n");

  const prompt = `基于以下知识库内容，回答研究问题并生成分析。

研究问题: ${question}

子问题:
${subQuestions.map((q, i) => `${i + 1}. ${q}`).join("\n")}

知识库中的相关内容:
${bookmarkContext || "无匹配书签"}

相关概念:
${conceptContext || "无匹配概念"}

请生成 JSON:
{
  "summary": "综合回答（200字以内）",
  "keyInsights": ["洞察1", "洞察2", ...],
  "consensus": ["多来源一致的观点1", ...],
  "divergences": ["来源间的分歧或不同视角1", ...]
}

要求:
- 基于提供的知识库内容回答，不要编造
- 如果知识库内容不足，明确指出知识空白
- keyInsights 应该是 3-5 条核心发现`;

  try {
    const result = await callLLM(
      apiKey,
      model,
      baseURL,
      "你是一个研究分析专家。基于提供的资料进行分析，保持客观。",
      prompt,
      signal,
    );
    const parsed = JSON.parse(result);
    return {
      summary: parsed.summary || "无法生成摘要",
      keyInsights: (parsed.keyInsights || []).slice(0, 5),
      consensus: (parsed.consensus || []).slice(0, 3),
      divergences: (parsed.divergences || []).slice(0, 3),
    };
  } catch {
    return {
      summary: "分析过程中出现错误",
      keyInsights: [],
      consensus: [],
      divergences: [],
    };
  }
}

/** Step 4: 生成完整报告 */
async function generateReport(
  question: string,
  findings: ResearchReport["findings"],
  citations: ResearchReport["citations"],
  apiKey: string,
  model: string,
  baseURL: string,
  signal?: AbortSignal,
): Promise<string> {
  const citationContext = citations
    .map((c) => `[${c.id}] ${c.title} (${c.url})`)
    .join("\n");

  const prompt = `基于以下分析结果，生成一篇结构化的研究报告。

研究问题: ${question}

核心发现:
${findings.summary}

关键洞察:
${findings.keyInsights.map((i, idx) => `${idx + 1}. ${i}`).join("\n")}

共识观点:
${findings.consensus.map((c) => `- ${c}`).join("\n")}

分歧观点:
${findings.divergences.map((d) => `- ${d}`).join("\n")}

可用引用:
${citationContext}

请生成 Markdown 格式的研究报告，包含:
1. 问题概述
2. 核心发现
3. 详细分析
4. 结论与建议
5. 引用来源

保持客观、简洁，使用中文。`;

  try {
    return await callLLM(
      apiKey,
      model,
      baseURL,
      "你是一个研究报告撰写专家。生成清晰、结构化的研究报告。",
      prompt,
      signal,
    );
  } catch {
    return `# 研究报告: ${question}\n\n## 核心发现\n\n${findings.summary}\n\n## 关键洞察\n\n${findings.keyInsights.map((i) => `- ${i}`).join("\n")}`;
  }
}

/** 执行完整研究流程 */
export async function conductResearch(
  question: string,
  signal?: AbortSignal,
): Promise<ResearchReport> {
  const settings = await getSettings();
  const llmCfg = resolveLLMConfig(settings);
  const apiKey = llmCfg.apiKey;
  const model = llmCfg.model || "gpt-4o-mini";
  const baseURL = llmCfg.baseURL;

  if (!apiKey) {
    throw new Error("API key not configured");
  }

  // Step 1: 分解问题
  console.log("[research] Step 1: Decomposing question...");
  const decomposed = await decomposeQuestion(question, apiKey, model, baseURL, signal);

  // Step 2: 搜索内部知识库
  console.log("[research] Step 2: Searching internal knowledge...");
  const internalResults = await searchInternalKnowledge(decomposed.searchQueries, signal);

  // Step 3: 综合分析
  console.log("[research] Step 3: Synthesizing findings...");
  const findings = await synthesizeFindings(
    question,
    decomposed.subQuestions,
    internalResults,
    apiKey,
    model,
    baseURL,
    signal,
  );

  // 构建引用列表
  const citations: ResearchReport["citations"] = internalResults.bookmarks
    .slice(0, 8)
    .map((b, idx) => ({
      id: idx + 1,
      title: b.title,
      url: b.url,
      excerpt: b.quickSummary || b.summary.slice(0, 150),
      relevance: idx < 3 ? "high" as const : idx < 6 ? "medium" as const : "low" as const,
    }));

  // Step 4: 生成报告
  console.log("[research] Step 4: Generating report...");
  const report = await generateReport(question, findings, citations, apiKey, model, baseURL, signal);

  return {
    question,
    generatedAt: Date.now(),
    process: {
      subQuestions: decomposed.subQuestions,
      sourcesSearched: internalResults.bookmarks.length + internalResults.concepts.length,
      internalSources: internalResults.bookmarks.length,
      conceptsUsed: internalResults.concepts.map((c) => c.name),
    },
    findings,
    citations,
    report,
  };
}

/** 获取研究历史 */
export async function getResearchHistory(limit = 10): Promise<ResearchReport[]> {
  // 从 storage 获取研究历史
  const result = await browser.storage.local.get("researchHistory");
  const history = (result.researchHistory || []) as ResearchReport[];
  return history.slice(0, limit);
}

/** 保存研究历史 */
export async function saveResearchToHistory(report: ResearchReport): Promise<void> {
  const result = await browser.storage.local.get("researchHistory");
  const history = (result.researchHistory || []) as ResearchReport[];
  history.unshift(report);
  // 保留最近 20 条
  await browser.storage.local.set({
    researchHistory: history.slice(0, 20),
  });
}
