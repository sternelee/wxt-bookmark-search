import { Readability } from "@mozilla/readability";
import TurndownService from "turndown";

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
            return { success: false, error: "Readability failed to parse content" };
          }

          // 3. 将 HTML 转为 Markdown (保持索引一致性)
          const turndown = new TurndownService({
            headingStyle: 'atx',
            codeBlockStyle: 'fenced'
          });
          
          const markdown = `# ${article.title ?? ""}\n\n${turndown.turndown(article.content ?? "")}`;

          return {
            success: true,
            title: article.title,
            excerpt: article.excerpt,
            markdown: markdown,
            byline: article.byline,
            siteName: article.siteName
          };
        } catch (error) {
          console.error("[FlowSearch] Extraction error:", error);
          return { success: false, error: String(error) };
        }
      }
    });
    
    console.log("[FlowSearch] Content script ready for extraction");
  },
});
