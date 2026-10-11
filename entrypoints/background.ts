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
import { getSettings, saveSettings } from "../src/db";
import {
  normalizeBaseURL,
  resolveEmbedConfig,
  resolveLLMConfig,
  isLLMConfigured,
  isEmbedConfigured,
} from "../src/service-config";
import type {
  BookmarkRecord,
  SearchResult,
  Settings,
  GistBookmarkNode,
  CodeSymbol,
  CodeEmbedding,
  CodeChunk,
  CodeSearchResult,
  WikiMessage,
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
  searchKeyword,
  searchVector,
  removeFromSearchEngine,
  flushSaveSearchEngine,
  registerSaveFn,
  resetSearchEngine,
  isSearchEngineReady,
  getSearchEngineDim,
  ORAMA_INDEX_STORAGE_KEY,
  ORAMA_INDEX_SPACE_KEY,
} from "../src/search-engine";
import {
  embeddingSpaceId,
  getEmbeddingDim,
  isVectorInSpace,
} from "../src/embedding-space";
import type { RawData } from "@orama/orama";
import {
  initIndexer,
  enqueueBookmark,
  indexAllBookmarks,
  pauseIndexing,
  resumeIndexing,
  retryFailed,
  retryFailedBookmark,
  getIndexingStatus,
  getBookmarkFolders,
  indexFolders,
  resetIndexerState,
  syncGithubStars,
  syncTwitterBookmarks,
  stripMarkdownToPlainText,
  fetchPageContent,
  enqueueBookmarksForReindex,
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
  syncCloudBookmarks,
  uploadCloudBookmarks,
  downloadCloudBookmarks,
  ensureCloudBookmarkDeviceId,
} from "../src/cloud-sync";
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

/** 启动期向量空间校验 — 多个初始化共用同一个 Promise，避免重复重建 */
let embedSpaceGuard: Promise<number> | null = null;
/**
 * 后台代码向量重嵌入（守卫触发时赋值）。
 * 代码索引初始化必须等它完成，避免用混合空间的向量重建索引；
 * 书签索引初始化不等待它，避免本地后端的串行 CPU 推理阻塞搜索可用性。
 */
let codeReembed: Promise<void> | null = null;

// 云端书签同步防抖状态（复用 cloudSync provider 配置）
const CLOUD_BOOKMARK_SYNC_DEBOUNCE_MS = 5000;
let cloudBookmarkSyncTimer: ReturnType<typeof setTimeout> | null = null;
let isSyncingCloudBookmarks = false;
let cloudBookmarkSyncLock = false;
let pendingCloudBookmarkSync = false;

type BrowserSearchBookmark = {
  id: string;
  title: string;
  url?: string;
};

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
    quickSummary: record.quickSummary,
    keyPoints: record.keyPoints,
    readingTime: record.readingTime,
    technologies: record.technologies,
  };
}

function dedupeSearchResults(
  results: SearchResult[],
  limit: number,
): SearchResult[] {
  const seen = new Set<string>();
  const deduped: SearchResult[] = [];
  for (const result of results) {
    if (seen.has(result.url)) continue;
    seen.add(result.url);
    deduped.push(result);
    if (deduped.length >= limit) break;
  }
  return deduped;
}

function buildBrowserSearchResults(
  query: string,
  bookmarks: BrowserSearchBookmark[],
): SearchResult[] {
  const ranked = rerankBookmarks(query, bookmarks, IS_FIREFOX);
  return ranked.map((suggestion) => {
    const bookmark = bookmarks.find((item) => item.url === suggestion.content);
    return {
      url: suggestion.content,
      title: bookmark?.title ?? suggestion.content,
      summary: "",
      tags: [],
      source: "bookmark" as const,
      indexed: false,
    };
  });
}

function toSuggestionRecord(result: SearchResult): BookmarkRecord {
  return {
    id: result.url,
    url: result.url,
    title: result.title,
    summary: result.summary,
    tags: result.tags,
    source: result.source,
    status: result.indexed ? "indexed" : "pending",
  };
}

async function buildKeywordSearchResults(
  query: string,
  bookmarks: BrowserSearchBookmark[],
  options: {
    limit: number;
    allowedUrls: Set<string> | null;
    sourceFilter: SearchResult["source"] | null;
  },
): Promise<SearchResult[]> {
  let indexedResults = await searchKeyword(query, {
    limit: Math.max(options.limit * 3, options.limit),
    sourceFilter: options.sourceFilter || undefined,
  });
  if (options.allowedUrls) {
    indexedResults = indexedResults.filter((record) =>
      options.allowedUrls!.has(record.url),
    );
  }
  return dedupeSearchResults(
    [
      ...indexedResults.map(toSearchResult),
      ...buildBrowserSearchResults(query, bookmarks),
    ],
    options.limit,
  );
}

async function buildKeywordSuggestions(
  query: string,
  bookmarks: BrowserSearchBookmark[],
  options: {
    limit: number;
    allowedUrls: Set<string> | null;
    sourceFilter: SearchResult["source"] | null;
  },
): Promise<Array<{ content: string; description: string }>> {
  const results = await buildKeywordSearchResults(query, bookmarks, options);
  return results.map((result) => ({
    content: result.url,
    description: formatSuggestion(
      toSuggestionRecord(result),
      query,
      false,
    ),
  }));
}

/**
 * 丢弃内存与 storage 中的书签 Orama 索引（用于重建）。
 * 传 dim 时用新维度重建空引擎（切换 embedding 后端后必须调用）。
 */
async function clearBookmarkIndexStorage(dim?: number): Promise<void> {
  await resetSearchEngine(dim);
  await browser.storage.local.remove([
    ORAMA_INDEX_STORAGE_KEY,
    ORAMA_INDEX_SPACE_KEY,
  ]);
}

async function resetIndexedData(): Promise<void> {
  const { clearAll } = await import("../src/db");
  clearEmbeddingCache();
  await resetIndexerState();
  await clearAll();
  await clearBookmarkIndexStorage();
}

async function reindexStoredEmbeddings(): Promise<number> {
  const { db } = await import("../src/db");
  const existingRecords = await db.bookmarks.toArray();
  const pendingRecords = existingRecords
    .filter((record) => typeof record.url === "string" && record.url.length > 0)
    .map((record) => ({
      ...record,
      status: "pending" as const,
      embedding: undefined,
      indexedAt: undefined,
      error: undefined,
    }));

  clearEmbeddingCache();
  await resetIndexerState();
  await db.bookmarks.bulkPut(pendingRecords);

  // 索引维度跟随当前 embedding 后端：切换后端后不能继续用旧维度的空引擎
  const settings = await getSettings();
  await clearBookmarkIndexStorage(getEmbeddingDim(settings));

  return enqueueBookmarksForReindex(
    pendingRecords.map((record) => ({
      id: record.id,
      url: record.url,
      title: record.title,
    })),
  );
}

/**
 * IMPORT_DATA：导入书签数据（来自设置页的 JSON 导入）。
 * 向量属于当前 embedding 空间的记录直接进搜索引擎；
 * 缺向量 / 异空间向量的记录重置为 pending 并重新入队生成。
 */
async function importBookmarksData(
  records: unknown,
): Promise<{ imported: number; requeued: number }> {
  const { db } = await import("../src/db");
  const list = (Array.isArray(records) ? records : []) as BookmarkRecord[];
  const valid = list.filter(
    (r) =>
      r && typeof r.id === "string" && typeof r.url === "string" && r.url.length > 0,
  );
  if (valid.length === 0) return { imported: 0, requeued: 0 };

  const settings = await getSettings();
  const inSpace = valid.filter(
    (r) =>
      Array.isArray(r.embedding) &&
      r.embedding.length > 0 &&
      isVectorInSpace(r.embedding, settings),
  );
  const stale = valid
    .filter((r) => !inSpace.includes(r))
    .map((r) => ({
      ...r,
      embedding: undefined,
      indexedAt: undefined,
      error: undefined,
      failureStage: undefined,
      status: "pending" as const,
    }));

  await db.bookmarks.bulkPut([...inSpace, ...stale]);

  if (inSpace.length > 0) {
    const count = await populateSearchEngine(inSpace);
    console.log(`[FlowSearch] Imported ${count} records into search engine`);
    await flushSaveSearchEngine();
  }

  let requeued = 0;
  if (stale.length > 0) {
    requeued = await enqueueBookmarksForReindex(
      stale.map((r) => ({ id: r.id, url: r.url, title: r.title })),
    );
  }

  return { imported: valid.length, requeued };
}

