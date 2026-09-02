/**
 * 文本层选区体验补丁，三部分：
 *
 * 1. 空白区选区补丁（复刻 pdf.js 官方 viewer TextLayerBuilder 的 #bindMouse 与
 *    #enableGlobalSelectionListener，见 pdfjs-dist/web/pdf_viewer.mjs）。
 *    TextLayer 的 span 绝对定位铺在页面上，行间与页边存在大片"空白区域"不属于任何
 *    span。Chromium 在空白处按下/拖拽时，选区锚点会跳到 DOM 顺序里邻近的文字：
 *     - 往选中文本后方的空白拖 → 意外选中后面一整段文字；
 *     - 往文本前方的空白拖 → 选区直接被取消。
 *    官方方案：每个文本层末尾放一个 `.endOfContent` 元素（空、默认贴在内容底部、
 *    user-select:none）。选中期间文本层加 `.selecting` 类，endOfContent 变为
 *    `top: 0` 盖住整层（z-index 0 在 span 之下），空白处的命中都落在它身上；
 *    同时在 selectionchange 里把它移动到选区锚点之后并临时置为 user-select:text，
 *    使"继续往空白拖"最多延伸到这个空元素为止。Chromium ≥ 148 已原生修复，
 *    跳过 DOM 移动（与官方一致）。
 *
 * 2. 选区高亮自绘（.pdf-sel-layer）。一行文本常被拆成多个 span（中英混排尤甚），
 *    相邻 span 盒子有轻微重叠；原生 ::selection 每个 span 各画一层半透明背景，
 *    重叠处叠色变深、边缘错位，看起来像"多个选区背景相互重叠"。这里关闭原生
 *    选区背景（CSS 置透明），改为监听 selectionchange 取 range 矩形、按视觉行
 *    合并后，在 canvas 与文本层之间的 .pdf-sel-layer 单层绘制。
 *
 * 3. 三击选段。span 全部绝对定位，浏览器把每个 span 当独立块，原生三击只能
 *    选中一个 span（约一行）。mousedown detail >= 3 时自行按行分组（矩形先
 *    换算回未旋转的层内坐标，旋转页同样成立），从点击行向上下扩展到段落
 *    边界（行距过大 / 上一行是段尾短行 / 下一行首行缩进即停），再整体写入
 *    Selection。
 */

interface LayerEntry {
  end: HTMLElement;
  onMouseDown: (e: MouseEvent) => void;
}

const textLayers = new Map<HTMLElement, LayerEntry>();
let globalAC: AbortController | null = null;

/** Chromium 148+ 已原生修复空白区选区行为（官方同款判断） */
function shouldSkipDomMove(): boolean {
  const chromium = /\bChrome\/(\d+)\b/.exec(navigator.userAgent)?.[1];
  return !!chromium && parseInt(chromium, 10) >= 148;
}

export function bindTextLayerSelection(div: HTMLElement, end: HTMLElement): void {
  // 缩放/旋转重渲染时会在同一个 div 上重复 bind：先解绑，避免监听叠加
  unbindTextLayerSelection(div);
  const onMouseDown = (e: MouseEvent) => {
    div.classList.add("selecting");
    if (e.button === 0 && e.detail >= 3 && selectParagraphAt(div, e)) {
      e.preventDefault();
    }
  };
  div.addEventListener("mousedown", onMouseDown);
  textLayers.set(div, { end, onMouseDown });
  enableGlobalSelectionListener();
}

export function unbindTextLayerSelection(div: HTMLElement): void {
  const entry = textLayers.get(div);
  if (entry) div.removeEventListener("mousedown", entry.onMouseDown);
  textLayers.delete(div);
  // 重渲染/卸载时清掉本页已画的选区高亮
  div.parentElement
    ?.querySelector(".pdf-sel-layer")
    ?.replaceChildren();
  if (textLayers.size === 0 && globalAC) {
    globalAC.abort();
    globalAC = null;
  }
}

function reset(end: HTMLElement, textLayer: HTMLElement): void {
  textLayer.append(end);
  end.style.width = "";
  end.style.height = "";
  textLayer.classList.remove("selecting");
}

