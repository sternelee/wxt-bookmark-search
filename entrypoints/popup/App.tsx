import { createSignal, onMount, For, Show, onCleanup } from "solid-js";
import { getIndexStats, hasApiKey, getIndexedBookmarks } from "../../src/db";
import { getRecentBookmarks } from "../../src/freq";
import { useI18n, setReactiveLocale } from "../../src/i18n";
import { getSettings } from "../../src/db";
import { Button } from "../../src/components/ui/button";
import { Separator } from "../../src/components/ui/separator";
import { Input } from "../../src/components/ui/input";
import Header from "./components/Header";
import SearchHint from "./components/SearchHint";
import StatsGrid from "./components/StatsGrid";
import RecentList from "./components/RecentList";
import IndexingHUD from "./components/IndexingHUD";

function App() {
  const { t } = useI18n();
  const [isConfigured, setIsConfigured] = createSignal(false);
  const [indexed, setIndexed] = createSignal(0);
  const [total, setTotal] = createSignal(0);
  const [recent, setRecent] = createSignal<
    Array<{ url: string; title: string; summary?: string; tags?: string[] }>
  >([]);
  const [indexingProgress, setIndexingProgress] = createSignal<{
    processed: number;
    total: number;
    status: string;
  } | null>(null);
  const [quickQuery, setQuickQuery] = createSignal("");

  const fetchStats = async () => {
    const stats = await getIndexStats();
    setIndexed(stats.indexed);
    setTotal(stats.total);
  };

  onMount(async () => {
    const settings = await getSettings();
    if (settings.language) {
      setReactiveLocale(settings.language as any);
    }
    const configured = await hasApiKey();
    setIsConfigured(configured);

    await fetchStats();

    // 获取最近访问
    const recentItems = await getRecentBookmarks(3);
    if (recentItems.length > 0) {
      setRecent(
        recentItems.map((r) => ({
          url: r.url,
          title: r.title || r.url,
          summary: r.summary,
        }))
      );
    }

    // 检查当前是否有索引任务在跑
    browser.runtime
      .sendMessage({ type: "GET_INDEXING_STATUS" })
      .then((status) => {
        if (status && status.isProcessing) {
          setIndexingProgress(status.progress);
        }
      });

    // 监听进度广播
    const handleMessage = (message: any) => {
      if (message.type === "INDEXING_PROGRESS") {
        setIndexingProgress(message.progress);
        if (
          message.progress.status === "complete" ||
          message.progress.status === "error"
        ) {
          setTimeout(() => setIndexingProgress(null), 2000);
          fetchStats();
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
    const searchPageUrl = browser.runtime.getURL("/search.html") + "?q=" + encodeURIComponent(trimmed);
    browser.tabs.create({ url: searchPageUrl, active: true });
  };

  return (
    <div class="w-[280px] p-5 bg-background text-foreground">
      <Header isConfigured={isConfigured()} />

      <SearchHint />

      {/* 快速搜索 */}
      <div class="flex gap-2 mb-4">
        <Input
          type="text"
          placeholder={t("popup.quickSearchPlaceholder")}
          value={quickQuery()}
          onInput={(e) => setQuickQuery(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") openSearchPage(quickQuery());
          }}
          class="flex-1"
        />
        <Button
          size="sm"
          onClick={() => openSearchPage(quickQuery())}
          disabled={!quickQuery().trim()}
        >
          🔍
        </Button>
      </div>

      <Separator class="my-4" />

      <StatsGrid indexed={indexed()} total={total()} />

      <Show when={indexingProgress()}>
        <IndexingHUD progress={indexingProgress()!} />
      </Show>

      <Show when={recent().length > 0}>
        <RecentList items={recent()} />
      </Show>

      <Button
        class="w-full"
        onClick={openSettings}
        size="lg"
      >
        {isConfigured() ? t("popup.manageSettings") : t("popup.goConfigure")}
      </Button>

      <div class="mt-4 text-center text-xs text-muted-foreground">
        {t("popup.poweredBy")}
      </div>
    </div>
  );
}

export default App;
