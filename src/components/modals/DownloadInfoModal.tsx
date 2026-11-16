import React, { useState, useRef, useEffect } from 'react';
import { 
  Monitor, Volume2, Folder
} from 'lucide-react';
import { TorrentItem } from '../../types';
import { SubwindowHeader } from './SubwindowHeader';

interface DownloadInfoModalProps {
  torrent: TorrentItem | null;
  isOpen: boolean;
  onClose: () => void;
  onResume: (id: string) => void;
  onPause: (id: string) => void;
  onCancel?: (id: string) => void;
  onSetSpeedLimit?: (id: string, limitKb: number) => void;
  onMinimize?: () => void;
  onSaveCompletionOptions?: (id: string, options: NonNullable<TorrentItem['completionOptions']>) => void;
}

export function formatIdmBytes(bytes: number): string {
  if (bytes === 0) return '0.000 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  if (i < 0) return `${bytes} B`;
  const val = (bytes / Math.pow(k, i)).toFixed(3);
  return `${val} ${sizes[i]}`;
}

export function formatIdmRate(bytesPerSec: number): string {
  if (!bytesPerSec || bytesPerSec <= 0) return '0.000 B/sec';
  const k = 1024;
  const sizes = ['B/sec', 'KB/sec', 'MB/sec', 'GB/sec'];
  const i = Math.floor(Math.log(bytesPerSec) / Math.log(k));
  if (i < 0) return `${Math.round(bytesPerSec)} B/sec`;
  const val = (bytesPerSec / Math.pow(k, i)).toFixed(3);
  return `${val} ${sizes[i]}`;
}

export function formatIdmTime(etaStr: string, remainingBytes: number, speed: number): string {
  if (speed <= 0 || remainingBytes <= 0) return etaStr || 'Unknown';
  const seconds = Math.round(remainingBytes / speed);
  if (seconds < 60) return `${seconds} sec`;
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  if (mins < 60) return `${mins} min ${secs} sec`;
  const hours = Math.floor(mins / 60);
  const remMins = mins % 60;
  return `${hours} hr ${remMins} min`;
}

