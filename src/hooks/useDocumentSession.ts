/**
 * 文档会话 Hook — 收拢单个 PDF 文档的完整生命周期：
 * 打开（含加密文档的密码交互）→ 状态维护（pdf / 文件名 / 路径 / 页数 /
 * 当前页 / 目录 / 各页尺寸缓存）→ 关闭（销毁 worker 资源）。
 *
 * 视图层状态（缩放 / 布局 / 侧栏 / 查找等）仍归 App 所有，通过回调同步：
 * - onOpened：文档就绪、进度恢复解析完成时触发（恢复视图偏好 / 最近文件）
 * - onOutlineLoaded：目录解析完成（失败为空数组；侧栏默认展开依赖目录）
 * - onClosed：文档关闭后重置视图层状态
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { readFile } from "@tauri-apps/plugin-fs";
import type { OpenedPdf, OutlineNode } from "../lib/pdf";
import { openPdf, loadOutline } from "../lib/pdf";
import { loadProgress, type ReadProgress } from "../lib/progress";
import type { LangKeys } from "../i18n";

export interface DocumentOpenedInfo {
  path: string;
  /** 持久化进度解析结果（无记录为 null） */
  restored: ReadProgress | null;
  /** 首页尺寸（scale=1），fit 倍率与页面布局的基准 */
  firstPage: { w: number; h: number };
  /** 恢复后的起始页码（无记录为 1） */
  page: number;
}

export interface DocumentSessionCallbacks {
  /** 文档打开成功后触发：恢复视图偏好（缩放/布局/旋转）、记录最近文件等 */
  onOpened?: (info: DocumentOpenedInfo) => void;
  /** 目录解析完成后触发：侧栏初始展开依赖目录是否非空 */
  onOutlineLoaded?: (outline: OutlineNode[]) => void;
  /** 文档关闭后触发：重置视图层状态 */
  onClosed?: () => void;
}

