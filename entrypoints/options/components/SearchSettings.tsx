import { createSignal, createEffect } from "solid-js";
import { Card, CardHeader, CardTitle, CardContent } from "../../../src/components/ui/card";
import { Select } from "../../../src/components/ui/select";
import { Slider } from "../../../src/components/ui/slider";
import { Button } from "../../../src/components/ui/button";
import { Alert } from "../../../src/components/ui/alert";
import { getSettings, saveSettings } from "../../../src/db";

export default function SearchSettings() {
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
      setStatus({ message: "✓ 搜索设置已应用", type: "success" });
    } catch (error) {
      setStatus({ message: `应用失败: ${error}`, type: "error" });
    }
  };

  return (
    <Card class="mb-6">
      <CardHeader>
        <CardTitle>🔍 检索策略</CardTitle>
      </CardHeader>
      <CardContent>
        <Select
          label="搜索模式"
          value={searchMode()}
          onChange={(e) => setSearchMode(e.currentTarget.value as any)}
          options={[
            { value: "hybrid", label: "混合检索 (Hybrid - 推荐)" },
            { value: "vector", label: "纯向量检索 (Semantic Only)" },
            { value: "keyword", label: "纯关键词匹配 (Classic)" },
          ]}
          hint="混合检索结合了关键词的精准度和 AI 向量的语义理解"
        />

        <Slider
          label="向量检索权重 (Vector Weight)"
          min="0"
          max="100"
          value={vectorWeight()}
          onInput={(e) => setVectorWeight(Number(e.currentTarget.value))}
          valueDisplay={`${vectorWeight()}%`}
          hint="调高此值将让搜索结果更偏向意思相近，调低则更偏向字面匹配"
          disabled={searchMode() !== "hybrid"}
        />

        <Button onClick={handleApply}>✨ 应用检索策略</Button>

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
