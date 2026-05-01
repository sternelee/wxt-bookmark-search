# Native AI Provider 混合本地化 — 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将书签 AI 摘要/标签生成从纯远程 API 迁移到 Chrome 内置 Prompt API（Gemini Nano），Firefox 降级远程。

**Architecture:** 新增 `src/ai-providers/` LLM provider 抽象层（5 个文件），通过模块级单例注入 `indexer.ts`。Embedding 和 Content 保持不变。

**Tech Stack:** Chrome Prompt API (`chrome.aiOriginTrial.languageModel`), OpenAI-compatible Chat API, WXT, Solid.js, Dexie.js

---

## 文件映射

| 任务 | 文件 | 操作 |
|------|------|------|
| 1 | `src/ai-providers/types.ts` | 新建 |
| 2 | `src/types.ts`, `src/db.ts` | 修改 |
| 3 | `src/ai-providers/detect.ts` | 新建 |
| 4 | `src/ai-providers/llm-base.ts` | 新建 |
| 5 | `src/ai-providers/llm-remote.ts` | 新建 |
| 6 | `src/ai-providers/llm-chrome.ts` | 新建 |
| 7 | `src/indexer.ts` | 修改 |
| 8 | `src/llm.ts` | 修改 |
| 9 | `entrypoints/background.ts` | 修改 |
| 10 | `wxt.config.ts` | 修改 |
| 11 | `src/i18n/locales/{zh-CN,en,ja,ko}.ts` | 修改 |
| 12 | `entrypoints/options/components/APISettings.tsx` | 修改 |
| 13 | — | 验证 |

---

### 任务 1: 创建 LLMProvider 类型定义

**文件:**
- 创建: `src/ai-providers/types.ts`

- [ ] **步骤 1: 创建接口文件**

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

- [ ] **步骤 2: 验证类型检查**

```bash
pnpm compile
```

---

### 任务 2: 添加 Settings 字段 + DB 迁移

**文件:**
- 修改: `src/types.ts:132`
- 修改: `src/db.ts:98-107,255`

- [ ] **步骤 1: `src/types.ts` — 在 Settings 接口末尾（`language?: string` 之后）添加 `aiProvider` 字段**

在 `src/types.ts:131` 的 `}` 前添加：
```ts
  /** AI 摘要提供者: "chrome" | "remote" | "disabled" */
  aiProvider?: string;
```

- [ ] **步骤 2: `src/db.ts` — Dexie v5 迁移**

替换 `src/db.ts:98-107`：
```ts
    // v4: add indexQueue for persistent indexing queue
    this.version(4).stores({
      bookmarks: "id, url, status, indexedAt",
      indexQueue: "bookmarkId, url, enqueuedAt",
    });
    // v5: add aiProvider default to storage.local settings
    this.version(5).stores({
      bookmarks: "id, url, status, indexedAt",
      indexQueue: "bookmarkId, url, enqueuedAt",
    });
```

- [ ] **步骤 3: `src/db.ts` — defaultSettings 添加 aiProvider**

在 `src/db.ts:255` 的 `};` 前（`language: "en"` 之后）添加：
```ts
  aiProvider: "remote",
```

- [ ] **步骤 4: `src/db.ts` — DB migration 逻辑：为现有用户迁移 `aiProvider`**

在 v5 version 声明后添加 `.upgrade()` 迁移：
```ts
    // v5: add aiProvider default to storage.local settings
    this.version(5).stores({
      bookmarks: "id, url, status, indexedAt",
      indexQueue: "bookmarkId, url, enqueuedAt",
    }).upgrade(async () => {
      const result = await browser.storage.local.get("settings");
      const settings = result["settings"] as Record<string, unknown> | undefined;
      if (settings && settings.aiProvider === undefined) {
        await browser.storage.local.set({
          settings: { ...settings, aiProvider: "remote" },
        });
      }
    });
```

**注意：** Dexie `upgrade()` 只能调用 IndexedDB API。`browser.storage.local` 是独立的 storage API，可安全在 `upgrade()` 中调用。

- [ ] **步骤 5: 验证**

```bash
pnpm compile
```

---

### 任务 3: 创建 Chrome AI 能力检测

**文件:**
- 创建: `src/ai-providers/detect.ts`

- [ ] **步骤 1: 创建检测函数**

