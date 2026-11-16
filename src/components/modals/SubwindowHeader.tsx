import React from 'react';
import { X } from 'lucide-react';
import { detectHostOs, OsStyle } from '../../utils/detectOs';

interface SubwindowHeaderProps {
  title: React.ReactNode;
  icon?: React.ReactNode;
  onClose: () => void;
  onMouseDown?: (e: React.MouseEvent) => void;
  osStyle?: OsStyle;
  className?: string;
}

/**
 * OS-compliant subwindow / dialog title bar:
 * - macOS: Only the red close traffic light on the left side; centered title; no right-side buttons.
 * - Linux: Title & icon on the left; only the close button on the right side (no min/max on subwindows).
 * - Windows: Title & icon on the left; only the close button on the right side (no min/max on subwindows).
 */
export const SubwindowHeader: React.FC<SubwindowHeaderProps> = ({
  title,
  icon,
  onClose,
  onMouseDown,
  osStyle,
  className = '',
}) => {
  const activeOs: OsStyle =
    osStyle ||
    ((typeof document !== 'undefined' &&
      (document.documentElement.getAttribute('data-os') as OsStyle)) ||
      detectHostOs());

  if (activeOs === 'macos') {
    return (
      <div
        onMouseDown={onMouseDown}
        className={`h-8 bg-[var(--os-bg-titlebar)] border-b border-[var(--os-border)] px-3 flex items-center justify-between font-semibold shrink-0 select-none relative ${
          onMouseDown ? 'cursor-move' : ''
        } ${className}`}
      >
        {/* Left: Only the red close traffic light on macOS subwindows */}
        <div className="flex items-center z-10">
          <button
            type="button"
            onClick={onClose}
            aria-label="Close subwindow"
            title="Close"
            className="group w-3 h-3 rounded-full bg-[#ff5f57] hover:bg-[#ff4b42] border border-[#e0443e] flex items-center justify-center shadow-2xs transition-colors"
          >
            <X className="w-2 h-2 text-[#4d0000] opacity-0 group-hover:opacity-100 stroke-[2.8]" />
          </button>
        </div>

        {/* Center: Subwindow Title */}
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none px-10">
          <div className="flex items-center gap-1.5 truncate text-xs font-semibold text-[var(--os-text)]">
            {icon}
            <span className="truncate">{title}</span>
          </div>
        </div>

        {/* Right spacer to keep layout balanced */}
        <div className="w-3 shrink-0" />
      </div>
    );
  }

  return (
    <div
      onMouseDown={onMouseDown}
      className={`h-8 bg-[var(--os-bg-titlebar)] border-b border-[var(--os-border)] px-3 flex items-center justify-between font-semibold shrink-0 select-none ${
        onMouseDown ? 'cursor-move' : ''
      } ${className}`}
    >
      {/* Left: Icon + Title */}
      <div className="flex items-center gap-2 truncate pr-2">
        {icon}
        <span className="truncate text-xs font-semibold text-[var(--os-text)]">{title}</span>
      </div>

      {/* Right: Only Close button on Linux & Windows subwindows */}
      <button
        type="button"
        onClick={onClose}
        aria-label="Close subwindow"
        title="Close"
        className={
          activeOs === 'linux'
            ? 'w-5 h-5 rounded-full flex items-center justify-center text-[var(--os-text-muted)] hover:bg-rose-600 hover:text-white transition-colors shrink-0'
            : 'w-6 h-5 rounded-xs flex items-center justify-center text-[var(--os-text-muted)] hover:bg-rose-600 hover:text-white transition-colors shrink-0'
        }
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );
};
