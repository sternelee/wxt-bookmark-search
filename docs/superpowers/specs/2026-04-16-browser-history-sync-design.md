# Browser History Sync — Design Spec

**Date:** 2026-04-16  
**Status:** Approved  
**Feature:** 浏览器访问历史索引与搜索支持

---

## Overview

为 Flow Search 扩展增加浏览器访问历史（`browser.history`）作为第四个数据来源，与现有书签、GitHub Stars、Twitter 书签并列。用户可在选项页配置同步天数，在 Popup 手动触发同步，并在 omnibox 中通过 `/history` 语法过滤搜索结果。

---

## Approach

采用方案 A：独立 `src/history.ts` 模块，复用现有 indexer 管道。与 GitHub/Twitter 同步模式完全对齐。

---

## 1. Data Model Changes

### `src/types.ts`

- `SearchResult.source` 扩展：
  ```ts
  source: "github" | "twitter" | "bookmark" | "history";
  ```

- `Settings` 新增字段：
  ```ts
  historySyncEnabled?: boolean;  // 是否启用历史同步，默认 false
  historyDays?: number;          // 同步最近 N 天，默认 30，范围 1-365
  ```

### `src/db.ts`

- `defaultSettings` 新增：
  ```ts
  historySyncEnabled: false,
  historyDays: 30,
  ```

---

## 2. New Module: `src/history.ts`

**职责：** 从 `browser.history` API 抓取历史记录，过滤后转换为 `BookmarkRecord`，写入 IndexedDB。

### ID 规则

```
"hi-" + encodeURIComponent(url).slice(0, 200)
```

### 过滤规则

跳过以下情况：
1. URL 已存在于 IndexedDB（`getIndexedUrls()` 返回的集合）
2. URL 协议为 `chrome://`、`chrome-extension://`、`about:`、`file://`
3. title 为空且 url 无意义（如纯 IP 或 localhost）

### 主函数签名

```ts
export async function syncHistoryBookmarks(): Promise<{
  added: number;
  skipped: number;
  error?: string;
}>
```

### 流程

```
syncHistoryBookmarks()
  ├── getSettings()                        // 读取 historyDays
  ├── browser.history.search({
  │     text: "",
  │     startTime: Date.now() - days * 86400_000,
  │     maxResults: 5000
  │   })
  ├── getIndexedUrls()                     // 已索引 URL 集合
  ├── 过滤（协议黑名单 + 已索引跳过）
  ├── 转换为 BookmarkRecord[]
  │     id: "hi-" + encodeURIComponent(url).slice(0, 200)
  │     title: item.title || url
  │     url: item.url
  │     status: "pending"
  │     indexedAt: Date.now()
  └── upsertBookmarks(records)             // 写入 DB，触发现有索引管道
```

---

## 3. background.ts Integration

### 新增消息类型

```ts
case "SYNC_HISTORY": {
  const { syncHistoryBookmarks } = await import("../src/history");
  const histResult = await syncHistoryBookmarks();
  return { success: true, ...histResult };
}
```

### 来源识别

```ts
if (record.id.startsWith("hi-")) source = "history";
```

### Omnibox 语法

新增 `/history` 过滤语法：

```
bi /history <关键词>  →  仅搜索历史记录
```

解析逻辑与 `/github`、`/twitter` 一致：

```ts
const historyMatch = query.match(/^\/history\s+(.*)$/i);
if (historyMatch) {
  sourceFilter = "history";
  query = historyMatch[1].trim();
}
```

### 帮助提示新增

```ts
"📜 <match>/history</match><dim>关键词</dim> — 搜索浏览历史"
```

### 权限声明（`wxt.config.ts`）

```ts
permissions: [...existing, "history"]
```

---

## 4. UI Changes

### 选项页 (`entrypoints/options/`)

新增"浏览历史同步"区块（与 GitHub/Twitter 同步区块风格一致）：

- **开关：** 启用/禁用历史同步（`historySyncEnabled`）
- **数字输入：** 同步最近 N 天（`historyDays`，默认 30，范围 1-365）
- **说明文字：** "需要 Chrome 历史记录权限"

### Popup (`entrypoints/popup/`)

- 同步按钮区新增"同步浏览历史"按钮，发送 `SYNC_HISTORY` 消息
- 显示同步结果（新增 X 条，跳过 Y 条）
- 统计标签新增 `📜 历史` 显示（与 `⭐ GitHub`、`🐦 Twitter` 对齐）
- 来源 badge 颜色：使用现有 badge 系统新增 `history` variant

---

## 5. Files to Modify

| 文件 | 变更类型 |
|------|---------|
| `src/types.ts` | 扩展 `SearchResult.source`，新增 `Settings` 字段 |
| `src/db.ts` | `defaultSettings` 新增两个字段 |
| `src/history.ts` | **新建**，核心同步逻辑 |
| `entrypoints/background.ts` | 新增消息 case、来源识别、omnibox 语法、帮助提示 |
| `wxt.config.ts` | 新增 `"history"` 权限 |
| `entrypoints/options/` | 新增历史同步配置 UI |
| `entrypoints/popup/` | 新增同步按钮 + 统计标签 |

---

## 6. Constraints

- 不修改 Dexie schema 版本（`BookmarkRecord` 结构不变，source 通过 id 前缀推断）
- 不实现定时自动同步（仅手动触发）
- 重复 URL 跳过策略：已在任意来源索引的 URL 均跳过
- `maxResults: 5000` 作为单次同步上限，防止首次同步过慢

---

## 7. Out of Scope

- 自动定时同步
- 页面全文提取（content script 方式）
- Firefox 兼容（`browser.history` API 在 Firefox 中也可用，但本期不特别测试）
