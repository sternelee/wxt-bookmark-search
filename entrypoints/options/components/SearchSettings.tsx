import { createSignal, createEffect } from "solid-js";
import type { SearchMode } from "../../../src/types";
import { Card, CardHeader, CardTitle, CardContent } from "../../../src/components/ui/card";
import { Select } from "../../../src/components/ui/select";
import { Slider } from "../../../src/components/ui/slider";
import { Input } from "../../../src/components/ui/input";
import { Button } from "../../../src/components/ui/button";
import { Alert } from "../../../src/components/ui/alert";
import { getSettings, saveSettings } from "../../../src/db";
import { useI18n } from "../../../src/i18n";

const SEARCH_MODES: SearchMode[] = ["hybrid", "vector", "keyword"];

function toSearchMode(value: string): SearchMode {
  return SEARCH_MODES.find((m) => m === value) ?? "hybrid";
}

export default function SearchSettings() {
  const { t } = useI18n();
  const [searchMode, setSearchMode] = createSignal<SearchMode>("hybrid");
  const [vectorWeight, setVectorWeight] = createSignal(40);
  const [resultLimit, setResultLimit] = createSignal(20);
  const [ragTopK, setRagTopK] = createSignal(8);
  const [status, setStatus] = createSignal<{ message: string; type: "success" | "error" } | null>(null);

  // 初始化
  getSettings().then((settings) => {
    setSearchMode(toSearchMode(settings.searchMode));
    setVectorWeight(Math.round((settings.vectorWeight || 0.4) * 100));
    setResultLimit(settings.searchResultLimit ?? 20);
    setRagTopK(settings.ragTopK ?? 8);
  });

  const handleApply = async () => {
    try {
      await saveSettings({
        searchMode: searchMode(),
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
