# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Flow Search** is a Manifest V3 browser extension for AI-powered bookmark search. Trigger: type `bi <keyword>` in the omnibox. Supports keyword, vector (semantic), and hybrid search modes using SiliconFlow BGE-M3 embeddings. Also indexes GitHub starred repos, Twitter/X bookmarks, and browser history.

Stack: WXT framework, TypeScript, Solid.js (popup/options UI), Dexie.js (IndexedDB), SiliconFlow BGE-M3 (embeddings), Jina AI Reader (content extraction), Octokit (GitHub API).

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

**Rule:** Core logic stays in `src/`. Entry points only wire up browser APIs and call `src/` functions. Never import `browser.*` globals directly inside `src/` files.

### Key src/ modules

| File | Responsibility |
|------|---------------|
| `types.ts` | All shared interfaces (`BookmarkRecord` with Twitter-specific fields, `Settings`, `SearchMode`, etc.) |
| `db.ts` | Dexie.js IndexedDB wrapper + `browser.storage.local` settings + in-memory cache for indexed bookmarks |
| `embedding.ts` | SiliconFlow BGE-M3 API client with LRU cache + AbortSignal support + native batch embedding API |
| `hybrid.ts` | RRF hybrid search with min-max normalization (pure JS cosine similarity on in-memory cache) |
| `search.ts` | Keyword-only search + Levenshtein fuzzy (sliding window) reranking |
| `vector.ts` | Cosine similarity utilities |
| `indexer.ts` | Background indexing queue with rate-limiting, enrichment queue recovery on restart |
| `freq.ts` | Visit frequency cache with debounced writes |
| `highlight.ts` | XML escaping for omnibox `<match>/<dim>/<url>` tags |
| `github.ts` | GitHub Stars fetching via Octokit with streaming pagination + early-exit |
| `twitter.ts` | Twitter/X GraphQL API client for bookmarks sync with retry logic |
| `twitter-cookies.ts` | Auto-extraction of Twitter cookies via `browser.cookies` API |
| `llm.ts` | SiliconFlow Chat API (DeepSeek-V3) for summaries/tags |
| `history.ts` | Browser history sync via `browser.history` API |
| `gist-sync.ts` | GitHub Gist bookmark sync with union merge + deletion tracking |
| `lib/utils.ts` | `cn()` utility for Tailwind class merging |
| `lib/sanitize.ts` | HTML sanitization + GitHub README HTML parsing for `HtmlRenderer` |
| `components/ui/` | Reusable UI components (Button, Card, Badge, Progress, Input, Select, etc.) |
| `components/HtmlRenderer.tsx` | Structured result cards — renders sanitized HTML for GitHub/twitter/bookmark/history sources |
| `i18n/` | Type-safe i18n with `useI18n()` hook; locales: zh-CN, en, ja, ko |
| `polyfills.ts` | Cross-browser polyfills (e.g. `AbortSignal.timeout` for Firefox <124) |

### Entry points

| File | Purpose |
|------|---------|
| `entrypoints/background.ts` | Service worker: omnibox handlers, message passing, indexer init, Gist sync scheduling |
| `entrypoints/popup/` | Solid.js popup UI (`.tsx`) — stats, recent bookmarks, indexing HUD |
| `entrypoints/options/` | Solid.js settings page (`.tsx`) — API keys, indexing controls, folder tree, GitHub/Twitter/History/Gist config |
| `entrypoints/search/` | Solid.js full-page search UI (`.tsx`) — independent search page with source/folder filters |
| `entrypoints/content.ts` | Content script placeholder |

### Message types (background.ts `onMessage` switch)

Synchronous: `GET_INDEXING_STATUS`

