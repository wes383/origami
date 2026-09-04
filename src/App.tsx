import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { open as openFileDialog } from "@tauri-apps/plugin-dialog";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import type { SearchMatch } from "./lib/search";
import { printDocument } from "./lib/print";
import { saveProgress, type FitIntent, type ScaleMode } from "./lib/progress";
import {
  loadBookmarks,
  toggleBookmark,
  addBookmark,
  removeBookmarkAt,
  renameBookmark,
  type Bookmark,
} from "./lib/bookmarks";
import {
  loadAnnotations,
  addAnnotation,
  removeAnnotation,
  updateAnnotationColor,
  updateAnnotationNote,
  type Annotation,
  type AnnotationType,
} from "./lib/annotations";
import type { CaptureSelection } from "./lib/textLayerSelection";
import { useI18n } from "./i18n";
import { useTheme } from "./hooks/useTheme";
import {
  addRecent,
  clearRecent,
  loadRecent,
  removeRecent,
  type RecentFile,
} from "./lib/recent";
import { readText, storageKey, writeText } from "./lib/storage";
import { takeStartupFile, onOpenFile } from "./lib/startupFile";
import Toolbar from "./components/Toolbar";
import AutoReaderBar from "./components/AutoReaderBar";
import PdfViewer, { type PageLayout, type FlipMode } from "./components/PdfViewer";
import Sidebar, { type SidebarTab } from "./components/Sidebar";
import SearchBar from "./components/SearchBar";
import PrintDialog from "./components/PrintDialog";
import PasswordDialog from "./components/PasswordDialog";
import TranslatePopup from "./components/TranslatePopup";
import AnnotationPopup from "./components/AnnotationPopup";
import RightPanel from "./components/RightPanel";
import { useTextActionEngine, type RightTab } from "./hooks/useTextActionEngine";
import { useDocumentSession } from "./hooks/useDocumentSession";
import { usePageFilter } from "./hooks/usePageFilter";
import { useAutoReader } from "./hooks/useAutoReader";
import AiSettingsModal from "./components/AiSettingsModal";
import ShortcutsHelp from "./components/ShortcutsHelp";
import FilePropertiesModal from "./components/FilePropertiesModal";
import EmptyState from "./components/EmptyState";
import ErrorBoundary, { ViewerErrorFallback } from "./components/ErrorBoundary";
import { DocIcon } from "./components/Icons";

/** 手动缩放档位（参考 Chrome） */
const ZOOM_LEVELS = [0.25, 0.33, 0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4, 5];
const READER_PADDING_X = 48; // 阅读区左右留白（24px × 2）
const READER_PADDING_X_NARROW = 24; // ≤720px 窄断点（12px × 2），与 global.css 媒体查询对齐
const READER_PADDING_Y = 56; // 阅读区上下留白（28px × 2）
const DOUBLE_PAGE_GAP = 16; // 双页模式两页之间的间隙，与 global.css .pdf-slot-pair 一致

/** 侧边栏展开偏好的存储 key：记住用户上次手动展开/关闭，打开文档时应用 */
const SIDEBAR_PREF_KEY = storageKey("sidebar-pref");

/** 读取偏好；无记录（首次使用）默认展开，兼容旧行为（含目录的文档自动展开） */
function loadSidebarPref(): boolean {
  return readText(SIDEBAR_PREF_KEY) !== "closed";
}

/** 保存偏好：仅在用户手动操作（开关按钮 / 关闭按钮 / 快捷键）时调用，
    程序自动设置（打开/关闭文档时的重置）不得调用，避免覆盖用户选择 */
function saveSidebarPref(open: boolean) {
  writeText(SIDEBAR_PREF_KEY, open ? "open" : "closed");
}

export type { ScaleMode };

