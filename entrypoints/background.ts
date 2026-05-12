import { installPolyfills } from "../src/polyfills";
import {
  loadFreqCache,
  incrementFreq,
  getRecentBookmarks,
  getFreqCache,
} from "../src/freq";
import { rerankBookmarks, getMatchQuality } from "../src/search";
import {
  highlightBookmark,
  highlightBookmarkPlain,
  escapeXml,
} from "../src/highlight";
import { getSettings, hasApiKey, saveSettings } from "../src/db";
import type {
  BookmarkRecord,
  SearchResult,
  Settings,
  GistBookmarkNode,
} from "../src/types";
import {
  getQueryEmbedding,
  getCacheStats,
  clearEmbeddingCache,
  hasCachedQuery,
} from "../src/embedding";
import {
  initSearchEngine,
  populateSearchEngine,
  saveSearchEngine,
  loadSearchEngine,
  searchHybrid,
  searchVector,
  removeFromSearchEngine,
  registerSaveFn,
  scheduleSaveSearchEngine,
} from "../src/search-engine";
import type { RawData } from "@orama/orama";
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
  stripMarkdownToPlainText,
  fetchPageContent,
} from "../src/indexer";
import { syncHistoryBookmarks } from "../src/history";
import { t } from "../src/i18n";
import {
  fullGistSync,
  ensureDeviceId,
  recordBookmarkDeletion,
  buildBookmarkKey,
  uploadToGist,
  downloadFromGist,
} from "../src/gist-sync";
import {
  getPreferredBookmarkRoot,
  resolveBookmarkRootFolder,
} from "../src/bookmarkRoots";
import {
  autoCreateLLMProvider,
  setLLMProvider,
  getLLMProvider,
} from "../src/ai-providers/llm-base";
import { checkLinks, getLinkHealthStats, getDeadLinks } from "../src/health";
import {
  findDuplicates,
  resolveDuplicates,
  buildFolderPathMapFromTree,
} from "../src/dedup";
import type { BookmarkTreeNode } from "../src/dedup";
import { getCategorySuggestions, applyCategories } from "../src/categorize";
import {
  getCloudProvider,
  uploadCloudSync,
  downloadCloudSync,
  testCloudConnection,
  getCloudSyncStatus,
  deleteCloudSync,
  CloudSyncError,
} from "../src/cloud-sync";

// 搜索防抖状态
let searchTimer: ReturnType<typeof setTimeout> | null = null;
let searchAbortController: AbortController | null = null;

