# Repository Guidelines

Guidance for AI coding agents operating in this repository.

**Flow Search** is a Manifest V3 browser extension for AI-powered bookmark search. Trigger: type `bi <keyword>` in the omnibox.

Stack: **WXT** · **TypeScript** · **Solid.js** · **Tailwind CSS** · **Dexie.js** · **Orama** · **SiliconFlow BGE-M3**

---

## Project Overview

Flow Search indexes browser bookmarks with AI-generated summaries, tags, and embeddings, then provides fast hybrid search (keyword + vector) through the Chrome omnibox and a dedicated search page. It supports syncing bookmarks across devices via GitHub Gist, WebDAV, Google Drive, Dropbox, or generic blob storage, and includes a tag-cloud explorer and RAG-based Q&A over the bookmark corpus.

---

## Architecture & Data Flow

### Strict Layer Separation

| Directory | Purpose |
|-----------|---------|
| `src/` | Pure business logic — no browser globals (`browser.*`, `document`, `window`), no framework deps |
| `entrypoints/` | Browser entry points that wire `src/` functions to browser APIs |

**Critical rule:** Never import `browser.*` inside `src/`. Entry points call `src/` functions and inject browser-specific callbacks.

### Data Flows

1. **Omnibox search:** query → `getQueryEmbedding()` (cached) → `searchHybrid()` in Orama engine → frequency-boosted results → omnibox suggestions with XML-escaped descriptions
2. **Indexing:** bookmark URL → content extraction (active tab → `@mozilla/readability` → Jina Reader fallback) → `llm.ts` (DeepSeek-V3 summaries/tags) → `embedding.ts` (SiliconFlow BGE-M3 batch API) → Dexie IndexedDB + Orama search engine
3. **Full-page search:** Same pipeline as omnibox, surfaced in `entrypoints/search/` Solid.js UI
4. **RAG Q&A:** `rag.ts` → vector search via `searchVector()` → assemble context (max 6000 chars) → LLM completion with citations
5. **Tag cloud explorer:** `tag-cloud.ts` builds hierarchical tag clouds with co-occurrence drill-down; rendered in `entrypoints/graph/`
6. **Sync:** `gist-sync.ts` (GitHub Gist), `cloud-sync/` (WebDAV, Google Drive, Dropbox, Blob) — union merge with deletion tracking

### In-Memory Cache Hot Path

`db.ts` loads all indexed bookmarks into RAM on service worker startup (`ensureCachedIndexedBookmarks()`). Omnibox queries avoid IndexedDB round trips. Cache invalidates on SW restart.

---

## Key Directories

| Path | Purpose |
|------|---------|
| `src/` | Core logic modules — search, indexing, embeddings, sync, RAG, dedup, tag cloud, i18n |
| `src/ai-providers/` | LLM provider abstraction: `llm-base.ts`, `llm-remote.ts`, `detect.ts`, `types.ts` |
| `src/cloud-sync/` | Multi-provider sync: `webdav.ts`, `google-drive.ts`, `dropbox.ts`, `blob.ts`, `bookmark-sync.ts` |
| `src/components/ui/` | Reusable UI primitives (Button, Card, Badge, Progress, Input, Select, etc.) |
| `src/i18n/` | Type-safe i18n system; locales: `zh-CN`, `en`, `ja`, `ko` — use `t('key')` |
| `entrypoints/background.ts` | Service worker — omnibox handlers, message router, indexer init, sync scheduling |
| `entrypoints/popup/` | Extension popup UI (Solid.js) |
| `entrypoints/options/` | Settings page — API keys, indexing controls, folder filters, sync config |
| `entrypoints/search/` | Full-page search UI (Solid.js) |
| `entrypoints/graph/` | Tag cloud visualization with `TagCloud.tsx` and `BookmarkPanel.tsx` |
| `entrypoints/content.ts` | Content script placeholder |
| `docs/superpowers/` | Plans, specs, changelog, roadmap |

---

## Development Commands

```bash
pnpm install       # Install dependencies (auto-runs wxt prepare via postinstall)
pnpm dev           # Dev server with HMR → .output/chrome-mv3/
pnpm dev:firefox   # Firefox dev server
pnpm dev:edge      # Edge dev server (add to package.json if needed)
pnpm build         # Production build (Chrome MV3)
pnpm build:firefox # Production build (Firefox MV3)
pnpm build:edge    # Edge production build
pnpm zip           # Package as .zip for distribution
pnpm zip:firefox   # Firefox zip package
pnpm zip:edge      # Edge zip package
pnpm compile       # TypeScript type-check only (tsc --noEmit)
```

