import { useEffect, useRef, useState } from "react";
import { TextLayer } from "pdfjs-dist";
import type { PDFDocumentProxy } from "pdfjs-dist";
import type { SearchRect } from "../lib/search";
import {
  bindTextLayerSelection,
  unbindTextLayerSelection,
} from "../lib/textLayerSelection";

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
  /** 本页的搜索高亮矩形（归一化坐标，与渲染进度无关立即上屏） */
  highlights: SearchRect[];
  /** 当前选中匹配 id（用于强调样式与滚动定位） */
  activeHighlightId: string | null;
}

export default function PdfPage({
  doc,
  pageNumber,
  scale,
  estimatedW,
  estimatedH,
  visible,
  highlights,
  activeHighlightId,
}: PdfPageProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const textLayerRef = useRef<HTMLDivElement | null>(null);
  const [rendered, setRendered] = useState(false);
  /** 本页真实尺寸（渲染后回填，替代按首页估算的占位值） */
  const [actualSize, setActualSize] = useState<{ w: number; h: number } | null>(null);

  useEffect(() => {
    // 倍率/文档变化时先清空旧文本层：其 span 按百分比定位，倍率变了会错位
    const container = textLayerRef.current;
    if (container) {
      container.replaceChildren();
      container.style.removeProperty("--total-scale-factor");
    }
    if (!visible) return;
    let cancelled = false;
    let renderTask: { cancel(): void } | null = null;
    let textLayer: TextLayer | null = null;

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
        if (cancelled) return;
        setRendered(true);

        // 文本层：把透明文字覆盖到 canvas 上，使页面内容可被选中 / 复制
        const textContent = await page.getTextContent();
        if (cancelled) return;
        const layerEl = textLayerRef.current;
        if (!layerEl) return;
        // TextLayer 用 --total-scale-factor 换算字号与容器尺寸（内部定位走百分比）
        layerEl.style.setProperty("--total-scale-factor", String(scale));
        textLayer = new TextLayer({
          textContentSource: textContent,
          container: layerEl,
          viewport,
        });
        await textLayer.render();
        if (cancelled) return;

        // endOfContent + 全局选区监听：修复"拖到空白区域意外选中大段文字 /
        // 选区被取消"（pdf.js 官方 viewer 同款方案，见 lib/textLayerSelection.ts）
        const endOfContent = document.createElement("div");
        endOfContent.className = "endOfContent";
        layerEl.append(endOfContent);
        bindTextLayerSelection(layerEl, endOfContent);
      } catch {
        /* 渲染取消或失败时静默处理 */
      }
    })();

    const layerDiv = textLayerRef.current;
    return () => {
      cancelled = true;
      renderTask?.cancel();
      textLayer?.cancel();
      if (layerDiv) unbindTextLayerSelection(layerDiv);
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
      {/* 搜索高亮层：位于 canvas 与文本层之间，不拦截鼠标（选区不受影响） */}
      {highlights.length > 0 && (
        <div className="pdf-hl-layer" aria-hidden="true">
          {highlights.map((r, i) => (
            <div
              key={`${r.matchId}-${i}`}
              data-hl={r.matchId}
              className={`pdf-hl ${r.matchId === activeHighlightId ? "is-active" : ""}`}
              style={{
                left: `${r.x * 100}%`,
                top: `${r.y * 100}%`,
                width: `${r.w * 100}%`,
                height: `${r.h * 100}%`,
              }}
            />
          ))}
        </div>
      )}
      <div ref={textLayerRef} className="pdf-text-layer" />
      {!rendered && (
        <div className="pdf-page-placeholder" aria-hidden="true">
          <span>{pageNumber}</span>
        </div>
      )}
    </div>
  );
}
