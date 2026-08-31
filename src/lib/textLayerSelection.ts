/**
 * pdf.js 官方 viewer 的选区体验补丁（复刻 TextLayerBuilder 的 #bindMouse 与
 * #enableGlobalSelectionListener，见 pdfjs-dist/web/pdf_viewer.mjs）。
 *
 * TextLayer 的 span 绝对定位铺在页面上，行间与页边存在大片"空白区域"不属于任何
 * span。Chromium 在空白处按下/拖拽时，选区锚点会跳到 DOM 顺序里邻近的文字，
 * 表现为两种怪象：
 *  - 往选中文本后方的空白拖 → 意外选中后面一整段文字；
 *  - 往文本前方的空白拖 → 选区直接被取消。
 *
 * 官方方案：每个文本层末尾放一个 `.endOfContent` 元素（空、默认贴在内容底部、
 * user-select:none）。选中期间文本层加 `.selecting` 类，endOfContent 变为
 * `top: 0` 盖住整层（z-index 0 在 span 之下），空白处的命中都落在它身上；
 * 同时在 selectionchange 里把它移动到选区锚点之后并临时置为 user-select:text，
 * 使"继续往空白拖"最多延伸到这个空元素为止，而不是吞掉后面的段落。
 * Chromium ≥ 148 / Firefox 已原生修复，跳过 DOM 移动（与官方一致）。
 */

const textLayers = new Map<HTMLElement, HTMLElement>();
let globalAC: AbortController | null = null;

/** Chromium 148+ 已原生修复空白区选区行为（官方同款判断） */
function shouldSkipDomMove(): boolean {
  const chromium = /\bChrome\/(\d+)\b/.exec(navigator.userAgent)?.[1];
  return !!chromium && parseInt(chromium, 10) >= 148;
}

export function bindTextLayerSelection(div: HTMLElement, end: HTMLElement): void {
  div.addEventListener("mousedown", () => {
    div.classList.add("selecting");
  });
  textLayers.set(div, end);
  enableGlobalSelectionListener();
}

export function unbindTextLayerSelection(div: HTMLElement): void {
  textLayers.delete(div);
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
      textLayers.forEach(reset);
    },
    { signal }
  );
  window.addEventListener(
    "blur",
    () => {
      isPointerDown = false;
      textLayers.forEach(reset);
    },
    { signal }
  );
  document.addEventListener(
    "keyup",
    () => {
      if (!isPointerDown) textLayers.forEach(reset);
    },
    { signal }
  );

  let prevRange: Range | null = null;
  document.addEventListener(
    "selectionchange",
    () => {
      const selection = document.getSelection();
      if (!selection || selection.rangeCount === 0) {
        textLayers.forEach(reset);
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
      for (const [div, end] of textLayers) {
        if (active.has(div)) div.classList.add("selecting");
        else reset(end, div);
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
      const endDiv = parentTextLayer ? textLayers.get(parentTextLayer) : undefined;
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
