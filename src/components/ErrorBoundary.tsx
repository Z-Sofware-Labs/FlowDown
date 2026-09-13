import React, { Component, ErrorInfo, ReactNode } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

interface Props {
  children: ReactNode;
  fallbackTitle?: string;
  onReset?: () => void;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('[FlowDown ErrorBoundary caught error]:', error, errorInfo);
  }

  private handleReset = () => {
    this.setState({ hasError: false, error: null });
    if (this.props.onReset) {
      this.props.onReset();
    }
  };

  public render() {
    if (this.state.hasError) {
      return (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-[#181a20] border border-rose-500/30 rounded-2xl w-full max-w-md shadow-2xl p-6 text-slate-200 flex flex-col items-center text-center animate-in fade-in zoom-in-95 duration-150">
            <div className="p-3 bg-rose-500/10 text-rose-400 rounded-xl mb-3">
              <AlertTriangle className="h-7 w-7" />
            </div>
            <h3 className="text-base font-bold text-white mb-1">
              {this.props.fallbackTitle || 'Component Error'}
            </h3>
            <p className="text-xs text-slate-400 mb-4 max-w-xs">
              FlowDown encountered an unexpected error while loading this dialog.
            </p>
            {this.state.error && (
              <div className="w-full bg-black/30 border border-white/5 rounded-lg p-3 text-[11px] font-mono text-rose-300 text-left overflow-x-auto max-h-28 mb-4">
                {this.state.error.message || String(this.state.error)}
              </div>
            )}
            <div className="flex items-center space-x-3">
              <button
                type="button"
                onClick={this.handleReset}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-semibold flex items-center space-x-1.5 transition-colors cursor-pointer"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                <span>Dismiss & Reset</span>
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
