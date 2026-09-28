import {
  createSignal,
  createMemo,
  Show,
  For,
  onMount,
  onCleanup,
} from "solid-js";
import type { BookmarkRecord, SearchResult } from "../../src/types";
import { incrementFreq } from "../../src/freq";
import { getSettings } from "../../src/db";
import { useI18n, setReactiveLocale } from "../../src/i18n";

type SourceFilter = "all" | "bookmark" | "github" | "twitter";
type SortOrder = "newest" | "oldest";

/** 记录排序时间：优先推文发布时间，其次索引时间 */
function recordTime(r: BookmarkRecord): number {
  const posted = r.postedAt ? Date.parse(r.postedAt) : NaN;
  if (!Number.isNaN(posted)) return posted;
  const bookmarked = r.bookmarkedAt ? Date.parse(r.bookmarkedAt) : NaN;
  if (!Number.isNaN(bookmarked)) return bookmarked;
  return r.indexedAt ?? 0;
}

/** 大数字紧凑格式化：1200 → 1.2k */
function formatCount(n?: number): string {
  if (!n) return "0";
  if (n >= 1000) return `${(n / 1000).toFixed(1).replace(/\.0$/, "")}k`;
  return String(n);
}

function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function faviconUrl(url: string): string {
  return `https://www.google.com/s2/favicons?domain=${domainOf(url)}&sz=64`;
}

