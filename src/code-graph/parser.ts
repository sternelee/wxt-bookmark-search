/**
 * AST-based code parser — TypeScript Compiler API
 * Uses `typescript` package's createSourceFile + Node visitor to extract
 * functions, classes, interfaces, type aliases, variables, exports, imports.
 * Falls back to regex-based scanning inside stripped source for call edges.
 */
import ts from "typescript";
import type { CodeSymbol, CodeEdge } from "../types";

/** Language detection by extension (best-effort, ts.createSourceFile also infers) */
function detectLanguage(filePath: string): string {
  const ext = filePath.split(".").pop() || "";
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
  };
  return map[ext] || "text";
}

/** Build symbol id */
function symbolId(filePath: string, name: string): string {
  return `${filePath}#${name}`;
}

/** Build edge id */
function edgeId(from: string, to: string, kind: string): string {
  return `${from}--${kind}--${to}`;
}

/**
 * Extract JSDoc comment immediately preceding a node, including multi-line `/** ... *\/`.
 * Returns empty string if no JSDoc found.
 */
function extractJSDoc(sourceFile: ts.SourceFile, node: ts.Node): string {
  const jsDocTags = (node as any).jsDoc as ts.JSDoc[] | undefined;
  if (jsDocTags && jsDocTags.length > 0) {
    return jsDocTags
      .map((tag) => tag.getText(sourceFile))
      .join("\n")
      .replace(/^\s*\*\s?/gm, "")
      .trim();
  }
  return "";
}

/** Return printable signature text for a node (first source line + opening). */
function nodeSignature(sourceFile: ts.SourceFile, node: ts.Node): string {
  const text = node.getText(sourceFile);
  const firstLineEnd = text.indexOf("\n");
  return firstLineEnd === -1 ? text.trim() : text.slice(0, firstLineEnd).trim();
}

/**
 * Parse a single TypeScript/JavaScript file into symbols and edges using the
 * TypeScript Compiler API. Returns symbols/edges with lineStart/lineEnd,
 * signature, jsdoc, and inter-symbol edges (calls / extends / implements / imports).
 */
