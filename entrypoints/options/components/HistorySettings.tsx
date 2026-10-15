import { createSignal } from "solid-js";
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
} from "../../../src/components/ui/card";
import { InputField } from "../../../src/components/form/InputField";
import { CheckboxField } from "../../../src/components/form/CheckboxField";
import { Button } from "../../../src/components/ui/button";
import { StatusAlert } from "../../../src/components/form/StatusAlert";
import { getSettings, saveSettings } from "../../../src/db";
import { useI18n } from "../../../src/i18n";

export default function HistorySettings() {
  const { t } = useI18n();
  const [syncEnabled, setSyncEnabled] = createSignal(false);
  const [historyDays, setHistoryDays] = createSignal(30);
  const [interval, setInterval] = createSignal(24);
  const [lastSync, setLastSync] = createSignal<string | null>(null);
  const [status, setStatus] = createSignal<{
    message: string;
    type: "success" | "error" | "info";
  } | null>(null);
  const [isSyncing, setIsSyncing] = createSignal(false);
  const [isStopping, setIsStopping] = createSignal(false);

  // 初始化
  getSettings().then((settings) => {
    setSyncEnabled(settings.historySyncEnabled || false);
    setHistoryDays(settings.historyDays ?? 30);
    setInterval(settings.historySyncInterval ?? 24);
  });

  const handleSave = async () => {
    try {
      await saveSettings({
        historySyncEnabled: syncEnabled(),
        historyDays: Math.min(365, Math.max(1, Math.round(historyDays()))),
        historySyncInterval: Math.min(720, Math.max(1, Math.round(interval()))),
      });
      // 保存后立即刷新后台定时任务
      browser.runtime
        .sendMessage({ type: "REFRESH_ALARMS" })
        .catch(() => {});
      setStatus({ message: t("options.history.saved"), type: "success" });
    } catch (error) {
      setStatus({ message: `${t("common.saveFailed")}: ${error}`, type: "error" });
    }
  };

  const handleSync = async () => {
    setIsSyncing(true);
    setStatus({ message: t("common.syncing"), type: "info" });

    try {
      const result = await browser.runtime.sendMessage({
        type: "SYNC_HISTORY",
      });

      if (result.stopped) {
        setStatus({ message: t("common.syncStopped"), type: "info" });
      } else if (result.success) {
        const msg = result.error
          ? `${t("options.history.syncError")}: ${result.error}`
          : t("options.history.syncSuccess", { added: result.added, skipped: result.skipped });
        setStatus({
          message: msg,
          type: result.error ? "error" : "success",
        });
        setLastSync(new Date().toLocaleString());
      } else {
        setStatus({ message: `${t("common.syncFailed")}: ${result.error}`, type: "error" });
      }
    } catch (error) {
      setStatus({
        message: `${t("common.communicationError")}: ${error}`,
        type: "error",
      });
    } finally {
      setIsSyncing(false);
      // 同步已结束（含被用户停止）：复位停止态，避免下次运行时「停止」按钮仍处于禁用态
      setIsStopping(false);
    }
  };

  /** 请求后台停止正在进行的浏览器历史同步 */
  const handleStop = () => {
    setIsStopping(true);
    // 复位交给 handleSync 的 finally：停止态应持续到同步真正结束
    browser.runtime
      .sendMessage({ type: "STOP_SOURCE_SYNC", source: "history" })
      .catch(() => {});
  };

  return (
    <Card class="mb-6">
      <CardHeader>
        <CardTitle>{t("options.history.title")}</CardTitle>
      </CardHeader>
      <CardContent>
        <p class="text-xs text-muted-foreground mb-3">
          {t("options.history.description")}
        </p>

        <CheckboxField
          label={t("options.history.enableSync")}
          checked={syncEnabled()}
          onChange={(checked) => setSyncEnabled(checked)}
        />

        <InputField
          label={t("options.history.syncDays")}
          type="number"
          placeholder="30"
          value={String(historyDays())}
          onChange={(value) => {
            const v = parseInt(value, 10);
            if (!isNaN(v) && v >= 1 && v <= 365) setHistoryDays(v);
          }}
          hint={t("options.history.syncDaysHint")}
        />

        <div class="mt-3">
          <InputField
            label={t("options.history.intervalLabel")}
            type="number"
            placeholder="24"
            value={String(interval())}
            onChange={(value) => {
              const v = parseInt(value, 10);
              if (!isNaN(v) && v >= 1 && v <= 720) setInterval(v);
            }}
            hint={t("options.history.intervalHint")}
          />
        </div>

        <div class="flex gap-3 flex-wrap mt-4">
          <Button onClick={handleSave}>{t("options.history.saveSettings")}</Button>
          <Button variant="outline" onClick={handleSync} disabled={isSyncing()}>
            {isSyncing() ? t("common.syncing") : t("options.history.syncNow")}
          </Button>
          <Button
            variant="outline"
            onClick={handleStop}
            disabled={!isSyncing() || isStopping()}
          >
            {isStopping() ? t("common.stopping") : t("common.stop")}
          </Button>
        </div>

        <StatusAlert status={status()} />

        {lastSync() && (
          <p class="text-xs text-muted-foreground mt-3">
            {t("common.lastSync")}: {lastSync()}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
