# Code Wiki 设计方案

## 调研总结

参考工具：
- **CodeSee** — Codebase Maps（可视化依赖图）+ Function Maps（函数级追踪）+ CodeSee AI（AI 问答）
- **Sourcegraph** — 精确符号跳转 + 跨仓库语义搜索
- **GitHub Copilot Spaces** — 知识源聚合（docs + repos）
- **Octotree** — 浏览器内代码树导航

## 设计原则

1. **复用现有栈** — Orama（搜索）、Dexie（存储）、SiliconFlow（嵌入+LLM）、Solid.js（UI）
2. **保持分层** — 纯逻辑在 `src/`，浏览器 API 在 `entrypoints/`
3. **增量构建** — 支持 git diff 检测，只更新变更文件
4. **离线优先** — 所有数据本地存储，AI 仅在生成/更新时调用

## 模块设计

### `src/code-graph/` — 代码知识图谱

```
code-graph/
  parser.ts      — acorn + typescript-estree 解析 AST
  graph.ts       — 节点（函数/类/接口/变量）+ 边（调用/继承/导入）
  persist.ts     — Dexie v7 schema: symbols, edges, files
  diff.ts        — git diff 检测变更范围，增量更新图谱
```

**节点类型**：`Function | Class | Interface | TypeAlias | Variable | Export | Import`
**边类型**：`Calls | Extends | Implements | Imports | Exports | References`

### `src/embed-code/` — 代码语义嵌入

```
embed-code/
  chunk.ts       — 代码感知切分（函数/类为最小单元，保留上下文）
  embed.ts       — 复用 `src/embedding.ts` 的 BGE-M3 管线
  index.ts       — Orama schema: code, language, file, symbol, kind, line, vector
```

**切分策略**：
- 函数级 chunk（函数签名 + JSDoc + 前 20 行实现）
- 类级 chunk（类定义 + 公共方法签名）
- 文件级 chunk（import 块 + 导出列表）

### `src/repo-wiki/` — AI 文档生成

```
repo-wiki/
  summarizer.ts  — 按模块批量 LLM 生成摘要
  wiki-builder.ts — 层级化文档（Module → File → Symbol）
  qa.ts          — 基于图的 RAG 问答（图上下文 + 向量检索）
```

**文档层级**：
```
📁 Project Wiki
  📄 Overview（项目总览：技术栈、架构、入口）
  📁 src/
    📄 search-engine.ts（文件级：职责、关键函数、依赖）
    📄 indexer.ts
    📁 components/
      📄 SummarizePanel.tsx
  📁 entrypoints/
    📄 background.ts
```

### `entrypoints/wiki/` — 浏览器内 UI

```
entrypoints/wiki/
  index.html     — 全页面 wiki UI
  index.tsx      — 入口
  components/
    CodeMap.tsx      — D3/SVG 代码依赖图可视化
    SymbolPanel.tsx  — 符号搜索 + 详情面板
    WikiTree.tsx     — 文档树导航
    CodeQA.tsx       — AI 问答侧栏
```

**Omnibox 触发**：`cw <query>`（code wiki 缩写）

## 数据流

```
GitHub Repo URL
    ↓
[background.ts] 检测仓库页面 → 注入 content script
    ↓
[content.ts] 提取文件列表 → sendMessage BUILD_CODE_GRAPH
    ↓
[code-graph/parser.ts] 解析文件 AST
    ↓
[code-graph/graph.ts] 构建节点/边
    ↓
[embed-code/chunk.ts] 代码切分
    ↓
[embed-code/embed.ts] BGE-M3 向量嵌入（批量 API）
    ↓
[search-engine.ts] Orama upsert（code schema）
    ↓
[repo-wiki/summarizer.ts] LLM 生成文档（批量，20 个 symbol/批）
    ↓
[repo-wiki/wiki-builder.ts] 组装层级 wiki → Dexie
    ↓
[wiki UI] 可视化 + 搜索 + 问答
```

