/**
 * 翻译结果卡片 / Wikipedia 结果卡片的「展示层」。
 *
 * 同一套渲染同时服务于两处：
 *   - 浮动卡片（选中文本后浮现，variant="floating"，绝对定位）
 *   - 右侧面板（variant="panel"，静态填满面板宽度，随面板滚动）
 *
 * 面板态不再使用 `.tr-card` 弹窗壳：内容直接作为侧栏内部区域渲染，
 * 去掉关闭按钮、弹窗 surface/边框/阴影/圆角，避免「把浮窗塞进侧栏」的观感。
 *
 * 行为（切模式 / 重试 / 切换模型 / 打开链接 / 关闭）通过 props 回调上抛，
 * 由调用方（TranslatePopup 或 RightPanel）对接引擎。模型切换菜单的开关状态
 * 在组件内部维护，并自带点击外部关闭。
 */

import { useEffect, useRef, useState } from "react";
import { useI18n } from "../i18n";
import {
  getActiveProfile,
  loadAiConfig,
  type TranslateMode,
} from "../lib/aiTranslate";
import { ChevronDownIcon, XIcon } from "./Icons";
import type {
  CardState,
  SummaryCardState,
  WikiCardState,
} from "../hooks/useTextActionEngine";

const CARD_WIDTH = 380;

/** 结果卡片定位：优先选区下方，空间不足放上方；水平 clamp 到视口内 */
function cardPosition(rect: { x: number; y: number; w: number; h: number }) {
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
    const above = rect.y - 10;
    const availAbove = above - margin;
    if (availAbove >= 160) {
      // 下方不足但上方空间足够：卡片占满上方区域、底边贴选区上 10px 展开
      top = Math.max(margin, above - maxH);
      height = Math.min(maxH, availAbove);
    } else {
      // 上下都放不下整卡（大段跨页选区几乎占满视口，rect.y 贴近视口顶）：
      // 贴顶部并尽量占满视口可用高度，避免 maxHeight 被兜底成 160px 细条
      top = margin;
      height = Math.min(maxH, window.innerHeight - margin * 2);
    }
  }
  return { left: x, top, maxHeight: height };
}

/* ==========================================================================
   翻译结果卡片
   ========================================================================== */

