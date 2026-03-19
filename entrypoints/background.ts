import {
  loadFreqCache,
  incrementFreq,
  getRecentBookmarks,
  getFreqCache,
} from "../src/freq";
import { rerankBookmarks } from "../src/search";
import { highlightBookmark } from "../src/highlight";
import { getSettings, getIndexedBookmarks, hasApiKey } from "../src/db";
import { getQueryEmbedding } from "../src/embedding";
import { hybridSearch, vectorSearch } from "../src/hybrid";
import { initIndexer, enqueueBookmark, indexAllBookmarks, pauseIndexing, resumeIndexing, getIndexingStatus, getBookmarkFolders, indexFolders } from "../src/indexer";

export default defineBackground(() => {
  // 加载频率缓存
  loadFreqCache().then((cache) => {
    console.log(
      "[bi] Frequency cache loaded:",
      Object.keys(cache).length,
      "entries",
    );
  });

  // 初始化索引器
  initIndexer();

  // 首次启动时检查是否需要索引
  hasApiKey().then((hasKey) => {
    if (hasKey) {
      console.log("[bi] API key found, starting initial index...");
      indexAllBookmarks();
    }
  });

  // Omnibox 交互
  browser.omnibox.onInputStarted.addListener(() => {
    browser.omnibox.setDefaultSuggestion({
      description:
        "🔍 Search bookmarks: <match>bi</match> <dim>keyword...</dim>",
    });
  });

  // 核心搜索逻辑
  browser.omnibox.onInputChanged.addListener(async (text, suggest) => {
    const query = text.trim();

    // 空查询：显示最常访问的书签
    if (!query) {
      const recent = getRecentBookmarks(8);
      if (recent.length === 0) {
        suggest([
          {
            content: "about:blank",
            description:
              "<dim>No bookmark history yet — visit a bookmark to build frequency data.</dim>",
          },
        ]);
        return;
      }
      suggest(
        recent.map(({ url }) => ({
          content: url,
          description: highlightBookmark(url, "", url),
        })),
      );
      return;
    }

    // 1. 获取 Chrome 原生搜索结果 (关键词搜索)
    const chromeResults = await browser.bookmarks.search(query);
    const valid = chromeResults.filter((b) => b.url !== null);

    // 2. 检查是否配置了 API Key
    const settings = await getSettings();
    if (!settings.openaiApiKey) {
      // 无 API Key: 降级为纯关键词搜索
      const suggestions = rerankBookmarks(query, valid);
      suggest(suggestions);
      return;
    }

    // 3. 获取已索引的书签
    const indexedBookmarks = await getIndexedBookmarks();

    // 如果没有已索引的书签，降级为关键词搜索
    if (indexedBookmarks.length === 0) {
      const suggestions = rerankBookmarks(query, valid);
      suggest(suggestions);
      return;
    }

    try {
      // 4. 生成查询向量
      const queryVector = await getQueryEmbedding(query, settings.openaiApiKey);

      // 5. 根据搜索模式执行搜索
      let results;
      const mode = settings.searchMode || 'hybrid';

      if (mode === 'vector') {
        // 纯向量搜索
        results = await vectorSearch(indexedBookmarks, queryVector, {
          limit: settings.searchMode ? 9 : undefined,
        });
      } else {
        // 混合搜索 (默认) 或关键词搜索
        results = await hybridSearch(valid, indexedBookmarks, queryVector, {
          mode,
          vectorWeight: settings.vectorWeight || 0.4,
          limit: 9,
        });
      }

      // 6. 转换为 Omnibox 建议
      const suggestions = results.map((record) => ({
        content: record.url,
        description: formatSuggestion(record, query, mode !== 'keyword'),
      }));

      suggest(suggestions);
    } catch (error) {
      console.error("[bi] Search error:", error);
      // 出错时降级为关键词搜索
      const suggestions = rerankBookmarks(query, valid);
      suggest(suggestions);
    }
  });

  // 打开选中的书签
  browser.omnibox.onInputEntered.addListener(async (url, disposition) => {
    const active =
      disposition === "newForegroundTab" || disposition === "currentTab";

    await browser.tabs.create({ url, active });

    // 记录访问频率
    incrementFreq(url);
    console.log("[bi] Opened:", url);
  });

  // 监听来自 Options 页面的消息
  browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
    switch (message.type) {
      case 'START_INDEXING':
        indexAllBookmarks();
        sendResponse({ success: true });
        break;
      case 'PAUSE_INDEXING':
        pauseIndexing();
        sendResponse({ success: true });
        break;
      case 'RESUME_INDEXING':
        resumeIndexing();
        sendResponse({ success: true });
        break;
      case 'GET_INDEXING_STATUS':
        const status = getIndexingStatus();
        sendResponse(status);
        break;
      case 'GET_BOOKMARK_FOLDERS':
        getBookmarkFolders().then(folders => {
          sendResponse({ success: true, folders });
        }).catch(error => {
          sendResponse({ success: false, error: error.message });
        });
        return true; // 异步响应
      case 'INDEX_FOLDERS':
        indexFolders(message.folderIds).then(result => {
          sendResponse({ success: true, ...result });
        }).catch(error => {
          sendResponse({ success: false, error: error.message });
        });
        return true; // 异步响应
      default:
        sendResponse({ success: false, error: 'Unknown message type' });
    }
    return true;
  });
});

/**
 * 格式化搜索建议
 */
function formatSuggestion(
  record: { url: string; title: string; summary: string },
  query: string,
  showAi: boolean
): string {
  const prefix = showAi ? "🤖 " : "";
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
