import { createSignal, For, Show } from "solid-js";
import type { CodeSymbol, CodeSearchResult } from "../../../src/types";
import { Badge } from "../../../src/components/ui/badge";
import { Button } from "../../../src/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../../../src/components/ui/card";
import { Separator } from "../../../src/components/ui/separator";
import { Skeleton } from "../../../src/components/ui/skeleton";
import { TextField, TextFieldInput } from "../../../src/components/ui/text-field";
import { cn } from "../../../src/lib/utils";
import { useI18n } from "../../../src/i18n";
import { kindBadgeClass, KIND_LABEL_KEY } from "./kindStyles";

interface SymbolPanelProps {
  repoUrl: string;
  onSymbolClick: (symbolId: string) => void;
}

export function SymbolPanel(props: SymbolPanelProps) {
  const { t } = useI18n();
  const [query, setQuery] = createSignal("");
  const [results, setResults] = createSignal<CodeSearchResult[]>([]);
  const [selected, setSelected] = createSignal<CodeSymbol | null>(null);
  const [loading, setLoading] = createSignal(false);
  const [searched, setSearched] = createSignal(false);

  const kindLabel = (kind: string) => {
    const key = KIND_LABEL_KEY[kind];
    return key ? t(key) : kind;
  };

  async function search() {
    const q = query().trim();
    if (!q) {
      setResults([]);
      setSearched(false);
      return;
    }
    setLoading(true);
    try {
      const res = await browser.runtime.sendMessage({
        type: "SEMANTIC_CODE_SEARCH",
        query: q,
        repoUrl: props.repoUrl,
      });
      if (res?.success && res.results) {
        setResults(res.results as CodeSearchResult[]);
      } else {
        setResults([]);
      }
    } catch (e) {
      console.error("[SymbolPanel] search error:", e);
      setResults([]);
    } finally {
      setLoading(false);
      setSearched(true);
    }
  }

  function handleKeyDown(e: KeyboardEvent) {
    if (e.key === "Enter" && !e.isComposing) search();
  }

  async function showSymbol(id: string) {
    try {
      const res = await browser.runtime.sendMessage({
        type: "GET_SYMBOL_INFO",
        symbolId: id,
      });
      if (res?.success && res.symbol) {
        setSelected(res.symbol as CodeSymbol);
        props.onSymbolClick(id);
      }
    } catch (e) {
      console.error("[SymbolPanel] getSymbol error:", e);
    }
  }

  return (
    <Card class="flex h-full flex-col">
      <CardHeader class="flex-none flex-row items-center justify-between gap-3 space-y-0">
        <CardTitle class="text-base">{t("codeWiki.tab.search")}</CardTitle>
        <Show when={results().length > 0}>
          <Badge variant="secondary" class="tabular-nums">
            {results().length}
          </Badge>
        </Show>
      </CardHeader>
      <CardContent class="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden">
        <div class="flex flex-none gap-2">
          <TextField
            value={query()}
            onChange={setQuery}
            class="min-w-0 flex-1"
            aria-label={t("codeWiki.placeholder.search")}
          >
            <TextFieldInput
              type="search"
              placeholder={t("codeWiki.placeholder.search")}
              autocomplete="off"
              spellcheck={false}
              onKeyDown={handleKeyDown}
            />
          </TextField>
          <Button size="sm" class="shrink-0" disabled={loading() || !query().trim()} onClick={search}>
            {t("codeWiki.action.build")}
          </Button>
        </div>

        <div class="min-h-0 flex-1 overflow-y-auto">
          <Show when={loading()}>
            <div class="flex flex-col gap-2">
              <For each={[0, 1, 2, 3]}>
                {() => (
                  <div class="flex items-center gap-2 p-2">
                    <Skeleton class="h-5 w-16 rounded-full" />
                    <div class="min-w-0 flex-1">
                      <Skeleton class="h-3.5 w-2/3 rounded-md" />
                      <Skeleton class="mt-1.5 h-3 w-1/2 rounded-md" />
                    </div>
                  </div>
                )}
              </For>
            </div>
          </Show>

          <Show when={!loading() && searched() && results().length === 0}>
            <div class="flex flex-col items-center gap-2 py-10 text-center text-muted-foreground">
              <p class="select-none text-3xl">🔎</p>
              <p class="text-sm">{t("board.noResults")}</p>
            </div>
          </Show>

          <Show when={!loading() && !searched()}>
            <div class="flex flex-col items-center gap-2 py-10 text-center text-muted-foreground">
              <p class="select-none text-3xl">🧩</p>
              <p class="max-w-56 text-sm">{t("codeWiki.placeholder.search")}</p>
            </div>
          </Show>

          <div class="flex flex-col gap-0.5">
            <For each={results()}>
              {(sym) => (
                <Button
                  variant={selected()?.id === sym.id ? "secondary" : "ghost"}
                  size="sm"
                  class="h-auto w-full justify-start gap-2 px-2 py-2 font-normal"
                  onClick={() => showSymbol(sym.id)}
                >
                  <Badge
                    variant="outline"
                    class={cn("shrink-0 px-1.5 py-0 text-[10px]", kindBadgeClass(sym.kind))}
                  >
                    {kindLabel(sym.kind)}
                  </Badge>
                  <span class="min-w-0 flex-1 text-left">
                    <span class="block truncate text-[13px] font-medium">{sym.name}</span>
                    <span class="block truncate font-mono text-[11px] text-muted-foreground">
                      {sym.filePath}:{sym.lineStart}
                    </span>
                  </span>
                </Button>
              )}
            </For>
          </div>
        </div>

        <Show when={selected()}>
          {(sym) => (
            <div class="max-h-[45%] flex-none overflow-y-auto">
              <Separator class="mb-3" />
              <div class="mb-1.5 flex items-center gap-2">
                <Badge
                  variant="outline"
                  class={cn("shrink-0 px-1.5 py-0 text-[10px]", kindBadgeClass(sym().kind))}
                >
                  {kindLabel(sym().kind)}
                </Badge>
                <span class="min-w-0 flex-1 truncate text-sm font-semibold">{sym().name}</span>
              </div>
              <p class="mb-2 font-mono text-[11px] text-muted-foreground">
                {sym().filePath}:{sym().lineStart}
              </p>
              <Show when={sym().signature}>
                <pre class="overflow-x-auto rounded-lg bg-muted p-2.5 font-mono text-[11px] leading-relaxed">
                  {sym().signature}
                </pre>
              </Show>
              <Show when={sym().jsdoc}>
                <p class="mt-2 whitespace-pre-wrap text-xs leading-relaxed text-muted-foreground">
                  {sym().jsdoc}
                </p>
              </Show>
            </div>
          )}
        </Show>
      </CardContent>
    </Card>
  );
}
