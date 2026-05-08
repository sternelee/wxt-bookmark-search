import { createSignal, onMount, For, Show, onCleanup } from "solid-js";
import { HtmlRenderer } from "../../src/components/HtmlRenderer";
import SummarizePanel from "../../src/components/SummarizePanel";
import { incrementFreq } from "../../src/freq";
import { getSettings } from "../../src/db";
import { useI18n, setReactiveLocale } from "../../src/i18n";
import type { SearchResult, SummarizeResult } from "../../src/types";

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

  // 摘要侧边栏
  const [summaryLoading, setSummaryLoading] = createSignal(false);
  const [summaryResult, setSummaryResult] =
    createSignal<SummarizeResult | null>(null);

  // RAG 问答
  const [askQuestion, setAskQuestion] = createSignal("");
  const [askLoading, setAskLoading] = createSignal(false);
  const [askAnswer, setAskAnswer] = createSignal("");
  const [askCitations, setAskCitations] = createSignal<
    { title: string; url: string; excerpt: string }[]
  >([]);
  const [askError, setAskError] = createSignal("");

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

  const handleSummarize = async (url: string, title: string) => {
    setSummaryLoading(true);
    setSummaryResult(null);
    try {
      const resp = await browser.runtime.sendMessage({
        type: "SUMMARIZE_URL",
        url,
      });
      if (resp?.success) {
        setSummaryResult({
          url: resp.url,
          title: resp.title,
          summary: resp.summary,
          tags: resp.tags || [],
          excerpt: resp.excerpt || "",
        });
      } else {
        setSummaryResult({
          url,
          title,
          summary: resp?.error || "Summary failed",
          tags: [],
          excerpt: "",
        });
      }
    } catch (e: any) {
      setSummaryResult({
        url,
        title,
        summary: e?.message || "Summary failed",
        tags: [],
        excerpt: "",
      });
    } finally {
      setSummaryLoading(false);
    }
  };

  const closeSummary = () => {
    setSummaryResult(null);
    setSummaryLoading(false);
  };

  const handleAsk = async () => {
    const q = askQuestion().trim();
    if (!q) return;
    setAskLoading(true);
    setAskAnswer("");
    setAskCitations([]);
    setAskError("");
    try {
      const resp = await browser.runtime.sendMessage({
        type: "ASK_BOOKMARKS",
        question: q,
      });
      if (resp?.success) {
        setAskAnswer(resp.answer || "");
        setAskCitations(resp.citations || []);
      } else {
        setAskError(resp?.error || "Q&A failed");
      }
    } catch (e: any) {
      setAskError(e?.message || "Q&A failed");
    } finally {
      setAskLoading(false);
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
          {t("search.syntaxHint")}：
          <code class="bg-muted px-1 rounded">{t("search.githubFilter")}</code>{" "}
          <code class="bg-muted px-1 rounded">{t("search.twitterFilter")}</code>{" "}
          <code class="bg-muted px-1 rounded">{t("search.folderFilter")}</code>{" "}
          ·{t("search.keyboardHint")}
        </p>

        {/* Q&A 问答栏 */}
        <div class="flex items-center gap-2 max-w-3xl mx-auto mt-2 pl-9">
          <span class="text-sm shrink-0 select-none">💬</span>
          <input
            type="text"
            class="flex-1 bg-muted rounded-lg px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-primary placeholder:text-muted-foreground"
            placeholder={t("search.askPlaceholder")}
            value={askQuestion()}
            onInput={(e) => setAskQuestion(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleAsk();
            }}
          />
          <button
            type="button"
            class="shrink-0 text-sm px-3 py-1.5 rounded-lg bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-50"
            onClick={handleAsk}
            disabled={askLoading() || !askQuestion().trim()}
          >
            {askLoading() ? "..." : t("search.askButton")}
          </button>
        </div>
      </header>

      {/* RAG 问答结果 */}
      <Show when={askAnswer() || askError()}>
        <div class="max-w-3xl mx-auto px-6 mt-3">
          <Show when={askError()}>
            <div class="rounded-lg border border-destructive/50 bg-destructive/10 text-destructive px-4 py-3 text-sm">
              {askError()}
            </div>
          </Show>
          <Show when={askAnswer()}>
            <div class="rounded-lg border border-border bg-accent/30 p-4">
              <div class="text-sm leading-relaxed whitespace-pre-wrap">
                {askAnswer()}
              </div>
              <Show when={askCitations().length > 0}>
                <div class="mt-3 pt-3 border-t border-border">
                  <div class="text-xs font-semibold text-muted-foreground mb-2">
                    {t("search.answerSources")}
                  </div>
                  <For each={askCitations()}>
                    {(cite, i) => (
                      <div class="text-xs mb-1">
                        <a
                          href={cite.url}
                          target="_blank"
                          class="text-blue-600 hover:underline"
                        >
                          [{i() + 1}] {cite.title}
                        </a>
                      </div>
                    )}
                  </For>
                </div>
              </Show>
            </div>
          </Show>
        </div>
      </Show>

      {/* 结果列表 + 侧边栏 */}
      <div class="max-w-5xl mx-auto px-6 py-5 flex gap-4 items-start">
        <main class="flex-1 min-w-0">
          <Show when={errorMsg()}>
            <div class="rounded-lg border border-destructive/50 bg-destructive/10 text-destructive px-4 py-3 mb-4 text-sm">
              {errorMsg()}
            </div>
          </Show>

          <Show when={!loading() && results().length === 0 && query().trim()}>
            <div class="text-center py-16 text-muted-foreground">
              <p class="text-4xl mb-4">🔎</p>
              <p class="text-base">
                {t("search.noResults", { query: query() })}
              </p>
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
                        <Show
                          when={result.source === "github"}
                          fallback={
                            <HtmlRenderer
                              html={result.summary}
                              source={result.source}
                              class="line-clamp-3"
                            />
                          }
                        >
                          <p class="text-sm text-foreground/80 leading-relaxed line-clamp-3">
                            {result.summary}
                          </p>
                        </Show>
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

                    <button
                      type="button"
                      class="text-xs text-blue-600 hover:text-blue-800 mt-2"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleSummarize(result.url, result.title || result.url);
                      }}
                    >
                      ✨ {t("search.summarize").replace("✨ ", "")}
                    </button>
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

        {/* 摘要侧边栏 */}
        <Show when={summaryLoading() || summaryResult()}>
          <SummarizePanel
            result={summaryResult()}
            loading={summaryLoading()}
            onClose={closeSummary}
          />
        </Show>
      </div>
    </div>
  );
}

export default App;
