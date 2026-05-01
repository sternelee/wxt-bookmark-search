# Native AI Provider 混合本地化 — 设计文档

## 概述

将书签的 AI 摘要/标签生成从纯远程 API（SiliconFlow DeepSeek-V3）迁移到 Chrome 内置 AI API（Prompt API / Summarizer API），Firefox 降级到远程 API。Embedding 向量搜索和内容提取保持不变。

## 决策记录

| 决策 | 结论 | 原因 |
|------|------|------|
| 方案 | 混合：Chrome 内置 AI 优先，远程降级 | 用户选择 |
| 本地化范围 | 仅 LLM 摘要/标签 | Chrome 无内置 Embedding API |
| 平台策略 | Chrome 优先，Firefox 降级 | Chrome 内置 API 仅限 Chrome |
| Embedding | 保留远程 SiliconFlow，**不抽象** | 用户选择；单一实现无需抽象层 |
| 内容提取 | 保持 Jina AI Reader 不变，**不抽象** | 已免费；单一实现无需抽象层 |

## 架构

### Provider 抽象层 (`src/ai-providers/`)

仅抽象 LLM 层（Embedding 和 Content 单一实现，无需抽象）：

```
src/ai-providers/
├── types.ts              # LLMProvider 接口定义
├── detect.ts             # Chrome AI 能力检测
├── llm-base.ts           # createLLMProvider() 工厂函数 + 全局 setter/getter
├── llm-chrome.ts         # Chrome Prompt API 实现
└── llm-remote.ts         # 远程 OpenAI-compatible（从现有 src/llm.ts 提取核心逻辑）
```

注：不创建 `embedding/` 和 `content/` 子目录 — 单一实现抽象是过度工程。

### 核心接口

```ts
// src/ai-providers/types.ts

/** LLM 返回结果 — 与现有 AIResult 接口兼容 */
export interface LLMResult {
  summary: string;
  tags: string[];
}

/** LLM Provider — 统一接口 */
export interface LLMProvider {
  readonly name: string;
  readonly available: boolean;
  /** 销毁会话资源（Chrome Prompt API 专属，Remote 为 no-op） */
  destroy(): void;
  /** 生成摘要和标签 */
  generateDeepContent(
    text: string,
    signal?: AbortSignal,
  ): Promise<LLMResult>;
}

export type LLMProviderType = "chrome" | "remote" | "disabled";
```

**命名说明：** `generateDeepContent` 与现有 `src/llm.ts` 中的函数名一致，`indexer.ts` 无需修改调用代码（仅需 import 路径变更）。

### 与现有 `enableLLMEnrichment` 的关系

| `enableLLMEnrichment` | `aiProvider` | 行为 |
|----------------------|-------------|------|
| `false` | 任意 | **LLM 增强完全禁用** — `enableLLMEnrichment` 最高优先级 |
| `true` | `"chrome"` | 使用 Chrome Prompt API |
| `true` | `"remote"` | 使用远程 SiliconFlow API |
| `true` | `"disabled"` | 等同于 `enableLLMEnrichment: false` |
| `true` | 未设置（迁移默认） | `"remote"`（向后兼容） |

`indexer.ts:771` 处现有检查逻辑不变：先检查 `enableLLMEnrichment`，再调用 `generateDeepContent()`。

### Provider 选择逻辑

```
启动 (background.ts)
  │
  ├─ 检测 chrome.aiOriginTrial?.languageModel.capabilities()
  │    ├─ available !== "no" → 创建 ChromeLLMProvider
  │    └─ 不可用 → 检查 Settings.openaiApiKey
  │         ├─ 有 → 创建 RemoteLLMProvider
  │         └─ 无 → LLM 不可用
  │
  ├─ 将 provider 实例注入全局 setter → setLLMProvider(instance)
  │
  └─ llm-base.ts 导出 getLLMProvider()，indexer.ts 通过它获取实例
```

### 依赖注入策略

使用模块级单例模式，避免修改 `indexer.ts` 的 import 结构：

```ts
// src/ai-providers/llm-base.ts

let _provider: LLMProvider | null = null;

/** background.ts 启动时调用 */
export function setLLMProvider(provider: LLMProvider): void {
  _provider?.destroy();
  _provider = provider;
}

/** indexer.ts 调用前获取 */
export function getLLMProvider(): LLMProvider | null {
  return _provider;
}
```

`indexer.ts:776` 处修改：

```ts
// 旧代码：
const llmResult = await generateDeepContent(content.markdown.slice(0, 4000), settings.openaiApiKey!, settings.llmModel, settings.baseURL);

// 新代码：
const provider = getLLMProvider();
if (provider) {
  const llmResult = await provider.generateDeepContent(content.markdown.slice(0, 4000));
  // ...
}
```

