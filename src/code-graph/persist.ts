/**
 * Code Graph persistence layer — Dexie CRUD for code wiki tables
 */
import { db } from "../db";
import type { CodeSymbol, CodeEdge, WikiDoc, CodeEmbedding } from "../types";

/** Save or update symbols */
export async function saveSymbols(symbols: CodeSymbol[]): Promise<void> {
  if (symbols.length === 0) return;
  await db.codeSymbols.bulkPut(symbols);
}

/** Save or update edges */
export async function saveEdges(edges: CodeEdge[]): Promise<void> {
  if (edges.length === 0) return;
  await db.codeEdges.bulkPut(edges);
}

/** Get a single symbol by id */
export async function getSymbol(id: string): Promise<CodeSymbol | undefined> {
  return db.codeSymbols.get(id);
}

/** Get all symbols for a file */
export async function getSymbolsByFile(filePath: string): Promise<CodeSymbol[]> {
  return db.codeSymbols.where("filePath").equals(filePath).toArray();
}

/** Get all symbols for a repo */
export async function getSymbolsByRepo(repoUrl: string): Promise<CodeSymbol[]> {
  return db.codeSymbols.where("repoUrl").equals(repoUrl).toArray();
}

/** Get all symbols */
export async function getAllSymbols(): Promise<CodeSymbol[]> {
  return db.codeSymbols.toArray();
}

/** Delete all symbols for a file */
export async function deleteSymbolsByFile(filePath: string): Promise<void> {
  const ids = await db.codeSymbols.where("filePath").equals(filePath).primaryKeys();
  if (ids.length > 0) await db.codeSymbols.bulkDelete(ids);
}

/** Delete all edges for a file */
export async function deleteEdgesByFile(filePath: string): Promise<void> {
  const fromIds = await db.codeEdges.where("from").startsWith(filePath + "#").primaryKeys();
  const toIds = await db.codeEdges.where("to").startsWith(filePath + "#").primaryKeys();
  const allIds = [...new Set([...fromIds, ...toIds])];
  if (allIds.length > 0) await db.codeEdges.bulkDelete(allIds);
}

/** Get all edges for a repo — uses CodeEdge.repoUrl index */
export async function getEdgesByRepo(repoUrl: string): Promise<CodeEdge[]> {
  return db.codeEdges.where("repoUrl").equals(repoUrl).toArray();
}

/** Save or update wiki doc */
export async function saveWikiDoc(doc: WikiDoc): Promise<void> {
  await db.wikiDocs.put(doc);
}

/** Get wiki doc by id */
export async function getWikiDoc(id: string): Promise<WikiDoc | undefined> {
  return db.wikiDocs.get(id);
}

/** Get all wiki docs for a repo */
export async function getWikiDocsByRepo(repoUrl: string): Promise<WikiDoc[]> {
  return db.wikiDocs.where("repoUrl").equals(repoUrl).toArray();
}

/** Save or update code embedding */
export async function saveCodeEmbedding(embedding: CodeEmbedding): Promise<void> {
  await db.codeEmbeddings.put(embedding);
}

/** Get code embedding by id */
export async function getCodeEmbedding(id: string): Promise<CodeEmbedding | undefined> {
  return db.codeEmbeddings.get(id);
}

/** Delete code embeddings for a file */
export async function deleteCodeEmbeddingsByFile(filePath: string): Promise<void> {
  const ids = await db.codeEmbeddings.where("id").startsWith(filePath + "#").primaryKeys();
  if (ids.length > 0) await db.codeEmbeddings.bulkDelete(ids);
}

/** Delete all code wiki data for a repo */
export async function deleteRepoData(repoUrl: string): Promise<void> {
  const symbolIds = await db.codeSymbols.where("repoUrl").equals(repoUrl).primaryKeys();
  const edgeIds = await db.codeEdges.where("repoUrl").equals(repoUrl).primaryKeys();
  const docIds = await db.wikiDocs.where("repoUrl").equals(repoUrl).primaryKeys();
  const embedIds = await db.codeEmbeddings.where("repoUrl").equals(repoUrl).primaryKeys();
  if (symbolIds.length > 0) await db.codeSymbols.bulkDelete(symbolIds);
  if (edgeIds.length > 0) await db.codeEdges.bulkDelete(edgeIds);
  if (docIds.length > 0) await db.wikiDocs.bulkDelete(docIds);
  if (embedIds.length > 0) await db.codeEmbeddings.bulkDelete(embedIds);
}
