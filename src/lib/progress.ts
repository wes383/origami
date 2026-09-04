/**
 * 阅读进度与视图偏好持久化（localStorage）。
 *
 * 按「完整文件路径」记录每个文档上次读到第几页，连同缩放模式、倍率、
 * 旋转、页面布局与翻页模式一起恢复——重开一本书不该每次都从封面开始。
 */

import type { PageLayout, FlipMode } from "../components/PdfViewer";
import { readJson, storageKey, writeJson } from "./storage";

/** 缩放模式：跟随宽度 / 适合页面 / 自定义倍率 */
export type ScaleMode = "fit-width" | "fit-page" | "custom";

/** 用户最后选择的 fit 模式（决定 fit 按钮下一次应用哪一种） */
export type FitIntent = "fit-width" | "fit-page";

export interface ReadProgress {
  page: number;
  scaleMode: ScaleMode;
  /** custom 模式下的倍率；fit 模式下由容器尺寸重算，此值仅作回显 */
  scale: number;
  fitIntent: FitIntent;
  /** 额外旋转角（0/90/180/270） */
  rotation: number;
  pageLayout: PageLayout;
  flipMode: FlipMode;
}

const KEY = storageKey("read-progress");
/** 最多保留的文档数：超出丢弃最久未读的 */
const MAX_ENTRIES = 200;

type Store = Record<string, ReadProgress & { at: number }>;

function loadStore(): Store {
  return readJson<Store>(KEY, {});
}

function saveStore(store: Store): void {
  if (writeJson(KEY, store)) return;
  // 配额失败降级：按最后阅读时间舍弃一半最旧条目后重试（再失败则放弃，仅内存生效）
  const keys = Object.keys(store);
  keys.sort((a, b) => (store[a].at ?? 0) - (store[b].at ?? 0));
  for (const k of keys.slice(0, Math.ceil(keys.length / 2))) delete store[k];
  writeJson(KEY, store);
}

/** 读取某文档的进度；无记录返回 null */
export function loadProgress(path: string): ReadProgress | null {
  const entry = loadStore()[path];
  if (!entry || typeof entry.page !== "number") return null;
  return {
    page: entry.page,
    scaleMode: entry.scaleMode ?? "custom",
    scale: entry.scale ?? 1,
    fitIntent: entry.fitIntent ?? "fit-page",
    rotation: entry.rotation ?? 0,
    pageLayout: entry.pageLayout ?? "single",
    flipMode: entry.flipMode ?? "scroll",
  };
}

/** 写入进度（去重置顶，超出上限丢弃最久未读的） */
export function saveProgress(path: string, progress: ReadProgress): void {
  const store = loadStore();
  delete store[path];
  store[path] = { ...progress, at: Date.now() };
  const keys = Object.keys(store);
  if (keys.length > MAX_ENTRIES) {
    // 按最后阅读时间升序，丢最旧的
    keys
      .sort((a, b) => (store[a].at ?? 0) - (store[b].at ?? 0))
      .slice(0, keys.length - MAX_ENTRIES)
      .forEach((k) => delete store[k]);
  }
  saveStore(store);
}
