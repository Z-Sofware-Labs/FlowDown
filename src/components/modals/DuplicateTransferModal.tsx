import React from 'react';
import { Copy, AlertTriangle, RotateCcw, Ban, X, Folder, HardDrive } from 'lucide-react';
import { SubwindowHeader } from './SubwindowHeader';
import { TorrentItem } from '../../types';
import { OsStyle } from '../../utils/detectOs';

interface DuplicateTransferModalProps {
  isOpen: boolean;
  onClose: () => void;
  existingItem: TorrentItem;
  newItemName: string;
  onOverwrite: () => void;
  onDoNotAdd: () => void;
  onCancel: () => void;
  osStyle?: OsStyle;
}

export const DuplicateTransferModal: React.FC<DuplicateTransferModalProps> = ({
  isOpen,
  onClose,
  existingItem,
  newItemName,
  onOverwrite,
  onDoNotAdd,
  onCancel,
  osStyle = 'windows',
}) => {
  if (!isOpen) return null;

  const formatBytes = (bytes: number) => {
    if (!bytes || bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
  };

  const getStatusBadge = () => {
    const s = existingItem.status;
    if (s === 'seeding' || existingItem.progress >= 100) {
      return (
        <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30">
          Completed (100%)
        </span>
      );
    }
    if (s === 'downloading') {
      return (
        <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-blue-500/15 text-blue-600 dark:text-blue-400 border border-blue-500/30">
          Downloading ({Math.round(existingItem.progress)}%)
        </span>
      );
    }
    if (s === 'paused') {
      return (
        <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/30">
          Paused ({Math.round(existingItem.progress)}%)
        </span>
      );
    }
    return (
      <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-[var(--os-bg-control)] text-[var(--os-text-muted)] border border-[var(--os-border)]">
        {s.toUpperCase()} ({Math.round(existingItem.progress)}%)
      </span>
    );
  };

  return (
    <div
      className="fixed inset-0 bg-black/45 dark:bg-black/65 backdrop-blur-xs flex items-center justify-center z-50 p-4 select-none animate-in fade-in duration-100"
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="duplicate-dialog-title"
        className={`w-[490px] max-w-full bg-[var(--os-bg-window)] border border-[var(--os-border)] shadow-2xl flex flex-col overflow-hidden text-[var(--os-text)] font-sans ${
          osStyle === 'macos' ? 'rounded-2xl' : osStyle === 'windows' ? 'rounded-lg' : 'rounded-md'
        }`}
      >
        <SubwindowHeader
          title="Duplicate Download Detected"
          icon={<Copy className="w-3.5 h-3.5 text-amber-500" />}
          onClose={onCancel}
          osStyle={osStyle}
        />

        <div className="p-5 space-y-4">
          {/* Alert Callout */}
          <div className="flex items-start gap-3 p-3 rounded-md bg-amber-500/10 border border-amber-500/25">
            <AlertTriangle className="w-5 h-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
            <div className="text-xs leading-relaxed">
              <span className="font-semibold text-[var(--os-text)]">
                This file is already on your transfer list:
              </span>
              <p className="font-mono text-[11px] font-semibold text-amber-700 dark:text-amber-300 break-all mt-0.5">
                {newItemName}
              </p>
            </div>
          </div>

          {/* Existing Transfer Status Card */}
          <div className="p-3 rounded-md bg-[var(--os-bg-content)] border border-[var(--os-border)] space-y-2 text-xs">
            <div className="flex items-center justify-between gap-2 border-b border-[var(--os-border-subtle)] pb-2">
              <span className="text-[11px] font-semibold text-[var(--os-text-muted)] uppercase tracking-wider">
                Current Item in List
              </span>
              {getStatusBadge()}
            </div>

            <div className="space-y-1.5 pt-0.5">
              <div className="flex items-center justify-between text-[11px]">
                <span className="text-[var(--os-text-muted)]">File Name:</span>
                <span className="font-medium text-[var(--os-text)] truncate max-w-[260px]" title={existingItem.name}>
                  {existingItem.name}
                </span>
              </div>
              <div className="flex items-center justify-between text-[11px]">
                <span className="text-[var(--os-text-muted)]">File Size:</span>
                <span className="font-mono text-[var(--os-text)]">
                  {formatBytes(existingItem.size)}
                </span>
              </div>
              <div className="flex items-center justify-between text-[11px]">
                <span className="text-[var(--os-text-muted)]">Save Location:</span>
                <span
                  className="font-mono text-[10px] text-[var(--os-text-muted)] truncate max-w-[260px] flex items-center gap-1"
                  title={existingItem.savePath}
                >
                  <Folder className="w-3 h-3 shrink-0" />
                  <span className="truncate">{existingItem.savePath}</span>
                </span>
              </div>
            </div>

            {/* Progress indicator */}
            <div className="pt-1.5">
              <div className="w-full bg-[var(--os-bg-window)] h-1.5 rounded-full overflow-hidden border border-[var(--os-border)]">
                <div
                  className="bg-[var(--os-accent)] h-full rounded-full transition-all duration-150"
                  style={{ width: `${Math.min(100, Math.max(0, existingItem.progress))}%` }}
                />
              </div>
            </div>
          </div>

          <p className="text-[11.5px] text-[var(--os-text-muted)] leading-relaxed">
            Choose whether to <strong>overwrite</strong> the existing download and start fresh, <strong>keep</strong> the current download without adding another copy, or <strong>cancel</strong>.
          </p>
        </div>

        {/* Modal Action Buttons: Overwrite, Do Not Add, Cancel */}
        <div className="px-4 py-3 bg-[var(--os-bg-statusbar)] border-t border-[var(--os-border)] flex items-center justify-end gap-2 shrink-0">
          <button
            type="button"
            onClick={onCancel}
            className="px-3 py-1.5 rounded bg-[var(--os-bg-control)] hover:bg-[var(--os-bg-hover)] border border-[var(--os-border)] text-[var(--os-text)] text-xs font-medium transition-colors"
          >
            Cancel
          </button>

          <button
            type="button"
            onClick={onDoNotAdd}
            className="px-3.5 py-1.5 rounded bg-[var(--os-bg-control)] hover:bg-[var(--os-bg-hover)] border border-[var(--os-border)] text-[var(--os-text)] text-xs font-semibold flex items-center gap-1.5 transition-colors shadow-2xs"
          >
            <Ban className="w-3.5 h-3.5 text-amber-500" />
            <span>Do Not Add</span>
          </button>

          <button
            type="button"
            onClick={onOverwrite}
            className="px-4 py-1.5 rounded bg-rose-600 hover:bg-rose-500 text-white text-xs font-semibold flex items-center gap-1.5 shadow-2xs transition-colors"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>Overwrite</span>
          </button>
        </div>
      </div>
    </div>
  );
};