```ts
// src/ai-providers/detect.ts
/**
 * Chrome AI Prompt API 能力检测。
 *
 * 注意：chrome.aiOriginTrial 是 Chrome 专属实验性 API，
 * WXT 的 browser.* polyfill 不包含此命名空间，因此必须
 * 直接使用 chrome.aiOriginTrial。这是经过评审的例外。
 */

export interface ChromeAICapabilities {
  available: "readily" | "after-download" | "no";
  defaultTemperature?: number;
  defaultTopK?: number;
  maxTopK?: number;
}

export interface ChromeAIDetectionResult {
  available: boolean;
  needsDownload: boolean;
  capabilities?: ChromeAICapabilities;
}

/** 检测 Chrome AI Prompt API 是否可用 */
export async function detectChromeAI(): Promise<ChromeAIDetectionResult> {
  if (typeof chrome === "undefined") {
    return { available: false, needsDownload: false };
  }
  if (!("aiOriginTrial" in chrome)) {
    return { available: false, needsDownload: false };
  }
  try {
    const ai = chrome.aiOriginTrial as {
      languageModel: {
        capabilities(): Promise<ChromeAICapabilities>;
      };
    };
    const caps = await ai.languageModel.capabilities();
    return {
      available: caps.available !== "no",
      needsDownload: caps.available === "after-download",
      capabilities: caps,
    };
  } catch {
    return { available: false, needsDownload: false };
  }
}
```

- [ ] **步骤 2: 验证**

```bash
pnpm compile
```

---

### 任务 4: 创建 LLM Provider 单例管理

**文件:**
- 创建: `src/ai-providers/llm-base.ts`

- [ ] **步骤 1: 创建单例管理 + 工厂函数**

```ts
// src/ai-providers/llm-base.ts
import type { LLMProvider, LLMResult } from "./types";
import type { Settings } from "../types";
import { detectChromeAI } from "./detect";
import { createRemoteLLMProvider } from "./llm-remote";
import { createChromeLLMProvider } from "./llm-chrome";

let _provider: LLMProvider | null = null;

/** 设置当前 LLM provider（background.ts 启动时调用） */
export function setLLMProvider(provider: LLMProvider | null): void {
  if (_provider && _provider !== provider) {
    _provider.destroy();
  }
  _provider = provider;
}

/** 获取当前 LLM provider */
export function getLLMProvider(): LLMProvider | null {
  return _provider;
}

/** 自动选择并创建 LLM provider */
export async function autoCreateLLMProvider(
  settings: Settings,
): Promise<LLMProvider | null> {
  // 用户手动选择 "disabled"
  if (settings.aiProvider === "disabled") {
    return null;
  }

  // 用户手动选择 "chrome" 或自动检测
  if (settings.aiProvider === "chrome" || !settings.aiProvider || settings.aiProvider === "remote") {
    // 尝试 Chrome AI
    const detection = await detectChromeAI();
    if (detection.available) {
      const provider = await createChromeLLMProvider();
      if (provider) return provider;
    }
  }

  // 降级到远程 API（需要 apiKey）
  if (settings.openaiApiKey) {
    return createRemoteLLMProvider(
      settings.openaiApiKey,
      settings.llmModel || "gpt-4o-mini",
      settings.baseURL || "https://api.openai.com",
    );
  }

  return null;
}
```

- [ ] **步骤 2: 验证**

```bash
pnpm compile
```

**注意：** 此文件在任务 5-6 完成后才能通过编译（import 了尚未创建的文件）。仅在步骤 1 时预期报错。

---

### 任务 5: 创建 Remote LLM Provider

**文件:**
- 创建: `src/ai-providers/llm-remote.ts`

- [ ] **步骤 1: 创建 RemoteLLMProvider（从 src/llm.ts 提取核心逻辑）**

```ts
// src/ai-providers/llm-remote.ts
import type { LLMProvider, LLMResult } from "./types";

const MAX_RETRIES = 2;
const RETRY_BASE_MS = 2000;

function isRetryableStatus(status: number): boolean {
  return status === 429 || (status >= 500 && status < 600);
}

function buildSystemPrompt(): string {
  return `You are a helpful bookmark assistant. Analyze the provided web content and return a JSON object containing:
1. 'summary': A 2-3 sentence summary in the original language of the text. CRITICAL: preserve key technical terms, product names, framework names, and distinguishing concepts. Do NOT over-generalize. If the text compares "React" and "React Native", the summary must mention BOTH terms, not just "React frameworks".
2. 'tags': 4-6 specific keywords/tags in the original language of the text. Include the main topic, key technologies mentioned, and any frameworks or libraries.

