/** 最近打开文件列表（localStorage 持久化） */

export interface RecentFile {
  path: string;
  name: string;
  /** 最后打开时间戳（ms）。仅随记录持久化，界面不展示 */
  at: number;
}

const KEY = "origami.recent-files";
const MAX = 8;

export function loadRecent(): RecentFile[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is RecentFile =>
        item && typeof item.path === "string" && typeof item.at === "number"
    );
  } catch {
    return [];
  }
}

/** 记录一次打开：去重置顶，超出上限丢弃最旧项，返回新列表 */
export function addRecent(path: string): RecentFile[] {
  const name = path.split(/[\\/]/).pop() ?? path;
  const next = [
    { path, name, at: Date.now() },
    ...loadRecent().filter((item) => item.path !== path),
  ].slice(0, MAX);
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* 存储不可用时仅内存生效 */
  }
  return next;
}

export function clearRecent(): RecentFile[] {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
  return [];
}

/** 删除单条记录，返回新列表 */
export function removeRecent(path: string): RecentFile[] {
  const next = loadRecent().filter((item) => item.path !== path);
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* ignore */
  }
  return next;
}
