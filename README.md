# Flow Search

Browser extension for fast omnibox bookmark search with AI-powered semantic search. Type `bi <keyword>` in Chrome's address bar to search your bookmarks.

Built with **WXT + TypeScript + Solid.js**.

## Features

- **Omnibox search** — type `bi ` (space after `bi`) to activate
- **AI Semantic Search** — powered by SiliconFlow BGE-M3 embeddings
- **Hybrid Search** — combines keyword matching + vector similarity with RRF algorithm and min-max normalization
- **Frequency-weighted ranking** — bookmarks you visit more often rank higher
- **Fuzzy matching** — Levenshtein edit distance (≤1) with sliding window for queries ≥3 chars
- **Multi-word search** — all words must appear in title or URL
- **Auto indexing** — automatically indexes new bookmarks in background
- **GitHub Stars sync** — indexes your starred repos with incremental sync (fast-path + background enrichment)
- **Privacy-first** — all data stored locally in IndexedDB

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

## Configuration

1. Click the extension icon → **Open Settings**
2. Enter your SiliconFlow API Key
3. Click **Start Indexing** to build the vector index
4. (Optional) Enter GitHub PAT to sync starred repos

## Search Modes

| Mode | Description |
|------|-------------|
| **Hybrid** | Combines keyword + semantic search with normalized RRF fusion (default) |
| **Vector** | Pure semantic similarity search |
| **Keyword** | Traditional keyword matching only |

## Architecture

```
src/
  types.ts       — TypeScript interfaces
  db.ts          — IndexedDB (Dexie.js) + in-memory cache for indexed bookmarks
  embedding.ts   — SiliconFlow BGE-M3 API client with LRU cache + AbortSignal
  vector.ts      — Cosine similarity utilities
  hybrid.ts      — RRF hybrid search with min-max normalization
  indexer.ts     — Background indexing with rate-limiting, enrichment queue recovery
  search.ts      — Keyword search + Levenshtein fuzzy (sliding window)
  freq.ts        — Visit frequency cache with debounced writes
  highlight.ts   — Omnibox highlight formatting
  github.ts      — GitHub Stars fetching with early-exit pagination
  llm.ts         — SiliconFlow Chat API for summaries
entrypoints/
  background.ts  — Service worker (omnibox handlers, debounced search, caching)
  popup/         — Extension popup UI
  options/       — Settings page
```

## Tech Stack

- **Framework**: WXT (Chrome Extension)
- **UI**: Solid.js
- **Vector DB**: IndexedDB via Dexie.js
- **Embedding**: SiliconFlow BGE-M3 (1024 dimensions)
- **Content Extraction**: Jina AI Reader (Markdown)

## Commands

```bash
pnpm dev          # dev server with HMR
pnpm build        # production build
pnpm build:firefox
pnpm zip          # package as .zip
pnpm compile      # TypeScript type check
```

## API Requirements

- **SiliconFlow API Key**: Required for semantic search
- **Jina AI Reader**: Free, no API key needed (for content extraction)
- **GitHub PAT**: Optional, for syncing starred repos

## Cost Estimation

For ~3000 bookmarks:
- BGE-M3 embedding: ~$0.01 (via SiliconFlow)
- Storage: ~15MB IndexedDB (1024-dim vectors)
