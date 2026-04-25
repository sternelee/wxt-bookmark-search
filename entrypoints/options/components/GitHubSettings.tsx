import { createSignal } from "solid-js";
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

export default function GitHubSettings() {
  const { t } = useI18n();
  const [githubToken, setGithubToken] = createSignal("");
  const [lastSync, setLastSync] = createSignal<string | null>(null);
  const [status, setStatus] = createSignal<{
    message: string;
    type: "success" | "error" | "info";
  } | null>(null);
  const [isSyncing, setIsSyncing] = createSignal(false);

  // 初始化
  getSettings().then((settings) => {
    setGithubToken(settings.githubToken || "");
    if (settings.lastGithubSync) {
      setLastSync(new Date(settings.lastGithubSync).toLocaleString());
    }
  });

  const handleSave = async () => {
    try {
      await saveSettings({ githubToken: githubToken() });
      setStatus({ message: t("options.github.saved"), type: "success" });
    } catch (error) {
      setStatus({ message: `保存失败: ${error}`, type: "error" });
    }
  };

  const handleSync = async () => {
    const settings = await getSettings();
    if (!settings.githubToken) {
      setStatus({ message: t("options.github.tokenRequired"), type: "error" });
      return;
    }

    setIsSyncing(true);
    setStatus({ message: t("options.github.syncingStars"), type: "info" });

    try {
      const result = await browser.runtime.sendMessage({
        type: "SYNC_GITHUB_STARS",
      });

      if (result.success) {
        setStatus({
          message: t("options.github.syncSuccess", { total: result.total }),
          type: "success",
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
        <CardTitle>{t("options.github.title")}</CardTitle>
      </CardHeader>
      <CardContent>
        <Input
          label="GitHub Personal Access Token (PAT)"
          type="password"
          placeholder="ghp_..."
          value={githubToken()}
          onInput={(e) => setGithubToken(e.currentTarget.value)}
          hint={t("options.github.tokenHint")}
        />

        <div class="flex gap-3 flex-wrap mt-4">
          <Button onClick={handleSave}>{t("options.github.saveSettings")}</Button>
          <Button variant="outline" onClick={handleSync} disabled={isSyncing()}>
            {isSyncing() ? t("options.github.syncingStars") : t("options.github.syncStars")}
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
