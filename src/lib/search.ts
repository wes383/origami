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
/** 命中总数上限：大文档全词/高频词可能上万条，封顶保护 UI 与内存 */
export const DEFAULT_MATCH_LIMIT = 500;

export interface SearchOptions {
  /** 每命中有匹配的一页回调一次；返回 false 立即中止 */
  onPage: (matches: SearchMatch[], truncated: boolean) => boolean;
  /** 每扫描完一页回调一次（含无匹配的页）；返回 false 立即中止 */
  onProgress?: (scanned: number, total: number) => boolean;
  /** 匹配选项；缺省为不区分大小写的普通子串查找 */
  flags?: SearchFlags;
  /** 命中总数上限（默认 500）：全词/高频词在大文档可能上万条，
      超限即停止扫描并在 onPage 回调标记 truncated */
  limit?: number;
}

/** 匹配选项 */
export interface SearchFlags {
  /** 区分大小写（默认 false） */
  caseSensitive?: boolean;
  /** 全词匹配（默认 false）：前后边界不能是字母/数字（CJK 天然按词边界，不受影响） */
  wholeWord?: boolean;
  /** 正则模式（默认 false）：query 按 RegExp 语法解析，非法正则整次搜索直接中止 */
  regex?: boolean;
}

/** 匹配引擎：把三档开关收敛成一个 next(start) → { index, end } 迭代器 */
interface Matcher {
  /** 从 start 起找下一个命中；无命中返回 null */
  next: (start: number) => { index: number; end: number } | null;
}

/** 编译非法正则时抛出的错误类型（SearchBar 捕获后提示用户） */
export class InvalidRegexError extends Error {}

const WORD_CHAR = /[A-Za-z0-9_]/;

/** 边界判定：pos 处的字符是否为词内字符（用于全词匹配） */
function isWordChar(text: string, pos: number): boolean {
  const c = text[pos];
  return c !== undefined && WORD_CHAR.test(c);
}

/** 构建匹配器（每页调用一次，传入当页全文）。RegExp 模式已提前校验零宽匹配 */
function buildMatcher(query: string, flags: SearchFlags, text: string): Matcher {
  const hay = flags.caseSensitive ? text : text.toLowerCase();
  if (flags.regex) {
    let re: RegExp;
    try {
      re = new RegExp(query, flags.caseSensitive ? "g" : "gi");
    } catch {
      throw new InvalidRegexError(query);
    }
    return {
      next: (start) => {
        // lastIndex 手动推进：start 前的内容已消费（含跨页正确性）
        if (re.lastIndex < start) re.lastIndex = start;
        const m = re.exec(hay);
        if (!m) return null;
        // 零宽匹配已由入口校验排除；保险起见 end 至少前进 1
        return { index: m.index, end: m.index + Math.max(1, m[0].length) };
      },
    };
  }
  const needle = flags.caseSensitive ? query : query.toLowerCase();
  if (!needle) return { next: () => null };
  if (flags.wholeWord) {
    return {
      next: (start) => {
        let idx = hay.indexOf(needle, start);
        while (idx !== -1) {
          const end = idx + needle.length;
          // 前后都不是词内字符才算全词命中；否则继续找下一个
          if (!isWordChar(hay, idx - 1) && !isWordChar(hay, end)) {
            return { index: idx, end };
          }
          idx = hay.indexOf(needle, idx + 1);
        }
        return null;
      },
    };
  }
  return {
    next: (start) => {
      const index = hay.indexOf(needle, start);
      return index === -1 ? null : { index, end: index + needle.length };
    },
  };
}

/**
 * 在文档中查找，逐页流式回调。
 * 任意回调返回 false 即中止（用于搜索词变更或用户点击停止）。
 * flags 控制大小写 / 全词 / 正则；limit 封顶总命中数（超限停止扫描）。
 */
export async function searchDocument(
  doc: PDFDocumentProxy,
  query: string,
  options: SearchOptions
): Promise<void> {
  const { onPage, onProgress, flags = {}, limit = DEFAULT_MATCH_LIMIT } = options;
  if (!query) return;

  // 正则模式：预校验。零宽匹配（如 /a*/）会让命中循环死循环，直接拒绝
  if (flags.regex) {
    let probe: RegExp;
    try {
      probe = new RegExp(query, flags.caseSensitive ? "" : "i");
    } catch {
      throw new InvalidRegexError(query);
    }
    if (probe.exec("") !== null) throw new InvalidRegexError(query);
  }

  const total = doc.numPages;
  let matchCount = 0;
  for (let p = 1; p <= total; p++) {
    // 命中上限保护：达到 limit 即停止扫描（最后一页结果已照常上抛）
    if (matchCount >= limit) break;
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

    // 匹配器以当前页文本构建（正则的 lastIndex 初始为 0）
    const matcher = buildMatcher(query, flags, text);
    const matches: SearchMatch[] = [];
    let cursor = 0;
    while (matchCount + matches.length < limit) {
      const hit = matcher.next(cursor);
      if (!hit) break;
      const { index: idx, end } = hit;

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
      // 正则模式下零宽匹配已由入口校验排除，此处 end > idx 恒成立；
      // cursor 推进保证不会停在原地
      cursor = Math.max(end, idx + 1);
    }
    matchCount += matches.length;

    if (matches.length) {
      // 矩形先于匹配对象生成，这里回填所属匹配 id
      for (const m of matches) {
        for (const r of m.rects) r.matchId = m.id;
      }
      // matchCount >= limit 表示已达上限（本轮填满），告知调用方已截断
      if (!onPage(matches, matchCount >= limit)) return;
    }

    if (onProgress && !onProgress(p, total)) return;
  }
}
