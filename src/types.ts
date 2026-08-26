import type { ContentType, DifficultyLevel, LLMProviderType, Concept, Claim, DataPoint } from "./ai-providers/types";

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

/** Orama 向量索引维度 — 本地后端 (384) 会零填充到该值以匹配远程 (1024) */
export const EMBEDDING_VECTOR_DIM = 1024;

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

  /** 一句话快速摘要 */
  quickSummary?: string;
  /** 关键要点 */
  keyPoints?: string[];
  /** 预估阅读时间（分钟） */
  readingTime?: number;
  /** 技术栈 */
  technologies?: string[];

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
  /** 一句话快速摘要 */
  quickSummary?: string;
  /** 关键要点 */
  keyPoints?: string[];
  /** 预估阅读时间（分钟） */
  readingTime?: number;
  /** 技术栈 */
  technologies?: string[];
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

  /** Embedding 后端: "local" = on-device WASM (@ternlight/mini, 384 维, 无 API), "remote" = HTTP API */
  embedBackend?: "local" | "remote";

  // Per-service overrides (optional) — 为 LLM 和 Embedding 分别配置不同服务
  /** Embedding 服务的独立 API Key（覆盖 openaiApiKey） */
  embedApiKey?: string;
  /** Embedding 服务的独立 Base URL（覆盖 baseURL） */
  embedBaseURL?: string;
  /** LLM 服务的独立 API Key（覆盖 openaiApiKey） */
  llmApiKey?: string;
  /** LLM 服务的独立 Base URL（覆盖 baseURL） */
  llmBaseURL?: string;

  // Gist 同步配置
  gistSyncEnabled?: boolean; // 是否启用 Gist 书签同步
  gistId?: string; // Gist ID
  gistDeviceId?: string; // 本设备 UUID
  lastGistSync?: number; // 上次同步时间戳

  // 云端同步内容开关（统一 provider 配置下，分别控制同步内容）
  cloudSyncVectorEnabled?: boolean; // 同步向量数据库（Orama 索引 + BookmarkRecord）
  cloudSyncBookmarksEnabled?: boolean; // 同步浏览器书签树

  // 浏览历史同步配置
  historySyncEnabled?: boolean; // 是否启用历史同步
  historyDays?: number; // 同步最近 N 天，默认 30

  // 语言设置
  language?: string; // 界面语言: 'zh-CN' | 'en' | 'ja' | 'ko'

  /** AI 摘要提供者: "remote" | "disabled" */
  aiProvider?: LLMProviderType;

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

  // 云盘同步（Google Drive / Dropbox / WebDAV）— 同步 Orama 索引 + 全部 BookmarkRecord
  /** 启用的云盘 provider；null/undefined 表示未启用 */
  cloudSyncProvider?: "google-drive" | "dropbox" | "webdav" | null;
  /** 手动 access token（Google Drive / Dropbox） */
  cloudSyncToken?: string;
  /** WebDAV 基础 URL（目录 URL，例如 https://dav.example.com/remote.php/dav/files/user/flow-search/ ） */
  cloudSyncWebdavUrl?: string;
  /** WebDAV 用户名 */
  cloudSyncWebdavUsername?: string;
  /** 自动定时上传开关 */
  cloudSyncEnabled?: boolean;
  /** 自动上传间隔（小时），默认 24 */
  cloudSyncInterval?: number;
  /** 上次成功上传/下载时间戳 */
  lastCloudSync?: number;
  /** 本设备 UUID（在同步 blob 中标识来源） */
  cloudSyncDeviceId?: string;
  /** 远程文件 ID（Google Drive fileId / Dropbox path） */
  cloudSyncFileId?: string;
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
export interface SummarizeResult {
  url: string;
  title: string;
  summary: string;
  tags: string[];
  /** 一句话快速摘要 */
  quickSummary?: string;
  /** 内容类型 */
  contentType?: ContentType;
  /** 关键要点 */
  keyPoints?: string[];
  /** 预估阅读时间（分钟） */
  readingTime?: number;
  /** 难度等级 */
  difficulty?: DifficultyLevel;
  /** 技术栈 */
  technologies?: string[];
  /** 提取的概念 */
  concepts?: Concept[];
  /** 核心论点 */
  claims?: Claim[];
  /** 关键数据点 */
  dataPoints?: DataPoint[];
}

