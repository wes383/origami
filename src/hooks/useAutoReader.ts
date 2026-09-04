/**
 * 自动阅读 Hook — 长文档（扫描件 / 校对稿）免手动翻页：
 * - 滚动模式（flipMode === "scroll"）：requestAnimationFrame 内按 px/s 累加容器 scrollTop，
 *   到达底部（scrollTop + clientHeight >= scrollHeight）自动停止。
 * - 翻页模式（flipMode === "paged"）：自调度定时器按「秒/页」间隔调用 goToPage(currentPage + step)，
 *   跨过最后一页后自动停止。
 *
 * 两种模式的速度体系彼此独立、各自持久化：
 * - 滚动模式速度 = px/s，档位表 AUTO_SPEED_LEVELS（21 档 10–500），可自定义 1–2400，
 *   存储键 origami.auto-speed-px；
 * - 翻页模式速度 = 秒/页，档位表 PAGED_SEC_LEVELS（13 档 1–300，数值小 = 翻页快），
 *   可自定义 0.1–300，存储键 origami.auto-paged-sec。
 * 空格键暂停/恢复（由调用方接入键盘）。
 *
 * 关键约束：驱动 effect 只依赖 [isPlaying, enabled, flipMode]，绝不依赖 currentPage。
 * 滚动模式下自动滚动会使 useVisiblePages 观察器回报新的 currentPage，若驱动因此被
 * 重建就会"页码变化 → 重置定时器"形成抖动，故所有实时值均经 ref 读取；autoScrollingRef
 * 同时作为"本轮自动滚动由本模块驱动"的显式标记，供 PdfViewer 区分用户滚动与自动滚动。
 */

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { storageKey, readText, writeText } from "../lib/storage";
import type { FlipMode, PageLayout } from "../components/PdfViewer";

/** 滚动模式速度档位表（21 档 px/s，由慢到快） */
export const AUTO_SPEED_LEVELS: number[] = [
  10, 12, 15, 20, 25, 30, 40, 50, 60, 70, 80, 90,
  100, 120, 150, 175, 200, 250, 300, 400, 500,
];

/** 翻页模式速度档位表（13 档 秒/页，数值越小 = 翻页越快；数组按数值升序） */
export const PAGED_SEC_LEVELS: number[] = [
  1, 2, 5, 10, 15, 20, 30, 50, 75, 100, 150, 200, 300,
];

const SPEED_KEY = storageKey("auto-speed-px");
/** 滚动默认档位：90 px/s（原默认，节奏适中） */
const DEFAULT_PX = 90;
const MIN_PX = 1;
const MAX_PX = 2400;

const PAGED_KEY = storageKey("auto-paged-sec");
/** 翻页默认档位：50 秒/页（档位表内第 8 档） */
const DEFAULT_PAGED_SEC = 50;
const MIN_PAGED_SEC = 0.1;
const MAX_PAGED_SEC = 300;

/** 数值 v 在升序档位表 list 中最近的索引（步进起点用） */
const nearestIndex = (list: number[], v: number): number => {
  let best = 0;
  let bestDiff = Infinity;
  for (let i = 0; i < list.length; i++) {
    const d = Math.abs(list[i] - v);
    if (d < bestDiff) {
      bestDiff = d;
      best = i;
    }
  }
  return best;
};

export interface UseAutoReaderArgs {
  /** 阅读区滚动容器（与 PdfViewer 共用同一 ref） */
  containerRef: RefObject<HTMLElement | null>;
  /** 文档已打开（驱动仅在 enabled 时运行） */
  enabled: boolean;
  flipMode: FlipMode;
  numPages: number;
  pageLayout: PageLayout;
  /** currentPage 的镜像 ref：驱动读取最新值，避免因依赖 currentPage 而重建 */
  currentPageRef: RefObject<number>;
  goToPage: (page: number) => void;
}

export interface UseAutoReaderResult {
  isPlaying: boolean;
  /** 滚动模式当前速度（px/s），自定义时即手动输入值 */
  speedPx: number;
  /** 翻页模式当前速度（秒/页），自定义时即手动输入值 */
  pagedSec: number;
  /** 指定模式当前速度在对应档位表中的索引（0-based）；自定义速度时为 -1 */
  speedIndex: (mode: FlipMode) => number;
  /** 指定模式档位总数 */
  speedCount: (mode: FlipMode) => number;
  /** 播放/暂停切换（空格键调用） */
  toggle: () => void;
  /** 暂停并停止驱动（手动滚动 / 方向键接管 / 关闭文档时调用） */
  pause: () => void;
  /** 彻底停止（同 pause，语义上用于文档关闭复位） */
  stop: () => void;
  /** 指定模式沿其档位表步进（-1 / +1），落盘 localStorage */
  cycleSpeed: (dir: 1 | -1, mode: FlipMode) => void;
  /** 指定模式当前速度在中段输入框显示的数值
      （滚动模式 = px/s 整数；翻页模式 = 秒/页，保留 1 位小数） */
  speedValue: (mode: FlipMode) => string;
  /** 从中段输入框提交一个数值：按当前模式解释并落盘（自定义值直接生效） */
  commitSpeed: (value: number, mode: FlipMode) => void;
  /** 本轮自动阅读是否由本模块驱动（PdfViewer 用于区分用户滚动） */
  autoScrollingRef: RefObject<boolean>;
}

