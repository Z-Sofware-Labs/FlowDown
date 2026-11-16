import React, { useState, useRef, useEffect, useCallback } from 'react';
import { 
  FileText, Download, Upload, PauseCircle, AlertTriangle, 
  ShieldCheck, Globe, RefreshCw, Trash2, 
  Copy, Play, Square, Pause, CheckSquare, Info, FolderOpen, Pencil, Hash, Link,
  ChevronRight, Check, Gauge
} from 'lucide-react';
import { TorrentItem, Priority, HealthPriorityMode, ObfuscationLevel } from '../types';
import { formatBytes, formatSpeed } from '../utils/formatters';

interface QtTransferTableProps {
  torrents: TorrentItem[];
  selectedId: string | null;
  onSelectTorrent: (id: string) => void;
  selectedIds?: string[];
  onSelectTorrents?: (ids: string[], primaryId?: string | null) => void;
  onResume: (id: string) => void;
  onStop?: (id: string) => void;
  onPause: (id: string) => void;
  onDelete: (id: string) => void;
  onForceRecheck: (id: string) => void;
  onSetPriority: (id: string, priority: Priority) => void;
  onSetHealthMode?: (id: string, mode: HealthPriorityMode) => void;
  onToggleLibqrbit?: (id: string) => void;
  onSetObfuscation?: (id: string, level: ObfuscationLevel) => void;
  onOpenDownloadInfo?: (id: string) => void;
  onOpenFolder?: (id: string) => void;
  onOpenItem?: (id: string) => void;
  onRequestRename?: (id: string) => void;
  onCopyName?: (ids: string[]) => void;
  onCopyInfoHash?: (ids: string[]) => void;
  onCopyMagnet?: (ids: string[]) => void;
  compactDensity?: boolean;
  onDeleteSelected?: () => void;
}

interface MarqueeBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

type ColumnId = 'name' | 'size' | 'progress' | 'status' | 'downSpeed' | 'upSpeed' | 'eta';

interface ColumnDef {
  id: ColumnId;
  label: string;
  align: 'left' | 'right';
  defaultWidth: number;
  minWidth: number;
}

const COLUMN_DEFS: Record<ColumnId, ColumnDef> = {
  name: { id: 'name', label: 'Name', align: 'left', defaultWidth: 300, minWidth: 120 },
  size: { id: 'size', label: 'Size', align: 'right', defaultWidth: 96, minWidth: 64 },
  progress: { id: 'progress', label: 'Progress', align: 'left', defaultWidth: 184, minWidth: 96 },
  status: { id: 'status', label: 'Status', align: 'left', defaultWidth: 140, minWidth: 88 },
  downSpeed: { id: 'downSpeed', label: 'Down Speed', align: 'right', defaultWidth: 112, minWidth: 78 },
  upSpeed: { id: 'upSpeed', label: 'Up Speed', align: 'right', defaultWidth: 96, minWidth: 72 },
  eta: { id: 'eta', label: 'ETA', align: 'right', defaultWidth: 92, minWidth: 60 },
};

const DEFAULT_COLUMN_ORDER: ColumnId[] = [
  'name',
  'size',
  'progress',
  'status',
  'downSpeed',
  'upSpeed',
  'eta',
];

const DEFAULT_COLUMN_WIDTHS: Record<ColumnId, number> = {
  name: COLUMN_DEFS.name.defaultWidth,
  size: COLUMN_DEFS.size.defaultWidth,
  progress: COLUMN_DEFS.progress.defaultWidth,
  status: COLUMN_DEFS.status.defaultWidth,
  downSpeed: COLUMN_DEFS.downSpeed.defaultWidth,
  upSpeed: COLUMN_DEFS.upSpeed.defaultWidth,
  eta: COLUMN_DEFS.eta.defaultWidth,
};

const COL_ORDER_STORAGE_KEY = 'flowdown_table_col_order_v1';
const COL_WIDTHS_STORAGE_KEY = 'flowdown_table_col_widths_v1';
const LEGACY_COL_ORDER_KEY = 'qrbit_table_col_order_v1';
const LEGACY_COL_WIDTHS_KEY = 'qrbit_table_col_widths_v1';

interface TransferTableRowProps {
  torrent: TorrentItem;
  isSelected: boolean;
  isEven: boolean;
  compactDensity: boolean;
  columnOrder: ColumnId[];
  onRowRef: (id: string, el: HTMLTableRowElement | null) => void;
  onContextMenu: (e: React.MouseEvent, id: string) => void;
  onDoubleClick: (id: string) => void;
}

const areRowsEqual = (prev: TransferTableRowProps, next: TransferTableRowProps): boolean => {
  if (prev.isSelected !== next.isSelected) return false;
  if (prev.isEven !== next.isEven) return false;
  if (prev.compactDensity !== next.compactDensity) return false;
  if (prev.columnOrder !== next.columnOrder) {
    if (prev.columnOrder.length !== next.columnOrder.length) return false;
    for (let i = 0; i < prev.columnOrder.length; i++) {
      if (prev.columnOrder[i] !== next.columnOrder[i]) return false;
    }
  }
  const p = prev.torrent;
  const n = next.torrent;
  if (p === n) return true;
  return (
    p.id === n.id &&
    p.name === n.name &&
    p.status === n.status &&
    p.progress === n.progress &&
    p.downloadSpeed === n.downloadSpeed &&
    p.uploadSpeed === n.uploadSpeed &&
    p.size === n.size &&
    p.eta === n.eta &&
    p.isMissing === n.isMissing &&
    p.isHttpSegmented === n.isHttpSegmented
  );
};

