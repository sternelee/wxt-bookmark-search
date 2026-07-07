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
import { Select } from "../../../src/components/ui/select";
import { getSettings, saveSettings } from "../../../src/db";
import { useI18n } from "../../../src/i18n";
import { CloudSyncError } from "../../../src/cloud-sync/types";

type ProviderValue = "" | "google-drive" | "dropbox" | "webdav";

export default function CloudSyncSettings() {
  const { t } = useI18n();

  const [provider, setProvider] = createSignal<ProviderValue>("");
  const [token, setToken] = createSignal("");
  const [showToken, setShowToken] = createSignal(false);
  const [webdavUrl, setWebdavUrl] = createSignal("");
  const [webdavUsername, setWebdavUsername] = createSignal("");
  const [enabled, setEnabled] = createSignal(false);
  const [interval, setIntervalH] = createSignal(24);
  const [vectorEnabled, setVectorEnabled] = createSignal(true);
  const [bookmarksEnabled, setBookmarksEnabled] = createSignal(false);
  const [lastSync, setLastSync] = createSignal<string | null>(null);
  const [deviceId, setDeviceId] = createSignal<string | null>(null);
  const [remoteSize, setRemoteSize] = createSignal<number | null>(null);
  const [remoteModifiedAt, setRemoteModifiedAt] = createSignal<string | null>(
    null,
  );
  const [status, setStatus] = createSignal<{
    message: string;
    type: "success" | "error" | "info";
  } | null>(null);
  const [isTesting, setIsTesting] = createSignal(false);

  // 向量操作
  const [isUploadingVector, setIsUploadingVector] = createSignal(false);
  const [isDownloadingVector, setIsDownloadingVector] = createSignal(false);
  const [pendingVectorDownload, setPendingVectorDownload] = createSignal(false);

  // 书签操作
  const [isSyncingBookmarks, setIsSyncingBookmarks] = createSignal(false);
  const [isUploadingBookmarks, setIsUploadingBookmarks] = createSignal(false);
  const [isDownloadingBookmarks, setIsDownloadingBookmarks] = createSignal(false);
  const [pendingBookmarkDownload, setPendingBookmarkDownload] = createSignal(false);

  // 确认对话框（替代原生 confirm）
  const [confirmDialog, setConfirmDialog] = createSignal<{
    open: boolean;
    title: string;
    message: string;
    variant: "destructive" | "default";
    onConfirm: () => void;
  }>({
    open: false,
    title: "",
    message: "",
    variant: "default",
    onConfirm: () => {},
  });

  // 删除操作
  const [isDeleting, setIsDeleting] = createSignal(false);

  const formatError = (error: unknown): string => {
    if (error instanceof CloudSyncError) {
      switch (error.code) {
        case "AUTH":
          return t("options.cloudSync.tokenExpired");
        case "SIZE":
          return t("options.cloudSync.sizeError");
        case "VERSION":
          return t("options.cloudSync.versionError");
        default:
          return error.message;
      }
    }
    if (error instanceof Error) return error.message;
    return String(error);
  };

  const refreshRemote = async () => {
    setRemoteSize(null);
    setRemoteModifiedAt(null);
    if (!provider() || !hasTokenOrPassword()) return;
    try {
      const res = await browser.runtime.sendMessage({
        type: "CLOUD_SYNC_GET_STATUS",
      });
      if (res?.success && res.exists) {
        if (typeof res.size === "number") setRemoteSize(res.size);
        if (typeof res.modifiedAt === "number") {
          setRemoteModifiedAt(new Date(res.modifiedAt).toLocaleString());
        }
      }
    } catch {
      // ignore
    }
  };

  onMount(async () => {
    const settings = await getSettings();
    setProvider((settings.cloudSyncProvider as ProviderValue) || "");
    setToken(settings.cloudSyncToken || "");
    setWebdavUrl(settings.cloudSyncWebdavUrl || "");
    setWebdavUsername(settings.cloudSyncWebdavUsername || "");
    setEnabled(!!settings.cloudSyncEnabled);
    setVectorEnabled(settings.cloudSyncVectorEnabled ?? true);
    setBookmarksEnabled(settings.cloudSyncBookmarksEnabled ?? false);
    setIntervalH(settings.cloudSyncInterval ?? 24);
    if (settings.lastCloudSync) {
      setLastSync(new Date(settings.lastCloudSync).toLocaleString());
    }
    if (settings.cloudSyncDeviceId) setDeviceId(settings.cloudSyncDeviceId);
    await refreshRemote();
  });

  const hasTokenOrPassword = (): boolean => {
    const p = provider();
    if (p === "webdav") {
      return !!webdavUrl() && !!webdavUsername() && !!token();
    }
    return !!token();
  };

  const persistConfig = async () => {
    await saveSettings({
      cloudSyncProvider: (provider() || null) as
        | "google-drive"
        | "dropbox"
        | "webdav"
        | null,
      cloudSyncToken: token() || undefined,
      cloudSyncWebdavUrl: webdavUrl() || undefined,
      cloudSyncWebdavUsername: webdavUsername() || undefined,
      cloudSyncEnabled: enabled(),
      cloudSyncInterval: interval(),
      cloudSyncVectorEnabled: vectorEnabled(),
      cloudSyncBookmarksEnabled: bookmarksEnabled(),
    });
  };

  const handleProviderChange = async (
    e: Event & { currentTarget: HTMLSelectElement },
  ) => {
    setProvider(e.currentTarget.value as ProviderValue);
    await persistConfig();
    setStatus(null);
  };

  const handleTokenBlur = async () => {
    await persistConfig();
  };

  const handleWebdavUrlBlur = async () => {
    let url = webdavUrl().trim();
    if (url) {
      if (!url.endsWith("/")) url += "/";
    }
    setWebdavUrl(url);
    await persistConfig();
  };

  const handleIntervalBlur = async () => {
    let v = interval();
    if (!Number.isFinite(v) || v < 1) v = 1;
    if (v > 24 * 30) v = 24 * 30;
    setIntervalH(v);
    await persistConfig();
    await browser.runtime.sendMessage({ type: "CLOUD_SYNC_REFRESH_ALARM" });
  };

  const handleVectorToggle = async () => {
    const v = !vectorEnabled();
    setVectorEnabled(v);
    await persistConfig();
    setStatus({
      message: v
        ? t("options.cloudSync.vectorEnabled")
        : t("options.cloudSync.vectorDisabled"),
      type: "info",
    });
  };

  const handleBookmarksToggle = async () => {
    const v = !bookmarksEnabled();
    setBookmarksEnabled(v);
    await persistConfig();
    setStatus({
      message: v
        ? t("options.cloudSync.bookmarksEnabled")
        : t("options.cloudSync.bookmarksDisabled"),
      type: "info",
    });
  };

  const handleAutoSyncToggle = async () => {
    const v = !enabled();
    setEnabled(v);
    await persistConfig();
    await browser.runtime.sendMessage({ type: "CLOUD_SYNC_REFRESH_ALARM" });
    setStatus({
      message: v
        ? t("options.cloudSync.autoSyncEnabled")
        : t("options.cloudSync.autoSyncDisabled"),
      type: v ? "success" : "info",
    });
  };

  const handleTest = async () => {
    if (!provider() || !hasTokenOrPassword()) {
      setStatus({
        message: t("options.cloudSync.configRequired"),
        type: "error",
      });
      return;
    }
    setIsTesting(true);
    setStatus({ message: t("options.cloudSync.testing"), type: "info" });
    try {
      const res = await browser.runtime.sendMessage({
        type: "CLOUD_SYNC_TEST_CONNECTION",
        provider: provider(),
        token: token(),
        ...(provider() === "webdav"
          ? { webdavUrl: webdavUrl(), webdavUsername: webdavUsername() }
          : {}),
      });
      if (res?.success) {
        setStatus({
          message: t("options.cloudSync.testSuccess"),
          type: "success",
        });
        await refreshRemote();
      } else {
        setStatus({
          message: t("options.cloudSync.testFailed", {
            error: res?.error || "Unknown",
          }),
          type: "error",
        });
      }
    } catch (e) {
      setStatus({
        message: t("options.cloudSync.testFailed", { error: formatError(e) }),
        type: "error",
      });
    } finally {
      setIsTesting(false);
    }
  };

  // === 向量操作 ===

  const handleUploadVector = async () => {
    if (!provider() || !hasTokenOrPassword()) {
      setStatus({
        message: t("options.cloudSync.configRequired"),
        type: "error",
      });
      return;
    }
    setIsUploadingVector(true);
    setStatus({ message: t("options.cloudSync.uploadingVector"), type: "info" });
    try {
      const res = await browser.runtime.sendMessage({
        type: "CLOUD_SYNC_UPLOAD",
      });
      if (res?.success) {
        setLastSync(new Date(res.uploadedAt).toLocaleString());
        setStatus({
          message: t("options.cloudSync.uploadSuccess", {
            size: formatBytes(res.size),
          }),
          type: "success",
        });
        await refreshRemote();
      } else {
        setStatus({
          message: t("options.cloudSync.uploadFailed", {
            error: res?.error || "Unknown",
          }),
          type: "error",
        });
      }
    } catch (e) {
      setStatus({
        message: t("options.cloudSync.uploadFailed", {
          error: formatError(e),
        }),
        type: "error",
      });
    } finally {
      setIsUploadingVector(false);
    }
  };

  const confirmDownloadVector = () => {
    setPendingVectorDownload(true);
  };

  const executeDownloadVector = async () => {
    setPendingVectorDownload(false);
    setIsDownloadingVector(true);
    setStatus({ message: t("options.cloudSync.downloadingVector"), type: "info" });
    try {
      const res = await browser.runtime.sendMessage({
        type: "CLOUD_SYNC_DOWNLOAD",
      });
      if (res?.success) {
        setLastSync(new Date(res.modifiedAt).toLocaleString());
        setStatus({
          message: t("options.cloudSync.downloadSuccess", {
            count: res.bookmarkCount,
          }),
          type: "success",
        });
        await refreshRemote();
      } else {
        setStatus({
          message: t("options.cloudSync.downloadFailed", {
            error: res?.error || "Unknown",
          }),
          type: "error",
        });
      }
    } catch (e) {
      setStatus({
        message: t("options.cloudSync.downloadFailed", {
          error: formatError(e),
        }),
        type: "error",
      });
    } finally {
      setIsDownloadingVector(false);
    }
  };

  // === 书签操作 ===

  const handleSyncBookmarks = async () => {
    if (!provider() || !hasTokenOrPassword()) {
      setStatus({
        message: t("options.cloudSync.configRequired"),
        type: "error",
      });
      return;
    }
    setConfirmDialog({
      open: true,
      title: t("options.cloudSync.confirmBookmarksSyncTitle"),
      message: t("options.cloudSync.confirmBookmarksSyncBody"),
      variant: "destructive",
      onConfirm: executeSyncBookmarks,
    });
  };

  const executeSyncBookmarks = async () => {
    setIsSyncingBookmarks(true);
    setStatus({ message: t("options.cloudSync.syncingBookmarks"), type: "info" });
    try {
      const res = await browser.runtime.sendMessage({
        type: "CLOUD_SYNC_BOOKMARK_SYNC",
      });
      if (res?.success) {
        setStatus({
          message: t("options.cloudSync.bookmarkSyncSuccess", {
            added: res.added,
            removed: res.removed,
            uploaded: res.uploaded,
          }),
          type: "success",
        });
      } else {
        setStatus({
          message: t("options.cloudSync.bookmarkSyncFailed", {
            error: res?.error || "Unknown",
          }),
          type: "error",
        });
      }
    } catch (e) {
      setStatus({
        message: t("options.cloudSync.bookmarkSyncFailed", {
          error: formatError(e),
        }),
        type: "error",
      });
    } finally {
      setIsSyncingBookmarks(false);
    }
  };

  const handleUploadBookmarks = async () => {
    if (!provider() || !hasTokenOrPassword()) {
      setStatus({
        message: t("options.cloudSync.configRequired"),
        type: "error",
      });
      return;
    }
    setIsUploadingBookmarks(true);
    setStatus({ message: t("options.cloudSync.uploadingBookmarks"), type: "info" });
    try {
      const res = await browser.runtime.sendMessage({
        type: "CLOUD_SYNC_BOOKMARK_UPLOAD",
      });
      if (res?.success) {
        setStatus({
          message: t("options.cloudSync.bookmarkUploadSuccess", {
            uploaded: res.uploaded,
          }),
          type: "success",
        });
      } else {
        setStatus({
          message: t("options.cloudSync.bookmarkUploadFailed", {
            error: res?.error || "Unknown",
          }),
          type: "error",
        });
      }
    } catch (e) {
      setStatus({
        message: t("options.cloudSync.bookmarkUploadFailed", {
          error: formatError(e),
        }),
        type: "error",
      });
    } finally {
      setIsUploadingBookmarks(false);
    }
  };

  const confirmDownloadBookmarks = () => {
    setPendingBookmarkDownload(true);
  };

  const executeDownloadBookmarks = async () => {
    setPendingBookmarkDownload(false);
    setIsDownloadingBookmarks(true);
    setStatus({ message: t("options.cloudSync.downloadingBookmarks"), type: "info" });
    try {
      const res = await browser.runtime.sendMessage({
        type: "CLOUD_SYNC_BOOKMARK_DOWNLOAD",
      });
      if (res?.success) {
        setStatus({
          message: t("options.cloudSync.bookmarkDownloadSuccess", {
            added: res.added,
            removed: res.removed,
          }),
          type: "success",
        });
      } else {
        setStatus({
          message: t("options.cloudSync.bookmarkDownloadFailed", {
            error: res?.error || "Unknown",
          }),
          type: "error",
        });
      }
    } catch (e) {
      setStatus({
        message: t("options.cloudSync.bookmarkDownloadFailed", {
          error: formatError(e),
        }),
        type: "error",
      });
    } finally {
      setIsDownloadingBookmarks(false);
    }
  };

  const handleDelete = async () => {
    if (!provider() || !hasTokenOrPassword()) return;
    setConfirmDialog({
      open: true,
      title: t("options.cloudSync.confirmDeleteTitle"),
      message: t("options.cloudSync.confirmDelete"),
      variant: "destructive",
      onConfirm: executeDelete,
    });
  };

  const executeDelete = async () => {
    setIsDeleting(true);
    try {
      const res = await browser.runtime.sendMessage({
        type: "CLOUD_SYNC_DELETE",
      });
      if (res?.success) {
        setLastSync(null);
        setRemoteSize(null);
        setRemoteModifiedAt(null);
        setStatus({
          message: t("options.cloudSync.deleteSuccess"),
          type: "success",
        });
      } else {
        setStatus({
          message: t("options.cloudSync.deleteFailed", {
            error: res?.error || "Unknown",
          }),
          type: "error",
        });
      }
    } catch (e) {
      setStatus({
        message: t("options.cloudSync.deleteFailed", {
          error: formatError(e),
        }),
        type: "error",
      });
    } finally {
      setIsDeleting(false);
    }
  };

  const providerOptions = () => [
    { value: "", label: t("options.cloudSync.providerNone") },
    { value: "google-drive", label: "Google Drive" },
    { value: "dropbox", label: "Dropbox" },
    { value: "webdav", label: "WebDAV (Nextcloud / ownCloud / etc.)" },
  ];

  const tokenLabel = () => {
    const p = provider();
    if (p === "google-drive") return "Access Token";
    if (p === "dropbox") return "Access Token";
    if (p === "webdav") return "Password";
    return t("options.cloudSync.tokenLabel");
  };

  const tokenHint = () => {
    const p = provider();
    if (p === "google-drive") return t("options.cloudSync.tokenHintGoogleDrive");
    if (p === "dropbox") return t("options.cloudSync.tokenHintDropbox");
    if (p === "webdav") return t("options.cloudSync.tokenHintWebdav");
    return "";
  };

  const providerHint = () => t("options.cloudSync.providerHint");

  return (
    <>
    <Card class="mb-6">
      <CardHeader>
        <CardTitle>{t("options.cloudSync.title")}</CardTitle>
      </CardHeader>
      <CardContent>
        <p class="text-sm text-muted-foreground mb-4">
          {t("options.cloudSync.description")}
        </p>

        <Select
          label={t("options.cloudSync.providerLabel")}
          options={providerOptions()}
          value={provider()}
          onChange={handleProviderChange}
          hint={providerHint()}
        />

        <Show when={!!provider()}>
          {/* WebDAV URL + Username */}
          <Show when={provider() === "webdav"}>
            <Input
              label={t("options.cloudSync.webdavUrlLabel")}
              type="url"
              placeholder={t("options.cloudSync.webdavUrlPlaceholder")}
              value={webdavUrl()}
              onInput={(e) => setWebdavUrl(e.currentTarget.value)}
              onBlur={handleWebdavUrlBlur}
              hint={t("options.cloudSync.webdavUrlHint")}
            />
            <Input
              label={t("options.cloudSync.webdavUsernameLabel")}
              type="text"
              placeholder={t("options.cloudSync.webdavUsernamePlaceholder")}
              value={webdavUsername()}
              onInput={(e) => setWebdavUsername(e.currentTarget.value)}
              onBlur={handleTokenBlur}
            />
          </Show>

          <div class="relative">
            <Input
              label={tokenLabel()}
              type={showToken() ? "text" : "password"}
              placeholder={t("options.cloudSync.tokenPlaceholder")}
              value={token()}
              onInput={(e) => setToken(e.currentTarget.value)}
              onBlur={handleTokenBlur}
              hint={tokenHint()}
            />
            <button
              type="button"
              onClick={() => setShowToken(!showToken())}
              class="absolute right-3 top-9 text-xs text-muted-foreground hover:text-foreground"
            >
              {showToken()
                ? t("options.cloudSync.hideToken")
                : t("options.cloudSync.showToken")}
            </button>
          </div>

          <Input
            label={t("options.cloudSync.intervalLabel")}
            type="number"
            min="1"
            max="720"
            value={interval()}
            onInput={(e) =>
              setIntervalH(Number(e.currentTarget.value) || 24)
            }
            onBlur={handleIntervalBlur}
            hint={t("options.cloudSync.intervalHint")}
          />

          {/* 同步内容开关 */}
          <div class="space-y-2 mb-4">
            <label class="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={vectorEnabled()}
                onChange={handleVectorToggle}
                class="w-4 h-4 rounded"
              />
              <span class="text-sm">
                {t("options.cloudSync.vectorSyncLabel")}
              </span>
            </label>
            <label class="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={bookmarksEnabled()}
                onChange={handleBookmarksToggle}
                class="w-4 h-4 rounded"
              />
              <span class="text-sm">
                {t("options.cloudSync.bookmarksSyncLabel")}
              </span>
            </label>
          </div>

          <label class="flex items-center gap-2 cursor-pointer mb-4">
            <input
              type="checkbox"
              checked={enabled()}
              onChange={handleAutoSyncToggle}
              class="w-4 h-4 rounded"
            />
            <span class="text-sm">
              {t("options.cloudSync.autoSyncLabel")}
            </span>
          </label>

          <div class="flex gap-2 flex-wrap mb-4">
            <Button onClick={handleTest} disabled={isTesting()}>
              {isTesting()
                ? t("common.testing")
                : t("options.cloudSync.testButton")}
            </Button>
            <Button
              variant="outline"
              onClick={handleDelete}
              disabled={isDeleting()}
            >
              {isDeleting()
                ? t("common.deleting")
                : t("options.cloudSync.deleteButton")}
            </Button>
          </div>

          {/* 向量操作 */}
          <Show when={vectorEnabled()}>
            <div class="border-t pt-4 mt-4">
              <p class="text-sm font-medium mb-3">
                {t("options.cloudSync.vectorSection")}
              </p>
              <div class="flex gap-2 flex-wrap mb-4">
                <Button
                  variant="outline"
                  onClick={handleUploadVector}
                  disabled={isUploadingVector()}
                  size="sm"
                >
                  {isUploadingVector()
                    ? t("common.uploading")
                    : t("options.cloudSync.uploadVectorButton")}
                </Button>
                <Button
                  variant="outline"
                  onClick={confirmDownloadVector}
                  disabled={isDownloadingVector()}
                  size="sm"
                >
                  {isDownloadingVector()
                    ? t("common.downloading")
                    : t("options.cloudSync.downloadVectorButton")}
                </Button>
              </div>

              <Show when={pendingVectorDownload()}>
                <div class="mb-4 p-4 rounded-lg border bg-amber-50 border-amber-200 dark:bg-amber-950 dark:border-amber-800">
                  <p class="text-sm font-semibold text-amber-900 dark:text-amber-100 mb-1">
                    {t("options.cloudSync.confirmVectorDownloadTitle")}
                  </p>
                  <p class="text-sm text-amber-800 dark:text-amber-200 mb-3">
                    {t("options.cloudSync.confirmVectorDownloadBody")}
                  </p>
                  <div class="flex gap-2">
                    <Button
                      size="sm"
                      onClick={executeDownloadVector}
                      disabled={isDownloadingVector()}
                    >
                      {t("common.confirm")}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setPendingVectorDownload(false)}
                    >
                      {t("common.cancel")}
                    </Button>
                  </div>
                </div>
              </Show>
            </div>
          </Show>

          {/* 书签操作 */}
          <Show when={bookmarksEnabled()}>
            <div class="border-t pt-4 mt-4">
              <p class="text-sm font-medium mb-3">
                {t("options.cloudSync.bookmarksSection")}
              </p>
              <div class="flex gap-2 flex-wrap mb-4">
                <Button
                  variant="outline"
                  onClick={handleSyncBookmarks}
                  disabled={isSyncingBookmarks()}
                  size="sm"
                >
                  {isSyncingBookmarks()
                    ? t("common.syncing")
                    : t("options.cloudSync.syncBookmarksButton")}
                </Button>
                <Button
                  variant="outline"
                  onClick={handleUploadBookmarks}
                  disabled={isUploadingBookmarks()}
                  size="sm"
                >
                  {isUploadingBookmarks()
                    ? t("common.uploading")
                    : t("options.cloudSync.uploadBookmarksButton")}
                </Button>
                <Button
                  variant="outline"
                  onClick={confirmDownloadBookmarks}
                  disabled={isDownloadingBookmarks()}
                  size="sm"
                >
                  {isDownloadingBookmarks()
                    ? t("common.downloading")
                    : t("options.cloudSync.downloadBookmarksButton")}
                </Button>
              </div>

              <Show when={pendingBookmarkDownload()}>
                <div class="mb-4 p-4 rounded-lg border bg-amber-50 border-amber-200 dark:bg-amber-950 dark:border-amber-800">
                  <p class="text-sm font-semibold text-amber-900 dark:text-amber-100 mb-1">
                    {t("options.cloudSync.confirmBookmarksDownloadTitle")}
                  </p>
                  <p class="text-sm text-amber-800 dark:text-amber-200 mb-3">
                    {t("options.cloudSync.confirmBookmarksDownloadBody")}
                  </p>
                  <div class="flex gap-2">
                    <Button
                      size="sm"
                      onClick={executeDownloadBookmarks}
                      disabled={isDownloadingBookmarks()}
                    >
                      {t("common.confirm")}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setPendingBookmarkDownload(false)}
                    >
                      {t("common.cancel")}
                    </Button>
                  </div>
                </div>
              </Show>
            </div>
          </Show>
        </Show>

        <Alert
          variant={status()?.type}
          visible={status() !== null}
          class="mt-2"
        >
          {status()?.message}
        </Alert>

        <Show when={remoteModifiedAt() || lastSync() || deviceId()}>
          <div class="mt-4 text-xs text-muted-foreground space-y-1">
            {lastSync() && (
              <div>
                {t("common.lastSync")}: {lastSync()}
              </div>
            )}
            {remoteModifiedAt() && (
              <div>
                {t("options.cloudSync.remoteModified")}: {remoteModifiedAt()}
                {remoteSize() !== null
                  ? ` · ${formatBytes(remoteSize()!)}`
                  : ""}
              </div>
            )}
            {deviceId() && (
              <div>
                {t("options.cloudSync.deviceId")}: <code>{deviceId()}</code>
              </div>
            )}
          </div>
        </Show>
      </CardContent>
    </Card>

    {/* 通用确认对话框 */}
    <Show when={confirmDialog().open}>
      <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
        <div class="bg-background border rounded-lg shadow-lg p-6 max-w-md w-full mx-4">
          <h3 class={confirmDialog().variant === "destructive" ? "text-lg font-semibold text-destructive mb-2" : "text-lg font-semibold mb-2"}>
            {confirmDialog().title}
          </h3>
          <p class="text-sm text-muted-foreground mb-4">{confirmDialog().message}</p>
          <div class="flex gap-2 justify-end">
            <Button
              variant="outline"
              onClick={() => setConfirmDialog((prev) => ({ ...prev, open: false }))}
            >
              {t("common.cancel")}
            </Button>
            <Button
              variant={confirmDialog().variant}
              onClick={() => {
                setConfirmDialog((prev) => ({ ...prev, open: false }));
                confirmDialog().onConfirm();
              }}
            >
              {t("common.confirm")}
            </Button>
          </div>
        </div>
      </div>
    </Show>
    </>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}