The output MUST be a valid JSON object. Example:
{
  "summary": "This article compares React and React Native, explaining their differences in rendering (DOM vs native UI), development workflow, and when to choose each for building cross-platform applications.",
  "tags": ["React", "React Native", "Cross-platform", "Mobile Development", "JavaScript", "Comparison"]
}`;
}

export function createRemoteLLMProvider(
  apiKey: string,
  model: string,
  baseURL: string,
): LLMProvider {
  const endpoint = `${baseURL}/v1/chat/completions`;
  const systemPrompt = buildSystemPrompt();

  return {
    name: "Remote (OpenAI-compatible)",
    get available() {
      return true;
    },
    destroy() {
      // no-op
    },
    async generateDeepContent(
      text: string,
      signal?: AbortSignal,
    ): Promise<LLMResult> {
      const userPrompt = `Content to analyze:\n\n${text.slice(0, 4000)}`;

      for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        try {
          const response = await fetch(endpoint, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${apiKey}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              model,
              messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: userPrompt },
              ],
              response_format: { type: "json_object" },
              temperature: 0.3,
            }),
            signal,
          });

          if (!response.ok) {
            if (isRetryableStatus(response.status) && attempt < MAX_RETRIES) {
              const delay = response.status === 429
                ? RETRY_BASE_MS * Math.pow(2, attempt)
                : RETRY_BASE_MS;
              console.warn(
                `[LLM-remote] ${response.status} error, retrying in ${delay}ms (${attempt + 1}/${MAX_RETRIES})`,
              );
              await new Promise((r) => setTimeout(r, delay));
              continue;
            }
            throw new Error(`LLM API error: ${response.status}`);
          }

          const data = await response.json();
          const content = data.choices[0].message.content;
          const result = JSON.parse(content) as LLMResult;
          result.tags = (result.tags || [])
            .map((t: string) => t.trim())
            .filter(Boolean);
          return result;
        } catch (error: unknown) {
          if (error instanceof DOMException && error.name === "AbortError") {
            throw error;
          }
          if (attempt >= MAX_RETRIES) {
            console.error("[LLM-remote] Failed:", error);
            break;
          }
          console.warn(`[LLM-remote] Attempt ${attempt + 1} failed:`, (error as Error).message);
          await new Promise((r) => setTimeout(r, RETRY_BASE_MS));
        }
      }

      // 降级
      return {
        summary: text.slice(0, 200).trim() + "...",
        tags: [],
      };
    },
  };
}
```

- [ ] **步骤 2: 验证**

```bash
pnpm compile
```

---

### 任务 6: 创建 Chrome Prompt API Provider

**文件:**
- 创建: `src/ai-providers/llm-chrome.ts`

- [ ] **步骤 1: 创建 ChromeLLMProvider**

```ts
// src/ai-providers/llm-chrome.ts
/**
 * Chrome Prompt API (Gemini Nano) LLM Provider。
 *
 * 注意：chrome.aiOriginTrial 是 Chrome 专属实验性 API，
 * WXT 的 browser.* polyfill 不包含此命名空间，因此必须
 * 直接使用 chrome.aiOriginTrial。这是经过评审的例外。
 */
import type { LLMProvider, LLMResult } from "./types";

function buildSummaryPrompt(text: string): string {
  return `Analyze the following webpage content and return a JSON object containing:
1. "summary": A 2-3 sentence summary in the original language of the text. CRITICAL: preserve key technical terms, product names, framework names, and distinguishing concepts.
2. "tags": 4-6 specific keywords/tags in the original language of the text. Include main topic, key technologies, frameworks.

Content:
${text.slice(0, 4000)}

