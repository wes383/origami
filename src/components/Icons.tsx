/** 统一的线性图标 — 对齐 lucide 规范（strokeWidth 2，默认 16px） */
interface IconProps {
  size?: number;
}

function base(size: number) {
  return {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 2,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
}

/** 查找（lucide search） */
export function SearchIcon({ size = 16 }: IconProps) {
  return (
    <svg {...base(size)}>
      <circle cx="11" cy="11" r="8" />
      <path d="m21 21-4.3-4.3" />
    </svg>
  );
}

/** 停止（lucide square，实心） */
export function StopIcon({ size = 16 }: IconProps) {
  return (
    <svg {...base(size)}>
      <rect
        x="7"
        y="7"
        width="10"
        height="10"
        rx="1.5"
        fill="currentColor"
        stroke="none"
      />
    </svg>
  );
}

/** 播放（lucide play，实心三角） */
export function PlayIcon({ size = 16 }: IconProps) {
  return (
    <svg {...base(size)}>
      <path d="M7 5.5v13a.5.5 0 0 0 .77.42l10-6.5a.5.5 0 0 0 0-.84l-10-6.5A.5.5 0 0 0 7 5.5Z" fill="currentColor" stroke="none" />
    </svg>
  );
}

/** 暂停（lucide pause，双竖条） */
export function PauseIcon({ size = 16 }: IconProps) {
  return (
    <svg {...base(size)}>
      <rect x="7" y="5" width="3.2" height="14" rx="1" fill="currentColor" stroke="none" />
      <rect x="13.8" y="5" width="3.2" height="14" rx="1" fill="currentColor" stroke="none" />
    </svg>
  );
}

/** 上箭头（lucide chevron-up） */
export function ChevronUpIcon({ size = 16 }: IconProps) {
  return (
    <svg {...base(size)}>
      <path d="m6 15 6-6 6 6" />
    </svg>
  );
}

/** 打开所在文件夹（lucide folder） */
export function FolderSearchIcon({ size = 16 }: IconProps) {
  return (
    <svg {...base(size)}>
      <path d="M4 20h16a1 1 0 0 0 1-1V8a1 1 0 0 0-1-1h-8.6a1 1 0 0 1-.8-.4l-1.2-1.6a1 1 0 0 0-.8-.4H4a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1Z" />
    </svg>
  );
}

/** 窗口控制（Windows 风格 1px 细线，非圆角线条） */
function winBase(size: number) {
  return {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.25,
    strokeLinecap: "square" as const,
    strokeLinejoin: "miter" as const,
  };
}

export function WinMinimizeIcon({ size = 16 }: IconProps) {
  return (
    <svg {...winBase(size)}>
      <path d="M5 12h14" />
    </svg>
  );
}

export function WinMaximizeIcon({ size = 16 }: IconProps) {
  return (
    <svg {...winBase(size)}>
      <rect x="6" y="6" width="12" height="12" />
    </svg>
  );
}

export function WinRestoreIcon({ size = 16 }: IconProps) {
  return (
    <svg {...winBase(size)}>
      <rect x="8" y="5" width="11" height="11" />
      <path d="M5 9v10h10" />
    </svg>
  );
}

export function WinCloseIcon({ size = 16 }: IconProps) {
  return (
    <svg {...winBase(size)}>
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}

export function ChevronLeftIcon({ size = 16 }: IconProps) {
  return (
    <svg {...base(size)}>
      <path d="M14.5 5.5 8 12l6.5 6.5" />
    </svg>
  );
}

export function ChevronRightIcon({ size = 16 }: IconProps) {
  return (
    <svg {...base(size)}>
      <path d="M9.5 5.5 16 12l-6.5 6.5" />
    </svg>
  );
}

export function PlusIcon({ size = 16 }: IconProps) {
  return (
    <svg {...base(size)}>
      <path d="M12 6v12M6 12h12" />
    </svg>
  );
}

export function MinusIcon({ size = 16 }: IconProps) {
  return (
    <svg {...base(size)}>
      <path d="M6 12h12" />
    </svg>
  );
}

export function FitWidthIcon({ size = 16 }: IconProps) {
  return (
    <svg {...base(size)}>
      <rect x="3" y="5" width="18" height="14" rx="1.5" />
      <path d="M9 9.5 6.5 12l2.5 2.5" />
      <path d="M15 9.5 17.5 12l-2.5 2.5" />
    </svg>
  );
}

export function FitPageIcon({ size = 16 }: IconProps) {
  return (
    <svg {...base(size)}>
      <rect x="5" y="3" width="14" height="18" rx="1.5" />
      <path d="M9.5 9.5 12 7l2.5 2.5" />
      <path d="M9.5 14.5 12 17l2.5-2.5" />
    </svg>
  );
}

export function SunIcon({ size = 16 }: IconProps) {
  return (
    <svg {...base(size)}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M18.4 5.6 17 7M7 17l-1.4 1.4" />
    </svg>
  );
}

export function MoonIcon({ size = 16 }: IconProps) {
  return (
    <svg {...base(size)}>
      <path d="M20 13.5A8 8 0 1 1 10.5 4 6.5 6.5 0 0 0 20 13.5Z" />
    </svg>
  );
}

export function SettingsIcon({ size = 16 }: IconProps) {
  return (
    <svg {...base(size)}>
      <path d="M4 6h16M4 12h16M4 18h16" />
    </svg>
  );
}

export function XIcon({ size = 16 }: IconProps) {
  return (
    <svg {...base(size)}>
      <path d="M6 6l12 12M18 6 6 18" />
    </svg>
  );
}

/** 信息（lucide info）：圆圈 + i，文件属性入口用 */
export function InfoIcon({ size = 16 }: IconProps) {
  return (
    <svg {...base(size)}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 8h.01" />
      <path d="M11 12h1v4h1" />
    </svg>
  );
}

/** 文档图标（lucide file-text） */
export function DocIcon({ size = 16 }: IconProps) {
  return (
    <svg {...base(size)}>
      <path d="M13 3H7a1.5 1.5 0 0 0-1.5 1.5v15A1.5 1.5 0 0 0 7 21h10a1.5 1.5 0 0 0 1.5-1.5V8.5L13 3Z" />
      <path d="M13 3v5.5h5.5" />
      <path d="M9 13h6" />
      <path d="M9 17h6" />
    </svg>
  );
}

/** 翻译（lucide languages） */
export function LanguagesIcon({ size = 16 }: IconProps) {
  return (
    <svg {...base(size)}>
      <path d="m5 8 6 6" />
      <path d="m4 14 6-6 2-3" />
      <path d="M2 5h12" />
      <path d="M7 2h1" />
      <path d="m22 22-5-10-5 10" />
      <path d="M14 18h6" />
    </svg>
  );
}

/** 键盘（lucide keyboard） */
export function KeyboardIcon({ size = 16 }: IconProps) {
  return (
    <svg {...base(size)}>
      <rect x="2" y="6" width="20" height="12" rx="2" />
      <path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10" />
    </svg>
  );
}

/** 全屏（lucide maximize） */
export function FullscreenIcon({ size = 16 }: IconProps) {
  return (
    <svg {...base(size)}>
      <path d="M8 3H5a2 2 0 0 0-2 2v3" />
      <path d="M21 8V5a2 2 0 0 0-2-2h-3" />
      <path d="M3 16v3a2 2 0 0 0 2 2h3" />
      <path d="M16 21h3a2 2 0 0 0 2-2v-3" />
    </svg>
  );
}

/** 退出全屏（lucide minimize） */
export function FullscreenExitIcon({ size = 16 }: IconProps) {
  return (
    <svg {...base(size)}>
      <path d="M8 3v3a2 2 0 0 1-2 2H3" />
      <path d="M21 8h-3a2 2 0 0 1-2-2V3" />
      <path d="M3 16h3a2 2 0 0 1 2 2v3" />
      <path d="M16 21v-3a2 2 0 0 1 2-2h3" />
    </svg>
  );
}

/** 图钉/固定（lucide pin） */
export function PinIcon({ size = 16 }: IconProps) {
  return (
    <svg {...base(size)}>
      <path d="M12 17v5" />
      <path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z" />
    </svg>
  );
}

/** 取消固定（lucide pin-off：图钉 + 斜线） */
export function PinOffIcon({ size = 16 }: IconProps) {
  return (
    <svg {...base(size)}>
      <path d="M12 17v5" />
      <path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z" />
      <path d="m2 2 20 20" />
    </svg>
  );
}

/** 勾选（lucide check） */
export function CheckIcon({ size = 16 }: IconProps) {
  return (
    <svg {...base(size)}>
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

/** 缩略图网格（lucide layout-grid） */
export function GridIcon({ size = 16 }: IconProps) {
  return (
    <svg {...base(size)}>
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <rect x="14" y="14" width="7" height="7" rx="1" />
    </svg>
  );
}

/** 目录（lucide list） */
export function ListIcon({ size = 16 }: IconProps) {
  return (
    <svg {...base(size)}>
      <path d="M8 6h13M8 12h13M8 18h13" />
      <path d="M3 6h.01M3 12h.01M3 18h.01" />
    </svg>
  );
}

/** 下拉箭头（lucide chevron-down） */
export function ChevronDownIcon({ size = 16 }: IconProps) {
  return (
    <svg {...base(size)}>
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

/** 书签（lucide bookmark） */
export function BookmarkIcon({ size = 16 }: IconProps) {
  return (
    <svg {...base(size)}>
      <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
    </svg>
  );
}

/** 添加书签（lucide bookmark-plus：书签轮廓 + 中央加号） */
export function BookmarkPlusIcon({ size = 16 }: IconProps) {
  return (
    <svg {...base(size)}>
      <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
      <path d="M12 7.5v5M9.5 10h5" />
    </svg>
  );
}

/** 已加书签（lucide bookmark 实心填充态） */
export function BookmarkFilledIcon({ size = 16 }: IconProps) {
  return (
    <svg {...base(size)}>
      <path
        d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"
        fill="currentColor"
        stroke="none"
      />
    </svg>
  );
}

/** 百科/全球（lucide globe） */
export function GlobeIcon({ size = 16 }: IconProps) {
  return (
    <svg {...base(size)}>
      <circle cx="12" cy="12" r="10" />
      <path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20" />
      <path d="M2 12h20" />
    </svg>
  );
}

/** 复制（lucide copy） */
export function CopyIcon({ size = 16 }: IconProps) {
  return (
    <svg {...base(size)}>
      <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
      <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
    </svg>
  );
}

/** 顺时针旋转（lucide rotate-cw） */
export function RotateIcon({ size = 16 }: IconProps) {
  return (
    <svg {...base(size)}>
      <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8" />
      <path d="M21 3v5h-5" />
    </svg>
  );
}

/** 更多操作（lucide more-horizontal，三点） */
export function MoreIcon({ size = 16 }: IconProps) {
  return (
    <svg {...base(size)}>
      <circle cx="5" cy="12" r="1" fill="currentColor" />
      <circle cx="12" cy="12" r="1" fill="currentColor" />
      <circle cx="19" cy="12" r="1" fill="currentColor" />
    </svg>
  );
}

/** 打印（lucide printer） */
export function PrinterIcon({ size = 16 }: IconProps) {
  return (
    <svg {...base(size)}>
      <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
      <path d="M6 9V3a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v6" />
      <rect x="6" y="14" width="12" height="8" rx="1" />
    </svg>
  );
}

/** 编辑（lucide pencil） */
export function PencilIcon({ size = 16 }: IconProps) {
  return (
    <svg {...base(size)}>
      <path d="M21.17 6.83a2.83 2.83 0 0 0-4-4L3.84 16.17a2 2 0 0 0-.5.83L2 22l5-1.34a2 2 0 0 0 .83-.5z" />
      <path d="m15 5 4 4" />
    </svg>
  );
}

/** 查找选项：区分大小写（lucide case-sensitive，大 A + 小 a） */
export function CaseIcon({ size = 16 }: IconProps) {
  return (
    <svg {...base(size)}>
      <path d="m2 16 4.039-9.69a.5.5 0 0 1 .923 0L11 16" />
      <path d="M22 9v7" />
      <path d="M3.304 13h6.392" />
      <circle cx="18.5" cy="12.5" r="3.5" />
    </svg>
  );
}

/** 查找选项：全词匹配（lucide whole-word，双字符带边界竖线 + 下划线） */
export function WordIcon({ size = 16 }: IconProps) {
  return (
    <svg {...base(size)}>
      <circle cx="7" cy="12" r="3" />
      <path d="M10 9v6" />
      <circle cx="17" cy="12" r="3" />
      <path d="M14 7v8" />
      <path d="M22 17v1c0 .5-.5 1-1 1H3c-.5 0-1-.5-1-1v-1" />
    </svg>
  );
}

/** 注释入口（lucide pen-line：基线 + 斜置笔尖） */
export function AnnotateIcon({ size = 16 }: IconProps) {
  return (
    <svg {...base(size)}>
      <path d="M12 20h9" />
      <path d="M16.376 3.622a1 1 0 0 1 3.002 3.002L7.368 18.635a2 2 0 0 1-.855.506l-2.872.838a.5.5 0 0 1-.62-.62l.838-2.872a2 2 0 0 1 .506-.854z" />
    </svg>
  );
}

/** 注释过滤：全部类型（lucide layers，多层堆叠 = 不限类型） */
export function StackIcon({ size = 16 }: IconProps) {
  return (
    <svg {...base(size)}>
      <path d="m12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z" />
      <path d="m22 17.65-9.17 4.16a2 2 0 0 1-1.66 0L2 17.65" />
      <path d="m22 12.65-9.17 4.16a2 2 0 0 1-1.66 0L2 12.65" />
    </svg>
  );
}

/** 查找选项：正则表达式（lucide regex，星号 + 方块字符） */
export function RegexIcon({ size = 16 }: IconProps) {
  return (
    <svg {...base(size)}>
      <path d="M17 3v10" />
      <path d="m12.67 5.5 8.66 5" />
      <path d="m12.67 10.5 8.66-5" />
      <path d="M9 17a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v2a2 2 0 0 0 2 2h2a2 2 0 0 0 2-2v-2z" />
    </svg>
  );
}

/** 注释：高亮荧光笔（lucide highlighter） */
export function HighlighterIcon({ size = 16 }: IconProps) {
  return (
    <svg {...base(size)}>
      <path d="m9 11-6 6v3h9l3-3" />
      <path d="m22 12-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4" />
    </svg>
  );
}

/** 注释：下划线（lucide underline，U 形 + 底部横线） */
export function UnderlineIcon({ size = 16 }: IconProps) {
  return (
    <svg {...base(size)}>
      <path d="M6 4v6a6 6 0 0 0 12 0V4" />
      <path d="M4 20h16" />
    </svg>
  );
}

/** 注释：删除线（lucide strikethrough） */
export function StrikethroughIcon({ size = 16 }: IconProps) {
  return (
    <svg {...base(size)}>
      <path d="M16 4H9a3 3 0 0 0-2.83 4" />
      <path d="M14 12a4 4 0 0 1 0 8H6" />
      <path d="M4 12h16" />
    </svg>
  );
}

/** 注释：便签（lucide sticky-note，纸片折角） */
export function StickyNoteIcon({ size = 16 }: IconProps) {
  return (
    <svg {...base(size)}>
      <path d="M15.5 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V8.5L15.5 3Z" />
      <path d="M15 3v6h6" />
    </svg>
  );
}

/** 总结/摘要（lucide file-text：带折角文档 + 三条正文线） */
export function FileTextIcon({ size = 16 }: IconProps) {
  return (
    <svg {...base(size)}>
      <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" />
      <path d="M14 2v4a2 2 0 0 0 2 2h4" />
      <path d="M10 9H8" />
      <path d="M16 13H8" />
      <path d="M16 17H8" />
    </svg>
  );
}

/** 删除（lucide trash-2，垃圾桶 + 两条横线） */
export function TrashIcon({ size = 16 }: IconProps) {
  return (
    <svg {...base(size)}>
      <path d="M3 6h18" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
      <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <path d="M10 11v6" />
      <path d="M14 11v6" />
    </svg>
  );
}
