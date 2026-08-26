import { defineConfig } from "wxt";
import { fileURLToPath } from "node:url";

// @ternlight/mini 的 wasm 未在 package exports 中导出，构建时复制到 public/
// 运行时通过 chrome.runtime.getURL 加载
import { copyFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";

const TERN_WASM_SOURCE = fileURLToPath(
  new URL(
    "./node_modules/@ternlight/mini/pkg-web/tern_engine_bg.wasm",
    import.meta.url,
  ),
);
const TERN_WASM_PUBLIC = join(process.cwd(), "public", "tern_engine_bg.wasm");

export default defineConfig({
  hooks: {
    "build:before": () => {
      if (!existsSync(dirname(TERN_WASM_PUBLIC))) {
        mkdirSync(dirname(TERN_WASM_PUBLIC), { recursive: true });
      }
      copyFileSync(TERN_WASM_SOURCE, TERN_WASM_PUBLIC);
    },
  },
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
      // Code Wiki: spawn offscreen document to host the parser Web Worker
      // (Chrome MV3 only — Firefox falls back to in-SW cooperative yielding).
      "offscreen",
    ],
    host_permissions: [
      "https://r.jina.ai/*",
      "https://x.com/*",
      "https://twitter.com/*",
      "https://api.x.com/*",
      "https://www.googleapis.com/*",
      "https://content.googleapis.com/*",
      "https://api.dropboxapi.com/*",
      "https://content.dropboxapi.com/*",
      "https://api.github.com/*",
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
