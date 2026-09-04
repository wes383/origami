/**
 * 右侧侧边栏面板。
 *
 * 含三个 tab：AI 翻译 / Wikipedia / AI 总结。结果由 useTextActionEngine 驱动——
 * 选中文本后若本面板处于打开且对应 tab，翻译 / Wikipedia / 总结结果会直接落到这里
 * （见 useTextActionEngine 的路由逻辑），无需再点浮动气泡的按钮。
 *
 * 未选中文本 / 尚未出结果时，对应 tab 显示引导提示。
 */

import { useI18n } from "../i18n";
import {
  FileTextIcon,
  GlobeIcon,
  LanguagesIcon,
  XIcon,
} from "./Icons";
import {
  SummaryCardView,
  TranslateCardView,
  WikiCardView,
} from "./TranslateCards";
import type { RightTab, TextActionEngine } from "../hooks/useTextActionEngine";

interface RightPanelProps {
  tab: RightTab;
  onTabChange: (tab: RightTab) => void;
  onClose: () => void;
  engine: TextActionEngine;
}

export default function RightPanel({
  tab,
  onTabChange,
  onClose,
  engine,
}: RightPanelProps) {
  const { t } = useI18n();
  const card = engine.panelCard;
  const wiki = engine.panelWiki;
  const summary = engine.panelSummary;

  return (
    <aside className="right-panel">
      <div className="sidebar-head">
        <div className="sidebar-tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={tab === "translate"}
            aria-label={t("aiTranslate")}
            title={t("aiTranslate")}
            className={`sidebar-tab ${tab === "translate" ? "is-active" : ""}`}
            onClick={() => onTabChange("translate")}
          >
            <LanguagesIcon size={15} />
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "wikipedia"}
            aria-label="Wikipedia"
            title="Wikipedia"
            className={`sidebar-tab ${tab === "wikipedia" ? "is-active" : ""}`}
            onClick={() => onTabChange("wikipedia")}
          >
            <GlobeIcon size={15} />
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "summary"}
            aria-label={t("aiSummarize")}
            title={t("aiSummarize")}
            className={`sidebar-tab ${tab === "summary" ? "is-active" : ""}`}
            onClick={() => onTabChange("summary")}
          >
            <FileTextIcon size={15} />
          </button>
        </div>
        <button
          type="button"
          className="sidebar-close"
          onClick={onClose}
          title={t("aiClose")}
          aria-label={t("aiClose")}
        >
          <XIcon size={15} />
        </button>
      </div>

      <div className="right-body">
        {tab === "translate" ? (
          card ? (
            <TranslateCardView
              card={card}
              variant="panel"
              onModeChange={(mode) => engine.runTranslate(card.info, mode, "panel")}
              onRetry={() => engine.retryTranslate()}
              onClose={() => engine.closePanelCard()}
              onSwitchModel={(id) => engine.switchModel(id)}
            />
          ) : (
            <div className="right-empty">{t("panelEmptyTranslate")}</div>
          )
        ) : tab === "wikipedia" ? (
          wiki ? (
            <WikiCardView
              wiki={wiki}
              variant="panel"
              onRetry={() => engine.retryWiki()}
              onClose={() => engine.closePanelWiki()}
              onOpenLink={() => engine.handleOpenWiki()}
            />
          ) : (
            <div className="right-empty">{t("panelEmptyWikipedia")}</div>
          )
        ) : summary ? (
          <SummaryCardView
            card={summary}
            variant="panel"
            onRetry={() => engine.retrySummarize()}
            onClose={() => engine.closePanelSummary()}
            onSwitchModel={(id) => engine.switchModel(id)}
          />
        ) : (
          <div className="right-empty">{t("panelEmptySummary")}</div>
        )}
      </div>
    </aside>
  );
}
