import * as pdfjsLib from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import type { PDFDocumentProxy } from "pdfjs-dist";

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

/**
 * pdf.js 运行时资源目录（由 vite.config.ts 的 pdfjsAssets 插件同步到 public/pdfjs/）。
 * worker 会按「目录前缀 + 文件名」fetch 这些辅助文件，默认前缀为 null 时会退化成
 * 相对 worker 脚本的 URL 而 404，导致 CCITT/JPX 扫描图、CJK 非嵌入字体整页空白。
 */
const ASSET_BASE = `${import.meta.env.BASE_URL}pdfjs/`;

export type { PDFDocumentProxy };

export interface OpenedPdf {
  doc: PDFDocumentProxy;
  /** 原始文件字节数（属性面板展示用） */
  size: number;
  /** 销毁文档及其 worker 资源 */
  destroy: () => Promise<void>;
}

/* ==========================================================================
   文档标识
   ========================================================================== */

/**
 * 每个 doc 一个稳定短 id，供渲染缓存 / 文本缓存 / 缩略图缓存做 key 前缀。
 * 不能用 doc.fingerprint（同文件多次打开一致，但不同文件可能为空且不稳定），
 * 用 WeakMap 挂在实例上，随文档一起被 GC。
 */
const docKeys = new WeakMap<PDFDocumentProxy, string>();

export function docKey(doc: PDFDocumentProxy): string {
  let id = docKeys.get(doc);
  if (!id) {
    id = Math.random().toString(36).slice(2, 10);
    docKeys.set(doc, id);
  }
  return id;
}

/* ==========================================================================
   打开文档
   ========================================================================== */

export interface OpenPdfOptions {
  /**
   * 文档加密时向用户索取密码；reject 表示用户取消。
   * 密码错误时 pdf.js 会以 wrong=true 再次调用。
   */
  requestPassword?: (wrong: boolean) => Promise<string>;
}

/** pdf.js PasswordResponses：1 = 需要密码，2 = 密码错误 */
const INCORRECT_PASSWORD = 2;

export async function openPdf(
  data: Uint8Array,
  options?: OpenPdfOptions
): Promise<OpenedPdf> {
  // 先记录字节数：pdfjs 会把 data 的 ArrayBuffer 通过 transferable 转移到
  // worker 线程（detach），之后 data.byteLength 归 0，属性面板会显示 0 B。
  const size = data.byteLength;
  // pdf.js 的 onPassword 挂在 task 上（不在 DocumentInitParameters 里）：
  // 调用 updatePassword(password) 继续，传入 Error 则中止加载
  const task = pdfjsLib.getDocument({
    data,
    // 四类运行时资源缺失时页面会「渲染成功但一片空白」，必须显式指定
    cMapUrl: `${ASSET_BASE}cmaps/`,
    cMapPacked: true,
    standardFontDataUrl: `${ASSET_BASE}standard_fonts/`,
    wasmUrl: `${ASSET_BASE}wasm/`,
    iccUrl: `${ASSET_BASE}iccs/`,
  });
  if (options?.requestPassword) {
    task.onPassword = (
      updatePassword: (value: string | Error) => void,
      reason: number
    ): void => {
      void options
        .requestPassword!(reason === INCORRECT_PASSWORD)
        .then((password) => updatePassword(password))
        .catch((err) =>
          updatePassword(err instanceof Error ? err : new Error(String(err)))
        );
    };
  }
  const doc = await task.promise;
  docKey(doc);
  return { doc, size, destroy: () => task.destroy() };
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
