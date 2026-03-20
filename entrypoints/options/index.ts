import {
  getSettings,
  saveSettings,
  getIndexStats,
  clearAll,
} from "../../src/db";
import { testApiKey, getCacheStats, clearEmbeddingCache } from "../../src/embedding";

// DOM 元素
const apiKeyInput = document.getElementById("apiKey") as HTMLInputElement;
const searchModeSelect = document.getElementById(
  "searchMode",
) as HTMLSelectElement;
const vectorWeightInput = document.getElementById(
  "vectorWeight",
) as HTMLInputElement;
const vectorWeightValue = document.getElementById(
  "vectorWeightValue",
) as HTMLElement;
const vectorWeightGroup = document.getElementById(
  "vectorWeightGroup",
) as HTMLElement;

const saveBtn = document.getElementById("saveBtn") as HTMLButtonElement;
const testBtn = document.getElementById("testBtn") as HTMLButtonElement;
const applySettingsBtn = document.getElementById(
  "applySettings",
) as HTMLButtonElement;
const startIndexBtn = document.getElementById(
  "startIndexBtn",
) as HTMLButtonElement;
const pauseBtn = document.getElementById("pauseBtn") as HTMLButtonElement;
const resumeBtn = document.getElementById("resumeBtn") as HTMLButtonElement;
const retryBtn = document.getElementById("retryBtn") as HTMLButtonElement;
const clearCacheBtn = document.getElementById("clearCacheBtn") as HTMLButtonElement;
const folderList = document.getElementById("folderList") as HTMLElement;

const apiStatus = document.getElementById("apiStatus") as HTMLElement;
const indexStatus = document.getElementById("indexStatus") as HTMLElement;
const progressContainer = document.getElementById(
  "progressContainer",
) as HTMLElement;
const progressBar = document.getElementById(
  "progressBar",
) as HTMLProgressElement;
const progressText = document.getElementById("progressText") as HTMLElement;
const cacheStats = document.getElementById("cacheStats") as HTMLElement;
const failedList = document.getElementById("failedList") as HTMLElement;
const failedSection = document.getElementById("failedSection") as HTMLElement;

const totalStat = document.getElementById("totalStat") as HTMLElement;
const indexedStat = document.getElementById("indexedStat") as HTMLElement;
const pendingStat = document.getElementById("pendingStat") as HTMLElement;
const failedStat = document.getElementById("failedStat") as HTMLElement;

// 初始化
async function init() {
  const settings = await getSettings();

  // 填充表单
  apiKeyInput.value = settings.openaiApiKey || "";
  searchModeSelect.value = settings.searchMode || "hybrid";
  vectorWeightInput.value = String((settings.vectorWeight || 0.4) * 100);
  vectorWeightValue.textContent = `${vectorWeightInput.value}%`;

  // 更新权重滑块显示
  updateWeightVisibility();

  // 加载文件夹列表
  await loadFolders();

  // 加载统计
  await loadStats();

  // 加载失败列表
  await loadFailedBookmarks();
}

