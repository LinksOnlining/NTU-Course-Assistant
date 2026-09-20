import { Component, type ErrorInfo, type ReactNode } from "react";

interface WindowErrorBoundaryProps {
  readonly children: ReactNode;
  readonly title: string;
}

interface WindowErrorBoundaryState {
  readonly failed: boolean;
}

export class WindowErrorBoundary extends Component<
  WindowErrorBoundaryProps,
  WindowErrorBoundaryState
> {
  state: WindowErrorBoundaryState = { failed: false };

  static getDerivedStateFromError(): WindowErrorBoundaryState {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`${this.props.title} render failed`, error, info.componentStack);
  }

  render() {
    if (this.state.failed) {
      return (
        <main className="window-error-boundary" role="alert">
          <h1>{this.props.title}加载失败</h1>
          <p>当前数据没有被修改。请重试；如果问题持续出现，请重新打开应用。</p>
          <button type="button" onClick={() => window.location.reload()}>
            重试
          </button>
        </main>
      );
    }
    return this.props.children;
  }
}
