# wxt-bookmark-ai

Browser extension for fast omnibox bookmark search. Type `bi <keyword>` in Chrome's address bar to search your bookmarks.

Built with **WXT + TypeScript** (no Rust/WASM).

## Features

- **Omnibox search** — type `bi ` (space after `bi`) to activate
- **Frequency-weighted ranking** — bookmarks you visit more often rank higher
- **Fuzzy matching** — Levenshtein edit distance (≤1) for queries ≥3 chars
- **Multi-word search** — all words must appear in title or URL
- **Persistent frequency cache** — stored in `browser.storage.local`

## Usage

```bash
pnpm install
pnpm build
```

Then in Chrome:

1. Open `chrome://extensions/`
2. Enable **Developer mode**
3. Click **Load unpacked**
4. Select `.output/chrome-mv3/`

## Search Algorithm

| Match type | Base score |
|-----------|-----------|
| URL exact match | 0 |
| Title prefix match | 1 |
| Multi-word all-match | 5 |
| Title contains | 10 |
| Chrome search fallback | 15 |
| Levenshtein fuzzy | 20 |

Final score = `baseScore * 10000 + freqWeight * 100 - url.length` (lower is better).

## Project Structure

```
src/
  types.ts      — ChromeBookmark, OmniboxSuggestion types
  freq.ts       — frequency cache (load/persist/increment)
  highlight.ts  — XML escape, URL host, highlightBookmark
  search.ts     — queryWordsMatch, levenshtein, rerankBookmarks
entrypoints/
  background.ts — omnibox listeners (startup / input / enter)
```

## Commands

```bash
pnpm dev          # dev server with HMR
pnpm build        # production build
pnpm build:firefox
pnpm zip          # package as .zip
```
