/**
 * 页面滤镜 Hook — 纯 CSS filter 实现的阅读区调色，零渲染成本：
 * 把滤镜字符串写入 <html> 的 --page-filter 变量，由 global.css 里
 * `.pdf-page canvas` / `.thumb-frame canvas` 消费（缩略图跟随）；
 * `.print-root canvas` 显式 reset 为 none——打印要的是原色。
 *
 * 预设四档：
 * - off    不滤镜
 * - night  invert(1) hue-rotate(180deg) —— 经典夜间反色
 * - paper  sepia(0.35) saturate(0.9) brightness(0.98) —— 护眼纸色
 * - custom 亮度 / 对比度 / 色温三个滑块自由组合
 */

import { useCallback, useEffect, useState } from "react";
import { readJson, storageKey, writeJson } from "../lib/storage";

export type PageFilterMode = "off" | "night" | "paper" | "custom";

/** custom 档的三个滑块值 */
export interface PageFilterCustom {
  /** 亮度 50–150（%） */
  brightness: number;
  /** 对比度 50–150（%） */
  contrast: number;
  /** 色温（暖色程度）0–100，映射 sepia 0–0.5；0 为无色偏 */
  warmth: number;
}

export interface PageFilterState {
  mode: PageFilterMode;
  custom: PageFilterCustom;
}

const STORAGE_KEY = storageKey("page-filter");

const DEFAULT_CUSTOM: PageFilterCustom = { brightness: 100, contrast: 100, warmth: 0 };

/** 夜间反色：invert 后色相翻转，避免反色后蓝色变橙色刺眼 */
const NIGHT_FILTER = "invert(1) hue-rotate(180deg)";
/** 护眼纸色 */
const PAPER_FILTER = "sepia(0.35) saturate(0.9) brightness(0.98)";

/** 由档位与自定义参数计算 CSS filter 字符串 */
export function pageFilterCss(state: PageFilterState): string {
  switch (state.mode) {
    case "night":
      return NIGHT_FILTER;
    case "paper":
      return PAPER_FILTER;
    case "custom": {
      const parts = [
        `brightness(${state.custom.brightness / 100})`,
        `contrast(${state.custom.contrast / 100})`,
      ];
      if (state.custom.warmth > 0) parts.push(`sepia(${state.custom.warmth / 200})`);
      return parts.join(" ");
    }
    default:
      return "none";
  }
}

function loadState(): PageFilterState {
  const saved = readJson<Partial<PageFilterState> | null>(STORAGE_KEY, null);
  if (!saved) return { mode: "off", custom: { ...DEFAULT_CUSTOM } };
  const mode: PageFilterMode =
    saved.mode === "night" || saved.mode === "paper" || saved.mode === "custom"
      ? saved.mode
      : "off";
  const c = saved.custom;
  const clamp = (v: unknown, lo: number, hi: number, fallback: number) =>
    typeof v === "number" && Number.isFinite(v)
      ? Math.min(hi, Math.max(lo, v))
      : fallback;
  return {
    mode,
    custom: {
      brightness: clamp(c?.brightness, 50, 150, 100),
      contrast: clamp(c?.contrast, 50, 150, 100),
      warmth: clamp(c?.warmth, 0, 100, 0),
    },
  };
}

export function usePageFilter() {
  const [state, setState] = useState<PageFilterState>(loadState);

  // 写入 <html> 的 --page-filter：阅读区页面与侧栏缩略图都从这里继承，
  // 打印 DOM（.print-root）在 CSS 里显式排除
  useEffect(() => {
    document.documentElement.style.setProperty("--page-filter", pageFilterCss(state));
  }, [state]);

  // 状态变化即持久化
  useEffect(() => {
    writeJson(STORAGE_KEY, state);
  }, [state]);

  const setMode = useCallback((mode: PageFilterMode) => {
    setState((s) => (s.mode === mode ? s : { ...s, mode }));
  }, []);

  /** 更新 custom 档的滑块值（clamp 保证落库数据合法） */
  const setCustom = useCallback((patch: Partial<PageFilterCustom>) => {
    setState((s) => ({
      mode: "custom",
      custom: {
        brightness: Math.min(150, Math.max(50, patch.brightness ?? s.custom.brightness)),
        contrast: Math.min(150, Math.max(50, patch.contrast ?? s.custom.contrast)),
        warmth: Math.min(100, Math.max(0, patch.warmth ?? s.custom.warmth)),
      },
    }));
  }, []);

  return { ...state, setMode, setCustom };
}

export type PageFilter = ReturnType<typeof usePageFilter>;