export const DownloadInfoModal: React.FC<DownloadInfoModalProps> = ({
  torrent,
  isOpen,
  onClose,
  onResume,
  onPause,
  onCancel,
  onSetSpeedLimit,
  onMinimize,
  onSaveCompletionOptions,
}) => {
  const [activeTab, setActiveTab] = useState<'status' | 'limiter' | 'completion'>('status');
  const [showDetails, setShowDetails] = useState<boolean>(true);
  const [isMaximized, setIsMaximized] = useState<boolean>(false);

  // Speed Limiter Tab state
  const [useSpeedLimiter, setUseSpeedLimiter] = useState(false);
  const [speedLimitValue, setSpeedLimitValue] = useState('2048');

  // Options on Completion Tab state
  const [exitOnComplete, setExitOnComplete] = useState(false);
  const [shutdownOnComplete, setShutdownOnComplete] = useState(false);
  const [playSoundOnComplete, setPlaySoundOnComplete] = useState(true);
  const [openFileOnComplete, setOpenFileOnComplete] = useState(false);
  const [openFolderOnComplete, setOpenFolderOnComplete] = useState(true);

  // Draggable window state
  const [position, setPosition] = useState<{ x: number; y: number } | null>(null);
  const isDraggingRef = useRef(false);
  const dragOffsetRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const modalRef = useRef<HTMLDivElement>(null);

  // Hydrate limiter & completion state when modal opens or torrent switches
  useEffect(() => {
    if (!isOpen || !torrent) return;
    const hasLimit = Boolean(torrent.perTransferLimitKbps && torrent.perTransferLimitKbps > 0);
    setUseSpeedLimiter(hasLimit);
    setSpeedLimitValue(hasLimit ? String(torrent.perTransferLimitKbps) : '2048');

    const opts = torrent.completionOptions;
    setExitOnComplete(opts?.exitOnComplete ?? false);
    setShutdownOnComplete(opts?.shutdownOnComplete ?? false);
    setPlaySoundOnComplete(opts?.playSoundOnComplete ?? true);
    setOpenFileOnComplete(opts?.openFileOnComplete ?? false);
    setOpenFolderOnComplete(opts?.openFolderOnComplete ?? true);
  }, [isOpen, torrent?.id]);

  // Center window on initial open
  useEffect(() => {
    if (isOpen && !position) {
      const w = isMaximized ? Math.min(820, window.innerWidth - 40) : 580;
      const h = showDetails ? 530 : 310;
      const startX = Math.max(20, Math.round((window.innerWidth - w) / 2));
      const startY = Math.max(30, Math.round((window.innerHeight - h) / 2));
      setPosition({ x: startX, y: startY });
    }
  }, [isOpen, showDetails, isMaximized, position]);

  if (!isOpen || !torrent) return null;

  const updateCompletionOption = (patch: Partial<NonNullable<TorrentItem['completionOptions']>>) => {
    const next = {
      exitOnComplete,
      shutdownOnComplete,
      playSoundOnComplete,
      openFileOnComplete,
      openFolderOnComplete,
      ...patch,
    };
    if ('exitOnComplete' in patch) setExitOnComplete(next.exitOnComplete);
    if ('shutdownOnComplete' in patch) setShutdownOnComplete(next.shutdownOnComplete);
    if ('playSoundOnComplete' in patch) setPlaySoundOnComplete(next.playSoundOnComplete);
    if ('openFileOnComplete' in patch) setOpenFileOnComplete(next.openFileOnComplete);
    if ('openFolderOnComplete' in patch) setOpenFolderOnComplete(next.openFolderOnComplete);
    onSaveCompletionOptions?.(torrent.id, next);
  };

  const isPaused = torrent.status === 'paused';
  const isCompleted = torrent.progress >= 100;
  const remainingBytes = Math.max(0, torrent.size - torrent.downloaded);

  // Generate 8 multi-threaded connection lines (matching IDM standard)
  const connectionCount = 8;
  const segmentSize = torrent.size / connectionCount;
  
  // Synthesize connection segments with real-time byte breakdown
  const connections = Array.from({ length: connectionCount }, (_, i) => {
    // If real HTTP segments exist, use them
    if (torrent.segments && torrent.segments[i]) {
      const seg = torrent.segments[i];
      const span = Math.max(1, seg.endByte - seg.startByte);
      const frac = Math.min(1, seg.downloadedBytes / span);
      return {
        id: i + 1,
        downloaded: seg.downloadedBytes,
        fraction: frac,
        info: seg.status === 'completed' 
          ? 'Complete' 
          : isPaused 
          ? 'Paused' 
          : seg.downloadedBytes > 0 
          ? 'Receiving data...' 
          : 'Connecting...',
      };
    }

    // Otherwise compute proportional slice for BitTorrent/HTTP transfer
    const segStart = i * segmentSize;
    const segEnd = (i + 1) * segmentSize;
    const downloadedForThisSeg = Math.max(
      0,
      Math.min(segmentSize, torrent.downloaded - segStart)
    );
    const frac = Math.max(0, Math.min(1, downloadedForThisSeg / segmentSize));
    
    let info = 'Receiving data...';
    if (isCompleted || frac >= 0.999) {
      info = 'Complete';
    } else if (isPaused) {
      info = 'Paused';
    } else if (torrent.downloadSpeed === 0) {
      info = 'Connecting...';
    }

    return {
      id: i + 1,
      downloaded: downloadedForThisSeg,
      fraction: frac,
      info,
    };
  });

  // Drag handlers
  const handleTitleMouseDown = (e: React.MouseEvent) => {
    // Ignore clicks on control buttons
    if ((e.target as HTMLElement).closest('button')) return;
    e.preventDefault();
    isDraggingRef.current = true;
    dragOffsetRef.current = {
      x: e.clientX - (position?.x || 0),
      y: e.clientY - (position?.y || 0),
    };

    const handleMouseMove = (moveEvent: MouseEvent) => {
      if (!isDraggingRef.current) return;
      const newX = Math.max(10, Math.min(window.innerWidth - 300, moveEvent.clientX - dragOffsetRef.current.x));
      const newY = Math.max(10, Math.min(window.innerHeight - 150, moveEvent.clientY - dragOffsetRef.current.y));
      setPosition({ x: newX, y: newY });
    };

    const handleMouseUp = () => {
      isDraggingRef.current = false;
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  };

  const handleApplySpeedLimit = (val: string) => {
    setSpeedLimitValue(val);
    if (onSetSpeedLimit) {
      const kb = parseInt(val, 10) || 0;
      onSetSpeedLimit(torrent.id, kb);
    }
  };

  // Derive source URL / Announce
  const sourceUrl = torrent.httpUrl || 
    (torrent.isHttpSegmented 
      ? `http://downloads.example/gen/6G/${encodeURIComponent(torrent.name)}?rate=256K`
      : `magnet:?xt=urn:btih:${torrent.hash}&dn=${encodeURIComponent(torrent.name)}`);

  return (
    <div className="fixed inset-0 z-50 pointer-events-auto select-none bg-black/40 backdrop-blur-2xs flex items-center justify-center">
      {/* Transfer Status Window */}
      <div
        ref={modalRef}
        style={{
          position: isMaximized ? 'relative' : position ? 'fixed' : 'relative',
          left: !isMaximized && position ? `${position.x}px` : undefined,
          top: !isMaximized && position ? `${position.y}px` : undefined,
          width: isMaximized ? `${Math.min(820, typeof window !== 'undefined' ? window.innerWidth - 40 : 820)}px` : '580px',
        }}
        className="bg-[var(--os-bg-window)] text-[var(--os-text)] font-sans text-xs border border-[var(--os-border)] rounded-xs shadow-[0_12px_45px_rgba(0,0,0,0.45)] flex flex-col overflow-hidden animate-in fade-in-80 zoom-in-95 duration-100"
      >
        {/* Title Bar (Subwindow: Only red close light on macOS left; only close button on Linux/Windows right) */}
        <SubwindowHeader
          onMouseDown={handleTitleMouseDown}
          onClose={onClose}
          icon={
            <div className="w-3.5 h-3.5 rounded-full bg-[var(--os-accent)] flex items-center justify-center shadow-xs shrink-0">
              <div className="w-1.5 h-1.5 rounded-full bg-white" />
            </div>
          }
          title={
            <span className="font-mono text-xs text-[var(--os-text)] font-medium">
              {Math.floor(torrent.progress)}% {torrent.name}
            </span>
          }
        />

        {/* Tab Strip */}
        <div className="px-3 pt-2 bg-[var(--os-bg-window)] flex items-center space-x-1 border-b border-[var(--os-border)]">
          <button
            onClick={() => setActiveTab('status')}
            className={`px-3 py-1 text-[11px] font-medium border-t border-x rounded-t transition-colors ${
              activeTab === 'status'
                ? 'bg-[var(--os-bg-content)] text-[var(--os-text)] border-[var(--os-border)] -mb-[1px] font-semibold border-b-transparent z-10'
                : 'text-[var(--os-text-muted)] hover:text-[var(--os-text)] border-transparent hover:bg-[var(--os-bg-hover)]'
            }`}
          >
            Download status
          </button>
          <button
            onClick={() => setActiveTab('limiter')}
            className={`px-3 py-1 text-[11px] font-medium border-t border-x rounded-t transition-colors ${
              activeTab === 'limiter'
                ? 'bg-[var(--os-bg-content)] text-[var(--os-text)] border-[var(--os-border)] -mb-[1px] font-semibold border-b-transparent z-10'
                : 'text-[var(--os-text-muted)] hover:text-[var(--os-text)] border-transparent hover:bg-[var(--os-bg-hover)]'
            }`}
          >
            Speed Limiter
          </button>
          <button
            onClick={() => setActiveTab('completion')}
            className={`px-3 py-1 text-[11px] font-medium border-t border-x rounded-t transition-colors ${
              activeTab === 'completion'
                ? 'bg-[var(--os-bg-content)] text-[var(--os-text)] border-[var(--os-border)] -mb-[1px] font-semibold border-b-transparent z-10'
                : 'text-[var(--os-text-muted)] hover:text-[var(--os-text)] border-transparent hover:bg-[var(--os-bg-hover)]'
            }`}
          >
            Options on completion
          </button>
        </div>

        {/* Tab Body */}
        <div className="p-3 bg-[var(--os-bg-window)] flex flex-col space-y-3">
          {/* 1. Download Status Tab */}
          {activeTab === 'status' && (
            <>
              {/* Top Details Panel */}
              <div className="p-2.5 bg-[var(--os-bg-content)] border border-[var(--os-border)] rounded-xs font-sans text-xs space-y-1.5">
                {/* Source URL / Resource */}
                <div className="truncate text-[var(--os-text)] font-mono text-[11px] select-all pb-1 border-b border-[var(--os-border-subtle)]" title={sourceUrl}>
                  {sourceUrl}
                </div>

                {/* 2-Column Property Grid */}
                <div className="grid grid-cols-[130px_1fr] gap-y-1 text-[11px] font-sans">
                  <span className="text-[var(--os-text-muted)]">Status</span>
                  <span className="text-[var(--os-text)] font-medium flex items-center gap-1.5">
                    {isCompleted ? (
                      <span className="text-emerald-600 dark:text-emerald-400 font-semibold">Completed (100%)</span>
                    ) : isPaused ? (
                      <span className="text-amber-600 dark:text-amber-400 font-semibold">Paused</span>
                    ) : torrent.status === 'throttled' ? (
                      <span className="text-rose-600 dark:text-rose-400 font-semibold">Throttled by ISP</span>
                    ) : (
                      <span className="text-emerald-600 dark:text-emerald-400">Receiving data...</span>
                    )}
                  </span>

                  <span className="text-[var(--os-text-muted)]">File size</span>
                  <span className="font-mono text-[var(--os-text)]">{formatIdmBytes(torrent.size)}</span>

                  <span className="text-[var(--os-text-muted)]">Downloaded</span>
                  <span className="font-mono text-[var(--os-text)]">
                    {formatIdmBytes(torrent.downloaded)} ( {torrent.progress.toFixed(2)} % )
                  </span>

                  <span className="text-[var(--os-text-muted)]">Transfer rate</span>
                  <span className="font-mono text-emerald-600 dark:text-emerald-400 font-bold">
                    {isPaused ? '0.000 B/sec' : formatIdmRate(torrent.downloadSpeed)}
                  </span>

                  <span className="text-[var(--os-text-muted)]">Time left</span>
                  <span className="font-mono text-[var(--os-text)]">
                    {isCompleted ? 'Done' : isPaused ? 'Paused' : formatIdmTime(torrent.eta, remainingBytes, torrent.downloadSpeed)}
                  </span>

                  <span className="text-[var(--os-text-muted)]">Resume capability</span>
                  <span className="text-emerald-600 dark:text-emerald-400 font-semibold">Yes</span>

                  <span className="text-[var(--os-text-muted)]">Server</span>
                  <span className="text-[var(--os-text)] flex items-center gap-1.5 font-sans">
                    <Monitor className="w-3.5 h-3.5 text-[var(--os-text-muted)] shrink-0" />
                    <span>this computer</span>
                    <span className="text-emerald-600 dark:text-emerald-400 text-[10px]">• about 1 ms (near)</span>
                  </span>
                </div>
              </div>

              {/* Primary Progress Bar */}
              <div className="w-full h-4 bg-[var(--os-bg-content)] rounded-xs border border-[var(--os-border)] overflow-hidden p-[1px]">
                <div
                  className="h-full bg-[var(--os-accent)] transition-all duration-300 rounded-2xs"
                  style={{ width: `${Math.min(100, Math.max(0, torrent.progress))}%` }}
                />
              </div>

              {/* Action Buttons Row */}
              <div className="flex items-center justify-between pt-0.5">
                <button
                  type="button"
                  onClick={() => setShowDetails(!showDetails)}
                  className="px-3 py-1 rounded-xs bg-[var(--os-bg-control)] hover:bg-[var(--os-bg-hover)] text-[var(--os-text)] border border-[var(--os-border)] shadow-2xs text-[11px] font-sans flex items-center gap-1 transition-colors"
                >
                  <span>{showDetails ? '<< Hide details' : '>> Details'}</span>
                </button>

                <div className="flex items-center space-x-2">
                  <button
                    type="button"
                    onClick={() => {
                      if (isPaused) onResume(torrent.id);
                      else onPause(torrent.id);
                    }}
                    className="min-w-20 px-4 py-1 rounded-xs bg-[var(--os-bg-control)] hover:bg-[var(--os-bg-hover)] text-[var(--os-text)] border border-[var(--os-border)] shadow-2xs text-[11px] font-sans font-medium transition-colors"
                  >
                    {isPaused ? 'Resume' : 'Pause'}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (onCancel) onCancel(torrent.id);
                      onClose();
                    }}
                    className="min-w-20 px-4 py-1 rounded-xs bg-[var(--os-bg-control)] hover:bg-[var(--os-bg-hover)] text-[var(--os-text)] border border-[var(--os-border)] shadow-2xs text-[11px] font-sans font-medium transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              </div>

              {/* Collapsible Lower Section: Segment visualizer & Connections Table */}
              {showDetails && (
                <div className="space-y-2 pt-1 animate-in fade-in duration-150">
                  <div className="text-[11px] text-[var(--os-text-muted)] text-center font-sans">
                    Start positions and download progress by connections
                  </div>

                  {/* Multi-Threaded Segment Visualizer Bar */}
                  <div className="w-full h-5 bg-[var(--os-bg-content)] border border-[var(--os-border)] rounded-xs relative flex overflow-hidden">
                    {connections.map((conn) => (
                      <div
                        key={conn.id}
                        className="relative h-full flex-1 border-l border-[var(--os-border)] first:border-l-0 overflow-hidden bg-[var(--os-bg-alt)]"
                        title={`Connection #${conn.id}: ${formatIdmBytes(conn.downloaded)} (${Math.round(conn.fraction * 100)}%)`}
                      >
                        <div
                          className="h-full bg-[var(--os-accent)] transition-all duration-300"
                          style={{ width: `${Math.round(conn.fraction * 100)}%` }}
                        />
                      </div>
                    ))}
                  </div>

                  {/* Connections Table */}
                  <div className="h-32 border border-[var(--os-border)] bg-[var(--os-bg-content)] overflow-y-auto rounded-xs font-mono text-xs">
                    <table className="w-full text-left border-collapse">
                      <thead className="sticky top-0 bg-[var(--os-bg-header)] border-b border-[var(--os-border)] text-[10px] text-[var(--os-text-muted)] font-sans font-semibold">
                        <tr>
                          <th className="py-1 px-2.5 w-10 border-r border-[var(--os-border-subtle)]">N.</th>
                          <th className="py-1 px-3 w-36 border-r border-[var(--os-border-subtle)]">Downloaded</th>
                          <th className="py-1 px-3">Info</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[var(--os-border-subtle)] text-[11px]">
                        {connections.map((conn) => (
                          <tr key={conn.id} className="hover:bg-[var(--os-bg-hover)]">
                            <td className="py-1 px-2.5 font-mono text-[var(--os-text)] border-r border-[var(--os-border-subtle)]">
                              {conn.id}
                            </td>
                            <td className="py-1 px-3 font-mono text-[var(--os-text)] border-r border-[var(--os-border-subtle)]">
                              {formatIdmBytes(conn.downloaded)}
                            </td>
                            <td className="py-1 px-3 font-sans text-[var(--os-text-muted)]">
                              {conn.info}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </>
          )}

          {/* 2. Speed Limiter Tab */}
          {activeTab === 'limiter' && (
            <div className="p-3 bg-[var(--os-bg-content)] border border-[var(--os-border)] rounded-xs space-y-4">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={useSpeedLimiter}
                  onChange={(e) => {
                    const enabled = e.target.checked;
                    setUseSpeedLimiter(enabled);
                    if (onSetSpeedLimit) {
                      const kb = enabled ? Math.max(1, parseInt(speedLimitValue, 10) || 2048) : 0;
                      onSetSpeedLimit(torrent.id, kb);
                    }
                  }}
                  className="rounded accent-[var(--os-accent)]"
                />
                <span className="font-semibold text-[var(--os-text)] text-xs">
                  Use Speed Limiter for this download
                </span>
              </label>

              <div className={`space-y-3 pl-6 transition-opacity ${useSpeedLimiter ? 'opacity-100' : 'opacity-40 pointer-events-none'}`}>
                <div>
                  <label className="block text-[11px] text-[var(--os-text-muted)] mb-1">
                    Maximum download speed (KB/s):
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      value={speedLimitValue}
                      onChange={(e) => handleApplySpeedLimit(e.target.value)}
                      min="1"
                      className="w-32 px-2.5 py-1 bg-[var(--os-bg-window)] border border-[var(--os-border)] rounded-xs text-[var(--os-text)] font-mono text-xs focus:outline-none focus:border-[var(--os-accent)]"
                    />
                    <span className="text-[var(--os-text-muted)] text-xs">KB/sec</span>
                  </div>
                </div>

                <div>
                  <div className="text-[11px] text-[var(--os-text-muted)] mb-1.5 font-medium">Quick Presets:</div>
                  <div className="flex flex-wrap gap-1.5">
                    {[
                      { label: '50 KB/s', val: '50' },
                      { label: '200 KB/s', val: '200' },
                      { label: '500 KB/s', val: '500' },
                      { label: '1 MB/s', val: '1024' },
                      { label: '2 MB/s', val: '2048' },
                      { label: '5 MB/s', val: '5120' },
                    ].map((p) => (
                      <button
                        key={p.val}
                        type="button"
                        onClick={() => handleApplySpeedLimit(p.val)}
                        className={`px-2.5 py-1 rounded-xs text-[10px] font-mono border transition-colors ${
                          speedLimitValue === p.val
                            ? 'bg-[var(--os-accent)] text-white border-[var(--os-accent)] font-bold'
                            : 'bg-[var(--os-bg-control)] text-[var(--os-text)] border-[var(--os-border)] hover:bg-[var(--os-bg-hover)]'
                        }`}
                      >
                        {p.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* 3. Options on Completion Tab */}
          {activeTab === 'completion' && (
            <div className="p-3 bg-[var(--os-bg-content)] border border-[var(--os-border)] rounded-xs space-y-3 font-sans text-xs">
              <div className="space-y-2">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={exitOnComplete}
                    onChange={(e) => updateCompletionOption({ exitOnComplete: e.target.checked })}
                    className="rounded accent-[var(--os-accent)]"
                  />
                  <span className="text-[var(--os-text)]">Exit FlowDown when done</span>
                </label>

                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={shutdownOnComplete}
                    onChange={(e) => updateCompletionOption({ shutdownOnComplete: e.target.checked })}
                    className="rounded accent-[var(--os-accent)]"
                  />
                  <span className="text-[var(--os-text)]">Turn off computer when done (Force shutdown)</span>
                </label>

                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={playSoundOnComplete}
                    onChange={(e) => updateCompletionOption({ playSoundOnComplete: e.target.checked })}
                    className="rounded accent-[var(--os-accent)]"
                  />
                  <span className="text-[var(--os-text)] flex items-center gap-1.5">
                    <Volume2 className="w-3.5 h-3.5 text-[var(--os-text-muted)]" />
                    <span>Play sound on completion</span>
                  </span>
                </label>

                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={openFileOnComplete}
                    onChange={(e) => updateCompletionOption({ openFileOnComplete: e.target.checked })}
                    className="rounded accent-[var(--os-accent)]"
                  />
                  <span className="text-[var(--os-text)]">Open file when download finishes</span>
                </label>

                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={openFolderOnComplete}
                    onChange={(e) => updateCompletionOption({ openFolderOnComplete: e.target.checked })}
                    className="rounded accent-[var(--os-accent)]"
                  />
                  <span className="text-[var(--os-text)] flex items-center gap-1.5">
                    <Folder className="w-3.5 h-3.5 text-amber-500" />
                    <span>Open destination folder when done</span>
                  </span>
                </label>
              </div>

              {/* Destination folder */}
              <div className="pt-2 border-t border-[var(--os-border-subtle)] text-[11px] flex justify-between items-center text-[var(--os-text-muted)]">
                <span>Save to:</span>
                <span className="font-mono text-[var(--os-text)] truncate max-w-[320px]" title={torrent.savePath}>
                  {torrent.savePath}
                </span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
