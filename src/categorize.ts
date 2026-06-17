/**
 * AI auto-categorization — 使用 LLM 根据书签内容自动归类到技术主题
 */
import type { CategorySuggestion } from "./types";
import { db, getSettings } from "./db";
import { resolveLLMConfig } from "./service-config";

const BATCH_SIZE = 20;
const MAX_CONTENT_LENGTH = 4000;

const CATEGORIES = [
  "Frontend",
  "Backend",
  "DevOps",
  "AI/ML",
  "Rust",
  "Go",
  "Python",
  "JavaScript/TypeScript",
  "Mobile",
  "Database",
  "Security",
  "Design",
  "Productivity",
  "Other",
];

/**
 * 获取分类建议（干跑，不实际移动书签）
 * @param bookmarkIds 要分类的书签 ID 列表
 * @param signal 可用于取消
 */
export async function getCategorySuggestions(
  bookmarkIds: string[],
  signal?: AbortSignal,
): Promise<CategorySuggestion[]> {
  const settings = await getSettings();
  const llmCfg = resolveLLMConfig(settings);
  if (!llmCfg.apiKey) {
    throw new Error("API Key not configured");
  }

  const baseURL = llmCfg.baseURL;
  const model = llmCfg.model || "gpt-4o-mini";
  const customRules = settings.categoryRules || "";

  // 获取书签记录
  const records = await db.bookmarks.bulkGet(bookmarkIds);
  const validRecords = records.filter(
    (r): r is NonNullable<typeof r> => r !== undefined,
  );

  if (validRecords.length === 0) return [];

  const allSuggestions: CategorySuggestion[] = [];

  // 分批处理
  for (let i = 0; i < validRecords.length; i += BATCH_SIZE) {
    if (signal?.aborted) break;

    const batch = validRecords.slice(i, i + BATCH_SIZE);
    const suggestions = await categorizeBatch(
      batch,
      baseURL,
      llmCfg.apiKey,
      model,
      customRules,
      signal,
    );
    allSuggestions.push(...suggestions);
  }

  return allSuggestions;
}

/** 分类一批书签 */
async function categorizeBatch(
  bookmarks: {
    id: string;
    url: string;
    title: string;
    summary?: string;
    tags?: string[];
  }[],
  baseURL: string,
  apiKey: string,
  model: string,
  customRules: string,
  signal?: AbortSignal,
): Promise<CategorySuggestion[]> {
  const apiUrl = `${baseURL.replace(/\/$/, "")}/v1/chat/completions`;

  // 构建书签列表
  const bookmarkList = bookmarks
    .map((b) => {
      const summary = (b.summary || "").slice(0, 200);
      const tags = b.tags?.length ? b.tags.join(", ") : "";
      return `ID:${b.id}\nURL:${b.url}\nTitle:${b.title}${summary ? `\nSummary:${summary}` : ""}${tags ? `\nTags:${tags}` : ""}`;
    })
    .join("\n\n---\n\n")
    .slice(0, MAX_CONTENT_LENGTH);

  const categoriesStr = CATEGORIES.map((c) => `"${c}"`).join(", ");

  let rulesSection = "";
  if (customRules) {
    rulesSection = `\nAdditional user-defined categorization rules:\n${customRules}\n`;
  }

  const systemPrompt = `You are a bookmark categorizer. Given a list of bookmarks (URL, title, summary, tags), categorize each into one of these technical topics: [${categoriesStr}].

Rules:
- Base categorization on URL domain patterns, title keywords, summary content, and existing tags
- A GitHub repo is categorized by its primary language and README description
- A blog post is categorized by its main technical topic
- A tool/library is categorized by what problem it solves
- If uncertain, use "Other" with "low" confidence
${rulesSection}
Return ONLY a valid JSON array of objects, each with:
- "bookmarkId": string
- "suggestedCategory": one of [${categoriesStr}]
- "confidence": "high" | "medium" | "low"
- "reasoning": short explanation (one sentence)

Example output:
[
  {"bookmarkId": "123", "suggestedCategory": "Rust", "confidence": "high", "reasoning": "GitHub repo with Rust as primary language, CLI tool for file management"},
  {"bookmarkId": "456", "suggestedCategory": "Frontend", "confidence": "medium", "reasoning": "Blog post about React component library patterns"}
]`;

  const response = await fetch(apiUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content: `Bookmarks to categorize:\n\n${bookmarkList}`,
        },
      ],
      response_format: { type: "json_object" },
      temperature: 0.2,
    }),
    signal,
  });

  if (!response.ok) {
    throw new Error(
      `Categorization API error: ${response.status} ${response.statusText}`,
    );
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error("Empty response from categorization API");
  }

  let items: {
    bookmarkId?: string;
    suggestedCategory?: string;
    confidence?: string;
    reasoning?: string;
  }[];

  try {
    const parsed = JSON.parse(content);
    if (Array.isArray(parsed)) {
      items = parsed;
    } else if (parsed && typeof parsed === "object") {
      // 有时 LLM 会包在一个对象里
      items = parsed.results || parsed.categories || parsed.items || [];
    } else {
      items = [];
    }
  } catch {
    throw new Error("Failed to parse categorization response");
  }

  const validCategories = new Set(CATEGORIES);

  return items
    .filter((item) => item.bookmarkId)
    .map((item) => {
      const category = item.suggestedCategory || "Other";
      const confidence =
        item.confidence === "high" ||
        item.confidence === "medium" ||
        item.confidence === "low"
          ? item.confidence
          : "medium";

      const original = bookmarks.find((b) => b.id === item.bookmarkId);

      return {
        bookmarkId: item.bookmarkId!,
        url: original?.url || "",
        title: original?.title || "",
        suggestedCategory: validCategories.has(category) ? category : "Other",
        confidence: confidence as "high" | "medium" | "low",
        reasoning: item.reasoning || "",
      };
    });
}

/**
 * 应用分类：将书签移动到对应文件夹
 * @param suggestions 分类建议
 * @param categoryFolderMap 分类名 → 浏览器文件夹 ID 映射
 * @param rootParentId 新建文件夹的默认父目录 ID
 * @param createFolder 创建文件夹回调
 * @param moveBookmark 移动书签回调
 */
export async function applyCategories(
  suggestions: CategorySuggestion[],
  categoryFolderMap: Record<string, string>,
  rootParentId: string,
  createFolder: (parentId: string, title: string) => Promise<string>,
  moveBookmark: (id: string, parentId: string) => Promise<void>,
): Promise<{ moved: number; created: number; skipped: number }> {
  let moved = 0;
  let created = 0;
  let skipped = 0;

  for (const suggestion of suggestions) {
    try {
      let targetFolderId = categoryFolderMap[suggestion.suggestedCategory];

      if (!targetFolderId) {
        // 创建新文件夹
        try {
          targetFolderId = await createFolder(
            rootParentId,
            suggestion.suggestedCategory,
          );
          categoryFolderMap[suggestion.suggestedCategory] = targetFolderId;
          created++;
        } catch {
          skipped++;
          continue;
        }
      }

      // 移动书签
      try {
        await moveBookmark(suggestion.bookmarkId, targetFolderId);
        moved++;
      } catch {
        skipped++;
      }
    } catch {
      skipped++;
    }
  }

  return { moved, created, skipped };
}
