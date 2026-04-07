/**
 * EdgeVec 向量索引封装
 * 使用 HNSW + Binary Quantization 实现高效的向量搜索
 *
 * EdgeVec 使用数字 ID，BookmarkRecord.vectorId 存储映射关系
 */

import init, { EdgeVec, EdgeVecConfig, MetricType } from 'edgevec';
import { db } from './db';
import type { BookmarkRecord } from './types';

const DB_NAME = 'flow-search-vectors';
const DIMENSIONS = 1024;

interface EdgeVecSearchResult {
  id: number;
  score: number;
}

interface SearchResult {
  url: string;
  score: number;
}

interface MemoryPressure {
  level: 'normal' | 'warning' | 'critical';
  usedBytes: number;
  totalBytes: number;
  usagePercent: number;
}

let edgeVec: EdgeVec | null = null;
let initPromise: Promise<EdgeVec> | null = null;
let mapsReady = false;

async function initEdgeVec(): Promise<EdgeVec> {
  if (edgeVec) return edgeVec;

  if (initPromise) return initPromise;

  initPromise = (async () => {
    await init();
    try {
      edgeVec = await EdgeVec.load(DB_NAME);
      console.log('[vectorIndex] Loaded existing EdgeVec database');
    } catch {
      const config = new EdgeVecConfig(DIMENSIONS);
      config.setMetricType(MetricType.Cosine);
      edgeVec = new EdgeVec(config);
      console.log('[vectorIndex] Created new EdgeVec database');
    }
    await rebuildMapsFromDexie();
    mapsReady = true;
    return edgeVec;
  })();

  return initPromise;
}

async function rebuildMapsFromDexie(): Promise<void> {
  if (!edgeVec) return;

  const indexed = await db.bookmarks
    .where('status')
    .equals('indexed')
    .filter(r => r.vectorId !== undefined && r.vectorId > 0)
    .toArray();

  let rebuilt = 0;
  for (const record of indexed) {
    if (record.vectorId && record.url) {
      edgeVec.softDelete(record.vectorId);
      const newId = edgeVec.insertWithMetadata(
        new Float32Array(record.embedding!),
        { url: record.url }
      );
      await db.bookmarks.update(record.id, { vectorId: newId });
      rebuilt++;
    }
  }
  console.log(`[vectorIndex] Rebuilt ${rebuilt} vector mappings from Dexie`);
}

function toFloat32Array(embedding: number[]): Float32Array {
  return new Float32Array(embedding);
}

function getUrlFromMetadata(db: EdgeVec, id: number, fallbackUrl: string): string {
  try {
    const meta = db.getVectorMetadata(id) as any;
    if (meta && meta.url) return meta.url;
  } catch {}
  return fallbackUrl;
}

export async function upsertVector(
  url: string,
  embedding: number[]
): Promise<void> {
  const ev = await initEdgeVec();
  const vector = toFloat32Array(embedding);

  const existing = await db.bookmarks.where('url').equals(url).first();
  if (existing?.vectorId) {
    ev.softDelete(existing.vectorId);
  }

  const id = ev.insertWithMetadata(vector, { url });
  urlToId.set(url, id);
  idToUrl.set(id, url);

  if (existing) {
    await db.bookmarks.update(existing.id, { vectorId: id });
  }
}

export async function bulkUpsertVectors(
  records: Array<{ url: string; embedding: number[] }>
): Promise<void> {
  const ev = await initEdgeVec();
  const updates: Array<{ id: string; vectorId: number }> = [];

  for (const { url, embedding } of records) {
    const existing = await db.bookmarks.where('url').equals(url).first();
    if (existing?.vectorId) {
      ev.softDelete(existing.vectorId);
    }

    const id = ev.insertWithMetadata(toFloat32Array(embedding), { url });
    urlToId.set(url, id);
    idToUrl.set(id, url);

    if (existing) {
      updates.push({ id: existing.id, vectorId: id });
    }
  }

  if (updates.length > 0) {
    await db.transaction('rw', db.bookmarks, async () => {
      for (const { id, vectorId } of updates) {
        await db.bookmarks.update(id, { vectorId });
      }
    });
  }
}

