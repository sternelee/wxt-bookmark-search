import { defineConfig } from "wxt";

export default defineConfig({
  modules: ["@wxt-dev/module-solid"],
  manifest: {
    name: "Flow Search",
    permissions: ["storage", "tabs", "bookmarks"],
    host_permissions: ["https://r.jina.ai/*"],
    omnibox: { keyword: "bi" },
  },
});
