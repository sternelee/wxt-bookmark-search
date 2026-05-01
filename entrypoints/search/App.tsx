import { createSignal, onMount, For, Show, onCleanup } from "solid-js";
import { HtmlRenderer } from "../../src/components/HtmlRenderer";
import { incrementFreq } from "../../src/freq";
import { getSettings } from "../../src/db";
import { useI18n, setReactiveLocale } from "../../src/i18n";
import type { SearchResult } from "../../src/types";

function sourceIcon(source: string): string {
  if (source === "github") return "⭐";
  if (source === "twitter") return "𝕏";
  return "🔖";
}

function App() {
  const { t } = useI18n();
  const params = new URLSearchParams(location.search);
  const initialQuery = params.get("q") ?? "";

  const [query, setQuery] = createSignal(initialQuery);
  const [results, setResults] = createSignal<SearchResult[]>([]);
  const [loading, setLoading] = createSignal(false);
  const [errorMsg, setErrorMsg] = createSignal("");
  const [selectedIdx, setSelectedIdx] = createSignal(-1);

  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let searchId = 0;

  const doSearch = async (q: string) => {
    const trimmed = q.trim();
    if (!trimmed) {
      setResults([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    setErrorMsg("");
    const currentId = ++searchId;

    try {
      const resp = await browser.runtime.sendMessage({
        type: "FULL_SEARCH",
        query: trimmed,
      });

      if (currentId !== searchId) return; // 丢弃过期响应
      if (resp?.success) {
        setResults(resp.results ?? []);
      } else {
        setErrorMsg(resp?.error ?? t("search.searchFailed"));
      }
    } catch (e: any) {
      if (currentId !== searchId) return;
      setErrorMsg(e?.message ?? t("search.searchError"));
    } finally {
      if (currentId === searchId) setLoading(false);
    }
  };

  const handleInput = (value: string) => {
    setQuery(value);
    setSelectedIdx(-1);

    // 同步 URL 参数，支持刷新/浏览器后退
    const url = new URL(location.href);
    url.searchParams.set("q", value);
    history.replaceState(null, "", url.toString());

    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => doSearch(value), 300);
  };

  const openResult = (url: string) => {
    incrementFreq(url);
    browser.tabs.create({ url });
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    const rs = results();
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIdx((i) => Math.min(i + 1, rs.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIdx((i) => Math.max(i - 1, -1));
    } else if (e.key === "Enter") {
      const idx = selectedIdx();
      if (idx >= 0 && rs[idx]) openResult(rs[idx].url);
    } else if (e.key === "Escape") {
      window.close();
    }
  };

  let inputRef: HTMLInputElement | undefined;

  onMount(async () => {
    const settings = await getSettings();
    if (settings.language) {
      setReactiveLocale(settings.language as any);
    }
    inputRef?.focus();
    if (initialQuery) doSearch(initialQuery);
  });

  onCleanup(() => {
    if (debounceTimer) clearTimeout(debounceTimer);
  });

  return (
    <div
      class="min-h-screen bg-background text-foreground"
      onKeyDown={handleKeyDown}
    >
      {/* 顶部搜索栏 */}
      <header class="sticky top-0 z-10 bg-background/95 backdrop-blur border-b border-border px-6 py-3">
        <div class="flex items-center gap-3 max-w-3xl mx-auto">
          <span class="text-xl select-none">🔍</span>
          <input
            ref={inputRef}
            id="search-input"
            type="search"
            class="flex-1 bg-muted rounded-lg px-4 py-2 text-base outline-none focus:ring-2 focus:ring-primary placeholder:text-muted-foreground"
            placeholder={t("search.placeholder")}
            value={query()}
            onInput={(e) => handleInput(e.currentTarget.value)}
            autocomplete="off"
            spellcheck={false}
          />
          <Show when={loading()}>
            <span class="text-muted-foreground text-lg animate-spin select-none">
              ◌
            </span>
          </Show>
        </div>
        <p class="text-xs text-muted-foreground max-w-3xl mx-auto mt-1 pl-9">
          {t("search.syntaxHint")}：<code class="bg-muted px-1 rounded">{t("search.githubFilter")}</code>{" "}
          <code class="bg-muted px-1 rounded">{t("search.twitterFilter")}</code>{" "}
          <code class="bg-muted px-1 rounded">{t("search.folderFilter")}</code> ·
          {t("search.keyboardHint")}
        </p>
      </header>

      {/* 结果列表 */}
      <main class="max-w-3xl mx-auto px-6 py-5">
        <Show when={errorMsg()}>
          <div class="rounded-lg border border-destructive/50 bg-destructive/10 text-destructive px-4 py-3 mb-4 text-sm">
            {errorMsg()}
          </div>
        </Show>

        <Show when={!loading() && results().length === 0 && query().trim()}>
          <div class="text-center py-16 text-muted-foreground">
            <p class="text-4xl mb-4">🔎</p>
            <p class="text-base">{t("search.noResults", { query: query() })}</p>
            <p class="text-sm mt-2">{t("search.tryOther")}</p>
          </div>
        </Show>

        <Show when={!query().trim() && results().length === 0 && !loading()}>
          <div class="text-center py-16 text-muted-foreground">
            <p class="text-4xl mb-4">🗂️</p>
            <p class="text-base">{t("search.emptyState")}</p>
          </div>
        </Show>

        <For each={results()}>
          {(result, idx) => (
            <div
              class={`rounded-lg border border-border p-4 mb-2.5 cursor-pointer transition-colors hover:bg-accent ${
                selectedIdx() === idx()
                  ? "bg-accent ring-2 ring-primary ring-offset-1"
                  : ""
              }`}
              onClick={() => openResult(result.url)}
              onMouseEnter={() => setSelectedIdx(idx())}
            >
              <div class="flex items-start gap-3">
                <span class="text-lg shrink-0 select-none mt-0.5">
                  {sourceIcon(result.source)}
                </span>
                <div class="min-w-0 flex-1 overflow-hidden">
                  <div class="font-semibold text-sm truncate">
                    {result.title || result.url}
                  </div>
                  <div class="text-xs text-muted-foreground truncate mt-0.5">
                    {result.url}
                  </div>
                  <Show when={result.summary}>
                    <div class="mt-1.5">
                      <HtmlRenderer
                        html={result.summary}
                        source={result.source}
                        class="line-clamp-3"
                      />
                    </div>
                  </Show>
                  <Show when={result.tags && result.tags.length > 0}>
                    <div class="flex flex-wrap gap-1 mt-2">
                      <For each={result.tags.slice(0, 6)}>
                        {(tag) => (
                          <span class="text-xs bg-secondary text-secondary-foreground px-2 py-0.5 rounded-full">
                            {tag}
                          </span>
                        )}
                      </For>
                    </div>
                  </Show>
                </div>
                <Show when={result.indexed}>
                  <span
                    class="text-xs text-muted-foreground shrink-0 mt-0.5"
                    title={t("search.aiIndexed")}
                  >
                    🤖
                  </span>
                </Show>
              </div>
            </div>
          )}
        </For>

        <Show when={results().length > 0}>
          <p class="text-center text-xs text-muted-foreground mt-4">
            {t("search.resultsCount", { count: results().length })}
          </p>
        </Show>
      </main>
    </div>
  );
}

export default App;
