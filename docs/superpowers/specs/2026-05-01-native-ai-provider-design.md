# Native AI Provider 混合本地化 — 设计文档

## 概述

将书签的 AI 摘要/标签生成从纯远程 API（SiliconFlow DeepSeek-V3）迁移到 Chrome 内置 AI API（Prompt API / Summarizer API），Firefox 降级到远程 API。Embedding 向量搜索和内容提取保持不变。

## 决策记录

| 决策 | 结论 | 原因 |
|------|------|------|
| 方案 | 混合：Chrome 内置 AI 优先，远程降级 | 用户选择 |
| 本地化范围 | 仅 LLM 摘要/标签 | Chrome 无内置 Embedding API |
| 平台策略 | Chrome 优先，Firefox 降级 | Chrome 内置 API 仅限 Chrome |
| Embedding | 保留远程 SiliconFlow | 用户选择 |
| 内容提取 | 保持 Jina AI Reader 不变 | 已免费，性能好 |

## 架构

### Provider 抽象层 (`src/ai-providers/`)

```
src/ai-providers/
├── types.ts              # 统一接口定义
├── detect.ts             # Chrome AI 能力检测
├── llm/
│   ├── base.ts           # LLMProvider 接口 + 工厂函数
│   ├── chrome-prompt.ts  # Chrome Prompt API 实现
│   └── remote-openai.ts  # 远程 OpenAI-compatible（现有 src/llm.ts 重构）
├── embedding/
│   ├── base.ts           # EmbeddingProvider 接口 + 工厂函数
│   └── remote-openai.ts  # 远程 OpenAI-compatible（现有 src/embedding.ts 重构）
└── content/
    └── jina.ts           # Jina AI Reader 封装
```

### 核心接口

```ts
// src/ai-providers/types.ts

type AIProviderCapability = "llm" | "embedding" | "content";

interface AIProvider {
  readonly name: string;
  readonly capability: AIProviderCapability;
  readonly available: boolean;
  /** 一次性初始化（模型下载等），返回可用性 */
  initialize?(): Promise<boolean>;
}

interface LLMProvider extends AIProvider {
  capability: "llm";
  generateSummary(params: {
    url: string;
    title: string;
    content: string;
    signal?: AbortSignal;
  }): Promise<{ summary: string; tags: string[] }>;
}

interface EmbeddingProvider extends AIProvider {
  capability: "embedding";
  getEmbeddings(texts: string[], signal?: AbortSignal): Promise<number[][]>;
  getModelInfo(): { model: string; dimensions: number };
}

interface ContentProvider extends AIProvider {
  capability: "content";
  extractContent(url: string, signal?: AbortSignal): Promise<{ title: string; content: string; textContent: string }>;
}
```

### Provider 选择逻辑

```
启动 (background.ts)
  │
  ├─ 检测 chrome.aiOriginTrial?.languageModel
  │    ├─ 可用 → LLM = ChromePromptProvider
  │    └─ 不可用 → 检查 Settings.apiKey
  │         ├─ 有 → LLM = RemoteOpenAIProvider
  │         └─ 无 → LLM = null（禁用摘要功能）
  │
  ├─ Embedding → 始终使用 Settings.apiKey → RemoteEmbeddingProvider
  │
  └─ Content → 始终使用 JinaProvider（免费）
```

用户可在 Options 页面手动切换 LLM provider（Chrome AI / Remote / 禁用）。

## 变更清单

### 新增文件

| 文件 | 职责 |
|------|------|
| `src/ai-providers/types.ts` | `AIProvider`, `LLMProvider`, `EmbeddingProvider`, `ContentProvider` 接口 |
| `src/ai-providers/detect.ts` | `detectChromeAI()` — 检测 Chrome AI API 可用性 + 模型能力 |
| `src/ai-providers/llm/base.ts` | `createLLMProvider()` 工厂函数 + 统一调用接口 |
| `src/ai-providers/llm/chrome-prompt.ts` | `ChromePromptProvider` — 使用 `chrome.aiOriginTrial.languageModel` |
| `src/ai-providers/llm/remote-openai.ts` | `RemoteOpenAIProvider` — 重构自现有 `src/llm.ts` |
| `src/ai-providers/embedding/base.ts` | `createEmbeddingProvider()` 工厂函数 |
| `src/ai-providers/embedding/remote-openai.ts` | `RemoteEmbeddingProvider` — 重构自现有 `src/embedding.ts` |
| `src/ai-providers/content/jina.ts` | `JinaProvider` — 封装 Jina AI Reader 调用 |

