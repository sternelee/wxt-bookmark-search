/**
 * 层级化 wiki 文档组装
 * 层级: Project Overview → Module docs → File docs → Symbol docs
 */
import { WIKI_DOC_ID, type CodeSymbol, type WikiDoc } from "../types";

/** 文件摘要（由 summarizer 提供） */
export interface FileSummary {
  filePath: string;
  purpose: string;
  keyFunctions: string[];
  dependencies: string[];
}

/** 顶层模块名（用于 module-level docs） */
const TOP_LEVEL_MODULES = ["src", "entrypoints", "tests", "docs", "scripts"] as const;

/** 从 filePath 提取顶层模块名 */
function getTopLevelModule(filePath: string): string {
  const normalized = filePath.replace(/^\.\//, "").replace(/^\//, "");
  const parts = normalized.split("/");
  return parts[0] || normalized;
}

/** 提取文件的目录路径 */
function getDirectoryPath(filePath: string): string {
  const idx = filePath.lastIndexOf("/");
  return idx === -1 ? "" : filePath.slice(0, idx);
}

/** 将 symbol docs 聚合为 file doc */
function buildFileDoc(
  repoUrl: string,
  filePath: string,
  symbolDocs: WikiDoc[],
  fileSummary: FileSummary | undefined,
): WikiDoc {
  const now = Date.now();
  const title = filePath.split("/").pop() || filePath;

  const content: string[] = [
    `# ${title}`,
    "",
    `**Path**: \`${filePath}\``,
    "",
  ];

  if (fileSummary) {
    content.push(`## Overview`, "");
    content.push(fileSummary.purpose);
    content.push("");

    if (fileSummary.keyFunctions.length) {
      content.push(`## Key Functions`, "");
      for (const fn of fileSummary.keyFunctions) {
        content.push(`- ${fn}`);
      }
      content.push("");
    }

    if (fileSummary.dependencies.length) {
      content.push(`## Dependencies`, "");
      for (const dep of fileSummary.dependencies) {
        content.push(`- \`${dep}\``);
      }
      content.push("");
    }
  }

  if (symbolDocs.length) {
    content.push(`## Symbols`, "");
    for (const symDoc of symbolDocs) {
      content.push(`### ${symDoc.title}`);
      content.push(symDoc.summary || symDoc.content.split("\n").slice(0, 3).join(" "));
      content.push("");
    }
  }

  const summary = fileSummary?.purpose
    || symbolDocs[0]?.summary
    || `Documentation for ${filePath}`;

  return {
    id: WIKI_DOC_ID.file(repoUrl, filePath),
    title: filePath,
    content: content.join("\n"),
    summary,
    symbols: symbolDocs.map((d) => d.id),
    repoUrl,
    updatedAt: now,
    kind: "file",
  };
}

/** 将 file docs 聚合为 module doc */
function buildModuleDoc(
  repoUrl: string,
  moduleName: string,
  fileDocs: WikiDoc[],
): WikiDoc {
  const now = Date.now();
  const allSymbols = fileDocs.flatMap((d) => d.symbols);

  const content: string[] = [
    `# ${moduleName}/`,
    "",
    `Module containing ${fileDocs.length} file(s).`,
    "",
    `## Files`, "",
  ];

  for (const fileDoc of fileDocs) {
    const fileName = fileDoc.title.split("/").pop() || fileDoc.title;
    content.push(`- [\`${fileName}\`](${fileDoc.id}) — ${fileDoc.summary.slice(0, 100)}`);
  }
  content.push("");

  // 聚合前 N 个最具代表性的 symbols
  const topSymbols = fileDocs
    .flatMap((d) => d.symbols)
    .slice(0, 20);
  if (topSymbols.length) {
    content.push(`## Notable Symbols`, "");
    for (const symId of topSymbols) {
      content.push(`- ${symId}`);
    }
    content.push("");
  }

  const summary = `Module ${moduleName} — ${fileDocs.length} file(s), ${allSymbols.length} symbol(s)`;

  return {
    id: WIKI_DOC_ID.module(repoUrl, moduleName),
    title: `${moduleName}/`,
    content: content.join("\n"),
    summary,
    symbols: allSymbols,
    repoUrl,
    updatedAt: now,
    kind: "module",
  };
}

/** 构建 Project Overview doc */
function buildOverviewDoc(
  repoUrl: string,
  moduleDocs: WikiDoc[],
  symbolDocs: WikiDoc[],
  fileDocs: WikiDoc[],
): WikiDoc {
  const now = Date.now();
  const allSymbols = symbolDocs.map((d) => d.id);

  const content: string[] = [
    `# Project Overview`,
    "",
    `Auto-generated documentation for \`${repoUrl}\`.`,
    "",
    `## Statistics`, "",
    `- Modules: ${moduleDocs.length}`,
    `- Files: ${fileDocs.length}`,
    `- Symbols: ${symbolDocs.length}`,
    "",
    `## Modules`, "",
  ];

  for (const mod of moduleDocs) {
    content.push(`- [\`${mod.title}\`](${mod.id}) — ${mod.summary}`);
  }
  content.push("");

  // 收集所有顶层模块的目录
  const topDirs = new Set<string>();
  for (const fileDoc of fileDocs) {
    topDirs.add(getDirectoryPath(fileDoc.id));
  }
  if (topDirs.size) {
    content.push(`## Directory Structure`, "", "```");
    const sortedDirs = Array.from(topDirs).sort();
    for (const dir of sortedDirs.slice(0, 30)) {
      content.push(dir);
    }
    if (sortedDirs.length > 30) {
      content.push(`... and ${sortedDirs.length - 30} more`);
    }
    content.push("```", "");
  }

  return {
    id: WIKI_DOC_ID.overview(repoUrl),
    title: "Project Overview",
    content: content.join("\n"),
    summary: `Overview of ${repoUrl} — ${moduleDocs.length} modules, ${fileDocs.length} files, ${symbolDocs.length} symbols`,
    symbols: allSymbols,
    repoUrl,
    updatedAt: now,
    kind: "overview",
  };
}

/**
 * 组装层级化 wiki 文档
 * 层级: Project Overview → Module docs → File docs → Symbol docs
 * @param symbols 解析得到的代码符号列表
 * @param symbolSummaries 可选的 per-symbol 摘要（来自 summarizer.summarizeSymbols）
 * @param repoUrl 仓库 URL
 * @returns WikiDoc 列表，按层级排序：overview → modules → files → symbols
 */
export function buildWikiDocs(
  symbols: CodeSymbol[],
  symbolSummaries: WikiDoc[] | undefined,
  repoUrl: string,
): WikiDoc[] {
  const now = Date.now();
  // 构造 id → summary 映射，用于丰富 symbol doc
  const summaryMap = new Map<string, WikiDoc>();
  if (symbolSummaries) {
    for (const sd of symbolSummaries) {
      summaryMap.set(sd.id, sd);
    }
  }

  // 1) Symbol docs（symbols 构造，若有 LLM 摘要则覆盖）
  const symbolDocs: WikiDoc[] = symbols.map((s) => {
    const llm = summaryMap.get(s.id);
    if (llm && llm.content) {
      // 优先使用 LLM 生成的文档
      return {
        ...llm,
        kind: "symbol" as const,
        updatedAt: now,
      };
    }
    const parts = [
      `## ${s.name}`,
      "",
      `**Kind**: ${s.kind}`,
      `**File**: \`${s.filePath}\` (lines ${s.lineStart}-${s.lineEnd})`,
      "",
    ];
    if (s.signature) {
      parts.push(`### Signature`, "```typescript", s.signature, "```", "");
    }
    if (s.jsdoc) {
      parts.push(`### Description`, s.jsdoc, "");
    }

    return {
      id: s.id,
      title: s.name,
      content: parts.join("\n"),
      summary: s.jsdoc
        ? s.jsdoc.split("\n")[0].slice(0, 200)
        : `${s.kind} in ${s.filePath}`,
      symbols: [s.id],
      repoUrl,
      updatedAt: now,
      kind: "symbol" as const,
    };
  });

  // 2) File docs（按 filePath 聚合）
  const symbolsByFile = new Map<string, CodeSymbol[]>();
  for (const s of symbols) {
    const arr = symbolsByFile.get(s.filePath) || [];
    arr.push(s);
    symbolsByFile.set(s.filePath, arr);
  }

  const fileDocs: WikiDoc[] = [];
  for (const [filePath, fileSymbols] of symbolsByFile) {
    const fileSymbolDocs = fileSymbols
      .map((s) => symbolDocs.find((d) => d.id === s.id))
      .filter((d): d is WikiDoc => Boolean(d));
    // 从符号集合合成文件摘要（无 LLM 时的 fallback）
    const syntheticSummary: FileSummary = {
      filePath,
      purpose: fileSymbolDocs
        .map((d) => d.summary)
        .filter(Boolean)
        .slice(0, 3)
        .join(" / ") || `Contains ${fileSymbols.length} symbol(s)`,
      keyFunctions: fileSymbols
        .filter((s) => s.kind === "function")
        .map((s) => s.name)
        .slice(0, 10),
      dependencies: Array.from(
        new Set(
          fileSymbols
            .map((s) => s.filePath.split("/").slice(0, -1).join("/"))
            .filter((p) => p && p !== filePath.split("/").slice(0, -1).join("/")),
        ),
      ).slice(0, 10),
    };
    fileDocs.push(
      buildFileDoc(repoUrl, filePath, fileSymbolDocs, syntheticSummary),
    );
  }

  // 3) Module docs（按顶层目录聚合）
  const filesByModule = new Map<string, WikiDoc[]>();
  for (const fileDoc of fileDocs) {
    // 提取 repoUrl 之前的原始 filePath 用于 module 聚合
    const prefix = `doc:file:${repoUrl}:`;
    const filePath = fileDoc.id.startsWith(prefix)
      ? fileDoc.id.slice(prefix.length)
      : fileDoc.title;
    const mod = getTopLevelModule(filePath);
    const arr = filesByModule.get(mod) || [];
    arr.push(fileDoc);
    filesByModule.set(mod, arr);
  }

  const moduleDocs: WikiDoc[] = [];
  for (const [moduleName, modFileDocs] of filesByModule) {
    moduleDocs.push(buildModuleDoc(repoUrl, moduleName, modFileDocs));
  }

  // 确保包含常见顶层模块（即使为空也保留引用）
  for (const knownMod of TOP_LEVEL_MODULES) {
    if (!filesByModule.has(knownMod)) {
      moduleDocs.push({
        id: WIKI_DOC_ID.module(repoUrl, knownMod),
        title: `${knownMod}/`,
        content: `# ${knownMod}/\n\nModule not present in this repository.`,
        summary: `Module ${knownMod} not found`,
        symbols: [],
        repoUrl,
        updatedAt: now,
        kind: "module",
      });
    }
  }

  // 4) Project Overview
  const overviewDoc = buildOverviewDoc(repoUrl, moduleDocs, symbolDocs, fileDocs);

  return [overviewDoc, ...moduleDocs, ...fileDocs, ...symbolDocs];
}
