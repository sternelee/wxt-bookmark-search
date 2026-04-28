import { createSignal, Show } from "solid-js";
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
import { testApiKey } from "../../../src/embedding";
import { testLlmModel } from "../../../src/llm";
import { useI18n } from "../../../src/i18n";

export default function APISettings() {
  const { t } = useI18n();
  const [apiKey, setApiKey] = createSignal("");
  const [baseURL, setBaseURL] = createSignal("");
  const [embeddingModel, setEmbeddingModel] = createSignal("");
  const [llmModel, setLLMModel] = createSignal("");
  const [enableLLMEnrichment, setEnableLLMEnrichment] = createSignal(true);
  const [showAdvanced, setShowAdvanced] = createSignal(false);
  const [status, setStatus] = createSignal<{
    message: string;
    type: "success" | "error" | "info";
  } | null>(null);
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
      setStatus({ message: t("options.api.apiKeyRequired"), type: "error" });
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
      setStatus({ message: t("options.api.saved"), type: "success" });
    } catch (error) {
      setStatus({ message: `保存失败: ${error}`, type: "error" });
    } finally {
      setIsSaving(false);
    }
  };

  const handleTest = async () => {
    if (!apiKey()) {
      setStatus({ message: t("options.api.apiKeyRequired"), type: "error" });
      return;
    }

    setIsTesting(true);
    try {
      await testApiKey(apiKey(), embeddingModel() || undefined, baseURL());
      if (enableLLMEnrichment()) {
        await testLlmModel(apiKey(), llmModel() || undefined, baseURL());
      }
      setStatus({ message: t("options.api.testSuccess"), type: "success" });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      setStatus({ message: msg, type: "error" });
    } finally {
      setIsTesting(false);
    }
  };

  return (
    <Card class="mb-6">
      <CardHeader>
        <CardTitle>{t("options.api.title")}</CardTitle>
      </CardHeader>
      <CardContent>
        <Input
          label="API Key"
          type="password"
          placeholder="sk-..."
          value={apiKey()}
          onInput={(e) => setApiKey(e.currentTarget.value)}
          hint={t("options.api.apiKeyHint")}
        />

        <div class="mt-4">
          <button
            type="button"
            onClick={() => setShowAdvanced(!showAdvanced())}
            class="text-sm text-blue-600 hover:text-blue-800 flex items-center gap-1"
          >
            {showAdvanced() ? "▼" : "▶"} {t("options.api.advanced")}
          </button>

          <Show when={showAdvanced()}>
            <div class="mt-3 space-y-4 pl-2 border-l-2 border-gray-200">
              <Input
                label="Base URL"
                placeholder="https://api.siliconflow.cn"
                value={baseURL()}
                onInput={(e) => setBaseURL(e.currentTarget.value)}
                hint={t("options.api.baseURLHint")}
              />

              <Input
                label={t("options.api.embeddingModel")}
                placeholder="BAAI/bge-m3"
                value={embeddingModel()}
                onInput={(e) => setEmbeddingModel(e.currentTarget.value)}
                hint={t("options.api.embeddingModelHint")}
              />

              <Input
                label={t("options.api.llmModel")}
                placeholder="deepseek-ai/DeepSeek-V3"
                value={llmModel()}
                onInput={(e) => setLLMModel(e.currentTarget.value)}
                hint={t("options.api.llmModelHint")}
              />
            </div>
          </Show>
        </div>

        <Checkbox
          label={t("options.api.enableLLM")}
          checked={enableLLMEnrichment()}
          onChange={(e) => setEnableLLMEnrichment(e.currentTarget.checked)}
          hint={t("options.api.enableLLMHint")}
          class="mt-4"
        />

        <div class="flex gap-3 flex-wrap mt-4">
          <Button onClick={handleSave} disabled={isSaving()}>
            {isSaving() ? t("common.saving") : t("common.save")}
          </Button>
          <Button variant="outline" onClick={handleTest} disabled={isTesting()}>
            {isTesting() ? t("common.testing") : t("common.test")}
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
