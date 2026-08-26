import { createSignal, onMount, For, Show } from "solid-js";
import { Card, CardHeader, CardTitle, CardContent } from "../../../src/components/ui/card";
import { Button } from "../../../src/components/ui/button";
import { Alert } from "../../../src/components/ui/alert";
import { useI18n } from "../../../src/i18n";

interface FailedItem {
  id: string;
  url: string;
  title: string;
  error?: string;
}

export default function FailedBookmarks() {
  const { t } = useI18n();
  const [failedItems, setFailedItems] = createSignal<FailedItem[]>([]);
  const [isVisible, setIsVisible] = createSignal(false);
  const [status, setStatus] = createSignal<{
    message: string;
    type: "success" | "error" | "info";
  } | null>(null);

  // 确认对话框（替代原生 confirm）
  const [confirmId, setConfirmId] = createSignal("");
  const [confirmTitle, setConfirmTitle] = createSignal("");
  const [confirmOpen, setConfirmOpen] = createSignal(false);

  const loadFailed = async () => {
    try {
      const response = await browser.runtime.sendMessage({
        type: "GET_FAILED_BOOKMARKS",
      }) as {
        success: boolean;
        failed: FailedItem[];
      };

      if (response.success && response.failed.length > 0) {
        setFailedItems(response.failed);
        setIsVisible(true);
      } else {
        setIsVisible(false);
      }
    } catch (error) {
      console.error("Failed to load failed bookmarks:", error);
      setIsVisible(true);
      setFailedItems([]);
      setStatus({
        message: t("common.unknownError"),
        type: "error",
      });
    }
  };

  onMount(() => {
    loadFailed().catch((err) =>
      console.error("Failed to load failed bookmarks:", err),
    );
  });

  const showConfirm = (item: FailedItem) => {
    setConfirmId(item.id);
    setConfirmTitle(item.title || item.url);
    setConfirmOpen(true);
  };

  const handleDeleteConfirm = async () => {
    const id = confirmId();
    setConfirmOpen(false);
    setStatus(null);

    try {
      const res = await browser.runtime.sendMessage({
        type: "DELETE_BOOKMARK",
        id,
      });

      if (res.success) {
        setFailedItems(failedItems().filter((item) => item.id !== id));
        if (failedItems().length <= 1) {
          setIsVisible(false);
        }
      } else {
        setStatus({
          message: t("options.failedBookmarks.deleteFailed") + ": " + (res.error || t("common.unknownError")),
          type: "error",
        });
      }
    } catch (error) {
      setStatus({
        message: t("options.failedBookmarks.deleteFailed") + ": " + (error instanceof Error ? error.message : String(error)),
        type: "error",
      });
    }
  };

  return (
    <>
    <Show when={isVisible()}>
      <Card class="mb-6">
        <CardHeader>
          <CardTitle>{t("options.failedBookmarks.title")}</CardTitle>
        </CardHeader>
        <CardContent>
          <p class="text-xs text-muted-foreground mb-3">
            {t("options.failedBookmarks.description")}
          </p>

          <div class="max-h-96 overflow-y-auto border border-border rounded-lg">
            <For each={failedItems()}>
              {(item) => (
                <div class="flex items-center px-4 py-3.5 border-b border-border last:border-b-0 gap-3 hover:bg-muted transition-all">
                  <div class="flex-1 overflow-hidden">
                    <span class="block text-sm font-semibold truncate">
                      {item.title || t("options.failedBookmarks.noTitle")}
                    </span>
                    <a
                      href={item.url}
                      target="_blank"
                      class="block text-xs text-muted-foreground truncate hover:text-primary hover:underline"
                      title={t("options.failedBookmarks.visit")}
                    >
                      {item.url}
                    </a>
                    <div class="text-[11px] text-destructive mt-0.5 opacity-80">
                      {t("options.failedBookmarks.errorLabel")}: {item.error || t("common.unknownError")}
                    </div>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => showConfirm(item)}
                    class="whitespace-nowrap"
                  >
                    {t("common.delete")}
                  </Button>
                </div>
              )}
            </For>
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
    </Show>

    {/* 确认对话框 */}
    <Show when={confirmOpen()}>
      <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
        <div class="bg-background border rounded-lg shadow-lg p-6 max-w-md w-full mx-4">
          <h3 class="text-lg font-semibold text-destructive mb-2">
            {t("options.failedBookmarks.deleteConfirm")}
          </h3>
          <p class="text-sm text-muted-foreground mb-4 break-all">{confirmTitle()}</p>
          <div class="flex gap-2 justify-end">
            <Button variant="outline" onClick={() => setConfirmOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button variant="destructive" onClick={handleDeleteConfirm}>
              {t("common.delete")}
            </Button>
          </div>
        </div>
      </div>
    </Show>
    </>
  );
}
