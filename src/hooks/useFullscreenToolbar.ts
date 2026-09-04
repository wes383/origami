/**
 * 全屏工具栏 auto-hide 状态机 — 从 Toolbar 抽出的完整隐藏/唤醒逻辑，
 * 让 Toolbar 只管渲染：
 *
 * - 唤醒：鼠标在「顶部区域」（y ≤ FS_BAR_SHOW_ZONE）内 → 显示工具栏。
 *   唤醒带与工具栏区域同宽（52+8），而非窄边带 —— 快移甩动鼠标后停驻
 *   位置常在 y 8~60 之间，窄唤醒带（如 8px）会漏掉导致工具栏不出现；
 *   与顶部唤醒探针条（.fs-bar-probe，覆盖同一区域）双保险。
 * - 隐藏：以 DOM 的 pointerleave 为准（鼠标离开工具栏元素必然触发，不受
 *   原生 Snap Overlay 拦截 / clientY 阈值 / 事件丢失影响）；全局指针事件
 *   只负责兜底（鼠标在顶部区域之外且菜单未开 → 延迟隐藏）。
 * - 图钉：锁定后工具栏不再参与 auto-hide；进入全屏时默认锁定。
 * - 菜单打开时禁止隐藏（下拉在工具栏下方展开，鼠标落在其上是合法交互）。
 */

import { useCallback, useEffect, useRef, useState } from "react";

/** 全屏 auto-hide「顶部区域」边界：鼠标在该 y 内（工具栏高 52 + 缓冲 8）
    唤醒工具栏；之外则延迟隐藏。唤醒与隐藏共用同一把尺子 —— 快移甩动鼠标后
    停驻位置常在 y 8~60 之间，唤醒带过窄（如 8px）会漏掉，导致工具栏不出现 */
export const FS_BAR_SHOW_ZONE = 60;
/** 移出工具栏区域后延迟隐藏的毫秒数（防鼠标快速掠过误触发） */
export const FS_BAR_HIDE_DELAY = 400;

/** auto-hide 的全局指针事件：优先 pointerrawupdate（Chromium 原始事件流，
    不做 coalescing 合并）。触控板快速滑动时事件流极密，WebView2 对
    pointermove 的合并可能让最后一个事件停在半路（实际指针已到顶部）导致
    唤醒漏判；pointerrawupdate 每帧原始上报，无合并丢失。非 Chromium
    环境回退 pointermove。 */
const POINTER_EVT: "pointerrawupdate" | "pointermove" =
  typeof window !== "undefined" && "onpointerrawupdate" in window
    ? "pointerrawupdate"
    : "pointermove";

export interface FullscreenToolbarOptions {
  /** 当前是否处于全屏（非全屏时状态机整体停用） */
  isFullscreen: boolean;
  /** 主设置下拉菜单是否打开 */
  menuOpen: boolean;
  /** 「更多操作」下拉菜单是否打开 */
  moreOpen: boolean;
  /** 语言二级菜单是否打开 */
  langMenuOpen: boolean;
}

