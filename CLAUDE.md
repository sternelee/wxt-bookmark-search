# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Flow Search** is a Manifest V3 browser extension for AI-powered bookmark search. Trigger: type `bi <keyword>` in the omnibox. Supports keyword, vector (semantic), and hybrid search modes. Also indexes GitHub starred repos, Twitter/X bookmarks, and browser history, with bookmark Q&A (RAG), link health checking, duplicate detection, and AI auto-categorization.

Stack: WXT framework, TypeScript, Solid.js (popup/options/search UI), Dexie.js (IndexedDB), **Orama** (in-memory hybrid search engine), OpenAI-compatible APIs for embeddings + LLM (default base: `https://api.openai.com`, default model: `gpt-4o-mini`; SiliconFlow BGE-M3 / DeepSeek-V3 supported via `baseURL`), `@mozilla/readability` + `turndown` (local content extraction), Jina AI Reader (fallback), Octokit (GitHub API).

**Browsers:** Chrome (primary) and Firefox (MV3 via `--mv3` flag). WXT handles cross-browser manifest differences automatically.

## Commands

```bash
pnpm install       # Install deps (auto-runs wxt prepare via postinstall)
pnpm dev           # Dev server with HMR → .output/chrome-mv3/
pnpm dev:firefox   # Firefox dev server
pnpm build         # Production build (Chrome MV3)
pnpm build:firefox # Production build (Firefox MV3)
pnpm zip           # Package as .zip for distribution
pnpm zip:firefox   # Package Firefox build as .zip
pnpm compile       # TypeScript type-check only (tsc --noEmit)
```

**No test runner is configured.** Manual testing:
- Chrome: load unpacked from `.output/chrome-mv3/` in `chrome://extensions/`
- Firefox: load unpacked from `.output/firefox-mv3/` in `about:debugging#/runtime/this-firefox`

**Always run `pnpm compile` before marking work done.**

## Architecture

### Layer separation (strict)

| Directory | Purpose |
|-----------|---------|
| `src/` | Pure logic — no framework deps, no browser entry-point globals |
| `entrypoints/` | Browser entry points wired to `src/` logic |

**Rule:** Core logic stays in `src/`. Entry points only wire up browser APIs and call `src/` functions. Never import `browser.*` globals directly inside `src/` files (exception: `health.ts` uses `browser.runtime.sendMessage` for broadcast progress — keep this isolated).

### Key src/ modules

