import { createSignal, onMount, Show } from "solid-js";
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
} from "../../../src/components/ui/card";
import { Button } from "../../../src/components/ui/button";
import { Checkbox } from "../../../src/components/ui/checkbox";
import { Select } from "../../../src/components/ui/select";
import { Alert } from "../../../src/components/ui/alert";
import { getSettings, saveSettings } from "../../../src/db";
import { useI18n } from "../../../src/i18n";

function formatErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export default function HealthSettings() {
  const { t } = useI18n();
  const [enabled, setEnabled] = createSignal(false);
  const [interval, setInterval] = createSignal(24);
  const [status, setStatus] = createSignal<{
    message: string;
    type: "success" | "error" | "info";
  } | null>(null);
  const [checking, setChecking] = createSignal(false);
  const [stats, setStats] = createSignal<{
    alive: number;
    dead: number;
    unchecked: number;
    lastCheckAt?: number;
  } | null>(null);
  const [deadLinks, setDeadLinks] = createSignal<
    { id: string; url: string; title: string; linkStatus: number }[]
  >([]);
  const [showDeadList, setShowDeadList] = createSignal(false);

  onMount(async () => {
    const settings = await getSettings();
    setEnabled(settings.linkCheckEnabled || false);
    setInterval(settings.linkCheckInterval || 24);

    try {
      const response = await browser.runtime.sendMessage({
        type: "GET_LINK_STATS",
      });
      if (response.success) {
        setStats({
          alive: response.alive,
          dead: response.dead,
          unchecked: response.unchecked,
          lastCheckAt: response.lastCheckAt,
        });
      }
    } catch {}
  });

  const handleSave = async () => {
    try {
      await saveSettings({
        linkCheckEnabled: enabled(),
        linkCheckInterval: interval(),
      });
      setStatus({ message: t("options.health.saved"), type: "success" });
    } catch (e) {
      setStatus({ message: formatErrorMessage(e), type: "error" });
    }
  };

  const handleCheckNow = async () => {
    setChecking(true);
    setStatus(null);
    try {
      const response = await browser.runtime.sendMessage({
        type: "CHECK_LINKS",
      });
      if (response.success) {
        setStatus({
          message: t("options.health.checkSummary", {
            checked: response.checked,
            alive: response.alive,
            dead: response.dead,
          }),
          type: "success",
        });
        // 刷新统计
        const statsRes = await browser.runtime.sendMessage({
          type: "GET_LINK_STATS",
        });
        if (statsRes.success) {
          setStats({
            alive: statsRes.alive,
            dead: statsRes.dead,
            unchecked: statsRes.unchecked,
            lastCheckAt: statsRes.lastCheckAt,
          });
        }
        // 如果有死链，加载死链列表
        if (response.dead > 0) {
          const deadRes = await browser.runtime.sendMessage({
            type: "GET_DEAD_LINKS",
          });
          if (deadRes.success) {
            setDeadLinks(deadRes.deadLinks);
          }
        }
      } else {
        setStatus({
          message: response.error || t("common.unknownError"),
          type: "error",
        });
      }
    } catch (e) {
      setStatus({ message: formatErrorMessage(e), type: "error" });
    } finally {
      setChecking(false);
    }
  };

  const intervalOptions = [
    { value: "6", label: "6h" },
    { value: "12", label: "12h" },
    { value: "24", label: "24h" },
    { value: "48", label: "48h" },
    { value: "168", label: "7d" },
  ];

  const formatLastCheck = (ts?: number) => {
    if (!ts) return t("options.health.never");
    const date = new Date(ts);
    return date.toLocaleString();
  };

  return (
    <Card class="mb-6">
      <CardHeader>
        <CardTitle>{t("options.health.title")}</CardTitle>
      </CardHeader>
      <CardContent>
        <Checkbox
          label={t("options.health.enableLabel")}
          checked={enabled()}
          onChange={(e) => setEnabled(e.currentTarget.checked)}
          hint={t("options.health.enableHint")}
        />

        <div class="mt-3">
          <Select
            label={t("options.health.intervalLabel")}
            value={String(interval())}
            options={intervalOptions}
            onChange={(value) => setInterval(Number(value))}
          />
        </div>

        <div class="mt-4 flex items-center gap-3">
          <Button onClick={handleSave}>{t("common.save")}</Button>

          <Button
            variant="outline"
            onClick={handleCheckNow}
            disabled={checking()}
          >
            {checking() ? "..." : t("options.health.checkNow")}
          </Button>
        </div>

        <Show when={stats()}>
          <div class="mt-4 p-3 rounded-md bg-muted/30 text-sm space-y-1">
            <div>
              {t("options.health.alive")}: {stats()!.alive}
            </div>
            <div>
              {t("options.health.dead")}: {stats()!.dead}
            </div>
            <div>
              {t("options.health.unchecked")}: {stats()!.unchecked}
            </div>
            <div class="text-muted-foreground">
              {t("options.health.lastCheck")}:{" "}
              {formatLastCheck(stats()!.lastCheckAt)}
            </div>
          </div>
        </Show>

        <Show when={deadLinks().length > 0}>
          <div class="mt-4">
            <button
              type="button"
              class="text-sm text-blue-600 hover:text-blue-800"
              onClick={() => setShowDeadList(!showDeadList())}
            >
              {showDeadList() ? "▼" : "▶"} {t("options.health.title")} (
              {deadLinks().length})
            </button>
            <Show when={showDeadList()}>
              <div class="mt-2 max-h-60 overflow-y-auto space-y-2">
                {deadLinks().map((link) => (
                  <div class="text-xs p-2 border rounded">
                    <a
                      href={link.url}
                      target="_blank"
                      class="text-blue-600 hover:underline break-all"
                    >
                      {link.title || link.url}
                    </a>
                    <span class="text-muted-foreground ml-2">
                      HTTP {link.linkStatus}
                    </span>
                  </div>
                ))}
              </div>
            </Show>
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
  );
}
