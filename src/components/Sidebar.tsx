import { useEffect, useMemo, useRef, useState } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { docKey, type OutlineNode } from "../lib/pdf";
import { renderCacheGet, renderCacheSet, thumbCacheKey } from "../lib/renderCache";
import { useI18n } from "../i18n";
import { ChevronDownIcon, ChevronRightIcon, SearchIcon, XIcon } from "./Icons";

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

/** 过滤后的目录节点（保留与查询匹配的整条路径） */
interface FilteredNode extends OutlineNode {
  /** 自身标题是否命中查询 */
  matchSelf: boolean;
  children: FilteredNode[];
}

/**
 * 按标题过滤目录树：保留标题命中或任一后代命中的节点，并标记 matchSelf 以便高亮。
 * 空查询返回 null（此时使用原始树，不进入搜索态）。
 */
function filterOutline(nodes: OutlineNode[], query: string): FilteredNode[] | null {
  if (!query) return null;
  const lower = query.toLowerCase();
  const walk = (items: OutlineNode[]): FilteredNode[] => {
    const out: FilteredNode[] = [];
    for (const n of items) {
      const matchSelf = n.title.toLowerCase().includes(lower);
      const children = walk(n.children);
      if (matchSelf || children.length > 0) {
        out.push({ ...n, matchSelf, children });
      }
    }
    return out;
  };
  return walk(nodes);
}

/** 把命中子串切分为片段，命中片段用于高亮 */
function splitHighlight(
  title: string,
  query: string
): { text: string; hit: boolean }[] {
  if (!query) return [{ text: title, hit: false }];
  const lower = title.toLowerCase();
  const q = query.toLowerCase();
  const parts: { text: string; hit: boolean }[] = [];
  let i = 0;
  for (;;) {
    const idx = lower.indexOf(q, i);
    if (idx === -1) {
      if (i < title.length) parts.push({ text: title.slice(i), hit: false });
      break;
    }
    if (idx > i) parts.push({ text: title.slice(i, idx), hit: false });
    parts.push({ text: title.slice(idx, idx + q.length), hit: true });
    i = idx + q.length;
  }
  return parts;
}

/** 前序查找第一个命中且含页码的节点（供回车跳转） */
function firstMatch(nodes: FilteredNode[]): FilteredNode | null {
  for (const n of nodes) {
    if (n.matchSelf && n.page != null) return n;
    const c = firstMatch(n.children);
    if (c) return c;
  }
  return null;
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
  const { t } = useI18n();
  /** 展开的节点 id 集合；初始全部折叠 */
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  /** 目录搜索词（空 = 未搜索） */
  const [query, setQuery] = useState("");
  const activeRowRef = useRef<HTMLButtonElement | null>(null);

  const trimmed = query.trim();
  /** null 表示未搜索，渲染完整目录树 */
  const filtered = useMemo(() => filterOutline(outline, trimmed), [outline, trimmed]);

  /** 命中条目数（仅搜索态有意义） */
  const matchCount = useMemo(() => {
    if (!filtered) return 0;
    let c = 0;
    const walk = (ns: FilteredNode[]) =>
      ns.forEach((n) => {
        if (n.matchSelf) c++;
        walk(n.children);
      });
    walk(filtered);
    return c;
  }, [filtered]);

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

  // 搜索态：自动展开所有含子级的过滤节点，使命中路径完整可见；
  // 退出搜索（清空）时回到默认全折叠
  useEffect(() => {
    if (!filtered) {
      setExpanded(new Set());
      return;
    }
    const all = new Set<string>();
    const walk = (ns: FilteredNode[]) =>
      ns.forEach((n) => {
        if (n.children.length) {
          all.add(n.id);
          walk(n.children);
        }
      });
    walk(filtered);
    setExpanded(all);
  }, [filtered]);

  // 祖先自动展开 + 活动行滚动到可见（仅非搜索态）
  useEffect(() => {
    if (!activeId || filtered) return;
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
  }, [activeId, flat, filtered]);

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
              <span className="outline-title">
                {trimmed ? (
                  splitHighlight(node.title, trimmed).map((p, i) =>
                    p.hit ? (
                      <mark key={i} className="outline-hl">
                        {p.text}
                      </mark>
                    ) : (
                      <span key={i}>{p.text}</span>
                    )
                  )
                ) : (
                  (node.title || "—")
                )}
              </span>
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

  return (
    <>
      <div className="outline-search">
        <span className="outline-search-lead">
          <SearchIcon size={14} />
        </span>
        <input
          className="outline-search-input"
          type="text"
          value={query}
          placeholder={t("tocSearchPlaceholder")}
          aria-label={t("tocSearchPlaceholder")}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && filtered) {
              const f = firstMatch(filtered);
              if (f?.page != null) onNavigate(f.page);
            } else if (e.key === "Escape") {
              setQuery("");
            }
          }}
        />
        {trimmed && (
          <>
            <span className="outline-search-count">
              {t("tocMatchCount").replace("{n}", String(matchCount))}
            </span>
            <button
              type="button"
              className="outline-search-clear"
              onClick={() => setQuery("")}
              title={t("searchClose")}
              aria-label={t("searchClose")}
            >
              <XIcon size={13} />
            </button>
          </>
        )}
      </div>
      {filtered && filtered.length === 0 ? (
        <div className="outline-empty">{t("tocNoMatch")}</div>
      ) : (
        <nav className="outline-list">{renderNodes(filtered ?? outline)}</nav>
      )}
    </>
  );
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
        const canvas = canvasRef.current;
        if (!canvas) return;

        // 缩略图缓存：重开同一文档时直接贴图，跳过重新解码
        const cacheKey = thumbCacheKey(docKey(doc), pageNumber);
        const cached = renderCacheGet(cacheKey);
        if (cached) {
          canvas.width = cached.width;
          canvas.height = cached.height;
          const ctx = canvas.getContext("2d");
          if (ctx) ctx.drawImage(cached, 0, 0);
          if (cancelled) return;
          setRatio(cached.height / cached.width);
          setRendered(true);
          return;
        }

        const page = await doc.getPage(pageNumber);
        if (cancelled) return;
        const base = page.getViewport({ scale: 1 });
        const viewport = page.getViewport({ scale: THUMB_WIDTH / base.width });
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
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
        if (cancelled) return;
        setRendered(true);
        renderCacheSet(cacheKey, canvas);
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