// Gist 同步防抖状态
const GIST_SYNC_DEBOUNCE_MS = 5000;
let gistSyncTimer: ReturnType<typeof setTimeout> | null = null;
let isSyncingGist = false;
/** 当 gist 同步正在向本地添加书签时，跳过事件监听以防递归 */
let gistSyncLock = false;
/** 同步进行中若又有本地变更，完成后补一次同步，避免丢事件 */
let pendingGistSync = false;

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
  else if (record.id.startsWith("hi-")) source = "history";

  const rawSummary = record.summary ?? "";
  const isGithub =
    source === "github" ||
    record.source === "github" ||
    record.url.includes("github.com");
  const summary = isGithub ? stripMarkdownToPlainText(rawSummary) : rawSummary;

  return {
    url: record.url,
    title: record.title,
    summary,
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
  let sourceFilter: "github" | "twitter" | "history" | null = null;

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
  const historyMatch = query.match(/^\/history\s+(.*)/i);
  if (historyMatch) {
    sourceFilter = "history";
    query = historyMatch[1].trim();
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
  } else if (sourceFilter === "history") {
    const { db } = await import("../src/db");
    const hiBookmarks = await db.bookmarks
      .filter((r) => r.id.startsWith("hi-"))
      .toArray();
    allowedUrls = new Set(hiBookmarks.map((r) => r.url));
  } else if (explicitFolderNames.length > 0) {
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
    allowedUrls = await getAllUrlsInFolders(settings.selectedFolderIds);
  }

  // 关键词搜索
  let chromeResults = await browser.bookmarks.search(query);
  let valid = chromeResults.filter((b) => b.url != null);
  if (allowedUrls) {
    valid = valid.filter((b) => allowedUrls!.has(b.url!));
  }

  // 多词查询：过滤掉仅部分匹配的低质量结果，减少噪音进入混合搜索
  if (query.includes(" ")) {
    const topChromeUrls = new Set(valid.slice(0, 6).map((b) => b.url));
    valid = valid.filter((b) => {
      const q = getMatchQuality(query, b.title, b.url ?? "");
      return q.score >= 2 || topChromeUrls.has(b.url);
    });
  }

  if (!settings.openaiApiKey) {
    const suggestions = rerankBookmarks(query, valid, IS_FIREFOX);
    return suggestions.slice(0, 20).map((s) => {
      const b = valid.find((x) => x.url === s.content);
      return {
        url: s.content,
        title: b?.title ?? s.content,
        summary: "",
        tags: [],
        source: "bookmark" as const,
        indexed: false,
      };
    });
  }

  // Orama 搜索
  if (valid.length === 0 && !settings.openaiApiKey) return [];

  if (!settings.openaiApiKey) {
    // 无 API Key：Chrome 关键词搜索（不依赖 Orama）
    const suggestions = rerankBookmarks(query, valid, IS_FIREFOX);
    return suggestions.slice(0, 20).map((s) => {
      const b = valid.find((x) => x.url === s.content);
      return {
        url: s.content,
        title: b?.title ?? s.content,
        summary: "",
        tags: [],
        source: "bookmark" as const,
        indexed: false,
      };
    });
  }

  try {
    const queryVector = await getQueryEmbedding(
      query,
      settings.openaiApiKey,
      undefined,
      settings.embeddingModel,
      settings.baseURL,
    );
    const mode = settings.searchMode || "hybrid";
    let results: BookmarkRecord[];

    const oramaLimit = allowedUrls ? Math.max(60, 20 * 3) : 20;

    if (mode === "vector") {
      results = await searchVector(queryVector, { limit: oramaLimit });
    } else {
      results = await searchHybrid(query, queryVector, {
        limit: oramaLimit,
        vectorWeight: settings.vectorWeight || 0.4,
      });
    }

    // 如果 scope 过滤了，手动过滤 Orama 结果
    if (allowedUrls) {
      results = results.filter((r) => allowedUrls!.has(r.url));
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
 * 递归获取文件夹及其子文件夹下所有的书签 URL
 */
async function getAllUrlsInFolders(folderIds: string[]): Promise<Set<string>> {
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

const IS_FIREFOX = import.meta.env.FIREFOX;

export default defineBackground(() => {
  installPolyfills();

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

  // 注册 Orama 索引持久化回调（必须在 initSearchAndPopulate 之前）
  registerSaveFn(async () => {
    const raw = saveSearchEngine();
    if (!raw) return;
    const json = JSON.stringify(raw);
    if (json.length > 900 * 1024) {
      console.warn("[FlowSearch] Orama index too large, skipping save");
      return;
    }
    await browser.storage.local.set({ orama_index: JSON.parse(json) });
  });

  // 初始化搜索引擎 (Orama)
  initSearchAndPopulate();

  // 初始化 LLM provider
  initLLMProvider();

  // 初始化死链检测定时任务
  initLinkCheckAlarm();

  // 初始化云盘同步定时任务
  initCloudSyncAlarm();

  // 首次启动时检查是否需要索引
  hasApiKey().then((hasKey) => {
    if (hasKey) {
      console.log("[FlowSearch] API key found, starting initial index...");
      indexAllBookmarks();
    }
  });

  /** 初始化 LLM provider */
  async function initLLMProvider(): Promise<void> {
    try {
      const settings = await getSettings();
      const provider = await autoCreateLLMProvider(settings);
      setLLMProvider(provider);
      if (provider) {
        console.log(`[FlowSearch] LLM provider: ${provider.name}`);
      } else {
        console.log("[FlowSearch] LLM provider: none available");
      }
    } catch (error) {
      console.error("[FlowSearch] Failed to init LLM provider:", error);
    }
  }

  /** 初始化搜索引擎（Orama），优先从 storage.local 恢复 */
  async function initSearchAndPopulate(): Promise<void> {
    try {
      await initSearchEngine();

      // 尝试从 storage.local 恢复
      const stored = await browser.storage.local.get("orama_index");
      if (stored.orama_index) {
        try {
          loadSearchEngine(stored.orama_index as RawData);
          console.log("[FlowSearch] Orama index restored from storage");
          return;
        } catch {
          console.warn(
            "[FlowSearch] Failed to load Orama index, rebuilding...",
          );
        }
      }

      // 从 IndexedDB 重建
      const { getAllIndexedRecords } = await import("../src/db");
      const records = await getAllIndexedRecords();
      const count = await populateSearchEngine(records);
      console.log(`[FlowSearch] Orama index rebuilt: ${count} records`);
      scheduleSaveSearchEngine();
    } catch (error) {
      console.error("[FlowSearch] Failed to init search engine:", error);
    }
  }

  /** 初始化死链检测定时任务 */
  async function initLinkCheckAlarm(): Promise<void> {
    const settings = await getSettings();
    const alarmName = "linkCheck";

    // 清除可能存在的旧定时器
    try {
      await browser.alarms.clear(alarmName);
    } catch {}

    if (settings.linkCheckEnabled && settings.linkCheckInterval) {
      browser.alarms.create(alarmName, {
        periodInMinutes: settings.linkCheckInterval * 60,
      });
      console.log(
        `[FlowSearch] Link check alarm set: every ${settings.linkCheckInterval}h`,
      );
    }
  }

  /** 初始化云盘同步定时任务 */
  async function initCloudSyncAlarm(): Promise<void> {
    const settings = await getSettings();
    const alarmName = "cloudSync";

    try {
      await browser.alarms.clear(alarmName);
    } catch {}

    if (
      settings.cloudSyncEnabled &&
      settings.cloudSyncProvider &&
      settings.cloudSyncToken &&
      settings.cloudSyncInterval
    ) {
      browser.alarms.create(alarmName, {
        periodInMinutes: settings.cloudSyncInterval * 60,
      });
      console.log(
        `[FlowSearch] Cloud sync alarm set: every ${settings.cloudSyncInterval}h (${settings.cloudSyncProvider})`,
      );
    }
  }

  // === Gist 同步 ===

  /** 触发 debounced Gist 同步（5 秒合并多次事件） */
  function scheduleDebouncedGistSync(): void {
    if (gistSyncLock || isSyncingGist) {
      pendingGistSync = true;
      return;
    }
    if (gistSyncTimer) clearTimeout(gistSyncTimer);
    gistSyncTimer = setTimeout(() => {
      gistSyncTimer = null;
      triggerGistSync().catch((err) => {
        console.error("[gist-sync] Auto sync failed:", err);
      });
    }, GIST_SYNC_DEBOUNCE_MS);
  }

  /** 取得默认可写书签根目录 */
  /** 获取浏览器实际根目录下的子节点（跳过合成根节点） */
  async function getBrowserRootChildren() {
    const tree = await browser.bookmarks.getTree();
    if (tree.length === 1 && !tree[0].url && tree[0].children) {
      return tree[0].children;
    }
    return tree;
  }

  async function getDefaultWritableBookmarkParentId(): Promise<string> {
    const rootChildren = await getBrowserRootChildren();
    const preferred = getPreferredBookmarkRoot(rootChildren);
    if (preferred) {
      return preferred.id;
    }
    throw new Error("No writable bookmark root folder found");
  }

  /** 在本地按路径创建缺失文件夹后写入书签 */
  async function createBookmarkFromGistPath(
    folderPath: string[],
    node: GistBookmarkNode,
  ): Promise<void> {
    const rootChildren = await getBrowserRootChildren();
    let currentParentId = await getDefaultWritableBookmarkParentId();
    let startIndex = 0;

    if (folderPath.length > 0) {
      const topLevelFolder = resolveBookmarkRootFolder(
        rootChildren,
        folderPath[0],
      );
      if (topLevelFolder) {
        currentParentId = topLevelFolder.id;
        startIndex = 1;
      }
    }

    for (let i = startIndex; i < folderPath.length; i++) {
      const segment = folderPath[i];
      const children = await browser.bookmarks.getChildren(currentParentId);
      const existingFolder = children.find(
        (item) => !item.url && item.title === segment,
      );

      if (existingFolder) {
        currentParentId = existingFolder.id;
        continue;
      }

      const createdFolder = await browser.bookmarks.create({
        parentId: currentParentId,
        title: segment,
      });
      currentParentId = createdFolder.id;
    }

    if (!node.url) return;

    const existingChildren =
      await browser.bookmarks.getChildren(currentParentId);
    const targetKey = buildBookmarkKey(node.url, node.title, folderPath);
    const existsInTargetFolder = existingChildren.some((item) => {
      if (!item.url) return false;
      return (
        buildBookmarkKey(item.url, item.title || "", folderPath) === targetKey
      );
    });
    if (existsInTargetFolder) {
      return;
    }

    await browser.bookmarks.create({
      parentId: currentParentId,
      title: node.title,
      url: node.url,
    });
  }

  /** 执行 Gist 同步 */
  async function triggerGistSync(force = false): Promise<{
    added: number;
    removed: number;
    uploaded: number;
    gistId: string;
  }> {
    const settings = await getSettings();
    if ((!settings.gistSyncEnabled && !force) || !settings.githubToken) {
      throw new Error("Gist 同步未启用或缺少 GitHub Token");
    }

    if (isSyncingGist) {
      throw new Error("同步正在进行中");
    }

    isSyncingGist = true;
    let result: {
      added: number;
      removed: number;
      uploaded: number;
      gistId: string;
    };

    try {
      const deviceId = await ensureDeviceId(settings.gistDeviceId);
      if (!settings.gistDeviceId) {
        await saveSettings({ gistDeviceId: deviceId });
      }

      const tree = await browser.bookmarks.getTree();

      gistSyncLock = true;
      try {
        result = await fullGistSync(
          settings.githubToken,
          settings.gistId,
          deviceId,
          tree,
          async (folderPath, node) => {
            await createBookmarkFromGistPath(folderPath, node);
          },
        );

        await saveSettings({
          gistId: result.gistId,
          lastGistSync: Date.now(),
        });

        console.log(
          `[gist-sync] Sync complete: +${result.added} -${result.removed}, uploaded ${result.uploaded} bookmarks`,
        );
      } finally {
        gistSyncLock = false;
      }
    } finally {
      isSyncingGist = false;
    }

    if (pendingGistSync) {
      pendingGistSync = false;
      queueMicrotask(() => scheduleDebouncedGistSync());
    }

    return result!;
  }

  // 监听书签变更 → 触发 Gist 同步
  browser.bookmarks.onCreated.addListener(() => {
    scheduleDebouncedGistSync();
  });

  browser.bookmarks.onChanged.addListener(() => {
    scheduleDebouncedGistSync();
  });

  browser.bookmarks.onMoved.addListener(() => {
    scheduleDebouncedGistSync();
  });

  browser.bookmarks.onRemoved.addListener(async (_id, removeInfo) => {
    try {
      type RemovedNode = {
        title?: string;
        url?: string;
        children?: RemovedNode[];
      };

      const collectRemovedBookmarks = (
        node: RemovedNode,
        folderPath: string[] = [],
      ): Array<{ url: string; title: string; folderPath: string[] }> => {
        if (node.url) {
          return [
            {
              url: node.url,
              title: node.title || "",
              folderPath,
            },
          ];
        }

        const nextPath = node.title ? [...folderPath, node.title] : folderPath;
        const results: Array<{
          url: string;
          title: string;
          folderPath: string[];
        }> = [];
        if (node.children) {
          for (const child of node.children) {
            results.push(...collectRemovedBookmarks(child, nextPath));
          }
        }
        return results;
      };

      const removedNode = (removeInfo as { node?: RemovedNode }).node;
      if (!removedNode) return;

      for (const bookmark of collectRemovedBookmarks(removedNode)) {
        await recordBookmarkDeletion(
          bookmark.url,
          bookmark.title,
          bookmark.folderPath,
        );
      }
    } catch (error) {
      console.warn("[gist-sync] Failed to record deleted bookmark:", error);
    }
    scheduleDebouncedGistSync();
  });

  // Omnibox 交互
  browser.omnibox.onInputStarted.addListener(() => {
    const defaultDesc = IS_FIREFOX
      ? t("background.omniboxDefault")
      : t("background.omniboxDefault");
    browser.omnibox.setDefaultSuggestion({
      description: defaultDesc,
    });
  });

  // 核心搜索逻辑
  browser.omnibox.onInputChanged.addListener(async (text, suggest) => {
    const rawInput = text.trim();

    // 1. 命令引导与文件夹补全逻辑
    if (rawInput === "/") {
      suggest([
        {
          content: "/github ",
          description: IS_FIREFOX
            ? t("background.cmdGithub")
            : t("background.cmdGithub"),
        },
        {
          content: "/twitter ",
          description: IS_FIREFOX
            ? t("background.cmdTwitter")
            : t("background.cmdTwitter"),
        },
        {
          content: "/history ",
          description: IS_FIREFOX
            ? t("background.cmdHistory")
            : t("background.cmdHistory"),
        },
        {
          content: "/folder:",
          description: IS_FIREFOX
            ? t("background.cmdFolder")
            : t("background.cmdFolder"),
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
        description: IS_FIREFOX
          ? t("background.folderSearch", { name: f.title })
          : t("background.folderSearch", { name: escapeXml(f.title) }),
      }));
      if (folderSuggestions.length > 0) {
        suggest(folderSuggestions);
        return;
      }
    }

    let query = rawInput;
    let explicitFolderNames: string[] = [];
    let sourceFilter: "github" | "twitter" | "history" | null = null;

    // 解析 /github 语法
    const githubMatch = query.match(/^\/github\s+(.*)$/i);
    if (githubMatch) {
      sourceFilter = "github";
      query = githubMatch[1].trim();
    }

    // 解析 /twitter 语法
    const twitterMatch = query.match(/^\/twitter\s+(.*)$/i);
    if (twitterMatch) {
      sourceFilter = "twitter";
      query = twitterMatch[1].trim();
    }

    // 解析 /history 语法
    const historyMatch = query.match(/^\/history\s+(.*)$/i);
    if (historyMatch) {
      sourceFilter = "history";
      query = historyMatch[1].trim();
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
      const recent = await getRecentBookmarks(8);
      let filtered: Array<{ url: string }> = recent;
      if (sourceFilter === "github") {
        filtered = recent.filter(({ url }) => url.includes("github.com"));
      } else if (sourceFilter === "twitter") {
        filtered = recent.filter(
          ({ url }) => url.includes("x.com") || url.includes("twitter.com"),
        );
      } else if (sourceFilter === "history") {
        filtered = recent.filter(
          ({ url }) => !url.startsWith("chrome") && !url.startsWith("about"),
        );
      }
      suggest(
        filtered.slice(0, 8).map(({ url }) => ({
          content: url,
          description: IS_FIREFOX
            ? highlightBookmarkPlain(url, "", url)
            : highlightBookmark(url, "", url),
        })),
      );
      return;
    }

    // --- 确定搜索作用域 ---
    const settings = await getSettings();
    let allowedUrls: Set<string> | null = null;

    if (sourceFilter === "github") {
      // GitHub: 从 DB 获取所有 gh- 开头的书签
      const { db } = await import("../src/db");
      const ghBookmarks = await db.bookmarks
        .filter((r) => r.id.startsWith("gh-"))
        .toArray();
      allowedUrls = new Set(ghBookmarks.map((r) => r.url));
    } else if (sourceFilter === "twitter") {
      // Twitter: 从 DB 获取所有 tw- 开头的书签
      const { db } = await import("../src/db");
      const twBookmarks = await db.bookmarks
        .filter((r) => r.id.startsWith("tw-"))
        .toArray();
      allowedUrls = new Set(twBookmarks.map((r) => r.url));
    } else if (sourceFilter === "history") {
      // History: 从 DB 获取所有 hi- 开头的书签
      const { db } = await import("../src/db");
      const hiBookmarks = await db.bookmarks
        .filter((r) => r.id.startsWith("hi-"))
        .toArray();
      allowedUrls = new Set(hiBookmarks.map((r) => r.url));
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

    // 多词查询：过滤掉仅部分匹配的低质量结果，减少噪音进入混合搜索
    if (query.includes(" ")) {
      const topChromeUrls = new Set(valid.slice(0, 6).map((b) => b.url));
      valid = valid.filter((b) => {
        const q = getMatchQuality(query, b.title, b.url ?? "");
        return q.score >= 2 || topChromeUrls.has(b.url);
      });
    }

    // 2. 检查 API Key
    if (!settings.openaiApiKey) {
      suggest(rerankBookmarks(query, valid));
      return;
    }

    // 3. 防抖搜索
    if (searchTimer) clearTimeout(searchTimer);
    if (searchAbortController) searchAbortController.abort();
    searchAbortController = new AbortController();
    const signal = searchAbortController.signal;

    // 查询向量已缓存时跳过 debounce 直接搜索
    const debounceMs = hasCachedQuery(query, settings.embeddingModel) ? 0 : 300;

    if (debounceMs > 0) {
      browser.omnibox.setDefaultSuggestion({
        description: IS_FIREFOX
          ? t("background.searching")
          : t("background.searching"),
      });
    }

    searchTimer = setTimeout(async () => {
      try {
        // 4. 生成查询向量
        const apiKey = settings.openaiApiKey!;
        const queryVector = await getQueryEmbedding(
          query,
          apiKey,
          signal,
          settings.embeddingModel,
          settings.baseURL,
        );

        // 如果已中止，直接返回
        if (signal.aborted) return;

        // 5. 执行 Orama 搜索
        let results: BookmarkRecord[];
        const mode = settings.searchMode || "hybrid";

        const oramaLimit = allowedUrls ? Math.max(27, 9 * 3) : 9;

        if (mode === "vector") {
          results = await searchVector(queryVector, { limit: oramaLimit });
        } else {
          results = await searchHybrid(query, queryVector, {
            limit: oramaLimit,
            vectorWeight: settings.vectorWeight || 0.4,
          });
        }

        // 应用 scope 过滤
        if (allowedUrls) {
          results = results.filter((r) => allowedUrls!.has(r.url));
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
    }, debounceMs);
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

  // 监听 aiProvider 设置变更，重新创建 provider
  browser.storage.onChanged.addListener(async (changes, areaName) => {
    if (areaName !== "local") return;
    const settingsChange = changes["settings"];
    if (!settingsChange) return;

    const oldVal = settingsChange.oldValue as Settings | undefined;
    const newVal = settingsChange.newValue as Settings | undefined;

    if (!newVal) return;

    if (
      oldVal?.aiProvider !== newVal?.aiProvider ||
      oldVal?.openaiApiKey !== newVal?.openaiApiKey
    ) {
      try {
        const provider = await autoCreateLLMProvider(newVal);
        setLLMProvider(provider);
      } catch (error) {
        console.error("[FlowSearch] Failed to recreate LLM provider:", error);
      }
    }

    // 死链检测设置变更 → 重建定时器
    if (
      oldVal?.linkCheckEnabled !== newVal?.linkCheckEnabled ||
      oldVal?.linkCheckInterval !== newVal?.linkCheckInterval
    ) {
      await initLinkCheckAlarm();
    }
  });

  // 死链检测定时器
  browser.alarms.onAlarm.addListener(async (alarm) => {
    if (alarm.name === "linkCheck") {
      console.log("[FlowSearch] Running scheduled link check...");
      try {
        const result = await checkLinks();
        console.log(
          `[FlowSearch] Link check complete: ${result.checked} checked, ${result.alive} alive, ${result.dead} dead`,
        );
        await saveSettings({ lastLinkCheck: Date.now() });
      } catch (error) {
        console.error("[FlowSearch] Scheduled link check failed:", error);
      }
    }
    if (alarm.name === "cloudSync") {
      try {
        const settings = await getSettings();
        if (!settings.cloudSyncEnabled) return;
        const provider = getCloudProvider(settings);
        if (!provider) {
          console.warn(
            "[FlowSearch] Cloud sync alarm fired but provider unavailable",
          );
          return;
        }
        console.log(
          `[FlowSearch] Running scheduled cloud sync (${provider.name})...`,
        );
        const result = await uploadCloudSync(provider);
        console.log(
          `[FlowSearch] Cloud sync uploaded ${result.size} bytes (fileId=${result.fileId})`,
        );
      } catch (error) {
        console.error("[FlowSearch] Scheduled cloud sync failed:", error);
      }
    }
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
            await removeFromSearchEngine(message.id).catch(() => {});
            scheduleSaveSearchEngine();
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
          case "SYNC_HISTORY": {
            const histResult = await syncHistoryBookmarks();
            return { success: true, ...histResult };
          }
          case "GET_CACHE_STATS": {
            return { success: true, ...getCacheStats() };
          }
          case "CLEAR_EMBEDDING_CACHE": {
            clearEmbeddingCache();
            return { success: true, ...getCacheStats() };
          }
          case "GIST_SYNC": {
            const syncResult = await triggerGistSync(true);
            return { success: true, ...syncResult };
          }
          case "GIST_CREATE": {
            const { Octokit } = await import("octokit");
            const settings = await getSettings();
            if (!settings.githubToken) {
              return { success: false, error: t("options.gist.tokenRequired") };
            }
            const octokit = new Octokit({ auth: settings.githubToken });
            const deviceId = await ensureDeviceId(settings.gistDeviceId);
            if (!settings.gistDeviceId) {
              await saveSettings({ gistDeviceId: deviceId });
            }
            const tree = await browser.bookmarks.getTree();
            const { exportBookmarkTree, createGist } =
              await import("../src/gist-sync");
            const localTree = exportBookmarkTree(tree);
            const gistId = await createGist(octokit, {
              version: 1,
              exportedAt: Date.now(),
              deviceId,
              bookmarks: localTree,
            });
            await saveSettings({
              gistId,
              gistSyncEnabled: true,
              lastGistSync: Date.now(),
            });
            return { success: true, gistId };
          }
          case "GIST_LINK": {
            const { Octokit } = await import("octokit");
            const { fetchGistData } = await import("../src/gist-sync");
            const linkSettings = await getSettings();
            if (!linkSettings.githubToken) {
              return { success: false, error: t("options.gist.tokenRequired") };
            }
            const octokit = new Octokit({ auth: linkSettings.githubToken });
            const remoteData = await fetchGistData(octokit, message.gistId);
            if (!remoteData) {
              return { success: false, error: t("options.gist.gistNotFound") };
            }
            await saveSettings({
              gistId: message.gistId,
              gistSyncEnabled: false,
            });
            return { success: true, gistId: message.gistId };
          }
          case "GIST_UPLOAD": {
            const uploadSettings = await getSettings();
            if (!uploadSettings.githubToken) {
              return { success: false, error: t("options.gist.tokenRequired") };
            }
            if (!uploadSettings.gistId) {
              return { success: false, error: t("options.gist.noGistLinked") };
            }
            const tree = await browser.bookmarks.getTree();
            const deviceId = await ensureDeviceId(uploadSettings.gistDeviceId);
            if (!uploadSettings.gistDeviceId) {
              await saveSettings({ gistDeviceId: deviceId });
            }
            const result = await uploadToGist(
              uploadSettings.githubToken,
              uploadSettings.gistId,
              deviceId,
              tree,
            );
            await saveSettings({ lastGistSync: Date.now() });
            return { success: true, ...result };
          }
          case "GIST_DOWNLOAD": {
            const downloadSettings = await getSettings();
            if (!downloadSettings.githubToken) {
              return { success: false, error: t("options.gist.tokenRequired") };
            }
            if (!downloadSettings.gistId) {
              return { success: false, error: t("options.gist.noGistLinked") };
            }
            const localTree = await browser.bookmarks.getTree();
            const downloadResult = await downloadFromGist(
              downloadSettings.githubToken,
              downloadSettings.gistId,
              localTree,
              async (id) => {
                await browser.bookmarks.removeTree(id);
              },
              async (folderPath, node) => {
                await createBookmarkFromGistPath(folderPath, node);
              },
            );
            await saveSettings({ lastGistSync: Date.now() });
            return { success: true, ...downloadResult };
          }
          case "CHECK_LINKS": {
            const result = await checkLinks();
            await saveSettings({ lastLinkCheck: Date.now() });
            return { success: true, ...result };
          }
          case "GET_LINK_STATS": {
            const stats = await getLinkHealthStats();
            return { success: true, ...stats };
          }
          case "GET_DEAD_LINKS": {
            const deadLinks = await getDeadLinks();
            return { success: true, deadLinks };
          }
          case "FIND_DUPLICATES": {
            const tree = await browser.bookmarks.getTree();
            const folderPathMap = buildFolderPathMapFromTree(
              tree as unknown as BookmarkTreeNode[],
            );
            const duplicates = await findDuplicates(folderPathMap);
            return { success: true, duplicates };
          }
          case "RESOLVE_DUPLICATES": {
            await resolveDuplicates(
              message.keepId,
              message.deleteIds,
              async (id: string) => {
                await browser.bookmarks.remove(id);
              },
            );
            return { success: true };
          }
          case "GET_CATEGORY_SUGGESTIONS": {
            const suggestions = await getCategorySuggestions(
              message.bookmarkIds,
            );
            return { success: true, suggestions };
          }
          case "APPLY_CATEGORIES": {
            // 获取默认可写根目录
            const rootParentId = await getDefaultWritableBookmarkParentId();
            const result = await applyCategories(
              message.suggestions,
              message.categoryFolderMap,
              rootParentId,
              async (parentId, title) => {
                const folder = await browser.bookmarks.create({
                  parentId,
                  title,
                });
                return folder.id;
              },
              async (id, parentId) => {
                await browser.bookmarks.move(id, { parentId });
              },
            );
            // 保存更新后的 categoryFolderMap
            await saveSettings({
              categoryFolderMap: {
                ...message.categoryFolderMap,
              },
            });
            return { success: true, ...result };
          }
          case "GET_CATEGORY_FOLDERS": {
            const folderMap = (await getSettings()).categoryFolderMap || {};
            return { success: true, folderMap };
          }
          case "SUMMARIZE_URL": {
            const summarizeSettings = await getSettings();
            if (!summarizeSettings.openaiApiKey) {
              return { success: false, error: "API Key not configured" };
            }
            const content = await fetchPageContent(
              message.url,
              summarizeSettings,
            );
            if (!content) {
              return { success: false, error: "Content extraction failed" };
            }
            const provider = getLLMProvider();
            if (!provider) {
              const fallback = (content.summary || content.markdown).slice(
                0,
                500,
              );
              return {
                success: true,
                url: message.url,
                title: content.title || message.url,
                summary: fallback,
                tags: [],
                excerpt: content.markdown.slice(0, 200),
              };
            }
            try {
              const result = await provider.generateDeepContent(
                content.markdown.slice(0, 4000),
              );
              return {
                success: true,
                url: message.url,
                title: content.title || message.url,
                summary: result.summary,
                tags: result.tags,
                excerpt: content.markdown.slice(0, 200),
              };
            } catch {
              const fallback = (content.summary || content.markdown).slice(
                0,
                500,
              );
              return {
                success: true,
                url: message.url,
                title: content.title || message.url,
                summary: fallback,
                tags: [],
                excerpt: content.markdown.slice(0, 200),
              };
            }
          }
          case "ASK_BOOKMARKS": {
            const askSettings = await getSettings();
            if (!askSettings.openaiApiKey) {
              return { success: false, error: "API Key not configured" };
            }
            const { askBookmarks } = await import("../src/rag");
            const queryVector = await getQueryEmbedding(
              message.question,
              askSettings.openaiApiKey,
              undefined,
              askSettings.embeddingModel,
              askSettings.baseURL,
            );
            const topK = message.topK || 8;
            const results = await searchVector(queryVector, { limit: topK });
            if (results.length === 0) {
              return {
                success: true,
                answer: "No relevant bookmarks found.",
                citations: [],
              };
            }
            const ragResult = await askBookmarks(
              message.question,
              results.map((r) => ({
                title: r.title,
                url: r.url,
                summary: r.summary,
              })),
              askSettings.openaiApiKey,
              askSettings.llmModel,
              askSettings.baseURL,
            );
            return { success: true, ...ragResult };
          }
          case "CLOUD_SYNC_TEST_CONNECTION": {
            // 从 settings 读取完整配置（WebDAV 多字段也在 settings 中持久化）
            const testSettings = await getSettings();
            // 优先使用 message 中的值，fallback 到 settings
            const testProvider = getCloudProvider({
              cloudSyncProvider: message.provider || testSettings.cloudSyncProvider,
              cloudSyncToken: message.token || testSettings.cloudSyncToken,
              cloudSyncWebdavUrl: message.webdavUrl || testSettings.cloudSyncWebdavUrl,
              cloudSyncWebdavUsername: message.webdavUsername || testSettings.cloudSyncWebdavUsername,
            });
            if (!testProvider) {
              return { success: false, error: "Provider not configured" };
            }
            try {
              const ok = await testCloudConnection(testProvider);
              return { success: ok };
            } catch (error: any) {
              return {
                success: false,
                error: error?.message || String(error),
                code: error instanceof CloudSyncError ? error.code : "UNKNOWN",
              };
            }
          }
          case "CLOUD_SYNC_GET_STATUS": {
            const settings = await getSettings();
            const provider = getCloudProvider(settings);
            if (!provider) {
              return { success: false, error: "Provider not configured" };
            }
            try {
              const status = await getCloudSyncStatus(provider);
              return { success: true, ...status };
            } catch (error: any) {
              return {
                success: false,
                error: error?.message || String(error),
                code: error instanceof CloudSyncError ? error.code : "UNKNOWN",
              };
            }
          }
          case "CLOUD_SYNC_UPLOAD": {
            const settings = await getSettings();
            const provider = getCloudProvider(settings);
            if (!provider) {
              return { success: false, error: "Provider not configured" };
            }
            try {
              const result = await uploadCloudSync(provider);
              return { success: true, ...result };
            } catch (error: any) {
              return {
                success: false,
                error: error?.message || String(error),
                code: error instanceof CloudSyncError ? error.code : "UNKNOWN",
              };
            }
          }
          case "CLOUD_SYNC_DOWNLOAD": {
            const settings = await getSettings();
            const provider = getCloudProvider(settings);
            if (!provider) {
              return { success: false, error: "Provider not configured" };
            }
            try {
              const result = await downloadCloudSync(provider);
              return { success: true, ...result };
            } catch (error: any) {
              return {
                success: false,
                error: error?.message || String(error),
                code: error instanceof CloudSyncError ? error.code : "UNKNOWN",
              };
            }
          }
          case "CLOUD_SYNC_DELETE": {
            const settings = await getSettings();
            const provider = getCloudProvider(settings);
            if (!provider) {
              return { success: false, error: "Provider not configured" };
            }
            try {
              await deleteCloudSync(provider);
              return { success: true };
            } catch (error: any) {
              return {
                success: false,
                error: error?.message || String(error),
                code: error instanceof CloudSyncError ? error.code : "UNKNOWN",
              };
            }
          }
          case "CLOUD_SYNC_REFRESH_ALARM": {
            await initCloudSyncAlarm();
            return { success: true };
          }
          case "GET_ALL_INDEXED": {
            const { getAllIndexedRecords } = await import("../src/db");
            const records = await getAllIndexedRecords();
            return { success: true, records };
          }
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
  _query: string,
  showAi: boolean,
): string {
  const aiActive = showAi && record.status === "indexed";
  const prefix = aiActive ? "🤖 " : "";
  const title = record.title || record.url;
  const rawSummary = record.summary || "";
  const isGithub =
    record.source === "github" ||
    record.id.startsWith("gh-") ||
    record.url.includes("github.com");
  const summary = isGithub
    ? stripMarkdownToPlainText(rawSummary).slice(0, 50)
    : rawSummary.slice(0, 50);

  if (IS_FIREFOX) {
    return `${prefix}${title}${summary ? " — " + summary : ""} (${record.url})`;
  }

  return `${prefix}<match>${escapeXml(title)}</match> <dim>${escapeXml(summary)}...</dim> <url>${escapeXml(record.url)}</url>`;
}
