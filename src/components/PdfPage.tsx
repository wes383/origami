import { memo, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { TextLayer } from "pdfjs-dist";
import type { PDFDocumentProxy } from "pdfjs-dist";
import type { SearchRect } from "../lib/search";
import {
  ANNO_DEFAULT_COLOR,
  annoFill,
  annoInk,
  type Annotation,
} from "../lib/annotations";
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
import {
  HighlighterIcon,
  StickyNoteIcon,
  StrikethroughIcon,
  UnderlineIcon,
} from "./Icons";

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
  /** 本页用户注释（归一化坐标；渲染前先随倍率旋转，与搜索高亮同模式） */
  annotations: Annotation[];
  /** 点击注释 chip 时的视口坐标（供浮层定位），需页面层上抛 */
  onAnnoOpen: (id: string, x: number, y: number) => void;
  /** 当前选中匹配 id（用于强调样式与滚动定位） */
  activeHighlightId: string | null;
  /** 点击 PDF 内部链接时导航到目标位置 */
  onInternalLink: (destination: PdfDestination) => void;
  /** 点击外部链接时交给宿主环境打开 */
  onExternalLink: (url: string) => void;
}

/**
 * 归一化矩形（未旋转页面坐标 0~1）—— SearchRect 与 AnnoRect 共用的几何基元。
 * 随页面旋转（顺时针）变换：90°/270° 时宽高互换，坐标绕归一化单位方块旋转
 */
interface NormalizedBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

