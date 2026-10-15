/**
 * Bookmark list panel — 实时显示与激活标签关联的书签
 */
import { For, Show } from "solid-js";
import { incrementFreq } from "../../../src/freq";
import { useI18n } from "../../../src/i18n";
import type { BookmarkRecord } from "../../../src/types";
import { Badge } from "../../../src/components/ui/badge";
import { cn } from "../../../src/lib/utils";

/** 来源 → 徽章配色（与 board / popup 保持一致） */
const SOURCE_META: Record<string, { label: string; class: string }> = {
  github: { label: "GitHub", class: "border-slate-400/40 bg-slate-400/10 text-slate-600 dark:text-slate-300" },
  twitter: { label: "X", class: "border-sky-400/40 bg-sky-400/10 text-sky-600 dark:text-sky-300" },
  history: { label: "History", class: "border-violet-400/40 bg-violet-400/10 text-violet-600 dark:text-violet-300" },
};

function SourceBadge(props: { source?: string }) {
  const meta = () => (props.source ? SOURCE_META[props.source] : undefined);
  return (
    <Show
      when={meta()}
      fallback={
        <Badge variant="outline" class="shrink-0 text-[10px] font-normal">
          🔖
        </Badge>
      }
    >
      {(m) => (
        <Badge variant="outline" class={cn("shrink-0 text-[10px] font-normal", m().class)}>
          {m().label}
        </Badge>
      )}
    </Show>
  );
}

interface BookmarkPanelProps {
  bookmarks: BookmarkRecord[];
  activeTags: string[];
  onOpen?: (url: string) => void;
}

export function BookmarkPanel(props: BookmarkPanelProps) {
  const { t } = useI18n();

  function openBookmark(url: string) {
    incrementFreq(url);
    browser.tabs.create({ url });
    props.onOpen?.(url);
  }

  return (
    <div class="flex h-full min-h-0 flex-col">
      {/* 头部 */}
      <div class="shrink-0 border-b border-border px-4 py-3">
        <Show
          when={props.activeTags.length > 0}
          fallback={
            <div class="text-sm font-medium text-muted-foreground">
              {t("search.graphClickTagToExplore")}
            </div>
          }
        >
          <div class="flex flex-wrap items-center gap-1.5">
            <span class="text-sm font-medium">{t("search.graphRelatedBookmarks")}</span>
            <For each={props.activeTags}>
              {(tag, i) => (
                <>
                  <span class="text-xs text-muted-foreground">{i() === 0 ? ":" : "+"}</span>
                  <Badge variant="secondary" class="text-xs font-semibold">
                    {tag}
                  </Badge>
                </>
              )}
            </For>
            <span class="ml-auto text-xs tabular-nums text-muted-foreground">
              {t("search.graphSelectedCount", { count: props.bookmarks.length })}
            </span>
          </div>
        </Show>
      </div>

      {/* 列表 */}
      <div class="min-h-0 flex-1 overflow-y-auto">
        <Show
          when={props.bookmarks.length > 0}
          fallback={
            <div class="flex h-40 items-center justify-center px-4 text-center text-sm text-muted-foreground">
              <Show
                when={props.activeTags.length > 0}
                fallback={t("search.graphStartExploring")}
              >
                {t("search.graphNoTaggedBookmarks")}
              </Show>
            </div>
          }
        >
          <For each={props.bookmarks}>
            {(bm) => (
              <button
                type="button"
                class="group flex w-full flex-col gap-1.5 border-b border-border/50 px-4 py-3 text-left transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:bg-muted/60"
                onClick={() => openBookmark(bm.url)}
              >
                {/* 标题行 */}
                <div class="flex min-w-0 items-center gap-2">
                  <SourceBadge source={bm.source} />
                  <span class="min-w-0 flex-1 truncate text-sm font-medium text-foreground group-hover:text-primary">
                    {bm.title || bm.url}
                  </span>
                </div>

                {/* URL */}
                <div class="truncate text-[11px] text-muted-foreground">{bm.url}</div>

                {/* 摘要 */}
                <Show when={bm.summary}>
                  <p class="line-clamp-2 text-xs text-muted-foreground">{bm.summary}</p>
                </Show>

                {/* 标签（高亮匹配） */}
                <Show when={bm.tags && bm.tags.length > 0}>
                  <div class="mt-0.5 flex flex-wrap gap-1">
                    <For each={bm.tags?.slice(0, 5)}>
                      {(tag) => {
                        const isActive = props.activeTags.includes(tag.toLowerCase().trim());
                        return (
                          <Badge
                            variant={isActive ? "default" : "secondary"}
                            class="rounded-full px-1.5 py-0 text-[10px] font-normal"
                          >
                            {tag}
                          </Badge>
                        );
                      }}
                    </For>
                  </div>
                </Show>
              </button>
            )}
          </For>
        </Show>
      </div>
    </div>
  );
}
