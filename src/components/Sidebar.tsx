import { useEffect, useMemo, useRef, useState } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import type { OutlineNode } from "../lib/pdf";
import { useI18n } from "../i18n";
import { ChevronDownIcon, ChevronRightIcon, XIcon } from "./Icons";

export type SidebarTab = "outline" | "thumbnails";

/** 缩略图渲染宽度（CSS px），面板内单列 */
const THUMB_WIDTH = 152;

interface SidebarProps {
  doc: PDFDocumentProxy;
  numPages: number;
  outline: OutlineNode[];
  tab: SidebarTab;
  onTabChange: (tab: SidebarTab) => void;
  currentPage: number;
  /** 点击条目/缩略图跳转到目标页 */
  onNavigate: (page: number) => void;
  onClose: () => void;
}

export default function Sidebar({
  doc,
  numPages,
  outline,
  tab,
  onTabChange,
  currentPage,
  onNavigate,
  onClose,
}: SidebarProps) {
  const { t } = useI18n();
  const hasOutline = outline.length > 0;
  const activeTab: SidebarTab = tab === "outline" && hasOutline ? "outline" : "thumbnails";

  return (
    <aside className="sidebar-panel">
      <div className="sidebar-head">
        <div className="sidebar-tabs" role="tablist">
          {hasOutline && (
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === "outline"}
              className={`sidebar-tab ${activeTab === "outline" ? "is-active" : ""}`}
              onClick={() => onTabChange("outline")}
            >
              {t("toc")}
            </button>
          )}
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "thumbnails"}
            className={`sidebar-tab ${activeTab === "thumbnails" ? "is-active" : ""}`}
            onClick={() => onTabChange("thumbnails")}
          >
            {t("thumbnails")}
          </button>
        </div>
        <button
          type="button"
          className="sidebar-close"
          onClick={onClose}
          title={t("tocClose")}
          aria-label={t("tocClose")}
        >
          <XIcon size={15} />
        </button>
      </div>
      {activeTab === "outline" ? (
        <OutlineTree outline={outline} currentPage={currentPage} onNavigate={onNavigate} />
      ) : (
        <ThumbnailList
          doc={doc}
          numPages={numPages}
          currentPage={currentPage}
          onNavigate={onNavigate}
        />
      )}
    </aside>
  );
}

/* ==========================================================================
   目录树
   ========================================================================== */

/** 扁平化后的目录条目（前序遍历），用于定位当前章节 */
interface FlatEntry {
  node: OutlineNode;
  /** 祖先节点 id 链（不含自身），用于自动展开 */
  parentIds: string[];
}

function OutlineTree({
  outline,
  currentPage,
  onNavigate,
}: {
  outline: OutlineNode[];
  currentPage: number;
  onNavigate: (page: number) => void;
}) {
  /** 展开的节点 id 集合；初始全部折叠 */
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const activeRowRef = useRef<HTMLButtonElement | null>(null);

  // 前序遍历扁平化
  const flat = useMemo<FlatEntry[]>(() => {
    const out: FlatEntry[] = [];
    const walk = (nodes: OutlineNode[], parents: string[]) => {
      for (const n of nodes) {
        out.push({ node: n, parentIds: parents });
        if (n.children.length) walk(n.children, [...parents, n.id]);
      }
    };
    walk(outline, []);
    return out;
  }, [outline]);

  // 当前章节：目标页不大于当前页的最后一个有条目的节点
  const activeId = useMemo(() => {
    let id: string | null = null;
    for (const e of flat) {
      if (e.node.page != null && e.node.page <= currentPage) id = e.node.id;
    }
    return id;
  }, [flat, currentPage]);

  // 祖先自动展开 + 活动行滚动到可见
  useEffect(() => {
    if (!activeId) return;
    const entry = flat.find((e) => e.node.id === activeId);
    if (!entry) return;
    setExpanded((prev) => {
      if (entry.parentIds.every((id) => prev.has(id))) return prev;
      const next = new Set(prev);
      entry.parentIds.forEach((id) => next.add(id));
      return next;
    });
    // 等待展开渲染后再滚动
    requestAnimationFrame(() => {
      activeRowRef.current?.scrollIntoView({ block: "nearest" });
    });
  }, [activeId, flat]);

  const toggle = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const renderNodes = (nodes: OutlineNode[]) => (
    <div className="outline-children">
      {nodes.map((node) => {
        const hasChildren = node.children.length > 0;
        const isOpen = expanded.has(node.id);
        const isActive = node.id === activeId;
        return (
          <div key={node.id} className="outline-node">
            <button
              type="button"
              ref={isActive ? activeRowRef : undefined}
              className={`outline-item ${isActive ? "is-active" : ""}`}
              onClick={() => {
                if (node.page != null) onNavigate(node.page);
                else if (hasChildren) toggle(node.id);
              }}
              title={node.title}
            >
              {hasChildren ? (
                <span
                  className="outline-toggle"
                  onClick={(e) => {
                    e.stopPropagation();
                    toggle(node.id);
                  }}
                >
                  {isOpen ? (
                    <ChevronDownIcon size={13} />
                  ) : (
                    <ChevronRightIcon size={13} />
                  )}
                </span>
              ) : (
                <span className="outline-toggle outline-toggle-leaf" />
              )}
              <span className="outline-title">{node.title || "—"}</span>
              {node.page != null && (
                <span className="outline-page">{node.page}</span>
              )}
            </button>
            {hasChildren && isOpen && renderNodes(node.children)}
          </div>
        );
      })}
    </div>
  );

  return <nav className="outline-list">{renderNodes(outline)}</nav>;
}

