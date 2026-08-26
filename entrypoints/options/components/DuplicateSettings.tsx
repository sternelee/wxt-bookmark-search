import { createSignal, Show } from "solid-js";
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
} from "../../../src/components/ui/card";
import { Button } from "../../../src/components/ui/button";
import { Alert } from "../../../src/components/ui/alert";
import { useI18n } from "../../../src/i18n";

function formatErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export default function DuplicateSettings() {
  const { t } = useI18n();
  const [scanning, setScanning] = createSignal(false);
  const [status, setStatus] = createSignal<{
    message: string;
    type: "success" | "error" | "info";
  } | null>(null);
  const [duplicates, setDuplicates] = createSignal<
    {
      url: string;
      bookmarks: { id: string; title: string; folderPath: string[] }[];
    }[]
  >([]);

  // 确认对话框（防止误删书签）
  const [confirmId, setConfirmId] = createSignal<string>("");
  const [confirmGroupIdx, setConfirmGroupIdx] = createSignal(0);
  const [confirmOpen, setConfirmOpen] = createSignal(false);

  const handleScan = async () => {
    setScanning(true);
    setStatus(null);
    setDuplicates([]);
    try {
      const response = await browser.runtime.sendMessage({
        type: "FIND_DUPLICATES",
      });
      if (response.success) {
        const groups = (response.duplicates || []).map(
          (g: {
            url: string;
            bookmarks: { id: string; title: string }[];
            folderPaths: string[][];
          }) => ({
            url: g.url,
            bookmarks: g.bookmarks.map((b, i) => ({
              id: b.id,
              title: b.title,
              folderPath: g.folderPaths[i] || [],
            })),
          }),
        );
        setDuplicates(groups);
        setStatus({
          message: t("options.duplicates.duplicatesFound", {
            count: groups.length,
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
      setScanning(false);
    }
  };

  const handleResolve = async (keepId: string, groupIndex: number) => {
    // 先弹出确认对话框
    setConfirmId(keepId);
    setConfirmGroupIdx(groupIndex);
    setConfirmOpen(true);
  };

  const confirmResolve = async () => {
    const keepId = confirmId();
    const groupIndex = confirmGroupIdx();
    setConfirmOpen(false);
    const group = duplicates()[groupIndex];
    const deleteIds = group.bookmarks
      .filter((b) => b.id !== keepId)
      .map((b) => b.id);

    try {
      const response = await browser.runtime.sendMessage({
        type: "RESOLVE_DUPLICATES",
        keepId,
        deleteIds,
      });
      if (response.success) {
        setDuplicates((prev) => prev.filter((_, i) => i !== groupIndex));
        setStatus({
          message: t("options.duplicates.resolveSuccess"),
          type: "success",
        });
      } else {
        setStatus({
          message: response.error || t("common.unknownError"),
          type: "error",
        });
      }
    } catch (e) {
      setStatus({ message: formatErrorMessage(e), type: "error" });
    }
  };

  return (
    <>
    <Card class="mb-6">
      <CardHeader>
        <CardTitle>{t("options.duplicates.title")}</CardTitle>
      </CardHeader>
      <CardContent>
        <Button onClick={handleScan} disabled={scanning()}>
          {scanning()
            ? t("options.duplicates.scanning")
            : t("options.duplicates.scanButton")}
        </Button>

        <Show when={duplicates().length > 0}>
          <div class="mt-4 space-y-4">
            {duplicates().map((group, gi) => (
              <div class="p-3 border rounded-md">
                <div class="text-xs text-muted-foreground break-all mb-2 font-mono">
                  {group.url}
                </div>
                {group.bookmarks.map((b) => (
                  <div class="flex items-center justify-between gap-2 py-1 text-sm">
                    <div class="min-w-0 overflow-hidden">
                      <span class="truncate block">{b.title}</span>
                      <span class="text-xs text-muted-foreground truncate block">
                        {b.folderPath.join(" / ")}
                      </span>
                    </div>
                    <Button
                      size="sm"
                      class="shrink-0"
                      onClick={() => handleResolve(b.id, gi)}
                    >
                      {t("options.duplicates.keep")}
                    </Button>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </Show>

        <Show
          when={!scanning() && duplicates().length === 0 && status() !== null}
        >
          <div class="mt-4 text-sm text-muted-foreground">
            {t("options.duplicates.noDuplicates")}
          </div>
        </Show>

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
            {t("options.duplicates.confirmResolveTitle")}
          </h3>
          <p class="text-sm text-muted-foreground mb-1">
            {t("options.duplicates.confirmResolveBody")}
          </p>
          <div class="text-xs text-muted-foreground mb-4">
            {(() => {
              const g = duplicates()[confirmGroupIdx()];
              if (!g) return null;
              const keep = g.bookmarks.find((b: { id: string; title: string }) => b.id === confirmId());
              const del = g.bookmarks.filter((b: { id: string; title: string }) => b.id !== confirmId());
              return (
                <div>
                  <div class="text-green-600 dark:text-green-400">
                    ✓ {t("options.duplicates.keep")}: {keep?.title}
                  </div>
                  {del.map((b: { id: string; title: string }) => (
                    <div class="text-red-500">✕ {b.title}</div>
                  ))}
                </div>
              );
            })()}
          </div>
          <div class="flex gap-2 justify-end">
            <Button variant="outline" onClick={() => setConfirmOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button variant="destructive" onClick={confirmResolve}>
              {t("common.confirm")}
            </Button>
          </div>
        </div>
      </div>
    </Show>
    </>
  );
}
