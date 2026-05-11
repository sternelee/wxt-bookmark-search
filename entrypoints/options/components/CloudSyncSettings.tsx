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

type ProviderValue = "" | "google-drive" | "dropbox";

export default function CloudSyncSettings() {
  const { t } = useI18n();

  const [provider, setProvider] = createSignal<ProviderValue>("");
  const [token, setToken] = createSignal("");
  const [showToken, setShowToken] = createSignal(false);
  const [enabled, setEnabled] = createSignal(false);
  const [interval, setIntervalH] = createSignal(24);
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
  const [isUploading, setIsUploading] = createSignal(false);
  const [isDownloading, setIsDownloading] = createSignal(false);
  const [isDeleting, setIsDeleting] = createSignal(false);
  const [pendingDownload, setPendingDownload] = createSignal(false);

  const formatError = (error: unknown): string => {
    if (error instanceof Error) return error.message;
    return String(error);
  };

  const refreshRemote = async () => {
    setRemoteSize(null);
    setRemoteModifiedAt(null);
    if (!provider() || !token()) return;
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
    setEnabled(!!settings.cloudSyncEnabled);
    setIntervalH(settings.cloudSyncInterval ?? 24);
    if (settings.lastCloudSync) {
      setLastSync(new Date(settings.lastCloudSync).toLocaleString());
    }
    if (settings.cloudSyncDeviceId) setDeviceId(settings.cloudSyncDeviceId);
    await refreshRemote();
  });

  const persistConfig = async () => {
    await saveSettings({
      cloudSyncProvider: (provider() || null) as
        | "google-drive"
        | "dropbox"
        | null,
      cloudSyncToken: token() || undefined,
      cloudSyncEnabled: enabled(),
      cloudSyncInterval: interval(),
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

  const handleIntervalBlur = async () => {
    let v = interval();
    if (!Number.isFinite(v) || v < 1) v = 1;
    if (v > 24 * 30) v = 24 * 30;
    setIntervalH(v);
    await persistConfig();
    await browser.runtime.sendMessage({ type: "CLOUD_SYNC_REFRESH_ALARM" });
  };

  const handleToggle = async () => {
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
    if (!provider() || !token()) {
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

  const handleUpload = async () => {
    if (!provider() || !token()) {
      setStatus({
        message: t("options.cloudSync.configRequired"),
        type: "error",
      });
      return;
    }
    setIsUploading(true);
    setStatus({ message: t("options.cloudSync.uploading"), type: "info" });
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
        const s = await getSettings();
        if (s.cloudSyncDeviceId) setDeviceId(s.cloudSyncDeviceId);
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
      setIsUploading(false);
    }
  };

  const confirmDownload = () => {
    if (!provider() || !token()) {
      setStatus({
        message: t("options.cloudSync.configRequired"),
        type: "error",
      });
      return;
    }
    setPendingDownload(true);
  };

  const executeDownload = async () => {
    setPendingDownload(false);
    setIsDownloading(true);
    setStatus({ message: t("options.cloudSync.downloading"), type: "info" });
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
      setIsDownloading(false);
    }
  };

  const handleDelete = async () => {
    if (!provider() || !token()) return;
    if (!confirm(t("options.cloudSync.confirmDelete"))) return;
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
  ];

  return (
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
          hint={t("options.cloudSync.providerHint")}
        />

        <Show when={!!provider()}>
          <div class="relative">
            <Input
              label={t("options.cloudSync.tokenLabel")}
              type={showToken() ? "text" : "password"}
              placeholder={t("options.cloudSync.tokenPlaceholder")}
              value={token()}
              onInput={(e) => setToken(e.currentTarget.value)}
              onBlur={handleTokenBlur}
              hint={
                provider() === "google-drive"
                  ? t("options.cloudSync.tokenHintGoogleDrive")
                  : t("options.cloudSync.tokenHintDropbox")
              }
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

          <label class="flex items-center gap-2 cursor-pointer mb-4">
            <input
              type="checkbox"
              checked={enabled()}
              onChange={handleToggle}
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
              onClick={handleUpload}
              disabled={isUploading()}
            >
              {isUploading()
                ? t("common.uploading")
                : t("options.cloudSync.uploadButton")}
            </Button>
            <Button
              variant="outline"
              onClick={confirmDownload}
              disabled={isDownloading()}
            >
              {isDownloading()
                ? t("common.downloading")
                : t("options.cloudSync.downloadButton")}
            </Button>
            <Button
              variant="outline"
              onClick={handleDelete}
              disabled={isDeleting()}
            >
              {t("options.cloudSync.deleteButton")}
            </Button>
          </div>

          <Show when={pendingDownload()}>
            <div class="mb-4 p-4 rounded-lg border bg-amber-50 border-amber-200 dark:bg-amber-950 dark:border-amber-800">
              <p class="text-sm font-semibold text-amber-900 dark:text-amber-100 mb-1">
                {t("options.cloudSync.confirmDownloadTitle")}
              </p>
              <p class="text-sm text-amber-800 dark:text-amber-200 mb-3">
                {t("options.cloudSync.confirmDownloadBody")}
              </p>
              <div class="flex gap-2">
                <Button
                  size="sm"
                  onClick={executeDownload}
                  disabled={isDownloading()}
                >
                  {t("common.confirm")}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setPendingDownload(false)}
                >
                  {t("common.cancel")}
                </Button>
              </div>
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
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}
