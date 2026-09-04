/**
 * 用户自定义书签持久化（localStorage）。
 *
 * 完全照抄 progress.ts 的模式：按「完整文件路径」记录每个文档的书签列表
 * { page, label, at }[]。目录大纲是 PDF 自带的，这里是用户自己想标记的位置，
 * 重开一本书或换用其他支持本格式的阅读器都能恢复（数据落在本地存储，跟随文件路径）。
 */

import { readJson, storageKey, writeJson } from "./storage";

/** 单个书签：页码、可选标签、添加时间戳 */
export interface Bookmark {
  page: number;
  /** 用户可读标签；空字符串表示仅按页码标记 */
  label: string;
  /** 添加/更新时间戳，用于排序与清理策略 */
  at: number;
}

const KEY = storageKey("bookmarks");
/** 最多保留的文档数：超出丢弃最久未变动的 */
const MAX_ENTRIES = 500;

type Store = Record<string, Bookmark[]>;

function loadStore(): Store {
  return readJson<Store>(KEY, {});
}

function saveStore(store: Store): void {
  if (writeJson(KEY, store)) return;
  // 配额失败降级：按最后变动时间舍弃一半最旧条目后重试（再失败则放弃，仅内存生效）
  const keys = Object.keys(store);
  keys.sort((a, b) => lastAt(store[a]) - lastAt(store[b]));
  for (const k of keys.slice(0, Math.ceil(keys.length / 2))) delete store[k];
  writeJson(KEY, store);
}

/** 列表中最后一条书签的时间戳（无书签时记 0） */
const lastAt = (list: Bookmark[] | undefined): number =>
  list && list.length ? list[list.length - 1].at : 0;

/** 读取某文档的书签，按页码升序；无记录或格式异常返回空数组 */
export function loadBookmarks(path: string): Bookmark[] {
  const list = loadStore()[path];
  if (!Array.isArray(list)) return [];
  return list
    .filter((b) => b && typeof b.page === "number" && Number.isFinite(b.page))
    .map((b) => ({
      page: b.page,
      label: typeof b.label === "string" ? b.label : "",
      at: b.at ?? 0,
    }))
    .sort((a, b) => a.page - b.page);
}

/** 某页是否已加书签（每页至多一条） */
export function isBookmarked(path: string, page: number): boolean {
  return loadBookmarks(path).some((b) => b.page === page);
}

/** 落盘：排序后写回，空列表则删除该文档条目；超出上限丢弃最久未变动的 */
function persist(path: string, list: Bookmark[]): Bookmark[] {
  const sorted = [...list].sort((a, b) => a.page - b.page);
  const store = loadStore();
  if (sorted.length === 0) delete store[path];
  else store[path] = sorted;

  const keys = Object.keys(store);
  if (keys.length > MAX_ENTRIES) {
    keys
      .sort((a, b) => lastAt(store[a]) - lastAt(store[b]))
      .slice(0, keys.length - MAX_ENTRIES)
      .forEach((k) => delete store[k]);
  }
  saveStore(store);
  return sorted;
}

/** 添加书签（每页至多一条：已存在则更新标签与时间，不重复添加） */
export function addBookmark(path: string, page: number, label = ""): Bookmark[] {
  const list = loadBookmarks(path).filter((b) => b.page !== page);
  list.push({ page, label, at: Date.now() });
  return persist(path, list);
}

/** 移除指定索引处的书签（列表条目顺序稳定，索引来自 loadBookmarks 的返回） */
export function removeBookmarkAt(path: string, index: number): Bookmark[] {
  const list = loadBookmarks(path);
  if (index < 0 || index >= list.length) return list;
  list.splice(index, 1);
  return persist(path, list);
}

/** 重命名指定索引处的书签（索引来自 loadBookmarks 的返回）；label 传空串表示恢复默认标题 */
export function renameBookmark(path: string, index: number, label: string): Bookmark[] {
  const list = loadBookmarks(path);
  if (index < 0 || index >= list.length) return list;
  const next = [...list];
  next[index] = { ...next[index], label, at: Date.now() };
  return persist(path, next);
}

/** 按页码移除书签 */
export function removeBookmarkPage(path: string, page: number): Bookmark[] {
  return persist(
    path,
    loadBookmarks(path).filter((b) => b.page !== page)
  );
}

/** 切换当前页书签：已标记则移除，未标记则添加；返回最新列表 */
export function toggleBookmark(path: string, page: number, label = ""): Bookmark[] {
  const list = loadBookmarks(path);
  if (list.some((b) => b.page === page)) {
    return persist(
      path,
      list.filter((b) => b.page !== page)
    );
  }
  list.push({ page, label, at: Date.now() });
  return persist(path, list);
}
