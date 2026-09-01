import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
} from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import type { SearchMatch } from "../lib/search";
import PdfPage from "./PdfPage";
import { useVisiblePages } from "../hooks/useVisiblePages";

/** 页面布局：每屏一页还是一对页 */
export type PageLayout = "single" | "double";
/** 翻页模式：连续滚动还是整页翻动 */
export type FlipMode = "scroll" | "paged";

interface PdfViewerProps {
  doc: PDFDocumentProxy;
  numPages: number;
  pageLayout: PageLayout;
  flipMode: FlipMode;
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
  /** 全文查找结果（用于各页高亮） */
  searchMatches: SearchMatch[];
  /** 当前选中的匹配 id（强调样式） */
  activeMatchId: string | null;
  /** 需滚动定位到视口中心的匹配 id（匹配项切换时设置） */
  focusMatchId: string | null;
  /** 定位处理完毕后清空意图 */
  onFocusHandled: () => void;
}

export default function PdfViewer({
  doc,
  numPages,
  pageLayout,
  flipMode,
  currentPage,
  onCurrentPageChange,
  jumpTarget,
  onJumpHandled,
  effScale,
  onZoomStep,
  onWidthChange,
  onHeightChange,
  basePage,
  searchMatches,
  activeMatchId,
  focusMatchId,
  onFocusHandled,
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
    enabled: flipMode === "scroll",
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
  // 翻页模式：滚到顶/底后再滚，切换上一页/下一页（双页按对翻）
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

      if (flipMode !== "paged") return;
      // 页面尚可滚动时交给原生滚动
      const atTop = el.scrollTop <= 0;
      const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 1;
      if (e.deltaY < 0 && !atTop) return;
      if (e.deltaY > 0 && !atBottom) return;
      // 到达边界：拦截并翻页。快速连续滚动（触控板惯性）只翻一次
      e.preventDefault();
      const now = performance.now();
      if (now - wheelIntentTimer > INTENT_WINDOW) {
        intentConsumed = false;
        wheelIntentTimer = now;
      }
      if (intentConsumed) return;
      intentConsumed = true;
      const step = pageLayout === "double" ? 2 : 1;
      onCurrentPageChange(e.deltaY > 0 ? currentPage + step : currentPage - step);
    };

    el.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      el.removeEventListener("wheel", onWheel);
      window.clearTimeout(wheelIntentTimer);
    };
  }, [effScale, onZoomStep, flipMode, pageLayout, currentPage, onCurrentPageChange]);

  // 翻页模式：翻页后回到页面顶部。
  // wheel 翻页发生在旧页已滚到底部时，容器 scrollTop 保留旧值，
  // 新页挂载后若不重置，会停留在新页的底部/中间位置。
  useEffect(() => {
    if (flipMode !== "paged") return;
    const el = containerRef.current;
    if (!el) return;
    el.scrollTop = 0;
  }, [currentPage, flipMode]);

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
    if (prev !== null && prev !== effScale && flipMode === "scroll") {
      el.querySelector<HTMLElement>(`[data-page="${currentPage}"]`)
        ?.scrollIntoView({ block: "start" });
    }
  }, [effScale, currentPage, flipMode]);

  // 滚动模式：仅在用户显式跳转时滚动到目标页。
  // 追踪观察器驱动的页码变化不触发滚动（否则拖动滚动条时观察器滞后上报
  // 视口外的页，会反向发起 smooth 滚动，松手后滚动条"自己跑"）
  useEffect(() => {
    if (jumpTarget == null) return;
    if (flipMode === "paged") {
      // 翻页模式无需滚动，直接由 currentPage 驱动渲染
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
  }, [jumpTarget, flipMode, doc, onJumpHandled]);

  const pw = basePage.w * effScale;
  const ph = basePage.h * effScale;

  // 各页匹配（含矩形），供 PdfPage 高亮
  const matchesByPage = useMemo(() => {
    const map = new Map<number, SearchMatch[]>();
    for (const m of searchMatches) {
      const list = map.get(m.page);
      if (list) list.push(m);
      else map.set(m.page, [m]);
    }
    return map;
  }, [searchMatches]);

  // 匹配项定位：等待页跳转意图清空后（避免与滚动动画互相抢占），
  // 将当前匹配滚动到视口中心。单页模式换页后 DOM 稍晚挂载，用 rAF 轮询兜底
  useEffect(() => {
    if (!focusMatchId || jumpTarget != null) return;
    let raf = 0;
    let tries = 0;
    const tryScroll = () => {
      const el = containerRef.current?.querySelector(
        `[data-hl="${focusMatchId}"]`
      );
      if (el) {
        el.scrollIntoView({ block: "center", inline: "nearest" });
        onFocusHandled();
        return;
      }
      if (tries++ < 90) raf = requestAnimationFrame(tryScroll);
      else onFocusHandled(); // 约 1.5s 后放弃，避免意图残留
    };
    raf = requestAnimationFrame(tryScroll);
    return () => cancelAnimationFrame(raf);
  }, [focusMatchId, jumpTarget, onFocusHandled]);

  // 双页布局的配对数组：[1,2] [3,4] …（最后一对可能只有左页）
  const pairs = useMemo(() => {
    if (pageLayout !== "double") return [];
    const out: number[][] = [];
    for (let p = 1; p <= numPages; p += 2) {
      out.push(p + 1 <= numPages ? [p, p + 1] : [p]);
    }
    return out;
  }, [pageLayout, numPages]);

  const renderPage = (page: number, visible: boolean) => (
    <div
      className="pdf-pair-page"
      data-page={page}
      ref={(el) => registerPage(page, el)}
    >
      <PdfPage
        doc={doc}
        pageNumber={page}
        scale={effScale}
        estimatedW={pw}
        estimatedH={ph}
        visible={visible}
        highlights={matchesByPage.get(page)?.flatMap((m) => m.rects) ?? []}
        activeHighlightId={activeMatchId}
      />
    </div>
  );

  // 翻页模式：只渲染当前页（双页布局渲染当前对，pairStart 归一到对首）
  const pagedStart = pageLayout === "double" && currentPage % 2 === 0
    ? currentPage - 1
    : currentPage;

  return (
    <div
      ref={containerRef}
      className={`pdf-viewer mode-${flipMode} layout-${pageLayout}`}
    >
      <div className="pdf-pages">
        {flipMode === "paged" ? (
          pageLayout === "double" ? (
            <div className="pdf-slot pdf-slot-pair">
              {renderPage(pagedStart, true)}
              {pagedStart + 1 <= numPages && renderPage(pagedStart + 1, true)}
            </div>
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
                highlights={matchesByPage.get(currentPage)?.flatMap((m) => m.rects) ?? []}
                activeHighlightId={activeMatchId}
              />
            </div>
          )
        ) : pageLayout === "double" ? (
          pairs.map(([left, right]) => (
            <div key={left} className="pdf-slot pdf-slot-pair">
              {renderPage(left, visiblePages.has(left))}
              {right != null && renderPage(right, visiblePages.has(right))}
            </div>
          ))
        ) : (
          Array.from({ length: numPages }, (_, i) => (
            <div
              key={i + 1}
              className="pdf-slot"
              ref={(el) => registerPage(i + 1, el)}
              data-page={i + 1}
            >
              {renderPage(i + 1, visiblePages.has(i + 1))}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
