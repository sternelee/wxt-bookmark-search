import { defineConfig } from "wxt";

export default defineConfig({
  modules: ["@wxt-dev/module-solid"],
  manifest: {
    name: "Flow Search",
    permissions: ["storage", "tabs", "bookmarks", "cookies", "history"],
    host_permissions: [
      "https://r.jina.ai/*",
      "https://x.com/*",
      "https://twitter.com/*",
      "https://api.x.com/*"
    ],
    omnibox: { keyword: "bi" },
    // wasm-unsafe-eval 是 MV3 中允许 WebAssembly (EdgeVec HNSW) 的官方方式
    content_security_policy: {
      extension_pages: "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'",
    },
  },
});
