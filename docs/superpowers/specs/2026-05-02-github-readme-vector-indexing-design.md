# GitHub Stars README 智能单向量化 — 设计文档

**日期**: 2026-05-02  
**状态**: 已批准，待实施（规格评审 v2）  
**影响文件**: `src/indexer.ts`, `src/types.ts`, `src/db.ts`

---

## 背景与问题

当前 GitHub Stars enrichment 流程中，README 内容仅取前 500 字符作为 `summary` 字段，并用于生成 embedding 向量。BGE-M3 模型支持最多 8192 tokens（约 6000–8000 有效字符），大量语义信息被浪费。

此外，README 通常包含大量 HTML/XML 噪声（badges、SVG、`<details>` 块、带属性标签等），直接输入向量模型会降低语义质量。

---

## 目标

1. 充分利用 BGE-M3 的 8192 token 窗口，将 README 的核心语义内容完整编码进单个向量
2. 在提取前去除 XML/HTML 格式噪声
3. 对已有 GitHub Stars 记录自动触发重新索引，无需用户手动操作

---

## 设计

### 1. XML/HTML 净化层：`sanitizeReadme(raw: string): string`

新增纯函数，在 Markdown 结构解析之前运行，**保留 Markdown 语法，仅去除 XML/HTML 噪声**。

裁剪顺序：

| 步骤 | 处理内容 | 原因 |
|------|---------|------|
| 1 | HTML 注释 `<!-- ... -->` | badge 配置、隐藏元数据，无语义 |
| 2 | SVG 整块 `<svg>...</svg>` | 图标/图表 XML 原始数据 |
| 3 | `<details>` / `<summary>` 块 | 折叠内容，结构混乱 |
| 4 | 带布局属性的 HTML 标签（`align`, `width`, `height`, `style`, `class`）→ 剥离标签保留内文 | 排版属性无语义 |
| 5 | 所有剩余 HTML/XML 标签 → 保留内文 | 通用清理 |
| 6 | Badge 图片链接 `[![...](img)](url)` | 纯装饰，语义为零 |
| 7 | 纯 URL 行（行内容仅为 URL） | 裸链接无上下文描述 |

与现有 `stripMarkdownToPlainText` 的关系：两者职责不同。`sanitizeReadme` 在结构解析前运行，保留 Markdown 语法；`stripMarkdownToPlainText` 在最终输出时运行，做全量净化。

---

### 2. 结构化区域提取：`extractReadmeSemanticContent(readme: string): string`

新增函数，对 `sanitizeReadme` 输出进行结构化解析和优先级提取。

**流程**：
```
sanitizeReadme(readme)
  → 按 H2/H3 划分 section 边界
  → 对每个 section 的标题做语义分类
  → 按配额优先填充各类型区域
  → 拼装结构化 embedding 文档（纯文本标签）
```

**配额分配（总上限 7500 字符）**：

| 区域 | 配额 | 识别关键词（不区分大小写） |
|------|------|--------------------------|
| 仓库描述行（title + description） | 200 | — |
| H2/H3 标题汇总 | 400 | 全部标题 |
| 项目简介（H1 下首段落，到第一个 H2 之前） | 1500 | — |
| Features 区域 | 1500 | features, 功能, 特性, highlights, what's included, capabilities |
| Use Cases / 应用场景 | 1000 | use cases, use-case, scenarios, 使用场景, 应用场景, who uses, motivation |
| Quick Start（跳过代码块） | 600 | quick start, getting started, 快速开始, installation, install, 安装, setup |
| 高密度正文兜底（行长 > 30 chars） | 剩余 | 按原文顺序填充 |

**代码块处理**：所有区域提取均跳过 fenced code block（`` ``` ``），避免命令行、API 签名等代码污染语义向量。

**平铺 README 兜底**（无任何 H2/H3 的情况）：若解析后无任何具名 section，则直接将 `sanitizeReadme` 输出经 `stripMarkdownToPlainText` 净化后取前 7500 字符，不使用结构化标签。

**输出格式示例**：
```
Title: owner/repo
Description: A fast HTTP router for Go (Language: Go)
Sections: Installation, Features, Examples, Benchmarks
Overview: [首段简介文本]
Features: [特性列表文本]
Use Cases: [使用场景文本]
Quick Start: [快速入门文本（无代码）]
Content: [兜底填充文本]
```

---

### 3. Enrichment 队列逻辑升级

修改 `processEnrichmentQueue()` 中对 README 的处理（`indexer.ts:330–381`）：

```typescript
// 旧逻辑
const plainText = stripMarkdownToPlainText(readme);
let summary = plainText.slice(0, 500);

// 新逻辑
const semanticContent = extractReadmeSemanticContent(readme);
const plainText = stripMarkdownToPlainText(readme);
const summary = plainText.slice(0, 800);  // DB 展示 + 关键词搜索用