**No test runner is configured.** Manual testing: load `.output/chrome-mv3/` unpacked in `chrome://extensions/`.

**Always run `pnpm compile` before marking work done.**

---

## Code Conventions & Common Patterns

### Formatting

- **2-space indent**, double quotes, semicolons always, trailing commas in multiline params/objects
- Import order: framework/libs first, then internal. `import type` for type-only imports
- Relative paths without extension: `import { fn } from './module'`
- Path aliases: `@/*` → `./src/*`, `~/*` → `./*` (use `@/` in entrypoints for `src/` imports)

### Naming

| Category | Case |
|----------|------|
| Variables, functions | `camelCase` |
| Module constants | `SCREAMING_SNAKE_CASE` |
| Interfaces, types, classes, components | `PascalCase` |
| Files | `camelCase` (modules), `PascalCase` (components) |

### TypeScript

- `interface` for exported object shapes; `type` for unions, aliases, function-scoped shapes
- Never use `as any` or `@ts-ignore` — fix the root type issue
- `instanceof Error` for error handling: `error instanceof Error ? error.message : String(error)`
- Explicit `as` casts only for untyped browser APIs (e.g., `document.getElementById('x') as HTMLInputElement`)

### Functions & Async

- Named `function` declarations for exported top-level functions; arrow functions for callbacks
- `async/await` throughout — no `.then()` chains except fire-and-forget: `promise().catch(() => {})`
- JSDoc on all exported functions: `/** One-line description */`
- Chinese comments exist in codebase — match surrounding comment language

### Error Handling

- All async entry-point logic wrapped in `try/catch`
- Log prefix: `console.error('[ModuleName] Description:', error)`
- Common prefixes: `[FlowSearch]`, `[indexer]`, `[hybrid]`, `[search]`, `[vectorSearch]`
- `console.warn` for recoverable failures (rate limits, missing data)
- Propagate errors up in library code — don't swallow silently

### State Management & DI

- **No global state manager.** IndexedDB (`db.ts`) is the source of truth
- **Dependency injection via callbacks:** `search-engine.ts` uses `registerSaveFn()` to inject browser.storage persistence from `background.ts`
- **In-memory cache** in `db.ts` for omnibox hot path; debounced writes in `freq.ts`
- **Message passing** for cross-context communication: return `true` from `onMessage` listener to keep channel open for async responses

---

## Important Files

### Entry Points

| File | Purpose |
|------|---------|
| `entrypoints/background.ts` | Service worker (~1700 lines). Omnibox handlers (150ms debounce + AbortController), message passing router (40+ message types), indexer initialization, Gist/cloud sync scheduling |
| `entrypoints/popup/App.tsx` | Extension popup UI |
| `entrypoints/options/App.tsx` | Settings page UI |
| `entrypoints/search/App.tsx` | Full-page search UI |
| `entrypoints/graph/App.tsx` | Tag cloud visualization page |
| `entrypoints/content.ts` | Content script placeholder |

### Core Modules

| File | Responsibility |
|------|---------------|
| `src/types.ts` | All shared interfaces (`BookmarkRecord`, `Settings`, `SearchMode`, `SearchResult`, `DuplicateGroup`) |
| `src/db.ts` | Dexie.js IndexedDB + `browser.storage.local` settings + in-memory cache for omnibox hot path |
| `src/search-engine.ts` | Orama search engine wrapper — keyword/vector/hybrid search with frequency boost, persistence callback injection |
| `src/search.ts` | Legacy keyword-only search + Levenshtein fuzzy reranking (sliding window). Retained as fallback |
| `src/hybrid.ts` | RRF hybrid search (keyword + vector fusion) with min-max normalization. Legacy, largely superseded by `search-engine.ts` |
| `src/embedding.ts` | SiliconFlow BGE-M3 API client with LRU cache + AbortSignal + batch API |
| `src/llm.ts` | SiliconFlow Chat API (DeepSeek-V3) for summaries/tags |
| `src/ai-providers/` | LLM provider abstraction — `llm-base.ts`, `llm-remote.ts`, `detect.ts`, `types.ts` |
| `src/indexer.ts` | Background indexing queue with rate-limiting, exponential backoff, enrichment recovery |
| `src/freq.ts` | Visit frequency cache with debounced writes to `browser.storage.local` |
| `src/rag.ts` | RAG Q&A over bookmark corpus — vector search → context assembly → LLM with citations |
| `src/tag-cloud.ts` | Hierarchical tag cloud with co-occurrence drill-down, fallback tag extraction from titles/URLs |
| `src/dedup.ts` | Duplicate bookmark detector — finds duplicate URLs, builds folder path maps, resolves duplicates |
| `src/categorize.ts` | AI categorization of bookmarks |
| `src/health.ts` | Health checks for extension state |
| `src/highlight.ts` | XML escaping for omnibox `<match>/<dim>/<url>` tags |
| `src/history.ts` | Browser history sync — converts `browser.history` items to `BookmarkRecord` |
| `src/github.ts` | GitHub Stars fetching via Octokit with early-exit pagination |
| `src/gist-sync.ts` | GitHub Gist multi-device bookmark sync (union merge, 900 KB size guard, deletion tracking) |
| `src/cloud-sync/` | WebDAV, Google Drive, Dropbox, Blob sync providers + `bookmark-sync.ts` orchestrator |
| `src/twitter.ts` | Twitter/X GraphQL API client with retry logic |
| `src/twitter-cookies.ts` | Auto-extraction of Twitter cookies via `browser.cookies` API |
| `src/bookmarkRoots.ts` | Cross-browser bookmark root role mapping (Chrome ↔ Firefox normalization) |
| `src/polyfills.ts` | `AbortSignal.timeout` polyfill for Firefox <124; import once in `background.ts` |
| `src/lib/utils.ts` | `cn()` utility for Tailwind class merging |
| `src/lib/sanitize.ts` | Sanitization utilities |

