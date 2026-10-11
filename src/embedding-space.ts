/**
 * Embedding 向量空间标识 — 判断存量向量是否与当前后端匹配
 *
 * local (on-device, @ternlight/mini) 与 remote (HTTP API) 是两个**互不兼容**的
 * 向量空间：维度不同、语义空间也不同。任何持久化的向量（Orama 索引、Dexie
 * 记录）都必须与产生它的空间绑定，否则查询向量会与文档向量做无意义的余弦
 * 相似度 —— 搜索「还能用」，但结果静默变差。
 *
 * 判定规则（不对远程模型维度做任何假设，保持既有行为）：
 * - 本地后端的向量一定是 384 维
 * - 384 维向量对远程后端而言一定是外来向量（本地后端产生的）
 * - 远程模型的维度（1024 / 1536 / …）不做校验，与修复前一致
 */
import type { Settings } from "./types";
import { resolveEmbedConfig } from "./service-config";

/** 本地 on-device 引擎维度（由 @ternlight/mini 硬编码） */
export const LOCAL_VECTOR_DIM = 384;

/** 远程 API 默认索引维度（BGE-M3 等 1024 维模型） */
export const REMOTE_VECTOR_DIM = 1024;

/** 本地引擎在向量空间指纹中的模型标签（与 embedding-local 的 LOCAL_MODEL_NAME 一致） */
export const LOCAL_SPACE_MODEL = "ternlight/mini";

/** 后端对应的向量维度（供只有 backend 信息、拿不到 Settings 的调用方使用） */
export function getDimForBackend(backend: "local" | "remote"): number {
  return backend === "local" ? LOCAL_VECTOR_DIM : REMOTE_VECTOR_DIM;
}

/** 当前设置对应的向量维度（Orama schema 使用） */
export function getEmbeddingDim(settings: Settings): number {
  return getDimForBackend(resolveEmbedConfig(settings).backend);
}

/**
 * 当前设置对应的向量空间指纹（后端 + 服务地址 + 模型 + 维度）。
 *
 * 包含 baseURL 是因为不同服务对同名模型可能返回完全不同的向量空间，
 * 这也是切换服务商时必须重建向量的原因。
 */
export function embeddingSpaceId(settings: Settings): string {
  const cfg = resolveEmbedConfig(settings);
  if (cfg.backend === "local") {
    return `local:${LOCAL_SPACE_MODEL}:${LOCAL_VECTOR_DIM}`;
  }
  return `remote:${cfg.baseURL}:${cfg.model || "default"}:${REMOTE_VECTOR_DIM}`;
}

/** 判断一条已持久化向量是否属于当前向量空间 */
export function isVectorInSpace(
  vector: number[] | undefined,
  settings: Settings,
): boolean {
  if (!vector || vector.length === 0) return false;
  const isLocal = resolveEmbedConfig(settings).backend === "local";
  return isLocal
    ? vector.length === LOCAL_VECTOR_DIM
    : vector.length !== LOCAL_VECTOR_DIM;
}
