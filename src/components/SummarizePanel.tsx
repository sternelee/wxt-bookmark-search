import { Show } from "solid-js";
import type { SummarizeResult } from "../types";
import { t } from "../i18n";

interface Props {
  result: SummarizeResult | null;
  loading: boolean;
  onClose: () => void;
}

export default function SummarizePanel(props: Props) {
  return (
    <aside class="w-96 shrink-0 border-l border-border pl-4 overflow-y-auto max-h-[calc(100vh-6rem)] sticky top-36 self-start">
      <div class="flex items-center justify-between mb-3">
        <h3 class="font-semibold text-sm">
          ✨ {t("search.summarize").replace("✨ ", "")}
        </h3>
        <button
          type="button"
          onClick={props.onClose}
          class="text-muted-foreground hover:text-foreground text-lg leading-none"
        >
          ×
        </button>
      </div>

      <Show when={props.loading}>
        <div class="text-sm text-muted-foreground animate-pulse">
          {t("search.summarizing")}
        </div>
      </Show>

      <Show when={!props.loading && props.result}>
        <a
          href={props.result!.url}
          target="_blank"
          class="text-sm font-medium text-blue-600 hover:underline break-all block mb-2"
        >
          {props.result!.title}
        </a>

        <Show when={props.result!.tags.length > 0}>
          <div class="flex flex-wrap gap-1 mb-3">
            {props.result!.tags.map((tag: string) => (
              <span class="text-xs px-2 py-0.5 rounded-full bg-secondary text-secondary-foreground">
                {tag}
              </span>
            ))}
          </div>
        </Show>

        <div class="text-sm leading-relaxed text-foreground whitespace-pre-wrap">
          {props.result!.summary}
        </div>
      </Show>

      <Show when={!props.loading && !props.result}>
        <div class="text-sm text-muted-foreground">
          {t("search.summaryEmpty")}
        </div>
      </Show>
    </aside>
  );
}
