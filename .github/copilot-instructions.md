# Copilot Instructions for Flow Search

**Flow Search** is a Manifest V3 Chrome extension for AI-powered bookmark search using the omnibox keyword `bi`.

## Build and Test

```bash
pnpm install                # Install dependencies (auto-runs wxt prepare via postinstall)
pnpm dev                    # Dev server with HMR → .output/chrome-mv3/
pnpm dev:firefox            # Firefox dev server
pnpm build                  # Production build
pnpm build:firefox          # Firefox production build
pnpm zip                    # Package as .zip for distribution
pnpm compile                # TypeScript type-check only (tsc --noEmit)
```

**No test runner is configured.** Manual testing: load `.output/chrome-mv3/` unpacked in `chrome://extensions/`.

**Always run `pnpm compile` before marking work done.** This verifies TypeScript types without building.

## Architecture

### Strict Layer Separation

- **`src/`** — Pure business logic. No framework deps, no browser globals (`browser.*`, `document`, `window`). Never import WXT or Solid.js here.
- **`entrypoints/`** — Browser entry points that wire up APIs to `src/` functions. All browser API usage belongs here.

**Critical Rule:** Keep `src/` platform-agnostic. New features in `src/` must not know about the browser extension API. Entry points are the adapter layer.

### Core Architecture

**Service Worker (`entrypoints/background.ts`):**
- Omnibox handler (`onInputChanged`) with 150ms debounce + AbortController
- Message passing router (string-literal actions in `switch` statement)
- Indexer initialization and management

**Data Flow:**
1. **Omnibox search:** query → `getQueryEmbedding()` (cached) → `hybridSearch()` (RRF with min-max normalization) → omnibox suggestions
2. **Indexing:** bookmark URL → Jina Reader → `llm.ts` (DeepSeek-V3 summaries/tags) → `embedding.ts` (BGE-M3 batch API) → IndexedDB → in-memory cache
3. **Sync sources:** GitHub (Octokit) and Twitter/X (GraphQL with auto cookie extraction) → background enrichment queue with rate-limit recovery

### Key `src/` Modules

| Module | Responsibility |
|--------|----------------|
| `types.ts` | Shared TypeScript interfaces: `BookmarkRecord`, `Settings`, `SearchMode` |
| `db.ts` | Dexie.js IndexedDB + `browser.storage.local` + in-memory cache for omnibox hot path |
| `embedding.ts` | SiliconFlow BGE-M3 API with LRU cache, batch API, AbortSignal support |
| `hybrid.ts` | RRF hybrid search (keyword + vector) with min-max normalization |
| `search.ts` | Keyword search + Levenshtein fuzzy reranking (sliding window) |
| `indexer.ts` | Background queue with rate-limiting, exponential backoff, enrichment recovery |
| `freq.ts` | Visit frequency cache with debounced writes to storage |
| `github.ts` | GitHub Stars sync via Octokit with early-exit pagination |
| `twitter.ts` | Twitter/X GraphQL API client with retry logic |
| `twitter-cookies.ts` | Auto-extract Twitter cookies via `browser.cookies` API |
| `llm.ts` | SiliconFlow Chat API (DeepSeek-V3) for summaries/tags |
| `vector.ts` | Cosine similarity utilities |
| `highlight.ts` | XML escaping for omnibox `<match>/<dim>/<url>` tags |
| `lib/utils.ts` | `cn()` for Tailwind class merging |
| `components/ui/` | Reusable UI components (Button, Card, Badge, etc.) |

### UI Layer (`entrypoints/`)

- **`popup/`** — Extension popup (Solid.js + Tailwind)
- **`options/`** — Settings page (Solid.js + Tailwind, API keys, indexing controls, folder filters)
- **`content.ts`** — Content script placeholder

## Code Style

### TypeScript

**Interfaces vs Types:**
- Use `interface` for exported object shapes (e.g., `BookmarkRecord`, `Settings`)
- Use `type` for unions, aliases, and function-scoped shapes (e.g., `SearchMode`, local `BookmarkInput`)

**Type Safety:**
- Never use `as any` or `@ts-ignore` — fix the root issue
- Use `instanceof Error` for error handling: `error instanceof Error ? error.message : String(error)`
- Explicit `as` casts only for untyped browser APIs (e.g., `document.getElementById('x') as HTMLInputElement`)

