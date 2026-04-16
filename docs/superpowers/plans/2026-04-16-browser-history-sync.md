# Browser History Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将浏览器访问历史（`browser.history`）作为第四个数据来源加入 Flow Search，支持手动同步、语义搜索和 `/history` omnibox 过滤。

**Architecture:** 新建 `src/history.ts` 模块负责抓取和转换历史记录，ID 前缀 `hi-` 区分来源，复用现有 `upsertBookmarks` + indexer 管道。在 `background.ts` 中新增 `SYNC_HISTORY` 消息和 `/history` omnibox 语法。在选项页新增 `HistorySettings.tsx` 组件。

**Tech Stack:** WXT · TypeScript · Solid.js · Dexie.js · `browser.history` API

---

## File Map

| 操作 | 文件 |
|------|------|
| 修改 | `src/types.ts` |
| 修改 | `src/db.ts` |
| 新建 | `src/history.ts` |
| 修改 | `wxt.config.ts` |
| 修改 | `entrypoints/background.ts` |
| 新建 | `entrypoints/options/components/HistorySettings.tsx` |
| 修改 | `entrypoints/options/App.tsx` |

---

## Task 1: 扩展类型定义

**Files:**
- Modify: `src/types.ts`

- [ ] **Step 1: 修改 SearchResult.source 联合类型**

在 `src/types.ts` 第 55 行，将：
```ts
  source: "github" | "twitter" | "bookmark";
```
改为：
```ts
  source: "github" | "twitter" | "bookmark" | "history";
```

- [ ] **Step 2: 在 Settings 接口末尾新增两个字段**

在 `src/types.ts` 的 `Settings` 接口末尾（`lastGistSync` 字段之后）添加：
```ts
  // 浏览历史同步配置
  historySyncEnabled?: boolean; // 是否启用历史同步
  historyDays?: number;         // 同步最近 N 天，默认 30
```

- [ ] **Step 3: 类型检查**

```bash
cd /Users/sternelee/www/github/wxt-bookmark-ai && pnpm compile
```
Expected: 无新增错误（`SearchResult.source` 的旧赋值 `"bookmark"/"github"/"twitter"` 仍合法）

- [ ] **Step 4: Commit**

```bash
git add src/types.ts
git commit -m "feat(types): add history source and Settings fields"
```

---

## Task 2: 更新默认设置

**Files:**
- Modify: `src/db.ts`

- [ ] **Step 1: 在 defaultSettings 末尾添加两个字段**

在 `src/db.ts` 的 `defaultSettings` 对象中，`lastGistSync: undefined,` 之后添加：
```ts
  historySyncEnabled: false,
  historyDays: 30,
```

完整的 `defaultSettings` 末尾应为：
```ts
  gistSyncEnabled: false,
  gistId: undefined,
  gistDeviceId: undefined,
  lastGistSync: undefined,
  historySyncEnabled: false,
  historyDays: 30,
};
```

- [ ] **Step 2: 类型检查**

```bash
cd /Users/sternelee/www/github/wxt-bookmark-ai && pnpm compile
```
Expected: 0 errors

- [ ] **Step 3: Commit**

```bash
git add src/db.ts
git commit -m "feat(db): add historySyncEnabled and historyDays defaults"
```

---

## Task 3: 新建 src/history.ts 核心模块

**Files:**
- Create: `src/history.ts`

- [ ] **Step 1: 创建文件**

