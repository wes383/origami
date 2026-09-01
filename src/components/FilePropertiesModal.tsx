/**
 * 文件属性弹窗 — 展示当前 PDF 的详细元数据列表（越详细越好）。
 *
 * 数据来源：
 * - 同步：文件名 / 完整路径 / 页数 / 文件大小（App 传入），
 *   doc.isEncrypted / doc.isPureXfa / doc.fingerprint（pdfjs 文档属性）；
 * - 异步 getMetadata()：PDFInfo 全部常用字段
 *   （PDF 版本 / 线性化 / 标题 / 作者 / 主题 / 关键词 / 创建者 / 生成程序 /
 *   创建·修改时间 / 陷印标记 / AcroForm / XFA / 文件集合 / 签名）+ 自定义属性；
 * - 异步 getAttachments() / getJavaScript()：附件数 / 嵌入脚本数。
 * 字段缺失时跳过该行，不显示占位。
 */

import { useEffect, useState } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { useI18n, type LangKeys } from "../i18n";
import { XIcon } from "./Icons";

interface Props {
  doc: PDFDocumentProxy;
  fileName: string;
  /** 文件完整路径 */
  filePath: string;
  numPages: number;
  fileSize: number;
  onClose: () => void;
}

interface RowDef {
  labelKey: LangKeys;
  value: string;
}

/** pdfjs v6 的 getMetadata().info 类型为 Object，这里声明用到的字段 */
interface PdfInfoLike {
  PDFFormatVersion?: string;
  /** 非 null 表示文档被加密（v6 中 doc.isEncrypted 已移除） */
  EncryptFilterName?: string | null;
  IsLinearized?: boolean;
  IsAcroFormPresent?: boolean;
  IsXFAPresent?: boolean;
  IsCollectionPresent?: boolean;
  IsSignaturesPresent?: boolean;
  Title?: string;
  Author?: string;
  Subject?: string;
  Keywords?: string;
  Creator?: string;
  Producer?: string;
  CreationDate?: string;
  ModDate?: string;
  /** 从 worker 传回的 Name 对象（{ name: "True" | "False" | "Unknown" }） */
  Trapped?: { name: string };
  Custom?: Record<string, string>;
}

/** PDF 日期字符串（D:YYYYMMDDHHmmSSOHH'mm' 或 …Z）→ Date；无法解析返回 null */
function parsePdfDate(s: string | undefined): Date | null {
  if (!s) return null;
  const m = s.match(/^D?:?(\d{4})(\d{2})?(\d{2})?(\d{2})?(\d{2})?(\d{2})?/);
  if (!m) return null;
  const [, y, mo = "01", d = "01", h = "00", mi = "00", se = "00"] = m;
  const date = new Date(
    Number(y),
    Number(mo) - 1,
    Number(d),
    Number(h),
    Number(mi),
    Number(se)
  );
  return Number.isNaN(date.getTime()) ? null : date;
}

const DATE_FMT = new Intl.DateTimeFormat(undefined, {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

/** 字节数 → 人类可读大小 */
function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) return "—";
  if (n < 1024) return `${n} B`;
  const kb = n / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  return `${(kb / 1024).toFixed(2)} MB`;
}

