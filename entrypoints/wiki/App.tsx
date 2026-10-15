import { createSignal, For, Show, onMount, onCleanup } from "solid-js";
import { Button } from "../../src/components/ui/button";
import { Card, CardContent } from "../../src/components/ui/card";
import { Badge } from "../../src/components/ui/badge";
import { Alert, AlertDescription } from "../../src/components/ui/alert";
import { Progress } from "../../src/components/ui/progress";
import { Skeleton } from "../../src/components/ui/skeleton";
import { Separator } from "../../src/components/ui/separator";
import { Toaster } from "../../src/components/ui/sonner";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "../../src/components/ui/tabs";
import { TextField, TextFieldInput } from "../../src/components/ui/text-field";
import { SelectField } from "../../src/components/form/SelectField";
import { CodeMap } from "./components/CodeMap";
import { SymbolPanel } from "./components/SymbolPanel";
import { WikiTree } from "./components/WikiTree";
import { CodeQA } from "./components/CodeQA";
import { cn } from "../../src/lib/utils";
import { useI18n, setReactiveLocale, type I18nKey } from "../../src/i18n";
import type { Locale } from "../../src/i18n";
import { getSettings } from "../../src/db";
import type { CodeSymbol, CodeEdge, WikiRepoMeta } from "../../src/types";

type Tab = "map" | "search" | "docs" | "qa";

