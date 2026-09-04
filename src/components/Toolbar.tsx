import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useI18n, UI_LANGS } from "../i18n";
import type { ThemePref } from "../hooks/useTheme";
import type { PageFilter } from "../hooks/usePageFilter";
import { useFullscreenToolbar } from "../hooks/useFullscreenToolbar";
import type { PageLayout, FlipMode } from "./PdfViewer";
import {
  AnnotateIcon,
  CheckIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  BookmarkIcon,
  BookmarkPlusIcon,
  BookmarkFilledIcon,
  DocIcon,
  FitPageIcon,
  FitWidthIcon,
  GridIcon,
  InfoIcon,
  KeyboardIcon,
  FullscreenIcon,
  FullscreenExitIcon,
  LanguagesIcon,
  ListIcon,
  MinusIcon,
  MoreIcon,
  PinIcon,
  PinOffIcon,
  PlusIcon,
  PlayIcon,
  PauseIcon,
  PrinterIcon,
  RotateIcon,
  SearchIcon,
  SettingsIcon,
  XIcon,
} from "./Icons";
import type { SidebarTab } from "./Sidebar";

/** ≤此宽度时隐藏工具栏缩放控件（改由「更多操作」菜单提供） */
const ZOOM_HIDDEN_BELOW = 650;

interface ToolbarProps {
  fileName: string;
  numPages: number;
  currentPage: number;
  onJumpToPage: (page: number) => void;
  pageLayout: PageLayout;
  onPageLayoutChange: (layout: PageLayout) => void;
  flipMode: FlipMode;
  onFlipModeChange: (mode: FlipMode) => void;
  /** 顺时针旋转 90° */
  onRotate: () => void;
  /** 打印当前文档 */
  onPrint: () => void;
  /** 打开文件属性弹窗 */
  onShowFileProps: () => void;
  /** 用户最后选择的 fit 模式，点击按钮将切换到另一个 */
  fitIntent: "fit-width" | "fit-page";
  onToggleFit: () => void;
  effScale: number;
  canZoomIn: boolean;
  canZoomOut: boolean;
  onZoomIn: () => void;
  onZoomOut: () => void;
  /** 手动输入精确缩放（0.25–5），切换到 custom 模式 */
  onSetScale: (scale: number) => void;
  themePref: ThemePref;
  onSetThemePref: (pref: ThemePref) => void;
  /** 页面滤镜（护眼/夜间反色/纸色/自定义）：usePageFilter 的返回值 */
  pageFilter: PageFilter;
  onOpen: () => void;
  /** 关闭当前文件，回到引导页 */
  onCloseFile: () => void;
  /** 打开 AI 翻译设置弹窗 */
  onOpenAiSettings: () => void;
  /** 打开快捷键帮助面板 */
  onShowShortcuts: () => void;
  /** 当前是否处于全屏 */
  isFullscreen: boolean;
  /** 切换全屏 */
  onToggleFullscreen: () => void;
  /** 打开全文查找 */
  onOpenSearch: () => void;
  /** 当前文档是否含目录 */
  outlineAvailable: boolean;
  /** 侧边栏是否展开 */
  sidebarOpen: boolean;
  /** 侧边栏当前标签页 */
  sidebarTab: SidebarTab;
  /** 切换侧边栏（同标签页重复点击则收起） */
  onToggleSidebar: (tab: SidebarTab) => void;
  /** 右侧 AI 面板是否展开 */
  rightPanelOpen: boolean;
  /** 切换右侧 AI 面板 */
  onToggleRightPanel: () => void;
  disabled: boolean;
  /** 自动阅读是否正在播放（控制播放/暂停图标与高亮态） */
  autoPlaying: boolean;
  /** 播放/暂停切换（空格键同样触发） */
  onToggleAuto: () => void;
  /** 当前页是否已加书签（决定更多操作菜单项显示「添加」还是「移除」） */
  bookmarkedCurrent: boolean;
  /** 切换当前页书签（添加/移除） */
  onToggleBookmark: () => void;
}

