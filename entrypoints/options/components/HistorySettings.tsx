import { createSignal } from "solid-js";
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
} from "../../../src/components/ui/card";
import { Input } from "../../../src/components/ui/input";
import { Checkbox } from "../../../src/components/ui/checkbox";
import { Button } from "../../../src/components/ui/button";
import { Alert } from "../../../src/components/ui/alert";
import { getSettings, saveSettings } from "../../../src/db";
import { useI18n } from "../../../src/i18n";

export default function HistorySettings() {
  const { t } = useI18n();
  const [syncEnabled, setSyncEnabled] = createSignal(false);
  const [historyDays, setHistoryDays] = createSignal(30);
  const [lastSync, setLastSync] = createSignal<string | null>(null);
  const [status, setStatus] = createSignal<{
    message: string;
    type: "success" | "error" | "info";
  } | null>(null);
  const [isSyncing, setIsSyncing] = createSignal(false);

  // 初始化
  getSettings().then((settings) => {
    setSyncEnabled(settings.historySyncEnabled || false);
    setHistoryDays(settings.historyDays ?? 30);
  });

  const handleSave = async () => {
    try {
      await saveSettings({
        historySyncEnabled: syncEnabled(),
        historyDays: historyDays(),
      });
      setStatus({ message: t("options.history.saved"), type: "success" });
    } catch (error) {
      setStatus({ message: `保存失败: ${error}`, type: "error" });
    }
  };

  const handleSync = async () => {
    setIsSyncing(true);
    setStatus({ message: t("common.syncing"), type: "info" });

    try {
      const result = await browser.runtime.sendMessage({
        type: "SYNC_HISTORY",
      });

      if (result.success) {
        const msg = result.error
          ? `${t("options.history.syncError")}: ${result.error}`
          : t("options.history.syncSuccess", { added: result.added, skipped: result.skipped });
        setStatus({
          message: msg,
          type: result.error ? "error" : "success",
        });
        setLastSync(new Date().toLocaleString());
      } else {
        setStatus({ message: `同步失败: ${result.error}`, type: "error" });
      }
    } catch (error) {
      setStatus({ message: `通信错误: ${error}`, type: "error" });
    } finally {
      setIsSyncing(false);
    }
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

        <Checkbox
          label={t("options.history.enableSync")}
          checked={syncEnabled()}
          onChange={(e) => setSyncEnabled(e.currentTarget.checked)}
        />

        <Input
          label={t("options.history.syncDays")}
          type="number"
          placeholder="30"
          value={String(historyDays())}
          onInput={(e) => {
            const v = parseInt(e.currentTarget.value, 10);
            if (!isNaN(v) && v >= 1 && v <= 365) setHistoryDays(v);
          }}
          hint={t("options.history.syncDaysHint")}
        />

        <div class="flex gap-3 flex-wrap mt-4">
          <Button onClick={handleSave}>{t("options.history.saveSettings")}</Button>
          <Button variant="outline" onClick={handleSync} disabled={isSyncing()}>
            {isSyncing() ? t("common.syncing") : t("options.history.syncNow")}
          </Button>
        </div>

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
