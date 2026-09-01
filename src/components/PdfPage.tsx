import { memo, useEffect, useRef, useState } from "react";
import { TextLayer } from "pdfjs-dist";
import type { PDFDocumentProxy } from "pdfjs-dist";
import type { SearchRect } from "../lib/search";
import { docKey } from "../lib/pdf";
import { getPageTextContent } from "../lib/pageText";
import { pageCacheKey, renderCacheGet, renderCacheSet } from "../lib/renderCache";
import {
  bindTextLayerSelection,
  unbindTextLayerSelection,
} from "../lib/textLayerSelection";
import {
  getPdfLinkOverlays,
  type PdfDestination,
  type PdfLinkOverlay,
} from "../lib/pdfLinks";

interface PdfPageProps {
  doc: PDFDocumentProxy;
  pageNumber: number;
  /** 当前生效缩放倍率 */
  scale: number;
  /** 额外旋转角（0/90/180/270，顺时针；与页面自带旋转叠加） */
  rotation: number;
  /** 按首页尺寸估算的占位宽高（CSS px），防止滚动跳动 */
  estimatedW: number;
  estimatedH: number;
  /** 是否进入懒渲染缓冲区 */
  visible: boolean;
  /** 本页的搜索高亮矩形（归一化坐标，与渲染进度无关立即上屏） */
  highlights: SearchRect[];
  /** 当前选中匹配 id（用于强调样式与滚动定位） */
  activeHighlightId: string | null;
  /** 点击 PDF 内部链接时导航到目标位置 */
  onInternalLink: (destination: PdfDestination) => void;
  /** 点击外部链接时交给宿主环境打开 */
  onExternalLink: (url: string) => void;
}

/**
 * 归一化矩形随页面旋转（顺时针）变换：
 * 90°/270° 时宽高互换，坐标绕归一化单位方块旋转
 */
function rotateRect(r: SearchRect, rotation: number): SearchRect {
  switch (((rotation % 360) + 360) % 360) {
    case 90:
      return { ...r, x: 1 - (r.y + r.h), y: r.x, w: r.h, h: r.w };
    case 180:
      return { ...r, x: 1 - (r.x + r.w), y: 1 - (r.y + r.h) };
    case 270:
      return { ...r, x: r.y, y: 1 - (r.x + r.w), w: r.h, h: r.w };
    default:
      return r;
  }
}

