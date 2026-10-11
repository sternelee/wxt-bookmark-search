# 2026-09-21 迭代记录：Embedding 向量空间校验（修复后端切换静默污染）

## 问题

`embedBackend` 从 `remote` 切到 `local`（或反向）后，存量向量与新查询向量不再处于同一向量空间，但系统没有任何守卫：

1. **零填充掩盖了维度差异**：本地 384 维向量被零填充到 1024，让两种后端"看起来"能共存于同一个 Orama 索引。填充只保证 `local ↔ local` 的余弦相似度不变，`local(384) ↔ remote(1024)` 之间的点积依旧毫无意义。
2. **守卫只覆盖一条路径**：只有「设置页保存」会通过 `isEmbedConfigChanged()` 触发 `REINDEX_STORED_EMBEDDINGS`。云同步导入、跨设备覆盖、直接改 storage 都不会经过这里。
3. **代码向量从未重建**：`reindexStoredEmbeddings()` 只处理 `db.bookmarks`，Code Wiki 的 `db.codeEmbeddings` 与代码 Orama 索引在切换后端后永久停留在旧空间。
4. **索引维度是编译期常量**：`EMBEDDING_VECTOR_DIM = 1024` 同时用于 `search-engine` 和 `embed-code` 的 schema，无法随后端变化。

**表现**：切换后端后搜索"还能用"，但结果静默变差 —— 正是最难被用户发现的那类 bug。

## 改动

### 1. 新增 `src/embedding-space.ts`（纯逻辑，无副作用）

向量空间的一处真相：

- `LOCAL_VECTOR_DIM = 384`、`REMOTE_VECTOR_DIM = 1024`
- `embeddingSpaceId(settings)` → `local:ternlight/mini:384` / `remote:<baseURL>:<model>:1024`
  - 含 `baseURL`：不同服务商的同名模型可能返回完全不同的向量空间
- `getEmbeddingDim(settings)` / `getDimForBackend(backend)` → 当前索引维度
- `isVectorInSpace(vector, settings)` → 本地 384 是硬事实；对远端**不**校验维度（远端模型维度不受控，按维度判定会引入"重建 → 维度仍不匹配 → 再重建"死循环）

### 2. 去掉零填充，索引维度动态化

- `src/embedding.ts`：删除 `padLocalVector()`，本地向量原样返回 384 维。
- `src/search-engine.ts` / `src/embed-code/index.ts`：schema 由 `buildBookmarkSchema(dim)` / `buildCodeSchema(dim)` 生成；`initSearchEngine(dim?)`、`loadSearchEngine(raw, dim?)` 接受维度，`resetSearchEngine(dim?)` 可切换维度；维度不符时 `load` 直接抛错而不是静默加载。
- `src/types.ts`：移除 `EMBEDDING_VECTOR_DIM`，新增 `Settings.embedSpaceFingerprint`。

### 3. 启动期向量空间守卫（`background.ts`）

`runEmbeddingSpaceGuard()` 在 SW 启动时跑一次（`ensureEmbeddingSpace()` 单例 Promise，书签与代码初始化共用）：

| 情形 | 判定 | 动作 |
|---|---|---|
| 首次引入指纹（升级迁移） | `prev === undefined && backend === "local" && 存在非 384 维向量` | 全量重建 |
| 后端 / 服务地址 / 模型变更 | `prev !== space` | 全量重建 |
| 空间一致 | `prev === space` | 仅记录指纹 |

重建动作 = `reindexStoredEmbeddings()`（书签：清空 embedding + 重新入队）+ `reembedAllCodeEmbeddings()`（代码：按持久化的原始 chunk 重新嵌入，**无需重下仓库**，向量表的 `chunk` 字段就是为此保留的）+ 丢弃两侧 Orama 索引与空间指纹。

缺 API Key（远端后端）时跳过校验，保留旧指纹等待下次启动 —— 与 `githubReadmeVersion` 的处理方式一致。

### 4. 运行期切换（设置页保存）

