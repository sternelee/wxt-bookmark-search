import { createSignal, onMount, Show } from "solid-js";
import { getSettings } from "../../src/db";
import APISettings from "./components/APISettings";
import GitHubSettings from "./components/GitHubSettings";
import TwitterSettings from "./components/TwitterSettings";
import GistSyncSettings from "./components/GistSyncSettings";
import SearchSettings from "./components/SearchSettings";
import IndexManager from "./components/IndexManager";
import FailedBookmarks from "./components/FailedBookmarks";

function App() {
  const [isLoaded, setIsLoaded] = createSignal(false);

  onMount(async () => {
    // 预加载设置
    await getSettings();
    setIsLoaded(true);
  });

  return (
    <div class="w-full">
      <header class="flex items-center gap-3 mb-8">
        <h1 class="text-3xl font-extrabold tracking-tight">
          <span class="bg-gradient-to-r from-primary to-pink-500 bg-clip-text text-transparent">
            🤖 Flow Search
          </span>
          <span class="text-foreground"> 设置</span>
        </h1>
      </header>

      <Show when={isLoaded()}>
        <APISettings />
        <GitHubSettings />
        <TwitterSettings />
        <GistSyncSettings />
        <SearchSettings />
        <IndexManager />
        <FailedBookmarks />
      </Show>
    </div>
  );
}

export default App;