function enableGlobalSelectionListener(): void {
  if (globalAC) return;
  globalAC = new AbortController();
  const signal = globalAC.signal;

  let isPointerDown = false;
  document.addEventListener(
    "pointerdown",
    () => {
      isPointerDown = true;
    },
    { signal }
  );
  document.addEventListener(
    "pointerup",
    () => {
      isPointerDown = false;
      textLayers.forEach((entry, div) => reset(entry.end, div));
    },
    { signal }
  );
  window.addEventListener(
    "blur",
    () => {
      isPointerDown = false;
      textLayers.forEach((entry, div) => reset(entry.end, div));
    },
    { signal }
  );
  document.addEventListener(
    "keyup",
    () => {
      if (!isPointerDown) textLayers.forEach((entry, div) => reset(entry.end, div));
    },
    { signal }
  );

  let prevRange: Range | null = null;
  document.addEventListener(
    "selectionchange",
    () => {
      schedulePaintSelection();
      const selection = document.getSelection();
      if (!selection || selection.rangeCount === 0) {
        textLayers.forEach((entry, div) => reset(entry.end, div));
        return;
      }

      // 选区涉及到的文本层进入 selecting 态，其余复位
      const active = new Set<HTMLElement>();
      for (let i = 0; i < selection.rangeCount; i++) {
        const range = selection.getRangeAt(i);
        for (const div of textLayers.keys()) {
          if (!active.has(div) && range.intersectsNode(div)) active.add(div);
        }
      }
      for (const [div, entry] of textLayers) {
        if (active.has(div)) div.classList.add("selecting");
        else reset(entry.end, div);
      }

      if (shouldSkipDomMove()) return;

      const range = selection.getRangeAt(0);
      // 终点与上次相同 → 本次是反向拖拽（在改起点），锚点取 startContainer
      const modifyStart =
        prevRange &&
        (range.compareBoundaryPoints(Range.END_TO_END, prevRange) === 0 ||
          range.compareBoundaryPoints(Range.START_TO_END, prevRange) === 0);
      let anchor: Node = modifyStart ? range.startContainer : range.endContainer;
      if (anchor.nodeType === Node.TEXT_NODE) {
        anchor = anchor.parentNode!;
      }
      if (!modifyStart && (range as Range).endOffset === 0) {
        // 锚点落在元素开头：向前找最近的有内容的兄弟节点
        do {
          while (!anchor.previousSibling) {
            anchor = anchor.parentNode!;
          }
          anchor = anchor.previousSibling;
        } while (!anchor.childNodes.length);
      }
      const parentTextLayer = (anchor as HTMLElement).parentElement?.closest(
        ".pdf-text-layer"
      ) as HTMLElement | null;
      const endDiv = parentTextLayer
        ? textLayers.get(parentTextLayer)?.end
        : undefined;
      if (endDiv && parentTextLayer) {
        endDiv.style.width = parentTextLayer.style.width;
        endDiv.style.height = parentTextLayer.style.height;
        endDiv.style.userSelect = "text";
        (anchor as HTMLElement).parentElement!.insertBefore(
          endDiv,
          modifyStart ? anchor : anchor.nextSibling
        );
      }
      prevRange = range.cloneRange();
    },
    { signal }
  );
}

/* ==========================================================================
   旋转适配：viewport 坐标 ⇄ 未旋转的层内局部坐标
   ========================================================================== */

interface Mapper {
  /** 文本层视觉包围盒（viewport 坐标，随旋转变化） */
  visual: RectBox;
  /** viewport 矩形 → 层内局部坐标（未旋转，PDF 文本空间） */
  toLocal(r: RectBox): RectBox;
  /** 层内局部坐标 → viewport 矩形 */
  toVisual(r: RectBox): RectBox;
  pointToLocal(x: number, y: number): { x: number; y: number };
}

/**
 * 文本层整体被 CSS 旋转（transform: rotate(...)）以对齐旋转后的 canvas，于是
 * span / 选区的 client 矩形都是旋转后的轴对齐包围盒：90°/270° 时"行"在屏幕上
 * 变成竖直方向，按视觉 y 重叠分行会把整页并成一块（三击选段就会选中整页）。
 *
 * 这里按 pdf.js 自己的映射（text_layer.mjs convertMatches 同款）把矩形换算回
 * 未旋转的层内局部坐标 —— 局部空间里行永远是水平的，分行与段落判断统一生效。
 * `data-main-rotation` 仅在 rotation ≠ 0 时由 pdf.js 写入，缺失即视为 0。
 */