// 加载文件夹列表
async function loadFolders() {
  try {
    const settings = await getSettings();
    const savedIds = settings.selectedFolderIds || [];
    
    console.log('[options] Loading bookmark folders...');
    const response = await browser.runtime.sendMessage({ type: 'GET_BOOKMARK_FOLDERS' }) as {
      success: boolean;
      folders?: Array<{ id: string; title: string; path: string; children?: any[] }>;
      error?: string;
    };

    if (!response.success || !response.folders) {
      folderList.innerHTML = '<div style="padding: 8px; color: #999;">加载文件夹失败</div>';
      return;
    }

    folderList.innerHTML = '';

    // 递归渲染文件夹树
    function renderFolderTree(folders: Array<{ id: string; title: string; path: string; children?: any[] }>, container: HTMLElement) {
      folders.forEach(folder => {
        const hasChildren = folder.children && folder.children.length > 0;

        const itemDiv = document.createElement('div');
        itemDiv.className = 'folder-item';

        // 展开/折叠按钮
        if (hasChildren) {
          const toggleBtn = document.createElement('button');
          toggleBtn.className = 'folder-toggle';
          toggleBtn.textContent = '▼';
          toggleBtn.onclick = (e) => {
            e.preventDefault();
            const childContainer = itemDiv.nextElementSibling as HTMLElement;
            if (childContainer && childContainer.classList.contains('folder-children')) {
              const isExpanded = childContainer.classList.contains('expanded');
              if (isExpanded) {
                childContainer.classList.remove('expanded');
                toggleBtn.classList.add('collapsed');
              } else {
                childContainer.classList.add('expanded');
                toggleBtn.classList.remove('collapsed');
              }
            }
          };
          itemDiv.appendChild(toggleBtn);
        } else {
          const spacer = document.createElement('span');
          spacer.style.width = '24px';
          spacer.style.display = 'inline-block';
          itemDiv.appendChild(spacer);
        }

        // 复选框
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.id = `folder-${folder.id}`;
        checkbox.value = folder.id;
        checkbox.style.marginRight = '8px';
        
        // 恢复勾选状态
        if (savedIds.includes(folder.id)) {
          checkbox.checked = true;
        }
        
        // 父子联动 + 实时保存
        checkbox.addEventListener('change', async () => {
          if (hasChildren) {
            const childCheckboxes = itemDiv.nextElementSibling?.querySelectorAll<HTMLInputElement>('input[type="checkbox"]');
            childCheckboxes?.forEach(cb => {
              cb.checked = checkbox.checked;
            });
          }
          
          // 实时保存勾选状态
          const currentSelected = getSelectedFolders();
          await saveSettings({ selectedFolderIds: currentSelected });
          
          updateIndexButtonLabel();
        });
        
        itemDiv.appendChild(checkbox);

        // 标签
        const label = document.createElement('label');
        label.htmlFor = `folder-${folder.id}`;
        label.textContent = folder.title;
        label.style.flex = '1';
        label.style.cursor = 'pointer';
        itemDiv.appendChild(label);

        container.appendChild(itemDiv);

        if (hasChildren) {
          const childContainer = document.createElement('div');
          childContainer.className = 'folder-children expanded';
          container.appendChild(childContainer);
          renderFolderTree(folder.children!, childContainer);
        }
      });
    }

    renderFolderTree(response.folders, folderList);
    updateIndexButtonLabel(); // 初始加载后更新按钮文案
  } catch (error) {
    console.error('Failed to load folders:', error);
    folderList.innerHTML = '<div style="padding: 8px; color: #999;">加载文件夹失败</div>';
  }
}

// 获取选中的文件夹 ID
function getSelectedFolders(): string[] {
  const checkboxes = folderList.querySelectorAll<HTMLInputElement>('input[type="checkbox"]:checked');
  return Array.from(checkboxes).map(cb => cb.value);
}

// 获取实际书签总数
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

// 加载索引统计
async function loadStats() {
  const [stats, bookmarkCount] = await Promise.all([
    getIndexStats(),
    getBookmarkCount(),
  ]);

  totalStat.textContent = String(bookmarkCount);
  indexedStat.textContent = String(stats.indexed);
  pendingStat.textContent = String(stats.pending);
  failedStat.textContent = String(stats.failed);

  // 更新缓存统计
  const cache = getCacheStats();
  cacheStats.textContent = `${cache.size}/${cache.maxSize}`;

  // 如果没有失败项，隐藏该区块
  if (stats.failed === 0) {
    failedSection.classList.add('hidden');
  } else {
    failedSection.classList.remove('hidden');
  }
}

// 加载失败书签列表
async function loadFailedBookmarks() {
  try {
    const response = await browser.runtime.sendMessage({ type: 'GET_FAILED_BOOKMARKS' }) as {
      success: boolean;
      failed: Array<{ id: string, url: string, title: string, error?: string }>;
    };

    if (!response.success || response.failed.length === 0) {
      failedSection.classList.add('hidden');
      return;
    }

    failedSection.classList.remove('hidden');
    failedList.innerHTML = '';

    response.failed.forEach(item => {
      const div = document.createElement('div');
      div.className = 'failed-item';
      div.innerHTML = `
        <div class="failed-info">
          <span class="failed-title">${item.title || '无标题'}</span>
          <a href="${item.url}" target="_blank" class="failed-url" title="点击访问">${item.url}</a>
          <div class="failed-error">错误: ${item.error || '未知错误'}</div>
        </div>
        <button class="btn-del" data-id="${item.id}">🗑️ 删除书签</button>
      `;
      
      const delBtn = div.querySelector('.btn-del') as HTMLButtonElement;
      delBtn.onclick = async () => {
        if (confirm('确定要从浏览器中永久删除这个书签吗？')) {
          delBtn.disabled = true;
          delBtn.textContent = '删除中...';
          const res = await browser.runtime.sendMessage({ type: 'DELETE_BOOKMARK', id: item.id });
          if (res.success) {
            div.remove();
            loadStats(); // 刷新统计
          } else {
            alert('删除失败: ' + (res.error || '未知错误'));
            delBtn.disabled = false;
            delBtn.textContent = '🗑️ 删除书签';
          }
        }
      };

      failedList.appendChild(div);
    });
  } catch (error) {
    console.error('Failed to load failed bookmarks:', error);
  }
}

