/**
 * 划词/划句翻译弹层（浮动态）。
 *
 * 职责：监听 PDF 文本层选区 → 浮现「复制 / AI 翻译 / Wikipedia」气泡；
 * 点击按钮或快捷键（T / W）发起请求。具体的请求与结果状态由
 * useTextActionEngine 统一管理，这里只负责「浮动」这一呈现渠道。
 *
 * 与右侧面板的联动：
 *   - 若右侧面板已打开且处于 translate tab，选中文本后翻译结果直接进面板，
 *     气泡不再显示「AI 翻译」按钮（其余按钮照常）。
 *   - 若右侧面板已打开且处于 wikipedia tab，Wikipedia 结果直接进面板，
 *     气泡不再显示「Wikipedia」按钮。
 * 其余情况行为不变：气泡三个按钮齐全，结果以浮动卡片呈现。
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useI18n } from "../i18n";
import { detectMode, buildContext } from "../lib/aiTranslate";
import { CopyIcon, GlobeIcon, LanguagesIcon } from "./Icons";
import { TranslateCardView, WikiCardView } from "./TranslateCards";
import type {
  SelectionInfo,
  TextActionEngine,
  RightPanelState,
} from "../hooks/useTextActionEngine";

interface BubbleInfo {
  text: string;
  context: string;
  /** 选区矩形（viewport 坐标，px） */
  rect: { x: number; y: number; w: number; h: number };
}

/** 气泡组估算尺寸（水平 clamp 用，实际宽度随文案略有出入） */
const BUBBLE_W = 300;
const BUBBLE_H = 30;

/** 复制文本到剪贴板（优先 Clipboard API，失败回退 execCommand） */
async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      ta.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

/** 气泡定位：优先选区下方，底部空间不足时翻到选区上方；水平 clamp 到视口内 */
function bubblePosition(rect: BubbleInfo["rect"]) {
  const margin = 8;
  const cx = rect.x + rect.w / 2;
  const left = Math.max(
    BUBBLE_W / 2 + margin,
    Math.min(cx, window.innerWidth - BUBBLE_W / 2 - margin)
  );
  const below = rect.y + rect.h + margin;
  const top =
    below + BUBBLE_H + margin <= window.innerHeight
      ? below
      : Math.max(margin, rect.y - BUBBLE_H - margin);
  return { left, top };
}