| File | Responsibility |
|------|---------------|
| `types.ts` | All shared interfaces (`BookmarkRecord`, `Settings`, `SearchMode`, `SearchResult`, `LinkCheckResult`, `DuplicateGroup`, `CategorySuggestion`, `RAGAnswer`, etc.) |
| `db.ts` | Dexie.js IndexedDB wrapper (schema v6) + `browser.storage.local` settings + `defaultSettings` |
| `search-engine.ts` | **Orama-backed search engine** — unified keyword/vector/hybrid search over a single in-memory Orama instance. Persists serialized state via `browser.storage.local` with 5 s debounced saves. Vector dim: 1024. Includes freq-boost reranking. |
| `embedding.ts` | OpenAI-compatible embedding API client (BGE-M3 / text-embedding-3, etc.) with LRU cache, AbortSignal, native batch API |
| `search.ts` | Higher-level search orchestration — calls `search-engine` and merges source/folder filters |
| `indexer.ts` | Background indexing queue with rate-limiting, exponential backoff, enrichment recovery on SW restart; **GitHub README re-indexing on `githubReadmeVersion` upgrade**; uses `extractReadmeSemanticContent` for repo READMEs |
| `freq.ts` | Visit frequency cache with debounced writes to `browser.storage.local` |
| `highlight.ts` | XML escaping for omnibox `<match>/<dim>/<url>` tags |
| `github.ts` | GitHub Stars fetching via Octokit with streaming pagination + early-exit |
| `twitter.ts` | Twitter/X GraphQL API client for bookmarks sync with retry logic |
| `twitter-cookies.ts` | Auto-extraction of Twitter cookies via `browser.cookies` API |
| `history.ts` | Browser history sync via `browser.history` API |
| `gist-sync.ts` | GitHub Gist multi-device bookmark sync with union merge + deletion tracking (30-day TTL, 900 KB size guard) |
| `cloud-sync/` | Cloud-drive sync for full BookmarkRecord + Orama vector index. Providers: Google Drive (`google-drive.ts`), Dropbox (`dropbox.ts`), WebDAV (`webdav.ts`), with `blob.ts` (gzip serialization via native `CompressionStream`), `bookmark-sync.ts` (content toggles), `types.ts`, and `index.ts` (orchestration). Manual Access Token auth; auto-upload via `browser.alarms`; download always manual (full replace). |
| `health.ts` | Link health checker — concurrent `HEAD` requests (CONCURRENCY=5, timeout 8 s), broadcasts `LINK_CHECK_PROGRESS` messages |
| `dedup.ts` | Duplicate bookmark detection (URL grouping) + resolution helper |
| `categorize.ts` | AI auto-categorization via LLM into a fixed taxonomy (Frontend/Backend/Rust/etc.); two-phase dry-run → apply with folder creation |
| `rag.ts` | Bookmark Q&A via RAG — feeds top-K relevant bookmark summaries to LLM, returns answer + citations |
| `llm.ts` | High-level LLM helpers (summarize-on-demand) using current AI provider |
| `ai-providers/` | LLM provider abstraction — `llm-base.ts` registry, `llm-remote.ts` (OpenAI-compatible), `detect.ts` (Chrome AI legacy, always returns unavailable), `types.ts` |
| `bookmarkRoots.ts` | Cross-browser bookmark root role mapping (Chrome ↔ Firefox normalization) |
| `lib/utils.ts` | `cn()` utility for Tailwind class merging |
| `lib/sanitize.ts` | HTML sanitization + GitHub README HTML parsing for `HtmlRenderer` |
| `components/HtmlRenderer.tsx` | Renders sanitized HTML for GitHub/twitter/bookmark/history result cards |
| `components/SummarizePanel.tsx` | On-demand summary + Q&A UI panel (used by search page) |
| `components/ui/` | Reusable UI primitives (Button, Card, Badge, Progress, Input, Select, etc.) |
| `i18n/` | Type-safe i18n with `useI18n()`; locales: `zh-CN`, `en`, `ja`, `ko` |
| `polyfills.ts` | Cross-browser polyfills (e.g. `AbortSignal.timeout` for Firefox <124) |

### Entry points

| File | Purpose |
|------|---------|
| `entrypoints/background.ts` | Service worker: omnibox handlers, message-passing switch, indexer init, Gist sync scheduling, link-check alarms, AI provider init |
| `entrypoints/popup/` | Solid.js popup UI — stats, recent bookmarks, indexing HUD |
| `entrypoints/options/` | Solid.js settings page — API keys, indexing controls, folder tree, GitHub/Twitter/History/Gist config, link-health/dedup/categorize panels |
| `entrypoints/search/` | Solid.js full-page search UI — source/folder filters, summarize panel, Q&A panel |
| `entrypoints/content.ts` | Content script placeholder |

### Message types (background.ts `onMessage` switch)

Synchronous: `GET_INDEXING_STATUS`

