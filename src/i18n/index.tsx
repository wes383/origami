import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { zh, type LangKeys } from "./zh";
import { en } from "./en";
import { ja } from "./ja";
import { ko } from "./ko";
import { fr } from "./fr";
import { de } from "./de";
import { es } from "./es";
import { ru } from "./ru";
import { pt } from "./pt";
import { it } from "./it";
import { readText, storageKey, writeText } from "../lib/storage";

export type { LangKeys };

export type Lang =
  | "zh"
  | "en"
  | "ja"
  | "ko"
  | "fr"
  | "de"
  | "es"
  | "ru"
  | "pt"
  | "it";

/** 界面语言列表（id + 本国语言自称），语言下拉菜单遍历渲染 */
export const UI_LANGS: { id: Lang; label: string }[] = [
  { id: "zh", label: "简体中文" },
  { id: "en", label: "English" },
  { id: "ja", label: "日本語" },
  { id: "ko", label: "한국어" },
  { id: "fr", label: "Français" },
  { id: "de", label: "Deutsch" },
  { id: "es", label: "Español" },
  { id: "ru", label: "Русский" },
  { id: "pt", label: "Português" },
  { id: "it", label: "Italiano" },
];

const dicts: Record<Lang, Record<LangKeys, string>> = {
  zh,
  en,
  ja,
  ko,
  fr,
  de,
  es,
  ru,
  pt,
  it,
};
const STORAGE_KEY = storageKey("lang");

/** 浏览器语言主前缀 → 界面语言（未识别回退 en） */
const BROWSER_LANG_MAP: Record<string, Lang> = {
  zh: "zh",
  en: "en",
  ja: "ja",
  ko: "ko",
  fr: "fr",
  de: "de",
  es: "es",
  ru: "ru",
  pt: "pt",
  it: "it",
};

/** 界面语言 → <html lang> 标准 locale 标签 */
const HTML_LANG: Record<Lang, string> = {
  zh: "zh-CN",
  en: "en",
  ja: "ja",
  ko: "ko",
  fr: "fr",
  de: "de",
  es: "es",
  ru: "ru",
  pt: "pt",
  it: "it",
};

function detectLang(): Lang {
  const saved = readText(STORAGE_KEY);
  if (saved && UI_LANGS.some((l) => l.id === saved)) return saved as Lang;
  const base = navigator.language.toLowerCase().split("-")[0];
  return BROWSER_LANG_MAP[base] ?? "en";
}

interface I18nContextValue {
  lang: Lang;
  setLang: (lang: Lang) => void;
  t: (key: LangKeys) => string;
}

const I18nContext = createContext<I18nContextValue | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(detectLang);

  const setLang = useCallback((next: Lang) => {
    writeText(STORAGE_KEY, next);
    setLangState(next);
  }, []);

  useEffect(() => {
    document.documentElement.lang = HTML_LANG[lang];
    document.title = dicts[lang].docTitle;
  }, [lang]);

  const t = useCallback((key: LangKeys) => dicts[lang][key], [lang]);

  return (
    <I18nContext.Provider value={{ lang, setLang, t }}>
      {children}
    </I18nContext.Provider>
  );
}

export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useI18n must be used within I18nProvider");
  return ctx;
}
