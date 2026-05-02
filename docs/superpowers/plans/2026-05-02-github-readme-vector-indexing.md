# GitHub Stars README 智能单向量化 — 实施计划

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 GitHub Stars 的 README 语义内容充分编码进单个 BGE-M3 向量（利用完整 8192 token 窗口），替换现有仅取 500 字符的做法。

**Architecture:** 新增 `sanitizeReadme`（HTML/XML 噪声裁剪）和 `extractReadmeSemanticContent`（结构化区域配额提取）两个纯函数，升级 `processEnrichmentQueue` 中的 embedding 生成逻辑，并通过 `githubReadmeVersion` 版本字段自动触发全量重建。

**Tech Stack:** TypeScript · Dexie.js · SiliconFlow BGE-M3 · browser.storage.local

**Spec:** `docs/superpowers/specs/2026-05-02-github-readme-vector-indexing-design.md`

---

## Chunk 1: Settings 类型与默认值

### Task 1: 添加 `githubReadmeVersion` 到 Settings 接口

**Files:**
- Modify: `src/types.ts:134` (在 `aiProvider` 字段后追加)
- Modify: `src/db.ts:290` (在 `defaultSettings` 末尾添加)

- [ ] **Step 1: 修改 `src/types.ts` — 添加字段**

  在 `src/types.ts:134` 的 `aiProvider` 字段后插入：

  ```typescript
  /** GitHub README 向量化版本号（用于存量重建触发），当前目标值 = 1 */
  githubReadmeVersion?: number;
  ```

- [ ] **Step 2: 修改 `src/db.ts` — 添加默认值**

  在 `src/db.ts` 的 `defaultSettings` 对象（第 271 行开始，`aiProvider: "remote"` 之后）追加：

  ```typescript
  githubReadmeVersion: 0,
  ```

- [ ] **Step 3: 运行类型检查**

  ```bash
  pnpm compile
  ```

  预期：零错误（仅新增可选字段，无 breaking change）

- [ ] **Step 4: 提交**

  ```bash
  git add src/types.ts src/db.ts
  git commit -m "feat: add githubReadmeVersion to Settings for re-index version control"
  ```

---

## Chunk 2: sanitizeReadme 纯函数

### Task 2: 在 `src/indexer.ts` 中实现 `sanitizeReadme`

**Files:**
- Modify: `src/indexer.ts` — 在 `stripMarkdownToPlainText`（第 143 行）之前插入新函数

- [ ] **Step 1: 在 `src/indexer.ts:141` 之前（`stripMarkdownToPlainText` 的 JSDoc 注释 `/** 将 Markdown 转为纯文本` 之前）插入以下代码**

  ```typescript
  /**
   * 对 GitHub README 进行 XML/HTML 噪声裁剪，保留 Markdown 结构
   * 裁剪顺序: HTML注释 → SVG块 → details/summary块 → 带布局属性HTML标签(剥离保留内文)
   *            → 剩余HTML标签 → Badge图片链接 → 纯URL行
   */
  export function sanitizeReadme(raw: string): string {
    return (
      raw
        // 1. HTML 注释（badge 配置、隐藏元数据，无语义）
        .replace(/<!--[\s\S]*?-->/g, " ")
        // 2. SVG 整块（图标/图表 XML 原始数据）
        .replace(/<svg[\s\S]*?<\/svg>/gi, " ")
        // 3. <details>/<summary> 块（折叠内容，结构混乱）
        .replace(/<details[\s\S]*?<\/details>/gi, " ")
        // 4. 带布局属性的 HTML 标签 → 剥离标签保留内文
        .replace(
          /<([a-zA-Z][a-zA-Z0-9]*)\s[^>]*(align|width|height|style|class)[^>]*>([\s\S]*?)<\/\1>/gi,
          "$3",
        )
        // 5. 所有剩余 HTML/XML 标签 → 保留内文
        .replace(/<\/?[a-zA-Z][^>]*>/g, " ")
        // 6. Badge 图片链接 [![...](img)](url)（纯装饰，语义为零）
        .replace(/\[!\[[^\]]*\]\([^)]*\)\]\([^)]*\)/g, " ")
        // 7. 纯 URL 行（行内容仅为 URL，无描述上下文）
        .replace(/^https?:\/\/\S+$/gm, " ")
        // 合并多余空白行（最多保留两个连续换行）
        .replace(/\n{3,}/g, "\n\n")
        .trim()
    );
  }
  ```

