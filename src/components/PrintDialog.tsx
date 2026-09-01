/**
 * 打印对话框 — 选择页码范围后调起系统打印。
 * 全部页 / 当前页 / 自定义范围（"1-3, 5, 8-10"）三种模式，
 * 确认后由父组件执行渲染（此处只负责收集范围）。
 */

import { useEffect, useRef, useState } from "react";
import { useI18n } from "../i18n";
import { parsePageRanges } from "../lib/print";
import { PrinterIcon, XIcon } from "./Icons";

type RangeMode = "all" | "current" | "custom";

interface PrintDialogProps {
  numPages: number;
  currentPage: number;
  /** 用户确认范围后回调，参数为升序页码数组 */
  onConfirm: (pages: number[]) => void;
  onClose: () => void;
}

export default function PrintDialog({
  numPages,
  currentPage,
  onConfirm,
  onClose,
}: PrintDialogProps) {
  const { t } = useI18n();
  const [mode, setMode] = useState<RangeMode>("all");
  const [customInput, setCustomInput] = useState("1-" + numPages);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const customPages = parsePageRanges(customInput, numPages);

  const confirm = () => {
    if (mode === "all") {
      onConfirm(Array.from({ length: numPages }, (_, i) => i + 1));
    } else if (mode === "current") {
      onConfirm([currentPage]);
    } else {
      if (customPages.length === 0) {
        // 范围非法时聚焦输入框提示修改
        inputRef.current?.focus();
        return;
      }
      onConfirm(customPages);
    }
  };

  return (
    <div
      className="tr-modal-overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="tr-modal print-dialog" role="dialog" aria-label={t("print")}>
        <header className="tr-modal-head">
          <h3>{t("print")}</h3>
          <button
            type="button"
            className="tr-modal-close"
            onClick={onClose}
            aria-label={t("aiClose")}
            title={t("aiClose")}
          >
            <XIcon size={14} />
          </button>
        </header>

        <div className="print-range">
          {(
            [
              ["all", `${t("printAll")} (1-${numPages})`],
              ["current", `${t("printCurrent")} (${currentPage})`],
              ["custom", t("printCustom")],
            ] as [RangeMode, string][]
          ).map(([value, label]) => (
            <label key={value} className={`print-range-item ${mode === value ? "is-active" : ""}`}>
              <input
                type="radio"
                name="print-range"
                checked={mode === value}
                onChange={() => setMode(value)}
              />
              <span>{label}</span>
            </label>
          ))}
        </div>

        {mode === "custom" && (
          <label className="tr-field print-custom-field">
            <span>{t("printRangeHint")}</span>
            <input
              ref={inputRef}
              type="text"
              value={customInput}
              spellCheck={false}
              placeholder="1-3, 5, 8-10"
              onChange={(e) => setCustomInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  confirm();
                }
              }}
            />
            {customInput.trim() && customPages.length === 0 && (
              <p className="print-range-invalid">{t("printRangeInvalid")}</p>
            )}
          </label>
        )}

        <div className="tr-form-actions">
          <span className="print-page-count">
            {mode === "all"
              ? t("printPageCount").replace("{n}", String(numPages))
              : mode === "current"
                ? t("printPageCount").replace("{n}", "1")
                : customPages.length > 0
                  ? t("printPageCount").replace("{n}", String(customPages.length))
                  : ""}
          </span>
          <div className="tr-form-actions-spacer" />
          <button type="button" className="tr-btn-secondary" onClick={onClose}>
            {t("aiCancel")}
          </button>
          <button
            type="button"
            className="tr-btn-primary"
            onClick={confirm}
            disabled={mode === "custom" && customPages.length === 0}
          >
            <PrinterIcon size={14} />
            {t("print")}
          </button>
        </div>
      </div>
    </div>
  );
}
