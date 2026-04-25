import { createSignal, createEffect } from "solid-js";
import { Card, CardHeader, CardTitle, CardContent } from "../../../src/components/ui/card";
import { Select } from "../../../src/components/ui/select";
import { Slider } from "../../../src/components/ui/slider";
import { Button } from "../../../src/components/ui/button";
import { Alert } from "../../../src/components/ui/alert";
import { getSettings, saveSettings } from "../../../src/db";
import { useI18n } from "../../../src/i18n";

export default function SearchSettings() {
  const { t } = useI18n();
  const [searchMode, setSearchMode] = createSignal<"hybrid" | "vector" | "keyword">("hybrid");
  const [vectorWeight, setVectorWeight] = createSignal(40);
  const [status, setStatus] = createSignal<{ message: string; type: "success" | "error" } | null>(null);

  // 初始化
  getSettings().then((settings) => {
    setSearchMode((settings.searchMode as any) || "hybrid");
    setVectorWeight(Math.round((settings.vectorWeight || 0.4) * 100));
  });

  const handleApply = async () => {
    try {
      await saveSettings({
        searchMode: searchMode(),
        vectorWeight: vectorWeight() / 100,
      });
      setStatus({ message: t("options.search.applied"), type: "success" });
    } catch (error) {
      setStatus({ message: `应用失败: ${error}`, type: "error" });
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
          onChange={(e) => setSearchMode(e.currentTarget.value as any)}
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
