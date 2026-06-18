import { createSignal, For, Show, onMount, onCleanup } from "solid-js";
import { Button } from "../../src/components/ui/button";
import { Input } from "../../src/components/ui/input";
import { Card, CardContent } from "../../src/components/ui/card";
import { Badge } from "../../src/components/ui/badge";
import { CodeMap } from "./components/CodeMap";
import { SymbolPanel } from "./components/SymbolPanel";
import { WikiTree } from "./components/WikiTree";
import { CodeQA } from "./components/CodeQA";
import { cn } from "../../src/lib/utils";
import { t, type I18nKey } from "../../src/i18n";
import type { CodeSymbol, CodeEdge, WikiRepoMeta } from "../../src/types";

type Tab = "map" | "search" | "docs" | "qa";

const TABS: { id: Tab; labelKey: I18nKey }[] = [
  { id: "map", labelKey: "codeWiki.tab.map" },
  { id: "search", labelKey: "codeWiki.tab.search" },
  { id: "docs", labelKey: "codeWiki.tab.docs" },
  { id: "qa", labelKey: "codeWiki.tab.qa" },
];

/** 简单判断输入是否为 GitHub URL（用于切换 fetchFromGitHub） */
function looksLikeGitHub(input: string): boolean {
  const t = input.trim().toLowerCase();
  return (
    t.startsWith("https://github.com/") ||
    t.startsWith("http://github.com/") ||
    t.startsWith("git@github.com:") ||
    /^[\w.-]+\/[\w.-]+$/.test(t)
  );
}

