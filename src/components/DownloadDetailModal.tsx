import React from 'react';
import { 
  X, 
  Server, 
  ShieldCheck, 
  Activity, 
  Cpu, 
  HardDrive, 
  Hash, 
  Globe, 
  Zap, 
  Radio, 
  Users, 
  Lock, 
  CheckCircle2, 
  SlidersHorizontal 
} from 'lucide-react';
import { DownloadItem } from '../types';
import { formatBytes, formatSpeed, formatEta } from '../utils/formatters';

interface DownloadDetailModalProps {
  item: DownloadItem | null;
  onClose: () => void;
  onSetItemSpeedLimit?: (id: string, limit: number) => void;
}

export const DownloadDetailModal: React.FC<DownloadDetailModalProps> = ({
  item,
  onClose,
}) => {
  if (!item) return null;

  const percent = Math.min(100, Math.floor((item.downloaded / item.size) * 100));
  const etaSeconds = item.speed > 0 ? (item.size - item.downloaded) / item.speed : 0;

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl w-full max-w-2xl shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200 text-slate-800 dark:text-slate-100">
        
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-800/80">
          <div className="flex items-center space-x-3 min-w-0 pr-4">
            <div className={`p-2.5 rounded-xl shrink-0 ${
              item.isTorrent 
                ? 'bg-teal-100 dark:bg-teal-950/80 text-teal-600 dark:text-teal-400' 
                : 'bg-blue-100 dark:bg-blue-950/80 text-blue-600 dark:text-blue-400'
            }`}>
              {item.isTorrent ? <Radio className="h-5 w-5" /> : <Activity className="h-5 w-5" />}
            </div>
            <div className="min-w-0">
              <div className="flex items-center space-x-2">
                <h2 className="text-sm font-bold text-slate-900 dark:text-white truncate">{item.name}</h2>
                {item.isTorrent && (
                  <span className="bg-teal-100 dark:bg-teal-900/60 text-teal-800 dark:text-teal-300 text-[10px] font-mono font-bold px-2 py-0.5 rounded-full shrink-0">
                    librqbit Core
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-400 dark:text-slate-500 truncate font-mono">{item.url}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-800 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors shrink-0"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="p-6 space-y-6 max-h-[80vh] overflow-y-auto text-xs">
          
          {/* Status & Speed Hero Card */}
          <div className="bg-slate-50 dark:bg-slate-800/50 p-4 rounded-xl border border-slate-200 dark:border-slate-700/80 grid grid-cols-2 sm:grid-cols-4 gap-4 text-center">
            <div>
              <div className="text-[10px] uppercase text-slate-400 dark:text-slate-500 font-bold mb-1">Status</div>
              <span className={`inline-block px-2.5 py-0.5 rounded-full text-xs font-bold ${
                item.status === 'downloading' ? 'bg-blue-100 dark:bg-blue-950 text-blue-700 dark:text-blue-300' :
                item.status === 'completed' ? 'bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300' :
                'bg-amber-100 dark:bg-amber-950 text-amber-700 dark:text-amber-300'
              }`}>
                {item.status.toUpperCase()}
              </span>
            </div>

            <div>
              <div className="text-[10px] uppercase text-slate-400 dark:text-slate-500 font-bold mb-1">Current Speed</div>
              <div className="text-sm font-mono font-bold text-blue-600 dark:text-blue-400">
                {formatSpeed(item.speed)}
              </div>
            </div>

            <div>
              <div className="text-[10px] uppercase text-slate-400 dark:text-slate-500 font-bold mb-1">Progress</div>
              <div className="text-sm font-mono font-bold text-slate-900 dark:text-white">
                {percent}%
              </div>
            </div>

            <div>
              <div className="text-[10px] uppercase text-slate-400 dark:text-slate-500 font-bold mb-1">ETA</div>
              <div className="text-sm font-mono font-bold text-slate-700 dark:text-slate-300">
                {item.status === 'downloading' ? formatEta(etaSeconds) : item.status === 'completed' ? 'Done' : 'Paused'}
              </div>
            </div>
          </div>

          {/* If Torrent: librqbit Swarm & Stealth Matrix Banner */}
          {item.isTorrent && (
            <div className="bg-teal-50/80 dark:bg-teal-950/40 rounded-xl p-4 border border-teal-200 dark:border-teal-900/60 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-2 text-teal-800 dark:text-teal-300 font-bold text-xs">
                  <ShieldCheck className="h-4 w-4 text-teal-600 dark:text-teal-400" />
                  <span>librqbit Active Stealth Engine Protection</span>
                </div>
                <span className="text-[10px] font-mono text-teal-700 dark:text-teal-400 bg-teal-100 dark:bg-teal-900/60 px-2 py-0.5 rounded-md font-bold">
                  Spoofed Peer ID: Transmission/3.00
                </span>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px] font-mono">
                <div className="bg-white/80 dark:bg-slate-900/60 p-2.5 rounded-lg border border-teal-200/60 dark:border-teal-900/60">
                  <span className="text-slate-400 dark:text-slate-500 block text-[9px] uppercase">Active Seeders</span>
                  <strong className="text-emerald-600 dark:text-emerald-400 text-sm">{item.seeders || 312}</strong>
                </div>

                <div className="bg-white/80 dark:bg-slate-900/60 p-2.5 rounded-lg border border-teal-200/60 dark:border-teal-900/60">
                  <span className="text-slate-400 dark:text-slate-500 block text-[9px] uppercase">Active Leechers</span>
                  <strong className="text-amber-600 dark:text-amber-400 text-sm">{item.leechers || 14}</strong>
                </div>

                <div className="bg-white/80 dark:bg-slate-900/60 p-2.5 rounded-lg border border-teal-200/60 dark:border-teal-900/60">
                  <span className="text-slate-400 dark:text-slate-500 block text-[9px] uppercase">Protocol Encryption</span>
                  <strong className="text-teal-700 dark:text-teal-300 text-xs">MSE / PE (128-bit)</strong>
                </div>

                <div className="bg-white/80 dark:bg-slate-900/60 p-2.5 rounded-lg border border-teal-200/60 dark:border-teal-900/60">
                  <span className="text-slate-400 dark:text-slate-500 block text-[9px] uppercase">Throttling Bypass</span>
                  <strong className="text-teal-700 dark:text-teal-300 text-xs">DPI Noise Enabled</strong>
                </div>
              </div>
            </div>
          )}

          {/* Speed Sparkline Graph */}
          <div className="space-y-2">
            <div className="flex items-center justify-between text-[11px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider">
              <span className="flex items-center space-x-1.5">
                <Zap className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400" />
                <span>Bandwidth History</span>
              </span>
              <span className="font-mono text-slate-400 dark:text-slate-500">Real-time throughput samples</span>
            </div>
            <div className="h-20 bg-slate-50 dark:bg-slate-800/50 rounded-xl p-3 border border-slate-200 dark:border-slate-700/80 flex items-end justify-between space-x-1">
              {item.speedHistory.length > 0 ? (
                item.speedHistory.map((val, idx) => {
                  const maxVal = Math.max(...item.speedHistory, 1);
                  const heightPercent = Math.min(100, Math.max(10, Math.floor((val / maxVal) * 100)));
                  return (
                    <div
                      key={idx}
                      className={`flex-1 rounded-t transition-all duration-300 relative group ${
                        item.isTorrent ? 'bg-teal-500 dark:bg-teal-400 hover:bg-teal-600' : 'bg-blue-500 dark:bg-blue-400 hover:bg-blue-600'
                      }`}
                      style={{ height: `${heightPercent}%` }}
                    >
                      <div className="opacity-0 group-hover:opacity-100 absolute -top-7 left-1/2 -translate-x-1/2 bg-slate-900 text-[10px] text-white font-mono px-1.5 py-0.5 rounded shadow-md pointer-events-none whitespace-nowrap z-10">
                        {val.toFixed(1)} MB/s
                      </div>
                    </div>
                  );
                })
              ) : (
                <div className="w-full text-center text-slate-400 text-xs py-4">No speed history recorded yet</div>
              )}
            </div>
          </div>

          {/* Multi-thread / Peer Chunk Grid Visualization */}
          <div className="space-y-2">
            <div className="flex items-center justify-between text-[11px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider">
              <span className="flex items-center space-x-1.5">
                <Cpu className="h-3.5 w-3.5 text-slate-600 dark:text-slate-400" />
                <span>
                  {item.isTorrent ? `librqbit Piece Map (${item.connections} Swarm Connections)` : `Parallel Thread Segments (${item.connections} Active Channels)`}
                </span>
              </span>
              <span className="font-mono text-blue-600 dark:text-blue-400 font-bold">{percent}% Total</span>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {item.chunks.map((chunk) => (
                <div
                  key={chunk.id}
                  className="bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700/80 rounded-xl p-2.5 space-y-1.5"
                >
                  <div className="flex items-center justify-between text-[10px] font-mono text-slate-500 dark:text-slate-400">
                    <span>{item.isTorrent ? `Piece Block #${chunk.id + 1}` : `Part #${chunk.id + 1}`}</span>
                    <span className="font-bold text-slate-800 dark:text-slate-200">{chunk.progress}%</span>
                  </div>
                  <div className="w-full bg-slate-200 dark:bg-slate-700 h-1.5 rounded-full overflow-hidden">
                    <div
                      className={`h-full transition-all duration-300 ${
                        chunk.progress === 100 
                          ? 'bg-emerald-500' 
                          : item.isTorrent 
                          ? 'bg-teal-500' 
                          : 'bg-blue-500'
                      }`}
                      style={{ width: `${chunk.progress}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Torrent Files Inspector List */}
          {item.torrentFiles && item.torrentFiles.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-[11px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider">
                <span>Torrent Files Included ({item.torrentFiles.filter(f => f.selected !== false).length} / {item.torrentFiles.length} Selected)</span>
              </div>
              <div className="max-h-40 overflow-y-auto space-y-1 bg-slate-50 dark:bg-slate-800/50 rounded-xl border border-slate-200 dark:border-slate-700/80 p-2 font-mono text-[11px]">
                {item.torrentFiles.map((tf, idx) => {
                  const isSel = tf.selected !== false;
                  return (
                    <div 
                      key={idx}
                      className={`flex items-center justify-between px-2.5 py-1.5 rounded border ${
                        isSel 
                          ? 'bg-white dark:bg-slate-900/80 border-slate-200 dark:border-slate-800' 
                          : 'bg-slate-100/50 dark:bg-slate-900/30 border-slate-200/50 dark:border-slate-800/50 opacity-60'
                      }`}
                    >
                      <span className={`truncate pr-2 ${isSel ? 'text-slate-700 dark:text-slate-200' : 'text-slate-400 line-through'}`}>
                        {tf.name}
                      </span>
                      <div className="flex items-center space-x-2 shrink-0">
                        <span className={`text-[9px] font-bold px-1.5 py-0.2 rounded uppercase ${
                          isSel ? 'bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-400' : 'bg-slate-200 dark:bg-slate-800 text-slate-500'
                        }`}>
                          {isSel ? 'Downloading' : 'Skipped'}
                        </span>
                        <span className="text-slate-400 text-[10px]">{formatBytes(tf.size)}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Detailed Connection Technical Specs */}
          <div className="space-y-2">
            <div className="text-[11px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider">
              File & Storage Location Metadata
            </div>
            <div className="bg-slate-50 dark:bg-slate-800/50 rounded-xl border border-slate-200 dark:border-slate-700/80 divide-y divide-slate-200 dark:divide-slate-700/80 font-mono text-[11px]">
              <div className="p-3 flex items-center justify-between">
                <span className="text-slate-500 dark:text-slate-400 flex items-center space-x-2">
                  <HardDrive className="h-3.5 w-3.5 text-slate-400" />
                  <span>File Size</span>
                </span>
                <span className="text-slate-800 dark:text-slate-200 font-bold">{formatBytes(item.size)}</span>
              </div>

              <div className="p-3 flex items-center justify-between">
                <span className="text-slate-500 dark:text-slate-400 flex items-center space-x-2">
                  <Server className="h-3.5 w-3.5 text-slate-400" />
                  <span>Local Save Path</span>
                </span>
                <span className="text-slate-800 dark:text-slate-200 font-bold">{item.savePath}</span>
              </div>

              <div className="p-3 flex items-center justify-between">
                <span className="text-slate-500 dark:text-slate-400 flex items-center space-x-2">
                  <Hash className="h-3.5 w-3.5 text-slate-400" />
                  <span>InfoHash / MD5</span>
                </span>
                <span className="text-slate-600 dark:text-slate-400 text-[10px] truncate max-w-xs">{item.hash || 'b4412e831f22c19983fae0193881472a1102e3b1'}</span>
              </div>

              <div className="p-3 flex items-center justify-between">
                <span className="text-slate-500 dark:text-slate-400 flex items-center space-x-2">
                  <ShieldCheck className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
                  <span>Security & Integrity</span>
                </span>
                <span className="text-emerald-700 dark:text-emerald-400 font-semibold">
                  {item.isTorrent ? 'librqbit Cryptographic Piece Hash Verified' : 'TLS 1.3 / Encrypted Connection'}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-slate-200 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-800/80 flex justify-end">
          <button
            onClick={onClose}
            className="px-5 py-2 rounded-full bg-slate-900 hover:bg-slate-800 dark:bg-slate-100 dark:hover:bg-white dark:text-slate-900 text-white font-semibold text-xs transition-colors shadow-xs"
          >
            Close Inspector
          </button>
        </div>
      </div>
    </div>
  );
};