export default function FilePropertiesModal({
  doc,
  fileName,
  filePath,
  numPages,
  fileSize,
  onClose,
}: Props) {
  const { t } = useI18n();
  const [rows, setRows] = useState<RowDef[]>([]);
  const [attachCount, setAttachCount] = useState<number | null>(null);
  const [custom, setCustom] = useState<Record<string, string> | null>(null);

  useEffect(() => {
    let cancelled = false;
    // 同步可得的基础行
    const base: RowDef[] = [
      { labelKey: "fpFileName", value: fileName },
      { labelKey: "fpPath", value: filePath },
      { labelKey: "fpPages", value: String(numPages) },
      { labelKey: "fpSize", value: formatBytes(fileSize) },
      { labelKey: "fpPureXfa", value: doc.isPureXfa ? t("fpYes") : t("fpNo") },
    ];
    const fingerprint = doc.fingerprints[0];
    if (fingerprint) {
      base.push({ labelKey: "fpFingerprint", value: fingerprint });
    }
    setRows(base);

    // getMetadata：追加 PDFInfo 字段（布尔缺失时跳过）
    void doc
      .getMetadata()
      .then(({ info }) => {
        if (cancelled) return;
        const meta = info as PdfInfoLike;
        const extra: RowDef[] = [];
        const boolKey = (v: boolean | undefined, k: LangKeys) => {
          if (typeof v !== "boolean") return;
          extra.push({ labelKey: k, value: v ? t("fpYes") : t("fpNo") });
        };
        // v6 用 EncryptFilterName 是否为 null 判断加密
        if (typeof meta.EncryptFilterName === "string") {
          extra.push({ labelKey: "fpEncrypted", value: t("fpYes") });
        } else if (meta.EncryptFilterName === null) {
          extra.push({ labelKey: "fpEncrypted", value: t("fpNo") });
        }
        boolKey(meta.IsLinearized, "fpLinearized");
        if (meta.PDFFormatVersion && meta.PDFFormatVersion.trim()) {
          extra.push({ labelKey: "fpVersion", value: meta.PDFFormatVersion.trim() });
        }
        const text: Record<string, string | undefined> = {
          fpTitle: meta.Title,
          fpAuthor: meta.Author,
          fpSubject: meta.Subject,
          fpKeywords: meta.Keywords,
          fpCreator: meta.Creator,
          fpProducer: meta.Producer,
        };
        for (const [key, val] of Object.entries(text)) {
          if (val && val.trim()) {
            extra.push({ labelKey: key as LangKeys, value: val.trim() });
          }
        }
        const created = parsePdfDate(meta.CreationDate);
        const modified = parsePdfDate(meta.ModDate);
        if (created) {
          extra.push({ labelKey: "fpCreated", value: DATE_FMT.format(created) });
        }
        if (modified) {
          extra.push({ labelKey: "fpModified", value: DATE_FMT.format(modified) });
        }
        const trapped = meta.Trapped?.name;
        if (trapped) {
          const map: Record<string, string> = {
            True: t("fpYes"),
            False: t("fpNo"),
            Unknown: t("fpUnknown"),
          };
          extra.push({
            labelKey: "fpTrapped",
            value: map[trapped] ?? trapped,
          });
        }
        boolKey(meta.IsAcroFormPresent, "fpAcroForm");
        boolKey(meta.IsXFAPresent, "fpXfa");
        boolKey(meta.IsCollectionPresent, "fpCollection");
        boolKey(meta.IsSignaturesPresent, "fpSignatures");
        if (meta.Custom && Object.keys(meta.Custom).length > 0) {
          setCustom(meta.Custom);
        }
        if (!cancelled) setRows([...base, ...extra]);
      })
      .catch(() => {
        /* 元数据读取失败：保留基础行 */
      });

    // 附件数量（v6 已移除 getJavaScript，故不再统计嵌入脚本数）
    void doc
      .getAttachments()
      .then((a) => {
        if (!cancelled) setAttachCount(a ? Object.keys(a).length : 0);
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [doc, fileName, filePath, numPages, fileSize, t]);

  // Esc 关闭
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div
      className="tr-modal-overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="tr-modal fp-modal" role="dialog" aria-label={t("fileProperties")}>
        <header className="tr-modal-head">
          <h3>{t("fileProperties")}</h3>
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

        <div className="fp-body">
          {rows.length === 0 ? (
            <div className="fp-loading">{t("fpLoading")}</div>
          ) : (
            <>
              <dl className="fp-list">
                {rows.map((row) => (
                  <div className="fp-row" key={row.labelKey}>
                    <dt>{t(row.labelKey)}</dt>
                    <dd>{row.value}</dd>
                  </div>
                ))}
                {attachCount !== null && (
                  <div className="fp-row">
                    <dt>{t("fpAttachments")}</dt>
                    <dd>{attachCount}</dd>
                  </div>
                )}
              </dl>

              {custom && Object.keys(custom).length > 0 && (
                <div className="fp-group">
                  <div className="fp-group-title">{t("fpCustom")}</div>
                  {Object.entries(custom).map(([key, value]) => (
                    <div className="fp-row" key={key}>
                      <dt>{key}</dt>
                      <dd>{value}</dd>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