```typescript
/**
 * 浏览器历史同步模块
 * 从 browser.history API 抓取访问记录，过滤后转换为 BookmarkRecord
 */

import type { BookmarkRecord } from "./types";
import { getSettings } from "./db";
import { upsertBookmarks } from "./db";

/** 需要跳过的 URL 协议前缀 */
const SKIP_PROTOCOLS = [
  "chrome://",
  "chrome-extension://",
  "about:",
  "file://",
  "data:",
  "javascript:",
];

/**
 * 判断 URL 是否应被跳过（系统页面或无效 URL）
 */
function shouldSkipUrl(url: string): boolean {
  return SKIP_PROTOCOLS.some((prefix) => url.startsWith(prefix));
}

/**
 * 将浏览器历史条目转换为 BookmarkRecord
 */
function historyItemToRecord(item: browser.history.HistoryItem): BookmarkRecord {
  const url = item.url!;
  // id: "hi-" + encodeURIComponent(url) 截取前 200 字符确保唯一可读
  const id = "hi-" + encodeURIComponent(url).slice(0, 200);
  return {
    id,
    url,
    title: item.title || url,
    summary: "",
    tags: [],
    status: "pending",
    indexedAt: Date.now(),
  };
}

/**
 * 同步浏览器访问历史到 IndexedDB
 * 跳过已索引 URL 和系统页面
 */
export async function syncHistoryBookmarks(): Promise<{
  added: number;
  skipped: number;
  error?: string;
}> {
  try {
    const settings = await getSettings();
    const days = settings.historyDays ?? 30;
    const startTime = Date.now() - days * 24 * 60 * 60 * 1000;

    // 从 browser.history 获取历史记录
    const historyItems = await browser.history.search({
      text: "",
      startTime,
      maxResults: 5000,
    });

    // 过滤无效 URL
    const validItems = historyItems.filter(
      (item) => item.url && !shouldSkipUrl(item.url),
    );

    if (validItems.length === 0) {
      return { added: 0, skipped: 0 };
    }

    // 获取已存在于 DB 的 URL 集合（任意来源）
    const { db } = await import("./db");
    const allUrls = validItems.map((item) => item.url!);

    // 分批查询已存在的 URL
    const BATCH_SIZE = 200;
    const existingUrls = new Set<string>();
    for (let i = 0; i < allUrls.length; i += BATCH_SIZE) {
      const batch = allUrls.slice(i, i + BATCH_SIZE);
      const existing = await db.bookmarks
        .where("url")
        .anyOf(batch)
        .toArray();
      for (const r of existing) {
        existingUrls.add(r.url);
      }
    }

    // 过滤已存在的 URL
    const newItems = validItems.filter(
      (item) => !existingUrls.has(item.url!),
    );

    if (newItems.length === 0) {
      return { added: 0, skipped: validItems.length };
    }

    // 转换并写入 DB
    const records = newItems.map(historyItemToRecord);
    await upsertBookmarks(records);

    console.log(
      `[history] 同步完成: 新增 ${records.length} 条，跳过 ${validItems.length - records.length} 条`,
    );

    return {
      added: records.length,
      skipped: validItems.length - records.length,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[history] syncHistoryBookmarks 失败:", error);
    return { added: 0, skipped: 0, error: message };
  }
}
```

- [ ] **Step 2: 类型检查**

```bash
cd /Users/sternelee/www/github/wxt-bookmark-ai && pnpm compile
```
Expected: 0 errors

- [ ] **Step 3: Commit**

```bash
git add src/history.ts
git commit -m "feat(history): add syncHistoryBookmarks module"
```

---

## Task 4: 声明 history 权限

**Files:**
- Modify: `wxt.config.ts`

- [ ] **Step 1: 在 permissions 数组中添加 "history"**

将 `wxt.config.ts` 中：
```ts
    permissions: ["storage", "tabs", "bookmarks", "cookies"],
```
改为：
```ts
    permissions: ["storage", "tabs", "bookmarks", "cookies", "history"],
```

- [ ] **Step 2: 类型检查**

```bash
cd /Users/sternelee/www/github/wxt-bookmark-ai && pnpm compile
```
Expected: 0 errors

- [ ] **Step 3: Commit**

```bash
git add wxt.config.ts
git commit -m "feat(manifest): add history permission"
```

---

## Task 5: 集成到 background.ts

**Files:**
- Modify: `entrypoints/background.ts`

- [ ] **Step 1: 在 import { syncGithubStars, syncTwitterBookmarks } 行中加入 syncHistoryBookmarks**

找到第 28-29 行：
```ts
  syncGithubStars,
  syncTwitterBookmarks,
```
改为：
```ts
  syncGithubStars,
  syncTwitterBookmarks,
  syncHistoryBookmarks,
```

同时在文件顶部的 `import ... from "../src/indexer"` 块中也需要确认 `syncHistoryBookmarks` 不在 indexer，而是来自 `../src/history`。

实际上 `syncHistoryBookmarks` 在 `src/history.ts`，不在 `indexer.ts`。所以在 background.ts 顶部添加单独的 import（在 indexer import 块之后）：

```ts
import { syncHistoryBookmarks } from "../src/history";
```

- [ ] **Step 2: 在 toSearchResult 函数中添加 history 来源识别**

找到第 68-69 行：
```ts
  if (record.id.startsWith("gh-")) source = "github";
  else if (record.id.startsWith("tw-")) source = "twitter";
```
改为：
```ts
  if (record.id.startsWith("gh-")) source = "github";
  else if (record.id.startsWith("tw-")) source = "twitter";
  else if (record.id.startsWith("hi-")) source = "history";
```

- [ ] **Step 3: 在 performFullSearch 中添加 /history 过滤支持**

