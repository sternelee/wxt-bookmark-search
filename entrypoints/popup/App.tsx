import { createSignal, onMount } from "solid-js";
import { getIndexStats, hasApiKey } from "../../src/db";
import "./App.css";

/** 获取实际书签总数 */
async function getBookmarkCount(): Promise<number> {
  const tree = await browser.bookmarks.getTree();
  let count = 0;

  function traverse(nodes: { url?: string; children?: unknown[] }[]) {
    for (const node of nodes) {
      if (node.url) count++;
      if (node.children) traverse(node.children as typeof nodes);
    }
  }

  traverse(tree);
  return count;
}

function App() {
  const [isConfigured, setIsConfigured] = createSignal(false);
  const [indexed, setIndexed] = createSignal(0);
  const [total, setTotal] = createSignal(0);

  onMount(async () => {
    const configured = await hasApiKey();
    setIsConfigured(configured);

    // 获取实际书签总数
    const bookmarkCount = await getBookmarkCount();
    setTotal(bookmarkCount);

    // 获取已索引数量
    const stats = await getIndexStats();
    setIndexed(stats.indexed);
  });

  const openSettings = () => {
    browser.runtime.openOptionsPage();
  };

  return (
    <div class="popup-container">
      <div class="header">
        <h1>🤖 书签 AI 搜索</h1>
        <span class={`status-badge ${isConfigured() ? 'ready' : 'not-configured'}`}>
          {isConfigured() ? '已配置' : '未配置'}
        </span>
      </div>

      <p class="hint">
        在地址栏输入 <code>bi</code> + 空格，然后输入关键词搜索书签。
      </p>

      <div class="usage-box">
        <strong>示例：</strong>
        <ul>
          <li><code>bi 如何学习编程</code></li>
          <li><code>bi react 教程</code></li>
        </ul>
      </div>

      <div class="divider"></div>

      <div class="stats">
        <div class="stat-item">
          <div class="stat-value">{indexed()}</div>
          <div class="stat-label">已索引</div>
        </div>
        <div class="stat-item">
          <div class="stat-value">{total()}</div>
          <div class="stat-label">总书签</div>
        </div>
      </div>

      <button class="settings-btn" onClick={openSettings}>
        打开设置
      </button>
    </div>
  );
}

export default App;
