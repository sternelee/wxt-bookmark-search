# Flow Search

Browser extension for fast omnibox bookmark search with AI-powered semantic search. Type `bi <keyword>` in Chrome's address bar to search your bookmarks.

Built with **WXT + TypeScript + Solid.js + Tailwind CSS + shadcn-solid**.

## Features

### Search

- **Omnibox search** — type `bi ` (space after `bi`) to activate
- **AI Semantic Search** — powered by SiliconFlow BGE-M3 embeddings
- **Hybrid Search** — combines keyword matching + vector similarity with RRF algorithm and min-max normalization
- **Frequency-weighted ranking** — bookmarks you visit more often rank higher
- **Fuzzy matching** — Levenshtein edit distance (≤1) with sliding window for queries ≥3 chars
- **Multi-word search** — all words must appear in title or URL
- **Judge reranking** — optional TypeSafe (Jev) relevance reranker for the top results

### Indexing

- **Auto indexing** — automatically indexes new bookmarks in background
- **GitHub Stars sync** — indexes your starred repos with incremental sync (fast-path + background enrichment)
- **Twitter/X Bookmarks sync** — indexes your Twitter bookmarks with GraphQL API
- **Browser history sync** — indexes recent history with a configurable lookback window
- **Global stop control** — every sync source (GitHub / X / history) can be aborted mid-run
- **LLM Enhancement** — auto-generates summaries and tags using DeepSeek-V3
- **Duplicate detection** — finds duplicate URLs and resolves them across folders

### Surfaces

- **Popup** — quick search, index stats and a live indexing HUD
- **Options (设置)** — 15 grouped settings panels behind a vertical tab rail, with `#section-<id>` deep links
- **Bookmark wall (书签墙)** — masonry card wall with source filters, hot tags, sort order, AI hybrid search and RAG Q&A
- **Tag cloud (标签云)** — drill-down tag explorer with breadcrumb navigation and a live related-bookmarks panel
- **Code Wiki** — symbol graph, symbol search, generated docs and repo Q&A for your repos

### Sync & Privacy

- **Multi-provider sync** — GitHub Gist, WebDAV, Google Drive, Dropbox, or generic blob storage; union merge with deletion tracking
- **Local embedding option** — WASM embedding backend for fully offline indexing
- **Privacy-first** — all data stored locally in IndexedDB
- **i18n** — zh-CN, en, ja, ko

## Installation

```bash
pnpm install
pnpm build
```

Then in Chrome:

1. Open `chrome://extensions/`
2. Enable **Developer mode**
3. Click **Load unpacked**
4. Select `.output/chrome-mv3/`

For Firefox use `pnpm build:firefox` and load `.output/firefox-mv3/` from `about:debugging`.

## Configuration

1. Click the extension icon → **Settings**
2. Enter your SiliconFlow API Key
3. Click **Start Indexing** to build the vector index
4. (Optional) Enter a GitHub PAT to sync starred repos, or Twitter/X cookies to sync bookmarks

## Search Modes

| Mode | Description |
|------|-------------|
| **Hybrid** | Combines keyword + semantic search with normalized RRF fusion (default) |
| **Vector** | Pure semantic similarity search |
| **Keyword** | Traditional keyword matching only |

## Architecture

### Strict layer separation

`src/` is pure business logic — it never touches `browser.*`, `document` or `window`. Browser APIs live only in `entrypoints/`, which call into `src/` and inject browser-specific callbacks.

```
src/
  types.ts              — all shared interfaces
  db.ts                 — IndexedDB (Dexie.js) + in-memory cache for the omnibox hot path
  search-engine.ts      — Orama wrapper: keyword / vector / hybrid search, frequency boost
  search.ts             — legacy keyword search + Levenshtein fuzzy reranking
  embedding.ts          — SiliconFlow BGE-M3 client: LRU cache, AbortSignal, batch API
  embedding-local.ts    — WASM local embedding backend
  embedding-space.ts    — guards the vector space across backend switches
  indexer.ts            — background indexing queue, rate limiting, enrichment recovery
  sync-control.ts       — AbortController registry for GitHub / X / history syncs
  github.ts             — GitHub Stars fetching with early-exit pagination
  twitter.ts            — Twitter/X GraphQL client
  twitter-cookies.ts    — cookie auto-extraction via browser.cookies
  history.ts            — browser history → BookmarkRecord conversion
  llm.ts                — SiliconFlow Chat API for summaries / tags
  ai-providers/         — LLM provider abstraction (llm-base, llm-remote, detect, types)
  rag.ts                — RAG Q&A over the bookmark corpus
  research.ts           — multi-source research helper
  daily-digest.ts       — daily knowledge digest builder
  tag-cloud.ts          — hierarchical tag cloud with co-occurrence drill-down
  categorize.ts         — AI bookmark categorization
  dedup.ts              — duplicate detection + folder path mapping
  health.ts             — link health checks
  gist-sync.ts          — GitHub Gist multi-device sync
  cloud-sync/           — WebDAV / Google Drive / Dropbox / Blob providers + orchestrator
  code-graph/           — symbol parser, graph builder, worker client, persistence
  embed-code/           — code chunking + code embeddings
  repo-wiki/            — wiki doc builder, summarizer, repo Q&A
  highlight.ts          — omnibox XML escaping / highlighting
  freq.ts               — visit frequency cache with debounced writes
  polyfills.ts          — AbortSignal.timeout polyfill for Firefox <124
  components/           — shared app-level panels (DigestPanel, ResearchPanel, HtmlRenderer)
  components/ui/        — 33 shadcn-solid components (vendored, do not hand-edit)
  components/form/      — project-level field wrappers (InputField, SelectField, …)
  i18n/                 — type-safe i18n; locales: zh-CN, en, ja, ko

entrypoints/
  background.ts         — service worker: omnibox handlers, message router, sync alarms
  popup/                — popup UI (Header, StatsGrid, RecentList, IndexingHUD, SearchHint)
  options/              — settings page; App.tsx holds the tab rail, components/ the 15 panels
  board/                — bookmark wall 书签墙
  graph/                — tag cloud explorer (TagCloud, BookmarkPanel)
  wiki/                 — Code Wiki (CodeMap, SymbolPanel, WikiTree, CodeQA)
  offscreen/            — offscreen document for local embedding work
```

