/**
 * 划词/划句翻译弹层。
 *
 * 交互流程：用户在 PDF 文本层选中内容 → 选区末端浮现「AI 翻译」气泡 →
 * 点击后请求 AI 并展示结果卡片。卡片头部可手动切换「词语释义 / 整句翻译」
 * 模式重新请求（启发式判定误判时的兜底），也可切换当前模型档案。
 * 翻译目标语言在 AI 设置弹窗里配置（见 AiSettingsModal），这里读取即可。
 *
 * 上下文：取选区所在文本层（.pdf-text-layer）的整页文字，以选区为中心
 * 截取窗口后一并送给 AI，由其定位该词在文中的确切含义。
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useI18n } from "../i18n";
import {
  buildContext,
  describeAiError,
  detectMode,
  getActiveProfile,
  isAiConfigured,
  loadAiConfig,
  loadTargetLang,
  saveAiConfig,
  TARGET_AUTO,
  translateSelection,
  type TranslateMode,
  type TranslateResult,
} from "../lib/aiTranslate";
import {
  fetchWikipediaSummary,
  wikiLang,
  type WikiResult,
} from "../lib/wikipedia";
import {
  ChevronDownIcon,
  CopyIcon,
  GlobeIcon,
  LanguagesIcon,
  XIcon,
} from "./Icons";

interface SelectionInfo {
  text: string;
  context: string;
  /** 选区矩形（viewport 坐标，px） */
  rect: { x: number; y: number; w: number; h: number };
}

type CardState = {
  info: SelectionInfo;
  mode: TranslateMode;
  status: "loading" | "done" | "error";
  result: TranslateResult | null;
  errorDetail: string | null;
};

type WikiCardState = {
  info: SelectionInfo;
  status: "loading" | "done" | "error";
  result: WikiResult | null;
  /** 错误码：not-found | empty | network | http:<status> */
  errorDetail: string | null;
};

const CARD_WIDTH = 380;

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

/** 气泡组估算尺寸（水平 clamp 用，实际宽度随文案略有出入） */
const BUBBLE_W = 300;
const BUBBLE_H = 30;

/** 气泡定位：优先选区下方，底部空间不足时翻到选区上方；水平 clamp 到视口内 */
function bubblePosition(rect: SelectionInfo["rect"]) {
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

/** 结果卡片定位：优先选区下方，空间不足放上方；水平 clamp 到视口内 */
function cardPosition(rect: SelectionInfo["rect"]) {
  const margin = 12;
  let x = rect.x + rect.w / 2 - CARD_WIDTH / 2;
  x = Math.max(margin, Math.min(x, window.innerWidth - CARD_WIDTH - margin));
  const below = rect.y + rect.h + 10;
  const maxH = 460;
  let top: number;
  let height: number;
  if (below + 200 <= window.innerHeight - margin) {
    top = below;
    height = Math.min(maxH, window.innerHeight - top - margin);
  } else {
    // 下方空间不足：卡片放选区上方，底部贴选区上方 10px 展开；
    // 只有视口高度实在放不下 maxH 时才退回贴顶（top = margin）
    const above = rect.y - 10;
    top = Math.max(margin, above - maxH);
    height = Math.min(maxH, above - margin);
  }
  return { left: x, top, maxHeight: Math.max(160, height) };
}

export default function TranslatePopup({
  onOpenSettings,
}: {
  onOpenSettings: () => void;
}) {
  const { t, lang: uiLang } = useI18n();

  const [bubble, setBubble] = useState<SelectionInfo | null>(null);
  const [card, setCard] = useState<CardState | null>(null);
  const [wiki, setWiki] = useState<WikiCardState | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const popupRef = useRef<HTMLDivElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  /** 快照式 state 的同步 ref：事件回调里读取最新值，避免闭包过期 */
  const cardRef = useRef<CardState | null>(null);
  cardRef.current = card;
  const wikiRef = useRef<WikiCardState | null>(null);
  wikiRef.current = wiki;
  const bubbleRef = useRef<SelectionInfo | null>(null);
  bubbleRef.current = bubble;

  const closeAll = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setBubble(null);
    setCard(null);
    setWiki(null);
    setMenuOpen(false);
  }, []);

  // ---------- 发起翻译请求 ----------

  const runTranslate = useCallback(
    (info: SelectionInfo, mode: TranslateMode) => {
      abortRef.current?.abort();
      const config = loadAiConfig();
      if (!isAiConfigured(config)) {
        closeAll();
        onOpenSettings();
        return;
      }
      const ac = new AbortController();
      abortRef.current = ac;
      setCard({ info, mode, status: "loading", result: null, errorDetail: null });
      // 目标语言在 AI 设置弹窗里配置；「跟随界面语言」时直接解析为当前 UI 语言
      //（UI 语言 10 种与 TARGET_LANGS 一一对应）
      const raw = loadTargetLang();
      const target = raw === TARGET_AUTO ? uiLang : raw;
      translateSelection({
        config,
        text: info.text,
        context: info.context,
        mode,
        lang: target,
        signal: ac.signal,
      })
        .then((result) => {
          if (ac.signal.aborted) return;
          setCard({ info, mode, status: "done", result, errorDetail: null });
        })
        .catch((err) => {
          if (ac.signal.aborted) return;
          const detail = describeAiError(err);
          setCard({ info, mode, status: "error", result: null, errorDetail: detail });
        });
    },
    [closeAll, onOpenSettings, uiLang]
  );

  // ---------- 发起 Wikipedia 名词解释请求 ----------

  const runWiki = useCallback(
    (info: SelectionInfo) => {
      abortRef.current?.abort();
      const ac = new AbortController();
      abortRef.current = ac;
      setBubble(null);
      setCard(null);
      setWiki({ info, status: "loading", result: null, errorDetail: null });
      fetchWikipediaSummary(info.text, wikiLang(uiLang), ac.signal)
        .then((result) => {
          if (ac.signal.aborted) return;
          setWiki({ info, status: "done", result, errorDetail: null });
        })
        .catch((err) => {
          if (ac.signal.aborted) return;
          const detail =
            err instanceof Error && err.message ? err.message : "network";
          setWiki({ info, status: "error", result: null, errorDetail: detail });
        });
    },
    [uiLang]
  );

  /** 用系统默认浏览器打开条目（Tauri opener 插件；非 Tauri 环境回退 window.open） */
  const handleOpenWiki = useCallback(async () => {
    const url = wikiRef.current?.result?.url;
    if (!url) return;
    try {
      await openUrl(url);
    } catch {
      window.open(url, "_blank", "noopener,noreferrer");
    }
  }, []);

  // ---------- 模型切换（结果卡片头部下拉） ----------

  const config = loadAiConfig();
  const activeProfile = getActiveProfile(config);

  /** 切换选用档案并立即用新模型重新翻译 */
  const switchModel = useCallback(
    (id: string) => {
      setMenuOpen(false);
      const cfg = loadAiConfig();
      if (cfg.activeId === id) return;
      saveAiConfig({ ...cfg, activeId: id });
      const cur = cardRef.current;
      if (cur) runTranslate(cur.info, cur.mode);
    },
    [runTranslate]
  );

  // 下拉菜单点击外部关闭
  useEffect(() => {
    if (!menuOpen) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [menuOpen]);

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
      // 卡片/Wikipedia 弹层打开时点击外部 → 收起整个弹层
      if (cardRef.current || wikiRef.current) {
        closeAll();
        return;
      }
      const info = readSelection();
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
      if (cardRef.current || bubbleRef.current || wikiRef.current) closeAll();
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
      if (bubbleRef.current && !cardRef.current) setBubble(null);
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
  }, [closeAll, readSelection]);

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
      if (key === "t") runTranslate(info, detectMode(info.text));
      else runWiki(info);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [runTranslate, runWiki, readSelection]);

