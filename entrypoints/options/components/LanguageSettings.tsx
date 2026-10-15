import { createSignal } from "solid-js";
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
} from "../../../src/components/ui/card";
import { SelectField } from "../../../src/components/form/SelectField";
import { Button } from "../../../src/components/ui/button";
import { StatusAlert } from "../../../src/components/form/StatusAlert";
import { getSettings, saveSettings } from "../../../src/db";
import { useI18n, type Locale } from "../../../src/i18n";

const LOCALE_OPTIONS: { value: Locale; label: string }[] = [
  { value: "zh-CN", label: "简体中文" },
  { value: "en", label: "English" },
  { value: "ja", label: "日本語" },
  { value: "ko", label: "한국어" },
];

function formatErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export default function LanguageSettings() {
  const { t, setLocale } = useI18n();
  // 与 defaultSettings.language 保持一致（src/db.ts 默认 "en"）
  const [locale, setLocaleSignal] = createSignal<Locale>("en");
  const [status, setStatus] = createSignal<{
    message: string;
    type: "success" | "error";
  } | null>(null);

  // 初始化
  getSettings().then((settings) => {
    const lang = (settings.language as Locale) || "en";
    setLocaleSignal(lang);
  });

  const handleApply = async () => {
    try {
      await saveSettings({ language: locale() });
      setLocale(locale());
      setStatus({ message: t("options.language.saved"), type: "success" });
    } catch (error) {
      setStatus({
        message: `${t("common.saveFailed")}: ${formatErrorMessage(error)}`,
        type: "error",
      });
    }
  };

  return (
    <Card class="mb-6">
      <CardHeader>
        <CardTitle>🌐 {t("options.language.title")}</CardTitle>
      </CardHeader>
      <CardContent>
        <SelectField
          label={t("options.language.label")}
          value={locale()}
          onChange={(value) => setLocaleSignal(value as Locale)}
          options={LOCALE_OPTIONS}
          hint={t("options.language.hint")}
        />

        <Button onClick={handleApply} class="mt-4">
          {t("common.save")}
        </Button>

        <StatusAlert status={status()} />
      </CardContent>
    </Card>
  );
}
