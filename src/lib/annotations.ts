/**
 * 用户自定义注释持久化（localStorage）。
 *
 * 照抄 progress.ts / bookmarks.ts 的模式：按「完整文件路径」记录每个文档的
 * 注释数组。注释的几何数据是「未旋转页面坐标系下的归一化矩形」（0~1，相对
 * 页宽/页高），与全文查找的 SearchRect 同空间 —— 渲染层在页面旋转时用同一套
 * rotateRect 变换，任意倍率下按百分比定位。选区捕获见 lib/textLayerSelection.ts
 * 的 captureSelectionRects()。
 */

import { readJson, storageKey, writeJson } from "./storage";

/** 注释类型 */
export type AnnotationType = "highlight" | "underline" | "strikeout" | "note";

/** 归一化矩形（未旋转页面坐标，0~1） */
export interface AnnoRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** 单条注释 */
export interface Annotation {
  /** 稳定唯一 id */
  id: string;
  type: AnnotationType;
  /** 页码（1-based） */
  page: number;
  /** 覆盖的文本行矩形（按视觉行合并后的若干块） */
  rects: AnnoRect[];
  /** 选中文本摘录（仅展示用，不参与匹配） */
  text: string;
  /** 批注正文（仅 type=note 有意义，其余类型恒为空串） */
  note: string;
  /** 落笔色（6 位 hex；几何类注释可自定义，旧数据缺省时渲染层用默认色） */
  color?: string;
  /** 创建/更新时间戳 */
  at: number;
}

/* ---------------- 颜色选择 ----------------
   每条几何注释可存自定义 color（6 位 hex）。颜色本身无需 i18n，色板按类型
   给"适合该呈现形态"的候选：
   - highlight：荧光笔效果，矩形渲染为该色 ~42% 半透明 → 给高亮度浅色系；
   - underline / strikeout：细线直接画该色 → 给饱和笔色系（含各类型默认色）。
   色板首项即默认色（旧数据 / 不选色时的回退观感）。 */

export type AnnoGeomType = "highlight" | "underline" | "strikeout";

export const ANNO_GEOM_TYPES: AnnoGeomType[] = [
  "highlight",
  "underline",
  "strikeout",
];

export const ANNO_COLORS: Record<AnnoGeomType, string[]> = {
  highlight: [
    "#ffd54f", // 黄（默认，≈旧观感）
    "#86efac", // 绿
    "#7dd3fc", // 天蓝
    "#fda4af", // 玫红
    "#fdba74", // 橙
    "#f9a8d4", // 粉
    "#d8b4fe", // 紫
  ],
  underline: [
    "#2563eb", // 蓝（默认）
    "#dc2626", // 红
    "#059669", // 绿
    "#9333ea", // 紫
    "#ea580c", // 橙
    "#db2777", // 品红
    "#0891b2", // 青
  ],
  strikeout: [
    "#dc2626", // 红（默认）
    "#2563eb", // 蓝
    "#059669", // 绿
    "#9333ea", // 紫
    "#ea580c", // 橙
    "#db2777", // 品红
    "#0891b2", // 青
  ],
};

/** 几何类型默认落笔色（= 色板首项） */
export const ANNO_DEFAULT_COLOR: Record<AnnoGeomType, string> = {
  highlight: ANNO_COLORS.highlight[0],
  underline: ANNO_COLORS.underline[0],
  strikeout: ANNO_COLORS.strikeout[0],
};

/** 合法 6 位 hex（供 UI 校验 / 持久化清洗） */
export function isValidAnnoColor(v: unknown): v is string {
  return typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v);
}

