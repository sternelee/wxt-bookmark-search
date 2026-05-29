import { createSignal } from "solid-js";
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
} from "../../../src/components/ui/card";
import { Select } from "../../../src/components/ui/select";
import { Button } from "../../../src/components/ui/button";
import { Alert } from "../../../src/components/ui/alert";
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
  const [locale, setLocaleSignal] = createSignal<Locale>("zh-CN");
  const [status, setStatus] = createSignal<{
    message: string;
    type: "success" | "error";
  } | null>(null);

  // 初始化
  getSettings().then((settings) => {
    const lang = (settings.language as Locale) || "zh-CN";
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
        <Select
          label={t("options.language.label")}
          value={locale()}
          onChange={(e) => setLocaleSignal(e.currentTarget.value as Locale)}
          options={LOCALE_OPTIONS}
          hint={t("options.language.hint")}
        />

        <Button onClick={handleApply} class="mt-4">
          {t("common.save")}
        </Button>

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
