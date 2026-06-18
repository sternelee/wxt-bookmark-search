/**
 * Code-aware chunking — 函数/类/文件级代码切分
 */
import type { CodeChunk, CodeSymbol, CodeChunkKind } from "../types";

/** 从文件路径推断语言 */
function inferLanguage(filePath: string): string {
  const ext = filePath.split(".").pop()?.toLowerCase();
  const map: Record<string, string> = {
    ts: "typescript",
    tsx: "typescript",
    js: "javascript",
    jsx: "javascript",
    mjs: "javascript",
    cjs: "javascript",
    py: "python",
    rs: "rust",
    go: "go",
    java: "java",
    kt: "kotlin",
    rb: "ruby",
    php: "php",
    cpp: "cpp",
    c: "c",
    h: "c",
    hpp: "cpp",
    cs: "csharp",
    swift: "swift",
    scala: "scala",
    sh: "bash",
    zsh: "bash",
    bash: "bash",
    yaml: "yaml",
    yml: "yaml",
    json: "json",
    md: "markdown",
    html: "html",
    css: "css",
    scss: "scss",
    less: "less",
    sql: "sql",
    vue: "vue",
    svelte: "svelte",
  };
  return map[ext || ""] || "text";
}

/** 取代码前 N 行 */
function takeLines(content: string, maxLines: number): string {
  const lines = content.split("\n");
  return lines.slice(0, maxLines).join("\n");
}

/** 提取 import / require 块 */
function extractImportBlock(content: string): string {
  const lines = content.split("\n");
  const imports: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (
      trimmed.startsWith("import ") ||
      trimmed.startsWith("require(") ||
      trimmed.startsWith("from ") ||
      (trimmed.startsWith("const ") && trimmed.includes("require(")) ||
      trimmed.startsWith("using ") ||
      trimmed.startsWith("#include ") ||
      trimmed.startsWith("use ") ||
      trimmed.startsWith("extern ") ||
      trimmed.startsWith("module ") ||
      trimmed.startsWith("package ")
    ) {
      imports.push(line);
    }
  }
  return imports.join("\n");
}

/** 提取导出列表（粗略） */
function extractExportList(content: string): string[] {
  const exports: string[] = [];
  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (
      line.startsWith("export ") ||
      line.startsWith("module.exports") ||
      line.startsWith("exports.") ||
      /^\s*pub\s+(fn|struct|enum|trait|type|use|mod|const|static)/.test(line)
    ) {
      exports.push(line);
    }
  }
  return exports;
}

/** 生成 chunk ID */
function chunkId(filePath: string, symbolName: string, kind: string): string {
  return `${filePath}#${symbolName}#${kind}`;
}

/**
 * 切分单个文件为代码块
 *
 * @param filePath - 文件路径（相对仓库根目录）
 * @param content - 文件完整内容
 * @param symbols - AST 解析出的符号列表（可选，用于精确切分）
 * @param repoUrl - 仓库 URL
 * @param branch - 分支名
 * @returns CodeChunk[]
 */
