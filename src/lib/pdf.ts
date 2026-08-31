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
