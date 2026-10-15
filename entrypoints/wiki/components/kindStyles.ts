import type { I18nKey } from "../../../src/i18n";

/** 符号种类 → Badge 样式（outline 变体 + 语义配色，明暗两套都可用） */
export const KIND_BADGE_CLASS: Record<string, string> = {
  function: "border-primary/40 bg-primary/10 text-primary",
  class: "border-violet-500/40 bg-violet-500/10 text-violet-700 dark:text-violet-300",
  interface: "border-success/40 bg-success/10 text-success",
  type: "border-warning/40 bg-warning/10 text-warning",
  variable: "border-border bg-muted text-muted-foreground",
  export: "border-error/40 bg-error/10 text-error",
  import: "border-indigo-500/40 bg-indigo-500/10 text-indigo-700 dark:text-indigo-300",
  file: "border-border bg-secondary text-secondary-foreground",
};

/** 符号种类 → SVG 节点填充色（中等明度，明暗背景下都可读） */
export const KIND_NODE_COLOR: Record<string, string> = {
  function: "#3b82f6",
  class: "#a855f7",
  interface: "#22c55e",
  type: "#f59e0b",
  variable: "#6b7280",
  export: "#ef4444",
  import: "#8b5cf6",
  file: "#64748b",
};

export const KIND_LABEL_KEY: Record<string, I18nKey> = {
  function: "codeWiki.kind.function",
  class: "codeWiki.kind.class",
  interface: "codeWiki.kind.interface",
  type: "codeWiki.kind.type",
  variable: "codeWiki.kind.variable",
  export: "codeWiki.kind.export",
  import: "codeWiki.kind.import",
  file: "codeWiki.kind.file",
};

export function kindBadgeClass(kind: string): string {
  return KIND_BADGE_CLASS[kind] ?? KIND_BADGE_CLASS.variable;
}

export function kindNodeColor(kind: string): string {
  return KIND_NODE_COLOR[kind] ?? KIND_NODE_COLOR.variable;
}