const TransferTableRow: React.FC<TransferTableRowProps> = React.memo(({
  torrent: tor,
  isSelected,
  isEven,
  compactDensity,
  columnOrder,
  onRowRef,
  onContextMenu,
  onDoubleClick,
}) => {
  const cellPad = compactDensity ? 'py-1 px-2.5' : 'py-2 px-3';

  return (
    <tr
      data-torrent-id={tor.id}
      ref={(el) => onRowRef(tor.id, el)}
      onContextMenu={(e) => onContextMenu(e, tor.id)}
      onDoubleClick={(e) => {
        e.stopPropagation();
        onDoubleClick(tor.id);
      }}
      className={`cursor-pointer transition-colors ${
        isSelected
          ? tor.isMissing
            ? 'bg-rose-900/60 text-white border-l-2 border-l-rose-500'
            : 'qt-selected-row text-white'
          : tor.isMissing
          ? 'bg-rose-950/25 hover:bg-rose-900/35 text-rose-300 border-l-2 border-l-rose-500/80'
          : isEven
          ? 'bg-[var(--os-bg-content)] hover:bg-[var(--os-bg-hover)]'
          : 'bg-[var(--os-bg-alt)] hover:bg-[var(--os-bg-hover)]'
      }`}
    >
      {columnOrder.map((colId) => {
        switch (colId) {
          case 'name':
            return (
              <td key={colId} className={`${cellPad} font-medium overflow-hidden`}>
                <div className="flex items-center gap-2 min-w-0">
                  {tor.isMissing ? (
                    <AlertTriangle className={`w-3.5 h-3.5 shrink-0 ${isSelected ? 'text-white' : 'text-rose-500 animate-pulse'}`} />
                  ) : tor.isHttpSegmented ? (
                    <Globe className={`w-3.5 h-3.5 shrink-0 ${isSelected ? 'text-white' : 'text-emerald-600 dark:text-emerald-400'}`} />
                  ) : (
                    <FileText className={`w-3.5 h-3.5 shrink-0 ${isSelected ? 'text-white' : 'text-[var(--os-accent)]'}`} />
                  )}
                  <span
                    className={`truncate text-[11px] ${
                      tor.isMissing
                        ? isSelected
                          ? 'text-white line-through opacity-90'
                          : 'text-rose-400 line-through opacity-85'
                        : ''
                    }`}
                    title={tor.isMissing ? `${tor.name} (File missing or deleted from disk)` : tor.name}
                  >
                    {tor.name}
                  </span>
                  {tor.isMissing && (
                    <span className="shrink-0 text-[9px] px-1 py-0.5 rounded font-mono font-semibold uppercase bg-rose-500/20 text-rose-400 border border-rose-500/40">
                      Missing
                    </span>
                  )}
                </div>
              </td>
            );

          case 'size':
            return (
              <td key={colId} className={`${cellPad} text-right font-mono text-[11px] truncate ${isSelected ? 'text-white' : 'text-[var(--os-text)]'}`}>
                {formatBytes(tor.size)}
              </td>
            );

          case 'progress':
            return (
              <td key={colId} className={`${cellPad} overflow-hidden`}>
                <div className="relative w-full h-3.5 bg-[var(--os-bg-alt)] rounded-xs overflow-hidden border border-[var(--os-border)]">
                  <div
                    className={`h-full transition-all duration-300 ${
                      tor.status === 'stealth_active'
                        ? 'bg-emerald-600 dark:bg-emerald-500'
                        : tor.status === 'throttled'
                        ? 'bg-rose-600'
                        : 'bg-[var(--os-accent)]'
                    }`}
                    style={{ width: `${Math.min(100, tor.progress)}%` }}
                  />
                  <span className="absolute inset-0 flex items-center justify-center text-[9px] font-mono font-semibold text-[var(--os-text)] drop-shadow-2xs">
                    {tor.progress.toFixed(1)}%
                  </span>
                </div>
              </td>
            );

          case 'status':
            return (
              <td key={colId} className={`${cellPad} overflow-hidden`}>
                <div className="flex items-center gap-1.5 text-[11px] min-w-0">
                  {tor.isMissing ? (
                    <>
                      <AlertTriangle className={`w-3.5 h-3.5 shrink-0 ${isSelected ? 'text-white' : 'text-rose-500 animate-pulse'}`} />
                      <span className={`truncate ${isSelected ? 'text-white font-semibold' : 'text-rose-400 font-medium'}`} title="File or directory missing from disk">
                        Missing File
                      </span>
                    </>
                  ) : tor.status === 'stealth_active' ? (
                    <>
                      <ShieldCheck className={`w-3.5 h-3.5 shrink-0 ${isSelected ? 'text-white' : 'text-emerald-600 dark:text-emerald-400'}`} />
                      <span className={`truncate ${isSelected ? 'text-white font-semibold' : 'text-emerald-700 dark:text-emerald-300 font-medium'}`}>
                        libqrbit Stealth
                      </span>
                    </>
                  ) : tor.status === 'throttled' ? (
                    <>
                      <AlertTriangle className={`w-3.5 h-3.5 shrink-0 ${isSelected ? 'text-white' : 'text-rose-600 dark:text-rose-400'}`} />
                      <span className={`truncate ${isSelected ? 'text-white font-semibold' : 'text-rose-700 dark:text-rose-400 font-medium'}`}>
                        ISP Throttled!
                      </span>
                    </>
                  ) : tor.status === 'seeding' ? (
                    <>
                      <Upload className={`w-3.5 h-3.5 shrink-0 ${isSelected ? 'text-white' : 'text-[var(--os-accent)]'}`} />
                      <span className={`truncate ${isSelected ? 'text-white' : 'text-[var(--os-accent)]'}`}>Seeding</span>
                    </>
                  ) : tor.status === 'paused' ? (
                    <>
                      <PauseCircle className={`w-3.5 h-3.5 shrink-0 ${isSelected ? 'text-white' : 'text-amber-600 dark:text-amber-400'}`} />
                      <span className={`truncate ${isSelected ? 'text-white' : 'text-amber-700 dark:text-amber-300'}`}>Paused</span>
                    </>
                  ) : tor.status === 'checking' ? (
                    <>
                      <RefreshCw className={`w-3.5 h-3.5 shrink-0 animate-spin ${isSelected ? 'text-white' : 'text-[var(--os-accent)]'}`} />
                      <span className={`truncate ${isSelected ? 'text-white' : 'text-[var(--os-accent)]'}`}>Checking...</span>
                    </>
                  ) : (
                    <>
                      <Download className={`w-3.5 h-3.5 shrink-0 ${isSelected ? 'text-white' : 'text-emerald-600 dark:text-emerald-400'}`} />
                      <span className={`truncate ${isSelected ? 'text-white' : 'text-[var(--os-text)]'}`}>Downloading</span>
                    </>
                  )}
                </div>
              </td>
            );

          case 'downSpeed':
            return (
              <td key={colId} className={`${cellPad} text-right font-mono text-[11px] truncate`}>
                <span
                  className={
                    tor.downloadSpeed > 0
                      ? isSelected
                        ? 'text-white font-bold'
                        : tor.status === 'throttled'
                        ? 'text-rose-600 dark:text-rose-400 font-semibold'
                        : 'text-emerald-700 dark:text-emerald-400 font-bold'
                      : isSelected
                      ? 'text-white/75'
                      : 'text-[var(--os-text-muted)]'
                  }
                >
                  {formatSpeed(tor.downloadSpeed)}
                </span>
              </td>
            );

          case 'upSpeed':
            return (
              <td
                key={colId}
                className={`${cellPad} text-right font-mono text-[11px] truncate ${
                  tor.uploadSpeed > 0
                    ? isSelected
                      ? 'text-white font-medium'
                      : 'text-[var(--os-accent)] font-medium'
                    : isSelected
                    ? 'text-white/75'
                    : 'text-[var(--os-text-muted)]'
                }`}
              >
                {formatSpeed(tor.uploadSpeed)}
              </td>
            );

          case 'eta':
            return (
              <td key={colId} className={`${cellPad} text-right font-mono text-[11px] truncate ${isSelected ? 'text-white' : 'text-[var(--os-text)]'}`}>
                {tor.eta}
              </td>
            );
        }
      })}
      <td className="p-0" />
    </tr>
  );
}, areRowsEqual);