// 组件卸载时中止进行中的请求
  useEffect(() => () => abortRef.current?.abort(), []);

  // ---------- 渲染 ----------

  const cardStyle = card ? cardPosition(card.info.rect) : null;

  const errorText = (() => {
    if (!card?.errorDetail) return "";
    const d = card.errorDetail;
    if (d === "network") return t("aiErrorNetwork");
    if (d === "empty") return t("aiErrorEmpty");
    if (d === "no-model") return t("aiErrorNoModel");
    if (d.startsWith("http:401") || d.startsWith("http:403")) return t("aiErrorAuth");
    if (d.startsWith("http:404")) return t("aiErrorNotFound");
    if (d.startsWith("http:429")) return t("aiErrorRateLimit");
    if (d.startsWith("http:")) return `${t("aiErrorHttp")} ${d.slice(5)}`;
    return d;
  })();

  const wikiErrorText = (() => {
    if (!wiki?.errorDetail) return "";
    const d = wiki.errorDetail;
    if (d === "not-found") return t("wikiNotFound");
    if (d === "empty") return t("wikiEmpty");
    if (d === "network") return t("aiErrorNetwork");
    if (d.startsWith("http:")) return `${t("aiErrorHttp")} ${d.slice(5)}`;
    return d;
  })();

  return (
    <div ref={popupRef}>
      {bubble && !card && !wiki && (
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
          <button
            type="button"
            className="tr-bubble"
            onClick={() => runTranslate(bubble, detectMode(bubble.text))}
          >
            <LanguagesIcon size={13} />
            <span>{t("aiTranslate")}</span>
          </button>
          <button
            type="button"
            className="tr-bubble"
            onClick={() => runWiki(bubble)}
          >
            <GlobeIcon size={13} />
            <span>Wikipedia</span>
          </button>
        </div>
      )}

      {card && cardStyle && (
        <div
          className="tr-card"
          style={{
            left: cardStyle.left,
            top: cardStyle.top,
            maxHeight: cardStyle.maxHeight,
          }}
          role="dialog"
          aria-label={t("aiTranslate")}
        >
          <div className="tr-card-header">
            <div className="tr-mode-switch">
              <button
                type="button"
                className={`tr-mode-btn ${card.mode === "word" ? "is-active" : ""}`}
                onClick={() => runTranslate(card.info, "word")}
              >
                {t("aiModeWord")}
              </button>
              <button
                type="button"
                className={`tr-mode-btn ${card.mode === "sentence" ? "is-active" : ""}`}
                onClick={() => runTranslate(card.info, "sentence")}
              >
                {t("aiModeSentence")}
              </button>
            </div>
            <div className="tr-spacer" />
            {activeProfile && (
              <div className="tr-chip-wrap" ref={menuRef}>
                <button
                  type="button"
                  className="tr-model-chip"
                  onClick={() => setMenuOpen((v) => !v)}
                  title={t("aiSwitchModel")}
                >
                  <span>{activeProfile.name}</span>
                  <ChevronDownIcon size={12} />
                </button>
                {menuOpen && (
                  <div className="tr-model-menu" role="menu">
                    {config.profiles.map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        className={`tr-model-menu-item ${p.id === activeProfile.id ? "is-active" : ""}`}
                        role="menuitem"
                        onClick={() => switchModel(p.id)}
                      >
                        <span className="tr-model-dot" aria-hidden="true" />
                        <span className="tr-profile-name">{p.name}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
            <button
              type="button"
              className="tr-close"
              onClick={closeAll}
              aria-label={t("aiClose")}
            >
              <XIcon size={14} />
            </button>
          </div>

          <div className="tr-card-body">
            {card.status === "loading" && (
              <div className="tr-loading">
                <span className="spinner" />
                <span>{t("aiLoading")}</span>
              </div>
            )}

            {card.status === "error" && (
              <div className="tr-error">
                <p>{errorText || t("aiErrorRequest")}</p>
                <button
                  type="button"
                  className="tr-retry"
                  onClick={() => runTranslate(card.info, card.mode)}
                >
                  {t("aiRetry")}
                </button>
              </div>
            )}

            {card.status === "done" && card.result && (
              <>
                {card.result.mode === "sentence" ? (
                  card.result.translation !== undefined ? (
                    <>
                      <p className="tr-original">{card.info.text}</p>
                      <p className="tr-translation">{card.result.translation}</p>
                    </>
                  ) : (
                    <p className="tr-raw">{card.result.raw}</p>
                  )
                ) : (
                  <>
                    <div className="tr-word-head">
                      <span className="tr-word">{card.result.query ?? card.info.text}</span>
                    </div>
                    {card.result.contextMeaning && (
                      <section className="tr-section">
                        <h4>{t("aiInContext")}</h4>
                        <p className="tr-context-meaning">{card.result.contextMeaning}</p>
                      </section>
                    )}
                    {card.result.senses && card.result.senses.length > 0 && (
                      <section className="tr-section">
                        <h4>{t("aiSenses")}</h4>
                        <ul className="tr-senses">
                          {card.result.senses.map((sense, i) => (
                            <li key={i}>
                              {sense.pos && <span className="tr-pos">{sense.pos}</span>}
                              <span>{sense.meaning}</span>
                            </li>
                          ))}
                        </ul>
                      </section>
                    )}
                    {!card.result.contextMeaning &&
                      (!card.result.senses || card.result.senses.length === 0) && (
                        <p className="tr-raw">{card.result.raw}</p>
                      )}
                  </>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {wiki && (
        <div
          className="tr-card"
          style={cardPosition(wiki.info.rect)}
          role="dialog"
          aria-label="Wikipedia"
        >
          <div className="tr-card-header">
            {wiki.status === "done" && wiki.result && (
              <h3 className="tr-wiki-head-title" title={wiki.result.title}>
                {wiki.result.title}
              </h3>
            )}
            <div className="tr-spacer" />
            <button
              type="button"
              className="tr-close"
              onClick={closeAll}
              aria-label={t("aiClose")}
            >
              <XIcon size={14} />
            </button>
          </div>

          <div className="tr-card-body">
            {wiki.status === "loading" && (
              <div className="tr-loading">
                <span className="spinner" />
                <span>{t("wikiLoading")}</span>
              </div>
            )}

            {wiki.status === "error" && (
              <div className="tr-error">
                <p>{wikiErrorText || t("aiErrorRequest")}</p>
                <button
                  type="button"
                  className="tr-retry"
                  onClick={() => runWiki(wiki.info)}
                >
                  {t("aiRetry")}
                </button>
              </div>
            )}

            {wiki.status === "done" && wiki.result && (
              <div className="tr-wiki-content">
                {wiki.result.thumbnail && (
                  <img
                    className="tr-wiki-thumb"
                    src={wiki.result.thumbnail}
                    alt=""
                  />
                )}
                <p className="tr-wiki-extract">{wiki.result.extract}</p>
                <div className="tr-wiki-actions">
                  <button
                    type="button"
                    className="tr-wiki-link"
                    onClick={handleOpenWiki}
                  >
                    {t("wikiOpen")}
                  </button>
                  <p className="tr-wiki-license">{wiki.result.license}</p>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
