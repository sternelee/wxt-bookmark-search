import { defineConfig } from "wxt";
import { fileURLToPath } from "node:url";

// WASM 资产（package exports 未导出 .wasm）由构建钩子复制到 public/，
// 运行时通过 browser.runtime.getURL 加载：
// - @ternlight/mini: 本地 embedding 引擎
// - @xberg-io/html-to-markdown-wasm: 本地 HTML→Markdown 转换器（readerBackend = "wasm"）
import { copyFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";

const WASM_ASSETS: Array<{ source: string; fileName: string }> = [
  {
    source: fileURLToPath(
      new URL(
        "./node_modules/@ternlight/mini/pkg-web/tern_engine_bg.wasm",
        import.meta.url,
      ),
    ),
    fileName: "tern_engine_bg.wasm",
  },
  {
    source: fileURLToPath(
      new URL(
        "./node_modules/@xberg-io/html-to-markdown-wasm/pkg/web/html_to_markdown_wasm_bg.wasm",
        import.meta.url,
      ),
    ),
    fileName: "html_to_markdown_wasm_bg.wasm",
  },
];

export default defineConfig({
  hooks: {
    "build:before": () => {
      for (const asset of WASM_ASSETS) {
        if (!existsSync(asset.source)) {
          throw new Error(
            `[wxt] missing wasm asset: ${asset.source} — check the package layout / version of the dependency that provides ${asset.fileName}`,
          );
        }
        const dest = join(process.cwd(), "public", asset.fileName);
        mkdirSync(dirname(dest), { recursive: true });
        copyFileSync(asset.source, dest);
      }
    },
  },
  // 阻止 Vite 把 .wasm 内联成 base64 塞进 background.js：
  // @xberg-io/html-to-markdown-wasm 与 @ternlight/mini 都用
  // `new URL('*.wasm', import.meta.url)` 定位 wasm，Vite 的
  // vite:asset-import-meta-url 插件会把它当资源字面量烘进产物：
  // - 给 new URL 打上 /* @vite-ignore */（该插件显式跳过这种写法）
  // - assetsInlineLimit: 0 作为第二道防护（小资源也不再转 base64）
  // 否则两份 wasm 合计 ~16MB base64 会让 background.js 膨胀到 20MB，
  // 而运行时真正加载的是 public/ 下经 browser.runtime.getURL 取到的那份。
  vite: () => ({
    build: { assetsInlineLimit: 0 },
    plugins: [
      {
        name: "wxt:disable-wasm-import-meta-url",
        enforce: "pre",
        transform: {
          filter: { code: /new\s+URL\(\s*["'`][^"'`]*\.wasm["'`]/ },
          handler(code) {
            return code.replace(
              /new\s+URL\(\s*(?=['"`][^'"`]*\.wasm)/g,
              "new URL(/* @vite-ignore */ ",
            );
          },
        },
      },
    ],
  }),
  modules: ["@wxt-dev/module-solid"],
  manifest: {
    name: "Flow Search",
    permissions: [
      "storage",
      "tabs",
      "bookmarks",
      "cookies",
      "history",
      "alarms",
      // Daily digest completion notification
      "notifications",
      // Code Wiki: spawn offscreen document to host the parser Web Worker
      // (Chrome MV3 only — Firefox falls back to in-SW cooperative yielding).
      "offscreen",
    ],
    host_permissions: [
      "https://r.jina.ai/*",
      "https://markdown.new/*",
      // 自建 Cloudflare Markdown 服务（workers/markdown-reader）
      "https://markdown-reader.leeapp.dev/*",
      "https://x.com/*",
      "https://twitter.com/*",
      "https://api.x.com/*",
      "https://www.googleapis.com/*",
      "https://content.googleapis.com/*",
      "https://api.dropboxapi.com/*",
      "https://content.dropboxapi.com/*",
      "https://api.github.com/*",
      // TypeSafe Jev 评估 API（无 CORS 头，必须走 host permission）
      "https://api.typesafe.ai/*",
    ],
    // 本地 embedding (@ternlight/mini) 需要 WASM 实例化：
    // MV3 默认 CSP (script-src 'self') 禁止 wasm-eval，需显式放开。
    content_security_policy: {
      extension_pages: "script-src 'self' 'wasm-unsafe-eval'; object-src 'self';",
    },
    omnibox: { keyword: "bi" },
    trial_tokens: process.env.CHROME_AI_TRIAL_TOKEN
      ? [{ token: process.env.CHROME_AI_TRIAL_TOKEN }]
      : undefined,
  },
});
