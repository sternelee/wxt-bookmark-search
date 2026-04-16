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

export default function HistorySettings() {
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
      setStatus({ message: "✓ 历史同步设置已保存", type: "success" });
    } catch (error) {
      setStatus({ message: `保存失败: ${error}`, type: "error" });
    }
  };

  const handleSync = async () => {
    setIsSyncing(true);
    setStatus({ message: "正在获取浏览历史...", type: "info" });

    try {
      const result = await browser.runtime.sendMessage({
        type: "SYNC_HISTORY",
      });

      if (result.success) {
        const msg = result.error
          ? `同步出错: ${result.error}`
          : `✓ 同步完成！新增 ${result.added} 条，跳过 ${result.skipped} 条`;
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
        <CardTitle>📜 浏览历史语义化索引</CardTitle>
      </CardHeader>
      <CardContent>
        <p class="text-xs text-muted-foreground mb-3">
          将浏览器访问历史纳入语义搜索。仅索引 http/https 页面，跳过已存在的书签/GitHub/Twitter 记录。
        </p>

        <Checkbox
          label="启用浏览历史同步"
          checked={syncEnabled()}
          onChange={(e) => setSyncEnabled(e.currentTarget.checked)}
        />

        <Input
          label="同步最近 N 天"
          type="number"
          placeholder="30"
          value={String(historyDays())}
          onInput={(e) => {
            const v = parseInt(e.currentTarget.value, 10);
            if (!isNaN(v) && v >= 1 && v <= 365) setHistoryDays(v);
          }}
          hint="范围 1-365 天，默认 30 天。天数越多首次同步越慢。"
        />

        <div class="flex gap-3 flex-wrap mt-4">
          <Button onClick={handleSave}>💾 保存设置</Button>
          <Button variant="outline" onClick={handleSync} disabled={isSyncing()}>
            {isSyncing() ? "正在同步..." : "🔄 立即同步历史"}
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
            上次同步: {lastSync()}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
