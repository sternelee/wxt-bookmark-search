import { createSignal, For, Show } from "solid-js";
import type { CodeQAResult } from "../../../src/types";
import { Alert, AlertDescription } from "../../../src/components/ui/alert";
import { Badge } from "../../../src/components/ui/badge";
import { Button } from "../../../src/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../../../src/components/ui/card";
import { Separator } from "../../../src/components/ui/separator";
import { TextField, TextFieldInput } from "../../../src/components/ui/text-field";
import { cn } from "../../../src/lib/utils";
import { useI18n } from "../../../src/i18n";

interface CodeQAProps {
  repoUrl: string;
}

interface ChatMessage {
  role: "user" | "assistant";
  text: string;
  isError?: boolean;
  citations?: CodeQAResult["citations"];
}

export function CodeQA(props: CodeQAProps) {
  const { t } = useI18n();
  const [question, setQuestion] = createSignal("");
  const [messages, setMessages] = createSignal<ChatMessage[]>([]);
  const [loading, setLoading] = createSignal(false);

  async function send() {
    const q = question().trim();
    if (!q || loading()) return;
    setMessages((prev) => [...prev, { role: "user", text: q }]);
    setQuestion("");
    setLoading(true);
    try {
      const res = (await browser.runtime.sendMessage({
        type: "ASK_CODEBASE",
        question: q,
        repoUrl: props.repoUrl,
      })) as {
        success: boolean;
        answer?: string;
        citations?: CodeQAResult["citations"];
        error?: string;
      };
      if (res?.success && res.answer) {
        setMessages((prev) => [
          ...prev,
          { role: "assistant", text: res.answer ?? "", citations: res.citations ?? [] },
        ]);
      } else {
        setMessages((prev) => [
          ...prev,
          { role: "assistant", text: res?.error || t("codeWiki.qa.failed"), isError: true },
        ]);
      }
    } catch (e) {
      console.error("[CodeQA] error:", e);
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          text: t("codeWiki.qa.error", {
            error: e instanceof Error ? e.message : String(e),
          }),
          isError: true,
        },
      ]);
    } finally {
      setLoading(false);
    }
  }

  function handleKeyDown(e: KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      send();
    }
  }

  return (
    <Card class="flex h-full flex-col">
      <CardHeader class="flex-none flex-row items-center justify-between gap-3 space-y-0">
        <CardTitle class="text-base">{t("codeWiki.tab.qa")}</CardTitle>
        <Show when={messages().length > 0}>
          <Button
            variant="ghost"
            size="sm"
            class="shrink-0 text-xs"
            onClick={() => setMessages([])}
          >
            {t("common.close")}
          </Button>
        </Show>
      </CardHeader>
      <CardContent class="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden">
        <div class="min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
          <Show when={messages().length === 0}>
            <div class="flex flex-col items-center gap-2 py-10 text-center text-muted-foreground">
              <p class="select-none text-3xl">💬</p>
              <p class="max-w-56 text-sm">{t("codeWiki.placeholder.ask")}</p>
            </div>
          </Show>

          <For each={messages()}>
            {(msg) => (
              <div class={cn("flex", msg.role === "user" ? "justify-end" : "justify-start")}>
                <div
                  class={cn(
                    "max-w-[85%] rounded-xl px-3 py-2 text-[13px] leading-relaxed",
                    msg.role === "user"
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-foreground",
                  )}
                >
                  <div class="whitespace-pre-wrap">{msg.text}</div>

                  <Show when={msg.citations && msg.citations.length > 0}>
                    <Separator class="my-2 opacity-30" />
                    <div class="mb-1.5 text-[11px] font-semibold uppercase tracking-wide opacity-70">
                      {t("codeWiki.qa.sources")}
                    </div>
                    <div class="flex flex-col gap-1.5">
                      <For each={msg.citations}>
                        {(c) => (
                          <div class="rounded-lg bg-background/50 p-2">
                            <div class="flex items-center gap-1.5">
                              <Badge variant="outline" class="shrink-0 px-1.5 py-0 font-mono text-[10px]">
                                {c.title}
                              </Badge>
                              <span class="min-w-0 flex-1 truncate font-mono text-[10px] opacity-70">
                                {c.filePath}
                              </span>
                            </div>
                            <Show when={c.excerpt}>
                              <p class="mt-1 line-clamp-2 text-[11px] italic opacity-70">
                                {c.excerpt.slice(0, 120)}
                              </p>
                            </Show>
                          </div>
                        )}
                      </For>
                    </div>
                  </Show>
                </div>
              </div>
            )}
          </For>

          <Show when={loading()}>
            <div class="flex items-center gap-2 text-sm text-muted-foreground">
              <span class="select-none motion-safe:animate-spin">◌</span>
              {t("codeWiki.qa.thinking")}
            </div>
          </Show>
        </div>

        <Show when={messages().some((m) => m.isError)}>
          <Alert variant="error" class="flex-none py-2">
            <AlertDescription class="text-xs">{t("codeWiki.qa.failed")}</AlertDescription>
          </Alert>
        </Show>

        <div class="flex flex-none gap-2">
          <TextField
            value={question()}
            onChange={setQuestion}
            class="min-w-0 flex-1"
            aria-label={t("codeWiki.placeholder.ask")}
          >
            <TextFieldInput
              type="text"
              placeholder={t("codeWiki.placeholder.ask")}
              autocomplete="off"
              spellcheck={false}
              onKeyDown={handleKeyDown}
            />
          </TextField>
          <Button class="shrink-0" disabled={loading() || !question().trim()} onClick={send}>
            {t("codeWiki.action.send")}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
