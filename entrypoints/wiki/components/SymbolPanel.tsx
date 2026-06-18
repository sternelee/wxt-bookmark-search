import { createSignal, For, Show } from "solid-js";
import type { CodeSymbol, CodeSearchResult } from "../../../src/types";
import { Card, CardContent, CardHeader, CardTitle } from "../../../src/components/ui/card";
import { Input } from "../../../src/components/ui/input";
import { Badge } from "../../../src/components/ui/badge";
import { cn } from "../../../src/lib/utils";
import { t } from "../../../src/i18n";

interface SymbolPanelProps {
  repoUrl: string;
  onSymbolClick: (symbolId: string) => void;
}

export function SymbolPanel(props: SymbolPanelProps) {
  const [query, setQuery] = createSignal("");
  const [results, setResults] = createSignal<CodeSearchResult[]>([]);
  const [selected, setSelected] = createSignal<CodeSymbol | null>(null);
  const [loading, setLoading] = createSignal(false);

  async function search() {
    const q = query().trim();
    if (!q) {
      setResults([]);
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
    }
  }

  function handleKeyDown(e: KeyboardEvent) {
    if (e.key === "Enter") search();
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

  const kindColor: Record<string, string> = {
    function: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
    class: "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200",
    interface: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
    type: "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200",
    variable: "bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200",
    export: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
    import: "bg-indigo-100 text-indigo-800 dark:bg-indigo-900 dark:text-indigo-200",
    file: "bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-200",
  };

  const kindLabel: Record<string, string> = {
    function: t("codeWiki.kind.function"),
    class: t("codeWiki.kind.class"),
    interface: t("codeWiki.kind.interface"),
    type: t("codeWiki.kind.type"),
    variable: t("codeWiki.kind.variable"),
    export: t("codeWiki.kind.export"),
    import: t("codeWiki.kind.import"),
    file: t("codeWiki.kind.file"),
  };

  return (
    <Card class="h-full flex flex-col">
      <CardHeader class="flex-none">
        <CardTitle>{t("codeWiki.tab.search")}</CardTitle>
      </CardHeader>
      <CardContent class="flex flex-col gap-3 flex-1 min-h-0 overflow-hidden">
        <div class="flex gap-2">
          <Input
            placeholder={t("codeWiki.placeholder.search")}
            value={query()}
            onInput={(e: InputEvent) => setQuery((e.currentTarget as HTMLInputElement).value)}
            onKeyDown={handleKeyDown}
            class="flex-1"
          />
        </div>
        <Show when={loading()}>
          <div class="text-sm text-muted-foreground">
            {t("codeWiki.status.searching")}
          </div>
        </Show>
        <div class="flex-1 overflow-y-auto space-y-1">
          <For each={results()}>
            {(sym) => (
              <div
                class={cn(
                  "flex items-center gap-2 p-2 rounded-md cursor-pointer hover:bg-accent",
                  selected()?.id === sym.id && "bg-accent",
                )}
                onClick={() => showSymbol(sym.id)}
              >
                <Badge class={kindColor[sym.kind] ?? kindColor.variable}>
                  {kindLabel[sym.kind] ?? sym.kind}
                </Badge>
                <div class="flex-1 min-w-0">
                  <div class="font-medium truncate">{sym.name}</div>
                  <div class="text-xs text-muted-foreground truncate">
                    {sym.filePath}:{sym.lineStart}
                  </div>
                </div>
              </div>
            )}
          </For>
        </div>
        <Show when={selected()}>
          {(sym) => (
            <div class="border-t pt-3 flex-none">
              <div class="font-semibold mb-1">{sym().name}</div>
              <Show when={sym().signature}>
                <pre class="text-xs bg-muted p-2 rounded whitespace-pre-wrap">
                  {sym().signature}
                </pre>
              </Show>
              <Show when={sym().jsdoc}>
                <div class="text-xs text-muted-foreground mt-2 whitespace-pre-wrap">
                  {sym().jsdoc}
                </div>
              </Show>
            </div>
          )}
        </Show>
      </CardContent>
    </Card>
  );
}
