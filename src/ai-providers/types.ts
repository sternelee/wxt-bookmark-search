/** 内容类型 */
export type ContentType = "article" | "repo" | "tweet" | "doc" | "video" | "tool" | "other";

/** 难度等级 */
export type DifficultyLevel = "beginner" | "intermediate" | "advanced";

/** LLM 返回结果 — 增强版结构化输出 */
export interface LLMResult {
  summary: string;
  tags: string[];
  /** 一句话快速摘要（15字以内） */
  quickSummary?: string;
  /** 内容类型 */
  contentType?: ContentType;
  /** 关键要点（3-5条） */
  keyPoints?: string[];
  /** 预估阅读时间（分钟） */
  readingTime?: number;
  /** 难度等级 */
  difficulty?: DifficultyLevel;
  /** 内容中提到的主要技术/工具 */
  technologies?: string[];
}

/** LLM Provider — 统一接口 */
export interface LLMProvider {
  readonly name: string;
  readonly available: boolean;
  /** 销毁会话资源（Remote 为 no-op） */
  destroy(): void;
  /** 生成摘要和标签 */
  generateDeepContent(
    text: string,
    signal?: AbortSignal,
    url?: string,
  ): Promise<LLMResult>;
  /** 提取结构化知识 */
  extractKnowledge(
    text: string,
    signal?: AbortSignal,
    url?: string,
  ): Promise<KnowledgeEntry>;
}
/** LLM 提供者类型: 远程 API | 禁用 */
export type LLMProviderType = "remote" | "disabled";

/** 概念提取 */
export interface Concept {
  name: string;
  definition: string;
  category: "技术" | "理论" | "方法论" | "工具" | "其他";
  relatedConcepts: string[];
}

/** 核心论点 */
export interface Claim {
  text: string;
  confidence: "high" | "medium" | "low";
  source: string;
}

/** 关键数据点 */
export interface DataPoint {
  fact: string;
  context: string;
}

/** 知识条目 — 完整结构化输出 */
export interface KnowledgeEntry {
  summary: string;
  quickSummary: string;
  keyPoints: string[];
  concepts: Concept[];
  claims: Claim[];
  dataPoints: DataPoint[];
  technologies: string[];
  contentType: ContentType;
  difficulty: DifficultyLevel;
  readingTime: number;
  language: string;
}
