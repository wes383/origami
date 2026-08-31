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
