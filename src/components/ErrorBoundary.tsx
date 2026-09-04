import { Component, type ReactNode } from "react";
import { useI18n } from "../i18n";

interface ErrorBoundaryProps {
  children: ReactNode;
  /** 出错时的渲染。接收重置函数；传入的函数组件内可正常使用 hooks（如 useI18n） */
  fallback: (reset: () => void) => ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
}

/**
 * 渲染错误边界：子树抛错（如某页渲染失败）时以 fallback 替代渲染，
 * 避免单个页面组件的异常把整个应用打成白屏。
 * key 变化（如切换文档）时边界自动重置。
 */
export default class ErrorBoundary extends Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(err: unknown) {
    console.warn("[ErrorBoundary]", err);
  }

  reset = () => this.setState({ hasError: false });

  render() {
    return this.state.hasError
      ? this.props.fallback(this.reset)
      : this.props.children;
  }
}

/** PdfViewer 专属错误兜底：提示渲染出错并提供重试 */
export function ViewerErrorFallback({ onRetry }: { onRetry: () => void }) {
  const { t } = useI18n();
  return (
    <div className="viewer-error">
      <span>{t("renderError")}</span>
      <button type="button" className="viewer-error-retry" onClick={onRetry}>
        {t("retry")}
      </button>
    </div>
  );
}