找到 `performFullSearch` 函数中 `sourceFilter` 的类型声明（约第 88 行）：
```ts
  let sourceFilter: "github" | "twitter" | null = null;
```
改为：
```ts
  let sourceFilter: "github" | "twitter" | "history" | null = null;
```

在紧接 twitterMatch 解析之后（约第 96-99 行之后）添加：
```ts
  const historyMatch = query.match(/^\/history\s+(.*)/i);
  if (historyMatch) {
    sourceFilter = "history";
    query = historyMatch[1].trim();
  }
```

在 `sourceFilter === "github"` 和 `sourceFilter === "twitter"` 的 if/else if 块之后（约第 114-126 行之后）添加：
```ts
  } else if (sourceFilter === "history") {
    const { db } = await import("../src/db");
    const hiBookmarks = await db.bookmarks
      .filter((r) => r.id.startsWith("hi-"))
      .toArray();
    allowedUrls = new Set(hiBookmarks.map((r) => r.url));
  }
```

- [ ] **Step 4: 在 omnibox onInputChanged 中添加 /history 支持**

找到 omnibox 的 `sourceFilter` 类型声明（约第 562 行）：
```ts
    let sourceFilter: 'github' | 'twitter' | null = null;
```
改为：
```ts
    let sourceFilter: 'github' | 'twitter' | 'history' | null = null;
```

在 twitterMatch 解析之后添加：
```ts
    // 解析 /history 语法
    const historyMatch = query.match(/^\/history\s+(.*)$/i);
    if (historyMatch) {
      sourceFilter = 'history';
      query = historyMatch[1].trim();
    }
```

在 `sourceFilter === 'twitter'` 的 else if 块之后添加：
```ts
    } else if (sourceFilter === 'history') {
      const { db } = await import("../src/db");
      const hiBookmarks = await db.bookmarks
        .filter(r => r.id.startsWith('hi-'))
        .toArray();
      allowedUrls = new Set(hiBookmarks.map(r => r.url));
    }
```

同样在 omnibox 空查询的 recent 过滤处（sourceFilter === 'twitter' 分支之后）添加：
```ts
      } else if (sourceFilter === 'history') {
        filtered = recent.filter(({ url }) => !url.startsWith('chrome') && !url.startsWith('about'));
      }
```

- [ ] **Step 5: 在 omnibox "/" 提示列表中添加 /history 条目**

找到 omnibox 的命令引导 suggest 调用，在 `/twitter` 条目之后添加：
```ts
        {
          content: "/history ",
          description:
            "📜 <match>/history</match><dim>关键词</dim> — 搜索浏览历史",
        },
```

- [ ] **Step 6: 在 switch (message.type) 中添加 SYNC_HISTORY case**

在 `case "SYNC_TWITTER_BOOKMARKS":` 块之后添加：
```ts
          case "SYNC_HISTORY": {
            const histResult = await syncHistoryBookmarks();
            return { success: true, ...histResult };
          }
```

- [ ] **Step 7: 类型检查**

```bash
cd /Users/sternelee/www/github/wxt-bookmark-ai && pnpm compile
```
Expected: 0 errors

- [ ] **Step 8: Commit**

```bash
git add entrypoints/background.ts
git commit -m "feat(background): add SYNC_HISTORY message, /history omnibox syntax"
```

---

## Task 6: 新建 HistorySettings.tsx 选项页组件

**Files:**
- Create: `entrypoints/options/components/HistorySettings.tsx`

- [ ] **Step 1: 创建组件文件**

