/**
 * Bookmark list panel — 实时显示与激活标签关联的书签
 */
import { For, Show } from "solid-js";
import { incrementFreq } from "../../../src/freq";
import { useI18n } from "../../../src/i18n";
import type { BookmarkRecord } from "../../../src/types";

function sourceIcon(source?: string): string {
  if (source === "github") return "⭐";
  if (source === "twitter") return "𝕏";
  if (source === "history") return "🕐";
  return "🔖";
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
    <div class="flex flex-col h-full">
      {/* 头部 */}
      <div class="px-4 py-3 border-b border-border shrink-0">
        <Show
          when={props.activeTags.length > 0}
          fallback={
            <div class="text-sm font-medium text-muted-foreground">
              {t("search.graphClickTagToExplore")}
            </div>
          }
        >
          <div class="flex items-center flex-wrap gap-1.5">
            <span class="text-sm font-medium">{t("search.graphRelatedBookmarks")}</span>
            <For each={props.activeTags}>
              {(tag, i) => (
                <>
                  <span class="text-xs text-muted-foreground">{i() === 0 ? ":" : "+"}</span>
                  <span class="text-sm font-semibold text-primary">{tag}</span>
                </>
              )}
            </For>
            <span class="ml-auto text-xs text-muted-foreground">
              {t("search.graphSelectedCount", { count: props.bookmarks.length })}
            </span>
          </div>
        </Show>
      </div>

      {/* 列表 */}
      <div class="flex-1 overflow-y-auto">
        <Show
          when={props.bookmarks.length > 0}
          fallback={
            <div class="flex items-center justify-center h-40 text-muted-foreground text-sm text-center px-4">
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
                class="w-full text-left flex flex-col gap-1 px-4 py-3
                       hover:bg-muted/60 transition-colors border-b border-border/50 group"
                onClick={() => openBookmark(bm.url)}
              >
                {/* 标题行 */}
                <div class="flex items-start gap-2 min-w-0">
                  <span class="text-base shrink-0 select-none mt-0.5">
                    {sourceIcon(bm.source)}
                  </span>
                  <span class="text-sm font-medium text-foreground group-hover:text-primary truncate flex-1 min-w-0">
                    {bm.title || bm.url}
                  </span>
                </div>

                {/* URL */}
                <div class="text-[11px] text-muted-foreground truncate ml-6">
                  {bm.url}
                </div>

                {/* 摘要 */}
                <Show when={bm.summary}>
                  <p class="text-xs text-muted-foreground line-clamp-2 ml-6">
                    {bm.summary}
                  </p>
                </Show>

                {/* 标签（高亮匹配） */}
                <Show when={bm.tags && bm.tags.length > 0}>
                  <div class="flex flex-wrap gap-1 ml-6 mt-0.5">
                    <For each={bm.tags?.slice(0, 5)}>
                      {(tag) => {
                        const normalized = tag.toLowerCase().trim();
                        const isActive = props.activeTags.includes(normalized);
                        return (
                          <span
                            class={`text-[10px] px-1.5 py-0.5 rounded-full transition-colors
                              ${isActive
                                ? "bg-primary text-primary-foreground font-medium"
                                : "bg-muted text-muted-foreground"
                              }`}
                          >
                            {tag}
                          </span>
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