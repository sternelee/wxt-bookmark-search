import { createSignal } from "solid-js";
import { Card, CardHeader, CardTitle, CardContent } from "../../../src/components/ui/card";
import { Input } from "../../../src/components/ui/input";
import { Button } from "../../../src/components/ui/button";
import { Alert } from "../../../src/components/ui/alert";
import { getSettings, saveSettings } from "../../../src/db";

export default function GitHubSettings() {
  const [githubToken, setGithubToken] = createSignal("");
  const [lastSync, setLastSync] = createSignal<string | null>(null);
  const [status, setStatus] = createSignal<{ message: string; type: "success" | "error" | "info" } | null>(null);
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
      setStatus({ message: "✓ GitHub 设置已保存", type: "success" });
    } catch (error) {
      setStatus({ message: `保存失败: ${error}`, type: "error" });
    }
  };

  const handleSync = async () => {
    const settings = await getSettings();
    if (!settings.githubToken) {
      setStatus({ message: "请先填写 GitHub Token", type: "error" });
      return;
    }

    setIsSyncing(true);
    setStatus({ message: "正在从 GitHub 获取仓库列表...", type: "info" });

    try {
      const result = await browser.runtime.sendMessage({
        type: "SYNC_GITHUB_STARS",
      });

      if (result.success) {
        setStatus({
          message: `✓ 同步成功！已将 ${result.total} 个仓库加入索引队列`,
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
        <CardTitle>🐙 GitHub Stars 语义化索引</CardTitle>
      </CardHeader>
      <CardContent>
        <Input
          label="GitHub Personal Access Token (PAT)"
          type="password"
          placeholder="ghp_..."
          value={githubToken()}
          onInput={(e) => setGithubToken(e.currentTarget.value)}
          hint="需要 public_repo 权限。配置后可将你的加星仓库纳入 AI 搜索范围。"
        />

        <div class="flex gap-3 flex-wrap">
          <Button onClick={handleSave}>💾 保存 GitHub 设置</Button>
          <Button variant="outline" onClick={handleSync} disabled={isSyncing()}>
            {isSyncing() ? "正在获取 Stars..." : "🔄 立即同步 Stars"}
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
