import { createSignal, onMount, Show } from "solid-js";
import { getSettings } from "../../src/db";
import { useI18n, setReactiveLocale } from "../../src/i18n";
import APISettings from "./components/APISettings";
import GitHubSettings from "./components/GitHubSettings";
import TwitterSettings from "./components/TwitterSettings";
import HistorySettings from "./components/HistorySettings";
import GistSyncSettings from "./components/GistSyncSettings";
import SearchSettings from "./components/SearchSettings";
import LanguageSettings from "./components/LanguageSettings";
import IndexManager from "./components/IndexManager";
import FailedBookmarks from "./components/FailedBookmarks";
import DataManagement from "./components/DataManagement";
import HealthSettings from "./components/HealthSettings";
import DuplicateSettings from "./components/DuplicateSettings";
import CategorizeSettings from "./components/CategorizeSettings";

function App() {
  const { t } = useI18n();
  const [isLoaded, setIsLoaded] = createSignal(false);

  onMount(async () => {
    // 预加载设置
    const settings = await getSettings();
    if (settings.language) {
      setReactiveLocale(settings.language as any);
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
        <APISettings />
        <IndexManager />
        <GitHubSettings />
        <TwitterSettings />
        <HistorySettings />
        <LanguageSettings />
        <SearchSettings />
        <GistSyncSettings />
        <HealthSettings />
        <DuplicateSettings />
        <CategorizeSettings />
        <FailedBookmarks />
        <DataManagement />
      </Show>
    </div>
  );
}

export default App;