**Imports:**
- Framework/library imports first, then internal imports
- Internal imports use relative paths without extension: `import { fn } from './module'`
- Use `import type` for type-only imports
- Path aliases: `@/*` → `./src/*`, `~/*` → `./*` (use `@/` in entrypoints for `src/` imports)

```ts
// Correct
import type { BookmarkRecord } from '@/types';
import { hybridSearch } from '@/hybrid';
import { createSignal, For } from 'solid-js';
```

### Formatting and Naming

- **Indentation:** 2 spaces
- **Quotes:** Double (`"`)
- **Semicolons:** Always
- **Trailing commas:** In multi-line function params and object literals
- **Variables/functions:** `camelCase`
- **Module constants:** `SCREAMING_SNAKE_CASE`
- **Interfaces/Types/Classes:** `PascalCase`
- **Files:** `camelCase`
- **Components:** `PascalCase`

### Functions

- Prefer named `function` declarations for exported functions
- Arrow functions for callbacks and event handlers
- `async/await` throughout — no `.then()` chains except fire-and-forget: `promise().catch(() => {})`
- JSDoc on all exported functions: `/** Brief description */`
- Inline comments for non-obvious logic (match surrounding language — Chinese comments exist in codebase)

### Error Handling

- All async entry-point logic must be wrapped in `try/catch`
- Log with prefix: `console.error('[ModuleName] Description:', error)`
- Prefixes: `[FlowSearch]` (background), `[indexer]`, `[hybrid]`, `[search]`, etc.
- Use `console.warn` for recoverable failures (rate limits, missing data)
- Propagate errors up — don't swallow silently in library code

## Browser Extension Constraints

- **MV3 service worker** — no persistent background page. Use `browser.storage.local` or IndexedDB for state.
- **In-memory cache optimization** — `ensureCachedIndexedBookmarks()` loads all indexed bookmarks into memory on SW startup for fast omnibox queries (hot path avoids IndexedDB). Cache rebuilds on SW restart.
- **Omnibox XML escaping** — always use `escapeXml()` from `highlight.ts` before inserting strings into suggestions. Only valid tags: `<match>`, `<dim>`, `<url>`
- **`browser.*` APIs** — globally available in entry points via WXT auto-injection; no explicit import needed
- **Message passing** — return `true` from `onMessage` listener to keep channel open for async responses

## Solid.js UI (Popup/Options)

- Use `createSignal`, `onMount`, `For`, `Show` from `solid-js`
- JSX uses `class` (not `className`); event handlers: `onClick`, `onChange`, etc.
- Tailwind v3 with HSL CSS variables + dark mode support
- No server-side concerns — pure CSP-compliant browser UI

## Adding Features

1. **New core logic** → add to `src/` as a dedicated module with JSDoc
2. **Browser API usage** → only in `entrypoints/`; expose typed function from `src/` and call from entry point
3. **New message type** → add `case` to `switch` in `background.ts` `onMessage`
4. **New settings field** → extend `Settings` in `types.ts`, add to `defaultSettings` in `db.ts`
5. **New DB column** → bump Dexie version in `db.ts` with migration
6. **Always verify:** `pnpm compile` before finishing

## API Dependencies

- **SiliconFlow API Key** — required for BGE-M3 embeddings and DeepSeek-V3 summaries (configured in extension options)
- **Jina AI Reader** (`https://r.jina.ai/*`) — free, no key needed, used for content extraction
- **GitHub PAT** — optional, for syncing starred repos
- **Twitter/X cookies** — optional, auto-extracted via `browser.cookies` API (requires `cookies` permission and `https://x.com/*` host permissions)

## Key Patterns

**RRF Fusion:** Hybrid search combines keyword and vector scores using Reciprocal Rank Fusion with min-max normalization for fair weighting.

**Rate Limiting:** `indexer.ts` uses exponential backoff for API calls. Respects SiliconFlow rate limits and gracefully handles 429 responses.

**Frequency Weighting:** `freq.ts` tracks bookmark visit counts with debounced writes to `browser.storage.local`. Integrated into ranking via `db.ts`.

**Twitter Sync:** Auto-extracts cookies via `browser.cookies` API with manual fallback. GraphQL API sync includes retry logic and persisted queue recovery on SW restart.

**Early-Exit Pagination:** GitHub Stars sync uses early-exit when all URLs already indexed to avoid unnecessary pagination.
