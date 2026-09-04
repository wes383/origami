/** 最近打开文件列表（localStorage 持久化） */

import { readJson, removeKey, storageKey, writeJson } from "./storage";

export interface RecentFile {
  path: string;
  name: string;
  /** 最后打开时间戳（ms）。仅随记录持久化，界面不展示 */
  at: number;
}

const KEY = storageKey("recent-files");
const MAX = 8;

export function loadRecent(): RecentFile[] {
  const parsed = readJson<unknown>(KEY, []);
  if (!Array.isArray(parsed)) return [];
  return parsed.filter(
    (item): item is RecentFile =>
      item && typeof item.path === "string" && typeof item.at === "number"
  );
}

/** 记录一次打开：去重置顶，超出上限丢弃最旧项，返回新列表 */
export function addRecent(path: string): RecentFile[] {
  const name = path.split(/[\\/]/).pop() ?? path;
  const next = [
    { path, name, at: Date.now() },
    ...loadRecent().filter((item) => item.path !== path),
  ].slice(0, MAX);
  // 写入失败（存储不可用/配额满）仅内存生效
  writeJson(KEY, next);
  return next;
}

export function clearRecent(): RecentFile[] {
  removeKey(KEY);
  return [];
}

/** 删除单条记录，返回新列表 */
export function removeRecent(path: string): RecentFile[] {
  const next = loadRecent().filter((item) => item.path !== path);
  writeJson(KEY, next);
  return next;
}
