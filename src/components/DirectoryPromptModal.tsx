import React from 'react';
import { FolderPlus, AlertCircle, Check, X } from 'lucide-react';

interface DirectoryPromptModalProps {
  isOpen: boolean;
  directoryPath: string;
  onConfirm: (path: string) => void;
  onCancel: () => void;
}

export const DirectoryPromptModal: React.FC<DirectoryPromptModalProps> = ({
  isOpen,
  directoryPath,
  onConfirm,
  onCancel,
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/70 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl max-w-md w-full shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200 text-slate-800 dark:text-slate-100">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 bg-amber-50/80 dark:bg-amber-950/40 border-b border-amber-200/80 dark:border-amber-900/60">
          <div className="flex items-center space-x-3">
            <div className="p-2.5 bg-amber-100 dark:bg-amber-900/60 text-amber-700 dark:text-amber-300 rounded-xl">
              <FolderPlus className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-900 dark:text-white flex items-center space-x-2">
                <span>Directory Not Found</span>
              </h3>
              <p className="text-xs text-amber-700 dark:text-amber-300">System File System Warning</p>
            </div>
          </div>

          <button
            onClick={onCancel}
            className="p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-lg hover:bg-slate-200/50 dark:hover:bg-slate-700/50 transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 space-y-4 text-xs text-slate-600 dark:text-slate-300">
          <div className="flex items-start space-x-3 bg-slate-50 dark:bg-slate-800/60 p-3.5 border border-slate-200 dark:border-slate-700 rounded-xl">
            <AlertCircle className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
            <div className="space-y-1">
              <p className="font-medium">
                The specified download save directory does not exist on your file system yet:
              </p>
              <div className="font-mono bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 px-2.5 py-1.5 rounded-lg text-blue-600 dark:text-blue-400 font-bold truncate">
                {directoryPath}
              </div>
            </div>
          </div>

          <p className="text-slate-700 dark:text-slate-300 font-semibold text-[13px]">
            Would you like FlowDown to automatically create this directory now?
          </p>
        </div>

        {/* Actions */}
        <div className="px-6 py-4 bg-slate-50 dark:bg-slate-800/80 border-t border-slate-200 dark:border-slate-700/80 flex items-center justify-end space-x-3">
          <button
            onClick={onCancel}
            className="px-4 py-2 rounded-xl text-slate-600 dark:text-slate-400 hover:bg-slate-200/60 dark:hover:bg-slate-700 font-medium transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={() => onConfirm(directoryPath)}
            className="px-5 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-semibold transition-colors shadow-xs flex items-center space-x-2"
          >
            <Check className="h-4 w-4" />
            <span>Create Directory</span>
          </button>
        </div>
      </div>
    </div>
  );
};
