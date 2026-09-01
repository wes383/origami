/**
 * AI 翻译设置弹窗 — 配置 OpenAI 兼容接口（Base URL / API Key / 模型）。
 * 配置仅保存在本机 localStorage（见 lib/aiTranslate.ts）。
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useI18n } from "../i18n";
import {
  describeAiError,
  loadAiConfig,
  saveAiConfig,
  testAiConnection,
} from "../lib/aiTranslate";
import { LanguagesIcon } from "./Icons";

type TestStatus = "idle" | "testing" | "ok" | "fail";

export default function AiSettingsModal({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  const [baseUrl, setBaseUrl] = useState(() => loadAiConfig().baseUrl);
  const [apiKey, setApiKey] = useState(() => loadAiConfig().apiKey);
  const [model, setModel] = useState(() => loadAiConfig().model);
  const [showKey, setShowKey] = useState(false);
  const [test, setTest] = useState<TestStatus>("idle");
  const [testDetail, setTestDetail] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const canSave = baseUrl.trim() !== "" && apiKey.trim() !== "";

  const handleSave = () => {
    if (!canSave) return;
    saveAiConfig({ baseUrl: baseUrl.trim(), apiKey: apiKey.trim(), model: model.trim() });
    onClose();
  };

  const handleTest = useCallback(async () => {
    if (!canSave) {
      setTest("fail");
      setTestDetail(t("aiFillFirst"));
      return;
    }
    const ac = new AbortController();
    setTest("testing");
    setTestDetail("");
    try {
      await testAiConnection(
        { baseUrl: baseUrl.trim(), apiKey: apiKey.trim(), model: model.trim() },
        ac.signal
      );
      setTest("ok");
    } catch (err) {
      if (ac.signal.aborted) return;
      setTest("fail");
      const d = describeAiError(err);
      setTestDetail(
        d === "network"
          ? t("aiErrorNetwork")
          : d.startsWith("http:")
            ? `${t("aiErrorHttp")} ${d.slice(5)}`
            : d
      );
    }
  }, [baseUrl, apiKey, model, canSave, t]);

  return (
    <div
      className="tr-modal-overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="tr-modal" role="dialog" aria-label={t("aiSettings")}>
        <header className="tr-modal-head">
          <LanguagesIcon />
          <h3>{t("aiApiTitle")}</h3>
        </header>

        <div className="tr-form">
          <label className="tr-field">
            <span>{t("aiBaseUrl")}</span>
            <input
              ref={inputRef}
              type="text"
              value={baseUrl}
              placeholder={t("aiBaseUrlPlaceholder")}
              spellCheck={false}
              onChange={(e) => setBaseUrl(e.target.value)}
            />
          </label>

          <label className="tr-field">
            <span>{t("aiApiKey")}</span>
            <div className="tr-key-row">
              <input
                type={showKey ? "text" : "password"}
                value={apiKey}
                placeholder="sk-…"
                spellCheck={false}
                autoComplete="off"
                onChange={(e) => setApiKey(e.target.value)}
              />
              <button
                type="button"
                className="tr-key-toggle"
                onClick={() => setShowKey((v) => !v)}
              >
                {showKey ? t("aiHide") : t("aiShow")}
              </button>
            </div>
          </label>

          <label className="tr-field">
            <span>{t("aiModel")}</span>
            <input
              type="text"
              value={model}
              spellCheck={false}
              onChange={(e) => setModel(e.target.value)}
            />
          </label>

          <p className="tr-hint">{t("aiConfigHint")}</p>

          {test === "ok" && <p className="tr-test-ok">{t("aiTestOk")}</p>}
          {test === "fail" && testDetail && (
            <p className="tr-test-fail">{`${t("aiTestFail")} · ${testDetail}`}</p>
          )}
        </div>

        <footer className="tr-modal-foot">
          <button
            type="button"
            className="tr-btn-secondary"
            onClick={() => void handleTest()}
            disabled={test === "testing"}
          >
            {test === "testing" ? t("aiTesting") : t("aiTest")}
          </button>
          <div className="tr-modal-foot-spacer" />
          <button type="button" className="tr-btn-secondary" onClick={onClose}>
            {t("aiCancel")}
          </button>
          <button
            type="button"
            className="tr-btn-primary"
            onClick={handleSave}
            disabled={!canSave}
            title={canSave ? undefined : t("aiFillFirst")}
          >
            {t("aiSave")}
          </button>
        </footer>
      </div>
    </div>
  );
}
