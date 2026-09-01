import { useCallback, useEffect, useRef, useState } from "react";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { open as openFileDialog } from "@tauri-apps/plugin-dialog";
import { readFile } from "@tauri-apps/plugin-fs";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import type { OpenedPdf, OutlineNode } from "./lib/pdf";
import { openPdf, loadOutline } from "./lib/pdf";
import type { SearchMatch } from "./lib/search";
import { printDocument } from "./lib/print";
import {
  loadProgress,
  saveProgress,
  type FitIntent,
  type ScaleMode,
} from "./lib/progress";
import { useI18n, type LangKeys } from "./i18n";
import { useTheme } from "./hooks/useTheme";
import {
  addRecent,
  clearRecent,
  loadRecent,
  removeRecent,
  type RecentFile,
} from "./lib/recent";
import Toolbar from "./components/Toolbar";
import PdfViewer, { type PageLayout, type FlipMode } from "./components/PdfViewer";
import Sidebar, { type SidebarTab } from "./components/Sidebar";
import SearchBar from "./components/SearchBar";
import PrintDialog from "./components/PrintDialog";
import PasswordDialog from "./components/PasswordDialog";
import TranslatePopup from "./components/TranslatePopup";
import AiSettingsModal from "./components/AiSettingsModal";
import EmptyState from "./components/EmptyState";
import { DocIcon } from "./components/Icons";

/** 手动缩放档位（参考 Chrome） */
const ZOOM_LEVELS = [0.25, 0.33, 0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4, 5];
const READER_PADDING_X = 48; // 阅读区左右留白（24px × 2）
const READER_PADDING_X_NARROW = 24; // ≤720px 窄断点（12px × 2），与 global.css 媒体查询对齐
const READER_PADDING_Y = 56; // 阅读区上下留白（28px × 2）
const DOUBLE_PAGE_GAP = 16; // 双页模式两页之间的间隙，与 global.css .pdf-slot-pair 一致

export type { ScaleMode };