function App() {
  const [activeTab, setActiveTab] = createSignal<Tab>("map");
  const [repos, setRepos] = createSignal<WikiRepoMeta[]>([]);
  const [selectedRepo, setSelectedRepo] = createSignal<string>("");
  const [buildUrl, setBuildUrl] = createSignal("");
  const [buildStatus, setBuildStatus] = createSignal("");
  const [buildOk, setBuildOk] = createSignal<boolean | null>(null);
  const [buildProgress, setBuildProgress] = createSignal<{
    current?: number;
    total?: number;
  } | null>(null);
  const [symbols, setSymbols] = createSignal<CodeSymbol[]>([]);
  const [edges, setEdges] = createSignal<CodeEdge[]>([]);

  onMount(async () => {
    try {
      const res = await browser.runtime.sendMessage({ type: "WIKI_LIST_REPOS" });
      if (res?.success && res.repos) {
        setRepos(res.repos as WikiRepoMeta[]);
        if (res.repos.length > 0) {
          setSelectedRepo((res.repos[0] as WikiRepoMeta).repoUrl);
          loadGraph((res.repos[0] as WikiRepoMeta).repoUrl);
        }
      }
    } catch (e) {
      console.error("[wiki] initial load error:", e);
    }

    // 监听 background 进度事件
    const listener = (msg: { type?: string; phase?: string; message?: string; current?: number; total?: number }) => {
      if (msg?.type !== "WIKI_PROGRESS") return;
      setBuildStatus(msg.message || "");
      if (msg.current !== undefined || msg.total !== undefined) {
        setBuildProgress({ current: msg.current, total: msg.total });
      }
    };
    browser.runtime.onMessage.addListener(listener);
    onCleanup(() => browser.runtime.onMessage.removeListener(listener));
  });

  async function loadGraph(repoUrl: string) {
    try {
      const res = await browser.runtime.sendMessage({
        type: "GET_CODE_GRAPH",
        repoUrl,
      });
      if (res?.success) {
        setSymbols(res.symbols ?? []);
        setEdges(res.edges ?? []);
      }
    } catch (e) {
      console.error("[wiki] loadGraph error:", e);
    }
  }

  function selectRepo(url: string) {
    setSelectedRepo(url);
    loadGraph(url);
  }

  async function buildGraph() {
    const url = buildUrl().trim();
    if (!url) return;
    setBuildStatus(t("codeWiki.status.building"));
    setBuildOk(null);
    setBuildProgress(null);
    const isGh = looksLikeGitHub(url);
    try {
      const res = await browser.runtime.sendMessage({
        type: "BUILD_CODE_GRAPH",
        repoUrl: url,
        branch: "main",
        files: [],
        fetchFromGitHub: isGh,
      });
      if (res?.success) {
        setBuildOk(true);
        setBuildProgress(null);
        setBuildStatus(
          t("codeWiki.status.built", {
            symbols: res.symbolCount ?? 0,
            edges: res.edgeCount ?? 0,
            embeddings: res.embeddingCount ?? 0,
            docs: res.wikiDocCount ?? 0,
          }),
        );
        setSelectedRepo(url);
        loadGraph(url);
        const list = await browser.runtime.sendMessage({ type: "WIKI_LIST_REPOS" });
        if (list?.success) setRepos(list.repos as WikiRepoMeta[]);
      } else {
        setBuildOk(false);
        setBuildProgress(null);
        setBuildStatus(t("codeWiki.status.failed", { error: res?.error || "unknown" }));
      }
    } catch (e) {
      setBuildOk(false);
      setBuildProgress(null);
      setBuildStatus(
        t("codeWiki.status.error", {
          error: e instanceof Error ? e.message : String(e),
        }),
      );
    }
  }

  async function syncWiki() {
    if (!selectedRepo()) return;
    setBuildStatus(t("codeWiki.status.syncing"));
    setBuildOk(null);
    try {
      const res = await browser.runtime.sendMessage({
        type: "SYNC_WIKI",
        repoUrl: selectedRepo(),
        branch: "main",
        files: [],
      });
      if (res?.success) {
        setBuildOk(true);
        setBuildStatus(
          t("codeWiki.status.synced", {
            symbols: res.symbolCount ?? 0,
            edges: res.edgeCount ?? 0,
          }),
        );
        loadGraph(selectedRepo());
      } else {
        setBuildOk(false);
        setBuildStatus(t("codeWiki.status.failed", { error: res?.error || "unknown" }));
      }
    } catch (e) {
      setBuildOk(false);
      setBuildStatus(
        t("codeWiki.status.error", {
          error: e instanceof Error ? e.message : String(e),
        }),
      );
    }
  }

  return (
    <div class="flex h-screen flex-col bg-background text-foreground">
      <header class="border-b px-4 py-3 flex items-center gap-3 flex-none">
        <h1 class="text-lg font-semibold">{t("codeWiki.title")}</h1>
        <Show when={repos().length > 0}>
          <select
            class="text-sm border border-input rounded px-2 py-1 bg-background"
            value={selectedRepo()}
            onChange={(e) => selectRepo(e.currentTarget.value)}
          >
            <For each={repos()}>
              {(r) => (
                <option value={r.repoUrl}>
                  {r.repoUrl} ({r.branch})
                </option>
              )}
            </For>
          </select>
        </Show>
        <div class="flex-1" />
        <Input
          placeholder={t("codeWiki.placeholder.buildUrl")}
          value={buildUrl()}
          onInput={(e) => setBuildUrl(e.currentTarget.value)}
          class="w-80"
        />
        <Button onClick={buildGraph} size="sm">
          {t("codeWiki.action.build")}
        </Button>
        <Show when={selectedRepo()}>
          <Button onClick={syncWiki} variant="outline" size="sm">
            {t("codeWiki.action.sync")}
          </Button>
        </Show>
      </header>
      <Show when={buildStatus()}>
        <div
          class={cn(
            "px-4 py-2 text-sm border-b flex items-center gap-3",
            buildOk() === true
              ? "text-green-600"
              : buildOk() === false
                ? "text-red-600"
                : "text-muted-foreground",
          )}
        >
          <span class="flex-1 truncate">{buildStatus()}</span>
          <Show when={buildProgress()?.total && buildProgress()!.total! > 0}>
            <div class="w-32 h-1.5 bg-muted rounded overflow-hidden">
              <div
                class="h-full bg-primary transition-all"
                style={{
                  width: `${Math.min(
                    100,
                    ((buildProgress()?.current ?? 0) / (buildProgress()?.total ?? 1)) * 100,
                  )}%`,
                }}
              />
            </div>
          </Show>
        </div>
      </Show>
      <nav class="border-b flex flex-none">
        <For each={TABS}>
          {(tab) => (
            <button
              class={cn(
                "px-4 py-2 text-sm font-medium border-b-2 border-transparent hover:bg-accent",
                activeTab() === tab.id && "border-primary text-primary",
              )}
              onClick={() => setActiveTab(tab.id)}
            >
              {t(tab.labelKey)}
            </button>
          )}
        </For>
      </nav>
      <main class="flex-1 min-h-0 p-4 overflow-hidden">
        <Show when={activeTab() === "map"}>
          <CodeMap
            symbols={symbols()}
            edges={edges()}
            onNodeClick={() => setActiveTab("search")}
          />
        </Show>
        <Show when={activeTab() === "search"}>
          <SymbolPanel repoUrl={selectedRepo()} onSymbolClick={() => {}} />
        </Show>
        <Show when={activeTab() === "docs"}>
          <WikiTree repoUrl={selectedRepo()} onDocSelect={() => {}} />
        </Show>
        <Show when={activeTab() === "qa"}>
          <CodeQA repoUrl={selectedRepo()} />
        </Show>
        <Show when={repos().length === 0}>
          <Card class="h-full flex items-center justify-center">
            <CardContent class="text-center text-muted-foreground">
              <p class="mb-2">{t("codeWiki.empty.title")}</p>
              <p class="text-sm">{t("codeWiki.empty.hint")}</p>
            </CardContent>
          </Card>
        </Show>
      </main>
    </div>
  );
}

export default App;