Return ONLY valid JSON, no markdown formatting. Example:
{"summary": "...", "tags": ["...", "..."]}`;
}

function parseJsonResponse(raw: string, fallbackText: string): LLMResult {
  const cleaned = raw
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  try {
    const parsed = JSON.parse(cleaned) as LLMResult;
    return {
      summary: parsed.summary || fallbackText.slice(0, 200).trim() + "...",
      tags: (parsed.tags || []).map((t: string) => t.trim()).filter(Boolean),
    };
  } catch {
    return { summary: raw.slice(0, 200).trim() + "...", tags: [] };
  }
}

/**
 * Chrome AI LanguageModel 类型声明（Origin Trial）。
 * 类型定义基于 Chrome AI Prompt API 公开文档。
 */
interface AILanguageModel {
  prompt(input: string, options?: { signal?: AbortSignal }): Promise<string>;
  destroy(): void;
}

interface AILanguageModelFactory {
  capabilities(): Promise<{
    available: "readily" | "after-download" | "no";
  }>;
  create(options?: {
    temperature?: number;
    topK?: number;
    signal?: AbortSignal;
  }): Promise<AILanguageModel>;
}

export async function createChromeLLMProvider(): Promise<LLMProvider | null> {
  if (typeof chrome === "undefined" || !("aiOriginTrial" in chrome)) {
    return null;
  }

  const ai = chrome.aiOriginTrial as {
    languageModel: AILanguageModelFactory;
  };

  let session: AILanguageModel | null = null;

  try {
    session = await ai.languageModel.create({
      temperature: 0.3,
      topK: 1,
    });
  } catch {
    return null;
  }

  return {
    name: "Chrome AI (Gemini Nano)",
    get available() {
      return session !== null;
    },
    destroy() {
      if (session) {
        session.destroy();
        session = null;
      }
    },
    async generateDeepContent(
      text: string,
      signal?: AbortSignal,
    ): Promise<LLMResult> {
      if (!session) {
        throw new Error("Chrome AI session not initialized");
      }

      try {
        const prompt = buildSummaryPrompt(text);
        const response = await session.prompt(prompt, { signal });
        return parseJsonResponse(response, text);
      } catch (error: unknown) {
        if (error instanceof DOMException && error.name === "AbortError") {
          throw error;
        }
        console.error("[LLM-chrome] Failed:", error);
        return { summary: text.slice(0, 200).trim() + "...", tags: [] };
      }
    },
  };
}
```

- [ ] **步骤 2: 验证**

```bash
pnpm compile
```

---

### 任务 7: 更新 indexer.ts 使用新 provider

**文件:**
- 修改: `src/indexer.ts:19,770-805`

- [ ] **步骤 1: 修改 import**

替换 `src/indexer.ts:19`：
```ts
import { getLLMProvider } from "./ai-providers/llm-base";
```

保留 `generateDeepContent` 的 import 删除：
```ts
// 旧行删除: import { generateDeepContent } from "./llm";
```

- [ ] **步骤 2: 修改 LLM 调用代码**

替换 `src/indexer.ts:770-805`：
```ts
          // LLM 增强（如果启用且有足够内容）
          if (
            settings.enableLLMEnrichment &&
            content?.markdown &&
            content.markdown.length > 100
          ) {
            try {
              const provider = getLLMProvider();
              if (provider) {
                const llmResult = await provider.generateDeepContent(
                  content.markdown.slice(0, 4000),
                );
                summary = llmResult.summary;
                tags = llmResult.tags;
                text = buildEmbeddingText(
                  content.title || job.title,
                  summary,
                  tags,
                  job.url,
                );
              } else {
                // 无可用 provider，降级到原始摘要
                text = content
                  ? buildEmbeddingText(
                      content.title || job.title,
                      summary || "",
                      [],
                      job.url,
                    )
                  : buildEmbeddingText(job.title, "", [], job.url);
              }
            } catch (llmError) {
              console.warn(
                `[indexer] LLM enhancement failed for ${job.url}:`,
                llmError,
              );
              // 降级：使用原始摘要
              text = content
                ? buildEmbeddingText(
                    content.title || job.title,
                    summary || "",
                    [],
                    job.url,
                  )
                : buildEmbeddingText(job.title, "", [], job.url);
            }
```

- [ ] **步骤 3: 验证**

```bash
pnpm compile
```

---

### 任务 8: 更新 src/llm.ts 保持向后兼容

**文件:**
- 修改: `src/llm.ts`

- [ ] **步骤 1: `src/llm.ts` — 重导出类型 + 标记 deprecated**

在文件顶部添加：
```ts
export type { LLMResult } from "./ai-providers/types";
```

将 `aiResult` 导出改为从 `types.ts` 重导出：
```ts
// 替换第 12-15 行：
export type { LLMResult as AIResult } from "./ai-providers/types";
```

为 `generateDeepContent` 添加 `@deprecated` 注释并保留原函数签名：
```ts
// 在第 22 行函数上方添加：
/** @deprecated 使用 src/ai-providers/ 中的 LLMProvider 替代 */
```

`testLlmModel` 保持不变（仍被 APISettings.tsx 使用）。