/* ==========================================================================
   页面缩略图
   ========================================================================== */

function ThumbnailList({
  doc,
  numPages,
  currentPage,
  onNavigate,
}: {
  doc: PDFDocumentProxy;
  numPages: number;
  currentPage: number;
  onNavigate: (page: number) => void;
}) {
  const listRef = useRef<HTMLDivElement | null>(null);

  // 当前页缩略图滚动到可见
  useEffect(() => {
    listRef.current
      ?.querySelector<HTMLElement>(`[data-thumb="${currentPage}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [currentPage]);

  return (
    <div className="thumb-list" ref={listRef}>
      {Array.from({ length: numPages }, (_, i) => (
        <Thumb
          key={i + 1}
          doc={doc}
          pageNumber={i + 1}
          active={currentPage === i + 1}
          onSelect={onNavigate}
          rootRef={listRef}
        />
      ))}
    </div>
  );
}

function Thumb({
  doc,
  pageNumber,
  active,
  onSelect,
  rootRef,
}: {
  doc: PDFDocumentProxy;
  pageNumber: number;
  active: boolean;
  onSelect: (page: number) => void;
  rootRef: React.RefObject<HTMLDivElement | null>;
}) {
  const itemRef = useRef<HTMLButtonElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  /** 进入视口缓冲区后才渲染 */
  const [visible, setVisible] = useState(false);
  const [rendered, setRendered] = useState(false);
  /** 真实宽高比（渲染前用 A4 竖版比例占位，防止滚动跳动） */
  const [ratio, setRatio] = useState<number | null>(null);

  // 懒渲染：进入滚动容器视口（含缓冲区）即触发一次
  useEffect(() => {
    const el = itemRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisible(true);
          io.disconnect();
        }
      },
      { root: rootRef.current, rootMargin: "300px 0px" }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [rootRef]);

  useEffect(() => {
    if (!visible || rendered) return;
    let cancelled = false;
    let renderTask: { cancel(): void } | null = null;
    (async () => {
      try {
        const page = await doc.getPage(pageNumber);
        if (cancelled) return;
        const base = page.getViewport({ scale: 1 });
        const viewport = page.getViewport({ scale: THUMB_WIDTH / base.width });
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const canvas = canvasRef.current;
        if (!canvas) return;
        canvas.width = Math.floor(viewport.width * dpr);
        canvas.height = Math.floor(viewport.height * dpr);
        setRatio(viewport.height / viewport.width);
        const task = page.render({
          canvas,
          viewport,
          // canvas backing store 放大 dpr 倍，需同步缩放绘制内容
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
  }, [visible, rendered, doc, pageNumber]);

  const height = Math.round(THUMB_WIDTH * (ratio ?? 1.414));

  return (
    <button
      ref={itemRef}
      type="button"
      data-thumb={pageNumber}
      className={`thumb-item ${active ? "is-active" : ""}`}
      onClick={() => onSelect(pageNumber)}
      title={String(pageNumber)}
    >
      <span className="thumb-frame" style={{ width: THUMB_WIDTH, height }}>
        <canvas ref={canvasRef} className={rendered ? "is-rendered" : ""} />
        {!rendered && (
          <span className="thumb-placeholder" aria-hidden="true">
            <span>{pageNumber}</span>
          </span>
        )}
      </span>
      <span className="thumb-page">{pageNumber}</span>
    </button>
  );
}