function formatDate(ts: number): string {
  if (!ts) return "";
  return new Date(ts).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

const SOURCE_ICON: Record<SourceFilter, string> = {
  all: "∞",
  bookmark: "🔖",
  github: "🐙",
  twitter: "𝕏",
};

/** SearchResult → 兜底 BookmarkRecord（本地无索引记录时渲染基础卡片） */
function resultToRecord(res: SearchResult): BookmarkRecord {
  return {
    id: res.url,
    url: res.url,
    title: res.title,
    summary: res.summary,
    quickSummary: res.quickSummary,
    tags: res.tags,
    keyPoints: res.keyPoints,
    readingTime: res.readingTime,
    technologies: res.technologies,
    source: res.source,
    status: "indexed",
  };
}

function App() {
  const { t } = useI18n();
  const initialQuery = new URLSearchParams(location.search).get("q") ?? "";

  const [records, setRecords] = createSignal<BookmarkRecord[]>([]);
  const [loading, setLoading] = createSignal(true);
  const [source, setSource] = createSignal<SourceFilter>("all");
  const [activeTag, setActiveTag] = createSignal<string | null>(null);
  const [query, setQuery] = createSignal(initialQuery);
  const [sortOrder, setSortOrder] = createSignal<SortOrder>("newest");

  // AI 搜索状态（null = 浏览模式）
  const [searchResults, setSearchResults] = createSignal<SearchResult[] | null>(null);
  const [searchLoading, setSearchLoading] = createSignal(false);
  const [searchError, setSearchError] = createSignal("");

  // RAG 问答状态
  const [askLoading, setAskLoading] = createSignal(false);
  const [askAnswer, setAskAnswer] = createSignal("");
  const [askCitations, setAskCitations] = createSignal<
    { title: string; url: string; excerpt: string }[]
  >([]);
  const [askError, setAskError] = createSignal("");

  let searchRef: HTMLInputElement | undefined;
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let searchId = 0;

  async function loadRecords() {
    setLoading(true);
    try {
      const resp = await browser.runtime.sendMessage({ type: "GET_ALL_INDEXED" });
      if (resp?.success) {
        setRecords(resp.records ?? []);
      }
    } catch (e) {
      console.error("[Board] Failed to load records:", e);
    } finally {
      setLoading(false);
    }
  }

  /** AI 混合搜索（background: 关键词 + 向量，支持 /github /twitter /history /folder: 语法） */
  async function doSearch(q: string) {
    const trimmed = q.trim();
    if (!trimmed) {
      setSearchResults(null);
      setSearchLoading(false);
      setSearchError("");
      return;
    }
    setSearchLoading(true);
    setSearchError("");
    const currentId = ++searchId;
    try {
      const resp = await browser.runtime.sendMessage({
        type: "FULL_SEARCH",
        query: trimmed,
      });
      if (currentId !== searchId) return; // 丢弃过期响应
      if (resp?.success) {
        setSearchResults(resp.results ?? []);
      } else {
        setSearchError(resp?.error ?? t("board.searchFailed"));
        setSearchResults([]);
      }
    } catch (e) {
      if (currentId !== searchId) return;
      setSearchError(e instanceof Error ? e.message : String(e));
      setSearchResults([]);
    } finally {
      if (currentId === searchId) setSearchLoading(false);
    }
  }

  function handleInput(value: string) {
    setQuery(value);
    // 同步 URL 参数，支持刷新/分享
    const url = new URL(location.href);
    if (value.trim()) url.searchParams.set("q", value);
    else url.searchParams.delete("q");
    history.replaceState(null, "", url.toString());

    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => doSearch(value), 300);
  }

  function clearSearch() {
    setQuery("");
    setSearchResults(null);
    setSearchError("");
    const url = new URL(location.href);
    url.searchParams.delete("q");
    history.replaceState(null, "", url.toString());
    if (debounceTimer) clearTimeout(debounceTimer);
    searchRef?.focus();
  }

  /** RAG 问答：基于当前搜索框内容提问 */
  async function handleAsk() {
    const q = query().trim();
    if (!q || askLoading()) return;
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
        setAskError(resp?.error || t("board.askFailed"));
      }
    } catch (e) {
      setAskError(e instanceof Error ? e.message : t("board.askFailed"));
    } finally {
      setAskLoading(false);
    }
  }

  function closeAsk() {
    setAskAnswer("");
    setAskCitations([]);
    setAskError("");
  }

  /** 各来源计数 */
  const sourceCounts = createMemo<Record<SourceFilter, number>>(() => {
    const counts: Record<SourceFilter, number> = {
      all: 0,
      bookmark: 0,
      github: 0,
      twitter: 0,
    };
    for (const r of records()) {
      counts.all += 1;
      const s = r.source ?? "bookmark";
      if (s === "github") counts.github += 1;
      else if (s === "twitter") counts.twitter += 1;
      else if (s === "bookmark") counts.bookmark += 1;
    }
    return counts;
  });

  /** 浏览模式：当前来源下的记录 */
  const sourceFiltered = createMemo<BookmarkRecord[]>(() => {
    const s = source();
    const all = records();
    if (s === "all") return all;
    if (s === "bookmark") {
      return all.filter((r) => (r.source ?? "bookmark") === "bookmark");
    }
    return all.filter((r) => r.source === s);
  });

  /** 当前来源下的热门标签（Top 24） */
  const topTags = createMemo<{ tag: string; count: number }[]>(() => {
    const freq = new Map<string, number>();
    for (const r of sourceFiltered()) {
      for (const tag of r.tags ?? []) {
        freq.set(tag, (freq.get(tag) ?? 0) + 1);
      }
    }
    return [...freq.entries()]
      .map(([tag, count]) => ({ tag, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 24);
  });

  /** URL → 本地记录（用于把 AI 搜索结果富化成完整卡片） */
  const recordByUrl = createMemo<Map<string, BookmarkRecord>>(
    () => new Map(records().map((r) => [r.url, r])),
  );

  const isSearching = createMemo(() => searchResults() !== null);

  /** 最终展示列表：搜索模式保持相关性排序，浏览模式按时间排序 */
  const visibleRecords = createMemo<BookmarkRecord[]>(() => {
    const sr = searchResults();
    let list: BookmarkRecord[];
    if (sr !== null) {
      const byUrl = recordByUrl();
      list = sr.map((res) => byUrl.get(res.url) ?? resultToRecord(res));
    } else {
      list = sourceFiltered();
    }

    // 来源过滤（搜索模式下可进一步收窄）
    const s = source();
    if (s !== "all") {
      if (s === "bookmark") {
        list = list.filter((r) => (r.source ?? "bookmark") === "bookmark");
      } else {
        list = list.filter((r) => r.source === s);
      }
    }

    // 标签过滤
    const tag = activeTag();
    if (tag) {
      list = list.filter((r) => r.tags?.includes(tag));
    }

    if (sr === null) {
      const dir = sortOrder() === "newest" ? -1 : 1;
      return [...list].sort((a, b) => dir * (recordTime(a) - recordTime(b)));
    }
    return list;
  });

  const sourceOptions = createMemo<{ value: SourceFilter; label: string }[]>(() => [
    { value: "all", label: t("board.everything") },
    { value: "bookmark", label: t("board.bookmarks") },
    { value: "github", label: t("board.githubRepos") },
    { value: "twitter", label: t("board.twitter") },
  ]);

  const currentTitle = createMemo(() => {
    if (isSearching()) return `🔍 ${query().trim()}`;
    const opt = sourceOptions().find((o) => o.value === source());
    return activeTag() ? `#${activeTag()}` : (opt?.label ?? "");
  });

  function selectSource(s: SourceFilter) {
    setSource(s);
    setActiveTag(null);
  }

  function toggleTag(tag: string) {
    setActiveTag((prev) => (prev === tag ? null : tag));
  }

  function openRecord(r: BookmarkRecord) {
    incrementFreq(r.url);
    browser.tabs.create({ url: r.url });
  }

  function handleKeydown(e: KeyboardEvent) {
    const active = document.activeElement;
    const isTyping =
      active instanceof HTMLInputElement ||
      active instanceof HTMLTextAreaElement ||
      (active instanceof HTMLElement && active.isContentEditable);
    if (e.key === "/" && !isTyping) {
      e.preventDefault();
      searchRef?.focus();
      searchRef?.select();
    } else if (e.key === "Escape" && active === searchRef) {
      clearSearch();
      searchRef?.blur();
    }
  }

  onMount(async () => {
    const settings = await getSettings();
    if (settings.language) {
      setReactiveLocale(settings.language as "zh-CN");
    }
    document.addEventListener("keydown", handleKeydown);
    await loadRecords();
    if (initialQuery) doSearch(initialQuery);
    else searchRef?.focus();
  });

  onCleanup(() => {
    document.removeEventListener("keydown", handleKeydown);
    if (debounceTimer) clearTimeout(debounceTimer);
  });

  return (
    <div class="min-h-screen bg-background text-foreground flex">
      {/* 左侧边栏 */}
      <aside class="hidden md:flex w-60 shrink-0 flex-col border-r border-border bg-muted/30 sticky top-0 h-screen overflow-y-auto">
        <div class="px-5 pt-5 pb-3">
          <h1 class="text-lg font-bold tracking-tight">🧱 {t("board.title")}</h1>
        </div>

        {/* 来源过滤 */}
        <nav class="px-3 space-y-0.5">
          <For each={sourceOptions()}>
            {(opt) => (
              <button
                type="button"
                class={`w-full flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors ${
                  source() === opt.value
                    ? "bg-primary/10 text-primary font-medium"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                }`}
                onClick={() => selectSource(opt.value)}
              >
                <span class="w-5 text-center select-none">{SOURCE_ICON[opt.value]}</span>
                <span class="flex-1 text-left">{opt.label}</span>
                <span class="text-xs tabular-nums opacity-70">
                  {sourceCounts()[opt.value]}
                </span>
              </button>
            )}
          </For>
        </nav>

        {/* 热门标签 */}
        <div class="mt-5 px-5 pb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/70">
          {t("board.tags")}
        </div>
        <div class="px-3 pb-4 flex-1">
          <Show
            when={topTags().length > 0}
            fallback={
              <p class="px-3 py-2 text-xs text-muted-foreground/60">{t("board.noTags")}</p>
            }
          >
            <For each={topTags()}>
              {(item) => (
                <button
                  type="button"
                  class={`w-full flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm truncate transition-colors ${
                    activeTag() === item.tag
                      ? "bg-primary/10 text-primary font-medium"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground"
                  }`}
                  title={item.tag}
                  onClick={() => toggleTag(item.tag)}
                >
                  <span class="opacity-60">#</span>
                  <span class="flex-1 text-left truncate">{item.tag}</span>
                  <span class="text-xs tabular-nums opacity-60">{item.count}</span>
                </button>
              )}
            </For>
          </Show>
        </div>

        {/* 底部导航 */}
        <div class="border-t border-border px-3 py-3 space-y-0.5">
          <button
            type="button"
            class="w-full flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
            onClick={() => browser.tabs.create({ url: (browser.runtime.getURL as any)("/graph.html") })}
          >
            <span class="w-5 text-center">🗺</span>
            {t("board.openGraph")}
          </button>
          <button
            type="button"
            class="w-full flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
            onClick={() => browser.tabs.create({ url: (browser.runtime.getURL as any)("/options.html") })}
          >
            <span class="w-5 text-center">⚙️</span>
            {t("board.openSettings")}
          </button>
        </div>
      </aside>

      {/* 主内容区 */}
      <main class="flex-1 min-w-0">
        {/* 顶栏 */}
        <header class="sticky top-0 z-10 bg-background/90 backdrop-blur border-b border-border px-5 py-3">
          <div class="flex items-center gap-3">
            <h2 class="text-lg font-semibold truncate hidden lg:block">{currentTitle()}</h2>
            <div class="flex-1 flex items-center gap-2 min-w-0">
              <input
                ref={searchRef}
                type="search"
                class="flex-1 min-w-0 bg-muted rounded-lg px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-primary placeholder:text-muted-foreground"
                placeholder={t("board.searchPlaceholder")}
                value={query()}
                onInput={(e) => handleInput(e.currentTarget.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.isComposing) handleAsk();
                }}
                autocomplete="off"
                spellcheck={false}
              />
              <Show when={query().trim().length > 0}>
                <button
                  type="button"
                  class="shrink-0 text-xs px-2.5 py-1.5 rounded-lg border border-border hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
                  title={t("common.close")}
                  onClick={clearSearch}
                >
                  ✕
                </button>
              </Show>
              <button
                type="button"
                class="shrink-0 text-xs px-3 py-2 rounded-lg bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-50 transition-opacity"
                title={t("board.askHint")}
                disabled={askLoading() || !query().trim()}
                onClick={handleAsk}
              >
                {askLoading() ? t("board.asking") : t("board.askButton")}
              </button>
              <Show when={searchLoading()}>
                <span class="text-muted-foreground text-lg animate-spin select-none">◌</span>
              </Show>
            </div>
            <span class="text-xs text-muted-foreground tabular-nums shrink-0 hidden sm:inline">
              {isSearching()
                ? t("board.resultsCount", { count: visibleRecords().length })
                : t("board.itemCount", { count: visibleRecords().length })}
            </span>
            <button
              type="button"
              class="shrink-0 text-xs px-2.5 py-1.5 rounded-lg border border-border hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
              title={t("board.sortToggle")}
              onClick={() =>
                setSortOrder((o) => (o === "newest" ? "oldest" : "newest"))
              }
            >
              {sortOrder() === "newest"
                ? `↓ ${t("board.newest")}`
                : `↑ ${t("board.oldest")}`}
            </button>
          </div>
          <p class="text-xs text-muted-foreground mt-1.5">
            {t("search.syntaxHint")}：
            <code class="bg-muted px-1 rounded">{t("search.githubFilter")}</code>{" "}
            <code class="bg-muted px-1 rounded">{t("search.twitterFilter")}</code>{" "}
            <code class="bg-muted px-1 rounded">{t("search.folderFilter")}</code>{" "}
            · {t("board.askHint")}
          </p>
          {/* 移动端来源 pills */}
          <div class="md:hidden flex gap-2 mt-2 overflow-x-auto">
            <For each={sourceOptions()}>
              {(opt) => (
                <button
                  type="button"
                  class={`shrink-0 rounded-full border px-3 py-1 text-xs transition-colors ${
                    source() === opt.value
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border text-muted-foreground hover:bg-muted"
                  }`}
                  onClick={() => selectSource(opt.value)}
                >
                  {SOURCE_ICON[opt.value]} {opt.label} · {sourceCounts()[opt.value]}
                </button>
              )}
            </For>
          </div>
          <Show when={activeTag()}>
            <div class="mt-2">
              <button
                type="button"
                class="inline-flex items-center gap-1 rounded-full bg-primary/10 text-primary px-3 py-1 text-xs"
                onClick={() => setActiveTag(null)}
              >
                #{activeTag()} ✕
              </button>
            </div>
          </Show>
        </header>

        {/* RAG 问答结果 */}
        <Show when={askAnswer() || askError() || askLoading()}>
          <div class="px-5 pt-4">
            <div class="rounded-xl border border-border bg-accent/30 p-4 relative">
              <button
                type="button"
                class="absolute top-2 right-2 text-muted-foreground hover:text-foreground text-xs px-1"
                title={t("common.close")}
                onClick={closeAsk}
              >
                ✕
              </button>
              <Show when={askLoading()}>
                <p class="text-sm text-muted-foreground">💬 {t("board.asking")}</p>
              </Show>
              <Show when={askError()}>
                <p class="text-sm text-destructive">{askError()}</p>
              </Show>
              <Show when={askAnswer()}>
                <div class="text-sm leading-relaxed whitespace-pre-wrap pr-6">
                  {askAnswer()}
                </div>
                <Show when={askCitations().length > 0}>
                  <div class="mt-3 pt-3 border-t border-border">
                    <div class="text-xs font-semibold text-muted-foreground mb-2">
                      {t("board.answerSources")}
                    </div>
                    <For each={askCitations()}>
                      {(cite, i) => (
                        <div class="text-xs mb-1">
                          <a
                            href={cite.url}
                            target="_blank"
                            rel="noreferrer"
                            class="text-primary hover:underline"
                          >
                            [{i() + 1}] {cite.title}
                          </a>
                        </div>
                      )}
                    </For>
                  </div>
                </Show>
              </Show>
            </div>
          </div>
        </Show>

        {/* 卡片墙 */}
        <div class="p-5">
          <Show when={searchError()}>
            <div class="rounded-lg border border-destructive/50 bg-destructive/10 text-destructive px-4 py-3 mb-4 text-sm">
              {searchError()}
            </div>
          </Show>
          <Show
            when={!loading()}
            fallback={
              <div class="py-24 text-center text-muted-foreground">
                <span class="inline-block animate-spin text-2xl">◌</span>
                <p class="mt-2 text-sm">{t("board.loading")}</p>
              </div>
            }
          >
            <Show
              when={visibleRecords().length > 0 || searchLoading()}
              fallback={
                <div class="py-24 text-center text-muted-foreground">
                  <p class="text-3xl">{isSearching() ? "🔎" : "🗃"}</p>
                  <p class="mt-2 text-sm">
                    {isSearching() ? t("board.noResults") : t("board.empty")}
                  </p>
                </div>
              }
            >
              <div class="columns-1 sm:columns-2 lg:columns-3 2xl:columns-4 gap-4 [&>*]:mb-4">
                <For each={visibleRecords()}>
                  {(r) => <BoardCard record={r} onOpen={() => openRecord(r)} />}
                </For>
              </div>
            </Show>
          </Show>
        </div>
      </main>
    </div>
  );
}

