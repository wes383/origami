/**
 * 注释管理浮层（点击页面上注释 chip 弹出）。
 *
 * 呈现单条注释：类型 + 页码头部、选中文本摘录；note 类型提供正文编辑
 * （textarea，Ctrl/Cmd+Enter 或「保存」按钮提交）；所有类型提供删除。
 * 自包含交互：Esc / 点击浮层外部关闭；删除或保存后由宿主关闭本层。
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "../i18n";
import {
  ANNO_COLORS,
  ANNO_DEFAULT_COLOR,
  annoIconTone,
  annoMarkColor,
  type Annotation,
  type AnnotationType,
  type AnnoGeomType,
} from "../lib/annotations";
import {
  CheckIcon,
  HighlighterIcon,
  StickyNoteIcon,
  StrikethroughIcon,
  TrashIcon,
  UnderlineIcon,
  XIcon,
} from "./Icons";

const POP_W = 300;

export default function AnnotationPopup({
  ann,
  x,
  y,
  focusNote,
  onSaveNote,
  onRecolor,
  onDelete,
  onClose,
}: {
  ann: Annotation;
  /** 打开时的视口坐标（chip 或选区锚点） */
  x: number;
  y: number;
  /** 新建批注时自动聚焦输入框 */
  focusNote?: boolean;
  onSaveNote: (id: string, note: string) => void;
  /** 修改几何注释落笔色（note 类型不触发） */
  onRecolor: (id: string, color: string) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const rootRef = useRef<HTMLDivElement | null>(null);
  /** 批注草稿；按 ann.id 重建（换一条注释不残留上一条草稿） */
  const [draft, setDraft] = useState(ann.note);
  useEffect(() => {
    setDraft(ann.note);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ann.id]);

  const typeName = (type: AnnotationType): string => {
    switch (type) {
      case "highlight":
        return t("annotateHighlight");
      case "underline":
        return t("annotateUnderline");
      case "strikeout":
        return t("annotateStrikeout");
      case "note":
        return t("annotateNote");
    }
  };
  const typeIcon = (type: AnnotationType, size = 13) => {
    switch (type) {
      case "highlight":
        return <HighlighterIcon size={size} />;
      case "underline":
        return <UnderlineIcon size={size} />;
      case "strikeout":
        return <StrikethroughIcon size={size} />;
      case "note":
        return <StickyNoteIcon size={size} />;
    }
  };

  /** 几何类注释：当前落笔色（旧数据无 color → 类型默认色）；note 无颜色概念为 null */
  const geom = ann.type === "note" ? null : (ann.type as AnnoGeomType);
  const curColor = geom ? (ann.color ?? ANNO_DEFAULT_COLOR[geom]) : null;
  /** 头部图标 chip 配色：几何类跟随当前落笔色（icon=压暗 ink、底=同色 tint），
      换色后即时同步；note 无颜色概念 → null，走原 CSS 琥珀观感 */
  const icTone = geom && curColor ? annoIconTone(curColor) : null;

  const pos = useMemo(() => {
    const margin = 10;
    const left = Math.max(
      margin,
      Math.min(x - POP_W / 2, window.innerWidth - POP_W - margin)
    );
    const below = y + 12;
    // 高度估算（含最长 96px 可滚动摘录）：note 含输入区、几何含换色色板行
    const estH = ann.type === "note" ? 300 : 260;
    const top =
      below + estH <= window.innerHeight
        ? below
        : Math.max(margin, y - estH - 12);
    return { left, top };
  }, [ann.type, x, y]);

  // Esc 关闭（与其余浮层惯例一致）
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  // 点击浮层外部关闭（内部点击放行）
  useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) onClose();
    };
    // 捕获阶段：在 chip 的点击冒泡触发新的 onAnnoOpen 之前，旧浮层先收起来
    document.addEventListener("pointerdown", onPointerDown, true);
    return () =>
      document.removeEventListener("pointerdown", onPointerDown, true);
  }, [onClose]);

  const dirty = draft !== ann.note;
  const save = () => {
    if (dirty) onSaveNote(ann.id, draft);
    onClose();
  };

  return (
    <div
      ref={rootRef}
      className={`anp is-${ann.type}`}
      style={{ left: pos.left, top: pos.top, width: POP_W }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div className="anp-head">
        <span
          className="anp-ic"
          style={icTone ?? undefined}
        >
          {typeIcon(ann.type)}
        </span>
        <span className="anp-title">{typeName(ann.type)}</span>
        <span className="anp-page">
          {t("bookmarkDefaultLabel").replace("{n}", String(ann.page))}
        </span>
        <button
          type="button"
          className="anp-x"
          onClick={onClose}
          title={t("cancel")}
          aria-label={t("cancel")}
        >
          <XIcon size={13} />
        </button>
      </div>
      {ann.text && <div className="anp-snippet">{ann.text}</div>}
      {ann.type === "note" ? (
        <textarea
          className="anp-note"
          autoFocus={focusNote}
          value={draft}
          placeholder={t("annotateNotePlaceholder")}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
              e.preventDefault();
              save();
            }
            e.stopPropagation();
          }}
        />
      ) : (
        // 几何类注释：换色色板行（当前色带对勾，点击即改色，页面矩形即时预览）；
        // 行尾右对齐 icon 版删除按钮
        geom && curColor && (
          <div className="anp-swatches" role="group" aria-label="color">
            {ANNO_COLORS[geom].map((hex) => {
              const active = curColor === hex;
              return (
                <button
                  key={hex}
                  type="button"
                  className={`anp-swatch${active ? " is-active" : ""}`}
                  style={{
                    background: hex,
                    ...(active ? { color: annoMarkColor(hex) } : {}),
                  }}
                  title={hex}
                  aria-label={hex}
                  aria-pressed={active}
                  onClick={() => onRecolor(ann.id, hex)}
                >
                  {active && <CheckIcon size={11} />}
                </button>
              );
            })}
            <button
              type="button"
              className="anp-del"
              title={t("annotateDelete")}
              aria-label={t("annotateDelete")}
              onClick={() => onDelete(ann.id)}
            >
              <TrashIcon size={14} />
            </button>
          </div>
        )
      )}
      {ann.type === "note" && (
        <div className="anp-foot">
          <button
            type="button"
            className="anp-del"
            title={t("annotateDelete")}
            aria-label={t("annotateDelete")}
            onClick={() => onDelete(ann.id)}
          >
            <TrashIcon size={14} />
          </button>
          <button
            type="button"
            className="anp-save"
            disabled={!dirty}
            onClick={save}
          >
            {t("annotateSave")}
          </button>
        </div>
      )}
    </div>
  );
}
