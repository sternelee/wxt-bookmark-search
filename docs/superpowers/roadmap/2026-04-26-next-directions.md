# Flow Search 后续方向（2026-04-26）

基于当前代码审计和最近一轮优化（`ed493be`），以下是按优先级排序的下一步候选。

---

## A. 搜索排序与发现体验

| 方向 | 描述 | 预估复杂度 |
|------|------|-----------|
| **空查询默认推荐** | Omnibox 空查询时，当前仅展示最近访问。可改为"高频 + 最近索引 + 近期新增"的混合推荐，让新加书签也能被主动发现。 | Low |
| **域名/来源分组** | 搜索结果按域名（如 `github.com`、`twitter.com`）折叠分组，减少视觉噪音。 | Medium |
| **搜索历史本地缓存** | Popup / 全页搜索记录最近 20 条查询，下拉时优先展示，减少重复输入。 | Low |
| **多关键词高亮** | `highlight.ts` 当前仅高亮连续匹配，支持对多词查询中的每个词分别 `<match>` 包裹。 | Low |

---

## B. UI / 交互增强

| 方向 | 描述 | 预估复杂度 |
|------|------|-----------|
| **全局快捷键 `Cmd/Ctrl+Shift+K`** | 注册浏览器命令快捷键，一键打开全页搜索或聚焦 Omnibox。 | Medium |
| **搜索结果预览卡片** | 鼠标悬停结果时展开右侧/浮层预览（标题、摘要、标签、缩略图）。 | Medium |
| **Popup 索引状态指示器** | 在 Popup 顶部增加小进度条，实时显示后台索引队列状态（无需打开设置页）。 | Low |
| **深色模式跟随系统** | 检测 `prefers-color-scheme`，动态切换 Tailwind dark variant。 | Low |

---

## C. 新数据源与同步

| 方向 | 描述 | 预估复杂度 |
|------|------|-----------|
| **Pocket 同步** | 新增 Pocket API 设置项，拉取用户的 Pocket 文章并生成向量索引。 | Medium |
| **Raindrop.io 同步** | 类似 GitHub Stars 的快速路径：Raindrop API 拉取收藏并批量 embed。 | Medium |
| **Notion 数据库同步** | 允许用户绑定 Notion Integration Token + Database ID，同步页面为书签记录。 | High |
| **本地 Markdown/阅读列表导入** | 支持上传 `.html` / `.md` 文件或从 Chrome Reading List 导入。 | Low |

---

## D. P1+ 性能与架构

| 方向 | 描述 | 预估复杂度 |
|------|------|-----------|
| **Embedding 缓存大小可配置** | 当前 LRU 缓存固定 100 条。加入设置项让用户根据内存情况调节（50-500）。 | Low |
| **Web Worker  offload 向量计算** | Service Worker 中做点积会阻塞事件循环。将 `rankBySimilarity` 移到 Web Worker，通过 `postMessage` 传查询向量和候选子集。 | Medium |
| **搜索结果内存缓存** | 对最近 10 个查询的结果做短暂缓存（30s），避免用户在 Omnibox 快速回退/重复输入时重复计算。 | Low |
| **向量索引压缩 / 降维** | 调研 PCA 或 Scalar Quantization 将 1024 维 Float32 向量压缩到 256 维 Byte/Int8，降低内存占用和计算量。 | High |
| **增量向量索引结构** | 当前是内存数组线性扫描（`O(n)` 点积）。当书签量 > 5000 时，可引入 HNSW 或 IVF 等近似最近邻索引结构（EdgeVec 或纯 JS HNSW）。 | High |

---

## 建议的下一批执行顺序

1. **空查询默认推荐**（Low，用户打开 Omnibox 时的第一眼体验）
2. **Popup 索引状态指示器**（Low，完善 Popup 的信息密度）
3. **Embedding 缓存可配置**（Low，给用户更多控制权）
4. **Web Worker offload 向量计算**（Medium，Service Worker 长期健康的关键）
5. **Pocket / Raindrop 同步**（Medium，扩展数据源，建立差异化优势）

---

*文档生成时间：2026-04-26*
*关联 Commit：`ed493be`*
