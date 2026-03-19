/**
 * XML-safe escape for omnibox <match> / <dim> tags.
 */
export function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Extract the hostname from a URL for display.
 * Falls back to the full URL on parse failure.
 */
export function urlHost(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

/**
 * Wrap matching substrings of `query` inside `text` with <match></match> XML tags.
 * Matching is case-insensitive.
 */
function highlightMatches(text: string, query: string): string {
  if (!query) return escapeXml(text);
  const escaped = escapeXml(text);
  // Build a regex that matches the query as a whole (case-insensitive)
  const escapedQuery = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(`(${escapedQuery})`, "gi");
  return escaped.replace(regex, "<match>$1</match>");
}

/**
 * Build an omnibox description string for a single bookmark.
 *
 * Format: "<match>Title with keyword</match> 🌐 example.com"
 *
 * The <dim> tag is intentionally omitted — Chrome's omnibox does not render
 * <dim> reliably across all platforms; using just the hostname after a separator
 * keeps the description clean.
 */
export function highlightBookmark(
  title: string,
  query: string,
  url: string,
): string {
  const highlighted = highlightMatches(title, query);
  const host = urlHost(url);
  return `${highlighted} 🌐 ${host}`;
}
