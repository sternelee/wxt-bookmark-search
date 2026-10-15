import { createSignal, onMount, onCleanup, Show, For } from "solid-js";
import type { Component } from "solid-js";
import { Dynamic } from "solid-js/web";
import { getSettings } from "../../src/db";
import { useI18n, setReactiveLocale } from "../../src/i18n";
import type { I18nKey } from "../../src/i18n";
import { cn } from "../../src/lib/utils";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "../../src/components/ui/tabs";
import { Separator } from "../../src/components/ui/separator";
import { Skeleton } from "../../src/components/ui/skeleton";
import { Toaster } from "../../src/components/ui/sonner";
import APISettings from "./components/APISettings";
import GitHubSettings from "./components/GitHubSettings";
import TwitterSettings from "./components/TwitterSettings";
import HistorySettings from "./components/HistorySettings";
import GistSyncSettings from "./components/GistSyncSettings";
import CloudSyncSettings from "./components/CloudSyncSettings";
import SearchSettings from "./components/SearchSettings";
import LanguageSettings from "./components/LanguageSettings";
import IndexManager from "./components/IndexManager";
import FailedBookmarks from "./components/FailedBookmarks";
import DataManagement from "./components/DataManagement";
import HealthSettings from "./components/HealthSettings";
import DuplicateSettings from "./components/DuplicateSettings";
import CategorizeSettings from "./components/CategorizeSettings";
import DigestSettings from "./components/DigestSettings";

interface OptionsTab {
  id: string;
  titleKey: I18nKey;
  Panel: Component;
}

interface OptionsTabGroup {
  labelKey: I18nKey;
  tabs: OptionsTab[];
}

/**
 * 配置分区定义 —— 按主题分组，每组内是一个 tab。
 * tab.id 同时用作 URL hash 锚点（#section-<id>），保持深链兼容。
 */
const TAB_GROUPS: OptionsTabGroup[] = [
  {
    labelKey: "options.nav.groupCore",
    tabs: [
      { id: "api", titleKey: "options.api.title", Panel: APISettings },
      { id: "search", titleKey: "options.search.title", Panel: SearchSettings },
      { id: "language", titleKey: "options.language.title", Panel: LanguageSettings },
    ],
  },
  {
    labelKey: "options.nav.groupAI",
    tabs: [
      { id: "index", titleKey: "options.indexManager.title", Panel: IndexManager },
      { id: "digest", titleKey: "options.digest.title", Panel: DigestSettings },
      { id: "categorize", titleKey: "options.categorize.title", Panel: CategorizeSettings },
      { id: "duplicates", titleKey: "options.duplicates.title", Panel: DuplicateSettings },
    ],
  },
  {
    labelKey: "options.nav.groupSources",
    tabs: [
      { id: "github", titleKey: "options.github.title", Panel: GitHubSettings },
      { id: "twitter", titleKey: "options.twitter.title", Panel: TwitterSettings },
      { id: "history", titleKey: "options.history.title", Panel: HistorySettings },
    ],
  },
  {
    labelKey: "options.nav.groupSync",
    tabs: [
      { id: "gist", titleKey: "options.gist.title", Panel: GistSyncSettings },
      { id: "cloud", titleKey: "options.cloudSync.title", Panel: CloudSyncSettings },
    ],
  },
  {
    labelKey: "options.nav.groupData",
    tabs: [
      { id: "health", titleKey: "options.health.title", Panel: HealthSettings },
      { id: "failed", titleKey: "options.failedBookmarks.title", Panel: FailedBookmarks },
      { id: "data", titleKey: "common.dataManagement", Panel: DataManagement },
    ],
  },
];

const ALL_TABS: OptionsTab[] = TAB_GROUPS.flatMap((group) => group.tabs);

/** 功能页面入口（board / graph / wiki） */
const FEATURE_PAGES = [
  { page: "/board.html", titleKey: "options.nav.pageBoard" },
  { page: "/graph.html", titleKey: "options.nav.pageGraph" },
  { page: "/wiki.html", titleKey: "options.nav.pageWiki" },
] as const satisfies readonly { page: string; titleKey: I18nKey }[];