```tsx
import { createSignal } from "solid-js";
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
} from "../../../src/components/ui/card";
import { Input } from "../../../src/components/ui/input";
import { Checkbox } from "../../../src/components/ui/checkbox";
import { Button } from "../../../src/components/ui/button";
import { Alert } from "../../../src/components/ui/alert";
import { getSettings, saveSettings } from "../../../src/db";

export default function HistorySettings() {
  const [syncEnabled, setSyncEnabled] = createSignal(false);
  const [historyDays, setHistoryDays] = createSignal(30);
  const [lastSync, setLastSync] = createSignal<string | null>(null);
  const [status, setStatus] = createSignal<{
    message: string;
    type: "success" | "error" | "info";
  } | null>(null);
  const [isSyncing, setIsSyncing] = createSignal(false);

  // 初始化
  getSettings().then((settings) => {
    setSyncEnabled(settings.historySyncEnabled || false);
    setHistoryDays(settings.historyDays ?? 30);
  });

  const handleSave = async () => {
    try {
      await saveSettings({
        historySyncEnabled: syncEnabled(),
        historyDays: historyDays(),
      });
      setStatus({ message: "✓ 历史同步设置已保存", type: "success" });
    } catch (error) {
      setStatus({ message: `保存失败: ${error}`, type: "error" });
    }
  };

  const handleSync = async () => {
    setIsSyncing(true);
    setStatus({ message: "正在获取浏览历史...", type: "info" });

    try {
      const result = await browser.runtime.sendMessage({
        type: "SYNC_HISTORY",
      });

      if (result.success) {
        const msg = result.error
          ? `同步出错: ${result.error}`
          : `✓ 同步完成！新增 ${result.added} 条，跳过 ${result.skipped} 条`;
        setStatus({
          message: msg,
          type: result.error ? "error" : "success",
        });
        setLastSync(new Date().toLocaleString());
      } else {
        setStatus({ message: `同步失败: ${result.error}`, type: "error" });
      }
    } catch (error) {
      setStatus({ message: `通信错误: ${error}`, type: "error" });
    } finally {
      setIsSyncing(false);
    }
  };

  return (
    <Card class="mb-6">
      <CardHeader>
        <CardTitle>📜 浏览历史语义化索引</CardTitle>
      </CardHeader>
      <CardContent>
        <p class="text-xs text-muted-foreground mb-3">
          将浏览器访问历史纳入语义搜索。仅索引 http/https 页面，跳过已存在的书签/GitHub/Twitter 记录。
        </p>

        <Checkbox
          label="启用浏览历史同步"
          checked={syncEnabled()}
          onChange={(e) => setSyncEnabled(e.currentTarget.checked)}
        />

        <Input
          label="同步最近 N 天"
          type="number"
          placeholder="30"
          value={String(historyDays())}
          onInput={(e) => {
            const v = parseInt(e.currentTarget.value, 10);
            if (!isNaN(v) && v >= 1 && v <= 365) setHistoryDays(v);
          }}
          hint="范围 1-365 天，默认 30 天。天数越多首次同步越慢。"
        />

        <div class="flex gap-3 flex-wrap mt-4">
          <Button onClick={handleSave}>💾 保存设置</Button>
          <Button variant="outline" onClick={handleSync} disabled={isSyncing()}>
            {isSyncing() ? "正在同步..." : "🔄 立即同步历史"}
          </Button>
        </div>

        <Alert
          variant={status()?.type}
          visible={status() !== null}
          class="mt-4"
        >
          {status()?.message}
        </Alert>

        {lastSync() && (
          <p class="text-xs text-muted-foreground mt-3">
            上次同步: {lastSync()}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 2: 类型检查**

```bash
cd /Users/sternelee/www/github/wxt-bookmark-ai && pnpm compile
```
Expected: 0 errors

- [ ] **Step 3: Commit**

```bash
git add entrypoints/options/components/HistorySettings.tsx
git commit -m "feat(options): add HistorySettings component"
```

---

## Task 7: 在选项页注册 HistorySettings

**Files:**
- Modify: `entrypoints/options/App.tsx`

- [ ] **Step 1: 添加 import 和组件**

在 `entrypoints/options/App.tsx` 中，在 `import TwitterSettings` 行之后添加：
```ts
import HistorySettings from "./components/HistorySettings";
```

在 JSX 的 `<TwitterSettings />` 之后添加：
```tsx
        <HistorySettings />
```

完整的组件列表应为：
```tsx
        <APISettings />
        <GitHubSettings />
        <TwitterSettings />
        <HistorySettings />
        <GistSyncSettings />
        <SearchSettings />
        <IndexManager />
        <FailedBookmarks />
```

- [ ] **Step 2: 类型检查**

```bash
cd /Users/sternelee/www/github/wxt-bookmark-ai && pnpm compile
```
Expected: 0 errors

- [ ] **Step 3: Commit**

```bash
git add entrypoints/options/App.tsx
git commit -m "feat(options): register HistorySettings in options page"
```

---

## Task 8: 验证构建

- [ ] **Step 1: 完整构建**

```bash
cd /Users/sternelee/www/github/wxt-bookmark-ai && pnpm build
```
Expected: Build 成功，`.output/chrome-mv3/` 目录生成

- [ ] **Step 2: 检查 manifest.json 包含 history 权限**

```bash
cat .output/chrome-mv3/manifest.json | grep -A5 '"permissions"'
```
Expected: 输出包含 `"history"`

- [ ] **Step 3: 最终 Commit**

```bash
git add -A
git commit -m "feat: browser history sync complete - add /history omnibox, options UI, and src/history.ts"
```
