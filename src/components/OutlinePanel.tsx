import { useEffect, useMemo, useRef, useState } from "react";
import type { OutlineNode } from "../lib/pdf";
import { useI18n } from "../i18n";
import { ChevronDownIcon, ChevronRightIcon, XIcon } from "./Icons";

interface OutlinePanelProps {
  outline: OutlineNode[];
  currentPage: number;
  /** 点击条目跳转到目标页 */
  onNavigate: (page: number) => void;
  onClose: () => void;
}

/** 扁平化后的目录条目（前序遍历），用于定位当前章节 */
interface FlatEntry {
  node: OutlineNode;
  /** 祖先节点 id 链（不含自身），用于自动展开 */
  parentIds: string[];
}

export default function OutlinePanel({
  outline,
  currentPage,
  onNavigate,
  onClose,
}: OutlinePanelProps) {
  const { t } = useI18n();
  /** 展开的节点 id 集合；初始展开顶层 */
  const [expanded, setExpanded] = useState<Set<string>>(
    () => new Set(outline.map((n) => n.id))
  );
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
              <span className="outline-title">
                {node.title || "—"}
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
    <aside className="outline-panel">
      <div className="outline-head">
        <span className="outline-head-title">{t("toc")}</span>
        <button
          type="button"
          className="outline-close"
          onClick={onClose}
          title={t("tocClose")}
          aria-label={t("tocClose")}
        >
          <XIcon size={15} />
        </button>
      </div>
      <nav className="outline-list">{renderNodes(outline)}</nav>
    </aside>
  );
}
