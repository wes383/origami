import { useI18n } from "../i18n";
import { DocIcon, FolderSearchIcon, XIcon } from "./Icons";
import { type RecentFile } from "../lib/recent";

interface EmptyStateProps {
  onOpen: () => void;
  /** 最近打开的文件（新→旧） */
  recentFiles: RecentFile[];
  /** 点击最近文件直接打开 */
  onOpenRecent: (path: string) => void;
  /** 移除单条最近记录 */
  onRemoveRecent: (path: string) => void;
  /** 在系统文件管理器中显示该文件 */
  onShowInFolder: (path: string) => void;
}

export default function EmptyState({
  onOpen,
  recentFiles,
  onOpenRecent,
  onRemoveRecent,
  onShowInFolder,
}: EmptyStateProps) {
  const { t } = useI18n();

  return (
    <div className="empty-state">
      <div className="empty-card">
        <button type="button" className="btn-primary" onClick={onOpen}>
          <DocIcon size={15} />
          {t("openPdf")}
        </button>
      </div>

      {recentFiles.length > 0 && (
        <div className="recent-panel">
          <div className="recent-header">
            <span className="recent-title">{t("recent")}</span>
          </div>
          <ul className="recent-list">
            {recentFiles.map((file) => (
              <li key={file.path} className="recent-row">
                <button
                  type="button"
                  className="recent-item"
                  onClick={() => onOpenRecent(file.path)}
                  title={file.path}
                >
                  <DocIcon size={15} />
                  <span className="recent-name">{file.name}</span>
                </button>
                <button
                  type="button"
                  className="recent-action"
                  onClick={() => onShowInFolder(file.path)}
                  title={t("showInFolder")}
                  aria-label={t("showInFolder")}
                >
                  <FolderSearchIcon size={14} />
                </button>
                <button
                  type="button"
                  className="recent-action"
                  onClick={() => onRemoveRecent(file.path)}
                  title={t("removeFromRecent")}
                  aria-label={t("removeFromRecent")}
                >
                  <XIcon size={13} />
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