function rotateRect(r: NormalizedBox, rotation: number): NormalizedBox {
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

/** chip 直径 16px：横排错开时的中心步进 = 16 + 4 间隙 */
const CHIP_STEP = 20;
/** 划线类 chip 簇的「同行」判定容差（px）：垂直差在此以内视为同一行行尾 */
const CHIP_ROW_TOL = 10;
/** 划线类 chip 簇的「同锚点」判定容差（px）：水平差在此以内视为叠在同一右下角 */
const CHIP_OVERLAP_TOL = 12;

function PdfPage({
  doc,
  pageNumber,
  scale,
  rotation,
  estimatedW,
  estimatedH,
  visible,
  highlights,
  annotations,
  onAnnoOpen,
  activeHighlightId,
  onInternalLink,
  onExternalLink,
}: PdfPageProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const textLayerRef = useRef<HTMLDivElement | null>(null);
  const [rendered, setRendered] = useState(false);
  /**
   * 本页真实尺寸（渲染后回填，替代按首页估算的占位值）。
   * 记录渲染时的 scale/rotation 快照：离屏页（visible=false）不会随倍率变化重渲染，
   * 若直接消费旧尺寸会一直按旧倍率撑宽（fit-width 收窄后产生横向滚动条 + 右侧空白）。
   * 快照与当前倍率不一致时视为失效，回退到按新倍率估算的占位尺寸。
   */
  const [actualSize, setActualSize] = useState<{
    scale: number;
    rotation: number;
    w: number;
    h: number;
  } | null>(null);
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
        setActualSize({ scale, rotation, w, h });

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
      } catch (err) {
        // cancelled 表示翻页/切倍率导致的主动取消，属正常；未取消的失败需要留痕：
        // 解码器或字体资源缺失时页面会「渲染成功但一片空白」，静默会让人无从排查
        if (!cancelled) {
          console.warn(`[PdfPage] 第 ${pageNumber} 页渲染失败`, err);
        }
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

  // 只有真实尺寸与当前倍率匹配时才使用（离屏页可能带着旧倍率的真实尺寸）
  const boxW =
    actualSize && actualSize.scale === scale && actualSize.rotation === rotation
      ? actualSize.w
      : Math.floor(estimatedW);
  const boxH =
    actualSize && actualSize.scale === scale && actualSize.rotation === rotation
      ? actualSize.h
      : Math.floor(estimatedH);

  /**
   * 划线类注释 chip 去重叠：多条注释覆盖同一行（末矩形右下角重合）时，
   * chip 会叠成一团。先把锚点（渲染像素）按「同一行 + 同一角点」聚类，
   * 簇内按 x 从左到右贪心排布——贴原锚点，与左侧已排 chip 冲突才右移一步进；
   * 簇整体超出页面右缘时再整体左移夹紧。note 的 pin 在首矩形左上角，
   * 与其他 chip 不在一处，不参与本排布。
   */
  const lineChipShift = useMemo(() => {
    const shift = new Map<string, number>();
    const pts = annotations
      .filter((a) => a.type !== "note")
      .map((a) => {
        const rot = a.rects.map((r) => rotateRect(r, rotation));
        const last = rot[rot.length - 1];
        return {
          id: a.id,
          x: (last.x + last.w) * boxW,
          y: (last.y + last.h) * boxH,
        };
      })
      .sort((p, q) => p.y - q.y || p.x - q.x);
    let i = 0;
    while (i < pts.length) {
      const anchor = pts[i];
      const members: typeof pts = [anchor];
      let j = i + 1;
      while (j < pts.length) {
        const p = pts[j];
        if (p.y - anchor.y > CHIP_ROW_TOL) break; // 已换行，后续只会更远
        if (p.x - anchor.x > CHIP_OVERLAP_TOL) break; // 同行但锚点已分开
        members.push(p);
        j += 1;
      }
      // 簇内贪心：尽量停在原锚点，与左侧已排 chip 冲突则右移一个步进
      let cursor = -Infinity;
      for (const p of members) {
        const s = Math.max(0, cursor + CHIP_STEP - p.x);
        shift.set(p.id, s);
        cursor = p.x + s;
      }
      // 右缘夹紧：最右 chip（中心+半宽）越界时整体左移，但不越过首 chip 可左移极限
      const rightEdge = cursor + 8;
      const limit = boxW - 6;
      if (rightEdge > limit) {
        const canLeft = Math.max(0, members[0].x - 8);
        const by = Math.min(rightEdge - limit, canLeft);
        for (const p of members) shift.set(p.id, (shift.get(p.id) ?? 0) - by);
      }
      i = j;
    }
    return shift;
  }, [annotations, rotation, boxW, boxH]);

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
      {/* 选区高亮层：由 lib/textLayerSelection.ts 自绘（按行合并矩形后单层绘制，
          避免原生 ::selection 在重叠 span 上叠色）；百分比定位，缩放自适应 */}
      <div className="pdf-sel-layer" aria-hidden="true" />
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
      {/* 用户注释层：置于文本层/链接层之上 —— 划线矩形与 chip 需要盖过文字
          （文字透明、选中不受影响）。矩形与搜索高亮同坐标系（未旋转归一化 +
          渲染时旋转）。chip 单独开 pointer-events 以便点击弹出注释管理浮层，
          其余区域不拦截文字选拖 */}
      {annotations.length > 0 && (
        <div className="an-layer">
          {annotations.map((ann) => {
            const rot = ann.rects.map((r) => rotateRect(r, rotation));
            const first = rot[0];
            const last = rot[rot.length - 1];
            const isNote = ann.type === "note";
            const chipPos = isNote
              ? // 便签：pin 在首矩形左上角，便于与其他标记区分
                { left: first.x * 100, top: first.y * 100 }
              : // 划线类：贴末矩形右下角，像"句末右下角小标记"，少遮挡文字
                { left: (last.x + last.w) * 100, top: (last.y + last.h) * 100 };
            return (
              <div
                key={ann.id}
                className={`an-group is-${ann.type}`}
                style={
                  ann.type === "note"
                    ? undefined
                    : ({
                        // 几何类：自定义落笔色 → 高亮铺色 / 线条 / chip 字形三档；
                        // 无 color 的旧数据依赖 CSS 回退默认色
                        "--an-fill": annoFill(
                          ann.color ?? ANNO_DEFAULT_COLOR[ann.type]
                        ),
                        "--an-ink": annoInk(
                          ann.color ?? ANNO_DEFAULT_COLOR[ann.type]
                        ),
                      } as CSSProperties)
                }
              >
                {rot.map((r, i) => (
                  <div
                    key={i}
                    className="an-rect"
                    style={{
                      left: `${r.x * 100}%`,
                      top: `${r.y * 100}%`,
                      width: `${r.w * 100}%`,
                      height: `${r.h * 100}%`,
                    }}
                  />
                ))}
                <button
                  type="button"
                  tabIndex={-1}
                  className={`an-chip ${isNote ? "an-chip-note" : ""}`}
                  style={{
                    left: `${chipPos.left}%`,
                    top: `${chipPos.top}%`,
                    // 划线类：同一右下角的多条注释 chip 向右错开（0 = 停在原锚点）
                    ...(isNote ? {} : { marginLeft: lineChipShift.get(ann.id) ?? 0 }),
                  }}
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation();
                    onAnnoOpen(ann.id, e.clientX, e.clientY);
                  }}
                >
                  {ann.type === "highlight" && <HighlighterIcon size={10} />}
                  {ann.type === "underline" && <UnderlineIcon size={10} />}
                  {ann.type === "strikeout" && <StrikethroughIcon size={10} />}
                  {ann.type === "note" && <StickyNoteIcon size={11} />}
                </button>
              </div>
            );
          })}
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
