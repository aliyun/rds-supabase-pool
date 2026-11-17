import { Component, type ErrorInfo, type ReactNode } from "react";

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("pool console render failed", error, info);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="flex min-h-screen items-center justify-center px-4 py-10">
          <div className="w-full max-w-lg rounded-2xl border border-rose/30 bg-ink-900/90 p-6 shadow-[0_40px_160px_rgba(0,0,0,.55)]">
            <div className="label-eyebrow text-rose">CONSOLE RENDER ERROR</div>
            <h1 className="display-title mt-2 text-xl font-semibold text-white">控制台渲染失败</h1>
            <p className="mt-2 text-xs leading-6 text-slate-400">
              页面遇到了未预期错误。请先刷新重试；如果问题持续存在，请保留下方错误信息用于排查。
            </p>
            <pre className="mono mt-4 max-h-40 overflow-auto rounded-lg border border-edge bg-ink-950/60 p-3 text-[10px] leading-5 text-rose">
              {this.state.error.message || String(this.state.error)}
            </pre>
            <div className="mt-4 flex justify-end">
              <button
                type="button"
                onClick={() => window.location.reload()}
                className="rounded-lg border border-cyan/40 bg-cyan/10 px-3 py-2 text-xs text-cyan-300 transition-colors hover:bg-cyan/15"
              >
                重新加载
              </button>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
