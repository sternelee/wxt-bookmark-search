/**
 * Code Graph — in-memory adjacency graph from symbols + edges
 */
import type { CodeSymbol, CodeEdge, CodeGraph } from "../types";

/** Build graph from symbols and edges */
export function buildGraph(
  repoUrl: string,
  branch: string,
  symbols: CodeSymbol[],
  edges: CodeEdge[],
): CodeGraph {
  const files = [...new Set(symbols.map((s) => s.filePath))].sort();
  return { repoUrl, branch, symbols, edges, files };
}

/** Get direct neighbors of a symbol (outgoing edges) */
export function getSymbolNeighbors(
  graph: CodeGraph,
  symbolId: string,
  kind?: string,
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const e of graph.edges) {
    if (e.from !== symbolId) continue;
    if (kind && e.kind !== kind) continue;
    if (!seen.has(e.to)) {
      seen.add(e.to);
      out.push(e.to);
    }
  }
  return out;
}

/** Get symbols that reference this symbol (incoming edges) */
export function getReferencingSymbols(
  graph: CodeGraph,
  symbolId: string,
  kind?: string,
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const e of graph.edges) {
    if (e.to !== symbolId) continue;
    if (kind && e.kind !== kind) continue;
    if (!seen.has(e.from)) {
      seen.add(e.from);
      out.push(e.from);
    }
  }
  return out;
}

/** Get call graph (transitive calls) up to depth limit */
export function getCallGraph(
  graph: CodeGraph,
  symbolId: string,
  maxDepth = 3,
): string[] {
  const visited = new Set<string>();
  const queue: { id: string; depth: number }[] = [{ id: symbolId, depth: 0 }];

  while (queue.length > 0) {
    const { id, depth } = queue.shift()!;
    if (visited.has(id)) continue;
    visited.add(id);
    if (depth >= maxDepth) continue;

    for (const e of graph.edges) {
      if (e.from === id && e.kind === "calls" && !visited.has(e.to)) {
        queue.push({ id: e.to, depth: depth + 1 });
      }
    }
  }

  visited.delete(symbolId);
  return [...visited];
}

/** Get inheritance chain (extends + implements) */
export function getInheritanceChain(
  graph: CodeGraph,
  symbolId: string,
): { extends: string[]; implements: string[] } {
  return {
    extends: getSymbolNeighbors(graph, symbolId, "extends"),
    implements: getSymbolNeighbors(graph, symbolId, "implements"),
  };
}

/** Get all symbols in a file */
export function getFileSymbols(
  graph: CodeGraph,
  filePath: string,
): CodeSymbol[] {
  return graph.symbols.filter((s) => s.filePath === filePath);
}

/** Get import edges originating from a file */
export function getFileImports(
  graph: CodeGraph,
  filePath: string,
): CodeEdge[] {
  const prefix = `${filePath}#`;
  return graph.edges.filter(
    (e) => e.kind === "imports" && e.from.startsWith(prefix),
  );
}

/** Find a symbol by id */
export function findSymbol(graph: CodeGraph, symbolId: string): CodeSymbol | undefined {
  return graph.symbols.find((s) => s.id === symbolId);
}
