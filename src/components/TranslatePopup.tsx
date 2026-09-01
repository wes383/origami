/**
 * 划词/划句翻译弹层。
 *
 * 交互流程：用户在 PDF 文本层选中内容 → 选区末端浮现「AI 翻译」气泡 →
 * 点击后请求 AI 并展示结果卡片。卡片头部可手动切换「词语释义 / 整句翻译」
 * 模式重新请求（启发式判定误判时的兜底）。
 *
 * 上下文：取选区所在文本层（.pdf-text-layer）的整页文字，以选区为中心
 * 截取窗口后一并送给 AI，由其定位该词在文中的确切含义。
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useI18n } from "../i18n";
import {
  buildContext,
  describeAiError,
  detectMode,
  isAiConfigured,
  loadAiConfig,
  translateSelection,
  type TranslateMode,
  type TranslateResult,
} from "../lib/aiTranslate";
import { LanguagesIcon, XIcon } from "./Icons";

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

const CARD_WIDTH = 380;

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
    top = margin;
    height = Math.min(maxH, rect.y - margin - 10);
  }
  return { left: x, top, maxHeight: Math.max(160, height) };
}

export default function TranslatePopup({
  onOpenSettings,
}: {
  onOpenSettings: () => void;
}) {
  const { t, lang } = useI18n();

  const [bubble, setBubble] = useState<SelectionInfo | null>(null);
  const [card, setCard] = useState<CardState | null>(null);
  const popupRef = useRef<HTMLDivElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  /** 快照式 state 的同步 ref：事件回调里读取最新值，避免闭包过期 */
  const cardRef = useRef<CardState | null>(null);
  cardRef.current = card;
  const bubbleRef = useRef<SelectionInfo | null>(null);
  bubbleRef.current = bubble;

  const closeAll = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setBubble(null);
    setCard(null);
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
      translateSelection({
        config,
        text: info.text,
        context: info.context,
        mode,
        lang,
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
    [closeAll, lang, onOpenSettings]
  );

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
      // 卡片打开时点击卡片外 → 收起整个弹层
      if (cardRef.current) {
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
    // 滚动/缩放后选区矩形失效，直接收起
    const onScrollOrResize = () => {
      if (cardRef.current || bubbleRef.current) closeAll();
    };

    document.addEventListener("pointerup", onPointerUp);
    document.addEventListener("keyup", onKeyUp);
    document.addEventListener("scroll", onScrollOrResize, true);
    window.addEventListener("resize", onScrollOrResize);
    return () => {
      document.removeEventListener("pointerup", onPointerUp);
      document.removeEventListener("keyup", onKeyUp);
      document.removeEventListener("scroll", onScrollOrResize, true);
      window.removeEventListener("resize", onScrollOrResize);
    };
  }, [closeAll, readSelection]);

  // 组件卸载时中止进行中的请求
  useEffect(() => () => abortRef.current?.abort(), []);

  // ---------- 渲染 ----------

  const cardStyle = card ? cardPosition(card.info.rect) : null;

  const errorText = (() => {
    if (!card?.errorDetail) return "";
    const d = card.errorDetail;
    if (d === "network") return t("aiErrorNetwork");
    if (d === "empty") return t("aiErrorEmpty");
    if (d.startsWith("http:401") || d.startsWith("http:403")) return t("aiErrorAuth");
    if (d.startsWith("http:404")) return t("aiErrorNotFound");
    if (d.startsWith("http:429")) return t("aiErrorRateLimit");
    if (d.startsWith("http:")) return `${t("aiErrorHttp")} ${d.slice(5)}`;
    return d;
  })();

  return (
    <div ref={popupRef}>
      {bubble && !card && (
        <button
          type="button"
          className="tr-bubble"
          style={{
            left: bubble.rect.x + bubble.rect.w / 2,
            top: bubble.rect.y + bubble.rect.h + 8,
          }}
          onMouseDown={(e) => e.preventDefault() /* 保住选区不被清掉 */}
          onClick={() => runTranslate(bubble, detectMode(bubble.text))}
          title={t("aiTranslate")}
        >
          <LanguagesIcon size={13} />
          <span>{t("aiTranslate")}</span>
        </button>
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
                      {card.result.phonetic && (
                        <span className="tr-phonetic">{card.result.phonetic}</span>
                      )}
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
    </div>
  );
}