function getMapper(div: HTMLElement): Mapper | null {
  const b = div.getBoundingClientRect();
  const lw = div.offsetWidth;
  const lh = div.offsetHeight;
  if (b.width < 1 || b.height < 1 || lw < 1 || lh < 1) return null;
  const rot = Number(div.dataset.mainRotation ?? "0") || 0;
  const visual: RectBox = { left: b.left, top: b.top, right: b.right, bottom: b.bottom };
  const toLocal = (r: RectBox): RectBox => {
    const u0 = (r.left - b.left) / b.width;
    const u1 = (r.right - b.left) / b.width;
    const v0 = (r.top - b.top) / b.height;
    const v1 = (r.bottom - b.top) / b.height;
    let s0: number;
    let s1: number;
    let t0: number;
    let t1: number;
    switch (rot) {
      case 90:
        s0 = v0;
        s1 = v1;
        t0 = 1 - u1;
        t1 = 1 - u0;
        break;
      case 180:
        s0 = 1 - u1;
        s1 = 1 - u0;
        t0 = 1 - v1;
        t1 = 1 - v0;
        break;
      case 270:
        s0 = 1 - v1;
        s1 = 1 - v0;
        t0 = u0;
        t1 = u1;
        break;
      default:
        s0 = u0;
        s1 = u1;
        t0 = v0;
        t1 = v1;
    }
    return { left: s0 * lw, top: t0 * lh, right: s1 * lw, bottom: t1 * lh };
  };
  const toVisual = (r: RectBox): RectBox => {
    const s0 = r.left / lw;
    const s1 = r.right / lw;
    const t0 = r.top / lh;
    const t1 = r.bottom / lh;
    let u0: number;
    let u1: number;
    let v0: number;
    let v1: number;
    switch (rot) {
      case 90:
        u0 = 1 - t1;
        u1 = 1 - t0;
        v0 = s0;
        v1 = s1;
        break;
      case 180:
        u0 = 1 - s1;
        u1 = 1 - s0;
        v0 = 1 - t1;
        v1 = 1 - t0;
        break;
      case 270:
        u0 = t0;
        u1 = t1;
        v0 = 1 - s1;
        v1 = 1 - s0;
        break;
      default:
        u0 = s0;
        u1 = s1;
        v0 = t0;
        v1 = t1;
    }
    return {
      left: b.left + u0 * b.width,
      top: b.top + v0 * b.height,
      right: b.left + u1 * b.width,
      bottom: b.top + v1 * b.height,
    };
  };
  const pointToLocal = (x: number, y: number) => {
    const r = toLocal({ left: x, top: y, right: x, bottom: y });
    return { x: r.left, y: r.top };
  };
  return { visual, toLocal, toVisual, pointToLocal };
}

/* ==========================================================================
   选区高亮自绘
   ========================================================================== */

let paintRaf = 0;

function schedulePaintSelection(): void {
  if (paintRaf) return;
  paintRaf = requestAnimationFrame(() => {
    paintRaf = 0;
    paintSelection();
  });
}

