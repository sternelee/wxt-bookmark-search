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
import { getSettings, saveSettings } from "../../../src/db";

export default function GistSyncSettings() {
  const [gistId, setGistId] = createSignal("");
  const [linkGistId, setLinkGistId] = createSignal("");
  const [syncEnabled, setSyncEnabled] = createSignal(false);
  const [lastSync, setLastSync] = createSignal<string | null>(null);
  const [status, setStatus] = createSignal<{
    message: string;
    type: "success" | "error" | "info";
  } | null>(null);
  const [isSyncing, setIsSyncing] = createSignal(false);
  const [isCreating, setIsCreating] = createSignal(false);
  const [isUploading, setIsUploading] = createSignal(false);
  const [isDownloading, setIsDownloading] = createSignal(false);

  const formatError = (error: unknown): string => {
    if (error instanceof Error) {
      return error.message;
    }
    return String(error);
  };

  // 初始化
  onMount(async () => {
    const settings = await getSettings();
    setGistId(settings.gistId || "");
    setSyncEnabled(settings.gistSyncEnabled || false);
    if (settings.lastGistSync) {
      setLastSync(new Date(settings.lastGistSync).toLocaleString());
    }
  });

  const handleCreate = async () => {
    setIsCreating(true);
    setStatus({ message: "正在创建 Gist 并上传书签...", type: "info" });
    try {
      const result = await browser.runtime.sendMessage({ type: "GIST_CREATE" });
      if (result.success) {
        setGistId(result.gistId);
        setSyncEnabled(true);
        setLastSync(new Date().toLocaleString());
        await saveSettings({ gistId: result.gistId, gistSyncEnabled: true });
        setStatus({
          message: `✓ Gist 创建成功！ID: ${result.gistId}`,
          type: "success",
        });
      } else {
        setStatus({ message: `创建失败: ${result.error}`, type: "error" });
      }
    } catch (error) {
      setStatus({ message: `创建失败: ${formatError(error)}`, type: "error" });
    } finally {
      setIsCreating(false);
    }
  };

  const handleLink = async () => {
    const id = linkGistId().trim();
    if (!id) {
      setStatus({ message: "请输入 Gist ID", type: "error" });
      return;
    }
    setIsSyncing(true);
    setStatus({ message: "正在关联 Gist 并同步书签...", type: "info" });
    try {
      const result = await browser.runtime.sendMessage({
        type: "GIST_LINK",
        gistId: id,
      });
      if (result.success) {
        setGistId(id);
        setSyncEnabled(true);
        setLastSync(new Date().toLocaleString());
        setLinkGistId("");
        await saveSettings({ gistId: id, gistSyncEnabled: true });
        setStatus({
          message: `✓ 关联成功！已同步: +${result.added} 新增, ${result.uploaded} 总计`,
          type: "success",
        });
      } else {
        setStatus({ message: `关联失败: ${result.error}`, type: "error" });
      }
    } catch (error) {
      setStatus({ message: `关联失败: ${formatError(error)}`, type: "error" });
    } finally {
      setIsSyncing(false);
    }
  };

  const handleSync = async () => {
    setIsSyncing(true);
    setStatus({ message: "正在同步书签到 Gist...", type: "info" });
    try {
      const result = await browser.runtime.sendMessage({ type: "GIST_SYNC" });
      if (result.success) {
        setLastSync(new Date().toLocaleString());
        setStatus({
          message: `✓ 同步完成！+${result.added} 新增, -${result.removed} 删除, ${result.uploaded} 总计`,
          type: "success",
        });
      } else {
        setStatus({ message: `同步失败: ${result.error}`, type: "error" });
      }
    } catch (error) {
      setStatus({ message: `同步失败: ${formatError(error)}`, type: "error" });
    } finally {
      setIsSyncing(false);
    }
  };

  const handleUpload = async () => {
    const confirmed = window.confirm(
      "⚠️ 上传覆盖将用本地书签全量替换 Gist 中的内容，远程独有的书签将丢失。\n\n确定继续？"
    );
    if (!confirmed) return;

    setIsUploading(true);
    setStatus({ message: "正在上传本地书签覆盖 Gist...", type: "info" });
    try {
      const result = await browser.runtime.sendMessage({ type: "GIST_UPLOAD" });
      if (result.success) {
        setLastSync(new Date().toLocaleString());
        setStatus({
          message: `✓ 上传覆盖完成！${result.uploaded} 个书签已覆盖到 Gist`,
          type: "success",
        });
      } else {
        setStatus({ message: `上传失败: ${result.error}`, type: "error" });
      }
    } catch (error) {
      setStatus({ message: `上传失败: ${formatError(error)}`, type: "error" });
    } finally {
      setIsUploading(false);
    }
  };

  const handleDownload = async () => {
    const confirmed = window.confirm(
      "⚠️ 下载覆盖将用 Gist 内容全量替换本地书签，本地独有的书签将被删除。\n\n确定继续？"
    );
    if (!confirmed) return;

    setIsDownloading(true);
    setStatus({ message: "正在从 Gist 下载覆盖本地书签...", type: "info" });
    try {
      const result = await browser.runtime.sendMessage({ type: "GIST_DOWNLOAD" });
      if (result.success) {
        setLastSync(new Date().toLocaleString());
        setStatus({
          message: `✓ 下载覆盖完成！+${result.added} 个书签已恢复，${result.removed} 个本地项目已清空`,
          type: "success",
        });
      } else {
        setStatus({ message: `下载失败: ${result.error}`, type: "error" });
      }
    } catch (error) {
      setStatus({ message: `下载失败: ${formatError(error)}`, type: "error" });
    } finally {
      setIsDownloading(false);
    }
  };

  const handleToggle = async () => {
    const newValue = !syncEnabled();
    setSyncEnabled(newValue);
    await saveSettings({ gistSyncEnabled: newValue });
    setStatus({
      message: newValue ? "✓ 自动同步已启用" : "自动同步已关闭",
      type: newValue ? "success" : "info",
    });
  };

  return (
    <Card class="mb-6">
      <CardHeader>
        <CardTitle>☁️ 书签 Gist 同步</CardTitle>
      </CardHeader>
      <CardContent>
        <p class="text-sm text-muted-foreground mb-4">
          通过 GitHub Gist 在多设备间同步浏览器书签。需要先在上方配置 GitHub
          Token（需包含 <code>gist</code> 权限）。
        </p>

        <Show when={!gistId()}>
          {/* 尚未关联 Gist */}
          <div class="space-y-4">
            <Button onClick={handleCreate} disabled={isCreating()}>
              {isCreating() ? "正在创建..." : "📤 创建新 Gist（上传本地书签）"}
            </Button>

            <div class="flex items-end gap-2">
              <Input
                label="关联已有 Gist ID"
                placeholder="输入 Gist ID（32 位十六进制）"
                value={linkGistId()}
                onInput={(e) => setLinkGistId(e.currentTarget.value)}
                hint="从其他设备获取 Gist ID 后在此关联"
              />
              <Button
                variant="outline"
                onClick={handleLink}
                disabled={isSyncing()}
                class="shrink-0 mb-6 ml-5"
              >
                {isSyncing() ? "关联中..." : "🔗 关联"}
              </Button>
            </div>
          </div>
        </Show>

        <Show when={!!gistId()}>
          {/* 已关联 Gist */}
          <div class="space-y-4">
            <div class="flex items-center gap-3 p-3 rounded-md bg-muted/50">
              <span class="text-sm font-medium">Gist ID:</span>
              <code class="text-xs bg-background px-2 py-1 rounded border">
                {gistId()}
              </code>
            </div>

            <div class="flex items-center gap-3">
              <label class="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={syncEnabled()}
                  onChange={handleToggle}
                  class="w-4 h-4 rounded"
                />
                <span class="text-sm">自动同步（书签变更后 5 秒自动上传）</span>
              </label>
            </div>

            <div class="flex gap-3 flex-wrap">
              <Button onClick={handleSync} disabled={isSyncing()}>
                {isSyncing() ? "同步中..." : "🔄 立即同步"}
              </Button>
              <Button
                variant="outline"
                onClick={handleUpload}
                disabled={isUploading()}
              >
                {isUploading() ? "上传中..." : "⬆️ 上传覆盖"}
              </Button>
              <Button
                variant="outline"
                onClick={handleDownload}
                disabled={isDownloading()}
              >
                {isDownloading() ? "下载中..." : "⬇️ 下载覆盖"}
              </Button>
            </div>
          </div>
        </Show>

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