const loadSpeedPx = (): number => {
  const raw = readText(SPEED_KEY);
  const n = raw == null ? NaN : parseFloat(raw);
  if (Number.isFinite(n) && n >= MIN_PX && n <= MAX_PX) return n;
  return DEFAULT_PX;
};

const writeSpeedPx = (px: number) => writeText(SPEED_KEY, String(px));

const loadPagedSec = (): number => {
  const raw = readText(PAGED_KEY);
  const n = raw == null ? NaN : parseFloat(raw);
  if (Number.isFinite(n) && n >= MIN_PAGED_SEC && n <= MAX_PAGED_SEC) return n;
  return DEFAULT_PAGED_SEC;
};

const writePagedSec = (sec: number) => writeText(PAGED_KEY, String(sec));

export function useAutoReader({
  containerRef,
  enabled,
  flipMode,
  numPages,
  pageLayout,
  currentPageRef,
  goToPage,
}: UseAutoReaderArgs): UseAutoReaderResult {
  const [isPlaying, setIsPlaying] = useState(false);
  const [speedPx, setSpeedPx] = useState<number>(loadSpeedPx);
  const [pagedSec, setPagedSec] = useState<number>(loadPagedSec);

  /** 本轮自动阅读是否由本模块驱动 */
  const autoScrollingRef = useRef(false);

  // 实时值镜像：驱动 effect 只在这些 ref 上读最新值，绝不把 currentPage 放进依赖
  const flipRef = useRef(flipMode);
  flipRef.current = flipMode;
  const numPagesRef = useRef(numPages);
  numPagesRef.current = numPages;
  const layoutRef = useRef(pageLayout);
  layoutRef.current = pageLayout;
  const speedRef = useRef(speedPx);
  speedRef.current = speedPx;
  const pagedSecRef = useRef(pagedSec);
  pagedSecRef.current = pagedSec;
  const goToRef = useRef(goToPage);
  goToRef.current = goToPage;

  const stop = useCallback(() => {
    autoScrollingRef.current = false;
    setIsPlaying(false);
  }, []);

  const pause = useCallback(() => {
    autoScrollingRef.current = false;
    setIsPlaying(false);
  }, []);

  const toggle = useCallback(() => {
    setIsPlaying((p) => {
      const next = !p;
      autoScrollingRef.current = next;
      return next;
    });
  }, []);

  /** 滚动模式沿 px/s 档位表步进 */
  const cycleScroll = useCallback((dir: 1 | -1) => {
    setSpeedPx((prev) => {
      let idx = AUTO_SPEED_LEVELS.indexOf(prev);
      if (idx < 0) idx = nearestIndex(AUTO_SPEED_LEVELS, prev);
      const next = Math.min(
        AUTO_SPEED_LEVELS.length - 1,
        Math.max(0, idx + dir)
      );
      const px = AUTO_SPEED_LEVELS[next];
      writeSpeedPx(px);
      return px;
    });
  }, []);

  /** 翻页模式沿 秒/页 档位表步进 */
  const cyclePaged = useCallback((dir: 1 | -1) => {
    setPagedSec((prev) => {
      let idx = PAGED_SEC_LEVELS.indexOf(prev);
      if (idx < 0) idx = nearestIndex(PAGED_SEC_LEVELS, prev);
      const next = Math.min(
        PAGED_SEC_LEVELS.length - 1,
        Math.max(0, idx + dir)
      );
      const sec = PAGED_SEC_LEVELS[next];
      writePagedSec(sec);
      return sec;
    });
  }, []);

  const cycleSpeed = useCallback(
    (dir: 1 | -1, mode: FlipMode) => {
      if (mode === "paged") cyclePaged(dir);
      else cycleScroll(dir);
    },
    [cycleScroll, cyclePaged]
  );

  const setCustomSpeed = useCallback((raw: number) => {
    const px = Math.min(MAX_PX, Math.max(MIN_PX, Math.round(raw)));
    writeSpeedPx(px);
    setSpeedPx(px);
  }, []);

  const setCustomPagedSec = useCallback((raw: number) => {
    const sec = Math.min(
      MAX_PAGED_SEC,
      Math.max(MIN_PAGED_SEC, Math.round(raw * 10) / 10)
    );
    writePagedSec(sec);
    setPagedSec(sec);
  }, []);

  /** 中段输入框显示的数值：滚动模式 = px/s 整数；翻页模式 = 秒/页（保留 1 位小数） */
  const speedValue = useCallback(
    (mode: FlipMode): string => {
      if (mode === "paged") return String(Math.round(pagedSec * 10) / 10);
      return String(Math.round(speedPx));
    },
    [speedPx, pagedSec]
  );

  /** 从中段输入框提交：按当前模式解释（自定义值直接落盘生效，无需吸附档位） */
  const commitSpeed = useCallback(
    (value: number, mode: FlipMode) => {
      if (!Number.isFinite(value) || value <= 0) return;
      if (mode === "paged") setCustomPagedSec(value);
      else setCustomSpeed(value);
    },
    [setCustomPagedSec, setCustomSpeed]
  );

  /** 当前速度在指定模式档位表中的索引；自定义速度不在表内时返回 -1 */
  const speedIndex = useCallback(
    (mode: FlipMode): number => {
      if (mode === "paged") return PAGED_SEC_LEVELS.indexOf(pagedSec);
      return AUTO_SPEED_LEVELS.indexOf(speedPx);
    },
    [speedPx, pagedSec]
  );

  /** 指定模式档位总数 */
  const speedCount = useCallback(
    (mode: FlipMode): number =>
      mode === "paged" ? PAGED_SEC_LEVELS.length : AUTO_SPEED_LEVELS.length,
    []
  );

  // 主驱动：仅在 播放状态 / 文档可用 / 翻页模式 变化时重启。
  // 注意：currentPage 不在依赖里 —— 自动滚动经观察器回报的页码变化不会重建此 effect，
  // 因而不会"反向重置定时器"。所有实时值经 ref 读取。
  useEffect(() => {
    if (!isPlaying || !enabled) {
      autoScrollingRef.current = false;
      return;
    }
    const el = containerRef.current;
    if (!el) {
      autoScrollingRef.current = false;
      setIsPlaying(false);
      return;
    }
    autoScrollingRef.current = true;

    const pxOf = () => speedRef.current;
    const secOf = () => pagedSecRef.current;

    if (flipRef.current === "scroll") {
      let raf = 0;
      let last = performance.now();
      // 亚像素累加器：scrollTop 读回会被取整，若每帧用「scrollTop + delta」回写，
      // 低速度（如 20px/s→0.33px/帧）会被反复取整回 0，表现为完全不动。
      // 故用独立的浮点累加量保留进度，写回时不再从 scrollTop 回读。
      const startTop = el.scrollTop;
      let accum = 0;
      const tick = (now: number) => {
        if (!autoScrollingRef.current) return;
        const dt = now - last;
        last = now;
        // 模式在播放中途被切换：交给定时器分支处理，停止这里的 rAF
        if (flipRef.current !== "scroll") {
          autoScrollingRef.current = false;
          return;
        }
        const max = el.scrollHeight - el.clientHeight;
        // 到底自动停（含极小容差，避免浮点误差在临界处反复启停）
        if (startTop + accum >= max - 0.5) {
          autoScrollingRef.current = false;
          setIsPlaying(false);
          return;
        }
        // px/秒 ÷ 1000 → px/毫秒，乘 dt 得到本帧应滚动的像素
        accum += (pxOf() / 1000) * dt;
        el.scrollTop = Math.min(startTop + accum, max);
        raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
      return () => {
        cancelAnimationFrame(raf);
        autoScrollingRef.current = false;
      };
    }

    // 翻页模式：自调度 setTimeout，每次翻页后按（可能已变更的）秒/页重新排期，
    // 使播放中调节速度即时生效。
    let timer = 0;
    const schedule = () => {
      // 每次排期都按最新秒/页计算间隔（自定义小数直接精确生效），使播放中调速即时生效
      const pageMs = Math.max(50, Math.round(secOf() * 1000));
      timer = window.setTimeout(() => {
        if (!autoScrollingRef.current) return;
        if (flipRef.current !== "paged") {
          autoScrollingRef.current = false;
          setIsPlaying(false);
          return;
        }
        const step = layoutRef.current === "double" ? 2 : 1;
        const next = (currentPageRef.current ?? 1) + step;
        if (next > numPagesRef.current) {
          autoScrollingRef.current = false;
          setIsPlaying(false);
          return;
        }
        goToRef.current(next);
        schedule();
      }, pageMs);
    };
    schedule();
    return () => {
      window.clearTimeout(timer);
      autoScrollingRef.current = false;
    };
  }, [isPlaying, enabled, flipMode, containerRef]);

  return {
    isPlaying,
    speedPx,
    pagedSec,
    speedIndex,
    speedCount,
    toggle,
    pause,
    stop,
    cycleSpeed,
    speedValue,
    commitSpeed,
    autoScrollingRef,
  };
}
