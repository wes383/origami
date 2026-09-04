/**
 * 统一的 localStorage 封装 — 全应用的持久化读写都从这里走。
 *
 * - 统一 key 前缀：storageKey() 生成 `origami.` 前缀的 key，禁止在业务代码里裸拼
 * - 读取自带 try/catch 兜底：存储不可用（隐私模式 / 已损坏）时返回 fallback
 * - 写入返回是否成功：调用方可据此降级（如收缩缓存条目后重试）
 * - LEGACY_KEY_MAP + migrateLegacyKeys() 提供版本迁移入口：
 *   旧前缀（pdfreader-* / 无前缀）的数据在模块加载时搬运到新 key
 */

const PREFIX = "origami.";

/** 生成带统一前缀的存储 key */
export function storageKey(name: string): string {
  return PREFIX + name;
}

/** 读取原始字符串；无记录或存储不可用时返回 null */
export function readText(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

/** 写入原始字符串；返回是否成功（配额满 / 存储不可用返回 false） */
export function writeText(key: string, value: string): boolean {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

/** 读取并解析 JSON；解析失败或存储不可用时返回 fallback */
export function readJson<T>(key: string, fallback: T): T {
  const raw = readText(key);
  if (raw == null) return fallback;
  try {
    const parsed = JSON.parse(raw);
    return (parsed ?? fallback) as T;
  } catch {
    return fallback;
  }
}

/** 序列化并写入 JSON；返回是否成功（失败时调用方可降级，如收缩数据重试） */
export function writeJson(key: string, value: unknown): boolean {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

/** 删除 key（存储不可用时静默） */
export function removeKey(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

/**
 * 旧 key → 新 key 迁移表（版本迁移入口）。
 * 新增迁移：在表里补一行「旧 key: storageKey("新名")」即可，
 * migrateLegacyKeys() 在模块加载时自动执行搬运。
 */
const LEGACY_KEY_MAP: Record<string, string> = {
  "pdfreader-ai-config": storageKey("ai-config"),
  "pdfreader-target-lang": storageKey("target-lang"),
  "pdfreader-theme": storageKey("theme"),
  "pdfreader-lang": storageKey("lang"),
  "pdfreader-sidebar-pref": storageKey("sidebar-pref"),
};

/** 迁移旧 key（一次即可幂等重复执行）：旧 key 有值且新 key 未写入时搬运，随后删除旧 key */
export function migrateLegacyKeys(): void {
  for (const [oldKey, newKey] of Object.entries(LEGACY_KEY_MAP)) {
    const raw = readText(oldKey);
    if (raw == null) continue;
    if (readText(newKey) == null) writeText(newKey, raw);
    removeKey(oldKey);
  }
}

migrateLegacyKeys();
