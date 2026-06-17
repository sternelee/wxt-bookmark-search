import type { BookmarkRecord } from "./types";
import type { DailyDigest, ConceptRecord } from "./db";
import { db, getSettings, saveDailyDigest } from "./db";
import type { LLMProvider } from "./ai-providers/types";
import { resolveLLMConfig } from "./service-config";

/** 获取指定日期范围内索引的书签 */
async function getBookmarksInRange(start: number, end: number): Promise<BookmarkRecord[]> {
  return db.bookmarks
    .where("indexedAt")
    .between(start, end, true, false)
    .toArray();
}

/** 提取域名 */
function extractDomains(bookmarks: BookmarkRecord[]): string[] {
  const domains = new Set<string>();
  for (const b of bookmarks) {
    try {
      domains.add(new URL(b.url).hostname);
    } catch {
      // ignore invalid URLs
    }
  }
  return [...domains].slice(0, 10);
}

/** 计算总阅读时间 */
function totalReadingTime(bookmarks: BookmarkRecord[]): number {
  return bookmarks.reduce((sum, b) => sum + (b.readingTime || 0), 0);
}

/** 使用 LLM 生成简报内容 */
async function generateDigestContent(
  bookmarks: BookmarkRecord[],
  concepts: ConceptRecord[],
  apiKey: string,
  model: string,
  baseURL: string,
): Promise<{ headlineInsight: string; connections: DailyDigest["connections"] }> {
  const bookmarkSummaries = bookmarks.map((b) => ({
    title: b.title,
    url: b.url,
    summary: b.quickSummary || b.summary.slice(0, 100),
    tags: b.tags || [],
    contentType: b.source || "bookmark",
  }));

  const conceptNames = concepts.map((c) => c.name).slice(0, 20);

  const prompt = `你是一个知识分析助手。根据用户今天阅读的书签内容，生成每日知识简报。

今日阅读的书签:
${JSON.stringify(bookmarkSummaries, null, 2)}

今日出现的概念:
${conceptNames.join(", ")}

请生成 JSON:
{
  "headlineInsight": "一句话总结今天的阅读主题和洞察（30字以内，中文）",
  "connections": [
    {
      "description": "描述两个内容之间的关联",
      "sourceA": "书签A的标题",
      "sourceB": "书签B的标题",
      "relation": "关联类型（互补/对比/延伸/引用）"
    }
  ]
}

要求:
- headlineInsight 要有洞察性，不要简单罗列
- connections 最多3条，只输出有意义的关联
- 如果内容太少无法关联，connections 可以为空数组`;

  try {
    const response = await fetch(`${baseURL}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: prompt }],
        response_format: { type: "json_object" },
        temperature: 0.5,
      }),
    });

    if (!response.ok) {
      return {
        headlineInsight: `今日阅读了 ${bookmarks.length} 篇内容`,
        connections: [],
      };
    }

    const data = await response.json();
    const content = JSON.parse(data.choices[0].message.content);
    return {
      headlineInsight: content.headlineInsight || `今日阅读了 ${bookmarks.length} 篇内容`,
      connections: (content.connections || []).slice(0, 3),
    };
  } catch {
    return {
      headlineInsight: `今日阅读了 ${bookmarks.length} 篇内容`,
      connections: [],
    };
  }
}

/** 识别新概念（首次出现的概念） */
function getNewConcepts(
  concepts: ConceptRecord[],
  dayStart: number,
  dayEnd: number,
): DailyDigest["newConcepts"] {
  return concepts
    .filter((c) => c.firstSeen >= dayStart && c.firstSeen < dayEnd)
    .sort((a, b) => b.frequency - a.frequency)
    .slice(0, 5)
    .map((c) => ({
      name: c.name,
      definition: c.definition,
      source: c.occurrences[0]?.context || "",
      importance: c.frequency >= 3 ? ("high" as const) : c.frequency >= 2 ? ("medium" as const) : ("low" as const),
    }));
}

/** 生成每日简报 */
export async function generateDailyDigest(
  provider?: LLMProvider,
  targetDate?: string,
): Promise<DailyDigest | null> {
  const date = targetDate || new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().split("T")[0];
  const dayStart = new Date(date).getTime();
  const dayEnd = dayStart + 24 * 60 * 60 * 1000;

  // 获取当日书签
  const bookmarks = await getBookmarksInRange(dayStart, dayEnd);
  if (bookmarks.length === 0) {
    console.log("[daily-digest] No bookmarks for", date);
    return null;
  }

  // 获取相关概念
  const allConcepts = await db.concepts.toArray();
  const relevantConcepts = allConcepts.filter((c) =>
    c.occurrences.some((o) =>
      bookmarks.some((b) => b.id === o.bookmarkId),
    ),
  );

  // 生成简报内容
  let headlineInsight = `今日阅读了 ${bookmarks.length} 篇内容`;
  let connections: DailyDigest["connections"] = [];

  if (provider && provider.available) {
    const settings = await getSettings();
    const llmCfg = resolveLLMConfig(settings);
    if (llmCfg.apiKey) {
      const result = await generateDigestContent(
        bookmarks,
        relevantConcepts,
        llmCfg.apiKey,
        llmCfg.model || "gpt-4o-mini",
        llmCfg.baseURL,
      );
      headlineInsight = result.headlineInsight;
      connections = result.connections;
    }
  }

  // 识别新概念
  const newConcepts = getNewConcepts(allConcepts, dayStart, dayEnd);

  const digest: DailyDigest = {
    date,
    generatedAt: Date.now(),
    stats: {
      pagesIndexed: bookmarks.length,
      readingTime: totalReadingTime(bookmarks),
      domains: extractDomains(bookmarks),
    },
    headlineInsight,
    newConcepts,
    connections,
    bookmarks: bookmarks.map((b) => ({
      title: b.title,
      url: b.url,
      quickSummary: b.quickSummary || b.summary.slice(0, 80),
      contentType: b.source || "bookmark",
    })),
  };

  // 保存简报
  await saveDailyDigest(digest);
  console.log(`[daily-digest] Generated for ${date}: ${bookmarks.length} bookmarks, ${newConcepts.length} new concepts`);

  return digest;
}

/** 获取最近 N 天的简报 */
export async function getRecentDigests(days = 7): Promise<DailyDigest[]> {
  const dates: string[] = [];
  const now = new Date();
  for (let i = 1; i <= days; i++) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    dates.push(d.toISOString().split("T")[0]);
  }

  const digests = await db.dailyDigests.bulkGet(dates);
  return digests.filter((d): d is DailyDigest => d !== undefined);
}

/** 检查今天是否已生成简报 */
export async function hasDigestForDate(date: string): Promise<boolean> {
  const existing = await db.dailyDigests.get(date);
  return !!existing;
}
