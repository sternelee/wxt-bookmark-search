import { createSignal, onMount, For, Show } from "solid-js";
import { getIndexStats, hasApiKey, getIndexedBookmarks } from "../../src/db";
import { getRecentBookmarks } from "../../src/freq";
import { Button } from "../../src/components/ui/button";
import { Separator } from "../../src/components/ui/separator";
import Header from "./components/Header";
import SearchHint from "./components/SearchHint";
import StatsGrid from "./components/StatsGrid";
import RecentList from "./components/RecentList";
import IndexingHUD from "./components/IndexingHUD";

function App() {
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

  const fetchStats = async () => {
    const stats = await getIndexStats();
    setIndexed(stats.indexed);
    setTotal(stats.total);
  };

  onMount(async () => {
    const configured = await hasApiKey();
    setIsConfigured(configured);

    await fetchStats();

    // 获取最近访问
    const recentUrls = getRecentBookmarks(3);
    if (recentUrls.length > 0) {
      const indexedItems = await getIndexedBookmarks();
      const recentItems = recentUrls.map((r) => {
        const item = indexedItems.find((i) => i.url === r.url);
        return {
          url: r.url,
          title: item?.title || r.url,
          summary: item?.summary,
          tags: item?.tags,
        };
      });
      setRecent(recentItems);
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
  });

  const openSettings = () => {
    browser.runtime.openOptionsPage();
  };

  return (
    <div class="w-[280px] p-5 bg-background text-foreground">
      <Header isConfigured={isConfigured()} />

      <SearchHint />

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
        {isConfigured() ? "管理索引与设置" : "去配置 API Key"}
      </Button>

      <div class="mt-4 text-center text-xs text-muted-foreground">
        Powered by SiliconFlow & Jina AI
      </div>
    </div>
  );
}

export default App;
