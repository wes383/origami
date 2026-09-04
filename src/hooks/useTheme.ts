import { useCallback, useEffect, useState } from "react";
import { readText, storageKey, writeText } from "../lib/storage";

export type Theme = "light" | "dark";
export type ThemePref = "light" | "dark" | "system";

const STORAGE_KEY = storageKey("theme");

function initialPref(): ThemePref {
  const saved = readText(STORAGE_KEY);
  if (saved === "light" || saved === "dark" || saved === "system") return saved;
  return "system";
}

function systemTheme(): Theme {
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

export function useTheme() {
  const [pref, setPrefState] = useState<ThemePref>(initialPref);
  /** system 模式下跟随系统变化 */
  const [systemPref, setSystemPref] = useState<Theme>(systemTheme);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => setSystemPref(systemTheme());
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  const theme: Theme = pref === "system" ? systemPref : pref;

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  const setThemePref = useCallback((next: ThemePref) => {
    setPrefState(next);
    writeText(STORAGE_KEY, next);
  }, []);

  /** 在 light/dark 间切换（system 视为当前生效主题的反面） */
  const toggleTheme = useCallback(() => {
    setThemePref(theme === "light" ? "dark" : "light");
  }, [theme, setThemePref]);

  return { theme, pref, setThemePref, toggleTheme };
}
