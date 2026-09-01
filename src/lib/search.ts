import { Util } from "pdfjs-dist";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { getPageTextContent } from "./pageText";

/* ==========================================================================
   全文查找
   ========================================================================== */

/** 归一化（0~1，相对页宽/页高）的高亮矩形，任意缩放下按百分比定位 */
export interface SearchRect {
  /** 所属匹配 id */
  matchId: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface SearchMatch {
  /** 稳定 id：`${页码}-${序号}` */
  id: string;
  page: number;
  /** 匹配文本 */
  text: string;
  /** 前后各约 40 字符的上下文（已压缩空白） */
  before: string;
  after: string;
  /** 高亮矩形（一条匹配可能跨多个文本 run） */
  rects: SearchRect[];
}

/** getTextContent 条目中最小可用的文本 run 结构 */
interface TextRunLike {
  str: string;
  transform: number[];
  width: number;
}

const CONTEXT_CHARS = 40;
/** 基线以上 ascent 占字号的比例（pdf.js 文本层无字体数据时的同款近似） */
const ASCENT_RATIO = 0.8;

export interface SearchOptions {
  /** 每命中有匹配的一页回调一次；返回 false 立即中止 */
  onPage: (matches: SearchMatch[]) => boolean;
  /** 每扫描完一页回调一次（含无匹配的页）；返回 false 立即中止 */
  onProgress?: (scanned: number, total: number) => boolean;
}

/**
 * 在文档中查找（不区分大小写），逐页流式回调。
 * 任意回调返回 false 即中止（用于搜索词变更或用户点击停止）。
 */
export async function searchDocument(
  doc: PDFDocumentProxy,
  query: string,
  options: SearchOptions
): Promise<void> {
  const { onPage, onProgress } = options;
  const needle = query.toLowerCase();
  if (!needle) return;

  const total = doc.numPages;
  for (let p = 1; p <= total; p++) {
    // 单页失败跳过，不中断整体搜索
    let page: Awaited<ReturnType<PDFDocumentProxy["getPage"]>>;
    try {
      page = await doc.getPage(p);
    } catch {
      continue;
    }
    const viewport = page.getViewport({ scale: 1 });

    const runs: { run: TextRunLike; start: number }[] = [];
    let text = "";
    try {
      // 走共享缓存：渲染文本层时已经取过一次的不必再解析
      const content = await getPageTextContent(doc, p);
      // 拼接整页文本并记录每个 run 的起始偏移，
      // 使跨 run（PDF 常把一个词拆成多个 run）的匹配也能命中
      for (const raw of content.items) {
        const item = raw as Partial<TextRunLike>;
        if (typeof item.str !== "string" || !item.str) continue;
        runs.push({
          run: {
            str: item.str,
            transform: item.transform ?? [1, 0, 0, 1, 0, 0],
            width: item.width ?? 0,
          },
          start: text.length,
        });
        text += item.str;
      }
    } catch {
      continue;
    }

    const hay = text.toLowerCase();
    const matches: SearchMatch[] = [];
    let idx = hay.indexOf(needle);
    while (idx !== -1) {
      const end = idx + needle.length;

      // 字符区间映射回文本 run，换算成页面归一化矩形
      const rects: SearchRect[] = [];
      for (const { run, start } of runs) {
        const runEnd = start + run.str.length;
        if (runEnd <= idx || start >= end) continue;
        const s = Math.max(0, idx - start);
        const e = Math.min(run.str.length, end - start);

        const tx = Util.transform(viewport.transform, run.transform);
        const fontHeight = Math.hypot(tx[2], tx[3]);
        // 按字符均分 run 宽度估算偏移（足够定位高亮）
        const charW = run.str.length ? run.width / run.str.length : 0;
        const x = tx[4] + s * charW;
        const w = (e - s) * charW;
        const y = tx[5] - fontHeight * ASCENT_RATIO;
        rects.push({
          matchId: "",
          x: x / viewport.width,
          y: y / viewport.height,
          w: w / viewport.width,
          h: fontHeight / viewport.height,
        });
      }

      matches.push({
        id: `${p}-${matches.length}`,
        page: p,
        text: text.slice(idx, end).replace(/\s+/g, " "),
        before: text
          .slice(Math.max(0, idx - CONTEXT_CHARS), idx)
          .replace(/\s+/g, " ")
          .trimStart(),
        after: text
          .slice(end, end + CONTEXT_CHARS)
          .replace(/\s+/g, " ")
          .trimEnd(),
        rects,
      });
      idx = hay.indexOf(needle, end);
    }

    if (matches.length) {
      // 矩形先于匹配对象生成，这里回填所属匹配 id
      for (const m of matches) {
        for (const r of m.rects) r.matchId = m.id;
      }
      if (!onPage(matches)) return;
    }

    if (onProgress && !onProgress(p, total)) return;
  }
}
