import { createSignal, onMount, Show, For } from "solid-js";
import { getSettings } from "../../src/db";
import { useI18n, setReactiveLocale } from "../../src/i18n";
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

function App() {
  const { t } = useI18n();
  const [isLoaded, setIsLoaded] = createSignal(false);

  // 分区导航锚点（title 键 → section id）
  const navSections = [
    { id: "section-api", titleKey: "options.api.title" },
    { id: "section-index", titleKey: "options.indexManager.title" },
    { id: "section-search", titleKey: "options.search.title" },
    { id: "section-digest", titleKey: "options.digest.title" },
    { id: "section-github", titleKey: "options.github.title" },
    { id: "section-twitter", titleKey: "options.twitter.title" },
    { id: "section-history", titleKey: "options.history.title" },
    { id: "section-language", titleKey: "options.language.title" },
    { id: "section-gist", titleKey: "options.gist.title" },
    { id: "section-cloud", titleKey: "options.cloudSync.title" },
    { id: "section-health", titleKey: "options.health.title" },
    { id: "section-duplicates", titleKey: "options.duplicates.title" },
    { id: "section-categorize", titleKey: "options.categorize.title" },
    { id: "section-data", titleKey: "common.dataManagement" },
  ] as const;

  // 功能页面入口（board / graph / wiki）
  const featurePages = [
    { page: "/board.html", titleKey: "options.nav.pageBoard" },
    { page: "/graph.html", titleKey: "options.nav.pageGraph" },
    { page: "/wiki.html", titleKey: "options.nav.pageWiki" },
  ] as const;

  onMount(async () => {
    // 预加载设置
    const settings = await getSettings();
    if (settings.language) {
      setReactiveLocale(settings.language as Parameters<typeof setReactiveLocale>[0]);
    }
    setIsLoaded(true);
  });

  return (
    <div class="w-full">
      <header class="flex items-center gap-3 mb-8">
        <h1 class="text-3xl font-extrabold tracking-tight">
          <span class="bg-gradient-to-r from-primary to-pink-500 bg-clip-text text-transparent">
            🤖 Flow Search
          </span>
          <span class="text-foreground"> {t("options.pageTitle")}</span>
        </h1>
      </header>

      <Show when={isLoaded()}>
        {/* 分区导航 + 功能页面入口 */}
        <nav class="mb-6 rounded-lg border border-border bg-muted/30 p-3">
          <div class="flex flex-wrap gap-2">
            <For each={navSections}>
              {(section) => (
                <a
                  href={`#${section.id}`}
                  class="text-xs px-2 py-1 rounded-md border border-border bg-background hover:bg-muted transition-colors"
                >
                  {t(section.titleKey)}
                </a>
              )}
            </For>
          </div>
          <div class="flex flex-wrap items-center gap-2 mt-2 pt-2 border-t border-border">
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

        <section id="section-api">
          <APISettings />
        </section>
        <section id="section-index">
          <IndexManager />
        </section>
        <section id="section-search">
          <SearchSettings />
        </section>
        <section id="section-digest">
          <DigestSettings />
        </section>
        <section id="section-github">
          <GitHubSettings />
        </section>
        <section id="section-twitter">
          <TwitterSettings />
        </section>
        <section id="section-history">
          <HistorySettings />
        </section>
        <section id="section-language">
          <LanguageSettings />
        </section>
        <section id="section-gist">
          <GistSyncSettings />
        </section>
        <section id="section-cloud">
          <CloudSyncSettings />
        </section>
        <section id="section-health">
          <HealthSettings />
        </section>
        <section id="section-duplicates">
          <DuplicateSettings />
        </section>
        <section id="section-categorize">
          <CategorizeSettings />
        </section>
        <FailedBookmarks />
        <section id="section-data">
          <DataManagement />
        </section>
      </Show>
    </div>
  );
}

export default App;
