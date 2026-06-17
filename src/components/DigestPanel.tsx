import { createSignal, Show, For, onMount } from "solid-js";
import type { DailyDigest } from "../db";
import { browser } from "wxt/browser";

interface Props {
  onClose: () => void;
}

export default function DigestPanel(props: Props) {
  const [digests, setDigests] = createSignal<DailyDigest[]>([]);
  const [loading, setLoading] = createSignal(true);
  const [selectedDate, setSelectedDate] = createSignal<string | null>(null);

  onMount(async () => {
    try {
      const resp = await browser.runtime.sendMessage({
        type: "GET_DAILY_DIGESTS",
        days: 7,
      });
      if (resp?.success) {
        setDigests(resp.digests);
        if (resp.digests.length > 0) {
          setSelectedDate(resp.digests[0].date);
        }
      }
    } catch (err) {
      console.error("[DigestPanel] Failed to load digests:", err);
    } finally {
      setLoading(false);
    }
  });

  const currentDigest = () => {
    const date = selectedDate();
    return digests().find((d) => d.date === date) || null;
  };

  const formatDate = (date: string) => {
    const d = new Date(date + "T00:00:00");
    return d.toLocaleDateString(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric",
    });
  };

  return (
    <aside class="w-96 shrink-0 border-l border-border pl-4 overflow-y-auto max-h-[calc(100vh-6rem)] sticky top-39.5 py-4 self-start">
      <div class="flex items-center justify-between mb-3">
        <h3 class="font-semibold text-sm">📚 Daily Knowledge Digest</h3>
        <button
          type="button"
          onClick={props.onClose}
          class="text-muted-foreground hover:text-foreground text-lg leading-none"
        >
          ×
        </button>
      </div>

      <Show when={loading}>
        <div class="space-y-3">
          <div class="h-4 bg-muted rounded animate-pulse w-3/4" />
          <div class="h-20 bg-muted rounded animate-pulse" />
          <div class="h-20 bg-muted rounded animate-pulse" />
        </div>
      </Show>

      <Show when={!loading && digests().length === 0}>
        <div class="text-sm text-muted-foreground text-center py-8">
          <p class="text-2xl mb-2">📭</p>
          <p>No digests yet</p>
          <p class="text-xs mt-1">
            Digests are generated daily based on your reading
          </p>
        </div>
      </Show>

      <Show when={!loading && digests().length > 0}>
        {/* Date selector */}
        <div class="flex gap-1 mb-4 overflow-x-auto pb-1">
          <For each={digests()}>
            {(digest) => (
              <button
                type="button"
                onClick={() => setSelectedDate(digest.date)}
                class={`px-2 py-1 text-xs rounded whitespace-nowrap ${
                  selectedDate() === digest.date
                    ? "bg-primary text-primary-foreground"
                    : "bg-secondary text-secondary-foreground hover:bg-secondary/80"
                }`}
              >
                {formatDate(digest.date)}
              </button>
            )}
          </For>
        </div>

        <Show when={currentDigest()}>
          {(digest) => (
            <>
              {/* Stats */}
              <div class="grid grid-cols-3 gap-2 mb-4">
                <div class="text-center p-2 bg-secondary rounded">
                  <div class="text-lg font-semibold">
                    {digest().stats.pagesIndexed}
                  </div>
                  <div class="text-xs text-muted-foreground">Pages</div>
                </div>
                <div class="text-center p-2 bg-secondary rounded">
                  <div class="text-lg font-semibold">
                    {digest().stats.readingTime}m
                  </div>
                  <div class="text-xs text-muted-foreground">Reading</div>
                </div>
                <div class="text-center p-2 bg-secondary rounded">
                  <div class="text-lg font-semibold">
                    {digest().stats.domains.length}
                  </div>
                  <div class="text-xs text-muted-foreground">Domains</div>
                </div>
              </div>

              {/* Headline Insight */}
              <div class="p-3 bg-blue-50 rounded mb-4">
                <p class="text-sm text-blue-800 font-medium">
                  💡 {digest().headlineInsight}
                </p>
              </div>

              {/* New Concepts */}
              <Show when={digest().newConcepts.length > 0}>
                <div class="mb-4">
                  <h4 class="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                    New Concepts
                  </h4>
                  <div class="space-y-2">
                    <For each={digest().newConcepts}>
                      {(concept) => (
                        <div class="p-2 bg-purple-50 rounded">
                          <div class="flex items-center gap-2">
                            <span class="text-sm font-medium text-purple-800">
                              {concept.name}
                            </span>
                            <span
                              class={`text-[10px] px-1.5 py-0.5 rounded ${
                                concept.importance === "high"
                                  ? "bg-red-100 text-red-700"
                                  : concept.importance === "medium"
                                    ? "bg-yellow-100 text-yellow-700"
                                    : "bg-gray-100 text-gray-700"
                              }`}
                            >
                              {concept.importance}
                            </span>
                          </div>
                          <p class="text-xs text-purple-600 mt-0.5">
                            {concept.definition}
                          </p>
                        </div>
                      )}
                    </For>
                  </div>
                </div>
              </Show>

              {/* Connections */}
              <Show when={digest().connections.length > 0}>
                <div class="mb-4">
                  <h4 class="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                    Connections
                  </h4>
                  <div class="space-y-2">
                    <For each={digest().connections}>
                      {(conn) => (
                        <div class="p-2 bg-green-50 rounded">
                          <p class="text-xs text-green-800">
                            {conn.description}
                          </p>
                          <div class="flex items-center gap-1 mt-1">
                            <span class="text-[10px] px-1 py-0.5 bg-green-100 text-green-700 rounded">
                              {conn.relation}
                            </span>
                            <span class="text-[10px] text-green-600 truncate">
                              {conn.sourceA} ↔ {conn.sourceB}
                            </span>
                          </div>
                        </div>
                      )}
                    </For>
                  </div>
                </div>
              </Show>

              {/* Bookmarks List */}
              <div>
                <h4 class="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                  Bookmarks ({digest().bookmarks.length})
                </h4>
                <div class="space-y-1.5">
                  <For each={digest().bookmarks}>
                    {(bm) => (
                      <a
                        href={bm.url}
                        target="_blank"
                        class="block p-2 hover:bg-secondary rounded transition-colors"
                      >
                        <div class="text-xs font-medium text-foreground truncate">
                          {bm.title}
                        </div>
                        <div class="text-[11px] text-muted-foreground mt-0.5 line-clamp-2">
                          {bm.quickSummary}
                        </div>
                      </a>
                    )}
                  </For>
                </div>
              </div>
            </>
          )}
        </Show>
      </Show>
    </aside>
  );
}
