/**
 * 划词/划句翻译弹层（浮动态）。
 *
 * 职责：监听 PDF 文本层选区 → 浮现「复制 / AI 翻译 / Wikipedia / 注释」气泡；
 * 注释为统一入口：点击后在按钮下方展开高亮/下划线/删除线/文字批注四工具菜单。
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
import {
  ANNO_COLORS,
  ANNO_GEOM_TYPES,
  annoInk,
  annoMarkColor,
  loadLastColors,
  saveLastColor,
  type AnnotationType,
  type AnnoGeomType,
} from "../lib/annotations";
import {
  captureSelectionRects,
  type CaptureSelection,
} from "../lib/textLayerSelection";
import {
  AnnotateIcon,
  CheckIcon,
  ChevronDownIcon,
  CopyIcon,
  FileTextIcon,
  GlobeIcon,
  HighlighterIcon,
  LanguagesIcon,
  StickyNoteIcon,
  StrikethroughIcon,
  UnderlineIcon,
} from "./Icons";
import {
  SummaryCardView,
  TranslateCardView,
  WikiCardView,
} from "./TranslateCards";
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

/** 气泡组估算尺寸（水平 clamp 用，实际宽度随文案略有出入）。
    单行气泡：复制 / AI 翻译 / (Wikipedia | AI 总结) / 注释工具 四按钮 ——
    词级选区显示 Wikipedia，句子/段落级长文本显示 AI 总结（互斥替换）；
    注释菜单为绝对定位弹出，不占气泡高度。多语言长文案下最宽约 520px，
    取 560 保守估算防贴边选区时误判偏移 */
const BUBBLE_W = 560;
const BUBBLE_H = 36;
/** 注释工具菜单估算高：4 个动作项 + 分隔线 + 底部三大类型常驻色板，用于上下翻转判定 */
const ANNO_MENU_H = 230;

/**
 * Wikipedia 是否适用于当前选区：它走 opensearch 按「名词/短语」查条目标题，
 * 句子/段落级长文本几乎必然查不到条目。判据复用 detectMode 的「词 vs 句」分界
 * （CJK ≤20 字、拉丁 ≤8 词且无句末标点 = 词级）；词级才可用 Wikipedia。
 * 三处入口（气泡按钮 / 快捷键 W / 右侧 Wikipedia 面板自动查询）统一收口。
 */
const wikiQueryable = (text: string) => detectMode(text) === "word";

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

/** 把视口坐标矩形裁剪到视口内（跨页超长选区的联合矩形常远超视口） */
function clampToViewport(r: {
  left: number;
  top: number;
  right: number;
  bottom: number;
}): BubbleInfo["rect"] {
  const x = Math.max(r.left, 0);
  const y = Math.max(r.top, 0);
  const w = Math.min(r.right, window.innerWidth) - x;
  const h = Math.min(r.bottom, window.innerHeight) - y;
  return { x, y, w, h };
}

