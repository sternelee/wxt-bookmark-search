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

export default function RecentList(props: RecentListProps) {
  const { t } = useI18n();
  return (
    <div class="mb-5">
      <h2 class="text-xs uppercase tracking-wide text-muted-foreground mb-2.5 font-medium">
        {t("popup.recentlyVisited")}
      </h2>
      <div class="flex flex-col gap-2">
        <For each={props.items}>
          {(item) => (
            <a
              href={item.url}
              target="_blank"
              class="block"
            >
              <Card class="hover:bg-accent hover:border-primary transition-all hover:-translate-y-0.5">
                <CardContent class="p-2.5">
                  <div class="text-[13px] font-semibold truncate mb-1">
                    {item.title || item.url}
                  </div>
                  <Show when={item.summary && item.source}>
                    <HtmlRenderer
                      html={item.summary!}
                      source={item.source!}
                      class="mb-2"
                    />
                  </Show>
                  <Show when={item.tags && item.tags.length > 0}>
                    <div class="flex gap-1.5">
                      <For each={item.tags?.slice(0, 2)}>
                        {(tag) => (
                          <Badge variant="secondary" class="text-[10px]">
                            #{tag}
                          </Badge>
                        )}
                      </For>
                    </div>
                  </Show>
                </CardContent>
              </Card>
            </a>
          )}
        </For>
      </div>
    </div>
  );
}
