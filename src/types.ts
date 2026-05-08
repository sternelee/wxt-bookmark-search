export interface ChromeBookmark {
  id: string;
  title: string;
  url: string | null; // folder nodes have null URL
  dateAdded?: number;
}

export interface OmniboxSuggestion {
  content: string;
  description: string;
}

/** 向量化书签记录 */
export interface BookmarkRecord {
  id: string; // bookmark id
  url: string;
  title: string;
  summary: string; // AI 提取的摘要
  tags?: string[]; // LLM 生成的标签
  embedding?: number[]; // 向量 (1024 维)
  vectorId?: number; // EdgeVec 向量 ID
  status: "pending" | "indexed" | "failed";
  indexedAt?: number; // 索引时间戳
  error?: string; // 失败原因
  needsEnrichment?: boolean; // 快速路径索引后，待后台丰富化（如 GitHub README）
  llmEnhanced?: boolean; // 是否经过 LLM 增强
  source?: "github" | "twitter" | "bookmark" | "history";

  /** 预计算的 embedding 向量模长（内存缓存专用，不持久化到 DB） */
  _embeddingNorm?: number;

  /** 最后一次链接健康检查的 HTTP 状态码 (0=网络错误/超时) */
  linkStatus?: number;
  /** 最后一次链接健康检查的时间戳 */
  linkCheckedAt?: number;

  // Twitter/X 特定字段
  tweetId?: string;
  authorHandle?: string;
  authorName?: string;
  authorProfileImageUrl?: string;
  postedAt?: string;
  bookmarkedAt?: string;
  engagement?: {
    likeCount?: number;
    repostCount?: number;
    replyCount?: number;
    bookmarkCount?: number;
    viewCount?: number;
    quoteCount?: number;
  };
  media?: string[];
  quotedTweetId?: string;
  quotedTweetText?: string;
}

/** 搜索结果 DTO — 仅含 UI 所需字段，不暴露向量/内部元数据 */
export interface SearchResult {
  url: string;
  title: string;
  summary: string;
  tags: string[];
  source: "github" | "twitter" | "bookmark" | "history";
  indexed: boolean;
}

/** 搜索模式 */
export type SearchMode = "keyword" | "vector" | "hybrid";

/** 搜索选项 */
export interface SearchOptions {
  mode?: SearchMode;
  vectorWeight?: number; // 混合搜索时向量权重 (默认 0.4)
  limit?: number;
}

/** Gist 同步数据结构 */
export interface GistBookmarkNode {
  id: string;
  title: string;
  url?: string; // 文件夹无 url
  dateAdded?: number;
  children?: GistBookmarkNode[];
}

export interface GistBookmarkData {
  version: 1;
  exportedAt: number; // 导出时间戳
  deviceId: string; // 设备标识
  bookmarks: GistBookmarkNode[];
}

/** 本地删除记录 — 用于合并时区分 "远程新增" vs "本地删除" */
export interface DeletedBookmarkEntry {
  key: string; // 书签唯一键: url + title + folderPath
  url: string;
  title: string;
  folderPath: string[];
  deletedAt: number;
}

/** 设置存储结构 */
export interface Settings {
  openaiApiKey?: string;
  baseURL?: string; // API 基础地址 (默认: https://api.siliconflow.cn)
  searchMode: SearchMode;
  vectorWeight: number;
  selectedFolderIds?: string[]; // 持久化存储选中的文件夹 ID
  githubToken?: string; // GitHub PAT
  githubSyncEnabled?: boolean; // 是否启用 GitHub 同步
  lastGithubSync?: number; // 上次同步时间
  twitterSyncEnabled?: boolean; // 是否启用 Twitter 同步
  lastTwitterSync?: number; // 上次 Twitter 同步时间
  twitterCookies?: {
    // Twitter cookies (手动输入)
    ct0: string;
    authToken: string;
  };
  enableLLMEnrichment?: boolean; // 是否启用 LLM 内容增强

  // 模型配置
  embeddingModel?: string; // Embedding 模型名称
  llmModel?: string; // LLM 模型名称

  // Gist 同步配置
  gistSyncEnabled?: boolean; // 是否启用 Gist 书签同步
  gistId?: string; // Gist ID
  gistDeviceId?: string; // 本设备 UUID
  lastGistSync?: number; // 上次同步时间戳

  // 浏览历史同步配置
  historySyncEnabled?: boolean; // 是否启用历史同步
  historyDays?: number; // 同步最近 N 天，默认 30

  // 语言设置
  language?: string; // 界面语言: 'zh-CN' | 'en' | 'ja' | 'ko'

  /** AI 摘要提供者: "remote" | "disabled" */
  aiProvider?: import("./ai-providers/types").LLMProviderType;

  /** GitHub README 向量化版本号（用于存量重建触发），当前目标值 = 1 */
  githubReadmeVersion?: number;

  /** 死链检测：是否启用定期扫描 */
  linkCheckEnabled?: boolean;
  /** 死链检测：扫描间隔（小时），默认 24 */
  linkCheckInterval?: number;
  /** 死链检测：上次扫描完成时间 */
  lastLinkCheck?: number;

  /** AI 自动分类：是否启用 */
  autoCategorizeEnabled?: boolean;
  /** AI 自动分类：用户自定义分类规则（追加到 prompt） */
  categoryRules?: string;
  /** AI 自动分类：分类名 → 浏览器文件夹 ID 映射 */
  categoryFolderMap?: Record<string, string>;
}

/** 索引队列持久化记录（用于 Service Worker 重启后恢复） */
export interface IndexQueueRecord {
  bookmarkId: string;
  url: string;
  title: string;
  retryCount: number;
  enqueuedAt: number;
}

/** 死链健康检查结果 */
export interface LinkCheckResult {
  total: number;
  checked: number;
  alive: number;
  dead: number;
  elapsedMs: number;
}

/** 死链健康统计 */
export interface LinkHealthStats {
  total: number;
  alive: number;
  dead: number;
  unchecked: number;
  lastCheckAt?: number;
}

/** 重复书签组 */
export interface DuplicateGroup {
  url: string;
  bookmarks: BookmarkRecord[];
  folderPaths: string[][];
}

/** AI 分类建议 */
export interface CategorySuggestion {
  bookmarkId: string;
  url: string;
  title: string;
  suggestedCategory: string;
  confidence: "high" | "medium" | "low";
  reasoning: string;
}