export function parseFile(
  filePath: string,
  content: string,
  repoUrl: string,
  branch: string,
): { symbols: CodeSymbol[]; edges: CodeEdge[] } {
  const ext = filePath.split(".").pop() || "";
  const isTsx = ext === "tsx" || ext === "jsx";
  const scriptKind =
    ext === "ts" || ext === "tsx"
      ? ts.ScriptKind.TSX
      : ext === "js" || ext === "jsx" || ext === "mjs" || ext === "cjs"
        ? ts.ScriptKind.JS
        : ts.ScriptKind.TS;

  const sourceFile = ts.createSourceFile(
    filePath,
    content,
    ts.ScriptTarget.Latest,
    /* setParentNodes */ true,
    scriptKind,
  );

  const symbols: CodeSymbol[] = [];
  const edges: CodeEdge[] = [];
  const symbolByName = new Map<string, CodeSymbol>();

  const lang = detectLanguage(filePath);
  void lang;

  const pushSymbol = (s: CodeSymbol) => {
    symbols.push(s);
    symbolByName.set(s.name, s);
  };

  /** Recursively walk TS AST and extract declarations. */
  const visit = (node: ts.Node) => {
    // Top-level & nested function declarations
    if (ts.isFunctionDeclaration(node) && node.name) {
      const name = node.name.text;
      const id = symbolId(filePath, name);
      const start = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
      const end = sourceFile.getLineAndCharacterOfPosition(node.getEnd());
      pushSymbol({
        id,
        name,
        kind: "function",
        filePath,
        lineStart: start.line + 1,
        lineEnd: end.line + 1,
        signature: nodeSignature(sourceFile, node),
        jsdoc: extractJSDoc(sourceFile, node),
        repoUrl,
        branch,
      });
    }

    // Variable statement: const fn = (...) => {} | const x = value
    if (ts.isVariableStatement(node)) {
      for (const decl of node.declarationList.declarations) {
        if (ts.isIdentifier(decl.name)) {
          const name = decl.name.text;
          const id = symbolId(filePath, name);
          const start = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
          const end = sourceFile.getLineAndCharacterOfPosition(node.getEnd());
          const initializer = decl.initializer;
          const isArrow = initializer && ts.isArrowFunction(initializer);
          pushSymbol({
            id,
            name,
            kind: isArrow ? "function" : "variable",
            filePath,
            lineStart: start.line + 1,
            lineEnd: end.line + 1,
            signature: nodeSignature(sourceFile, node),
            jsdoc: extractJSDoc(sourceFile, node),
            repoUrl,
            branch,
          });
        }
      }
    }

    // Class declaration
    if (ts.isClassDeclaration(node) && node.name) {
      const name = node.name.text;
      const id = symbolId(filePath, name);
      const start = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
      const end = sourceFile.getLineAndCharacterOfPosition(node.getEnd());
      pushSymbol({
        id,
        name,
        kind: "class",
        filePath,
        lineStart: start.line + 1,
        lineEnd: end.line + 1,
        signature: nodeSignature(sourceFile, node),
        jsdoc: extractJSDoc(sourceFile, node),
        repoUrl,
        branch,
      });

      // extends / implements edges
      const heritage = node.heritageClauses ?? [];
      for (const clause of heritage) {
        for (const expr of clause.types) {
          const target = expr.expression.getText(sourceFile);
          const targetId = symbolId(filePath, target);
          const kind = clause.token === ts.SyntaxKind.ExtendsKeyword ? "extends" : "implements";
          edges.push({
            id: edgeId(id, targetId, kind),
            from: id,
            to: targetId,
            kind,
            repoUrl,
          });
        }
      }
    }

    // Interface declaration
    if (ts.isInterfaceDeclaration(node)) {
      const name = node.name.text;
      const id = symbolId(filePath, name);
      const start = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
      const end = sourceFile.getLineAndCharacterOfPosition(node.getEnd());
      pushSymbol({
        id,
        name,
        kind: "interface",
        filePath,
        lineStart: start.line + 1,
        lineEnd: end.line + 1,
        signature: nodeSignature(sourceFile, node),
        jsdoc: extractJSDoc(sourceFile, node),
        repoUrl,
        branch,
      });

      // extends edges for interfaces
      for (const clause of node.heritageClauses ?? []) {
        for (const expr of clause.types) {
          const target = expr.expression.getText(sourceFile);
          edges.push({
            id: edgeId(id, symbolId(filePath, target), "extends"),
            from: id,
            to: symbolId(filePath, target),
            kind: "extends",
            repoUrl,
          });
        }
      }
    }

    // Type alias declaration
    if (ts.isTypeAliasDeclaration(node)) {
      const name = node.name.text;
      const id = symbolId(filePath, name);
      const start = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
      const end = sourceFile.getLineAndCharacterOfPosition(node.getEnd());
      pushSymbol({
        id,
        name,
        kind: "type",
        filePath,
        lineStart: start.line + 1,
        lineEnd: end.line + 1,
        signature: nodeSignature(sourceFile, node),
        jsdoc: extractJSDoc(sourceFile, node),
        repoUrl,
        branch,
      });
    }

    // Enum declaration
    if (ts.isEnumDeclaration(node)) {
      const name = node.name.text;
      const id = symbolId(filePath, name);
      const start = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
      const end = sourceFile.getLineAndCharacterOfPosition(node.getEnd());
      pushSymbol({
        id,
        name,
        kind: "type",
        filePath,
        lineStart: start.line + 1,
        lineEnd: end.line + 1,
        signature: nodeSignature(sourceFile, node),
        jsdoc: extractJSDoc(sourceFile, node),
        repoUrl,
        branch,
      });
    }

    // Export assignment: export = ...
    if (ts.isExportAssignment(node)) {
      const text = node.getText(sourceFile);
      const start = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
      const end = sourceFile.getLineAndCharacterOfPosition(node.getEnd());
      pushSymbol({
        id: symbolId(filePath, "__export__"),
        name: "__export__",
        kind: "export",
        filePath,
        lineStart: start.line + 1,
        lineEnd: end.line + 1,
        signature: text.slice(0, 80),
        jsdoc: "",
        repoUrl,
        branch,
      });
    }

    // Imports
    if (ts.isImportDeclaration(node)) {
      const moduleSpec = node.moduleSpecifier.getText(sourceFile).replace(/['"]/g, "");
      const named = node.importClause?.namedBindings;
      if (named && ts.isNamedImports(named)) {
        for (const element of named.elements) {
          const name = (element.propertyName ?? element.name).text;
          const localId = symbolId(filePath, name);
          // The import always points to a foreign module; we model as references edge
          // to a synthetic module symbol if present locally.
          const localSymbol = symbolByName.get(name);
          if (localSymbol) {
            edges.push({
              id: edgeId(localId, localSymbol.id, "imports"),
              from: localId,
              to: localSymbol.id,
              kind: "imports",
              repoUrl,
            });
          } else {
            // Record the import as a virtual symbol node for completeness
            const start = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
            const end = sourceFile.getLineAndCharacterOfPosition(node.getEnd());
            pushSymbol({
              id: localId,
              name,
              kind: "import",
              filePath,
              lineStart: start.line + 1,
              lineEnd: end.line + 1,
              signature: `import { ${name} } from "${moduleSpec}"`,
              jsdoc: "",
              repoUrl,
              branch,
            });
          }
        }
      } else if (named && ts.isNamespaceImport(named)) {
        const localName = named.name.text;
        const start = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
        const end = sourceFile.getLineAndCharacterOfPosition(node.getEnd());
        pushSymbol({
          id: symbolId(filePath, localName),
          name: localName,
          kind: "import",
          filePath,
          lineStart: start.line + 1,
          lineEnd: end.line + 1,
          signature: `import * as ${localName} from "${moduleSpec}"`,
          jsdoc: "",
          repoUrl,
          branch,
        });
      } else {
        // Default import
        const defaultName = node.importClause?.name?.text;
        if (defaultName) {
          const start = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
          const end = sourceFile.getLineAndCharacterOfPosition(node.getEnd());
          pushSymbol({
            id: symbolId(filePath, defaultName),
            name: defaultName,
            kind: "import",
            filePath,
            lineStart: start.line + 1,
            lineEnd: end.line + 1,
            signature: `import ${defaultName} from "${moduleSpec}"`,
            jsdoc: "",
            repoUrl,
            branch,
          });
        }
      }
    }

    // Export declarations: export { foo, bar }
    if (ts.isExportDeclaration(node) && node.exportClause && ts.isNamedExports(node.exportClause)) {
      for (const element of node.exportClause.elements) {
        const name = (element.propertyName ?? element.name).text;
        const localSymbol = symbolByName.get(name);
        if (localSymbol) {
          edges.push({
            id: edgeId(symbolId(filePath, name), localSymbol.id, "exports"),
            from: symbolId(filePath, name),
            to: localSymbol.id,
            kind: "exports",
            repoUrl,
          });
        }
      }
    }

    // Recurse
    ts.forEachChild(node, visit);
  };

  visit(sourceFile);

  // Build call edges via identifier name resolution within symbol bodies.
  // We walk the AST and collect CallExpression nodes whose callee identifier
  // matches a known local symbol name. This avoids false positives from
  // string literals and comments (TS parser never emits identifiers from those).
  const symbolsByNameArr = symbols.filter(
    (s) => s.kind === "function" || s.kind === "class",
  );
  const nameSet = new Set(symbolsByNameArr.map((s) => s.name));

  const collectCalls = (node: ts.Node, currentSymbol?: CodeSymbol) => {
    if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
      const expr = node.expression;
      let calledName: string | undefined;
      if (ts.isIdentifier(expr)) {
        calledName = expr.text;
      }
      // For NewExpression, the callee is the constructor identifier
      if (calledName && nameSet.has(calledName) && currentSymbol) {
        const target = symbolByName.get(calledName);
        if (target && target.id !== currentSymbol.id) {
          // Dedupe: don't push duplicate edge
          const edgeKey = `${currentSymbol.id}->${target.id}`;
          if (!seenCallEdges.has(edgeKey)) {
            seenCallEdges.add(edgeKey);
            edges.push({
              id: edgeId(currentSymbol.id, target.id, "calls"),
              from: currentSymbol.id,
              to: target.id,
              kind: "calls",
              repoUrl,
            });
          }
        }
      }
    }
    ts.forEachChild(node, (child) => collectCalls(child, currentSymbol));
  };

  const seenCallEdges = new Set<string>();

  // Re-walk, tracking enclosing symbol via a parallel tree walk
  const walkWithContext = (node: ts.Node, enclosing?: CodeSymbol) => {
    let next = enclosing;
    if (ts.isFunctionDeclaration(node) && node.name) {
      next = symbolByName.get(node.name.text);
    } else if (ts.isClassDeclaration(node) && node.name) {
      next = symbolByName.get(node.name.text);
    } else if (ts.isVariableStatement(node)) {
      for (const decl of node.declarationList.declarations) {
        if (ts.isIdentifier(decl.name) && decl.initializer && ts.isArrowFunction(decl.initializer)) {
          next = symbolByName.get(decl.name.text);
        }
      }
    }
    if (next) {
      // For a function declaration, scan its body for calls; don't recurse
      // into nested class/function bodies (avoids duplicates).
      if (ts.isFunctionDeclaration(node) && node.body && ts.isBlock(node.body)) {
        collectCalls(node.body, next);
        return;
      }
      // For a class declaration, scan its body (method bodies) for calls.
      if (ts.isClassDeclaration(node)) {
        collectCalls(node, next);
        return;
      }
    }
    ts.forEachChild(node, (child) => walkWithContext(child, next));
  };
  walkWithContext(sourceFile);

  void isTsx;

  return { symbols, edges };
}

/**
 * Parse multiple files into a combined symbol/edge set.
 * Yields to the event loop every YIELD_EVERY files so the SW can process
 * other messages (omnibox, fetchFromGitHub cancellation, etc.) without
 * being starved during long parse runs.
 */
const YIELD_EVERY = 25;
const yieldToEventLoop = (): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, 0));

export async function parseFiles(
  files: { path: string; content: string }[],
  repoUrl: string,
  branch: string,
): Promise<{ symbols: CodeSymbol[]; edges: CodeEdge[] }> {
  const allSymbols: CodeSymbol[] = [];
  const allEdges: CodeEdge[] = [];
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    try {
      const { symbols, edges } = parseFile(file.path, file.content, repoUrl, branch);
      allSymbols.push(...symbols);
      allEdges.push(...edges);
    } catch (e) {
      console.warn(
        `[parser] failed to parse ${file.path}:`,
        e instanceof Error ? e.message : String(e),
      );
    }
    if ((i + 1) % YIELD_EVERY === 0 && i + 1 < files.length) {
      await yieldToEventLoop();
    }
  }
  return { symbols: allSymbols, edges: allEdges };
}
