import { For, Show } from "solid-js";
import { Card, CardContent } from "../../../src/components/ui/card";
import { Badge } from "../../../src/components/ui/badge";
import { useI18n } from "../../../src/i18n";
import { HtmlRenderer } from "../../../src/components/HtmlRenderer";

interface RecentListProps {
  items: Array<{
    url: string;
    title?: string;
    summary?: string;
    tags?: string[];
    source?: "github" | "twitter" | "bookmark" | "history";
  }>;
}

const SOURCE_BADGE: Record<string, { label: string; class: string }> = {
  github: { label: "GitHub", class: "border-slate-500/40 bg-slate-500/10 text-slate-600 dark:text-slate-300" },
  twitter: { label: "X", class: "border-sky-500/40 bg-sky-500/10 text-sky-600 dark:text-sky-300" },
  history: { label: "History", class: "border-violet-500/40 bg-violet-500/10 text-violet-600 dark:text-violet-300" },
};

export default function RecentList(props: RecentListProps) {
  const { t } = useI18n();

  return (
    <section class="flex flex-col gap-2">
      <h2 class="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        {t("popup.recentlyVisited")}
      </h2>

      <Show
        when={props.items.length > 0}
        fallback={
          <Card class="border-dashed">
            <CardContent class="p-3 text-center text-[11px] text-muted-foreground">
              {t("common.empty")}
            </CardContent>
          </Card>
        }
      >
        <div class="flex flex-col gap-2">
          <For each={props.items}>
            {(item) => {
              const source = () => (item.source ? SOURCE_BADGE[item.source] : undefined);
              return (
                <a href={item.url} target="_blank" rel="noreferrer" class="block">
                  <Card class="transition-all hover:-translate-y-0.5 hover:border-primary hover:bg-accent">
                    <CardContent class="p-2.5">
                      <div class="mb-1 flex items-start justify-between gap-2">
                        <span class="truncate text-[13px] font-semibold">
                          {item.title || item.url}
                        </span>
                        <Show when={source()}>
                          <Badge variant="outline" class={"shrink-0 px-1.5 py-0 text-[9px] " + source()!.class}>
                            {source()!.label}
                          </Badge>
                        </Show>
                      </div>
                      <Show when={item.summary}>
                        <HtmlRenderer
                          html={item.summary!}
                          source={item.source || "bookmark"}
                          class="mb-1.5"
                        />
                      </Show>
                      <Show when={item.tags && item.tags.length > 0}>
                        <div class="flex flex-wrap gap-1">
                          <For each={item.tags?.slice(0, 3)}>
                            {(tag) => (
                              <Badge variant="secondary" class="px-1.5 py-0 text-[9px]">
                                #{tag}
                              </Badge>
                            )}
                          </For>
                        </div>
                      </Show>
                    </CardContent>
                  </Card>
                </a>
              );
            }}
          </For>
        </div>
      </Show>
    </section>
  );
}
