import { createSignal, onMount, For, Show } from "solid-js";
import { Card, CardHeader, CardTitle, CardContent } from "../../../src/components/ui/card";
import { Button } from "../../../src/components/ui/button";
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
    }
  };

  onMount(loadFailed);

  const handleDelete = async (id: string) => {
    if (!confirm(t("options.failedBookmarks.deleteConfirm"))) {
      return;
    }

    try {
      const res = await browser.runtime.sendMessage({
        type: "DELETE_BOOKMARK",
        id,
      });

      if (res.success) {
        setFailedItems(failedItems().filter(item => item.id !== id));
        if (failedItems().length === 0) {
          setIsVisible(false);
        }
      } else {
        alert(t("options.failedBookmarks.deleteFailed") + ": " + (res.error || t("common.unknownError")));
      }
    } catch (error) {
      alert(t("options.failedBookmarks.deleteFailed") + ": " + error);
    }
  };

  return (
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
                    onClick={() => handleDelete(item.id)}
                    class="whitespace-nowrap"
                  >
                    {t("common.delete")}
                  </Button>
                </div>
              )}
            </For>
          </div>
        </CardContent>
      </Card>
    </Show>
  );
}
