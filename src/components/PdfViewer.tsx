import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
} from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import PdfPage from "./PdfPage";
import { useVisiblePages } from "../hooks/useVisiblePages";

export type ViewMode = "single" | "continuous";

interface PdfViewerProps {
  doc: PDFDocumentProxy;
  numPages: number;
  viewMode: ViewMode;
  currentPage: number;
  onCurrentPageChange: (page: number) => void;
  /** 用户显式跳转的目标页（页码输入/前后翻页按钮）。追踪观察器只跟随滚动，永不引发滚动 */
  jumpTarget: number | null;
  /** 跳转处理完毕后清空意图 */
  onJumpHandled: () => void;
  /** 当前生效缩放倍率（fit-width 或自定义） */
  effScale: number;
  /** Ctrl+滚轮 / 触控板捏合步进缩放 */
  onZoomStep: (dir: 1 | -1) => void;
  /** 上报阅读区宽度，供 App 计算 fit-width 倍率 */
  onWidthChange: (width: number) => void;
  /** 上报阅读区高度，供 App 计算 fit-page 倍率 */
  onHeightChange: (height: number) => void;
  /** 首页基础尺寸（scale=1） */
  basePage: { w: number; h: number };
}

export default function PdfViewer({
  doc,
  numPages,
  viewMode,
  currentPage,
  onCurrentPageChange,
  jumpTarget,
  onJumpHandled,
  effScale,
  onZoomStep,
  onWidthChange,
  onHeightChange,
  basePage,
}: PdfViewerProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  /** 缩放锚点：保持鼠标指向的内容点不动 */
  const anchorRef = useRef<{ mx: number; my: number; cx: number; cy: number } | null>(null);
  /** 程序化跳转期间抑制观察器上报，避免滚动途中页码变化打断跳转 */
  const suppressTrackRef = useRef(false);
  /** 上一次生效倍率：区分"初始渲染"与"fit 倍率变化需锚定当前页" */
  const prevScaleRef = useRef<number | null>(null);

  const handleVisiblePage = useCallback(
    (page: number) => {
      if (suppressTrackRef.current) return;
      onCurrentPageChange(page);
    },
    [onCurrentPageChange]
  );

  const { visiblePages, registerPage } = useVisiblePages({
    containerRef,
    numPages,
    enabled: viewMode === "continuous",
    onCurrentPageChange: handleVisiblePage,
  });

  // 上报容器宽高（fit-width / fit-page 依据）
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const report = () => {
      onWidthChange(el.clientWidth);
      onHeightChange(el.clientHeight);
    };
    report();
    const ro = new ResizeObserver(report);
    ro.observe(el);
    return () => ro.disconnect();
  }, [onWidthChange, onHeightChange, doc]);

  // Ctrl+滚轮缩放（WebView2 中触屏捏合也表现为 ctrl+wheel）
  // 单页模式：滚到顶/底后再滚，切换上一页/下一页
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    /** 连续触发的 wheel 事件视为一次滚动意图（触控板惯性/高速滚动） */
    let wheelIntentTimer = 0;
    let intentConsumed = false;
    const INTENT_WINDOW = 120;

    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        const rect = el.getBoundingClientRect();
        const mx = e.clientX - rect.left;
        const my = e.clientY - rect.top;
        anchorRef.current = {
          mx,
          my,
          cx: (el.scrollLeft + mx) / effScale,
          cy: (el.scrollTop + my) / effScale,
        };
        onZoomStep(e.deltaY < 0 ? 1 : -1);
        return;
      }

      if (viewMode !== "single") return;
      // 页面尚可滚动时交给原生滚动
      const atTop = el.scrollTop <= 0;
      const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 1;
      if (e.deltaY < 0 && !atTop) return;
      if (e.deltaY > 0 && !atBottom) return;
      // 到达边界：拦截并翻页。快速连续滚动（触控板惯性）只翻一页
      e.preventDefault();
      const now = performance.now();
      if (now - wheelIntentTimer > INTENT_WINDOW) {
        intentConsumed = false;
        wheelIntentTimer = now;
      }
      if (intentConsumed) return;
      intentConsumed = true;
      onCurrentPageChange(e.deltaY > 0 ? currentPage + 1 : currentPage - 1);
    };

    el.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      el.removeEventListener("wheel", onWheel);
      window.clearTimeout(wheelIntentTimer);
    };
  }, [effScale, onZoomStep, viewMode, currentPage, onCurrentPageChange]);

  // 缩放后恢复位置：Ctrl+滚轮走鼠标锚点；fit 倍率变化（窗口缩放等）锚定当前页顶部
  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const prev = prevScaleRef.current;
    prevScaleRef.current = effScale;
    const anchor = anchorRef.current;
    if (anchor) {
      anchorRef.current = null;
      el.scrollLeft = Math.max(0, anchor.cx * effScale - anchor.mx);
      el.scrollTop = Math.max(0, anchor.cy * effScale - anchor.my);
      return;
    }
    if (prev !== null && prev !== effScale && viewMode === "continuous") {
      el.querySelector<HTMLElement>(`[data-page="${currentPage}"]`)
        ?.scrollIntoView({ block: "start" });
    }
  }, [effScale, currentPage, viewMode]);

  // 连续模式：仅在用户显式跳转时滚动到目标页。
  // 追踪观察器驱动的页码变化不触发滚动（否则拖动滚动条时观察器滞后上报
  // 视口外的页，会反向发起 smooth 滚动，松手后滚动条"自己跑"）
  useEffect(() => {
    if (jumpTarget == null) return;
    if (viewMode !== "continuous") {
      // 单页模式无需滚动，直接由 currentPage 驱动渲染
      onJumpHandled();
      return;
    }
    const el = containerRef.current;
    if (!el) return;
    const pageEl = el.querySelector<HTMLElement>(`[data-page="${jumpTarget}"]`);
    if (!pageEl) return;

    // smooth 滚动会经过中间页，抑制期间的上报避免页码被中途改写。
    // 注意：意图在动画结束后才清理——若同步清理，jumpTarget 置空会让本 effect
    // 的 cleanup 立刻取消 rAF 动画，页面根本不会滚动
    suppressTrackRef.current = true;

    // 自定义缓动动画：每帧重算目标位置。一次性 scrollIntoView 在调用瞬间
    // 固定终点，而滚动途中懒渲染的页面会回填真实高度使目标移动，
    // 导致最终落在目标页之前的一两页
    const DURATION = 350;
    const startTime = performance.now();
    const startTop = el.scrollTop;
    let raf = 0;
    let cancelled = false;
    let settled = false;
    let stableFrames = 0;

    const finish = () => {
      suppressTrackRef.current = false;
      onJumpHandled();
    };

    // 目标 scrollTop：按当前布局实时计算（rect 差值不受 offsetParent 影响）
    const targetTop = () => {
      const delta =
        pageEl.getBoundingClientRect().top - el.getBoundingClientRect().top;
      return Math.max(0, el.scrollTop + delta);
    };

    const tick = (now: number) => {
      if (cancelled) return;
      if (!settled) {
        const t = Math.min(1, (now - startTime) / DURATION);
        const ease = 1 - Math.pow(1 - t, 3);
        el.scrollTop = startTop + (targetTop() - startTop) * ease;
        if (t >= 1) settled = true;
        raf = requestAnimationFrame(tick);
        return;
      }
      // 收尾吸附：布局（页面高度回填）稳定前每帧对齐目标，
      // 连续 8 帧目标不再移动即完成，3s 超时兜底
      const goal = targetTop();
      el.scrollTop = goal;
      stableFrames += 1;
      if (
        stableFrames >= 8 ||
        performance.now() - startTime > 3000 ||
        Math.abs(pageEl.getBoundingClientRect().top - el.getBoundingClientRect().top) < 0.5
      ) {
        finish();
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      suppressTrackRef.current = false;
      // 被新跳转/卸载打断时也清理意图，避免残留
      onJumpHandled();
    };
  }, [jumpTarget, viewMode, doc, onJumpHandled]);

  const pw = basePage.w * effScale;
  const ph = basePage.h * effScale;

  return (
    <div
      ref={containerRef}
      className={`pdf-viewer ${viewMode === "single" ? "mode-single" : "mode-continuous"}`}
    >
      <div className="pdf-pages">
        {viewMode === "continuous" ? (
          Array.from({ length: numPages }, (_, i) => (
            <div
              key={i + 1}
              className="pdf-slot"
              ref={(el) => registerPage(i + 1, el)}
              data-page={i + 1}
            >
              <PdfPage
                doc={doc}
                pageNumber={i + 1}
                scale={effScale}
                estimatedW={pw}
                estimatedH={ph}
                visible={visiblePages.has(i + 1)}
              />
            </div>
          ))
        ) : (
          <div className="pdf-slot">
            <PdfPage
              key={currentPage}
              doc={doc}
              pageNumber={currentPage}
              scale={effScale}
              estimatedW={pw}
              estimatedH={ph}
              visible
            />
          </div>
        )}
      </div>
    </div>
  );
}