export default function TranslatePopup({
  engine,
  rightPanel,
  onAnnotate,
}: {
  engine: TextActionEngine;
  rightPanel: RightPanelState;
  /** 在选区上创建注释：kind + 归一化矩形捕获 + 锚点（视口坐标，供批注浮层定位）；
      color 为几何类注释的自定义落笔色（6 位 hex），缺省用类型默认色 */
  onAnnotate: (
    type: AnnotationType,
    cap: CaptureSelection,
    anchor: { x: number; y: number },
    color?: string
  ) => void;
}) {
  const { t } = useI18n();

  const [bubble, setBubble] = useState<BubbleInfo | null>(null);
  /** 注释工具菜单是否展开（统一入口按钮 → 下方弹出菜单） */
  const [annoOpen, setAnnoOpen] = useState(false);
  /** 各几何类型最近一次使用的落笔色（持久化记忆；首启回退类型默认色）。
      底部色板据此给对应色块加对勾标注；上方标题行点击用它直接创建 */
  const [lastColors, setLastColors] = useState<Record<AnnoGeomType, string>>(
    loadLastColors
  );
  const popupRef = useRef<HTMLDivElement | null>(null);

  // 快照式 state 的同步 ref：事件回调里读取最新值，避免闭包过期
  const bubbleRef = useRef<BubbleInfo | null>(null);
  bubbleRef.current = bubble;
  const annoOpenRef = useRef(false);
  annoOpenRef.current = annoOpen;
  const floatingCardRef = useRef(engine.floatingCard);
  floatingCardRef.current = engine.floatingCard;
  const floatingWikiRef = useRef(engine.floatingWiki);
  floatingWikiRef.current = engine.floatingWiki;
  const floatingSummaryRef = useRef(engine.floatingSummary);
  floatingSummaryRef.current = engine.floatingSummary;
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
    // 只挡住病态选区（如 Ctrl+A 全选整本大文档）：正常跨页长选区（几千~几万字，
    // 正是 AI 总结的目标场景）必须放行，超限由各 AI 动作自行处理
    if (!text || text.length > 50000) return null;
    const startNode =
      range.startContainer.nodeType === Node.TEXT_NODE
        ? range.startContainer.parentElement
        : (range.startContainer as HTMLElement | null);
    const layer = startNode?.closest?.(".pdf-text-layer");
    if (!layer) return null;
    const rect = range.getBoundingClientRect();
    if (!rect || (rect.width === 0 && rect.height === 0)) return null;
    // 跨页超长选区：联合矩形可远超视口（顶部为负、底边超出、高度数屏），
    // 直接定位会把气泡/卡片甩出屏幕或钉在远端。矩形超出视口时改锚到选区
    // 末行（range 端点所在行 = 松手/起手处，总在收尾时附近）；末行盒无效
    // （落在 endOfContent 等无内容元素上）则退回裁剪后的联合矩形。
    let anchor = clampToViewport(rect);
    if (rect.top < 0 || rect.bottom > window.innerHeight) {
      const endEl =
        range.endContainer.nodeType === Node.TEXT_NODE
          ? range.endContainer.parentElement
          : (range.endContainer as HTMLElement | null);
      const endBox = endEl?.getBoundingClientRect();
      if (endBox && endBox.width > 0 && endBox.height > 0) {
        const er = clampToViewport(endBox);
        if (er.w > 0 && er.h > 0 && er.h <= window.innerHeight * 0.5) anchor = er;
      }
    }
    return {
      text,
      context: buildContext(layer.textContent ?? "", text),
      rect: anchor,
    };
  }, []);

  useEffect(() => {
    const inPopup = (target: EventTarget | null) =>
      popupRef.current?.contains(target as Node) ?? false;

    const onPointerUp = (e: PointerEvent) => {
      // 点击弹层外任意处：先收起注释工具菜单（气泡自身行为由下方逻辑决定）
      if (!inPopup(e.target)) setAnnoOpen(false);
      if (inPopup(e.target)) return;
      // 卡片/Wikipedia 弹层打开时点击外部 → 收起整个浮动弹层
      if (
        floatingCardRef.current ||
        floatingWikiRef.current ||
        floatingSummaryRef.current
      ) {
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
          // 句子级长文本不做 Wikipedia 查询（与气泡按钮隐藏策略一致）
          if (wikiQueryable(info.text)) engine.runWiki(info);
        } else if (rightPanel.open && rightPanel.tab === "summary") {
          // 仅句子级长文本适合总结（词/短语直接给 AI 翻译）
          if (!wikiQueryable(info.text)) engine.runSummarize(info);
        }
      }
      lastSelRef.current = info.text;
      setBubble(info);
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        // 注释菜单开着：Esc 先收菜单；气泡本身交给下层（下次 Esc 收气泡）
        if (annoOpenRef.current) {
          setAnnoOpen(false);
          return;
        }
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
      if (
        floatingCardRef.current ||
        bubbleRef.current ||
        floatingWikiRef.current ||
        floatingSummaryRef.current
      )
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
      // W = Wikipedia 词/短语查询：句子级长文本忽略按键（与按钮隐藏策略一致）
      else if (wikiQueryable(info.text)) engine.runWiki(info);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [engine.runTranslate, engine.runWiki, readSelection]);

  // 组件卸载时中止进行中的请求（依赖稳定的 engine.closeAll，避免每帧重渲染触发清理而清空卡片）
  useEffect(() => () => engine.closeAll(), [engine.closeAll]);

  // 气泡关闭/换选区时，收起注释工具菜单（滚动、点外部、执行注释等都会使 bubble 置空）
  useEffect(() => {
    if (!bubble) setAnnoOpen(false);
  }, [bubble]);

  /**
   * 在气泡可见的选区上创建注释：捕获归一化几何 → 回调宿主落盘 → 收起气泡并
   * 清除选区。清选区是为了避免同一段文字残留高亮、同一选区被再次点按钮误加。
   * color 为几何类注释的自定义落笔色；不传则用类型默认色。
   */
  const annotate = useCallback(
    (type: AnnotationType, color?: string) => {
      const info = bubbleRef.current;
      if (!info) return;
      const cap = captureSelectionRects();
      if (!cap) return;
      setBubble(null);
      lastSelRef.current = "";
      window.getSelection()?.removeAllRanges();
      onAnnotate(type, cap, { x: info.rect.x, y: info.rect.y }, color);
    },
    [onAnnotate]
  );

  /**
   * 创建注释的统一入口：几何类指定/沿用颜色并记忆该色；note 不涉及颜色。
   * - 一级菜单项点击（不传 color）→ 用该类型「最近一次使用」的颜色直接创建；
   * - 色板点击（传 color）→ 用所选色创建，并更新记忆（色板对勾随之移动）。
   */
  const commitAnno = useCallback(
    (type: AnnotationType, color?: string) => {
      if (type === "note") {
        annotate("note");
        return;
      }
      const resolved = color ?? lastColors[type];
      if (resolved !== lastColors[type]) {
        saveLastColor(type, resolved);
        setLastColors((prev) => ({ ...prev, [type]: resolved }));
      }
      annotate(type, resolved);
    },
    [annotate, lastColors]
  );

  /** 底部色板点击：仅为该类型「选色」——记忆所选色并移动对勾，
      不创建注释、菜单保持展开（动作等用户点上方标题行触发） */
  const selectColor = useCallback(
    (type: AnnoGeomType, hex: string) => {
      if (lastColors[type] === hex) return;
      saveLastColor(type, hex);
      setLastColors((prev) => ({ ...prev, [type]: hex }));
    },
    [lastColors]
  );

  // ---------- 渲染 ----------

  const hideTranslateBtn = rightPanel.open && rightPanel.tab === "translate";
  // Wikipedia 仅适用于词/短语级选区：句子/段落级长文本隐藏按钮（与 W 键/面板路由同判据）
  const hideWikiBtn =
    (rightPanel.open && rightPanel.tab === "wikipedia") ||
    (bubble ? !wikiQueryable(bubble.text) : false);
  // AI 总结与 Wikipedia 互斥：句子/段落级长文本才显示（词/短语级无总结意义）；
  // 右侧面板开在 summary tab 时结果已分流进面板，气泡隐藏该按钮
  const showSummaryBtn = bubble
    ? !wikiQueryable(bubble.text) &&
      !(rightPanel.open && rightPanel.tab === "summary")
    : false;

  const floatingCard = engine.floatingCard;
  const floatingWiki = engine.floatingWiki;
  const floatingSummary = engine.floatingSummary;
  // 菜单展开方向：气泡组下方放不下时改为向上弹出
  const groupPos =
    bubble && !floatingCard && !floatingWiki && !floatingSummary
      ? bubblePosition(bubble.rect)
      : null;
  const annoMenuUp = groupPos
    ? groupPos.top + BUBBLE_H + 6 + ANNO_MENU_H > window.innerHeight
    : false;

  return (
    <div ref={popupRef}>
      {bubble && !floatingCard && !floatingWiki && !floatingSummary && (
        <div
          className="tr-bubble-group"
          style={groupPos!}
          onMouseDown={(e) => e.preventDefault() /* 保住选区不被清掉 */}
        >
          <div className="tr-bubble-row">
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
          {/* AI 总结：长文本（句子/段落级）选区显示，与 Wikipedia 互斥替换 */}
          {showSummaryBtn && (
            <button
              type="button"
              className="tr-bubble"
              onClick={() => engine.runSummarize(bubble)}
            >
              <FileTextIcon size={13} />
              <span>{t("aiSummarize")}</span>
            </button>
          )}
          {/* 注释统一入口：Wikipedia 右侧，点击展开四工具菜单（与右侧面板无关，恒显示） */}
          <div className="tr-anno">
            <button
              type="button"
              className={`tr-anno-btn ${annoOpen ? "is-open" : ""}`}
              title={t("annotateTools")}
              aria-label={t("annotateTools")}
              aria-haspopup="menu"
              aria-expanded={annoOpen}
              onClick={() => setAnnoOpen((v) => !v)}
            >
              <AnnotateIcon size={14} />
              <span>{t("annotateTools")}</span>
              <span className="tr-anno-caret">
                <ChevronDownIcon size={10} />
              </span>
            </button>
            {annoOpen && (
              <div
                className={`tr-anno-menu ${annoMenuUp ? "is-up" : ""}`}
                role="menu"
                aria-label={t("annotateTools")}
              >
                {/* 动作区：点击标题行 = 以该类型当前选中色（底部色板勾选）直接创建 */}
                {ANNO_GEOM_TYPES.map((type) => (
                  <button
                    key={type}
                    type="button"
                    role="menuitem"
                    className={`tr-anno-item is-${type}`}
                    onClick={() => {
                      setAnnoOpen(false);
                      commitAnno(type);
                    }}
                  >
                    {/* 图标颜色跟随该类型当前选中色（浅色压暗保证可读） */}
                    <span
                      className="tr-anno-ic"
                      style={{ color: annoInk(lastColors[type]) }}
                    >
                      {type === "highlight" && <HighlighterIcon size={14} />}
                      {type === "underline" && <UnderlineIcon size={14} />}
                      {type === "strikeout" && <StrikethroughIcon size={14} />}
                    </span>
                    <span className="tr-anno-label">
                      {type === "highlight" && t("annotateHighlight")}
                      {type === "underline" && t("annotateUnderline")}
                      {type === "strikeout" && t("annotateStrikeout")}
                    </span>
                  </button>
                ))}
                <button
                  type="button"
                  role="menuitem"
                  className="tr-anno-item is-note"
                  onClick={() => {
                    setAnnoOpen(false);
                    annotate("note");
                  }}
                >
                  <span className="tr-anno-ic">
                    <StickyNoteIcon size={14} />
                  </span>
                  <span className="tr-anno-label">{t("annotateNote")}</span>
                </button>

                <div className="tr-anno-divider" role="separator" />

                {/* 底部统一色板：三大类型全部候选色常驻并排、分别选择。
                    仅用于选色（点色块 = 该类型当前色，带对勾记忆），
                    执行动作请点上方对应标题行 */}
                <div className="tr-anno-palette" role="presentation">
                  {ANNO_GEOM_TYPES.map((type) => (
                    <div key={type} className="tr-anno-pal-row">
                      <span
                        className={`tr-anno-pal-ic is-${type}`}
                        title={
                          type === "highlight"
                            ? t("annotateHighlight")
                            : type === "underline"
                              ? t("annotateUnderline")
                              : t("annotateStrikeout")
                        }
                        style={{ color: annoInk(lastColors[type]) }}
                      >
                        {type === "highlight" && <HighlighterIcon size={14} />}
                        {type === "underline" && <UnderlineIcon size={14} />}
                        {type === "strikeout" && <StrikethroughIcon size={14} />}
                      </span>
                      <div
                        className="tr-anno-pal-swatches"
                        onPointerDown={(e) => e.preventDefault() /* 保住选区 */}
                      >
                        {ANNO_COLORS[type].map((hex) => {
                          const isLast = lastColors[type] === hex;
                          return (
                            <button
                              key={hex}
                              type="button"
                              className={`tr-anno-swatch${isLast ? " is-last" : ""}`}
                              style={{
                                background: hex,
                                ...(isLast ? { color: annoMarkColor(hex) } : {}),
                              }}
                              title={hex}
                              aria-label={hex}
                              aria-pressed={isLast}
                              onClick={() => selectColor(type, hex)}
                            >
                              {isLast && <CheckIcon size={11} />}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
          </div>
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
      {floatingSummary && (
        <SummaryCardView
          card={floatingSummary}
          variant="floating"
          onRetry={() => engine.retrySummarize()}
          onClose={() => engine.closeFloatingSummary()}
          onSwitchModel={(id) => engine.switchModel(id)}
        />
      )}
    </div>
  );
}
