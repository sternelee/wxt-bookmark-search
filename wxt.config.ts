import { defineConfig } from "wxt";

export default defineConfig({
  modules: ["@wxt-dev/module-solid"],
  manifest: {
    name: "Flow Search",
    permissions: ["storage", "tabs", "bookmarks", "cookies", "history", "alarms"],
    host_permissions: [
      "https://r.jina.ai/*",
      "https://x.com/*",
      "https://twitter.com/*",
      "https://api.x.com/*"
    ],
    omnibox: { keyword: "bi" },
    trial_tokens: process.env.CHROME_AI_TRIAL_TOKEN
      ? [{ token: process.env.CHROME_AI_TRIAL_TOKEN }]
      : undefined,
  },
});