function hexToRgb(hex: string): [number, number, number] {
  const v = parseInt(hex.slice(1), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

/** hex → rgba() 字符串（高亮矩形以 ~42% 半透明铺色） */
export function annoFill(hex: string): string {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, 0.42)`;
}

/** chip / 文字色：亮度高的色（高亮浅色系）压暗到 ~0.45 亮度保证在小圆片上可读；
    本就偏深的笔色（下划线 / 删除线色板）原样返回 */
export function annoInk(hex: string): string {
  const [r, g, b] = hexToRgb(hex);
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  if (lum <= 0.6) return hex;
  const s = Math.min(0.45 / lum, 1);
  const map = (v: number) => Math.round(v * s);
  return `#${[map(r), map(g), map(b)].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

/* ---------------- 最近使用色记忆 ----------------
   每种几何类型记住「最近一次实际落笔的颜色」并持久化（origami.anno-last-color）。
   用途：色板上给对应色块加「上次使用」对勾标注；一级菜单项点击不选色时，
   直接用该类型最近使用的颜色创建（从未选过 → 回退类型默认色）。 */

const LAST_COLOR_KEY = storageKey("anno-last-color");
type LastColorStore = Partial<Record<AnnoGeomType, string>>;

/** 读取各几何类型最近一次使用的落笔色；从未选过 / 记录非法 → 类型默认色 */
export function loadLastColors(): Record<AnnoGeomType, string> {
  const out = { ...ANNO_DEFAULT_COLOR };
  const store = readJson<LastColorStore>(LAST_COLOR_KEY, {});
  for (const type of ANNO_GEOM_TYPES) {
    const v = store[type];
    if (isValidAnnoColor(v)) out[type] = v.toLowerCase();
  }
  return out;
}

/** 记录某几何类型最近一次使用的落笔色（6 位 hex，非法值忽略） */
export function saveLastColor(type: AnnoGeomType, hex: string): void {
  if (!isValidAnnoColor(hex)) return;
  const store = readJson<LastColorStore>(LAST_COLOR_KEY, {});
  store[type] = hex.toLowerCase();
  writeJson(LAST_COLOR_KEY, store);
}

/** 色块上对勾的绘制色：底偏浅（高亮系）用深灰勾、底偏深（笔色系）用白勾 */
export function annoMarkColor(hex: string): string {
  const [r, g, b] = hexToRgb(hex);
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return lum > 0.55 ? "rgba(17, 24, 39, 0.78)" : "#ffffff";
}

/** 图标 chip 配色（浮层头部 / 各处小方片）：icon 用 annoInk 压暗可读色，
    底用该色同色系半透明 tint —— 亮浅色系 0.34、深笔色系 0.14，随落笔色实时对应 */
export function annoIconTone(hex: string): {
  color: string;
  background: string;
} {
  const [r, g, b] = hexToRgb(hex);
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return {
    color: annoInk(hex),
    background: `rgba(${r}, ${g}, ${b}, ${lum > 0.6 ? 0.34 : 0.14})`,
  };
}

const KEY = storageKey("annotations");
/** 单个文档最多保留的注释条数 */
const MAX_PER_DOC = 2000;
/** 最多记录的文档数：超出丢弃最久未变动的 */
const MAX_DOCS = 200;

type Store = Record<string, Annotation[]>;

const lastAt = (list: Annotation[] | undefined): number =>
  list && list.length ? list[list.length - 1].at : 0;

function loadStore(): Store {
  return readJson<Store>(KEY, {});
}

function saveStore(store: Store): void {
  if (writeJson(KEY, store)) return;
  // 配额失败降级：按最后变动时间舍弃一半最旧文档后重试（再失败则放弃，仅内存生效）
  const keys = Object.keys(store);
  keys.sort((a, b) => lastAt(store[a]) - lastAt(store[b]));
  for (const k of keys.slice(0, Math.ceil(keys.length / 2))) delete store[k];
  writeJson(KEY, store);
}

/** 清洗单条记录：字段类型不合法即丢弃；返回 null 表示整条作废 */
function sanitize(raw: Annotation): Annotation | null {
  if (!raw || typeof raw !== "object") return null;
  if (typeof raw.page !== "number" || !Number.isFinite(raw.page)) return null;
  if (!Array.isArray(raw.rects) || raw.rects.length === 0) return null;
  const type =
    raw.type === "highlight" ||
    raw.type === "underline" ||
    raw.type === "strikeout" ||
    raw.type === "note"
      ? raw.type
      : null;
  if (!type) return null;
  const rects: AnnoRect[] = [];
  for (const r of raw.rects) {
    if (!r || typeof r !== "object") continue;
    const { x, y, w, h } = r as AnnoRect;
    if (![x, y, w, h].every((v) => typeof v === "number" && Number.isFinite(v)))
      continue;
    if (w < 0.0005 || h < 0.0005) continue; // 零尺寸矩形无意义
    rects.push({
      x: Math.min(1, Math.max(0, x)),
      y: Math.min(1, Math.max(0, y)),
      w: Math.min(1 - x, Math.max(0, w)),
      h: Math.min(1 - y, Math.max(0, h)),
    });
  }
  if (rects.length === 0) return null;
  return {
    id: typeof raw.id === "string" && raw.id ? raw.id : `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    type,
    page: raw.page,
    rects,
    text: typeof raw.text === "string" ? raw.text.slice(0, 500) : "",
    note: typeof raw.note === "string" ? raw.note.slice(0, 20000) : "",
    // 旧数据无 color：不落字段，渲染层回退到类型默认色
    ...(isValidAnnoColor(raw.color) ? { color: raw.color.toLowerCase() } : {}),
    at: typeof raw.at === "number" && Number.isFinite(raw.at) ? raw.at : 0,
  };
}

/** 读取某文档的注释，按添加先后返回；无记录或格式异常返回空数组 */
export function loadAnnotations(path: string): Annotation[] {
  const list = loadStore()[path];
  if (!Array.isArray(list)) return [];
  const out: Annotation[] = [];
  for (const raw of list) {
    const a = sanitize(raw);
    if (a) out.push(a);
  }
  return out;
}

/** 落盘：空列表删除该文档条目；超上限丢弃最旧的 */
function persist(path: string, list: Annotation[]): Annotation[] {
  const store = loadStore();
  if (list.length === 0) delete store[path];
  else {
    const trimmed = list.length > MAX_PER_DOC ? list.slice(list.length - MAX_PER_DOC) : list;
    store[path] = trimmed;
  }
  const keys = Object.keys(store);
  if (keys.length > MAX_DOCS) {
    keys
      .sort((a, b) => lastAt(store[a]) - lastAt(store[b]))
      .slice(0, keys.length - MAX_DOCS)
      .forEach((k) => delete store[k]);
  }
  saveStore(store);
  return store[path] ?? [];
}

function newId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

/** 两个归一化矩形是否高度重合（容差 0.01，用于防止同一选区误触二次添加） */
function rectsOverlap(a: AnnoRect[], b: AnnoRect[]): boolean {
  if (a.length === 0 || a.length !== b.length) return false;
  const tol = 0.012;
  for (let i = 0; i < a.length; i++) {
    const ra = a[i];
    const rb = b[i];
    if (
      Math.abs(ra.x - rb.x) > tol ||
      Math.abs(ra.y - rb.y) > tol ||
      Math.abs(ra.w - rb.w) > tol ||
      Math.abs(ra.h - rb.h) > tol
    ) {
      return false;
    }
  }
  return true;
}

/** 几何类注释（非 note）与同页同类型既有条目重合时跳过，避免重复点击误加 */
function isDuplicate(
  list: Annotation[],
  type: AnnotationType,
  page: number,
  rects: AnnoRect[]
): boolean {
  if (type === "note") return false;
  return list.some(
    (a) => a.type === type && a.page === page && rectsOverlap(a.rects, rects)
  );
}

export interface NewAnnotation {
  type: AnnotationType;
  page: number;
  rects: AnnoRect[];
  text: string;
  note?: string;
  /** 落笔色（6 位 hex）；缺省用类型默认色渲染 */
  color?: string;
}

/** 添加一条注释；与既有几何注释重合时跳过并返回 null（note 恒新增） */
export function addAnnotation(
  path: string,
  input: NewAnnotation
): Annotation[] | null {
  const list = loadAnnotations(path);
  if (isDuplicate(list, input.type, input.page, input.rects)) return null;
  const next = [
    ...list,
    {
      id: newId(),
      type: input.type,
      page: input.page,
      rects: input.rects,
      text: input.text,
      note: input.type === "note" ? (input.note ?? "") : "",
      ...(isValidAnnoColor(input.color) ? { color: input.color.toLowerCase() } : {}),
      at: Date.now(),
    },
  ];
  return persist(path, next);
}

/** 按 id 移除注释；返回最新列表 */
export function removeAnnotation(path: string, id: string): Annotation[] {
  const list = loadAnnotations(path);
  if (!list.some((a) => a.id === id)) return list;
  return persist(
    path,
    list.filter((a) => a.id !== id)
  );
}

/** 更新批注正文（仅 note 类型有意义）；返回最新列表，找不到 id 则原样返回 */
export function updateAnnotationNote(
  path: string,
  id: string,
  note: string
): Annotation[] {
  const list = loadAnnotations(path);
  const idx = list.findIndex((a) => a.id === id);
  if (idx < 0) return list;
  const next = [...list];
  next[idx] = { ...next[idx], note, at: Date.now() };
  return persist(path, next);
}

/** 修改几何注释的落笔色（note 无颜色概念，直接忽略）；找不到 id / 颜色非法则原样返回 */
export function updateAnnotationColor(
  path: string,
  id: string,
  color: string
): Annotation[] {
  if (!isValidAnnoColor(color)) return loadAnnotations(path);
  const list = loadAnnotations(path);
  const idx = list.findIndex((a) => a.id === id);
  if (idx < 0) return list;
  const target = list[idx];
  if (target.type === "note") return list;
  const next = [...list];
  next[idx] = { ...target, color: color.toLowerCase(), at: Date.now() };
  return persist(path, next);
}