Async: `FULL_SEARCH`, `START_INDEXING`, `PAUSE_INDEXING`, `RESUME_INDEXING`, `RETRY_FAILED`, `GET_FAILED_BOOKMARKS`, `DELETE_BOOKMARK`, `GET_BOOKMARK_FOLDERS`, `INDEX_FOLDERS`, `SYNC_GITHUB_STARS`, `SYNC_TWITTER_BOOKMARKS`, `SYNC_HISTORY`, `GET_CACHE_STATS`, `CLEAR_EMBEDDING_CACHE`, `GIST_SYNC`, `GIST_CREATE`, `GIST_LINK`, `GIST_UPLOAD`, `GIST_DOWNLOAD`

### Data flow

**Omnibox search:** `onInputChanged` → debounce 150ms + AbortController → `ensureCachedIndexedBookmarks` (in-memory cache) → `getQueryEmbedding` → `hybridSearch` / `vectorSearch` with min-max normalized RRF fusion → suggestions (max 9) → `browser.omnibox.setDefaultSuggestion`

**Full-page search:** popup/options or Enter in omnibox → `performFullSearch` → same pipeline as omnibox but returns `SearchResult[]` DTOs (max 20) with source/folder filters (`/github`, `/twitter`, `/history`, `/folder:name`)

**Hybrid/vector search:** query → `getQueryEmbedding` (cached or API) → `hybridSearch` (RRF fusion with normalized scores) or `vectorSearch` (pure semantic) → results. Vector search uses pure JS cosine similarity over the in-memory cache — no WASM or external vector DB.

**Indexing pipeline:** bookmark URL → Jina AI Reader (extract markdown) → `llm.ts` (generate summary/tags via DeepSeek-V3) → `embedding.ts` (BGE-M3 vector with native batch API) → Dexie IndexedDB → update in-memory cache

**GitHub Stars sync:** fetch with early-exit when all URLs already indexed → background enrichment queue resumes on SW restart

**Twitter/X sync:** auto-extract cookies via `browser.cookies` (fallback to manual input) → GraphQL API with retry/rate-limit handling → convert to BookmarkRecord with Twitter-specific metadata → enqueue for indexing

**History sync:** `browser.history.search` → filter system URLs → skip already-indexed URLs → convert to BookmarkRecord (`hi-` prefix IDs) → upsert to IndexedDB → enqueue for indexing

**Gist sync:** bookmark CRUD events → debounced 5s trigger → `browser.bookmarks.getTree` → union merge with remote Gist → apply local deletions (30-day TTL) → update Gist. Uses `gistSyncLock` to prevent recursion during sync.

**Message passing:** popup/options ↔ background via `browser.runtime.sendMessage` / `onMessage.addListener` with string-literal action types in a `switch` statement.

### Key patterns

**RRF Fusion:** Hybrid search combines keyword and vector scores using Reciprocal Rank Fusion with min-max normalization for fair weighting.

**Rate Limiting:** `indexer.ts` uses exponential backoff for API calls. Respects SiliconFlow rate limits and gracefully handles 429 responses.

**Frequency Weighting:** `freq.ts` tracks bookmark visit counts with debounced writes to `browser.storage.local`. Integrated into ranking via `db.ts`.

**Twitter Sync:** Auto-extracts cookies via `browser.cookies` API with manual fallback. GraphQL API sync includes retry logic and persisted queue recovery on SW restart.

**Early-Exit Pagination:** GitHub Stars sync uses early-exit when all URLs already indexed to avoid unnecessary pagination.

## Adding New Features

1. **New core logic** → add to `src/` as a dedicated module
2. **New browser API usage** → only in `entrypoints/`; call typed `src/` functions
3. **New message type** → add a `case` to the `switch` in `background.ts` `onMessage` handler
4. **New settings field** → extend `Settings` in `types.ts`, add to `defaultSettings` in `db.ts`
5. **New DB column** → bump the Dexie version in `db.ts` with a migration
6. **Always verify:** `pnpm compile` before finishing

## Code Style

### TypeScript

