/**
 * 整页文本内容缓存。
 *
 * getTextContent 是搜索与文本层共用的开销来源：全文查找会逐页调用一遍，
 * 之后每页渲染文本层时又各调一次。这里按「文档 + 页号」缓存结果，
 * 让查找、渲染、AI 上下文三条路径共享同一份数据。
 */

import type { PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist";
import { docKey } from "./pdf";

/** pdf.js 未稳定导出 TextContent 类型，从方法返回值反推 */
export type PageTextContent = Awaited<ReturnType<PDFPageProxy["getTextContent"]>>;

/** 上限页数：约 300 页文本（每页数 KB~数十 KB），超出按插入顺序淘汰 */
const MAX_PAGES = 300;

const store = new Map<string, PageTextContent>();

export async function getPageTextContent(
  doc: PDFDocumentProxy,
  pageNumber: number
): Promise<PageTextContent> {
  const key = `${docKey(doc)}:${pageNumber}`;
  const hit = store.get(key);
  if (hit) {
    // 刷新为最近使用
    store.delete(key);
    store.set(key, hit);
    return hit;
  }
  const page = await doc.getPage(pageNumber);
  const content = await page.getTextContent();
  store.set(key, content);
  while (store.size > MAX_PAGES) {
    const oldest = store.keys().next();
    if (oldest.done) break;
    store.delete(oldest.value);
  }
  return content;
}

/** 切换文档后旧文本不再需要；key 已含文档 id，仅在内存紧张时调用 */
export function clearPageTextCache(): void {
  store.clear();
}
