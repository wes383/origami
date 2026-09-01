import type { PDFDocumentProxy } from "pdfjs-dist";

/* ==========================================================================
   打印：把所选页渲染为高分辨率位图，构建打印专用 DOM 后调起系统打印
   ========================================================================== */

/** 打印分辨率（PDF 单位 72dpi，2 倍即约 144dpi，兼顾清晰度与内存） */
const PRINT_SCALE = 2;

/** 解析 "1-3, 5, 8-10" 形式的页码范围；非法片段忽略。返回升序去重页码数组 */
export function parsePageRanges(input: string, numPages: number): number[] {
  const pages = new Set<number>();
  for (const part of input.split(/[,，]/)) {
    const seg = part.trim();
    if (!seg) continue;
    // 单页 "5" 或区间 "2-6"
    const m = seg.match(/^(\d+)\s*(?:-\s*(\d+))?$/);
    if (!m) continue;
    const start = Number(m[1]);
    const end = m[2] ? Number(m[2]) : start;
    if (start < 1 || end < 1 || start > numPages || end > numPages) continue;
    for (let p = Math.min(start, end); p <= Math.max(start, end); p++) {
      pages.add(p);
    }
  }
  return [...pages].sort((a, b) => a - b);
}

/**
 * 渲染指定页并调起打印对话框。
 * 打印期间在 body 下挂载 .print-root（仅 @media print 可见），
 * window.print() 返回（对话框关闭）后清理。
 * onProgress 汇报渲染进度（0~1）。
 */
export async function printDocument(
  doc: PDFDocumentProxy,
  pages: number[],
  onProgress?: (done: number, total: number) => void
): Promise<void> {
  const container = document.createElement("div");
  container.className = "print-root";

  const total = pages.length;
  const canvases: HTMLCanvasElement[] = [];
  let done = 0;
  for (const p of pages) {
    const page = await doc.getPage(p);
    const viewport = page.getViewport({ scale: PRINT_SCALE });
    const canvas = document.createElement("canvas");
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    await page.render({ canvas, viewport }).promise;

    // 直接把 canvas 挂进打印 DOM：转成 dataURL 会同时驻留 JPEG 编码副本
    // 与 base64 字符串，百页级文档峰值内存直接翻倍且容易 OOM
    container.appendChild(canvas);
    canvases.push(canvas);
    done += 1;
    onProgress?.(done, total);
  }

  document.body.appendChild(container);
  try {
    window.print();
  } finally {
    container.remove();
    // 打印对话框关闭后立即回收 backing store（置 0 触发浏览器释放）
    for (const canvas of canvases) {
      canvas.width = 0;
      canvas.height = 0;
    }
  }
}