- **Interfaces vs Types:** Use `interface` for exported object shapes (e.g., `BookmarkRecord`, `Settings`). Use `type` for unions, aliases, and function-scoped shapes (e.g., `SearchMode`).
- **Type safety:** never `as any` or `@ts-ignore` — use `instanceof Error` for error handling. Explicit `as` casts only for untyped browser APIs.
- **Imports:** Framework/library imports first, then internal imports. Use `import type` for type-only imports. Path aliases: `@/*` → `./src/*`, `~/*` → `./*` — use `@/` in entrypoints for `src/` imports.

```ts
// Correct
import type { BookmarkRecord } from "@/types";
import { hybridSearch } from "@/hybrid";
import { createSignal, For } from "solid-js";
```

- **Functions:** Prefer named `function` declarations for exported top-level functions. Arrow functions for callbacks and event handlers.
- **JSDoc:** One-line `/** Brief description */` on all exported functions.

### Formatting and Naming

- **Indentation:** 2 spaces. **Quotes:** double. **Semicolons:** always. **Trailing commas:** in multi-line
- `camelCase` for variables/functions, `SCREAMING_SNAKE_CASE` for module-level constants, `PascalCase` for interfaces/types/classes/components
- `async/await` throughout — no raw `.then()` chains except fire-and-forget: `promise().catch(() => {})`
- Error logging: `console.error('[ModuleName] Description:', error)` — prefixes like `[FlowSearch]`, `[indexer]`, `[hybrid]`
- Chinese comments are present in the codebase — match the language of surrounding code
- Solid.js UI: use `class` (not `className`), `createSignal`/`For`/`Show` from `solid-js`
- Tailwind v3 with shadcn-style HSL CSS variables (`hsl(var(--primary))`), dark mode via `prefers-color-scheme`

### Error Handling

- All async entry-point logic must be wrapped in `try/catch`
- Log with prefix: `console.error('[ModuleName] Description:', error)`
- Use `console.warn` for recoverable failures (rate limits, missing data)
- Propagate errors up — don't swallow silently in library code (`src/`)

## Browser Extension Constraints

- **MV3 service worker (Chrome)** / **non-persistent background page (Firefox)** — no persistent background page. Avoid large in-memory state; use `browser.storage.local` or IndexedDB. WXT abstracts the difference; same `background.ts` entrypoint works for both.
- **In-memory cache optimization** — `ensureCachedIndexedBookmarks()` loads all indexed bookmarks into memory on background startup for fast omnibox search (no IndexedDB queries in hot path). Cache stays warm during session, rebuilt on restart
- **Omnibox descriptions must be XML-escaped** — always use `escapeXml()` from `highlight.ts`; only `<match>`, `<dim>`, `<url>` tags are valid
- `browser.*` APIs are globally available in entry points via WXT auto-injection — no explicit import needed
- Message passing: return `true` from `onMessage` listener to keep channel open for async responses

## Cross-Browser Compatibility

WXT handles most manifest differences automatically. Code-level considerations:

- **Never use `chrome.*` APIs directly** — always use `browser.*` (WXT polyfills Chrome to Promise-based API)
- **`AbortSignal.timeout`** — polyfilled in `src/polyfills.ts` for Firefox <124; imported at `background.ts` startup
- **`browser.cookies`** — works on both browsers; ensure host permissions for target domains are declared in manifest
- **`browser.history`** — Firefox requires `history` permission (same as Chrome)
- **Firefox MV3** uses `background.scripts` (non-persistent page) instead of `service_worker`; WXT generates the correct manifest per target

## API Dependencies

- **SiliconFlow API Key** — required for embeddings (BGE-M3) and LLM summaries (DeepSeek-V3). Configured in extension options
- **Jina AI Reader** (`https://r.jina.ai/*`) — free, no key needed, used for content extraction
- **GitHub PAT** — optional, for syncing starred repos and Gist bookmark sync
- **Twitter/X cookies** — optional, auto-extracted via `browser.cookies` API (requires `cookies` permission + `https://x.com/*` host_permissions), with manual fallback for auth tokens
