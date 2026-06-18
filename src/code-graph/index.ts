/**
 * Code Graph — parse, build, persist, and diff source files into a queryable graph.
 * Pure logic; no browser API usage.
 */

export { parseFile, parseFiles } from "./parser";
export {
  buildGraph,
  getSymbolNeighbors,
  getReferencingSymbols,
  getCallGraph,
  getInheritanceChain,
  getFileSymbols,
  getFileImports,
} from "./graph";
export {
  saveSymbols,
  saveEdges,
  getSymbol,
  getSymbolsByFile,
  getSymbolsByRepo,
  getAllSymbols,
  deleteSymbolsByFile,
  deleteEdgesByFile,
  saveWikiDoc,
  getWikiDoc,
  getWikiDocsByRepo,
  saveCodeEmbedding,
  getCodeEmbedding,
  deleteCodeEmbeddingsByFile,
  deleteRepoData,
} from "./persist";
export { parseGitDiff, detectChangedFiles } from "./diff";
export type { DiffSummary } from "./diff";
export {
  parseGitHubUrl,
  listRepoFiles,
  fetchFileContents,
  fetchRepoSource,
} from "./github";
export type { GitHubRepoRef, RepoFileEntry } from "./github";
export {
  parseViaWorker,
  chunkViaWorker,
  shutdownWorker,
} from "./worker-client";
