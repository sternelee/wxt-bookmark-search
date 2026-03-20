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
      "[FlowSearch] Frequency cache loaded:",
      Object.keys(cache).length,
      "entries",
    );
  });

  // 初始化索引器
  initIndexer();

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
        "🔍 Flow Search: <match>bi</match> <dim>keyword...</dim>",
    });
  });

/**
 * 递归获取文件夹及其子文件夹下所有的书签 URL
 */
async function getAllUrlsInFolders(folderIds: string[]): Promise<Set<string>> {
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
      console.warn(`[FlowSearch] Failed to fetch subtree for folder ${id}:`, e);
    }
  }
  
  return urls;
}

  // 核心搜索逻辑
  browser.omnibox.onInputChanged.addListener(async (text, suggest) => {
    const rawInput = text.trim();
    
    // 1. 命令引导与文件夹补全逻辑 (保持不变...)
    if (rawInput === "/") {
      suggest([{ content: "/folder:", description: "📁 <match>/folder:</match><dim>名称 关键词</dim> — 限定在特定文件夹中搜索" }]);
      return;
    }
    if (rawInput.startsWith("/folder:") && !rawInput.includes(" ")) {
      const folderPart = rawInput.substring(8);
      const allFolders = await browser.bookmarks.search({});
      const folders = allFolders.filter(f => !f.url && (folderPart === "" || f.title.toLowerCase().includes(folderPart.toLowerCase())));
      const folderSuggestions = folders.slice(0, 8).map(f => ({
        content: `/folder:${f.title} `,
        description: `📁 搜索文件夹: <match>${escapeXml(f.title)}</match>`
      }));
      if (folderSuggestions.length > 0) { suggest(folderSuggestions); return; }
    }

    let query = rawInput;
    let explicitFolderNames: string[] = [];

    // 解析搜索语法: /folder:xxx keyword
    const folderMatch = query.match(/^\/folder:(\S+)\s+(.*)$/i);
    if (folderMatch) {
      explicitFolderNames = [folderMatch[1].toLowerCase()];
      query = folderMatch[2].trim();
    }

    if (!query) {
      // 空查询逻辑...
      const recent = getRecentBookmarks(8);
      suggest(recent.map(({ url }) => ({ content: url, description: highlightBookmark(url, "", url) })));
      return;
    }

    // --- 核心改进：确定搜索作用域 ---
    const settings = await getSettings();
    let allowedUrls: Set<string> | null = null;

    if (explicitFolderNames.length > 0) {
      // 如果使用了 /folder: 语法，优先级最高，精准定位文件夹
      const folders = await browser.bookmarks.search({ title: explicitFolderNames[0] });
      const folderIds = folders.filter(f => !f.url).map(f => f.id);
      if (folderIds.length > 0) {
        allowedUrls = await getAllUrlsInFolders(folderIds);
      }
    } else if (settings.selectedFolderIds && settings.selectedFolderIds.length > 0) {
      // 如果没有语法，但设置中指定了目录，则使用设置的作用域
      allowedUrls = await getAllUrlsInFolders(settings.selectedFolderIds);
    }

    // 1. 获取关键词搜索结果，并应用过滤
    let chromeResults = await browser.bookmarks.search(query);
    let valid = chromeResults.filter((b) => b.url !== null);
    if (allowedUrls) {
      valid = valid.filter(b => allowedUrls!.has(b.url!));
    }

    // 2. 检查 API Key
    if (!settings.openaiApiKey) {
      suggest(rerankBookmarks(query, valid));
      return;
    }

    // 3. 获取已索引书签，并应用过滤
    const allIndexed = await getIndexedBookmarks();
    let filteredIndexed = allIndexed;
    if (allowedUrls) {
      filteredIndexed = allIndexed.filter(idx => allowedUrls!.has(idx.url));
    }

    if (filteredIndexed.length === 0 && valid.length === 0) {
      suggest([]); return;
    }

    try {
      // 4. 生成查询向量
      const queryVector = await getQueryEmbedding(query, settings.openaiApiKey);

      // 5. 执行混合搜索
      let results;
      const mode = settings.searchMode || 'hybrid';

      if (mode === 'vector') {
        results = await vectorSearch(filteredIndexed, queryVector, { limit: 9 });
      } else {
        results = await hybridSearch(valid, filteredIndexed, queryVector, {
          mode,
          vectorWeight: settings.vectorWeight || 0.4,
          limit: 9,
        });
      }

      suggest(results.map((record) => ({
        content: record.url,
        description: formatSuggestion(record, query, mode !== 'keyword'),
      })));
    } catch (error) {
      console.error("[FlowSearch] Search error:", error);
      suggest(rerankBookmarks(query, valid));
    }
  });

  // 打开选中的书签
  browser.omnibox.onInputEntered.addListener(async (url, disposition) => {
    const active =
      disposition === "newForegroundTab" || disposition === "currentTab";

    await browser.tabs.create({ url, active });

    // 记录访问频率
    incrementFreq(url);
    console.log("[FlowSearch] Opened:", url);
  });

  // 监听来自 Options 页面的消息
  browser.runtime.onMessage.addListener(async (message, sender, sendResponse) => {
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
      case 'RETRY_FAILED':
        retryFailed();
        sendResponse({ success: true });
        break;
      case 'GET_INDEXING_STATUS':
        const status = getIndexingStatus();
        sendResponse(status);
        break;
      case 'GET_FAILED_BOOKMARKS':
        try {
          const { getFailedBookmarks } = await import('../src/db');
          const failed = await getFailedBookmarks();
          sendResponse({ success: true, failed });
        } catch (e) {
          sendResponse({ success: false, error: String(e) });
        }
        break;
      case 'DELETE_BOOKMARK':
        try {
          const { deleteBookmark } = await import('../src/db');
          // 1. 从浏览器删除
          await browser.bookmarks.remove(message.id);
          // 2. 从本地数据库删除
          await deleteBookmark(message.id);
          sendResponse({ success: true });
        } catch (error: any) {
          // 如果书签在浏览器中已不存在，依然尝试从本地库清理
          const { deleteBookmark } = await import('../src/db');
          await deleteBookmark(message.id);
          sendResponse({ success: false, error: error.message });
        }
        break;
      case 'GET_BOOKMARK_FOLDERS':
        try {
          const folders = await getBookmarkFolders();
          sendResponse({ success: true, folders });
        } catch (error: any) {
          sendResponse({ success: false, error: error.message });
        }
        break;
      case 'INDEX_FOLDERS':
        try {
          const result = await indexFolders(message.folderIds);
          sendResponse({ success: true, ...result });
        } catch (error: any) {
          sendResponse({ success: false, error: error.message });
        }
        break;
      default:
        sendResponse({ success: false, error: 'Unknown message type' });
    }
    return true; // 保持通道开启以进行异步响应
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
