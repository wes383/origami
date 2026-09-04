import { useEffect, useRef, useState } from "react";
import { useI18n } from "../i18n";
import { MinusIcon, PlusIcon, XIcon } from "./Icons";

interface AutoReaderBarProps {
  /** 中段输入框显示的数值（滚动模式=px/s，翻页模式=秒/页） */
  speedValue: string;
  /** 中段输入框的单位后缀（px/s / 秒/页，由调用方按当前语言传入） */
  speedUnit: string;
  /** 输入框允许的最小值（px/s 下限 1；秒/页允许 0.1 级小数） */
  speedMin?: number;
  /** 翻页模式（数值单位=秒/页）：档位表按秒/页升序，−/+ 与滚动模式同方向操作
      （− 数值减小 / + 数值增大），仅「减速/加速」提示文案随语义翻转 —— 秒/页
      数值小 = 翻页快，故 − 在翻页模式表示加速 */
  paged?: boolean;
  /** 当前档位索引（0-based），自定义时为 -1 */
  speedIndex: number;
  /** 档位总数 */
  speedCount: number;
  /** 切换速度档位（dir: -1 降速 / +1 增速） */
  onCycleSpeed: (dir: 1 | -1) => void;
  /** 从中段输入框提交一个数值（按当前模式解释） */
  onValueCommit: (value: number) => void;
  /** 关闭浮动条并停止自动阅读 */
  onClose: () => void;
}

/**
 * 自动阅读浮动条：开启后固定在阅读区底部居中。
 * 速度调节 UI 严格参照顶部工具栏的缩放比例控件：
 * 左/右为方形 −/+ 按钮（tb-btn icon-only），中段为带单位后缀的输入框（灰底药丸）。
 */
export default function AutoReaderBar({
  speedValue,
  speedUnit,
  speedMin = 1,
  paged = false,
  speedIndex,
  speedCount,
  onCycleSpeed,
  onValueCommit,
  onClose,
}: AutoReaderBarProps) {
  const { t } = useI18n();
  const [draft, setDraft] = useState(speedValue);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const cancelledRef = useRef(false);

  // 外部速度变化（± 步进 / 恢复默认）时同步输入框；编辑态（输入框聚焦）除外
  useEffect(() => {
    if (document.activeElement !== inputRef.current) setDraft(speedValue);
  }, [speedValue]);

  const commit = () => {
    if (cancelledRef.current) {
      // Esc 取消：失焦触发的 commit 直接丢弃草稿，还原为当前速度
      cancelledRef.current = false;
      setDraft(speedValue);
      return;
    }
    const n = parseFloat(draft);
    if (Number.isFinite(n) && n > 0) onValueCommit(n);
    else setDraft(speedValue);
  };

  const atMin = speedIndex === 0;
  const atMax = speedIndex === speedCount - 1;

  // 两种模式的档位表数组均按「显示数值升序」排列，故 −/+ 方向一致：
  // − = 索引 -1 = 显示数值减小、+ = 索引 +1 = 显示数值增大。
  // 语义差别只在文案：滚动模式数值=px/s（小=慢）→ − 是减速；翻页模式数值=秒/页
  // （小=快）→ − 是加速。提示文案随模式翻转，避免误导。
  // 禁用边界 = 各自档位表两端（数值最小端 − 禁用 / 数值最大端 + 禁用）。
  const minusDir: 1 | -1 = -1;
  const plusDir: 1 | -1 = 1;
  const minusDisabled = atMin;
  const plusDisabled = atMax;
  const minusLabel = paged ? t("autoScrollFaster") : t("autoScrollSlower");
  const plusLabel = paged ? t("autoScrollSlower") : t("autoScrollFaster");

  return (
    <div className="auto-bar" role="region" aria-label={t("autoScroll")}>
      <button
        type="button"
        className="tb-btn icon-only"
        onClick={() => onCycleSpeed(minusDir)}
        disabled={minusDisabled}
        title={minusLabel}
        aria-label={minusLabel}
      >
        <MinusIcon />
      </button>

      <div className="auto-speed" title={t("autoScrollSpeed")}>
        <input
          ref={inputRef}
          className="auto-speed-input"
          type="number"
          min={speedMin}
          max={2400}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onFocus={(e) => e.currentTarget.select()}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              commit();
              inputRef.current?.blur();
            } else if (e.key === "Escape") {
              cancelledRef.current = true;
              inputRef.current?.blur();
            }
          }}
          onBlur={commit}
          aria-label={t("autoScrollCustom")}
        />
        <span className="auto-speed-unit">{speedUnit}</span>
      </div>

      <button
        type="button"
        className="tb-btn icon-only"
        onClick={() => onCycleSpeed(plusDir)}
        disabled={plusDisabled}
        title={plusLabel}
        aria-label={plusLabel}
      >
        <PlusIcon />
      </button>

      <span className="auto-bar-sep" aria-hidden="true" />

      <button
        type="button"
        className="tb-btn icon-only"
        onClick={onClose}
        title={t("autoScrollStop")}
        aria-label={t("autoScrollStop")}
      >
        <XIcon />
      </button>
    </div>
  );
}
