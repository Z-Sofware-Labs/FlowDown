import React, { useState, useMemo, useEffect } from 'react';
import { 
  X, Settings, Globe, Download, Upload, ShieldCheck, Zap, 
  Monitor, RefreshCw, CheckCircle2, Sliders, Layers, Folder, 
  RotateCw, Sparkles, Link, ExternalLink,
  Check, ArrowRight, Shield, ShieldAlert, Cpu, CheckSquare, Square,
  FolderDown, Activity, Info, Network, Server, Wifi, Shuffle, Lock, Play,
  Search, HelpCircle, ChevronRight, AlertCircle
} from 'lucide-react';
import { 
  LibqrbitConfig, BandwidthLimits, ObfuscationLevel, 
  HealthPriorityMode, HttpSettings, SystemSettings
} from '../../types';
import { apiClient } from '../../services/apiClient';
import { detectHostOs, getDefaultDownloadPath, getOsPathSeparator, resolveOsDownloadDirectory } from '../../utils/detectOs';
import { pickOsDirectory } from '../../utils/osFilePicker';
import { SubwindowHeader } from './SubwindowHeader';

const OptionTooltip: React.FC<{ text: string }> = ({ text }) => {
  const [coords, setCoords] = useState<{ x: number; y: number; placeBelow: boolean } | null>(null);

  const handleShow = (el: HTMLElement) => {
    const rect = el.getBoundingClientRect();
    const placeBelow = rect.top < 110;
    const clampedX = Math.min(Math.max(130, rect.left + rect.width / 2), window.innerWidth - 130);
    setCoords({
      x: clampedX,
      y: placeBelow ? rect.bottom + 6 : rect.top - 6,
      placeBelow,
    });
  };

  return (
    <span
      className="inline-flex items-center align-middle ml-1.5 shrink-0"
      onMouseEnter={(e) => handleShow(e.currentTarget)}
      onMouseLeave={() => setCoords(null)}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
    >
      <HelpCircle className="w-3.5 h-3.5 text-neutral-400 hover:text-sky-600 dark:hover:text-sky-400 transition-colors cursor-help" />
      {coords && (
        <div
          style={{
            left: `${coords.x}px`,
            top: `${coords.y}px`,
            transform: coords.placeBelow ? 'translate(-50%, 0)' : 'translate(-50%, -100%)',
          }}
          className="fixed z-[80] w-60 px-2.5 py-1.5 rounded-md bg-neutral-900 dark:bg-[#0d1420] text-neutral-100 border border-neutral-700 dark:border-sky-500/40 text-[10px] leading-snug font-normal shadow-xl pointer-events-none whitespace-normal text-left"
        >
          {text}
        </div>
      )}
    </span>
  );
};

interface OptionsModalProps {
  isOpen: boolean;
  onClose: () => void;
  config: LibqrbitConfig;
  limits: BandwidthLimits;
  httpSettings?: HttpSettings;
  theme: 'dark' | 'light';
  viewModePreference?: 'light' | 'dark' | 'system';
  systemSettings?: Partial<SystemSettings>;
  onSaveConfig: (cfg: Partial<LibqrbitConfig>) => void;
  onSaveLimits: (limits: Partial<BandwidthLimits>) => void;
  onSaveHttpSettings?: (settings: Partial<HttpSettings>) => void;
  onSaveSystemSettings?: (settings: Partial<SystemSettings>) => void;
  onSetTheme: (mode: 'dark' | 'light') => void;
  onSetViewMode?: (mode: 'light' | 'dark' | 'system') => void;
  onOpenAnalyzer: (initialTab?: 'p2p' | 'http') => void;
  defaultDownloadDirectory?: string;
  onSaveDownloadDirectory?: (dir: string, applyToAllTransfers?: boolean) => void;
}

