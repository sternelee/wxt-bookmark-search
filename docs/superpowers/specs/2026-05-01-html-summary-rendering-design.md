# HTML Summary Rendering — Design Spec

## Goal

Render all bookmark summaries as HTML instead of plain text, using structured card layout.

## Scope

- **RecentList** (popup): GitHub stars/repos
- **Full-page search** (search page): GitHub + Twitter + regular bookmarks

## Approach

### Security

Use `DOMParser` to safely sanitize HTML:
- Strip `<script>`, `<style>`, event attributes (`onclick`, `onerror`, etc.)
- Allow only safe tags: `a`, `p`, `br`, `strong`, `em`, `b`, `i`, `code`, `pre`, `ul`, `ol`, `li`, `h1-h6`, `blockquote`, `span`
- `href` allowed only on `<a>` with `http/https` protocol
- Strip all `style` attributes

### Components

#### `src/lib/sanitize.ts`
```ts
export function sanitizeHtml(html: string): string
export function parseHtmlStructure(html: string): ParsedHtml
interface ParsedHtml {
  language?: string;
  stars?: string;
  description?: string;
  readmeUrl?: string;
  rawHtml?: string;
}
```

#### `src/components/HtmlRenderer.tsx`
- Props: `html: string`, `source: "github" | "twitter" | "bookmark" | "history"`
- For `github`: extract structured fields → render as GitHub card
- For others: render sanitized HTML with `prose` Tailwind classes

### File Changes

| File | Change |
|------|--------|
| `src/lib/sanitize.ts` | New — sanitization + GitHub HTML parsing |
| `src/components/HtmlRenderer.tsx` | New — renders structured cards |
| `entrypoints/popup/components/RecentList.tsx` | Add `source` prop; use `HtmlRenderer` |
| `entrypoints/search/App.tsx` | Use `HtmlRenderer` for summaries |
| `src/types.ts` | Add `source` to `RecentListProps` item shape |

## Implementation Notes

- Use `DOMParser` (native, no extra dep) — available in all MV3-supported browsers
- GitHub LLM summary HTML: extract `data-language`, `data-stars` attributes from root element
- Fallback: if parsing fails, render sanitized raw HTML as prose
