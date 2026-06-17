import { createSignal, Show, For, onMount } from "solid-js";
import type { ResearchReport } from "../research";
import { browser } from "wxt/browser";

interface Props {
  onClose: () => void;
}

export default function ResearchPanel(props: Props) {
  const [query, setQuery] = createSignal("");
  const [loading, setLoading] = createSignal(false);
  const [report, setReport] = createSignal<ResearchReport | null>(null);
  const [history, setHistory] = createSignal<ResearchReport[]>([]);
  const [showHistory, setShowHistory] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  onMount(async () => {
    try {
      const resp = await browser.runtime.sendMessage({
        type: "GET_RESEARCH_HISTORY",
        limit: 5,
      });
      if (resp?.success) {
        setHistory(resp.history);
      }
    } catch {
      // ignore
    }
  });

  const handleResearch = async () => {
    const q = query().trim();
    if (!q || loading()) return;

    setLoading(true);
    setError(null);
    setReport(null);

    try {
      const resp = await browser.runtime.sendMessage({
        type: "RESEARCH",
        question: q,
      });

      if (resp?.success) {
        setReport(resp.report);
        setHistory((prev: ResearchReport[]) =>
          [resp.report, ...prev].slice(0, 5),
        );
      } else {
        setError(resp?.error || "Research failed");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleResearch();
    }
  };

  const formatDate = (ts: number) => {
    return new Date(ts).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  return (
    <aside class="w-[480px] shrink-0 border-l border-border pl-4 py-4 overflow-y-auto max-h-[calc(100vh-11rem)] sticky top-40 self-start">
      <div class="flex items-center justify-between mb-3">
        <h3 class="font-semibold text-sm">🔬 Research Agent</h3>
        <div class="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setShowHistory(!showHistory())}
            class="text-xs text-muted-foreground hover:text-foreground px-2 py-1 rounded bg-secondary"
          >
            {showHistory() ? "Back" : "History"}
          </button>
          <button
            type="button"
            onClick={props.onClose}
            class="text-muted-foreground hover:text-foreground text-lg leading-none"
          >
            ×
          </button>
        </div>
      </div>

      <Show when={!showHistory()}>
        {/* Research Input */}
        <div class="mb-4">
          <textarea
            value={query()}
            onInput={(e) => setQuery(e.currentTarget.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask a research question..."
            class="w-full p-3 text-sm border rounded-lg resize-none h-20 bg-background"
            disabled={loading()}
          />
          <button
            type="button"
            onClick={handleResearch}
            disabled={!query().trim() || loading()}
            class="mt-2 w-full px-4 py-2 text-sm font-medium text-white bg-purple-600 rounded-lg hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Show when={loading()} fallback="Start Research">
              <span class="flex items-center justify-center gap-2">
                <svg class="animate-spin h-4 w-4" viewBox="0 0 24 24">
                  <circle
                    class="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    stroke-width="4"
                    fill="none"
                  />
                  <path
                    class="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                  />
                </svg>
                Researching...
              </span>
            </Show>
          </button>
        </div>

        {/* Error */}
        <Show when={error()}>
          <div class="p-3 mb-4 text-sm text-red-700 bg-red-50 rounded-lg">
            {error()}
          </div>
        </Show>

        {/* Loading State */}
        <Show when={loading()}>
          <div class="space-y-3 mb-4">
            <div class="flex items-center gap-2 text-sm text-muted-foreground">
              <div class="animate-pulse h-2 w-2 bg-purple-500 rounded-full" />
              <span>Decomposing question...</span>
            </div>
            <div class="flex items-center gap-2 text-sm text-muted-foreground">
              <div
                class="animate-pulse h-2 w-2 bg-purple-500 rounded-full"
                style={{ "animation-delay": "0.5s" }}
              />
              <span>Searching knowledge base...</span>
            </div>
            <div class="flex items-center gap-2 text-sm text-muted-foreground">
              <div
                class="animate-pulse h-2 w-2 bg-purple-500 rounded-full"
                style={{ "animation-delay": "1s" }}
              />
              <span>Synthesizing findings...</span>
            </div>
          </div>
        </Show>

        {/* Report */}
        <Show when={report()}>
          {(r: () => ResearchReport) => (
            <div class="space-y-4">
              {/* Process Info */}
              <div class="p-3 bg-secondary rounded-lg">
                <div class="text-xs text-muted-foreground mb-2">
                  Research Process
                </div>
                <div class="grid grid-cols-2 gap-2 text-xs">
                  <div>
                    <span class="text-muted-foreground">Sources: </span>
                    <span class="font-medium">
                      {r().process.sourcesSearched}
                    </span>
                  </div>
                  <div>
                    <span class="text-muted-foreground">Internal: </span>
                    <span class="font-medium">
                      {r().process.internalSources}
                    </span>
                  </div>
                </div>
                <Show when={r().process.conceptsUsed.length > 0}>
                  <div class="mt-2 flex flex-wrap gap-1">
                    <For each={r().process.conceptsUsed.slice(0, 5)}>
                      {(concept: string) => (
                        <span class="text-[10px] px-1.5 py-0.5 bg-purple-100 text-purple-700 rounded">
                          {concept}
                        </span>
                      )}
                    </For>
                  </div>
                </Show>
              </div>

              {/* Key Insights */}
              <Show when={r().findings.keyInsights.length > 0}>
                <div>
                  <h4 class="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                    💡 Key Insights
                  </h4>
                  <ul class="space-y-1.5">
                    <For each={r().findings.keyInsights}>
                      {(insight: string) => (
                        <li class="text-xs text-foreground flex gap-2">
                          <span class="text-purple-500 shrink-0">•</span>
                          <span>{insight}</span>
                        </li>
                      )}
                    </For>
                  </ul>
                </div>
              </Show>

              {/* Consensus & Divergences */}
              <Show
                when={
                  r().findings.consensus.length > 0 ||
                  r().findings.divergences.length > 0
                }
              >
                <div class="grid grid-cols-2 gap-3">
                  <Show when={r().findings.consensus.length > 0}>
                    <div>
                      <h4 class="text-xs font-semibold text-green-600 mb-1.5">
                        ✓ Consensus
                      </h4>
                      <ul class="space-y-1">
                        <For each={r().findings.consensus}>
                          {(item: string) => (
                            <li class="text-[11px] text-foreground">{item}</li>
                          )}
                        </For>
                      </ul>
                    </div>
                  </Show>
                  <Show when={r().findings.divergences.length > 0}>
                    <div>
                      <h4 class="text-xs font-semibold text-orange-600 mb-1.5">
                        ⇄ Divergences
                      </h4>
                      <ul class="space-y-1">
                        <For each={r().findings.divergences}>
                          {(item: string) => (
                            <li class="text-[11px] text-foreground">{item}</li>
                          )}
                        </For>
                      </ul>
                    </div>
                  </Show>
                </div>
              </Show>

              {/* Citations */}
              <Show when={r().citations.length > 0}>
                <div>
                  <h4 class="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                    📚 Sources ({r().citations.length})
                  </h4>
                  <div class="space-y-1.5">
                    <For each={r().citations}>
                      {(cite: ResearchReport["citations"][0]) => (
                        <a
                          href={cite.url}
                          target="_blank"
                          class="block p-2 bg-secondary rounded hover:bg-secondary/80 transition-colors"
                        >
                          <div class="flex items-center gap-2">
                            <span class="text-[10px] px-1 py-0.5 bg-blue-100 text-blue-700 rounded">
                              [{cite.id}]
                            </span>
                            <span
                              class={`text-[10px] px-1 py-0.5 rounded ${
                                cite.relevance === "high"
                                  ? "bg-green-100 text-green-700"
                                  : cite.relevance === "medium"
                                    ? "bg-yellow-100 text-yellow-700"
                                    : "bg-gray-100 text-gray-700"
                              }`}
                            >
                              {cite.relevance}
                            </span>
                          </div>
                          <div class="text-xs font-medium text-foreground mt-1 truncate">
                            {cite.title}
                          </div>
                          <div class="text-[11px] text-muted-foreground mt-0.5 line-clamp-2">
                            {cite.excerpt}
                          </div>
                        </a>
                      )}
                    </For>
                  </div>
                </div>
              </Show>

              {/* Full Report */}
              <div>
                <h4 class="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                  📄 Full Report
                </h4>
                <div class="p-3 bg-secondary rounded-lg text-xs leading-relaxed whitespace-pre-wrap max-h-96 overflow-y-auto">
                  {r().report}
                </div>
              </div>
            </div>
          )}
        </Show>
      </Show>

      {/* History */}
      <Show when={showHistory()}>
        <div class="space-y-2">
          <Show when={history().length === 0}>
            <p class="text-sm text-muted-foreground text-center py-8">
              No research history yet
            </p>
          </Show>
          <For each={history()}>
            {(item: ResearchReport) => (
              <button
                type="button"
                onClick={() => {
                  setReport(item);
                  setShowHistory(false);
                }}
                class="w-full text-left p-3 bg-secondary rounded-lg hover:bg-secondary/80 transition-colors"
              >
                <div class="text-xs text-muted-foreground mb-1">
                  {formatDate(item.generatedAt)}
                </div>
                <div class="text-sm font-medium text-foreground line-clamp-2">
                  {item.question}
                </div>
                <div class="text-xs text-muted-foreground mt-1">
                  {item.process.sourcesSearched} sources ·{" "}
                  {item.citations.length} citations
                </div>
              </button>
            )}
          </For>
        </div>
      </Show>
    </aside>
  );
}