export default function TranslatePopup({
  engine,
  rightPanel,
}: {
  engine: TextActionEngine;
  rightPanel: RightPanelState;
}) {
  const { t } = useI18n();

  const [bubble, setBubble] = useState<BubbleInfo | null>(null);
  const popupRef = useRef<HTMLDivElement | null>(null);

  // 快照式 state 的同步 ref：事件回调里读取最新值，避免闭包过期
  const bubbleRef = useRef<BubbleInfo | null>(null);
  bubbleRef.current = bubble;
  const floatingCardRef = useRef(engine.floatingCard);
  floatingCardRef.current = engine.floatingCard;
  const floatingWikiRef = useRef(engine.floatingWiki);
  floatingWikiRef.current = engine.floatingWiki;
  /** 上次已处理选区的文本签名：仅「新选区」才路由进面板，避免旧选区重复触发请求 */
  const lastSelRef = useRef<string>("");

  const closeAll = useCallback(() => {
    engine.closeAll();
    setBubble(null);
  }, [engine.closeAll]);

  // ---------- 选区监听 ----------

  /** 从 pointerup/keyup 事件里提取文本层选区 */
  const readSelection = useCallback((): SelectionInfo | null => {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null;
    const range = selection.getRangeAt(0);
    const text = selection.toString().replace(/\u00a0/g, " ").trim();
    if (!text || text.length > 3000) return null;
    const startNode =
      range.startContainer.nodeType === Node.TEXT_NODE
        ? range.startContainer.parentElement
        : (range.startContainer as HTMLElement | null);
    const layer = startNode?.closest?.(".pdf-text-layer");
    if (!layer) return null;
    const rect = range.getBoundingClientRect();
    if (!rect || (rect.width === 0 && rect.height === 0)) return null;
    return {
      text,
      context: buildContext(layer.textContent ?? "", text),
      rect: { x: rect.left, y: rect.top, w: rect.width, h: rect.height },
    };
  }, []);

  useEffect(() => {
    const inPopup = (target: EventTarget | null) =>
      popupRef.current?.contains(target as Node) ?? false;

    const onPointerUp = (e: PointerEvent) => {
      if (inPopup(e.target)) return;
      // 卡片/Wikipedia 弹层打开时点击外部 → 收起整个浮动弹层
      if (floatingCardRef.current || floatingWikiRef.current) {
        closeAll();
        return;
      }
      const info = readSelection();
      if (!info) {
        lastSelRef.current = "";
        return;
      }
      // 仅对「新选区」路由到面板：避免面板内点击（如切换模型按钮）因选区仍在
      // 而反复触发重新翻译/查询（表现为「闪烁重新加载」）
      const isNewSelection = info.text !== lastSelRef.current;
      if (isNewSelection) {
        if (rightPanel.open && rightPanel.tab === "translate") {
          engine.runTranslate(info, detectMode(info.text));
        } else if (rightPanel.open && rightPanel.tab === "wikipedia") {
          engine.runWiki(info);
        }
      }
      lastSelRef.current = info.text;
      setBubble(info);
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        closeAll();
        return;
      }
      if (inPopup(e.target)) return;
      if (e.shiftKey || e.key === "a" || e.key === "A") {
        setBubble(readSelection());
      }
    };
    // 滚动不再收起弹层（保持翻译结果可见）；仅窗口缩放后选区矩形失效才收起
    const onResize = () => {
      if (floatingCardRef.current || bubbleRef.current || floatingWikiRef.current)
        closeAll();
    };
    // 滚动页面：气泡 fixed 定位跟随选区，滚动后选区矩形失效 → 收起气泡；
    // 已打开的结果卡片保持可见（用户既定行为）；弹层内部滚动（卡片内容）不触发
    const onScroll = (e: Event) => {
      if (inPopup(e.target)) return;
      if (bubbleRef.current) setBubble(null);
    };
    // 单击选中文本内部时，Chromium 要等 mouseup 的默认行为才折叠选区，
    // pointerup 先读到旧选区导致气泡残留；这里监听选区折叠并兜底收起。
    const onSelectionChange = () => {
      const selection = window.getSelection();
      if (selection && !selection.isCollapsed && selection.rangeCount > 0) return;
      // 选区已折叠 → 旧选区签名作废，下次重新划词才算「新选区」
      lastSelRef.current = "";
      if (bubbleRef.current && !floatingCardRef.current) setBubble(null);
    };

    document.addEventListener("pointerup", onPointerUp);
    document.addEventListener("keyup", onKeyUp);
    document.addEventListener("selectionchange", onSelectionChange);
    document.addEventListener("scroll", onScroll, true); // 捕获阶段：读到 PDF 阅读区等所有滚动
    window.addEventListener("resize", onResize);
    return () => {
      document.removeEventListener("pointerup", onPointerUp);
      document.removeEventListener("keyup", onKeyUp);
      document.removeEventListener("selectionchange", onSelectionChange);
      document.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onResize);
    };
  }, [closeAll, readSelection, engine.runTranslate, engine.runWiki, rightPanel.open, rightPanel.tab]);

  // 划词快捷键：选中 PDF 文本后按 T 触发 AI 翻译、按 W 搜索 Wikipedia
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      // 仅裸键（无 Ctrl/Alt/Shift 修饰）；输入框内不触发
      if (e.ctrlKey || e.altKey || e.shiftKey) return;
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable)
      )
        return;
      const key = e.key.toLowerCase();
      if (key !== "t" && key !== "w") return;
      // 优先用已显示的选区气泡，否则实时读取 PDF 文本层选区
      const info = bubbleRef.current ?? readSelection();
      if (!info) return;
      e.preventDefault();
      // 路由交给引擎：面板开在对应 tab 时结果直接进面板
      if (key === "t") engine.runTranslate(info, detectMode(info.text));
      else engine.runWiki(info);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [engine.runTranslate, engine.runWiki, readSelection]);

  // 组件卸载时中止进行中的请求（依赖稳定的 engine.closeAll，避免每帧重渲染触发清理而清空卡片）
  useEffect(() => () => engine.closeAll(), [engine.closeAll]);

  // ---------- 渲染 ----------

  const hideTranslateBtn = rightPanel.open && rightPanel.tab === "translate";
  const hideWikiBtn = rightPanel.open && rightPanel.tab === "wikipedia";

  const floatingCard = engine.floatingCard;
  const floatingWiki = engine.floatingWiki;

  return (
    <div ref={popupRef}>
      {bubble && !floatingCard && !floatingWiki && (
        <div
          className="tr-bubble-group"
          style={bubblePosition(bubble.rect)}
          onMouseDown={(e) => e.preventDefault() /* 保住选区不被清掉 */}
        >
          <button
            type="button"
            className="tr-bubble"
            title={t("copy")}
            onClick={() => {
              void copyText(bubble.text);
              setBubble(null);
            }}
          >
            <CopyIcon size={13} />
            <span>{t("copy")}</span>
          </button>
          {!hideTranslateBtn && (
            <button
              type="button"
              className="tr-bubble"
              onClick={() => engine.runTranslate(bubble, detectMode(bubble.text))}
            >
              <LanguagesIcon size={13} />
              <span>{t("aiTranslate")}</span>
            </button>
          )}
          {!hideWikiBtn && (
            <button
              type="button"
              className="tr-bubble"
              onClick={() => engine.runWiki(bubble)}
            >
              <GlobeIcon size={13} />
              <span>Wikipedia</span>
            </button>
          )}
        </div>
      )}

      {floatingCard && (
        <TranslateCardView
          card={floatingCard}
          variant="floating"
          onModeChange={(mode) =>
            engine.runTranslate(floatingCard.info, mode, "floating")
          }
          onRetry={() => engine.retryTranslate()}
          onClose={() => engine.closeFloatingCard()}
          onSwitchModel={(id) => engine.switchModel(id)}
        />
      )}

      {floatingWiki && (
        <WikiCardView
          wiki={floatingWiki}
          variant="floating"
          onRetry={() => engine.retryWiki()}
          onClose={() => engine.closeFloatingWiki()}
          onOpenLink={() => engine.handleOpenWiki()}
        />
      )}
    </div>
  );
}
