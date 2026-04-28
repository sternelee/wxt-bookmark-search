# AGENTS.md — Flow Search

Guidance for AI coding agents operating in this repository.

## Project Overview

**Flow Search** is a Manifest V3 Chrome extension for AI-powered bookmark search.
Trigger: type `bi <keyword>` in Chrome's omnibox.

Stack: **WXT** · **TypeScript** · **Solid.js** (popup/options UI) · **Dexie.js** (IndexedDB) · **SiliconFlow BGE-M3** (embeddings, cosine similarity search)

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

**No test runner is configured.** Manual testing: Load unpacked from `.output/chrome-mv3/` in `chrome://extensions/`.

**Type-check before marking work done:**
```bash
pnpm compile
```

---

## Architecture

### Layer separation (strict)

| Directory | Purpose |
|-----------|---------|
| `src/` | Pure logic — no framework deps, no browser entry-point globals |
| `entrypoints/` | Browser entry points wired to `src/` logic |
| `entrypoints/background.ts` | Service worker (omnibox handlers, message passing) |
| `entrypoints/popup/` | Solid.js popup UI (`.tsx`) |
| `entrypoints/options/` | Solid.js settings page (API keys, indexing controls, folder filters) |
| `entrypoints/search/` | Solid.js full-text search page (standalone, outside popup) |
| `entrypoints/content.ts` | Content script (page-level extraction) |

**Rule:** Core logic stays in `src/`. Entry points only wire up browser APIs and call `src/` functions. Never import `browser.*` globals directly inside `src/` files.

### Key src/ modules

| File | Responsibility |
|------|---------------|
| `types.ts` | All shared TypeScript interfaces (`BookmarkRecord`, `Settings`, `SearchMode`, etc.) |
| `db.ts` | Dexie.js IndexedDB wrapper + `browser.storage.local` settings |
| `embedding.ts` | SiliconFlow BGE-M3 API client with LRU cache |
| `hybrid.ts` | RRF hybrid search (keyword + vector fusion) with min-max normalization |
| `search.ts` | Keyword-only search + Levenshtein fuzzy reranking |
| `freq.ts` | Visit frequency cache (persisted to `browser.storage.local`) |
| `highlight.ts` | XML escaping for omnibox `<match>/<dim>/<url>` tags |
| `indexer.ts` | Background indexing queue with rate-limiting & exponential backoff |
| `vectorIndex.ts` | EdgeVec HNSW wrapper with URL-to-ID mapping, BQ search, persistence |
| `vector.ts` | Cosine similarity utilities (fallback/debugging) |
| `github.ts` | GitHub Stars fetching with early-exit pagination |
| `twitter.ts` | Twitter/X GraphQL API client for bookmarks sync |
| `twitter-cookies.ts` | Auto-extraction of Twitter cookies from browser |
| `llm.ts` | SiliconFlow Chat API for summaries/tags |
| `vectorWorkerManager.ts` | Legacy Worker code (deprecated, unused) |
| `bookmarkRoots.ts` | Cross-browser bookmark root role mapping (Chrome ↔ Firefox root normalization) |
| `gist-sync.ts` | GitHub Gist multi-device bookmark sync (union merge strategy, 900 KB size guard) |
| `history.ts` | Browser history sync — converts `browser.history` items to `BookmarkRecord` |
| `polyfills.ts` | Cross-browser polyfills (AbortSignal.timeout for Firefox <124); import once in background |
| `i18n/index.ts` | Type-safe i18n system; supported locales: `zh-CN`, `en`, `ja`, `ko`; use `t('key')` |
| `lib/utils.ts` | `cn()` utility for Tailwind class merging |
| `components/ui/` | Reusable UI components (Button, Card, Badge, Progress, Input, Select, etc.) |

---

## TypeScript Style

### Types vs Interfaces
- Use `interface` for object shapes that may be extended or implemented (e.g., `BookmarkRecord`, `Settings`)
- Use `type` for unions, aliases, and local-scope shapes (e.g., `SearchMode = 'keyword' | 'vector' | 'hybrid'`, local `BookmarkInput`)
- Prefer `type` for local function-scope shapes; `interface` for exported data models

### Type safety
- **Never** use `as any` or `@ts-ignore` — fix the root type issue
- Use explicit `as` casts only when interfacing with untyped browser APIs (e.g., `document.getElementById('x') as HTMLInputElement`)
- Prefer `error instanceof Error ? error.message : String(error)` over untyped `catch(e)`
- Use `error: any` in catch clauses only when re-accessing `.message` afterward

