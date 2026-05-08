# Bookmark Health Management & Automated Organization

## Overview

Add three features to FlowSearch:
1. **Dead Link Detection** — periodically scan indexed bookmarks, mark HTTP errors
2. **Duplicate Detection** — find same-URL bookmarks, allow batch resolution
3. **AI Auto-Categorization** — LLM-based topic classification into browser folders

---

## 1. Dead Link Detection (`src/health.ts`)

### Data Model Changes

New optional fields on `BookmarkRecord` (`src/types.ts`):

```typescript
/** HTTP status code from last link check (200, 404, 500, 0=timeout/network error) */
linkStatus?: number;
/** Timestamp (ms) of last link check */
linkCheckedAt?: number;
```

### New Settings Fields (`src/types.ts` → `Settings`)

```typescript
/** Enable periodic dead link scanning */
linkCheckEnabled?: boolean;
/** Interval in hours between checks (default 24) */
linkCheckInterval?: number;
/** Timestamp of last completed scan */
lastLinkCheck?: number;
```

Default values in `src/db.ts` → `defaultSettings`: `linkCheckEnabled: false, linkCheckInterval: 24`.

### Core Logic: `src/health.ts`

**Implementation approach:**
- Query all `status === "indexed"` bookmarks, sort by `linkCheckedAt ASC` (nulls first)
- Concurrency pool of **5** HEAD requests via `Promise.allSettled`
- Timeout **8s** per request (`AbortSignal.timeout(8000)`)
- On response: store `linkStatus` (status code), `linkCheckedAt` (Date.now()) via `db.bookmarks.update(id, { linkStatus, linkCheckedAt })`
- On timeout/error: store `linkStatus: 0`, `linkCheckedAt`
- Rate limiting: 100ms between batches of 5
- Broadcast progress via runtime messages
- Cancelable via `AbortSignal`

### Scheduling

Use `browser.alarms` API:

```typescript
browser.alarms.create("linkCheck", { periodInMinutes: settings.linkCheckInterval * 60 });

browser.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "linkCheck") checkLinks();
});
```

### Message Types (background.ts)

| Type | Direction | Purpose |
|------|-----------|---------|
| `CHECK_LINKS` | Options → BG | Manually trigger link scan |
| `GET_LINK_STATS` | Options → BG | Get health stats summary |
| `GET_DEAD_LINKS` | Options → BG | List dead bookmarks |

### Options UI: `HealthSettings.tsx`

Toggle, interval selector, "Check Now" button, stats display, dead links list.

---

## 2. Duplicate Detection (`src/dedup.ts`)

### Core Logic

- Query all urls from indexed bookmarks, group by URL using Map
- Filter to groups with ≥2 entries
- Fetch full records + browser folder paths for each group
- Resolve: `browser.bookmarks.remove()` + `db.bookmarks.bulkDelete()`

### Message Types

| Type | Direction | Purpose |
|------|-----------|---------|
| `FIND_DUPLICATES` | Options → BG | Return duplicate groups |
| `RESOLVE_DUPLICATES` | Options → BG | Delete specified duplicates |

### Options UI: `DuplicateSettings.tsx`

Scan button, grouped results with keep/remove actions, empty state.

---

## 3. AI Auto-Categorization (`src/categorize.ts`)

### New Settings Fields

```typescript
autoCategorizeEnabled?: boolean;
categoryRules?: string;
categoryFolderMap?: Record<string, string>;
```

### LLM Prompt

Given a list of bookmarks, categorize each into: Frontend, Backend, DevOps, AI/ML, Rust, Go, Python, JavaScript/TypeScript, Mobile, Database, Security, Design, Productivity, Other. Return JSON array of `{ bookmarkId, suggestedCategory, confidence, reasoning }`.

### Implementation

- Batch 20 bookmarks per LLM call
- User reviews suggestions, then applies
- Creates/moves bookmarks to browser folders based on `categoryFolderMap`

### Message Types

| Type | Direction | Purpose |
|------|-----------|---------|
| `GET_CATEGORY_SUGGESTIONS` | Options → BG | Dry-run categorization |
| `APPLY_CATEGORIES` | Options → BG | Move bookmarks to folders |
| `GET_CATEGORY_FOLDERS` | Options → BG | List category folders |

### Options UI: `CategorizeSettings.tsx`

Toggle, folder selector, analyze button, results table with accept/skip, folder mapping, user rules textarea.

---

## 4. Database Changes (`src/db.ts`)

- No Dexie schema bump needed (optional fields only)
- Add default values: `linkCheckEnabled: false`, `linkCheckInterval: 24`, `autoCategorizeEnabled: false`, `categoryRules: ""`, `categoryFolderMap: {}`
- New query helpers: `getUncheckedBookmarks()`, `getAllIndexedUrls()`, `updateLinkStatus()`

---

## 5. i18n Keys

Three new sections: `options.health` (13 keys), `options.duplicates` (10 keys), `options.categorize` (19 keys). New common keys: `checking`, `keep`, `remove`.

---

## 6. Files to Create

- `src/health.ts`
- `src/dedup.ts`
- `src/categorize.ts`
- `entrypoints/options/components/HealthSettings.tsx`
- `entrypoints/options/components/DuplicateSettings.tsx`
- `entrypoints/options/components/CategorizeSettings.tsx`

## 7. Files to Modify

- `src/types.ts` — new fields and interfaces
- `src/db.ts` — defaults + query helpers
- `entrypoints/background.ts` — 9 new message handlers + alarms
- `entrypoints/options/App.tsx` — mount 3 new components
- `src/i18n/locales/{en,zh-CN,ja,ko}.ts` — new keys

## 8. Verification

- `pnpm compile` pass
- Dead link: toggle → alarm created, manual scan → stats update, 404 URLs marked
- Duplicates: same URL in 2 folders → scan finds → keep one removes others
- Categorize: analyze → suggestions shown → apply → bookmarks moved
- Edge cases: empty DB, no API key, network errors, SW restart mid-scan
