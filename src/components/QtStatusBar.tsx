import React, { useState, useEffect, useRef } from 'react';
import { 
  Download, Upload, ShieldCheck, ShieldAlert, HardDrive, 
  Wifi, Gauge, RefreshCw, ChevronUp, RotateCcw, Cpu 
} from 'lucide-react';
import { formatSpeed, formatBytes } from '../utils/formatters';
import { BandwidthLimits } from '../types';
import { apiClient } from '../services/apiClient';

interface QtStatusBarProps {
  totalDownSpeed: number;
  totalUpSpeed: number;
  sessionDownloaded?: number;
  sessionUploaded?: number;
  bandwidthLimits: BandwidthLimits;
  libqrbitActive: boolean;
  stealthPort: number;
  rustConnected?: boolean;
  activePeersCount?: number;
  onToggleTurtle: () => void;
  onSetGlobalLimit: (down: number, up: number) => void;
  onOpenScheduler: () => void;
  onOpenLibqrbitSettings: () => void;
  onResetSessionStats?: () => void;
}

export const QtStatusBar: React.FC<QtStatusBarProps> = ({
  totalDownSpeed,
  totalUpSpeed,
  sessionDownloaded = 0,
  sessionUploaded = 0,
  bandwidthLimits,
  libqrbitActive,
  stealthPort,
  rustConnected = false,
  activePeersCount = 0,
  onToggleTurtle,
  onSetGlobalLimit,
  onOpenScheduler,
  onOpenLibqrbitSettings,
  onResetSessionStats,
}) => {
  const [showSpeedMenu, setShowSpeedMenu] = useState(false);
  const [freeSpaceGb, setFreeSpaceGb] = useState<number | null>(null);
  const speedMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let active = true;
    const fetchDisk = async () => {
      const info = await apiClient.getFsInfo();
      if (active && info?.diskStats?.freeGB !== undefined) {
        setFreeSpaceGb(info.diskStats.freeGB);
      }
    };
    void fetchDisk();
    const timer = window.setInterval(() => void fetchDisk(), 30000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    if (!showSpeedMenu) return;
    const onMouseDown = (e: MouseEvent) => {
      if (speedMenuRef.current && !speedMenuRef.current.contains(e.target as Node)) {
        setShowSpeedMenu(false);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setShowSpeedMenu(false);
    };
    window.addEventListener('mousedown', onMouseDown);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [showSpeedMenu]);

  const dhtNodeCount = bandwidthLimits.dhtEnabled === false ? 0 : 280 + activePeersCount * 2;
  const altDownMbps = ((bandwidthLimits.altDownloadLimit || 2048) / 1024).toFixed(1);

  return (
    <div className="h-6 bg-[var(--os-bg-statusbar)] border-t border-[var(--os-border)] px-2 flex items-center justify-between text-[11px] font-mono text-[var(--os-text-muted)] select-none z-30 transition-colors">
      {/* Left: Connection & DHT Status */}
      <div className="flex items-center space-x-3 truncate">
        {/* Connection status */}
        <div className="flex items-center gap-1.5 text-[var(--os-text)]">
          <Wifi className="w-3 h-3 text-emerald-600 dark:text-emerald-400" />
          <span className="truncate">Online</span>
        </div>

        {/* libqrbit Stealth Status */}
        <button
          onClick={onOpenLibqrbitSettings}
          title="Click to configure libqrbit Port & Evasion"
          className="flex items-center gap-1 text-[10px] text-emerald-700 dark:text-emerald-400 hover:underline transition-colors font-medium"
        >
          {libqrbitActive ? (
            <>
              <ShieldCheck className="w-3 h-3 text-emerald-600 dark:text-emerald-400" />
              <span>libqrbit: Stealth On (Port {stealthPort})</span>
            </>
          ) : (
            <>
              <ShieldAlert className="w-3 h-3 text-[var(--os-text-muted)]" />
              <span>libqrbit: Stealth Off</span>
            </>
          )}
        </button>

        {/* DHT nodes */}
        <div className="hidden sm:flex items-center gap-1 text-[var(--os-text-muted)]">
          <span>DHT:</span>
          <span className="text-[var(--os-text)] font-semibold">{dhtNodeCount} nodes</span>
        </div>

        {/* Daemon IPC Status */}
        <div 
          className="hidden xl:flex items-center gap-1 text-[10px] text-[var(--os-text-muted)] border-l border-[var(--os-border)] pl-2.5"
          title={
            rustConnected
              ? 'FlowDown Pure-Rust Daemon connected via JSON-RPC 2.0'
              : 'Local Preview Engine active (start flowdownd daemon for native IPC)'
          }
        >
          <Cpu className={`w-3 h-3 ${rustConnected ? 'text-emerald-600 dark:text-emerald-400' : 'text-[var(--os-accent)]'}`} />
          <span>
            Engine:{' '}
            <strong className="text-[var(--os-text)] font-medium">
              {rustConnected ? 'flowdownd (Rust IPC)' : 'Local Engine (Preview)'}
            </strong>
          </span>
        </div>

        {/* Live Session Upload / Download Stats */}
        <div className="hidden md:flex items-center gap-1.5 text-[var(--os-text-muted)] border-l border-[var(--os-border)] pl-2.5">
          <span>Session:</span>
          <span className="text-emerald-700 dark:text-emerald-400 font-semibold">{formatBytes(sessionDownloaded)} ↓</span>
          <span className="text-[var(--os-text-muted)]">/</span>
          <span className="text-[var(--os-accent)] font-semibold">{formatBytes(sessionUploaded)} ↑</span>
          {onResetSessionStats && (
            <button
              onClick={onResetSessionStats}
              title="Reset session stats to 0 B (active transfers continue uninterrupted)"
              className="ml-1 p-0.5 rounded hover:bg-[var(--os-bg-hover)] text-[var(--os-text-muted)] hover:text-[var(--os-text)] transition-colors"
            >
              <RotateCcw className="w-2.5 h-2.5" />
            </button>
          )}
        </div>
      </div>

      {/* Right: Storage, Turtle mode, and Speeds */}
      <div className="flex items-center space-x-3 shrink-0">
        {/* Free Space */}
        <div className="hidden md:flex items-center gap-1 text-[var(--os-text-muted)]">
          <HardDrive className="w-3 h-3 text-[var(--os-text-muted)]" />
          <span>
            Free:{' '}
            <strong className="text-[var(--os-text)] font-normal">
              {freeSpaceGb !== null ? `${freeSpaceGb.toFixed(1)} GB` : '—'}
            </strong>
          </span>
        </div>

        {/* Alternative Speed Mode (Limited / Unlimited) */}
        <button
          onClick={onToggleTurtle}
          title={`Speed Mode: ${bandwidthLimits.altSpeedActive ? `Limited (${altDownMbps} MB/s cap)` : 'Unlimited (Full Line Rate)'}`}
          className={`flex items-center gap-1 px-1.5 py-0.2 rounded transition-colors ${
            bandwidthLimits.altSpeedActive
              ? 'bg-amber-100 dark:bg-amber-950/80 text-amber-900 dark:text-amber-300 border border-amber-400 dark:border-amber-800 font-semibold'
              : 'hover:text-[var(--os-text)]'
          }`}
        >
          <Gauge className="w-3 h-3 text-amber-600 dark:text-amber-400" />
          <span className="hidden sm:inline">
            {bandwidthLimits.altSpeedActive ? `Limited (${altDownMbps} MB/s)` : 'Unlimited'}
          </span>
        </button>

        {/* Live Download Speed with Quick Limit Dropdown */}
        <div ref={speedMenuRef} className="relative">
          <button
            onClick={() => setShowSpeedMenu(!showSpeedMenu)}
            className="flex items-center gap-1 text-emerald-700 dark:text-emerald-400 font-bold hover:bg-[var(--os-bg-hover)] px-1 rounded transition-colors"
            title="Click to select global download speed limit"
          >
            <Download className="w-3 h-3 text-emerald-600 dark:text-emerald-400" />
            <span>{formatSpeed(totalDownSpeed)}</span>
            <span className="text-[10px] text-[var(--os-text-muted)] font-normal">
              ({bandwidthLimits.globalDownloadLimit === 0 ? '∞' : `${bandwidthLimits.globalDownloadLimit} KB/s`})
            </span>
            <ChevronUp className="w-2.5 h-2.5 text-[var(--os-text-muted)]" />
          </button>

          {showSpeedMenu && (
            <div className="absolute bottom-full right-0 mb-1 w-44 bg-[var(--os-bg-content)] border border-[var(--os-border)] rounded shadow-xl py-1 text-xs text-[var(--os-text)] z-50">
              <div className="px-2.5 py-1 text-[10px] uppercase font-semibold text-[var(--os-text-muted)] border-b border-[var(--os-border)]">
                Download Limit
              </div>
              {[
                { label: 'Unlimited', val: 0 },
                { label: '50 MB/s (High)', val: 51200 },
                { label: '20 MB/s (Standard)', val: 20480 },
                { label: '5 MB/s (Restricted)', val: 5120 },
                { label: '1 MB/s (Low)', val: 1024 },
              ].map((opt) => (
                <button
                  key={opt.val}
                  onClick={() => {
                    onSetGlobalLimit(opt.val, bandwidthLimits.globalUploadLimit);
                    setShowSpeedMenu(false);
                  }}
                  className={`w-full flex items-center justify-between px-3 py-1 hover:bg-[var(--os-accent)] hover:text-white text-left text-[11px] transition-colors group ${
                    bandwidthLimits.globalDownloadLimit === opt.val ? 'text-[var(--os-accent)] font-bold' : ''
                  }`}
                >
                  <span>{opt.label}</span>
                  {bandwidthLimits.globalDownloadLimit === opt.val && <span className="group-hover:text-white">✓</span>}
                </button>
              ))}
              <div className="border-t border-[var(--os-border)] my-1" />
              <button
                onClick={() => {
                  setShowSpeedMenu(false);
                  onOpenScheduler();
                }}
                className="w-full px-3 py-1 text-left text-[11px] text-[var(--os-accent)] hover:bg-[var(--os-bg-hover)]"
              >
                Bandwidth Scheduler...
              </button>
            </div>
          )}
        </div>

        {/* Live Upload Speed */}
        <div className="flex items-center gap-1 text-[var(--os-accent)] font-bold">
          <Upload className="w-3 h-3 text-[var(--os-accent)]" />
          <span>{formatSpeed(totalUpSpeed)}</span>
          <span className="text-[10px] text-[var(--os-text-muted)] font-normal">
            ({bandwidthLimits.globalUploadLimit === 0 ? '∞' : `${bandwidthLimits.globalUploadLimit} KB/s`})
          </span>
        </div>
      </div>
    </div>
  );
};
