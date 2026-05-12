import { createSignal, createMemo, Show, For, onMount } from "solid-js";
import {
  buildRootTagCloud,
  drillDown,
  getBookmarksByTags,
  getTagCloudStats,
} from "../../src/tag-cloud";
import type { BookmarkRecord } from "../../src/types";
import type { TagNode } from "../../src/tag-cloud";
import { TagCloud } from "./components/TagCloud";
import { BookmarkPanel } from "./components/BookmarkPanel";

function App() {
  // 所有已索引书签（从 background 获取）
  const [allRecords, setAllRecords] = createSignal<BookmarkRecord[]>([]);
  const [loading, setLoading] = createSignal(true);

  // 钻取路径（面包屑）
  const [tagPath, setTagPath] = createSignal<string[]>([]);

  // 当前展示的标签云节点
  const cloudNodes = createMemo<TagNode[]>(() => {
    const path = tagPath();
    if (path.length === 0) return buildRootTagCloud(allRecords());
    return drillDown(path, allRecords());
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
  }

  // 面包屑点击：回退到指定层级
  function handleBreadcrumb(index: number) {
    setTagPath(tagPath().slice(0, index + 1));
  }

  // 重置到根
  function handleReset() {
    setTagPath([]);
  }

  // 初始化
  onMount(loadRecords);

  return (
    <div class="flex h-screen bg-background text-foreground overflow-hidden">

      {/* === 左侧：标签云 === */}
      <div class="flex flex-col w-1/2 border-r border-border min-h-0">

        {/* 面包屑导航 */}
        <div class="flex items-center gap-1 px-4 py-2.5 border-b border-border text-sm min-h-[44px] shrink-0 overflow-x-auto">
          {/* 根节点 */}
          <button
            type="button"
            class={`shrink-0 hover:text-primary transition-colors rounded px-2 py-0.5 ${
              tagPath().length === 0
                ? "font-semibold text-foreground bg-muted"
                : "text-muted-foreground"
            }`}
            onClick={handleReset}
          >
            全部
          </button>

          <For each={tagPath()}>
            {(tag, i) => (
              <>
                <span class="text-muted-foreground shrink-0 select-none">›</span>
                <button
                  type="button"
                  class={`shrink-0 hover:text-primary transition-colors rounded px-2 py-0.5 ${
                    i() === tagPath().length - 1
                      ? "font-semibold text-foreground bg-muted"
                      : "text-muted-foreground"
                  }`}
                  onClick={() => handleBreadcrumb(i())}
                  title={`返回到 "${tag}" 层级`}
                >
                  {tag}
                </button>
              </>
            )}
          </For>

          <Show when={tagPath().length > 0}>
            <span class="ml-auto shrink-0 text-xs text-muted-foreground pr-2">
              {relatedBookmarks().length} 个书签
            </span>
          </Show>
        </div>

        {/* 标签云主体 */}
        <div class="flex-1 min-h-0 relative">
          <div class="absolute inset-0 transition-opacity duration-300">
            <TagCloud
              nodes={cloudNodes()}
              activeTags={tagPath()}
              onTagClick={handleTagClick}
              isLoading={loading()}
            />
          </div>
        </div>

        {/* 底部提示 + 统计 */}
        <div class="px-4 py-2 border-t border-border text-xs text-muted-foreground shrink-0 flex justify-between">
          <Show
            when={tagPath().length === 0}
            fallback={
              <span>继续点击标签精细筛选 · 点击面包屑返回上级</span>
            }
          >
            <span>
              {loading()
                ? "加载中..."
                : `${stats().totalTags} 个标签 · ${stats().totalTags > 0 ? stats().topTag + " 最多" : ""}`}
            </span>
          </Show>
          <span class="text-primary opacity-70">字号越大 = 关联越多</span>
        </div>
      </div>

      {/* === 右侧：关联书签 === */}
      <div class="flex flex-col w-1/2 min-h-0">
        <BookmarkPanel
          bookmarks={relatedBookmarks()}
          activeTags={tagPath()}
        />
      </div>
    </div>
  );
}

export default App;