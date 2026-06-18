import { defineConfig } from "wxt";

export default defineConfig({
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
    omnibox: { keyword: "bi" },
    trial_tokens: process.env.CHROME_AI_TRIAL_TOKEN
      ? [{ token: process.env.CHROME_AI_TRIAL_TOKEN }]
      : undefined,
  },
});
