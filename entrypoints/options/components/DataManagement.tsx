import { createSignal, onMount, Show } from "solid-js";
import { Card, CardHeader, CardTitle, CardContent } from "../../../src/components/ui/card";
import { Button } from "../../../src/components/ui/button";
import { Alert } from "../../../src/components/ui/alert";
import { db, resetSettings } from "../../../src/db";
import { useI18n } from "../../../src/i18n";

interface ConfirmDialogState {
  open: boolean;
  title: string;
  message: string;
  variant: "default" | "destructive";
  onConfirm: () => void;
}

const EXPORT_VERSION = 1;
/** 导出文件中的敏感 settings 字段不落盘，书签记录本身不含密钥 */
const EXPORT_FILE_PREFIX = "flow-search-export";

export default function DataManagement() {
  const { t } = useI18n();
  const [status, setStatus] = createSignal<{ message: string; type: "success" | "error" | "info" } | null>(null);
  const [cacheStats, setCacheStats] = createSignal<{ size: number; maxSize: number } | null>(null);

  const [confirmDialog, setConfirmDialog] = createSignal<ConfirmDialogState>({
    open: false,
    title: "",
    message: "",
    variant: "default",
    onConfirm: () => {},
  });

  onMount(async () => {
    try {
      const response = await browser.runtime.sendMessage({ type: "GET_CACHE_STATS" });
      if (response?.success) {
        setCacheStats({ size: response.size, maxSize: response.maxSize });
      }
    } catch {}
  });

  /** 导出全部索引记录为 JSON（不含 API Key 等设置项） */
  const handleExport = async () => {
    try {
      const records = await db.bookmarks.toArray();
      const payload = {
        app: "flow-search",
        version: EXPORT_VERSION,
        exportedAt: new Date().toISOString(),
        records,
      };
      const blob = new Blob([JSON.stringify(payload)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `${EXPORT_FILE_PREFIX}-${Date.now()}.json`;
      anchor.click();
      URL.revokeObjectURL(url);
      setStatus({
        message: t("options.dataManagement.exportSuccess", {
          count: records.length,
        }),
        type: "success",
      });
    } catch (error) {
      setStatus({ message: `${t("options.dataManagement.exportFailed")}: ${error}`, type: "error" });
    }
  };

  /** 导入 JSON（含带向量的记录直接进搜索引擎，缺向量的重新入队生成） */
  const handleImportFile = async (file: File) => {
    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as { records?: unknown[] };
      const records = Array.isArray(parsed?.records) ? parsed.records : null;
      if (!records || records.length === 0) {
        setStatus({ message: t("options.dataManagement.importInvalid"), type: "error" });
        return;
      }

      const response = await browser.runtime.sendMessage({
        type: "IMPORT_DATA",
        records,
      });
      if (!response?.success) {
        throw new Error(response?.error || t("common.unknownError"));
      }
      setStatus({
        message: t("options.dataManagement.importSuccess", {
          imported: response.imported,
          requeued: response.requeued,
        }),
        type: "success",
      });
    } catch (error) {
      setStatus({ message: `${t("options.dataManagement.importFailed")}: ${error}`, type: "error" });
    }
  };

  /** 恢复全部设置为默认值 */
  const handleResetSettings = () => {
    setConfirmDialog({
      open: true,
      title: t("options.dataManagement.resetConfirmTitle"),
      message: t("options.dataManagement.resetConfirmBody"),
      variant: "destructive",
      onConfirm: async () => {
        setConfirmDialog((prev) => ({ ...prev, open: false }));
        try {
          await resetSettings();
          // 让后台按默认设置重建定时任务
          browser.runtime
            .sendMessage({ type: "REFRESH_ALARMS" })
            .catch(() => {});
          setStatus({ message: t("options.dataManagement.resetDone"), type: "success" });
        } catch (error) {
          setStatus({ message: `${t("common.saveFailed")}: ${error}`, type: "error" });
        }
      },
    });
  };

  /** 丢弃全部存量向量并按当前 embedding 配置重建 */
  const handleRebuildVectors = () => {
    setConfirmDialog({
      open: true,
      title: t("options.dataManagement.rebuildButton"),
      message: t("options.dataManagement.rebuildConfirm"),
      variant: "default",
      onConfirm: async () => {
        setConfirmDialog((prev) => ({ ...prev, open: false }));
        try {
          const response = await browser.runtime.sendMessage({
            type: "REINDEX_STORED_EMBEDDINGS",
          });
          if (!response?.success) {
            throw new Error(response?.error || t("common.unknownError"));
          }
          setStatus({
            message: t("options.dataManagement.rebuildQueued", {
              count: response.queued ?? 0,
            }),
            type: "success",
          });
        } catch (error) {
          setStatus({ message: `${t("options.dataManagement.rebuildFailed")}: ${error}`, type: "error" });
        }
      },
    });
  };

  // 清空查询缓存（内存中的 embedding API 缓存）
  const handleClearQueryCache = () => {
    setConfirmDialog({
      open: true,
      title: t("common.clearQueryCache"),
      message: t("options.indexManager.clearQueryCacheConfirm"),
      variant: "default",
      onConfirm: async () => {
        setConfirmDialog((prev) => ({ ...prev, open: false }));
        try {
          await browser.runtime.sendMessage({ type: "CLEAR_EMBEDDING_CACHE" });
          const stats = await browser.runtime.sendMessage({ type: "GET_CACHE_STATS" });
          if (stats?.success) {
            setCacheStats({ size: stats.size, maxSize: stats.maxSize });
          }
          setStatus({ message: t("options.indexManager.clearQueryCacheCleared"), type: "success" });
        } catch (error) {
          setStatus({ message: `${t("options.indexManager.cacheClearFailed")}: ${error}`, type: "error" });
        }
      },
    });
  };

  // 清空数据库（IndexedDB 中的书签向量数据）
  const handleClearDatabase = () => {
    setConfirmDialog({
      open: true,
      title: t("common.clearDatabase"),
      message: t("options.indexManager.clearDatabaseConfirm"),
      variant: "destructive",
      onConfirm: async () => {
        setConfirmDialog((prev) => ({ ...prev, open: false }));
        try {
          const response = await browser.runtime.sendMessage({
            type: "CLEAR_INDEXED_DATA",
          });
          if (!response?.success) {
            throw new Error(response?.error || t("options.indexManager.cacheClearFailed"));
          }
          setStatus({ message: t("options.indexManager.databaseCleared"), type: "success" });
        } catch (error) {
          setStatus({ message: `${t("options.indexManager.cacheClearFailed")}: ${error}`, type: "error" });
        }
      },
    });
  };

  const closeConfirmDialog = () => {
    setConfirmDialog((prev) => ({ ...prev, open: false }));
  };

  return (
    <>
    <Card class="mb-6 border-destructive/30">
      <CardHeader>
        <CardTitle class="text-destructive">{t("common.dataManagement")}</CardTitle>
      </CardHeader>
      <CardContent>
        <p class="text-sm text-muted-foreground mb-4">
          {t("options.dataManagement.description")}
        </p>

        <Show when={cacheStats()}>
          <p class="text-xs text-muted-foreground mb-4">
            {t("options.dataManagement.cacheStats", {
              size: cacheStats()!.size,
              maxSize: cacheStats()!.maxSize,
            })}
          </p>
        </Show>

        <div class="flex gap-3 flex-wrap">
          <Button variant="outline" onClick={handleExport}>
            {t("options.dataManagement.exportButton")}
          </Button>
          <Button
            variant="outline"
            onClick={() => document.getElementById("flow-search-import-input")?.click()}
          >
            {t("options.dataManagement.importButton")}
          </Button>
          <Button variant="outline" onClick={handleRebuildVectors}>
            {t("options.dataManagement.rebuildButton")}
          </Button>
          <Button variant="outline" onClick={handleResetSettings}>
            {t("options.dataManagement.resetButton")}
          </Button>
          <Button variant="outline" onClick={handleClearQueryCache}>
            {t("common.clearQueryCache")}
          </Button>
          <Button variant="destructive" onClick={handleClearDatabase}>
            {t("common.clearDatabase")}
          </Button>
        </div>

        {/* 隐藏的导入文件选择器 */}
        <input
          id="flow-search-import-input"
          type="file"
          accept="application/json,.json"
          class="hidden"
          onChange={(e) => {
            const file = e.currentTarget.files?.[0];
            if (file) handleImportFile(file);
            e.currentTarget.value = "";
          }}
        />

        <Alert
          variant={status()?.type}
          visible={status() !== null}
          class="mt-4"
        >
          {status()?.message}
        </Alert>
      </CardContent>
    </Card>

      {/* 确认对话框 */}
      <Show when={confirmDialog().open}>
        <div
          class="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
          onClick={closeConfirmDialog}
        >
          <Card
            class="w-full max-w-md mx-4 shadow-xl"
            onClick={(e: MouseEvent) => e.stopPropagation()}
          >
            <CardHeader>
              <CardTitle class={confirmDialog().variant === "destructive" ? "text-destructive" : ""}>
                {confirmDialog().title}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p class="text-sm text-foreground whitespace-pre-line mb-6">
                {confirmDialog().message}
              </p>
              <div class="flex gap-3 justify-end">
                <Button variant="outline" onClick={closeConfirmDialog}>
                  {t("common.cancel")}
                </Button>
                <Button
                  variant={confirmDialog().variant}
                  onClick={() => confirmDialog().onConfirm()}
                >
                  {t("common.confirm")}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </Show>
    </>
  );
}