export async function deleteVector(url: string): Promise<void> {
  const ev = await initEdgeVec();
  const id = urlToId.get(url);
  if (id !== undefined) {
    ev.softDelete(id);
    urlToId.delete(url);
    idToUrl.delete(id);

    const existing = await db.bookmarks.where('url').equals(url).first();
    if (existing) {
      await db.bookmarks.update(existing.id, { vectorId: 0 });
    }
  }
}

export async function searchVectors(
  query: number[],
  limit: number = 10
): Promise<SearchResult[]> {
  const ev = await initEdgeVec();
  const queryVec = toFloat32Array(query);
  const results = ev.search(queryVec, limit) as EdgeVecSearchResult[];
  return results
    .map(r => ({
      url: getUrlFromMetadata(ev, r.id, idToUrl.get(r.id) || ''),
      score: r.score,
    }))
    .filter(r => r.url);
}

export async function searchVectorsBQ(
  query: number[],
  limit: number = 10,
  rescoreK: number = 5
): Promise<SearchResult[]> {
  const ev = await initEdgeVec();
  const queryVec = toFloat32Array(query);
  const results = ev.searchBQRescored(queryVec, limit, rescoreK) as EdgeVecSearchResult[];
  return results
    .map(r => ({
      url: getUrlFromMetadata(ev, r.id, idToUrl.get(r.id) || ''),
      score: r.score,
    }))
    .filter(r => r.url);
}

export async function getVectorCount(): Promise<number> {
  const ev = await initEdgeVec();
  return ev.liveCount();
}

export async function getMemoryPressure(): Promise<MemoryPressure> {
  const ev = await initEdgeVec();
  return ev.getMemoryPressure() as MemoryPressure;
}

export async function compact(): Promise<void> {
  const ev = await initEdgeVec();
  if (ev.needsCompaction()) {
    const result = ev.compact();
    console.log(`[vectorIndex] Compacted: removed ${result.tombstones_removed} tombstones`);
  }
}

export async function persist(): Promise<void> {
  const ev = await initEdgeVec();
  await ev.save(DB_NAME);

  if (ev.needsCompaction()) {
    const result = ev.compact();
    console.log(`[vectorIndex] Persist compact: removed ${result.tombstones_removed} tombstones`);
  }
  console.log('[vectorIndex] Persisted to IndexedDB');
}

export async function needsPersist(): Promise<boolean> {
  const ev = await initEdgeVec();
  return ev.needsCompaction();
}

export async function clearAll(): Promise<void> {
  const ev = await initEdgeVec();
  const count = ev.liveCount();
  for (let i = 0; i < count; i++) {
    const results = ev.search(new Float32Array(DIMENSIONS), 1) as EdgeVecSearchResult[];
    if (results.length > 0) {
      ev.softDelete(results[0].id);
    } else {
      break;
    }
  }
  urlToId.clear();
  idToUrl.clear();
  mapsReady = false;

  if (ev.needsCompaction()) {
    ev.compact();
  }

  await db.bookmarks.toCollection().modify({ vectorId: 0 });
}

export async function initializeVectorIndex(): Promise<void> {
  await initEdgeVec();
}

export async function indexBookmarks(
  bookmarks: BookmarkRecord[]
): Promise<void> {
  const ev = await initEdgeVec();
  const updates: Array<{ id: string; vectorId: number }> = [];

  for (const bookmark of bookmarks) {
    if (!bookmark.embedding || bookmark.status !== 'indexed') continue;

    const existing = await db.bookmarks.where('url').equals(bookmark.url).first();
    if (existing?.vectorId) {
      ev.softDelete(existing.vectorId);
    }

    const id = ev.insertWithMetadata(toFloat32Array(bookmark.embedding), {
      url: bookmark.url,
      title: bookmark.title,
    });
    urlToId.set(bookmark.url, id);
    idToUrl.set(id, bookmark.url);

    if (existing) {
      updates.push({ id: existing.id, vectorId: id });
    }
  }

  if (updates.length > 0) {
    await db.transaction('rw', db.bookmarks, async () => {
      for (const { id, vectorId } of updates) {
        await db.bookmarks.update(id, { vectorId });
      }
    });
  }
}

const urlToId = new Map<string, number>();
const idToUrl = new Map<number, string>();
