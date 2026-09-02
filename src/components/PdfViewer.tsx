import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
} from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import type { SearchMatch, SearchRect } from "../lib/search";
import {
  getDestinationViewportPoint,
  type PdfDestination,
} from "../lib/pdfLinks";
import PdfPage from "./PdfPage";
import { useVisiblePages } from "../hooks/useVisiblePages";
import { openUrl } from "@tauri-apps/plugin-opener";

/** 页面布局：每屏一页还是一对页 */
export type PageLayout = "single" | "double";
/** 翻页模式：连续滚动还是整页翻动 */
export type FlipMode = "scroll" | "paged";

/** 无高亮页共用的空数组：保持引用稳定，避免破坏 PdfPage 的 memo */
const EMPTY_RECTS: SearchRect[] = [];

interface PdfViewerProps {
  doc: PDFDocumentProxy;
  numPages: number;
  pageLayout: PageLayout;
  flipMode: FlipMode;
  /** 额外旋转角（0/90/180/270，顺时针） */
  rotation: number;
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
  rotation,
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
  /** 翻页模式中等待目标页挂载后再执行的内部链接定位。 */
  const pendingDestinationRef = useRef<{
    pageNumber: number;
    destination: unknown[];
  } | null>(null);

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
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

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
      }
    };

    el.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      el.removeEventListener("wheel", onWheel);
    };
  }, [effScale, onZoomStep]);

  // 翻页模式：翻页后回到页面顶部。
  // 键盘/按钮翻页后容器 scrollTop 保留旧值，新页挂载后若不重置，
  // 会停留在新页的底部/中间位置。
  useEffect(() => {
    if (flipMode !== "paged") return;
    const el = containerRef.current;
    if (!el) return;
    el.scrollTop = 0;
  }, [currentPage, flipMode]);

  // 模式/布局切换后恢复阅读位置。
  // paged → scroll：容器由「渲染单页」变为「渲染全页」，scrollTop 归零，
  // 若不主动滚动会停在第 1 页，随后观察器又把 currentPage 覆盖回 1。
  // pageLayout 切换（single↔double）同理：内容总高度变化，位置失效。
  // 仅在 flipMode/pageLayout「发生变化」的瞬间滚动一次，观察器驱动的
  // currentPage 变化不触发（否则滚动途中会被反向打断）。
  const prevModeRef = useRef<{ flip: FlipMode; layout: PageLayout } | null>(null);
  useEffect(() => {
    const prev = prevModeRef.current;
    prevModeRef.current = { flip: flipMode, layout: pageLayout };
    if (!prev) return; // 首次挂载不滚动（由 jumpTarget 处理恢复页）
    const modeChanged = prev.flip !== flipMode;
    const layoutChanged = prev.layout !== pageLayout;
    if (!modeChanged && !layoutChanged) return;

    // 只有当前处于连续滚动模式才需要恢复滚动位置；
    // 翻页模式由 currentPage 直接驱动渲染，无需滚动
    if (flipMode !== "scroll") return;

    const el = containerRef.current;
    if (!el) return;

    // 等待全页列表重渲染完成后再定位（切模式瞬间 DOM 尚未更新）
    const id = requestAnimationFrame(() => {
      const pageEl = el.querySelector<HTMLElement>(`[data-page="${currentPage}"]`);
      if (!pageEl) return;
      // 立即跳转（非平滑）：模式切换无需动画，且避免途经中间页改写页码。
      // 用 rect 差值计算目标 scrollTop，不受 offsetParent 影响（与 jumpTarget 逻辑一致）
      suppressTrackRef.current = true;
      const delta = pageEl.getBoundingClientRect().top - el.getBoundingClientRect().top;
      el.scrollTop += delta;
      // 延迟一帧再释放：IntersectionObserver 重建后的初始回调是异步的，
      // 若此刻立即释放，观察器可能先用「视口仍在第 1 页」的旧快照把
      // currentPage 覆盖回 1，再被下面的滚动纠正，造成短暂跳变
      requestAnimationFrame(() => {
        suppressTrackRef.current = false;
      });
    });
    return () => cancelAnimationFrame(id);
  }, [flipMode, pageLayout, currentPage]);

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

  /** 将已解析的内部目标滚动到对应页面的精确位置。 */
  const scrollToDestination = useCallback(
    async (pageNumber: number, destination: unknown[]) => {
      const container = containerRef.current;
      if (!container) return;

      try {
        const page = await doc.getPage(pageNumber);
        const viewport = page.getViewport({
          scale: effScale,
          rotation: (page.rotate + rotation) % 360,
        });
        const point = getDestinationViewportPoint(destination, page.view, viewport);

        const align = () => {
          const pageNode = container.querySelector<HTMLElement>(
            `[data-page="${pageNumber}"] .pdf-page`
          );
          if (!pageNode) return;
          const pageRect = pageNode.getBoundingClientRect();
          const containerRect = container.getBoundingClientRect();
          const scaleX = pageNode.clientWidth / viewport.width;
          const scaleY = pageNode.clientHeight / viewport.height;
          container.scrollTo({
            left: Math.max(
              0,
              container.scrollLeft + pageRect.left - containerRect.left + point.left * scaleX
            ),
            top: Math.max(
              0,
              container.scrollTop + pageRect.top - containerRect.top + point.top * scaleY
            ),
            behavior: "auto",
          });
        };

        // 初次将目标页滚入可见区，随后等懒渲染回填真实页面尺寸后再精确对齐一次。
        align();
        requestAnimationFrame(() => requestAnimationFrame(align));
      } catch {
        /* 无效目标不影响继续阅读 */
      }
    },
    [doc, effScale, rotation]
  );

  /** 解析命名/显式内部链接，并在保留当前缩放的前提下定位。 */
  const handleInternalLink = useCallback(
    async (destination: PdfDestination) => {
      try {
        const explicit =
          typeof destination === "string"
            ? await doc.getDestination(destination)
            : destination;
        if (!Array.isArray(explicit)) return;

        const pageRef = explicit[0];
        const pageNumber =
          typeof pageRef === "number"
            ? pageRef + 1
            : pageRef && typeof pageRef === "object"
              ? (await doc.getPageIndex(
                  pageRef as Parameters<typeof doc.getPageIndex>[0]
                )) + 1
              : null;
        if (!pageNumber || pageNumber < 1 || pageNumber > numPages) return;

        if (flipMode === "paged" && pageNumber !== currentPage) {
          pendingDestinationRef.current = { pageNumber, destination: explicit };
          onCurrentPageChange(pageNumber);
        } else {
          void scrollToDestination(pageNumber, explicit);
        }
      } catch {
        /* 命名目标不存在或解析失败时静默忽略 */
      }
    },
    [currentPage, doc, flipMode, numPages, onCurrentPageChange, scrollToDestination]
  );

  useLayoutEffect(() => {
    const pending = pendingDestinationRef.current;
    if (!pending || pending.pageNumber !== currentPage) return;
    pendingDestinationRef.current = null;
    void scrollToDestination(pending.pageNumber, pending.destination);
  }, [currentPage, scrollToDestination]);

  /** 外部链接仅允许常用安全协议，优先用 Tauri 调起系统默认浏览器。 */
  const handleExternalLink = useCallback(async (url: string) => {
    try {
      const protocol = new URL(url).protocol;
      if (!["http:", "https:", "mailto:"].includes(protocol)) return;
    } catch {
      return;
    }

    try {
      await openUrl(url);
    } catch {
      window.open(url, "_blank", "noopener,noreferrer");
    }
  }, []);

  // 占位尺寸：90°/270° 旋转时宽高互换
  const rotated = rotation % 180 !== 0;
  const pw = (rotated ? basePage.h : basePage.w) * effScale;
  const ph = (rotated ? basePage.w : basePage.h) * effScale;

  // 各页高亮矩形（已展平）。预先展平是为了让同一页在多次渲染间拿到
  // 相同的数组引用 —— PdfPage 是 memo 组件，每次 flatMap 都会破坏 memo
  const rectsByPage = useMemo(() => {
    const map = new Map<number, SearchRect[]>();
    for (const m of searchMatches) {
      const list = map.get(m.page);
      if (list) list.push(...m.rects);
      else map.set(m.page, [...m.rects]);
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

  const renderPdf = (page: number, visible: boolean) => (
    <PdfPage
      // key 保证翻页时整页重挂载：否则复用实例会残留上一页的 canvas 内容
      key={page}
      doc={doc}
      pageNumber={page}
      scale={effScale}
      rotation={rotation}
      estimatedW={pw}
      estimatedH={ph}
      visible={visible}
      highlights={rectsByPage.get(page) ?? EMPTY_RECTS}
      activeHighlightId={activeMatchId}
      onInternalLink={handleInternalLink}
      onExternalLink={handleExternalLink}
    />
  );

  /** 双页布局的页包装：负责 data-page 标记与观察器注册 */
  const renderPage = (page: number, visible: boolean) => (
    <div
      className="pdf-pair-page"
      data-page={page}
      ref={(el) => registerPage(page, el)}
    >
      {renderPdf(page, visible)}
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
            <div
              className="pdf-slot"
              data-page={currentPage}
              ref={(el) => registerPage(currentPage, el)}
            >
              {renderPdf(currentPage, true)}
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
          // 单页连续模式：直接渲染 PdfPage。此前外层 .pdf-slot 与内层
          // .pdf-pair-page 都带 data-page 且注册了同一个页号，后者覆盖前者，
          // 导致 querySelector 命中的元素与观察器观察的元素不一致，
          // 跳转定位会差一个 margin
          Array.from({ length: numPages }, (_, i) => (
            <div
              key={i + 1}
              className="pdf-slot"
              ref={(el) => registerPage(i + 1, el)}
              data-page={i + 1}
            >
              {renderPdf(i + 1, visiblePages.has(i + 1))}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
