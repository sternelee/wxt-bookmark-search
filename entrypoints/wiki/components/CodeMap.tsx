import { createSignal, For, Show, onMount } from "solid-js";
import type { CodeSymbol, CodeEdge } from "../../../src/types";
import { Card, CardContent, CardHeader, CardTitle } from "../../../src/components/ui/card";
import { t } from "../../../src/i18n";

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
  const [nodes, setNodes] = createSignal<Node[]>([]);
  const [links, setLinks] = createSignal<Link[]>([]);
  const [selectedId, setSelectedId] = createSignal<string | null>(null);
  const [width, setWidth] = createSignal(800);
  const [height, setHeight] = createSignal(500);

  onMount(() => {
    const el = document.getElementById("code-map-svg");
    if (el) {
      const rect = el.getBoundingClientRect();
      setWidth(Math.max(rect.width, 400));
      setHeight(Math.max(rect.height, 300));
    }
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

  const colorForKind = (kind: string) => {
    const map: Record<string, string> = {
      function: "#3b82f6",
      class: "#a855f7",
      interface: "#22c55e",
      type: "#f59e0b",
      variable: "#6b7280",
      export: "#ef4444",
      import: "#8b5cf6",
    };
    return map[kind] ?? "#6b7280";
  };

  return (
    <Card class="h-full flex flex-col">
      <CardHeader class="flex-none">
        <CardTitle>{t("codeWiki.tab.map")}</CardTitle>
      </CardHeader>
      <CardContent class="flex-1 min-h-0 p-0">
        <svg id="code-map-svg" width="100%" height="100%" viewBox={`0 0 ${width()} ${height()}`}>
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
                  stroke="#94a3b8"
                  stroke-width={1.5}
                  stroke-opacity={0.6}
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
                  fill={colorForKind(node.kind)}
                  stroke={selectedId() === node.id ? "#fff" : "transparent"}
                  stroke-width={2}
                />
                <text
                  x={node.x}
                  y={node.y + node.r + 12}
                  text-anchor="middle"
                  font-size="10"
                  fill="currentColor"
                >
                  {node.label}
                </text>
              </g>
            )}
          </For>
        </svg>
      </CardContent>
    </Card>
  );
}
