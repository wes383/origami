import { useEffect, useMemo, useRef, useState } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { docKey, type OutlineNode } from "../lib/pdf";
import { renderCacheGet, renderCacheSet, thumbCacheKey } from "../lib/renderCache";
import type { Bookmark } from "../lib/bookmarks";
import {
  ANNO_DEFAULT_COLOR,
  annoIconTone,
  annoInk,
  type Annotation,
  type AnnotationType,
} from "../lib/annotations";
import { useI18n } from "../i18n";
import {
  AnnotateIcon,
  BookmarkIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  GridIcon,
  HighlighterIcon,
  ListIcon,
  PencilIcon,
  PlusIcon,
  SearchIcon,
  StackIcon,
  StickyNoteIcon,
  StrikethroughIcon,
  TrashIcon,
  UnderlineIcon,
  XIcon,
} from "./Icons";

export type SidebarTab = "outline" | "thumbnails" | "bookmarks" | "annotations";

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
  /** 当前文档的书签列表（按页码升序） */
  bookmarks: Bookmark[];
  /** 添加当前页为书签 */
  onAddBookmark: () => void;
  /** 移除第 index 条书签（索引对应 bookmarks 数组顺序） */
  onRemoveBookmark: (index: number) => void;
  /** 重命名第 index 条书签（label 传空串表示恢复默认标题） */
  onRenameBookmark: (index: number, label: string) => void;
  /** 当前文档的全部注释（跨类型、按创建序存储） */
  annotations: Annotation[];
  /** 删除指定 id 的注释（列表条目内的删除按钮） */
  onDeleteAnnotation: (id: string) => void;
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
  bookmarks,
  onAddBookmark,
  onRemoveBookmark,
  onRenameBookmark,
  annotations,
  onDeleteAnnotation,
  onClose,
}: SidebarProps) {
  const { t } = useI18n();
  const hasOutline = outline.length > 0;
  // 无目录时回退到缩略图；书签页始终可用
  const activeTab: SidebarTab =
    tab === "outline" && !hasOutline ? "thumbnails" : tab;

  /** 「编辑列表」开关：书签 / 注释 tab 头部（关闭钮左侧）的笔按钮触发，
      开启后两个列表的条目右侧才出现删除钮 */
  const [listEditing, setListEditing] = useState(false);
  const canEditList =
    activeTab === "bookmarks" || activeTab === "annotations";

  /** 切换 tab 时退出列表编辑态（编辑按钮只在这两个 tab 下存在） */
  const changeTab = (next: SidebarTab) => {
    setListEditing(false);
    onTabChange(next);
  };

  /** 编辑态下点击除「条目删除钮 / 编辑开关」以外的任意位置立即退出编辑态：
      在面板上统一收口冒泡事件（条目自身跳页 / 行内改名等 handler 先行执行，
      删除钮点击不退出以支持连续删除） */
  const onPanelClick = (e: React.MouseEvent<HTMLElement>) => {
    if (!listEditing) return;
    if ((e.target as HTMLElement).closest(".bm-del, .anl-del, .sidebar-edit"))
      return;
    setListEditing(false);
  };

  const panelRef = useRef<HTMLElement | null>(null);

  // 编辑态下点击侧栏「外部」任意位置同样退出编辑态（内部点击交由 onPanelClick 统一处理，
  // 删除钮 / 编辑开关的豁免逻辑不受影响）
  useEffect(() => {
    if (!listEditing) return;
    const onDocPointerDown = (e: PointerEvent) => {
      if (panelRef.current?.contains(e.target as Node)) return;
      setListEditing(false);
    };
    document.addEventListener("pointerdown", onDocPointerDown);
    return () => document.removeEventListener("pointerdown", onDocPointerDown);
  }, [listEditing]);

  return (
    <aside className="sidebar-panel" ref={panelRef} onClick={onPanelClick}>
      <div className="sidebar-head">
        <div className="sidebar-tabs" role="tablist">
          {hasOutline && (
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === "outline"}
              aria-label={t("toc")}
              title={t("toc")}
              className={`sidebar-tab ${activeTab === "outline" ? "is-active" : ""}`}
              onClick={() => changeTab("outline")}
            >
              <ListIcon size={15} />
            </button>
          )}
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "thumbnails"}
            aria-label={t("thumbnails")}
            title={t("thumbnails")}
            className={`sidebar-tab ${activeTab === "thumbnails" ? "is-active" : ""}`}
            onClick={() => changeTab("thumbnails")}
          >
            <GridIcon size={15} />
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "bookmarks"}
            aria-label={t("bookmarks")}
            title={t("bookmarks")}
            className={`sidebar-tab ${activeTab === "bookmarks" ? "is-active" : ""}`}
            onClick={() => changeTab("bookmarks")}
          >
            <BookmarkIcon size={15} />
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "annotations"}
            aria-label={t("annotateTools")}
            title={t("annotateTools")}
            className={`sidebar-tab ${activeTab === "annotations" ? "is-active" : ""}`}
            onClick={() => changeTab("annotations")}
          >
            <AnnotateIcon size={15} />
          </button>
        </div>
        <div className="sidebar-actions">
          {canEditList && (
            <button
              type="button"
              className={`sidebar-edit ${listEditing ? "is-active" : ""}`}
              onClick={() => setListEditing((v) => !v)}
              title={listEditing ? t("listEditDone") : t("listEdit")}
              aria-label={listEditing ? t("listEditDone") : t("listEdit")}
              aria-pressed={listEditing}
            >
              <PencilIcon size={14} />
            </button>
          )}
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
      </div>
      {activeTab === "outline" ? (
        <OutlineTree outline={outline} currentPage={currentPage} onNavigate={onNavigate} />
      ) : activeTab === "bookmarks" ? (
        <BookmarkList
          bookmarks={bookmarks}
          currentPage={currentPage}
          onNavigate={onNavigate}
          onAddCurrent={onAddBookmark}
          onRemove={onRemoveBookmark}
          onRename={onRenameBookmark}
          listEdit={listEditing}
        />
      ) : activeTab === "annotations" ? (
        <AnnotationList
          annotations={annotations}
          currentPage={currentPage}
          onNavigate={onNavigate}
          onDelete={onDeleteAnnotation}
          listEdit={listEditing}
        />
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

/* ==========================================================================
   用户书签（复用缩略图列表的视觉语言：同一容器与卡片质感）
   ========================================================================== */

function BookmarkList({
  bookmarks,
  currentPage,
  onNavigate,
  onAddCurrent,
  onRemove,
  onRename,
  listEdit,
}: {
  bookmarks: Bookmark[];
  currentPage: number;
  onNavigate: (page: number) => void;
  onAddCurrent: () => void;
  onRemove: (index: number) => void;
  onRename: (index: number, label: string) => void;
  /** 编辑态：为真时条目右侧显示删除钮 */
  listEdit: boolean;
}) {
  const { t } = useI18n();
  /** 当前页是否已加书签（是则隐藏底部"添加当前页"按钮） */
  const currentBookmarked = bookmarks.some((b) => b.page === currentPage);
  /** 正在行内改名的条目索引（null = 无） */
  const [editing, setEditing] = useState<number | null>(null);
  /** 输入框草稿（初始为原 label；未自定义时为占位提示默认标题） */
  const [draft, setDraft] = useState("");
  /** 显式取消/提交后置真，屏蔽随后的 blur 误提交（参照自动阅读输入框惯例） */
  const cancelledRef = useRef(false);

  /** 条目标题：自定义 label 优先；未命名时默认「第 x 页」（本地化） */
  const titleOf = (b: Bookmark) =>
    b.label || t("bookmarkDefaultLabel").replace("{n}", String(b.page));

  const beginEdit = (index: number) => {
    cancelledRef.current = false;
    setEditing(index);
    setDraft(bookmarks[index]?.label ?? "");
  };

  /** 提交：Trim 后存 label（空串 = 恢复默认标题） */
  const finishEdit = () => {
    if (editing == null) return;
    const index = editing;
    cancelledRef.current = true; // 屏蔽提交后输入框卸载触发的 blur
    setEditing(null);
    onRename(index, draft.trim());
  };

  /** Esc 取消：不改动 label */
  const cancelEdit = () => {
    cancelledRef.current = true;
    setEditing(null);
  };

  /** 失焦：仅当未显式取消/提交过才提交 */
  const handleBlur = () => {
    if (editing == null) return;
    if (cancelledRef.current) {
      cancelledRef.current = false;
      return;
    }
    finishEdit();
  };

  return (
    <div className="thumb-list">
      {bookmarks.length === 0 ? (
        <div className="bookmark-empty">{t("bookmarkEmpty")}</div>
      ) : (
        bookmarks.map((b, i) => {
          const isEditing = editing === i;
          return (
            <div
              key={b.page}
              className={`bm-item ${b.page === currentPage ? "is-active" : ""} ${
                isEditing ? "is-editing" : ""
              }`}
              onClick={(e) => {
                // 编辑中：点击空白仅让输入框失焦（提交/取消），不跳页
                if (isEditing) return;
                // 点击内部按钮（跳转/改名/删除）时交还自身处理
                if ((e.target as HTMLElement).closest("button")) return;
                onNavigate(b.page);
              }}
            >
              {isEditing ? (
                <div className="bm-main">
                  <span className="bm-page">{b.page}</span>
                  <input
                    className="bm-edit"
                    type="text"
                    value={draft}
                    placeholder={b.label ? undefined : titleOf(b)}
                    autoFocus
                    onChange={(e) => setDraft(e.target.value)}
                    onFocus={(e) => e.currentTarget.select()}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") finishEdit();
                      else if (e.key === "Escape") cancelEdit();
                    }}
                    onBlur={handleBlur}
                    aria-label={t("bookmarkRename")}
                  />
                </div>
              ) : (
                <button
                  type="button"
                  className="bm-main"
                  onClick={() => onNavigate(b.page)}
                  title={b.label ? `${b.label} · ${b.page}` : String(b.page)}
                >
                  <span className="bm-page">{b.page}</span>
                  {/* 无独立编辑钮：第一击跳页（该条成为当前页）后，
                      再次点击标题文字进入行内改名；尚未在当前页时点标题仍是跳页 */}
                  <span
                    className={`bm-label ${b.label ? "" : "bm-label-empty"}`}
                    title={b.page === currentPage ? t("bookmarkRename") : undefined}
                    onClick={(e) => {
                      if (b.page !== currentPage) return;
                      e.preventDefault();
                      e.stopPropagation();
                      beginEdit(i);
                    }}
                  >
                    {titleOf(b)}
                  </span>
                </button>
              )}
              {listEdit && (
                <button
                  type="button"
                  className="bm-del"
                  onClick={() => onRemove(i)}
                  tabIndex={isEditing ? -1 : 0}
                  title={t("removeBookmark")}
                  aria-label={t("removeBookmark")}
                >
                  <TrashIcon size={13} />
                </button>
              )}
            </div>
          );
        })
      )}
      {!currentBookmarked && (
        <button type="button" className="bm-add" onClick={onAddCurrent}>
          <PlusIcon size={14} />
          <span>{t("bookmarkAddCurrent")}</span>
        </button>
      )}
    </div>
  );
}

