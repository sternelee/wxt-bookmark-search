# HTML Summary Rendering — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render all bookmark summaries as HTML instead of plain text, with structured card layout for GitHub source.

**Architecture:** Security-first HTML rendering using `DOMParser` for sanitization. GitHub summaries are parsed for structured fields (language, stars, description) and rendered as rich cards. Other sources render sanitized HTML as prose.

**Tech Stack:** Pure `DOMParser` (native), Tailwind CSS, Solid.js — no new dependencies.

---

## File Structure

| File | Purpose |
|------|---------|
| `src/lib/sanitize.ts` | `sanitizeHtml()` + `parseGitHubHtml()` |
| `src/components/HtmlRenderer.tsx` | Solid.js component rendering structured cards |
| `src/types.ts` | Add `source` to `RecentListProps` item |
| `entrypoints/popup/components/RecentList.tsx` | Use `HtmlRenderer` |
| `entrypoints/search/App.tsx` | Use `HtmlRenderer` for summaries |

---

## Task 1: `src/lib/sanitize.ts`

**Files:**
- Create: `src/lib/sanitize.ts`

- [ ] **Step 1: Write sanitize + parse functions**

```ts
/**
 * Strip dangerous HTML: scripts, events, javascript: URLs.
 * Allows safe text/structure tags + http/https links only.
 */
export function sanitizeHtml(html: string): string {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, "text/html");

  // Remove dangerous elements
  doc.querySelectorAll("script, style, iframe, object, embed, form").forEach(
    (el) => el.remove()
  );

  // Scrub event attributes and javascript: hrefs from all elements
  const allElements = doc.querySelectorAll("*");
  allElements.forEach((el) => {
    const attrs = Array.from(el.attributes);
    attrs.forEach((attr) => {
      const name = attr.name.toLowerCase();
      if (
        name.startsWith("on") ||
        name === "style" ||
        (name === "href" &&
          !attr.value.match(/^https?:\/\//))
      ) {
        el.removeAttribute(name);
      }
    });
  });

  return doc.body.innerHTML;
}

/**
 * Parse GitHub LLM summary HTML for structured card data.
 * The LLM is instructed to embed: data-language, data-stars, data-readme-url.
 */
export function parseGitHubHtml(html: string): {
  language?: string;
  stars?: string;
  description?: string;
  readmeUrl?: string;
  rawHtml: string;
} {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, "text/html");
  const root = doc.querySelector("[data-language]") || doc.body;

  const language = root.getAttribute("data-language") || undefined;
  const stars = root.getAttribute("data-stars") || undefined;
  const readmeUrl = root.getAttribute("data-readme-url") || undefined;

  // Description: first <p> text content, or root text content
  const p = root.querySelector("p");
  const description = p?.textContent?.trim() || root.textContent?.trim().slice(0, 200) || "";

  return {
    language,
    stars,
    description,
    readmeUrl,
    rawHtml: root.innerHTML,
  };
}
```

- [ ] **Step 2: Run typecheck**

```bash
pnpm compile
```
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/lib/sanitize.ts
git commit -m "feat: add sanitize and parseGitHubHtml utilities"
```

---

## Task 2: `src/components/HtmlRenderer.tsx`

**Files:**
- Create: `src/components/HtmlRenderer.tsx`

- [ ] **Step 1: Write HtmlRenderer component**

```tsx
import { Show, splitProps } from "solid-js";
import { sanitizeHtml, parseGitHubHtml } from "../lib/sanitize";
import { Badge } from "./ui/badge";

interface HtmlRendererProps {
  html: string;
  source: "github" | "twitter" | "bookmark" | "history";
  class?: string;
}

export function HtmlRenderer(props: HtmlRendererProps) {
  const [local, others] = splitProps(props, ["html", "source", "class"]);

  return (
    <Show
      when={local.source === "github"}
      fallback={<div class={`prose prose-sm max-w-none ${local.class || ""}`} innerHTML={sanitizeHtml(local.html)} />}
    >
      <GitHubCard html={local.html} class={local.class} />
    </Show>
  );
}

