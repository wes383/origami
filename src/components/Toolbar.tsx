import { useEffect, useRef, useState } from "react";
import { useI18n, type Lang } from "../i18n";
import type { ThemePref } from "../hooks/useTheme";
import type { ViewMode } from "./PdfViewer";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  DocIcon,
  FitPageIcon,
  FitWidthIcon,
  LanguagesIcon,
  MinusIcon,
  PlusIcon,
  SettingsIcon,
  XIcon,
} from "./Icons";

/** ≤此宽度时隐藏工具栏缩放控件（改由设置菜单提供） */
const ZOOM_HIDDEN_BELOW = 560;

interface ToolbarProps {
  fileName: string;
  numPages: number;
  currentPage: number;
  onJumpToPage: (page: number) => void;
  viewMode: ViewMode;
  onViewModeChange: (mode: ViewMode) => void;
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
  disabled: boolean;
}

export default function Toolbar({
  fileName,
  numPages,
  currentPage,
  onJumpToPage,
  viewMode,
  onViewModeChange,
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
  disabled,
}: ToolbarProps) {
  const { t, lang, setLang } = useI18n();
  const [pageInput, setPageInput] = useState(String(currentPage));
  const [zoomInput, setZoomInput] = useState(String(Math.round(effScale * 100)));
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
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

  const switchLang = (next: Lang) => setLang(next);

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
              )}

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

              <div className="tb-dropdown-separator" />

              <div className="tb-dropdown-label">{t("viewMode")}</div>
              <div className="tb-dropdown-row">
                <button
                  type="button"
                  className={`tb-dropdown-choice ${viewMode === "single" ? "is-active" : ""}`}
                  role="menuitemradio"
                  aria-checked={viewMode === "single"}
                  onClick={() => onViewModeChange("single")}
                >
                  {t("singlePage")}
                </button>
                <button
                  type="button"
                  className={`tb-dropdown-choice ${viewMode === "continuous" ? "is-active" : ""}`}
                  role="menuitemradio"
                  aria-checked={viewMode === "continuous"}
                  onClick={() => onViewModeChange("continuous")}
                >
                  {t("continuous")}
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
              <div className="tb-dropdown-row">
                <button
                  type="button"
                  className={`tb-dropdown-choice ${lang === "zh" ? "is-active" : ""}`}
                  role="menuitemradio"
                  aria-checked={lang === "zh"}
                  onClick={() => switchLang("zh")}
                >
                  中文
                </button>
                <button
                  type="button"
                  className={`tb-dropdown-choice ${lang === "en" ? "is-active" : ""}`}
                  role="menuitemradio"
                  aria-checked={lang === "en"}
                  onClick={() => switchLang("en")}
                >
                  English
                </button>
              </div>

              <div className="tb-dropdown-separator" />

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
          </>
        )}
      </div>
      )}

      {/* 右：占位列。窗口控制按钮由 tauri-plugin-frame 注入（Windows 11 原生样式 + Snap Layout） */}
    </header>
  );
}
