# AGENTS.md — Flow Search

Guidance for AI coding agents operating in this repository.

**Flow Search** is a Manifest V3 Chrome extension for AI-powered bookmark search.
Trigger: type `bi <keyword>` in Chrome's omnibox.

Stack: **WXT** · **TypeScript** · **Solid.js** (popup/options UI) · **Dexie.js** (IndexedDB) · **SiliconFlow BGE-M3** (embeddings)

---

## Commands

```bash
pnpm install       # Install dependencies (auto-runs wxt prepare via postinstall)
pnpm dev           # Dev server with HMR → .output/chrome-mv3/
pnpm dev:firefox   # Firefox dev server
pnpm build         # Production build (Chrome MV3)
pnpm build:firefox # Production build (Firefox MV3)
pnpm zip           # Package as .zip for distribution
pnpm compile       # TypeScript type-check only (tsc --noEmit)
```

**No test runner configured.** Manual testing: load unpacked from `.output/chrome-mv3/` in `chrome://extensions/`.

**Always run `pnpm compile` before marking work done.**

---

## Architecture

### Layer separation (strict)

| Directory | Purpose |
|-----------|---------|
| `src/` | Pure logic — no browser globals, no framework deps |
| `entrypoints/` | Browser entry points wired to `src/` logic |

**Rule:** Never import `browser.*` inside `src/`. Entry points call `src/` functions and wire up browser APIs.

### Entry points

| File | Purpose |
|------|---------|
| `entrypoints/background.ts` | Service worker: omnibox handlers (150ms debounce + AbortController), message passing switch, indexer init, Gist sync scheduling |
| `entrypoints/popup/` | Solid.js popup UI (`.tsx`) |
| `entrypoints/options/` | Solid.js settings page (`.tsx`) — API keys, indexing controls, folder tree, GitHub/Twitter/History/Gist config |
| `entrypoints/search/` | Solid.js full-page search UI (`.tsx`) |
| `entrypoints/content.ts` | Content script placeholder |

### Key `src/` modules

| File | Responsibility |
|------|---------------|
| `types.ts` | All shared interfaces (`BookmarkRecord`, `Settings`, `SearchMode`, `SearchResult`) |
| `db.ts` | Dexie.js IndexedDB wrapper + `browser.storage.local` settings + in-memory cache for omnibox hot path |
| `embedding.ts` | SiliconFlow BGE-M3 API client with LRU cache + AbortSignal + batch API |
| `hybrid.ts` | RRF hybrid search (keyword + vector fusion) with min-max normalization |
| `search.ts` | Keyword-only search + Levenshtein fuzzy reranking (sliding window) |
| `indexer.ts` | Background indexing queue with rate-limiting, exponential backoff, enrichment recovery |
| `freq.ts` | Visit frequency cache with debounced writes to `browser.storage.local` |
| `highlight.ts` | XML escaping for omnibox `<match>/<dim>/<url>` tags |
| `llm.ts` | SiliconFlow Chat API (DeepSeek-V3) for summaries/tags |
| `github.ts` | GitHub Stars fetching via Octokit with early-exit pagination |
| `twitter.ts` | Twitter/X GraphQL API client with retry logic |
| `twitter-cookies.ts` | Auto-extraction of Twitter cookies via `browser.cookies` API |
| `history.ts` | Browser history sync — converts `browser.history` items to `BookmarkRecord` |
| `gist-sync.ts` | GitHub Gist multi-device bookmark sync (union merge, 900 KB size guard, deletion tracking) |
| `polyfills.ts` | `AbortSignal.timeout` polyfill for Firefox <124; import once in `background.ts` |
| `i18n/index.ts` | Type-safe i18n system; locales: `zh-CN`, `en`, `ja`, `ko`; use `t('key')` |
| `bookmarkRoots.ts` | Cross-browser bookmark root role mapping (Chrome ↔ Firefox normalization) |
| `lib/utils.ts` | `cn()` utility for Tailwind class merging |
| `components/ui/` | Reusable UI components (Button, Card, Badge, Progress, Input, Select, etc.) |
| `vectorWorkerManager.ts` | Legacy — unused, do not reference |

### Message types (background.ts `onMessage` switch)

Synchronous: `GET_INDEXING_STATUS`

Async: `FULL_SEARCH`, `START_INDEXING`, `PAUSE_INDEXING`, `RESUME_INDEXING`, `RETRY_FAILED`, `GET_FAILED_BOOKMARKS`, `DELETE_BOOKMARK`, `GET_BOOKMARK_FOLDERS`, `INDEX_FOLDERS`, `SYNC_GITHUB_STARS`, `SYNC_TWITTER_BOOKMARKS`, `SYNC_HISTORY`, `GET_CACHE_STATS`, `CLEAR_EMBEDDING_CACHE`, `GIST_SYNC`, `GIST_CREATE`, `GIST_LINK`

---

## Code & TypeScript Style

- **2-space indent**, double quotes, semicolons always, trailing commas in multiline
- `camelCase` for vars/functions, `SCREAMING_SNAKE_CASE` for module constants, `PascalCase` for interfaces/types/classes/components
- `interface` for exported object shapes; `type` for unions/aliases/function-scoped shapes
- **Never** `as any` or `@ts-ignore` — fix the root type issue. `instanceof Error` for error handling. `as` casts only for untyped browser APIs
- Named `function` declarations for exported top-level functions; arrow functions for callbacks
- `async/await` throughout — no `.then()` except fire-and-forget: `promise().catch(() => {})`
- JSDoc on all exported functions: `/** One-line description */`
- Chinese comments present in codebase — match surrounding comment language
- Import order: framework/libs first, then internal. `import type` for type-only. Relative paths, no extension
- Path aliases: `@/*` → `./src/*`, `~/*` → `./*` (use `@/` for src imports in entrypoints)
- `browser.*` APIs globally available in entry points via WXT auto-injection — no explicit import
- Error logging: `console.error('[ModuleName] Description:', error)` with prefixes `[FlowSearch]`, `[indexer]`, `[hybrid]`, `[vectorSearch]`

---

## Browser Extension Constraints

- **MV3 service worker** — no persistent background page. Use `browser.storage.local` or IndexedDB for state
- **Omnibox descriptions must be XML-escaped** — always use `escapeXml()` from `highlight.ts`. Only valid tags: `<match>`, `<dim>`, `<url>`
- **In-memory cache hot path:** `ensureCachedIndexedBookmarks()` loads all indexed bookmarks into RAM on SW startup — omnibox queries avoid IndexedDB round trips. Cache invalidates on SW restart.
- **Content extraction order:** Active Tab (fastest) → Local Readability → Jina Reader (network fallback; requires `https://r.jina.ai/*` host permission)
- **Message passing:** return `true` from `onMessage` listener to keep channel open for async responses
- **Firefox MV3** uses `background.scripts` (non-persistent page) instead of `service_worker`; WXT handles manifest generation per target
- **Never use `chrome.*`** — always `browser.*` (WXT polyfills Chrome to Promise-based API)

---

## API Dependencies

- **SiliconFlow API Key** — required for BGE-M3 embeddings and DeepSeek-V3 summaries/tags (configured in options page)
- **Jina AI Reader** (`https://r.jina.ai/*`) — free, no key; used for content extraction
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