export function TranslateCardView({
  card,
  variant,
  onModeChange,
  onRetry,
  onClose,
  onSwitchModel,
}: {
  card: CardState;
  variant: "floating" | "panel";
  onModeChange: (mode: TranslateMode) => void;
  onRetry: () => void;
  onClose: () => void;
  onSwitchModel: (id: string) => void;
}) {
  const { t } = useI18n();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  const config = loadAiConfig();
  const activeProfile = getActiveProfile(config);

  // 下拉菜单点击外部关闭
  useEffect(() => {
    if (!menuOpen) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [menuOpen]);

  const errorText = (() => {
    const d = card.errorDetail;
    if (!d) return "";
    if (d === "network") return t("aiErrorNetwork");
    if (d === "empty") return t("aiErrorEmpty");
    if (d === "no-model") return t("aiErrorNoModel");
    if (d.startsWith("http:401") || d.startsWith("http:403"))
      return t("aiErrorAuth");
    if (d.startsWith("http:404")) return t("aiErrorNotFound");
    if (d.startsWith("http:429")) return t("aiErrorRateLimit");
    if (d.startsWith("http:")) return `${t("aiErrorHttp")} ${d.slice(5)}`;
    return d;
  })();

  const modeSwitch = (
    <div className="tr-mode-switch">
      <button
        type="button"
        className={`tr-mode-btn ${card.mode === "word" ? "is-active" : ""}`}
        onClick={() => onModeChange("word")}
      >
        {t("aiModeWord")}
      </button>
      <button
        type="button"
        className={`tr-mode-btn ${card.mode === "sentence" ? "is-active" : ""}`}
        onClick={() => onModeChange("sentence")}
      >
        {t("aiModeSentence")}
      </button>
    </div>
  );

  const modelMenu = activeProfile ? (
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
              onClick={() => {
                setMenuOpen(false);
                onSwitchModel(p.id);
              }}
            >
              <span className="tr-model-dot" aria-hidden="true" />
              <span className="tr-profile-name">{p.name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  ) : null;

  const body = (
    <>
      {card.status === "loading" && (
        <div className="tr-loading">
          <span className="spinner" />
          <span>{t("aiLoading")}</span>
        </div>
      )}

      {card.status === "error" && (
        <div className="tr-error">
          <p>{errorText || t("aiErrorRequest")}</p>
          <button type="button" className="tr-retry" onClick={onRetry}>
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
                <span className="tr-word">
                  {card.result.query ?? card.info.text}
                </span>
              </div>
              {card.result.contextMeaning && (
                <section className="tr-section">
                  <h4>{t("aiInContext")}</h4>
                  <p className="tr-context-meaning">
                    {card.result.contextMeaning}
                  </p>
                </section>
              )}
              {card.result.senses && card.result.senses.length > 0 && (
                <section className="tr-section">
                  <h4>{t("aiSenses")}</h4>
                  <ul className="tr-senses">
                    {card.result.senses.map((sense, i) => (
                      <li key={i}>
                        {sense.pos && (
                          <span className="tr-pos">{sense.pos}</span>
                        )}
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
    </>
  );

  if (variant === "panel") {
    return (
      <div className="tr-panel-content" role="region" aria-label={t("aiTranslate")}>
        <div className="tr-panel-header">
          {modeSwitch}
          <div className="tr-spacer" />
          {modelMenu}
        </div>
        <div className="tr-panel-body">{body}</div>
      </div>
    );
  }

  return (
    <div
      className="tr-card"
      style={cardPosition(card.info.rect)}
      role="dialog"
      aria-label={t("aiTranslate")}
    >
      <div className="tr-card-header">
        {modeSwitch}
        <div className="tr-spacer" />
        {modelMenu}
        <button
          type="button"
          className="tr-close"
          onClick={onClose}
          aria-label={t("aiClose")}
        >
          <XIcon size={14} />
        </button>
      </div>
      <div className="tr-card-body">{body}</div>
    </div>
  );
}

/* ==========================================================================
   AI 总结结果卡片（长文本选区；浮动卡或右侧面板 summary tab）
   ========================================================================== */

export function SummaryCardView({
  card,
  variant,
  onRetry,
  onClose,
  onSwitchModel,
}: {
  card: SummaryCardState;
  variant: "floating" | "panel";
  onRetry: () => void;
  onClose: () => void;
  onSwitchModel: (id: string) => void;
}) {
  const { t } = useI18n();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  // 下拉菜单点击外部关闭
  useEffect(() => {
    if (!menuOpen) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [menuOpen]);

  const config = loadAiConfig();
  const activeProfile = getActiveProfile(config);

  const errorText = (() => {
    const d = card.errorDetail;
    if (!d) return "";
    if (d === "network") return t("aiErrorNetwork");
    if (d === "empty") return t("aiErrorEmpty");
    if (d === "no-model") return t("aiErrorNoModel");
    if (d.startsWith("http:401") || d.startsWith("http:403"))
      return t("aiErrorAuth");
    if (d.startsWith("http:404")) return t("aiErrorNotFound");
    if (d.startsWith("http:429")) return t("aiErrorRateLimit");
    if (d.startsWith("http:")) return `${t("aiErrorHttp")} ${d.slice(5)}`;
    return d;
  })();

  const modelMenu = activeProfile ? (
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
              onClick={() => {
                setMenuOpen(false);
                onSwitchModel(p.id);
              }}
            >
              <span className="tr-model-dot" aria-hidden="true" />
              <span className="tr-profile-name">{p.name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  ) : null;

  const body = (
    <>
      {card.status === "loading" && (
        <div className="tr-loading">
          <span className="spinner" />
          <span>{t("aiLoading")}</span>
        </div>
      )}

      {card.status === "error" && (
        <div className="tr-error">
          <p>{errorText || t("aiErrorRequest")}</p>
          <button type="button" className="tr-retry" onClick={onRetry}>
            {t("aiRetry")}
          </button>
        </div>
      )}

      {card.status === "done" && card.result && (
        <>
          {card.result.summary ? (
            <>
              <p className="tr-summary-text">{card.result.summary}</p>
              {card.result.keyPoints && card.result.keyPoints.length > 0 && (
                <ul className="tr-summary-keys">
                  {card.result.keyPoints.map((k, i) => (
                    <li key={i}>{k}</li>
                  ))}
                </ul>
              )}
            </>
          ) : (
            <p className="tr-raw">{card.result.raw}</p>
          )}
        </>
      )}
    </>
  );

  if (variant === "panel") {
    return (
      <div
        className="tr-panel-content"
        role="region"
        aria-label={t("aiSummarize")}
      >
        <div className="tr-panel-header">
          <span className="tr-summary-tag">{t("aiSummarize")}</span>
          <div className="tr-spacer" />
          {modelMenu}
        </div>
        <div className="tr-panel-body">{body}</div>
      </div>
    );
  }

  return (
    <div
      className="tr-card tr-card-summary"
      style={cardPosition(card.info.rect)}
      role="dialog"
      aria-label={t("aiSummarize")}
    >
      <div className="tr-card-header">
        <span className="tr-summary-tag">{t("aiSummarize")}</span>
        <div className="tr-spacer" />
        {modelMenu}
        <button
          type="button"
          className="tr-close"
          onClick={onClose}
          aria-label={t("aiClose")}
        >
          <XIcon size={14} />
        </button>
      </div>
      <div className="tr-card-body">{body}</div>
    </div>
  );
}

/* ==========================================================================
   Wikipedia 结果卡片
   ========================================================================== */

export function WikiCardView({
  wiki,
  variant,
  onRetry,
  onClose,
  onOpenLink,
}: {
  wiki: WikiCardState;
  variant: "floating" | "panel";
  onRetry: () => void;
  onClose: () => void;
  onOpenLink: () => void;
}) {
  const { t } = useI18n();

  const wikiErrorText = (() => {
    const d = wiki.errorDetail;
    if (!d) return "";
    if (d === "not-found") return t("wikiNotFound");
    if (d === "empty") return t("wikiEmpty");
    if (d === "network") return t("aiErrorNetwork");
    if (d.startsWith("http:")) return `${t("aiErrorHttp")} ${d.slice(5)}`;
    return d;
  })();

  const title =
    wiki.status === "done" && wiki.result ? (
      <h3
        className={
          variant === "panel" ? "tr-wiki-panel-title" : "tr-wiki-head-title"
        }
        title={wiki.result.title}
      >
        {wiki.result.title}
      </h3>
    ) : null;

  const body = (
    <>
      {wiki.status === "loading" && (
        <div className="tr-loading">
          <span className="spinner" />
          <span>{t("wikiLoading")}</span>
        </div>
      )}

      {wiki.status === "error" && (
        <div className="tr-error">
          <p>{wikiErrorText || t("aiErrorRequest")}</p>
          <button type="button" className="tr-retry" onClick={onRetry}>
            {t("aiRetry")}
          </button>
        </div>
      )}

      {wiki.status === "done" && wiki.result && (
        <div className="tr-wiki-content">
          {variant === "panel" && title}
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
              onClick={onOpenLink}
            >
              {t("wikiOpen")}
            </button>
            <p className="tr-wiki-license">{wiki.result.license}</p>
          </div>
        </div>
      )}
    </>
  );

  if (variant === "panel") {
    return (
      <div className="tr-panel-content" role="region" aria-label="Wikipedia">
        <div className="tr-panel-body">{body}</div>
      </div>
    );
  }

  return (
    <div
      className="tr-card"
      style={cardPosition(wiki.info.rect)}
      role="dialog"
      aria-label="Wikipedia"
    >
      <div className="tr-card-header">
        {title}
        <div className="tr-spacer" />
        <button
          type="button"
          className="tr-close"
          onClick={onClose}
          aria-label={t("aiClose")}
        >
          <XIcon size={14} />
        </button>
      </div>
      <div className="tr-card-body">{body}</div>
    </div>
  );
}
