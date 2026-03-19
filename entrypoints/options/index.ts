import {
  getSettings,
  saveSettings,
  getIndexStats,
  clearAll,
} from "../../src/db";
import { testApiKey } from "../../src/embedding";

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
const retryBtn = document.getElementById("retryBtn") as HTMLButtonElement;

const apiStatus = document.getElementById("apiStatus") as HTMLElement;
const indexStatus = document.getElementById("indexStatus") as HTMLElement;
const progressContainer = document.getElementById(
  "progressContainer",
) as HTMLElement;
const progressBar = document.getElementById(
  "progressBar",
) as HTMLProgressElement;

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

  // 加载统计
  await loadStats();
}

// 获取实际书签总数
async function getBookmarkCount(): Promise<number> {
  const tree = await browser.bookmarks.getTree();
  let count = 0;

  function traverse(nodes: browser.bookmarks.BookmarkTreeNode[]) {
    for (const node of nodes) {
      if (node.url) count++;
      if (node.children) traverse(node.children);
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
    showStatus(apiStatus, "✓ API Key 已保存", "success");
  } catch (error) {
    showStatus(apiStatus, `保存失败: ${error}`, "error");
  } finally {
    saveBtn.disabled = false;
    saveBtn.textContent = "保存设置";
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

// 开始索引
startIndexBtn.addEventListener("click", async () => {
  const settings = await getSettings();

  if (!settings.openaiApiKey) {
    showStatus(indexStatus, "请先配置 API Key", "error");
    return;
  }

  startIndexBtn.disabled = true;
  progressContainer.classList.remove("hidden");
  showStatus(indexStatus, "正在索引...", "info");

  try {
    await browser.runtime.sendMessage({ type: "START_INDEXING" });
    showStatus(indexStatus, "✓ 索引任务已启动", "success");

    // 定期更新统计
    const interval = setInterval(async () => {
      await loadStats();
      const stats = await getIndexStats();
      if (stats.pending === 0) {
        clearInterval(interval);
        startIndexBtn.disabled = false;
        progressContainer.classList.add("hidden");
      }
    }, 2000);
  } catch (error) {
    showStatus(indexStatus, `启动失败: ${error}`, "error");
    startIndexBtn.disabled = false;
    progressContainer.classList.add("hidden");
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

// 初始化
init();
