/**
 * Code embedding pipeline — 复用 batchEmbedTexts + Dexie 缓存
 */
import type { CodeChunk, CodeEmbedding } from "../types";
import { batchEmbedTexts } from "../embedding";
import { db } from "../db";

/**
 * 为代码块生成嵌入向量
 *
 * 复用 `src/embedding.ts` 的 `batchEmbedTexts`，自动处理缓存和分批。
 * SiliconFlow BGE-M3 是纯文档检索模型，**不**需要 "Represent this..." 指令前缀。
 *
 * @param chunks - 代码块列表
 * @param apiKey - SiliconFlow API key
 * @param baseURL - API 基础 URL（可选，默认 OpenAI 兼容端点）
 * @param model - embedding 模型（可选，默认 text-embedding-3-small）
 * @returns CodeEmbedding[]
 */
export async function embedChunks(
  chunks: CodeChunk[],
  apiKey: string,
  baseURL?: string,
  model?: string,
): Promise<CodeEmbedding[]> {
  // BGE-M3 不使用指令前缀。直接将代码内容截断到 4000 字符喂入。
  const texts = chunks.map((c) => c.content.slice(0, 4000));
  const vectors = await batchEmbedTexts(texts, apiKey, model, baseURL);
  const embeddings: CodeEmbedding[] = [];
  for (let i = 0; i < chunks.length; i++) {
    embeddings.push({
      id: chunks[i].id,
      vector: vectors[i] ?? [],
      chunk: chunks[i].content,
      repoUrl: chunks[i].repoUrl,
    });
  }
  return embeddings;
}

/**
 * 保存代码嵌入到 Dexie（codeEmbeddings 表）
 *
 * @param embeddings - 要保存的嵌入记录
 */
export async function saveCodeEmbedding(
  embeddings: CodeEmbedding[],
): Promise<void> {
  if (embeddings.length === 0) return;
  await db.codeEmbeddings.bulkPut(embeddings);
}

/**
 * 从 Dexie 读取代码嵌入
 *
 * @param ids - 要查询的 symbol id 列表
 * @returns 命中的 CodeEmbedding 列表
 */
export async function getCodeEmbeddings(
  ids: string[],
): Promise<CodeEmbedding[]> {
  if (ids.length === 0) return [];
  const records = await db.codeEmbeddings.bulkGet(ids);
  return records.filter(Boolean) as CodeEmbedding[];
}

/**
 * 删除指定仓库的代码嵌入
 *
 * @param repoUrl - 仓库 URL 前缀匹配
 */
export async function deleteCodeEmbeddingsByRepo(repoUrl: string): Promise<void> {
  const all = await db.codeEmbeddings.toArray();
  const toDelete = all.filter((e) => e.repoUrl === repoUrl).map((e) => e.id);
  if (toDelete.length > 0) {
    await db.codeEmbeddings.bulkDelete(toDelete);
  }
}

/**
 * 删除指定文件路径的代码嵌入（增量同步用）
 *
 * @param filePath - 文件路径
 */
export async function deleteCodeEmbeddingsByFile(filePath: string): Promise<void> {
  const prefix = `${filePath}#`;
  const all = await db.codeEmbeddings.toArray();
  const toDelete = all.filter((e) => e.id.startsWith(prefix)).map((e) => e.id);
  if (toDelete.length > 0) {
    await db.codeEmbeddings.bulkDelete(toDelete);
  }
}
