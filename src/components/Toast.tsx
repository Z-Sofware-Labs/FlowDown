import React from 'react';
import { CheckCircle2, X, Download, AlertCircle, Info } from 'lucide-react';

export interface ToastMessage {
  id: string;
  title: string;
  description: string;
  type?: 'success' | 'info' | 'error';
}

interface ToastProps {
  toasts: ToastMessage[];
  onDismiss: (id: string) => void;
}

export const ToastContainer: React.FC<ToastProps> = ({ toasts, onDismiss }) => {
  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-5 right-5 z-50 space-y-2 max-w-sm w-full pointer-events-none">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className="pointer-events-auto bg-white border border-slate-200 text-slate-800 p-3.5 rounded-xl shadow-lg flex items-start justify-between space-x-3 animate-in slide-in-from-bottom-5 duration-300"
        >
          <div className="flex items-start space-x-3 min-w-0">
            {toast.type === 'error' ? (
              <AlertCircle className="h-5 w-5 text-rose-600 shrink-0 mt-0.5" />
            ) : toast.type === 'info' ? (
              <Info className="h-5 w-5 text-blue-600 shrink-0 mt-0.5" />
            ) : (
              <CheckCircle2 className="h-5 w-5 text-emerald-600 shrink-0 mt-0.5" />
            )}
            <div className="min-w-0">
              <h4 className="text-xs font-bold text-slate-900 truncate">{toast.title}</h4>
              <p className="text-[11px] text-slate-600 truncate mt-0.5">{toast.description}</p>
            </div>
          </div>
          <button
            onClick={() => onDismiss(toast.id)}
            className="text-slate-400 hover:text-slate-700 p-1 rounded-lg hover:bg-slate-100 transition-colors shrink-0"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      ))}
    </div>
  );
};