### Imports
- Framework/library imports first, then internal imports
- Internal imports use relative paths with no file extension: `import { fn } from './module'`
- `background.ts` omits `.js` extension; `search.ts` uses `.js` (both are acceptable — match the file you're editing)
- Use `import type` for type-only imports: `import type { BookmarkRecord } from './types'`
- Named imports preferred; no default imports from internal modules except Solid.js components
- Path aliases available: `@/*` → `./src/*`, `~/*` → `./*` (use `@/` for src imports in entrypoints)

```ts
// Correct
import type { BookmarkRecord, Settings } from './types';
import { getSettings, saveSettings } from './db';
import { getEmbedding } from './embedding';

// Correct (Solid.js UI entry)
import { createSignal, onMount, For } from 'solid-js';
import { getIndexStats } from '../../src/db';
import './App.css';
```

---

## Code Style

### Formatting
- **Indentation:** 2 spaces
- **Quotes:** Double quotes `"` (enforced by WXT/TypeScript toolchain)
- **Semicolons:** Yes (always)
- **Trailing commas:** Used in multi-line function parameters and object literals
- **Line endings:** LF

### Naming conventions
| Kind | Convention | Example |
|------|-----------|---------|
| Variables / functions | `camelCase` | `loadFreqCache`, `getQueryEmbedding` |
| Constants (module-level) | `SCREAMING_SNAKE_CASE` | `SCORE_URL_EXACT`, `RRF_K`, `MAX_RETRIES` |
| Interfaces | `PascalCase` | `BookmarkRecord`, `IndexingProgress` |
| Types / type aliases | `PascalCase` | `SearchMode`, `ProgressListener` |
| Classes | `PascalCase` | `BookmarkDB`, `EmbeddingCache` |
| Files | `camelCase` | `hybrid.ts`, `vectorWorkerManager.ts` |
| Solid.js components | `PascalCase` | `App.tsx` |

### Functions
- Prefer named `function` declarations for exported top-level functions
- Use arrow functions for callbacks, event handlers, and inline expressions
- `async/await` throughout — no raw `.then()` chains except fire-and-forget patterns
- Fire-and-forget: `somePromise().catch(() => {})` — empty catch is acceptable only for best-effort async side effects

### Error handling
- All async entry-point logic must be wrapped in `try/catch`
- Log errors with `console.error('[ModuleName] Description:', error)`
- Use `console.warn` for recoverable/expected failures (rate limits, missing data)
- Use `console.debug` for noisy low-value traces
- Log prefix format: `[FlowSearch]` in background, `[indexer]`, `[hybrid]`, `[vectorSearch]` in src modules
- Propagate errors up for the caller to handle; don't swallow silently in library code

### Comments
- JSDoc on all exported functions: `/** One-line description */`
- Inline comments for non-obvious logic; Chinese comments are present in the codebase — match the language of the surrounding code when adding new comments
- Section dividers: `// === Section Name ===`

---

## Browser Extension Constraints

- **Manifest V3 service worker** — no persistent background page. Avoid large in-memory state; use `browser.storage.local` for persistence
- **Omnibox descriptions must be XML-escaped** — always use `escapeXml()` from `highlight.ts` before inserting into omnibox suggestion strings
- **`<match>`, `<dim>`, `<url>`** are the only valid omnibox XML tags
- `browser.*` APIs are globally available in entry points via WXT's auto-injection — no explicit import needed
- Message passing between pages uses `browser.runtime.sendMessage` / `onMessage.addListener`; return `true` from the listener to keep the channel open for async responses

---

## Solid.js (Popup / Options)

- UI lives in `entrypoints/popup/` and `entrypoints/options/`
- Use `createSignal`, `onMount`, `For`, `Show` from `solid-js`
- JSX uses `class` (not `className`); event handlers use `onClick`, `onChange`, etc.
- No server-side concerns — pure CSP-compliant browser UI
- Tailwind v3 with HSL CSS variables + dark mode support (`tailwind.config.js`)

---

## API Dependencies

- **SiliconFlow API Key** — required for BGE-M3 embeddings and LLM summaries/tags (configured in options page)
- **Jina AI Reader** (`https://r.jina.ai/*`) — free, no key needed; used for content extraction
- **GitHub PAT** — optional, for syncing starred repos
- **Twitter/X cookies** — optional, auto-extracted via `browser.cookies` API; manual fallback also supported

---

## Key Runtime Patterns

- **In-memory cache hot path:** `ensureCachedIndexedBookmarks()` loads all indexed bookmarks into RAM on SW startup — omnibox queries avoid IndexedDB round trips. Cache invalidates on SW restart.
- **Omnibox debounce:** 150ms debounce + `AbortController` in `background.ts` `onInputChanged` handler; cancel previous in-flight embedding request on each keystroke.
- **Content extraction order:** Active Tab (fastest) → Local Readability → Jina Reader (network fallback). Jina requires `https://r.jina.ai/*` host permission.
- **Indexer recovery:** `indexQueue` (Dexie v4) persists pending work; on SW restart the queue is reloaded, so bookmarks survive service-worker lifecycle termination.
- **Gist sync lock:** `gistSyncLock` flag in `background.ts` prevents recursive bookmark-change events while gist sync is writing locally. If a local change arrives during sync, `pendingGistSync` queues a follow-up sync.

---

## Adding New Features

1. **New core logic** → add to `src/` as a dedicated module with clear JSDoc
2. **New browser API usage** → only in `entrypoints/`; expose a typed function from `src/` and call it from the entry point
3. **New message type** → add a `case` to the `switch` in `background.ts` `onMessage` handler; add the type string as a string literal
4. **New settings field** → extend `Settings` interface in `types.ts`, add to `defaultSettings` in `db.ts`
5. **New DB column** → bump the Dexie version in `db.ts` with a migration
6. Run `pnpm compile` to verify types before finishing
