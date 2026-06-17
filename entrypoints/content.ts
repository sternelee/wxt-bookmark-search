import { Readability } from "@mozilla/readability";
import TurndownService from "turndown";

// === Serendipity: 偶遇式知识回忆 ===

interface SerendipityMatch {
  title: string;
  url: string;
  quickSummary: string;
  readAt: number;
  concepts: string[];
  relevance: number;
}

/** 英文停用词 */
const STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "but", "in", "on", "at", "to", "for",
  "of", "with", "by", "from", "is", "it", "this", "that", "are", "was",
  "be", "has", "had", "have", "do", "does", "did", "will", "would", "can",
  "could", "should", "may", "might", "shall", "not", "no", "all", "each",
  "every", "both", "few", "more", "most", "other", "some", "such", "than",
  "too", "very", "just", "about", "above", "after", "again", "also", "any",
  "because", "before", "below", "between", "both", "come", "day", "even",
  "first", "get", "give", "go", "here", "how", "if", "into", "know", "like",
  "look", "make", "many", "me", "much", "new", "now", "old", "only", "our",
  "out", "over", "own", "people", "say", "she", "he", "so", "still", "take",
  "tell", "their", "them", "then", "there", "these", "they", "thing", "think",
  "time", "two", "use", "us", "way", "well", "what", "when", "which", "who",
  "why", "work", "year", "you", "your",
]);

