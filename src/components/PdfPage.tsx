import { useEffect, useRef, useState } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";

interface PdfPageProps {
  doc: PDFDocumentProxy;
  pageNumber: number;
  /** 当前生效缩放倍率 */
  scale: number;
  /** 按首页尺寸估算的占位宽高（CSS px），防止滚动跳动 */
  estimatedW: number;
  estimatedH: number;
  /** 是否进入懒渲染缓冲区 */
  visible: boolean;
}

export default function PdfPage({
  doc,
  pageNumber,
  scale,
  estimatedW,
  estimatedH,
  visible,
}: PdfPageProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [rendered, setRendered] = useState(false);
  /** 本页真实尺寸（渲染后回填，替代按首页估算的占位值） */
  const [actualSize, setActualSize] = useState<{ w: number; h: number } | null>(null);

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    let renderTask: { cancel(): void } | null = null;

    (async () => {
      try {
        const page = await doc.getPage(pageNumber);
        if (cancelled) return;
        const viewport = page.getViewport({ scale });
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const canvas = canvasRef.current;
        if (!canvas) return;

        const w = Math.floor(viewport.width);
        const h = Math.floor(viewport.height);
        canvas.width = Math.floor(viewport.width * dpr);
        canvas.height = Math.floor(viewport.height * dpr);
        canvas.style.width = `${w}px`;
        canvas.style.height = `${h}px`;
        // 各页尺寸可能与首页不同：用真实尺寸替换估算占位，防止 overflow:hidden 裁掉底部
        setActualSize({ w, h });

        const task = page.render({
          canvas,
          viewport,
          // canvas  backing store 放大了 dpr 倍，需同步缩放绘制内容，否则内容只占左上角 1/dpr²
          transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined,
        });
        renderTask = task;
        await task.promise;
        if (!cancelled) setRendered(true);
      } catch {
        /* 渲染取消或失败时静默处理 */
      }
    })();

    return () => {
      cancelled = true;
      renderTask?.cancel();
    };
  }, [doc, pageNumber, scale, visible]);

  const boxW = actualSize?.w ?? Math.floor(estimatedW);
  const boxH = actualSize?.h ?? Math.floor(estimatedH);

  return (
    <div
      className="pdf-page"
      data-page={pageNumber}
      style={{ width: boxW, height: boxH }}
    >
      <canvas ref={canvasRef} className={rendered ? "is-rendered" : ""} />
      {!rendered && (
        <div className="pdf-page-placeholder" aria-hidden="true">
          <span>{pageNumber}</span>
        </div>
      )}
    </div>
  );
}