/** 统一卡片入口：按来源分发渲染 */
function BoardCard(props: { record: BookmarkRecord; onOpen: () => void }) {
  const source = () => props.record.source ?? "bookmark";
  return (
    <article
      class="break-inside-avoid rounded-xl border border-border bg-card text-card-foreground p-4 cursor-pointer transition-all hover:shadow-md hover:border-primary/40"
      onClick={props.onOpen}
    >
      <Show
        when={source() === "twitter"}
        fallback={
          <Show when={source() === "github"} fallback={<BookmarkBody record={props.record} />}>
            <GithubBody record={props.record} />
          </Show>
        }
      >
        <TwitterBody record={props.record} />
      </Show>
      <TagRow tags={props.record.tags} />
    </article>
  );
}

/** 普通书签 / 历史卡片 */
function BookmarkBody(props: { record: BookmarkRecord }) {
  const { t } = useI18n();
  const r = props.record;
  return (
    <>
      <header class="flex items-start gap-2.5">
        <img
          src={faviconUrl(r.url)}
          alt=""
          class="w-5 h-5 mt-0.5 rounded shrink-0"
          loading="lazy"
          onError={(e) => (e.currentTarget.style.display = "none")}
        />
        <h3 class="font-semibold leading-snug line-clamp-2 flex-1">{r.title || r.url}</h3>
      </header>
      <Show when={r.quickSummary}>
        <p class="mt-2 text-sm font-medium leading-relaxed line-clamp-2">{r.quickSummary}</p>
      </Show>
      <Show when={r.summary}>
        <p class="mt-1.5 text-sm text-muted-foreground leading-relaxed line-clamp-4">{r.summary}</p>
      </Show>
      <footer class="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
        <span class="truncate">{domainOf(r.url)}</span>
        <Show when={r.readingTime}>
          <span class="shrink-0">· {t("board.readingTime", { minutes: r.readingTime ?? 0 })}</span>
        </Show>
        <span class="flex-1" />
        <span class="shrink-0">{formatDate(recordTime(r))}</span>
      </footer>
    </>
  );
}