export default function App() {
  const { t } = useI18n();
  const { pref: themePref, setThemePref } = useTheme();
  /** 页面滤镜（护眼/夜间反色/纸色/自定义）：写 --page-filter 变量供 CSS 消费 */
  const pageFilter = usePageFilter();

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
  const [scaleMode, setScaleMode] = useState<ScaleMode>("custom");
  /**
   * 用户最后选择的 fit 模式（fit-width / fit-page）。
   * 点击 fit 按钮后 scaleMode 固定为 custom（切页不再自动调整），
   * 但仍依据此状态在两种模式间来回切换
   */
  const [fitIntent, setFitIntent] = useState<FitIntent>("fit-width");
  const [scale, setScale] = useState(1);
  const [fitScale, setFitScale] = useState(1);
  const [fitPageScale, setFitPageScale] = useState(1);
  const [containerWidth, setContainerWidth] = useState(0);
  const [containerHeight, setContainerHeight] = useState(0);
  const [basePage, setBasePage] = useState<{ w: number; h: number } | null>(null);
  /** fit 倍率的基准页：当前页的真实尺寸（各页尺寸可能不同） */
  const [refPage, setRefPage] = useState<{ w: number; h: number } | null>(null);
  const [dragOver, setDragOver] = useState(false);
  /** 阅读区左右留白（跟随 CSS 断点：≤720px 减半） */
  const [narrowWindow, setNarrowWindow] = useState(
    () => typeof window !== "undefined" && window.innerWidth <= 720
  );
  /** 最近打开的文件（localStorage 持久化，新→旧） */
  const [recentFiles, setRecentFiles] = useState<RecentFile[]>(() => loadRecent());
  /** AI 划词翻译设置弹窗 */
  const [aiSettingsOpen, setAiSettingsOpen] = useState(false);
  /** 快捷键帮助面板 */
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  /** 文件属性弹窗 */
  const [filePropsOpen, setFilePropsOpen] = useState(false);
  /** 全屏模式（Tauri 原生窗口全屏） */
  const [isFullscreen, setIsFullscreen] = useState(false);
  /** 侧边栏展开状态 */
  const [sidebarOpen, setSidebarOpen] = useState(false);
  /** 侧边栏当前标签页（目录 / 缩略图） */
  const [sidebarTab, setSidebarTab] = useState<SidebarTab>("outline");
  /** 右侧 AI 面板展开状态 */
  const [rightOpen, setRightOpen] = useState(false);
  /** 右侧面板当前标签页（AI 翻译 / Wikipedia） */
  const [rightTab, setRightTab] = useState<RightTab>("translate");
  /** 当前文档的用户书签（按页码升序），跟随 filePath 加载/清空 */
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);
  /** 当前文档的用户注释（含高亮/下划线/删除线/文字批注），跟随 filePath 加载/清空 */
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  /** 注释浮层：chip 或新建批注触发；含锚点视口坐标与是否聚焦批注输入框 */
  const [annoSel, setAnnoSel] = useState<{
    id: string;
    x: number;
    y: number;
    focus: boolean;
  } | null>(null);

  // ---------- 文档会话（打开 / 状态 / 关闭） ----------
  // 文档生命周期状态（pdf / 文件名 / 路径 / 页数 / 当前页 / 目录）由
  // useDocumentSession 管理；视图偏好在 onOpened 回调里恢复

  const {
    pdf,
    fileName,
    filePath,
    numPages,
    currentPage,
    setCurrentPage,
    outline,
    loading,
    errorKey,
    setErrorKey,
    currentPathRef,
    pageSizesRef,
    loadFile,
    closeFile,
    passwordOpen,
    passwordWrong,
    handlePasswordSubmit,
    handlePasswordCancel,
  } = useDocumentSession({
    /** 文档就绪后恢复视图偏好、记录最近文件、清查找结果、跳回上次阅读页 */
    onOpened: ({ path, restored, firstPage, page }) => {
      setBasePage(firstPage);
      setRefPage(firstPage);

      // 恢复上次的视图偏好；无记录时默认固定 100%（不再自适应）
      setScaleMode(restored?.scaleMode ?? "custom");
      setFitIntent(restored?.fitIntent ?? "fit-width");
      setScale(restored?.scale ?? 1);
      setRotation(restored?.rotation ?? 0);
      setPageLayout(restored?.pageLayout ?? "single");
      setFlipMode(restored?.flipMode ?? "scroll");

      setRecentFiles(addRecent(path));
      setSidebarTab("outline");
      // 载入该文档已保存的书签（localStorage 按文件路径持久化）
      setBookmarks(loadBookmarks(path));
      // 载入该文档的用户注释（高亮/下划线/删除线/批注，同样按路径持久化）
      setAnnotations(loadAnnotations(path));

      // 新文档：清空上一个文档的查找结果
      setSearchMatches([]);
      setActiveMatchId(null);
      setFocusMatchId(null);

      // 恢复到上次阅读页（首开时即第 1 页，无需滚动）
      if (page > 1) setJumpTarget(page);
    },
    /** 侧边栏默认状态：应用用户上次手动选择的展开/关闭偏好（无记录时默认展开）；
        文档本身无目录时无论偏好如何都不展开（没有可导航的内容） */
    onOutlineLoaded: (parsedOutline) => {
      setSidebarOpen(loadSidebarPref() && parsedOutline.length > 0);
    },
    /** 关闭文档后重置视图层状态 */
    onClosed: () => {
      setJumpTarget(null);
      setBasePage(null);
      setRefPage(null);
      setScaleMode("custom");
      setScale(1);
      setFitScale(1);
      setFitPageScale(1);
      setRotation(0);
      setSidebarOpen(false);
      setSidebarTab("outline");
      setBookmarks([]);
      setAnnotations([]);
      setAnnoSel(null);
      setRightOpen(false);
      setRightTab("translate");
      setSearchOpen(false);
      setSearchMatches([]);
      setActiveMatchId(null);
      setFocusMatchId(null);
      setPrinting(false);
      setPrintProgress(null);
    },
  });

  /** 划词翻译 / Wikipedia 引擎：统一管理请求与结果（浮动 + 右侧面板两处呈现）。
   *  依据右侧面板开合与当前 tab 决定结果落点。 */
  const openAiSettings = useCallback(() => setAiSettingsOpen(true), []);
  const engine = useTextActionEngine({
    onOpenSettings: openAiSettings,
    rightPanel: { open: rightOpen, tab: rightTab },
  });

  /** 阅读区滚动容器（自动阅读驱动与 PdfViewer 共用同一 ref 读写 scrollTop） */
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  /** currentPage 的镜像 ref：自动阅读驱动读取最新值，避免把 currentPage 列入依赖导致重建 */
  const currentPageRef = useRef(currentPage);
  currentPageRef.current = currentPage;

  /** 切换文档（或关闭）时清空右侧面板残留内容，避免旧结果串入新文档 */
  useEffect(() => {
    engine.clearPanel();
  }, [pdf, engine.clearPanel]);
  /** 全文查找 */
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchMatches, setSearchMatches] = useState<SearchMatch[]>([]);
  const [activeMatchId, setActiveMatchId] = useState<string | null>(null);
  const [focusMatchId, setFocusMatchId] = useState<string | null>(null);

  /** 进度保存去抖：滚动连发时只落最后一次 */
  const progressTimerRef = useRef<number | null>(null);

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 720px)");
    const onChange = (e: MediaQueryListEvent) => setNarrowWindow(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  // ---------- 全屏（Tauri 原生窗口全屏） ----------
  /** 切换全屏：读取真实状态 → 反置 → 再读真实状态回写，保证图标同步 */
  const toggleFullscreen = useCallback(() => {
    const win = getCurrentWindow();
    win
      .isFullscreen()
      .then(async (fs) => {
        // 进入全屏前先清除 WS_MAXIMIZE：tao 跨 maximize→fullscreen 切换时不会
        // 自动复位最大化标志，OS 仍按工作区计算客户区高度，wry 据此把 WebView
        // 视图停在「显示器高度 - 任务栏高度」，底部露出窗口默认黑色背景。
        // 表现为：屏幕底部（原来任务栏位置）一条黑条，仿佛没真正全屏。
        // 先 unmaximize 再 setFullscreen，让 WebView 跟着窗口铺到显示器完整尺寸。
        if (!fs) {
          try {
            if (await win.isMaximized()) await win.unmaximize();
          } catch {
            /* 权限缺失或调用失败不影响后续切全屏 */
          }
        }
        return win.setFullscreen(!fs);
      })
      .then(() => win.isFullscreen())
      .then(setIsFullscreen)
      .catch(() => {});
  }, []);

  useEffect(() => {
    // 初始化一次真实状态（该 Tauri 版本无 onFullscreenChanged，切换均由 toggleFullscreen 读取真实状态）
    getCurrentWindow()
      .isFullscreen()
      .then(setIsFullscreen)
      .catch(() => {});
  }, []);

  useLayoutEffect(() => {
    // 全屏沉浸：给 <html> 挂 fs-on class —— 隐藏 tauri-plugin-frame 注入的
    // 窗口控制按钮（最小化/最大化/关闭），并收回工具栏右上角预留宽度。
    // 用 useLayoutEffect（而非 useEffect）：按钮渲染同帧就位，避免进入全屏时
    // 按钮先出现在 Snap Overlay 覆盖区（右上角 y≤52px）一帧。
    // 对应规则见 global.css 的 .fs-on 段；退出全屏仍走 F11 / 设置菜单。
    document.documentElement.classList.toggle("fs-on", isFullscreen);
  }, [isFullscreen]);

  const effScale =
    scaleMode === "fit-width"
      ? fitScale
      : scaleMode === "fit-page"
        ? fitPageScale
        : scale;
  const canZoomIn = effScale < ZOOM_LEVELS[ZOOM_LEVELS.length - 1] - 0.01;
  const canZoomOut = effScale > ZOOM_LEVELS[0] + 0.01;

  const handleOpenDialog = useCallback(async () => {
    const selected = await openFileDialog({
      multiple: false,
      filters: [{ name: "PDF", extensions: ["pdf"] }],
    });
    const path = typeof selected === "string" ? selected : null;
    if (path) loadFile(path);
  }, [loadFile]);

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
          loadFile(paths[0]);
        }
      });
      if (disposed) fn();
      else unlisten = fn;
    })();
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [loadFile, setErrorKey]);

  // ---------- 双击 PDF 文件启动 ----------
  // 首个实例读命令行参数；后续实例由单实例插件转发 open-file 事件

  useEffect(() => {
    let disposed = false;
    void (async () => {
      const path = await takeStartupFile();
      if (!disposed && path) loadFile(path);
    })();
    const unlisten = onOpenFile((path) => loadFile(path));
    return () => {
      disposed = true;
      void unlisten.then((fn) => fn());
    };
  }, [loadFile]);

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
  }, [pdf, currentPage, basePage, pageSizesRef]);

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
    [numPages, setCurrentPage]
  );

  /**
   * 单页模式滚轮边界翻页：clamp 页码但不设置跳转意图。
   * 连续模式观察器上报也复用此通道——只更新页码，绝不触发滚动
   */
  const handlePageChange = useCallback(
    (page: number) => {
      setCurrentPage(Math.min(Math.max(1, page), Math.max(1, numPages)));
    },
    [numPages, setCurrentPage]
  );

  // ---------- 自动阅读（自动滚动 / 自动翻页） ----------
  const auto = useAutoReader({
    containerRef: scrollContainerRef,
    enabled: !!pdf,
    flipMode,
    numPages,
    pageLayout,
    currentPageRef,
    goToPage,
  });
  /** 键盘 handler 用的 ref 镜像：避免把 auto.* 放进依赖导致监听反复重建 */
  const autoActiveRef = useRef(false);
  autoActiveRef.current = auto.isPlaying;
  const autoToggleRef = useRef(auto.toggle);
  autoToggleRef.current = auto.toggle;
  const autoPauseRef = useRef(auto.pause);
  autoPauseRef.current = auto.pause;
  const autoStopRef = useRef(auto.stop);
  autoStopRef.current = auto.stop;
  /** 文档关闭（pdf 置空）时复位自动阅读状态，避免下一份文档打开后误显示"播放中" */
  useEffect(() => {
    if (!pdf) autoStopRef.current();
  }, [pdf]);

  const handleJumpHandled = useCallback(() => setJumpTarget(null), []);
  const handleFocusHandled = useCallback(() => setFocusMatchId(null), []);

  // ---------- 用户书签 ----------
  /** 切换当前页书签（已标记则移除，未标记则添加），落盘并同步本地状态 */
  const toggleCurrentBookmark = useCallback(() => {
    const path = currentPathRef.current;
    if (!path) return;
    setBookmarks(toggleBookmark(path, currentPage));
  }, [currentPage]);

  /** 列表内「添加当前页」：每页至多一条，已存在则更新时间 */
  const addCurrentBookmark = useCallback(() => {
    const path = currentPathRef.current;
    if (!path) return;
    setBookmarks(addBookmark(path, currentPage, ""));
  }, [currentPage]);

  /** 移除指定索引的书签（索引对应当前 bookmarks 数组顺序） */
  const removeBookmarkAtIdx = useCallback((index: number) => {
    const path = currentPathRef.current;
    if (!path) return;
    setBookmarks(removeBookmarkAt(path, index));
  }, []);

  /** 重命名指定索引的书签（label 空串 = 恢复默认标题） */
  const renameBookmarkAtIdx = useCallback((index: number, label: string) => {
    const path = currentPathRef.current;
    if (!path) return;
    setBookmarks(renameBookmark(path, index, label));
  }, []);

  // ---------- 用户注释（高亮 / 下划线 / 删除线 / 文字批注） ----------

  /**
   * 选区气泡触发：创建注释后落盘并同步状态。
   * 几何类注释与同页同类型重叠时由 lib 去重返回 null（忽略即可）；
   * note 类型会随后打开批注浮层，锚点取选区左上角
   */
  const createAnnotation = useCallback(
    (
      type: AnnotationType,
      cap: CaptureSelection,
      anchor: { x: number; y: number },
      color?: string
    ) => {
      const path = currentPathRef.current;
      if (!path) return;
      const result = addAnnotation(path, {
        type,
        page: cap.page,
        rects: cap.rects,
        text: cap.text,
        ...(color ? { color } : {}),
      });
      if (!result) return;
      setAnnotations(result);
      if (type === "note") {
        const created = result[result.length - 1];
        setAnnoSel({ id: created.id, x: anchor.x, y: anchor.y, focus: true });
      }
    },
    []
  );

  /** 页面注释 chip 点击：打开注释浮层（非新建，不聚焦输入框） */
  const openAnnoPopup = useCallback((id: string, x: number, y: number) => {
    setAnnoSel({ id, x, y, focus: false });
  }, []);

  /** 批注正文保存（note 类型） */
  const saveAnnoNote = useCallback((id: string, note: string) => {
    const path = currentPathRef.current;
    if (!path) return;
    setAnnotations(updateAnnotationNote(path, id, note));
  }, []);

  /** 修改几何注释落笔色；浮层保持打开，页面矩形/chip 即时变色预览 */
  const recolorAnno = useCallback((id: string, color: string) => {
    const path = currentPathRef.current;
    if (!path) return;
    setAnnotations(updateAnnotationColor(path, id, color));
  }, []);

  /** 删除注释；浮层随之关闭 */
  const deleteAnno = useCallback((id: string) => {
    const path = currentPathRef.current;
    if (!path) return;
    setAnnotations(removeAnnotation(path, id));
    setAnnoSel(null);
  }, []);

  /** 当前浮层对应的注释（可能已被删除 → 浮层自动消失） */
  const annoPopup = annoSel
    ? (annotations.find((a) => a.id === annoSel.id) ?? null)
    : null;

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
    currentPathRef,
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

  /** Ctrl+F 打开查找；首页（无文档）也阻止系统默认查找行为 */
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key.toLowerCase() === "f") {
        e.preventDefault(); // 禁用系统默认 Ctrl+F（首页无文档时同样阻止浏览器/系统查找条）
        if (!pdf) return;
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
      if (e.ctrlKey && e.key.toLowerCase() === "p") {
        if (!pdf) return;
        e.preventDefault();
        setPrintDialogOpen(true);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [pdf]);

  // ---------- 键盘（← / → 通用整页翻动，双页按对翻；其余仅翻页模式，滚动模式走原生滚动） ----------

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!pdf) return;
      const target = e.target as HTMLElement | null;
      const typing =
        !!target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable);
      if (typing) return;
      const step = pageLayout === "double" ? 2 : 1;
      const autoActive = autoActiveRef.current;

      // 空格：自动阅读 暂停/恢复（两种翻页模式通用）；未启动时按下即开始
      if (e.key === " ") {
        e.preventDefault();
        autoToggleRef.current();
        return;
      }

      // 手动导航键（方向键 / PageUp·Down / Home·End）：若自动阅读进行中先暂停，
      // 把控制权交还用户（避免自动滚动与手动翻页互相抢占）
      const isNav =
        e.key === "ArrowLeft" ||
        e.key === "ArrowRight" ||
        e.key === "ArrowDown" ||
        e.key === "ArrowUp" ||
        e.key === "PageDown" ||
        e.key === "PageUp" ||
        e.key === "Home" ||
        e.key === "End";
      if (autoActive && isNav) autoPauseRef.current();

      if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        e.preventDefault();
        goToPage(currentPage + (e.key === "ArrowRight" ? step : -step));
        return;
      }
      if (flipMode !== "paged") return;
      if (e.key === "ArrowDown" || e.key === "PageDown") {
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

  // ---------- 键盘快捷键（全局，Windows 版仅用 Ctrl） ----------
  // Ctrl 组合：O 打开、0 复位缩放、= 放大、- 缩小、\ 切换目录侧栏
  // 纯键：? 帮助、R 旋转、F 适应（无文档 / 输入框聚焦时多数不触发）

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const typing =
        !!target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable);

      // —— 修饰键组合（仅 Ctrl，本应用仅发布 Windows 版）——
      if (e.ctrlKey) {
        const key = e.key.toLowerCase();
        if (key === "o") {
          e.preventDefault();
          void handleOpenDialog();
          return;
        }
        if (!pdf) return; // 其余组合需已打开文档
        if (key === "0") {
          e.preventDefault();
          setZoomExact(1);
        } else if (key === "=" || key === "+") {
          e.preventDefault();
          zoomIn();
        } else if (key === "-") {
          e.preventDefault();
          zoomOut();
        } else if (key === "\\") {
          e.preventDefault();
          // 同标签页重复点击则收起
          if (sidebarOpen && sidebarTab === "outline") {
            setSidebarOpen(false);
            saveSidebarPref(false);
          } else {
            setSidebarTab("outline");
            setSidebarOpen(true);
            saveSidebarPref(true);
          }
        } else if (key === "t") {
          // 翻译侧边栏开关（T = Translate）
          e.preventDefault();
          setRightOpen((v) => !v);
        }
        return;
      }

      // —— 纯快捷键（无修饰键）——
      if (typing) return;

      // ? 打开快捷键帮助（Shift + /）
      if (e.key === "?") {
        e.preventDefault();
        setShortcutsOpen(true);
        return;
      }

      // F11 切换全屏（窗口级功能，无需文档）
      if (e.key === "F11") {
        e.preventDefault();
        toggleFullscreen();
        return;
      }

      // Esc 退出全屏（仅全屏时触发；各弹窗自带的 Esc 关闭不受影响）
      if (e.key === "Escape" && isFullscreen) {
        e.preventDefault();
        const win = getCurrentWindow();
        win
          .setFullscreen(false)
          .then(() => win.isFullscreen())
          .then(setIsFullscreen)
          .catch(() => {});
        return;
      }

      if (!pdf) return; // 以下需已打开文档
      const key = e.key.toLowerCase();
      if (key === "r") {
        e.preventDefault();
        rotateClockwise();
      } else if (key === "f") {
        e.preventDefault();
        toggleFit();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    pdf,
    isFullscreen,
    sidebarOpen,
    sidebarTab,
    handleOpenDialog,
    zoomIn,
    zoomOut,
    setZoomExact,
    rotateClockwise,
    toggleFit,
    toggleFullscreen,
  ]);

  // ---------- 错误提示自动消失 ----------

  useEffect(() => {
    if (!errorKey) return;
    const timer = window.setTimeout(() => setErrorKey(null), 4000);
    return () => window.clearTimeout(timer);
  }, [errorKey, setErrorKey]);

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
        pageFilter={pageFilter}
        onOpen={handleOpenDialog}
        onCloseFile={closeFile}
        onOpenAiSettings={() => setAiSettingsOpen(true)}
        onShowShortcuts={() => setShortcutsOpen(true)}
        onShowFileProps={() => setFilePropsOpen(true)}
        isFullscreen={isFullscreen}
        onToggleFullscreen={toggleFullscreen}
        onOpenSearch={() => setSearchOpen(true)}
        outlineAvailable={outline.length > 0}
        sidebarOpen={sidebarOpen}
        sidebarTab={sidebarTab}
        onToggleSidebar={(tab) => {
          if (sidebarOpen && sidebarTab === tab) {
            setSidebarOpen(false);
            saveSidebarPref(false);
          } else {
            setSidebarTab(tab);
            setSidebarOpen(true);
            saveSidebarPref(true);
          }
        }}
        rightPanelOpen={rightOpen}
        onToggleRightPanel={() => setRightOpen((v) => !v)}
        disabled={!pdf}
        autoPlaying={auto.isPlaying}
        onToggleAuto={auto.toggle}
        bookmarkedCurrent={bookmarks.some((b) => b.page === currentPage)}
        onToggleBookmark={toggleCurrentBookmark}
      />

      <main className="reader">
        {pdf && basePage ? (
          <div
            className={`reader-body ${sidebarOpen ? "with-sidebar" : ""} ${
              rightOpen ? "with-right-sidebar" : ""
            }`}
          >
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
                bookmarks={bookmarks}
                onAddBookmark={addCurrentBookmark}
                onRemoveBookmark={removeBookmarkAtIdx}
                onRenameBookmark={renameBookmarkAtIdx}
                annotations={annotations}
                onDeleteAnnotation={deleteAnno}
                onClose={() => {
                  setSidebarOpen(false);
                  saveSidebarPref(false);
                }}
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
              {/* 错误边界：单个页面渲染抛错时兜底，避免整页白屏；
                  key 跟随文件名，切换文档自动重置 */}
              <ErrorBoundary
                key={fileName}
                fallback={(reset) => <ViewerErrorFallback onRetry={reset} />}
              >
                <PdfViewer
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
                  annotations={annotations}
                  onAnnoOpen={openAnnoPopup}
                  activeMatchId={activeMatchId}
                  focusMatchId={focusMatchId}
                  onFocusHandled={handleFocusHandled}
                  containerRef={scrollContainerRef}
                  autoScrollingRef={auto.autoScrollingRef}
                  onAutoScrollInterrupt={auto.pause}
                />
              </ErrorBoundary>
              {auto.isPlaying && (
                <AutoReaderBar
                  speedValue={auto.speedValue(flipMode)}
                  speedUnit={flipMode === "paged" ? t("autoSecPerPage") : "px/s"}
                  paged={flipMode === "paged"}
                  speedMin={flipMode === "paged" ? 0.1 : 1}
                  speedIndex={auto.speedIndex(flipMode)}
                  speedCount={auto.speedCount(flipMode)}
                  onCycleSpeed={(d) => auto.cycleSpeed(d, flipMode)}
                  onValueCommit={(n) => auto.commitSpeed(n, flipMode)}
                  onClose={auto.stop}
                />
              )}
            </div>
            {rightOpen && (
              <RightPanel
                tab={rightTab}
                onTabChange={setRightTab}
                onClose={() => {
                  setRightOpen(false);
                  engine.clearPanel();
                }}
                engine={engine}
              />
            )}
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
      <TranslatePopup
        engine={engine}
        rightPanel={{ open: rightOpen, tab: rightTab }}
        onAnnotate={createAnnotation}
      />
      {/* 注释浮层：chip 或新建批注后打开，可编辑正文 / 删除 */}
      {annoSel && annoPopup && (
        <AnnotationPopup
          key={`${annoSel.id}-${annoSel.x}-${annoSel.y}-${annoSel.focus ? 1 : 0}`}
          ann={annoPopup}
          x={annoSel.x}
          y={annoSel.y}
          focusNote={annoSel.focus}
          onSaveNote={saveAnnoNote}
          onRecolor={recolorAnno}
          onDelete={deleteAnno}
          onClose={() => setAnnoSel(null)}
        />
      )}
      {aiSettingsOpen && <AiSettingsModal onClose={() => setAiSettingsOpen(false)} />}
      {shortcutsOpen && (
        <ShortcutsHelp onClose={() => setShortcutsOpen(false)} />
      )}
      {pdf && filePropsOpen && (
        <FilePropertiesModal
          doc={pdf.doc}
          fileName={fileName}
          filePath={filePath}
          numPages={numPages}
          fileSize={pdf.size}
          onClose={() => setFilePropsOpen(false)}
        />
      )}
    </div>
  );
}
