import { createSignal } from "solid-js";
import { Card, CardHeader, CardTitle, CardContent } from "../../../src/components/ui/card";
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
      setStatus({ message: t("options.search.applied"), type: "success" });
    } catch (error) {
      setStatus({
        message: `${t("common.error")}: ${error}`,
        type: "error",
      });
    }
  };

  return (
    <Card class="mb-6">
      <CardHeader>
        <CardTitle>🌐 {t("common.language") || "语言设置"}</CardTitle>
      </CardHeader>
      <CardContent>
        <Select
          label={t("common.language") || "界面语言"}
          value={locale()}
          onChange={(e) => setLocaleSignal(e.currentTarget.value as Locale)}
          options={LOCALE_OPTIONS}
          hint="切换后需保存设置，部分文本可能需刷新页面生效"
        />

        <Button onClick={handleApply} class="mt-4">
          {t("common.apply")}
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