export default function Toolbar({
  fileName,
  numPages,
  currentPage,
  onJumpToPage,
  pageLayout,
  onPageLayoutChange,
  flipMode,
  onFlipModeChange,
  onRotate,
  onPrint,
  onShowFileProps,
  fitIntent,
  onToggleFit,
  effScale,
  canZoomIn,
  canZoomOut,
  onZoomIn,
  onZoomOut,
  onSetScale,
  themePref,
  onSetThemePref,
  pageFilter,
  onOpen,
  onCloseFile,
  onOpenAiSettings,
  onShowShortcuts,
  isFullscreen,
  onToggleFullscreen,
  onOpenSearch,
  outlineAvailable,
  sidebarOpen,
  sidebarTab,
  onToggleSidebar,
  rightPanelOpen,
  onToggleRightPanel,
  disabled,
  autoPlaying,
  onToggleAuto,
  bookmarkedCurrent,
  onToggleBookmark,
}: ToolbarProps) {
  const { t, lang, setLang } = useI18n();
  const [pageInput, setPageInput] = useState(String(currentPage));
  const [zoomInput, setZoomInput] = useState(String(Math.round(effScale * 100)));
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  /** 更多操作下拉菜单 */
  const [moreOpen, setMoreOpen] = useState(false);
  const moreMenuRef = useRef<HTMLDivElement | null>(null);
  /** 语言二级菜单（向右 flyout，portal 到 body 避免被下拉菜单的滚动裁切） */
  const [langMenuOpen, setLangMenuOpen] = useState(false);
  const langWrapRef = useRef<HTMLDivElement | null>(null);
  const langMenuDomRef = useRef<HTMLDivElement | null>(null);
  /** ≤650px 时工具栏缩放控件隐藏，改由「更多操作」菜单提供 */
  const [narrow, setNarrow] = useState(
    () => window.innerWidth <= ZOOM_HIDDEN_BELOW
  );
  // 全屏 auto-hide 状态机（唤醒带/探针条/图钉/菜单抑制隐藏）见 hook 注释
  const {
    barVisible: fsBarVisible,
    pinned: fsBarPinned,
    showBar: showFsBar,
    handleBarPointerLeave,
    togglePinned: toggleFsBarPinned,
  } = useFullscreenToolbar({ isFullscreen, menuOpen, moreOpen, langMenuOpen });

  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${ZOOM_HIDDEN_BELOW}px)`);
    const onChange = () => setNarrow(mq.matches);
    onChange();
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    setPageInput(String(currentPage));
  }, [currentPage]);

  useEffect(() => {
    setZoomInput(String(Math.round(effScale * 100)));
  }, [effScale]);

  // 点击菜单外部 / Esc 关闭
  useEffect(() => {
    if (!menuOpen) return;
    const onPointerDown = (e: PointerEvent) => {
      // 语言二级菜单 portal 到 body（不在 menuRef 内），点击其内部不应关闭主菜单
      if (
        !menuRef.current?.contains(e.target as Node) &&
        !langMenuDomRef.current?.contains(e.target as Node)
      )
        setMenuOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [menuOpen]);

  // 点击更多菜单外部 / Esc 关闭
  useEffect(() => {
    if (!moreOpen) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!moreMenuRef.current?.contains(e.target as Node)) setMoreOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMoreOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [moreOpen]);

  // 语言二级菜单：点击其外部（含设置菜单内其他区域、portal 后的菜单本体）即关闭；
  // 窗口缩放或下拉菜单滚动时位置会错位，直接收起
  useEffect(() => {
    if (!langMenuOpen) return;
    const onPointerDown = (e: PointerEvent) => {
      if (
        !langWrapRef.current?.contains(e.target as Node) &&
        !langMenuDomRef.current?.contains(e.target as Node)
      )
        setLangMenuOpen(false);
    };
    const onDismiss = () => setLangMenuOpen(false);
    document.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("resize", onDismiss);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("resize", onDismiss);
    };
  }, [langMenuOpen]);

  const commitPageInput = () => {
    const n = parseInt(pageInput, 10);
    if (!Number.isNaN(n) && n >= 1 && n <= numPages) {
      // 未修改（或目标等于当前页）不触发跳转，避免 blur 也滚到当前页顶部
      if (n !== currentPage) onJumpToPage(n);
      else setPageInput(String(currentPage));
    } else {
      setPageInput(String(currentPage));
    }
  };

  const commitZoomInput = () => {
    const n = parseInt(zoomInput, 10);
    if (Number.isNaN(n)) {
      setZoomInput(String(Math.round(effScale * 100)));
      return;
    }
    const clamped = Math.min(500, Math.max(25, n));
    onSetScale(clamped / 100);
    setZoomInput(String(clamped));
  };

  const prevDisabled = disabled || currentPage <= 1;
  const nextDisabled = disabled || currentPage >= numPages;

  const switchLang = (next: (typeof UI_LANGS)[number]["id"]) => setLang(next);

  return (
    // data-tauri-drag-region 使工具栏空白区域可作为窗口拖拽区（子元素交互不受影响）；
    // 全屏时属性改为 "false"（tauri 的 drag.js 运行时读属性，"false" = 显式禁用，
    // 阻止该元素及其祖先的拖拽）——全屏窗口不应被拖动；
    // 右上角窗口按钮由 tauri-plugin-frame 注入（z-index 100 层，浮于工具栏之上）
    <>
      <header
        className={`toolbar ${disabled ? "no-center" : ""} ${
          isFullscreen && !fsBarPinned && !fsBarVisible ? "toolbar-hidden" : ""
        }`}
        data-tauri-drag-region={isFullscreen ? "false" : ""}
        onPointerEnter={showFsBar}
        onPointerLeave={handleBarPointerLeave}
      >
      {/* 左：菜单 + 文件名 */}
      <div className="tb-group tb-left">
        {/* 设置下拉菜单 */}
        <div className="tb-menu" ref={menuRef}>
          <button
            type="button"
            className={`tb-btn icon-only ${menuOpen ? "is-open" : ""}`}
            onClick={() => setMenuOpen((v) => !v)}
            title={t("settings")}
            aria-label={t("settings")}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
          >
            <SettingsIcon />
          </button>

          {menuOpen && (
            <div
              className="tb-dropdown tb-dropdown-left"
              role="menu"
              onScroll={() => setLangMenuOpen(false)}
            >
              <button
                type="button"
                className="tb-dropdown-item"
                role="menuitem"
                onClick={() => {
                  setMenuOpen(false);
                  onOpen();
                }}
              >
                <DocIcon />
                <span>{t("openPdf")}</span>
              </button>

              {!disabled && (
                <>
                  <button
                    type="button"
                    className="tb-dropdown-item is-danger"
                    role="menuitem"
                    onClick={() => {
                      setMenuOpen(false);
                      onCloseFile();
                    }}
                  >
                    <XIcon />
                    <span>{t("closeFile")}</span>
                  </button>

                  <button
                    type="button"
                    className="tb-dropdown-item"
                    role="menuitem"
                    onClick={() => {
                      setMenuOpen(false);
                      onPrint();
                    }}
                  >
                    <PrinterIcon />
                    <span>{t("print")}</span>
                  </button>

                  <button
                    type="button"
                    className="tb-dropdown-item"
                    role="menuitem"
                    onClick={() => {
                      setMenuOpen(false);
                      onShowFileProps();
                    }}
                  >
                    <InfoIcon />
                    <span>{t("fileProperties")}</span>
                  </button>
                </>
              )}

              {disabled && (
                <>
                  <div className="tb-dropdown-separator" />
                  {/* 全屏：仅主页（无文档）时在此提供；文档打开后由「更多操作」按钮提供 */}
                  <button
                    type="button"
                    className="tb-dropdown-item"
                    role="menuitem"
                    onClick={() => {
                      setMenuOpen(false);
                      onToggleFullscreen();
                    }}
                  >
                    {isFullscreen ? <FullscreenExitIcon /> : <FullscreenIcon />}
                    <span>{isFullscreen ? t("exitFullscreen") : t("fullscreen")}</span>
                  </button>
                </>
              )}

              <div className="tb-dropdown-separator" />

              <div className="tb-dropdown-label">{t("language")}</div>
              <div className="tb-lang-wrap" ref={langWrapRef}>
                <button
                  type="button"
                  className="tb-lang-trigger"
                  onClick={() => setLangMenuOpen((v) => !v)}
                  aria-haspopup="menu"
                  aria-expanded={langMenuOpen}
                >
                  <span>
                    {UI_LANGS.find((l) => l.id === lang)?.label ?? lang}
                  </span>
                  <ChevronRightIcon size={12} />
                </button>
              </div>

              {/* 语言二级菜单 portal 到 body：固定定位，向右飞出，
                  避免被设置了 overflow 滚动的下拉容器裁切 */}
              {langMenuOpen &&
                langWrapRef.current &&
                createPortal(
                  (() => {
                    const rect =
                      langWrapRef.current!.getBoundingClientRect();
                    const menuH = UI_LANGS.length * 30 + 8;
                    const top = Math.min(
                      rect.top,
                      Math.max(8, window.innerHeight - 8 - menuH)
                    );
                    const left = rect.right + 6;
                    return (
                      <div
                        className="tb-lang-menu tb-lang-menu-fixed"
                        ref={langMenuDomRef}
                        role="menu"
                        style={{ top, left }}
                      >
                        {UI_LANGS.map((l) => (
                          <button
                            key={l.id}
                            type="button"
                            className={`tb-lang-item ${
                              lang === l.id ? "is-active" : ""
                            }`}
                            role="menuitemradio"
                            aria-checked={lang === l.id}
                            onClick={() => {
                              switchLang(l.id);
                              setLangMenuOpen(false);
                            }}
                          >
                            <span className="tb-lang-dot" aria-hidden="true" />
                            <span className="tb-lang-name">{l.label}</span>
                          </button>
                        ))}
                      </div>
                    );
                  })(),
                  document.body
                )}

              <div className="tb-dropdown-label">{t("theme")}</div>
              <div className="tb-dropdown-row">
                <button
                  type="button"
                  className={`tb-dropdown-choice ${themePref === "light" ? "is-active" : ""}`}
                  role="menuitemradio"
                  aria-checked={themePref === "light"}
                  onClick={() => onSetThemePref("light")}
                >
                  {t("lightTheme")}
                </button>
                <button
                  type="button"
                  className={`tb-dropdown-choice ${themePref === "dark" ? "is-active" : ""}`}
                  role="menuitemradio"
                  aria-checked={themePref === "dark"}
                  onClick={() => onSetThemePref("dark")}
                >
                  {t("darkTheme")}
                </button>
                <button
                  type="button"
                  className={`tb-dropdown-choice ${themePref === "system" ? "is-active" : ""}`}
                  role="menuitemradio"
                  aria-checked={themePref === "system"}
                  onClick={() => onSetThemePref("system")}
                >
                  {t("systemTheme")}
                </button>
              </div>

              {/* 页面滤镜：纯 CSS filter，阅读区与缩略图跟随，打印恒为原色 */}
              <div className="tb-dropdown-label">{t("pageFilter")}</div>
              <div className="tb-dropdown-row">
                <button
                  type="button"
                  className={`tb-dropdown-choice ${pageFilter.mode === "off" ? "is-active" : ""}`}
                  role="menuitemradio"
                  aria-checked={pageFilter.mode === "off"}
                  onClick={() => pageFilter.setMode("off")}
                >
                  {t("filterOff")}
                </button>
                <button
                  type="button"
                  className={`tb-dropdown-choice ${pageFilter.mode === "night" ? "is-active" : ""}`}
                  role="menuitemradio"
                  aria-checked={pageFilter.mode === "night"}
                  onClick={() => pageFilter.setMode("night")}
                >
                  {t("filterNight")}
                </button>
                <button
                  type="button"
                  className={`tb-dropdown-choice ${pageFilter.mode === "paper" ? "is-active" : ""}`}
                  role="menuitemradio"
                  aria-checked={pageFilter.mode === "paper"}
                  onClick={() => pageFilter.setMode("paper")}
                >
                  {t("filterPaper")}
                </button>
                <button
                  type="button"
                  className={`tb-dropdown-choice ${pageFilter.mode === "custom" ? "is-active" : ""}`}
                  role="menuitemradio"
                  aria-checked={pageFilter.mode === "custom"}
                  onClick={() => pageFilter.setMode("custom")}
                >
                  {t("filterCustom")}
                </button>
              </div>
              {pageFilter.mode === "custom" && (
                <div className="tb-filter-sliders">
                  <div className="tb-filter-slider">
                    <span>{t("filterBrightness")}</span>
                    <input
                      type="range"
                      min={50}
                      max={150}
                      step={1}
                      value={pageFilter.custom.brightness}
                      aria-label={t("filterBrightness")}
                      onChange={(e) =>
                        pageFilter.setCustom({ brightness: Number(e.target.value) })
                      }
                    />
                    <span className="tb-filter-slider-value">
                      {pageFilter.custom.brightness}%
                    </span>
                  </div>
                  <div className="tb-filter-slider">
                    <span>{t("filterContrast")}</span>
                    <input
                      type="range"
                      min={50}
                      max={150}
                      step={1}
                      value={pageFilter.custom.contrast}
                      aria-label={t("filterContrast")}
                      onChange={(e) =>
                        pageFilter.setCustom({ contrast: Number(e.target.value) })
                      }
                    />
                    <span className="tb-filter-slider-value">
                      {pageFilter.custom.contrast}%
                    </span>
                  </div>
                  <div className="tb-filter-slider">
                    <span>{t("filterWarmth")}</span>
                    <input
                      type="range"
                      min={0}
                      max={100}
                      step={1}
                      value={pageFilter.custom.warmth}
                      aria-label={t("filterWarmth")}
                      onChange={(e) =>
                        pageFilter.setCustom({ warmth: Number(e.target.value) })
                      }
                    />
                    <span className="tb-filter-slider-value">
                      {pageFilter.custom.warmth}%
                    </span>
                  </div>
                </div>
              )}

              <div className="tb-dropdown-separator" />

              <button
                type="button"
                className="tb-dropdown-item"
                role="menuitem"
                onClick={() => {
                  setMenuOpen(false);
                  onOpenAiSettings();
                }}
              >
                <LanguagesIcon />
                <span>{t("aiSettings")}</span>
              </button>

              <button
                type="button"
                className="tb-dropdown-item"
                role="menuitem"
                onClick={() => {
                  setMenuOpen(false);
                  onShowShortcuts();
                }}
              >
                <KeyboardIcon />
                <span>{t("shortcutsTitle")}</span>
              </button>
            </div>
          )}
        </div>

        {fileName && (
          <span className="file-name" title={fileName}>
            {fileName}
          </span>
        )}
      </div>

      {/* 中：翻页 + 页码 + 缩放 + 适应模式（未打开文件时隐藏） */}
      {disabled ? null : (
      <div className="tb-group tb-center">
        <button
          type="button"
          className="tb-btn icon-only"
          onClick={() => onJumpToPage(currentPage - 1)}
          disabled={prevDisabled}
          title={t("prevPage")}
          aria-label={t("prevPage")}
        >
          <ChevronLeftIcon />
        </button>
        <div className="page-indicator">
          <input
            className="page-input"
            value={pageInput}
            disabled={disabled}
            inputMode="numeric"
            placeholder={t("pageJump")}
            aria-label={t("pageJump")}
            onChange={(e) => setPageInput(e.target.value.replace(/[^\d]/g, ""))}
            onBlur={commitPageInput}
            onFocus={(e) => e.target.select()}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                commitPageInput();
                (e.target as HTMLInputElement).blur();
              } else if (e.key === "Escape") {
                setPageInput(String(currentPage));
                (e.target as HTMLInputElement).blur();
              }
            }}
          />
          <span className="page-total">/ {numPages || "–"}</span>
        </div>
        <button
          type="button"
          className="tb-btn icon-only"
          onClick={() => onJumpToPage(currentPage + 1)}
          disabled={nextDisabled}
          title={t("nextPage")}
          aria-label={t("nextPage")}
        >
          <ChevronRightIcon />
        </button>

        {!narrow && (
          <>
            <span className="tb-divider" />

            <button
              type="button"
              className="tb-btn icon-only"
              onClick={onZoomOut}
              disabled={disabled || !canZoomOut}
              title={t("zoomOut")}
              aria-label={t("zoomOut")}
            >
              <MinusIcon />
            </button>
            <div className="zoom-indicator">
              <input
                className="zoom-input"
                value={zoomInput}
                disabled={disabled}
                inputMode="numeric"
                aria-label={t("zoom")}
                title={t("zoom")}
                onChange={(e) => setZoomInput(e.target.value.replace(/[^\d]/g, ""))}
                onBlur={commitZoomInput}
                onFocus={(e) => e.target.select()}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    commitZoomInput();
                    (e.target as HTMLInputElement).blur();
                  } else if (e.key === "Escape") {
                    setZoomInput(String(Math.round(effScale * 100)));
                    (e.target as HTMLInputElement).blur();
                  }
                }}
              />
              <span className="zoom-unit">%</span>
            </div>
            <button
              type="button"
              className="tb-btn icon-only"
              onClick={onZoomIn}
              disabled={disabled || !canZoomIn}
              title={t("zoomIn")}
              aria-label={t("zoomIn")}
            >
              <PlusIcon />
            </button>
            <button
              type="button"
              className="tb-btn icon-only"
              onClick={onToggleFit}
              disabled={disabled}
              title={fitIntent === "fit-width" ? t("fitWidth") : t("fitPage")}
              aria-label={fitIntent === "fit-width" ? t("fitWidth") : t("fitPage")}
            >
              {fitIntent === "fit-width" ? <FitWidthIcon /> : <FitPageIcon />}
            </button>
            <span className="tb-separator" aria-hidden="true" />
            <button
              type="button"
              className="tb-btn icon-only"
              onClick={onOpenSearch}
              title={t("search")}
              aria-label={t("search")}
            >
              <SearchIcon />
            </button>
          </>
        )}

        {/* 全屏时的退出全屏与锁定工具栏按钮：置于查找与更多操作之间
            （原在左侧菜单旁；右上角 Snap Overlay 原生子窗口会吞掉右上角的点击，
            见 global.css .fs-on 段注释，故不放右上角） */}
        {isFullscreen && (
          <button
            type="button"
            className="tb-btn icon-only"
            onClick={onToggleFullscreen}
            title={t("exitFullscreen")}
            aria-label={t("exitFullscreen")}
          >
            <FullscreenExitIcon />
          </button>
        )}

        {isFullscreen && (
          <button
            type="button"
            className="tb-btn icon-only"
            onClick={toggleFsBarPinned}
            title={fsBarPinned ? t("unpinToolbar") : t("pinToolbar")}
            aria-label={fsBarPinned ? t("unpinToolbar") : t("pinToolbar")}
            aria-pressed={fsBarPinned}
          >
            {fsBarPinned ? <PinOffIcon /> : <PinIcon />}
          </button>
        )}

        {/* 更多操作：位于查找按钮右侧；窄屏隐藏缩放控件时，这些功能也收进此菜单 */}
        <div className="tb-menu" ref={moreMenuRef}>
          <button
            type="button"
            className={`tb-btn icon-only ${moreOpen ? "is-open" : ""}`}
            onClick={() => setMoreOpen((v) => !v)}
            title={t("moreActions")}
            aria-label={t("moreActions")}
            aria-haspopup="menu"
            aria-expanded={moreOpen}
          >
            <MoreIcon />
          </button>

          {moreOpen && (
            <div className="tb-dropdown" role="menu">
              {/* 目录侧边栏开关（仅当前文档含目录时提供） */}
              {outlineAvailable && (
                <button
                  type="button"
                  className={`tb-dropdown-item ${sidebarOpen && sidebarTab === "outline" ? "is-active" : ""}`}
                  role="menuitemcheckbox"
                  aria-checked={sidebarOpen && sidebarTab === "outline"}
                  onClick={() => {
                    setMoreOpen(false);
                    onToggleSidebar("outline");
                  }}
                >
                  <ListIcon />
                  <span>{t("toc")}</span>
                  {sidebarOpen && sidebarTab === "outline" && (
                    <span className="tb-item-check">
                      <CheckIcon size={14} />
                    </span>
                  )}
                </button>
              )}

              {/* 页面缩略图侧边栏开关 */}
              <button
                type="button"
                className={`tb-dropdown-item ${sidebarOpen && sidebarTab === "thumbnails" ? "is-active" : ""}`}
                role="menuitemcheckbox"
                aria-checked={sidebarOpen && sidebarTab === "thumbnails"}
                onClick={() => {
                  setMoreOpen(false);
                  onToggleSidebar("thumbnails");
                }}
              >
                <GridIcon />
                <span>{t("thumbnails")}</span>
                {sidebarOpen && sidebarTab === "thumbnails" && (
                  <span className="tb-item-check">
                    <CheckIcon size={14} />
                  </span>
                )}
              </button>

              {/* 书签列表侧边栏开关 */}
              <button
                type="button"
                className={`tb-dropdown-item ${sidebarOpen && sidebarTab === "bookmarks" ? "is-active" : ""}`}
                role="menuitemcheckbox"
                aria-checked={sidebarOpen && sidebarTab === "bookmarks"}
                onClick={() => {
                  setMoreOpen(false);
                  onToggleSidebar("bookmarks");
                }}
              >
                <BookmarkIcon />
                <span>{t("bookmarks")}</span>
                {sidebarOpen && sidebarTab === "bookmarks" && (
                  <span className="tb-item-check">
                    <CheckIcon size={14} />
                  </span>
                )}
              </button>

              {/* 注释列表侧边栏开关 */}
              <button
                type="button"
                className={`tb-dropdown-item ${sidebarOpen && sidebarTab === "annotations" ? "is-active" : ""}`}
                role="menuitemcheckbox"
                aria-checked={sidebarOpen && sidebarTab === "annotations"}
                onClick={() => {
                  setMoreOpen(false);
                  onToggleSidebar("annotations");
                }}
              >
                <AnnotateIcon />
                <span>{t("annotateTools")}</span>
                {sidebarOpen && sidebarTab === "annotations" && (
                  <span className="tb-item-check">
                    <CheckIcon size={14} />
                  </span>
                )}
              </button>

              {/* 添加/移除当前页书签（实心 = 已标记；点击切换） */}
              <button
                type="button"
                className={`tb-dropdown-item ${bookmarkedCurrent ? "is-active" : ""}`}
                role="menuitemcheckbox"
                aria-checked={bookmarkedCurrent}
                onClick={() => {
                  setMoreOpen(false);
                  onToggleBookmark();
                }}
              >
                {bookmarkedCurrent ? <BookmarkFilledIcon /> : <BookmarkPlusIcon />}
                <span>
                  {bookmarkedCurrent ? t("removeBookmark") : t("addBookmark")}
                </span>
              </button>

              {/* 翻译侧边栏开关 */}
              <button
                type="button"
                className={`tb-dropdown-item ${rightPanelOpen ? "is-active" : ""}`}
                role="menuitemcheckbox"
                aria-checked={rightPanelOpen}
                onClick={() => {
                  setMoreOpen(false);
                  onToggleRightPanel();
                }}
              >
                <LanguagesIcon />
                <span>{t("aiSidebar")}</span>
                {rightPanelOpen && (
                  <span className="tb-item-check">
                    <CheckIcon size={14} />
                  </span>
                )}
              </button>

              {/* 自动阅读：播放/暂停（速度在页面底部浮动条调节） */}
              <button
                type="button"
                className={`tb-dropdown-item ${autoPlaying ? "is-active" : ""}`}
                role="menuitemcheckbox"
                aria-checked={autoPlaying}
                onClick={() => onToggleAuto()}
              >
                {autoPlaying ? <PauseIcon /> : <PlayIcon />}
                <span>{autoPlaying ? t("autoScrollPause") : t("autoScroll")}</span>
                {autoPlaying && (
                  <span className="tb-item-check">
                    <CheckIcon size={14} />
                  </span>
                )}
              </button>

              <div className="tb-dropdown-separator" />

              {/* 全屏 */}
              <button
                type="button"
                className="tb-dropdown-item"
                role="menuitem"
                onClick={() => {
                  setMoreOpen(false);
                  onToggleFullscreen();
                }}
              >
                {isFullscreen ? <FullscreenExitIcon /> : <FullscreenIcon />}
                <span>{isFullscreen ? t("exitFullscreen") : t("fullscreen")}</span>
              </button>

              {/* 锁定工具栏：仅全屏时提供（点击后永久固定，不再 auto-hide） */}
              {isFullscreen && (
                <button
                  type="button"
                  className={`tb-dropdown-item ${fsBarPinned ? "is-active" : ""}`}
                  role="menuitemcheckbox"
                  aria-checked={fsBarPinned}
                  onClick={() => {
                    setMoreOpen(false);
                    toggleFsBarPinned();
                  }}
                >
                  {fsBarPinned ? <PinOffIcon /> : <PinIcon />}
                  <span>{fsBarPinned ? t("unpinToolbar") : t("pinToolbar")}</span>
                  {fsBarPinned && (
                    <span className="tb-item-check">
                      <CheckIcon size={14} />
                    </span>
                  )}
                </button>
              )}

              {/* 旋转页面 */}
              <button
                type="button"
                className="tb-dropdown-item"
                role="menuitem"
                onClick={() => {
                  setMoreOpen(false);
                  onRotate();
                }}
              >
                <RotateIcon />
                <span>{t("rotatePage")}</span>
              </button>

              <div className="tb-dropdown-label">{t("pageLayout")}</div>
              <div className="tb-dropdown-row">
                <button
                  type="button"
                  className={`tb-dropdown-choice ${pageLayout === "single" ? "is-active" : ""}`}
                  role="menuitemradio"
                  aria-checked={pageLayout === "single"}
                  onClick={() => onPageLayoutChange("single")}
                >
                  {t("singlePage")}
                </button>
                <button
                  type="button"
                  className={`tb-dropdown-choice ${pageLayout === "double" ? "is-active" : ""}`}
                  role="menuitemradio"
                  aria-checked={pageLayout === "double"}
                  onClick={() => onPageLayoutChange("double")}
                >
                  {t("doublePage")}
                </button>
              </div>

              <div className="tb-dropdown-label">{t("flipMode")}</div>
              <div className="tb-dropdown-row">
                <button
                  type="button"
                  className={`tb-dropdown-choice ${flipMode === "scroll" ? "is-active" : ""}`}
                  role="menuitemradio"
                  aria-checked={flipMode === "scroll"}
                  onClick={() => onFlipModeChange("scroll")}
                >
                  {t("continuous")}
                </button>
                <button
                  type="button"
                  className={`tb-dropdown-choice ${flipMode === "paged" ? "is-active" : ""}`}
                  role="menuitemradio"
                  aria-checked={flipMode === "paged"}
                  onClick={() => onFlipModeChange("paged")}
                >
                  {t("paged")}
                </button>
              </div>

              {/* 窄屏时工具栏隐藏的查找与缩放控件收进这里 */}
              {narrow && (
                <>
                  <div className="tb-dropdown-separator" />

                  <div className="tb-dropdown-label">{t("zoom")}</div>
                  <div className="tb-dropdown-row">
                    <button
                      type="button"
                      className="tb-dropdown-choice"
                      role="menuitem"
                      onClick={onZoomOut}
                      disabled={disabled || !canZoomOut}
                      aria-label={t("zoomOut")}
                      title={t("zoomOut")}
                    >
                      <MinusIcon />
                    </button>
                    <span className="tb-dropdown-value">
                      {Math.round(effScale * 100)}%
                    </span>
                    <button
                      type="button"
                      className="tb-dropdown-choice"
                      role="menuitem"
                      onClick={onZoomIn}
                      disabled={disabled || !canZoomIn}
                      aria-label={t("zoomIn")}
                      title={t("zoomIn")}
                    >
                      <PlusIcon />
                    </button>
                  </div>
                  <div className="tb-dropdown-row">
                    <button
                      type="button"
                      className="tb-dropdown-choice"
                      role="menuitem"
                      onClick={onToggleFit}
                    >
                      {fitIntent === "fit-width" ? t("fitWidth") : t("fitPage")}
                    </button>
                  </div>

                  {/* 查找（窄屏时工具栏按钮隐藏，由这里提供入口，置于菜单最底部） */}
                  <div className="tb-dropdown-separator" />
                  <button
                    type="button"
                    className="tb-dropdown-item"
                    role="menuitem"
                    onClick={() => {
                      setMoreOpen(false);
                      onOpenSearch();
                    }}
                  >
                    <SearchIcon />
                    <span>{t("search")}</span>
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      </div>
      )}

      {/* 右：占位列。窗口控制按钮由 tauri-plugin-frame 注入（Windows 11 原生样式 + Snap Layout） */}
    </header>
      {/* 全屏唤醒探针条：必须紧跟 header 之后（CSS 用相邻兄弟选择器在
          隐藏态启用/显示态禁用）；若放在 header 前面，+ 选择器永不匹配，
          显示态时探针条会以 z-index 30 盖住工具栏（z-index 10）挡住按钮。
          只挂 onPointerEnter（唤醒）—— 绝不能挂 onPointerLeave：探针条在
          唤醒后随 toolbar-hidden 移除而变 pointer-events:none，浏览器会
          因此触发一次「伪 pointerleave」（鼠标未动也触发），若在此调度
          隐藏，工具栏会刚滑入又被隐藏（「鼠标移到顶部工具栏消失」）。 */}
      {isFullscreen && !fsBarPinned && (
        <div
          className="fs-bar-probe"
          onPointerEnter={showFsBar}
          aria-hidden="true"
        />
      )}
    </>
  );
}