/** GitHub 仓库卡片 */
function GithubBody(props: { record: BookmarkRecord }) {
  const { t } = useI18n();
  const r = props.record;
  return (
    <>
      <header class="flex items-start gap-2.5">
        <span class="text-lg leading-none mt-0.5 select-none">🐙</span>
        <h3 class="font-semibold leading-snug line-clamp-2 flex-1 font-mono text-[15px]">
          {r.title || r.url}
        </h3>
      </header>
      <Show when={r.quickSummary}>
        <p class="mt-2 text-sm font-medium leading-relaxed line-clamp-2">{r.quickSummary}</p>
      </Show>
      <Show when={r.summary}>
        <p class="mt-1.5 text-sm text-muted-foreground leading-relaxed line-clamp-5">{r.summary}</p>
      </Show>
      <Show when={(r.technologies ?? []).length > 0}>
        <div class="mt-2.5 flex flex-wrap gap-1.5">
          <For each={(r.technologies ?? []).slice(0, 6)}>
            {(tech) => (
              <span class="rounded-md bg-primary/10 text-primary px-2 py-0.5 text-[11px] font-medium">
                {tech}
              </span>
            )}
          </For>
        </div>
      </Show>
      <footer class="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
        <span>github.com</span>
        <Show when={r.readingTime}>
          <span class="shrink-0">· {t("board.readingTime", { minutes: r.readingTime ?? 0 })}</span>
        </Show>
        <span class="flex-1" />
        <span class="shrink-0">{formatDate(recordTime(r))}</span>
      </footer>
    </>
  );
}