## 变更清单

### 新增文件（共 5 个）

| 文件 | 职责 |
|------|------|
| `src/ai-providers/types.ts` | `LLMResult`、`LLMProvider`、`LLMProviderType` 接口 |
| `src/ai-providers/detect.ts` | `detectChromeAI()` — 检测 Chrome AI API 可用性 + 模型能力 |
| `src/ai-providers/llm-base.ts` | `setLLMProvider()` / `getLLMProvider()` 全局单例 + 工厂函数 |
| `src/ai-providers/llm-chrome.ts` | `ChromeLLMProvider` — 使用 `chrome.aiOriginTrial.languageModel` |
| `src/ai-providers/llm-remote.ts` | `RemoteLLMProvider` — 从现有 `src/llm.ts` 提取核心 fetch 逻辑 |

### 修改文件（共 8 个）

| 文件 | 变更 |
|------|------|
| `src/types.ts` | 新增 `LLMProviderType` 类型；`Settings` 添加 `aiProvider?: LLMProviderType` |
| `src/db.ts` | Dexie v4→v5，新增 `aiProvider: "remote"` 迁移；`defaultSettings.aiProvider = "remote"` |
| `src/llm.ts` | 重导出 `LLMResult`；标记 `generateDeepContent` 为 `@deprecated`，内部委托新 provider（过渡期） |
| `src/embedding.ts` | 不变 |
| `src/indexer.ts` | 修改 import：`generateDeepContent` → `getLLMProvider`；修改调用方式，移除 `apiKey/model/baseURL` 参数 |
| `entrypoints/background.ts` | 启动时调用 `detectChromeAI()` + `setLLMProvider()`；监听 Settings 变更重新创建 provider |
| `wxt.config.ts` | 新增 `manifest.trial_tokens` 配置（见下文） |
| `entrypoints/options/components/APISettings.tsx` | 新增 "AI 摘要提供者" 下拉选择（Chrome AI / Remote / 禁用） |
| `src/i18n/locales/*.ts` | 新增 `aiProvider`、`aiProviderChrome`、`aiProviderRemote`、`aiProviderDisabled` 等 i18n keys |

### 不变文件

- `src/hybrid.ts` — RRF 混合搜索逻辑不变
- `src/search.ts` — 关键词搜索不变
- `src/vector.ts` — 向量工具函数不变
- `src/freq.ts` — 访问频率不变
- `src/highlight.ts` — omnibox 高亮不变
- `src/embedding.ts` — 无变更
- 所有 UI 页面组件（popup/search）— 无需改动

## Chrome Prompt API 集成细节

### Origin Trial 配置

**注意：** Chrome AI API 使用 Origin Trial 机制，配置时使用 `trial_tokens` manifest key，**不是** `permissions`：

```ts
// wxt.config.ts
export default defineConfig({
  manifest: {
    trial_tokens: [
      {
        token: process.env.CHROME_AI_TRIAL_TOKEN,
        // 注意：origin 应为 "chrome-extension://<extension-id>"，具体值由 Chrome 在注册时确定
      },
    ],
  },
});
```

Origin Trial token 通过环境变量 `CHROME_AI_TRIAL_TOKEN` 注入，构建时嵌入 manifest。

### 约定例外：使用 `chrome.aiOriginTrial` 而非 `browser.*`

AGENTS.md 规定 entrypoints 中始终使用 `browser.*`。但 `chrome.aiOriginTrial` 是 Chrome 专属实验性 API，WXT 的 `browser.*` polyfill **不包含此命名空间**。因此 `detect.ts` 和 `llm-chrome.ts` 中必须直接使用 `chrome.aiOriginTrial`。这是经过评审的例外，在文件中添加注释说明原因。

### API 检测

```ts
// src/ai-providers/detect.ts
// 注意：chrome.aiOriginTrial 是 Chrome 专属，无 browser.* polyfill
async function detectChromeAI(): Promise<{
  available: boolean;
  capabilities?: AILanguageModelCapabilities;
}> {
  if (typeof chrome === "undefined" || !("aiOriginTrial" in chrome)) {
    return { available: false };
  }
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

### Prompt API 会话生命周期

Chrome Prompt API 使用有状态会话模式：`create()` → `prompt()` → `destroy()`。

```ts
// src/ai-providers/llm-chrome.ts

class ChromeLLMProvider implements LLMProvider {
  readonly name = "Chrome AI (Gemini Nano)";
  private session: AILanguageModel | null = null;

  get available(): boolean {
    return this.session !== null;
  }

