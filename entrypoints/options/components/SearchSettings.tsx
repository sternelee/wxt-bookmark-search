import { createSignal, createEffect } from "solid-js";
import type { SearchEngine, SearchMode } from "../../../src/types";
import { Card, CardHeader, CardTitle, CardContent } from "../../../src/components/ui/card";
import { Select } from "../../../src/components/ui/select";
import { Slider } from "../../../src/components/ui/slider";
import { Input } from "../../../src/components/ui/input";
import { Button } from "../../../src/components/ui/button";
import { Alert } from "../../../src/components/ui/alert";
import { getSettings, saveSettings } from "../../../src/db";
import { jevSystemOne } from "../../../src/jev";
import { useI18n } from "../../../src/i18n";

const SEARCH_MODES: SearchMode[] = ["hybrid", "vector", "keyword"];

const SEARCH_ENGINES: SearchEngine[] = ["orama", "jev"];

function toSearchMode(value: string): SearchMode {
  return SEARCH_MODES.find((m) => m === value) ?? "hybrid";
}

function toSearchEngine(value: string): SearchEngine {
  return SEARCH_ENGINES.find((e) => e === value) ?? "orama";
}

export default function SearchSettings() {
  const { t } = useI18n();
  const [searchMode, setSearchMode] = createSignal<SearchMode>("hybrid");
  const [searchEngine, setSearchEngine] = createSignal<SearchEngine>("orama");
  const [jevApiKey, setJevApiKey] = createSignal("");
  const [jevBaseURL, setJevBaseURL] = createSignal("");
  const [jevTesting, setJevTesting] = createSignal(false);
  const [vectorWeight, setVectorWeight] = createSignal(40);
  const [resultLimit, setResultLimit] = createSignal(20);
  const [ragTopK, setRagTopK] = createSignal(8);
  const [status, setStatus] = createSignal<{ message: string; type: "success" | "error" | "info" } | null>(null);

  // 初始化
  getSettings().then((settings) => {
    setSearchMode(toSearchMode(settings.searchMode));
    setSearchEngine(toSearchEngine(settings.searchEngine ?? "orama"));
    setJevApiKey(settings.jevApiKey ?? "");
    setJevBaseURL(settings.jevBaseURL ?? "");
    setVectorWeight(Math.round((settings.vectorWeight || 0.4) * 100));
    setResultLimit(settings.searchResultLimit ?? 20);
    setRagTopK(settings.ragTopK ?? 8);
  });

  const handleJevTest = async () => {
    const settings = await getSettings();
    const apiKey = jevApiKey().trim() || settings.jevApiKey;
    if (!apiKey) {
      setStatus({ message: t("options.search.jevTestNeedKey"), type: "error" });
      return;
    }
    setJevTesting(true);
    setStatus({ message: t("options.search.jevTesting"), type: "info" });
    try {
      // 探针请求：验证 Key 有效性、端点可达性与响应协议
      await jevSystemOne(
        { apiKey, baseURL: jevBaseURL().trim() || settings.jevBaseURL },
        {
          request: "Flow Search connection test",
          results: [
            { source: "bookmark", title: "Flow Search", snippet: "connection test" },
          ],
        },
        {
          ok: {
            type: "noul",
            instructions: "Is `results[0]` a test record?",
            criteria: { true: "a test record", false: "not a test record" },
          },
        },
      );
      setStatus({ message: t("options.search.jevTestOk"), type: "success" });
    } catch (error) {
      setStatus({
        message: t("options.search.jevTestFailed", {
          error: error instanceof Error ? error.message : String(error),
        }),
        type: "error",
      });
    } finally {
      setJevTesting(false);
    }
  };

  const handleApply = async () => {
    if (searchEngine() === "jev" && !jevApiKey().trim()) {
      setStatus({ message: t("options.search.jevKeyRequired"), type: "error" });
      return;
    }
    try {
      await saveSettings({
        searchMode: searchMode(),
        searchEngine: searchEngine(),
        jevApiKey: jevApiKey().trim() || undefined,
        jevBaseURL: jevBaseURL().trim() || undefined,
        vectorWeight: vectorWeight() / 100,
        searchResultLimit: Math.min(50, Math.max(5, Math.round(resultLimit()))),
        ragTopK: Math.min(20, Math.max(1, Math.round(ragTopK()))),
      });
      setStatus({ message: t("options.search.applied"), type: "success" });
    } catch (error) {
      setStatus({
        message: `${t("options.search.applyFailed")}: ${error}`,
        type: "error",
      });
    }
  };

  return (
    <Card class="mb-6">
      <CardHeader>
        <CardTitle>{t("options.search.title")}</CardTitle>
      </CardHeader>
      <CardContent>
        <Select
          label={t("options.search.mode")}
          value={searchMode()}
          onChange={(e) => setSearchMode(toSearchMode(e.currentTarget.value))}
          options={[
            { value: "hybrid", label: t("options.search.modeHybrid") },
            { value: "vector", label: t("options.search.modeVector") },
            { value: "keyword", label: t("options.search.modeKeyword") },
          ]}
          hint={t("options.search.modeHint")}
        />

        <Select
          label={t("options.search.engine")}
          value={searchEngine()}
          onChange={(e) => setSearchEngine(toSearchEngine(e.currentTarget.value))}
          options={[
            { value: "orama", label: t("options.search.engineOrama") },
            { value: "jev", label: t("options.search.engineJev") },
          ]}
          hint={t("options.search.engineHint")}
        />

        {searchEngine() === "jev" && (
          <>
            <div class="mt-3">
              <Input
                label={t("options.search.jevApiKey")}
                type="password"
                placeholder="ts-..."
                value={jevApiKey()}
                onInput={(e) => setJevApiKey(e.currentTarget.value)}
                hint={t("options.search.jevApiKeyHint")}
              />
            </div>
            <div class="mt-3">
              <Input
                label={t("options.search.jevBaseURL")}
                type="text"
                placeholder="https://api.typesafe.ai/v1/systemone"
                value={jevBaseURL()}
                onInput={(e) => setJevBaseURL(e.currentTarget.value)}
                hint={t("options.search.jevBaseURLHint")}
              />
            </div>
            <div class="mt-3">
              <Button
                variant="outline"
                size="sm"
                disabled={jevTesting()}
                onClick={handleJevTest}
              >
                {jevTesting() ? t("options.search.jevTesting") : t("options.search.jevTest")}
              </Button>
            </div>
          </>
        )}

        <Slider
          label={t("options.search.vectorWeight")}
          min="0"
          max="100"
          value={vectorWeight()}
          onInput={(e) => setVectorWeight(Number(e.currentTarget.value))}
          valueDisplay={`${vectorWeight()}%`}
          hint={t("options.search.vectorWeightHint")}
          disabled={searchMode() !== "hybrid"}
        />

        <div class="mt-3">
          <Input
            label={t("options.search.resultLimit")}
            type="number"
            placeholder="20"
            value={String(resultLimit())}
            onInput={(e) => {
              const v = parseInt(e.currentTarget.value, 10);
              if (!isNaN(v) && v >= 5 && v <= 50) setResultLimit(v);
            }}
            hint={t("options.search.resultLimitHint")}
          />
        </div>

        <div class="mt-3">
          <Input
            label={t("options.search.ragTopK")}
            type="number"
            placeholder="8"
            value={String(ragTopK())}
            onInput={(e) => {
              const v = parseInt(e.currentTarget.value, 10);
              if (!isNaN(v) && v >= 1 && v <= 20) setRagTopK(v);
            }}
            hint={t("options.search.ragTopKHint")}
          />
        </div>

        <Button onClick={handleApply}>{t("common.apply")}</Button>

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
