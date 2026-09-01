/**
 * AI 翻译设置弹窗 — 管理多个「模型档案」。
 * 每个档案 = 显示名（可选）+ Base URL + API Key + 模型名，可来自不同厂商；
 * 点击列表行选用其一，翻译请求始终走当前选用的档案。
 * 配置仅保存在本机 localStorage（见 lib/aiTranslate.ts，旧格式自动迁移）。
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useI18n } from "../i18n";
import {
  describeAiError,
  getActiveProfile,
  loadAiConfig,
  saveAiConfig,
  testAiConnection,
  type AiProfile,
} from "../lib/aiTranslate";
import { PencilIcon, PlusIcon, XIcon } from "./Icons";

type TestStatus = "idle" | "testing" | "ok" | "fail";

function genId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `p-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }
}

export default function AiSettingsModal({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  const initial = useRef(loadAiConfig()).current;
  const [profiles, setProfiles] = useState<AiProfile[]>(initial.profiles);
  const [activeId, setActiveId] = useState(initial.activeId);
  /** 表单：新增与编辑共用；端点字段默认沿用当前选用档案（同厂商换模型的常见场景） */
  const [formName, setFormName] = useState("");
  const [formUrl, setFormUrl] = useState(
    () => getActiveProfile(initial)?.baseUrl ?? ""
  );
  const [formKey, setFormKey] = useState(
    () => getActiveProfile(initial)?.apiKey ?? ""
  );
  const [formModel, setFormModel] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showKey, setShowKey] = useState(false);
  /** 添加/编辑表单默认收起，点击「添加模型」才展开 */
  const [formOpen, setFormOpen] = useState(false);
  const [test, setTest] = useState<TestStatus>("idle");
  const [testDetail, setTestDetail] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  useEffect(() => {
    if (formOpen) inputRef.current?.focus();
  }, [formOpen]);

  const active = getActiveProfile({ profiles, activeId });

  const formValid =
    formUrl.trim() !== "" && formKey.trim() !== "" && formModel.trim() !== "";

  /** 每步操作（添加/编辑/删除/选用）后立即持久化到 localStorage */
  const persist = (next: AiProfile[], nextActiveId: string) => {
    saveAiConfig({ profiles: next, activeId: nextActiveId });
  };

  const resetForm = useCallback(() => {
    setFormName("");
    setFormUrl(active?.baseUrl ?? "");
    setFormKey(active?.apiKey ?? "");
    setFormModel("");
    setEditingId(null);
    setShowKey(false);
    setFormOpen(false);
  }, [active]);

  const startEdit = (p: AiProfile) => {
    setEditingId(p.id);
    setFormName(p.name === p.model ? "" : p.name);
    setFormUrl(p.baseUrl);
    setFormKey(p.apiKey);
    setFormModel(p.model);
    setTest("idle");
    setFormOpen(true);
  };

  const selectProfile = (id: string) => {
    setActiveId(id);
    persist(profiles, id);
  };

  const submitForm = () => {
    if (!formValid) return;
    const profile: AiProfile = {
      id: editingId ?? genId(),
      name: formName.trim() || formModel.trim(),
      baseUrl: formUrl.trim(),
      apiKey: formKey.trim(),
      model: formModel.trim(),
    };
    const next = editingId
      ? profiles.map((p) => (p.id === editingId ? profile : p))
      : [...profiles, profile];
    const nextActiveId = editingId ? activeId : activeId || profile.id;
    setProfiles(next);
    if (!editingId && !activeId) setActiveId(profile.id);
    persist(next, nextActiveId);
    resetForm();
    setTest("idle");
  };

  const removeProfile = (id: string) => {
    const next = profiles.filter((p) => p.id !== id);
    const nextActiveId = activeId === id ? (next[0]?.id ?? "") : activeId;
    setProfiles(next);
    setActiveId(nextActiveId);
    persist(next, nextActiveId);
    if (editingId === id) resetForm();
  };

  /** 测试连接：测的是表单里当前输入的接口/Key/模型（而非已保存档案） */
  const handleTest = useCallback(async () => {
    if (!formValid) {
      setTest("fail");
      setTestDetail(t("aiFillFirst"));
      return;
    }
    const ac = new AbortController();
    setTest("testing");
    setTestDetail("");
    try {
      await testAiConnection(
        {
          id: editingId ?? "temp",
          name: formName.trim() || formModel.trim(),
          baseUrl: formUrl.trim(),
          apiKey: formKey.trim(),
          model: formModel.trim(),
        },
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
  }, [formValid, editingId, formName, formModel, formUrl, formKey, t]);

  return (
    <div
      className="tr-modal-overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="tr-modal" role="dialog" aria-label={t("aiSettings")}>
        <header className="tr-modal-head">
          <h3>{t("aiApiTitle")}</h3>
          <button
            type="button"
            className="tr-modal-close"
            onClick={onClose}
            aria-label={t("aiClose")}
            title={t("aiClose")}
          >
            <XIcon size={14} />
          </button>
        </header>

        <div className="tr-form">
          {/* 已保存的模型档案 */}
          <div className="tr-field">
            <span>{t("aiSavedModels")}</span>
            {profiles.length === 0 ? (
              <p className="tr-hint">{t("aiNoProfiles")}</p>
            ) : (
              <div className="tr-model-list">
                {profiles.map((p) => (
                  <div
                    key={p.id}
                    className={`tr-model-item ${p.id === activeId ? "is-active" : ""}`}
                  >
                    <button
                      type="button"
                      className="tr-model-select"
                      onClick={() => selectProfile(p.id)}
                      title={p.id === activeId ? undefined : t("aiSetActive")}
                    >
                      <span className="tr-model-dot" aria-hidden="true" />
                      <span className="tr-profile-name">{p.name}</span>
                      {p.name !== p.model && (
                        <span className="tr-profile-model">{p.model}</span>
                      )}
                      {p.id === activeId && (
                        <span className="tr-model-badge">{t("aiActive")}</span>
                      )}
                    </button>
                    <button
                      type="button"
                      className="tr-model-remove"
                      onClick={() => startEdit(p)}
                      aria-label={`${t("aiEdit")} ${p.name}`}
                      title={t("aiEdit")}
                    >
                      <PencilIcon size={12} />
                    </button>
                    <button
                      type="button"
                      className="tr-model-remove"
                      onClick={() => removeProfile(p.id)}
                      aria-label={`${t("aiRemoveModel")} ${p.name}`}
                      title={t("aiRemoveModel")}
                    >
                      <XIcon size={12} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* 添加 / 编辑模型：默认收起，只显示「添加模型」按钮，点击后展开表单 */}
          {!formOpen ? (
            <button
              type="button"
              className="tr-btn-secondary tr-add-model"
              onClick={() => setFormOpen(true)}
            >
              <PlusIcon size={14} />
              {t("aiAddTitle")}
            </button>
          ) : (
            <div className="tr-form-section">
              <h4 className="tr-form-title">
                {editingId ? t("aiEditTitle") : t("aiAddTitle")}
              </h4>

              <p className="tr-hint">{t("aiConfigHint")}</p>

              <label className="tr-field">
                <span>{t("aiBaseUrl")}</span>
                <input
                  ref={inputRef}
                  type="text"
                  value={formUrl}
                  placeholder={t("aiBaseUrlPlaceholder")}
                  spellCheck={false}
                  onChange={(e) => setFormUrl(e.target.value)}
                />
              </label>

              <label className="tr-field">
                <span>{t("aiApiKey")}</span>
                <div className="tr-key-row">
                  <input
                    type={showKey ? "text" : "password"}
                    value={formKey}
                    spellCheck={false}
                    autoComplete="off"
                    onChange={(e) => setFormKey(e.target.value)}
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
                <span>{t("aiModelName")}</span>
                <input
                  type="text"
                  value={formModel}
                  spellCheck={false}
                  onChange={(e) => setFormModel(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      submitForm();
                    }
                  }}
                />
              </label>

              {/* 显示名（可选）：放在模型输入下方 */}
              <label className="tr-field">
                <span>{t("aiName")}</span>
                <input
                  type="text"
                  value={formName}
                  spellCheck={false}
                  onChange={(e) => setFormName(e.target.value)}
                />
              </label>

              {/* 操作行：测试连接 | 取消 | 添加/保存修改（每步操作自动保存） */}
              <div className="tr-form-actions">
                <button
                  type="button"
                  className="tr-btn-secondary"
                  onClick={() => void handleTest()}
                  disabled={test === "testing" || !formValid}
                  title={formValid ? undefined : t("aiFillFirst")}
                >
                  {test === "testing" ? t("aiTesting") : t("aiTest")}
                </button>
                <div className="tr-form-actions-spacer" />
                <button
                  type="button"
                  className="tr-btn-secondary"
                  onClick={resetForm}
                >
                  {t("aiCancel")}
                </button>
                <button
                  type="button"
                  className="tr-btn-primary"
                  onClick={submitForm}
                  disabled={!formValid}
                  title={formValid ? undefined : t("aiFillFirst")}
                >
                  {editingId ? t("aiSaveEdit") : t("aiAddModel")}
                </button>
              </div>
              {test === "ok" && <p className="tr-test-ok">{t("aiTestOk")}</p>}
              {test === "fail" && testDetail && (
                <p className="tr-test-fail">{`${t("aiTestFail")} · ${testDetail}`}</p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
