# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Flow Search** is a Manifest V3 Chrome extension for AI-powered bookmark search. Trigger: type `bi <keyword>` in Chrome's omnibox. Supports keyword, vector (semantic), and hybrid search modes using SiliconFlow BGE-M3 embeddings. Also indexes GitHub starred repos.

Stack: WXT framework, TypeScript, Solid.js (popup/options UI), Dexie.js (IndexedDB), SiliconFlow BGE-M3 (embeddings), Jina AI Reader (content extraction), Octokit (GitHub API).

## Commands

```bash
pnpm install       # Install deps (auto-runs wxt prepare via postinstall)
pnpm dev           # Dev server with HMR → .output/chrome-mv3/
pnpm dev:firefox   # Firefox dev server
pnpm build         # Production build (Chrome MV3)
pnpm build:firefox # Production build (Firefox MV3)
pnpm zip           # Package as .zip for distribution
pnpm compile       # TypeScript type-check only (tsc --noEmit)
```

**No test runner is configured.** Manual testing only: load unpacked from `.output/chrome-mv3/` in `chrome://extensions/`.

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
| `types.ts` | All shared interfaces (`BookmarkRecord`, `Settings`, `SearchMode`, etc.) |
| `db.ts` | Dexie.js IndexedDB wrapper + `browser.storage.local` settings + in-memory cache for indexed bookmarks |
| `embedding.ts` | SiliconFlow BGE-M3 API client with LRU cache + AbortSignal support |
| `hybrid.ts` | RRF hybrid search with min-max normalization |
| `search.ts` | Keyword-only search + Levenshtein fuzzy (sliding window) reranking |
| `vector.ts` | Cosine similarity utilities |
| `vectorWorkerManager.ts` | Web Worker for offloading vector computations |
| `indexer.ts` | Background indexing queue with rate-limiting, enrichment queue recovery on restart |
| `freq.ts` | Visit frequency cache with debounced writes |
| `highlight.ts` | XML escaping for omnibox `<match>/<dim>/<url>` tags |
| `github.ts` | GitHub Stars fetching via Octokit with streaming pagination + early-exit |
| `llm.ts` | SiliconFlow Chat API (DeepSeek-V3) for summaries/tags |

### Entry points

| File | Purpose |
|------|---------|
| `entrypoints/background.ts` | Service worker: omnibox handlers, message passing, indexer init |
| `entrypoints/popup/` | Solid.js popup UI (`.tsx`) |
| `entrypoints/options/` | Vanilla TS settings page |
| `entrypoints/content.ts` | Content script placeholder |

### Data flow

**Omnibox search:** `onInputChanged` → debounce 150ms + AbortController → `ensureCachedIndexedBookmarks` (in-memory cache) → `getQueryEmbedding` → `hybridSearch` / `vectorSearch` with min-max normalized RRF fusion → suggestions (max 9) → `browser.omnibox.setDefaultSuggestion`

**Hybrid/vector search:** query → `getQueryEmbedding` (cached or API) → `hybridSearch` (RRF fusion with normalized scores) or `vectorSearch` (pure semantic) → results

**Indexing pipeline:** bookmark URL → Jina AI Reader (extract markdown) → `llm.ts` (generate summary/tags via DeepSeek-V3) → `embedding.ts` (BGE-M3 vector) → Dexie IndexedDB → update in-memory cache

**GitHub Stars sync:** fetch with early-exit when all URLs already indexed → background enrichment queue resumes on SW restart

**Message passing:** popup/options ↔ background via `browser.runtime.sendMessage` / `onMessage.addListener` with string-literal action types in a `switch` statement.

## Adding New Features

1. **New core logic** → add to `src/` as a dedicated module
2. **New browser API usage** → only in `entrypoints/`; call typed `src/` functions
3. **New message type** → add a `case` to the `switch` in `background.ts` `onMessage` handler
4. **New settings field** → extend `Settings` in `types.ts`, add to `defaultSettings` in `db.ts`
5. **New DB column** → bump the Dexie version in `db.ts` with a migration

## Code Style

- **Indentation:** 2 spaces. **Quotes:** double. **Semicolons:** always. **Trailing commas:** in multi-line
- `camelCase` for variables/functions, `SCREAMING_SNAKE_CASE` for module-level constants, `PascalCase` for interfaces/types/classes/components
- Use `import type` for type-only imports
- `async/await` throughout — no raw `.then()` chains except fire-and-forget
- Error logging: `console.error('[ModuleName] Description:', error)` — prefixes like `[FlowSearch]`, `[indexer]`, `[hybrid]`
- Chinese comments are present in the codebase — match the language of surrounding code

## Browser Extension Constraints

- **MV3 service worker** — no persistent background page. Avoid large in-memory state; use `browser.storage.local` or IndexedDB
- **Omnibox descriptions must be XML-escaped** — always use `escapeXml()` from `highlight.ts`; only `<match>`, `<dim>`, `<url>` tags are valid
- `browser.*` APIs are globally available in entry points via WXT auto-injection — no explicit import needed
- Message passing: return `true` from `onMessage` listener to keep channel open for async responses

## API Dependencies

- **SiliconFlow API Key** — required for embeddings (BGE-M3) and LLM summaries (DeepSeek-V3). Configured in extension options
- **Jina AI Reader** (`https://r.jina.ai/*`) — free, no key needed, used for content extraction
- **GitHub PAT** — optional, for syncing starred repos
