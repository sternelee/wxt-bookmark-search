/**
 * Code semantic search — 查询向量化 + 混合搜索 一键入口
 */
import type { CodeSearchResult } from "../types";
import { getQueryEmbedding } from "../embedding";
import { ensureCodeSearchEngine, searchCodeHybrid } from "./index";

/**
 * 语义代码搜索：自动懒加载引擎 + 获取查询向量 + 混合搜索
 *
 * @param query - 自然语言查询
 * @param apiKey - SiliconFlow API key
 * @param options - 搜索选项
 * @returns CodeSearchResult[]
 */
export async function semanticCodeSearch(
  query: string,
  apiKey: string,
  options: {
    limit?: number;
    vectorWeight?: number;
    repoUrl?: string;
    baseURL?: string;
    model?: string;
    signal?: AbortSignal;
  } = {},
): Promise<CodeSearchResult[]> {
  const { baseURL, model, signal, ...searchOpts } = options;
  await ensureCodeSearchEngine();
  const queryEmbedding = await getQueryEmbedding(query, apiKey, signal, model, baseURL);
  return searchCodeHybrid(query, queryEmbedding, searchOpts);
}

// Re-export 所有 embed-code 模块，方便 barrel import
export { chunkFile, chunkFiles } from "./chunk";
export {
  embedChunks,
  saveCodeEmbedding,
  getCodeEmbeddings,
  deleteCodeEmbeddingsByRepo,
} from "./embed";
export {
  initCodeSearchEngine,
  ensureCodeSearchEngine,
  populateCodeSearchEngine,
  upsertCodeSearchBatch,
  removeCodeSearchByFile,
  clearCodeSearchByRepo,
  searchCodeHybrid,
  searchCodeVector,
  searchCodeKeyword,
  isCodeSearchEngineReady,
  registerCodeSaveFn,
  scheduleSaveCodeSearchEngine,
  flushSaveCodeSearchEngine,
  resetCodeSearchEngine,
  saveCodeSearchEngine,
  loadCodeSearchEngine,
  ORAMA_CODE_INDEX_STORAGE_KEY,
} from "./index";