export default function App() {
  const { t } = useI18n();
  const { pref: themePref, setThemePref } = useTheme();

  const [pdf, setPdf] = useState<OpenedPdf | null>(null);
  const [fileName, setFileName] = useState("");
  const [numPages, setNumPages] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  /** 用户显式跳转意图（页码输入/前后翻页）。追踪观察器只跟随滚动，不触发滚动 */
  const [jumpTarget, setJumpTarget] = useState<number | null>(null);
  const [pageLayout, setPageLayout] = useState<PageLayout>("single");
  const [flipMode, setFlipMode] = useState<FlipMode>("scroll");
  /** 额外旋转角（0/90/180/270，顺时针；叠加在页面自带旋转之上） */
  const [rotation, setRotation] = useState(0);
  /** 打印准备中（渲染整本文档位图） */
  const [printing, setPrinting] = useState(false);
  /** 打印渲染进度（done / total），用于"正在准备打印…"下方显示 */
  const [printProgress, setPrintProgress] = useState<{ done: number; total: number } | null>(
    null
  );
  /** 打印对话框（选择页码范围） */
  const [printDialogOpen, setPrintDialogOpen] = useState(false);
  const [scaleMode, setScaleMode] = useState<ScaleMode>("fit-width");
  /**
   * 用户最后选择的 fit 模式（fit-width / fit-page）。
   * 点击 fit 按钮后 scaleMode 固定为 custom（切页不再自动调整），
   * 但仍依据此状态在两种模式间来回切换
   */
  const [fitIntent, setFitIntent] = useState<FitIntent>("fit-page");
  const [scale, setScale] = useState(1);
  const [fitScale, setFitScale] = useState(1);
  const [fitPageScale, setFitPageScale] = useState(1);
  const [containerWidth, setContainerWidth] = useState(0);
  const [containerHeight, setContainerHeight] = useState(0);
  const [basePage, setBasePage] = useState<{ w: number; h: number } | null>(null);
  /** fit 倍率的基准页：当前页的真实尺寸（各页尺寸可能不同） */
  const [refPage, setRefPage] = useState<{ w: number; h: number } | null>(null);
  const [loading, setLoading] = useState(false);
  const [errorKey, setErrorKey] = useState<LangKeys | null>(null);
  const [dragOver, setDragOver] = useState(false);
  /** 加密文档密码输入弹窗 */
  const [passwordOpen, setPasswordOpen] = useState(false);
  /** 当前密码是否已判错一次（用于弹窗提示与重新弹出） */
  const [passwordWrong, setPasswordWrong] = useState(false);
  /** 阅读区左右留白（跟随 CSS 断点：≤720px 减半） */
  const [narrowWindow, setNarrowWindow] = useState(
    () => typeof window !== "undefined" && window.innerWidth <= 720
  );
  /** 最近打开的文件（localStorage 持久化，新→旧） */
  const [recentFiles, setRecentFiles] = useState<RecentFile[]>(() => loadRecent());
  /** AI 划词翻译设置弹窗 */
  const [aiSettingsOpen, setAiSettingsOpen] = useState(false);
  /** 当前文档的目录树 */
  const [outline, setOutline] = useState<OutlineNode[]>([]);
  /** 侧边栏展开状态 */
  const [sidebarOpen, setSidebarOpen] = useState(false);
  /** 侧边栏当前标签页（目录 / 缩略图） */
  const [sidebarTab, setSidebarTab] = useState<SidebarTab>("outline");
  /** 全文查找 */
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchMatches, setSearchMatches] = useState<SearchMatch[]>([]);
  const [activeMatchId, setActiveMatchId] = useState<string | null>(null);
  const [focusMatchId, setFocusMatchId] = useState<string | null>(null);

  /** 当前文档路径（进度持久化与打印进度的 key；不含文件名） */
  const currentPathRef = useRef<string>("");
  /** 当前文档对象：loadFile/closeFile 里直接取，避免 setState 闭包过期 */
  const pdfRef = useRef<OpenedPdf | null>(null);
  /** 进度保存去抖：滚动连发时只落最后一次 */
  const progressTimerRef = useRef<number | null>(null);
  /** 待密码打开的文档数据（密码输入弹窗回调用） */
  const pendingPasswordRef = useRef<Uint8Array | null>(null);

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 720px)");
    const onChange = (e: MediaQueryListEvent) => setNarrowWindow(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  const effScale =
    scaleMode === "fit-width"
      ? fitScale
      : scaleMode === "fit-page"
        ? fitPageScale
        : scale;
  const canZoomIn = effScale < ZOOM_LEVELS[ZOOM_LEVELS.length - 1] - 0.01;
  const canZoomOut = effScale > ZOOM_LEVELS[0] + 0.01;

  const loadFileRef = useRef<(path: string) => void>(() => {});
  /** 各页尺寸缓存（scale=1），避免重复 getPage */
  const pageSizesRef = useRef(new Map<number, { w: number; h: number }>());

  // ---------- 打开文件 ----------

  /** 关闭上一份文档（销毁 worker 资源）。副作用放函数体，不走 setState updater */
  const destroyCurrent = useCallback(() => {
    const prev = pdfRef.current;
    if (prev) void prev.destroy();
  }, []);

  const loadFile = useCallback(
    async (path: string) => {
      if (!/\.pdf$/i.test(path)) {
        setErrorKey("errorNotPdf");
        return;
      }
      setLoading(true);
      setErrorKey(null);
      let opened: OpenedPdf;
      try {
        const data = await readFile(path);
        const bytes = new Uint8Array(data);
        // 加密文档：弹出密码框，取到密码后重试打开
        opened = await openPdf(bytes, {
          requestPassword: (wrong) =>
            new Promise<string>((resolve, reject) => {
              pendingPasswordRef.current = bytes;
              setPasswordWrong(wrong);
              setPasswordOpen(true);
              passwordResolveRef.current = resolve;
              passwordRejectRef.current = reject;
            }),
        });
      } catch (err) {
        // 用户取消密码输入：静默返回，不报"文件无效"
        if (err instanceof Error && err.message === "password-cancelled") {
          setLoading(false);
          return;
        }
        setErrorKey("errorInvalid");
        setLoading(false);
        return;
      }

      // 打开成功：清理可能残留的密码弹窗状态
      pendingPasswordRef.current = null;
      passwordResolveRef.current = null;
      passwordRejectRef.current = null;
      setPasswordOpen(false);

      try {
        const page1 = await opened.doc.getPage(1);
        const vp = page1.getViewport({ scale: 1 });

        // 先销毁旧文档，再替换引用（避免 StrictMode 下 updater 跑两次）
        destroyCurrent();
        pdfRef.current = opened;
        setPdf(opened);

        const restored = loadProgress(path);
        const total = opened.doc.numPages;
        const page = Math.min(Math.max(1, restored?.page ?? 1), total);

        setNumPages(total);
        setCurrentPage(page);
        setBasePage({ w: vp.width, h: vp.height });
        pageSizesRef.current = new Map([[1, { w: vp.width, h: vp.height }]]);
        setRefPage({ w: vp.width, h: vp.height });

        // 恢复上次的视图偏好；无记录时默认「适合页面」（P0-4：按钮首显适合页面）
        const sm = restored?.scaleMode ?? "fit-width";
        setScaleMode(sm);
        setFitIntent(restored?.fitIntent ?? "fit-page");
        setScale(restored?.scale ?? 1);
        setRotation(restored?.rotation ?? 0);
        setPageLayout(restored?.pageLayout ?? "single");
        setFlipMode(restored?.flipMode ?? "scroll");

        setFileName(path.split(/[\\/]/).pop() ?? path);
        currentPathRef.current = path;
        setRecentFiles(addRecent(path));

        // 解析目录（失败不阻塞打开文档）
        const parsedOutline = await loadOutline(opened.doc).catch(() => []);
        setOutline(parsedOutline);
        // 含目录的文档默认展开侧边栏（目录页签），便于导航
        setSidebarTab("outline");
        setSidebarOpen(parsedOutline.length > 0);

        // 新文档：清空上一个文档的查找结果
        setSearchMatches([]);
        setActiveMatchId(null);
        setFocusMatchId(null);

        // 恢复到上次阅读页（首开时即第 1 页，无需滚动）
        if (page > 1) setJumpTarget(page);
      } catch {
        setErrorKey("errorInvalid");
      } finally {
        setLoading(false);
      }
    },
    [destroyCurrent]
  );
  loadFileRef.current = loadFile;

  /** 密码输入弹窗的 resolve/reject：由 openPdf 的 requestPassword 挂载 */
  const passwordResolveRef = useRef<((value: string) => void) | null>(null);
  const passwordRejectRef = useRef<((err: unknown) => void) | null>(null);

  const handlePasswordSubmit = useCallback(
    (password: string) => {
      setPasswordOpen(false);
      passwordResolveRef.current?.(password);
      passwordResolveRef.current = null;
      passwordRejectRef.current = null;
    },
    []
  );

  const handlePasswordCancel = useCallback(() => {
    setPasswordOpen(false);
    setLoading(false);
    pendingPasswordRef.current = null;
    // reject 会让 openPdf 中止；此时 requestPassword 已 reject，走 catch 静默返回
    passwordRejectRef.current?.(new Error("password-cancelled"));
    passwordResolveRef.current = null;
    passwordRejectRef.current = null;
  }, []);

  const handleOpenDialog = useCallback(async () => {
    const selected = await openFileDialog({
      multiple: false,
      filters: [{ name: "PDF", extensions: ["pdf"] }],
    });
    const path = typeof selected === "string" ? selected : null;
    if (path) loadFileRef.current(path);
  }, []);

  /** 关闭当前文件，销毁文档资源并回到引导页 */
  const closeFile = useCallback(() => {
    destroyCurrent();
    pdfRef.current = null;
    setPdf(null);
    setFileName("");
    setNumPages(0);
    setCurrentPage(1);
    setJumpTarget(null);
    setBasePage(null);
    setRefPage(null);
    pageSizesRef.current = new Map();
    setScaleMode("fit-width");
    setScale(1);
    setFitScale(1);
    setFitPageScale(1);
    setRotation(0);
    setErrorKey(null);
    setOutline([]);
    setSidebarOpen(false);
    setSidebarTab("outline");
    setSearchOpen(false);
    setSearchMatches([]);
    setActiveMatchId(null);
    setFocusMatchId(null);
    setPrinting(false);
    setPrintProgress(null);
    setPasswordOpen(false);
    currentPathRef.current = "";
  }, [destroyCurrent]);

  // ---------- 禁用右键菜单（阅读器场景） ----------

  useEffect(() => {
    const onContextMenu = (e: MouseEvent) => e.preventDefault();
    window.addEventListener("contextmenu", onContextMenu);
    return () => window.removeEventListener("contextmenu", onContextMenu);
  }, []);

  // ---------- 拖拽打开（Tauri2 拦截 HTML5 drop，须用官方事件） ----------

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    (async () => {
      const fn = await getCurrentWebview().onDragDropEvent((event) => {
        const payload = event.payload;
        if (payload.type === "enter") {
          // 只对"含文件路径"的拖放显示提示：拖拽选中文本等 HTML5 内容时
          // enter 事件的 paths 为空，不应触发"松开以打开文件"
          setDragOver(payload.paths.length > 0);
        } else if (payload.type === "over") {
          // 悬停中（不带 paths）：保持当前状态
        } else if (payload.type === "leave") {
          setDragOver(false);
        } else if (payload.type === "drop") {
          setDragOver(false);
          const paths = payload.paths ?? [];
          if (paths.length === 0) return;
          if (paths.length > 1) {
            // 单窗口阅读器：多文件静默丢弃会让用户困惑，明确提示
            setErrorKey("errorMultipleFiles");
            return;
          }
          loadFileRef.current(paths[0]);
        }
      });
      if (disposed) fn();
      else unlisten = fn;
    })();
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  // ---------- 缩放 ----------

  const stepZoom = useCallback(
    (dir: 1 | -1) => {
      setScaleMode("custom");
      setScale(() => {
        if (dir > 0) {
          return (
            ZOOM_LEVELS.find((l) => l > effScale + 0.01) ??
            ZOOM_LEVELS[ZOOM_LEVELS.length - 1]
          );
        }
        const below = [...ZOOM_LEVELS].reverse().find((l) => l < effScale - 0.01);
        return below ?? ZOOM_LEVELS[0];
      });
    },
    [effScale]
  );

  const zoomIn = useCallback(() => stepZoom(1), [stepZoom]);
  const zoomOut = useCallback(() => stepZoom(-1), [stepZoom]);
  /** 手动输入精确缩放（clamp 到 25%–500%），切换到 custom 模式 */
  const setZoomExact = useCallback((value: number) => {
    setScaleMode("custom");
    setScale(Math.min(5, Math.max(0.25, value)));
  }, []);
  /**
   * 一次性应用 fit 倍率：点击时按当前页立即计算并固定为 custom 缩放，
   * 之后切换页面保持该比例，不再自动调整。
   * 依据 fitIntent 在适应宽度 ↔ 适合页面间来回切换
   */
  const toggleFit = useCallback(() => {
    if (!refPage || !containerWidth || !containerHeight) return;
    const rotated = rotation % 180 !== 0;
    const pageW = rotated ? refPage.h : refPage.w;
    const pageH = rotated ? refPage.w : refPage.h;
    const spanW = pageLayout === "double" ? pageW * 2 + DOUBLE_PAGE_GAP : pageW;
    const wFit = Math.max(
      0.1,
      (containerWidth - (narrowWindow ? READER_PADDING_X_NARROW : READER_PADDING_X)) /
        spanW
    );
    const hFit = Math.max(0.1, (containerHeight - READER_PADDING_Y) / pageH);
    const next = fitIntent === "fit-width" ? wFit : Math.min(wFit, hFit);
    setFitIntent(fitIntent === "fit-width" ? "fit-page" : "fit-width");
    setScale(next);
    setScaleMode("custom");
  }, [refPage, containerWidth, containerHeight, fitIntent, narrowWindow, pageLayout, rotation]);

  // 当前页变化时获取该页真实尺寸，作为 fit 倍率基准。
  // debounce 250ms：滚动经过多页时避免基准页/倍率连续变化导致布局抖动
  useEffect(() => {
    if (!pdf || !basePage) return;
    const timer = window.setTimeout(() => {
      const cached = pageSizesRef.current.get(currentPage);
      if (cached) {
        setRefPage(cached);
        return;
      }
      void (async () => {
        try {
          const page = await pdf.doc.getPage(currentPage);
          const vp = page.getViewport({ scale: 1 });
          const size = { w: vp.width, h: vp.height };
          pageSizesRef.current.set(currentPage, size);
          setRefPage(size);
        } catch {
          /* 忽略：保持上一页基准 */
        }
      })();
    }, 250);
    return () => window.clearTimeout(timer);
  }, [pdf, currentPage, basePage]);

  // fit 倍率随基准页和容器尺寸变化（基准页 = 当前页）。
  // 左右留白与 CSS 断点对齐：≤720px 时 slot padding 减半。
  // 双页模式宽度按"两页 + 页间隙"计算（首页单独一页时仍按两页预留，切页不跳动）。
  // 90°/270° 旋转时按交换后的宽高计算
  const paddingX = narrowWindow ? READER_PADDING_X_NARROW : READER_PADDING_X;
  useEffect(() => {
    if (!refPage) return;
    const rotated = rotation % 180 !== 0;
    const pageW = rotated ? refPage.h : refPage.w;
    const pageH = rotated ? refPage.w : refPage.h;
    const spanW = pageLayout === "double" ? pageW * 2 + DOUBLE_PAGE_GAP : pageW;
    const wFit = Math.max(0.1, (containerWidth - paddingX) / spanW);
    const hFit = Math.max(0.1, (containerHeight - READER_PADDING_Y) / pageH);
    setFitScale(wFit);
    setFitPageScale(Math.min(wFit, hFit));
  }, [containerWidth, containerHeight, refPage, paddingX, pageLayout, rotation]);

  // ---------- 页码 ----------

  /** 显式跳转（页码输入/前后翻页按钮/键盘）：设置意图，由 PdfViewer 执行滚动 */
  const goToPage = useCallback(
    (page: number) => {
      const next = Math.min(Math.max(1, page), Math.max(1, numPages));
      setCurrentPage(next);
      setJumpTarget(next);
    },
    [numPages]
  );

  /**
   * 单页模式滚轮边界翻页：clamp 页码但不设置跳转意图。
   * 连续模式观察器上报也复用此通道——只更新页码，绝不触发滚动
   */
  const handlePageChange = useCallback(
    (page: number) => {
      setCurrentPage(Math.min(Math.max(1, page), Math.max(1, numPages)));
    },
    [numPages]
  );

  const handleJumpHandled = useCallback(() => setJumpTarget(null), []);
  const handleFocusHandled = useCallback(() => setFocusMatchId(null), []);

  // ---------- 阅读进度持久化 ----------

  /**
   * 页码 / 缩放 / 旋转 / 布局 / 翻页模式变化时（去抖 500ms）写回进度。
   * 布局与翻页模式由 setState 包装函数驱动，这里只需在状态本身变化时落盘。
   */
  useEffect(() => {
    const path = currentPathRef.current;
    if (!path || !pdf) return;
    if (progressTimerRef.current != null) window.clearTimeout(progressTimerRef.current);
    progressTimerRef.current = window.setTimeout(() => {
      progressTimerRef.current = null;
      saveProgress(path, {
        page: currentPage,
        scaleMode,
        scale,
        fitIntent,
        rotation,
        pageLayout,
        flipMode,
      });
    }, 500);
    return () => {
      if (progressTimerRef.current != null) {
        window.clearTimeout(progressTimerRef.current);
        progressTimerRef.current = null;
      }
    };
  }, [
    pdf,
    currentPage,
    scaleMode,
    scale,
    fitIntent,
    rotation,
    pageLayout,
    flipMode,
  ]);

  // ---------- 全文查找 ----------

  /** 关闭查找并清空所有高亮 */
  const closeSearch = useCallback(() => {
    setSearchOpen(false);
    setSearchMatches([]);
    setActiveMatchId(null);
    setFocusMatchId(null);
  }, []);

  /**
   * 选中匹配变化：设置激活高亮并滚动定位。
   * 翻页模式还需切换当前页；滚动模式交由 scrollIntoView 滚动，
   * 观察器随后跟随滚动更新页码（避免与页跳转动画互相抢占）
   */
  const handleActiveMatchChange = useCallback(
    (match: SearchMatch | null) => {
      setActiveMatchId(match?.id ?? null);
      setFocusMatchId(match?.id ?? null);
      if (match && flipMode === "paged" && match.page !== currentPage) {
        goToPage(match.page);
      }
    },
    [flipMode, currentPage, goToPage]
  );

  /** Ctrl+F 打开查找（存在文档时） */
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "f") {
        if (!pdf) return;
        e.preventDefault();
        setSearchOpen(true);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [pdf]);

  /** 顺时针旋转 90°（0→90→180→270→0 循环） */
  const rotateClockwise = useCallback(() => {
    setRotation((r) => (r + 90) % 360);
  }, []);

  /** 打印当前文档：先弹范围对话框，确认后渲染所选页位图并调起系统打印 */
  const handlePrint = useCallback(() => {
    if (!pdf) return;
    setPrintDialogOpen(true);
  }, [pdf]);

  /** 范围确认后执行打印 */
  const handlePrintConfirm = useCallback(
    async (pages: number[]) => {
      if (!pdf || printing || pages.length === 0) return;
      setPrintDialogOpen(false);
      setPrinting(true);
      setPrintProgress({ done: 0, total: pages.length });
      try {
        await printDocument(pdf.doc, pages, (done, total) =>
          setPrintProgress({ done, total })
        );
      } catch {
        /* 渲染失败静默退出，不打断阅读 */
      } finally {
        setPrinting(false);
        setPrintProgress(null);
      }
    },
    [pdf, printing]
  );

  /** Ctrl+P 打印（存在文档时） */
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "p") {
        if (!pdf) return;
        e.preventDefault();
        setPrintDialogOpen(true);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [pdf]);

  // ---------- 键盘（翻页模式整页翻动，双页按对翻；滚动模式走原生滚动） ----------

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!pdf || flipMode !== "paged") return;
      if (e.target instanceof HTMLInputElement) return;
      const step = pageLayout === "double" ? 2 : 1;
      if (e.key === "ArrowDown" || e.key === "PageDown" || e.key === " ") {
        e.preventDefault();
        goToPage(currentPage + step);
      } else if (e.key === "ArrowUp" || e.key === "PageUp") {
        e.preventDefault();
        goToPage(currentPage - step);
      } else if (e.key === "Home") {
        e.preventDefault();
        goToPage(1);
      } else if (e.key === "End") {
        e.preventDefault();
        goToPage(numPages);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [pdf, flipMode, pageLayout, currentPage, numPages, goToPage]);

  // ---------- 错误提示自动消失 ----------

  useEffect(() => {
    if (!errorKey) return;
    const timer = window.setTimeout(() => setErrorKey(null), 4000);
    return () => window.clearTimeout(timer);
  }, [errorKey]);

  return (
    <div className="app">
      <Toolbar
        fileName={fileName}
        numPages={numPages}
        currentPage={currentPage}
        onJumpToPage={goToPage}
        pageLayout={pageLayout}
        onPageLayoutChange={setPageLayout}
        flipMode={flipMode}
        onFlipModeChange={setFlipMode}
        onRotate={rotateClockwise}
        onPrint={handlePrint}
        fitIntent={fitIntent}
        onToggleFit={toggleFit}
        effScale={effScale}
        canZoomIn={canZoomIn}
        canZoomOut={canZoomOut}
        onZoomIn={zoomIn}
        onZoomOut={zoomOut}
        onSetScale={setZoomExact}
        themePref={themePref}
        onSetThemePref={setThemePref}
        onOpen={handleOpenDialog}
        onCloseFile={closeFile}
        onOpenAiSettings={() => setAiSettingsOpen(true)}
        onOpenSearch={() => setSearchOpen(true)}
        outlineAvailable={outline.length > 0}
        sidebarOpen={sidebarOpen}
        sidebarTab={sidebarTab}
        onToggleSidebar={(tab) => {
          if (sidebarOpen && sidebarTab === tab) setSidebarOpen(false);
          else {
            setSidebarTab(tab);
            setSidebarOpen(true);
          }
        }}
        disabled={!pdf}
      />

      <main className="reader">
        {pdf && basePage ? (
          <div className={`reader-body ${sidebarOpen ? "with-sidebar" : ""}`}>
            {sidebarOpen && (
              <Sidebar
                key={fileName}
                doc={pdf.doc}
                numPages={numPages}
                outline={outline}
                tab={sidebarTab}
                onTabChange={setSidebarTab}
                currentPage={currentPage}
                onNavigate={goToPage}
                onClose={() => setSidebarOpen(false)}
              />
            )}
            <div className="reader-main">
              {searchOpen && (
                <SearchBar
                  doc={pdf.doc}
                  onMatchesChange={setSearchMatches}
                  onActiveChange={handleActiveMatchChange}
                  onClose={closeSearch}
                />
              )}
              <PdfViewer
                key={fileName}
                doc={pdf.doc}
                numPages={numPages}
                pageLayout={pageLayout}
                flipMode={flipMode}
                rotation={rotation}
                currentPage={currentPage}
                onCurrentPageChange={handlePageChange}
                jumpTarget={jumpTarget}
                onJumpHandled={handleJumpHandled}
                effScale={effScale}
                onZoomStep={stepZoom}
                onWidthChange={setContainerWidth}
                onHeightChange={setContainerHeight}
                basePage={basePage}
                searchMatches={searchMatches}
                activeMatchId={activeMatchId}
                focusMatchId={focusMatchId}
                onFocusHandled={handleFocusHandled}
              />
            </div>
          </div>
        ) : (
          <EmptyState
            onOpen={handleOpenDialog}
            recentFiles={recentFiles}
            onOpenRecent={loadFile}
            onRemoveRecent={(path) => setRecentFiles(removeRecent(path))}
            onClearRecent={() => setRecentFiles(clearRecent())}
            onShowInFolder={(path) => void revealItemInDir(path).catch(() => {})}
          />
        )}
      </main>

      {dragOver && (
        <div className="drag-overlay">
          <div className="drag-card">
            <DocIcon size={26} />
            <span>{t("dropToOpen")}</span>
          </div>
        </div>
      )}

      {loading && (
        <div className="loading-overlay">
          <div className="spinner" />
          <span>{t("loading")}</span>
        </div>
      )}

      {printing && (
        <div className="loading-overlay">
          <div className="spinner" />
          <span>
            {t("preparingPrint")}
            {printProgress && (
              <span className="print-progress">
                {printProgress.done}/{printProgress.total}
              </span>
            )}
          </span>
        </div>
      )}

      {printDialogOpen && (
        <PrintDialog
          numPages={numPages}
          currentPage={currentPage}
          onConfirm={handlePrintConfirm}
          onClose={() => setPrintDialogOpen(false)}
        />
      )}

      {passwordOpen && (
        <PasswordDialog
          wrong={passwordWrong}
          onSubmit={handlePasswordSubmit}
          onCancel={handlePasswordCancel}
        />
      )}

      {errorKey && <div className="error-toast">{t(errorKey)}</div>}

      {/* AI 划词/划句翻译：选中 PDF 文本后浮现气泡，点击请求 AI */}
      <TranslatePopup onOpenSettings={() => setAiSettingsOpen(true)} />
      {aiSettingsOpen && <AiSettingsModal onClose={() => setAiSettingsOpen(false)} />}
    </div>
  );
}
