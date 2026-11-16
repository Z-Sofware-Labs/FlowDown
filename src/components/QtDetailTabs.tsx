import React, { useState, useEffect, useRef } from 'react';
import { 
  Info, Radio, Users, Grid, LineChart, Terminal, 
  Zap, Layers, Sparkles
} from 'lucide-react';
import { TorrentItem, SpeedHistoryPoint, LogEntry, PeerInfo, TrackerInfo } from '../types';
import { formatBytes, formatSpeed } from '../utils/formatters';
import { MOCK_PEERS, MOCK_TRACKERS } from '../services/mockData';
import { torrentEngine } from '../services/torrentEngine';

interface QtDetailTabsProps {
  torrent: TorrentItem | null;
  speedHistory: SpeedHistoryPoint[];
  logs: LogEntry[];
  theme: 'dark' | 'light';
  stealthPort?: number;
  stealthEnabled?: boolean;
  onTriggerPortHop: () => void;
  onOpenDiagnostic: () => void;
  onOpenAnalyzer: () => void;
  height?: number;
}

export const QtDetailTabs: React.FC<QtDetailTabsProps> = ({
  torrent,
  speedHistory,
  logs,
  theme,
  stealthPort = 52841,
  stealthEnabled = true,
  onTriggerPortHop,
  onOpenDiagnostic,
  onOpenAnalyzer,
  height,
}) => {
  const [activeTab, setActiveTab] = useState<
    'general' | 'trackers' | 'peers' | 'pieces' | 'speed' | 'segments' | 'logs'
  >('general');

  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Draw Speed Chart on Canvas
  useEffect(() => {
    if (activeTab !== 'speed' || !canvasRef.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const width = canvas.width;
    const height = canvas.height;

    ctx.clearRect(0, 0, width, height);

    const cs = getComputedStyle(document.documentElement);
    const osBorder = cs.getPropertyValue('--os-border-subtle').trim() || (theme === 'dark' ? '#2e3338' : '#e5e5e5');
    const osAccent = cs.getPropertyValue('--os-accent').trim() || '#0078d7';

    // Background and grid according to active OS palette
    ctx.strokeStyle = osBorder;
    ctx.lineWidth = 1;
    for (let y = 20; y < height; y += 30) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
    }
    for (let x = 40; x < width; x += 60) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();
    }

    if (speedHistory.length < 2) return;

    // Find max speed
    const maxSpeed = Math.max(...speedHistory.map((s) => Math.max(s.downloadSpeed, s.uploadSpeed, s.bypassedSpeed, 1000)), 50000);

    const getY = (val: number) => height - 10 - (val / maxSpeed) * (height - 30);
    const getX = (i: number) => (i / (speedHistory.length - 1)) * (width - 20) + 10;

    // 1. Draw Bypassed Speed Area (OS Accent tint)
    ctx.beginPath();
    ctx.moveTo(getX(0), height);
    speedHistory.forEach((p, i) => {
      ctx.lineTo(getX(i), getY(p.bypassedSpeed));
    });
    ctx.lineTo(getX(speedHistory.length - 1), height);
    ctx.closePath();
    ctx.fillStyle = theme === 'dark' ? 'rgba(16, 185, 129, 0.14)' : 'rgba(16, 185, 129, 0.12)';
    ctx.fill();

    // Line for Bypassed Speed
    ctx.beginPath();
    ctx.strokeStyle = theme === 'dark' ? '#10b981' : '#059669';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 2]);
    speedHistory.forEach((p, i) => {
      const x = getX(i);
      const y = getY(p.bypassedSpeed);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
    ctx.setLineDash([]);

    // 2. Draw Download Line (Primary OS Highlight)
    ctx.beginPath();
    ctx.strokeStyle = osAccent;
    ctx.lineWidth = 2;
    speedHistory.forEach((p, i) => {
      const x = getX(i);
      const y = getY(p.downloadSpeed);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();

    // 3. Draw Upload Line (Muted slate/amber)
    ctx.beginPath();
    ctx.strokeStyle = theme === 'dark' ? '#34d399' : '#16a34a';
    ctx.lineWidth = 1.5;
    speedHistory.forEach((p, i) => {
      const x = getX(i);
      const y = getY(p.uploadSpeed);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
  }, [activeTab, speedHistory, theme]);

  const pieceSize = torrent ? Math.round(torrent.size / Math.max(1, torrent.piecesCount)) : 4194304;

  const activeTrackers: TrackerInfo[] = React.useMemo(() => {
    if (!torrent) return [];
    if (torrent.isHttpSegmented) {
      return [
        {
          url: torrent.httpUrl || `https://cdn.flowdown.invalid/files/${encodeURIComponent(torrent.name)}`,
          status: torrent.status === 'paused' ? 'Not Contacted' : 'Working',
          seeders: torrent.segments?.length || torrent.peersTotal,
          leechers: 0,
          downloaded: Math.round(torrent.progress),
          interval: 'Range 206',
          message:
            torrent.status === 'paused'
              ? 'HTTP multi-stream paused'
              : `HTTP/2 Range streaming active (${torrent.segments?.length || 8} parallel sockets)`,
        },
      ];
    }
    const seedFactor = Math.max(0.2, torrent.seedsTotal / 120);
    const peerFactor = Math.max(0.2, torrent.peersTotal / 60);
    return MOCK_TRACKERS.map((trk, idx) => ({
      ...trk,
      status: torrent.status === 'paused' ? 'Not Contacted' : trk.status,
      seeders: idx === 0 ? Math.max(torrent.seedsConnected, Math.round(trk.seeders * seedFactor)) : Math.round(trk.seeders * seedFactor),
      leechers: Math.round(trk.leechers * peerFactor),
      message:
        torrent.status === 'paused'
          ? 'Stopped by user'
          : torrent.libqrbitEnabled
          ? `${trk.message} (via ${torrent.decoyProtocol} stealth)`
          : trk.message,
    }));
  }, [torrent]);

  const activePeers: PeerInfo[] = React.useMemo(() => {
    if (!torrent || torrent.status === 'paused') return [];
    if (torrent.isHttpSegmented && torrent.segments) {
      return torrent.segments.map((seg) => {
        const span = Math.max(1, seg.endByte - seg.startByte);
        const pct = Math.min(100, Math.round((seg.downloadedBytes / span) * 100));
        return {
          ip: `CDN Edge #${seg.id} (:443)`,
          country: 'US',
          client: 'HTTP/2 Range Socket',
          flags: seg.status === 'completed' ? 'OK' : 'DL',
          downloadSpeed: seg.speed,
          uploadSpeed: 0,
          progress: pct,
          isLibqrbitPeer: torrent.libqrbitEnabled,
          encryption: torrent.libqrbitEnabled ? 'libqrbit MP-Morph' : 'Full RC4/TLS1.3',
          relevance: `Stream #${seg.id}`,
        };
      });
    }
    const totalRate = torrent.downloadSpeed || 0;
    const peerSlices = Math.min(MOCK_PEERS.length, Math.max(1, torrent.peersConnected || 3));
    return MOCK_PEERS.slice(0, peerSlices).map((p, idx) => ({
      ...p,
      isLibqrbitPeer: torrent.libqrbitEnabled ? p.isLibqrbitPeer : false,
      encryption:
        torrent.libqrbitEnabled && p.isLibqrbitPeer
          ? 'libqrbit MP-Morph'
          : 'Full RC4/TLS1.3',
      downloadSpeed: Math.max(0, Math.round((totalRate / peerSlices) * (idx === 0 ? 1.4 : 0.85))),
      uploadSpeed: Math.max(0, Math.round((torrent.uploadSpeed || 0) / peerSlices)),
    }));
  }, [torrent]);

  return (
    <div
      style={{ height: height ? `${height}px` : undefined }}
      className={`${height ? '' : 'h-52'} bg-[var(--os-bg-window)] border-t border-[var(--os-border)] flex flex-col select-none text-xs text-[var(--os-text)] transition-colors shrink-0`}
    >
      {/* Tab Navigation */}
      <div className="h-7 bg-[var(--os-bg-toolbar)] border-b border-[var(--os-border)] flex items-center px-2 space-x-1 overflow-x-auto text-[11px]">
        <button
          onClick={() => setActiveTab('general')}
          className={`px-3 py-1 rounded-t flex items-center gap-1.5 font-medium transition-colors ${
            activeTab === 'general'
              ? 'bg-[var(--os-bg-content)] text-[var(--os-accent)] border-t-2 border-[var(--os-accent)] font-semibold shadow-2xs'
              : 'text-[var(--os-text-muted)] hover:text-[var(--os-text)]'
          }`}
        >
          <Info className="w-3.5 h-3.5" />
          <span>General</span>
        </button>

        <button
          onClick={() => setActiveTab('trackers')}
          className={`px-3 py-1 rounded-t flex items-center gap-1.5 font-medium transition-colors ${
            activeTab === 'trackers'
              ? 'bg-[var(--os-bg-content)] text-[var(--os-accent)] border-t-2 border-[var(--os-accent)] font-semibold shadow-2xs'
              : 'text-[var(--os-text-muted)] hover:text-[var(--os-text)]'
          }`}
        >
          <Radio className="w-3.5 h-3.5" />
          <span>Trackers</span>
        </button>

        <button
          onClick={() => setActiveTab('peers')}
          className={`px-3 py-1 rounded-t flex items-center gap-1.5 font-medium transition-colors ${
            activeTab === 'peers'
              ? 'bg-[var(--os-bg-content)] text-[var(--os-accent)] border-t-2 border-[var(--os-accent)] font-semibold shadow-2xs'
              : 'text-[var(--os-text-muted)] hover:text-[var(--os-text)]'
          }`}
        >
          <Users className="w-3.5 h-3.5" />
          <span>Peers ({torrent?.peersConnected || 0})</span>
        </button>

        <button
          onClick={() => setActiveTab('pieces')}
          className={`px-3 py-1 rounded-t flex items-center gap-1.5 font-medium transition-colors ${
            activeTab === 'pieces'
              ? 'bg-[var(--os-bg-content)] text-[var(--os-accent)] border-t-2 border-[var(--os-accent)] font-semibold shadow-2xs'
              : 'text-[var(--os-text-muted)] hover:text-[var(--os-text)]'
          }`}
        >
          <Grid className="w-3.5 h-3.5" />
          <span>Pieces Map</span>
        </button>

        <button
          onClick={() => setActiveTab('speed')}
          className={`px-3 py-1 rounded-t flex items-center gap-1.5 font-medium transition-colors ${
            activeTab === 'speed'
              ? 'bg-[var(--os-bg-content)] text-[var(--os-accent)] border-t-2 border-[var(--os-accent)] font-semibold shadow-2xs'
              : 'text-[var(--os-text-muted)] hover:text-[var(--os-text)]'
          }`}
        >
          <LineChart className="w-3.5 h-3.5" />
          <span>Speed Graph</span>
        </button>

        {/* HTTP Segments Tab (for IDM) */}
        {torrent?.isHttpSegmented && (
          <button
            onClick={() => setActiveTab('segments')}
            className={`px-3 py-1 rounded-t flex items-center gap-1.5 font-medium transition-colors ${
              activeTab === 'segments'
                ? 'bg-[var(--os-bg-content)] text-emerald-700 dark:text-emerald-400 border-t-2 border-emerald-600 dark:border-emerald-400 font-bold shadow-2xs'
                : 'text-[var(--os-text-muted)] hover:text-[var(--os-text)]'
            }`}
          >
            <Layers className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
            <span>HTTP Segments (IDM)</span>
          </button>
        )}

        <button
          onClick={() => setActiveTab('logs')}
          className={`px-3 py-1 rounded-t flex items-center gap-1.5 font-medium transition-colors ${
            activeTab === 'logs'
              ? 'bg-[var(--os-bg-content)] text-[var(--os-accent)] border-t-2 border-[var(--os-accent)] font-semibold shadow-2xs'
              : 'text-[var(--os-text-muted)] hover:text-[var(--os-text)]'
          }`}
        >
          <Terminal className="w-3.5 h-3.5" />
          <span>Qt Event Log</span>
        </button>
      </div>

      {/* Tab Content Container */}
      <div className="flex-1 p-3 overflow-y-auto bg-[var(--os-bg-window)]">
        {!torrent && activeTab !== 'logs' && activeTab !== 'speed' ? (
          <div className="h-full flex items-center justify-center text-[var(--os-text-muted)] text-xs">
            Select a transfer from the list above to inspect swarm health, peers, pieces, and libqrbit stealth stats.
          </div>
        ) : (
          <>
            {/* 1. General Tab */}
            {activeTab === 'general' && torrent && (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs font-mono">
                {/* Column 1: Transfer Stats */}
                <div className="space-y-1.5 bg-[var(--os-bg-content)] p-2.5 rounded border border-[var(--os-border)] shadow-2xs">
                  <div className="text-[10px] uppercase font-semibold text-[var(--os-text-muted)] tracking-wider mb-1 font-sans">
                    Transfer Statistics
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[var(--os-text-muted)]">Total Size:</span>
                    <span className="text-[var(--os-text)]">{formatBytes(torrent.size)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[var(--os-text-muted)]">Downloaded:</span>
                    <span className="text-emerald-700 dark:text-emerald-400 font-bold">{formatBytes(torrent.downloaded)} ({torrent.progress.toFixed(1)}%)</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[var(--os-text-muted)]">Uploaded:</span>
                    <span className="text-[var(--os-accent)] font-semibold">{formatBytes(torrent.uploaded)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[var(--os-text-muted)]">Share Ratio:</span>
                    <span className="text-[var(--os-text)]">{torrent.ratio.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[var(--os-text-muted)]">Estimated Time:</span>
                    <span className="text-[var(--os-text)]">{torrent.eta}</span>
                  </div>
                </div>

                {/* Column 2: Swarm Health & Pieces */}
                <div className="space-y-1.5 bg-[var(--os-bg-content)] p-2.5 rounded border border-[var(--os-border)] shadow-2xs">
                  <div className="text-[10px] uppercase font-semibold text-[var(--os-text-muted)] tracking-wider mb-1 font-sans">
                    Swarm Health & Scheduling
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[var(--os-text-muted)]">Swarm Availability:</span>
                    <span className="text-emerald-700 dark:text-emerald-400 font-bold">{torrent.swarmHealth.toFixed(1)}x (Grade {torrent.healthGrade})</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[var(--os-text-muted)]">Scheduling Mode:</span>
                    <span className="text-[var(--os-accent)] font-medium capitalize">{torrent.healthPriorityMode.replace('_', ' ')}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[var(--os-text-muted)]">Pieces Count:</span>
                    <span className="text-[var(--os-text)]">{torrent.piecesCount} × {formatBytes(pieceSize)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[var(--os-text-muted)]">Seeds / Peers:</span>
                    <span className="text-[var(--os-text)]">{torrent.seedsConnected}/{torrent.seedsTotal} seeds · {torrent.peersConnected}/{torrent.peersTotal} peers</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[var(--os-text-muted)]">Bandwidth Priority:</span>
                    <span className="text-amber-700 dark:text-amber-300 font-bold">{torrent.priority}</span>
                  </div>
                </div>

                {/* Column 3: Information & Paths */}
                <div className="space-y-1.5 bg-[var(--os-bg-content)] p-2.5 rounded border border-[var(--os-border)] shadow-2xs">
                  <div className="text-[10px] uppercase font-semibold text-[var(--os-text-muted)] tracking-wider mb-1 font-sans">
                    Storage & Hash Identification
                  </div>
                  <div>
                    <span className="text-[var(--os-text-muted)] block text-[10px]">Save Directory:</span>
                    <span className="text-[var(--os-text)] truncate block text-[11px]" title={torrent.savePath}>
                      {torrent.savePath}
                    </span>
                  </div>
                  <div>
                    <span className="text-[var(--os-text-muted)] block text-[10px]">Info Hash (SHA-1):</span>
                    <span className="text-[var(--os-text)] text-[10px] font-mono select-all truncate block">
                      {torrent.hash}
                    </span>
                  </div>
                  <div className="flex justify-between text-[11px] pt-1">
                    <span className="text-[var(--os-text-muted)]">Added Date:</span>
                    <span className="text-[var(--os-text)]">{torrent.addedDate}</span>
                  </div>
                </div>
              </div>
            )}

            {/* 2. Trackers Tab */}
            {activeTab === 'trackers' && (
              <div className="h-full overflow-x-auto bg-[var(--os-bg-content)] rounded border border-[var(--os-border)]">
                <table className="w-full text-left font-mono text-[11px]">
                  <thead className="text-[10px] uppercase text-[var(--os-text-muted)] border-b border-[var(--os-border)] bg-[var(--os-bg-header)]">
                    <tr>
                      <th className="py-1 px-2">Tracker / Origin URL</th>
                      <th className="py-1 px-2 w-24">Status</th>
                      <th className="py-1 px-2 w-16 text-right">Seeds</th>
                      <th className="py-1 px-2 w-16 text-right">Leechers</th>
                      <th className="py-1 px-2 w-24 text-right">Downloaded</th>
                      <th className="py-1 px-2 w-24">Interval</th>
                      <th className="py-1 px-2">Message</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--os-border-subtle)]">
                    {activeTrackers.map((trk, i) => (
                      <tr key={i} className="hover:bg-[var(--os-bg-hover)]">
                        <td className="py-1 px-2 text-[var(--os-accent)] truncate max-w-xs">{trk.url}</td>
                        <td className="py-1 px-2">
                          <span className="px-1.5 py-0.2 rounded text-[10px] bg-emerald-50 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-400 border border-emerald-300 dark:border-emerald-800/50">
                            {trk.status}
                          </span>
                        </td>
                        <td className="py-1 px-2 text-right text-emerald-700 dark:text-emerald-400 font-bold">{trk.seeders}</td>
                        <td className="py-1 px-2 text-right text-[var(--os-accent)]">{trk.leechers}</td>
                        <td className="py-1 px-2 text-right text-[var(--os-text-muted)]">{trk.downloaded}</td>
                        <td className="py-1 px-2 text-[var(--os-text)]">{trk.interval}</td>
                        <td className="py-1 px-2 text-[var(--os-text-muted)] truncate max-w-sm">{trk.message}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* 3. Peers Tab */}
            {activeTab === 'peers' && (
              <div className="h-full overflow-x-auto bg-[var(--os-bg-content)] rounded border border-[var(--os-border)]">
                <table className="w-full text-left font-mono text-[11px]">
                  <thead className="text-[10px] uppercase text-[var(--os-text-muted)] border-b border-[var(--os-border)] bg-[var(--os-bg-header)]">
                    <tr>
                      <th className="py-1 px-2">IP / Endpoint</th>
                      <th className="py-1 px-2 w-12 text-center">CC</th>
                      <th className="py-1 px-2">Client</th>
                      <th className="py-1 px-2 w-20">Flags</th>
                      <th className="py-1 px-2 w-24 text-right">Down Speed</th>
                      <th className="py-1 px-2 w-24 text-right">Up Speed</th>
                      <th className="py-1 px-2 w-16 text-right">Progress</th>
                      <th className="py-1 px-2">Encryption / Protocol</th>
                      <th className="py-1 px-2">Relevance</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--os-border-subtle)]">
                    {activePeers.length === 0 ? (
                      <tr>
                        <td colSpan={9} className="py-4 text-center text-[var(--os-text-muted)]">
                          No active peer sockets (transfer is paused or idle).
                        </td>
                      </tr>
                    ) : (
                      activePeers.map((peer, i) => (
                        <tr key={i} className={`hover:bg-[var(--os-bg-hover)] ${peer.isLibqrbitPeer ? 'bg-emerald-50/70 dark:bg-emerald-950/20' : ''}`}>
                          <td className="py-1 px-2 text-[var(--os-text)] flex items-center gap-1.5">
                            {peer.isLibqrbitPeer && (
                              <span title="libqrbit Stealth Peer Link" className="inline-flex">
                                <Zap className="w-3 h-3 text-yellow-500 dark:text-yellow-400 fill-yellow-400" />
                              </span>
                            )}
                            <span>{peer.ip}</span>
                          </td>
                          <td className="py-1 px-2 text-center text-[var(--os-text-muted)]">{peer.country}</td>
                          <td className="py-1 px-2 text-[var(--os-text)]">
                            <span className={peer.isLibqrbitPeer ? 'text-emerald-700 dark:text-emerald-300 font-bold' : ''}>
                              {peer.client}
                            </span>
                          </td>
                          <td className="py-1 px-2 text-[var(--os-text-muted)]">{peer.flags}</td>
                          <td className="py-1 px-2 text-right text-emerald-700 dark:text-emerald-400 font-bold">
                            {formatSpeed(peer.downloadSpeed)}
                          </td>
                          <td className="py-1 px-2 text-right text-[var(--os-accent)]">
                            {formatSpeed(peer.uploadSpeed)}
                          </td>
                          <td className="py-1 px-2 text-right text-[var(--os-text)]">{peer.progress}%</td>
                          <td className="py-1 px-2">
                            <span className={`px-1.5 py-0.2 rounded text-[10px] ${
                              peer.encryption === 'libqrbit MP-Morph'
                                ? 'bg-emerald-100 dark:bg-emerald-900/60 text-emerald-800 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-700/60 font-semibold'
                                : 'bg-[var(--os-bg-alt)] text-[var(--os-text-muted)]'
                            }`}>
                              {peer.encryption}
                            </span>
                          </td>
                          <td className="py-1 px-2 text-[var(--os-text-muted)]">{peer.relevance}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            )}

            {/* 4. Pieces Map Tab */}
            {activeTab === 'pieces' && torrent && (
              <div className="h-full flex flex-col">
                <div className="flex items-center justify-between pb-2 text-[11px] font-mono border-b border-[var(--os-border)] mb-2">
                  <div className="flex items-center gap-4">
                    <span>Total Pieces: <strong>{torrent.piecesCount}</strong></span>
                    <span>Piece Size: <strong>{formatBytes(pieceSize)}</strong></span>
                    <span>Verified Chunks: <strong className="text-emerald-700 dark:text-emerald-400">{torrent.completedPieces.filter(Boolean).length}</strong></span>
                  </div>
                  <div className="flex items-center gap-3 text-[10px]">
                    <span className="flex items-center gap-1">
                      <span className="w-2.5 h-2.5 bg-emerald-500 rounded-xs" /> Verified
                    </span>
                    <span className="flex items-center gap-1">
                      <span className="w-2.5 h-2.5 bg-[var(--os-accent)] rounded-xs animate-pulse" /> Active Chunks
                    </span>
                    <span className="flex items-center gap-1">
                      <span className="w-2.5 h-2.5 bg-[var(--os-border)] rounded-xs" /> Missing
                    </span>
                  </div>
                </div>

                {/* 2D Piece Grid */}
                <div className="flex-1 overflow-y-auto p-1 bg-[var(--os-bg-content)] rounded border border-[var(--os-border)] flex flex-wrap gap-[2px] content-start">
                  {torrent.completedPieces.map((isDone, idx) => {
                    const isActive = torrent.activePieces.includes(idx);
                    return (
                      <div
                        key={idx}
                        title={`Piece #${idx} - ${isDone ? 'Verified (SHA-1 OK)' : isActive ? 'Actively Downloading' : 'Queued (Rarest-first)'}`}
                        className={`w-3.5 h-3.5 rounded-[1px] transition-colors cursor-pointer ${
                          isDone
                            ? 'bg-emerald-500 hover:bg-emerald-400'
                            : isActive
                            ? 'bg-[var(--os-accent)] animate-pulse'
                            : 'bg-[var(--os-border-subtle)] hover:bg-[var(--os-border)]'
                        }`}
                      />
                    );
                  })}
                </div>
              </div>
            )}

            {/* 5. Speed Graph Tab */}
            {activeTab === 'speed' && (
              <div className="h-full flex flex-col">
                <div className="flex items-center justify-between pb-1 text-[11px] font-mono mb-1">
                  <div className="flex items-center gap-4">
                    <span className="flex items-center gap-1.5 text-[var(--os-accent)] font-bold">
                      <span className="w-2.5 h-0.5 bg-[var(--os-accent)] inline-block" /> Download
                    </span>
                    <span className="flex items-center gap-1.5 text-emerald-700 dark:text-emerald-400 font-bold">
                      <span className="w-2.5 h-0.5 bg-emerald-600 dark:bg-emerald-400 inline-block" /> Upload
                    </span>
                    <span className="flex items-center gap-1.5 text-yellow-700 dark:text-yellow-400 font-bold">
                      <span className="w-2.5 h-0.5 border-t border-dashed border-yellow-600 dark:border-yellow-400 inline-block" /> libqrbit Throttling Bypass
                    </span>
                  </div>
                  <span className="text-[var(--os-text-muted)] text-[10px]">Real-time 2s updates · Auto-scaled line rate</span>
                </div>
                <div className="flex-1 bg-[var(--os-bg-content)] rounded border border-[var(--os-border)] overflow-hidden relative shadow-2xs">
                  <canvas
                    ref={canvasRef}
                    width={800}
                    height={180}
                    className="w-full h-full block"
                  />
                </div>
              </div>
            )}

            {/* 6. HTTP Segments Tab (IDM) */}
            {activeTab === 'segments' && torrent?.segments && (
              <div className="h-full overflow-y-auto space-y-2 font-mono text-xs">
                <div className="flex items-center justify-between text-[11px] border-b border-[var(--os-border)] pb-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-sans font-semibold">Direct HTTP Streams ({torrent.segments.length})</span>
                    <button
                      onClick={onOpenAnalyzer}
                      className="px-2 py-0.5 rounded bg-[var(--os-accent)] hover:bg-[var(--os-accent-hover)] text-white font-sans text-[10px] font-semibold flex items-center gap-1 shadow-2xs transition-colors"
                      title="Run HTTP socket acceleration & carrier bypass auto analysis"
                    >
                      <Sparkles className="w-3 h-3 text-yellow-300 fill-yellow-300" />
                      <span>Auto Analyze HTTP</span>
                    </button>
                    <div className="flex items-center gap-1 pl-2 border-l border-[var(--os-border)] font-sans">
                      <span className="text-[10px] text-[var(--os-text-muted)]">Scale:</span>
                      {[1, 2, 4, 8, 16, 32].map((cnt) => (
                        <button
                          key={cnt}
                          onClick={() => torrent && torrentEngine.setHttpSegments(torrent.id, cnt)}
                          className={`px-1.5 py-0.5 rounded text-[10px] font-medium border transition-colors ${
                            torrent?.peersTotal === cnt || torrent?.segments?.length === cnt
                              ? 'bg-[var(--os-accent)] text-white border-[var(--os-accent)] font-semibold'
                              : 'bg-[var(--os-bg-control)] hover:bg-[var(--os-bg-hover)] text-[var(--os-text)] border-[var(--os-border)]'
                          }`}
                          title={`Dynamically scale and split chunks into ${cnt} streams in real-time`}
                        >
                          {cnt}x
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] text-emerald-600 dark:text-emerald-400 font-mono bg-emerald-500/10 px-1.5 py-0.5 rounded border border-emerald-500/20">
                      Work-Stealing IDM Active
                    </span>
                    <span className="text-emerald-700 dark:text-emerald-400 font-bold">{formatSpeed(torrent.downloadSpeed)} Aggregate</span>
                  </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                  {torrent.segments.map((seg) => {
                    const totalSegBytes = seg.endByte - seg.startByte;
                    const percent = Math.min(100, (seg.downloadedBytes / totalSegBytes) * 100);
                    return (
                      <div key={seg.id} className="p-2 bg-[var(--os-bg-content)] rounded border border-[var(--os-border)] space-y-1 shadow-2xs">
                        <div className="flex justify-between text-[10px]">
                          <span className="text-[var(--os-text)] font-semibold">Stream #{seg.id}</span>
                          <span className={seg.status === 'completed' ? 'text-[var(--os-accent)] font-bold' : 'text-emerald-700 dark:text-emerald-400 font-bold'}>
                            {seg.status === 'completed' ? 'Finished' : formatSpeed(seg.speed)}
                          </span>
                        </div>
                        <div className="h-2 bg-[var(--os-bg-alt)] rounded-xs overflow-hidden border border-[var(--os-border-subtle)]">
                          <div
                            className="h-full bg-[var(--os-accent)] transition-all duration-300"
                            style={{ width: `${percent}%` }}
                          />
                        </div>
                        <div className="flex justify-between text-[9px] text-[var(--os-text-muted)]">
                          <span>{formatBytes(seg.startByte)} - {formatBytes(seg.endByte)}</span>
                          <span>{percent.toFixed(1)}%</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* 8. Log Tab */}
            {activeTab === 'logs' && (
              <div className="h-full overflow-y-auto font-mono text-[11px] space-y-1 pr-1 bg-[var(--os-bg-content)] p-2 rounded border border-[var(--os-border)]">
                {logs.map((log) => {
                  let badge = 'bg-[var(--os-bg-alt)] text-[var(--os-text)] border-[var(--os-border)]';
                  if (log.type === 'LIBQRBIT') badge = 'bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-300 border-emerald-300 dark:border-emerald-800';
                  if (log.type === 'THROTTLE') badge = 'bg-rose-100 dark:bg-rose-950 text-rose-800 dark:text-rose-300 border-rose-300 dark:border-rose-800';
                  if (log.type === 'SECURITY') badge = 'bg-[var(--os-bg-selected-soft)] text-[var(--os-text-selected-soft)] border-[var(--os-accent)]';

                  return (
                    <div key={log.id} className="flex items-start gap-2 py-0.5">
                      <span className="text-[var(--os-text-muted)] shrink-0">{log.timestamp}</span>
                      <span className={`px-1 rounded text-[9px] font-semibold border ${badge} shrink-0`}>
                        {log.type}
                      </span>
                      <span className="text-[var(--os-text)] break-words">{log.message}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};