interface RectBox {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/**
 * 把选区 client 矩形按视觉行合并：
 *  - 垂直重叠超过较矮者一半 → 同一行带；
 *  - 行带内水平间隙 ≤ 0.6 倍行高 → 同一块（相邻 span 盒子重叠/紧挨时并成一整段，
 *    避免各自半透明背景叠色；多栏之间的大间隙仍分开画）。
 */
function mergeSelectionRects(rects: RectBox[]): RectBox[] {
  rects.sort((a, b) => a.top - b.top || a.left - b.left);
  const bands: { top: number; bottom: number; items: RectBox[] }[] = [];
  for (const r of rects) {
    const band = bands[bands.length - 1];
    const h = r.bottom - r.top;
    if (band && r.top < band.bottom - Math.min(h, band.bottom - band.top) * 0.5) {
      band.items.push(r);
      band.top = Math.min(band.top, r.top);
      band.bottom = Math.max(band.bottom, r.bottom);
    } else {
      bands.push({ top: r.top, bottom: r.bottom, items: [r] });
    }
  }
  const merged: RectBox[] = [];
  for (const band of bands) {
    band.items.sort((a, b) => a.left - b.left);
    const gapTol = (band.bottom - band.top) * 0.6;
    let cur: RectBox | null = null;
    for (const r of band.items) {
      if (cur && r.left - cur.right > gapTol) {
        merged.push(cur);
        cur = null;
      }
      if (!cur) {
        cur = { ...r };
      } else {
        cur.left = Math.min(cur.left, r.left);
        cur.right = Math.max(cur.right, r.right);
        cur.top = Math.min(cur.top, r.top);
        cur.bottom = Math.max(cur.bottom, r.bottom);
      }
    }
    if (cur) merged.push(cur);
  }
  return merged;
}

function paintSelection(): void {
  // 每页先清空，再按页收集 → 局部合并 → 换回视觉坐标绘制。
  // 按页分别合并：跨页选区不会被并成一块，旋转页也能按层内行正确分行。
  const layers: { m: Mapper; paint: HTMLElement | null }[] = [];
  for (const div of textLayers.keys()) {
    const paint =
      div.parentElement?.querySelector<HTMLElement>(".pdf-sel-layer") ?? null;
    paint?.replaceChildren();
    const m = getMapper(div);
    if (m) layers.push({ m, paint });
  }
  const selection = document.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return;

  const rects: RectBox[] = [];
  for (let i = 0; i < selection.rangeCount; i++) {
    for (const r of selection.getRangeAt(i).getClientRects()) {
      if (r.width < 1 || r.height < 1) continue;
      rects.push({ left: r.left, top: r.top, right: r.right, bottom: r.bottom });
    }
  }
  if (!rects.length) return;

  for (const { m, paint } of layers) {
    if (!paint) continue;
    const vb = m.visual;
    const vw = vb.right - vb.left;
    const vh = vb.bottom - vb.top;
    const local: RectBox[] = [];
    for (const r of rects) {
      const cx = (r.left + r.right) / 2;
      const cy = (r.top + r.bottom) / 2;
      if (cx < vb.left || cx > vb.right || cy < vb.top || cy > vb.bottom) continue;
      local.push(m.toLocal(r));
    }
    if (!local.length) continue;
    for (const line of mergeSelectionRects(local)) {
      const v = m.toVisual(line);
      // 裁剪到视觉盒内（防 endOfContent 等越界矩形）
      const left = Math.max(v.left, vb.left);
      const right = Math.min(v.right, vb.right);
      const top = Math.max(v.top, vb.top);
      const bottom = Math.min(v.bottom, vb.bottom);
      if (right - left < 1 || bottom - top < 1) continue;
      const el = document.createElement("div");
      el.className = "pdf-sel-rect";
      // 百分比定位：页盒随缩放变化时无需重算
      el.style.left = `${((left - vb.left) / vw) * 100}%`;
      el.style.top = `${((top - vb.top) / vh) * 100}%`;
      el.style.width = `${((right - left) / vw) * 100}%`;
      el.style.height = `${((bottom - top) / vh) * 100}%`;
      paint.appendChild(el);
    }
  }
}

/* ==========================================================================
   三击选段
   ========================================================================== */

interface LineBox extends RectBox {
  /** 行内叶子 span（文档序） */
  spans: HTMLSpanElement[];
}

/**
 * 收集文本层内的文本行：叶子 span 的 client 矩形先换算到未旋转的层内坐标，
 * 再按垂直重叠聚成行带，行带内按水平大间隙切段（分栏）。
 * 必须在局部坐标里分组 —— 旋转页面在屏幕上"行"是竖直的，直接按视觉 y 重叠
 * 分组会把整页并成一块（表现为三击选中整页）。
 */
function collectLines(div: HTMLElement, m: Mapper): LineBox[] {
  interface Item {
    r: RectBox;
    span: HTMLSpanElement;
  }
  const items: Item[] = [];
  div.querySelectorAll("span").forEach((span) => {
    if (span.querySelector("span")) return; // markedContent 等容器，取叶子
    if (!span.textContent) return;
    const box = span.getBoundingClientRect();
    const r = m.toLocal({
      left: box.left,
      top: box.top,
      right: box.right,
      bottom: box.bottom,
    });
    if (r.right - r.left < 1 || r.bottom - r.top < 1) return;
    items.push({ r, span });
  });
  items.sort((a, b) => a.r.top - b.r.top || a.r.left - b.r.left);

  const bands: { top: number; bottom: number; items: Item[] }[] = [];
  for (const it of items) {
    const band = bands[bands.length - 1];
    const h = it.r.bottom - it.r.top;
    if (band && it.r.top < band.bottom - Math.min(h, band.bottom - band.top) * 0.5) {
      band.items.push(it);
      band.top = Math.min(band.top, it.r.top);
      band.bottom = Math.max(band.bottom, it.r.bottom);
    } else {
      bands.push({ top: it.r.top, bottom: it.r.bottom, items: [it] });
    }
  }

  const lines: LineBox[] = [];
  for (const band of bands) {
    band.items.sort((a, b) => a.r.left - b.r.left);
    const gapTol = (band.bottom - band.top) * 1.5;
    let cur: LineBox | null = null;
    for (const it of band.items) {
      if (cur && it.r.left - cur.right > gapTol) {
        lines.push(cur);
        cur = null;
      }
      if (!cur) {
        cur = {
          top: it.r.top,
          bottom: it.r.bottom,
          left: it.r.left,
          right: it.r.right,
          spans: [],
        };
      }
      cur.top = Math.min(cur.top, it.r.top);
      cur.bottom = Math.max(cur.bottom, it.r.bottom);
      cur.left = Math.min(cur.left, it.r.left);
      cur.right = Math.max(cur.right, it.r.right);
      cur.spans.push(it.span);
    }
    if (cur) lines.push(cur);
  }
  lines.sort((a, b) => a.top - b.top || a.left - b.left);
  return lines;
}

/** 命中最优先：包含点击点的行；否则垂直距离最近的行 */
function findLineIndex(lines: LineBox[], x: number, y: number): number {
  let best = -1;
  let bestDist = Infinity;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (y >= l.top - 2 && y <= l.bottom + 2 && x >= l.left - 2 && x <= l.right + 2) {
      return i;
    }
    const dy = y < l.top ? l.top - y : y > l.bottom ? y - l.bottom : 0;
    if (dy < bestDist) {
      bestDist = dy;
      best = i;
    }
  }
  return best;
}