function PdfPage({
  doc,
  pageNumber,
  scale,
  rotation,
  estimatedW,
  estimatedH,
  visible,
  highlights,
  activeHighlightId,
  onInternalLink,
  onExternalLink,
}: PdfPageProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const textLayerRef = useRef<HTMLDivElement | null>(null);
  const [rendered, setRendered] = useState(false);
  /** 本页真实尺寸（渲染后回填，替代按首页估算的占位值） */
  const [actualSize, setActualSize] = useState<{ w: number; h: number } | null>(null);
  const [links, setLinks] = useState<PdfLinkOverlay[]>([]);

  useEffect(() => {
    // 倍率/文档变化时先清空旧文本层：其 span 按百分比定位，倍率变了会错位
    const container = textLayerRef.current;
    if (container) {
      container.replaceChildren();
      container.style.removeProperty("--total-scale-factor");
    }
    setLinks([]);
    if (!visible) return;
    let cancelled = false;
    let renderTask: { cancel(): void } | null = null;
    let textLayer: TextLayer | null = null;

    (async () => {
      try {
        const page = await doc.getPage(pageNumber);
        if (cancelled) return;
        // viewport.rotation 参数是绝对值（会覆盖页面自带旋转），需叠加页内原始旋转
        const viewport = page.getViewport({
          scale,
          rotation: (page.rotate + rotation) % 360,
        });
        // 链接注释与页面渲染并行读取；后续按同一个 viewport 生成命中区域。
        const annotationsPromise = page.getAnnotations().catch(() => []);
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const canvas = canvasRef.current;
        if (!canvas) return;

        const w = Math.floor(viewport.width);
        const h = Math.floor(viewport.height);
        canvas.style.width = `${w}px`;
        canvas.style.height = `${h}px`;
        // 各页尺寸可能与首页不同：用真实尺寸替换估算占位，防止 overflow:hidden 裁掉底部
        setActualSize({ w, h });

        // 位图缓存：翻回上一页 / 重开文档时直接贴图，跳过 pdf.js 渲染
        const cacheKey = pageCacheKey(docKey(doc), pageNumber, scale, rotation, dpr);
        const cached = renderCacheGet(cacheKey);
        if (cached) {
          canvas.width = cached.width;
          canvas.height = cached.height;
          const ctx = canvas.getContext("2d");
          if (ctx) ctx.drawImage(cached, 0, 0);
          if (cancelled) return;
          setRendered(true);
        } else {
          canvas.width = Math.floor(viewport.width * dpr);
          canvas.height = Math.floor(viewport.height * dpr);
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
          renderCacheSet(cacheKey, canvas);
        }

        // 文本层：把透明文字覆盖到 canvas 上，使页面内容可被选中 / 复制
        // 走共享缓存，渲染与全文查找复用同一份解析结果
        const textContent = await getPageTextContent(doc, pageNumber);
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

        const annotations = await annotationsPromise;
        if (cancelled) return;
        setLinks(getPdfLinkOverlays(annotations, viewport));

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
  }, [doc, pageNumber, scale, rotation, visible]);

  const boxW = actualSize?.w ?? Math.floor(estimatedW);
  const boxH = actualSize?.h ?? Math.floor(estimatedH);

  return (
    <div
      className="pdf-page"
      data-page={pageNumber}
      style={{ width: boxW, height: boxH }}
    >
      <canvas ref={canvasRef} className={rendered ? "is-rendered" : ""} />
      {/* 搜索高亮层：位于 canvas 与文本层之间，不拦截鼠标（选区不受影响）。
          矩形基于未旋转页面归一化坐标，旋转时同步变换 */}
      {highlights.length > 0 && (
        <div className="pdf-hl-layer" aria-hidden="true">
          {highlights.map((r, i) => {
            const rr = rotateRect(r, rotation);
            return (
              <div
                key={`${r.matchId}-${i}`}
                data-hl={r.matchId}
                className={`pdf-hl ${r.matchId === activeHighlightId ? "is-active" : ""}`}
                style={{
                  left: `${rr.x * 100}%`,
                  top: `${rr.y * 100}%`,
                  width: `${rr.w * 100}%`,
                  height: `${rr.h * 100}%`,
                }}
              />
            );
          })}
        </div>
      )}
      <div ref={textLayerRef} className="pdf-text-layer" />
      {links.length > 0 && (
        <div className="pdf-link-layer">
          {links.map((link) => (
            <a
              key={link.id}
              className="pdf-link"
              href={link.url ?? "#"}
              title={link.url ?? "跳转到文档内位置"}
              aria-label={link.url ?? "跳转到文档内位置"}
              rel={link.url ? "noopener noreferrer" : undefined}
              style={{
                left: link.left,
                top: link.top,
                width: link.width,
                height: link.height,
              }}
              onPointerDown={(event) => event.stopPropagation()}
              onPointerUp={(event) => event.stopPropagation()}
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                if (link.url) onExternalLink(link.url);
                else if (link.destination) onInternalLink(link.destination);
              }}
            />
          ))}
        </div>
      )}
      {!rendered && (
        <div className="pdf-page-placeholder" aria-hidden="true">
          <span>{pageNumber}</span>
        </div>
      )}
    </div>
  );
}

/**
 * 页面渲染开销大：props 未变时整棵子树跳过重渲染。
 * 前提是调用方传入稳定的 highlights 引用（见 PdfViewer 的 rectsByPage）。
 */
export default memo(PdfPage);
