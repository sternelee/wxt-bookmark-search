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
import { isEmbedConfigChanged } from "../../../src/service-config";
import { useI18n } from "../../../src/i18n";

export default function APISettings() {
  const { t } = useI18n();
  const [apiKey, setApiKey] = createSignal("");
  const [baseURL, setBaseURL] = createSignal("");
  const [embeddingModel, setEmbeddingModel] = createSignal("");
  const [llmModel, setLLMModel] = createSignal("");
  const [enableLLMEnrichment, setEnableLLMEnrichment] = createSignal(true);
  const [aiProvider, setAIProvider] = createSignal<"remote" | "disabled">("remote");
  const [showAdvanced, setShowAdvanced] = createSignal(false);
  // Per-service override: LLM / Embedding 可指向不同服务。默认收起隐藏。
  const [showPerService, setShowPerService] = createSignal(false);
  const [embedApiKey, setEmbedApiKey] = createSignal("");
  const [embedBaseURL, setEmbedBaseURL] = createSignal("");
  const [llmApiKey, setLLMApiKey] = createSignal("");
  const [llmBaseURL, setLLMBaseURL] = createSignal("");
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
    // 兼容旧设置中的 "chrome"，降级为 "remote"
    const provider = settings.aiProvider;
    setAIProvider(
      provider === "disabled" ? "disabled" : "remote",
    );
    // Per-service override 初始化
    setEmbedApiKey(settings.embedApiKey || "");
    setEmbedBaseURL(settings.embedBaseURL || "");
    setLLMApiKey(settings.llmApiKey || "");
    setLLMBaseURL(settings.llmBaseURL || "");
  });

  const handleSave = async () => {
    if (!apiKey()) {
      setStatus({ message: t("options.api.apiKeyRequired"), type: "error" });
      return;
    }

    setIsSaving(true);
    try {
      const currentSettings = await getSettings();
      const nextBaseURL = (baseURL() || "").trim().replace(/\/+$/, "");
      const nextEmbeddingModel = (embeddingModel() || "").trim();
      const nextEmbedBaseURL = (embedBaseURL() || "").trim().replace(/\/+$/, "");
      const nextLLMBaseURL = (llmBaseURL() || "").trim().replace(/\/+$/, "");
      const shouldReindexEmbeddings = isEmbedConfigChanged(currentSettings, {
        baseURL: nextBaseURL || undefined,
        embedBaseURL: nextEmbedBaseURL || undefined,
        embeddingModel: nextEmbeddingModel || undefined,
      });

      await saveSettings({
        openaiApiKey: apiKey(),
        baseURL: baseURL() || undefined,
        embeddingModel: embeddingModel() || undefined,
        llmModel: llmModel() || undefined,
        enableLLMEnrichment: enableLLMEnrichment(),
        aiProvider: aiProvider(),
        embedApiKey: embedApiKey() || undefined,
        embedBaseURL: embedBaseURL() || undefined,
        llmApiKey: llmApiKey() || undefined,
        llmBaseURL: llmBaseURL() || undefined,
      });

      if (shouldReindexEmbeddings) {
        const response = await browser.runtime.sendMessage({
          type: "REINDEX_STORED_EMBEDDINGS",
        });
        if (!response?.success) {
          throw new Error(
            response?.error || t("options.api.reindexFailedGeneric"),
          );
        }
        setStatus({
          message:
            response.queued > 0
              ? t("options.api.savedAndReindexing", {
                  count: response.queued,
                })
              : t("options.api.saved"),
          type: "success",
        });
      } else {
        setStatus({ message: t("options.api.saved"), type: "success" });
      }
    } catch (error) {
      setStatus({ message: `${t("common.saveFailed")}: ${error}`, type: "error" });
    } finally {
      setIsSaving(false);
    }
  };

  const handleTest = async () => {
    setIsTesting(true);
    try {
      if (!apiKey()) {
        setStatus({ message: t("options.api.apiKeyRequired"), type: "error" });
        return;
      }

      // Per-service override 生效判断：apiKey 或 baseURL 任一不同
      const embedHasOverride = !!embedApiKey().trim() || !!embedBaseURL().trim();
      const llmHasOverride = !!llmApiKey().trim() || !!llmBaseURL().trim();
      const separateServices = embedHasOverride || llmHasOverride;

      // Embedding 测试（始终跑，embedding 必需要）
      const embedKey = (embedApiKey() || apiKey()).trim();
      const embedBase = (embedBaseURL() || baseURL()).trim();
      const embedP = testApiKey(
        embedKey,
        embeddingModel() || undefined,
        embedBase,
      ).then(
        () => ({ ok: true as const }),
        (err) => ({
          ok: false as const,
          message: err instanceof Error ? err.message : String(err),
        }),
      );

      // LLM 测试（按原条件跑）
      const llmP =
        enableLLMEnrichment() && aiProvider() === "remote"
          ? testLlmModel(
              (llmApiKey() || apiKey()).trim(),
              llmModel() || undefined,
              (llmBaseURL() || baseURL()).trim(),
            ).then(
              () => ({ ok: true as const }),
              (err) => ({
                ok: false as const,
                message: err instanceof Error ? err.message : String(err),
              }),
            )
          : Promise.resolve({ ok: true as const, skipped: true as const });

      const [embedResult, llmResult] = await Promise.all([embedP, llmP]);

      // 组装结果消息：服务分开时逐项报告，合并时只显示一个汇总
      if (!separateServices) {
        if (!embedResult.ok) {
          setStatus({ message: embedResult.message, type: "error" });
        } else if (!llmResult.ok) {
          setStatus({ message: llmResult.message, type: "error" });
        } else {
          setStatus({
            message: t("options.api.testSuccess"),
            type: "success",
          });
        }
        return;
      }

      // separateServices 模式：逐项报告
      const embedLabel = t("options.api.testServiceEmbed");
      const llmLabel = t("options.api.testServiceLLM");
      const lines: { label: string; ok: boolean; message?: string }[] = [];
      lines.push({
        label: embedLabel,
        ok: embedResult.ok,
        message: embedResult.ok ? undefined : embedResult.message,
      });
      if (!("skipped" in llmResult) || !llmResult.skipped) {
        lines.push({
          label: llmLabel,
          ok: llmResult.ok,
          message: llmResult.ok ? undefined : llmResult.message,
        });
      }

      const allOk = lines.every((l) => l.ok);
      const okCount = lines.filter((l) => l.ok).length;
      const failCount = lines.length - okCount;

      let message: string;
      if (allOk) {
        message = t("options.api.testBothOk");
      } else if (failCount === lines.length) {
        // 两项都失败
        const embedErr = lines[0].message || "";
        const llmErr = lines[1]?.message || "";
        message = t("options.api.testBothFail", {
          embed: embedErr,
          llm: llmErr,
        });
      } else {
        // 一项失败一项成功
        const failed = lines.find((l) => !l.ok)!;
        message = t("options.api.testPartialFail", {
          failedService: failed.label,
          error: failed.message || "",
        });
      }

      setStatus({
        message,
        type: allOk ? "success" : "error",
      });
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

        {/* Per-service override：默认收起隐藏 */}
        <div class="mt-4">
          <button
            type="button"
            onClick={() => setShowPerService(!showPerService())}
            class="text-sm text-blue-600 hover:text-blue-800 flex items-center gap-1"
          >
            {showPerService() ? "▼" : "▶"}{" "}
            <span class="font-medium">
              {t("options.api.perService")}
            </span>
          </button>
          <p class="text-xs text-muted-foreground mt-1">
            {t("options.api.perServiceHint")}
          </p>

          <Show when={showPerService()}>
            <div class="mt-3 space-y-4 pl-2 border-l-2 border-gray-200">
              {/* Embedding service override */}
              <div class="rounded-md border border-border p-3 space-y-3">
                <div class="text-sm font-semibold">
                  {t("options.api.perServiceEmbedTitle")}
                </div>
                <p class="text-xs text-muted-foreground -mt-2">
                  {t("options.api.perServiceEmbedHint")}
                </p>
                <Input
                  label={t("options.api.perServiceApiKey")}
                  type="password"
                  placeholder={
                    apiKey()
                      ? t("options.api.perServiceInheritHint", {
                          value: "***",
                        })
                      : ""
                  }
                  value={embedApiKey()}
                  onInput={(e) => setEmbedApiKey(e.currentTarget.value)}
                />
                <Input
                  label={t("options.api.perServiceBaseURL")}
                  placeholder={
                    baseURL() ||
                    "https://api.openai.com"
                  }
                  value={embedBaseURL()}
                  onInput={(e) => setEmbedBaseURL(e.currentTarget.value)}
                />
                <Input
                  label={t("options.api.perServiceModel")}
                  placeholder="BAAI/bge-m3"
                  value={embeddingModel()}
                  onInput={(e) => setEmbeddingModel(e.currentTarget.value)}
                />
              </div>

              {/* LLM service override */}
              <div class="rounded-md border border-border p-3 space-y-3">
                <div class="text-sm font-semibold">
                  {t("options.api.perServiceLLMTitle")}
                </div>
                <p class="text-xs text-muted-foreground -mt-2">
                  {t("options.api.perServiceLLMHint")}
                </p>
                <Input
                  label={t("options.api.perServiceApiKey")}
                  type="password"
                  placeholder={
                    apiKey()
                      ? t("options.api.perServiceInheritHint", {
                          value: "***",
                        })
                      : ""
                  }
                  value={llmApiKey()}
                  onInput={(e) => setLLMApiKey(e.currentTarget.value)}
                />
                <Input
                  label={t("options.api.perServiceBaseURL")}
                  placeholder={
                    baseURL() ||
                    "https://api.openai.com"
                  }
                  value={llmBaseURL()}
                  onInput={(e) => setLLMBaseURL(e.currentTarget.value)}
                />
                <Input
                  label={t("options.api.perServiceModel")}
                  placeholder="deepseek-ai/DeepSeek-V3"
                  value={llmModel()}
                  onInput={(e) => setLLMModel(e.currentTarget.value)}
                />
              </div>
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

        <div class="mt-4">
          <label class="text-sm font-medium block mb-1">
            {t("options.api.aiProvider")}
          </label>
          <select
            class="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            value={aiProvider()}
            onChange={(e) =>
              setAIProvider(e.currentTarget.value as "remote" | "disabled")
            }
          >
            <option value="remote">{t("options.api.aiProviderRemote")}</option>
            <option value="disabled">{t("options.api.aiProviderDisabled")}</option>
          </select>
          <p class="text-xs text-muted-foreground mt-1">
            {t("options.api.aiProviderHint")}
          </p>
        </div>

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
