import { createSignal, onMount, Show } from "solid-js";
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
} from "../../../src/components/ui/card";
import { Input } from "../../../src/components/ui/input";
import { Button } from "../../../src/components/ui/button";
import { Alert } from "../../../src/components/ui/alert";
import { getSettings, saveSettings } from "../../../src/db";
import { useI18n } from "../../../src/i18n";

export default function GistSyncSettings() {
  const { t } = useI18n();
  const [gistId, setGistId] = createSignal("");
  const [linkGistId, setLinkGistId] = createSignal("");
  const [syncEnabled, setSyncEnabled] = createSignal(false);
  const [lastSync, setLastSync] = createSignal<string | null>(null);
  const [status, setStatus] = createSignal<{
    message: string;
    type: "success" | "error" | "info";
  } | null>(null);
  const [isSyncing, setIsSyncing] = createSignal(false);
  const [isCreating, setIsCreating] = createSignal(false);
  const [isUploading, setIsUploading] = createSignal(false);
  const [isDownloading, setIsDownloading] = createSignal(false);
  const [bookmarkCount, setBookmarkCount] = createSignal(0);

  /** 内联确认对话框状态 */
  const [pendingAction, setPendingAction] = createSignal<
    | { type: "upload"; title: string; message: string }
    | { type: "download"; title: string; message: string }
    | null
  >(null);

  const formatError = (error: unknown): string => {
    let msg: string;
    if (error instanceof Error) {
      msg = error.message;
    } else {
      msg = String(error);
    }
    // 友好提示 Gist 大小超限
    if (msg.includes("过大") || msg.includes("GistSizeError")) {
      msg += " " + t("options.gist.sizeError");
    }
    return msg;
  };

  /** 统计浏览器书签总数 */
  const countBookmarks = (nodes: Array<{ url?: string; children?: any[] }>): number => {
    let count = 0;
    for (const node of nodes) {
      if (node.url) count++;
      if (node.children) count += countBookmarks(node.children);
    }
    return count;
  };

  // 初始化
  onMount(async () => {
    const settings = await getSettings();
    setGistId(settings.gistId || "");
    setSyncEnabled(settings.gistSyncEnabled || false);
    if (settings.lastGistSync) {
      setLastSync(new Date(settings.lastGistSync).toLocaleString());
    }
    // 统计本地书签数量
    try {
      const tree = await browser.bookmarks.getTree();
      setBookmarkCount(countBookmarks(tree));
    } catch {
      // 忽略统计失败
    }
  });

  const handleCreate = async () => {
    setIsCreating(true);
    setStatus({ message: t("options.gist.creating"), type: "info" });
    try {
      const result = await browser.runtime.sendMessage({ type: "GIST_CREATE" });
      if (result.success) {
        setGistId(result.gistId);
        setSyncEnabled(true);
        setLastSync(new Date().toLocaleString());
        await saveSettings({ gistId: result.gistId, gistSyncEnabled: true });
        setStatus({
          message: t("options.gist.createSuccess", { gistId: result.gistId }),
          type: "success",
        });
      } else {
        setStatus({
          message: `${t("common.createFailed")}: ${result.error}`,
          type: "error",
        });
      }
    } catch (error) {
      setStatus({
        message: `${t("common.createFailed")}: ${formatError(error)}`,
        type: "error",
      });
    } finally {
      setIsCreating(false);
    }
  };

  const handleLink = async () => {
    const id = linkGistId().trim();
    if (!id) {
      setStatus({ message: t("options.gist.gistIdRequired"), type: "error" });
      return;
    }
    setIsSyncing(true);
    setStatus({ message: t("options.gist.linking"), type: "info" });
    try {
      const result = await browser.runtime.sendMessage({
        type: "GIST_LINK",
        gistId: id,
      });
      if (result.success) {
        setGistId(id);
        setSyncEnabled(false);
        setLinkGistId("");
        await saveSettings({ gistId: id, gistSyncEnabled: false });
        setStatus({
          message: t("options.gist.linkSuccess", { gistId: result.gistId }),
          type: "success",
        });
      } else {
        setStatus({
          message: `${t("common.linkFailed")}: ${result.error}`,
          type: "error",
        });
      }
    } catch (error) {
      setStatus({
        message: `${t("common.linkFailed")}: ${formatError(error)}`,
        type: "error",
      });
    } finally {
      setIsSyncing(false);
    }
  };

  const handleSync = async () => {
    setIsSyncing(true);
    setStatus({ message: t("options.gist.syncInfo"), type: "info" });
    try {
      const result = await browser.runtime.sendMessage({ type: "GIST_SYNC" });
      if (result.success) {
        setLastSync(new Date().toLocaleString());
        setStatus({
          message: t("options.gist.syncSuccess", { added: result.added, removed: result.removed, uploaded: result.uploaded }),
          type: "success",
        });
      } else {
        setStatus({
          message: `${t("common.syncFailed")}: ${result.error}`,
          type: "error",
        });
      }
    } catch (error) {
      setStatus({
        message: `${t("common.syncFailed")}: ${formatError(error)}`,
        type: "error",
      });
    } finally {
      setIsSyncing(false);
    }
  };

  const handleUpload = () => {
    setPendingAction({
      type: "upload",
      title: t("options.gist.confirmUploadTitle"),
      message:
        t("options.gist.confirmUploadBody"),
    });
  };

  const handleDownload = () => {
    setPendingAction({
      type: "download",
      title: t("options.gist.confirmDownloadTitle"),
      message:
        t("options.gist.confirmDownloadBody"),
    });
  };

  const executePendingAction = async () => {
    const action = pendingAction();
    if (!action) return;
    setPendingAction(null);

    if (action.type === "upload") {
      setIsUploading(true);
      setStatus({ message: t("options.gist.uploadInfo"), type: "info" });
      try {
        const result = await browser.runtime.sendMessage({ type: "GIST_UPLOAD" });
        if (result.success) {
          setLastSync(new Date().toLocaleString());
          setStatus({
            message: t("options.gist.uploadSuccess", { uploaded: result.uploaded }),
            type: "success",
          });
        } else {
          setStatus({
            message: `${t("common.uploadFailed")}: ${result.error}`,
            type: "error",
          });
        }
      } catch (error) {
        setStatus({
          message: `${t("common.uploadFailed")}: ${formatError(error)}`,
          type: "error",
        });
      } finally {
        setIsUploading(false);
      }
      return;
    }

    if (action.type === "download") {
      setIsDownloading(true);
      setStatus({ message: t("options.gist.downloadInfo"), type: "info" });
      try {
        const result = await browser.runtime.sendMessage({ type: "GIST_DOWNLOAD" });
        if (result.success) {
          setLastSync(new Date().toLocaleString());
          setStatus({
            message: t("options.gist.downloadSuccess", { added: result.added, removed: result.removed }),
            type: "success",
          });
        } else {
          setStatus({
            message: `${t("common.downloadFailed")}: ${result.error}`,
            type: "error",
          });
        }
      } catch (error) {
        setStatus({
          message: `${t("common.downloadFailed")}: ${formatError(error)}`,
          type: "error",
        });
      } finally {
        setIsDownloading(false);
      }
    }
  };

  const handleToggle = async () => {
    const newValue = !syncEnabled();
    setSyncEnabled(newValue);
    await saveSettings({ gistSyncEnabled: newValue });
    setStatus({
      message: newValue ? t("options.gist.autoSyncEnabled") : t("options.gist.autoSyncDisabled"),
      type: newValue ? "success" : "info",
    });
  };

  return (
    <Card class="mb-6">
      <CardHeader>
        <CardTitle>{t("options.gist.title")}</CardTitle>
      </CardHeader>
      <CardContent>
        <p class="text-sm text-muted-foreground mb-4">
          {t("options.gist.description")}
        </p>

        <Show when={!gistId()}>
          {/* 尚未关联 Gist */}
          <div class="space-y-4">
            <Button onClick={handleCreate} disabled={isCreating()}>
              {isCreating() ? t("common.creating") : t("options.gist.createGist")}
            </Button>

            <div class="flex items-end gap-2">
              <Input
                label={t("options.gist.linkGist")}
                placeholder={t("options.gist.gistIdPlaceholder")}
                value={linkGistId()}
                onInput={(e) => setLinkGistId(e.currentTarget.value)}
                hint={t("options.gist.gistIdHint")}
              />
              <Button
                variant="outline"
                onClick={handleLink}
                disabled={isSyncing()}
                class="shrink-0 mb-6 ml-5"
              >
                {isSyncing() ? t("common.linking") : t("common.link")}
              </Button>
            </div>
          </div>
        </Show>

        <Show when={!!gistId()}>
          {/* 已关联 Gist */}
          <div class="space-y-4">
            <div class="flex items-center gap-3 p-3 rounded-md bg-muted/50">
              <span class="text-sm font-medium">Gist ID:</span>
              <code class="text-xs bg-background px-2 py-1 rounded border">
                {gistId()}
              </code>
              <span class="text-xs text-muted-foreground ml-auto">
                {t("options.gist.localBookmarks", { count: bookmarkCount() })}
              </span>
            </div>

            <div class="flex items-center gap-3">
              <label class="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={syncEnabled()}
                  onChange={handleToggle}
                  class="w-4 h-4 rounded"
                />
                <span class="text-sm">{t("options.gist.autoSync")}</span>
              </label>
            </div>

            <div class="flex gap-3 flex-wrap">
              <Button onClick={handleSync} disabled={isSyncing()}>
                {isSyncing() ? t("common.syncing") : t("common.sync")}
              </Button>
              <Button
                variant="outline"
                onClick={handleUpload}
                disabled={isUploading()}
              >
                {isUploading() ? t("common.uploading") : t("common.upload")}
              </Button>
              <Button
                variant="outline"
                onClick={handleDownload}
                disabled={isDownloading()}
              >
                {isDownloading() ? t("common.downloading") : t("common.download")}
              </Button>
            </div>
          </div>
        </Show>

        <Show when={pendingAction()}>
          <div class="mt-4 p-4 rounded-lg border bg-amber-50 border-amber-200 dark:bg-amber-950 dark:border-amber-800">
            <p class="text-sm font-semibold text-amber-900 dark:text-amber-100 mb-1">
              {pendingAction()!.title}
            </p>
            <p class="text-sm text-amber-800 dark:text-amber-200 mb-3">
              {pendingAction()!.message}
            </p>
            <div class="flex gap-2">
              <Button
                size="sm"
                onClick={executePendingAction}
                disabled={isUploading() || isDownloading()}
              >
                {t("common.confirm")}
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setPendingAction(null)}
                disabled={isUploading() || isDownloading()}
              >
                {t("common.cancel")}
              </Button>
            </div>
          </div>
        </Show>

        <Alert
          variant={status()?.type}
          visible={status() !== null}
          class="mt-4"
        >
          {status()?.message}
        </Alert>

        {lastSync() && (
          <p class="text-xs text-muted-foreground mt-3">
            {t("common.lastSync")}: {lastSync()}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
