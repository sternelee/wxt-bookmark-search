/**
 * Strip dangerous HTML: scripts, events, javascript: URLs.
 * Allows safe text/structure tags + http/https links only.
 */
export function sanitizeHtml(html: string): string {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, "text/html");

  doc.querySelectorAll("script, style, iframe, object, embed, form").forEach(
    (el) => el.remove()
  );

  const allElements = doc.querySelectorAll("*");
  allElements.forEach((el) => {
    const attrs = Array.from(el.attributes);
    attrs.forEach((attr) => {
      const name = attr.name.toLowerCase();
      if (
        name.startsWith("on") ||
        name === "style" ||
        (name === "href" &&
          !attr.value.match(/^https?:\/\//)) ||
        (name === "src" &&
          !attr.value.match(/^https?:\/\//))
      ) {
        el.removeAttribute(name);
      }
    });
  });

  return doc.body.innerHTML;
}

/**
 * Parse GitHub LLM summary HTML for structured card data.
 * The LLM is instructed to embed: data-language, data-stars, data-readme-url.
 */
export function parseGitHubHtml(html: string): {
  language?: string;
  stars?: string;
  description?: string;
  readmeUrl?: string;
  rawHtml: string;
} {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, "text/html");
  const root = doc.querySelector("[data-language]") || doc.body;

  const language = root.getAttribute("data-language") || undefined;
  const stars = root.getAttribute("data-stars") || undefined;
  const readmeUrl = root.getAttribute("data-readme-url") || undefined;

  const p = root.querySelector("p");
  const description = p?.textContent?.trim() || root.textContent?.trim().slice(0, 200) || "";

  return {
    language,
    stars,
    description,
    readmeUrl,
    rawHtml: root.innerHTML,
  };
}