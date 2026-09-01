/**
 * AI 划词/划句翻译 — OpenAI 兼容 Chat Completions 客户端。
 *
 * 支持保存多个「模型档案」（厂商各自的 Base URL / API Key / 模型名），
 * 随时切换当前使用的档案。配置持久化在 localStorage，仅供前端直接
 * fetch 调用，不上传到任何第三方。CSP 为 null（tauri.conf.json），
 * webview 内可直接请求外部 HTTPS 接口。
 */

const STORAGE_KEY = "pdfreader-ai-config";

/** 一个模型档案 = 一个厂商端点 + 模型 */
export interface AiProfile {
  id: string;
  /** 显示名，默认取模型名 */
  name: string;
  baseUrl: string;
  apiKey: string;
  model: string;
}

export interface AiConfig {
  profiles: AiProfile[];
  /** 当前选用的档案 id（始终指向 profiles 中的一项） */
  activeId: string;
}

function genId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `p-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }
}

function sanitizeProfiles(raw: unknown): AiProfile[] {
  if (!Array.isArray(raw)) return [];
  return (raw as unknown[])
    .map((p): AiProfile | null => {
      if (!p || typeof p !== "object") return null;
      const o = p as Record<string, unknown>;
      const baseUrl = typeof o.baseUrl === "string" ? o.baseUrl : "";
      const apiKey = typeof o.apiKey === "string" ? o.apiKey : "";
      const model = typeof o.model === "string" ? o.model.trim() : "";
      if (!baseUrl || !model) return null;
      const name =
        typeof o.name === "string" && o.name.trim() ? o.name.trim() : model;
      return {
        id: typeof o.id === "string" && o.id ? o.id : genId(),
        name,
        baseUrl,
        apiKey,
        model,
      };
    })
    .filter((p): p is AiProfile => p !== null);
}

export function loadAiConfig(): AiConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { profiles: [], activeId: "" };
    const parsed = JSON.parse(raw) as Record<string, unknown>;

    let profiles: AiProfile[] = [];
    if (Array.isArray(parsed.profiles)) {
      // 当前格式：档案列表
      profiles = sanitizeProfiles(parsed.profiles);
    } else if (Array.isArray(parsed.models)) {
      // 上一版：单 endpoint + 多模型名 → 每个模型名升格为一个档案
      const baseUrl = typeof parsed.baseUrl === "string" ? parsed.baseUrl : "";
      const apiKey = typeof parsed.apiKey === "string" ? parsed.apiKey : "";
      const activeModel =
        typeof parsed.activeModel === "string" ? parsed.activeModel : "";
      profiles = (parsed.models as unknown[])
        .filter((m): m is string => typeof m === "string" && m.trim() !== "")
        .map((m) => ({
          id: genId(),
          name: m.trim(),
          baseUrl,
          apiKey,
          model: m.trim(),
        }));
      const hit = profiles.find((p) => p.model === activeModel);
      return {
        profiles,
        activeId: hit?.id ?? profiles[0]?.id ?? "",
      };
    } else if (typeof parsed.model === "string" && parsed.model.trim()) {
      // 最初版：单 endpoint + 单模型
      profiles = [
        {
          id: genId(),
          name: parsed.model.trim(),
          baseUrl: typeof parsed.baseUrl === "string" ? parsed.baseUrl : "",
          apiKey: typeof parsed.apiKey === "string" ? parsed.apiKey : "",
          model: parsed.model.trim(),
        },
      ];
    }

    let activeId = typeof parsed.activeId === "string" ? parsed.activeId : "";
    if (!profiles.some((p) => p.id === activeId)) {
      activeId = profiles[0]?.id ?? "";
    }
    return { profiles, activeId };
  } catch {
    return { profiles: [], activeId: "" };
  }
}

export function saveAiConfig(config: AiConfig): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  } catch {
    /* ignore */
  }
}

export function getActiveProfile(config: AiConfig): AiProfile | null {
  return config.profiles.find((p) => p.id === config.activeId) ?? null;
}

export function isAiConfigured(config: AiConfig): boolean {
  const p = getActiveProfile(config);
  return p !== null && p.baseUrl.trim() !== "" && p.apiKey.trim() !== "";
}

// ---------- 词语 / 句子判定 ----------

export type TranslateMode = "word" | "sentence";

/**
 * 启发式判定选中内容是「单词/短语」还是「句子」：
 *  - 含 CJK：≤20 字且无句末标点 → 词/短语；否则按句子翻译
 *  - 拉丁文：≤8 个词且不含句末标点 → 词/短语；否则按句子翻译
 * 误判时用户可在结果卡片里手动切换模式重新请求
 */
export function detectMode(text: string): TranslateMode {
  const t = text.trim();
  if (!t) return "word";
  const hasCJK = /[\u3400-\u9fff\uf900-\ufaff]/.test(t);
  if (hasCJK) {
    return t.length <= 20 && !/[。！？；!?;]/.test(t) ? "word" : "sentence";
  }
  const stripped = t.replace(/["'“”‘’()[\]{}]+/g, " ");
  const core = stripped.replace(/[.!?;:,]+$/, "");
  const words = core.split(/\s+/).filter(Boolean).length;
  const hasSentencePunct = /[.!?;](\s|$)/.test(stripped);
  return words <= 8 && !hasSentencePunct ? "word" : "sentence";
}

// ---------- 上下文截取 ----------

const CONTEXT_MAX = 3000;

/**
 * 文本层 textContent 压缩空白后，尽量以选中内容为中心截取窗口，
 * 避免超长页面文本撑爆请求
 */
export function buildContext(layerText: string, selected: string): string {
  const ctx = layerText.replace(/\s+/g, " ").trim();
  if (!ctx) return "";
  const needle = selected.replace(/\s+/g, " ").trim().slice(0, 60);
  const idx = needle ? ctx.indexOf(needle) : -1;
  if (idx >= 0) {
    const half = Math.floor(CONTEXT_MAX / 2);
    const start = Math.max(0, idx - half);
    const end = Math.min(ctx.length, idx + needle.length + half);
    const head = start > 0 ? "… " : "";
    const tail = end < ctx.length ? " …" : "";
    return head + ctx.slice(start, end) + tail;
  }
  return ctx.length > CONTEXT_MAX ? ctx.slice(0, CONTEXT_MAX) + " …" : ctx;
}

// ---------- 结果结构 ----------

export interface WordSense {
  pos?: string;
  meaning: string;
}

export interface TranslateResult {
  mode: TranslateMode;
  /** 清理后的词头（word 模式） */
  query?: string;
  /** 该词在本文上下文中的含义（word 模式） */
  contextMeaning?: string;
  /** 按词性分组的常见含义（word 模式） */
  senses?: WordSense[];
  /** 整句翻译（sentence 模式） */
  translation?: string;
  /** AI 未返回预期 JSON 时的原文兜底 */
  raw?: string;
}

export class AiRequestError extends Error {}

/** 可选的目标语言（翻译结果 / 词义解释用该语言输出） */
export const TARGET_LANGS = [
  { id: "zh", label: "简体中文" },
  { id: "en", label: "English" },
  { id: "ja", label: "日本語" },
  { id: "ko", label: "한국어" },
  { id: "fr", label: "Français" },
  { id: "de", label: "Deutsch" },
  { id: "es", label: "Español" },
  { id: "ru", label: "Русский" },
  { id: "pt", label: "Português" },
  { id: "it", label: "Italiano" },
] as const;

export type TargetLangId = (typeof TARGET_LANGS)[number]["id"];

const TARGET_KEY = "pdfreader-target-lang";

/** 特殊值：跟随界面语言（默认）。由调用方解析为当前 UI 语言 */
export const TARGET_AUTO = "auto";

/** 读取目标语言，默认「跟随界面语言」（与界面语言保持一致） */
export function loadTargetLang(): string {
  try {
    const v = localStorage.getItem(TARGET_KEY);
    if (v === TARGET_AUTO) return TARGET_AUTO;
    if (v && TARGET_LANGS.some((l) => l.id === v)) return v;
  } catch {
    /* ignore */
  }
  return TARGET_AUTO;
}

export function saveTargetLang(id: string): void {
  try {
    localStorage.setItem(TARGET_KEY, id);
  } catch {
    /* ignore */
  }
}

export function targetLangName(id: string): string {
  return TARGET_LANGS.find((l) => l.id === id)?.label ?? "简体中文";
}

function wordSystemPrompt(target: string): string {
  return [
    "You are an expert lexicographer and reading assistant for PDF documents.",
    "The user selected a word or short phrase from a document; you are given the page text as context.",
    "Tasks:",
    "1. Locate the selected word/phrase in the context and determine its exact meaning as used there.",
    "2. List all of its common meanings, grouped by part of speech, ordered by frequency (max 8 senses).",
    `Write "contextMeaning" and every "meaning" in ${target}. Keep "pos" concise (e.g. "n.", "v.", "adj.", "短语").`,
    "Respond ONLY with a JSON object, no markdown fences, in this exact shape:",
    '{"query": string, "contextMeaning": string, "senses": [{"pos": string, "meaning": string}]}',
  ].join("\n");
}

function sentenceSystemPrompt(target: string): string {
  return [
    "You are a professional translator for PDF documents.",
    "The user selected a sentence (or passage); you are given the surrounding page text as context.",
    `Translate the selected text into ${target}.`,
    "Use the context to disambiguate pronouns, terminology and tone; keep the translation fluent and faithful.",
    "If the selected text is already in the target language, produce a translation into the other language instead.",
    "Respond ONLY with a JSON object, no markdown fences, in this exact shape:",
    '{"translation": string}',
  ].join("\n");
}

/** 从回复中稳健提取 JSON（容忍 ``` 围栏与前后闲话） */
function extractJson(text: string): Record<string, unknown> | null {
  let s = text.trim();
  const fence = /```(?:json)?\s*([\s\S]*?)\s*```/i.exec(s);
  if (fence) s = fence[1].trim();
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    return JSON.parse(s.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function pickString(obj: Record<string, unknown>, key: string): string | undefined {
  const v = obj[key];
  return typeof v === "string" && v.trim() !== "" ? v.trim() : undefined;
}

/** 一次请求的端点信息（取自当前选用的档案） */
interface ChatEndpoint {
  baseUrl: string;
  apiKey: string;
  model: string;
}

interface ChatMessage {
  role: "system" | "user";
  content: string;
}

/** 调用 OpenAI 兼容接口，返回原始文本 */
async function chatCompletion(
  endpoint: ChatEndpoint,
  messages: ChatMessage[],
  signal?: AbortSignal
): Promise<string> {
  const base = endpoint.baseUrl.trim().replace(/\/+$/, "");
  const url = /\/chat\/completions$/.test(base)
    ? base
    : `${base}/chat/completions`;

  if (!endpoint.model.trim()) throw new AiRequestError("no-model");
  let resp: Response;
  try {
    resp = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${endpoint.apiKey.trim()}`,
      },
      body: JSON.stringify({
        model: endpoint.model.trim(),
        messages,
        temperature: 0.3,
        stream: false,
      }),
      signal,
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") throw err;
    throw new AiRequestError(
      "network:" + (err instanceof Error ? err.message : "fetch failed")
    );
  }

  if (!resp.ok) {
    let detail = "";
    try {
      const body = (await resp.json()) as {
        error?: { message?: string } | string;
      };
      detail =
        typeof body.error === "string"
          ? body.error
          : body.error?.message ?? "";
    } catch {
      /* ignore */
    }
    throw new AiRequestError(`http:${resp.status}:${detail}`);
  }

  const data = (await resp.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  const content = data.choices?.[0]?.message?.content ?? "";
  if (!content.trim()) throw new AiRequestError("empty");
  return content;
}

export interface TranslateParams {
  config: AiConfig;
  text: string;
  context: string;
  mode: TranslateMode;
  /** 目标语言 id（见 TARGET_LANGS），翻译/释义输出到该语言 */
  lang: string;
  signal?: AbortSignal;
}

/** 主入口：按模式构造 prompt 并解析结构化结果 */
export async function translateSelection(
  params: TranslateParams
): Promise<TranslateResult> {
  const { config, text, context, mode, lang, signal } = params;
  const target = targetLangName(lang);
  const contextBlock = context
    ? `\n\nContext (page text where the selection appears):\n"""\n${context}\n"""`
    : "";

  const system =
    mode === "word"
      ? wordSystemPrompt(target)
      : sentenceSystemPrompt(target);
  const user =
    mode === "word"
      ? `Selected text: "${text}"${contextBlock}`
      : `Selected text:\n"""\n${text}\n"""${contextBlock}`;

  const profile = getActiveProfile(config);
  if (!profile) throw new AiRequestError("no-model");

  const raw = await chatCompletion(
    profile,
    [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    signal
  );

  const parsed = extractJson(raw);
  if (!parsed) {
    return { mode, raw: raw.trim() };
  }
  if (mode === "sentence") {
    const translation =
      pickString(parsed, "translation") ?? pickString(parsed, "text");
    if (!translation) return { mode, raw: raw.trim() };
    return { mode, translation };
  }
  const senses = Array.isArray(parsed.senses)
    ? (parsed.senses as unknown[])
        .map((s) => {
          if (typeof s === "string") return { meaning: s };
          if (s && typeof s === "object") {
            const o = s as Record<string, unknown>;
            const meaning = pickString(o, "meaning") ?? pickString(o, "definition");
            if (!meaning) return null;
            return { pos: pickString(o, "pos") ?? pickString(o, "partOfSpeech"), meaning };
          }
          return null;
        })
        .filter((s): s is WordSense => s !== null)
    : [];
  return {
    mode,
    query: pickString(parsed, "query") ?? text,
    contextMeaning: pickString(parsed, "contextMeaning"),
    senses,
  };
}

/** 设置弹窗「测试连接」：发送一条最小请求验证配置可用 */
export async function testAiConnection(
  profile: AiProfile,
  signal?: AbortSignal
): Promise<void> {
  await chatCompletion(
    profile,
    [
      { role: "system", content: "You are a connectivity probe." },
      { role: "user", content: 'Reply with exactly: OK' },
    ],
    signal
  );
}

/** 把错误对象转成适合展示的简短信息（i18n key 或原文） */
export function describeAiError(err: unknown): string {
  if (!(err instanceof AiRequestError)) {
    return err instanceof Error ? err.message : String(err);
  }
  const msg = err.message;
  if (msg.startsWith("network:")) return "network";
  if (msg.startsWith("http:")) {
    const status = msg.slice(5, 8).trim();
    const detail = msg.slice(8).trim();
    return detail ? `http:${status}:${detail}` : `http:${status}`;
  }
  return msg;
}
