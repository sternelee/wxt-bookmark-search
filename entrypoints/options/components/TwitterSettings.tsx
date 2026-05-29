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

export default function TwitterSettings() {
  const { t } = useI18n();
  const [syncEnabled, setSyncEnabled] = createSignal(false);
  const [ct0, setCt0] = createSignal("");
  const [authToken, setAuthToken] = createSignal("");
  const [lastSync, setLastSync] = createSignal<string | null>(null);
  const [status, setStatus] = createSignal<{
    message: string;
    type: "success" | "error" | "info";
  } | null>(null);
  const [isSyncing, setIsSyncing] = createSignal(false);

  // 初始化
  getSettings().then((settings) => {
    setSyncEnabled(settings.twitterSyncEnabled || false);
    setCt0(settings.twitterCookies?.ct0 || "");
    setAuthToken(settings.twitterCookies?.authToken || "");
    if (settings.lastTwitterSync) {
      setLastSync(new Date(settings.lastTwitterSync).toLocaleString());
    }
  });

  const handleSave = async () => {
    const settings: any = {
      twitterSyncEnabled: syncEnabled(),
    };

    if (ct0() && authToken()) {
      settings.twitterCookies = { ct0: ct0(), authToken: authToken() };
    }

    try {
      await saveSettings(settings);
      setStatus({ message: t("options.twitter.saved"), type: "success" });
    } catch (error) {
      setStatus({ message: `${t("common.saveFailed")}: ${error}`, type: "error" });
    }
  };

  const handleSync = async () => {
    const settings = await getSettings();
    if (!settings.openaiApiKey) {
      setStatus({ message: t("options.twitter.apiKeyRequired"), type: "error" });
      return;
    }

    setIsSyncing(true);
    setStatus({ message: t("common.syncing"), type: "info" });

    try {
      const result = await browser.runtime.sendMessage({
        type: "SYNC_TWITTER_BOOKMARKS",
      });

      if (result.success) {
        setStatus({
          message: t("options.twitter.syncSuccess", { total: result.total }),
          type: "success",
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
    }
  };

  return (
    <Card class="mb-6">
      <CardHeader>
        <CardTitle>{t("options.twitter.title")}</CardTitle>
      </CardHeader>
      <CardContent>
        <p class="text-xs text-muted-foreground mb-3">
          {t("options.twitter.description")}
        </p>

        <Checkbox
          label={t("options.twitter.enableSync")}
          checked={syncEnabled()}
          onChange={(e) => setSyncEnabled(e.currentTarget.checked)}
        />

        <Input
          label={t("options.twitter.csrfToken")}
          placeholder={t("options.twitter.csrfPlaceholder")}
          value={ct0()}
          onInput={(e) => setCt0(e.currentTarget.value)}
          hint={t("options.twitter.csrfHint")}
        />

        <Input
          label={t("options.twitter.authToken")}
          type="password"
          placeholder={t("options.twitter.authPlaceholder")}
          value={authToken()}
          onInput={(e) => setAuthToken(e.currentTarget.value)}
        />

        <div class="flex gap-3 flex-wrap mt-4">
          <Button onClick={handleSave}>{t("options.twitter.saveSettings")}</Button>
          <Button variant="outline" onClick={handleSync} disabled={isSyncing()}>
            {isSyncing() ? t("common.syncing") : t("options.twitter.syncBookmarks")}
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