export function chunkFile(
  filePath: string,
  content: string,
  symbols: CodeSymbol[] = [],
  repoUrl: string = "",
  branch: string = "",
): CodeChunk[] {
  const language = inferLanguage(filePath);
  const chunks: CodeChunk[] = [];

  // 1. 函数级 chunk（有符号信息时优先）
  const funcSymbols = symbols.filter((s) => s.kind === "function");
  for (const sym of funcSymbols) {
    const lines = content.split("\n");
    const bodyLines = lines.slice(sym.lineStart - 1, sym.lineEnd);
    const signature = sym.signature || bodyLines[0] || "";
    const jsdoc = sym.jsdoc || "";
    const bodyPreview = takeLines(bodyLines.slice(1).join("\n"), 20);
    const chunkContent = [jsdoc, signature, bodyPreview].filter(Boolean).join("\n");
    chunks.push({
      id: chunkId(filePath, sym.name, "function"),
      content: chunkContent,
      language,
      filePath,
      symbolName: sym.name,
      kind: "function",
      lineStart: sym.lineStart,
      lineEnd: sym.lineEnd,
      repoUrl,
      branch,
    });
  }

  // 2. 类级 chunk
  const classSymbols = symbols.filter((s) => s.kind === "class");
  for (const sym of classSymbols) {
    const lines = content.split("\n");
    const bodyLines = lines.slice(sym.lineStart - 1, sym.lineEnd);
    const signature = sym.signature || bodyLines[0] || "";
    const jsdoc = sym.jsdoc || "";
    // 提取公共方法签名（粗略：以 public / 无修饰符的函数定义行）
    const publicMethods = bodyLines
      .filter(
        (l) =>
          /^\s*(public\s+)?(async\s+)?[a-zA-Z_$][\w$]*\s*\(/.test(l) ||
          /^\s*[a-zA-Z_$][\w$]*\s*\(/.test(l),
      )
      .map((l) => l.trim());
    const chunkContent = [jsdoc, signature, ...publicMethods].filter(Boolean).join("\n");
    chunks.push({
      id: chunkId(filePath, sym.name, "class"),
      content: chunkContent,
      language,
      filePath,
      symbolName: sym.name,
      kind: "class",
      lineStart: sym.lineStart,
      lineEnd: sym.lineEnd,
      repoUrl,
      branch,
    });
  }

  // 3. 接口/类型级 chunk
  const typeSymbols = symbols.filter(
    (s) => s.kind === "interface" || s.kind === "type",
  );
  for (const sym of typeSymbols) {
    const lines = content.split("\n");
    const bodyLines = lines.slice(sym.lineStart - 1, sym.lineEnd);
    const signature = sym.signature || bodyLines[0] || "";
    const jsdoc = sym.jsdoc || "";
    const chunkContent = [jsdoc, signature, ...bodyLines.slice(1)]
      .filter(Boolean)
      .join("\n");
    chunks.push({
      id: chunkId(filePath, sym.name, sym.kind),
      content: chunkContent,
      language,
      filePath,
      symbolName: sym.name,
      kind: sym.kind,
      lineStart: sym.lineStart,
      lineEnd: sym.lineEnd,
      repoUrl,
      branch,
    });
  }

  // 4. 文件级 chunk（import + export 列表，作为兜底）
  const importBlock = extractImportBlock(content);
  const exports = extractExportList(content);
  const fileChunkContent = [
    importBlock,
    exports.length > 0 ? "// Exports:" : "",
    ...exports,
  ]
    .filter(Boolean)
    .join("\n");
  if (fileChunkContent.trim().length > 0) {
    const totalLines = content.split("\n").length;
    chunks.push({
      id: chunkId(filePath, "__file__", "file"),
      content: fileChunkContent,
      language,
      filePath,
      symbolName: "__file__",
      // 文件级 chunk 使用 CodeChunkKind 中的 "file" 变体
      kind: "file" as CodeChunkKind,
      lineStart: 1,
      lineEnd: totalLines,
      repoUrl,
      branch,
    });
  }

  return chunks;
}

/**
 * 批量切分多个文件
 *
 * @param files - { path, content, symbols }[]
 * @param repoUrl - 仓库 URL
 * @param branch - 分支名
 * @returns 所有文件的 CodeChunk 扁平列表
 */
export async function chunkFiles(
  files: { path: string; content: string; symbols?: CodeSymbol[] }[],
  repoUrl: string = "",
  branch: string = "",
): Promise<CodeChunk[]> {
  const all: CodeChunk[] = [];
  const YIELD_EVERY = 25;
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    all.push(...chunkFile(f.path, f.content, f.symbols || [], repoUrl, branch));
    if ((i + 1) % YIELD_EVERY === 0 && i + 1 < files.length) {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
  }
  return all;
}
