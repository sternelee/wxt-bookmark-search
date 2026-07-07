import { createSignal, onMount, Show, For } from "solid-js";
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
} from "../../../src/components/ui/card";
import { Button } from "../../../src/components/ui/button";
import { Checkbox } from "../../../src/components/ui/checkbox";
import { Alert } from "../../../src/components/ui/alert";
import { getSettings, saveSettings } from "../../../src/db";
import { useI18n } from "../../../src/i18n";

function formatErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export default function CategorizeSettings() {
  const { t } = useI18n();
  const [enabled, setEnabled] = createSignal(false);
  const [rules, setRules] = createSignal("");
  const [status, setStatus] = createSignal<{
    message: string;
    type: "success" | "error" | "info";
  } | null>(null);
  const [analyzing, setAnalyzing] = createSignal(false);
  const [applying, setApplying] = createSignal(false);
  // 确认对话框
  const [confirmOpen, setConfirmOpen] = createSignal(false);
  const [confirmMoveCount, setConfirmMoveCount] = createSignal(0);
  const [suggestions, setSuggestions] = createSignal<
    {
      bookmarkId: string;
      url: string;
      title: string;
      suggestedCategory: string;
      confidence: "high" | "medium" | "low";
      reasoning: string;
      _accepted: boolean;
    }[]
  >([]);
  const [categoryFolderMap, setCategoryFolderMap] = createSignal<
    Record<string, string>
  >({});

  onMount(async () => {
    const settings = await getSettings();
    setEnabled(settings.autoCategorizeEnabled || false);
    setRules(settings.categoryRules || "");
    setCategoryFolderMap(settings.categoryFolderMap || {});
  });

  const handleSave = async () => {
    try {
      await saveSettings({
        autoCategorizeEnabled: enabled(),
        categoryRules: rules(),
        categoryFolderMap: categoryFolderMap(),
      });
      setStatus({ message: t("options.categorize.saved"), type: "success" });
    } catch (e) {
      setStatus({ message: formatErrorMessage(e), type: "error" });
    }
  };

  const handleAnalyze = async () => {
    setAnalyzing(true);
    setStatus(null);
    setSuggestions([]);

    try {
      // 获取所有已索引书签
      const settings = await getSettings();
      if (!settings.openaiApiKey) {
        setStatus({
          message: t("background.apiKeyNotConfigured"),
          type: "error",
        });
        return;
      }

      // 获取已索引书签 ID 列表
      const { getIndexedBookmarks } = await import("../../../src/db");
      const indexed = await getIndexedBookmarks();
      const bookmarkIds = indexed.map((r) => r.id);

      if (bookmarkIds.length === 0) {
        setStatus({
          message: t("options.categorize.noIndexedBookmarks"),
          type: "info",
        });
        return;
      }

      const response = await browser.runtime.sendMessage({
        type: "GET_CATEGORY_SUGGESTIONS",
        bookmarkIds,
      });

      if (response.success) {
        const withAccepted = (response.suggestions || []).map(
          (s: {
            bookmarkId: string;
            url: string;
            title: string;
            suggestedCategory: string;
            confidence: string;
            reasoning: string;
          }) => ({
            ...s,
            _accepted: s.confidence === "high" || s.confidence === "medium",
          }),
        );
        setSuggestions(withAccepted);
        setStatus({
          message: t("options.categorize.suggestionsFound", {
            count: withAccepted.length,
          }),
          type: "info",
        });
      } else {
        setStatus({
          message: response.error || t("common.unknownError"),
          type: "error",
        });
      }
    } catch (e) {
      setStatus({ message: formatErrorMessage(e), type: "error" });
    } finally {
      setAnalyzing(false);
    }
  };

  const handleApply = async () => {
    const toApply = suggestions().filter((s) => s._accepted);
    if (toApply.length === 0) {
      setStatus({
        message: t("options.categorize.noSuggestionsAccepted"),
        type: "info",
      });
      return;
    }

    // 先弹出确认对话框
    setConfirmMoveCount(toApply.length);
    setConfirmOpen(true);
  };

  const confirmApply = async () => {
    setConfirmOpen(false);
    const toApply = suggestions().filter((s) => s._accepted);

    setApplying(true);
    try {
      const response = await browser.runtime.sendMessage({
        type: "APPLY_CATEGORIES",
        suggestions: toApply.map((s) => ({
          bookmarkId: s.bookmarkId,
          url: s.url,
          title: s.title,
          suggestedCategory: s.suggestedCategory,
          confidence: s.confidence,
          reasoning: s.reasoning,
        })),
        categoryFolderMap: categoryFolderMap(),
      });

      if (response.success) {
        // 更新 categoryFolderMap（新的文件夹可能已被创建）
        const updatedMap = { ...categoryFolderMap() };
        if (response.moved > 0) {
          // 后台可能创建了新文件夹，重新获取映射
          const mapRes = await browser.runtime.sendMessage({
            type: "GET_CATEGORY_FOLDERS",
          });
          if (mapRes.success) {
            setCategoryFolderMap(mapRes.folderMap);
          }
        }

        await saveSettings({ categoryFolderMap: updatedMap });

        setStatus({
          message: t("options.categorize.applySuccess", {
            moved: response.moved,
            created: response.created,
            skipped: response.skipped,
          }),
          type: "success",
        });
        setSuggestions([]);
      } else {
        setStatus({
          message: response.error || t("common.unknownError"),
          type: "error",
        });
      }
    } catch (e) {
      setStatus({ message: formatErrorMessage(e), type: "error" });
    } finally {
      setApplying(false);
    }
  };

  const toggleAccepted = (index: number) => {
    setSuggestions((prev) =>
      prev.map((s, i) => (i === index ? { ...s, _accepted: !s._accepted } : s)),
    );
  };

  const confidenceClass = (c: string) => {
    switch (c) {
      case "high":
        return "text-green-600";
      case "medium":
        return "text-yellow-600";
      case "low":
        return "text-red-600";
      default:
        return "";
    }
  };

  return (
    <>
    <Card class="mb-6">
      <CardHeader>
        <CardTitle>{t("options.categorize.title")}</CardTitle>
      </CardHeader>
      <CardContent>
        <Checkbox
          label={t("options.categorize.enableLabel")}
          checked={enabled()}
          onChange={(e) => setEnabled(e.currentTarget.checked)}
          hint={t("options.categorize.enableHint")}
        />

        <div class="mt-4">
          <label class="text-sm font-medium block mb-1">
            {t("options.categorize.rulesLabel")}
          </label>
          <textarea
            class="w-full rounded-md border border-input bg-background px-3 py-2 text-sm min-h-[80px]"
            placeholder="e.g. Repos about compilers should be categorized as Rust"
            value={rules()}
            onInput={(e) => setRules(e.currentTarget.value)}
          />
          <p class="text-xs text-muted-foreground mt-1">
            {t("options.categorize.rulesHint")}
          </p>
        </div>

        <Button onClick={handleSave} class="mt-4 mb-4">
          {t("common.save")}
        </Button>

        <div class="border-t pt-4">
          <Button
            variant="outline"
            onClick={handleAnalyze}
            disabled={analyzing()}
            class="mb-4"
          >
            {analyzing()
              ? t("options.categorize.analyzing")
              : t("options.categorize.analyzeButton")}
          </Button>

          <Show when={suggestions().length > 0}>
            <div class="overflow-x-auto">
              <table class="w-full text-sm">
                <thead>
                  <tr class="border-b">
                    <th class="text-left py-2 w-8">✓</th>
                    <th class="text-left py-2">{t("common.search")}</th>
                    <th class="text-left py-2">
                      {t("options.categorize.suggestedCategory")}
                    </th>
                    <th class="text-left py-2">Confidence</th>
                    <th class="text-left py-2">Reasoning</th>
                  </tr>
                </thead>
                <tbody>
                  <For each={suggestions()}>
                    {(item, index) => (
                      <tr class="border-b">
                        <td class="py-1">
                          <input
                            type="checkbox"
                            checked={item._accepted}
                            onChange={() => toggleAccepted(index())}
                          />
                        </td>
                        <td class="py-1">
                          <a
                            href={item.url}
                            target="_blank"
                            class="text-blue-600 hover:underline"
                          >
                            {item.title.slice(0, 50)}
                          </a>
                        </td>
                        <td class="py-1 font-medium">
                          {item.suggestedCategory}
                        </td>
                        <td class={`py-1 ${confidenceClass(item.confidence)}`}>
                          {item.confidence}
                        </td>
                        <td class="py-1 text-xs text-muted-foreground max-w-[200px] truncate">
                          {item.reasoning}
                        </td>
                      </tr>
                    )}
                  </For>
                </tbody>
              </table>
            </div>

            <Button onClick={handleApply} disabled={applying()} class="mt-4">
              {applying()
                ? t("options.categorize.applying")
                : t("options.categorize.applyButton")}
            </Button>
          </Show>
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
    <Show when={confirmOpen()}>
      <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
        <div class="bg-background border rounded-lg shadow-lg p-6 max-w-md w-full mx-4">
          <h3 class="text-lg font-semibold text-destructive mb-2">
            {t("options.categorize.confirmApplyTitle")}
          </h3>
          <p class="text-sm text-muted-foreground mb-4">
            {t("options.categorize.confirmApplyBody", { count: confirmMoveCount() })}
          </p>
          <div class="flex gap-2 justify-end">
            <Button variant="outline" onClick={() => setConfirmOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button variant="destructive" onClick={confirmApply}>
              {t("common.confirm")}
            </Button>
          </div>
        </div>
      </div>
    </Show>
    </>
  );
}
