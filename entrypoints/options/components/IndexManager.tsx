import { createSignal, onMount, onCleanup, For, Show } from "solid-js";
import { Card, CardHeader, CardTitle, CardContent } from "../../../src/components/ui/card";
import { Button } from "../../../src/components/ui/button";
import { Progress } from "../../../src/components/ui/progress";
import { Alert } from "../../../src/components/ui/alert";
import { getIndexStats, getSettings, saveSettings, clearAll } from "../../../src/db";
import FolderTree from "./FolderTree";

export default function IndexManager() {
  const [stats, setStats] = createSignal({ total: 0, indexed: 0, pending: 0, failed: 0 });
  const [selectedFolders, setSelectedFolders] = createSignal<string[]>([]);
  const [progress, setProgress] = createSignal<{ processed: number; total: number; status: string } | null>(null);
  const [isIndexing, setIsIndexing] = createSignal(false);
  const [isPaused, setIsPaused] = createSignal(false);
  const [status, setStatus] = createSignal<{ message: string; type: "success" | "error" | "info" } | null>(null);
  const [cacheStats, setCacheStats] = createSignal({ size: 0, maxSize: 100 });

  // 加载嵌入缓存状态（从 background 获取真实值）
  const loadCacheStats = async () => {
    try {
      const result = await browser.runtime.sendMessage({ type: "GET_CACHE_STATS" });
      if (result) {
        setCacheStats({ size: result.size ?? 0, maxSize: result.maxSize ?? 100 });
      }
    } catch (error) {
      console.warn("[IndexManager] Failed to get cache stats:", error);
    }
  };

  // 加载统计
  const loadStats = async () => {
    const statsData = await getIndexStats();
    const tree = await browser.bookmarks.getTree();
    let count = 0;

    function traverse(nodes: any[]) {
      for (const node of nodes) {
        if (node.url) count++;
        if (node.children) traverse(node.children);
      }
    }

    traverse(tree);
    setStats({ ...statsData, total: count });
  };

  // 加载选中的文件夹
  const loadSelectedFolders = async () => {
    const settings = await getSettings();
    setSelectedFolders(settings.selectedFolderIds || []);
  };

  // 初始化
  onMount(async () => {
    await loadStats();
    await loadSelectedFolders();
    await loadCacheStats();

    // 定期刷新缓存状态
    const cacheInterval = setInterval(loadCacheStats, 5000);
    onCleanup(() => clearInterval(cacheInterval));

    // 检查当前是否有索引任务在跑
    const statusResult = await browser.runtime.sendMessage({ type: "GET_INDEXING_STATUS" });
    if (statusResult && statusResult.isProcessing) {
      setProgress(statusResult.progress);
      setIsIndexing(true);
    }

    // 监听进度广播
    const handleMessage = (message: any) => {
      if (message.type === "INDEXING_PROGRESS") {
        setProgress(message.progress);

        if (message.progress.status === "processing") {
          setIsIndexing(true);
          setIsPaused(false);
          setStatus({ message: `索引中 ${message.progress.processed}/${message.progress.total}`, type: "info" });
        } else if (message.progress.status === "paused") {
          setIsPaused(true);
          setStatus({ message: `索引已暂停 (${message.progress.processed}/${message.progress.total})`, type: "info" });
        } else if (message.progress.status === "complete") {
          setIsIndexing(false);
          setIsPaused(false);
          setProgress(null);
          setStatus({ message: `✓ 索引完成，共处理 ${message.progress.processed} 个书签`, type: "success" });
          loadStats();
        } else if (message.progress.status === "error") {
          setIsIndexing(false);
          setIsPaused(false);
          setProgress(null);
          setStatus({ message: `索引出错: ${message.progress.error || "未知错误"}`, type: "error" });
        }
      }
    };

    browser.runtime.onMessage.addListener(handleMessage);
    onCleanup(() => browser.runtime.onMessage.removeListener(handleMessage));
  });

  // 开始索引
  const handleStart = async () => {
    const settings = await getSettings();
    if (!settings.openaiApiKey) {
      setStatus({ message: "请先配置 API Key", type: "error" });
      return;
    }

    const selected = selectedFolders();

    setIsIndexing(true);
    setIsPaused(false);
    setStatus({ message: selected.length > 0 ? "正在执行定向索引..." : "正在执行全量增量索引...", type: "info" });

    try {
      if (selected.length > 0) {
        const result = await browser.runtime.sendMessage({
          type: "INDEX_FOLDERS",
          folderIds: selected,
        });

        if (result && result.success && result.queued === 0) {
          setStatus({
            message: `✓ 所选文件夹 (${result.total}个书签) 已全部同步`,
            type: "success",
          });
          setIsIndexing(false);
          setProgress(null);
        }
      } else {
        await browser.runtime.sendMessage({ type: "START_INDEXING" });
      }
    } catch (error) {
      setStatus({ message: `启动失败: ${error}`, type: "error" });
      setIsIndexing(false);
      setProgress(null);
    }
  };

  // 暂停索引
  const handlePause = async () => {
    try {
      await browser.runtime.sendMessage({ type: "PAUSE_INDEXING" });
      setIsPaused(true);
      setStatus({ message: "索引已暂停", type: "info" });
    } catch (error) {
      setStatus({ message: `暂停失败: ${error}`, type: "error" });
    }
  };

  // 恢复索引
  const handleResume = async () => {
    try {
      await browser.runtime.sendMessage({ type: "RESUME_INDEXING" });
      setIsPaused(false);
      setStatus({ message: "索引已恢复", type: "info" });
    } catch (error) {
      setStatus({ message: `恢复失败: ${error}`, type: "error" });
    }
  };

  // 重试失败
  const handleRetry = async () => {
    const settings = await getSettings();
    if (!settings.openaiApiKey) {
      setStatus({ message: "请先配置 API Key", type: "error" });
      return;
    }

    try {
      await browser.runtime.sendMessage({ type: "RETRY_FAILED" });
      setStatus({ message: "✓ 重试任务已启动", type: "success" });
    } catch (error) {
      setStatus({ message: `启动失败: ${error}`, type: "error" });
    }
  };

  // 清空缓存
  const handleClearCache = async () => {
    try {
      await browser.runtime.sendMessage({ type: "CLEAR_EMBEDDING_CACHE" });
      await loadCacheStats();
      setStatus({ message: "✓ 查询缓存已清空", type: "success" });
    } catch (error) {
      setStatus({ message: `清空缓存失败: ${error}`, type: "error" });
    }
  };

  return (
    <Card class="mb-6">
      <CardHeader>
        <CardTitle>⚙️ 索引引擎管理</CardTitle>
      </CardHeader>
      <CardContent>
        {/* 统计网格 */}
        <div class="grid grid-cols-2 gap-3 mb-6">
          <div class="text-center bg-muted p-3 rounded-lg border border-border">
            <div class="text-xl font-extrabold text-primary">{stats().total}</div>
            <div class="text-[11px] text-muted-foreground font-medium mt-1 uppercase">总书签</div>
          </div>
          <div class="text-center bg-muted p-3 rounded-lg border border-border">
            <div class="text-xl font-extrabold text-primary">{stats().indexed}</div>
            <div class="text-[11px] text-muted-foreground font-medium mt-1 uppercase">已索引</div>
          </div>
          <div class="text-center bg-muted p-3 rounded-lg border border-border">
            <div class="text-xl font-extrabold text-primary">{stats().pending}</div>
            <div class="text-[11px] text-muted-foreground font-medium mt-1 uppercase">待处理</div>
          </div>
          <div class="text-center bg-muted p-3 rounded-lg border border-border">
            <div class="text-xl font-extrabold text-primary">{stats().failed}</div>
            <div class="text-[11px] text-muted-foreground font-medium mt-1 uppercase">失败项</div>
          </div>
        </div>

        {/* 文件夹选择 */}
        <div class="mb-5">
          <label class="block text-sm font-semibold mb-2 text-foreground">索引范围选择</label>
          <FolderTree
            selectedIds={selectedFolders()}
            onChange={setSelectedFolders}
          />
          <p class="text-xs text-muted-foreground mt-1.5">
            不勾选任何文件夹将默认对所有书签进行增量索引
          </p>
        </div>

        {/* 控制按钮 */}
        <div class="flex gap-3 flex-wrap">
          <Button
            onClick={handleStart}
            disabled={isIndexing() && !isPaused()}
          >
            {selectedFolders().length > 0
              ? `🚀 索引选中的 ${selectedFolders().length} 个文件夹`
              : "🚀 开始全量/增量索引"}
          </Button>
          <Button
            variant="outline"
            onClick={handlePause}
            disabled={!isIndexing() || isPaused()}
          >
            ⏸️ 暂停
          </Button>
          <Button
            variant="outline"
            onClick={handleResume}
            disabled={!isPaused()}
          >
            ▶️ 恢复
          </Button>
          <Button variant="outline" onClick={handleRetry}>
            🔄 重试失败
          </Button>
          <Button variant="destructive" onClick={handleClearCache}>
            🧹 清空缓存
          </Button>
        </div>

        <Alert
          variant={status()?.type}
          visible={status() !== null}
          class="mt-4"
        >
          {status()?.message}
        </Alert>

        <Show when={progress()}>
          <div class="mt-5 bg-muted p-3 rounded-lg">
            <Progress
              value={Math.round((progress()!.processed / (progress()!.total || 1)) * 100)}
              class="h-2"
            />
            <div class="text-right text-xs text-muted-foreground mt-1">
              {Math.round((progress()!.processed / (progress()!.total || 1)) * 100)}% ({progress()!.processed}/{progress()!.total})
            </div>
          </div>
        </Show>

        <div class="mt-4 text-xs text-muted-foreground border-t border-border pt-3">
          🧠 向量查询缓存状态:
          <span class="font-bold"> {cacheStats().size}/{cacheStats().maxSize}</span>
          (已缓存最近的查询结果，提升搜索速度)
        </div>
      </CardContent>
    </Card>
  );
}
