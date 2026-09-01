/** PDF 内部目标：命名目标或显式目标数组。 */
export type PdfDestination = string | unknown[];

/** 链接注释在已旋转 viewport 中的命中区域（CSS px）。 */
export interface PdfLinkOverlay {
  id: string;
  left: number;
  top: number;
  width: number;
  height: number;
  destination?: PdfDestination;
  url?: string;
}

interface ViewportLike {
  convertToViewportPoint(x: number, y: number): number[];
}

interface LinkAnnotationLike {
  id?: unknown;
  subtype?: unknown;
  rect?: unknown;
  dest?: unknown;
  url?: unknown;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isDestination(value: unknown): value is PdfDestination {
  return typeof value === "string" || Array.isArray(value);
}

/** 将 pdf.js 的 Link 注释转换为可覆盖在 canvas 上的命中区域。 */
export function getPdfLinkOverlays(
  annotations: unknown[],
  viewport: ViewportLike
): PdfLinkOverlay[] {
  const links: PdfLinkOverlay[] = [];

  for (const raw of annotations) {
    const annotation = raw as LinkAnnotationLike;
    if (annotation.subtype !== "Link" || !Array.isArray(annotation.rect)) continue;
    const [x1, y1, x2, y2] = annotation.rect;
    if (![x1, y1, x2, y2].every(isFiniteNumber)) continue;

    const url = typeof annotation.url === "string" ? annotation.url : undefined;
    const destination = isDestination(annotation.dest) ? annotation.dest : undefined;
    if (!url && !destination) continue;

    const [vx1, vy1] = viewport.convertToViewportPoint(x1, y1);
    const [vx2, vy2] = viewport.convertToViewportPoint(x2, y2);
    const left = Math.min(vx1, vx2);
    const top = Math.min(vy1, vy2);
    const width = Math.abs(vx2 - vx1);
    const height = Math.abs(vy2 - vy1);
    if (![left, top, width, height].every(Number.isFinite)) continue;

    links.push({
      id: typeof annotation.id === "string" ? annotation.id : `link-${links.length}`,
      left,
      top,
      width,
      height,
      destination,
      url,
    });
  }

  return links;
}

/**
 * 将 PDF 显式目标转换为 viewport 坐标。保留当前阅读器缩放，支持常见的
 * XYZ、Fit、FitH、FitV 与 FitR 目标；其余目标退回页面顶部。
 */
export function getDestinationViewportPoint(
  destination: unknown[],
  pageView: number[],
  viewport: ViewportLike
): { left: number; top: number } {
  const [minX, minY, maxX, maxY] = pageView;
  const kind = destination[1] as { name?: unknown } | undefined;
  const name = typeof kind?.name === "string" ? kind.name : "Fit";
  const at = (index: number, fallback: number) =>
    isFiniteNumber(destination[index]) ? destination[index] : fallback;

  if (name === "FitR") {
    const x1 = at(2, minX);
    const y1 = at(3, minY);
    const x2 = at(4, maxX);
    const y2 = at(5, maxY);
    const [vx1, vy1] = viewport.convertToViewportPoint(x1, y1);
    const [vx2, vy2] = viewport.convertToViewportPoint(x2, y2);
    return { left: Math.min(vx1, vx2), top: Math.min(vy1, vy2) };
  }

  let x = minX;
  let y = maxY;
  if (name === "XYZ") {
    x = at(2, minX);
    y = at(3, maxY);
  } else if (name === "FitH" || name === "FitBH") {
    y = at(2, maxY);
  } else if (name === "FitV" || name === "FitBV") {
    x = at(2, minX);
  }

  const [left, top] = viewport.convertToViewportPoint(x, y);
  return { left, top };
}
