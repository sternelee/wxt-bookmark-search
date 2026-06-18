import { createSignal, For, Show } from "solid-js";
import type { CodeQAResult } from "../../../src/types";
import { Card, CardContent, CardHeader, CardTitle } from "../../../src/components/ui/card";
import { Input } from "../../../src/components/ui/input";
import { Button } from "../../../src/components/ui/button";
import { cn } from "../../../src/lib/utils";
import { t } from "../../../src/i18n";

interface CodeQAProps {
  repoUrl: string;
}

interface ChatMessage {
  role: "user" | "assistant";
  text: string;
  citations?: CodeQAResult["citations"];
}

export function CodeQA(props: CodeQAProps) {
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
      })) as { success: boolean; answer?: string; citations?: CodeQAResult["citations"]; error?: string };
      if (res?.success && res.answer) {
        setMessages((prev) => [
          ...prev,
          { role: "assistant", text: res.answer ?? "", citations: res.citations ?? [] },
        ]);
      } else {
        setMessages((prev) => [
          ...prev,
          { role: "assistant", text: res?.error || t("codeWiki.qa.failed") },
        ]);
      }
    } catch (e) {
      console.error("[CodeQA] error:", e);
      setMessages((prev) => [
        ...prev,
        { role: "assistant", text: t("codeWiki.qa.error", { error: e instanceof Error ? e.message : String(e) }) },
      ]);
    } finally {
      setLoading(false);
    }
  }

  function handleKeyDown(e: KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  return (
    <Card class="h-full flex flex-col">
      <CardHeader class="flex-none">
        <CardTitle>{t("codeWiki.tab.qa")}</CardTitle>
      </CardHeader>
      <CardContent class="flex flex-col gap-3 flex-1 min-h-0 overflow-hidden">
        <div class="flex-1 overflow-y-auto space-y-3">
          <For each={messages()}>
            {(msg) => (
              <div
                class={cn(
                  "p-3 rounded-lg text-sm",
                  msg.role === "user"
                    ? "bg-primary text-primary-foreground ml-8"
                    : "bg-muted mr-8",
                )}
              >
                <div class="whitespace-pre-wrap">{msg.text}</div>
                <Show when={msg.citations && msg.citations.length > 0}>
                  <div class="mt-2 space-y-1">
                    <div class="text-xs font-semibold opacity-70">
                      {t("codeWiki.qa.sources")}
                    </div>
                    <For each={msg.citations}>
                      {(c) => (
                        <div class="text-xs opacity-70">
                          <code class="font-mono">{c.title}</code>
                          <span class="ml-1 text-muted-foreground">
                            {c.filePath}
                          </span>
                          <Show when={c.excerpt}>
                            <div class="ml-2 mt-1 line-clamp-2 italic">
                              {c.excerpt.slice(0, 120)}
                            </div>
                          </Show>
                        </div>
                      )}
                    </For>
                  </div>
                </Show>
              </div>
            )}
          </For>
          <Show when={loading()}>
            <div class="text-sm text-muted-foreground animate-pulse">
              {t("codeWiki.qa.thinking")}
            </div>
          </Show>
        </div>
        <div class="flex gap-2 flex-none">
          <Input
            placeholder={t("codeWiki.placeholder.ask")}
            value={question()}
            onInput={(e) => setQuestion(e.currentTarget.value)}
            onKeyDown={handleKeyDown}
            class="flex-1"
          />
          <Button onClick={send} disabled={loading()}>
            {t("codeWiki.action.send")}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