/**
 * 三击选中整段：返回 true 表示已自行设置选区（调用方应 preventDefault）。
 * 段落边界启发式：行距 > 0.9 倍行高 / 上一行右端明显不到栏右（段尾短行）/
 * 下一行左端明显缩进（新段开头）即停。
 */
function selectParagraphAt(div: HTMLElement, e: MouseEvent): boolean {
  const m = getMapper(div);
  if (!m) return false;
  const pt = m.pointToLocal(e.clientX, e.clientY);
  const lines = collectLines(div, m);
  const idx = findLineIndex(lines, pt.x, pt.y);
  if (idx < 0) return false;
  const anchor = lines[idx];
  const h = anchor.bottom - anchor.top;
  // 同栏（水平区间与点击行有交集）的行才参与段落扩展
  const column = lines.filter((l) => l.left < anchor.right && anchor.left < l.right);
  const i0 = column.indexOf(anchor);
  // 栏左右边界：取点击行邻域的极值，容忍个别行的缩进/短行
  const near = column.slice(Math.max(0, i0 - 8), i0 + 9);
  const colLeft = Math.min(...near.map((l) => l.left));
  const colRight = Math.max(...near.map((l) => l.right));
  const isShort = (l: LineBox) => l.right < colRight - h * 0.9;
  const isIndented = (l: LineBox) => l.left > colLeft + h * 0.4;
  const gapOk = (a: LineBox, b: LineBox) => b.top - a.bottom <= h * 0.9;

  let first = i0;
  let last = i0;
  while (first > 0) {
    const prev = column[first - 1];
    if (!gapOk(prev, column[first]) || isShort(prev) || isIndented(column[first])) {
      break;
    }
    first--;
  }
  while (last < column.length - 1) {
    const next = column[last + 1];
    if (!gapOk(column[last], next) || isShort(column[last]) || isIndented(next)) {
      break;
    }
    last++;
  }

  const members: HTMLSpanElement[] = [];
  for (let i = first; i <= last; i++) members.push(...column[i].spans);
  if (!members.length) return false;
  // 行内按左序收集，跨行可能乱文档序：取文档序首/尾作为选区端点
  let start: Node = members[0];
  let end: Node = members[0];
  for (const s of members) {
    if (start.compareDocumentPosition(s) & Node.DOCUMENT_POSITION_PRECEDING) start = s;
    if (end.compareDocumentPosition(s) & Node.DOCUMENT_POSITION_FOLLOWING) end = s;
  }
  const selection = document.getSelection();
  if (!selection) return false;
  const range = document.createRange();
  range.setStartBefore(start);
  range.setEndAfter(end);
  selection.removeAllRanges();
  selection.addRange(range);
  return true;
}
