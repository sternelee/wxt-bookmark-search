import { defineConfig } from "wxt";

export default defineConfig({
  modules: ["@wxt-dev/module-solid"],
  manifest: {
    name: "Flow Search",
    permissions: ["storage", "tabs", "bookmarks", "cookies"],
    host_permissions: [
      "https://r.jina.ai/*",
      "https://x.com/*",
      "https://twitter.com/*",
      "https://api.x.com/*"
    ],
    omnibox: { keyword: "bi" },
  },
});