export function useDocumentSession(callbacks: DocumentSessionCallbacks = {}) {
  const [pdf, setPdf] = useState<OpenedPdf | null>(null);
  const [fileName, setFileName] = useState("");
  /** 当前文件完整路径（文件属性弹窗展示） */
  const [filePath, setFilePath] = useState("");
  const [numPages, setNumPages] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  /** 当前文档的目录树 */
  const [outline, setOutline] = useState<OutlineNode[]>([]);
  /** 文档读取中 */
  const [loading, setLoading] = useState(false);
  /** 打开失败的错误提示 key（自动消失逻辑由渲染层负责） */
  const [errorKey, setErrorKey] = useState<LangKeys | null>(null);
  /** 加密文档密码输入弹窗 */
  const [passwordOpen, setPasswordOpen] = useState(false);
  /** 当前密码是否已判错一次（用于弹窗提示与重新弹出） */
  const [passwordWrong, setPasswordWrong] = useState(false);

  /** 当前文档路径（进度持久化与打印进度的 key；不含文件名） */
  const currentPathRef = useRef<string>("");
  /** 当前文档对象：loadFile/closeFile 里直接取，避免 setState 闭包过期 */
  const pdfRef = useRef<OpenedPdf | null>(null);
  /** 各页尺寸缓存（scale=1），避免重复 getPage */
  const pageSizesRef = useRef(new Map<number, { w: number; h: number }>());
  /** 待密码打开的文档数据（密码输入弹窗回调用） */
  const pendingPasswordRef = useRef<Uint8Array | null>(null);
  /** 密码输入弹窗的 resolve/reject：由 openPdf 的 requestPassword 挂载 */
  const passwordResolveRef = useRef<((value: string) => void) | null>(null);
  const passwordRejectRef = useRef<((err: unknown) => void) | null>(null);

  // 回调放 ref：保证 loadFile/closeFile 引用稳定（拖拽/事件监听不重复订阅）
  const callbacksRef = useRef(callbacks);
  useEffect(() => {
    callbacksRef.current = callbacks;
  });

  /** 关闭上一份文档（销毁 worker 资源）。副作用放函数体，不走 setState updater */
  const destroyCurrent = useCallback(() => {
    const prev = pdfRef.current;
    if (prev) void prev.destroy();
  }, []);

  const loadFile = useCallback(
    async (path: string) => {
      if (!/\.pdf$/i.test(path)) {
        setErrorKey("errorNotPdf");
        return;
      }
      setLoading(true);
      setErrorKey(null);
      let opened: OpenedPdf;
      try {
        const data = await readFile(path);
        const bytes = new Uint8Array(data);
        // 加密文档：弹出密码框，取到密码后重试打开
        opened = await openPdf(bytes, {
          requestPassword: (wrong) =>
            new Promise<string>((resolve, reject) => {
              pendingPasswordRef.current = bytes;
              setPasswordWrong(wrong);
              setPasswordOpen(true);
              passwordResolveRef.current = resolve;
              passwordRejectRef.current = reject;
            }),
        });
      } catch (err) {
        // 用户取消密码输入：静默返回，不报"文件无效"
        if (err instanceof Error && err.message === "password-cancelled") {
          setLoading(false);
          return;
        }
        setErrorKey("errorInvalid");
        setLoading(false);
        return;
      }

      // 打开成功：清理可能残留的密码弹窗状态
      pendingPasswordRef.current = null;
      passwordResolveRef.current = null;
      passwordRejectRef.current = null;
      setPasswordOpen(false);

      try {
        const page1 = await opened.doc.getPage(1);
        const vp = page1.getViewport({ scale: 1 });
        const firstPage = { w: vp.width, h: vp.height };

        // 先销毁旧文档，再替换引用（避免 StrictMode 下 updater 跑两次）
        destroyCurrent();
        pdfRef.current = opened;
        setPdf(opened);

        const restored = loadProgress(path);
        const total = opened.doc.numPages;
        const page = Math.min(Math.max(1, restored?.page ?? 1), total);

        setNumPages(total);
        setCurrentPage(page);
        pageSizesRef.current = new Map([[1, firstPage]]);

        setFileName(path.split(/[\\/]/).pop() ?? path);
        setFilePath(path);
        currentPathRef.current = path;

        callbacksRef.current.onOpened?.({ path, restored, firstPage, page });

        // 解析目录（失败不阻塞打开文档）
        const parsedOutline = await loadOutline(opened.doc).catch(() => []);
        setOutline(parsedOutline);
        callbacksRef.current.onOutlineLoaded?.(parsedOutline);
      } catch {
        setErrorKey("errorInvalid");
      } finally {
        setLoading(false);
      }
    },
    [destroyCurrent]
  );

  const handlePasswordSubmit = useCallback((password: string) => {
    setPasswordOpen(false);
    passwordResolveRef.current?.(password);
    passwordResolveRef.current = null;
    passwordRejectRef.current = null;
  }, []);

  const handlePasswordCancel = useCallback(() => {
    setPasswordOpen(false);
    setLoading(false);
    pendingPasswordRef.current = null;
    // reject 会让 openPdf 中止；此时 requestPassword 已 reject，走 catch 静默返回
    passwordRejectRef.current?.(new Error("password-cancelled"));
    passwordResolveRef.current = null;
    passwordRejectRef.current = null;
  }, []);

  /** 关闭当前文件，销毁文档资源并回到引导页 */
  const closeFile = useCallback(() => {
    destroyCurrent();
    pdfRef.current = null;
    setPdf(null);
    setFileName("");
    setFilePath("");
    setNumPages(0);
    setCurrentPage(1);
    pageSizesRef.current = new Map();
    setOutline([]);
    setErrorKey(null);
    setPasswordOpen(false);
    currentPathRef.current = "";
    callbacksRef.current.onClosed?.();
  }, [destroyCurrent]);

  return {
    // 状态
    pdf,
    fileName,
    filePath,
    numPages,
    currentPage,
    setCurrentPage,
    outline,
    pageSizesRef,
    loading,
    errorKey,
    setErrorKey,
    currentPathRef,
    // 操作
    loadFile,
    closeFile,
    // 密码弹窗
    passwordOpen,
    passwordWrong,
    handlePasswordSubmit,
    handlePasswordCancel,
  };
}

export type DocumentSession = ReturnType<typeof useDocumentSession>;