`REINDEX_STORED_EMBEDDINGS` 消息改为调用 `revalidateEmbeddingSpace()`（丢弃缓存的守卫结果后重跑），因此：

- 设置页只需保存设置，书签与代码向量的重建、新维度的内存索引重建都由守卫统一完成；
- `reindexStoredEmbeddings()` 现在会用**新维度**重建空引擎（`clearBookmarkIndexStorage(dim)`），不再出现"新后端向量写进旧维度 schema"。

### 5. 云同步：让向量空间随 blob 走

- `CloudSyncBlob` 新增可选字段 `embedSpace?: string`；`buildSyncBlob()` 写入导出端的空间指纹。
- `importSyncBlob()` 调整顺序：**先合并 settings**（向量空间由设置决定），再决定索引策略。
  - 空间一致 → 快速路径：直接加载 blob 中的 Orama 索引；
  - 空间不一致（或旧版 blob 无该字段）→ 剥离导入记录的 embedding、置为 `pending`，从 Dexie 重建索引，并通过 `enqueueBookmarksForReindex()` 重新入队。
- `ensureSearchEngineReady()` 用当前后端的维度初始化，避免给 local 用户序列化出 1024 维空引擎。

### 6. `embed-code` 查询侧防呆

`semanticCodeSearch()` 现在按 `backend` 校验引擎维度（`ensureCodeSearchEngine(dim)`），防止 SW 启动窗口期内用新后端的查询向量去搜旧维度的索引。

## 兼容性

- **远端后端行为不变**：默认维度仍是 1024，`isVectorInSpace()` 对远端不做维度校验；未配置过 `embedSpaceFingerprint` 的用户首次启动只是"采用当前空间"，不触发重建。
- **本地后端用户**：首次启动检测到零填充遗留向量 → 全量重建（本地推理免费），此后稳定在 384 维。
- **Dexie schema 无变更**（v9 不变），新增的 `embedSpaceFingerprint` / `embedSpace` 都是可选字段。
- **旧版云同步 blob** 仍然可导入（无 `embedSpace` → 按不匹配处理，重建而非混用）。

## 审查后修复

1. **代码向量重建与书签解耦**：守卫原实现中 `records.length === 0` 会提前返回，导致「只用 Code Wiki、没有书签」的用户切换后端后代码向量永不重建（外来向量被 `rebuildCodeIndexFromDb` 过滤 → 索引永久为空）。现将书签与代码向量的重建判定拆为独立的 `rebuildBookmarks` / `rebuildCode`。
2. **移除 `activeBookmarkSpace` / `activeCodeSpace` 缓存**：云同步导入会在 SW 运行期改变设置，缓存的指纹会让 saveFn 给新索引写入过期指纹，导致下次启动误判不匹配、多余全量重建。两个 saveFn 改为每次现算 `embeddingSpaceId(await getSettings())`。
3. **代码重嵌入后台化**：本地后端是串行 CPU 推理，全量重嵌入可能耗时数分钟，原先同步阻塞守卫 → 阻塞书签索引初始化。现改为守卫只 await 书签重建（入队操作，毫秒级），代码重嵌入作为后台 Promise 执行；`initCodeSearchAndPopulate` 等待该 Promise 完成后再加载/重建代码索引。指纹在重嵌入完成后才落盘 —— SW 中途被杀时下次启动守卫幂等重跑；重嵌入期间若设置再次变更，丢弃过期结果避免旧指纹覆盖新指纹。

## 验证

- `pnpm compile` 通过（`tsc --noEmit`）。
- 手动回归清单：
  1. 远端后端 → Omnibox `bi <关键词>` 正常；重启扩展后控制台出现 `Orama index restored from storage`（不重建）。
  2. 设置页切到 `local` → 保存后返回 `queued > 0`，控制台 `Embedding space mismatch (remote:… -> local:ternlight/mini:384)`；`codeEmbeddings` 维度变为 384。
  3. 重新切回 `remote` → 再次重建；数据库 `embedding[].length` 回到 1024。
  4. Code Wiki：切换后端后 `cw` 语义搜索仍返回结果（代码索引未被清空或残留旧空间）。