/** Twitter/X 书签卡片 */
function TwitterBody(props: { record: BookmarkRecord }) {
  const r = props.record;
  const eng = () => r.engagement ?? {};
  return (
    <>
      <header class="flex items-center gap-2.5">
        <Show
          when={r.authorProfileImageUrl}
          fallback={
            <span class="w-8 h-8 rounded-full bg-muted flex items-center justify-center text-sm select-none shrink-0">
              𝕏
            </span>
          }
        >
          <img
            src={r.authorProfileImageUrl}
            alt={r.authorName ?? ""}
            class="w-8 h-8 rounded-full shrink-0"
            loading="lazy"
            onError={(e) => (e.currentTarget.style.display = "none")}
          />
        </Show>
        <div class="min-w-0 flex-1">
          <p class="text-sm font-semibold truncate">{r.authorName || r.authorHandle || r.title}</p>
          <Show when={r.authorHandle}>
            <p class="text-xs text-muted-foreground truncate">@{r.authorHandle}</p>
          </Show>
        </div>
        <span class="text-xs text-muted-foreground shrink-0">{formatDate(recordTime(r))}</span>
      </header>
      <Show when={r.quickSummary || r.summary}>
        <p class="mt-2.5 text-sm leading-relaxed whitespace-pre-line line-clamp-6">
          {r.quickSummary || r.summary}
        </p>
      </Show>
      <Show when={r.quotedTweetText}>
        <blockquote class="mt-2 border-l-2 border-border pl-3 text-xs text-muted-foreground line-clamp-3">
          {r.quotedTweetText}
        </blockquote>
      </Show>
      <Show when={(r.media ?? []).length > 0}>
        <img
          src={r.media![0]}
          alt=""
          class="mt-3 w-full rounded-lg border border-border object-cover max-h-72"
          loading="lazy"
          onError={(e) => (e.currentTarget.style.display = "none")}
        />
      </Show>
      <footer class="mt-3 flex items-center gap-4 text-xs text-muted-foreground">
        <span title="replies">💬 {formatCount(eng().replyCount)}</span>
        <span title="reposts">🔁 {formatCount(eng().repostCount)}</span>
        <span title="likes">❤️ {formatCount(eng().likeCount)}</span>
        <Show when={eng().viewCount}>
          <span title="views">👁 {formatCount(eng().viewCount)}</span>
        </Show>
      </footer>
    </>
  );
}

/** 标签行 */
function TagRow(props: { tags?: string[] }) {
  return (
    <Show when={(props.tags ?? []).length > 0}>
      <div class="mt-3 flex flex-wrap gap-1.5">
        <For each={(props.tags ?? []).slice(0, 5)}>
          {(tag) => (
            <span class="rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground">
              #{tag}
            </span>
          )}
        </For>
      </div>
    </Show>
  );
}

export default App;
