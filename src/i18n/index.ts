/**
 * I18n — 轻量类型安全的国际化系统
 *
 * 支持语言: zh-CN, en, ja, ko
 * 用法: const { t } = useI18n(); t('popup.title')
 * 插值: t('github.syncSuccess', { total: 5 })
 */

import { createSignal } from "solid-js";
import zhCN from "./locales/zh-CN";
import en from "./locales/en";
import ja from "./locales/ja";
import ko from "./locales/ko";

export type Locale = "zh-CN" | "en" | "ja" | "ko";

const locales = {
  "zh-CN": zhCN,
  en,
  ja,
  ko,
} as const;

export type I18nKey = Paths<typeof zhCN>;

/** 从嵌套对象中生成点分隔的键路径类型 */
type Paths<T, D extends string = ""> = T extends string
  ? D extends ""
    ? never
    : D
  : {
      [K in keyof T]-?: K extends string
        ? T[K] extends string
          ? D extends ""
            ? K
            : `${D}.${K}`
          : T[K] extends Record<string, unknown>
            ? D extends ""
              ? Paths<T[K], K>
              : Paths<T[K], `${D}.${K}`>
            : never
        : never;
    }[keyof T];

/** 通过点分隔路径从嵌套对象中取值 */
function getNestedValue(obj: any, path: string): string | undefined {
  const parts = path.split(".");
  let current = obj;
  for (const part of parts) {
    if (current == null) return undefined;
    current = current[part];
  }
  return typeof current === "string" ? current : undefined;
}

function formatMissingKeyFallback(key: string): string {
  const tail = key.split(".").pop() || key;
  const spaced = tail
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .trim();
  if (!spaced) return key;
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

const [localeSignal, setLocaleSignal] = createSignal<Locale>("en");

/** 设置当前语言 */
export function setLocale(locale: Locale): void {
  setLocaleSignal(locale);
}

/** 获取当前语言 */
export function getLocale(): Locale {
  return localeSignal();
}

/**
 * 翻译函数
 * @param key 点分隔的翻译键
 * @param vars 插值变量对象，如 { total: 5 }
 * @returns 翻译后的字符串，如果键不存在则返回键本身
 */
export function t(
  key: I18nKey,
  vars?: Record<string, string | number>,
): string {
  const currentLocale = localeSignal();
  const fallbackLocales = [
    currentLocale,
    "en",
    "zh-CN",
  ].filter((locale, index, list) => list.indexOf(locale) === index) as Locale[];

  let text: string | undefined;
  for (const locale of fallbackLocales) {
    text = getNestedValue(locales[locale], key);
    if (text !== undefined) {
      break;
    }
  }

  if (text === undefined) {
    console.warn(`[i18n] Missing key: ${key}`);
    return formatMissingKeyFallback(key);
  }

  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      text = text.replace(new RegExp(`{{\\s*${k}\\s*}}`, "g"), String(v));
    }
  }

  return text;
}

/** Solid.js 兼容的 hook — 返回响应式 t 函数（locale 变化时 UI 自动刷新） */
export function setReactiveLocale(locale: Locale): void {
  setLocale(locale);
}

export function useI18n() {
  return { t, locale: localeSignal, setLocale: setReactiveLocale };
}

/** Locale → 人类可读语言名（用于 LLM prompt 注入） */
const LOCALE_LANGUAGE_NAMES: Record<Locale, string> = {
  "zh-CN": "Simplified Chinese (简体中文)",
  en: "English",
  ja: "Japanese (日本語)",
  ko: "Korean (한국어)",
};

/** 获取当前 UI 语言的人类可读名称，缺省回退到 English */
export function getLanguageName(locale?: string | null): string {
  if (locale && locale in LOCALE_LANGUAGE_NAMES) {
    return LOCALE_LANGUAGE_NAMES[locale as Locale];
  }
  return "English";
}

/** 浏览器语言到支持的 locale 的映射 */
export function detectBrowserLocale(): Locale {
  const lang = navigator.language || (navigator as any).userLanguage || "zh-CN";
  if (lang.startsWith("zh")) return "zh-CN";
  if (lang.startsWith("en")) return "en";
  if (lang.startsWith("ja")) return "ja";
  if (lang.startsWith("ko")) return "ko";
  return "zh-CN";
}
