import { createSignal, onMount, For, Show } from "solid-js";
import { Card, CardHeader, CardTitle, CardContent } from "../../../src/components/ui/card";
import { Button } from "../../../src/components/ui/button";

interface FailedItem {
  id: string;
  url: string;
  title: string;
  error?: string;
}

export default function FailedBookmarks() {
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
    if (!confirm("确定要从浏览器中永久删除这个书签吗？")) {
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
        alert("删除失败: " + (res.error || "未知错误"));
      }
    } catch (error) {
      alert("删除失败: " + error);
    }
  };

  return (
    <Show when={isVisible()}>
      <Card class="mb-6">
        <CardHeader>
          <CardTitle>⚠️ 失效 / 索引失败管理</CardTitle>
        </CardHeader>
        <CardContent>
          <p class="text-xs text-muted-foreground mb-3">
            以下书签在索引过程中遇到错误，可能是网址已失效。你可以点击链接测试或直接删除书签。
          </p>

          <div class="max-h-96 overflow-y-auto border border-border rounded-lg">
            <For each={failedItems()}>
              {(item) => (
                <div class="flex items-center px-4 py-3.5 border-b border-border last:border-b-0 gap-3 hover:bg-muted transition-all">
                  <div class="flex-1 overflow-hidden">
                    <span class="block text-sm font-semibold truncate">
                      {item.title || "无标题"}
                    </span>
                    <a
                      href={item.url}
                      target="_blank"
                      class="block text-xs text-muted-foreground truncate hover:text-primary hover:underline"
                      title="点击访问"
                    >
                      {item.url}
                    </a>
                    <div class="text-[11px] text-destructive mt-0.5 opacity-80">
                      错误: {item.error || "未知错误"}
                    </div>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleDelete(item.id)}
                    class="whitespace-nowrap"
                  >
                    🗑️ 删除书签
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