Async:
- **Search & indexing:** `FULL_SEARCH`, `START_INDEXING`, `PAUSE_INDEXING`, `RESUME_INDEXING`, `RETRY_FAILED`, `GET_FAILED_BOOKMARKS`, `DELETE_BOOKMARK`, `GET_BOOKMARK_FOLDERS`, `INDEX_FOLDERS`, `GET_ALL_INDEXED`
- **External sources:** `SYNC_GITHUB_STARS`, `SYNC_TWITTER_BOOKMARKS`, `SYNC_HISTORY`
- **Cache:** `GET_CACHE_STATS`, `CLEAR_EMBEDDING_CACHE`
- **Gist:** `GIST_SYNC`, `GIST_CREATE`, `GIST_LINK`, `GIST_UPLOAD`, `GIST_DOWNLOAD`
- **Cloud sync:** `CLOUD_SYNC_TEST_CONNECTION`, `CLOUD_SYNC_GET_STATUS`, `CLOUD_SYNC_UPLOAD`, `CLOUD_SYNC_DOWNLOAD`, `CLOUD_SYNC_DELETE`, `CLOUD_SYNC_REFRESH_ALARM`, `CLOUD_SYNC_BOOKMARK_SYNC`, `CLOUD_SYNC_BOOKMARK_UPLOAD`, `CLOUD_SYNC_BOOKMARK_DOWNLOAD`
- **Link health:** `CHECK_LINKS`, `GET_LINK_STATS`, `GET_DEAD_LINKS`
- **Dedup:** `FIND_DUPLICATES`, `RESOLVE_DUPLICATES`
- **Categorize:** `GET_CATEGORY_SUGGESTIONS`, `APPLY_CATEGORIES`, `GET_CATEGORY_FOLDERS`
- **AI:** `SUMMARIZE_URL`, `ASK_BOOKMARKS`

Broadcast (background → all listeners): `LINK_CHECK_PROGRESS`

### Data flow

**Omnibox search:** `onInputChanged` → debounce 150 ms + AbortController → ensure Orama engine loaded → `getQueryEmbedding` (cached or API) → `searchHybrid` (Orama mode: `"hybrid"` with `hybridWeights`) → freq-boost rerank → suggestions (max 9) → `browser.omnibox.setDefaultSuggestion`.

**Full-page search:** popup/options or Enter in omnibox → `performFullSearch` → same pipeline returning `SearchResult[]` DTOs (max 20) with source/folder filters (`/github`, `/twitter`, `/history`, `/folder:name`).

**Hybrid/vector/keyword search:** all go through `search-engine.ts`. Vector and hybrid require an embedding (uses LRU cache, then API). Keyword falls back when no API key. Orama handles fuzzy tolerance (`tolerance: 1`).

**Indexing pipeline:** bookmark URL → content extraction (Active Tab → Local Readability + Turndown → Jina AI Reader fallback) → `ai-providers` LLM (summary + tags) → `embedding.ts` (vector via batch API) → Dexie write → `upsertSearchEngine` → `scheduleSaveSearchEngine`.

**GitHub README re-indexing:** `initIndexer` checks `settings.githubReadmeVersion` against the target version constant. On mismatch, GitHub-sourced bookmarks are re-enqueued for enrichment via `extractReadmeSemanticContent` (markdown → semantically-meaningful text).

**Twitter/X sync:** auto-extract cookies via `browser.cookies` (manual fallback) → GraphQL API with retry/rate-limit handling → `BookmarkRecord` with Twitter-specific metadata → enqueue.

**History sync:** `browser.history.search` → filter system URLs → skip already-indexed → `BookmarkRecord` with `hi-` prefix IDs → upsert → enqueue.

**Gist sync:** bookmark CRUD → 5 s debounce → `browser.bookmarks.getTree` → union merge with remote Gist → apply 30-day deletion tombstones → update Gist. Uses `gistSyncLock` to prevent recursion.

**Link health:** `health.ts` HEAD-checks all indexed URLs (concurrency 5, 8 s timeout), writes `linkStatus` + `linkCheckedAt` to Dexie, broadcasts progress messages. Runs on `browser.alarms` schedule when `linkCheckEnabled`.

**Dedup:** group indexed bookmarks by URL → resolve via keep-one + delete-rest (browser bookmark API + Dexie + Orama).

**Categorize:** select bookmark IDs → batch LLM call (BATCH_SIZE=20) → `CategorySuggestion[]` → user reviews → apply moves bookmarks into category folders (creates folders on demand).

**Summarize on demand / Q&A:** `SUMMARIZE_URL` extracts and runs LLM live for a single URL. `ASK_BOOKMARKS` runs `searchVector` over the corpus, passes top results to `rag.ts`, returns answer + citations.

