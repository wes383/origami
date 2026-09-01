import { useCallback, useEffect, useRef, useState } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { searchDocument, type SearchMatch } from "../lib/search";
import { useI18n } from "../i18n";
import {
  ChevronDownIcon,
  ChevronUpIcon,
  SearchIcon,
  StopIcon,
  XIcon,
} from "./Icons";

const DEBOUNCE_MS = 250;

interface SearchBarProps {
  doc: PDFDocumentProxy;
  /** 结果集上抛（供页面高亮渲染） */
  onMatchesChange: (matches: SearchMatch[]) => void;
  /** 当前选中的匹配变化（App 负责翻页/滚动/激活高亮） */
  onActiveChange: (match: SearchMatch | null) => void;
  onClose: () => void;
}

export default function SearchBar({
  doc,
  onMatchesChange,
  onActiveChange,
  onClose,
}: SearchBarProps) {
  const { t } = useI18n();
  const inputRef = useRef<HTMLInputElement | null>(null);
  /** 搜索代际号：词变更后旧任务的回调直接作废 */
  const runIdRef = useRef(0);
  const [query, setQuery] = useState("");
  const [committed, setCommitted] = useState("");
  const [matches, setMatches] = useState<SearchMatch[]>([]);
  const [activeIdx, setActiveIdx] = useState(-1);
  const [searching, setSearching] = useState(false);
  /** 已扫描页数 / 总页数：长文档查找时给出进度反馈 */
  const [scanned, setScanned] = useState(0);

  // 挂载即聚焦输入框
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // 输入防抖后提交搜索词
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setCommitted(query.trim());
    }, DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [query]);

  // 执行搜索：逐页流式追加结果，词变更/组件卸载即中止
  useEffect(() => {
    if (!committed) {
      runIdRef.current += 1;
      setSearching(false);
      setMatches([]);
      setActiveIdx(-1);
      return;
    }
    const runId = ++runIdRef.current;
    setSearching(true);
    setMatches([]);
    setActiveIdx(-1);
    setScanned(0);
    (async () => {
      await searchDocument(doc, committed, {
        onPage: (pageMatches) => {
          if (runIdRef.current !== runId) return false;
          setMatches((prev) => [...prev, ...pageMatches]);
          return true;
        },
        onProgress: (done) => {
          if (runIdRef.current !== runId) return false;
          setScanned(done);
          return true;
        },
      });
      if (runIdRef.current !== runId) return;
      setSearching(false);
    })();
    return () => {
      runIdRef.current += 1;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [committed, doc]);

  /**
   * 停止查找：仅推进代际号让进行中的回调返回 false（下一页即中止），
   * 已收集到的结果保留，查找栏不关闭。
   */
  const stop = useCallback(() => {
    runIdRef.current += 1;
    setSearching(false);
  }, []);

  // 结果集变化即上抛
  useEffect(() => {
    onMatchesChange(matches);
  }, [matches, onMatchesChange]);

  // 首个结果到达时自动选中（对齐浏览器 Ctrl+F 行为）
  useEffect(() => {
    if (activeIdx === -1 && matches.length > 0) setActiveIdx(0);
  }, [matches, activeIdx]);

  // 选中项变化通知 App
  useEffect(() => {
    onActiveChange(activeIdx >= 0 ? matches[activeIdx] ?? null : null);
  }, [activeIdx, matches, onActiveChange]);

  const step = (dir: 1 | -1) => {
    if (!matches.length) return;
    setActiveIdx((i) => (i + dir + matches.length) % matches.length);
  };

  const close = () => onClose();

  const countLabel = searching
    ? `${t("searchScanning")} ${scanned}/${doc.numPages}`
    : matches.length
      ? `${activeIdx + 1}/${matches.length}`
      : "0";

  return (
    <div className="search-bar" role="search">
      <span className="search-lead">
        <SearchIcon size={14} />
      </span>
      <input
        ref={inputRef}
        className="search-input"
        value={query}
        placeholder={t("searchPlaceholder")}
        aria-label={t("search")}
        spellCheck={false}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            step(e.shiftKey ? -1 : 1);
          } else if (e.key === "Escape") {
            e.preventDefault();
            close();
          }
        }}
      />
      <span className="search-count" aria-live="polite">
        {countLabel}
      </span>
      <button
        type="button"
        className="search-nav"
        onClick={() => step(-1)}
        disabled={!matches.length}
        title={t("searchPrev")}
        aria-label={t("searchPrev")}
      >
        <ChevronUpIcon size={14} />
      </button>
      <button
        type="button"
        className="search-nav"
        onClick={() => step(1)}
        disabled={!matches.length}
        title={t("searchNext")}
        aria-label={t("searchNext")}
      >
        <ChevronDownIcon size={14} />
      </button>
      {searching && (
        <button
          type="button"
          className="search-nav"
          onClick={stop}
          title={t("searchStop")}
          aria-label={t("searchStop")}
        >
          <StopIcon size={12} />
        </button>
      )}
      <button
        type="button"
        className="search-nav"
        onClick={close}
        title={t("searchClose")}
        aria-label={t("searchClose")}
      >
        <XIcon size={14} />
      </button>
    </div>
  );
}
