import React from 'react';
import { 
  Play, 
  Pause, 
  Trash2, 
  Film, 
  Music, 
  Code, 
  Archive, 
  FileText, 
  Image as ImageIcon, 
  File, 
  CheckCircle2, 
  Clock, 
  FolderOpen,
  Maximize2,
  Radio,
  ShieldCheck,
  Users,
  ExternalLink
} from 'lucide-react';
import { DownloadItem, FileType } from '../types';
import { formatBytes, formatSpeed, formatEta, getFileTypeBadgeColor } from '../utils/formatters';

interface DownloadItemRowProps {
  item: DownloadItem;
  isSelected?: boolean;
  onToggleSelect?: (id: string, e: React.MouseEvent) => void;
  onTogglePause: (id: string) => void;
  onDelete: (id: string) => void;
  onInspect: (item: DownloadItem) => void;
  onOpenLocation: (item: DownloadItem) => void;
  onOpenFile: (item: DownloadItem) => void;
  onContextMenu: (e: React.MouseEvent, item: DownloadItem) => void;
  onNotCompletedDoubleClick: (item: DownloadItem) => void;
}

export const DownloadItemRow: React.FC<DownloadItemRowProps> = ({
  item,
  isSelected = false,
  onToggleSelect,
  onTogglePause,
  onDelete,
  onInspect,
  onOpenLocation,
  onOpenFile,
  onContextMenu,
  onNotCompletedDoubleClick,
}) => {
  const percent = item.size > 0
    ? Math.min(100, (item.downloaded / item.size) * 100)
    : (item.status === 'completed' ? 100 : 0);
  const displayedPercent = percent >= 100
    ? 100
    : percent >= 10
      ? Number(percent.toFixed(1))
      : Number(percent.toFixed(2));
  const barPercent = percent > 0 && percent < 0.2 ? 0.2 : percent;
  const etaSeconds = item.speed > 0 ? (item.size - item.downloaded) / item.speed : 0;
  const badgeStyle = getFileTypeBadgeColor(item.fileType);

  const getIcon = (type: FileType) => {
    switch (type) {
      case 'torrent': return Radio;
      case 'video': return Film;
      case 'audio': return Music;
      case 'software': return Code;
      case 'archive': return Archive;
      case 'document': return FileText;
      case 'image': return ImageIcon;
      default: return File;
    }
  };

  const IconComponent = getIcon(item.fileType);

  return (
    <div 
      data-download-id={item.id}
      onContextMenu={(e) => onContextMenu(e, item)}
      onDoubleClick={() => {
        if (item.status === 'completed') {
          onOpenFile(item);
        } else {
          onNotCompletedDoubleClick(item);
        }
      }}
      className={`group bg-white dark:bg-slate-900 hover:bg-slate-50/90 dark:hover:bg-slate-800/80 border ${
        isSelected
          ? 'border-blue-500 dark:border-blue-500 bg-blue-50/40 dark:bg-blue-950/40 ring-1 ring-blue-500/40 shadow-sm'
          : 'border-slate-200/90 dark:border-slate-800'
      } rounded-xl p-5 shadow-xs hover:shadow-md transition-all duration-150 space-y-3.5 cursor-pointer relative select-none`}
      title="Right-click for options, double-click to open completed file, click the checkbox to select"
    >
      {/* Top Row: File Checkbox, Name, Badge, Torrent Tags, Actions */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start space-x-3.5 min-w-0">
          {/* Item Selection Checkbox */}
          <div className="pt-1 pr-0.5 shrink-0">
            <button
              type="button"
              data-checkbox="true"
              onClick={(e) => {
                e.stopPropagation();
                onToggleSelect && onToggleSelect(item.id, e);
              }}
              className={`w-5 h-5 rounded-md border flex items-center justify-center transition-colors cursor-pointer ${
                isSelected
                  ? 'bg-blue-600 border-blue-600 text-white'
                  : 'bg-white dark:bg-slate-800 border-slate-300 dark:border-slate-700 hover:border-blue-400 dark:hover:border-blue-500'
              }`}
              title="Select transfer"
            >
              {isSelected && <CheckCircle2 className="h-3.5 w-3.5 text-white stroke-[3]" />}
            </button>
          </div>

          {/* File Type Icon */}
          <div className={`w-11 h-11 rounded-lg ${badgeStyle.iconBg} flex items-center justify-center font-bold shrink-0 text-xs shadow-2xs`}>
            <IconComponent className="h-5 w-5" />
          </div>

          <div className="min-w-0">
            <div className="flex items-center space-x-2 flex-wrap gap-y-1">
              <h3 className="text-sm font-bold text-slate-900 dark:text-white truncate max-w-md group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors">
                {item.name}
              </h3>

              <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-md ${badgeStyle.bg} ${badgeStyle.text} border ${badgeStyle.border}`}>
                {item.category}
              </span>

              {item.isTorrent && (
                <span className="flex items-center space-x-1 text-[10px] font-bold text-teal-700 dark:text-teal-300 bg-teal-50 dark:bg-teal-950/80 border border-teal-200 dark:border-teal-800 px-2 py-0.5 rounded-md">
                  <ShieldCheck className="h-3 w-3 text-teal-600 dark:text-teal-400" />
                  <span>librqbit Stealth</span>
                </span>
              )}

              {item.status === 'completed' && (
                <span className="flex items-center space-x-1 text-[10px] font-semibold text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/80 border border-emerald-200 dark:border-emerald-800 px-2 py-0.5 rounded-md">
                  <CheckCircle2 className="h-3 w-3" />
                  <span>Finished</span>
                </span>
              )}

              {item.status === 'paused' && (
                <span className="flex items-center space-x-1 text-[10px] font-semibold text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/80 border border-amber-200 dark:border-amber-800 px-2 py-0.5 rounded-md">
                  <Pause className="h-3 w-3" />
                  <span>Paused</span>
                </span>
              )}

              {item.status === 'queued' && (
                <span className="flex items-center space-x-1 text-[10px] font-semibold text-purple-700 dark:text-purple-300 bg-purple-50 dark:bg-purple-950/80 border border-purple-200 dark:border-purple-800 px-2 py-0.5 rounded-md">
                  <Clock className="h-3 w-3" />
                  <span>Queued</span>
                </span>
              )}
            </div>

            <div className="flex items-center space-x-3 text-xs text-slate-500 dark:text-slate-400 mt-1 flex-wrap">
              <span className="truncate max-w-xs text-slate-400 dark:text-slate-500 font-mono text-[11px]">
                {item.url}
              </span>
              <span>•</span>
              <button 
                onClick={(e) => {
                  e.stopPropagation();
                  onOpenLocation(item);
                }}
                className="flex items-center space-x-1 text-slate-500 hover:text-blue-600 dark:hover:text-blue-400 transition-colors text-[11px]"
                title="Open download folder in the OS file manager"
              >
                <FolderOpen className="h-3 w-3 text-blue-500" />
                <span className="font-mono text-slate-600 dark:text-slate-300">{item.savePath}</span>
              </button>

              {item.isTorrent && item.seeders !== undefined && (
                <>
                  <span>•</span>
                  <span className="flex items-center space-x-1 text-[11px] font-mono text-slate-500 dark:text-slate-400">
                    <Users className="h-3 w-3 text-teal-500" />
                    <span>S: <strong className="text-emerald-600 dark:text-emerald-400">{item.seeders}</strong> / L: <strong className="text-amber-600 dark:text-amber-400">{item.leechers}</strong></span>
                  </span>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Action Controls */}
        <div className="flex items-center space-x-1 shrink-0" onClick={(e) => e.stopPropagation()}>
          <button
            onClick={() => onOpenLocation(item)}
            className="p-2 rounded-lg text-slate-400 hover:text-blue-600 dark:hover:text-blue-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors border border-transparent hover:border-slate-200 dark:hover:border-slate-700"
            title="Open download folder in the OS file manager"
          >
            <FolderOpen className="h-4 w-4" />
          </button>

          {item.status !== 'completed' && (
            <button
              onClick={() => onTogglePause(item.id)}
              className={`p-2 rounded-lg text-xs font-medium transition-colors border ${
                item.status === 'downloading'
                  ? 'bg-transparent hover:bg-amber-50 dark:hover:bg-amber-950/60 text-slate-500 hover:text-amber-700 dark:text-slate-400 dark:hover:text-amber-300 border-transparent hover:border-amber-200 dark:hover:border-amber-800'
                  : 'bg-emerald-50 hover:bg-emerald-100 dark:bg-emerald-950/60 dark:hover:bg-emerald-900/80 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800'
              }`}
              title={item.status === 'downloading' ? 'Pause download' : 'Resume download'}
            >
              {item.status === 'downloading' ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
            </button>
          )}

          <button
            onClick={() => onInspect(item)}
            className="p-2 rounded-lg text-slate-400 hover:text-blue-600 dark:hover:text-blue-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors border border-transparent hover:border-slate-200 dark:hover:border-slate-700"
            title="Inspect librqbit Engine Details & Pieces"
          >
            <Maximize2 className="h-4 w-4" />
          </button>

          <button
            onClick={() => onDelete(item.id)}
            className="p-2 rounded-lg text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/60 transition-colors border border-transparent hover:border-rose-100 dark:hover:border-rose-900"
            title="Remove transfer"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Progress Bar & Real-time Stats */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between text-xs font-mono">
          <div className="flex items-center space-x-2">
            <span className="font-bold text-slate-800 dark:text-slate-100">{displayedPercent}%</span>
            <span className="text-slate-500 dark:text-slate-400">
              ({formatBytes(item.downloaded)} of {formatBytes(item.size)})
            </span>
          </div>

          <div className="flex items-center space-x-4">
            {item.status === 'downloading' && (
              <>
                {item.preparing ? (
                  <span className="text-amber-600 dark:text-amber-400 font-semibold">
                    {item.preparingLabel || 'Preparing...'}
                  </span>
                ) : (
                  <>
                    <span className="text-blue-600 dark:text-blue-400 font-semibold font-mono">{formatSpeed(item.speed)}</span>
                    <span className="text-slate-400 dark:text-slate-500">ETA: {formatEta(etaSeconds)}</span>
                  </>
                )}
              </>
            )}
            {item.status === 'completed' && item.completedAt && (
              <span className="text-emerald-600 dark:text-emerald-400 font-medium text-[11px]">
                Done {new Date(item.completedAt).toLocaleTimeString()}
              </span>
            )}
          </div>
        </div>

        {/* Outer Bar */}
        <div className="w-full bg-slate-100 dark:bg-slate-800 h-2 rounded-full overflow-hidden relative">
          <div
            className={`h-full rounded-full transition-all duration-300 relative ${
              item.status === 'completed'
                ? 'bg-emerald-500 dark:bg-emerald-400'
                : item.status === 'paused'
                ? 'bg-amber-400'
                : item.isTorrent
                ? 'bg-teal-500 dark:bg-teal-400'
                : 'bg-blue-500 dark:bg-blue-400'
            }`}
            style={{ width: `${barPercent}%` }}
          />
        </div>
      </div>

      {/* Multi-thread Chunk / Peer Progress Map Preview */}
      <div className="pt-0.5 flex items-center justify-between">
        <div className="flex items-center space-x-1.5 w-full max-w-xl">
          <span className="text-[10px] text-slate-400 dark:text-slate-500 font-mono shrink-0">
            {item.isTorrent ? `librqbit ${item.connections} peers:` : `HTTP ${item.activeConnections ?? 1} active / auto:`}
          </span>
          <div className="flex space-x-1 w-full">
            {item.chunks.map((chunk) => (
              <div
                key={chunk.id}
                title={`Peer Chunk ${chunk.id + 1}: ${chunk.progress}%`}
                className="h-1.5 flex-1 bg-slate-100 dark:bg-slate-800 rounded-xs overflow-hidden border border-slate-200/60 dark:border-slate-700/60"
              >
                <div
                  className={`h-full transition-all duration-300 ${
                    item.status === 'completed'
                      ? 'bg-emerald-400'
                      : item.status === 'paused'
                      ? 'bg-amber-400'
                      : item.isTorrent
                      ? 'bg-teal-400'
                      : 'bg-blue-400'
                  }`}
                  style={{ width: `${chunk.progress}%` }}
                />
              </div>
            ))}
          </div>
        </div>

        <div className="flex items-center space-x-2 shrink-0 ml-2" onClick={(e) => e.stopPropagation()}>
          <span className="text-[9px] text-slate-400 dark:text-slate-500 font-medium italic hidden sm:inline">
            Double-click row to open path
          </span>
          <button
            onClick={() => onInspect(item)}
            className="text-[10px] font-bold text-blue-600 dark:text-blue-400 hover:text-blue-700 flex items-center space-x-1"
          >
            <span>Inspector</span>
          </button>
        </div>
      </div>
    </div>
  );
};