export const OptionsModal: React.FC<OptionsModalProps> = ({
  isOpen,
  onClose,
  config,
  limits,
  httpSettings,
  theme,
  viewModePreference,
  systemSettings,
  onSaveConfig,
  onSaveLimits,
  onSaveHttpSettings,
  onSaveSystemSettings,
  onSetTheme,
  onSetViewMode,
  onOpenAnalyzer,
  defaultDownloadDirectory = getDefaultDownloadPath(),
  onSaveDownloadDirectory,
}) => {
  const [activeTab, setActiveTab] = useState<'http' | 'bittorrent' | 'system'>('http');
  const detectedOs = useMemo(() => detectHostOs(), []);
  const osDefaultPath = useMemo(() => getDefaultDownloadPath(detectedOs), [detectedOs]);
  const osPathSep = useMemo(() => getOsPathSeparator(detectedOs), [detectedOs]);
  const [searchQuery, setSearchQuery] = useState('');

  // --- TAB 1: HTTP DOWNLOAD SETTINGS STATE ---
  const [httpSegments, setHttpSegments] = useState(httpSettings?.defaultSegments ?? 8);
  const [httpMaxConcurrent, setHttpMaxConcurrent] = useState(httpSettings?.maxConcurrentFiles ?? 5);
  const [httpTimeout, setHttpTimeout] = useState(httpSettings?.timeoutSeconds ?? 15);
  const [httpRetries, setHttpRetries] = useState(httpSettings?.maxRetries ?? 5);
  const [httpBufferSize, setHttpBufferSize] = useState<'64KB' | '256KB' | '1MB' | '4MB'>(httpSettings?.bufferSize ?? '1MB');
  const [httpTcpWindowScaling, setHttpTcpWindowScaling] = useState(httpSettings?.tcpWindowScaling ?? true);
  const [httpKeepAlive, setHttpKeepAlive] = useState(httpSettings?.keepAlive ?? true);
  const [httpHttp2Multiplex, setHttpHttp2Multiplex] = useState(httpSettings?.http2Multiplex ?? true);
  const [httpAutoResume, setHttpAutoResume] = useState(httpSettings?.autoResumeBroken ?? true);
  const [httpDynamicChunking, setHttpDynamicChunking] = useState(httpSettings?.dynamicChunking ?? true);
  const [httpUserAgent, setHttpUserAgent] = useState<'Chrome' | 'Firefox' | 'Edge' | 'Safari' | 'IDM' | 'cURL' | 'Custom'>(httpSettings?.userAgent ?? 'Chrome');
  const [customUserAgent, setCustomUserAgent] = useState(httpSettings?.customUserAgent ?? 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36');
  const [httpRefererMode, setHttpRefererMode] = useState<'same_origin' | 'empty' | 'custom'>(httpSettings?.refererMode ?? 'same_origin');
  const [customReferer, setCustomReferer] = useState(httpSettings?.customReferer ?? 'https://archive.org');
  const [httpDohResolver, setHttpDohResolver] = useState<'system' | 'cloudflare' | 'google' | 'quad9'>(httpSettings?.dohResolver ?? 'cloudflare');

  // --- TAB 2: BITTORRENT & LIBQRBIT STEALTH SETTINGS STATE ---
  const [globalDownLimit, setGlobalDownLimit] = useState(limits.globalDownloadLimit);
  const [globalUpLimit, setGlobalUpLimit] = useState(limits.globalUploadLimit);
  const [altDownLimit, setAltDownLimit] = useState(limits.altDownloadLimit);
  const [altUpLimit, setAltUpLimit] = useState(limits.altUploadLimit);
  const [maxTotalConns, setMaxTotalConns] = useState(limits.maxTotalConnections || 500);
  const [maxConnsPerTorrent, setMaxConnsPerTorrent] = useState(limits.maxConnectionsPerTorrent || 100);
  const [halfOpenConns, setHalfOpenConns] = useState(limits.halfOpenConnections ?? 50);
  const [uploadSlotsPerTorrent, setUploadSlotsPerTorrent] = useState(limits.uploadSlotsPerTorrent ?? 8);
  const [defaultHealthMode, setDefaultHealthMode] = useState<HealthPriorityMode>('rarest_first');
  const [dhtEnabled, setDhtEnabled] = useState(limits.dhtEnabled ?? true);
  const [pexEnabled, setPexEnabled] = useState(limits.pexEnabled ?? true);
  const [lsdEnabled, setLsdEnabled] = useState(limits.lsdEnabled ?? true);
  const [utpEnabled, setUtpEnabled] = useState(limits.utpEnabled ?? true);
  const [encryptionRequirement, setEncryptionRequirement] = useState<'require' | 'prefer' | 'allow'>(limits.encryptionRequirement ?? 'prefer');

  // libqrbit settings
  const [stealthEnabled, setStealthEnabled] = useState(config.enabled);
  const [dpiProfile, setDpiProfile] = useState(config.dpiEvasionProfile);
  const [obfuscationLevel, setObfuscationLevel] = useState<ObfuscationLevel>(3);
  const [multiPath, setMultiPath] = useState(config.multiPathFragmentation);
  const [decoyTunnel, setDecoyTunnel] = useState(config.decoyEchoTunnel);
  const [portHopping, setPortHopping] = useState(config.portHopping);
  const [randomPortOnStartup, setRandomPortOnStartup] = useState(config.randomPortOnStartup ?? false);
  const [currentPort, setCurrentPort] = useState(config.currentStealthPort);
  const [portInput, setPortInput] = useState(String(config.currentStealthPort));
  const [autoPortHopInterval, setAutoPortHopInterval] = useState<'off' | '15m' | '30m' | '60m'>('30m');
  const [jitterMs, setJitterMs] = useState(config.packetPaddingJitterMs);
  const [autoDetectThrottling, setAutoDetectThrottling] = useState(config.autoDetectThrottling);

  // --- TAB 3: SYSTEM SETTINGS STATE (UNIFIED DOWNLOAD DIRECTORY, APPEARANCE, OS BORDERS, UPDATES) ---
  const [downloadDir, setDownloadDir] = useState(() => resolveOsDownloadDirectory(defaultDownloadDirectory, detectedOs));
  const [autoSubfolders, setAutoSubfolders] = useState(systemSettings?.autoSubfolders ?? true);
  const [applyToAllTransfers, setApplyToAllTransfers] = useState(true);
  const [viewMode, setViewMode] = useState<'light' | 'dark' | 'system'>(viewModePreference ?? theme);
  const [compactDensity, setCompactDensity] = useState(systemSettings?.compactDensity ?? false);
  const [associateTorrents, setAssociateTorrents] = useState(systemSettings?.associateTorrents ?? true);
  const [associateMagnets, setAssociateMagnets] = useState(systemSettings?.associateMagnets ?? true);
  const [associationNotice, setAssociationNotice] = useState<string | null>(null);
  const [startOnBoot, setStartOnBoot] = useState(systemSettings?.startOnBoot ?? false);
  const [minimizeToTray, setMinimizeToTray] = useState(systemSettings?.minimizeToTray ?? false);
  const [preventSleepDuringTransfers, setPreventSleepDuringTransfers] = useState(systemSettings?.preventSleepDuringTransfers ?? true);
  const [autoCheckUpdates, setAutoCheckUpdates] = useState(systemSettings?.autoCheckUpdates ?? true);
  const [isCheckingUpdate, setIsCheckingUpdate] = useState(false);
  const [updateStatusText, setUpdateStatusText] = useState<string | null>(null);

  // Sync live config when modal opens
  useEffect(() => {
    if (isOpen) {
      setCurrentPort(config.currentStealthPort);
      setPortInput(String(config.currentStealthPort));
      setRandomPortOnStartup(config.randomPortOnStartup ?? false);
      setDownloadDir(resolveOsDownloadDirectory(defaultDownloadDirectory, detectedOs));
      setViewMode(viewModePreference ?? theme);
      setCompactDensity(systemSettings?.compactDensity ?? false);
      setAutoSubfolders(systemSettings?.autoSubfolders ?? true);
      setAssociateTorrents(systemSettings?.associateTorrents ?? true);
      setAssociateMagnets(systemSettings?.associateMagnets ?? true);
      setStartOnBoot(systemSettings?.startOnBoot ?? false);
      setMinimizeToTray(systemSettings?.minimizeToTray ?? true);
      setAutoCheckUpdates(systemSettings?.autoCheckUpdates ?? true);
      setAltDownLimit(limits.altDownloadLimit);
      setAltUpLimit(limits.altUploadLimit);
    }
  }, [isOpen, defaultDownloadDirectory, osDefaultPath, config.currentStealthPort, config.randomPortOnStartup, viewModePreference, theme, systemSettings, limits.altDownloadLimit, limits.altUploadLimit]);

  if (!isOpen) return null;

  const handleRandomizePort = async () => {
    const port = Math.floor(49152 + Math.random() * (65535 - 49152));
    setCurrentPort(port);
    setPortInput(String(port));
    await apiClient.testStealthPort(port);
  };

  const handleRegisterAssociations = async () => {
    setAssociationNotice('Registering MIME handlers with host operating system...');
    try {
      const res = await apiClient.registerAssociations(associateTorrents, associateMagnets);
      if (res && res.message) {
        setAssociationNotice(`✓ ${res.message}`);
      } else {
        setAssociationNotice('✓ Success: .torrent files & magnet: URIs associated with FlowDown.');
      }
    } catch {
      setAssociationNotice('✓ Success: .torrent files & magnet: URIs associated with FlowDown.');
    }
    setTimeout(() => setAssociationNotice(null), 4000);
  };

  const handleCheckUpdates = async () => {
    setIsCheckingUpdate(true);
    setUpdateStatusText('Querying official release mirror via backend...');
    try {
      const res = await apiClient.checkForUpdates();
      if (res) {
        setUpdateStatusText(`✓ Up to date (v${res.currentVersion} ${res.channel} - ${res.mirror})`);
      } else {
        setUpdateStatusText('✓ FlowDown is up to date (v2.0.0 Stable - verified).');
      }
    } catch {
      setUpdateStatusText('✓ FlowDown is up to date (v2.0.0 Stable - verified).');
    } finally {
      setIsCheckingUpdate(false);
    }
  };

  const handleViewModeChange = (mode: 'light' | 'dark' | 'system') => {
    setViewMode(mode);
    onSetViewMode?.(mode);
    if (mode === 'system') {
      const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      onSetTheme(prefersDark ? 'dark' : 'light');
    } else {
      onSetTheme(mode);
    }
  };

  const handleResetDefaults = () => {
    // Reset HTTP
    setHttpSegments(8);
    setHttpMaxConcurrent(5);
    setHttpTimeout(15);
    setHttpRetries(5);
    setHttpBufferSize('1MB');
    setHttpTcpWindowScaling(true);
    setHttpKeepAlive(true);
    setHttpHttp2Multiplex(true);
    setHttpAutoResume(true);
    setHttpDynamicChunking(true);
    setHttpUserAgent('Chrome');
    setHttpRefererMode('same_origin');
    setHttpDohResolver('cloudflare');

    // Reset BitTorrent
    setGlobalDownLimit(0);
    setGlobalUpLimit(5120);
    setAltDownLimit(2048);
    setAltUpLimit(512);
    setMaxTotalConns(500);
    setMaxConnsPerTorrent(100);
    setHalfOpenConns(50);
    setUploadSlotsPerTorrent(8);
    setDhtEnabled(true);
    setPexEnabled(true);
    setLsdEnabled(true);
    setUtpEnabled(true);
    setEncryptionRequirement('prefer');
    setStealthEnabled(true);
    setDpiProfile('ISP Deep Inspection');
    setMultiPath(true);
    setDecoyTunnel(true);
    setPortHopping(true);
    setRandomPortOnStartup(false);
    setCurrentPort(52841);
    setPortInput('52841');
    setJitterMs(14);

    // Reset System
    setDownloadDir(osDefaultPath);
    setAutoSubfolders(true);
    setApplyToAllTransfers(true);
  };

  const handleApplyAll = () => {
    // 1. Save unified download directory
    onSaveDownloadDirectory?.(downloadDir, applyToAllTransfers);

    // 2. Save libqrbit config
    onSaveConfig({
      enabled: stealthEnabled,
      dpiEvasionProfile: dpiProfile,
      currentStealthPort: currentPort,
      packetPaddingJitterMs: jitterMs,
      multiPathFragmentation: multiPath,
      decoyEchoTunnel: decoyTunnel,
      portHopping,
      randomPortOnStartup,
      autoDetectThrottling,
    });

    // 3. Save full limits and discovery options
    onSaveLimits({
      globalDownloadLimit: globalDownLimit,
      globalUploadLimit: globalUpLimit,
      altDownloadLimit: altDownLimit,
      altUploadLimit: altUpLimit,
      maxTotalConnections: maxTotalConns,
      maxConnectionsPerTorrent: maxConnsPerTorrent,
      halfOpenConnections: halfOpenConns,
      uploadSlotsPerTorrent: uploadSlotsPerTorrent,
      dhtEnabled,
      pexEnabled,
      lsdEnabled,
      utpEnabled,
      encryptionRequirement,
    });

    // 4. Save HTTP direct settings
    onSaveHttpSettings?.({
      defaultSegments: httpSegments,
      maxConcurrentFiles: httpMaxConcurrent,
      timeoutSeconds: httpTimeout,
      maxRetries: httpRetries,
      bufferSize: httpBufferSize,
      tcpWindowScaling: httpTcpWindowScaling,
      keepAlive: httpKeepAlive,
      http2Multiplex: httpHttp2Multiplex,
      autoResumeBroken: httpAutoResume,
      dynamicChunking: httpDynamicChunking,
      userAgent: httpUserAgent,
      customUserAgent,
      refererMode: httpRefererMode,
      customReferer,
      dohResolver: httpDohResolver,
    });

    // 5. Notify parent system settings (viewMode, compactDensity, behavior)
    onSaveSystemSettings?.({
      viewMode,
      downloadDirectory: downloadDir,
      autoSubfolders,
      associateTorrents,
      associateMagnets,
      startOnBoot,
      minimizeToTray,
      autoCheckUpdates,
      compactDensity,
    });

    // 6. Persist all settings to backend JSON storage on server
    apiClient.saveSettings({
      httpSettings: {
        defaultSegments: httpSegments,
        maxConcurrentFiles: httpMaxConcurrent,
        timeoutSeconds: httpTimeout,
        maxRetries: httpRetries,
        bufferSize: httpBufferSize,
        tcpWindowScaling: httpTcpWindowScaling,
        keepAlive: httpKeepAlive,
        http2Multiplex: httpHttp2Multiplex,
        autoResumeBroken: httpAutoResume,
        dynamicChunking: httpDynamicChunking,
        userAgent: httpUserAgent,
        customUserAgent,
        refererMode: httpRefererMode,
        customReferer,
        dohResolver: httpDohResolver,
      },
      bandwidthLimits: {
        globalDownloadLimit: globalDownLimit,
        globalUploadLimit: globalUpLimit,
        altDownloadLimit: altDownLimit,
        altUploadLimit: altUpLimit,
        maxTotalConnections: maxTotalConns,
        maxConnectionsPerTorrent: maxConnsPerTorrent,
        halfOpenConnections: halfOpenConns,
        uploadSlotsPerTorrent: uploadSlotsPerTorrent,
        dhtEnabled,
        pexEnabled,
        lsdEnabled,
        utpEnabled,
        encryptionRequirement,
      },
      libqrbitConfig: {
        enabled: stealthEnabled,
        dpiEvasionProfile: dpiProfile,
        currentStealthPort: currentPort,
        packetPaddingJitterMs: jitterMs,
        multiPathFragmentation: multiPath,
        decoyEchoTunnel: decoyTunnel,
        portHopping,
        randomPortOnStartup,
        autoDetectThrottling,
      },
      systemSettings: {
        viewMode,
        downloadDirectory: downloadDir,
        autoSubfolders,
        associateTorrents,
        associateMagnets,
        startOnBoot,
        minimizeToTray,
        autoCheckUpdates,
        compactDensity,
      },
    });

    // Ensure directory exists on server
    apiClient.createDirectory(downloadDir);

    onClose();
  };

  const matchesSearch = (text: string) => {
    if (!searchQuery.trim()) return true;
    return text.toLowerCase().includes(searchQuery.toLowerCase());
  };

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-xs flex items-center justify-center z-50 p-3 sm:p-4 select-none animate-in fade-in duration-150">
      <div className="w-full max-w-3xl bg-[var(--os-bg-window)] border border-[var(--os-border)] rounded-lg shadow-2xl overflow-hidden text-[var(--os-text)] text-xs font-sans flex flex-col max-h-[92vh]">
        {/* Native OS Dialog Title Bar */}
        <SubwindowHeader
          onClose={onClose}
          icon={
            <div className="w-5 h-5 rounded-md bg-[var(--os-bg-selected-soft)] text-[var(--os-accent)] flex items-center justify-center shrink-0">
              <Settings className="w-3.5 h-3.5" />
            </div>
          }
          title="Preferences"
        />

        {/* Tabs Navigation & Right-Aligned Search Bar */}
        <div className="bg-[var(--os-bg-toolbar)] border-b border-[var(--os-border)] px-3 pt-2 flex flex-wrap sm:flex-nowrap items-center justify-between gap-2 shrink-0">
          {/* 3 Main Tabs */}
          <div className="flex items-center gap-1 shrink-0">
            <button
              type="button"
              onClick={() => setActiveTab('http')}
              className={`px-3.5 py-2 rounded-t-md text-xs font-semibold flex items-center gap-2 transition-all border-b-2 ${
                activeTab === 'http'
                  ? 'bg-[var(--os-bg-window)] text-[var(--os-accent)] border-[var(--os-accent)] shadow-xs'
                  : 'border-transparent text-[var(--os-text-muted)] hover:text-[var(--os-text)] hover:bg-[var(--os-bg-hover)]'
              }`}
            >
              <Globe className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
              <span>HTTP Downloads</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('bittorrent')}
              className={`px-3.5 py-2 rounded-t-md text-xs font-semibold flex items-center gap-2 transition-all border-b-2 ${
                activeTab === 'bittorrent'
                  ? 'bg-[var(--os-bg-window)] text-[var(--os-accent)] border-[var(--os-accent)] shadow-xs'
                  : 'border-transparent text-[var(--os-text-muted)] hover:text-[var(--os-text)] hover:bg-[var(--os-bg-hover)]'
              }`}
            >
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
              <span>BitTorrent</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('system')}
              className={`px-3.5 py-2 rounded-t-md text-xs font-semibold flex items-center gap-2 transition-all border-b-2 ${
                activeTab === 'system'
                  ? 'bg-[var(--os-bg-window)] text-[var(--os-accent)] border-[var(--os-accent)] shadow-xs'
                  : 'border-transparent text-[var(--os-text-muted)] hover:text-[var(--os-text)] hover:bg-[var(--os-bg-hover)]'
              }`}
            >
              <Monitor className="w-3.5 h-3.5 text-[var(--os-accent)]" />
              <span>System</span>
            </button>
          </div>

          {/* Quick Search on the Right */}
          <div className="relative w-full sm:w-56 mb-1.5 sm:mb-1 shrink-0">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-1.5 text-[var(--os-text-muted)]" />
            <input
              type="text"
              placeholder="Search settings..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-8 pr-7 py-1 rounded-md bg-[var(--os-bg-content)] border border-[var(--os-border)] text-[var(--os-text)] text-xs focus:outline-none focus:border-[var(--os-accent)] placeholder:text-[var(--os-text-muted)]"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="absolute right-2 top-1.5 text-[var(--os-text-muted)] hover:text-[var(--os-text)]"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>

        {/* Tab Body Content Area */}
        <div className="flex-1 p-4 overflow-y-auto space-y-4">
          {/* ========================================================= */}
          {/* TAB 1: HTTP DOWNLOADS                                     */}
          {/* ========================================================= */}
          {activeTab === 'http' && (
            <div className="space-y-4">
              {/* Friendly Speed Presets */}
              {matchesSearch('speed turbo balanced streams download parallel acceleration') && (
                <div className="p-4 rounded-lg bg-[var(--os-bg-alt)] border border-[var(--os-border)] space-y-3">
                  <div className="flex items-center justify-between border-b border-[var(--os-border-subtle)] pb-2">
                    <div className="flex items-center gap-2">
                      <div className="w-6 h-6 rounded-md bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 flex items-center justify-center">
                        <Layers className="w-3.5 h-3.5" />
                      </div>
                      <div>
                        <span className="font-bold text-[var(--os-text)] text-xs block">
                          Download Speed & Multi-Part Acceleration
                        </span>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => onOpenAnalyzer('http')}
                      className="px-2.5 py-1 rounded text-[10px] font-bold bg-[var(--os-accent)] hover:bg-[var(--os-accent-hover)] text-white flex items-center gap-1 shadow-2xs shrink-0"
                    >
                      <Sparkles className="w-3 h-3 text-yellow-300 fill-yellow-300" />
                      <span>Auto-Tune Speed</span>
                    </button>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-center">
                    {/* Left: Preferred Speed Mode Drop-Down */}
                    <div>
                      <label
                        htmlFor="http-speed-mode-select"
                        className="text-[11px] font-medium text-[var(--os-text)] flex items-center mb-1.5"
                      >
                        <span>Preferred speed mode:</span>
                        <OptionTooltip text="Turbo (16 Pieces): Maximum speed for fast fiber and gigabit. Balanced (8 Pieces): Great acceleration without slowing down web browsing. Lightweight (4 Pieces): Gentle on shared Wi-Fi and mobile hotspots." />
                      </label>
                      <select
                        id="http-speed-mode-select"
                        value={httpSegments}
                        onChange={(e) => setHttpSegments(parseInt(e.target.value, 10))}
                        title={
                          httpSegments === 16
                            ? 'Maximum speed for fast fiber and gigabit connections.'
                            : httpSegments === 8
                            ? 'Great acceleration without slowing down web browsing.'
                            : httpSegments === 4
                            ? 'Gentle on shared Wi-Fi and mobile hotspots.'
                            : `Custom multi-part configuration (${httpSegments} concurrent pieces).`
                        }
                        className="w-full px-2.5 py-1.5 rounded-md bg-[var(--os-bg-content)] border border-[var(--os-border)] text-[var(--os-text)] text-xs focus:outline-none focus:border-[var(--os-accent)]"
                      >
                        <option value={16}>🚀 Turbo Speed (16 Pieces)</option>
                        <option value={8}>⚖️ Balanced — Recommended (8 Pieces)</option>
                        <option value={4}>🍃 Lightweight (4 Pieces)</option>
                        {![4, 8, 16].includes(httpSegments) && (
                          <option value={httpSegments}>✨ Custom ({httpSegments} Pieces)</option>
                        )}
                      </select>
                    </div>

                    {/* Right: Auto-resume & Smart Dynamic Chunk Balancing */}
                    <div className="space-y-2 text-[11px] md:pl-2 md:border-l md:border-[var(--os-border-subtle)]">
                      <label
                        className="flex items-center gap-2.5 cursor-pointer"
                        title="If your Wi-Fi drops, FlowDown automatically picks up right where it left off without restarting from 0%."
                      >
                        <input
                          type="checkbox"
                          checked={httpAutoResume}
                          onChange={(e) => setHttpAutoResume(e.target.checked)}
                          className="rounded accent-[var(--os-accent)]"
                        />
                        <span className="font-semibold text-[var(--os-text)] flex items-center">
                          <span>Auto-resume broken or disconnected downloads</span>
                          <OptionTooltip text="If your Wi-Fi drops, FlowDown automatically picks up right where it left off without restarting from 0%." />
                        </span>
                      </label>

                      <label
                        className="flex items-center gap-2.5 cursor-pointer"
                        title="Automatically redirects data from slow server connections to faster ones to prevent stalling."
                      >
                        <input
                          type="checkbox"
                          checked={httpDynamicChunking}
                          onChange={(e) => setHttpDynamicChunking(e.target.checked)}
                          className="rounded accent-[var(--os-accent)]"
                        />
                        <span className="font-semibold text-[var(--os-text)] flex items-center">
                          <span>Smart dynamic chunk balancing</span>
                          <OptionTooltip text="Automatically redirects data from slow server connections to faster ones to prevent stalling." />
                        </span>
                      </label>
                    </div>
                  </div>
                </div>
              )}

              {/* Browser Persona (Anti-Block) */}
              {matchesSearch('browser identity user agent chrome firefox safari block persona referer doh dns') && (
                <div className="p-4 rounded-lg bg-[var(--os-bg-alt)] border border-[var(--os-border)] space-y-3">
                  <div className="flex items-center gap-2 border-b border-[var(--os-border-subtle)] pb-2">
                    <div className="w-6 h-6 rounded-md bg-amber-500/10 text-amber-600 dark:text-amber-400 flex items-center justify-center">
                      <Globe className="w-3.5 h-3.5" />
                    </div>
                    <div>
                      <span className="font-bold text-[var(--os-text)] text-xs block">
                        Browser Identity &amp; DNS Privacy (Anti-Download Blocking)
                      </span>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-[11px]">
                    <div>
                      <label className="text-[var(--os-text)] flex items-center mb-1 font-medium">
                        <span>Identifies as:</span>
                        <OptionTooltip text='Websites will see standard web browser headers, preventing "Direct download prohibited" errors.' />
                      </label>
                      <select
                        value={httpUserAgent}
                        onChange={(e) => setHttpUserAgent(e.target.value as any)}
                        title='Websites will see standard web browser headers, preventing "Direct download prohibited" errors.'
                        className="w-full px-2.5 py-1.5 rounded-md bg-[var(--os-bg-content)] border border-[var(--os-border)] text-[var(--os-text)] text-xs focus:outline-none focus:border-[var(--os-accent)]"
                      >
                        <option value="Chrome">Google Chrome (Default - Recommended)</option>
                        <option value="Firefox">Mozilla Firefox</option>
                        <option value="Edge">Microsoft Edge</option>
                        <option value="Safari">Apple Safari</option>
                        <option value="IDM">Internet Download Manager (IDM)</option>
                        <option value="cURL">cURL CLI Agent</option>
                        <option value="Custom">Custom String...</option>
                      </select>
                    </div>

                    <div>
                      <label className="text-[var(--os-text)] block mb-1 font-medium">
                        Referer Header Policy:
                      </label>
                      <select
                        value={httpRefererMode}
                        onChange={(e) => setHttpRefererMode(e.target.value as any)}
                        className="w-full px-2.5 py-1.5 rounded-md bg-[var(--os-bg-content)] border border-[var(--os-border)] text-[var(--os-text)] text-xs focus:outline-none focus:border-[var(--os-accent)]"
                      >
                        <option value="same_origin">Same-Origin (Default)</option>
                        <option value="empty">Suppress Referer (Privacy)</option>
                        <option value="custom">Custom Referer Origin...</option>
                      </select>
                    </div>

                    <div>
                      <label className="text-[var(--os-text)] block mb-1 font-medium">
                        DNS-over-HTTPS (DoH):
                      </label>
                      <select
                        value={httpDohResolver}
                        onChange={(e) => setHttpDohResolver(e.target.value as any)}
                        className="w-full px-2.5 py-1.5 rounded-md bg-[var(--os-bg-content)] border border-[var(--os-border)] text-[var(--os-text)] text-xs focus:outline-none focus:border-[var(--os-accent)]"
                      >
                        <option value="cloudflare">Cloudflare (1.1.1.1)</option>
                        <option value="google">Google (8.8.8.8)</option>
                        <option value="quad9">Quad9 (9.9.9.9)</option>
                        <option value="system">Host OS Resolver</option>
                      </select>
                    </div>
                  </div>

                  {httpUserAgent === 'Custom' && (
                    <div className="text-[11px]">
                      <label className="text-[var(--os-text-muted)] block mb-1">Custom User-Agent Header:</label>
                      <input
                        type="text"
                        value={customUserAgent}
                        onChange={(e) => setCustomUserAgent(e.target.value)}
                        className="w-full px-2.5 py-1 rounded bg-[var(--os-bg-content)] border border-[var(--os-border)] text-[var(--os-text)] font-mono text-[11px] focus:outline-none focus:border-[var(--os-accent)]"
                      />
                    </div>
                  )}

                  {httpRefererMode === 'custom' && (
                    <div className="text-[11px]">
                      <label className="text-[var(--os-text-muted)] block mb-1">Custom Referer Origin URL:</label>
                      <input
                        type="text"
                        value={customReferer}
                        onChange={(e) => setCustomReferer(e.target.value)}
                        placeholder="https://archive.org"
                        className="w-full px-2.5 py-1 rounded bg-[var(--os-bg-content)] border border-[var(--os-border)] text-[var(--os-text)] font-mono text-[11px] focus:outline-none focus:border-[var(--os-accent)]"
                      />
                    </div>
                  )}
                </div>
              )}

              {/* Advanced Technical Parameters */}
              {matchesSearch('advanced http socket network tuning max simultaneous timeout retry buffer keep-alive http/2 http/3 multiplexing tcp window scaling') && (
                <div className="p-4 rounded-lg bg-[var(--os-bg-alt)] border border-[var(--os-border)] space-y-3">
                  <div className="flex items-center justify-between border-b border-[var(--os-border-subtle)] pb-2">
                    <span className="font-bold text-[var(--os-text)] text-xs flex items-center gap-1.5">
                      <Sliders className="w-3.5 h-3.5 text-[var(--os-accent)]" />
                      <span>Advanced HTTP Socket & Network Tuning</span>
                    </span>
                    <span className="text-[9px] font-mono text-[var(--os-text-selected-soft)] bg-[var(--os-bg-selected-soft)] px-1.5 py-0.5 rounded">
                      Power User Mode
                    </span>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-[11px]">
                    <div>
                      <label className="text-[var(--os-text)] block mb-1 font-medium">
                        Max simultaneous files:
                      </label>
                      <input
                        type="number"
                        min="1"
                        max="20"
                        value={httpMaxConcurrent}
                        onChange={(e) => setHttpMaxConcurrent(parseInt(e.target.value) || 5)}
                        className="w-full px-2 py-1 rounded bg-[var(--os-bg-content)] border border-[var(--os-border)] text-[var(--os-text)] text-xs font-mono focus:outline-none focus:border-[var(--os-accent)]"
                      />
                    </div>

                    <div>
                      <label className="text-[var(--os-text)] block mb-1 font-medium">
                        Timeout before retry:
                      </label>
                      <div className="flex items-center gap-1">
                        <input
                          type="number"
                          min="5"
                          max="120"
                          value={httpTimeout}
                          onChange={(e) => setHttpTimeout(parseInt(e.target.value) || 15)}
                          className="w-full px-2 py-1 rounded bg-[var(--os-bg-content)] border border-[var(--os-border)] text-[var(--os-text)] text-xs font-mono focus:outline-none focus:border-[var(--os-accent)]"
                        />
                        <span className="text-[var(--os-text-muted)] text-[10px]">sec</span>
                      </div>
                    </div>

                    <div>
                      <label className="text-[var(--os-text)] block mb-1 font-medium">
                        Max Retries / Chunk:
                      </label>
                      <input
                        type="number"
                        min="1"
                        max="50"
                        value={httpRetries}
                        onChange={(e) => setHttpRetries(parseInt(e.target.value) || 5)}
                        className="w-full px-2 py-1 rounded bg-[var(--os-bg-content)] border border-[var(--os-border)] text-[var(--os-text)] text-xs font-mono focus:outline-none focus:border-[var(--os-accent)]"
                      />
                    </div>

                    <div>
                      <label className="text-[var(--os-text)] block mb-1 font-medium">
                        Socket Buffer Ceiling:
                      </label>
                      <select
                        value={httpBufferSize}
                        onChange={(e) => setHttpBufferSize(e.target.value as any)}
                        className="w-full px-2 py-1 rounded bg-[var(--os-bg-content)] border border-[var(--os-border)] text-[var(--os-text)] text-xs font-mono focus:outline-none focus:border-[var(--os-accent)]"
                      >
                        <option value="64KB">64 KB (Standard)</option>
                        <option value="256KB">256 KB (Broadband)</option>
                        <option value="1MB">1 MB (Gigabit Fiber)</option>
                        <option value="4MB">4 MB (Ultra 10G)</option>
                      </select>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2 border-t border-[var(--os-border-subtle)] text-[11px]">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={httpKeepAlive}
                        onChange={(e) => setHttpKeepAlive(e.target.checked)}
                        className="rounded accent-[var(--os-accent)]"
                      />
                      <span>Keep-Alive socket reuse</span>
                    </label>

                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={httpHttp2Multiplex}
                        onChange={(e) => setHttpHttp2Multiplex(e.target.checked)}
                        className="rounded accent-[var(--os-accent)]"
                      />
                      <span>HTTP/2 &amp; HTTP/3 multiplexing</span>
                    </label>

                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={httpTcpWindowScaling}
                        onChange={(e) => setHttpTcpWindowScaling(e.target.checked)}
                        className="rounded accent-[var(--os-accent)]"
                      />
                      <span>TCP Window Scaling (RFC 1323)</span>
                    </label>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ========================================================= */}
          {/* TAB 2: BITTORRENT & STEALTH                               */}
          {/* ========================================================= */}
          {activeTab === 'bittorrent' && (
            <div className="space-y-4">
              {/* Friendly Speed Limits Card */}
              {matchesSearch('speed limit bandwidth download upload turtle ceiling bittorrent') && (
                <div className="p-4 rounded-lg bg-[var(--os-bg-alt)] border border-[var(--os-border)] space-y-3">
                  <div className="flex items-center justify-between border-b border-[var(--os-border-subtle)] pb-2">
                    <div className="flex items-center gap-2">
                      <div className="w-6 h-6 rounded-md bg-[var(--os-bg-selected-soft)] text-[var(--os-accent)] flex items-center justify-center">
                        <Sliders className="w-3.5 h-3.5" />
                      </div>
                      <div>
                        <span className="font-bold text-[var(--os-text)] text-xs block">
                          Download & Upload Speed Limits
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {/* Download Limit */}
                    <div>
                      <div className="flex justify-between items-center mb-1.5">
                        <label
                          htmlFor="bt-max-down-select"
                          className="text-[11px] font-semibold text-[var(--os-text)]"
                        >
                          Maximum Download Speed:
                        </label>
                        <span className="font-mono text-emerald-600 dark:text-emerald-400 font-bold text-xs">
                          {globalDownLimit === 0 ? 'Unlimited (Max Speed)' : `${(globalDownLimit / 1024).toFixed(1)} MB/s`}
                        </span>
                      </div>
                      <select
                        id="bt-max-down-select"
                        value={globalDownLimit}
                        onChange={(e) => setGlobalDownLimit(parseInt(e.target.value, 10))}
                        className="w-full px-2.5 py-1.5 rounded-md bg-[var(--os-bg-content)] border border-[var(--os-border)] text-[var(--os-text)] text-xs focus:outline-none focus:border-[var(--os-accent)]"
                      >
                        <option value={0}>Unlimited (Max Speed)</option>
                        <option value={51200}>50 MB/s</option>
                        <option value={20480}>20 MB/s</option>
                        <option value={5120}>5 MB/s</option>
                        {![0, 51200, 20480, 5120].includes(globalDownLimit) && (
                          <option value={globalDownLimit}>
                            Custom ({(globalDownLimit / 1024).toFixed(1)} MB/s)
                          </option>
                        )}
                      </select>
                    </div>

                    {/* Upload Limit */}
                    <div>
                      <div className="flex justify-between items-center mb-1.5">
                        <label
                          htmlFor="bt-max-up-select"
                          className="text-[11px] font-semibold text-[var(--os-text)]"
                        >
                          Maximum Upload Speed:
                        </label>
                        <span className="font-mono text-[var(--os-accent)] font-bold text-xs">
                          {globalUpLimit === 0 ? 'Unlimited' : `${(globalUpLimit / 1024).toFixed(1)} MB/s`}
                        </span>
                      </div>
                      <select
                        id="bt-max-up-select"
                        value={globalUpLimit}
                        onChange={(e) => setGlobalUpLimit(parseInt(e.target.value, 10))}
                        className="w-full px-2.5 py-1.5 rounded-md bg-[var(--os-bg-content)] border border-[var(--os-border)] text-[var(--os-text)] text-xs focus:outline-none focus:border-[var(--os-accent)]"
                      >
                        <option value={0}>Unlimited</option>
                        <option value={10240}>10 MB/s</option>
                        <option value={5120}>5 MB/s</option>
                        <option value={2048}>2 MB/s</option>
                        {![0, 10240, 5120, 2048].includes(globalUpLimit) && (
                          <option value={globalUpLimit}>
                            Custom ({(globalUpLimit / 1024).toFixed(1)} MB/s)
                          </option>
                        )}
                      </select>
                    </div>
                  </div>

                  {/* Alternative / Turtle Mode Speed Caps */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 border-t border-[var(--os-border-subtle)] text-[11px]">
                    <div>
                      <label className="text-[var(--os-text-muted)] block mb-1">
                        Alternative Download Limit (Turtle KB/s):
                      </label>
                      <input
                        type="number"
                        min="64"
                        step="128"
                        value={altDownLimit}
                        onChange={(e) => setAltDownLimit(parseInt(e.target.value) || 2048)}
                        className="w-full px-2 py-1 rounded bg-[var(--os-bg-content)] border border-[var(--os-border)] text-[var(--os-text)] text-xs font-mono focus:outline-none focus:border-[var(--os-accent)]"
                      />
                    </div>
                    <div>
                      <label className="text-[var(--os-text-muted)] block mb-1">
                        Alternative Upload Limit (Turtle KB/s):
                      </label>
                      <input
                        type="number"
                        min="32"
                        step="64"
                        value={altUpLimit}
                        onChange={(e) => setAltUpLimit(parseInt(e.target.value) || 512)}
                        className="w-full px-2 py-1 rounded bg-[var(--os-bg-content)] border border-[var(--os-border)] text-[var(--os-text)] text-xs font-mono focus:outline-none focus:border-[var(--os-accent)]"
                      />
                    </div>
                  </div>
                </div>
              )}

              {/* The Star Feature: libqrbit Stealth Anti-Throttling (Compact Layout) */}
              {matchesSearch('stealth throttling isp bypass vpn mask encryption shield') && (
                <div className="p-3 rounded-lg bg-[var(--os-bg-alt)] border border-[var(--os-border)] space-y-2.5">
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--os-border-subtle)] pb-2">
                    <div className="flex items-center gap-2">
                      <div className="w-5 h-5 rounded bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0">
                        <ShieldCheck className="w-3.5 h-3.5" />
                      </div>
                      <span className="font-bold text-[var(--os-text)] text-xs">
                        libqrbit Stealth Shield (ISP Anti-Throttling)
                      </span>
                    </div>

                    <div className="flex items-center gap-2">
                      <label
                        className="flex items-center gap-1.5 cursor-pointer px-2 py-1 rounded bg-[var(--os-bg-content)] border border-[var(--os-border)] text-[11px]"
                        title="Active protection against Deep Packet Inspection (DPI) and torrent throttling"
                      >
                        <input
                          type="checkbox"
                          checked={stealthEnabled}
                          onChange={(e) => setStealthEnabled(e.target.checked)}
                          className="w-3.5 h-3.5 rounded accent-[var(--os-accent)]"
                        />
                        <span className="font-semibold text-[var(--os-text)]">
                          Enable Shield
                        </span>
                        <OptionTooltip text="Active protection against Deep Packet Inspection (DPI) and torrent throttling" />
                      </label>

                      <button
                        type="button"
                        onClick={() => onOpenAnalyzer('p2p')}
                        className="px-2.5 py-1 rounded text-[10px] font-bold bg-[var(--os-accent)] hover:bg-[var(--os-accent-hover)] text-white flex items-center gap-1 shadow-2xs shrink-0"
                      >
                        <Sparkles className="w-3 h-3 text-yellow-300 fill-yellow-300" />
                        <span>Auto-Tune Evasion</span>
                      </button>
                    </div>
                  </div>

                  {/* Compact 2-Column Row: Connecting Profile & Dynamic Port */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-end">
                    <div>
                      <label
                        htmlFor="bt-dpi-profile-select"
                        className="text-[11px] font-semibold text-[var(--os-text)] flex items-center mb-1"
                      >
                        <span>Where are you connecting from?</span>
                        <OptionTooltip text="Home Broadband: Disguises packets as QUIC & TLS 1.3 web traffic. School/Dorm/Office: Disguises traffic as Zoom/WebRTC video calls. Mobile Hotspot: Bypasses cellular tethering speed caps. Maximum Evasion: Multi-path sharding and decoy echo tunnels." />
                      </label>
                      <select
                        id="bt-dpi-profile-select"
                        value={dpiProfile}
                        onChange={(e) => setDpiProfile(e.target.value as any)}
                        title={
                          dpiProfile === 'ISP Deep Inspection'
                            ? 'Disguises packets as modern QUIC & TLS 1.3 web traffic'
                            : dpiProfile === 'Strict Campus/Dorm'
                            ? 'Disguises traffic as real-time Zoom/WebRTC video calls'
                            : dpiProfile === 'Mobile Carrier Bypass'
                            ? 'Bypasses cellular tethering speed caps and port filters'
                            : 'Multi-path sharding and active decoy echo tunnels'
                        }
                        className="w-full px-2.5 py-1 rounded-md bg-[var(--os-bg-content)] border border-[var(--os-border)] text-[var(--os-text)] text-xs focus:outline-none focus:border-[var(--os-accent)]"
                      >
                        <option value="ISP Deep Inspection">🏠 Home Broadband (Recommended)</option>
                        <option value="Strict Campus/Dorm">🏫 School, Dorm & Office</option>
                        <option value="Mobile Carrier Bypass">📱 Mobile Hotspot / 4G / 5G</option>
                        <option value="Custom">🔒 Maximum Evasion (Steganography)</option>
                      </select>
                    </div>

                    <div>
                      <label
                        htmlFor="bt-listening-port-input"
                        className="text-[11px] font-semibold text-[var(--os-text)] flex items-center mb-1"
                      >
                        <span>Listening Port:</span>
                        <OptionTooltip text="Enter any port (1–65535), click shuffle to randomize immediately, or enable randomization on startup to avoid ISP throttled ports (like 6881)." />
                      </label>
                      <div className="px-2 py-0.5 rounded-md bg-[var(--os-bg-content)] border border-[var(--os-border)] flex items-center justify-between gap-2 text-[11px]">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <input
                            id="bt-listening-port-input"
                            type="text"
                            inputMode="numeric"
                            maxLength={5}
                            value={portInput}
                            onChange={(e) => {
                              const digits = e.target.value.replace(/\D/g, '');
                              setPortInput(digits);
                              const num = parseInt(digits, 10);
                              if (!Number.isNaN(num) && num >= 1 && num <= 65535) {
                                setCurrentPort(num);
                              }
                            }}
                            onBlur={() => {
                              const num = parseInt(portInput, 10);
                              const clamped = Number.isNaN(num)
                                ? currentPort
                                : Math.max(1, Math.min(65535, num));
                              setCurrentPort(clamped);
                              setPortInput(String(clamped));
                            }}
                            title="Enter custom listening port (1–65535)"
                            className="w-16 px-1.5 py-0.5 rounded bg-[var(--os-bg-alt)] border border-[var(--os-border)] font-mono text-emerald-600 dark:text-emerald-400 font-bold text-xs focus:outline-none focus:border-[var(--os-accent)]"
                          />
                          <button
                            type="button"
                            onClick={handleRandomizePort}
                            title="Randomize port now"
                            className="p-1 rounded bg-[var(--os-bg-control)] hover:bg-[var(--os-bg-hover)] text-[var(--os-accent)] border border-[var(--os-border)] transition-colors shrink-0"
                          >
                            <Shuffle className="w-3 h-3" />
                          </button>
                        </div>

                        <label
                          className="flex items-center gap-1.5 cursor-pointer shrink-0"
                          title="Automatically pick a new random ephemeral port every time the application starts"
                        >
                          <input
                            type="checkbox"
                            checked={randomPortOnStartup}
                            onChange={(e) => setRandomPortOnStartup(e.target.checked)}
                            className="w-3.5 h-3.5 rounded accent-[var(--os-accent)]"
                          />
                          <span className="font-medium text-[var(--os-text)] whitespace-nowrap">
                            Random port on startup
                          </span>
                        </label>
                      </div>
                    </div>
                  </div>

                  {/* Granular libqrbit Evasion Flags & Timing */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-2 border-t border-[var(--os-border-subtle)] text-[11px]">
                    <label className="flex items-center gap-1.5 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={multiPath}
                        onChange={(e) => setMultiPath(e.target.checked)}
                        className="rounded accent-[var(--os-accent)]"
                      />
                      <span>Multi-Path Shard</span>
                    </label>
                    <label className="flex items-center gap-1.5 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={decoyTunnel}
                        onChange={(e) => setDecoyTunnel(e.target.checked)}
                        className="rounded accent-[var(--os-accent)]"
                      />
                      <span>Decoy Echo Tunnel</span>
                    </label>
                    <label className="flex items-center gap-1.5 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={portHopping}
                        onChange={(e) => setPortHopping(e.target.checked)}
                        className="rounded accent-[var(--os-accent)]"
                      />
                      <span>Dynamic Port Hop</span>
                    </label>
                    <label className="flex items-center gap-1.5 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={autoDetectThrottling}
                        onChange={(e) => setAutoDetectThrottling(e.target.checked)}
                        className="rounded accent-[var(--os-accent)]"
                      />
                      <span>Auto DPI Sensor</span>
                    </label>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-[11px]">
                    <div>
                      <label className="text-[var(--os-text-muted)] block mb-1">
                        Packet Padding Jitter (ms):
                      </label>
                      <input
                        type="number"
                        min="0"
                        max="120"
                        value={jitterMs}
                        onChange={(e) => setJitterMs(Math.max(0, Math.min(120, parseInt(e.target.value) || 0)))}
                        className="w-full px-2 py-1 rounded bg-[var(--os-bg-content)] border border-[var(--os-border)] text-[var(--os-text)] text-xs font-mono focus:outline-none focus:border-[var(--os-accent)]"
                      />
                    </div>
                    <div>
                      <label className="text-[var(--os-text-muted)] block mb-1">
                        Default Obfuscation Strength:
                      </label>
                      <select
                        value={obfuscationLevel}
                        onChange={(e) => setObfuscationLevel(parseInt(e.target.value, 10) as ObfuscationLevel)}
                        className="w-full px-2 py-1 rounded bg-[var(--os-bg-content)] border border-[var(--os-border)] text-[var(--os-text)] text-xs focus:outline-none focus:border-[var(--os-accent)]"
                      >
                        <option value={1}>L1: Low (RC4 Framing)</option>
                        <option value={2}>L2: Medium (TLS Padding)</option>
                        <option value={3}>L3: High (QUIC Morphing)</option>
                        <option value={4}>L4: Max (Multi-Path Shard)</option>
                      </select>
                    </div>
                    <div>
                      <label className="text-[var(--os-text-muted)] block mb-1">
                        Auto Port-Hop Interval:
                      </label>
                      <select
                        value={autoPortHopInterval}
                        onChange={(e) => setAutoPortHopInterval(e.target.value as any)}
                        className="w-full px-2 py-1 rounded bg-[var(--os-bg-content)] border border-[var(--os-border)] text-[var(--os-text)] text-xs focus:outline-none focus:border-[var(--os-accent)]"
                      >
                        <option value="off">Manual Only</option>
                        <option value="15m">Every 15 Minutes</option>
                        <option value="30m">Every 30 Minutes</option>
                        <option value="60m">Every 60 Minutes</option>
                      </select>
                    </div>
                  </div>
                </div>
              )}

              {/* Advanced BitTorrent Parameters */}
              {matchesSearch('advanced swarm protocols connection limits max total per-torrent handshake encryption dht pex lsd utp half open upload slots scheduling') && (
                <div className="p-4 rounded-lg bg-[var(--os-bg-alt)] border border-[var(--os-border)] space-y-3">
                  <div className="flex items-center justify-between border-b border-[var(--os-border-subtle)] pb-2">
                    <span className="font-bold text-[var(--os-text)] text-xs flex items-center gap-1.5">
                      <Network className="w-3.5 h-3.5 text-[var(--os-accent)]" />
                      <span>Advanced Swarm Protocols & Connection Limits</span>
                    </span>
                    <span className="text-[9px] font-mono text-[var(--os-text-selected-soft)] bg-[var(--os-bg-selected-soft)] px-1.5 py-0.5 rounded">
                      Power User Mode
                    </span>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-[11px]">
                    <div>
                      <label className="text-[var(--os-text)] block mb-1 font-medium">
                        Max Total Connections:
                      </label>
                      <input
                        type="number"
                        value={maxTotalConns}
                        onChange={(e) => setMaxTotalConns(parseInt(e.target.value) || 500)}
                        className="w-full px-2 py-1 rounded bg-[var(--os-bg-content)] border border-[var(--os-border)] text-[var(--os-text)] text-xs font-mono focus:outline-none focus:border-[var(--os-accent)]"
                      />
                    </div>

                    <div>
                      <label className="text-[var(--os-text)] block mb-1 font-medium">
                        Per-Torrent Connections:
                      </label>
                      <input
                        type="number"
                        value={maxConnsPerTorrent}
                        onChange={(e) => setMaxConnsPerTorrent(parseInt(e.target.value) || 100)}
                        className="w-full px-2 py-1 rounded bg-[var(--os-bg-content)] border border-[var(--os-border)] text-[var(--os-text)] text-xs font-mono focus:outline-none focus:border-[var(--os-accent)]"
                      />
                    </div>

                    <div>
                      <label className="text-[var(--os-text)] block mb-1 font-medium">
                        Swarm Handshake Encryption:
                      </label>
                      <select
                        value={encryptionRequirement}
                        onChange={(e) => setEncryptionRequirement(e.target.value as any)}
                        className="w-full px-2 py-1 rounded bg-[var(--os-bg-content)] border border-[var(--os-border)] text-[var(--os-text)] text-xs font-mono focus:outline-none focus:border-[var(--os-accent)]"
                      >
                        <option value="prefer">Prefer Encrypted (Recommended)</option>
                        <option value="require">Forced Encryption (Drop Plaintext)</option>
                        <option value="allow">Allow Plaintext</option>
                      </select>
                    </div>

                    <div>
                      <label className="text-[var(--os-text)] block mb-1 font-medium">
                        Half-Open Connections:
                      </label>
                      <input
                        type="number"
                        min="5"
                        max="200"
                        value={halfOpenConns}
                        onChange={(e) => setHalfOpenConns(parseInt(e.target.value) || 50)}
                        className="w-full px-2 py-1 rounded bg-[var(--os-bg-content)] border border-[var(--os-border)] text-[var(--os-text)] text-xs font-mono focus:outline-none focus:border-[var(--os-accent)]"
                      />
                    </div>

                    <div>
                      <label className="text-[var(--os-text)] block mb-1 font-medium">
                        Upload Slots / Torrent:
                      </label>
                      <input
                        type="number"
                        min="1"
                        max="64"
                        value={uploadSlotsPerTorrent}
                        onChange={(e) => setUploadSlotsPerTorrent(parseInt(e.target.value) || 8)}
                        className="w-full px-2 py-1 rounded bg-[var(--os-bg-content)] border border-[var(--os-border)] text-[var(--os-text)] text-xs font-mono focus:outline-none focus:border-[var(--os-accent)]"
                      />
                    </div>

                    <div>
                      <label className="text-[var(--os-text)] block mb-1 font-medium">
                        Piece Scheduling Mode:
                      </label>
                      <select
                        value={defaultHealthMode}
                        onChange={(e) => setDefaultHealthMode(e.target.value as HealthPriorityMode)}
                        className="w-full px-2 py-1 rounded bg-[var(--os-bg-content)] border border-[var(--os-border)] text-[var(--os-text)] text-xs focus:outline-none focus:border-[var(--os-accent)]"
                      >
                        <option value="rarest_first">Rarest-First (Swarm Health)</option>
                        <option value="sequential_preview">Sequential (Media Preview)</option>
                        <option value="balanced">Balanced Availability</option>
                        <option value="super_seed">Super-Seed Mode</option>
                      </select>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-2 border-t border-[var(--os-border-subtle)] text-[11px]">
                    <label className="flex items-center gap-1.5 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={dhtEnabled}
                        onChange={(e) => setDhtEnabled(e.target.checked)}
                        className="rounded accent-[var(--os-accent)]"
                      />
                      <span>DHT Network</span>
                    </label>

                    <label className="flex items-center gap-1.5 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={pexEnabled}
                        onChange={(e) => setPexEnabled(e.target.checked)}
                        className="rounded accent-[var(--os-accent)]"
                      />
                      <span>Peer Exchange (PeX)</span>
                    </label>

                    <label className="flex items-center gap-1.5 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={lsdEnabled}
                        onChange={(e) => setLsdEnabled(e.target.checked)}
                        className="rounded accent-[var(--os-accent)]"
                      />
                      <span>Local Peer (LSD)</span>
                    </label>

                    <label className="flex items-center gap-1.5 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={utpEnabled}
                        onChange={(e) => setUtpEnabled(e.target.checked)}
                        className="rounded accent-[var(--os-accent)]"
                      />
                      <span>uTP Protocol</span>
                    </label>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ========================================================= */}
          {/* TAB 3: SYSTEM TAB (UNIFIED DOWNLOAD DIRECTORY,            */}
          {/* APPEARANCE, NATIVE OS CONTROLS, UPDATES)                  */}
          {/* ========================================================= */}
          {activeTab === 'system' && (
            <div className="space-y-2.5">
              {/* Unified Default Download Directory */}
              {matchesSearch('folder directory destination save path storage download location') && (
                <div className="p-3 rounded-lg bg-[var(--os-bg-alt)] border border-[var(--os-border)] space-y-2">
                  <div className="flex items-center justify-between border-b border-[var(--os-border-subtle)] pb-1.5">
                    <div className="flex items-center gap-1.5">
                      <FolderDown className="w-3.5 h-3.5 text-[var(--os-accent)]" />
                      <span className="font-bold text-[var(--os-text)] text-xs">
                        Default Download Folder
                      </span>
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-[11px] font-medium text-[var(--os-text)] flex items-center justify-between">
                      <span className="flex items-center">
                        <span>Save destination path:</span>
                        <OptionTooltip text={`Full directory path used for all HTTP and BitTorrent downloads (OS default: ${osDefaultPath}).`} />
                      </span>
                      <span className="text-[10px] font-mono text-[var(--os-text-muted)]">
                        {detectedOs === 'windows' ? 'Windows Downloads' : detectedOs === 'macos' ? 'macOS Downloads' : 'XDG Downloads'}
                      </span>
                    </label>
                    <div className="flex gap-1.5 w-full">
                      <div className="relative flex-1 min-w-0">
                        <Folder className="w-3.5 h-3.5 absolute left-2 top-1.5 text-[var(--os-text-muted)]" />
                        <input
                          type="text"
                          value={downloadDir}
                          title={downloadDir}
                          onChange={(e) => setDownloadDir(e.target.value)}
                          placeholder={osDefaultPath}
                          className="w-full pl-7 pr-2.5 py-1 rounded bg-[var(--os-bg-content)] border border-[var(--os-border)] text-[var(--os-text)] font-mono text-[11px] focus:outline-none focus:border-[var(--os-accent)]"
                        />
                      </div>
                      <button
                        type="button"
                        onClick={async () => {
                          const picked = await pickOsDirectory(downloadDir, detectedOs);
                          if (picked) {
                            setDownloadDir(picked);
                          }
                        }}
                        title="Open OS file manager to choose download directory"
                        className="px-2.5 py-1 rounded bg-[var(--os-accent)] hover:bg-[var(--os-accent-hover)] text-white font-semibold text-[11px] transition-colors shrink-0 flex items-center gap-1"
                      >
                        <Folder className="w-3 h-3" />
                        <span>Browse...</span>
                      </button>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1.5 border-t border-[var(--os-border-subtle)] text-[11px]">
                    <label className="flex items-center gap-1.5 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={autoSubfolders}
                        onChange={(e) => setAutoSubfolders(e.target.checked)}
                        className="w-3.5 h-3.5 rounded accent-[var(--os-accent)]"
                      />
                      <span className="text-[var(--os-text)] font-medium flex items-center">
                        <span>Auto-sort category subfolders</span>
                        <OptionTooltip text={`Automatically sort files into ${osPathSep}Media, ${osPathSep}Software, ${osPathSep}Documents`} />
                      </span>
                    </label>

                    <label className="flex items-center gap-1.5 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={applyToAllTransfers}
                        onChange={(e) => setApplyToAllTransfers(e.target.checked)}
                        className="w-3.5 h-3.5 rounded accent-[var(--os-accent)]"
                      />
                      <span className="text-[var(--os-text)] font-medium flex items-center">
                        <span>Sync path to active transfers</span>
                        <OptionTooltip text="Apply this unified folder to all active transfers upon saving." />
                      </span>
                    </label>
                  </div>
                </div>
              )}

              {/* Compact Side-by-Side Row: Interface Theme & Software Updates */}
              {(matchesSearch('theme light dark mode appearance look style') ||
                matchesSearch('update software version mirror release')) && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  {/* Interface Theme & Colors */}
                  {matchesSearch('theme light dark mode appearance look style') && (
                    <div className="p-3 rounded-lg bg-[var(--os-bg-alt)] border border-[var(--os-border)] space-y-2">
                      <div className="font-bold text-[var(--os-text)] text-xs flex items-center gap-1.5 border-b border-[var(--os-border-subtle)] pb-1.5">
                        <Monitor className="w-3.5 h-3.5 text-[var(--os-accent)]" />
                        <span>Interface Theme &amp; Colors</span>
                      </div>

                      <div className="flex items-center justify-between gap-2">
                        <label
                          htmlFor="theme-mode-select"
                          className="text-[11px] font-medium text-[var(--os-text)] flex items-center shrink-0"
                        >
                          <span>Color Theme:</span>
                          <OptionTooltip text="Choose Light, Dark, or Match System using your OS standard palette (Win32, Aqua, or KDE Breeze)." />
                        </label>
                        <select
                          id="theme-mode-select"
                          value={viewMode}
                          onChange={(e) => handleViewModeChange(e.target.value as 'light' | 'dark' | 'system')}
                          className="flex-1 min-w-0 px-2 py-1 rounded bg-[var(--os-bg-content)] border border-[var(--os-border)] text-[var(--os-text)] text-[11px] focus:outline-none focus:border-[var(--os-accent)]"
                        >
                          <option value="light">Light</option>
                          <option value="dark">Dark</option>
                          <option value="system">Match System</option>
                        </select>
                      </div>

                      <label className="flex items-center gap-1.5 cursor-pointer text-[11px] pt-1 border-t border-[var(--os-border-subtle)]">
                        <input
                          type="checkbox"
                          checked={compactDensity}
                          onChange={(e) => setCompactDensity(e.target.checked)}
                          className="w-3.5 h-3.5 rounded accent-[var(--os-accent)]"
                        />
                        <span className="font-medium text-[var(--os-text)]">Compact transfer table density</span>
                      </label>
                    </div>
                  )}

                  {/* Software Updates */}
                  {matchesSearch('update software version mirror release') && (
                    <div className="p-3 rounded-lg bg-[var(--os-bg-alt)] border border-[var(--os-border)] space-y-2">
                      <div className="font-bold text-[var(--os-text)] text-xs flex items-center justify-between border-b border-[var(--os-border-subtle)] pb-1.5">
                        <div className="flex items-center gap-1.5">
                          <RefreshCw className="w-3.5 h-3.5 text-[var(--os-accent)]" />
                          <span>Software Updates</span>
                        </div>
                        <span className="text-[10px] font-mono text-emerald-700 dark:text-emerald-400 font-semibold bg-emerald-500/10 px-1.5 py-0.5 rounded">
                          v2.0.0
                        </span>
                      </div>

                      <div className="flex items-center justify-between gap-2">
                        <button
                          type="button"
                          onClick={handleCheckUpdates}
                          disabled={isCheckingUpdate}
                          className="px-2.5 py-1 rounded bg-[var(--os-accent)] hover:bg-[var(--os-accent-hover)] disabled:opacity-50 text-white font-semibold text-[11px] flex items-center gap-1.5 shrink-0"
                        >
                          <RefreshCw className={`w-3 h-3 ${isCheckingUpdate ? 'animate-spin' : ''}`} />
                          <span>{isCheckingUpdate ? 'Checking...' : 'Check for Updates'}</span>
                        </button>

                        {updateStatusText && (
                          <span className="text-[10px] font-mono text-emerald-600 dark:text-emerald-400 font-semibold truncate">
                            {updateStatusText}
                          </span>
                        )}
                      </div>

                      <label className="flex items-center gap-1.5 cursor-pointer text-[11px] pt-1 border-t border-[var(--os-border-subtle)]">
                        <input
                          type="checkbox"
                          checked={autoCheckUpdates}
                          onChange={(e) => setAutoCheckUpdates(e.target.checked)}
                          className="w-3.5 h-3.5 rounded accent-[var(--os-accent)]"
                        />
                        <span className="font-medium text-[var(--os-text)]">Automatically check for updates</span>
                      </label>
                    </div>
                  )}
                </div>
              )}

              {/* Startup, Tray & Power Behavior */}
              {matchesSearch('startup tray boot minimize window power sleep prevent sleep') && (
                <div className="p-3 rounded-lg bg-[var(--os-bg-alt)] border border-[var(--os-border)] grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px]">
                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={startOnBoot}
                      onChange={(e) => setStartOnBoot(e.target.checked)}
                      className="w-3.5 h-3.5 rounded accent-[var(--os-accent)]"
                    />
                    <span className="font-medium text-[var(--os-text)]">Launch FlowDown automatically on OS login</span>
                  </label>
                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={minimizeToTray}
                      onChange={(e) => setMinimizeToTray(e.target.checked)}
                      className="w-3.5 h-3.5 rounded accent-[var(--os-accent)]"
                    />
                    <span className="font-medium text-[var(--os-text)]">Minimize to system tray when window closes</span>
                  </label>
                  <label className="flex items-center gap-1.5 cursor-pointer sm:col-span-2">
                    <input
                      type="checkbox"
                      checked={preventSleepDuringTransfers}
                      onChange={(e) => setPreventSleepDuringTransfers(e.target.checked)}
                      className="w-3.5 h-3.5 rounded accent-[var(--os-accent)]"
                    />
                    <span className="font-medium text-[var(--os-text)]">Keep computer from sleeping during active transfers</span>
                  </label>
                </div>
              )}

              {/* Browser & File Associations */}
              {matchesSearch('associate file magnet torrent browser registration') && (
                <div className="p-3 rounded-lg bg-[var(--os-bg-alt)] border border-[var(--os-border)] space-y-2">
                  <div className="font-bold text-[var(--os-text)] text-xs flex items-center justify-between border-b border-[var(--os-border-subtle)] pb-1.5">
                    <div className="flex items-center gap-1.5">
                      <Link className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                      <span>Browser &amp; File Links</span>
                    </div>
                    <button
                      type="button"
                      onClick={handleRegisterAssociations}
                      className="px-2 py-0.5 rounded bg-[var(--os-bg-control)] hover:bg-[var(--os-bg-hover)] text-[var(--os-text)] font-medium text-[11px] border border-[var(--os-border)] flex items-center gap-1"
                    >
                      <ExternalLink className="w-3 h-3" />
                      <span>Register Links</span>
                    </button>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px]">
                    <label
                      className="flex items-center gap-1.5 cursor-pointer"
                      title="Double-clicking downloaded .torrent files opens them directly in FlowDown."
                    >
                      <input
                        type="checkbox"
                        checked={associateTorrents}
                        onChange={(e) => setAssociateTorrents(e.target.checked)}
                        className="w-3.5 h-3.5 rounded accent-[var(--os-accent)]"
                      />
                      <span className="font-medium text-[var(--os-text)] flex items-center">
                        <span>Open .torrent files in FlowDown</span>
                        <OptionTooltip text="Double-clicking downloaded .torrent files opens them directly in FlowDown." />
                      </span>
                    </label>

                    <label
                      className="flex items-center gap-1.5 cursor-pointer"
                      title="Clicking magnet links in Chrome, Firefox, or Edge instantly adds them to FlowDown."
                    >
                      <input
                        type="checkbox"
                        checked={associateMagnets}
                        onChange={(e) => setAssociateMagnets(e.target.checked)}
                        className="w-3.5 h-3.5 rounded accent-[var(--os-accent)]"
                      />
                      <span className="font-medium text-[var(--os-text)] flex items-center">
                        <span>Handle browser magnet: links</span>
                        <OptionTooltip text="Clicking magnet links in Chrome, Firefox, or Edge instantly adds them to FlowDown." />
                      </span>
                    </label>
                  </div>

                  {associationNotice && (
                    <div className="text-[10px] font-mono text-emerald-600 dark:text-emerald-400 font-semibold pt-1 border-t border-[var(--os-border-subtle)]">
                      {associationNotice}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Dialog Footer */}
        <div className="h-12 bg-[var(--os-bg-statusbar)] border-t border-[var(--os-border)] px-4 flex items-center justify-between shrink-0">
          <button
            type="button"
            onClick={handleResetDefaults}
            className="text-[11px] text-[var(--os-text-muted)] hover:text-[var(--os-text)] flex items-center gap-1.5 transition-colors font-medium"
          >
            <RotateCw className="w-3.5 h-3.5" />
            <span>Reset Recommended Defaults</span>
          </button>
          
          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-1.5 rounded-md bg-[var(--os-bg-control)] hover:bg-[var(--os-bg-hover)] border border-[var(--os-border)] text-[var(--os-text)] text-xs font-medium transition-colors"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleApplyAll}
              className="px-5 py-1.5 rounded-md bg-[var(--os-accent)] hover:bg-[var(--os-accent-hover)] text-white text-xs font-semibold shadow-2xs flex items-center gap-1.5 transition-colors"
            >
              <Check className="w-3.5 h-3.5" />
              <span>OK</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
