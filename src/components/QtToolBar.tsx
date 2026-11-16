import React from 'react';
import { 
  FilePlus, Globe, Play, Square, Pause, Trash2, ArrowUp, ArrowDown, 
  ShieldCheck, ShieldAlert, Gauge, Sliders, Search 
} from 'lucide-react';

interface QtToolBarProps {
  onOpenAddTorrent: () => void;
  onOpenAddUrl: () => void;
  onResumeSelected: () => void;
  onStopSelected?: () => void;
  onPauseSelected: () => void;
  onDeleteSelected: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onToggleTurtle: () => void;
  onSetTurtle?: (active: boolean) => void;
  turtleActive: boolean;
  onToggleLibqrbit: () => void;
  onSetLibqrbit?: (active: boolean) => void;
  libqrbitActive: boolean;
  onOpenSettings: () => void;
  searchFilter: string;
  onSearchChange: (val: string) => void;
  selectedCount: number;
  selectedIsDownloading?: boolean;
  altDownloadLimitKbps?: number;
}

export const QtToolBar: React.FC<QtToolBarProps> = ({
  onOpenAddTorrent,
  onOpenAddUrl,
  onResumeSelected,
  onStopSelected,
  onPauseSelected,
  onDeleteSelected,
  onMoveUp,
  onMoveDown,
  onToggleTurtle,
  onSetTurtle,
  turtleActive,
  onToggleLibqrbit,
  onSetLibqrbit,
  libqrbitActive,
  onOpenSettings,
  searchFilter,
  onSearchChange,
  selectedCount,
  selectedIsDownloading = false,
  altDownloadLimitKbps = 2048,
}) => {
  return (
    <div className="h-10 bg-[var(--os-bg-toolbar)] border-b border-[var(--os-border)] px-2 flex items-center justify-between select-none text-[var(--os-text)] text-xs transition-colors overflow-hidden">
      {/* Left: Action Buttons Strip */}
      <div className="flex items-center space-x-1 shrink-0 overflow-hidden">
        {/* Add Torrent / Magnet */}
        <button
          onClick={onOpenAddTorrent}
          title="Add Torrent or Magnet Link (Ctrl+O)"
          className="flex items-center gap-1.5 px-2 py-1 rounded bg-[var(--os-bg-control)] hover:bg-[var(--os-bg-hover)] text-[var(--os-text)] border border-[var(--os-border)] shadow-2xs transition-colors shrink-0"
        >
          <FilePlus className="w-3.5 h-3.5 text-[var(--os-accent)]" />
          <span className="text-[11px] font-medium">Torrent / Magnet</span>
        </button>

        {/* Add HTTP / IDM Direct URL */}
        <button
          onClick={onOpenAddUrl}
          title="Add HTTP / Direct Download (Multi-Segment IDM mode)"
          className="flex items-center gap-1.5 px-2 py-1 rounded bg-[var(--os-bg-control)] hover:bg-[var(--os-bg-hover)] text-[var(--os-text)] border border-[var(--os-border)] shadow-2xs transition-colors shrink-0"
        >
          <Globe className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
          <span className="text-[11px] font-medium">URL</span>
        </button>

        <div className="h-4 w-px bg-[var(--os-border)] mx-1 shrink-0" />

        {/* Play (Start / Resume) or Stop when selected transfer is actively downloading */}
        {selectedCount > 0 && selectedIsDownloading ? (
          <button
            onClick={onStopSelected || onPauseSelected}
            title="Stop Transfer"
            className="p-1.5 rounded hover:bg-[var(--os-bg-hover)] text-rose-600 dark:text-rose-400 transition-colors shrink-0"
          >
            <Square className="w-3.5 h-3.5 fill-rose-500/20" />
          </button>
        ) : (
          <button
            onClick={onResumeSelected}
            disabled={selectedCount === 0}
            title="Start / Resume Transfer"
            className="p-1.5 rounded hover:bg-[var(--os-bg-hover)] text-emerald-600 dark:text-emerald-400 disabled:opacity-30 disabled:hover:bg-transparent transition-colors shrink-0"
          >
            <Play className="w-3.5 h-3.5 fill-emerald-500/20" />
          </button>
        )}

        {/* Pause */}
        <button
          onClick={onPauseSelected}
          disabled={selectedCount === 0}
          title="Pause Transfer"
          className="p-1.5 rounded hover:bg-[var(--os-bg-hover)] text-amber-600 dark:text-amber-400 disabled:opacity-30 disabled:hover:bg-transparent transition-colors shrink-0"
        >
          <Pause className="w-3.5 h-3.5 fill-amber-500/20" />
        </button>

        {/* Delete */}
        <button
          onClick={onDeleteSelected}
          disabled={selectedCount === 0}
          title="Delete Transfer"
          className="p-1.5 rounded hover:bg-[var(--os-bg-hover)] text-rose-600 dark:text-rose-400 disabled:opacity-30 disabled:hover:bg-transparent transition-colors shrink-0"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>

        <div className="h-4 w-px bg-[var(--os-border)] mx-1 shrink-0" />

        {/* Priority Up / Down */}
        <button
          onClick={onMoveUp}
          disabled={selectedCount === 0}
          title="Move Up in Queue"
          className="p-1.5 rounded hover:bg-[var(--os-bg-hover)] text-[var(--os-text)] disabled:opacity-30 disabled:hover:bg-transparent transition-colors shrink-0"
        >
          <ArrowUp className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={onMoveDown}
          disabled={selectedCount === 0}
          title="Move Down in Queue"
          className="p-1.5 rounded hover:bg-[var(--os-bg-hover)] text-[var(--os-text)] disabled:opacity-30 disabled:hover:bg-transparent transition-colors shrink-0"
        >
          <ArrowDown className="w-3.5 h-3.5" />
        </button>

        <div className="h-4 w-px bg-[var(--os-border)] mx-1 shrink-0" />

        {/* Turtle Mode Single Button (Switches between Limited and Unlimited) */}
        <button
          onClick={onToggleTurtle}
          title={`Speed Mode: ${turtleActive ? `Limited (Alternative limits active: ${(altDownloadLimitKbps / 1024).toFixed(1)} MB/s)` : 'Unlimited (Full speed)'} - Click to switch`}
          className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-[11px] font-medium border transition-all shadow-2xs shrink-0 ${
            turtleActive
              ? 'bg-amber-100 dark:bg-amber-950/70 text-amber-900 dark:text-amber-200 border-amber-400 dark:border-amber-700/80 font-semibold'
              : 'bg-[var(--os-bg-control)] hover:bg-[var(--os-bg-hover)] text-[var(--os-text)] border-[var(--os-border)]'
          }`}
        >
          <Gauge className={`w-3.5 h-3.5 ${turtleActive ? 'text-amber-600 dark:text-amber-400' : 'text-[var(--os-text-muted)]'}`} />
          <span>{turtleActive ? 'Limited' : 'Unlimited'}</span>
        </button>

        {/* Stealth Single Button (Switches between On and Off) */}
        <button
          onClick={onToggleLibqrbit}
          title={`libqrbit Stealth DPI Masking: ${libqrbitActive ? 'On' : 'Off'} - Click to toggle`}
          className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-[11px] font-medium border transition-all shadow-2xs shrink-0 ${
            libqrbitActive
              ? 'bg-[var(--os-bg-selected-soft)] text-[var(--os-text-selected-soft)] border-[var(--os-accent)] font-semibold'
              : 'bg-[var(--os-bg-control)] text-[var(--os-text-muted)] border-[var(--os-border)] hover:bg-[var(--os-bg-hover)]'
          }`}
        >
          {libqrbitActive ? (
            <ShieldCheck className="w-3.5 h-3.5 text-[var(--os-accent)]" />
          ) : (
            <ShieldAlert className="w-3.5 h-3.5 text-[var(--os-text-muted)]" />
          )}
          <span>Stealth: {libqrbitActive ? 'On' : 'Off'}</span>
        </button>
      </div>

      {/* Right: Search Filter & Settings Quick Action */}
      <div className="flex items-center space-x-1.5 shrink-0 ml-2">
        <div className="relative">
          <Search className="w-3.5 h-3.5 absolute left-2 top-2 text-[var(--os-text-muted)]" />
          <input
            type="text"
            value={searchFilter}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Filter..."
            className="w-28 sm:w-36 pl-7 pr-2 py-1 rounded bg-[var(--os-bg-content)] border border-[var(--os-border)] text-[var(--os-text)] text-xs placeholder:text-[var(--os-text-muted)] focus:outline-none focus:border-[var(--os-accent)] font-normal"
          />
        </div>

        <button
          onClick={onOpenSettings}
          title="Preferences & Options (HTTP, BitTorrent, System)"
          className="p-1.5 rounded hover:bg-[var(--os-bg-hover)] text-[var(--os-text)] transition-colors shrink-0"
        >
          <Sliders className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
};
