import { createSignal, onMount, For } from "solid-js";
import { getIndexStats, hasApiKey, getIndexedBookmarks } from "../../src/db";
import { getRecentBookmarks } from "../../src/freq";
import "./App.css";

function App() {
  const [isConfigured, setIsConfigured] = createSignal(false);
  const [indexed, setIndexed] = createSignal(0);
  const [total, setTotal] = createSignal(0);
  const [recent, setRecent] = createSignal<Array<{ url: string; title: string; summary?: string; tags?: string[] }>>([]);
  const [indexingProgress, setIndexingProgress] = createSignal<{ processed: number; total: number; status: string } | null>(null);

  const fetchStats = async () => {
    const stats = await getIndexStats();
    setIndexed(stats.indexed);
    setTotal(stats.total);
  };

  onMount(async () => {
    const configured = await hasApiKey();
    setIsConfigured(configured);

    await fetchStats();

    // 获取最近访问
    const recentUrls = getRecentBookmarks(3);
    if (recentUrls.length > 0) {
      const indexedItems = await getIndexedBookmarks();
      const recentItems = recentUrls.map(r => {
        const item = indexedItems.find(i => i.url === r.url);
        return {
          url: r.url,
          title: item?.title || r.url,
          summary: item?.summary,
          tags: item?.tags
        };
      });
      setRecent(recentItems);
    }

    // 检查当前是否有索引任务在跑
    browser.runtime.sendMessage({ type: 'GET_INDEXING_STATUS' }).then(status => {
      if (status && status.isProcessing) {
        setIndexingProgress(status.progress);
      }
    });

    // 监听进度广播
    const handleMessage = (message: any) => {
      if (message.type === 'INDEXING_PROGRESS') {
        setIndexingProgress(message.progress);
        if (message.progress.status === 'complete' || message.progress.status === 'error') {
          setTimeout(() => setIndexingProgress(null), 2000);
          fetchStats();
        }
      }
    };
    browser.runtime.onMessage.addListener(handleMessage);
  });

  const openSettings = () => {
    browser.runtime.openOptionsPage();
  };

  return (
    <div class="popup-container">
      <div class="header">
        <div class="logo">
          <span class="ai-icon">✨</span>
          <h1>Flow Search</h1>
        </div>
        <span class={`status-dot ${isConfigured() ? 'ready' : 'not-configured'}`} title={isConfigured() ? '已配置' : '未配置'}></span>
      </div>

      <div class="search-hint">
        <div class="kb-shortcut">
          <kbd>bi</kbd> + <kbd>Space</kbd>
        </div>
        <p>直接在地址栏搜索书签</p>
      </div>

      <div class="divider"></div>

      <div class="stats-grid">
        <div class="stat-card">
          <div class="stat-value">{indexed()}</div>
          <div class="stat-label">AI 已索引</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">{total()}</div>
          <div class="stat-label">全部书签</div>
        </div>
      </div>

      {indexingProgress() && (
        <div class="indexing-hud">
          <div class="hud-header">
            <span>⚡ 正在同步索引...</span>
            <span>{Math.round((indexingProgress()!.processed / (indexingProgress()!.total || 1)) * 100)}%</span>
          </div>
          <div class="hud-bar">
            <div class="hud-fill" style={{ width: `${(indexingProgress()!.processed / (indexingProgress()!.total || 1)) * 100}%` }}></div>
          </div>
        </div>
      )}

      {recent().length > 0 && (
        <div class="recent-section">
          <h2>最近访问</h2>
          <div class="recent-list">
            <For each={recent()}>
              {(item) => (
                <a href={item.url} target="_blank" class="recent-item">
                  <div class="item-info">
                    <span class="item-title">{item.title}</span>
                    <div class="item-meta">
                      {item.tags?.slice(0, 2).map(tag => (
                        <span class="tag">#{tag}</span>
                      ))}
                    </div>
                  </div>
                </a>
              )}
            </For>
          </div>
        </div>
      )}

      <button class="primary-btn" onClick={openSettings}>
        {isConfigured() ? '管理索引与设置' : '去配置 API Key'}
      </button>
      
      <div class="footer">
        Powered by SiliconFlow & Jina AI
      </div>
    </div>
  );
}

export default App;
