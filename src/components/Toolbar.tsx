import { useEffect, useRef, useState } from "react";
import { useI18n, UI_LANGS } from "../i18n";
import type { ThemePref } from "../hooks/useTheme";
import type { PageLayout, FlipMode } from "./PdfViewer";
import {
  CheckIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  DocIcon,
  FitPageIcon,
  FitWidthIcon,
  GridIcon,
  LanguagesIcon,
  ListIcon,
  MinusIcon,
  PlusIcon,
  PrinterIcon,
  RotateIcon,
  SearchIcon,
  SettingsIcon,
  XIcon,
} from "./Icons";
import type { SidebarTab } from "./Sidebar";

/** ≤此宽度时隐藏工具栏缩放控件（改由设置菜单提供） */
const ZOOM_HIDDEN_BELOW = 560;

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
  onOpen: () => void;
  /** 关闭当前文件，回到引导页 */
  onCloseFile: () => void;
  /** 打开 AI 翻译设置弹窗 */
  onOpenAiSettings: () => void;
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
  disabled: boolean;
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
  onOpen,
  onCloseFile,
  onOpenAiSettings,
  onOpenSearch,
  outlineAvailable,
  sidebarOpen,
  sidebarTab,
  onToggleSidebar,
  disabled,
}: ToolbarProps) {
  const { t, lang, setLang } = useI18n();
  const [pageInput, setPageInput] = useState(String(currentPage));
  const [zoomInput, setZoomInput] = useState(String(Math.round(effScale * 100)));
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  /** 语言二级菜单（向右 flyout） */
  const [langMenuOpen, setLangMenuOpen] = useState(false);
  const langWrapRef = useRef<HTMLDivElement | null>(null);
  /** ≤560px 时工具栏缩放控件隐藏，改由设置菜单提供 */
  const [narrow, setNarrow] = useState(
    () => window.innerWidth <= ZOOM_HIDDEN_BELOW
  );

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
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
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

  // 语言二级菜单：点击其外部（含设置菜单内其他区域）即关闭
  useEffect(() => {
    if (!langMenuOpen) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!langWrapRef.current?.contains(e.target as Node))
        setLangMenuOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () =>
      document.removeEventListener("pointerdown", onPointerDown);
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
    // 右上角窗口按钮由 tauri-plugin-frame 注入（z-index 100 层，浮于工具栏之上）
    <header
      className={`toolbar ${disabled ? "no-center" : ""}`}
      data-tauri-drag-region
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
            <div className="tb-dropdown tb-dropdown-left" role="menu">
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
                </>
              )}

              {!disabled && (
                <>
                  <div className="tb-dropdown-separator" />

                  {/* 目录侧边栏开关（仅当前文档含目录时提供） */}
                  {outlineAvailable && (
                    <button
                      type="button"
                      className={`tb-dropdown-item ${sidebarOpen && sidebarTab === "outline" ? "is-active" : ""}`}
                      role="menuitemcheckbox"
                      aria-checked={sidebarOpen && sidebarTab === "outline"}
                      onClick={() => {
                        setMenuOpen(false);
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
                      setMenuOpen(false);
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

                  <div className="tb-dropdown-separator" />
                </>
              )}

              {!disabled && (
                <button
                  type="button"
                  className="tb-dropdown-item"
                  role="menuitem"
                  onClick={() => {
                    setMenuOpen(false);
                    onRotate();
                  }}
                >
                  <RotateIcon />
                  <span>{t("rotatePage")}</span>
                </button>
              )}

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
                {langMenuOpen && (
                  <div className="tb-lang-menu" role="menu">
                    {UI_LANGS.map((l) => (
                      <button
                        key={l.id}
                        type="button"
                        className={`tb-lang-item ${lang === l.id ? "is-active" : ""}`}
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
                )}
              </div>

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
      </div>
      )}

      {/* 右：占位列。窗口控制按钮由 tauri-plugin-frame 注入（Windows 11 原生样式 + Snap Layout） */}
    </header>
  );
}
