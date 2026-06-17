import { Show, For } from "solid-js";
import type { SummarizeResult } from "../types";
import { t } from "../i18n";

interface Props {
  result: SummarizeResult | null;
  loading: boolean;
  onClose: () => void;
}

const CONTENT_TYPE_LABELS: Record<string, string> = {
  article: "📄 Article",
  repo: "📦 Repository",
  tweet: "🐦 Tweet",
  doc: "📚 Documentation",
  video: "🎬 Video",
  tool: "🔧 Tool",
  other: "📌 Other",
};

const DIFFICULTY_LABELS: Record<string, { label: string; color: string }> = {
  beginner: { label: "Beginner", color: "bg-green-100 text-green-700" },
  intermediate: {
    label: "Intermediate",
    color: "bg-yellow-100 text-yellow-700",
  },
  advanced: { label: "Advanced", color: "bg-red-100 text-red-700" },
};

export default function SummarizePanel(props: Props) {
  return (
    <aside class="w-96 shrink-0 border-l border-border pl-4 py-4 overflow-y-auto max-h-[calc(100vh-11rem)] sticky top-40 self-start">
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
        <div class="space-y-3">
          <div class="h-4 bg-muted rounded animate-pulse w-3/4" />
          <div class="h-4 bg-muted rounded animate-pulse w-1/2" />
          <div class="h-20 bg-muted rounded animate-pulse" />
          <div class="flex gap-2">
            <div class="h-6 w-16 bg-muted rounded-full animate-pulse" />
            <div class="h-6 w-16 bg-muted rounded-full animate-pulse" />
            <div class="h-6 w-16 bg-muted rounded-full animate-pulse" />
          </div>
        </div>
      </Show>

      <Show when={!props.loading && props.result}>
        {/* Title */}
        <a
          href={props.result!.url}
          target="_blank"
          class="text-sm font-medium text-blue-600 hover:underline break-all block mb-2"
        >
          {props.result!.title}
        </a>

        {/* Quick Summary */}
        <Show when={props.result!.quickSummary}>
          <p class="text-sm font-medium text-foreground mb-3 leading-snug">
            {props.result!.quickSummary}
          </p>
        </Show>

        {/* Meta badges: content type, difficulty, reading time */}
        <div class="flex flex-wrap items-center gap-2 mb-3">
          <Show when={props.result!.contentType}>
            <span class="text-xs px-2 py-0.5 rounded-full bg-blue-50 text-blue-600">
              {CONTENT_TYPE_LABELS[props.result!.contentType!] ||
                props.result!.contentType}
            </span>
          </Show>

          <Show when={props.result!.difficulty}>
            <span
              class={`text-xs px-2 py-0.5 rounded-full ${DIFFICULTY_LABELS[props.result!.difficulty!]?.color || "bg-secondary text-secondary-foreground"}`}
            >
              {DIFFICULTY_LABELS[props.result!.difficulty!]?.label ||
                props.result!.difficulty}
            </span>
          </Show>

          <Show when={props.result!.readingTime}>
            <span class="text-xs px-2 py-0.5 rounded-full bg-secondary text-secondary-foreground">
              ⏱ {props.result!.readingTime} min
            </span>
          </Show>
        </div>

        {/* Tags */}
        <Show when={props.result!.tags.length > 0}>
          <div class="flex flex-wrap gap-1 mb-3">
            <For each={props.result!.tags}>
              {(tag: string) => (
                <span class="text-xs px-2 py-0.5 rounded-full bg-secondary text-secondary-foreground">
                  {tag}
                </span>
              )}
            </For>
          </div>
        </Show>

        {/* Key Points */}
        <Show
          when={props.result!.keyPoints && props.result!.keyPoints!.length > 0}
        >
          <div class="mb-3">
            <h4 class="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">
              Key Points
            </h4>
            <ul class="space-y-1">
              <For each={props.result!.keyPoints}>
                {(point: string) => (
                  <li class="text-xs text-foreground flex gap-1.5">
                    <span class="text-blue-500 mt-0.5 shrink-0">•</span>
                    <span>{point}</span>
                  </li>
                )}
              </For>
            </ul>
          </div>
        </Show>

        {/* Technologies */}
        <Show
          when={
            props.result!.technologies && props.result!.technologies!.length > 0
          }
        >
          <div class="mb-3">
            <h4 class="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">
              Technologies
            </h4>
            <div class="flex flex-wrap gap-1">
              <For each={props.result!.technologies}>
                {(tech: string) => (
                  <span class="text-xs px-2 py-0.5 rounded bg-purple-50 text-purple-600 border border-purple-200">
                    {tech}
                  </span>
                )}
              </For>
            </div>
          </div>
        </Show>

        {/* Concepts */}
        <Show
          when={props.result!.concepts && props.result!.concepts!.length > 0}
        >
          <div class="mb-3 border-t border-border pt-3">
            <h4 class="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">
              💡 Concepts
            </h4>
            <div class="space-y-2">
              <For each={props.result!.concepts}>
                {(concept) => (
                  <div class="p-2 bg-blue-50 rounded text-xs">
                    <div class="font-medium text-blue-800">{concept.name}</div>
                    <div class="text-blue-600 mt-0.5">{concept.definition}</div>
                    <Show when={concept.relatedConcepts.length > 0}>
                      <div class="text-blue-400 mt-1">
                        Related: {concept.relatedConcepts.join(", ")}
                      </div>
                    </Show>
                  </div>
                )}
              </For>
            </div>
          </div>
        </Show>

        {/* Claims */}
        <Show when={props.result!.claims && props.result!.claims!.length > 0}>
          <div class="mb-3">
            <h4 class="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">
              🎯 Key Claims
            </h4>
            <ul class="space-y-1.5">
              <For each={props.result!.claims}>
                {(claim) => (
                  <li class="text-xs">
                    <div class="text-foreground">{claim.text}</div>
                    <div class="text-muted-foreground mt-0.5 flex items-center gap-2">
                      <span
                        class={`px-1.5 py-0.5 rounded text-[10px] ${
                          claim.confidence === "high"
                            ? "bg-green-100 text-green-700"
                            : claim.confidence === "medium"
                              ? "bg-yellow-100 text-yellow-700"
                              : "bg-gray-100 text-gray-700"
                        }`}
                      >
                        {claim.confidence}
                      </span>
                      <span class="truncate">{claim.source}</span>
                    </div>
                  </li>
                )}
              </For>
            </ul>
          </div>
        </Show>

        {/* Data Points */}
        <Show
          when={
            props.result!.dataPoints && props.result!.dataPoints!.length > 0
          }
        >
          <div class="mb-3">
            <h4 class="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">
              📊 Key Data
            </h4>
            <ul class="space-y-1">
              <For each={props.result!.dataPoints}>
                {(dp) => (
                  <li class="text-xs p-1.5 bg-green-50 rounded">
                    <div class="font-medium text-green-800">{dp.fact}</div>
                    <div class="text-green-600">{dp.context}</div>
                  </li>
                )}
              </For>
            </ul>
          </div>
        </Show>

        {/* Full Summary */}
        <div class="text-sm leading-relaxed text-foreground whitespace-pre-wrap border-t border-border pt-3 mt-3">
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