  async initialize(): Promise<boolean> {
    try {
      const caps = await chrome.aiOriginTrial.languageModel.capabilities();
      if (caps.available === "no") return false;

      this.session = await chrome.aiOriginTrial.languageModel.create({
        temperature: 0.3,
        topK: 1,
        // 如果模型尚未下载，create() 会触发下载
        // caps.available === "after-download" 表示需要等待下载
      });
      return true;
    } catch {
      return false;
    }
  }

  async generateDeepContent(text: string, signal?: AbortSignal): Promise<LLMResult> {
    if (!this.session) throw new Error("Chrome AI session not initialized");

    const prompt = buildSummaryPrompt(text);
    const response = await this.session.prompt(prompt, { signal });
    return parseJsonResponse(response);
  }

  destroy(): void {
    if (this.session) {
      this.session.destroy();
      this.session = null;
    }
  }
}
```

**模型下载处理：**
- `capabilities().available === "after-download"` → 模型未下载，需要触发下载
- `create()` 调用会自动触发下载（用户可见进度在 Chrome UI 中）
- `initialize()` 返回 `false` 时，调用方降级到 remote provider

### 摘要生成 Prompt

```ts
function buildSummaryPrompt(text: string): string {
  return `Analyze the following webpage content and return a JSON object containing:
1. "summary": A 2-3 sentence summary in the original language of the text. CRITICAL: preserve key technical terms, product names, framework names, and distinguishing concepts.
2. "tags": 4-6 specific keywords/tags in the original language of the text. Include main topic, key technologies, frameworks.

Content:
${text.slice(0, 4000)}

Return ONLY valid JSON, no markdown formatting. Example:
{"summary": "...", "tags": ["...", "..."]}`;
}
```

### 响应解析

```ts
function parseJsonResponse(raw: string): LLMResult {
  // 清洗可能的 markdown 代码块包装
  const cleaned = raw
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  try {
    const parsed = JSON.parse(cleaned) as LLMResult;
    return {
      summary: parsed.summary || text.slice(0, 200).trim() + "...",
      tags: (parsed.tags || []).map((t) => t.trim()).filter(Boolean),
    };
  } catch {
    // JSON 解析失败 → 降级为截取原文
    return { summary: raw.slice(0, 200).trim() + "...", tags: [] };
  }
}
```

## 向后兼容

1. **Settings 迁移**：`aiProvider` 不存在时 Dexie migration 设为 `"remote"`，保持现有行为
2. **`enableLLMEnrichment` 不变**：优先级高于 `aiProvider`，现有行为完全保留
3. **API Key 仍然必需**：Embedding 继续使用 SiliconFlow API Key
4. **现有数据不变**：`BookmarkRecord.summary`、`BookmarkRecord.tags`、`BookmarkRecord.llmEnhanced` 字段不变
5. **`src/llm.ts` 过渡兼容**：`generateDeepContent` 标记 `@deprecated` 但保持可用，委托给新 provider 层

## 风险与缓解

| 风险 | 缓解 |
|------|------|
| Chrome AI API 仍在 Origin Trial，可能 API 变更 | 通过 `LLMProvider` 接口隔离，变更只影响 `llm-chrome.ts` |
| Gemini Nano 模型 (~2-3GB) 首次下载 | `canWrite` → `after-download` → `create()` 自动下载；显示状态在 Options UI |
| Prompt API 输出格式不稳定 | JSON 解析清洗 + 重试 + 静默降级 |
| Firefox 用户始终走远程 API | Options UI 明确标注 "Chrome AI 不可用（仅限Chromium）" |
| Service Worker 中 Prompt API 超时 | AbortSignal + 30s 超时 |
| `chrome.*` 违反 AGENTS.md 的 `browser.*` 约定 | 文件内注释说明原因；Code Review 中确认例外 |

## 测试要点

1. Chrome ≥131 + Origin Trial → `detectChromeAI()` 返回 `available: true` → 使用本地模型
2. Firefox / Chrome 无 trial → 降级远程 API
3. 远程 API Key 未配置但 Chrome AI 可用 → 摘要正常（`enableLLMEnrichment = true`）
4. 两者都不可用 → 摘要功能静默禁用，`getLLMProvider()` 返回 `null`
5. Options 手动切换 provider → `setLLMProvider()` 销毁旧会话 + 创建新 provider
6. Prompt API 返回非 JSON → `parseJsonResponse` 降级处理
7. `enableLLMEnrichment: false` → 无论 `aiProvider` 值为何，LLM 调用被跳过
8. 模型下载中（`after-download`）→ `initialize()` 返回 `false`，降级 remote
