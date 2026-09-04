import { Fragment, useEffect } from "react";
import { useI18n, type LangKeys } from "../i18n";
import { XIcon } from "./Icons";

interface Props {
  onClose: () => void;
}

interface Row {
  keys: string;
  descKey: LangKeys;
  /** 划词类快捷键（选中文本后可用）提示 */
  selection?: boolean;
}

const ROWS: Row[] = [
  { keys: "Ctrl + O", descKey: "openPdf" },
  { keys: "Ctrl + P", descKey: "print" },
  { keys: "Ctrl + F", descKey: "search" },
  { keys: "Ctrl + \\", descKey: "shortcutSidebar" },
  { keys: "Ctrl + T", descKey: "shortcutTranslateSidebar" },
  { keys: "←", descKey: "prevPage" },
  { keys: "→", descKey: "nextPage" },
  { keys: "␣", descKey: "autoScrollSpace" },
  { keys: "Ctrl + +", descKey: "zoomIn" },
  { keys: "Ctrl + -", descKey: "zoomOut" },
  { keys: "Ctrl + 0", descKey: "shortcutZoomReset" },
  { keys: "R", descKey: "rotatePage" },
  { keys: "F", descKey: "shortcutFit" },
  { keys: "T", descKey: "aiTranslate", selection: true },
  { keys: "W", descKey: "shortcutWikipedia", selection: true },
  { keys: "S", descKey: "shortcutSummary", selection: true },
  { keys: "H", descKey: "annotateHighlight", selection: true },
  { keys: "U", descKey: "annotateUnderline", selection: true },
  { keys: "D", descKey: "annotateStrikeout", selection: true },
  { keys: "N", descKey: "annotateNote", selection: true },
  { keys: "F11", descKey: "shortcutFullscreen" },
  { keys: "Esc", descKey: "exitFullscreen" },
  { keys: "?", descKey: "shortcutHelp" },
];

export default function ShortcutsHelp({ onClose }: Props) {
  const { t } = useI18n();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="tr-modal-overlay" onMouseDown={onClose}>
      <div
        className="tr-modal sc-modal"
        onMouseDown={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={t("shortcutsTitle")}
      >
        <div className="tr-modal-head">
          <h3>{t("shortcutsTitle")}</h3>
          <button
            type="button"
            className="tr-modal-close"
            onClick={onClose}
            aria-label={t("aiClose")}
          >
            <XIcon size={15} />
          </button>
        </div>
        <div className="sc-body">
          {ROWS.map((row, i) => (
            <div className="sc-row" key={i}>
              <span className="sc-keys">
                {row.keys.split(" + ").map((k, i, arr) => (
                  <Fragment key={i}>
                    <kbd>{k}</kbd>
                    {i < arr.length - 1 && <span className="sc-plus">+</span>}
                  </Fragment>
                ))}
              </span>
              <span className="sc-desc">{t(row.descKey)}</span>
              {row.selection && (
                <span className="sc-tag">{t("shortcutSelectionHint")}</span>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