**Message passing:** popup/options/search ↔ background via `browser.runtime.sendMessage` / `onMessage.addListener` with string-literal action types in a `switch` statement. Return `true` from listener to keep channel open for async responses.

### Key patterns

**Orama search engine:** Single in-memory instance, persisted to `browser.storage.local` (serialized via `save()`/`load()`). Reloaded on SW startup. Saves are debounced (5 s) via `scheduleSaveSearchEngine`. Inserts done via `populateSearchEngine` (bulk) or `upsertSearchEngine` (single). Embedding-less records are filtered out.

**Freq boost:** After Orama returns hits, `applyFreqBoost` adds up to `FREQ_BOOST_MAX (0.15)` based on normalized visit frequency, then resorts.

**Rate limiting:** `indexer.ts` uses exponential backoff for API calls. Respects rate limits and gracefully handles 429 responses. `llm-remote.ts` retries up to MAX_RETRIES=2 with 2 s base delay on 429/5xx.

**AI provider abstraction:** `ai-providers/llm-base.ts` holds the current provider singleton; `autoCreateLLMProvider(settings)` picks based on `settings.aiProvider`. Chrome AI is deprecated (`detect.ts` always returns unavailable). Current sole live provider: remote OpenAI-compatible (`llm-remote.ts`).

**Content extraction order:** Active Tab (fastest, uses Readability on live DOM) → Local Readability + Turndown on fetched HTML → Jina Reader (`https://r.jina.ai/*` host permission) as network fallback.

**Early-exit pagination:** GitHub Stars sync exits when all URLs already indexed to avoid unnecessary pagination.

**Schema migrations:** Dexie versions 1–6 in `db.ts`. v5 added `aiProvider` default. v6 migrated `aiProvider: "chrome"` → `"remote"` after Chrome AI removal.

## Adding New Features

1. **New core logic** → add to `src/` as a dedicated module with JSDoc
2. **New browser API usage** → only in `entrypoints/`; expose typed function from `src/` and call from entry point
3. **New message type** → add a `case` to the `switch` in `background.ts` `onMessage` handler
4. **New settings field** → extend `Settings` in `types.ts`, add to `defaultSettings` in `db.ts`
5. **New DB column** → bump the Dexie version in `db.ts` with a migration
6. **New searchable field** → update `bookmarkSchema` in `search-engine.ts` and `recordToDoc`/`docToRecord` mappers
7. **New LLM provider** → add module under `ai-providers/`, wire into `autoCreateLLMProvider`
8. **Always verify:** `pnpm compile` before finishing

## Code Style

### TypeScript

- **Interfaces vs Types:** Use `interface` for exported object shapes (e.g., `BookmarkRecord`, `Settings`). Use `type` for unions, aliases, and function-scoped shapes (e.g., `SearchMode`).
- **Type safety:** never `as any` or `@ts-ignore` — use `instanceof Error` for error handling. Explicit `as` casts only for untyped browser APIs or Orama's loose schema typing (already isolated in `search-engine.ts`).
- **Imports:** Framework/library imports first, then internal imports. Use `import type` for type-only imports. Path aliases: `@/*` → `./src/*`, `~/*` → `./*` — use `@/` in entrypoints for `src/` imports.

```ts
// Correct
import type { BookmarkRecord } from "@/types";
import { searchHybrid } from "@/search-engine";
import { createSignal, For } from "solid-js";
```

- **Functions:** Prefer named `function` declarations for exported top-level functions. Arrow functions for callbacks and event handlers.
- **JSDoc:** One-line `/** Brief description */` on all exported functions. Chinese is acceptable to match surrounding code.

### Formatting and Naming