## 增量更新

```
git diff --name-only HEAD~1
    ↓
只解析变更文件
    ↓
删除旧节点/边/嵌入
    ↓
插入新节点/边/嵌入
    ↓
标记受影响的上级文档为 dirty → 批量重生成
```

## Dexie Schema v7

```ts
interface CodeSymbol {
  id: string;           // filePath#symbolName
  name: string;
  kind: 'function' | 'class' | 'interface' | 'type' | 'variable';
  filePath: string;
  lineStart: number;
  lineEnd: number;
  signature: string;
  jsdoc: string;
  repoUrl: string;
  branch: string;
}

interface CodeEdge {
  id: string;
  from: string;         // symbol id
  to: string;
  kind: 'calls' | 'extends' | 'implements' | 'imports' | 'references';
}

interface WikiDoc {
  id: string;           // filePath or modulePath
  title: string;
  content: string;      // markdown
  summary: string;      // AI 生成摘要
  symbols: string[];    // 包含的 symbol ids
  repoUrl: string;
  updatedAt: number;
}

interface CodeEmbedding {
  id: string;           // symbol id
  vector: number[];     // 1024-dim
  chunk: string;        // 原始代码片段
}
```

## Orama Schema（code 索引）

```ts
const codeSchema = {
  id: 'string',
  content: 'string',
  language: 'string',
  filePath: 'string',
  symbolName: 'string',
  kind: 'string',
  line: 'number',
  repoUrl: 'string',
} as const;
```

向量维度 1024，与 bookmark 索引分离（`codeSearchEngine` 实例）。

## 消息类型（background.ts 新增）

```ts
type WikiMessage =
  | { action: 'BUILD_CODE_GRAPH'; repoUrl: string; branch?: string }
  | { action: 'GET_CODE_GRAPH'; repoUrl: string }
  | { action: 'SEMANTIC_CODE_SEARCH'; query: string; repoUrl?: string }
  | { action: 'ASK_CODEBASE'; question: string; repoUrl: string }
  | { action: 'GET_SYMBOL_INFO'; symbolId: string }
  | { action: 'GET_WIKI_DOC'; docId: string }
  | { action: 'SYNC_WIKI'; repoUrl: string };  // 增量同步
```

## 与现有功能复用

| 现有模块 | 复用点 |
|---------|--------|
| `src/embedding.ts` | BGE-M3 批量嵌入 API（复用 LRU cache、AbortSignal） |
| `src/search-engine.ts` | Orama 搜索引擎模式（新建 `codeSearchEngine` 实例） |
| `src/llm.ts` | LLM 摘要生成（复用 provider 抽象） |
| `src/rag.ts` | RAG 问答模式（替换数据源为 code embeddings） |
| `src/db.ts` | Dexie schema 迁移（v7） |
| `src/indexer.ts` | 后台队列模式（复用 rate-limit、backoff） |
| `src/i18n/` | UI 国际化 |
| `src/components/ui/` | UI 组件复用 |

## 实现顺序

1. **Phase 1** — `src/code-graph/` 基础解析 + Dexie v7 schema
2. **Phase 2** — `src/embed-code/` 切分 + 嵌入 + Orama 索引
3. **Phase 3** — `src/repo-wiki/` AI 文档生成 + RAG 问答
4. **Phase 4** — `entrypoints/wiki/` UI + omnibox 触发
5. **Phase 5** — 增量更新 + 性能优化

## 风险与缓解

| 风险 | 缓解 |
|-----|------|
| AST 解析大仓库慢 | 增量更新 + worker 线程（WXT content script 可复用） |
| 嵌入 API 成本高 | 本地缓存（Dexie）+ 增量只算变更 |
| LLM 生成文档 token 多 | 分层生成（先模块摘要，按需展开文件） |
| 浏览器存储限制 | 只保留当前仓库图谱，历史仓库可清理 |
| GitHub API 限流 | 复用现有 Octokit 配置，支持 PAT |
