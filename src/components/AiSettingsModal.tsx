/**
 * AI 翻译设置弹窗 — 管理多个「模型档案」。
 * 每个档案 = 显示名（可选）+ Base URL + API Key + 模型名，可来自不同厂商；
 * 点击列表行选用其一，翻译请求始终走当前选用的档案。
 * 配置仅保存在本机 localStorage（见 lib/aiTranslate.ts，旧格式自动迁移）。
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useI18n } from "../i18n";
import {
  describeAiError,
  getActiveProfile,
  loadAiConfig,
  loadTargetLang,
  saveAiConfig,
  saveTargetLang,
  TARGET_AUTO,
  TARGET_LANGS,
  targetLangName,
  testAiConnection,
  type AiProfile,
} from "../lib/aiTranslate";
import { ChevronDownIcon, PencilIcon, PlusIcon, XIcon } from "./Icons";

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
  /** 翻译目标语言（翻译/释义输出到该语言），选择即持久化 */
  const [targetLang, setTargetLang] = useState<string>(loadTargetLang);
  const [langMenuOpen, setLangMenuOpen] = useState(false);
  /** 菜单 fixed 定位坐标：脱离 modal 滚动容器，避免被 overflow 裁剪 */
  const [langMenuPos, setLangMenuPos] = useState<{
    top: number;
    left: number;
  } | null>(null);
  const langMenuRef = useRef<HTMLDivElement | null>(null);
  /** portal 菜单自身的 ref：外部点击关闭时同时检查菜单内部 */
  const langMenuDomRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  // 目标语言下拉菜单：点击外部关闭（菜单 portal 到 body，需同时命中 chip 与菜单自身）
  useEffect(() => {
    if (!langMenuOpen) return;
    const onPointerDown = (e: PointerEvent) => {
      const inChip = langMenuRef.current?.contains(e.target as Node) ?? false;
      const inMenu = langMenuDomRef.current?.contains(e.target as Node) ?? false;
      if (!inChip && !inMenu) setLangMenuOpen(false);
    };
    const onScrollOrResize = () => setLangMenuOpen(false);
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("scroll", onScrollOrResize, true);
    window.addEventListener("resize", onScrollOrResize);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("scroll", onScrollOrResize, true);
      window.removeEventListener("resize", onScrollOrResize);
    };
  }, [langMenuOpen]);

  /** 打开目标语言菜单：按 chip 视口坐标定位（fixed） */
  const openLangMenu = () => {
    const chip = langMenuRef.current?.querySelector(".tr-model-chip");
    if (!chip) return;
    const r = chip.getBoundingClientRect();
    setLangMenuPos({ top: r.bottom + 6, left: r.left });
    setLangMenuOpen(true);
  };

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

  /** 切换翻译目标语言：持久化并更新 chip 显示 */
  const switchLang = (id: string) => {
    setLangMenuOpen(false);
    if (id === targetLang) return;
    saveTargetLang(id);
    setTargetLang(id);
  };

  /** 目标语言选项：首项「跟随界面语言」+ 具体语言列表 */
  const langOptions = [
    { id: TARGET_AUTO, label: t("aiTargetAuto") },
    ...TARGET_LANGS.map((l) => ({ id: l.id, label: l.label })),
  ];

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
          <h3>{t("aiSettings")}</h3>
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
          {/* 翻译目标语言：翻译/释义输出到所选语言（样式与翻译卡片模型切换一致） */}
          <div className="tr-field">
            <span>{t("aiTargetLang")}</span>
            <div className="tr-chip-wrap" ref={langMenuRef}>
              <button
                type="button"
                className="tr-model-chip tr-lang-trigger"
                onClick={openLangMenu}
              >
                <span>
                  {targetLang === TARGET_AUTO
                    ? t("aiTargetAuto")
                    : targetLangName(targetLang)}
                </span>
                <ChevronDownIcon size={12} />
              </button>
            </div>
          </div>

          {/* 目标语言下拉菜单：portal 到 body（参照 orkest-ui Select 做法），
              脱离 modal 的 overflow/transform 上下文，不再被裁剪或错位 */}
          {langMenuOpen &&
            langMenuPos &&
            createPortal(
              <div
                className="tr-model-menu tr-menu-fixed"
                ref={langMenuDomRef}
                style={{ top: langMenuPos.top, left: langMenuPos.left }}
                role="menu"
              >
                {langOptions.map((l) => (
                  <button
                    key={l.id}
                    type="button"
                    className={`tr-model-menu-item ${l.id === targetLang ? "is-active" : ""}`}
                    role="menuitem"
                    onClick={() => switchLang(l.id)}
                  >
                    <span className="tr-model-dot" aria-hidden="true" />
                    <span className="tr-profile-name">{l.label}</span>
                  </button>
                ))}
              </div>,
              document.body
            )}

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