- [ ] **Step 2: 运行类型检查**

  ```bash
  pnpm compile
  ```

  预期：零错误

- [ ] **Step 3: 提交**

  ```bash
  git add src/indexer.ts
  git commit -m "feat: add sanitizeReadme to strip HTML/XML noise from GitHub READMEs"
  ```

---

## Chunk 3: extractReadmeSemanticContent 函数

### Task 3: 实现 `extractReadmeSemanticContent`

**Files:**
- Modify: `src/indexer.ts` — 在 `sanitizeReadme` 函数之后、`stripMarkdownToPlainText` 之前插入

- [ ] **Step 1: 在 `sanitizeReadme` 函数结束的 `}` 之后、`stripMarkdownToPlainText` JSDoc 之前插入以下代码**

  ```typescript
  /**
   * 从 README 中提取结构化语义内容，用于 BGE-M3 向量化（最大利用 8192 token 窗口）
   * 流程: sanitizeReadme → 按H2/H3划分section → 语义分类 → 按配额填充 → 结构化文档
   * @param readme 原始 README 文本（Markdown 格式）
   * @returns 结构化纯文本，总长不超过 7500 字符
   */
  export function extractReadmeSemanticContent(readme: string): string {
    const TOTAL_BUDGET = 7500;

    // 1. HTML/XML 净化，保留 Markdown 结构
    const sanitized = sanitizeReadme(readme);

    // 2. 提取仓库描述行（Title + Description，从首行 H1 和 description 区域）
    const titleMatch = sanitized.match(/^#\s+(.+)$/m);
    const repoTitle = titleMatch ? titleMatch[1].trim() : "";

    // 3. 按 H2/H3 边界划分 section
    const sectionPattern = /^(#{2,3})\s+(.+)$/gm;
    const sections: Array<{ title: string; content: string; start: number }> = [];
    let lastMatch: RegExpExecArray | null = null;

    let m: RegExpExecArray | null;
    while ((m = sectionPattern.exec(sanitized)) !== null) {
      if (lastMatch !== null) {
        sections.push({
          title: lastMatch[2].trim(),
          content: sanitized.slice(lastMatch.index + lastMatch[0].length, m.index).trim(),
          start: lastMatch.index,
        });
      }
      lastMatch = m;
    }
    if (lastMatch !== null) {
      sections.push({
        title: lastMatch[2].trim(),
        content: sanitized.slice(lastMatch.index + lastMatch[0].length).trim(),
        start: lastMatch.index,
      });
    }

    // 4. 平铺 README 兜底：无 H2/H3 时直接取 stripMarkdownToPlainText 前 7500 字符
    if (sections.length === 0) {
      const flat = stripMarkdownToPlainText(sanitized);
      return flat.slice(0, TOTAL_BUDGET);
    }

    // 5. 标题汇总
    const allTitles = sections.map((s) => s.title).join(", ");

    // 6. 提取 H1 下首段落（到第一个 H2/H3 之前）作为 Overview
    const firstSectionStart = sections[0].start;
    const preH2Text = sanitized.slice(0, firstSectionStart);
    // 去掉 H1 标题行本身
    const overviewRaw = preH2Text.replace(/^#\s+.+$/m, "").trim();
    const overview = stripMarkdownToPlainText(overviewRaw);

    // 7. 语义分类关键词
    const FEATURE_KW = /features?|功能|特性|highlights?|what'?s included|capabilities/i;
    const USECASE_KW = /use[- ]cases?|scenarios?|使用场景|应用场景|who uses|motivation/i;
    const QUICKSTART_KW = /quick[- ]?start|getting[- ]?started|快速开始|installation|install|安装|setup/i;

    // 8. 按语义分类归并 section 内容（跳过 fenced 代码块）
    function stripCodeBlocks(text: string): string {
      return text.replace(/```[\s\S]*?```/g, " ").replace(/`[^`]+`/g, " ");
    }

    let featuresText = "";
    let useCaseText = "";
    let quickStartText = "";
    const bodyLines: string[] = [];

    for (const sec of sections) {
      const plain = stripMarkdownToPlainText(sec.content);
      if (FEATURE_KW.test(sec.title)) {
        featuresText += (featuresText ? "\n" : "") + plain;
      } else if (USECASE_KW.test(sec.title)) {
        useCaseText += (useCaseText ? "\n" : "") + plain;
      } else if (QUICKSTART_KW.test(sec.title)) {
        // Quick Start: 额外去掉代码块，避免命令行污染语义
        const stripped = stripMarkdownToPlainText(stripCodeBlocks(sec.content));
        quickStartText += (quickStartText ? "\n" : "") + stripped;
      } else {
        // 兜底：取行长 > 30 的高密度正文行
        const lines = plain.split(/\s+/).filter((w) => w.length > 0).join(" ");
        if (lines.length > 30) {
          bodyLines.push(lines);
        }
      }
    }

    // 9. 按配额构建输出
    const QUOTA = {
      description: 200,
      titles: 400,
      overview: 1500,
      features: 1500,
      useCases: 1000,
      quickStart: 600,
    };

    const parts: string[] = [];
    let remaining = TOTAL_BUDGET;

    function addPart(label: string, text: string, quota: number): void {
      if (!text || remaining <= 0) return;
      const allowed = Math.min(quota, remaining);
      const slice = text.slice(0, allowed);
      if (slice.trim()) {
        parts.push(`${label}: ${slice.trim()}`);
        remaining -= slice.length + label.length + 2;
      }
    }

    // 仓库描述行（title 已在外部上下文中，这里加上完整描述）
    addPart("Title", repoTitle, QUOTA.description);
    addPart("Sections", allTitles, QUOTA.titles);
    addPart("Overview", overview, QUOTA.overview);
    addPart("Features", featuresText, QUOTA.features);
    addPart("Use Cases", useCaseText, QUOTA.useCases);
    addPart("Quick Start", quickStartText, QUOTA.quickStart);

    // 兜底：高密度正文行
    if (remaining > 50 && bodyLines.length > 0) {
      const body = bodyLines.join(" ").slice(0, remaining);
      if (body.trim()) {
        parts.push(`Content: ${body.trim()}`);
      }
    }

    return parts.join("\n");
  }
  ```

- [ ] **Step 2: 运行类型检查**

  ```bash
  pnpm compile
  ```

  预期：零错误

- [ ] **Step 3: 提交**

  ```bash
  git add src/indexer.ts
  git commit -m "feat: add extractReadmeSemanticContent for structured README vector extraction"
  ```

---

## Chunk 4: 升级 processEnrichmentQueue

### Task 4: 更新 `processEnrichmentQueue` 中的 embedding 生成逻辑

**Files:**
- Modify: `src/indexer.ts:330–381` (`processEnrichmentQueue` 函数的 readme 处理部分)

目标：将 `plainText.slice(0, 500)` 替换为 `semanticContent`，并解耦 LLM 和 embedding 两个路径。

- [ ] **Step 1: 替换 `processEnrichmentQueue` 中的 README 处理块**

  找到 `src/indexer.ts:330`（`try {` 块内，`const readme = await fetchRepoReadme(...)` 之后），将原有逻辑替换：

  **旧代码（第 332–381 行）：**
  ```typescript
        if (readme && readme.length > 10) {
          const plainText = stripMarkdownToPlainText(readme);
          let summary = plainText.slice(0, 500);
          let tags: string[] = [];
          let llmEnhanced = false;

          // LLM 增强（如果启用）
          if (settings.enableLLMEnrichment && plainText.length > 100) {
            try {
              const provider = getLLMProvider();
              if (provider) {
                const llmResult = await provider.generateDeepContent(
                  plainText.slice(0, 4000),
                );
                summary = llmResult.summary;
                tags = llmResult.tags;
                llmEnhanced = true;
              }
            } catch (llmError) {
              console.warn(
                `[indexer] LLM enrichment failed for ${job.owner}/${job.repo}:`,
                llmError,
              );
              // 降级：使用原始摘要
            }
          }

          const textToEmbed = buildEmbeddingText(
            `${job.owner}/${job.repo}`,
            summary,
            tags,
            job.url,
          );
          const { embedding } = await getEmbedding(
            textToEmbed,
            settings.openaiApiKey!,
            undefined,
            settings.embeddingModel,
            settings.baseURL,
          );
          await updateBookmark(job.bookmarkId, {
            summary,
            tags,
            embedding,
            needsEnrichment: false,
            indexedAt: Date.now(),
            llmEnhanced,
          });
          console.log(`[indexer] Enriched: ${job.owner}/${job.repo}`);
        }
  ```

  **新代码：**
  ```typescript
        if (readme && readme.length > 10) {
          // 语义内容提取（用于 embedding，充分利用 BGE-M3 的 8192 token 窗口）
          const semanticContent = extractReadmeSemanticContent(readme);
          const plainText = stripMarkdownToPlainText(readme);
          let summary = plainText.slice(0, 800);  // 展示用摘要（关键词搜索 + UI）
          let tags: string[] = [];
          let llmEnhanced = false;

          // LLM 增强（仅影响 summary + tags，不影响 embedding）
          if (settings.enableLLMEnrichment && plainText.length > 100) {
            try {
              const provider = getLLMProvider();
              if (provider) {
                const llmResult = await provider.generateDeepContent(
                  plainText.slice(0, 4000),
                );
                summary = llmResult.summary;   // UI 展示摘要来自 LLM
                tags = llmResult.tags;
                llmEnhanced = true;
              }
            } catch (llmError) {
              console.warn(
                `[indexer] LLM enrichment failed for ${job.owner}/${job.repo}:`,
                llmError,
              );
              // 降级：使用原始摘要
            }
          }

          // embedding 始终使用 semanticContent（与 LLM 开关无关）
          // 不通过 buildEmbeddingText，避免 "Summary:" 标签重复嵌套已结构化的内容
          const textToEmbed = semanticContent.slice(0, 8000);
          const { embedding } = await getEmbedding(
            textToEmbed,
            settings.openaiApiKey!,
            undefined,
            settings.embeddingModel,
            settings.baseURL,
          );
          await updateBookmark(job.bookmarkId, {
            summary,
            tags,
            embedding,
            needsEnrichment: false,
            indexedAt: Date.now(),
            llmEnhanced,
          });
          console.log(`[indexer] Enriched: ${job.owner}/${job.repo}`);
        }
  ```

- [ ] **Step 2: 运行类型检查**

  ```bash
  pnpm compile
  ```

  预期：零错误

- [ ] **Step 3: 提交**

  ```bash
  git add src/indexer.ts
  git commit -m "feat: use extractReadmeSemanticContent for GitHub README embeddings"
  ```

---

## Chunk 5: initIndexer 版本检查与自动重建

### Task 5: 在 `initIndexer` 中插入版本检查块

**Files:**
- Modify: `src/indexer.ts:1417–1452` — 在 `restoreEnrichmentQueue()` 调用之后、`processEnrichmentQueue()` 调用之前插入版本检查代码

需先确认当前 `initIndexer` 的结构（关键行）：
- Line 1415: `if (settings.githubToken && settings.openaiApiKey) {`
- Line 1417: `await restoreEnrichmentQueue();`
- Line 1419: `// 2. 从 DB 中恢复需要 enrichment 的记录...`
- Line 1448: `if (enrichmentQueue.length > 0) {`
- Line 1452: `processEnrichmentQueue().catch(() => {});`

- [ ] **Step 1: 在 `restoreEnrichmentQueue()` 调用之后、DB 恢复循环之前（即 `indexer.ts` 第 1417 行之后）插入版本检查块**

  找到以下代码段（`restoreEnrichmentQueue()` 调用 + 紧接的注释）：

  ```typescript
      // 1. 先从 storage 恢复队列
      await restoreEnrichmentQueue();

      // 2. 从 DB 中恢复需要 enrichment 的记录（避免重复）
  ```

  在 `await restoreEnrichmentQueue();` 之后、`// 2. 从 DB 中恢复...` 注释之前插入：

  ```typescript
      // === README 向量版本检查：存量重建 ===
      const CURRENT_README_VERSION = 1;
      // 仅在 githubToken 存在时才做重建（无 token 无法拉 README，保留旧版本号等待下次启动）
      if (settings.githubToken && (settings.githubReadmeVersion ?? 0) < CURRENT_README_VERSION) {
        const githubRecords = await db.bookmarks
          .filter((r) => r.source === "github" && r.status === "indexed")
          .toArray();

        let versionAdded = 0;
        for (const record of githubRecords) {
          if (enrichmentQueue.some((j) => j.bookmarkId === record.id)) continue;
          const match = record.url.match(/github\.com\/([^/]+)\/([^/?#]+)/);
          if (match) {
            enrichmentQueue.push({
              bookmarkId: record.id,
              url: record.url,
              owner: match[1],
              repo: match[2].replace(/\/$/, ""),
              token: settings.githubToken,
            });
            versionAdded++;
          }
        }

        if (versionAdded > 0) {
          await persistEnrichmentQueue();
          console.log(
            `[indexer] Queued ${versionAdded} GitHub repos for README re-indexing (v${CURRENT_README_VERSION})`,
          );
        }

        // 仅在 token 存在时推进版本（无 token 时保留旧值，等待下次启动时重试）
        await saveSettings({ githubReadmeVersion: CURRENT_README_VERSION });
      }
      // === 版本检查结束 ===
  ```

  注意：此块需要 `saveSettings` 函数，检查文件顶部是否已有 `import { saveSettings } from "./db"`，若没有则需要添加（通常已存在）。

- [ ] **Step 2: 确认 `saveSettings` 已在 `src/indexer.ts` 中导入**

  ```bash
  grep -n "saveSettings" src/indexer.ts | head -5
  ```

  若不存在，在顶部导入行中添加 `saveSettings`：
  ```typescript
  import { ..., saveSettings } from "./db";
  ```

- [ ] **Step 3: 运行类型检查**

  ```bash
  pnpm compile
  ```

  预期：零错误

- [ ] **Step 4: 提交**

  ```bash
  git add src/indexer.ts
  git commit -m "feat: trigger GitHub README re-indexing on version upgrade in initIndexer"
  ```

---

## Chunk 6: 最终验证

### Task 6: 完整编译与手动验证

- [ ] **Step 1: 完整类型检查**

  ```bash
  pnpm compile
  ```

  预期：零错误、零警告

- [ ] **Step 2: 构建扩展**

  ```bash
  pnpm build
  ```

  预期：`.output/chrome-mv3/` 生成成功，无构建错误

- [ ] **Step 3: 手动验证清单（在 Chrome 扩展中加载 `.output/chrome-mv3/`）**

  1. 打开 Options 页 → GitHub Token 已配置，API Key 已配置
  2. 点击 "Sync GitHub Stars" → 等待完成
  3. 打开扩展 Background service worker DevTools → Console 中应见到：
     - `[indexer] Queued N GitHub repos for README re-indexing (v1)` （首次启动）
  4. 等待 enrichment 完成后，搜索某个已 star 的 repo 名（用 Features 中的关键词）
  5. 重启扩展 → DevTools Console 中 **不应再出现** re-indexing 日志（版本已推进到 1）
  6. 无 Token 场景：清空 GitHub Token → 重启 → `githubReadmeVersion` 应保持原值

- [ ] **Step 4: 最终提交（如有遗漏修改）**

  ```bash
  git status
  git add -p  # 只提交必要修改
  git commit -m "chore: finalize GitHub README semantic vector indexing"
  ```
