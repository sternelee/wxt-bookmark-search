import { createSignal, Show, For, onMount } from "solid-js";
import type { DailyDigest } from "../db";
import { browser } from "wxt/browser";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Card, CardContent } from "./ui/card";
import { Separator } from "./ui/separator";
import { Skeleton } from "./ui/skeleton";

interface Props {
  onClose: () => void;
}

/** 概念重要度 → Badge 变体 */
const IMPORTANCE_VARIANT: Record<string, "error" | "warning" | "secondary"> = {
  high: "error",
  medium: "warning",
  low: "secondary",
};

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
    <aside class="sticky top-0 flex max-h-screen w-96 shrink-0 flex-col overflow-y-auto border-l border-border bg-muted/20 px-4 py-4">
      <div class="mb-3 flex items-center justify-between gap-2">
        <h3 class="text-sm font-semibold">📚 Daily Knowledge Digest</h3>
        <Button
          variant="ghost"
          size="icon"
          class="size-7 shrink-0"
          aria-label="Close"
          onClick={props.onClose}
        >
          ✕
        </Button>
      </div>

      <Show when={loading}>
        <div class="flex flex-col gap-3">
          <Skeleton class="h-4 w-3/4 rounded-md" />
          <Skeleton class="h-20 w-full rounded-xl" />
          <Skeleton class="h-20 w-full rounded-xl" />
        </div>
      </Show>

      <Show when={!loading && digests().length === 0}>
        <div class="flex flex-col items-center gap-2 py-10 text-center text-muted-foreground">
          <p class="select-none text-3xl">📭</p>
          <p class="text-sm">No digests yet</p>
          <p class="max-w-56 text-xs">Digests are generated daily based on your reading</p>
        </div>
      </Show>

      <Show when={!loading && digests().length > 0}>
        {/* 日期选择 */}
        <div class="mb-4 flex gap-1 overflow-x-auto pb-1">
          <For each={digests()}>
            {(digest) => (
              <Button
                variant={selectedDate() === digest.date ? "default" : "secondary"}
                size="sm"
                class="shrink-0 text-xs"
                onClick={() => setSelectedDate(digest.date)}
              >
                {formatDate(digest.date)}
              </Button>
            )}
          </For>
        </div>

        <Show when={currentDigest()}>
          {(digest) => (
            <div class="flex flex-col gap-4">
              {/* 统计 */}
              <div class="grid grid-cols-3 gap-2">
                <Card>
                  <CardContent class="p-2 text-center">
                    <div class="text-lg font-semibold tabular-nums">
                      {digest().stats.pagesIndexed}
                    </div>
                    <div class="text-[11px] text-muted-foreground">Pages</div>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent class="p-2 text-center">
                    <div class="text-lg font-semibold tabular-nums">
                      {digest().stats.readingTime}m
                    </div>
                    <div class="text-[11px] text-muted-foreground">Reading</div>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent class="p-2 text-center">
                    <div class="text-lg font-semibold tabular-nums">
                      {digest().stats.domains.length}
                    </div>
                    <div class="text-[11px] text-muted-foreground">Domains</div>
                  </CardContent>
                </Card>
              </div>

              {/* 头条洞察 */}
              <Card class="border-primary/30 bg-primary/5">
                <CardContent class="p-3">
                  <p class="text-sm font-medium leading-relaxed">💡 {digest().headlineInsight}</p>
                </CardContent>
              </Card>

              {/* 新概念 */}
              <Show when={digest().newConcepts.length > 0}>
                <section>
                  <h4 class="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    New Concepts
                  </h4>
                  <div class="flex flex-col gap-2">
                    <For each={digest().newConcepts}>
                      {(concept) => (
                        <Card class="bg-accent/40">
                          <CardContent class="p-2.5">
                            <div class="flex items-center gap-2">
                              <span class="min-w-0 flex-1 truncate text-sm font-medium">
                                {concept.name}
                              </span>
                              <Badge
                                variant={IMPORTANCE_VARIANT[concept.importance] ?? "secondary"}
                                class="shrink-0 px-1.5 py-0 text-[10px]"
                              >
                                {concept.importance}
                              </Badge>
                            </div>
                            <p class="mt-1 text-xs leading-relaxed text-muted-foreground">
                              {concept.definition}
                            </p>
                          </CardContent>
                        </Card>
                      )}
                    </For>
                  </div>
                </section>
              </Show>

              {/* 关联 */}
              <Show when={digest().connections.length > 0}>
                <section>
                  <h4 class="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Connections
                  </h4>
                  <div class="flex flex-col gap-2">
                    <For each={digest().connections}>
                      {(conn) => (
                        <Card class="bg-success/5">
                          <CardContent class="p-2.5">
                            <p class="text-xs leading-relaxed">{conn.description}</p>
                            <div class="mt-1.5 flex items-center gap-1.5">
                              <Badge variant="success" class="px-1.5 py-0 text-[10px]">
                                {conn.relation}
                              </Badge>
                              <span class="truncate text-[10px] text-muted-foreground">
                                {conn.sourceA} ↔ {conn.sourceB}
                              </span>
                            </div>
                          </CardContent>
                        </Card>
                      )}
                    </For>
                  </div>
                </section>
              </Show>

              <Separator />

              {/* 书签列表 */}
              <section>
                <h4 class="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Bookmarks ({digest().bookmarks.length})
                </h4>
                <div class="flex flex-col gap-1">
                  <For each={digest().bookmarks}>
                    {(bm) => (
                      <a
                        href={bm.url}
                        target="_blank"
                        rel="noreferrer"
                        class="block rounded-lg p-2 transition-colors hover:bg-accent"
                      >
                        <div class="truncate text-xs font-medium">{bm.title}</div>
                        <div class="mt-0.5 line-clamp-2 text-[11px] text-muted-foreground">
                          {bm.quickSummary}
                        </div>
                      </a>
                    )}
                  </For>
                </div>
              </section>
            </div>
          )}
        </Show>
      </Show>
    </aside>
  );
}