- [ ] **步骤 2: 验证**

```bash
pnpm compile
```

---

### 任务 9: 在 background.ts 中集成 provider 初始化

**文件:**
- 修改: `entrypoints/background.ts`

- [ ] **步骤 1: 添加 import**

在 `entrypoints/background.ts` 的 import 区域添加：
```ts
import {
  autoCreateLLMProvider,
  setLLMProvider,
  getLLMProvider,
} from "../src/ai-providers/llm-base";
import { saveSettings } from "../src/db"; // 确保已 import
```

- [ ] **步骤 2: 添加 provider 初始化函数**

在 `entrypoints/background.ts` 中添加（在 `initIndexer()` 调用之前附近）：
```ts
/** 初始化 LLM provider */
async function initLLMProvider(): Promise<void> {
  try {
    const settings = await getSettings();
    const provider = await autoCreateLLMProvider(settings);
    setLLMProvider(provider);
    if (provider) {
      console.log(`[FlowSearch] LLM provider: ${provider.name}`);
    } else {
      console.log("[FlowSearch] LLM provider: none available");
    }
  } catch (error) {
    console.error("[FlowSearch] Failed to init LLM provider:", error);
  }
}
```

- [ ] **步骤 3: 在初始化流程中调用**

找到 `entrypoints/background.ts` 中的初始化调用区域（附件 `initIndexer()`）并添加：
```ts
// 在 initIndexer() 调用之前或之后添加：
initLLMProvider();
```

- [ ] **步骤 4: 监听 aiProvider 设置变更，重新创建 provider**

在现有 `browser.storage.onChanged` 监听器中（如果有），添加：
```ts
browser.storage.onChanged.addListener(async (changes, areaName) => {
  if (areaName !== "local") return;
  const settingsChange = changes["settings"];
  if (!settingsChange) return;

  const oldVal = settingsChange.oldValue as Settings | undefined;
  const newVal = settingsChange.newValue as Settings | undefined;

  // aiProvider 或 openaiApiKey 变更时重新初始化 provider
  if (
    oldVal?.aiProvider !== newVal?.aiProvider ||
    oldVal?.openaiApiKey !== newVal?.openaiApiKey
  ) {
    const provider = await autoCreateLLMProvider(newVal!);
    setLLMProvider(provider);
  }
});
```

- [ ] **步骤 5: 验证**

```bash
pnpm compile
```

---

### 任务 10: 更新 wxt.config.ts 支持 Chrome AI Origin Trial

**文件:**
- 修改: `wxt.config.ts`

- [ ] **步骤 1: 添加 trial_tokens 配置**

```ts
import { defineConfig } from "wxt";

export default defineConfig({
  modules: ["@wxt-dev/module-solid"],
  manifest: {
    name: "Flow Search",
    permissions: ["storage", "tabs", "bookmarks", "cookies", "history"],
    host_permissions: [
      "https://r.jina.ai/*",
      "https://x.com/*",
      "https://twitter.com/*",
      "https://api.x.com/*",
    ],
    omnibox: { keyword: "bi" },
    trial_tokens: process.env.CHROME_AI_TRIAL_TOKEN
      ? [{ token: process.env.CHROME_AI_TRIAL_TOKEN }]
      : undefined,
  },
});
```

- [ ] **步骤 2: 验证**

```bash
pnpm compile
```

---

### 任务 11: 添加 i18n 翻译 key

**文件:**
- 修改: `src/i18n/locales/zh-CN.ts:76-78`
- 修改: `src/i18n/locales/en.ts:76-78`
- 修改: `src/i18n/locales/ja.ts`
- 修改: `src/i18n/locales/ko.ts`

- [ ] **步骤 1: zh-CN — 在 `options.api.` 区域添加**

在 `src/i18n/locales/zh-CN.ts:78`（`testFail` 之后）添加：
```ts
      aiProvider: "AI 摘要提供者",
      aiProviderHint: "Chrome 用户可选内置 AI（离线），其他浏览器使用远程 API",
      aiProviderChrome: "Chrome 内置 AI (离线)",
      aiProviderRemote: "远程 API",
      aiProviderDisabled: "禁用",
```

- [ ] **步骤 2: en — 在 `options.api.` 区域添加**

在 `src/i18n/locales/en.ts:81`（`testFail` 之后）添加：
```ts
      aiProvider: "AI Summary Provider",
      aiProviderHint: "Chrome users can use built-in AI (offline), others use remote API",
      aiProviderChrome: "Chrome Built-in AI (Offline)",
      aiProviderRemote: "Remote API",
      aiProviderDisabled: "Disabled",
```

