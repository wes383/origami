import * as pdfjsLib from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import type { PDFDocumentProxy } from "pdfjs-dist";

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

export type { PDFDocumentProxy };

export interface OpenedPdf {
  doc: PDFDocumentProxy;
  /** 销毁文档及其 worker 资源 */
  destroy: () => Promise<void>;
}

export async function openPdf(data: Uint8Array): Promise<OpenedPdf> {
  const task = pdfjsLib.getDocument({ data });
  const doc = await task.promise;
  return { doc, destroy: () => task.destroy() };
}

/* ==========================================================================
   目录（PDF Outline）
   ========================================================================== */

/** 解析后的目录节点 */
export interface OutlineNode {
  /** 稳定 id：基于路径索引生成（如 "0/2/1"），用于展开状态与高亮定位 */
  id: string;
  /** 目录条目标题（PDF 中可能为空字符串） */
  title: string;
  /** 跳转目标页码（1 基）；无法解析时为 null */
  page: number | null;
  /** 子目录 */
  children: OutlineNode[];
}

/** 将目录条目 dest 解析为 1 基页码；失败返回 null */
async function resolveDestPage(
  doc: PDFDocumentProxy,
  dest: unknown
): Promise<number | null> {
  try {
    // 命名目标（字符串）→ 先查引用数组；直接目标本身就是数组
    const explicit = typeof dest === "string" ? await doc.getDestination(dest) : dest;
    // 目标数组的第一个元素是页面引用对象（RefProxy）
    if (Array.isArray(explicit) && explicit[0]) {
      const index = await doc.getPageIndex(explicit[0] as Parameters<typeof doc.getPageIndex>[0]);
      return index + 1;
    }
  } catch {
    /* 单个条目解析失败不应拖垮整棵目录 */
  }
  return null;
}

/**
 * 解析文档目录树。
 * pdf.js 返回的 outline 每项含 title / dest / items（子级数组）；
 * 此处递归转换为 OutlineNode 并把 dest 预解析为页码。
 */
export async function loadOutline(doc: PDFDocumentProxy): Promise<OutlineNode[]> {
  let raw: Awaited<ReturnType<PDFDocumentProxy["getOutline"]>>;
  try {
    raw = await doc.getOutline();
  } catch {
    return [];
  }
  if (!raw || raw.length === 0) return [];

  const walk = async (
    items: NonNullable<Awaited<ReturnType<PDFDocumentProxy["getOutline"]>>>,
    prefix: string
  ): Promise<OutlineNode[]> => {
    const out: OutlineNode[] = [];
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      out.push({
        id: `${prefix}${i}`,
        title: (item.title ?? "").replace(/\s+/g, " ").trim(),
        page: await resolveDestPage(doc, item.dest),
        children: item.items?.length
          ? await walk(item.items, `${prefix}${i}/`)
          : [],
      });
    }
    return out;
  };

  return walk(raw, "");
}
