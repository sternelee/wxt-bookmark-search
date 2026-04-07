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
  id: string;              // bookmark id
  url: string;
  title: string;
  summary: string;         // AI 提取的摘要
  tags?: string[];         // LLM 生成的标签
  embedding?: number[];    // 向量 (1024 维)
  vectorId?: number;       // EdgeVec 向量 ID
  status: 'pending' | 'indexed' | 'failed';
  indexedAt?: number;      // 索引时间戳
  error?: string;          // 失败原因
  needsEnrichment?: boolean; // 快速路径索引后，待后台丰富化（如 GitHub README）
  llmEnhanced?: boolean;   // 是否经过 LLM 增强

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

/** 搜索模式 */
export type SearchMode = 'keyword' | 'vector' | 'hybrid';

/** 搜索选项 */
export interface SearchOptions {
  mode?: SearchMode;
  vectorWeight?: number;   // 混合搜索时向量权重 (默认 0.4)
  limit?: number;
}

/** 设置存储结构 */
export interface Settings {
  openaiApiKey?: string;
  searchMode: SearchMode;
  vectorWeight: number;
  selectedFolderIds?: string[]; // 持久化存储选中的文件夹 ID
  githubToken?: string;         // GitHub PAT
  githubSyncEnabled?: boolean;  // 是否启用 GitHub 同步
  lastGithubSync?: number;      // 上次同步时间
  twitterSyncEnabled?: boolean; // 是否启用 Twitter 同步
  lastTwitterSync?: number;     // 上次 Twitter 同步时间
  twitterCookies?: {            // Twitter cookies (手动输入)
    ct0: string;
    authToken: string;
  };
  enableLLMEnrichment?: boolean; // 是否启用 LLM 内容增强

  // 模型配置
  embeddingModel?: string;       // Embedding 模型名称
  llmModel?: string;             // LLM 模型名称
}