// 显示状态消息
function showStatus(
  element: HTMLElement,
  message: string,
  type: "success" | "error" | "info",
) {
  element.textContent = message;
  element.className = `status ${type}`;
  element.classList.remove("hidden");

  // 自动隐藏成功消息
  if (type === "success") {
    setTimeout(() => element.classList.add("hidden"), 3000);
  }
}

// 更新权重滑块可见性
function updateWeightVisibility() {
  const isHybrid = searchModeSelect.value === "hybrid";
  vectorWeightGroup.style.opacity = isHybrid ? "1" : "0.5";
  vectorWeightInput.disabled = !isHybrid;
}
// 保存 API 设置
saveBtn.addEventListener("click", async () => {
  const apiKey = apiKeyInput.value.trim();

  if (!apiKey) {
    showStatus(apiStatus, "请输入 API Key", "error");
    return;
  }

  saveBtn.disabled = true;
  saveBtn.textContent = "保存中...";

  try {
    await saveSettings({ openaiApiKey: apiKey });
    showStatus(apiStatus, "✓ 设置已保存", "success");
  } catch (error) {
    showStatus(apiStatus, `保存失败: ${error}`, "error");
  } finally {
    saveBtn.disabled = false;
    saveBtn.textContent = "💾 保存 API 设置";
  }
});


// 测试 API 连接
testBtn.addEventListener("click", async () => {
  const apiKey = apiKeyInput.value.trim();

  if (!apiKey) {
    showStatus(apiStatus, "请输入 API Key", "error");
    return;
  }

  testBtn.disabled = true;
  testBtn.textContent = "测试中...";

  try {
    const valid = await testApiKey(apiKey);
    if (valid) {
      showStatus(apiStatus, "✓ API Key 有效，连接成功", "success");
    } else {
      showStatus(apiStatus, "✗ API Key 无效", "error");
    }
  } catch (error) {
    showStatus(apiStatus, `测试失败: ${error}`, "error");
  } finally {
    testBtn.disabled = false;
    testBtn.textContent = "测试连接";
  }
});

// 应用搜索设置
applySettingsBtn.addEventListener("click", async () => {
  const searchMode = searchModeSelect.value as "hybrid" | "vector" | "keyword";
  const vectorWeight = Number(vectorWeightInput.value) / 100;

  try {
    await saveSettings({ searchMode, vectorWeight });
    showStatus(indexStatus, "✓ 搜索设置已应用", "success");
  } catch (error) {
    showStatus(indexStatus, `应用失败: ${error}`, "error");
  }
});

// 权重滑块更新
vectorWeightInput.addEventListener("input", () => {
  vectorWeightValue.textContent = `${vectorWeightInput.value}%`;
});

// 搜索模式切换
searchModeSelect.addEventListener("change", updateWeightVisibility);

// 更新索引按钮标签
function updateIndexButtonLabel() {
  const selected = getSelectedFolders();
  if (selected.length > 0) {
    startIndexBtn.textContent = `🚀 索引选中的 ${selected.length} 个文件夹`;
    startIndexBtn.style.background = 'var(--info)';
  } else {
    startIndexBtn.textContent = '🚀 开始全量/增量索引';
    startIndexBtn.style.background = 'var(--primary-color)';
  }
}