export const QtTransferTable: React.FC<QtTransferTableProps> = ({
  torrents,
  selectedId,
  onSelectTorrent,
  selectedIds: externalSelectedIds,
  onSelectTorrents,
  onResume,
  onStop,
  onPause,
  onDelete,
  onForceRecheck,
  onSetPriority,
  onOpenDownloadInfo,
  onOpenFolder,
  onOpenItem,
  onRequestRename,
  onCopyName,
  onCopyInfoHash,
  onCopyMagnet,
  compactDensity = false,
  onDeleteSelected,
}) => {
  // Internal selection fallback if external is not provided
  const [internalSelectedIds, setInternalSelectedIds] = useState<string[]>(
    selectedId ? [selectedId] : []
  );

  const selectedIds = externalSelectedIds ?? internalSelectedIds;

  const updateSelection = useCallback(
    (newIds: string[], primaryId?: string | null) => {
      const primary = primaryId !== undefined ? primaryId : newIds[0] || null;
      if (onSelectTorrents) {
        onSelectTorrents(newIds, primary);
      } else {
        setInternalSelectedIds(newIds);
        if (primary && onSelectTorrent) {
          onSelectTorrent(primary);
        }
      }
    },
    [onSelectTorrents, onSelectTorrent]
  );

  // Moveable & Resizeable Columns State
  const [columnOrder, setColumnOrder] = useState<ColumnId[]>(() => {
    try {
      const raw = localStorage.getItem(COL_ORDER_STORAGE_KEY) || localStorage.getItem(LEGACY_COL_ORDER_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as ColumnId[];
        const valid = parsed.filter((id) => id in COLUMN_DEFS);
        if (valid.length === DEFAULT_COLUMN_ORDER.length && new Set(valid).size === DEFAULT_COLUMN_ORDER.length) {
          return valid;
        }
      }
    } catch {
      // ignore storage errors
    }
    return DEFAULT_COLUMN_ORDER;
  });

  const [colWidths, setColWidths] = useState<Record<ColumnId, number>>(() => {
    try {
      const raw = localStorage.getItem(COL_WIDTHS_STORAGE_KEY) || localStorage.getItem(LEGACY_COL_WIDTHS_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<Record<ColumnId, number>>;
        const merged = { ...DEFAULT_COLUMN_WIDTHS };
        (Object.keys(COLUMN_DEFS) as ColumnId[]).forEach((id) => {
          const val = parsed[id];
          if (typeof val === 'number' && val >= COLUMN_DEFS[id].minWidth && val <= 1000) {
            merged[id] = val;
          }
        });
        return merged;
      }
    } catch {
      // ignore storage errors
    }
    return { ...DEFAULT_COLUMN_WIDTHS };
  });

  useEffect(() => {
    try {
      localStorage.setItem(COL_ORDER_STORAGE_KEY, JSON.stringify(columnOrder));
    } catch {
      // ignore
    }
  }, [columnOrder]);

  useEffect(() => {
    try {
      localStorage.setItem(COL_WIDTHS_STORAGE_KEY, JSON.stringify(colWidths));
    } catch {
      // ignore
    }
  }, [colWidths]);

  const [resizingColId, setResizingColId] = useState<ColumnId | null>(null);
  const [draggedColId, setDraggedColId] = useState<ColumnId | null>(null);
  const [dropIndicator, setDropIndicator] = useState<{ id: ColumnId; position: 'before' | 'after' } | null>(null);
  const [headerMenu, setHeaderMenu] = useState<{ visible: boolean; x: number; y: number }>({
    visible: false,
    x: 0,
    y: 0,
  });

  const handleResetColumns = () => {
    setColumnOrder([...DEFAULT_COLUMN_ORDER]);
    setColWidths({ ...DEFAULT_COLUMN_WIDTHS });
    setHeaderMenu({ visible: false, x: 0, y: 0 });
  };

  const handleColumnResizeMouseDown = (e: React.MouseEvent, colId: ColumnId) => {
    e.preventDefault();
    e.stopPropagation();

    const startX = e.clientX;
    const startWidth = colWidths[colId];
    const minWidth = COLUMN_DEFS[colId].minWidth;

    setResizingColId(colId);
    document.body.style.cursor = 'col-resize';

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const deltaX = moveEvent.clientX - startX;
      const nextWidth = Math.max(minWidth, Math.min(900, Math.round(startWidth + deltaX)));
      setColWidths((prev) => ({ ...prev, [colId]: nextWidth }));
    };

    const handleMouseUp = () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
      setResizingColId(null);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  };

  const handleColumnDragStart = (e: React.DragEvent<HTMLTableCellElement>, colId: ColumnId) => {
    if (resizingColId) {
      e.preventDefault();
      return;
    }
    setDraggedColId(colId);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', colId);
  };

  const handleColumnDragOver = (e: React.DragEvent<HTMLTableCellElement>, targetId: ColumnId) => {
    if (!draggedColId || draggedColId === targetId) {
      if (dropIndicator?.id === targetId) setDropIndicator(null);
      return;
    }
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const rect = e.currentTarget.getBoundingClientRect();
    const position: 'before' | 'after' = e.clientX - rect.left < rect.width / 2 ? 'before' : 'after';
    if (!dropIndicator || dropIndicator.id !== targetId || dropIndicator.position !== position) {
      setDropIndicator({ id: targetId, position });
    }
  };

  const handleColumnDrop = (e: React.DragEvent<HTMLTableCellElement>, targetId: ColumnId) => {
    e.preventDefault();
    const sourceId = draggedColId || (e.dataTransfer.getData('text/plain') as ColumnId);
    if (!sourceId || sourceId === targetId || !(sourceId in COLUMN_DEFS)) {
      setDraggedColId(null);
      setDropIndicator(null);
      return;
    }

    const rect = e.currentTarget.getBoundingClientRect();
    const position: 'before' | 'after' = e.clientX - rect.left < rect.width / 2 ? 'before' : 'after';

    setColumnOrder((prev) => {
      const next = prev.filter((id) => id !== sourceId);
      const targetIndex = next.indexOf(targetId);
      if (targetIndex === -1) return prev;
      const insertAt = position === 'after' ? targetIndex + 1 : targetIndex;
      next.splice(insertAt, 0, sourceId);
      return next;
    });

    setDraggedColId(null);
    setDropIndicator(null);
  };

  const handleColumnDragEnd = () => {
    setDraggedColId(null);
    setDropIndicator(null);
  };

  // Marquee selection box state
  const containerRef = useRef<HTMLDivElement>(null);
  const rowRefs = useRef<Map<string, HTMLTableRowElement>>(new Map());
  const [marqueeBox, setMarqueeBox] = useState<MarqueeBox | null>(null);
  const isDraggingMarqueeRef = useRef(false);
  const dragStartRef = useRef<{
    clientX: number;
    clientY: number;
    scrollLeft: number;
    scrollTop: number;
    modifier: 'none' | 'ctrl' | 'shift';
    targetId: string | null;
    initialSelected: string[];
  } | null>(null);

  // Context menu state
  const [contextMenu, setContextMenu] = useState<{
    visible: boolean;
    x: number;
    y: number;
    torrentId: string | null;
    isMulti: boolean;
  }>({
    visible: false,
    x: 0,
    y: 0,
    torrentId: null,
    isMulti: false,
  });
  const [openSubmenu, setOpenSubmenu] = useState<'priority' | null>(null);

  const handleContextMenu = useCallback(
    (e: React.MouseEvent, id: string) => {
      e.preventDefault();
      e.stopPropagation();

      // If right-clicked on an item not currently in selection, select only this item
      let activeIds = selectedIds;
      if (!selectedIds.includes(id)) {
        activeIds = [id];
        updateSelection([id], id);
      }

      setOpenSubmenu(null);
      setContextMenu({
        visible: true,
        x: Math.min(e.clientX, Math.max(8, window.innerWidth - 248)),
        y: Math.min(e.clientY, Math.max(8, window.innerHeight - 380)),
        torrentId: id,
        isMulti: activeIds.length > 1,
      });
    },
    [selectedIds, updateSelection]
  );

  const handleRowRef = useCallback((id: string, el: HTMLTableRowElement | null) => {
    if (el) rowRefs.current.set(id, el);
    else rowRefs.current.delete(id);
  }, []);

  const handleRowDoubleClick = useCallback(
    (id: string) => {
      if (onOpenItem) {
        onOpenItem(id);
      } else if (onOpenFolder) {
        onOpenFolder(id);
      }
    },
    [onOpenItem, onOpenFolder]
  );

  const closeContextMenu = () => {
    setOpenSubmenu(null);
    if (contextMenu.visible) {
      setContextMenu({ visible: false, x: 0, y: 0, torrentId: null, isMulti: false });
    }
  };

  // Close context menus when clicking anywhere outside
  useEffect(() => {
    if (!contextMenu.visible && !headerMenu.visible) return;
    const handleGlobalMouseDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && target.closest('[data-qt-context-menu]')) return;
      setContextMenu({ visible: false, x: 0, y: 0, torrentId: null, isMulti: false });
      setHeaderMenu({ visible: false, x: 0, y: 0 });
    };
    window.addEventListener('mousedown', handleGlobalMouseDown);
    return () => window.removeEventListener('mousedown', handleGlobalMouseDown);
  }, [contextMenu.visible, headerMenu.visible]);

  // Keyboard navigation and shortcuts (Ctrl+A / Cmd+A, Escape, Enter, F2)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Check if target is an input or textarea
      if (
        document.activeElement instanceof HTMLInputElement ||
        document.activeElement instanceof HTMLTextAreaElement
      ) {
        return;
      }

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
        e.preventDefault();
        const allIds = torrents.map((t) => t.id);
        updateSelection(allIds, allIds[0] || null);
      } else if (e.key === 'Escape') {
        updateSelection([]);
        setContextMenu({ visible: false, x: 0, y: 0, torrentId: null, isMulti: false });
        setHeaderMenu({ visible: false, x: 0, y: 0 });
      } else if (e.key === 'Enter' && selectedIds.length > 0 && onOpenDownloadInfo) {
        e.preventDefault();
        onOpenDownloadInfo(selectedIds[0]);
      } else if (e.key === 'F2' && selectedIds.length === 1 && onRequestRename) {
        e.preventDefault();
        onRequestRename(selectedIds[0]);
      } else if (e.key === 'F5' && selectedIds.length > 0) {
        e.preventDefault();
        selectedIds.forEach((id) => onForceRecheck(id));
      } else if (e.key === 'Delete' && selectedIds.length > 0) {
        e.preventDefault();
        if (onDeleteSelected) {
          onDeleteSelected();
        } else {
          selectedIds.forEach((id) => onDelete(id));
          updateSelection([]);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [torrents, updateSelection, selectedIds, onOpenDownloadInfo, onRequestRename, onForceRecheck, onDeleteSelected, onDelete]);

  // Handle mousedown on table container or rows
  const handleMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    // Only handle primary left mouse button
    if (e.button !== 0) return;

    // Ignore clicks on table headers (drag/resize), context menus, buttons, or inputs
    const target = e.target as HTMLElement;
    if (
      target.closest('thead') ||
      target.closest('[data-col-resizer]') ||
      target.closest('[data-qt-context-menu]') ||
      target.closest('button') ||
      target.closest('input') ||
      target.closest('select')
    ) {
      return;
    }

    // Prevent native browser text selection or ghost drag
    e.preventDefault();

    closeContextMenu();
    setHeaderMenu({ visible: false, x: 0, y: 0 });

    const container = containerRef.current;
    if (!container) return;

    // Identify if clicked on a specific row
    const rowEl = target.closest('tr[data-torrent-id]') as HTMLElement | null;
    const clickedId = rowEl ? rowEl.getAttribute('data-torrent-id') : null;

    const modifier: 'none' | 'ctrl' | 'shift' = e.shiftKey
      ? 'shift'
      : e.ctrlKey || e.metaKey
      ? 'ctrl'
      : 'none';

    dragStartRef.current = {
      clientX: e.clientX,
      clientY: e.clientY,
      scrollLeft: container.scrollLeft,
      scrollTop: container.scrollTop,
      modifier,
      targetId: clickedId,
      initialSelected: [...selectedIds],
    };
    isDraggingMarqueeRef.current = false;

    // Attach global move and up listeners
    const handleGlobalMouseMove = (moveEvent: MouseEvent) => {
      if (!dragStartRef.current || !containerRef.current) return;
      const start = dragStartRef.current;
      const cont = containerRef.current;
      const contRect = cont.getBoundingClientRect();

      const dist = Math.hypot(
        moveEvent.clientX - start.clientX,
        moveEvent.clientY - start.clientY
      );

      // Start drag marquee after moving more than 3 pixels
      if (!isDraggingMarqueeRef.current && dist > 3) {
        isDraggingMarqueeRef.current = true;
      }

      if (isDraggingMarqueeRef.current) {
        // Drag rectangle in client viewport coordinates
        const mLeft = Math.min(start.clientX, moveEvent.clientX);
        const mTop = Math.min(start.clientY, moveEvent.clientY);
        const mRight = Math.max(start.clientX, moveEvent.clientX);
        const mBottom = Math.max(start.clientY, moveEvent.clientY);

        // Visual box relative to scrollable container
        const left = mLeft - contRect.left + cont.scrollLeft;
        const top = mTop - contRect.top + cont.scrollTop;
        const width = Math.max(2, mRight - mLeft);
        const height = Math.max(2, mBottom - mTop);

        setMarqueeBox({ left, top, width, height });

        // Calculate intersection with all table rows in viewport coordinates
        const intersectedIds: string[] = [];
        rowRefs.current.forEach((row, rowId) => {
          if (!row) return;
          const rRect = row.getBoundingClientRect();

          // 2D Overlap check: does marquee intersect with row?
          const overlaps = !(
            mRight < rRect.left ||
            mLeft > rRect.right ||
            mBottom < rRect.top ||
            mTop > rRect.bottom
          );

          if (overlaps) {
            intersectedIds.push(rowId);
          }
        });

        // Determine active selection based on modifier
        if (start.modifier === 'ctrl') {
          const union = Array.from(new Set([...start.initialSelected, ...intersectedIds]));
          updateSelection(union, intersectedIds[intersectedIds.length - 1] || start.initialSelected[0]);
        } else {
          updateSelection(intersectedIds, intersectedIds[intersectedIds.length - 1] || null);
        }
      }
    };

    const handleGlobalMouseUp = (upEvent: MouseEvent) => {
      window.removeEventListener('mousemove', handleGlobalMouseMove);
      window.removeEventListener('mouseup', handleGlobalMouseUp);

      const start = dragStartRef.current;
      dragStartRef.current = null;

      if (isDraggingMarqueeRef.current) {
        // Finished dragging selection box
        isDraggingMarqueeRef.current = false;
        setMarqueeBox(null);
      } else if (start) {
        // Clean single click (not a drag)
        if (start.targetId) {
          const clickedId = start.targetId;
          if (start.modifier === 'ctrl') {
            // Toggle clicked item in selection
            if (start.initialSelected.includes(clickedId)) {
              const next = start.initialSelected.filter((id) => id !== clickedId);
              updateSelection(next, next[0] || null);
            } else {
              const next = [...start.initialSelected, clickedId];
              updateSelection(next, clickedId);
            }
          } else if (start.modifier === 'shift' && selectedId) {
            // Range selection
            const lastIdx = torrents.findIndex((t) => t.id === selectedId);
            const curIdx = torrents.findIndex((t) => t.id === clickedId);
            if (lastIdx !== -1 && curIdx !== -1) {
              const minIdx = Math.min(lastIdx, curIdx);
              const maxIdx = Math.max(lastIdx, curIdx);
              const rangeIds = torrents.slice(minIdx, maxIdx + 1).map((t) => t.id);
              updateSelection(rangeIds, clickedId);
            } else {
              updateSelection([clickedId], clickedId);
            }
          } else {
            // Normal click: select clicked item exclusively
            updateSelection([clickedId], clickedId);
          }
        } else {
          // Clicked on empty table background: clear selection
          if (start.modifier === 'none') {
            updateSelection([]);
          }
        }
      }
    };

    window.addEventListener('mousemove', handleGlobalMouseMove);
    window.addEventListener('mouseup', handleGlobalMouseUp);
  };

  const targetTorrent = torrents.find((t) => t.id === contextMenu.torrentId);

  // Bulk action helpers
  const handleBulkResume = () => {
    selectedIds.forEach((id) => onResume(id));
    closeContextMenu();
  };

  const handleBulkPause = () => {
    selectedIds.forEach((id) => onPause(id));
    closeContextMenu();
  };

  const handleBulkForceRecheck = () => {
    selectedIds.forEach((id) => onForceRecheck(id));
    closeContextMenu();
  };

  const handleBulkDelete = () => {
    selectedIds.forEach((id) => onDelete(id));
    updateSelection([]);
    closeContextMenu();
  };

  const handleBulkSetPriority = (priority: Priority) => {
    selectedIds.forEach((id) => onSetPriority(id, priority));
    closeContextMenu();
  };

  return (
    <div
      ref={containerRef}
      onMouseDown={handleMouseDown}
      onContextMenu={(e) => {
        e.preventDefault();
        const target = e.target as HTMLElement | null;
        if (target?.closest('thead') || target?.closest('[data-qt-context-menu]')) return;
        const rowEl = target?.closest('tr[data-torrent-id]') as HTMLElement | null;
        const rowId = rowEl?.getAttribute('data-torrent-id');
        if (rowId) {
          handleContextMenu(e, rowId);
          return;
        }
        // If right-clicked in empty table space while transfers exist, open context menu for current selection (or first transfer)
        const fallbackId = selectedId || selectedIds[0] || torrents[0]?.id;
        if (fallbackId) {
          handleContextMenu(e, fallbackId);
        }
      }}
      className="flex-1 overflow-auto bg-[var(--os-bg-content)] text-[var(--os-text)] text-xs font-sans select-none relative transition-colors focus:outline-none"
      tabIndex={0}
    >
      {/* Draggable Selection Box (Rubberband / Marquee Rect) */}
      {marqueeBox && (
        <div
          style={{
            left: `${marqueeBox.left}px`,
            top: `${marqueeBox.top}px`,
            width: `${marqueeBox.width}px`,
            height: `${marqueeBox.height}px`,
            background: 'var(--os-marquee-bg)',
          }}
          className="absolute border border-[var(--os-accent)] pointer-events-none z-30 shadow-xs"
        />
      )}

      {(() => {
        const totalColumnsWidth = columnOrder.reduce((sum, id) => sum + colWidths[id], 0);

        return (
          <table
            className="w-full table-fixed border-collapse text-left"
            style={{ minWidth: `${totalColumnsWidth}px` }}
          >
            <colgroup>
              {columnOrder.map((colId) => (
                <col key={colId} style={{ width: `${colWidths[colId]}px` }} />
              ))}
              <col className="w-auto" />
            </colgroup>

            {/* Moveable & Resizeable Table Header */}
            <thead
              onContextMenu={(e) => {
                e.preventDefault();
                e.stopPropagation();
                closeContextMenu();
                setHeaderMenu({
                  visible: true,
                  x: Math.min(e.clientX, Math.max(8, window.innerWidth - 200)),
                  y: Math.min(e.clientY, Math.max(8, window.innerHeight - 60)),
                });
              }}
              className="sticky top-0 bg-[var(--os-bg-header)] border-b border-[var(--os-border)] text-[11px] font-semibold text-[var(--os-text)] z-10 select-none shadow-2xs"
            >
              <tr>
                {columnOrder.map((colId) => {
                  const def = COLUMN_DEFS[colId];
                  const isDragged = draggedColId === colId;
                  const isDropBefore = dropIndicator?.id === colId && dropIndicator.position === 'before';
                  const isDropAfter = dropIndicator?.id === colId && dropIndicator.position === 'after';

                  return (
                    <th
                      key={colId}
                      draggable={!resizingColId}
                      onDragStart={(e) => handleColumnDragStart(e, colId)}
                      onDragOver={(e) => handleColumnDragOver(e, colId)}
                      onDrop={(e) => handleColumnDrop(e, colId)}
                      onDragEnd={handleColumnDragEnd}
                      title="Drag header to reorder column • Drag right edge to resize"
                      className={`relative py-2 px-3 border-r border-[var(--os-border)] cursor-grab active:cursor-grabbing hover:bg-[var(--os-bg-hover)] transition-colors overflow-hidden ${
                        def.align === 'right' ? 'text-right' : 'text-left'
                      } ${isDragged ? 'opacity-50 bg-[var(--os-bg-selected-soft)]' : ''}`}
                    >
                      {isDropBefore && (
                        <div className="absolute left-0 top-0 bottom-0 w-0.5 bg-[var(--os-accent)] z-30 pointer-events-none" />
                      )}
                      {isDropAfter && (
                        <div className="absolute right-0 top-0 bottom-0 w-0.5 bg-[var(--os-accent)] z-30 pointer-events-none" />
                      )}

                      <span className="block truncate pr-1">{def.label}</span>

                      {/* Right-Edge Column Resize Handle */}
                      <div
                        data-col-resizer="true"
                        draggable={false}
                        onDragStart={(e) => e.preventDefault()}
                        onMouseDown={(e) => handleColumnResizeMouseDown(e, colId)}
                        onDoubleClick={(e) => {
                          e.stopPropagation();
                          setColWidths((prev) => ({ ...prev, [colId]: def.defaultWidth }));
                        }}
                        title="Drag to resize column (Double-click to reset width)"
                        className="absolute top-0 right-0 bottom-0 w-2 cursor-col-resize z-20 group/resizer flex items-center justify-end"
                      >
                        <div
                          className={`w-[2px] h-3/5 rounded-full transition-colors ${
                            resizingColId === colId
                              ? 'bg-[var(--os-accent)]'
                              : 'bg-transparent group-hover/resizer:bg-[var(--os-accent)]'
                          }`}
                        />
                      </div>
                    </th>
                  );
                })}
                {/* Trailing filler cell so header background spans full table width */}
                <th className="p-0" />
              </tr>
            </thead>

            {/* Table Body */}
            <tbody className="divide-y divide-[var(--os-border-subtle)]">
              {torrents.length === 0 ? (
                <tr>
                  <td colSpan={columnOrder.length + 1} className="py-12 text-center text-[var(--os-text-muted)]">
                    <div className="flex flex-col items-center gap-2">
                      <Download className="w-8 h-8 text-[var(--os-accent)] opacity-60" />
                      <p className="text-sm font-medium text-[var(--os-text)]">No transfers in this view</p>
                      <p className="text-xs text-[var(--os-text-muted)]">
                        Add a .torrent, magnet link, or HTTP download URL from the toolbar
                      </p>
                    </div>
                  </td>
                </tr>
              ) : (
                torrents.map((tor, idx) => (
                  <TransferTableRow
                    key={tor.id}
                    torrent={tor}
                    isSelected={selectedIds.includes(tor.id)}
                    isEven={idx % 2 === 0}
                    compactDensity={compactDensity}
                    columnOrder={columnOrder}
                    onRowRef={handleRowRef}
                    onContextMenu={handleContextMenu}
                    onDoubleClick={handleRowDoubleClick}
                  />
                ))
              )}
            </tbody>
          </table>
        );
      })()}

      {/* Subtle Desktop Marquee / Multi-select helper tag */}
      {selectedIds.length > 1 && (
        <div className="fixed bottom-9 right-4 z-40 bg-[var(--os-bg-content)] text-[var(--os-text)] text-[10px] font-mono px-2.5 py-1 rounded shadow-lg border border-[var(--os-accent)] flex items-center gap-2 pointer-events-none animate-in fade-in">
          <CheckSquare className="w-3 h-3 text-[var(--os-accent)]" />
          <span>{selectedIds.length} transfers selected</span>
          <span className="text-[var(--os-text-muted)]">| Esc to clear</span>
        </div>
      )}

      {/* Classic Qt Context Menu (Pure One-Click Options) */}
      {contextMenu.visible && targetTorrent && (
        <div
          data-qt-context-menu="true"
          style={{ top: contextMenu.y, left: contextMenu.x }}
          className="fixed w-60 bg-[var(--os-bg-content)] border border-[var(--os-border)] rounded shadow-2xl py-1 text-xs text-[var(--os-text)] z-50 select-none animate-in fade-in-50 zoom-in-95 duration-100"
        >
          {/* Stop (when downloading) or Resume (when paused/stopped) */}
          {targetTorrent.status === 'downloading' ||
          targetTorrent.status === 'stealth_active' ||
          targetTorrent.status === 'throttled' ||
          targetTorrent.status === 'checking' ? (
            <button
              onMouseEnter={() => setOpenSubmenu(null)}
              onClick={
                contextMenu.isMulti
                  ? () => {
                      selectedIds.forEach((id) => (onStop ? onStop(id) : onPause(id)));
                      closeContextMenu();
                    }
                  : () => {
                      if (onStop) onStop(targetTorrent.id);
                      else onPause(targetTorrent.id);
                      closeContextMenu();
                    }
              }
              className="w-full flex items-center gap-2.5 px-3 py-1.5 hover:bg-[var(--os-accent)] hover:text-white text-left transition-colors group"
            >
              <Square className="w-3.5 h-3.5 text-rose-600 dark:text-rose-400 group-hover:text-white fill-rose-500/20" />
              <span>{contextMenu.isMulti ? `Stop (${selectedIds.length})` : 'Stop'}</span>
            </button>
          ) : (
            <button
              onMouseEnter={() => setOpenSubmenu(null)}
              onClick={
                contextMenu.isMulti
                  ? handleBulkResume
                  : () => {
                      onResume(targetTorrent.id);
                      closeContextMenu();
                    }
              }
              className="w-full flex items-center gap-2.5 px-3 py-1.5 hover:bg-[var(--os-accent)] hover:text-white text-left transition-colors group"
            >
              <Play className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 group-hover:text-white" />
              <span>{contextMenu.isMulti ? `Resume (${selectedIds.length})` : 'Resume'}</span>
            </button>
          )}

          {/* Pause */}
          <button
            onMouseEnter={() => setOpenSubmenu(null)}
            onClick={
              contextMenu.isMulti
                ? handleBulkPause
                : () => {
                    onPause(targetTorrent.id);
                    closeContextMenu();
                  }
            }
            className="w-full flex items-center gap-2.5 px-3 py-1.5 hover:bg-[var(--os-accent)] hover:text-white text-left transition-colors group"
          >
            <Pause className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400 group-hover:text-white" />
            <span>{contextMenu.isMulti ? `Pause (${selectedIds.length})` : 'Pause'}</span>
          </button>

          {/* Force Recheck */}
          <button
            onMouseEnter={() => setOpenSubmenu(null)}
            onClick={
              contextMenu.isMulti
                ? handleBulkForceRecheck
                : () => {
                    onForceRecheck(targetTorrent.id);
                    closeContextMenu();
                  }
            }
            className="w-full flex items-center justify-between px-3 py-1.5 hover:bg-[var(--os-accent)] hover:text-white text-left transition-colors group"
          >
            <span className="flex items-center gap-2.5">
              <RefreshCw className="w-3.5 h-3.5 text-[var(--os-accent)] group-hover:text-white" />
              <span>{contextMenu.isMulti ? `Force Recheck (${selectedIds.length})` : 'Force Recheck'}</span>
            </span>
            <span className="text-[10px] font-mono text-[var(--os-text-muted)] group-hover:text-white/80">F5</span>
          </button>

          <div className="my-1 border-t border-[var(--os-border-subtle)]" />

          {/* Open File directly (when single file) */}
          {(!targetTorrent.files || targetTorrent.files.length <= 1) && !contextMenu.isMulti && (
            <button
              onMouseEnter={() => setOpenSubmenu(null)}
              onClick={() => {
                if (onOpenItem) onOpenItem(targetTorrent.id);
                closeContextMenu();
              }}
              className="w-full flex items-center gap-2.5 px-3 py-1.5 hover:bg-[var(--os-accent)] hover:text-white text-left transition-colors group"
            >
              <FileText className="w-3.5 h-3.5 text-sky-500 dark:text-sky-400 group-hover:text-white" />
              <span>Open file</span>
            </button>
          )}

          {/* Open Destination Folder */}
          <button
            onMouseEnter={() => setOpenSubmenu(null)}
            onClick={() => {
              if (onOpenFolder) onOpenFolder(targetTorrent.id);
              closeContextMenu();
            }}
            className="w-full flex items-center gap-2.5 px-3 py-1.5 hover:bg-[var(--os-accent)] hover:text-white text-left transition-colors group"
          >
            <FolderOpen className="w-3.5 h-3.5 text-amber-500 dark:text-amber-400 group-hover:text-white" />
            <span>Open destination folder</span>
          </button>

          {/* Rename */}
          <button
            disabled={contextMenu.isMulti}
            onMouseEnter={() => setOpenSubmenu(null)}
            onClick={() => {
              if (!contextMenu.isMulti && onRequestRename) onRequestRename(targetTorrent.id);
              closeContextMenu();
            }}
            className="w-full flex items-center justify-between px-3 py-1.5 hover:bg-[var(--os-accent)] hover:text-white disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-inherit text-left transition-colors group"
          >
            <span className="flex items-center gap-2.5">
              <Pencil className="w-3.5 h-3.5 text-[var(--os-accent)] group-hover:text-white" />
              <span>Rename...</span>
            </span>
            <span className="text-[10px] font-mono text-[var(--os-text-muted)] group-hover:text-white/80">F2</span>
          </button>

          <div className="my-1 border-t border-[var(--os-border-subtle)]" />

          {/* Copy Name */}
          <button
            onMouseEnter={() => setOpenSubmenu(null)}
            onClick={() => {
              const idsToCopy = contextMenu.isMulti ? selectedIds : [targetTorrent.id];
              if (onCopyName) onCopyName(idsToCopy);
              closeContextMenu();
            }}
            className="w-full flex items-center gap-2.5 px-3 py-1.5 hover:bg-[var(--os-accent)] hover:text-white text-left transition-colors group"
          >
            <Copy className="w-3.5 h-3.5 text-[var(--os-text-muted)] group-hover:text-white" />
            <span>{contextMenu.isMulti ? `Copy names (${selectedIds.length})` : 'Copy name'}</span>
          </button>

          {/* Copy Info Hash */}
          <button
            onMouseEnter={() => setOpenSubmenu(null)}
            onClick={() => {
              const idsToCopy = contextMenu.isMulti ? selectedIds : [targetTorrent.id];
              if (onCopyInfoHash) onCopyInfoHash(idsToCopy);
              closeContextMenu();
            }}
            className="w-full flex items-center gap-2.5 px-3 py-1.5 hover:bg-[var(--os-accent)] hover:text-white text-left transition-colors group"
          >
            <Hash className="w-3.5 h-3.5 text-[var(--os-text-muted)] group-hover:text-white" />
            <span>{contextMenu.isMulti ? `Copy info hashes (${selectedIds.length})` : 'Copy info hash'}</span>
          </button>

          {/* Copy Magnet Link */}
          <button
            onMouseEnter={() => setOpenSubmenu(null)}
            onClick={() => {
              const idsToCopy = contextMenu.isMulti ? selectedIds : [targetTorrent.id];
              if (onCopyMagnet) onCopyMagnet(idsToCopy);
              closeContextMenu();
            }}
            className="w-full flex items-center gap-2.5 px-3 py-1.5 hover:bg-[var(--os-accent)] hover:text-white text-left transition-colors group"
          >
            <Link className="w-3.5 h-3.5 text-[var(--os-accent)] group-hover:text-white" />
            <span>{contextMenu.isMulti ? `Copy magnet links (${selectedIds.length})` : 'Copy magnet link'}</span>
          </button>

          <div className="my-1 border-t border-[var(--os-border-subtle)]" />

          {/* Bandwidth Priority Flyout Submenu */}
          <div
            className="relative"
            onMouseEnter={() => setOpenSubmenu('priority')}
            onMouseLeave={() => setOpenSubmenu(null)}
          >
            <button
              type="button"
              onClick={() => setOpenSubmenu(openSubmenu === 'priority' ? null : 'priority')}
              className={`w-full flex items-center justify-between px-3 py-1.5 text-left transition-colors group ${
                openSubmenu === 'priority'
                  ? 'bg-[var(--os-accent)] text-white'
                  : 'hover:bg-[var(--os-accent)] hover:text-white'
              }`}
            >
              <span className="flex items-center gap-2.5">
                <Gauge className={`w-3.5 h-3.5 ${openSubmenu === 'priority' ? 'text-white' : 'text-[var(--os-accent)] group-hover:text-white'}`} />
                <span>Bandwidth Allocation</span>
              </span>
              <ChevronRight className={`w-3.5 h-3.5 ${openSubmenu === 'priority' ? 'text-white' : 'text-[var(--os-text-muted)] group-hover:text-white'}`} />
            </button>

            {openSubmenu === 'priority' && (
              <div
                data-qt-context-menu="true"
                className={`absolute top-0 w-36 bg-[var(--os-bg-content)] border border-[var(--os-border)] rounded shadow-2xl py-1 z-50 ${
                  contextMenu.x + 240 + 148 > (typeof window !== 'undefined' ? window.innerWidth : 1280)
                    ? 'right-full mr-0.5'
                    : 'left-full ml-0.5'
                }`}
              >
                {(['Max', 'High', 'Normal', 'Low'] as Priority[]).map((p) => {
                  const isCurrent = !contextMenu.isMulti && targetTorrent.priority === p;
                  return (
                    <button
                      key={p}
                      onClick={() => {
                        if (contextMenu.isMulti) {
                          handleBulkSetPriority(p);
                        } else {
                          onSetPriority(targetTorrent.id, p);
                          closeContextMenu();
                        }
                      }}
                      className="w-full flex items-center justify-between px-3 py-1.5 hover:bg-[var(--os-accent)] hover:text-white text-left transition-colors group"
                    >
                      <span>{p}</span>
                      {isCurrent && (
                        <Check className="w-3.5 h-3.5 text-[var(--os-accent)] group-hover:text-white" />
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Properties / Download Info */}
          <button
            onMouseEnter={() => setOpenSubmenu(null)}
            onClick={() => {
              if (onOpenDownloadInfo) onOpenDownloadInfo(targetTorrent.id);
              closeContextMenu();
            }}
            className="w-full flex items-center justify-between px-3 py-1.5 hover:bg-[var(--os-accent)] hover:text-white text-left transition-colors group"
          >
            <span className="flex items-center gap-2.5">
              <Info className="w-3.5 h-3.5 text-[var(--os-accent)] group-hover:text-white" />
              <span>Download Info...</span>
            </span>
            <span className="text-[10px] font-mono text-[var(--os-text-muted)] group-hover:text-white/80">Enter</span>
          </button>

          <div className="my-1 border-t border-[var(--os-border-subtle)]" />

          {/* Remove */}
          <button
            onMouseEnter={() => setOpenSubmenu(null)}
            onClick={
              contextMenu.isMulti
                ? handleBulkDelete
                : () => {
                    onDelete(targetTorrent.id);
                    closeContextMenu();
                  }
            }
            className="w-full flex items-center gap-2.5 px-3 py-1.5 hover:bg-rose-600 hover:text-white text-rose-600 dark:text-rose-400 text-left transition-colors group"
          >
            <Trash2 className="w-3.5 h-3.5 group-hover:text-white" />
            <span>{contextMenu.isMulti ? `Remove (${selectedIds.length})` : 'Remove'}</span>
          </button>
        </div>
      )}
      {/* Header Context Menu (Reset Columns) */}
      {headerMenu.visible && (
        <div
          data-qt-context-menu="true"
          style={{ top: headerMenu.y, left: headerMenu.x }}
          className="fixed w-48 bg-[var(--os-bg-content)] border border-[var(--os-border)] rounded shadow-2xl py-1 text-xs text-[var(--os-text)] z-50 select-none animate-in fade-in-50 zoom-in-95 duration-100"
        >
          <button
            onClick={handleResetColumns}
            className="w-full flex items-center gap-2.5 px-3 py-1.5 hover:bg-[var(--os-accent)] hover:text-white text-left transition-colors group"
          >
            <RefreshCw className="w-3.5 h-3.5 text-[var(--os-accent)] group-hover:text-white" />
            <span>Reset columns layout</span>
          </button>
        </div>
      )}
    </div>
  );
};