### Config Files

| File | Purpose |
|------|---------|
| `wxt.config.ts` | WXT build config — manifest metadata, permissions, omnibox keyword `bi`, modules |
| `tsconfig.json` | Extends `.wxt/tsconfig.json`, Solid.js JSX preserve, path aliases `@/*` and `~/*` |
| `tailwind.config.js` | Tailwind v3 with HSL CSS variables + dark mode |
| `postcss.config.js` | PostCSS with Tailwind + autoprefixer |

---

## Runtime/Tooling Preferences

- **Package manager:** `pnpm` (lockfile: `pnpm-lock.yaml`)
- **Runtime:** Node.js (no Bun-specific features)
- **Build system:** WXT (`^0.20.20`) — handles Manifest V3 generation, HMR, and cross-browser builds
- **UI framework:** Solid.js (`^1.9.11`) with `@wxt-dev/module-solid`
- **Styling:** Tailwind CSS v3 with HSL CSS variables, dark mode support
- **Database:** Dexie.js (`^4.3.0`) for IndexedDB
- **Search engine:** Orama (`^3.1.18`) for full-text, vector, and hybrid search
- **Browser targets:** Chrome MV3, Firefox MV3, Edge MV3

---

## Testing & QA

**No test runner is configured.** QA is manual:

1. Run `pnpm dev` and load `.output/chrome-mv3/` as an unpacked extension in `chrome://extensions/`
2. Test omnibox search with `bi <query>`
3. Test popup, options, search page, and graph page UIs
4. Verify indexing flow by adding bookmarks and checking for summaries/tags
5. Run `pnpm compile` for TypeScript type-checking

**Before finishing any change:**
```bash
pnpm compile   # Must pass
```

---

## Browser Extension Constraints

- **MV3 service worker** — no persistent background page. Use `browser.storage.local` or IndexedDB for state
- **`browser.*` APIs only** — never `chrome.*` (WXT polyfills Chrome to Promise-based API)
- **Omnibox XML escaping** — always use `escapeXml()` from `highlight.ts` before inserting strings into suggestion descriptions. Only valid tags: `<match>`, `<dim>`, `<url>`
- **Message passing** — return `true` from `onMessage` listener to keep channel open for async responses
- **Firefox MV3** uses `background.scripts` instead of `service_worker`; WXT handles manifest generation per target
- **Content extraction order:** Active Tab (fastest) → Local Readability (`@mozilla/readability`) → Jina Reader (`https://r.jina.ai/*`) network fallback

---

## API Dependencies

- **SiliconFlow API Key** — required for BGE-M3 embeddings and DeepSeek-V3 summaries/tags (configured in options page)
- **Jina AI Reader** (`https://r.jina.ai/*`) — free, no key; used for content extraction fallback
- **GitHub PAT** — optional, for syncing starred repos and Gist sync
- **Twitter/X cookies** — optional, auto-extracted via `browser.cookies` API; manual fallback also supported

---

## Adding New Features

1. **New core logic** → add to `src/` as a dedicated module with JSDoc
2. **New browser API usage** → only in `entrypoints/`; expose typed function from `src/` and call from entry point
3. **New message type** → add `case` to `switch` in `background.ts` `onMessage` handler
4. **New settings field** → extend `Settings` in `types.ts`, add to `defaultSettings` in `db.ts`
5. **New DB column** → bump Dexie version in `db.ts` with migration
6. **Always verify:** `pnpm compile` before finishing
