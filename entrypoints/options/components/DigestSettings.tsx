import { createSignal, onMount } from "solid-js";
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
} from "../../../src/components/ui/card";
import { Button } from "../../../src/components/ui/button";
import { Checkbox } from "../../../src/components/ui/checkbox";
import { Input } from "../../../src/components/ui/input";
import { Alert } from "../../../src/components/ui/alert";
import { getSettings, saveSettings } from "../../../src/db";
import { useI18n } from "../../../src/i18n";

function formatErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** 每日知识简报设置：开关 / 生成时间 / 通知 */
export default function DigestSettings() {
  const { t } = useI18n();
  const [enabled, setEnabled] = createSignal(true);
  const [hour, setHour] = createSignal(9);
  const [notify, setNotify] = createSignal(true);
  const [status, setStatus] = createSignal<{
    message: string;
    type: "success" | "error";
  } | null>(null);

  onMount(async () => {
    const settings = await getSettings();
    setEnabled(settings.digestEnabled ?? true);
    setHour(settings.digestHour ?? 9);
    setNotify(settings.digestNotifyEnabled ?? true);
  });

  const handleSave = async () => {
    try {
      const clampedHour = Math.min(23, Math.max(0, Math.round(hour())));
      await saveSettings({
        digestEnabled: enabled(),
        digestHour: clampedHour,
        digestNotifyEnabled: notify(),
      });
      // 保存后立即刷新后台定时任务
      browser.runtime
        .sendMessage({ type: "REFRESH_ALARMS" })
        .catch(() => {});
      setStatus({ message: t("options.digest.saved"), type: "success" });
    } catch (error) {
      setStatus({
        message: `${t("common.saveFailed")}: ${formatErrorMessage(error)}`,
        type: "error",
      });
    }
  };

  return (
    <Card class="mb-6">
      <CardHeader>
        <CardTitle>{t("options.digest.title")}</CardTitle>
      </CardHeader>
      <CardContent>
        <Checkbox
          label={t("options.digest.enableLabel")}
          checked={enabled()}
          onChange={(e) => setEnabled(e.currentTarget.checked)}
          hint={t("options.digest.enableHint")}
        />

        <div class="mt-3">
          <Input
            label={t("options.digest.hourLabel")}
            type="number"
            placeholder="9"
            value={String(hour())}
            onInput={(e) => {
              const v = parseInt(e.currentTarget.value, 10);
              if (!isNaN(v) && v >= 0 && v <= 23) setHour(v);
            }}
            hint={t("options.digest.hourHint")}
          />
        </div>

        <Checkbox
          label={t("options.digest.notifyLabel")}
          checked={notify()}
          onChange={(e) => setNotify(e.currentTarget.checked)}
          hint={t("options.digest.notifyHint")}
          class="mt-3"
        />

        <Button onClick={handleSave} class="mt-4">
          {t("common.save")}
        </Button>

        <Alert
          variant={status()?.type}
          visible={status() !== null}
          class="mt-4"
        >
          {status()?.message}
        </Alert>
      </CardContent>
    </Card>
  );
}