/** 从 location.hash（#section-xxx，兼容裸 #xxx）解析出 tab id，非法或缺失时返回 null */
function readTabFromHash(): string | null {
  const id = window.location.hash.replace(/^#(?:section-)?/, "");
  return ALL_TABS.some((tab) => tab.id === id) ? id : null;
}

function App() {
  const { t } = useI18n();
  const [isLoaded, setIsLoaded] = createSignal(false);
  const [activeTab, setActiveTab] = createSignal<string>(ALL_TABS[0].id);

  /** 切换 tab 并同步 URL hash（用 replaceState 避免页面滚动跳动） */
  const selectTab = (id: string) => {
    setActiveTab(id);
    const nextHash = `#section-${id}`;
    if (window.location.hash !== nextHash) {
      window.history.replaceState(null, "", nextHash);
    }
  };

  /** 跟随 URL hash 切换 tab（用于初始深链与浏览器前进/后退） */
  const syncTabFromHash = () => {
    const tabId = readTabFromHash();
    if (tabId) setActiveTab(tabId);
  };

  onMount(async () => {
    // 预加载设置
    const settings = await getSettings();
    if (settings.language) {
      setReactiveLocale(settings.language as Parameters<typeof setReactiveLocale>[0]);
    }

    syncTabFromHash();
    window.addEventListener("hashchange", syncTabFromHash);
    setIsLoaded(true);
  });

  onCleanup(() => window.removeEventListener("hashchange", syncTabFromHash));

  return (
    <div class="w-full pb-16">
      <header class="mb-7 flex flex-wrap items-center justify-between gap-4">
        <div class="flex items-center gap-3">
          <span class="grid size-11 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-primary to-pink-500 text-xl shadow-sm">
            🤖
          </span>
          <div class="leading-tight">
            <h1 class="text-2xl font-extrabold tracking-tight">
              Flow Search
              <span class="ml-2 text-base font-medium text-muted-foreground">
                {t("options.pageTitle")}
              </span>
            </h1>
          </div>
        </div>

        <nav class="flex flex-wrap items-center gap-1.5">
          <span class="text-xs font-medium text-muted-foreground">
            {t("options.nav.pages")}
          </span>
          <For each={FEATURE_PAGES}>
            {(page) => (
              <button
                type="button"
                class="rounded-md border border-border bg-card px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                onClick={() => {
                  browser.tabs.create({ url: browser.runtime.getURL(page.page) }).catch(() => {});
                }}
              >
                {t(page.titleKey)}
              </button>
            )}
          </For>
        </nav>
      </header>

      <Show
        when={isLoaded()}
        fallback={
          <div class="flex flex-col gap-6 lg:flex-row lg:gap-8">
            <Skeleton class="h-72 w-full rounded-xl lg:w-60" />
            <Skeleton class="h-96 flex-1 rounded-xl" />
          </div>
        }
      >
        {/* 面板全部保持挂载（forceMount + hidden），切换 tab 不会丢弃未保存的表单输入 */}
        <Tabs
          value={activeTab()}
          onChange={selectTab}
          orientation="vertical"
          class="flex flex-col gap-5 lg:flex-row lg:items-start lg:gap-8"
        >
          <aside class="w-full shrink-0 lg:sticky lg:top-6 lg:w-60">
            <TabsList class="flex h-auto w-full flex-wrap items-stretch justify-start gap-0.5 rounded-xl border border-border bg-card p-1.5 shadow-sm lg:flex-col lg:flex-nowrap">
              <For each={TAB_GROUPS}>
                {(group, groupIndex) => (
                  <>
                    <Show when={groupIndex() > 0}>
                      <Separator class="my-1 hidden lg:block" />
                    </Show>
                    <div
                      aria-hidden="true"
                      class="hidden px-2.5 pb-1.5 pt-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground lg:block"
                    >
                      {t(group.labelKey)}
                    </div>
                    <For each={group.tabs}>
                      {(tab) => (
                        <TabsTrigger
                          value={tab.id}
                          class={cn(
                            "w-auto shrink-0 justify-start whitespace-nowrap rounded-lg px-2.5 py-1.5 text-[13px] font-normal text-muted-foreground",
                            // 竖向侧栏里允许换行：窄栏容不下「☁️ 云端同步（Google Drive / Dropbox / WebDAV）」这类长标题
                            "lg:w-full lg:min-w-0 lg:shrink lg:items-start lg:whitespace-normal lg:text-left lg:leading-snug lg:break-words",
                            "hover:bg-muted hover:text-foreground",
                            "data-[selected]:bg-primary data-[selected]:font-medium data-[selected]:text-primary-foreground data-[selected]:shadow-sm",
                          )}
                        >
                          {t(tab.titleKey)}
                        </TabsTrigger>
                      )}
                    </For>
                  </>
                )}
              </For>
            </TabsList>
          </aside>

          <div class="min-w-0 flex-1">
            <For each={ALL_TABS}>
              {(tab) => (
                <TabsContent
                  value={tab.id}
                  forceMount
                  class={cn(
                    "mt-0 focus-visible:outline-none",
                    activeTab() === tab.id ? "block" : "hidden",
                  )}
                >
                  <Dynamic component={tab.Panel} />
                </TabsContent>
              )}
            </For>
          </div>
        </Tabs>
      </Show>

      <Toaster position="bottom-right" />
    </div>
  );
}

export default App;
