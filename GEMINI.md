# GEMINI.md - wxt-bookmark-ai

## Project Overview

**wxt-bookmark-ai** is a sophisticated browser extension that enhances bookmark searching with AI-powered semantic search capabilities. It allows users to search their bookmarks directly from the browser's address bar (omnibox) using the keyword `bi`.

### Core Features
- **AI Semantic Search**: Uses SiliconFlow BGE-M3 embeddings (1024 dimensions) to understand the meaning behind search queries.
- **Hybrid Search Algorithm**: Combines traditional keyword matching with vector similarity using the Reciprocal Rank Fusion (RRF) algorithm for optimal results.
- **Local-First Privacy**: All vector data and indices are stored locally in the browser's IndexedDB (via Dexie.js).
- **Intelligent Indexing**: Automatically extracts content from bookmarked pages using Jina AI Reader (Markdown extraction) and generates embeddings in the background.
- **Omnibox Integration**: Provides real-time search suggestions with highlighting and frequency-weighted ranking.

### Tech Stack
- **Framework**: [WXT](https://wxt.dev/) (Web Extension Toolbox)
- **Frontend**: Solid.js (for Popup and Options pages)
- **Language**: TypeScript
- **Database**: IndexedDB with [Dexie.js](https://dexie.org/)
- **Embeddings**: SiliconFlow (BGE-M3 model)
- **Content Extraction**: Jina AI Reader (r.jina.ai)

---

## Building and Running

### Prerequisites
- Node.js (Latest LTS recommended)
- `pnpm` (Preferred package manager)
- SiliconFlow API Key (Required for semantic search features)

### Key Commands
- **Install Dependencies**: `pnpm install`
- **Development Mode**: `pnpm dev` (Starts WXT dev server with HMR)
- **Build Production**: `pnpm build` (Outputs to `.output/chrome-mv3`)
- **Build for Firefox**: `pnpm build:firefox` (Outputs to `.output/firefox-mv3`)
- **Type Checking**: `pnpm compile` (Runs `tsc --noEmit`)
- **Package Extension**: `pnpm zip` (Creates a .zip for distribution)

---

## Architecture & File Structure

### Core Logic (`src/`)
- `db.ts`: IndexedDB schema and Dexie.js database operations.
- `indexer.ts`: The background indexing engine. Handles queue management, rate limiting (exponential backoff), and page content extraction.
- `embedding.ts`: Client for the SiliconFlow embedding API.
- `hybrid.ts`: Implementation of the hybrid search and RRF ranking logic.
- `search.ts`: Traditional keyword search implementation with reranking capabilities.
- `vector.ts`: Vector similarity utilities (Cosine similarity).
- `freq.ts`: Manages bookmark visit frequency to improve ranking.
- `types.ts`: Centralized TypeScript interfaces and types.

### Extension Entrypoints (`entrypoints/`)
- `background.ts`: The Service Worker. Manages omnibox interaction (`browser.omnibox`), background task coordination, and message passing.
- `popup/`: The extension's popup UI (built with Solid.js).
- `options/`: The settings page for API configuration and index management.
- `content.ts`: Content scripts for interacting with web pages (if applicable).

---

## Development Conventions

### Coding Style
- **Modularization**: Keep core logic in `src/` and UI/Entrypoint specific code in `entrypoints/`.
- **Async Patterns**: Extensively use `async/await` for database operations, API calls, and browser extension APIs.
- **Type Safety**: Prioritize strong typing for all data structures, especially for `BookmarkRecord` and `Settings`.
- **Error Handling**: Implement robust error handling in the indexer to manage API failures and rate limits (429s).

### Best Practices
- **Privacy**: Ensure no sensitive data (like API keys or bookmark content) is sent to external servers except for the necessary embedding and extraction APIs.
- **Performance**: Use background processing for heavy tasks like indexing to keep the browser UI responsive.
- **Omnibox UX**: Keep omnibox descriptions concise and use standard XML highlighting tags (`<match>`, `<dim>`, `<url>`).
- **WXT Modules**: Leverage WXT modules like `@wxt-dev/module-solid` for seamless framework integration.