/* ==========================================================================
   注释列表（高亮 / 下划线 / 删除线 / 文字批注 汇总，按页码升序）
   ========================================================================== */

/** 类型过滤 chips 顺序：null = 全部 → 四类注释 */
const ANNO_TYPE_FILTERS: (AnnotationType | null)[] = [
  null,
  "highlight",
  "underline",
  "strikeout",
  "note",
];

function AnnotationList({
  annotations,
  currentPage,
  onNavigate,
  onDelete,
  listEdit,
}: {
  annotations: Annotation[];
  currentPage: number;
  onNavigate: (page: number) => void;
  onDelete: (id: string) => void;
  /** 编辑态：为真时条目右侧显示删除钮 */
  listEdit: boolean;
}) {
  const { t } = useI18n();

  /** 按页码升序（同页按创建先后），列表始终稳定有序 */
  const sorted = useMemo(
    () =>
      [...annotations].sort((a, b) => a.page - b.page || a.at - b.at),
    [annotations]
  );

  /** 类型过滤：null = 全部类型 */
  const [filter, setFilter] = useState<AnnotationType | null>(null);

  /** 过滤后的展示列表 */
  const filtered = useMemo(
    () => (filter ? sorted.filter((a) => a.type === filter) : sorted),
    [sorted, filter]
  );

  const typeName = (type: AnnotationType): string => {
    switch (type) {
      case "highlight":
        return t("annotateHighlight");
      case "underline":
        return t("annotateUnderline");
      case "strikeout":
        return t("annotateStrikeout");
      case "note":
        return t("annotateNote");
    }
  };

  /** 条目主文案：文字批注优先显示正文（用户写的内容），几何注释显示选中摘录 */
  const labelOf = (a: Annotation): string => {
    const raw =
      a.type === "note" && a.note.trim()
        ? a.note
        : a.text || typeName(a.type);
    return raw.replace(/\s+/g, " ").trim() || typeName(a.type);
  };

  const typeIcon = (type: AnnotationType, size = 12) => {
    switch (type) {
      case "highlight":
        return <HighlighterIcon size={size} />;
      case "underline":
        return <UnderlineIcon size={size} />;
      case "strikeout":
        return <StrikethroughIcon size={size} />;
      case "note":
        return <StickyNoteIcon size={size} />;
    }
  };

  return (
    <div className="anl-panel">
      {sorted.length > 0 && (
        <div className="anl-filters" role="group" aria-label={t("annotateTools")}>
          {/* 过滤 chips：全部 + 四类型（null=全部）。纯图标钮，类型图标按类型默认落笔色
              着色（is-active 背景 accent-muted），文字移至 title / aria-label */}
          {ANNO_TYPE_FILTERS.map((ft) => {
            const active = filter === ft;
            const chipTitle = ft === null ? t("annotateAll") : typeName(ft);
            const chipColor =
              ft === "note"
                ? "#b45309"
                : ft
                  ? annoInk(ANNO_DEFAULT_COLOR[ft])
                  : undefined;
            return (
              <button
                key={ft ?? "all"}
                type="button"
                className={`anl-chip${active ? " is-active" : ""}`}
                title={chipTitle}
                aria-label={chipTitle}
                aria-pressed={active}
                onClick={() => setFilter(ft)}
              >
                {ft === null ? (
                  <StackIcon size={14} />
                ) : (
                  <span
                    className="anl-chip-ic"
                    style={{ color: chipColor }}
                    aria-hidden="true"
                  >
                    {typeIcon(ft, 14)}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}
      <div className="thumb-list">
        {filtered.length === 0 ? (
          <div className="anl-empty">{t("annotationListEmpty")}</div>
        ) : (
          filtered.map((a) => {
            // 几何类图标 chip 跟随该条实际落笔色（旧数据无 color → 类型默认色）；
            // note 无颜色概念走 CSS 琥珀兜底
            const geom = a.type === "note" ? null : a.type;
            const cur = geom ? (a.color ?? ANNO_DEFAULT_COLOR[geom]) : null;
            const tone = geom && cur ? annoIconTone(cur) : undefined;
            const label = labelOf(a);
            return (
              <div
                key={a.id}
                className={`anl-item ${a.page === currentPage ? "is-active" : ""}`}
                onClick={(e) => {
                  if ((e.target as HTMLElement).closest("button")) return;
                  onNavigate(a.page);
                }}
              >
                <button
                  type="button"
                  className="anl-main"
                  onClick={() => onNavigate(a.page)}
                  title={`${typeName(a.type)} · ${a.page}${label ? ` · ${label}` : ""}`}
                >
                  <span
                    className={`anl-ic ${a.type === "note" ? "is-note" : ""}`}
                    style={tone}
                    aria-hidden="true"
                  >
                    {typeIcon(a.type)}
                  </span>
                  <span className="anl-label">{label}</span>
                </button>
                <span className="anl-page">{a.page}</span>
                {listEdit && (
                  <button
                    type="button"
                    className="anl-del"
                    onClick={() => onDelete(a.id)}
                    title={t("annotateDelete")}
                    aria-label={t("annotateDelete")}
                  >
                    <TrashIcon size={13} />
                  </button>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