function GitHubCard(props: { html: string; class?: string }) {
  const parsed = () => parseGitHubHtml(props.html);

  return (
    <div class={`rounded-md border border-border bg-muted/30 p-3 space-y-2 ${props.class || ""}`}>
      <Show when={parsed().description}>
        <p class="text-sm text-foreground/80 leading-relaxed line-clamp-3">
          {parsed().description}
        </p>
      </Show>

      <div class="flex flex-wrap items-center gap-2">
        <Show when={parsed().language}>
          <Badge variant="secondary" class="text-xs">
            {parsed().language}
          </Badge>
        </Show>
        <Show when={parsed().stars}>
          <span class="text-xs text-muted-foreground">
            ⭐ {parsed().stars}
          </span>
        </Show>
      </div>

      <Show when={parsed().readmeUrl}>
        <div class="flex gap-2 pt-1">
          <a
            href={parsed().readmeUrl}
            target="_blank"
            rel="noopener noreferrer"
            class="text-xs text-primary hover:underline flex items-center gap-1"
          >
            📄 View README
          </a>
        </div>
      </Show>
    </div>
  );
}
```

- [ ] **Step 2: Run typecheck**

```bash
pnpm compile
```
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/components/HtmlRenderer.tsx
git commit -m "feat: add HtmlRenderer component for structured GitHub cards"
```

---

## Task 3: `entrypoints/popup/components/RecentList.tsx`

**Files:**
- Modify: `entrypoints/popup/components/RecentList.tsx`

- [ ] **Step 1: Add source prop and use HtmlRenderer**

```tsx
import { For, Show } from "solid-js";
import { Card, CardContent } from "../../../src/components/ui/card";
import { Badge } from "../../../src/components/ui/badge";
import { HtmlRenderer } from "../../../src/components/HtmlRenderer";
import { useI18n } from "../../../src/i18n";

interface RecentListProps {
  items: Array<{
    url: string;
    title: string;
    summary?: string;
    tags?: string[];
    source?: "github" | "twitter" | "bookmark" | "history";
  }>;
}

export default function RecentList(props: RecentListProps) {
  const { t } = useI18n();
  return (
    <div class="mb-5">
      <h2 class="text-xs uppercase tracking-wide text-muted-foreground mb-2.5 font-medium">
        {t("popup.recentlyVisited")}
      </h2>
      <div class="flex flex-col gap-2">
        <For each={props.items}>
          {(item) => (
            <a
              href={item.url}
              target="_blank"
              class="block"
            >
              <Card class="hover:bg-accent hover:border-primary transition-all hover:-translate-y-0.5">
                <CardContent class="p-2.5">
                  <div class="text-[13px] font-semibold truncate mb-1">
                    {item.title}
                  </div>
                  <Show when={item.summary && item.source}>
                    <div class="mt-1.5">
                      <HtmlRenderer
                        html={item.summary!}
                        source={item.source!}
                        class="line-clamp-2"
                      />
                    </div>
                  </Show>
                  <Show when={item.tags && item.tags.length > 0}>
                    <div class="flex gap-1.5 mt-1.5">
                      <For each={item.tags?.slice(0, 2)}>
                        {(tag) => (
                          <Badge variant="secondary" class="text-[10px]">
                            #{tag}
                          </Badge>
                        )}
                      </For>
                    </div>
                  </Show>
                </CardContent>
              </Card>
            </a>
          )}
        </For>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Run typecheck**

```bash
pnpm compile
```
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add entrypoints/popup/components/RecentList.tsx
git commit -m "feat: use HtmlRenderer in RecentList for GitHub card display"
```

---

## Task 4: `entrypoints/search/App.tsx`

**Files:**
- Modify: `entrypoints/search/App.tsx`

- [ ] **Step 1: Add HtmlRenderer import and replace summary rendering**

Add import:
```tsx
import { HtmlRenderer } from "../../src/components/HtmlRenderer";
```

Replace lines 187-191 (the `<p class="text-sm mt-1.5...">{result.summary}</p>` block) with:

```tsx
<Show when={result.summary}>
  <div class="mt-1.5">
    <HtmlRenderer
      html={result.summary}
      source={result.source}
      class="line-clamp-3"
    />
  </div>
</Show>
```

- [ ] **Step 2: Run typecheck**

```bash
pnpm compile
```
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add entrypoints/search/App.tsx
git commit -m "feat: use HtmlRenderer in search results for structured cards"
```

---

## Verification

After all tasks:
```bash
pnpm compile && pnpm build
```

Manual test:
1. `pnpm dev`
2. Open `chrome://extensions/`, load unpacked from `.output/chrome-mv3/`
3. Click extension popup — GitHub bookmark should show structured card
4. Open search page — GitHub bookmarks should show structured card with language badge and stars