/** RAG 问答结果 */
export interface RAGAnswer {
  answer: string;
  citations: { title: string; url: string; excerpt: string }[];
}
/** 代码符号类型 */
export type CodeSymbolKind = "function" | "class" | "interface" | "type" | "variable" | "export" | "import";

/** 代码分片类型 — 在 CodeSymbolKind 基础上扩展文件级 chunk */
export type CodeChunkKind = CodeSymbolKind | "file";

/** 代码符号 */
export interface CodeSymbol {
  id: string; // filePath#symbolName
  name: string;
  kind: CodeSymbolKind;
  filePath: string;
  lineStart: number;
  lineEnd: number;
  signature: string;
  jsdoc: string;
  repoUrl: string;
  branch: string;
}

/** 代码图谱边 */
export interface CodeEdge {
  id: string;
  from: string; // symbol id
  to: string;
  kind: "calls" | "extends" | "implements" | "imports" | "exports" | "references";
  /** 冗余字段：便于按 repo 查询、删除 */
  repoUrl: string;
}

/** Wiki 文档 id 前缀规范 — 避免与 symbol id 冲突 */
export const WIKI_DOC_ID = {
  overview: (repoUrl: string) => `doc:overview:${repoUrl}`,
  module: (repoUrl: string, moduleName: string) => `doc:module:${repoUrl}:${moduleName}`,
  file: (repoUrl: string, filePath: string) => `doc:file:${repoUrl}:${filePath}`,
} as const;

/** Wiki 文档 */
export interface WikiDoc {
  id: string; // 使用 WIKI_DOC_ID.* 生成
  title: string;
  content: string; // markdown
  summary: string; // AI 生成摘要
  symbols: string[]; // 包含的 symbol ids
  repoUrl: string;
  updatedAt: number;
  /** 文档类型：overview / module / file / symbol */
  kind: "overview" | "module" | "file" | "symbol";
}

/** 代码嵌入向量 */
export interface CodeEmbedding {
  id: string; // symbol id
  vector: number[]; // 1024-dim
  chunk: string; // 原始代码片段
  repoUrl: string;
}

/** 代码分片 */
export interface CodeChunk {
  id: string;
  content: string;
  language: string;
  filePath: string;
  symbolName: string;
  kind: CodeChunkKind;
  lineStart: number;
  lineEnd: number;
  repoUrl: string;
  branch: string;
}

/** 代码图谱 */
export interface CodeGraph {
  repoUrl: string;
  branch: string;
  symbols: CodeSymbol[];
  edges: CodeEdge[];
  files: string[];
}

/** Wiki 消息类型 — 复用 background.ts 的 `type` 字段 dispatch 协议 */
export type WikiMessage =
  | { type: "BUILD_CODE_GRAPH"; repoUrl: string; branch?: string; files?: { path: string; content: string }[]; fetchFromGitHub?: boolean }
  | { type: "GET_CODE_GRAPH"; repoUrl: string }
  | { type: "SEMANTIC_CODE_SEARCH"; query: string; repoUrl?: string; limit?: number }
  | { type: "ASK_CODEBASE"; question: string; repoUrl: string }
  | { type: "GET_SYMBOL_INFO"; symbolId: string }
  | { type: "GET_WIKI_DOC"; docId: string }
  | { type: "SYNC_WIKI"; repoUrl: string; branch?: string; files?: { path: string; content: string }[]; fetchFromGitHub?: boolean }
  | { type: "WIKI_LIST_REPOS" }
  | { type: "GET_WIKI_OVERVIEW"; repoUrl: string };

/** Wiki 进度事件（background → UI） */
export type WikiProgressEvent = {
  type: "WIKI_PROGRESS";
  repoUrl: string;
  phase: "fetching_tree" | "downloading" | "parsing" | "embedding" | "wiki";
  message: string;
  /** 当前文件索引（用于 downloading phase） */
  current?: number;
  total?: number;
};

/** Wiki 仓库元信息 */
export interface WikiRepoMeta {
  id: string;
  repoUrl: string;
  branch: string;
  updatedAt: number;
  symbolCount: number;
  edgeCount: number;
  docCount: number;
  embeddingCount: number;
}

/** 代码搜索结果 */
export interface CodeSearchResult {
  id: string;
  name: string;
  kind: CodeChunkKind;
  filePath: string;
  lineStart: number;
  lineEnd: number;
  repoUrl: string;
  score: number;
  excerpt: string;
}

/** 代码问答结果 */
export interface CodeQAResult {
  answer: string;
  citations: { title: string; filePath: string; excerpt: string }[];
}
