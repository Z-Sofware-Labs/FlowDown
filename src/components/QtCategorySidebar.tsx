import React, { useState } from 'react';
import { 
  Download, Upload, CheckCircle2, PlayCircle, PauseCircle, 
  ShieldCheck, AlertTriangle, Folder, Tag, Activity, ChevronDown, ChevronRight, Layers
} from 'lucide-react';
import { TorrentItem } from '../types';

interface QtCategorySidebarProps {
  torrents: TorrentItem[];
  selectedCategory: string;
  onSelectCategory: (cat: string) => void;
  selectedStatus: string;
  onSelectStatus: (status: string) => void;
  selectedTag: string;
  onSelectTag: (tag: string) => void;
  width?: number;
}

export const QtCategorySidebar: React.FC<QtCategorySidebarProps> = ({
  torrents,
  selectedCategory,
  onSelectCategory,
  selectedStatus,
  onSelectStatus,
  selectedTag,
  onSelectTag,
  width,
}) => {
  const [statusExpanded, setStatusExpanded] = useState(true);
  const [categoriesExpanded, setCategoriesExpanded] = useState(true);
  const [tagsExpanded, setTagsExpanded] = useState(true);

  // Compute counts
  const allCount = torrents.length;
  const downloadingCount = torrents.filter((t) => t.status === 'downloading' || t.status === 'stealth_active').length;
  const seedingCount = torrents.filter((t) => t.status === 'seeding').length;
  const completedCount = torrents.filter((t) => t.progress >= 100).length;
  const pausedCount = torrents.filter((t) => t.status === 'paused').length;
  const throttledCount = torrents.filter((t) => t.status === 'throttled').length;
  const stealthCount = torrents.filter((t) => t.libqrbitEnabled && t.status === 'stealth_active').length;

  const categories = Array.from(
    new Set([
      'All',
      'Default',
      'Linux',
      'Datasets',
      'Media',
      'Archives',
      'Software',
      'Other',
      ...torrents.map((t) => t.category).filter(Boolean),
    ])
  );
  const tags = Array.from(
    new Set([
      'All',
      'libqrbit',
      'Multi-Path',
      'Research',
      'IDM-MultiChunk',
      'ISO',
      'HTTP-Direct',
      'BitTorrent',
      'Standard',
      ...torrents.flatMap((t) => t.tags || []).filter(Boolean),
    ])
  );

  return (
    <div
      style={{ width: width ? `${width}px` : undefined }}
      className={`${width ? '' : 'w-56'} shrink-0 bg-[var(--os-bg-sidebar)] border-r border-[var(--os-border)] text-[var(--os-text)] text-xs flex flex-col h-full select-none overflow-y-auto transition-colors`}
    >
      {/* Status Section */}
      <div className="py-2">
        <button
          onClick={() => setStatusExpanded(!statusExpanded)}
          className="w-full px-3 py-1 flex items-center justify-between text-[11px] font-semibold text-[var(--os-text-muted)] hover:text-[var(--os-text)] tracking-wider uppercase"
        >
          <span className="flex items-center gap-1.5">
            {statusExpanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
            Transfers
          </span>
          <span className="text-[10px] font-mono text-[var(--os-text-muted)]">({allCount})</span>
        </button>

        {statusExpanded && (
          <div className="mt-1 space-y-0.5">
            <button
              onClick={() => onSelectStatus('all')}
              className={`w-full px-3 py-1 flex items-center justify-between text-left transition-colors ${
                selectedStatus === 'all'
                  ? 'bg-[var(--os-bg-selected-soft)] text-[var(--os-text-selected-soft)] border-l-2 border-[var(--os-accent)] font-semibold'
                  : 'hover:bg-[var(--os-bg-hover)] text-[var(--os-text)]'
              }`}
            >
              <div className="flex items-center gap-2">
                <Layers className="w-3.5 h-3.5 text-[var(--os-text-muted)]" />
                <span>All Transfers</span>
              </div>
              <span className="text-[10px] font-mono text-[var(--os-text-muted)]">{allCount}</span>
            </button>

            <button
              onClick={() => onSelectStatus('downloading')}
              className={`w-full px-3 py-1 flex items-center justify-between text-left transition-colors ${
                selectedStatus === 'downloading'
                  ? 'bg-[var(--os-bg-selected-soft)] text-[var(--os-text-selected-soft)] border-l-2 border-[var(--os-accent)] font-semibold'
                  : 'hover:bg-[var(--os-bg-hover)] text-[var(--os-text)]'
              }`}
            >
              <div className="flex items-center gap-2">
                <Download className="w-3.5 h-3.5 text-[var(--os-accent)]" />
                <span>Downloading</span>
              </div>
              <span className="text-[10px] font-mono text-[var(--os-text-muted)]">{downloadingCount}</span>
            </button>

            <button
              onClick={() => onSelectStatus('seeding')}
              className={`w-full px-3 py-1 flex items-center justify-between text-left transition-colors ${
                selectedStatus === 'seeding'
                  ? 'bg-[var(--os-bg-selected-soft)] text-[var(--os-text-selected-soft)] border-l-2 border-[var(--os-accent)] font-semibold'
                  : 'hover:bg-[var(--os-bg-hover)] text-[var(--os-text)]'
              }`}
            >
              <div className="flex items-center gap-2">
                <Upload className="w-3.5 h-3.5 text-[var(--os-accent)]" />
                <span>Seeding</span>
              </div>
              <span className="text-[10px] font-mono text-[var(--os-text-muted)]">{seedingCount}</span>
            </button>

            <button
              onClick={() => onSelectStatus('completed')}
              className={`w-full px-3 py-1 flex items-center justify-between text-left transition-colors ${
                selectedStatus === 'completed'
                  ? 'bg-[var(--os-bg-selected-soft)] text-[var(--os-text-selected-soft)] border-l-2 border-[var(--os-accent)] font-semibold'
                  : 'hover:bg-[var(--os-bg-hover)] text-[var(--os-text)]'
              }`}
            >
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                <span>Completed</span>
              </div>
              <span className="text-[10px] font-mono text-[var(--os-text-muted)]">{completedCount}</span>
            </button>

            <button
              onClick={() => onSelectStatus('paused')}
              className={`w-full px-3 py-1 flex items-center justify-between text-left transition-colors ${
                selectedStatus === 'paused'
                  ? 'bg-[var(--os-bg-selected-soft)] text-[var(--os-text-selected-soft)] border-l-2 border-[var(--os-accent)] font-semibold'
                  : 'hover:bg-[var(--os-bg-hover)] text-[var(--os-text)]'
              }`}
            >
              <div className="flex items-center gap-2">
                <PauseCircle className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" />
                <span>Paused</span>
              </div>
              <span className="text-[10px] font-mono text-[var(--os-text-muted)]">{pausedCount}</span>
            </button>

            {/* Special libqrbit Stealth Protected Filter */}
            <button
              onClick={() => onSelectStatus('stealth')}
              className={`w-full px-3 py-1 flex items-center justify-between text-left transition-colors ${
                selectedStatus === 'stealth'
                  ? 'bg-emerald-100 dark:bg-emerald-950/70 text-emerald-900 dark:text-emerald-200 border-l-2 border-emerald-600 dark:border-emerald-400 font-semibold'
                  : 'hover:bg-[var(--os-bg-hover)] text-emerald-700 dark:text-emerald-400/90'
              }`}
            >
              <div className="flex items-center gap-2">
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                <span>libqrbit Stealth</span>
              </div>
              <span className="text-[10px] font-mono text-emerald-800 dark:text-emerald-300 bg-emerald-100 dark:bg-emerald-950/80 px-1.5 py-0.2 rounded border border-emerald-300 dark:border-emerald-800/60 font-semibold">
                {stealthCount}
              </span>
            </button>

            {/* ISP Throttled Filter */}
            <button
              onClick={() => onSelectStatus('throttled')}
              className={`w-full px-3 py-1 flex items-center justify-between text-left transition-colors ${
                selectedStatus === 'throttled'
                  ? 'bg-rose-100 dark:bg-rose-950/70 text-rose-900 dark:text-rose-200 border-l-2 border-rose-600 dark:border-rose-400 font-semibold'
                  : 'hover:bg-[var(--os-bg-hover)] text-rose-700 dark:text-rose-400/90'
              }`}
            >
              <div className="flex items-center gap-2">
                <AlertTriangle className="w-3.5 h-3.5 text-rose-600 dark:text-rose-400" />
                <span>ISP Throttled</span>
              </div>
              <span className="text-[10px] font-mono text-rose-800 dark:text-rose-300 bg-rose-100 dark:bg-rose-950/80 px-1.5 py-0.2 rounded border border-rose-300 dark:border-rose-800/60 font-semibold">
                {throttledCount}
              </span>
            </button>
          </div>
        )}
      </div>

      <div className="border-t border-[var(--os-border-subtle)] my-1" />

      {/* Categories Section */}
      <div className="py-2">
        <button
          onClick={() => setCategoriesExpanded(!categoriesExpanded)}
          className="w-full px-3 py-1 flex items-center justify-between text-[11px] font-semibold text-[var(--os-text-muted)] hover:text-[var(--os-text)] tracking-wider uppercase"
        >
          <span className="flex items-center gap-1.5">
            {categoriesExpanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
            Categories
          </span>
        </button>

        {categoriesExpanded && (
          <div className="mt-1 space-y-0.5">
            {categories.map((cat) => {
              const count = cat === 'All' ? torrents.length : torrents.filter((t) => t.category === cat).length;
              return (
                <button
                  key={cat}
                  onClick={() => onSelectCategory(cat)}
                  className={`w-full px-3 py-1 flex items-center justify-between text-left transition-colors ${
                    selectedCategory === cat
                      ? 'bg-[var(--os-bg-selected-soft)] text-[var(--os-text-selected-soft)] border-l-2 border-[var(--os-accent)] font-semibold'
                      : 'hover:bg-[var(--os-bg-hover)] text-[var(--os-text)]'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <Folder className="w-3.5 h-3.5 text-amber-500 dark:text-amber-400/80" />
                    <span>{cat}</span>
                  </div>
                  <span className="text-[10px] font-mono text-[var(--os-text-muted)]">{count}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      <div className="border-t border-[var(--os-border-subtle)] my-1" />

      {/* Tags Section */}
      <div className="py-2">
        <button
          onClick={() => setTagsExpanded(!tagsExpanded)}
          className="w-full px-3 py-1 flex items-center justify-between text-[11px] font-semibold text-[var(--os-text-muted)] hover:text-[var(--os-text)] tracking-wider uppercase"
        >
          <span className="flex items-center gap-1.5">
            {tagsExpanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
            Tags
          </span>
        </button>

        {tagsExpanded && (
          <div className="mt-1 space-y-0.5">
            {tags.map((tag) => {
              const count = tag === 'All' ? torrents.length : torrents.filter((t) => t.tags.includes(tag)).length;
              return (
                <button
                  key={tag}
                  onClick={() => onSelectTag(tag)}
                  className={`w-full px-3 py-1 flex items-center justify-between text-left transition-colors ${
                    selectedTag === tag
                      ? 'bg-[var(--os-bg-selected-soft)] text-[var(--os-text-selected-soft)] border-l-2 border-[var(--os-accent)] font-semibold'
                      : 'hover:bg-[var(--os-bg-hover)] text-[var(--os-text)]'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <Tag className="w-3.5 h-3.5 text-[var(--os-text-muted)]" />
                    <span className="truncate">{tag}</span>
                  </div>
                  <span className="text-[10px] font-mono text-[var(--os-text-muted)]">{count}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
