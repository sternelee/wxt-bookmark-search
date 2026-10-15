import { createSignal, onMount, For, Show, onCleanup } from "solid-js";
import { getIndexStats, hasApiKey, getIndexedBookmarks } from "../../src/db";
import { getRecentBookmarks } from "../../src/freq";
import { useI18n, setReactiveLocale } from "../../src/i18n";
import type { Locale } from "../../src/i18n";
import { getSettings } from "../../src/db";
import { Button } from "../../src/components/ui/button";
import { Separator } from "../../src/components/ui/separator";
import { Skeleton } from "../../src/components/ui/skeleton";
import { Toaster } from "../../src/components/ui/sonner";
import { TextField, TextFieldInput } from "../../src/components/ui/text-field";
import Header from "./components/Header";
import SearchHint from "./components/SearchHint";
import StatsGrid from "./components/StatsGrid";
import RecentList from "./components/RecentList";
import IndexingHUD from "./components/IndexingHUD";

type BookmarkTreeNode = {
  url?: string;
  children?: BookmarkTreeNode[];
};

function countBrowserBookmarks(nodes: BookmarkTreeNode[]): number {
  let count = 0;
  for (const node of nodes) {
    if (node.url) {
      count += 1;
    }
    if (node.children) {
      count += countBrowserBookmarks(node.children);
    }
  }
  return count;
}

interface IndexingProgress {
  processed: number;
  total: number;
  status: string;
}

function App() {
  const { t } = useI18n();
  const [isReady, setIsReady] = createSignal(false);
  const [isConfigured, setIsConfigured] = createSignal(false);
  const [indexed, setIndexed] = createSignal(0);
  const [total, setTotal] = createSignal(0);
  const [recent, setRecent] = createSignal<
    Array<{
      url: string;
      title: string;
      summary?: string;
      tags?: string[];
      source?: "github" | "twitter" | "bookmark" | "history";
    }>
  >([]);
  const [indexingProgress, setIndexingProgress] = createSignal<IndexingProgress | null>(null);
  const [quickQuery, setQuickQuery] = createSignal("");

  const fetchStats = async () => {
    const [stats, tree] = await Promise.all([getIndexStats(), browser.bookmarks.getTree()]);
    setIndexed(stats.indexed);
    setTotal(countBrowserBookmarks(tree));
  };

  onMount(async () => {
    const settings = await getSettings();
    if (settings.language) {
      setReactiveLocale(settings.language as Locale);
    }
    setIsConfigured(await hasApiKey());

    await fetchStats();

    // 获取最近访问
    const recentItems = await getRecentBookmarks(3);
    if (recentItems.length > 0) {
      setRecent(
        recentItems.map((r) => ({
          url: r.url,
          title: r.title || r.url,
          summary: r.summary,
          source: r.source,
        })),
      );
    }
    setIsReady(true);

    // 检查当前是否有索引任务在跑
    browser.runtime
      .sendMessage({ type: "GET_INDEXING_STATUS" })
      .then((status) => {
        if (status && status.isProcessing) {
          setIndexingProgress(status.progress);
        }
      })
      .catch(() => {});

    // 监听进度广播
    const handleMessage = (message: { type?: string; progress?: IndexingProgress }) => {
      if (message.type === "INDEXING_PROGRESS" && message.progress) {
        setIndexingProgress(message.progress);
        if (message.progress.status === "complete" || message.progress.status === "error") {
          setTimeout(() => setIndexingProgress(null), 2000);
          fetchStats().catch(() => {});
        }
      }
    };
    browser.runtime.onMessage.addListener(handleMessage);

    onCleanup(() => {
      browser.runtime.onMessage.removeListener(handleMessage);
    });
  });

  const openSettings = () => {
    browser.runtime.openOptionsPage();
  };

  const openSearchPage = (query: string) => {
    const trimmed = query.trim();
    if (!trimmed) return;
    const searchPageUrl = browser.runtime.getURL("/board.html") + "?q=" + encodeURIComponent(trimmed);
    browser.tabs.create({ url: searchPageUrl, active: true }).catch(() => {});
  };

  return (
    <div class="w-[340px] bg-background text-foreground">
      <div class="flex flex-col gap-4 p-5">
        <Header isConfigured={isConfigured()} />

        {/* 快速搜索 */}
        <div class="flex flex-col gap-2">
          <div class="flex gap-2">
            <TextField
              value={quickQuery()}
              onChange={setQuickQuery}
              class="min-w-0 flex-1"
              aria-label={t("popup.quickSearchPlaceholder")}
            >
              <TextFieldInput
                type="text"
                placeholder={t("popup.quickSearchPlaceholder")}
                onKeyDown={(e) => {
                  if (e.key === "Enter") openSearchPage(quickQuery());
                }}
              />
            </TextField>
            <Button
              size="icon"
              onClick={() => openSearchPage(quickQuery())}
              disabled={!quickQuery().trim()}
              title={t("common.search")}
              aria-label={t("common.search")}
            >
              🔍
            </Button>
          </div>
          <SearchHint />
        </div>

        <Separator />

        <Show
          when={isReady()}
          fallback={
            <div class="flex flex-col gap-3">
              <Skeleton class="h-[68px] w-full rounded-xl" />
              <Skeleton class="h-16 w-full rounded-xl" />
            </div>
          }
        >
          <StatsGrid indexed={indexed()} total={total()} />

          <Show when={indexingProgress()}>
            <IndexingHUD progress={indexingProgress()!} />
          </Show>

          <RecentList items={recent()} />
        </Show>

        <Button class="w-full" onClick={openSettings} size="lg">
          {isConfigured() ? t("popup.manageSettings") : t("popup.goConfigure")}
        </Button>

        <p class="text-center text-[11px] text-muted-foreground">{t("popup.poweredBy")}</p>
      </div>

      <Toaster position="bottom-center" />
    </div>
  );
}

export default App;