- [ ] **步骤 3: ja — 查找 `options.api.` 区域的 `testFail` 并添加**

```ts
      aiProvider: "AI 要約プロバイダー",
      aiProviderHint: "Chrome ユーザーは内蔵 AI (オフライン) を使用できます",
      aiProviderChrome: "Chrome 内蔵 AI (オフライン)",
      aiProviderRemote: "リモート API",
      aiProviderDisabled: "無効",
```

- [ ] **步骤 4: ko — 查找 `options.api.` 区域的 `testFail` 并添加**

```ts
      aiProvider: "AI 요약 제공자",
      aiProviderHint: "Chrome 사용자는 내장 AI(오프라인)를 사용할 수 있습니다",
      aiProviderChrome: "Chrome 내장 AI (오프라인)",
      aiProviderRemote: "원격 API",
      aiProviderDisabled: "비활성화",
```

- [ ] **步骤 5: 验证**

```bash
pnpm compile
```

---

### 任务 12: APISettings.tsx 添加 Provider 选择 UI

**文件:**
- 修改: `entrypoints/options/components/APISettings.tsx`

- [ ] **步骤 1: 添加 import**

在 `entrypoints/options/components/APISettings.tsx:2` 附近的 import 中添加：
```ts
import { AutoComplete } from "../../../src/components/ui/auto-complete";
```

如果项目没有 AutoComplete 组件，使用 Select 替代：
```ts
import { Select } from "../../../src/components/ui/select";
```

- [ ] **步骤 2: 添加信号和初始化**

在 `APISettings` 函数体中，现有信号声明处添加：
```ts
  const [aiProvider, setAIProvider] = createSignal<"chrome" | "remote" | "disabled">("remote");
```

在 `getSettings()` 初始化回调中添加：
```ts
    setAIProvider((settings.aiProvider as "chrome" | "remote" | "disabled") || "remote");
```

- [ ] **步骤 3: 更新 handleSave 包含 aiProvider**

修改 `handleSave` 中的 `saveSettings` 调用：
```ts
      await saveSettings({
        openaiApiKey: apiKey(),
        baseURL: baseURL() || undefined,
        embeddingModel: embeddingModel() || undefined,
        llmModel: llmModel() || undefined,
        enableLLMEnrichment: enableLLMEnrichment(),
        aiProvider: aiProvider(),
      });
```

- [ ] **步骤 4: 添加 Select UI（在 Checkbox enableLLMEnrichment 之后）**

在 `<Checkbox ... />` 之后，保存按钮之前添加：
```tsx
        <div class="mt-4">
          <label class="text-sm font-medium block mb-1">
            {t("options.api.aiProvider")}
          </label>
          <select
            class="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            value={aiProvider()}
            onChange={(e) =>
              setAIProvider(e.currentTarget.value as "chrome" | "remote" | "disabled")
            }
          >
            <option value="chrome">{t("options.api.aiProviderChrome")}</option>
            <option value="remote">{t("options.api.aiProviderRemote")}</option>
            <option value="disabled">{t("options.api.aiProviderDisabled")}</option>
          </select>
          <p class="text-xs text-muted-foreground mt-1">
            {t("options.api.aiProviderHint")}
          </p>
        </div>
```

- [ ] **步骤 5: 验证**

```bash
pnpm compile
```

---

### 任务 13: 最终验证

- [ ] **步骤 1: 运行类型检查**

```bash
pnpm compile
```

**期望输出：** 无类型错误。

- [ ] **步骤 2: 运行构建确认无运行时问题**

```bash
pnpm build
```

**期望输出：** 构建成功，生成 `.output/chrome-mv3/`。

- [ ] **步骤 3: 检查新增文件完整性**

```bash
ls -la src/ai-providers/
```

**期望输出：** 5 个文件：`types.ts`, `detect.ts`, `llm-base.ts`, `llm-chrome.ts`, `llm-remote.ts`

- [ ] **步骤 4: 手动验证清单**
  1. Chrome 环境下 `detectChromeAI()` 在控制台可调用
  2. 无 Origin Trial token 时 provider 降级到 remote
  3. Options 页面 Provider 选择器可正常切换
  4. `enableLLMEnrichment: false` 时忽略 provider 选择
  5. 索引书签时 LLM 摘要正常生成