- **Indentation:** 2 spaces. **Quotes:** double. **Semicolons:** always. **Trailing commas:** in multi-line.
- `camelCase` for variables/functions, `SCREAMING_SNAKE_CASE` for module-level constants, `PascalCase` for interfaces/types/classes/components.
- `async/await` throughout — no raw `.then()` chains except fire-and-forget: `promise().catch(() => {})`.
- Error logging: `console.error('[ModuleName] Description:', error)` — prefixes like `[FlowSearch]`, `[indexer]`, `[search-engine]`, `[LLM-remote]`, `[dedup]`, `[db]`.
- Chinese comments are present throughout the codebase — match the language of surrounding code.
- Solid.js UI: use `class` (not `className`), `createSignal`/`For`/`Show` from `solid-js`.
- Tailwind v3 with shadcn-style HSL CSS variables (`hsl(var(--primary))`), dark mode via `prefers-color-scheme`.

### Error Handling

- All async entry-point logic must be wrapped in `try/catch`.
- Log with prefix: `console.error('[ModuleName] Description:', error)`.
- Use `console.warn` for recoverable failures (rate limits, missing data).
- Propagate errors up — don't swallow silently in library code (`src/`).
- `llm-remote.ts` gracefully degrades to a truncated-content summary on permanent failure rather than throwing.

## Browser Extension Constraints

- **MV3 service worker (Chrome)** / **non-persistent background page (Firefox)** — no persistent in-memory state across SW restarts. Persist via `browser.storage.local` (small) or IndexedDB (large). WXT generates the correct manifest per target.
- **Orama state persistence:** the entire search engine is serialized via `save()` and stored in `browser.storage.local` under a dedicated key; reloaded on background startup via `loadSearchEngine`. Saves are debounced.
- **Omnibox descriptions must be XML-escaped** — always use `escapeXml()` from `highlight.ts`; only `<match>`, `<dim>`, `<url>` tags are valid.
- `browser.*` APIs are globally available in entry points via WXT auto-injection — no explicit import needed.
- Message passing: return `true` from `onMessage` listener to keep channel open for async responses.

## Cross-Browser Compatibility

WXT handles most manifest differences automatically. Code-level considerations:

- **Never use `chrome.*` APIs directly** — always use `browser.*` (WXT polyfills Chrome to Promise-based API).
- **`AbortSignal.timeout`** — polyfilled in `src/polyfills.ts` for Firefox <124; imported at `background.ts` startup.
- **`browser.cookies`** — works on both browsers; host permissions for target domains are declared in `wxt.config.ts`.
- **`browser.history`** — requires `history` permission on both browsers.
- **Firefox MV3** uses `background.scripts` (non-persistent page) instead of `service_worker`; WXT generates the correct manifest per target.

## API Dependencies

- **OpenAI-compatible API Key** (set as `openaiApiKey`) — required for embeddings and LLM. Configure `baseURL` to point at SiliconFlow (`https://api.siliconflow.cn`), OpenAI, or any compatible endpoint. Default model: `gpt-4o-mini`; embedding default depends on the provider.
- **Jina AI Reader** (`https://r.jina.ai/*`) — free, no key needed; fallback for content extraction.
- **GitHub PAT** — optional, for syncing starred repos and Gist bookmark sync.
- **Twitter/X cookies** — optional, auto-extracted via `browser.cookies` API (requires `cookies` permission + `https://x.com/*` host_permissions), with manual fallback for `ct0` + `authToken`.
- **Google Drive / Dropbox access tokens** — optional, for `cloud-sync` (full BookmarkRecord + Orama vector index sync). Manual paste; never auto-refreshed. Google Drive scope: `drive.file`.

## Manifest (`wxt.config.ts`)

- `permissions`: `storage`, `tabs`, `bookmarks`, `cookies`, `history`, `alarms`
- `host_permissions`: `https://r.jina.ai/*`, `https://x.com/*`, `https://twitter.com/*`, `https://api.x.com/*`, `https://www.googleapis.com/*`, `https://content.googleapis.com/*`, `https://api.dropboxapi.com/*`, `https://content.dropboxapi.com/*`
- `omnibox.keyword`: `bi`
- Optional `trial_tokens` via `CHROME_AI_TRIAL_TOKEN` env (Chrome AI deprecated but token still wired for future re-enable)