### 修改文件

| 文件 | 变更 |
|------|------|
| `src/types.ts` | 新增 `AIProviderType` 枚举 (`"chrome" | "remote" | "disabled"`)；`Settings` 添加 `aiProvider?: AIProviderType` |
| `src/db.ts` | Dexie 版本升级至 v5，新增 `aiProvider` 字段 migration；`defaultSettings` 添加默认值 |
| `src/llm.ts` | 重构为薄适配器，委托给 `LLMProvider` |
| `src/embedding.ts` | 同上，委托给 `EmbeddingProvider` |
| `entrypoints/background.ts` | 启动时初始化 AI providers；消息路由传递 provider 实例 |
| `wxt.config.ts` | `permissions` 添加 `"aiLanguageModel"` origin trial token 配置 |
| `entrypoints/options/components/APISettings.tsx` | 新增 "AI Provider" 下拉选择（Chrome AI / Remote / 禁用） |
| `src/i18n/locales/*.ts` | 新增相关 i18n keys |

### 不变文件

- `src/indexer.ts` — 索引流程不变，通过 `LLMProvider` 接口调用
- `src/hybrid.ts` — RRF 混合搜索逻辑不变
- `src/search.ts` — 关键词搜索不变
- `src/vector.ts` — 向量工具函数不变
- `src/freq.ts` — 访问频率不变
- `src/highlight.ts` — omnibox 高亮不变
- 所有 UI 页面组件（popup/search）— 无需改动

## Chrome Prompt API 集成细节

### API 检测

```ts
// src/ai-providers/detect.ts
async function detectChromeAI(): Promise<{
  available: boolean;
  capabilities?: AILanguageModelCapabilities;
}> {
  if (!("aiOriginTrial" in chrome)) return { available: false };
  try {
    const caps = await chrome.aiOriginTrial.languageModel.capabilities();
    return {
      available: caps.available !== "no",
      capabilities: caps,
    };
  } catch {
    return { available: false };
  }
}
```

### 摘要生成 Prompt

```ts
const SUMMARY_PROMPT = `Analyze the following webpage and return a JSON object with:
1. "summary": A concise 1-2 sentence summary in the original language
2. "tags": An array of 3-5 relevant tags/keywords

URL: {url}
Title: {title}
Content: {content}

Return ONLY valid JSON, no markdown formatting.`;
```

### 模型配置

- `temperature: 0.3` — 低温度保证摘要一致性
- `topK: 1` — 确定性输出
- 响应解析：从 Prompt API 文本响应中提取 JSON

## 向后兼容

1. **Settings 迁移**：`aiProvider` 字段不存在时默认 `"remote"`，保持现有行为
2. **API Key 仍然必需**：Embedding 继续使用 SiliconFlow，即使 LLM 已本地化
3. **现有数据不变**：`BookmarkRecord.summary`、`BookmarkRecord.tags`、`BookmarkRecord.llmEnhanced` 字段不变
4. **索引器不变**：`indexer.ts` 调用 `generateBookmarkSummary()` 接口，签名不变

## 风险与缓解

| 风险 | 缓解 |
|------|------|
| Chrome AI API 仍在 Origin Trial，可能变更 | 通过抽象层隔离，API 变更只影响 `chrome-prompt.ts` |
| Gemini Nano 模型下载大小（~2-3GB）及首次下载体验 | 在 Options UI 显示下载状态；提供手动切换回 remote 的选项 |
| Prompt API 输出格式不稳定（不总是返回有效 JSON） | 添加 JSON 解析重试逻辑 + 格式清洗；失败时静默降级（无摘要） |
| Firefox 用户始终走远程 API | 明确在 Options 中标注 "Chrome AI 不可用" |
| Service Worker 中调用 Prompt API 可能超时 | 使用 AbortSignal + 合理超时（30s） |

## 测试要点

1. Chrome ≥131 开启 Origin Trial → AI 摘要使用本地模型
2. Firefox / Chrome 无 trial → 降级到远程 API
3. 远程 API Key 未配置但本地 AI 可用 → 摘要正常
4. 两者都不可用 → 摘要功能静默禁用，不影响搜索
5. Settings 中手动切换 provider → 立即生效
6. Prompt API 返回非标准 JSON → 优雅降级
