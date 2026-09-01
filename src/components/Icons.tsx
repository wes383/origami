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
