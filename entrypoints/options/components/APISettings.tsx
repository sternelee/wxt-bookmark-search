import { createSignal, Show } from "solid-js";
import { Card, CardHeader, CardTitle, CardContent } from "../../../src/components/ui/card";
import { Input } from "../../../src/components/ui/input";
import { Checkbox } from "../../../src/components/ui/checkbox";
import { Button } from "../../../src/components/ui/button";
import { Alert } from "../../../src/components/ui/alert";
import { getSettings, saveSettings } from "../../../src/db";
import { testApiKey } from "../../../src/embedding";

export default function APISettings() {
  const [apiKey, setApiKey] = createSignal("");
  const [baseURL, setBaseURL] = createSignal("");
  const [embeddingModel, setEmbeddingModel] = createSignal("");
  const [llmModel, setLLMModel] = createSignal("");
  const [enableLLMEnrichment, setEnableLLMEnrichment] = createSignal(true);
  const [showAdvanced, setShowAdvanced] = createSignal(false);
  const [status, setStatus] = createSignal<{ message: string; type: "success" | "error" | "info" } | null>(null);
  const [isSaving, setIsSaving] = createSignal(false);
  const [isTesting, setIsTesting] = createSignal(false);

  // 初始化
  getSettings().then((settings) => {
    setApiKey(settings.openaiApiKey || "");
    setBaseURL(settings.baseURL || "https://api.siliconflow.cn");
    setEmbeddingModel(settings.embeddingModel || "");
    setLLMModel(settings.llmModel || "");
    setEnableLLMEnrichment(settings.enableLLMEnrichment ?? true);
  });

  const handleSave = async () => {
    if (!apiKey()) {
      setStatus({ message: "请输入 API Key", type: "error" });
      return;
    }

    setIsSaving(true);
    try {
      await saveSettings({
        openaiApiKey: apiKey(),
        baseURL: baseURL() || undefined,
        embeddingModel: embeddingModel() || undefined,
        llmModel: llmModel() || undefined,
        enableLLMEnrichment: enableLLMEnrichment(),
      });
      setStatus({ message: "✓ 设置已保存", type: "success" });
    } catch (error) {
      setStatus({ message: `保存失败: ${error}`, type: "error" });
    } finally {
      setIsSaving(false);
    }
  };

  const handleTest = async () => {
    if (!apiKey()) {
      setStatus({ message: "请输入 API Key", type: "error" });
      return;
    }

    setIsTesting(true);
    try {
      const valid = await testApiKey(apiKey(), undefined, baseURL());
      if (valid) {
        setStatus({ message: "✓ API Key 有效，连接成功", type: "success" });
      } else {
        setStatus({ message: "✗ API Key 无效", type: "error" });
      }
    } catch (error) {
      setStatus({ message: `测试失败: ${error}`, type: "error" });
    } finally {
      setIsTesting(false);
    }
  };

  return (
    <Card class="mb-6">
      <CardHeader>
        <CardTitle>🔑 API 配置</CardTitle>
      </CardHeader>
      <CardContent>
        <Input
          label="API Key"
          type="password"
          placeholder="sk-..."
          value={apiKey()}
          onInput={(e) => setApiKey(e.currentTarget.value)}
          hint="支持 SiliconFlow、OpenAI、Azure OpenAI 等兼容 API"
        />

        <div class="mt-4">
          <button
            type="button"
            onClick={() => setShowAdvanced(!showAdvanced())}
            class="text-sm text-blue-600 hover:text-blue-800 flex items-center gap-1"
          >
            {showAdvanced() ? "▼" : "▶"} 高级设置
          </button>

          <Show when={showAdvanced()}>
            <div class="mt-3 space-y-4 pl-2 border-l-2 border-gray-200">
              <Input
                label="Base URL"
                placeholder="https://api.siliconflow.cn"
                value={baseURL()}
                onInput={(e) => setBaseURL(e.currentTarget.value)}
                hint="API 基础地址，默认: https://api.siliconflow.cn"
              />

              <Input
                label="Embedding 模型"
                placeholder="BAAI/bge-m3"
                value={embeddingModel()}
                onInput={(e) => setEmbeddingModel(e.currentTarget.value)}
                hint="默认: BAAI/bge-m3 (1024维向量)"
              />

              <Input
                label="LLM 模型"
                placeholder="deepseek-ai/DeepSeek-V3"
                value={llmModel()}
                onInput={(e) => setLLMModel(e.currentTarget.value)}
                hint="默认: deepseek-ai/DeepSeek-V3 (用于摘要和标签)"
              />
            </div>
          </Show>
        </div>

        <Checkbox
          label="启用 LLM 内容增强"
          checked={enableLLMEnrichment()}
          onChange={(e) => setEnableLLMEnrichment(e.currentTarget.checked)}
          hint="使用 LLM 生成摘要和标签，提升搜索质量"
          class="mt-4"
        />

        <div class="flex gap-3 flex-wrap mt-4">
          <Button onClick={handleSave} disabled={isSaving()}>
            {isSaving() ? "保存中..." : "💾 保存"}
          </Button>
          <Button variant="outline" onClick={handleTest} disabled={isTesting()}>
            {isTesting() ? "测试中..." : "⚡ 测试连接"}
          </Button>
        </div>

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
