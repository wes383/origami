/**
 * 加密文档密码输入弹窗。
 *
 * pdf.js 在打开加密 PDF 时回调请求密码；密码错误会再次回调。
 * 这里只负责收密码，取到后交给调用方回传给 pdf.js。
 */

import { useEffect, useRef, useState } from "react";
import { useI18n } from "../i18n";
import { DocIcon } from "./Icons";

interface PasswordDialogProps {
  /** 上一轮密码错误 → 显示错误提示 */
  wrong: boolean;
  onSubmit: (password: string) => void;
  onCancel: () => void;
}

export default function PasswordDialog({
  wrong,
  onSubmit,
  onCancel,
}: PasswordDialogProps) {
  const { t } = useI18n();
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);

  // 每次弹出（含密码错误后重新弹出）聚焦并清空输入
  useEffect(() => {
    setValue("");
    inputRef.current?.focus();
  }, []);

  // 密码错误后清空输入，便于重输
  useEffect(() => {
    if (wrong) setValue("");
  }, [wrong]);

  return (
    <div
      className="tr-modal-overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div
        className="tr-modal password-dialog"
        role="dialog"
        aria-label={t("pdfPasswordTitle")}
      >
        <header className="tr-modal-head">
          <h3>{t("pdfPasswordTitle")}</h3>
        </header>

        <div className="tr-form">
          <p className="password-desc">
            {wrong ? t("pdfPasswordWrong") : t("pdfPasswordDesc")}
          </p>
          <label className="tr-field">
            <span>{t("pdfPasswordPlaceholder")}</span>
            <input
              ref={inputRef}
              type="password"
              value={value}
              spellCheck={false}
              autoComplete="off"
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  onSubmit(value);
                } else if (e.key === "Escape") {
                  e.preventDefault();
                  onCancel();
                }
              }}
            />
          </label>

          <div className="tr-form-actions">
            <div className="tr-form-actions-spacer" />
            <button type="button" className="tr-btn-secondary" onClick={onCancel}>
              {t("cancel")}
            </button>
            <button
              type="button"
              className="tr-btn-primary"
              onClick={() => onSubmit(value)}
              disabled={value.length === 0}
            >
              <DocIcon size={14} />
              {t("pdfPasswordOpen")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
