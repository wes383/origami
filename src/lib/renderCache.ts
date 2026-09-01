/**
 * 渲染位图缓存（LRU + 内存预算）。
 *
 * 页面 canvas 与侧边栏缩略图都走这里：翻回上一页 / 重开文档时直接
 * drawImage 复用，跳过 pdf.js 的 render，消除翻页闪烁与重复解码。
 *
 * 按字节预算淘汰而非按条目数——不同缩放倍率下单个位图大小相差百倍，
 * 固定条数会让 500% 放大浏览时内存失控。
 */

/** 预算上限（192MB）：约 6~10 页 2x 高清位图，或数百张缩略图 */
const MAX_BYTES = 192 * 1024 * 1024;

interface CacheEntry {
  canvas: HTMLCanvasElement;
  bytes: number;
}

/** 插入顺序即 LRU 顺序（Map 保证迭代顺序），命中的键重新插入到末尾 */
const store = new Map<string, CacheEntry>();
let totalBytes = 0;

function byteSize(canvas: HTMLCanvasElement): number {
  // canvas backing store：RGBA 每像素 4 字节
  return canvas.width * canvas.height * 4;
}

/** 取缓存位图；命中后刷新为最近使用。返回的是缓存内部 canvas，只能读取 */
export function renderCacheGet(key: string): HTMLCanvasElement | undefined {
  const hit = store.get(key);
  if (!hit) return undefined;
  store.delete(key);
  store.set(key, hit);
  return hit.canvas;
}

/** 复制一份离屏位图存入缓存。超过预算时从最旧的条目开始淘汰 */
export function renderCacheSet(key: string, source: HTMLCanvasElement): void {
  const bytes = byteSize(source);
  // 单张就超过预算：存进去会立刻把其他全部挤掉，不如不存
  if (bytes === 0 || bytes > MAX_BYTES) return;

  const existing = store.get(key);
  if (existing) {
    store.delete(key);
    totalBytes -= existing.bytes;
    release(existing.canvas);
  }

  const copy = document.createElement("canvas");
  copy.width = source.width;
  copy.height = source.height;
  const ctx = copy.getContext("2d");
  // 拿不到 2d 上下文（极端环境）时放弃缓存，不影响渲染主流程
  if (!ctx) return;
  ctx.drawImage(source, 0, 0);

  store.set(key, { canvas: copy, bytes });
  totalBytes += bytes;
  evictIfNeeded();
}

function release(canvas: HTMLCanvasElement): void {
  // 置 0 可让浏览器立即回收 backing store，不必等 GC
  canvas.width = 0;
  canvas.height = 0;
}

function evictIfNeeded(): void {
  while (totalBytes > MAX_BYTES) {
    const oldest = store.keys().next();
    if (oldest.done) break;
    const entry = store.get(oldest.value);
    if (!entry) break;
    store.delete(oldest.value);
    totalBytes -= entry.bytes;
    release(entry.canvas);
  }
}

/** 切换文档时清空（当前 key 已含文档 id，通常不必调用；供极端内存压力兜底） */
export function renderCacheClear(): void {
  for (const entry of store.values()) release(entry.canvas);
  store.clear();
  totalBytes = 0;
}

/** 页面位图 key：文档 + 页号 + 倍率 + 旋转 + dpr 共同决定一张位图 */
export function pageCacheKey(
  docKey: string,
  pageNumber: number,
  scale: number,
  rotation: number,
  dpr: number
): string {
  return `page:${docKey}:${pageNumber}:${scale.toFixed(4)}:${rotation}:${dpr}`;
}

/** 缩略图 key：与页面位图分开命名空间，避免互相挤占 */
export function thumbCacheKey(docKey: string, pageNumber: number): string {
  return `thumb:${docKey}:${pageNumber}`;
}
