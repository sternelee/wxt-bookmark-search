import { createSignal, Show } from "solid-js";
import { Card, CardHeader, CardTitle, CardContent } from "../../../src/components/ui/card";
import { Button } from "../../../src/components/ui/button";
import { Alert } from "../../../src/components/ui/alert";
import { clearAll } from "../../../src/db";
import { useI18n } from "../../../src/i18n";

interface ConfirmDialogState {
  open: boolean;
  title: string;
  message: string;
  variant: "default" | "destructive";
  onConfirm: () => void;
}

export default function DataManagement() {
  const { t } = useI18n();
  const [status, setStatus] = createSignal<{ message: string; type: "success" | "error" | "info" } | null>(null);

  const [confirmDialog, setConfirmDialog] = createSignal<ConfirmDialogState>({
    open: false,
    title: "",
    message: "",
    variant: "default",
    onConfirm: () => {},
  });

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
          await clearAll();
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

          <div class="flex gap-3 flex-wrap">
            <Button variant="outline" onClick={handleClearQueryCache}>
              {t("common.clearQueryCache")}
            </Button>
            <Button variant="destructive" onClick={handleClearDatabase}>
              {t("common.clearDatabase")}
            </Button>
          </div>

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
