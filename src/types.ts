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
  embedding?: number[];    // 向量 (512 维)
  status: 'pending' | 'indexed' | 'failed';
  indexedAt?: number;      // 索引时间戳
  error?: string;          // 失败原因
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
}