/**
 * 执行全局搜索（供独立搜索页调用）
 * 复用 omnibox 搜索的完整逻辑，返回最多 searchResultLimit 条 SearchResult
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

  const mode = settings.searchMode || "hybrid";
  const resultLimit = Math.min(50, Math.max(5, settings.searchResultLimit ?? 20));
  const embedCfg = resolveEmbedConfig(settings);
  if (mode === "keyword" || (embedCfg.backend !== "local" && !embedCfg.apiKey)) {
    return buildKeywordSearchResults(query, valid, {
      limit: resultLimit,
      allowedUrls,
      sourceFilter,
    });
  }

  try {
    const queryVector = await getQueryEmbedding(
      query,
      embedCfg.apiKey,
      undefined,
      embedCfg.model,
      embedCfg.baseURL,
      embedCfg.backend,
    );
    let results: BookmarkRecord[];

    const oramaLimit = allowedUrls
      ? Math.max(60, resultLimit * 3)
      : resultLimit;

    if (mode === "vector") {
      results = await searchVector(queryVector, {
        limit: oramaLimit,
        sourceFilter: sourceFilter || undefined,
      });
    } else {
      results = await searchHybrid(query, queryVector, {
        limit: oramaLimit,
        vectorWeight: settings.vectorWeight || 0.4,
        sourceFilter: sourceFilter || undefined,
      });
    }

    // 如果 scope 过滤了，手动过滤 Orama 结果
    if (allowedUrls) {
      results = results.filter((r) => allowedUrls!.has(r.url));
    }

    return results.map(toSearchResult);
  } catch (err) {
    console.error("[FlowSearch] performFullSearch error:", err);
    return buildKeywordSearchResults(query, valid, {
      limit: resultLimit,
      allowedUrls,
      sourceFilter,
    });
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
    // 空间指纹与索引一起落盘：加载时据此判断旧索引是否仍可用。
    // 每次现算而非缓存 —— 云同步导入等路径可能在 SW 运行期改变设置，
    // 缓存值会给新索引写入过期的指纹，导致下次启动误判不匹配
    const space = embeddingSpaceId(await getSettings());
    await browser.storage.local.set({
      [ORAMA_INDEX_STORAGE_KEY]: JSON.parse(json),
      [ORAMA_INDEX_SPACE_KEY]: space,
    });
  });

  // 初始化搜索引擎 (Orama)
  initSearchAndPopulate();

  // 初始化代码 Wiki 搜索引擎 (Orama) — 独立实例
  initCodeSearchAndPopulate();

  // 初始化 LLM provider
  initLLMProvider();

  // 初始化死链检测定时任务
  initLinkCheckAlarm();

  // 初始化云盘同步定时任务
  initCloudSyncAlarm();
  initDailyDigestAlarm();
  initSourceSyncAlarms();

  // 首次启动时检查是否需要索引（索引只需要 embedding，本地后端无需 Key）
  getSettings().then((settings) => {
    if (isEmbedConfigured(settings)) {
      console.log("[FlowSearch] Embedding configured, starting initial index...");
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

  /**
   * 校验存量向量与当前 embedding 后端是否属于同一向量空间。
   *
   * 切换后端 / 更换 embedding 模型后，旧向量与新查询向量不再可比（余弦相似度
   * 失去意义），必须丢弃并重建。仅靠「用户在设置页重新保存」不够：云同步导入、
   * 跨设备覆盖、直接修改 storage 都不会经过那条路径。
   *
   * 两种触发情形：
   * 1. 指纹变更：后端 / 模型被换掉，存量向量必然失效
   * 2. 首次引入指纹（升级迁移）：本地后端存量向量仍是零填充的 1024 维
   *
   * 不对远端模型的维度做推断 —— 远端模型维度不受控，按维度判定会导致
   * 「重建 → 维度仍不匹配 → 再重建」的死循环。跨设备导入的错位向量由
   * `cloud-sync/blob.ts` 在导入时就地剥离并重新入队。
   */
  async function runEmbeddingSpaceGuard(): Promise<number> {
    try {
      const settings = await getSettings();
      const cfg = resolveEmbedConfig(settings);
      // 无法重新嵌入时（远端后端缺 API Key）保留现状，下次启动再校验
      if (cfg.backend !== "local" && !cfg.apiKey) return 0;

      const { db } = await import("../src/db");
      const space = embeddingSpaceId(settings);
      const prev = settings.embedSpaceFingerprint;
      const records = await db.bookmarks.toArray();

      const spaceChanged = prev !== undefined && prev !== space;
      const staleCount = records.filter(
        (r) => r.embedding?.length && !isVectorInSpace(r.embedding, settings),
      ).length;
      // 升级迁移：旧版本本地后端把 384 维零填充到 1024；本地维度是硬事实，可安全判定
      const legacyPadding =
        prev === undefined && cfg.backend === "local" && staleCount > 0;
      const rebuildBookmarks =
        records.length > 0 && (spaceChanged || legacyPadding);

      // 代码向量与书签独立判定：无书签的 Code Wiki 用户切换后端后，
      // 代码向量同样失效，不能因书签表为空而跳过重建
      const codeCount = await db.codeEmbeddings.count();
      let rebuildCode = false;
      let staleCodeCount = 0;
      if (codeCount > 0) {
        staleCodeCount = (await db.codeEmbeddings.toArray()).filter(
          (e) => e.vector?.length && !isVectorInSpace(e.vector, settings),
        ).length;
        rebuildCode =
          spaceChanged ||
          (prev === undefined && cfg.backend === "local" && staleCodeCount > 0);
      }

      if (!rebuildBookmarks && !rebuildCode) {
        // 无需重建：首次采用当前空间，或无存量向量时直接跟进新指纹
        if (prev !== space) await saveSettings({ embedSpaceFingerprint: space });
        return 0;
      }

      console.warn(
        `[FlowSearch] Embedding space mismatch (${prev ?? "legacy"} -> ${space}); ` +
          `${staleCount} stale bookmark vectors, ${staleCodeCount} stale code vectors — rebuilding`,
      );

      let queued = 0;
      if (rebuildBookmarks) {
        queued = await reindexStoredEmbeddings();
      }

      if (rebuildCode) {
        // 代码向量同源失效：按原始 chunk 重新嵌入（无需重下仓库）。
        // 本地后端是串行 CPU 推理，全量重嵌入可能耗时数分钟，因此不阻塞
        // 守卫返回（书签索引初始化不等它）；initCodeSearchAndPopulate 会
        // 等待 codeReembed 完成后再加载 / 重建代码索引。
        // 指纹在重嵌入完成后才落盘：SW 中途被杀时指纹仍是旧值，下次启动
        // 守卫会幂等重跑（书签重建为入队操作，重复执行无害）。
        codeReembed = (async () => {
          const { reembedAllCodeEmbeddings } = await import(
            "../src/embed-code/embed"
          );
          const reembedded = await reembedAllCodeEmbeddings(
            cfg.apiKey,
            cfg.model,
            cfg.baseURL,
            cfg.backend,
          );

          const code = await import("../src/embed-code/index");
          await browser.storage.local.remove([
            code.ORAMA_CODE_INDEX_STORAGE_KEY,
            code.ORAMA_CODE_INDEX_SPACE_KEY,
          ]);

          // 重嵌入期间用户可能又改了设置：空间已变则丢弃本次结果，
          // 交给新一轮守卫处理，避免旧空间指纹覆盖新指纹
          const latest = await getSettings();
          if (embeddingSpaceId(latest) !== space) {
            console.warn(
              "[FlowSearch] Embedding space changed during code re-embedding, discarding stale results",
            );
            return;
          }

          // 运行期（设置页切换后端）时内存索引仍是旧维度，需立即重建；
          // 启动期代码引擎尚未初始化，交给 initCodeSearchAndPopulate
          if (code.isCodeSearchEngineReady()) {
            await code.initCodeSearchEngine(getEmbeddingDim(latest));
            await rebuildCodeIndexFromDb(latest);
          }

          await saveSettings({ embedSpaceFingerprint: space });
          console.log(
            `[FlowSearch] Re-embedded ${reembedded} code vectors (${space})`,
          );
        })().catch((error) => {
          console.error("[FlowSearch] Code re-embedding failed:", error);
        });
        console.log(
          `[FlowSearch] Re-queued ${queued} bookmarks for re-embedding (${space}); ` +
            "code re-embedding continues in background",
        );
        return queued;
      }

      await saveSettings({ embedSpaceFingerprint: space });
      console.log(
        `[FlowSearch] Re-queued ${queued} bookmarks for re-embedding (${space})`,
      );
      return queued;
    } catch (error) {
      console.error("[FlowSearch] Embedding space guard failed:", error);
      return 0;
    }
  }

  /** 向量空间校验（同一 SW 生命周期内只跑一次） */
  function ensureEmbeddingSpace(): Promise<number> {
    if (!embedSpaceGuard) embedSpaceGuard = runEmbeddingSpaceGuard();
    return embedSpaceGuard;
  }

  /** 设置变更后重新校验向量空间（丢弃已缓存的结果） */
  async function revalidateEmbeddingSpace(): Promise<number> {
    embedSpaceGuard = null;
    return ensureEmbeddingSpace();
  }

  /** 初始化搜索引擎（Orama），优先从 storage.local 恢复 */
  async function initSearchAndPopulate(): Promise<void> {
    try {
      await ensureEmbeddingSpace();

      const settings = await getSettings();
      const dim = getEmbeddingDim(settings);
      const space = embeddingSpaceId(settings);

      // 维度一致时保留现有实例，避免丢掉校验期间已写入的文档
      if (!isSearchEngineReady() || getSearchEngineDim() !== dim) {
        await initSearchEngine(dim);
      }

      // 尝试从 storage.local 恢复（仅当向量空间指纹一致）
      const stored = await browser.storage.local.get([
        ORAMA_INDEX_STORAGE_KEY,
        ORAMA_INDEX_SPACE_KEY,
      ]);
      if (stored[ORAMA_INDEX_STORAGE_KEY]) {
        if (stored[ORAMA_INDEX_SPACE_KEY] === space) {
          try {
            loadSearchEngine(stored[ORAMA_INDEX_STORAGE_KEY] as RawData, dim);
            console.log("[FlowSearch] Orama index restored from storage");
            return;
          } catch {
            console.warn(
              "[FlowSearch] Failed to load Orama index, rebuilding...",
            );
          }
        } else {
          console.warn(
            "[FlowSearch] Stored Orama index belongs to another embedding space, rebuilding...",
          );
        }
      }

      // 从 IndexedDB 重建（过滤掉其他向量空间的向量）
      const { getAllIndexedRecords } = await import("../src/db");
      const records = await getAllIndexedRecords();
      const inSpace = records.filter(
        (r) =>
          !r.embedding?.length || isVectorInSpace(r.embedding, settings),
      );
      if (inSpace.length !== records.length) {
        console.warn(
          `[FlowSearch] Skipped ${records.length - inSpace.length} records with foreign-dimension vectors`,
        );
      }
      const count = await populateSearchEngine(inSpace);
      console.log(`[FlowSearch] Orama index rebuilt: ${count} records`);
      await flushSaveSearchEngine();
    } catch (error) {
      console.error("[FlowSearch] Failed to init search engine:", error);
    }
  }

  /** 初始化代码搜索引擎（Code Wiki），优先从 storage.local 恢复 */
  async function initCodeSearchAndPopulate(): Promise<void> {
    try {
      await ensureEmbeddingSpace();
      // 守卫可能已触发后台代码重嵌入：等它完成再加载 / 重建代码索引，
      // 避免用混合向量空间的 Dexie 数据建索引
      if (codeReembed) await codeReembed;

      const settings = await getSettings();
      const dim = getEmbeddingDim(settings);
      const space = embeddingSpaceId(settings);

      const {
        initCodeSearchEngine,
        loadCodeSearchEngine,
        registerCodeSaveFn,
        isCodeSearchEngineReady,
        getCodeSearchEngineDim,
        ORAMA_CODE_INDEX_STORAGE_KEY,
        ORAMA_CODE_INDEX_SPACE_KEY,
      } = await import("../src/embed-code/index");

      if (!isCodeSearchEngineReady() || getCodeSearchEngineDim() !== dim) {
        await initCodeSearchEngine(dim);
      }

      // 注册持久化回调
      registerCodeSaveFn(async () => {
        const raw = (await import("../src/embed-code/index")).saveCodeSearchEngine();
        if (raw) {
          // 现算指纹（同书签 saveFn）：运行期设置可能已被云同步导入改变
          const codeSpace = embeddingSpaceId(await getSettings());
          await browser.storage.local.set({
            [ORAMA_CODE_INDEX_STORAGE_KEY]: raw,
            [ORAMA_CODE_INDEX_SPACE_KEY]: codeSpace,
          });
        }
      });

      // 尝试从 storage.local 恢复（仅当向量空间指纹一致）
      const stored = await browser.storage.local.get([
        ORAMA_CODE_INDEX_STORAGE_KEY,
        ORAMA_CODE_INDEX_SPACE_KEY,
      ]);
      if (stored[ORAMA_CODE_INDEX_STORAGE_KEY]) {
        if (stored[ORAMA_CODE_INDEX_SPACE_KEY] === space) {
          try {
            loadCodeSearchEngine(
              stored[ORAMA_CODE_INDEX_STORAGE_KEY] as RawData,
              dim,
            );
            console.log(
              "[FlowSearch] Code wiki Orama index restored from storage",
            );
            return;
          } catch {
            console.warn(
              "[FlowSearch] Failed to load code wiki Orama index, rebuilding...",
            );
          }
        } else {
          console.warn(
            "[FlowSearch] Stored code wiki index belongs to another embedding space, rebuilding...",
          );
        }
      }

      const count = await rebuildCodeIndexFromDb(settings);
      if (count === 0) {
        console.log("[FlowSearch] No code wiki data to index");
        return;
      }
      console.log(`[FlowSearch] Code wiki Orama rebuilt: ${count} chunks`);
    } catch (error) {
      console.error("[FlowSearch] Failed to init code wiki search engine:", error);
    }
  }

  /**
   * 用 Dexie 中的代码向量 + 符号表重建代码索引。
   * chunk 元信息由符号表复原，因此无需重新下载仓库。
   */
  async function rebuildCodeIndexFromDb(settings: Settings): Promise<number> {
    const { db } = await import("../src/db");
    const {
      populateCodeSearchEngine: populateCode,
      scheduleSaveCodeSearchEngine,
    } = await import("../src/embed-code/index");

    const [embeddingRecords, symbolRecords] = await Promise.all([
      db.codeEmbeddings.toArray(),
      db.codeSymbols.toArray(),
    ]);
    if (embeddingRecords.length === 0) return 0;

    // 构造最小 chunks（symbol 级：signature + jsdoc + filePath）
    const symbolMap = new Map(symbolRecords.map((s) => [s.id, s]));
    const records: { chunk: CodeChunk; embedding: number[] }[] = [];
    for (const e of embeddingRecords) {
      // 其他向量空间的代码向量不可用，跳过等待重新嵌入
      if (!isVectorInSpace(e.vector, settings)) continue;
      const sym = symbolMap.get(e.id);
      if (!sym) continue;
      const chunk: CodeChunk = {
        id: e.id,
        content: [sym.jsdoc ? `/* ${sym.jsdoc} */` : "", sym.signature]
          .filter(Boolean)
          .join("\n"),
        language: sym.filePath.split(".").pop() || "text",
        filePath: sym.filePath,
        symbolName: sym.name,
        kind: sym.kind,
        lineStart: sym.lineStart,
        lineEnd: sym.lineEnd,
        repoUrl: sym.repoUrl,
        branch: sym.branch,
      };
      records.push({ chunk, embedding: e.vector });
    }

    const count = await populateCode(records);
    scheduleSaveCodeSearchEngine();
    return count;
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

  // === 每日知识简报 ===

  async function initDailyDigestAlarm(): Promise<void> {
    const settings = await getSettings();

    try {
      await browser.alarms.clear("daily-digest");
    } catch {}

    if (settings.digestEnabled === false) {
      console.log("[FlowSearch] Daily digest disabled");
      return;
    }

    // 按用户设定的整点触发，之后每 24 小时重复
    const hour = Math.min(23, Math.max(0, Math.floor(settings.digestHour ?? 9)));
    const next = new Date();
    next.setHours(hour, 0, 0, 0);
    if (next.getTime() <= Date.now()) {
      next.setDate(next.getDate() + 1);
    }
    browser.alarms.create("daily-digest", {
      when: next.getTime(),
      periodInMinutes: 24 * 60,
    });
    console.log(
      `[FlowSearch] Daily digest alarm set at ${String(hour).padStart(2, "0")}:00`,
    );
  }

  /** 外部数据源（GitHub / Twitter / History）定时同步 alarm */
  async function initSourceSyncAlarm(
    alarmName: string,
    enabled: boolean,
    intervalHours: number | undefined,
  ): Promise<void> {
    try {
      await browser.alarms.clear(alarmName);
    } catch {}

    if (enabled && intervalHours && intervalHours > 0) {
      browser.alarms.create(alarmName, {
        periodInMinutes: intervalHours * 60,
      });
      console.log(
        `[FlowSearch] ${alarmName} alarm set: every ${intervalHours}h`,
      );
    }
  }

  async function initSourceSyncAlarms(): Promise<void> {
    const settings = await getSettings();
    await initSourceSyncAlarm(
      "githubSync",
      settings.githubSyncEnabled === true && !!settings.githubToken,
      settings.githubSyncInterval,
    );
    await initSourceSyncAlarm(
      "twitterSync",
      settings.twitterSyncEnabled === true,
      settings.twitterSyncInterval,
    );
    await initSourceSyncAlarm(
      "historySync",
      settings.historySyncEnabled === true,
      settings.historySyncInterval,
    );
  }

  async function handleDailyDigest(): Promise<void> {
    try {
      const { generateDailyDigest, hasDigestForDate } = await import("../src/daily-digest");
      const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().split("T")[0];

      if (await hasDigestForDate(yesterday)) {
        console.log("[FlowSearch] Digest already exists for", yesterday);
        return;
      }

      const provider = getLLMProvider();
      const digest = await generateDailyDigest(provider || undefined, yesterday);

      if (digest) {
        const settings = await getSettings();
        if (settings.digestNotifyEnabled !== false) {
          browser.notifications.create("daily-digest", {
            type: "basic",
            iconUrl: "/icon/128.png",
            title: t("background.digestNotifyTitle"),
            message: t("background.digestNotifyBody", {
              pages: digest.stats.pagesIndexed,
              concepts: digest.newConcepts.length,
            }),
          });
        }
      }
    } catch (err) {
      console.error("[FlowSearch] Daily digest failed:", err);
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
      throw new Error(t("background.gistSyncUnavailable"));
    }

    if (isSyncingGist) {
      throw new Error(t("background.syncInProgress"));
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

  // === 云端书签同步（复用 cloudSync provider） ===

  /** 触发 debounced 云端书签同步（5 秒合并多次事件） */
  function scheduleDebouncedCloudBookmarkSync(): void {
    if (cloudBookmarkSyncLock || isSyncingCloudBookmarks) {
      pendingCloudBookmarkSync = true;
      return;
    }
    if (cloudBookmarkSyncTimer) clearTimeout(cloudBookmarkSyncTimer);
    cloudBookmarkSyncTimer = setTimeout(() => {
      cloudBookmarkSyncTimer = null;
      triggerCloudBookmarkSync().catch((err) => {
        console.error("[cloud-bookmark-sync] Auto sync failed:", err);
      });
    }, CLOUD_BOOKMARK_SYNC_DEBOUNCE_MS);
  }

  /** 执行云端书签同步 */
  async function triggerCloudBookmarkSync(
    force = false,
  ): Promise<{
    added: number;
    removed: number;
    uploaded: number;
  }> {
    const settings = await getSettings();
    if (!settings.cloudSyncBookmarksEnabled && !force) {
      throw new Error("Cloud bookmark sync not enabled");
    }

    const provider = getCloudProvider(settings);
    if (!provider) {
      throw new Error("Cloud provider not configured");
    }

    if (isSyncingCloudBookmarks) {
      throw new Error("Cloud bookmark sync already in progress");
    }

    isSyncingCloudBookmarks = true;
    let result: { added: number; removed: number; uploaded: number };

    try {
      const deviceId = await ensureCloudBookmarkDeviceId(
        settings.cloudSyncDeviceId,
      );
      if (!settings.cloudSyncDeviceId) {
        await saveSettings({ cloudSyncDeviceId: deviceId });
      }

      const tree = await browser.bookmarks.getTree();

      cloudBookmarkSyncLock = true;
      try {
        result = await syncCloudBookmarks(
          provider,
          deviceId,
          tree,
          async (folderPath, node) => {
            await createBookmarkFromGistPath(folderPath, node);
          },
        );

        console.log(
          `[cloud-bookmark-sync] Sync complete: +${result.added} -${result.removed}, uploaded ${result.uploaded} bookmarks`,
        );
      } finally {
        cloudBookmarkSyncLock = false;
      }
    } finally {
      isSyncingCloudBookmarks = false;
    }

    if (pendingCloudBookmarkSync) {
      pendingCloudBookmarkSync = false;
      queueMicrotask(() => scheduleDebouncedCloudBookmarkSync());
    }

    return result!;
  }

  // 监听书签变更 → 触发 Gist 同步 + 云端书签同步
  browser.bookmarks.onCreated.addListener(() => {
    scheduleDebouncedGistSync();
    scheduleDebouncedCloudBookmarkSync();
  });

  browser.bookmarks.onChanged.addListener(() => {
    scheduleDebouncedGistSync();
    scheduleDebouncedCloudBookmarkSync();
  });

  browser.bookmarks.onMoved.addListener(() => {
    scheduleDebouncedGistSync();
    scheduleDebouncedCloudBookmarkSync();
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
    scheduleDebouncedCloudBookmarkSync();
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
        {
          content: "cw ",
          description: IS_FIREFOX
            ? t("background.cmdCodeWiki")
            : t("background.cmdCodeWiki"),
        },
      ]);
      return;
    }

    // Code Wiki trigger: "cw ..." — open wiki page or suggest a query
    if (rawInput === "cw" || rawInput.startsWith("cw ")) {
      const query = rawInput === "cw" ? "" : rawInput.substring(3).trim();
      const wikiPageUrl = (browser.runtime.getURL as any)("/wiki.html");
      suggest([
        {
          content: wikiPageUrl,
          description: IS_FIREFOX
            ? `Open Code Wiki${query ? ` — ${query}` : ""}`
            : `<match>Open Code Wiki</match> <dim>${escapeXml(query || "browse symbols & docs")}</dim>`,
        },
        ...(query
          ? [
              {
                content: `${wikiPageUrl}?q=${encodeURIComponent(query)}`,
                description: IS_FIREFOX
                  ? `Search: ${query}`
                  : `<match>Search:</match> <dim>${escapeXml(query)}</dim> <url>${escapeXml(wikiPageUrl)}</url>`,
              },
            ]
          : []),
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

    const mode = settings.searchMode || "hybrid";
    const embedCfg = resolveEmbedConfig(settings);

    // 2. 关键词模式或无 API Key：直接走全文关键词路径，不生成 embedding
    if (mode === "keyword" || !embedCfg.apiKey) {
      suggest(
        await buildKeywordSuggestions(query, valid, {
          limit: 9,
          allowedUrls,
          sourceFilter,
        }),
      );
      return;
    }

    // 3. 防抖搜索
    if (searchTimer) clearTimeout(searchTimer);
    if (searchAbortController) searchAbortController.abort();
    searchAbortController = new AbortController();
    const signal = searchAbortController.signal;

    // 查询向量已缓存时跳过 debounce 直接搜索
    const debounceMs = hasCachedQuery(query, embedCfg.model, embedCfg.backend) ? 0 : 300;

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
        const apiKey = embedCfg.apiKey;
        const queryVector = await getQueryEmbedding(
          query,
          apiKey,
          signal,
          embedCfg.model,
          embedCfg.baseURL,
          embedCfg.backend,
        );

        // 如果已中止，直接返回
        if (signal.aborted) return;

        // 5. 执行 Orama 搜索
        let results: BookmarkRecord[];

        const oramaLimit = allowedUrls ? Math.max(27, 9 * 3) : 9;

        if (mode === "vector") {
          results = await searchVector(queryVector, {
            limit: oramaLimit,
            sourceFilter: sourceFilter || undefined,
          });
        } else {
          results = await searchHybrid(query, queryVector, {
            limit: oramaLimit,
            vectorWeight: settings.vectorWeight || 0.4,
            sourceFilter: sourceFilter || undefined,
          });
        }

        // 应用 scope 过滤
        if (allowedUrls) {
          results = results.filter((r) => allowedUrls!.has(r.url));
        }

        suggest(
          results.map((record) => ({
            content: record.url,
            description: formatSuggestion(record, query, true),
          })),
        );
      } catch (error: any) {
        // 忽略 AbortError，静默返回
        if (error.name === "AbortError" || error.message?.includes("aborted"))
          return;
        console.error("[FlowSearch] Search error:", error);
        suggest(
          await buildKeywordSuggestions(query, valid, {
            limit: 9,
            allowedUrls,
            sourceFilter,
          }),
        );
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
      // 打开书签墙（集成 AI 搜索）
      const searchPageUrl =
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (browser.runtime.getURL as any)("/board.html") +
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
      resolveLLMConfig(oldVal ?? newVal).apiKey !== resolveLLMConfig(newVal).apiKey ||
      resolveLLMConfig(oldVal ?? newVal).baseURL !== resolveLLMConfig(newVal).baseURL
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
        if (settings.cloudSyncVectorEnabled) {
          const result = await uploadCloudSync(provider);
          console.log(
            `[FlowSearch] Cloud vector sync uploaded ${result.size} bytes`,
          );
        }
        if (settings.cloudSyncBookmarksEnabled) {
          const result = await triggerCloudBookmarkSync(true);
          console.log(
            `[FlowSearch] Cloud bookmark sync +${result.added} -${result.removed}, ${result.uploaded} total`,
          );
        }
      } catch (error) {
        console.error("[FlowSearch] Scheduled cloud sync failed:", error);
      }
    }
    if (alarm.name === "daily-digest") {
      console.log("[FlowSearch] Running daily digest generation...");
      await handleDailyDigest();
    }
    if (alarm.name === "githubSync") {
      console.log("[FlowSearch] Running scheduled GitHub Stars sync...");
      try {
        const settings = await getSettings();
        if (!settings.githubSyncEnabled || !settings.githubToken) return;
        const result = await syncGithubStars();
        console.log(
          `[FlowSearch] Scheduled GitHub sync done: ${result.total} repos, ${result.queued} queued`,
        );
      } catch (error) {
        console.warn("[FlowSearch] Scheduled GitHub sync failed:", error);
      }
    }
    if (alarm.name === "twitterSync") {
      console.log("[FlowSearch] Running scheduled Twitter sync...");
      try {
        const settings = await getSettings();
        if (!settings.twitterSyncEnabled) return;
        const result = await syncTwitterBookmarks();
        console.log(
          `[FlowSearch] Scheduled Twitter sync done: ${result.total} bookmarks, ${result.queued} queued`,
        );
      } catch (error) {
        console.warn("[FlowSearch] Scheduled Twitter sync failed:", error);
      }
    }
    if (alarm.name === "historySync") {
      console.log("[FlowSearch] Running scheduled history sync...");
      try {
        const settings = await getSettings();
        if (!settings.historySyncEnabled) return;
        const result = await syncHistoryBookmarks();
        console.log(
          `[FlowSearch] Scheduled history sync done: ${result.added} added, ${result.skipped} skipped`,
        );
      } catch (error) {
        console.warn("[FlowSearch] Scheduled history sync failed:", error);
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
          case "GET_FAILED_BOOKMARKS": {
            const { getFailureList } = await import("../src/db");
            const failed = await getFailureList();
            return { success: true, failed };
          }
          case "RETRY_BOOKMARK": {
            const ok = await retryFailedBookmark(message.id);
            return ok
              ? { success: true }
              : { success: false, error: "Record not found or missing retry prerequisites" };
          }
          case "DELETE_BOOKMARK":
            const { deleteBookmark } = await import("../src/db");
            try {
              await browser.bookmarks.remove(message.id);
            } catch (e) {
              console.debug("[FlowSearch] Bookmark already gone from browser");
            }
            await deleteBookmark(message.id);
            await removeFromSearchEngine(message.id).catch(() => {});
            await flushSaveSearchEngine();
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
          case "CLEAR_INDEXED_DATA": {
            await resetIndexedData();
            return { success: true };
          }
          case "REINDEX_STORED_EMBEDDINGS": {
            // 走空间校验：书签与代码向量一起重建，并记录新的空间指纹
            const queued = await revalidateEmbeddingSpace();
            return { success: true, queued };
          }
          case "REFRESH_ALARMS": {
            // 设置保存后刷新全部定时任务（死链 / 云同步 / 简报 / 外部数据源）
            await initLinkCheckAlarm();
            await initCloudSyncAlarm();
            await initDailyDigestAlarm();
            await initSourceSyncAlarms();
            return { success: true };
          }
          case "IMPORT_DATA": {
            const result = await importBookmarksData(message.records);
            return { success: true, ...result };
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
              async () => browser.bookmarks.getTree(),
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
          case "CLOUD_SYNC_BOOKMARK_SYNC": {
            try {
              const result = await triggerCloudBookmarkSync(true);
              return { success: true, ...result };
            } catch (e: any) {
              return {
                success: false,
                error: e?.message || String(e),
              };
            }
          }
          case "CLOUD_SYNC_BOOKMARK_UPLOAD": {
            try {
              const bmSettings = await getSettings();
              const provider = getCloudProvider(bmSettings);
              if (!provider) {
                return {
                  success: false,
                  error: t("background.providerNotConfigured"),
                };
              }
              const deviceId = await ensureCloudBookmarkDeviceId(
                bmSettings.cloudSyncDeviceId,
              );
              if (!bmSettings.cloudSyncDeviceId) {
                await saveSettings({ cloudSyncDeviceId: deviceId });
              }
              const localTree = await browser.bookmarks.getTree();
              const result = await uploadCloudBookmarks(
                provider,
                deviceId,
                localTree,
              );
              return { success: true, ...result };
            } catch (e: any) {
              return {
                success: false,
                error: e?.message || String(e),
              };
            }
          }
          case "CLOUD_SYNC_BOOKMARK_DOWNLOAD": {
            try {
              const bmDownSettings = await getSettings();
              const provider = getCloudProvider(bmDownSettings);
              if (!provider) {
                return {
                  success: false,
                  error: t("background.providerNotConfigured"),
                };
              }
              const localTree = await browser.bookmarks.getTree();
              const result = await downloadCloudBookmarks(
                provider,
                localTree,
                async () => browser.bookmarks.getTree(),
                async (id: string) => {
                  await browser.bookmarks.removeTree(id);
                },
                async (folderPath, node) => {
                  await createBookmarkFromGistPath(folderPath, node);
                },
              );
              return { success: true, ...result };
            } catch (e: any) {
              return {
                success: false,
                error: e?.message || String(e),
              };
            }
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
            if (!isLLMConfigured(summarizeSettings)) {
              return {
                success: false,
                error: t("background.apiKeyNotConfigured"),
              };
            }
            const content = await fetchPageContent(
              message.url,
              summarizeSettings,
            );
            if (!content) {
              return {
                success: false,
                error: t("background.contentExtractionFailed"),
              };
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
              };
            }
            try {
              // 并行执行摘要和知识提取
              const [result, knowledge] = await Promise.all([
                provider.generateDeepContent(
                  content.markdown.slice(0, 8000),
                  undefined,
                  message.url,
                ),
                content.markdown.length > 300
                  ? provider.extractKnowledge(
                      content.markdown.slice(0, 10000),
                      undefined,
                      message.url,
                    ).catch(() => null)
                  : Promise.resolve(null),
              ]);

              // 异步存储概念（不阻塞响应）
              if (knowledge && knowledge.concepts.length > 0) {
                const { upsertConcepts } = await import("../src/db");
                upsertConcepts(
                  knowledge.concepts.map((c) => ({
                    name: c.name,
                    definition: c.definition,
                    category: c.category,
                    relatedConcepts: c.relatedConcepts,
                    bookmarkId: `summarize-${Date.now()}`,
                    context: knowledge.quickSummary || knowledge.summary.slice(0, 100),
                  })),
                ).catch((e) => console.warn("[background] Concept storage failed:", e));
              }

              return {
                success: true,
                url: message.url,
                title: content.title || message.url,
                summary: result.summary,
                tags: result.tags,
                quickSummary: result.quickSummary,
                contentType: result.contentType,
                keyPoints: result.keyPoints,
                readingTime: result.readingTime,
                difficulty: result.difficulty,
                technologies: result.technologies,
                concepts: knowledge?.concepts || [],
                claims: knowledge?.claims || [],
                dataPoints: knowledge?.dataPoints || [],
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
              };
            }
          }
          case "ASK_BOOKMARKS": {
            const askSettings = await getSettings();
            const askEmbedCfg = resolveEmbedConfig(askSettings);
            const askLLMCfg = resolveLLMConfig(askSettings);
            if ((askEmbedCfg.backend !== "local" && !askEmbedCfg.apiKey) || !askLLMCfg.apiKey) {
              return {
                success: false,
                error: t("background.apiKeyNotConfigured"),
              };
            }
            const { askBookmarks } = await import("../src/rag");
            const queryVector = await getQueryEmbedding(
              message.question,
              askEmbedCfg.apiKey,
              undefined,
              askEmbedCfg.model,
              askEmbedCfg.baseURL,
              askEmbedCfg.backend,
            );
            const topK = message.topK || askSettings.ragTopK || 8;
            const results = await searchVector(queryVector, { limit: topK });
            if (results.length === 0) {
              return {
                success: true,
                answer: t("background.noRelevantBookmarks"),
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
              askLLMCfg.apiKey,
              askLLMCfg.model,
              askLLMCfg.baseURL,
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
              return {
                success: false,
                error: t("background.providerNotConfigured"),
              };
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
              return {
                success: false,
                error: t("background.providerNotConfigured"),
              };
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
              return {
                success: false,
                error: t("background.providerNotConfigured"),
              };
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
              return {
                success: false,
                error: t("background.providerNotConfigured"),
              };
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
              return {
                success: false,
                error: t("background.providerNotConfigured"),
              };
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
          case "GET_DAILY_DIGESTS": {
            const { getRecentDigests } = await import("../src/daily-digest");
            const digests = await getRecentDigests(message.days || 7);
            return { success: true, digests };
          }
          case "GENERATE_DAILY_DIGEST": {
            const { generateDailyDigest } = await import("../src/daily-digest");
            const provider = getLLMProvider();
            const digest = await generateDailyDigest(
              provider || undefined,
              message.date,
            );
            return { success: true, digest };
          }
          case "GET_CONCEPTS": {
            const { getTopConcepts, searchConcepts } = await import("../src/db");
            if (message.query) {
              const concepts = await searchConcepts(message.query);
              return { success: true, concepts };
            }
            const concepts = await getTopConcepts(message.limit || 50);
            return { success: true, concepts };
          }
          case "SERENDIPITY_SEARCH": {
            const { keywords, url } = message;
            if (!keywords || keywords.length === 0) {
              return { success: true, matches: [] };
            }

            // 搜索相关概念
            const { searchConcepts, db: searchDb } = await import("../src/db");
            const query = keywords.join(" ");
            const matchedConcepts = await searchConcepts(query);

            if (matchedConcepts.length === 0) {
              return { success: true, matches: [] };
            }

            // 从概念 occurrences 收集书签 ID，批量查询
            const bookmarkIds = new Set<string>();
            for (const concept of matchedConcepts) {
              for (const occ of concept.occurrences) {
                bookmarkIds.add(occ.bookmarkId);
              }
            }

            if (bookmarkIds.size === 0) {
              return { success: true, matches: [] };
            }

            const ids = [...bookmarkIds].slice(0, 30);
            const records = await searchDb.bookmarks.bulkGet(ids);
            const currentDomain = new URL(url).hostname;

            // 计算相关性分数
            const bookmarkScores = new Map<string, { record: NonNullable<typeof records[0]>; score: number; concepts: string[] }>();

            for (const concept of matchedConcepts) {
              for (const occ of concept.occurrences) {
                const record = records.find((r: typeof records[0]) => r && r.id === occ.bookmarkId);
                if (!record) continue;

                try {
                  if (new URL(record.url).hostname === currentDomain) continue;
                } catch {
                  continue;
                }

                const existing = bookmarkScores.get(record.id);
                if (existing) {
                  existing.score += 1;
                  if (!existing.concepts.includes(concept.name)) {
                    existing.concepts.push(concept.name);
                  }
                } else {
                  bookmarkScores.set(record.id, { record, score: 1, concepts: [concept.name] });
                }
              }
            }

            const matches = [...bookmarkScores.values()]
              .sort((a, b) => b.score - a.score)
              .slice(0, 5)
              .map((item) => ({
                title: item.record.title,
                url: item.record.url,
                quickSummary: item.record.quickSummary || item.record.summary.slice(0, 100),
                readAt: item.record.indexedAt || 0,
                concepts: item.concepts.slice(0, 3),
                relevance: Math.min(item.score / matchedConcepts.length, 1),
              }));

            return { success: true, matches };
          }
          case "RESEARCH": {
            const { conductResearch, saveResearchToHistory } = await import("../src/research");
            try {
              const controller = new AbortController();
              setTimeout(() => controller.abort(), 5 * 60 * 1000);
              const report = await conductResearch(message.question, controller.signal);
              await saveResearchToHistory(report);
              return { success: true, report };
            } catch (err) {
              const errMsg = err instanceof Error ? err.message : String(err);
              return { success: false, error: errMsg };
            }
          }
          case "GET_RESEARCH_HISTORY": {
            const { getResearchHistory } = await import("../src/research");
            const history = await getResearchHistory(message.limit || 10);
            return { success: true, history };
          }
          // === Code Wiki handlers ===
          case "BUILD_CODE_GRAPH": {
            return await buildCodeGraphHandler(message);
          }
          case "GET_CODE_GRAPH": {
            const {
              getSymbolsByRepo,
              getEdgesByRepo,
              getWikiDocsByRepo,
            } = await import("../src/code-graph/persist");
            const [symbols, edges, docs] = await Promise.all([
              getSymbolsByRepo(message.repoUrl),
              getEdgesByRepo(message.repoUrl),
              getWikiDocsByRepo(message.repoUrl),
            ]);
            return { success: true, symbols, edges, docs };
          }
          case "SEMANTIC_CODE_SEARCH": {
            const { semanticCodeSearch } = await import("../src/embed-code/search");
            const settings = await getSettings();
            const embedCfg = resolveEmbedConfig(settings);
            if (embedCfg.backend !== "local" && !embedCfg.apiKey) {
              return { success: false, error: "No API key configured" };
            }
            const results = await semanticCodeSearch(
              message.query,
              embedCfg.apiKey,
              {
                repoUrl: message.repoUrl,
                limit: message.limit || 20,
                baseURL: settings.embedBaseURL || settings.baseURL,
                model: settings.embeddingModel,
                backend: embedCfg.backend,
              },
            );
            return { success: true, results };
          }
          case "ASK_CODEBASE": {
            return await askCodebaseHandler(message);
          }
          case "GET_SYMBOL_INFO": {
            const { getSymbol } = await import("../src/code-graph/persist");
            const symbol = await getSymbol(message.symbolId);
            if (!symbol) {
              return { success: false, error: "Symbol not found" };
            }
            return { success: true, symbol };
          }
          case "GET_WIKI_DOC": {
            const { getWikiDoc } = await import("../src/code-graph/persist");
            const doc = await getWikiDoc(message.docId);
            if (!doc) {
              return { success: false, error: "Doc not found" };
            }
            return { success: true, doc };
          }
          case "GET_WIKI_OVERVIEW": {
            const { db } = await import("../src/db");
            const { WIKI_DOC_ID } = await import("../src/types");
            const doc = await db.wikiDocs.get(WIKI_DOC_ID.overview(message.repoUrl));
            if (!doc) {
              return { success: false, error: "Overview not found" };
            }
            return { success: true, doc };
          }
          case "SYNC_WIKI": {
            return await syncWikiHandler(message);
          }
          case "WIKI_LIST_REPOS": {
            const { db } = await import("../src/db");
            const [allSymbols, allEdges, allDocs, allEmbeds] = await Promise.all([
              db.codeSymbols.toArray(),
              db.codeEdges.toArray(),
              db.wikiDocs.toArray(),
              db.codeEmbeddings.toArray(),
            ]);
            const repoMap = new Map<
              string,
              {
                id: string;
                repoUrl: string;
                branch: string;
                updatedAt: number;
                symbolCount: number;
                edgeCount: number;
                docCount: number;
                embeddingCount: number;
              }
            >();
            for (const s of allSymbols) {
              const cur = repoMap.get(s.repoUrl) || {
                id: s.repoUrl,
                repoUrl: s.repoUrl,
                branch: s.branch,
                updatedAt: 0,
                symbolCount: 0,
                edgeCount: 0,
                docCount: 0,
                embeddingCount: 0,
              };
              cur.symbolCount++;
              cur.updatedAt = Math.max(cur.updatedAt, 0);
              repoMap.set(s.repoUrl, cur);
            }
            for (const e of allEdges) {
              const cur = repoMap.get(e.repoUrl);
              if (cur) cur.edgeCount++;
            }
            for (const d of allDocs) {
              const cur = repoMap.get(d.repoUrl);
              if (cur) {
                cur.docCount++;
                cur.updatedAt = Math.max(cur.updatedAt, d.updatedAt);
              }
            }
            for (const em of allEmbeds) {
              const cur = repoMap.get(em.repoUrl);
              if (cur) cur.embeddingCount++;
            }
            return { success: true, repos: [...repoMap.values()] };
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

// ============================================================
// Code Wiki helper handlers (extracted from switch for clarity)
// ============================================================

function langNameForSettings(lang: string | undefined): string {
  switch (lang) {
    case "zh-CN":
      return "Chinese";
    case "ja":
      return "Japanese";
    case "ko":
      return "Korean";
    case "en":
    default:
      return "English";
  }
}

function normaliseBaseURL(url: string | undefined, fallback: string): string {
  // 与 OpenAI SDK 约定一致：baseURL 以 /v1 结尾，端点只拼接资源路径
  return normalizeBaseURL(url || fallback);
}

/** 从 symbols 构造最小可用 chunks（fallback when Orama engine empty） */
function symbolsToChunks(symbols: CodeSymbol[]): CodeChunk[] {
  return symbols.map((s) => ({
    id: s.id,
    content: [
      s.jsdoc ? `/* ${s.jsdoc} */` : "",
      s.signature,
    ].filter(Boolean).join("\n"),
    language: s.filePath.split(".").pop() || "text",
    filePath: s.filePath,
    symbolName: s.name,
    kind: s.kind,
    lineStart: s.lineStart,
    lineEnd: s.lineEnd,
    repoUrl: s.repoUrl,
    branch: s.branch,
  }));
}

/** 加载仓库的所有 symbols 和 embeddings（fallback path for QA） */
async function loadRepoContext(repoUrl: string): Promise<{
  symbols: CodeSymbol[];
  embeddings: Map<string, number[]>;
}> {
  const { getSymbolsByRepo } = await import("../src/code-graph/persist");
  const { db } = await import("../src/db");
  const [symbols, embeddingRecords] = await Promise.all([
    getSymbolsByRepo(repoUrl),
    db.codeEmbeddings.where("repoUrl").equals(repoUrl).toArray(),
  ]);
  const embeddings = new Map<string, number[]>();
  for (const e of embeddingRecords as CodeEmbedding[]) {
    embeddings.set(e.id, e.vector);
  }
  return { symbols, embeddings };
}

/** BUILD_CODE_GRAPH 完整流水线：parse → embed → populate → wiki */
async function buildCodeGraphHandler(
  message: Extract<WikiMessage, { type: "BUILD_CODE_GRAPH" }>,
) {
  const settings = await getSettings();
  const embedApiKey = settings.embedApiKey || settings.openaiApiKey || "";
  const llmApiKey = settings.llmApiKey || settings.openaiApiKey || "";
  const embedCfgForWiki = resolveEmbedConfig(settings);
  const embedBaseURL = normaliseBaseURL(
    settings.embedBaseURL || settings.baseURL,
      "https://api.siliconflow.cn/v1",
  );
  const llmBaseURL = normaliseBaseURL(
    settings.llmBaseURL || settings.baseURL,
      "https://api.siliconflow.cn/v1",
  );
  const embedModel = settings.embeddingModel;
  const llmModel = settings.llmModel;

  const { parseFiles: parseFilesLegacy, saveSymbols, saveEdges, parseGitHubUrl, fetchRepoSource } =
    await import("../src/code-graph");
  void parseFilesLegacy; // legacy fallback exposed for tests; production uses parseViaWorker
  const { parseViaWorker, chunkViaWorker } = await import(
    "../src/code-graph/worker-client"
  );
  const { chunkFiles } = await import("../src/embed-code/chunk");
  const { embedChunks, saveCodeEmbedding } = await import(
    "../src/embed-code/embed"
  );
  const {
    ensureCodeSearchEngine,
    populateCodeSearchEngine,
    clearCodeSearchByRepo,
  } = await import("../src/embed-code/index");
  const { summarizeSymbols, buildWikiDocs } = await import("../src/repo-wiki");
  const { upsertWikiDocs } = await import("../src/db");
  type WikiProgressEvent = import("../src/types").WikiProgressEvent;

  const branch = message.branch || "main";
  const repoUrl = message.repoUrl;

  // 进度广播：向所有打开的 tab 发送 WIKI_PROGRESS
  const broadcastProgress = (
    phase: WikiProgressEvent["phase"],
    msg: string,
    current?: number,
    total?: number,
  ) => {
    try {
      const event: WikiProgressEvent = {
        type: "WIKI_PROGRESS",
        repoUrl,
        phase,
        message: msg,
        current,
        total,
      };
      browser.runtime.sendMessage(event).catch(() => {
        /* no listeners */
      });
    } catch {
      /* ignore */
    }
  };

  // 1. 拉取 source：可选 GitHub
  let files: { path: string; content: string }[] = message.files || [];
  if (message.fetchFromGitHub) {
    const ref = parseGitHubUrl(repoUrl);
    if (!ref) {
      return { success: false, error: `Invalid GitHub URL: ${repoUrl}` };
    }
    const targetBranch = branch || ref.branch;
    const fullRef = { ...ref, branch: targetBranch };
    broadcastProgress(
      "fetching_tree",
      `Resolving tree for ${ref.owner}/${ref.repo}@${targetBranch}...`,
    );
    try {
      files = await fetchRepoSource(fullRef, {
        onProgress: (msg) => {
          const match = /Downloaded (\d+)\/(\d+)/.exec(msg);
          if (match) {
            broadcastProgress(
              "downloading",
              msg,
              Number(match[1]),
              Number(match[2]),
            );
          } else {
            broadcastProgress("downloading", msg);
          }
        },
      });
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e);
      return { success: false, error: `GitHub fetch failed: ${errMsg}` };
    }
    if (files.length === 0) {
      return {
        success: false,
        error: "No source files found in repository (check branch or access)",
      };
    }
  }

  broadcastProgress("parsing", `Parsing ${files.length} files...`);

  // 2. 解析（worker offload，失败 fallback 到 in-SW）
  const { symbols, edges } = await parseViaWorker(
    files,
    repoUrl,
    branch,
    (done, total) => broadcastProgress("parsing", `Parsed ${done}/${total} files...`),
  );

  // 3. 持久化 symbols/edges
  await saveSymbols(symbols);
  await saveEdges(edges);

  broadcastProgress("parsing", `Chunking ${symbols.length} symbols...`);

  // 4. 切分（按文件 + symbols 精切）
  const chunks = await chunkViaWorker(
    files.map((f: { path: string; content: string }) => ({
      path: f.path,
      content: f.content,
      symbols: symbols.filter((s) => s.filePath === f.path),
    })),
    symbols,
    repoUrl,
    branch,
    (done, total) => broadcastProgress("embedding", `Chunked ${done}/${total} files...`),
  );

  broadcastProgress("embedding", `Embedding ${chunks.length} chunks via BGE-M3...`);

  // 4. 嵌入（需 API key）
  let embeddings: CodeEmbedding[] = [];
  if (chunks.length > 0 && (embedCfgForWiki.backend === "local" || embedApiKey)) {
    try {
      embeddings = await embedChunks(
        chunks,
        embedApiKey,
        embedBaseURL,
        embedModel,
        embedCfgForWiki.backend,
      );
      await saveCodeEmbedding(embeddings);
    } catch (e) {
      console.warn(
        "[BUILD_CODE_GRAPH] embed failed:",
        e instanceof Error ? e.message : String(e),
      );
    }
  } else if (chunks.length > 0) {
    console.warn("[BUILD_CODE_GRAPH] no embed API key, skipping embeddings");
  }

  // 5. 填充搜索引擎（先清后填）
  if (embeddings.length > 0) {
    try {
      await ensureCodeSearchEngine();
      await clearCodeSearchByRepo(repoUrl);
      const embedMap = new Map(embeddings.map((e) => [e.id, e.vector]));
      await populateCodeSearchEngine(
        chunks
          .map((c) => ({ chunk: c, embedding: embedMap.get(c.id) ?? [] }))
          .filter((r) => r.embedding.length > 0),
      );
    } catch (e) {
      console.warn(
        "[BUILD_CODE_GRAPH] populate engine failed:",
        e instanceof Error ? e.message : String(e),
      );
    }
  }

  // 6. Wiki 文档生成
  broadcastProgress("wiki", "Generating wiki documentation...");
  let wikiDocs: import("../src/types").WikiDoc[] = [];
  try {
    const symbolSummaries = llmApiKey && symbols.length > 0
      ? await summarizeSymbols(
          symbols,
          llmApiKey,
          llmBaseURL,
          llmModel,
          langNameForSettings(settings.language),
        )
      : undefined;
    wikiDocs = buildWikiDocs(symbols, symbolSummaries, repoUrl);
    await upsertWikiDocs(wikiDocs);
  } catch (e) {
    console.warn(
      "[BUILD_CODE_GRAPH] wiki generation failed:",
      e instanceof Error ? e.message : String(e),
    );
  }

  return {
    success: true,
    symbolCount: symbols.length,
    edgeCount: edges.length,
    embeddingCount: embeddings.length,
    wikiDocCount: wikiDocs.length,
  };
}

/** SYNC_WIKI：按文件增量重算 */
async function syncWikiHandler(
  message: Extract<WikiMessage, { type: "SYNC_WIKI" }>,
) {
  const settings = await getSettings();
  const embedApiKey = settings.embedApiKey || settings.openaiApiKey || "";
  const llmApiKey = settings.llmApiKey || settings.openaiApiKey || "";
  const embedCfgForWiki = resolveEmbedConfig(settings);
  const embedBaseURL = normaliseBaseURL(
    settings.embedBaseURL || settings.baseURL,
      "https://api.siliconflow.cn/v1",
  );
  const llmBaseURL = normaliseBaseURL(
    settings.llmBaseURL || settings.baseURL,
      "https://api.siliconflow.cn/v1",
  );
  const embedModel = settings.embeddingModel;
  const llmModel = settings.llmModel;

  const {
    saveSymbols,
    saveEdges,
    deleteSymbolsByFile,
    deleteEdgesByFile,
  } = await import("../src/code-graph");
  const { parseViaWorker, chunkViaWorker } = await import(
    "../src/code-graph/worker-client"
  );
  const { chunkFiles } = await import("../src/embed-code/chunk");
  const { embedChunks, saveCodeEmbedding, deleteCodeEmbeddingsByFile } =
    await import("../src/embed-code/embed");
  const {
    ensureCodeSearchEngine,
    populateCodeSearchEngine,
    removeCodeSearchByFile,
  } = await import("../src/embed-code/index");
  const { summarizeSymbols, buildWikiDocs } = await import("../src/repo-wiki");
  const { upsertWikiDocs, db } = await import("../src/db");
  const { getSymbolsByRepo } = await import("../src/code-graph/persist");

  const files = message.files || [];
  const branch = message.branch || "main";
  const repoUrl = message.repoUrl;

  // 1) 删除变更文件的旧数据
  for (const f of files) {
    await deleteSymbolsByFile(f.path);
    await deleteEdgesByFile(f.path);
    await deleteCodeEmbeddingsByFile(f.path);
    await removeCodeSearchByFile(f.path);
  }

  const { symbols: newSymbols, edges: newEdges } = await parseViaWorker(
    files,
    repoUrl,
    branch,
  );
  await saveSymbols(newSymbols);
  await saveEdges(newEdges);

  const chunks = await chunkViaWorker(
    files.map((f) => ({
      path: f.path,
      content: f.content,
      symbols: newSymbols.filter((s) => s.filePath === f.path),
    })),
    newSymbols,
    repoUrl,
    branch,
  );

  let embeddings: CodeEmbedding[] = [];
  if (chunks.length > 0 && (embedCfgForWiki.backend === "local" || embedApiKey)) {
    try {
      embeddings = await embedChunks(
        chunks,
        embedApiKey,
        embedBaseURL,
        embedModel,
        embedCfgForWiki.backend,
      );
      await saveCodeEmbedding(embeddings);
      await ensureCodeSearchEngine();
      const embedMap = new Map(embeddings.map((e) => [e.id, e.vector]));
      await populateCodeSearchEngine(
        chunks
          .map((c) => ({ chunk: c, embedding: embedMap.get(c.id) ?? [] }))
          .filter((r) => r.embedding.length > 0),
      );
    } catch (e) {
      console.warn(
        "[SYNC_WIKI] embed failed:",
        e instanceof Error ? e.message : String(e),
      );
    }
  }

  // 重建 wiki（覆盖；先删后插）
  const allSymbols = await getSymbolsByRepo(repoUrl);
  const allDocs = await db.wikiDocs.where("repoUrl").equals(repoUrl).primaryKeys();
  if (allDocs.length > 0) await db.wikiDocs.bulkDelete(allDocs);

  let wikiDocs: import("../src/types").WikiDoc[] = [];
  try {
    const symbolSummaries = llmApiKey && allSymbols.length > 0
      ? await summarizeSymbols(
          allSymbols,
          llmApiKey,
          llmBaseURL,
          llmModel,
          langNameForSettings(settings.language),
        )
      : undefined;
    wikiDocs = buildWikiDocs(allSymbols, symbolSummaries, repoUrl);
    await upsertWikiDocs(wikiDocs);
  } catch (e) {
    console.warn(
      "[SYNC_WIKI] wiki rebuild failed:",
      e instanceof Error ? e.message : String(e),
    );
  }

  return {
    success: true,
    symbolCount: newSymbols.length,
    edgeCount: newEdges.length,
    embeddingCount: embeddings.length,
    wikiDocCount: wikiDocs.length,
  };
}

/** ASK_CODEBASE RAG — pool-based cosine sim + LLM */
async function askCodebaseHandler(
  message: Extract<WikiMessage, { type: "ASK_CODEBASE" }>,
) {
  const settings = await getSettings();
  const embedCfg = resolveEmbedConfig(settings);
  const embedApiKey = embedCfg.apiKey;
  const llmApiKey = settings.llmApiKey || settings.openaiApiKey || "";
  if ((embedCfg.backend !== "local" && !embedApiKey) || !llmApiKey) {
    return { success: false, error: "No API key configured" };
  }

  const { askCodebase } = await import("../src/repo-wiki/qa");
  const { searchViaWorkerPool } = await import("../src/code-graph/worker-client");
  const { repoUrl, question } = message;

  // 1) 加载仓库所有 symbols + embeddings
  const { symbols, embeddings } = await loadRepoContext(repoUrl);
  if (symbols.length === 0) {
    return {
      success: true,
      answer: "This repository has no indexed code yet. Build the code graph first.",
      citations: [],
    };
  }

  // 2) 构造 chunks（symbol 级别）
  const chunks = symbolsToChunks(symbols);

  const embedBaseURL = normaliseBaseURL(
    settings.embedBaseURL || settings.baseURL,
      "https://api.siliconflow.cn/v1",
  );
  const llmBaseURL = normaliseBaseURL(
    settings.llmBaseURL || settings.baseURL,
      "https://api.siliconflow.cn/v1",
  );

  // 3) Embed query + pool-based cosine sim across N workers
  const { getQueryEmbedding } = await import("../src/embedding");
  const queryEmbedding = await getQueryEmbedding(
    question,
    embedApiKey,
    undefined,
    settings.embeddingModel,
    embedBaseURL,
    embedCfg.backend,
  );
  const TOP_K = 8;
  const ranked = await searchViaWorkerPool(
    queryEmbedding,
    chunks,
    embeddings,
    TOP_K,
    (phase) => console.log(`[ASK_CODEBASE] ${phase}`),
  );
  // Map ranked ids back to top chunks for context + citations
  const chunkById = new Map(chunks.map((c) => [c.id, c]));
  const topChunks = ranked
    .map((r) => chunkById.get(r.id))
    .filter((c): c is NonNullable<typeof c> => Boolean(c));

  // 4) Build RAG context + call LLM (askCodebase from qa.ts handles the prompt)
  const result = await askCodebase(
    question,
    topChunks,
    embeddings,
    embedApiKey,
    embedBaseURL,
    settings.embeddingModel,
    settings.llmModel,
    llmApiKey,
    embedCfg.backend,
  );
  return {
    success: true,
    answer: result.answer,
    citations: result.citations,
  };
}
