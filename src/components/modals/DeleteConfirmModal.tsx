import React, { useState, useEffect } from 'react';
import { Trash2, AlertCircle, HardDrive } from 'lucide-react';
import { SubwindowHeader } from './SubwindowHeader';
import { TorrentItem } from '../../types';
import { OsStyle } from '../../utils/detectOs';

interface DeleteConfirmModalProps {
  isOpen: boolean;
  onClose: () => void;
  items: TorrentItem[];
  onConfirmDelete: (deleteFiles: boolean) => void;
  osStyle?: OsStyle;
}

export const DeleteConfirmModal: React.FC<DeleteConfirmModalProps> = ({
  isOpen,
  onClose,
  items,
  onConfirmDelete,
  osStyle = 'windows',
}) => {
  const [deleteFiles, setDeleteFiles] = useState(false);

  // Reset checkbox when dialog opens
  useEffect(() => {
    if (isOpen) {
      setDeleteFiles(false);
    }
  }, [isOpen]);

  if (!isOpen || items.length === 0) return null;

  const formatBytes = (bytes: number) => {
    if (!bytes || bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
  };

  const totalBytes = items.reduce((acc, curr) => acc + (curr.size || 0), 0);
  const isMultiple = items.length > 1;

  const handleConfirm = () => {
    onConfirmDelete(deleteFiles);
    onClose();
  };

  return (
    <div
      className="fixed inset-0 bg-black/45 dark:bg-black/65 backdrop-blur-xs flex items-center justify-center z-50 p-4 select-none animate-in fade-in duration-100"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="delete-dialog-title"
        className={`w-[460px] max-w-full bg-[var(--os-bg-window)] border border-[var(--os-border)] shadow-2xl flex flex-col overflow-hidden text-[var(--os-text)] font-sans ${
          osStyle === 'macos' ? 'rounded-2xl' : osStyle === 'windows' ? 'rounded-lg' : 'rounded-md'
        }`}
      >
        <SubwindowHeader
          title="Confirm Deletion"
          icon={<Trash2 className="w-3.5 h-3.5 text-rose-500" />}
          onClose={onClose}
          osStyle={osStyle}
        />

        <div className="p-5 space-y-4">
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-full bg-rose-500/10 text-rose-600 dark:text-rose-400 flex items-center justify-center shrink-0 mt-0.5">
              <AlertCircle className="w-5 h-5" />
            </div>
            <div className="space-y-1 min-w-0">
              <h3 id="delete-dialog-title" className="text-sm font-bold text-[var(--os-text)] leading-tight">
                {isMultiple ? `Remove ${items.length} transfers?` : 'Remove transfer from FlowDown?'}
              </h3>
              <p className="text-xs text-[var(--os-text-muted)] leading-relaxed">
                {isMultiple
                  ? `Are you sure you want to remove the ${items.length} selected transfers (${formatBytes(totalBytes)}) from the list?`
                  : `Are you sure you want to remove this transfer from the list?`}
              </p>
            </div>
          </div>

          {/* Single Item details or Multi Item scrollable box */}
          {!isMultiple ? (
            <div className="p-3 rounded-md bg-[var(--os-bg-content)] border border-[var(--os-border)] space-y-1 text-xs">
              <div className="font-semibold text-[var(--os-text)] truncate" title={items[0].name}>
                {items[0].name}
              </div>
              <div className="flex items-center justify-between text-[11px] text-[var(--os-text-muted)] font-mono">
                <span>{formatBytes(items[0].size)}</span>
                <span className="capitalize">{items[0].status} ({Math.round(items[0].progress)}%)</span>
              </div>
            </div>
          ) : (
            <div className="max-h-36 overflow-y-auto rounded-md bg-[var(--os-bg-content)] border border-[var(--os-border)] divide-y divide-[var(--os-border-subtle)] text-xs">
              {items.map((item) => (
                <div key={item.id} className="p-2 flex items-center justify-between gap-2">
                  <span className="truncate text-[11px] font-medium text-[var(--os-text)]" title={item.name}>
                    {item.name}
                  </span>
                  <span className="text-[10px] font-mono text-[var(--os-text-muted)] shrink-0">
                    {formatBytes(item.size)}
                  </span>
                </div>
              ))}
            </div>
          )}

          {/* Delete files from disk option */}
          <div className="p-3 rounded-md bg-rose-500/5 border border-rose-500/20">
            <label className="flex items-start gap-2.5 cursor-pointer">
              <input
                type="checkbox"
                checked={deleteFiles}
                onChange={(e) => setDeleteFiles(e.target.checked)}
                className="w-4 h-4 rounded accent-rose-600 mt-0.5 shrink-0"
              />
              <div className="text-xs">
                <span className="font-semibold text-[var(--os-text)] flex items-center gap-1.5">
                  <HardDrive className="w-3.5 h-3.5 text-rose-500" />
                  <span>Also delete downloaded files from disk</span>
                </span>
                <p className="text-[11px] text-[var(--os-text-muted)] mt-0.5 leading-tight">
                  Files located in your download directory will be permanently erased.
                </p>
              </div>
            </label>
          </div>
        </div>

        {/* Modal Action Buttons: Cancel, Delete */}
        <div className="px-4 py-3 bg-[var(--os-bg-statusbar)] border-t border-[var(--os-border)] flex items-center justify-end gap-2 shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="px-3.5 py-1.5 rounded bg-[var(--os-bg-control)] hover:bg-[var(--os-bg-hover)] border border-[var(--os-border)] text-[var(--os-text)] text-xs font-medium transition-colors"
          >
            Cancel
          </button>

          <button
            type="button"
            onClick={handleConfirm}
            className="px-4 py-1.5 rounded bg-rose-600 hover:bg-rose-500 text-white text-xs font-semibold flex items-center gap-1.5 shadow-2xs transition-colors"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>{deleteFiles ? 'Delete & Erase Files' : 'Remove from List'}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
