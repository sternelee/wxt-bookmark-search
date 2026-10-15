import { createSignal, createEffect, For, Show, onMount, onCleanup } from "solid-js";
import type { CodeSymbol, CodeEdge } from "../../../src/types";
import { Badge } from "../../../src/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "../../../src/components/ui/card";
import { cn } from "../../../src/lib/utils";
import { useI18n } from "../../../src/i18n";
import { kindBadgeClass, kindNodeColor, KIND_LABEL_KEY } from "./kindStyles";

interface CodeMapProps {
  symbols: CodeSymbol[];
  edges: CodeEdge[];
  onNodeClick: (symbolId: string) => void;
}

interface Node {
  id: string;
  x: number;
  y: number;
  label: string;
  kind: string;
  filePath: string;
  r: number;
}

interface Link {
  source: string;
  target: string;
  kind: string;
}

export function CodeMap(props: CodeMapProps) {
  const { t } = useI18n();
  const [nodes, setNodes] = createSignal<Node[]>([]);
  const [links, setLinks] = createSignal<Link[]>([]);
  const [selectedId, setSelectedId] = createSignal<string | null>(null);
  const [width, setWidth] = createSignal(800);
  const [height, setHeight] = createSignal(500);

  let svgEl: SVGSVGElement | undefined;

  /** 统计当前图谱里出现的种类（用于图例） */
  const presentKinds = () => {
    const kinds = new Set<string>();
    for (const n of nodes()) kinds.add(n.kind);
    return [...kinds].sort();
  };

  const kindLabel = (kind: string) => {
    const key = KIND_LABEL_KEY[kind];
    return key ? t(key) : kind;
  };

  onMount(() => {
    const measure = () => {
      const el = svgEl?.parentElement;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      if (rect.width > 0) setWidth(Math.max(rect.width, 400));
      if (rect.height > 0) setHeight(Math.max(rect.height, 300));
    };
    measure();

    // 面板初始为 hidden（forceMount），尺寸为 0，需要等其可见后再量一次
    const target = svgEl?.parentElement;
    let observer: ResizeObserver | undefined;
    if (target && typeof ResizeObserver !== "undefined") {
      observer = new ResizeObserver(measure);
      observer.observe(target);
    }
    onCleanup(() => observer?.disconnect());
  });

  // 符号/边是异步加载的，必须在它们变化时重建布局（原实现只在 mount 时建一次 → 空图）
  createEffect(() => {
    props.symbols;
    props.edges;
    width();
    height();
    buildGraph();
  });

  function buildGraph() {
    const symMap = new Map<string, CodeSymbol>();
    for (const s of props.symbols) symMap.set(s.id, s);

    const fileMap = new Map<string, string[]>();
    for (const s of props.symbols) {
      const list = fileMap.get(s.filePath) ?? [];
      list.push(s.id);
      fileMap.set(s.filePath, list);
    }

    const nodeList: Node[] = [];
    const linkList: Link[] = [];

    // Layout: files in a circle, symbols around their file center
    const files = [...fileMap.keys()];
    const cx = width() / 2;
    const cy = height() / 2;
    const fileRadius = Math.min(width(), height()) * 0.35;

    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      const fAngle = (2 * Math.PI * i) / Math.max(files.length, 1);
      const fcx = cx + fileRadius * Math.cos(fAngle);
      const fcy = cy + fileRadius * Math.sin(fAngle);
      const ids = fileMap.get(f) ?? [];
      for (let j = 0; j < ids.length; j++) {
        const s = symMap.get(ids[j]);
        if (!s) continue;
        const sAngle = (2 * Math.PI * j) / Math.max(ids.length, 1) + fAngle;
        const r = 40 + ids.length * 5;
        nodeList.push({
          id: s.id,
          x: fcx + r * Math.cos(sAngle),
          y: fcy + r * Math.sin(sAngle),
          label: s.name,
          kind: s.kind,
          filePath: s.filePath,
          r: 6 + (s.kind === "function" ? 2 : 4),
        });
      }
    }

    for (const e of props.edges) {
      if (symMap.has(e.from) && symMap.has(e.to)) {
        linkList.push({ source: e.from, target: e.to, kind: e.kind });
      }
    }

    setNodes(nodeList);
    setLinks(linkList);
  }

  const nodeById = () => {
    const m = new Map<string, Node>();
    for (const n of nodes()) m.set(n.id, n);
    return m;
  };

  return (
    <Card class="flex h-full flex-col">
      <CardHeader class="flex-none flex-row items-center justify-between gap-3 space-y-0">
        <CardTitle class="text-base">{t("codeWiki.tab.map")}</CardTitle>
        <div class="flex flex-wrap items-center justify-end gap-1.5">
          <Badge variant="secondary" class="tabular-nums">
            {nodes().length} · {links().length}
          </Badge>
          <For each={presentKinds()}>
            {(kind) => (
              <Badge
                variant="outline"
                class={cn("px-1.5 py-0 text-[10px]", kindBadgeClass(kind))}
              >
                {kindLabel(kind)}
              </Badge>
            )}
          </For>
        </div>
      </CardHeader>
      <CardContent class="relative min-h-0 flex-1 p-0">
        <Show
          when={nodes().length > 0}
          fallback={
            <div class="flex h-full flex-col items-center justify-center gap-2 p-6 text-center text-muted-foreground">
              <p class="select-none text-3xl">🕸</p>
              <p class="max-w-64 text-sm">{t("codeWiki.empty.title")}</p>
            </div>
          }
        >
          <svg
            ref={svgEl}
            id="code-map-svg"
            width="100%"
            height="100%"
            viewBox={`0 0 ${width()} ${height()}`}
            class="text-foreground"
          >
            <For each={links()}>
              {(link) => {
                const src = nodeById().get(link.source);
                const tgt = nodeById().get(link.target);
                if (!src || !tgt) return null;
                return (
                  <line
                    x1={src.x}
                    y1={src.y}
                    x2={tgt.x}
                    y2={tgt.y}
                    stroke="currentColor"
                    stroke-width={1.5}
                    stroke-opacity={0.25}
                  />
                );
              }}
            </For>
            <For each={nodes()}>
              {(node) => (
                <g
                  onClick={() => {
                    setSelectedId(node.id);
                    props.onNodeClick(node.id);
                  }}
                  class="cursor-pointer"
                >
                  <circle
                    cx={node.x}
                    cy={node.y}
                    r={node.r}
                    fill={kindNodeColor(node.kind)}
                    stroke={selectedId() === node.id ? "currentColor" : "transparent"}
                    stroke-width={2}
                  />
                  <text
                    x={node.x}
                    y={node.y + node.r + 12}
                    text-anchor="middle"
                    font-size="10"
                    fill="currentColor"
                    opacity={selectedId() === node.id ? 1 : 0.75}
                  >
                    {node.label}
                  </text>
                </g>
              )}
            </For>
          </svg>
        </Show>
      </CardContent>
    </Card>
  );
}
