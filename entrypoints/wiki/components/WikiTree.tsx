import { createSignal, For, Show, onMount } from "solid-js";
import type { WikiDoc } from "../../../src/types";
import { Badge } from "../../../src/components/ui/badge";
import { Button } from "../../../src/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../../../src/components/ui/card";
import { Separator } from "../../../src/components/ui/separator";
import { Skeleton } from "../../../src/components/ui/skeleton";
import { cn } from "../../../src/lib/utils";
import { useI18n } from "../../../src/i18n";

interface WikiTreeProps {
  repoUrl: string;
  onDocSelect: (docId: string) => void;
}

interface TreeNode {
  id: string;
  name: string;
  children: TreeNode[];
  docId?: string;
}

export function WikiTree(props: WikiTreeProps) {
  const { t } = useI18n();
  const [docs, setDocs] = createSignal<WikiDoc[]>([]);
  const [selectedDoc, setSelectedDoc] = createSignal<WikiDoc | null>(null);
  const [tree, setTree] = createSignal<TreeNode[]>([]);
  const [loading, setLoading] = createSignal(true);

  onMount(async () => {
    try {
      const res = await browser.runtime.sendMessage({
        type: "GET_WIKI_DOC",
        docId: `${props.repoUrl}#overview`,
      });
      if (res?.success && res.doc) {
        setSelectedDoc(res.doc as WikiDoc);
      }
    } catch (e) {
      console.error("[WikiTree] initial load error:", e);
    }
    await loadDocs();
  });

  async function loadDocs() {
    try {
      const res = await browser.runtime.sendMessage({
        type: "GET_CODE_GRAPH",
        repoUrl: props.repoUrl,
      });
      if (res?.success && res.docs) {
        const d = res.docs as WikiDoc[];
        setDocs(d);
        buildTree(d);
      }
    } catch (e) {
      console.error("[WikiTree] load docs error:", e);
    } finally {
      setLoading(false);
    }
  }

  function buildTree(docsList: WikiDoc[]) {
    const root: TreeNode = { id: "root", name: "Project", children: [] };
    for (const doc of docsList) {
      const id = doc.id.replace(`${props.repoUrl}#`, "");
      const parts = id.split("/");
      let current = root;
      for (let i = 0; i < parts.length; i++) {
        const part = parts[i];
        const isLeaf = i === parts.length - 1;
        const childId = parts.slice(0, i + 1).join("/");
        let child = current.children.find((c) => c.id === childId);
        if (!child) {
          child = {
            id: childId,
            name: part,
            children: [],
            docId: isLeaf ? doc.id : undefined,
          };
          current.children.push(child);
        }
        current = child;
      }
    }
    setTree(root.children);
  }

  async function selectDoc(docId: string) {
    try {
      const res = await browser.runtime.sendMessage({
        type: "GET_WIKI_DOC",
        docId,
      });
      if (res?.success && res.doc) {
        setSelectedDoc(res.doc as WikiDoc);
        props.onDocSelect(docId);
      }
    } catch (e) {
      console.error("[WikiTree] select doc error:", e);
    }
  }

  function TreeItem(itemProps: { node: TreeNode; depth: number }) {
    const [expanded, setExpanded] = createSignal(itemProps.depth < 2);
    const hasChildren = () => itemProps.node.children.length > 0;

    return (
      <div>
        <Button
          variant={selectedDoc()?.id === itemProps.node.docId ? "secondary" : "ghost"}
          size="sm"
          class="h-auto w-full justify-start gap-1.5 px-2 py-1 font-normal"
          style={{ "padding-left": `${itemProps.depth * 12 + 8}px` }}
          onClick={() => {
            if (hasChildren()) setExpanded(!expanded());
            if (itemProps.node.docId) selectDoc(itemProps.node.docId);
          }}
        >
          <span class="w-3 shrink-0 select-none text-[10px] text-muted-foreground">
            {hasChildren() ? (expanded() ? "▼" : "▶") : "◦"}
          </span>
          <span
            class={cn(
              "min-w-0 flex-1 truncate text-left text-[13px]",
              itemProps.node.docId && "font-medium",
            )}
          >
            {itemProps.node.name}
          </span>
        </Button>
        <Show when={expanded()}>
          <For each={itemProps.node.children}>
            {(child) => <TreeItem node={child} depth={itemProps.depth + 1} />}
          </For>
        </Show>
      </div>
    );
  }

  return (
    <Card class="flex h-full flex-col">
      <CardHeader class="flex-none flex-row items-center justify-between gap-3 space-y-0">
        <CardTitle class="text-base">{t("codeWiki.tab.docs")}</CardTitle>
        <Show when={docs().length > 0}>
          <Badge variant="secondary" class="tabular-nums">
            {docs().length}
          </Badge>
        </Show>
      </CardHeader>
      <CardContent class="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden">
        <div class="min-h-0 flex-1 overflow-y-auto">
          <Show when={loading()}>
            <div class="flex flex-col gap-1.5">
              <For each={[0, 1, 2, 3, 4]}>
                {(i) => (
                  <Skeleton
                    class="h-6 rounded-md"
                    style={{ width: `${85 - i * 9}%`, "margin-left": `${i * 8}px` }}
                  />
                )}
              </For>
            </div>
          </Show>

          <Show when={!loading() && tree().length === 0}>
            <div class="flex flex-col items-center gap-2 py-10 text-center text-muted-foreground">
              <p class="select-none text-3xl">📄</p>
              <p class="max-w-56 text-sm">{t("codeWiki.empty.title")}</p>
            </div>
          </Show>

          <For each={tree()}>{(node) => <TreeItem node={node} depth={0} />}</For>
        </div>

        <Show when={selectedDoc()}>
          {(doc) => (
            <div class="max-h-[50%] flex-none overflow-y-auto">
              <Separator class="mb-3" />
              <div class="mb-2 text-sm font-semibold">{doc().title}</div>
              <div
                class="text-[13px] leading-relaxed text-muted-foreground [&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[11px] [&_h1]:mb-2 [&_h1]:text-base [&_h1]:font-semibold [&_h1]:text-foreground [&_h2]:mb-1.5 [&_h2]:text-sm [&_h2]:font-semibold [&_h2]:text-foreground [&_h3]:mb-1 [&_h3]:text-[13px] [&_h3]:font-semibold [&_h3]:text-foreground [&_li]:ml-4 [&_li]:list-disc"
                innerHTML={renderMarkdown(doc().content)}
              />
            </div>
          )}
        </Show>
      </CardContent>
    </Card>
  );
}

function renderMarkdown(md: string): string {
  // HTML-escape first to prevent XSS from code snippets / user-controlled content
  const escaped = md
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
  return escaped
    .replace(/^### (.*$)/gim, "<h3>$1</h3>")
    .replace(/^## (.*$)/gim, "<h2>$1</h2>")
    .replace(/^# (.*$)/gim, "<h1>$1</h1>")
    .replace(/^\* (.*$)/gim, "<ul><li>$1</li></ul>")
    .replace(/^\- (.*$)/gim, "<ul><li>$1</li></ul>")
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\n/g, "<br />");
}