const TABS: { id: Tab; labelKey: I18nKey; icon: string }[] = [
  { id: "map", labelKey: "codeWiki.tab.map", icon: "🗺" },
  { id: "search", labelKey: "codeWiki.tab.search", icon: "🔎" },
  { id: "docs", labelKey: "codeWiki.tab.docs", icon: "📄" },
  { id: "qa", labelKey: "codeWiki.tab.qa", icon: "💬" },
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

interface RepoOption {
  value: string;
  label: string;
}

function App() {
  const { t } = useI18n();
  const [ready, setReady] = createSignal(false);
  const [activeTab, setActiveTab] = createSignal<Tab>("map");
  const [repos, setRepos] = createSignal<WikiRepoMeta[]>([]);
  const [selectedRepo, setSelectedRepo] = createSignal<string>("");
  const [buildUrl, setBuildUrl] = createSignal("");
  const [buildStatus, setBuildStatus] = createSignal("");
  const [buildOk, setBuildOk] = createSignal<boolean | null>(null);
  const [building, setBuilding] = createSignal(false);
  const [syncing, setSyncing] = createSignal(false);
  const [buildProgress, setBuildProgress] = createSignal<{
    current?: number;
    total?: number;
  } | null>(null);
  const [symbols, setSymbols] = createSignal<CodeSymbol[]>([]);
  const [edges, setEdges] = createSignal<CodeEdge[]>([]);

  /** 构建进度百分比 */
  const progressPct = () => {
    const p = buildProgress();
    if (!p?.total) return 0;
    return Math.min(100, Math.round(((p.current ?? 0) / p.total) * 100));
  };

  const repoOptions = () =>
    repos().map((r) => ({
      value: r.repoUrl,
      label: `${r.repoUrl} (${r.branch})`,
    }));

  onMount(async () => {
    const settings = await getSettings();
    if (settings.language) setReactiveLocale(settings.language as Locale);

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
    } finally {
      setReady(true);
    }

    // 监听 background 进度事件
    const listener = (msg: {
      type?: string;
      phase?: string;
      message?: string;
      current?: number;
      total?: number;
    }) => {
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
    if (!url || building()) return;
    setBuilding(true);
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
    } finally {
      setBuilding(false);
    }
  }

  async function syncWiki() {
    if (!selectedRepo() || syncing()) return;
    setSyncing(true);
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
    } finally {
      setSyncing(false);
    }
  }

  return (
    <div class="flex h-screen flex-col bg-background text-foreground">
      {/* 顶栏 */}
      <header class="flex flex-none flex-col gap-3 border-b border-border px-4 py-3">
        <div class="flex items-center gap-3">
          <h1 class="shrink-0 text-lg font-bold tracking-tight">
            <span class="select-none">📖</span> {t("codeWiki.title")}
          </h1>

          <Show when={repos().length > 0}>
            <div class="w-72 shrink-0">
              <SelectField
                value={selectedRepo()}
                onChange={selectRepo}
                options={repoOptions()}
                placeholder={t("codeWiki.placeholder.buildUrl")}
                aria-label={t("codeWiki.title")}
              />
            </div>
            <Badge variant="secondary" class="shrink-0 tabular-nums">
              {symbols().length} <span class="opacity-60">·</span> {edges().length}
            </Badge>
          </Show>

          <span class="flex-1" />

          <TextField
            value={buildUrl()}
            onChange={setBuildUrl}
            class="w-80 shrink-0"
            aria-label={t("codeWiki.placeholder.buildUrl")}
          >
            <TextFieldInput
              type="text"
              placeholder={t("codeWiki.placeholder.buildUrl")}
              autocomplete="off"
              spellcheck={false}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.isComposing) buildGraph();
              }}
            />
          </TextField>

          <Button size="sm" class="shrink-0" disabled={building() || !buildUrl().trim()} onClick={buildGraph}>
            {building() ? t("codeWiki.status.building") : t("codeWiki.action.build")}
          </Button>

          <Show when={selectedRepo()}>
            <Button
              variant="outline"
              size="sm"
              class="shrink-0"
              disabled={syncing()}
              onClick={syncWiki}
            >
              {syncing() ? t("codeWiki.status.syncing") : t("codeWiki.action.sync")}
            </Button>
          </Show>
        </div>

        {/* 构建状态 */}
        <Show when={buildStatus()}>
          <div class="flex items-center gap-3">
            <Alert
              variant={buildOk() === true ? "success" : buildOk() === false ? "error" : "info"}
              class="min-w-0 flex-1 py-2"
            >
              <AlertDescription class="truncate">{buildStatus()}</AlertDescription>
            </Alert>
            <Show when={buildProgress()?.total}>
              <div class="flex shrink-0 items-center gap-2">
                <Progress value={progressPct()} class="w-32" />
                <span class="w-9 shrink-0 text-right text-[11px] font-medium tabular-nums text-muted-foreground">
                  {progressPct()}%
                </span>
              </div>
            </Show>
          </div>
        </Show>
      </header>

      {/* 主体 */}
      <Show
        when={ready()}
        fallback={
          <div class="flex flex-1 flex-col gap-3 p-4">
            <Skeleton class="h-9 w-64 rounded-lg" />
            <Skeleton class="h-full w-full rounded-xl" />
          </div>
        }
      >
        <Show
          when={repos().length > 0}
          fallback={
            <div class="flex flex-1 items-center justify-center p-4">
              <Card class="w-full max-w-md border-dashed">
                <CardContent class="flex flex-col items-center gap-3 py-10 text-center">
                  <p class="select-none text-4xl">🗂</p>
                  <p class="font-medium">{t("codeWiki.empty.title")}</p>
                  <p class="text-sm text-muted-foreground">{t("codeWiki.empty.hint")}</p>
                </CardContent>
              </Card>
            </div>
          }
        >
          <Tabs
            value={activeTab()}
            onChange={(value) => value && setActiveTab(value as Tab)}
            class="flex min-h-0 flex-1 flex-col"
          >
            <TabsList class="h-auto flex-none justify-start gap-1 rounded-none border-b border-border bg-transparent px-2 pt-1">
              <For each={TABS}>
                {(tab) => (
                  <TabsTrigger
                    value={tab.id}
                    class="gap-1.5 rounded-b-none border-b-2 border-transparent bg-transparent px-3 py-2 text-sm font-normal text-muted-foreground data-[selected]:border-primary data-[selected]:bg-transparent data-[selected]:font-medium data-[selected]:text-primary data-[selected]:shadow-none"
                  >
                    <span class="select-none">{tab.icon}</span>
                    {t(tab.labelKey)}
                  </TabsTrigger>
                )}
              </For>
            </TabsList>

            {/* 面板保持挂载（forceMount）以免切换 tab 丢失搜索/问答状态 */}
            <div class="relative min-h-0 flex-1 p-4">
              <TabsContent
                value="map"
                forceMount
                class={cn(
                  "h-full focus-visible:outline-none",
                  activeTab() === "map" ? "block" : "hidden",
                )}
              >
                <CodeMap
                  symbols={symbols()}
                  edges={edges()}
                  onNodeClick={() => setActiveTab("search")}
                />
              </TabsContent>
              <TabsContent
                value="search"
                forceMount
                class={cn(
                  "h-full focus-visible:outline-none",
                  activeTab() === "search" ? "block" : "hidden",
                )}
              >
                <SymbolPanel repoUrl={selectedRepo()} onSymbolClick={() => {}} />
              </TabsContent>
              <TabsContent
                value="docs"
                forceMount
                class={cn(
                  "h-full focus-visible:outline-none",
                  activeTab() === "docs" ? "block" : "hidden",
                )}
              >
                <WikiTree repoUrl={selectedRepo()} onDocSelect={() => {}} />
              </TabsContent>
              <TabsContent
                value="qa"
                forceMount
                class={cn(
                  "h-full focus-visible:outline-none",
                  activeTab() === "qa" ? "block" : "hidden",
                )}
              >
                <CodeQA repoUrl={selectedRepo()} />
              </TabsContent>
            </div>
          </Tabs>
        </Show>
      </Show>

      <Toaster position="bottom-right" />
    </div>
  );
}

export default App;
