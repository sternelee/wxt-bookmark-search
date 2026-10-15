import { createSignal, createMemo, Show, For, onMount } from "solid-js";
import {
  buildRootTagCloud,
  drillDown,
  getBookmarksByTags,
  getTagCloudStats,
} from "../../src/tag-cloud";
import type { BookmarkRecord } from "../../src/types";
import type { TagNode } from "../../src/tag-cloud";
import { useI18n } from "../../src/i18n";
import { Badge } from "../../src/components/ui/badge";
import { Button } from "../../src/components/ui/button";
import { Separator } from "../../src/components/ui/separator";
import { Toaster } from "../../src/components/ui/sonner";
import { TextField, TextFieldInput } from "../../src/components/ui/text-field";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbSeparator,
} from "../../src/components/ui/breadcrumb";
import { TagCloud } from "./components/TagCloud";
import { BookmarkPanel } from "./components/BookmarkPanel";

function App() {
  const { t } = useI18n();
  // 所有已索引书签（从 background 获取）
  const [allRecords, setAllRecords] = createSignal<BookmarkRecord[]>([]);
  const [loading, setLoading] = createSignal(true);
  const [filter, setFilter] = createSignal("");

  // 钻取路径（面包屑）
  const [tagPath, setTagPath] = createSignal<string[]>([]);

  // 当前展示的标签云节点
  const cloudNodes = createMemo<TagNode[]>(() => {
    const path = tagPath();
    if (path.length === 0) return buildRootTagCloud(allRecords());
    return drillDown(path, allRecords());
  });

  /** 按过滤词收窄标签云（只影响展示，不影响钻取状态） */
  const visibleNodes = createMemo<TagNode[]>(() => {
    const q = filter().trim().toLowerCase();
    if (!q) return cloudNodes();
    return cloudNodes().filter((n) => n.tag.toLowerCase().includes(q));
  });

  // 实时关联书签（左侧标签点击时右侧即时更新）
  const relatedBookmarks = createMemo<BookmarkRecord[]>(() => {
    const path = tagPath();
    if (path.length === 0) return [];
    return getBookmarksByTags(path, allRecords());
  });

  // 统计信息
  const stats = createMemo(() => getTagCloudStats(allRecords()));

  // 加载所有已索引书签
  async function loadRecords() {
    setLoading(true);
    try {
      const resp = await browser.runtime.sendMessage({ type: "GET_ALL_INDEXED" });
      if (resp?.success) {
        setAllRecords(resp.records ?? []);
      }
    } catch (e) {
      console.error("[Graph] Failed to load records:", e);
    } finally {
      setLoading(false);
    }
  }

  // 点击标签：钻取或回退
  function handleTagClick(tag: string) {
    const path = tagPath();
    const idx = path.indexOf(tag);

    if (idx >= 0) {
      // 已选中 → 回退到该标签之前的层级
      setTagPath(path.slice(0, idx));
    } else {
      // 新增标签 → 钻入
      setTagPath([...path, tag]);
    }
    setFilter("");
  }

  // 面包屑点击：回退到指定层级
  function handleBreadcrumb(index: number) {
    setTagPath(tagPath().slice(0, index + 1));
  }

  // 重置到根
  function handleReset() {
    setTagPath([]);
    setFilter("");
  }

  function openPage(page: "/board.html" | "/options.html") {
    browser.tabs.create({ url: browser.runtime.getURL(page) });
  }

  // 初始化
  onMount(loadRecords);

  return (
    <div class="flex h-screen overflow-hidden bg-background text-foreground">
      {/* === 左侧：标签云 === */}
      <div class="flex min-h-0 w-1/2 flex-col border-r border-border">
        {/* 顶栏：面包屑 + 过滤 + 入口 */}
        <div class="flex flex-none items-center gap-2 border-b border-border px-4 py-2.5">
          <Breadcrumb class="min-w-0 flex-1">
            <BreadcrumbList class="flex-nowrap">
              <BreadcrumbItem class="shrink-0">
                <BreadcrumbLink
                  class={
                    tagPath().length === 0
                      ? "cursor-default font-semibold text-foreground"
                      : undefined
                  }
                  onClick={(e) => {
                    e.preventDefault();
                    handleReset();
                  }}
                >
                  {t("search.graphAll")}
                </BreadcrumbLink>
              </BreadcrumbItem>
              <For each={tagPath()}>
                {(tag, i) => (
                  <>
                    <BreadcrumbSeparator class="shrink-0" />
                    <BreadcrumbItem class="shrink-0">
                      <BreadcrumbLink
                        class={
                          i() === tagPath().length - 1
                            ? "cursor-default font-semibold text-foreground"
                            : undefined
                        }
                        title={t("search.graphBackToLevel", { tag })}
                        onClick={(e) => {
                          e.preventDefault();
                          handleBreadcrumb(i());
                        }}
                      >
                        {tag}
                      </BreadcrumbLink>
                    </BreadcrumbItem>
                  </>
                )}
              </For>
            </BreadcrumbList>
          </Breadcrumb>

          <Show when={tagPath().length > 0}>
            <Badge variant="secondary" class="shrink-0 tabular-nums">
              {t("search.graphSelectedCount", { count: relatedBookmarks().length })}
            </Badge>
          </Show>

          <Separator orientation="vertical" class="h-6 shrink-0" />

          <TextField
            value={filter()}
            onChange={setFilter}
            class="w-40 shrink-0"
            aria-label={t("search.graphFilterTags")}
          >
            <TextFieldInput
              type="search"
              placeholder={t("search.graphFilterTags")}
              autocomplete="off"
              spellcheck={false}
            />
          </TextField>

          <Button
            variant="ghost"
            size="sm"
            class="shrink-0"
            onClick={() => openPage("/board.html")}
          >
            {t("board.title")}
          </Button>
        </div>

        {/* 标签云主体 */}
        <div class="relative min-h-0 flex-1">
          <div class="absolute inset-0 transition-opacity duration-300">
            <TagCloud
              nodes={visibleNodes()}
              activeTags={tagPath()}
              onTagClick={handleTagClick}
              isLoading={loading()}
              hasFilter={filter().trim().length > 0}
            />
          </div>
        </div>

        {/* 底部提示 + 统计 */}
        <div class="flex flex-none items-center justify-between border-t border-border px-4 py-2 text-xs text-muted-foreground">
          <Show when={tagPath().length === 0} fallback={<span>{t("search.graphRefineHint")}</span>}>
            <span>
              {loading()
                ? t("search.graphLoading")
                : stats().totalTags > 0 && stats().topTag
                  ? t("search.graphTagStatsWithTop", {
                      count: stats().totalTags,
                      topTag: stats().topTag ?? "",
                    })
                  : t("search.graphTagStats", { count: stats().totalTags })}
            </span>
          </Show>
          <span class="opacity-70">{t("search.graphSizeHint")}</span>
        </div>
      </div>

      {/* === 右侧：关联书签 === */}
      <div class="flex min-h-0 w-1/2 flex-col">
        <BookmarkPanel bookmarks={relatedBookmarks()} activeTags={tagPath()} />
      </div>

      <Toaster position="bottom-right" />
    </div>
  );
}

export default App;