### UI conventions

- **Components come from `src/components/ui/`**, which holds unmodified shadcn-solid / Kobalte sources. Re-syncing from upstream is preferred over editing them.
- **Project-specific wrappers go in `src/components/form/`** so a registry re-sync cannot overwrite them.
- **Imports use relative paths.** `tsconfig.json` declares `@/*` and `~/*`, but the bundler does not resolve them.
- **Theme tokens live in `tailwind.config.js`** (`addBase`), not in per-entrypoint CSS files. Each `entrypoints/*/style.css` only carries `@tailwind` directives plus its own base rules.
- **Panels stay mounted** across tab switches so unsaved form input is never discarded.

## Tech Stack

- **Framework**: WXT (Chrome / Firefox / Edge MV3)
- **UI**: Solid.js + Tailwind CSS v3
- **Components**: shadcn-solid (Kobalte primitives, vendored via the registry CLI)
- **Styling**: HSL CSS variables, `darkMode: 'media'`
- **Storage**: IndexedDB via Dexie.js, `browser.storage.local` for settings
- **Search engine**: Orama (full-text + vector + hybrid)
- **Embedding**: SiliconFlow BGE-M3 (1024 dimensions)
- **LLM**: SiliconFlow DeepSeek-V3 (summaries and tags)
- **Content Extraction**: active tab → `@mozilla/readability` → selected reader backend (local WASM default / Jina), no cross-backend fallback

## Commands

```bash
pnpm dev            # dev server with HMR
pnpm dev:firefox    # Firefox dev server
pnpm build          # production build (Chrome MV3)
pnpm build:firefox  # production build (Firefox MV3)
pnpm zip            # package as .zip
pnpm zip:firefox
pnpm zip:edge
pnpm compile        # TypeScript type check (tsc --noEmit)
```

**No test runner is configured.** QA is manual: load the unpacked build and exercise the
omnibox, popup, options, bookmark wall, tag cloud and Code Wiki. Always run `pnpm compile`
before finishing a change.

## API Requirements

- **SiliconFlow API Key**: Required for semantic search and LLM enhancement (remote embedding backend)
- **Jina AI Reader**: Free, no API key needed (optional remote content extraction backend; the default backend is local WASM conversion)
- **GitHub PAT**: Optional, for syncing starred repos and Gist sync
- **Twitter/X Cookies**: Optional, auto-extracted from the browser (bookmarks sync)

## Cost Estimation

For ~3000 bookmarks:
- BGE-M3 embedding: ~$0.01 (via SiliconFlow), or $0 with the local WASM backend
- DeepSeek-V3 LLM summaries: ~$0.02-0.05 (optional)
- Storage: ~15MB IndexedDB (1024-dim vectors)

## Recent Updates

- ✅ Rebuilt all five surfaces on shadcn-solid / Kobalte (33 vendored components + `src/components/form/` wrappers)
- ✅ Options page reorganized into 15 grouped panels behind a vertical tab rail with deep links
- ✅ Consolidated theme tokens into `tailwind.config.js`; fixed the wiki entrypoint that was missing its `@tailwind` directives
- ✅ Added a stop control for GitHub Stars / X bookmarks / history sync
- ✅ Added the Code Wiki surface (symbol graph, docs, repo Q&A)
- ✅ Added the tag cloud explorer with breadcrumb drill-down
- ✅ Added multi-provider cloud sync (WebDAV / Google Drive / Dropbox / Blob)
- ✅ Added duplicate detection and link health checks
