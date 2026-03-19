import { defineConfig } from "wxt";

export default defineConfig({
  modules: ["@wxt-dev/module-solid"],
  manifest: {
    permissions: ["storage", "tabs", "bookmarks"],
    omnibox: { keyword: "bi" },
  },
});