// 直接构建 embedding 输入文本，不通过 buildEmbeddingText（避免 "Summary:" 标签重复嵌套）
const textToEmbed = semanticContent.slice(0, 8000);
```

然后直接调用 `getEmbedding(textToEmbed, ...)` 而非先调用 `buildEmbeddingText`。

**与 LLM enrichment 路径的协调**：当 `enableLLMEnrichment` 为 true 时：
- `summary` 字段使用 LLM 生成的摘要（供 UI 展示，保持短文本语义质量）
- `textToEmbed` 仍使用 `semanticContent`（保证完整 README 语义进入向量）
- LLM 路径不再覆盖 `textToEmbed`，仅覆盖 `summary` 和 `tags`

```typescript
// LLM 分支更新后的结构
let summary = plainText.slice(0, 800);
let tags: string[] = [];
let llmEnhanced = false;
const semanticContent = extractReadmeSemanticContent(readme);

if (settings.enableLLMEnrichment && plainText.length > 100) {
  try {
    const provider = getLLMProvider();
    if (provider) {
      const llmResult = await provider.generateDeepContent(plainText.slice(0, 4000));
      summary = llmResult.summary;   // ← 展示用摘要来自 LLM
      tags = llmResult.tags;
      llmEnhanced = true;
    }
  } catch { /* 降级：使用原始摘要 */ }
}

// embedding 始终使用 semanticContent（与 LLM 开关无关）
const textToEmbed = semanticContent.slice(0, 8000);
const { embedding } = await getEmbedding(textToEmbed, settings.openaiApiKey!, ...);
```

---

### 4. Settings 版本控制 + 自动重建

#### `src/types.ts`

新增字段：
```typescript
interface Settings {
  // ... 现有字段
  githubReadmeVersion?: number;  // README 向量化版本号，当前目标值 = 1
}
```

#### `src/db.ts`

在 `defaultSettings` 中设置 `githubReadmeVersion: 0`。

#### `src/indexer.ts` — `initIndexer()` 插入位置

在现有代码的 **`restoreEnrichmentQueue()` 调用之后、`processEnrichmentQueue()` 调用之前** 插入（即 `indexer.ts:1417` 和 `indexer.ts:1452` 之间）：

```typescript
const CURRENT_README_VERSION = 1;

// 仅在 githubToken 存在时才做重建（无 token 无法拉 README，跳过并保留版本为旧值）
if (settings.githubToken && (settings.githubReadmeVersion ?? 0) < CURRENT_README_VERSION) {
  const githubRecords = await db.bookmarks
    .filter(r => r.source === 'github' && r.status === 'indexed')
    .toArray();

  let added = 0;
  for (const record of githubRecords) {
    if (enrichmentQueue.some(j => j.bookmarkId === record.id)) continue;
    const match = record.url.match(/github\.com\/([^/]+)\/([^/?#]+)/);
    if (match) {
      enrichmentQueue.push({
        bookmarkId: record.id,
        url: record.url,
        owner: match[1],
        repo: match[2].replace(/\/$/, ""),  // 与 fetchPageContent 保持一致
        token: settings.githubToken,
      });
      added++;
    }
  }

  if (added > 0) {
    await persistEnrichmentQueue();
    console.log(`[indexer] Queued ${added} GitHub repos for README re-indexing (v${CURRENT_README_VERSION})`);
  }

  // 仅在 token 存在时推进版本（无 token 情况下保留旧版本，等待下次启动时重试）
  await saveSettings({ githubReadmeVersion: CURRENT_README_VERSION });
}
// 注意：processEnrichmentQueue() 的现有调用（indexer.ts:1452）会自动处理新加入的队列
// isEnriching 守卫确保不会重复启动
```

---

## 不变的部分

- `BookmarkRecord` 数据库 schema 无变更（不增加新字段或新表）
- 快速路径（`syncGithubStars` 中的 `batchEmbedTexts`）不变，仍用 description + language 快速建立初始向量
- 搜索逻辑（`hybrid.ts`, `vector.ts`）无变更
- `fetchRepoReadme` 无变更

---

## 验证标准

1. `pnpm compile` 零错误
2. `extractReadmeSemanticContent` 对典型 README（有 badge、SVG、Features section）输出：无 XML 标签、无 badge 链接、标题汇总存在、Features 内容正确提取
3. `sanitizeReadme` 对含 `<details>` 和 `<!-- comment -->` 的输入正确清除
4. `processEnrichmentQueue` 对一个已有 repo 触发后，DB 中该记录的 `summary` 更新为新摘要（>500 chars），且 `embedding` 维度不变
5. 重启扩展后，`githubReadmeVersion` 为 1，不重复触发重建队列
6. 无 GitHub Token 时，版本保持 0，下次配置 Token 后重启可正常触发重建
7. 平铺 README（无 H2/H3）不崩溃，输出不为空
