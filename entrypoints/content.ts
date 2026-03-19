// content.ts is intentionally left minimal.
// The omnibox bookmark search is handled entirely in background.ts.
// This content script can be expanded later for per-page features.
export default defineContentScript({
  matches: ["*://*/*"],
  main() {
    // No-op: per-page logic will be added in a future iteration.
  },
});
