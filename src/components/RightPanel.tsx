/**
 * 右侧侧边栏面板。
 *
 * 含两个 tab：AI 翻译 / Wikipedia。结果由 useTextActionEngine 驱动——
 * 选中文本后若本面板处于打开且对应 tab，翻译 / Wikipedia 结果会直接落到这里
 * （见 useTextActionEngine 的路由逻辑），无需再点浮动气泡的按钮。
 *
 * 未选中文本 / 尚未出结果时，对应 tab 显示引导提示。
 */

import { useI18n } from "../i18n";
import { XIcon } from "./Icons";
import { TranslateCardView, WikiCardView } from "./TranslateCards";
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

  return (
    <aside className="right-panel">
      <div className="sidebar-head">
        <div className="sidebar-tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={tab === "translate"}
            className={`sidebar-tab ${tab === "translate" ? "is-active" : ""}`}
            onClick={() => onTabChange("translate")}
          >
            {t("aiTranslate")}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "wikipedia"}
            className={`sidebar-tab ${tab === "wikipedia" ? "is-active" : ""}`}
            onClick={() => onTabChange("wikipedia")}
          >
            Wikipedia
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
        ) : wiki ? (
          <WikiCardView
            wiki={wiki}
            variant="panel"
            onRetry={() => engine.retryWiki()}
            onClose={() => engine.closePanelWiki()}
            onOpenLink={() => engine.handleOpenWiki()}
          />
        ) : (
          <div className="right-empty">{t("panelEmptyWikipedia")}</div>
        )}
      </div>
    </aside>
  );
}