export function useFullscreenToolbar({
  isFullscreen,
  menuOpen,
  moreOpen,
  langMenuOpen,
}: FullscreenToolbarOptions) {
  /** 工具栏是否显示（鼠标在顶部触发带内显示，移出后延迟隐藏） */
  const [barVisible, setBarVisible] = useState(false);
  const hideTimerRef = useRef<number | null>(null);
  /** 全屏时是否锁定工具栏（点击图钉按钮后永久固定，不再 auto-hide） */
  const [pinned, setPinned] = useState(false);
  const pinnedRef = useRef(pinned);
  /** 菜单打开时禁止隐藏（下拉在工具栏下方展开，鼠标落在其上是合法交互） */
  const menuOpenRef = useRef(menuOpen);
  const moreOpenRef = useRef(moreOpen);
  const langMenuOpenRef = useRef(langMenuOpen);

  useEffect(() => {
    menuOpenRef.current = menuOpen;
  }, [menuOpen]);

  useEffect(() => {
    moreOpenRef.current = moreOpen;
  }, [moreOpen]);

  useEffect(() => {
    langMenuOpenRef.current = langMenuOpen;
  }, [langMenuOpen]);

  useEffect(() => {
    pinnedRef.current = pinned;
  }, [pinned]);

  /** 记录上一个全屏状态：进入全屏（false→true）时默认固定工具栏，
      用户可点图钉自行取消；退出全屏时由 auto-hide effect 重置回非固定 */
  const prevFullscreenRef = useRef(isFullscreen);
  useEffect(() => {
    if (isFullscreen && !prevFullscreenRef.current) {
      setPinned(true);
    }
    prevFullscreenRef.current = isFullscreen;
  }, [isFullscreen]);

  const clearHideTimer = useCallback(() => {
    if (hideTimerRef.current) {
      window.clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
  }, []);

  // 全屏 auto-hide 主逻辑。隐藏路径以 DOM 的 pointerleave 为准；全局指针事件
  // 只负责唤醒与兜底（见文件头注释）。顶部区域内不会触发隐藏（唤醒幂等）。
  useEffect(() => {
    if (!isFullscreen) {
      setBarVisible(false);
      setPinned(false);
      clearHideTimer();
      return;
    }
    const scheduleHide = () => {
      if (hideTimerRef.current) return;
      hideTimerRef.current = window.setTimeout(() => {
        hideTimerRef.current = null;
        setBarVisible(false);
      }, FS_BAR_HIDE_DELAY);
    };
    const onPointerMove = (e: PointerEvent) => {
      // 锁定工具栏：不参与 auto-hide（唤醒/兜底全部跳过）
      if (pinnedRef.current) return;
      const y = e.clientY;
      if (
        y <= FS_BAR_SHOW_ZONE ||
        menuOpenRef.current ||
        moreOpenRef.current ||
        langMenuOpenRef.current
      ) {
        clearHideTimer();
        setBarVisible(true);
      } else if (y > FS_BAR_SHOW_ZONE) {
        scheduleHide();
      }
    };
    // pointerrawupdate 与 pointermove 的联合事件名会让 TS 把监听器推断为
    // 通用 EventListener，需断言回 PointerEvent（clientY 来自 PointerEvent）
    const onPointerMoveHandler = onPointerMove as EventListener;
    window.addEventListener(POINTER_EVT, onPointerMoveHandler);
    return () => {
      window.removeEventListener(POINTER_EVT, onPointerMoveHandler);
      clearHideTimer();
    };
  }, [isFullscreen, clearHideTimer]);

  /** 显示工具栏：清掉待执行的隐藏定时并置可见。
      被 header 的 onPointerEnter 与顶部唤醒探针条共用 */
  const showBar = useCallback(() => {
    clearHideTimer();
    setBarVisible(true);
  }, [clearHideTimer]);

  /** header 的 pointerleave：延迟隐藏（菜单打开/锁定时跳过）。
      DOM pointerleave 在鼠标移出元素（含移到原生 Snap Overlay 上）时必然
      触发，比全局 clientY 阈值可靠。锁定工具栏时永不隐藏。 */
  const handleBarPointerLeave = useCallback(() => {
    if (
      pinnedRef.current ||
      menuOpenRef.current ||
      moreOpenRef.current ||
      langMenuOpenRef.current
    )
      return;
    if (!hideTimerRef.current) {
      hideTimerRef.current = window.setTimeout(() => {
        hideTimerRef.current = null;
        setBarVisible(false);
      }, FS_BAR_HIDE_DELAY);
    }
  }, []);

  /** 切换锁定状态，并取消可能已调度的隐藏定时（避免解锁瞬间工具栏闪没） */
  const togglePinned = useCallback(() => {
    setPinned((v) => !v);
    clearHideTimer();
  }, [clearHideTimer]);

  return { barVisible, pinned, showBar, handleBarPointerLeave, togglePinned };
}
