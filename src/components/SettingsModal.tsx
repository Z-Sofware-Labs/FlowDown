import React, { useEffect, useState } from 'react';
import { X, Settings, HardDrive, Volume2, Gauge, Zap, Check, Radio, ShieldCheck, Lock, Sun, Moon, Minimize2, Shuffle, Link, FileType, Sparkles } from 'lucide-react';
import { GlobalSettings } from '../types';
import { resolveDownloadPath, registerFileAssociationsNative, isTauriEnvironment } from '../utils/tauri';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  settings: GlobalSettings;
  onUpdateSettings: (newSettings: Partial<GlobalSettings>) => void;
  onCheckForUpdates?: () => void;
  isCheckingUpdates?: boolean;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  onClose,
  settings,
  onUpdateSettings,
  onCheckForUpdates,
  isCheckingUpdates = false,
}) => {
  const [displaySavePath, setDisplaySavePath] = useState(settings.defaultSavePath);
  const isTauri = isTauriEnvironment();

  // File association state: null = idle, true = registered, false = removed, 'error' = failed
  const [torrentAssocStatus, setTorrentAssocStatus] = useState<null | 'registered' | 'removed' | 'error'>(null);
  const [magnetAssocStatus, setMagnetAssocStatus] = useState<null | 'registered' | 'removed' | 'error'>(null);
  const [torrentAssocActive, setTorrentAssocActive] = useState(false);
  const [magnetAssocActive, setMagnetAssocActive] = useState(false);

  const handleAssociation = async (type: 'torrent' | 'magnet', enable: boolean) => {
    if (type === 'torrent') {
      setTorrentAssocActive(true);
      setTorrentAssocStatus(null);
    } else {
      setMagnetAssocActive(true);
      setMagnetAssocStatus(null);
    }
    try {
      await registerFileAssociationsNative({
        torrent: type === 'torrent' ? enable : false,
        magnet: type === 'magnet' ? enable : false,
      });
      if (type === 'torrent') setTorrentAssocStatus(enable ? 'registered' : 'removed');
      else setMagnetAssocStatus(enable ? 'registered' : 'removed');
    } catch {
      if (type === 'torrent') setTorrentAssocStatus('error');
      else setMagnetAssocStatus('error');
    } finally {
      if (type === 'torrent') setTorrentAssocActive(false);
      else setMagnetAssocActive(false);
    }
  };

  useEffect(() => {
    if (!isOpen) return;
    void resolveDownloadPath(settings.defaultSavePath)
      .then(setDisplaySavePath)
      .catch(() => setDisplaySavePath(settings.defaultSavePath));
  }, [isOpen, settings.defaultSavePath]);

  // Reset association status feedback when modal closes
  useEffect(() => {
    if (!isOpen) {
      setTorrentAssocStatus(null);
      setMagnetAssocStatus(null);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200 text-slate-800 dark:text-slate-100">
        
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-800/80">
          <div className="flex items-center space-x-3">
            <div className="p-2 bg-slate-100 dark:bg-slate-800 rounded-xl text-slate-700 dark:text-slate-200">
              <Settings className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-900 dark:text-white">Manager & Engine Settings</h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">Configure bandwidth, librqbit stealth shield, and default paths</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-800 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="p-6 space-y-5 text-xs max-h-[75vh] overflow-y-auto">
          
          {/* Theme Mode */}
          <div className="space-y-1.5">
            <label className="text-[11px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider flex items-center space-x-2">
              <Sun className="h-3.5 w-3.5 text-amber-500" />
              <span>Appearance Theme</span>
            </label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => onUpdateSettings({ theme: 'light' })}
                className={`flex items-center justify-center space-x-2 p-2.5 rounded-xl border text-xs font-semibold transition-all ${
                  settings.theme === 'light'
                    ? 'bg-amber-50 dark:bg-slate-800 border-amber-400 dark:border-amber-500 text-slate-900 dark:text-white'
                    : 'bg-slate-50 dark:bg-slate-800/50 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
                }`}
              >
                <Sun className="h-4 w-4 text-amber-500" />
                <span>Light Mode</span>
              </button>
              <button
                type="button"
                onClick={() => onUpdateSettings({ theme: 'dark' })}
                className={`flex items-center justify-center space-x-2 p-2.5 rounded-xl border text-xs font-semibold transition-all ${
                  settings.theme === 'dark'
                    ? 'bg-indigo-900/40 border-indigo-500 text-slate-900 dark:text-white'
                    : 'bg-slate-50 dark:bg-slate-800/50 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
                }`}
              >
                <Moon className="h-4 w-4 text-indigo-400" />
                <span>Dark Mode</span>
              </button>
            </div>
          </div>
          
          {/* Max Simultaneous Transfers */}
          <div className="space-y-1.5">
            <label className="text-[11px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider flex items-center space-x-2">
              <Zap className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400" />
              <span>Max Simultaneous Active Transfers</span>
            </label>
            <select
              value={settings.maxSimultaneousDownloads}
              onChange={(e) => onUpdateSettings({ maxSimultaneousDownloads: Number(e.target.value) })}
              className="w-full bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 focus:border-blue-500 focus:bg-white dark:focus:bg-slate-900 rounded-xl px-3 py-2.5 text-slate-800 dark:text-slate-100 text-xs focus:outline-none cursor-pointer"
            >
              <option value={1}>1 File at a time (Sequential)</option>
              <option value={2}>2 Files at a time</option>
              <option value={3}>3 Files at a time (Recommended)</option>
              <option value={5}>5 Files at a time</option>
              <option value={10}>10 Files at a time (High Bandwidth)</option>
            </select>
          </div>

          {/* Global Speed Throttle */}
          <div className="space-y-1.5">
            <label className="text-[11px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider flex items-center space-x-2">
              <Gauge className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
              <span>Global Speed Throttle</span>
            </label>
            <select
              value={settings.globalSpeedLimit}
              onChange={(e) => onUpdateSettings({ globalSpeedLimit: Number(e.target.value) })}
              className="w-full bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 focus:border-blue-500 focus:bg-white dark:focus:bg-slate-900 rounded-xl px-3 py-2.5 text-slate-800 dark:text-slate-100 text-xs focus:outline-none cursor-pointer font-mono"
            >
              <option value={0}>Unlimited (Full Speed Bypass)</option>
              <option value={2000000}>2 MB/s Throttle</option>
              <option value={5000000}>5 MB/s Throttle</option>
              <option value={10000000}>10 MB/s Throttle</option>
              <option value={25000000}>25 MB/s Throttle</option>
            </select>
          </div>

          {/* Default Save Folder */}
          <div className="space-y-1.5">
            <label className="text-[11px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider flex items-center space-x-2">
              <HardDrive className="h-3.5 w-3.5 text-slate-600 dark:text-slate-400" />
              <span>Default Download Path</span>
            </label>
            <input
              type="text"
              value={displaySavePath}
              onChange={(e) => {
                const value = e.target.value;
                setDisplaySavePath(value);
                onUpdateSettings({ defaultSavePath: value });
              }}
              onBlur={() => {
                void resolveDownloadPath(settings.defaultSavePath)
                  .then(setDisplaySavePath)
                  .catch(() => setDisplaySavePath(settings.defaultSavePath));
              }}
              className="w-full bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 focus:border-blue-500 focus:bg-white dark:focus:bg-slate-900 rounded-xl px-3 py-2.5 text-slate-800 dark:text-slate-100 font-mono text-xs focus:outline-none transition-all"
            />
          </div>

          {/* librqbit Stealth Traffic & Privacy Configuration */}
          <div className="bg-teal-50/80 dark:bg-teal-950/40 border border-teal-200 dark:border-teal-900/60 rounded-xl p-4 space-y-3">
            <div className="flex items-center space-x-2 text-teal-800 dark:text-teal-300 font-bold">
              <ShieldCheck className="h-4 w-4 text-teal-600 dark:text-teal-400" />
              <span>librqbit Stealth Protocol & Network Privacy</span>
            </div>
            
            <p className="text-[11px] text-teal-700/80 dark:text-teal-300/80 leading-relaxed">
              Enables packet-level header encryption, non-standard listening ports, and client ID anonymization for BitTorrent traffic.
            </p>

            <p className="text-[11px] text-amber-700/90 dark:text-amber-300/90 leading-relaxed">
              <strong>Torrents only:</strong> Encryption, DHT rules, and custom listening ports apply to BitTorrent connections.
            </p>

            <div className="space-y-2 pt-1 text-slate-700 dark:text-slate-300">
              <label className="flex items-center space-x-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={settings.stealthEnabled}
                  onChange={(e) => onUpdateSettings({ stealthEnabled: e.target.checked })}
                  className="rounded border-teal-300 text-teal-600 focus:ring-teal-500 h-4 w-4 cursor-pointer"
                />
                <span className="font-semibold text-slate-800 dark:text-slate-200">
                  Enable High-Stealth Traffic Masking Mode
                </span>
              </label>

              <label className="flex items-center space-x-2 cursor-pointer pl-6">
                <input
                  type="checkbox"
                  checked={settings.protocolEncryptionRequired}
                  onChange={(e) => onUpdateSettings({ protocolEncryptionRequired: e.target.checked })}
                  className="rounded border-teal-300 text-teal-600 focus:ring-teal-500 h-3.5 w-3.5 cursor-pointer"
                />
                <span className="text-slate-600 dark:text-slate-400 text-xs">
                  Force MSE/PE Header Encryption (Reject plaintext peers)
                </span>
              </label>

              <label className="flex items-center space-x-2 cursor-pointer pl-6">
                <input
                  type="checkbox"
                  checked={settings.anonymousMode ?? true}
                  onChange={(e) => onUpdateSettings({ anonymousMode: e.target.checked })}
                  className="rounded border-teal-300 text-teal-600 focus:ring-teal-500 h-3.5 w-3.5 cursor-pointer"
                />
                <span className="text-slate-600 dark:text-slate-400 text-xs">
                  Anonymous Mode (Masks Peer ID fingerprint & sanitizes User-Agent)
                </span>
              </label>

              <label className="flex items-center space-x-2 cursor-pointer pl-6">
                <input
                  type="checkbox"
                  checked={settings.disableDht ?? false}
                  onChange={(e) => onUpdateSettings({ disableDht: e.target.checked })}
                  className="rounded border-teal-300 text-teal-600 focus:ring-teal-500 h-3.5 w-3.5 cursor-pointer"
                />
                <span className="text-slate-600 dark:text-slate-400 text-xs">
                  Disable DHT / Public Discovery (Strict Tracker Mode for Private Trackers)
                </span>
              </label>
            </div>

            {/* Custom Listening Port Configuration */}
            <div className="pt-2 border-t border-teal-200/60 dark:border-teal-900/60 space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="font-semibold text-slate-800 dark:text-slate-200">
                  Incoming Listening Port
                </span>
                <button
                  type="button"
                  onClick={() => {
                    const randomPort = Math.floor(Math.random() * (65535 - 49152 + 1)) + 49152;
                    onUpdateSettings({ torrentListenPort: randomPort });
                  }}
                  className="text-[11px] font-medium text-teal-700 dark:text-teal-300 hover:text-teal-900 dark:hover:text-teal-100 flex items-center space-x-1 cursor-pointer"
                >
                  <Shuffle className="h-3 w-3 inline" />
                  <span>Randomize Port</span>
                </button>
              </div>

              <div className="flex items-center space-x-2">
                <input
                  type="number"
                  min={1024}
                  max={65535}
                  value={settings.torrentListenPort ?? 51413}
                  onChange={(e) => {
                    const val = parseInt(e.target.value, 10);
                    if (!isNaN(val) && val >= 1024 && val <= 65535) {
                      onUpdateSettings({ torrentListenPort: val });
                    }
                  }}
                  className="w-28 bg-white dark:bg-slate-900 border border-teal-300 dark:border-teal-800 rounded-lg px-2.5 py-1.5 text-xs font-mono text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-1 focus:ring-teal-500"
                />
                <label className="flex items-center space-x-1.5 cursor-pointer text-[11px] text-slate-600 dark:text-slate-400">
                  <input
                    type="checkbox"
                    checked={settings.torrentRandomizePort ?? false}
                    onChange={(e) => onUpdateSettings({ torrentRandomizePort: e.target.checked })}
                    className="rounded border-teal-300 text-teal-600 focus:ring-teal-500 h-3.5 w-3.5 cursor-pointer"
                  />
                  <span>Randomize on launch (49152–65535)</span>
                </label>
              </div>
            </div>
          </div>

          {/* Checkbox Options */}
          <div className="space-y-3 pt-2">
            <label className="flex items-center space-x-3 cursor-pointer p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700/80 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors">
              <input
                type="checkbox"
                checked={settings.hardwareAcceleration ?? true}
                onChange={(e) => onUpdateSettings({ hardwareAcceleration: e.target.checked })}
                className="rounded border-slate-300 dark:border-slate-700 text-blue-600 focus:ring-blue-500 h-4 w-4 cursor-pointer"
              />
              <div className="flex flex-col">
                <span className="text-slate-800 dark:text-slate-200 font-semibold flex items-center space-x-1.5 text-xs">
                  <Zap className="h-3.5 w-3.5 text-amber-500" />
                  <span>Hardware Acceleration (GPU/CPU Offloading)</span>
                </span>
                <span className="text-[11px] text-slate-500 dark:text-slate-400">
                  Adjusts download engine thread pool handling & socket polling to reduce CPU overhead during active transfers
                </span>
              </div>
            </label>

            <label className="flex items-center space-x-3 cursor-pointer p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700/80 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors">
              <input
                type="checkbox"
                checked={settings.minimizeToTaskbar ?? true}
                onChange={(e) => onUpdateSettings({ minimizeToTaskbar: e.target.checked })}
                className="rounded border-slate-300 dark:border-slate-700 text-blue-600 focus:ring-blue-500 h-4 w-4 cursor-pointer"
              />
              <div className="flex flex-col">
                <span className="text-slate-800 dark:text-slate-200 font-semibold flex items-center space-x-1.5 text-xs">
                  <Minimize2 className="h-3.5 w-3.5 text-blue-500" />
                  <span>Minimize to Taskbar / System Tray</span>
                </span>
                <span className="text-[11px] text-slate-500 dark:text-slate-400">
                  Keep active downloads running in background tray when window is minimized
                </span>
              </div>
            </label>

            <label className="flex items-center space-x-3 cursor-pointer">
              <input
                type="checkbox"
                checked={settings.autoStartNext}
                onChange={(e) => onUpdateSettings({ autoStartNext: e.target.checked })}
                className="rounded border-slate-300 dark:border-slate-700 text-blue-600 focus:ring-blue-500 h-4 w-4 cursor-pointer"
              />
              <span className="text-slate-700 dark:text-slate-300 font-medium">Auto-start queued items when slots become available</span>
            </label>

            <label className="flex items-center space-x-3 cursor-pointer">
              <input
                type="checkbox"
                checked={settings.soundNotifications}
                onChange={(e) => onUpdateSettings({ soundNotifications: e.target.checked })}
                className="rounded border-slate-300 dark:border-slate-700 text-blue-600 focus:ring-blue-500 h-4 w-4 cursor-pointer"
              />
              <span className="text-slate-700 dark:text-slate-300 font-medium flex items-center space-x-1.5">
                <Volume2 className="h-3.5 w-3.5 text-amber-500" />
                <span>Play audio chime and show notification toast on completion</span>
              </span>
            </label>
          </div>

          {/* File Associations */}
          {isTauri && (
            <div className="space-y-1.5">
              <label className="text-[11px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider flex items-center space-x-2">
                <Link className="h-3.5 w-3.5 text-violet-500" />
                <span>File Associations</span>
              </label>
              <div className="bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-xl p-3 space-y-2">
                <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
                  Register FlowDown as the default handler for torrent files and magnet links on your system.
                  <span className="block mt-0.5 text-[10.5px] text-slate-400 dark:text-slate-500 italic">
                    (On macOS, associations are automatically handled by the application bundle).
                  </span>
                </p>

                {/* .torrent row */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-2">
                    <FileType className="h-3.5 w-3.5 text-violet-500 shrink-0" />
                    <div>
                      <p className="text-xs font-semibold text-slate-700 dark:text-slate-200">.torrent files</p>
                      {torrentAssocStatus === 'registered' && (
                        <p className="text-[11px] text-emerald-600 dark:text-emerald-400">✓ Registered successfully</p>
                      )}
                      {torrentAssocStatus === 'removed' && (
                        <p className="text-[11px] text-slate-500 dark:text-slate-400">Association removed</p>
                      )}
                      {torrentAssocStatus === 'error' && (
                        <p className="text-[11px] text-red-500 dark:text-red-400">Failed — try again</p>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center space-x-1.5">
                    <button
                      type="button"
                      disabled={torrentAssocActive}
                      onClick={() => handleAssociation('torrent', true)}
                      className="px-2.5 py-1 rounded-lg bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white text-[11px] font-semibold transition-colors cursor-pointer"
                    >
                      {torrentAssocActive ? '…' : 'Register'}
                    </button>
                    <button
                      type="button"
                      disabled={torrentAssocActive}
                      onClick={() => handleAssociation('torrent', false)}
                      className="px-2.5 py-1 rounded-lg bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 dark:hover:bg-slate-600 disabled:opacity-50 text-slate-700 dark:text-slate-300 text-[11px] font-semibold transition-colors cursor-pointer"
                    >
                      Remove
                    </button>
                  </div>
                </div>

                {/* magnet row */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-2">
                    <Link className="h-3.5 w-3.5 text-violet-500 shrink-0" />
                    <div>
                      <p className="text-xs font-semibold text-slate-700 dark:text-slate-200">magnet: links</p>
                      {magnetAssocStatus === 'registered' && (
                        <p className="text-[11px] text-emerald-600 dark:text-emerald-400">✓ Registered successfully</p>
                      )}
                      {magnetAssocStatus === 'removed' && (
                        <p className="text-[11px] text-slate-500 dark:text-slate-400">Association removed</p>
                      )}
                      {magnetAssocStatus === 'error' && (
                        <p className="text-[11px] text-red-500 dark:text-red-400">Failed — try again</p>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center space-x-1.5">
                    <button
                      type="button"
                      disabled={magnetAssocActive}
                      onClick={() => handleAssociation('magnet', true)}
                      className="px-2.5 py-1 rounded-lg bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white text-[11px] font-semibold transition-colors cursor-pointer"
                    >
                      {magnetAssocActive ? '…' : 'Register'}
                    </button>
                    <button
                      type="button"
                      disabled={magnetAssocActive}
                      onClick={() => handleAssociation('magnet', false)}
                      className="px-2.5 py-1 rounded-lg bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 dark:hover:bg-slate-600 disabled:opacity-50 text-slate-700 dark:text-slate-300 text-[11px] font-semibold transition-colors cursor-pointer"
                    >
                      Remove
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Software Updates Section */}
          <div className="space-y-3 pt-2 border-t border-slate-100 dark:border-slate-800">
            <label className="text-[11px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider flex items-center space-x-2">
              <Sparkles className="h-3.5 w-3.5 text-blue-500" />
              <span>Software Updates</span>
            </label>
            <div className="flex items-center justify-between p-3.5 bg-slate-50 dark:bg-slate-800/40 rounded-xl border border-slate-200/80 dark:border-slate-700/80">
              <div>
                <p className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                  Current Version: <span className="font-mono text-blue-600 dark:text-blue-400">v1.0.1</span>
                </p>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                  Channel: GitHub Releases (latest.json)
                </p>
              </div>
              {onCheckForUpdates && (
                <button
                  type="button"
                  onClick={onCheckForUpdates}
                  disabled={isCheckingUpdates}
                  className="px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-xs font-semibold transition-colors flex items-center space-x-1.5 cursor-pointer"
                >
                  <Sparkles className={`h-3.5 w-3.5 ${isCheckingUpdates ? 'animate-spin' : ''}`} />
                  <span>{isCheckingUpdates ? 'Checking...' : 'Check Now'}</span>
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-slate-200 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-800/80 flex justify-end">
          <button
            onClick={onClose}
            className="px-5 py-2.5 rounded-full bg-blue-600 hover:bg-blue-700 text-white font-semibold text-xs transition-colors shadow-xs flex items-center space-x-2"
          >
            <Check className="h-4 w-4" />
            <span>Save Settings</span>
          </button>
        </div>
      </div>
    </div>
  );
};

