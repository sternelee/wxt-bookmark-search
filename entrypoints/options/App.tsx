import { createSignal, onMount, onCleanup, Show, For } from "solid-js";
import type { Component } from "solid-js";
import { Dynamic } from "solid-js/web";
import { getSettings } from "../../src/db";
import { useI18n, setReactiveLocale } from "../../src/i18n";
import type { I18nKey } from "../../src/i18n";
import { cn } from "../../src/lib/utils";
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

/** 从 location.hash（#section-xxx，兼容裸 #xxx）解析出 tab id，非法或缺失时返回 null */
function readTabFromHash(): string | null {
  const id = window.location.hash.replace(/^#(?:section-)?/, "");
  return ALL_TABS.some((tab) => tab.id === id) ? id : null;
}

function App() {
  const { t } = useI18n();
  const [isLoaded, setIsLoaded] = createSignal(false);
  const [activeTab, setActiveTab] = createSignal<string>(ALL_TABS[0].id);

  // 功能页面入口（board / graph / wiki）
  const featurePages = [
    { page: "/board.html", titleKey: "options.nav.pageBoard" },
    { page: "/graph.html", titleKey: "options.nav.pageGraph" },
    { page: "/wiki.html", titleKey: "options.nav.pageWiki" },
  ] as const;

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
    <div class="w-full">
      <header class="flex items-center gap-3 mb-6">
        <h1 class="text-3xl font-extrabold tracking-tight">
          <span class="bg-gradient-to-r from-primary to-pink-500 bg-clip-text text-transparent">
            🤖 Flow Search
          </span>
          <span class="text-foreground"> {t("options.pageTitle")}</span>
        </h1>
      </header>

      <Show when={isLoaded()}>
        {/* 分组 tab 导航 + 功能页面入口 */}
        <nav class="mb-6 rounded-lg border border-border bg-muted/30 p-3 space-y-2">
          <For each={TAB_GROUPS}>
            {(group) => (
              <div class="flex items-start gap-3">
                <span class="hidden sm:block shrink-0 w-20 pt-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  {t(group.labelKey)}
                </span>
                <div class="flex flex-wrap gap-1.5" role="tablist">
                  <For each={group.tabs}>
                    {(tab) => {
                      const isActive = () => activeTab() === tab.id;
                      return (
                        <button
                          type="button"
                          role="tab"
                          aria-selected={isActive()}
                          class={cn(
                            "text-xs px-2.5 py-1.5 rounded-md border transition-colors",
                            isActive()
                              ? "bg-primary text-primary-foreground border-primary shadow-sm font-medium"
                              : "bg-background border-border text-muted-foreground hover:bg-muted hover:text-foreground",
                          )}
                          onClick={() => selectTab(tab.id)}
                        >
                          {t(tab.titleKey)}
                        </button>
                      );
                    }}
                  </For>
                </div>
              </div>
            )}
          </For>

          <div class="flex flex-wrap items-center gap-2 pt-2 border-t border-border">
            <span class="text-xs font-medium text-muted-foreground">
              {t("options.nav.pages")}:
            </span>
            <For each={featurePages}>
              {(page) => (
                <button
                  type="button"
                  class="text-xs px-2 py-1 rounded-md border border-border bg-background hover:bg-muted transition-colors text-blue-600 hover:text-blue-800"
                  onClick={() => {
                    const url = (browser.runtime.getURL as (p: string) => string)(page.page);
                    browser.tabs.create({ url }).catch(() => {});
                  }}
                >
                  {t(page.titleKey)}
                </button>
              )}
            </For>
          </div>
        </nav>

        {/* 当前 tab 的内容面板 —— 全部保持挂载，仅切换可见性，避免切换 tab 时丢失未保存的表单输入 */}
        <For each={ALL_TABS}>
          {(tab) => (
            <div
              id={`section-${tab.id}`}
              role="tabpanel"
              class={activeTab() === tab.id ? "block" : "hidden"}
            >
              <Dynamic component={tab.Panel} />
            </div>
          )}
        </For>
      </Show>
    </div>
  );
}

export default App;
