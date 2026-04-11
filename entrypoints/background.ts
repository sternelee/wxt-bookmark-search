import {
  loadFreqCache,
  incrementFreq,
  getRecentBookmarks,
  getFreqCache,
} from "../src/freq";
import { rerankBookmarks } from "../src/search";
import { highlightBookmark } from "../src/highlight";
import {
  getSettings,
  ensureCachedIndexedBookmarks,
  hasApiKey,
} from "../src/db";
import type { BookmarkRecord, SearchResult } from "../src/types";
import { getQueryEmbedding } from "../src/embedding";
import { hybridSearch, vectorSearch } from "../src/hybrid";
import {
  initIndexer,
  enqueueBookmark,
  indexAllBookmarks,
  pauseIndexing,
  resumeIndexing,
  retryFailed,
  getIndexingStatus,
  getBookmarkFolders,
  indexFolders,
  syncGithubStars,
  syncTwitterBookmarks,
} from "../src/indexer";

// 搜索防抖状态
let searchTimer: ReturnType<typeof setTimeout> | null = null;
let searchAbortController: AbortController | null = null;

/**
 * 判断字符串是否为可直接导航的 URL（http/https）
 */
function isNavigableUrl(str: string): boolean {
  try {
    const url = new URL(str);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

/**
 * 将 BookmarkRecord 转换为轻量 SearchResult DTO
 */
function toSearchResult(record: BookmarkRecord): SearchResult {
  let source: SearchResult["source"] = "bookmark";
  if (record.id.startsWith("gh-")) source = "github";
  else if (record.id.startsWith("tw-")) source = "twitter";

  return {
    url: record.url,
    title: record.title,
    summary: record.summary ?? "",
    tags: record.tags ?? [],
    source,
    indexed: record.status === "indexed",
  };
}

/**
 * 执行全局搜索（供独立搜索页调用）
 * 复用 omnibox 搜索的完整逻辑，返回最多 20 条 SearchResult
 */
async function performFullSearch(rawInput: string): Promise<SearchResult[]> {
  let query = rawInput.trim();
  let explicitFolderNames: string[] = [];
  let sourceFilter: "github" | "twitter" | null = null;

  // 解析 /github /twitter /folder: 语法
  const githubMatch = query.match(/^\/github\s+(.*)/i);
  if (githubMatch) {
    sourceFilter = "github";
    query = githubMatch[1].trim();
  }
  const twitterMatch = query.match(/^\/twitter\s+(.*)/i);
  if (twitterMatch) {
    sourceFilter = "twitter";
    query = twitterMatch[1].trim();
  }
  if (!sourceFilter) {
    const folderMatch = query.match(/^\/folder:(\S+)\s+(.*)/i);
    if (folderMatch) {
      explicitFolderNames = [folderMatch[1].toLowerCase()];
      query = folderMatch[2].trim();
    }
  }

  if (!query) return [];

  const settings = await getSettings();
  let allowedUrls: Set<string> | null = null;

  if (sourceFilter === "github") {
    const { db } = await import("../src/db");
    const ghBookmarks = await db.bookmarks
      .filter((r) => r.id.startsWith("gh-"))
      .toArray();
    allowedUrls = new Set(ghBookmarks.map((r) => r.url));
  } else if (sourceFilter === "twitter") {
    const { db } = await import("../src/db");
    const twBookmarks = await db.bookmarks
      .filter((r) => r.id.startsWith("tw-"))
      .toArray();
    allowedUrls = new Set(twBookmarks.map((r) => r.url));
  } else if (explicitFolderNames.length > 0) {
    const folders = await browser.bookmarks.search({
      title: explicitFolderNames[0],
    });
    const folderIds = folders.filter((f) => !f.url).map((f) => f.id);
    if (folderIds.length > 0) {
      allowedUrls = await getAllUrlsInFoldersForSearch(folderIds);
    }
  } else if (settings.selectedFolderIds && settings.selectedFolderIds.length > 0) {
    allowedUrls = await getAllUrlsInFoldersForSearch(settings.selectedFolderIds);
  }

  // 关键词搜索
  let chromeResults = await browser.bookmarks.search(query);
  let valid = chromeResults.filter((b) => b.url != null);
  if (allowedUrls) {
    valid = valid.filter((b) => allowedUrls!.has(b.url!));
  }

  if (!settings.openaiApiKey) {
    return valid.slice(0, 20).map((b) => ({
      url: b.url!,
      title: b.title ?? b.url!,
      summary: "",
      tags: [],
      source: "bookmark" as const,
      indexed: false,
    }));
  }

  // 向量搜索
  const allIndexed = await ensureCachedIndexedBookmarks();
  let filteredIndexed = allowedUrls
    ? allIndexed.filter((idx) => allowedUrls!.has(idx.url))
    : allIndexed;

  if (filteredIndexed.length === 0 && valid.length === 0) return [];

  try {
    const queryVector = await getQueryEmbedding(
      query,
      settings.openaiApiKey,
      undefined,
      settings.embeddingModel,
    );
    const mode = settings.searchMode || "hybrid";
    let results: BookmarkRecord[];

    if (mode === "vector") {
      results = await vectorSearch(filteredIndexed, queryVector, { limit: 20 });
    } else {
      results = await hybridSearch(valid, filteredIndexed, queryVector, {
        mode,
        vectorWeight: settings.vectorWeight || 0.4,
        limit: 20,
      });
    }

    return results.map(toSearchResult);
  } catch (err) {
    console.error("[FlowSearch] performFullSearch error:", err);
    // 降级到关键词结果
    return valid.slice(0, 20).map((b) => ({
      url: b.url!,
      title: b.title ?? b.url!,
      summary: "",
      tags: [],
      source: "bookmark" as const,
      indexed: false,
    }));
  }
}

/**
 * 递归获取文件夹下所有书签 URL（供 performFullSearch 使用）
 */
async function getAllUrlsInFoldersForSearch(
  folderIds: string[],
): Promise<Set<string>> {
  const urls = new Set<string>();
  for (const id of folderIds) {
    try {
      const subtree = await browser.bookmarks.getSubTree(id);
      const traverse = (nodes: any[]) => {
        for (const node of nodes) {
          if (node.url) urls.add(node.url);
          if (node.children) traverse(node.children);
        }
      };
      traverse(subtree);
    } catch (e) {
      console.warn(`[FlowSearch] Failed to fetch subtree for folder ${id}:`, e);
    }
  }
  return urls;
}

export default defineBackground(() => {
  // 加载频率缓存
  loadFreqCache().then((cache) => {
    console.log(
      "[FlowSearch] Frequency cache loaded:",
      Object.keys(cache).length,
      "entries",
    );
  });

  // 初始化索引器
  initIndexer().then(() => {
    console.log("[FlowSearch] Indexer initialized");
  });

  // 预热已索引书签缓存
  ensureCachedIndexedBookmarks().then((cached) => {
    console.log(
      "[FlowSearch] Indexed bookmark cache loaded:",
      cached.length,
      "entries",
    );
  });

  // 首次启动时检查是否需要索引
  hasApiKey().then((hasKey) => {
    if (hasKey) {
      console.log("[FlowSearch] API key found, starting initial index...");
      indexAllBookmarks();
    }
  });

  // Omnibox 交互
  browser.omnibox.onInputStarted.addListener(() => {
    browser.omnibox.setDefaultSuggestion({
      description:
        "🔍 Flow Search — 输入关键词后按 Enter 打开全页搜索，或选择书签直接跳转 <dim>(/github /twitter /folder:名称)</dim>",
    });
  });

  /**
   * 递归获取文件夹及其子文件夹下所有的书签 URL
   */
  async function getAllUrlsInFolders(
    folderIds: string[],
  ): Promise<Set<string>> {
    const urls = new Set<string>();

    for (const id of folderIds) {
      try {
        const subtree = await browser.bookmarks.getSubTree(id);

        const traverse = (nodes: any[]) => {
          for (const node of nodes) {
            if (node.url) {
              urls.add(node.url);
            }
            if (node.children) {
              traverse(node.children);
            }
          }
        };

        traverse(subtree);
      } catch (e) {
        console.warn(
          `[FlowSearch] Failed to fetch subtree for folder ${id}:`,
          e,
        );
      }
    }

    return urls;
  }

  // 核心搜索逻辑
  browser.omnibox.onInputChanged.addListener(async (text, suggest) => {
    const rawInput = text.trim();

    // 1. 命令引导与文件夹补全逻辑
    if (rawInput === "/") {
      suggest([
        {
          content: "/github ",
          description:
            "🔮 <match>/github</match><dim>关键词</dim> — 搜索 GitHub Stars",
        },
        {
          content: "/twitter ",
          description:
            "🐦 <match>/twitter</match><dim>关键词</dim> — 搜索 Twitter 书签",
        },
        {
          content: "/folder:",
          description:
            "📁 <match>/folder:</match><dim>名称 关键词</dim> — 限定在特定文件夹中搜索",
        },
      ]);
      return;
    }

    // /folder: 自动补全
    if (rawInput.startsWith("/folder:") && !rawInput.includes(" ")) {
      const folderPart = rawInput.substring(8);
      const allFolders = await browser.bookmarks.search({});
      const folders = allFolders.filter(
        (f) =>
          !f.url &&
          (folderPart === "" ||
            f.title.toLowerCase().includes(folderPart.toLowerCase())),
      );
      const folderSuggestions = folders.slice(0, 8).map((f) => ({
        content: `/folder:${f.title} `,
        description: `📁 搜索文件夹: <match>${escapeXml(f.title)}</match>`,
      }));
      if (folderSuggestions.length > 0) {
        suggest(folderSuggestions);
        return;
      }
    }

    let query = rawInput;
    let explicitFolderNames: string[] = [];
    let sourceFilter: 'github' | 'twitter' | null = null;

    // 解析 /github 语法
    const githubMatch = query.match(/^\/github\s+(.*)$/i);
    if (githubMatch) {
      sourceFilter = 'github';
      query = githubMatch[1].trim();
    }

    // 解析 /twitter 语法
    const twitterMatch = query.match(/^\/twitter\s+(.*)$/i);
    if (twitterMatch) {
      sourceFilter = 'twitter';
      query = twitterMatch[1].trim();
    }

    // 解析 /folder:xxx keyword (兼容)
    if (!sourceFilter) {
      const folderMatch = query.match(/^\/folder:(\S+)\s+(.*)$/i);
      if (folderMatch) {
        explicitFolderNames = [folderMatch[1].toLowerCase()];
        query = folderMatch[2].trim();
      }
    }

    if (!query) {
      // 空查询 — 显示最近访问书签，并按来源过滤
      const recent = getRecentBookmarks(8);
      let filtered: Array<{ url: string }> = recent;
      if (sourceFilter === 'github') {
        filtered = recent.filter(({ url }) => url.includes('github.com'));
      } else if (sourceFilter === 'twitter') {
        filtered = recent.filter(({ url }) => url.includes('x.com') || url.includes('twitter.com'));
      }
      suggest(
        filtered.slice(0, 8).map(({ url }) => ({
          content: url,
          description: highlightBookmark(url, "", url),
        })),
      );
      return;
    }

    // --- 确定搜索作用域 ---
    const settings = await getSettings();
    let allowedUrls: Set<string> | null = null;

    if (sourceFilter === 'github') {
      // GitHub: 从 DB 获取所有 gh- 开头的书签
      const { db } = await import("../src/db");
      const ghBookmarks = await db.bookmarks
        .filter(r => r.id.startsWith('gh-'))
        .toArray();
      allowedUrls = new Set(ghBookmarks.map(r => r.url));
    } else if (sourceFilter === 'twitter') {
      // Twitter: 从 DB 获取所有 tw- 开头的书签
      const { db } = await import("../src/db");
      const twBookmarks = await db.bookmarks
        .filter(r => r.id.startsWith('tw-'))
        .toArray();
      allowedUrls = new Set(twBookmarks.map(r => r.url));
    } else if (explicitFolderNames.length > 0) {
      // 如果使用了 /folder: 语法，优先级最高，精准定位文件夹
      const folders = await browser.bookmarks.search({
        title: explicitFolderNames[0],
      });
      const folderIds = folders.filter((f) => !f.url).map((f) => f.id);
      if (folderIds.length > 0) {
        allowedUrls = await getAllUrlsInFolders(folderIds);
      }
    } else if (
      settings.selectedFolderIds &&
      settings.selectedFolderIds.length > 0
    ) {
      // 如果没有语法，但设置中指定了目录，则使用设置的作用域
      allowedUrls = await getAllUrlsInFolders(settings.selectedFolderIds);
    }

    // 1. 获取关键词搜索结果，并应用过滤
    let chromeResults = await browser.bookmarks.search(query);
    let valid = chromeResults.filter((b) => b.url !== null);
    if (allowedUrls) {
      valid = valid.filter((b) => allowedUrls!.has(b.url!));
    }

    // 2. 检查 API Key
    if (!settings.openaiApiKey) {
      suggest(rerankBookmarks(query, valid));
      return;
    }

    // 3. 获取已索引书签，并应用过滤
    const allIndexed = await ensureCachedIndexedBookmarks();
    let filteredIndexed = allIndexed;
    if (allowedUrls) {
      filteredIndexed = allIndexed.filter((idx) => allowedUrls!.has(idx.url));
    }

    if (filteredIndexed.length === 0 && valid.length === 0) {
      suggest([]);
      return;
    }

    // === 防抖搜索：快速路径保持立即响应，向量搜索包裹 debounce ===
    if (searchTimer) clearTimeout(searchTimer);
    if (searchAbortController) searchAbortController.abort();
    searchAbortController = new AbortController();
    const signal = searchAbortController.signal;

    searchTimer = setTimeout(async () => {
      try {
        // 4. 生成查询向量
        const apiKey = settings.openaiApiKey!;
        const queryVector = await getQueryEmbedding(
          query,
          apiKey,
          signal,
          settings.embeddingModel
        );

        // 如果已中止，直接返回
        if (signal.aborted) return;

        // 5. 执行混合搜索
        let results;
        const mode = settings.searchMode || "hybrid";

        if (mode === "vector") {
          results = await vectorSearch(filteredIndexed, queryVector, {
            limit: 9,
          }, signal);
        } else {
          results = await hybridSearch(valid, filteredIndexed, queryVector, {
            mode,
            vectorWeight: settings.vectorWeight || 0.4,
            limit: 9,
          }, signal);
        }

        suggest(
          results.map((record) => ({
            content: record.url,
            description: formatSuggestion(record, query, mode !== "keyword"),
          })),
        );
      } catch (error: any) {
        // 忽略 AbortError，静默返回
        if (error.name === "AbortError" || error.message?.includes("aborted"))
          return;
        console.error("[FlowSearch] Search error:", error);
        suggest(rerankBookmarks(query, valid));
      }
    }, 150);
  });

  // 打开选中的书签，或在非 URL 选中时打开全局搜索页
  browser.omnibox.onInputEntered.addListener(async (text, disposition) => {
    let targetUrl: string;

    if (isNavigableUrl(text)) {
      // 用户选择了具体书签建议
      targetUrl = text;
      incrementFreq(targetUrl);
    } else {
      // 用户按下 Enter 选中了默认建议（原始查询文本）
      // 打开独立搜索页
      const searchPageUrl =
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (browser.runtime.getURL as any)("/search.html") +
        "?q=" +
        encodeURIComponent(text);
      targetUrl = searchPageUrl;
    }

    // 根据 disposition 正确处理标签页语义
    switch (disposition) {
      case "currentTab":
        await browser.tabs.update({ url: targetUrl });
        break;
      case "newBackgroundTab":
        await browser.tabs.create({ url: targetUrl, active: false });
        break;
      case "newForegroundTab":
      default:
        await browser.tabs.create({ url: targetUrl, active: true });
        break;
    }

    console.log("[FlowSearch] onInputEntered:", disposition, "→", targetUrl);
  });

  // 监听来自 Options 页面的消息
  browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
    // 处理同步消息
    if (message.type === "GET_INDEXING_STATUS") {
      sendResponse(getIndexingStatus());
      return false;
    }

    // 处理异步消息
    const handleAsync = async () => {
      try {
        switch (message.type) {
          case "FULL_SEARCH": {
            const results = await performFullSearch(message.query ?? "");
            return { success: true, results };
          }
          case "START_INDEXING":
            indexAllBookmarks();
            return { success: true };
          case "PAUSE_INDEXING":
            pauseIndexing();
            return { success: true };
          case "RESUME_INDEXING":
            resumeIndexing();
            return { success: true };
          case "RETRY_FAILED":
            retryFailed();
            return { success: true };
          case "GET_FAILED_BOOKMARKS":
            const { getFailedBookmarks } = await import("../src/db");
            const failed = await getFailedBookmarks();
            return { success: true, failed };
          case "DELETE_BOOKMARK":
            const { deleteBookmark } = await import("../src/db");
            try {
              await browser.bookmarks.remove(message.id);
            } catch (e) {
              console.debug("[FlowSearch] Bookmark already gone from browser");
            }
            await deleteBookmark(message.id);
            return { success: true };
          case "GET_BOOKMARK_FOLDERS":
            const folders = await getBookmarkFolders();
            return { success: true, folders };
          case "INDEX_FOLDERS":
            const folderResult = await indexFolders(message.folderIds);
            return { success: true, ...folderResult };
          case "SYNC_GITHUB_STARS":
            const ghResult = await syncGithubStars();
            return { success: true, ...ghResult };
          case "SYNC_TWITTER_BOOKMARKS":
            const twResult = await syncTwitterBookmarks();
            return { success: true, ...twResult };
          default:
            return { success: false, error: "Unknown message type" };
        }
      } catch (error: any) {
        console.error(`[FlowSearch] Message error (${message.type}):`, error);
        return { success: false, error: error.message };
      }
    };

    handleAsync().then(sendResponse);
    return true; // 关键：保持通道开启
  });
});

/**
 * 格式化搜索建议
 * 仅对已索引记录显示 🤖 前缀
 */
function formatSuggestion(
  record: BookmarkRecord,
  query: string,
  showAi: boolean,
): string {
  const aiActive = showAi && record.status === 'indexed';
  const prefix = aiActive ? "🤖 " : "";
  const title = record.title || record.url;
  const summary = record.summary?.slice(0, 50) || "";

  return `${prefix}<match>${escapeXml(title)}</match> <dim>${escapeXml(summary)}...</dim> <url>${escapeXml(record.url)}</url>`;
}

/**
 * XML 转义 (用于 omnibox description)
 */
function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