// 开始索引
startIndexBtn.addEventListener("click", async () => {
  const settings = await getSettings();

  if (!settings.openaiApiKey) {
    showStatus(indexStatus, "请先配置 API Key", "error");
    return;
  }

  const selectedFolders = getSelectedFolders();
  
  startIndexBtn.disabled = true;
  pauseBtn.disabled = false;
  resumeBtn.disabled = true;
  progressContainer.classList.remove("hidden");
  
  const isSelective = selectedFolders.length > 0;
  showStatus(indexStatus, isSelective ? "正在执行定向索引..." : "正在执行全量增量索引...", "info");

  try {
    if (isSelective) {
      // 索引选中的文件夹
      const result = await browser.runtime.sendMessage({
        type: 'INDEX_FOLDERS',
        folderIds: selectedFolders
      });
      
      // 如果没有新书签需要入队，直接结束
      if (result && result.success && result.queued === 0) {
        showStatus(indexStatus, `✓ 所选文件夹 (${result.total}个书签) 已全部同步`, "success");
        startIndexBtn.disabled = false;
        pauseBtn.disabled = true;
        progressContainer.classList.add("hidden");
      }
    } else {
      // 索引全部书签
      await browser.runtime.sendMessage({ type: "START_INDEXING" });
    }
  } catch (error) {
    showStatus(indexStatus, `启动失败: ${error}`, "error");
    startIndexBtn.disabled = false;
    pauseBtn.disabled = true;
    progressContainer.classList.add("hidden");
  }
});

// 暂停索引
pauseBtn.addEventListener("click", async () => {
  try {
    await browser.runtime.sendMessage({ type: "PAUSE_INDEXING" });
    showStatus(indexStatus, "索引已暂停", "info");
    pauseBtn.disabled = true;
    resumeBtn.disabled = false;
  } catch (error) {
    showStatus(indexStatus, `暂停失败: ${error}`, "error");
  }
});

// 恢复索引
resumeBtn.addEventListener("click", async () => {
  try {
    await browser.runtime.sendMessage({ type: "RESUME_INDEXING" });
    showStatus(indexStatus, "索引已恢复", "info");
    pauseBtn.disabled = false;
    resumeBtn.disabled = true;
  } catch (error) {
    showStatus(indexStatus, `恢复失败: ${error}`, "error");
  }
});

// 重试失败
retryBtn.addEventListener("click", async () => {
  const settings = await getSettings();

  if (!settings.openaiApiKey) {
    showStatus(indexStatus, "请先配置 API Key", "error");
    return;
  }

  try {
    await browser.runtime.sendMessage({ type: "RETRY_FAILED" });
    showStatus(indexStatus, "✓ 重试任务已启动", "success");
  } catch (error) {
    showStatus(indexStatus, `启动失败: ${error}`, "error");
  }
});

// 清空缓存
clearCacheBtn.addEventListener("click", () => {
  clearEmbeddingCache();
  const cache = getCacheStats();
  cacheStats.textContent = `${cache.size}/${cache.maxSize}`;
  showStatus(indexStatus, "✓ 查询缓存已清空", "success");
});

// 监听索引进度
browser.runtime.onMessage.addListener((message) => {
  if (message.type === "INDEXING_PROGRESS") {
    const progress = message.progress as { total: number; processed: number; current?: string; status: string; error?: string };

    // 更新进度条
    const percent = progress.total > 0 ? Math.round((progress.processed / progress.total) * 100) : 0;
    progressBar.value = percent;
    progressText.textContent = `${percent}% (${progress.processed}/${progress.total})`;

    // 更新状态文本
    if (progress.status === "processing") {
      const currentUrl = progress.current ? ` (${progress.current.slice(0, 50)}...)` : "";
      showStatus(indexStatus, `索引中 ${progress.processed}/${progress.total}${currentUrl}`, "info");
      pauseBtn.disabled = false;
      resumeBtn.disabled = true;
    } else if (progress.status === "paused") {
      showStatus(indexStatus, `索引已暂停 (${progress.processed}/${progress.total})`, "info");
      pauseBtn.disabled = true;
      resumeBtn.disabled = false;
    } else if (progress.status === "complete") {
      showStatus(indexStatus, `✓ 索引完成，共处理 ${progress.processed} 个书签`, "success");
      startIndexBtn.disabled = false;
      pauseBtn.disabled = true;
      resumeBtn.disabled = true;
      progressContainer.classList.add("hidden");
      loadStats(); // 刷新统计
    } else if (progress.status === "error") {
      showStatus(indexStatus, `索引出错: ${progress.error || '未知错误'}`, "error");
      startIndexBtn.disabled = false;
      pauseBtn.disabled = true;
      resumeBtn.disabled = true;
      progressContainer.classList.add("hidden");
    }
  }
  return true;
});

// 初始化
init();
