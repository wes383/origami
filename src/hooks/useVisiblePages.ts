import { useCallback, useEffect, useRef, useState, type RefObject } from "react";

interface UseVisiblePagesOptions {
  containerRef: RefObject<HTMLElement | null>;
  numPages: number;
  /** 仅连续模式启用 */
  enabled: boolean;
  /** 可见面积最大的页作为当前页 */
  onCurrentPageChange: (page: number) => void;
}

/**
 * 双 IntersectionObserver：
 * 1. 渲染观察器（rootMargin 600px 缓冲）维护需要渲染的页集合；
 * 2. 追踪观察器（无 margin）按可见比例确定当前页。
 */
export function useVisiblePages({
  containerRef,
  numPages,
  enabled,
  onCurrentPageChange,
}: UseVisiblePagesOptions) {
  const [visiblePages, setVisiblePages] = useState<Set<number>>(new Set());
  const ratioRef = useRef<Map<number, number>>(new Map());
  const elementsRef = useRef<Map<number, HTMLElement>>(new Map());
  const changeRef = useRef(onCurrentPageChange);
  changeRef.current = onCurrentPageChange;

  const registerPage = useCallback((page: number, el: HTMLElement | null) => {
    if (el) elementsRef.current.set(page, el);
    else elementsRef.current.delete(page);
  }, []);

  useEffect(() => {
    if (!enabled) return;
    const container = containerRef.current;
    if (!container) return;

    const renderObserver = new IntersectionObserver(
      (entries) => {
        setVisiblePages((prev) => {
          const next = new Set(prev);
          let changed = false;
          for (const entry of entries) {
            const page = Number((entry.target as HTMLElement).dataset.page);
            if (entry.isIntersecting) {
              if (!next.has(page)) {
                next.add(page);
                changed = true;
              }
            } else if (next.has(page)) {
              next.delete(page);
              changed = true;
            }
          }
          return changed ? next : prev;
        });
      },
      { root: container, rootMargin: "600px 0px" }
    );

    const trackObserver = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const page = Number((entry.target as HTMLElement).dataset.page);
          ratioRef.current.set(page, entry.intersectionRatio);
        }
        let best = 0;
        let bestPage = -1;
        for (const [page, ratio] of ratioRef.current) {
          if (ratio > best) {
            best = ratio;
            bestPage = page;
          }
        }
        if (bestPage > 0) changeRef.current(bestPage);
      },
      { root: container, threshold: [0, 0.05, 0.1, 0.25, 0.5, 0.75, 1] }
    );

    for (const el of elementsRef.current.values()) {
      renderObserver.observe(el);
      trackObserver.observe(el);
    }

    return () => {
      renderObserver.disconnect();
      trackObserver.disconnect();
      ratioRef.current.clear();
    };
  }, [enabled, numPages, containerRef]);

  return { visiblePages, registerPage };
}
