import { createSignal, For, Show, onMount } from "solid-js";
import type { WikiDoc } from "../../../src/types";
import { Card, CardContent, CardHeader, CardTitle } from "../../../src/components/ui/card";
import { cn } from "../../../src/lib/utils";
import { t } from "../../../src/i18n";

interface WikiTreeProps {
  repoUrl: string;
  onDocSelect: (docId: string) => void;
}

interface TreeNode {
  id: string;
  name: string;
  children: TreeNode[];
  docId?: string;
  expanded?: boolean;
}

export function WikiTree(props: WikiTreeProps) {
  const [docs, setDocs] = createSignal<WikiDoc[]>([]);
  const [selectedDoc, setSelectedDoc] = createSignal<WikiDoc | null>(null);
  const [tree, setTree] = createSignal<TreeNode[]>([]);

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

  function TreeItem(props: { node: TreeNode; depth: number }) {
    const [expanded, setExpanded] = createSignal(props.depth < 2);
    const hasChildren = props.node.children.length > 0;

    return (
      <div>
        <div
          class={cn(
            "flex items-center gap-1 py-1 px-2 rounded cursor-pointer hover:bg-accent",
            selectedDoc()?.id === props.node.docId && "bg-accent",
          )}
          style={{ "padding-left": `${props.depth * 12 + 8}px` }}
          onClick={() => {
            if (hasChildren) setExpanded(!expanded());
            if (props.node.docId) selectDoc(props.node.docId);
          }}
        >
          <Show when={hasChildren}>
            <span class="text-xs text-muted-foreground select-none">
              {expanded() ? "▼" : "▶"}
            </span>
          </Show>
          <Show when={!hasChildren}>
            <span class="text-xs text-muted-foreground select-none">◦</span>
          </Show>
          <span class="text-sm truncate">{props.node.name}</span>
        </div>
        <Show when={expanded()}>
          <For each={props.node.children}>
            {(child) => <TreeItem node={child} depth={props.depth + 1} />}
          </For>
        </Show>
      </div>
    );
  }

  return (
    <Card class="h-full flex flex-col">
      <CardHeader class="flex-none">
        <CardTitle>{t("codeWiki.tab.docs")}</CardTitle>
      </CardHeader>
      <CardContent class="flex flex-col gap-3 flex-1 min-h-0 overflow-hidden">
        <div class="flex-1 overflow-y-auto">
          <For each={tree()}>
            {(node) => <TreeItem node={node} depth={0} />}
          </For>
        </div>
        <Show when={selectedDoc()}>
          {(doc) => (
            <div class="border-t pt-3 flex-none overflow-y-auto max-h-[50%]">
              <div class="font-semibold mb-2">{doc().title}</div>
              <div class="prose dark:prose-invert prose-sm max-w-none">
                <div innerHTML={renderMarkdown(doc().content)} />
              </div>
            </div>
          )}
        </Show>
      </CardContent>
    </Card>
  );
}

function renderMarkdown(md: string): string {
  return md
    .replace(/^### (.*$)/gim, "<h3>$1</h3>")
    .replace(/^## (.*$)/gim, "<h2>$1</h2>")
    .replace(/^# (.*$)/gim, "<h1>$1</h1>")
    .replace(/^\* (.*$)/gim, "<ul><li>$1</li></ul>")
    .replace(/^\- (.*$)/gim, "<ul><li>$1</li></ul>")
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\n/g, "<br />");
}
