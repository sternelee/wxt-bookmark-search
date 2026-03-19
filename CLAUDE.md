# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**wxt-bookmark-ai** is a Chrome/Chromium browser extension (Manifest V3) that provides fast omnibox bookmark search. Typing `bi <keyword>` in Chrome's address bar searches bookmarks ranked by a frequency-weighted algorithm that learns from your browsing habits.

Stack: WXT framework, Solid.js (via @wxt-dev/module-solid), TypeScript, Vite.

## Commands

```bash
pnpm install      # Install deps (runs wxt prepare automatically)
pnpm dev         # Dev server with HMR; output goes to .output/chrome-mv3/
pnpm build       # Production build for Chrome → chrome-mv3/
pnpm zip         # Package as .zip
pnpm compile     # TypeScript type checking (tsc --noEmit)
```

To load the extension in Chrome: open `chrome://extensions/`, enable Developer mode, click **Load unpacked**, select `chrome-mv3/`.

## Architecture

The extension is small (~400 lines TS). Logic lives in two layers:

### `src/` — Core logic (no framework dependencies)

| File | Purpose |
|------|---------|
| `search.ts` | Scoring algorithm: exact/prefix/fuzzy/Levenshtein match types → final score formula `baseScore * 10000 + (1 - normalizedFreq) * 100 - url.length` |
| `freq.ts` | Visit frequency cache persisted to `browser.storage.local`; exposes `loadFreqCache`, `persistFreqCache`, `incrementFreq`, `getFreqCache`, `getRecentBookmarks` |
| `highlight.ts` | XML escaping for omnibox `<match>` tags, URL host extraction |
| `types.ts` | `ChromeBookmark`, `OmniboxSuggestion` interfaces |

### `entrypoints/` — Browser extension entry points

| File | Purpose |
|------|---------|
| `background.ts` | Service worker: wires `browser.omnibox` events (`onInputStarted`, `onInputChanged`, `onInputEntered`) to the search algorithm |
| `content.ts` | Minimal placeholder for future per-page features |

### Data flow

`onInputChanged` → `queryWordsMatch` (filter bookmarks) → `rerankBookmarks` (score + sort) → `suggestions` (max 9) → `browser.omnibox.setDefaultSuggestion` / `updateSuggestionWeather`

## Key Constraints

- Omnibox `<match>` tags must be valid XML-escaped; `highlight.ts` handles this.
- Levenshtein fuzzy matching only activates for queries with 3+ characters.
- Manifest V3 service workers have memory limits; avoid keeping large state in memory — rely on `browser.storage.local`.
