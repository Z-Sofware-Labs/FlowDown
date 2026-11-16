import React, { useState, useEffect, useRef } from 'react';
import { Pencil, Check } from 'lucide-react';
import { TorrentItem } from '../../types';
import { SubwindowHeader } from './SubwindowHeader';

interface RenameTransferModalProps {
  isOpen: boolean;
  torrent: TorrentItem | null;
  onClose: () => void;
  onRename: (id: string, newName: string) => void;
}

export const RenameTransferModal: React.FC<RenameTransferModalProps> = ({
  isOpen,
  torrent,
  onClose,
  onRename,
}) => {
  const [name, setName] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen && torrent) {
      setName(torrent.name);
      requestAnimationFrame(() => {
        if (inputRef.current) {
          inputRef.current.focus();
          // Select base filename up to last extension dot for quick renaming
          const lastDot = torrent.name.lastIndexOf('.');
          if (lastDot > 0) {
            inputRef.current.setSelectionRange(0, lastDot);
          } else {
            inputRef.current.select();
          }
        }
      });
    }
  }, [isOpen, torrent]);

  if (!isOpen || !torrent) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    onRename(torrent.id, trimmed);
    onClose();
  };

  return (
    <div
      className="fixed inset-0 bg-black/50 backdrop-blur-xs flex items-center justify-center z-50 p-4 select-none"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-md bg-[var(--os-bg-window)] border border-[var(--os-border)] rounded shadow-2xl overflow-hidden text-[var(--os-text)] text-xs font-sans animate-in fade-in-50 zoom-in-95 duration-100">
        {/* Native OS Dialog Title Bar */}
        <SubwindowHeader
          onClose={onClose}
          icon={<Pencil className="w-3.5 h-3.5 text-[var(--os-accent)] shrink-0" />}
          title="Rename Transfer"
        />

        <form onSubmit={handleSubmit} className="p-4 space-y-3">
          <div className="space-y-1.5">
            <label className="text-[11px] text-[var(--os-text)] font-medium block">
              New Name:
            </label>
            <input
              ref={inputRef}
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  e.stopPropagation();
                  onClose();
                }
              }}
              className="w-full px-2.5 py-1.5 rounded bg-[var(--os-bg-content)] border border-[var(--os-border)] text-[var(--os-text)] focus:outline-none focus:border-[var(--os-accent)] font-mono text-[11px]"
            />
          </div>

          <div className="text-[10px] text-[var(--os-text-muted)] font-mono truncate">
            Hash: {torrent.hash}
          </div>

          <div className="flex items-center justify-end gap-2 pt-2 border-t border-[var(--os-border)]">
            <button
              type="button"
              onClick={onClose}
              className="px-3.5 py-1.5 rounded bg-[var(--os-bg-control)] hover:bg-[var(--os-bg-hover)] border border-[var(--os-border)] text-[var(--os-text)] text-xs font-medium"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!name.trim()}
              className="px-4 py-1.5 rounded bg-[var(--os-accent)] hover:bg-[var(--os-accent-hover)] disabled:opacity-40 text-white text-xs font-semibold shadow-xs flex items-center gap-1.5"
            >
              <Check className="w-3.5 h-3.5" />
              <span>Save Name</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
