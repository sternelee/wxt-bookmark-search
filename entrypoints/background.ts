import {
  loadFreqCache,
  incrementFreq,
  getRecentBookmarks,
  getFreqCache,
} from "../src/freq";
import { rerankBookmarks } from "../src/search";
import { highlightBookmark } from "../src/highlight";

export default defineBackground(() => {
  // Load frequency cache at startup
  loadFreqCache().then((cache) => {
    console.log(
      "[bi] Frequency cache loaded:",
      Object.keys(cache).length,
      "entries",
    );
  });

  // Empty query: show hint suggestion
  browser.omnibox.onInputStarted.addListener(() => {
    browser.omnibox.setDefaultSuggestion({
      description:
        "🔍 Search bookmarks: <match>bi</match> <dim>keyword...</dim>",
    });
  });

  // Every keystroke: Chrome search → TS re-rank → suggest
  browser.omnibox.onInputChanged.addListener(async (text, suggest) => {
    const query = text.trim();

    if (!query) {
      // Empty query: show most frequently visited bookmarks
      const recent = getRecentBookmarks(8);
      if (recent.length === 0) {
        suggest([
          {
            content: "about:blank",
            description:
              "<dim>No bookmark history yet — visit a bookmark to build frequency data.</dim>",
          },
        ]);
        return;
      }
      suggest(
        recent.map(({ url }) => ({
          content: url,
          description: highlightBookmark(url, "", url),
        })),
      );
      return;
    }

    const chromeResults = await browser.bookmarks.search(query);
    // Filter out folder nodes (null URL) — they can't be opened
    const valid = chromeResults.filter((b) => b.url !== null);
    const suggestions = rerankBookmarks(query, valid);
    suggest(suggestions);
  });

  // Enter: open the URL and record frequency
  browser.omnibox.onInputEntered.addListener(async (url, disposition) => {
    const active =
      disposition === "newForegroundTab" || disposition === "currentTab";

    await browser.tabs.create({ url, active });

    // Increment frequency counter (fire-and-forget)
    incrementFreq(url);
    console.log("[bi] Opened:", url);
  });
});
