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

export default function TwitterSettings() {
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
      setStatus({ message: "✓ Twitter 设置已保存", type: "success" });
    } catch (error) {
      setStatus({ message: `保存失败: ${error}`, type: "error" });
    }
  };

  const handleSync = async () => {
    const settings = await getSettings();
    if (!settings.openaiApiKey) {
      setStatus({ message: "请先配置 API Key", type: "error" });
      return;
    }

    setIsSyncing(true);
    setStatus({ message: "正在从 Twitter 获取书签...", type: "info" });

    try {
      const result = await browser.runtime.sendMessage({
        type: "SYNC_TWITTER_BOOKMARKS",
      });

      if (result.success) {
        setStatus({
          message: `✓ 同步成功！已将 ${result.total} 个书签加入索引`,
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
        <CardTitle>🐦 Twitter/X 书签语义化索引</CardTitle>
      </CardHeader>
      <CardContent>
        <p class="text-xs text-muted-foreground mb-3">
          需要在浏览器中登录 Twitter/X。扩展将自动提取 Cookie
          进行同步，无需开发者账号。
        </p>

        <Checkbox
          label="启用 Twitter 书签同步"
          checked={syncEnabled()}
          onChange={(e) => setSyncEnabled(e.currentTarget.checked)}
        />

        <Input
          label="CSRF Token (ct0) - 可选"
          placeholder="自动提取失败时手动输入"
          value={ct0()}
          onInput={(e) => setCt0(e.currentTarget.value)}
          hint="自动提取失败时，可从浏览器开发者工具中复制"
        />

        <Input
          label="Auth Token - 可选"
          type="password"
          placeholder="自动提取失败时手动输入"
          value={authToken()}
          onInput={(e) => setAuthToken(e.currentTarget.value)}
        />

        <div class="flex gap-3 flex-wrap mt-4">
          <Button onClick={handleSave}>💾 保存 Twitter 设置</Button>
          <Button variant="outline" onClick={handleSync} disabled={isSyncing()}>
            {isSyncing() ? "正在同步..." : "🔄 立即同步书签"}
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