/** 提取页面关键概念（带停用词过滤） */
function extractPageKeywords(): string[] {
  const keywords = new Set<string>();

  const addWords = (text: string) => {
    text.split(/[\s\-_|,，、.:;!?()[\]{}""''`~@#$%^&*+=/\\]+/).forEach((w) => {
      const lower = w.toLowerCase();
      if (lower.length > 2 && !STOPWORDS.has(lower)) {
        keywords.add(lower);
      }
    });
  };

  if (document.title) addWords(document.title);

  const metaKeywords = document.querySelector('meta[name="keywords"]');
  if (metaKeywords) {
    const content = metaKeywords.getAttribute("content") || "";
    content.split(/[,，、]+/).forEach((w) => {
      const trimmed = w.trim().toLowerCase();
      if (trimmed.length > 1 && !STOPWORDS.has(trimmed)) keywords.add(trimmed);
    });
  }

  document.querySelectorAll("h1, h2, h3").forEach((el) => {
    if (el.textContent) addWords(el.textContent);
  });

  return [...keywords].slice(0, 15);
}

/** 创建 Serendipity 侧边栏 */
function createSerendipitySidebar(matches: SerendipityMatch[]): HTMLElement {
  // 移除已有侧边栏
  const existing = document.getElementById("flow-serendipity-sidebar");
  if (existing) existing.remove();

  const sidebar = document.createElement("div");
  sidebar.id = "flow-serendipity-sidebar";
  sidebar.style.cssText = `
    position: fixed;
    right: 0;
    top: 10%;
    width: 320px;
    max-height: 80vh;
    background: white;
    border-left: 1px solid #e5e7eb;
    box-shadow: -4px 0 20px rgba(0,0,0,0.1);
    z-index: 2147483647;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    overflow-y: auto;
    transition: transform 0.3s ease;
    border-radius: 12px 0 0 12px;
  `;

  const timeAgo = (ts: number): string => {
    const diff = Date.now() - ts;
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    if (days > 30) return `${Math.floor(days / 30)} months ago`;
    if (days > 0) return `${days} days ago`;
    const hours = Math.floor(diff / (1000 * 60 * 60));
    if (hours > 0) return `${hours} hours ago`;
    return "recently";
  };

  // Build DOM safely without innerHTML
  const content = document.createElement("div");
  content.style.padding = "16px";

  const header = document.createElement("div");
  header.style.cssText = "display:flex;justify-content:space-between;align-items:center;margin-bottom:12px";

  const title = document.createElement("h3");
  title.style.cssText = "margin:0;font-size:14px;font-weight:600;color:#111827";
  title.textContent = "💡 Related Knowledge";

  const closeBtn = document.createElement("button");
  closeBtn.id = "flow-serendipity-close";
  closeBtn.style.cssText = "background:none;border:none;cursor:pointer;font-size:18px;color:#6b7280;padding:4px 8px;border-radius:4px";
  closeBtn.textContent = "×";
  closeBtn.addEventListener("click", () => {
    sidebar.style.transform = "translateX(100%)";
    setTimeout(() => sidebar.remove(), 300);
  });

  header.append(title, closeBtn);

  const subtitle = document.createElement("p");
  subtitle.style.cssText = "margin:0 0 12px;font-size:12px;color:#6b7280";
  subtitle.textContent = "From your reading history";

  const list = document.createElement("div");
  list.style.cssText = "display:flex;flex-direction:column;gap:8px";

  for (const m of matches) {
    const link = document.createElement("a");
    link.href = m.url;
    link.target = "_blank";
    link.style.cssText = "display:block;padding:10px;background:#f9fafb;border-radius:8px;text-decoration:none;border:1px solid #e5e7eb;transition:background 0.2s";
    link.addEventListener("mouseenter", () => { link.style.background = "#f3f4f6"; });
    link.addEventListener("mouseleave", () => { link.style.background = "#f9fafb"; });

    const meta = document.createElement("div");
    meta.style.cssText = "font-size:12px;color:#9ca3af;margin-bottom:4px";
    meta.textContent = `${timeAgo(m.readAt)} · ${Math.round(m.relevance * 100)}% match`;

    const titleEl = document.createElement("div");
    titleEl.style.cssText = "font-size:13px;font-weight:500;color:#111827;margin-bottom:4px";
    titleEl.textContent = m.title;

    const summary = document.createElement("div");
    summary.style.cssText = "font-size:12px;color:#6b7280;line-height:1.4";
    summary.textContent = m.quickSummary;

    link.append(meta, titleEl, summary);

    if (m.concepts.length > 0) {
      const tags = document.createElement("div");
      tags.style.cssText = "margin-top:6px;display:flex;flex-wrap:wrap;gap:4px";
      for (const c of m.concepts.slice(0, 3)) {
        const tag = document.createElement("span");
        tag.style.cssText = "font-size:10px;padding:2px 6px;background:#ede9fe;color:#7c3aed;border-radius:4px";
        tag.textContent = c;
        tags.appendChild(tag);
      }
      link.appendChild(tags);
    }

    list.appendChild(link);
  }

  content.append(header, subtitle, list);
  sidebar.appendChild(content);


  return sidebar;
}

/** 创建触发按钮 */
function createSerendipityButton(matchCount: number): HTMLElement {
  const btn = document.createElement("div");
  btn.id = "flow-serendipity-btn";
  btn.style.cssText = `
    position: fixed;
    right: 16px;
    top: 50%;
    transform: translateY(-50%);
    background: #7c3aed;
    color: white;
    width: 48px;
    height: 48px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    box-shadow: 0 4px 12px rgba(124, 58, 237, 0.4);
    z-index: 2147483646;
    font-size: 20px;
    transition: transform 0.2s, box-shadow 0.2s;
  `;
  btn.textContent = "💡";
  btn.title = `${matchCount} related items found`;

  btn.addEventListener("mouseenter", () => {
    btn.style.transform = "translateY(-50%) scale(1.1)";
    btn.style.boxShadow = "0 6px 16px rgba(124, 58, 237, 0.5)";
  });
  btn.addEventListener("mouseleave", () => {
    btn.style.transform = "translateY(-50%) scale(1)";
    btn.style.boxShadow = "0 4px 12px rgba(124, 58, 237, 0.4)";
  });

  return btn;
}

/** 执行 Serendipity 检查 */
async function runSerendipity(): Promise<void> {
  // 避免在特殊页面运行
  if (
    window.location.protocol === "chrome:" ||
    window.location.protocol === "chrome-extension:" ||
    window.location.protocol === "about:"
  ) {
    return;
  }

  // 等待页面稳定
 await new Promise<void>((resolve) => setTimeout(resolve, 3000));

  const keywords = extractPageKeywords();
  if (keywords.length === 0) return;

  try {
    const resp = await browser.runtime.sendMessage({
      type: "SERENDIPITY_SEARCH",
      keywords,
      url: window.location.href,
    });

    if (resp?.success && resp.matches && resp.matches.length > 0) {
      const matches = resp.matches as SerendipityMatch[];

      // 创建触发按钮
      const btn = createSerendipityButton(matches.length);
      let sidebarOpen = false;

      btn.addEventListener("click", () => {
        if (sidebarOpen) {
          const sidebar = document.getElementById("flow-serendipity-sidebar");
          if (sidebar) {
            sidebar.style.transform = "translateX(100%)";
            setTimeout(() => sidebar.remove(), 300);
          }
          sidebarOpen = false;
        } else {
          const sidebar = createSerendipitySidebar(matches);
          document.body.appendChild(sidebar);
          sidebarOpen = true;
        }
      });

      document.body.appendChild(btn);

      // 30秒后自动隐藏按钮（用户可手动触发）
      setTimeout(() => {
        if (!sidebarOpen) {
          btn.style.opacity = "0.3";
          btn.style.transition = "opacity 0.5s";
        }
      }, 30000);
    }
  } catch (err) {
    // 静默失败，不影响页面
    console.debug("[FlowSearch] Serendipity check failed:", err);
  }
}

export default defineContentScript({
  matches: ["*://*/*"],
  main() {
    // 监听来自 background 的提取请求
    browser.runtime.onMessage.addListener((message) => {
      if (message.type === "EXTRACT_CONTENT") {
        try {
          // 1. 克隆文档，避免 Readability 破坏原页面 DOM
          const docClone = document.cloneNode(true) as Document;

          // 2. 使用 Readability 提取正文
          const reader = new Readability(docClone);
          const article = reader.parse();

          if (!article) {
            return {
              success: false,
              error: "Readability failed to parse content",
            };
          }

          // 3. 将 HTML 转为 Markdown (保持索引一致性)
          const turndown = new TurndownService({
            headingStyle: "atx",
            codeBlockStyle: "fenced",
          });

          const markdown = `# ${article.title ?? ""}\n\n${turndown.turndown(article.content ?? "")}`;

          return {
            success: true,
            title: article.title,
            excerpt: article.excerpt,
            markdown: markdown,
            byline: article.byline,
            siteName: article.siteName,
          };
        } catch (error) {
          console.error("[FlowSearch] Extraction error:", error);
          return { success: false, error: String(error) };
        }
      }
    });

    // 运行 Serendipity 检查
    runSerendipity();

    console.log("[FlowSearch] Content script ready");
  },
});
