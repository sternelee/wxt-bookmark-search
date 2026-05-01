import { createSignal, onMount, onCleanup, Show } from "solid-js";
import { Card, CardHeader, CardTitle, CardContent } from "../../../src/components/ui/card";
import { Button } from "../../../src/components/ui/button";
import { Progress } from "../../../src/components/ui/progress";
import { Alert } from "../../../src/components/ui/alert";
import { getIndexStats, getSettings } from "../../../src/db";
import { useI18n } from "../../../src/i18n";
import FolderTree from "./FolderTree";

export default function IndexManager() {
  const { t } = useI18n();
  const [stats, setStats] = createSignal({ total: 0, indexed: 0, pending: 0, failed: 0 });
  const [selectedFolders, setSelectedFolders] = createSignal<string[]>([]);
  const [progress, setProgress] = createSignal<{ processed: number; total: number; status: string } | null>(null);
  const [isIndexing, setIsIndexing] = createSignal(false);
  const [isPaused, setIsPaused] = createSignal(false);
  const [status, setStatus] = createSignal<{ message: string; type: "success" | "error" | "info" } | null>(null);

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
          setStatus({ message: t("options.indexManager.indexing", { processed: message.progress.processed, total: message.progress.total }), type: "info" });
        } else if (message.progress.status === "paused") {
          setIsPaused(true);
          setStatus({ message: t("options.indexManager.paused", { processed: message.progress.processed, total: message.progress.total }), type: "info" });
        } else if (message.progress.status === "complete") {
          setIsIndexing(false);
          setIsPaused(false);
          setProgress(null);
          setStatus({ message: t("options.indexManager.completed", { count: message.progress.processed }), type: "success" });
          loadStats();
        } else if (message.progress.status === "error") {
          setIsIndexing(false);
          setIsPaused(false);
          setProgress(null);
          setStatus({ message: `${t("common.error")}: ${message.progress.error || t("common.unknownError")}`, type: "error" });
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
      setStatus({ message: t("options.indexManager.apiKeyRequired"), type: "error" });
      return;
    }

    const selected = selectedFolders();

    setIsIndexing(true);
    setIsPaused(false);
    setStatus({ message: selected.length > 0 ? t("options.indexManager.scopeLabel") : t("common.start"), type: "info" });

    try {
      if (selected.length > 0) {
        const result = await browser.runtime.sendMessage({
          type: "INDEX_FOLDERS",
          folderIds: selected,
        });

        if (result && result.success && result.queued === 0) {
          setStatus({
            message: t("options.indexManager.folderSynced", { total: result.total }),
            type: "success",
          });
          setIsIndexing(false);
          setProgress(null);
        }
      } else {
        await browser.runtime.sendMessage({ type: "START_INDEXING" });
      }
    } catch (error) {
      setStatus({ message: `${t("options.indexManager.startFailed")}: ${error}`, type: "error" });
      setIsIndexing(false);
      setProgress(null);
    }
  };

  // 暂停索引
  const handlePause = async () => {
    try {
      await browser.runtime.sendMessage({ type: "PAUSE_INDEXING" });
      setIsPaused(true);
      setStatus({ message: t("common.pause").replace("⏸️ ", ""), type: "info" });
    } catch (error) {
      setStatus({ message: `${t("options.indexManager.pauseFailed")}: ${error}`, type: "error" });
    }
  };

  // 恢复索引
  const handleResume = async () => {
    try {
      await browser.runtime.sendMessage({ type: "RESUME_INDEXING" });
      setIsPaused(false);
      setStatus({ message: t("common.resume").replace("▶️ ", ""), type: "info" });
    } catch (error) {
      setStatus({ message: `${t("options.indexManager.resumeFailed")}: ${error}`, type: "error" });
    }
  };

  // 重试失败
  const handleRetry = async () => {
    const settings = await getSettings();
    if (!settings.openaiApiKey) {
      setStatus({ message: t("options.indexManager.apiKeyRequired"), type: "error" });
      return;
    }

    try {
      await browser.runtime.sendMessage({ type: "RETRY_FAILED" });
      setStatus({ message: t("options.indexManager.retryStarted"), type: "success" });
    } catch (error) {
      setStatus({ message: `${t("options.indexManager.startFailed")}: ${error}`, type: "error" });
    }
  };

  return (
    <Card class="mb-6">
      <CardHeader>
        <CardTitle>{t("options.indexManager.title")}</CardTitle>
      </CardHeader>
      <CardContent>
        {/* 统计网格 */}
        <div class="grid grid-cols-2 gap-3 mb-6">
          <div class="text-center bg-muted p-3 rounded-lg border border-border">
            <div class="text-xl font-extrabold text-primary">{stats().total}</div>
            <div class="text-[11px] text-muted-foreground font-medium mt-1 uppercase">{t("common.total")}</div>
          </div>
          <div class="text-center bg-muted p-3 rounded-lg border border-border">
            <div class="text-xl font-extrabold text-primary">{stats().indexed}</div>
            <div class="text-[11px] text-muted-foreground font-medium mt-1 uppercase">{t("common.indexed")}</div>
          </div>
          <div class="text-center bg-muted p-3 rounded-lg border border-border">
            <div class="text-xl font-extrabold text-primary">{stats().pending}</div>
            <div class="text-[11px] text-muted-foreground font-medium mt-1 uppercase">{t("common.pending")}</div>
          </div>
          <div class="text-center bg-muted p-3 rounded-lg border border-border">
            <div class="text-xl font-extrabold text-primary">{stats().failed}</div>
            <div class="text-[11px] text-muted-foreground font-medium mt-1 uppercase">{t("common.failed")}</div>
          </div>
        </div>

        {/* 文件夹选择 */}
        <div class="mb-5">
          <label class="block text-sm font-semibold mb-2 text-foreground">{t("options.indexManager.scopeLabel")}</label>
          <FolderTree
            selectedIds={selectedFolders()}
            onChange={setSelectedFolders}
          />
          <p class="text-xs text-muted-foreground mt-1.5">
            {t("options.indexManager.scopeHint")}
          </p>
        </div>

        {/* 控制按钮 */}
        <div class="flex gap-3 flex-wrap">
          <Button
            onClick={handleStart}
            disabled={isIndexing() && !isPaused()}
          >
            {selectedFolders().length > 0
              ? t("common.startFolder", { count: selectedFolders().length })
              : t("common.start")}
          </Button>
          <Button
            variant="outline"
            onClick={handlePause}
            disabled={!isIndexing() || isPaused()}
          >
            {t("common.pause")}
          </Button>
          <Button
            variant="outline"
            onClick={handleResume}
            disabled={!isPaused()}
          >
            {t("common.resume")}
          </Button>
          <Button variant="outline" onClick={handleRetry}>
            {t("common.retry")}
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
      </CardContent>
    </Card>
  );
}
