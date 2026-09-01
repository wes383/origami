/**
 * 划词翻译 / Wikipedia 查询「引擎」。
 *
 * 把原先散落在 TranslatePopup 里的「请求 + 结果状态」抽离到这里，供两处消费：
 *   1. 选中文本后浮现的浮动气泡 / 浮动结果卡片（TranslatePopup）
 *   2. 右侧侧边栏面板（RightPanel）
 *
 * 路由规则：发起翻译 / Wikipedia 请求时，依据「右侧面板是否打开 + 当前 tab」
 * 决定结果落到「浮动卡片」还是「右侧面板」。
 *   - 面板打开且处于 translate tab → 翻译结果进面板
 *   - 面板打开且处于 wikipedia tab → Wikipedia 结果进面板
 *   - 其余（面板未打开 / 处于另一个 tab）→ 结果进浮动卡片
 *
 * 这样选中文本后若右侧面板已开在对应 tab，结果直接在面板里呈现，
 * 浮动气泡则隐藏掉那个已「分流」走的按钮（见 TranslatePopup）。
 */

import { useCallback, useRef, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useI18n } from "../i18n";
import {
  describeAiError,
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

export interface SelectionInfo {
  text: string;
  context: string;
  /** 选区矩形（viewport 坐标，px） */
  rect: { x: number; y: number; w: number; h: number };
}

export type CardState = {
  info: SelectionInfo;
  mode: TranslateMode;
  status: "loading" | "done" | "error";
  result: TranslateResult | null;
  errorDetail: string | null;
};

export type WikiCardState = {
  info: SelectionInfo;
  status: "loading" | "done" | "error";
  result: WikiResult | null;
  /** 错误码：not-found | empty | network | http:<status> */
  errorDetail: string | null;
};

export type RightTab = "translate" | "wikipedia";

export type RightPanelState = { open: boolean; tab: RightTab };

type RouteLoc = "floating" | "panel";

export function useTextActionEngine({
  onOpenSettings,
  rightPanel,
}: {
  onOpenSettings: () => void;
  rightPanel: RightPanelState;
}) {
  const { lang: uiLang } = useI18n();

  const [floatingCard, setFloatingCard] = useState<CardState | null>(null);
  const [floatingWiki, setFloatingWiki] = useState<WikiCardState | null>(null);
  const [panelCard, setPanelCard] = useState<CardState | null>(null);
  const [panelWiki, setPanelWiki] = useState<WikiCardState | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  /** 最近一次翻译结果所在位置，供「切换模型 / 重试」重新请求到同一处 */
  const lastTranslateLoc = useRef<RouteLoc | null>(null);
  const lastWikiLoc = useRef<RouteLoc | null>(null);
  // 最新结果快照（切换模型时读取当前卡片的 info / mode）
  const floatingCardRef = useRef<CardState | null>(null);
  const panelCardRef = useRef<CardState | null>(null);
  const floatingWikiRef = useRef<WikiCardState | null>(null);
  const panelWikiRef = useRef<WikiCardState | null>(null);
  floatingCardRef.current = floatingCard;
  panelCardRef.current = panelCard;
  floatingWikiRef.current = floatingWiki;
  panelWikiRef.current = panelWiki;

  /** 依据右侧面板状态推断结果落点（可被显式 route 覆盖） */
  const routeTarget = useCallback(
    (kind: "translate" | "wiki"): RouteLoc => {
      if (!rightPanel.open) return "floating";
      if (kind === "translate")
        return rightPanel.tab === "translate" ? "panel" : "floating";
      return rightPanel.tab === "wikipedia" ? "panel" : "floating";
    },
    [rightPanel.open, rightPanel.tab]
  );

  const setCardAt = useCallback((loc: RouteLoc, state: CardState) => {
    if (loc === "panel") {
      setFloatingCard(null);
      setPanelCard(state);
    } else {
      setPanelCard(null);
      setFloatingCard(state);
    }
  }, []);

  const setWikiAt = useCallback((loc: RouteLoc, state: WikiCardState) => {
    if (loc === "panel") {
      setFloatingWiki(null);
      setPanelWiki(state);
    } else {
      setPanelWiki(null);
      setFloatingWiki(state);
    }
  }, []);

  // ---------- 发起翻译请求 ----------

  const runTranslate = useCallback(
    (
      info: SelectionInfo,
      mode: TranslateMode,
      route?: RouteLoc
    ) => {
      const loc = route ?? routeTarget("translate");
      abortRef.current?.abort();
      const config = loadAiConfig();
      if (!isAiConfigured(config)) {
        setFloatingCard(null);
        setPanelCard(null);
        onOpenSettings();
        return;
      }
      const ac = new AbortController();
      abortRef.current = ac;
      lastTranslateLoc.current = loc;
      setCardAt(loc, {
        info,
        mode,
        status: "loading",
        result: null,
        errorDetail: null,
      });
      // 目标语言在 AI 设置弹窗里配置；「跟随界面语言」时直接解析为当前 UI 语言
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
          setCardAt(loc, {
            info,
            mode,
            status: "done",
            result,
            errorDetail: null,
          });
        })
        .catch((err) => {
          if (ac.signal.aborted) return;
          const detail = describeAiError(err);
          setCardAt(loc, {
            info,
            mode,
            status: "error",
            result: null,
            errorDetail: detail,
          });
        });
    },
    [onOpenSettings, routeTarget, setCardAt, uiLang]
  );

  // ---------- 发起 Wikipedia 名词解释请求 ----------

  const runWiki = useCallback(
    (info: SelectionInfo, route?: RouteLoc) => {
      const loc = route ?? routeTarget("wiki");
      abortRef.current?.abort();
      const ac = new AbortController();
      abortRef.current = ac;
      lastWikiLoc.current = loc;
      setWikiAt(loc, {
        info,
        status: "loading",
        result: null,
        errorDetail: null,
      });
      fetchWikipediaSummary(info.text, wikiLang(uiLang), ac.signal)
        .then((result) => {
          if (ac.signal.aborted) return;
          setWikiAt(loc, {
            info,
            status: "done",
            result,
            errorDetail: null,
          });
        })
        .catch((err) => {
          if (ac.signal.aborted) return;
          const detail =
            err instanceof Error && err.message ? err.message : "network";
          setWikiAt(loc, {
            info,
            status: "error",
            result: null,
            errorDetail: detail,
          });
        });
    },
    [routeTarget, setWikiAt, uiLang]
  );

  /** 用系统默认浏览器打开条目（Tauri opener 插件；非 Tauri 环境回退 window.open） */
  const handleOpenWiki = useCallback(() => {
    const loc = lastWikiLoc.current;
    const cur = loc === "panel" ? panelWikiRef.current : floatingWikiRef.current;
    const url = cur?.result?.url;
    if (!url) return;
    try {
      void openUrl(url);
    } catch {
      window.open(url, "_blank", "noopener,noreferrer");
    }
  }, []);

  // ---------- 模型切换（结果卡片头部下拉） ----------

  const switchModel = useCallback(
    (id: string) => {
      const cfg = loadAiConfig();
      if (cfg.activeId === id) return;
      saveAiConfig({ ...cfg, activeId: id });
      const loc = lastTranslateLoc.current;
      const cur = loc === "panel" ? panelCardRef.current : floatingCardRef.current;
      if (loc && cur) runTranslate(cur.info, cur.mode, loc);
    },
    [runTranslate]
  );

  // ---------- 重试 ----------

  const retryTranslate = useCallback(() => {
    const loc = lastTranslateLoc.current;
    const cur = loc === "panel" ? panelCardRef.current : floatingCardRef.current;
    if (loc && cur) runTranslate(cur.info, cur.mode, loc);
  }, [runTranslate]);

  const retryWiki = useCallback(() => {
    const loc = lastWikiLoc.current;
    const cur = loc === "panel" ? panelWikiRef.current : floatingWikiRef.current;
    if (loc && cur) runWiki(cur.info, loc);
  }, [runWiki]);

  // ---------- 关闭（仅清对应位置的结果；右侧面板为停靠 UI，不在此处清空） ----------

  const closeFloatingCard = useCallback(() => setFloatingCard(null), []);
  const closeFloatingWiki = useCallback(() => setFloatingWiki(null), []);
  const closePanelCard = useCallback(() => setPanelCard(null), []);
  const closePanelWiki = useCallback(() => setPanelWiki(null), []);

  /** 清空右侧面板内容（关闭面板 / 切换文档时调用） */
  const clearPanel = useCallback(() => {
    setPanelCard(null);
    setPanelWiki(null);
  }, []);

  /** 收起浮动卡片（点击外部 / Esc）。不碰面板内容 */
  const closeAll = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setFloatingCard(null);
    setFloatingWiki(null);
  }, []);

  return {
    floatingCard,
    floatingWiki,
    panelCard,
    panelWiki,
    runTranslate,
    runWiki,
    switchModel,
    retryTranslate,
    retryWiki,
    handleOpenWiki,
    closeFloatingCard,
    closeFloatingWiki,
    closePanelCard,
    closePanelWiki,
    clearPanel,
    closeAll,
  };
}

export type TextActionEngine = ReturnType<typeof useTextActionEngine>;
