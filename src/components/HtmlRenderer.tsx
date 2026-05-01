import { Show, splitProps, createMemo } from "solid-js";
import { sanitizeHtml, parseGitHubHtml } from "../lib/sanitize";
import { Badge } from "./ui/badge";

interface HtmlRendererProps {
  html: string;
  source: "github" | "twitter" | "bookmark" | "history";
  class?: string;
}

export function HtmlRenderer(props: HtmlRendererProps) {
  const [local, others] = splitProps(props, ["html", "source", "class"]);

  return (
    <Show
      when={local.source === "github"}
      fallback={<div class={`prose prose-sm max-w-none ${local.class || ""}`} innerHTML={sanitizeHtml(local.html)} />}
    >
      <GitHubCard html={local.html} class={local.class} />
    </Show>
  );
}

function GitHubCard(props: { html: string; class?: string }) {
  const parsed = createMemo(() => parseGitHubHtml(props.html));

  return (
    <div class={`rounded-md border border-border bg-muted/30 p-3 space-y-2 ${props.class || ""}`}>
      <Show when={parsed().description}>
        <p class="text-sm text-foreground/80 leading-relaxed line-clamp-3">
          {parsed().description}
        </p>
      </Show>

      <div class="flex flex-wrap items-center gap-2">
        <Show when={parsed().language}>
          <Badge variant="secondary" class="text-xs">
            {parsed().language}
          </Badge>
        </Show>
        <Show when={parsed().stars}>
          <span class="text-xs text-muted-foreground">
            ⭐ {parsed().stars}
          </span>
        </Show>
      </div>

      <Show when={parsed().readmeUrl}>
        <div class="flex gap-2 pt-1">
          <a
            href={parsed().readmeUrl}
            target="_blank"
            rel="noopener noreferrer"
            class="text-xs text-primary hover:underline flex items-center gap-1"
          >
            📄 View README
          </a>
        </div>
      </Show>
    </div>
  );
}