import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import {
  searchDocument,
  InvalidRegexError,
  type SearchMatch,
  type SearchFlags,
} from "../lib/search";
import { useI18n } from "../i18n";
import {
  CaseIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  ListIcon,
  RegexIcon,
  SearchIcon,
  StopIcon,
  WordIcon,
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
  /** 搜索代际号：词/选项变更后旧任务的回调直接作废 */
  const runIdRef = useRef(0);
  const [query, setQuery] = useState("");
  const [committed, setCommitted] = useState("");
  const [matches, setMatches] = useState<SearchMatch[]>([]);
  const [activeIdx, setActiveIdx] = useState(-1);
  const [searching, setSearching] = useState(false);
  /** 已扫描页数 / 总页数：长文档查找时给出进度反馈 */
  const [scanned, setScanned] = useState(0);
  /** 命中数达到上限被截断：提示用户缩小范围 */
  const [truncated, setTruncated] = useState(false);
  /** 非法/零宽正则提示 */
  const [regexError, setRegexError] = useState(false);

  // 匹配选项（切换即触发新搜索）
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);
  const [regex, setRegex] = useState(false);
  /** 结果列表展开状态（默认收起，点图标展开） */
  const [listOpen, setListOpen] = useState(false);
  /** 当前激活项在列表中的引用：点击/上下切换后滚入视野 */
  const listRef = useRef<HTMLDivElement | null>(null);

  const flags: SearchFlags = useMemo(
    () => ({ caseSensitive, wholeWord, regex }),
    [caseSensitive, wholeWord, regex]
  );

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

  // 执行搜索：逐页流式追加结果，词/选项变更/组件卸载即中止
  useEffect(() => {
    if (!committed) {
      runIdRef.current += 1;
      setSearching(false);
      setMatches([]);
      setActiveIdx(-1);
      setScanned(0);
      setTruncated(false);
      setRegexError(false);
      return;
    }
    const runId = ++runIdRef.current;
    setSearching(true);
    setMatches([]);
    setActiveIdx(-1);
    setScanned(0);
    setTruncated(false);
    setRegexError(false);
    (async () => {
      try {
        await searchDocument(doc, committed, {
          flags,
          onPage: (pageMatches, limitHit) => {
            if (runIdRef.current !== runId) return false;
            setMatches((prev) => [...prev, ...pageMatches]);
            if (limitHit) setTruncated(true);
            return true;
          },
          onProgress: (done) => {
            if (runIdRef.current !== runId) return false;
            setScanned(done);
            return true;
          },
        });
      } catch (err) {
        // 非法正则 / 零宽匹配：清空结果并提示（同时结束扫描态）
        if (err instanceof InvalidRegexError) {
          if (runIdRef.current === runId) {
            setSearching(false);
            setRegexError(true);
          }
          return;
        }
        throw err;
      }
      if (runIdRef.current !== runId) return;
      setSearching(false);
    })();
    return () => {
      runIdRef.current += 1;
    };
  }, [committed, doc, flags]);

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

  // 激活项变化后滚入结果列表视野（列表展开时）
  useEffect(() => {
    if (!listOpen || activeIdx < 0) return;
    listRef.current
      ?.querySelector(`[data-idx="${activeIdx}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [activeIdx, listOpen]);

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

  /** 选项切换按钮（可复用三枚）：aria-pressed 上报开关态 */
  const toggleBtn = (
    key: "case" | "word" | "regex",
    on: boolean,
    onClick: () => void,
    label: string,
    icon: React.ReactNode
  ) => (
    <button
      type="button"
      className={`search-opt ${on ? "is-on" : ""}`}
      onClick={onClick}
      title={label}
      aria-label={label}
      aria-pressed={on}
      data-key={key}
    >
      {icon}
    </button>
  );

  return (
    <div className="search-wrap" role="search">
      <div className="search-bar">
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
        {toggleBtn(
          "case",
          caseSensitive,
          () => setCaseSensitive((v) => !v),
          t("searchCaseSensitive"),
          <CaseIcon size={14} />
        )}
        {toggleBtn(
          "word",
          wholeWord,
          () => setWholeWord((v) => !v),
          t("searchWholeWord"),
          <WordIcon size={14} />
        )}
        {toggleBtn(
          "regex",
          regex,
          () => setRegex((v) => !v),
          t("searchRegex"),
          <RegexIcon size={14} />
        )}
        <button
          type="button"
          className={`search-nav ${listOpen ? "is-on" : ""}`}
          onClick={() => setListOpen((v) => !v)}
          disabled={!matches.length && !searching}
          title={t("searchResultList")}
          aria-label={t("searchResultList")}
          aria-pressed={listOpen}
        >
          <ListIcon size={14} />
        </button>
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

      {/* 正则错误提示：结果列表不会出现（出错即无结果），可独立悬浮在栏下方 */}
      {regexError && (
        <div className="search-note is-error" role="alert">
          {t("searchRegexError")}
        </div>
      )}

      {/* 可折叠结果列表：点击跳转，当前项高亮。截断提示固定在列表尾部
          （独立悬浮会与列表重叠） */}
      {listOpen && (matches.length > 0 || searching) && (
        <div className="search-results" ref={listRef}>
          {matches.map((m, i) => (
            <button
              key={m.id}
              type="button"
              className={`search-result-item ${i === activeIdx ? "is-active" : ""}`}
              data-idx={i}
              onClick={() => setActiveIdx(i)}
            >
              <span className="search-result-page">{m.page}</span>
              <span className="search-result-text" dir="auto">
                {m.before && <span className="search-result-ctx">{m.before}</span>}
                <span className="search-result-hit">{m.text}</span>
                {m.after && <span className="search-result-ctx">{m.after}</span>}
              </span>
            </button>
          ))}
          {searching ? (
            <div className="search-results-more">
              {t("searchScanning")} {scanned}/{doc.numPages}
            </div>
          ) : (
            truncated && (
              <div className="search-results-more" role="status">
                {t("searchTruncated")}
              </div>
            )
          )}
        </div>
      )}

      {/* 列表收起时的截断提示：列表不显示，独立悬浮不与任何内容重叠 */}
      {!listOpen && truncated && !searching && (
        <div className="search-note" role="status">
          {t("searchTruncated")}
        </div>
      )}
    </div>
  );
}
