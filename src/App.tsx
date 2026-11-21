/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useMemo } from 'react';
import { torrentEngine } from './services/torrentEngine';
import { TorrentItem, BandwidthLimits, LibqrbitConfig, SpeedHistoryPoint, LogEntry, Priority, HealthPriorityMode, ObfuscationLevel, OsStyle, SystemSettings } from './types';
import { QtMenuBar } from './components/QtMenuBar';
import { QtToolBar } from './components/QtToolBar';
import { QtCategorySidebar } from './components/QtCategorySidebar';
import { QtTransferTable } from './components/QtTransferTable';
import { QtDetailTabs } from './components/QtDetailTabs';
import { QtStatusBar } from './components/QtStatusBar';

import { AddTorrentModal, StartupTorrentPayload } from './components/modals/AddTorrentModal';
import { AddUrlModal } from './components/modals/AddUrlModal';
import { OptionsModal } from './components/modals/OptionsModal';
import { BandwidthSchedulerModal } from './components/modals/BandwidthSchedulerModal';
import { DiagnosticModal } from './components/modals/DiagnosticModal';
import { AnalyzerModal } from './components/modals/AnalyzerModal';
import { TorrentCreatorModal } from './components/modals/TorrentCreatorModal';
import { AboutModal } from './components/modals/AboutModal';
import { UpdateModal } from './components/modals/UpdateModal';
import { DuplicateTransferModal } from './components/modals/DuplicateTransferModal';
import { DeleteConfirmModal } from './components/modals/DeleteConfirmModal';
import { DownloadInfoModal } from './components/modals/DownloadInfoModal';
import { RenameTransferModal } from './components/modals/RenameTransferModal';
import { SubwindowHeader } from './components/modals/SubwindowHeader';
import { detectHostOs, resolveOsDownloadDirectory } from './utils/detectOs';
import { openOsDestinationFolder } from './utils/osFilePicker';
import { apiClient } from './services/apiClient';

export default function App() {
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');
  const [viewModePreference, setViewModePreference] = useState<'dark' | 'light' | 'system'>('dark');
  const osStyle: OsStyle = useMemo(() => detectHostOs(), []);
  const [isClosePromptOpen, setIsClosePromptOpen] = useState<boolean>(false);
  const [showSidebar, setShowSidebar] = useState<boolean>(true);
  const [showDetailTabs, setShowDetailTabs] = useState<boolean>(true);
  const [showStatusBar, setShowStatusBar] = useState<boolean>(true);
  const [systemSettingsState, setSystemSettingsState] = useState<Partial<SystemSettings>>({
    compactDensity: false,
    autoSubfolders: true,
    associateTorrents: true,
    associateMagnets: true,
    startOnBoot: false,
    minimizeToTray: false,
    preventSleepDuringTransfers: true,
    autoCheckUpdates: true,
  });
  const [torrents, setTorrents] = useState<TorrentItem[]>(torrentEngine.getTorrents());
  const [bandwidthLimits, setBandwidthLimits] = useState<BandwidthLimits>(torrentEngine.getBandwidthLimits());
  const [libqrbitConfig, setLibqrbitConfig] = useState<LibqrbitConfig>(torrentEngine.getLibqrbitConfig());
  const [speedHistory, setSpeedHistory] = useState<SpeedHistoryPoint[]>(torrentEngine.getSpeedHistory());
  const [logs, setLogs] = useState<LogEntry[]>(torrentEngine.getLogs());
  const [isThrottlingActive, setIsThrottlingActive] = useState<boolean>(torrentEngine.isThrottlingActive());
  const [sessionStats, setSessionStats] = useState(torrentEngine.getSessionStats());
  const [rustConnected, setRustConnected] = useState<boolean>(torrentEngine.isRustDaemonConnected());
  const [defaultDownloadDir, setDefaultDownloadDir] = useState<string>(torrentEngine.getDefaultDownloadDirectory());

  const handleResetSessionStats = () => {
    torrentEngine.resetSessionStats();
    setSessionStats({ ...torrentEngine.getSessionStats() });
  };

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [searchFilter, setSearchFilter] = useState('');
  const [selectedStatus, setSelectedStatus] = useState('all');
  const [selectedCategory, setSelectedCategory] = useState('All');
  const [selectedTag, setSelectedTag] = useState('All');

  // Split pane resizing states (Left sidebar & Bottom detail pane)
  const [sidebarWidth, setSidebarWidth] = useState(210);
  const [isDraggingSidebar, setIsDraggingSidebar] = useState(false);
  const [detailHeight, setDetailHeight] = useState(200);
  const [isDraggingDetail, setIsDraggingDetail] = useState(false);

  const handleSidebarMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsDraggingSidebar(true);
    const startX = e.clientX;
    const startWidth = sidebarWidth;

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const deltaX = moveEvent.clientX - startX;
      const newWidth = Math.max(140, Math.min(420, startWidth + deltaX));
      setSidebarWidth(newWidth);
    };

    const handleMouseUp = () => {
      setIsDraggingSidebar(false);
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  };

  const handleDetailMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsDraggingDetail(true);
    const startY = e.clientY;
    const startHeight = detailHeight;

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const deltaY = startY - moveEvent.clientY;
      const newHeight = Math.max(36, Math.min(450, startHeight + deltaY));
      setDetailHeight(newHeight);
    };

    const handleMouseUp = () => {
      setIsDraggingDetail(false);
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  };

  // Modal dialog states
  const [isAddTorrentOpen, setIsAddTorrentOpen] = useState(false);
  const [pendingStartupTorrent, setPendingStartupTorrent] = useState<StartupTorrentPayload | null>(null);
  const [isAddUrlOpen, setIsAddUrlOpen] = useState(false);
  const [isLibqrbitSettingsOpen, setIsLibqrbitSettingsOpen] = useState(false);
  const [isSchedulerOpen, setIsSchedulerOpen] = useState(false);
  const [isDiagnosticOpen, setIsDiagnosticOpen] = useState(false);
  const [isAnalyzerOpen, setIsAnalyzerOpen] = useState(false);
  const [analyzerInitialTab, setAnalyzerInitialTab] = useState<'p2p' | 'http'>('p2p');
  const [isTorrentCreatorOpen, setIsTorrentCreatorOpen] = useState(false);
  const [isAboutOpen, setIsAboutOpen] = useState(false);
  const [isUpdateModalOpen, setIsUpdateModalOpen] = useState(false);
  const [duplicateConflict, setDuplicateConflict] = useState<{
    existingItem: TorrentItem;
    newItemName: string;
    type: 'torrent' | 'http';
    data: any;
  } | null>(null);
  const [deleteConfirmation, setDeleteConfirmation] = useState<{
    items: TorrentItem[];
  } | null>(null);
  const [downloadInfoTorrentId, setDownloadInfoTorrentId] = useState<string | null>(null);
  const [renameTorrentId, setRenameTorrentId] = useState<string | null>(null);
  const [toast, setToast] = useState<{ title: string; detail: string } | null>(null);
  const toastTimerRef = React.useRef<number | null>(null);

  const showToast = (title: string, detail: string) => {
    setToast({ title, detail });
    if (toastTimerRef.current) {
      window.clearTimeout(toastTimerRef.current);
    }
    toastTimerRef.current = window.setTimeout(() => {
      setToast(null);
      toastTimerRef.current = null;
    }, 3500);
  };

  const copyText = async (text: string): Promise<boolean> => {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch {
      // Fallback below
    }
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return ok;
    } catch {
      return false;
    }
  };

  const handleOpenItem = async (id: string) => {
    const tor = torrents.find((t) => t.id === id);
    if (!tor) return;

    if (tor.isMissing) {
      showToast('File Missing or Deleted', `Cannot open "${tor.name}". The files are not found on disk at "${tor.savePath}".`);
      torrentEngine.addLog('TORRENT', `Attempted to open missing transfer "${tor.name}" at "${tor.savePath}".`);
      return;
    }

    const sep = tor.savePath.includes('\\') ? '\\' : '/';
    const normalize = (p: string) => p.replace(/[/\\]+$/, '');
    const normalizedSave = normalize(tor.savePath);

    // Detect if this is a nested torrent (multi-file torrent or files in subdirectories)
    const isMultiFile = Boolean(tor.files && tor.files.length > 1);
    const hasNestedPath = Boolean(
      tor.files && tor.files.length === 1 && (tor.files[0].path.includes('/') || tor.files[0].path.includes('\\'))
    );
    const isNestedTorrent = !tor.isHttpSegmented && (isMultiFile || hasNestedPath);

    if (isNestedTorrent) {
      // Nested torrent: open that directory directly using the default OS file manager
      const endsWithName = normalizedSave.toLowerCase().endsWith(tor.name.toLowerCase());
      const nestedDir = endsWithName ? normalizedSave : `${normalizedSave}${sep}${tor.name}`;

      const opened = await apiClient.openItem(nestedDir);
      if (opened) {
        torrentEngine.addLog('INFO', `Opened directory "${nestedDir}" [OS File Manager].`);
        showToast('Opened Directory', `${tor.name}`);
      } else {
        await handleOpenFolder(id);
      }
    } else {
      // Single file download: open file directly with default OS application
      const singleFileName = tor.files && tor.files.length === 1 ? tor.files[0].path : tor.name;
      const targetFilePath = `${normalizedSave}${sep}${singleFileName}`;

      const opened = await apiClient.openItem(targetFilePath);
      if (!opened) {
        // Fallback to opening folder
        await handleOpenFolder(id);
      } else {
        torrentEngine.addLog('INFO', `Opened file "${singleFileName}" [Default App].`);
        showToast('Opened Download', `${singleFileName}`);
      }
    }
  };

  const handleOpenFolder = async (id: string) => {
    const tor = torrents.find((t) => t.id === id);
    if (!tor) return;

    const openRes = await apiClient.openDestinationFolder(tor.savePath, tor.name);
    let openedViaBrowser = false;

    if (!openRes?.launchedNative) {
      openedViaBrowser = await openOsDestinationFolder(tor.savePath, osStyle);
    }

    const methodLabel = openRes?.launchedNative
      ? `Native ${openRes.fileManager}`
      : openedViaBrowser
      ? 'OS File Manager'
      : 'Local path';

    torrentEngine.addLog(
      'INFO',
      `Opened destination folder "${tor.savePath}" for "${tor.name}" [${methodLabel}].`
    );
    showToast('Opened Destination Folder', `${tor.savePath} • ${methodLabel}`);
  };

  const handleCopyName = async (ids: string[]) => {
    const selected = torrents.filter((t) => ids.includes(t.id));
    if (selected.length === 0) return;
    const payload = selected.map((t) => t.name).join('\n');
    await copyText(payload);
    if (selected.length === 1) {
      torrentEngine.addLog('INFO', `Copied transfer name "${selected[0].name}" to clipboard.`);
      showToast('Copied Name', selected[0].name);
    } else {
      torrentEngine.addLog('INFO', `Copied ${selected.length} transfer names to clipboard.`);
      showToast('Copied Names', `${selected.length} transfer names copied to clipboard`);
    }
  };

  const handleCopyInfoHash = async (ids: string[]) => {
    const selected = torrents.filter((t) => ids.includes(t.id));
    if (selected.length === 0) return;
    const payload = selected.map((t) => t.hash).join('\n');
    await copyText(payload);
    if (selected.length === 1) {
      torrentEngine.addLog('INFO', `Copied SHA-1 info hash (${selected[0].hash}) to clipboard.`);
      showToast('Copied Info Hash', selected[0].hash);
    } else {
      torrentEngine.addLog('INFO', `Copied ${selected.length} SHA-1 info hashes to clipboard.`);
      showToast('Copied Info Hashes', `${selected.length} SHA-1 hashes copied to clipboard`);
    }
  };

  const handleCopyMagnet = async (ids: string[]) => {
    const selected = torrents.filter((t) => ids.includes(t.id));
    if (selected.length === 0) return;
    const payload = selected
      .map((t) => `magnet:?xt=urn:btih:${t.hash}&dn=${encodeURIComponent(t.name)}`)
      .join('\n');
    await copyText(payload);
    if (selected.length === 1) {
      torrentEngine.addLog('INFO', `Copied magnet URI for "${selected[0].name}" to clipboard.`);
      showToast('Copied Magnet URI', `magnet:?xt=urn:btih:${selected[0].hash.slice(0, 16)}...`);
    } else {
      torrentEngine.addLog('INFO', `Copied ${selected.length} magnet URIs to clipboard.`);
      showToast('Copied Magnet URIs', `${selected.length} magnet links copied to clipboard`);
    }
  };

  const downloadInfoTorrent = useMemo(() => {
    if (!downloadInfoTorrentId) return null;
    return torrents.find((t) => t.id === downloadInfoTorrentId) || null;
  }, [torrents, downloadInfoTorrentId]);

  const renameTorrentTarget = useMemo(() => {
    if (!renameTorrentId) return null;
    return torrents.find((t) => t.id === renameTorrentId) || null;
  }, [torrents, renameTorrentId]);

  const handleOpenAnalyzer = (tab: 'p2p' | 'http' = 'p2p') => {
    setAnalyzerInitialTab(tab);
    setIsAnalyzerOpen(true);
  };

  // Keep computer from sleeping during active transfers
  useEffect(() => {
    if (!systemSettingsState.preventSleepDuringTransfers) return;
    const hasActiveTransfers = torrents.some(
      (t) => t.status === 'downloading' || t.status === 'stealth_active' || t.status === 'throttled'
    );
    let wakeLock: any = null;
    if (hasActiveTransfers && 'wakeLock' in navigator) {
      (navigator as any).wakeLock.request('screen').then((lock: any) => {
        wakeLock = lock;
      }).catch(() => {});
    }
    return () => {
      if (wakeLock && typeof wakeLock.release === 'function') {
        wakeLock.release().catch(() => {});
      }
    };
  }, [torrents, systemSettingsState.preventSleepDuringTransfers]);

  // Sync with engine subscription
  useEffect(() => {
    requestAnimationFrame(() => {
      import('@tauri-apps/api/core')
        .then(({ invoke }) => invoke('show_main_window'))
        .catch(() => {});
    });

    const unsubscribe = torrentEngine.subscribe(() => {
      const nextTorrents = torrentEngine.getTorrents();
      setTorrents((prev) => {
        if (prev === nextTorrents) return prev;
        if (prev.length === nextTorrents.length) {
          let allSame = true;
          for (let i = 0; i < prev.length; i++) {
            if (prev[i] !== nextTorrents[i]) {
              allSame = false;
              break;
            }
          }
          if (allSame) return prev;
        }
        return [...nextTorrents];
      });

      const nextLimits = torrentEngine.getBandwidthLimits();
      setBandwidthLimits((prev) => {
        if (
          prev.globalDownloadLimit === nextLimits.globalDownloadLimit &&
          prev.globalUploadLimit === nextLimits.globalUploadLimit &&
          prev.altSpeedActive === nextLimits.altSpeedActive &&
          prev.altDownloadLimit === nextLimits.altDownloadLimit &&
          prev.altUploadLimit === nextLimits.altUploadLimit &&
          prev.scheduledAltSpeed === nextLimits.scheduledAltSpeed &&
          prev.dhtEnabled === nextLimits.dhtEnabled &&
          prev.pexEnabled === nextLimits.pexEnabled &&
          prev.lsdEnabled === nextLimits.lsdEnabled &&
          prev.utpEnabled === nextLimits.utpEnabled
        ) {
          return prev;
        }
        return { ...nextLimits };
      });

      const nextConfig = torrentEngine.getLibqrbitConfig();
      setLibqrbitConfig((prev) => {
        if (
          prev.enabled === nextConfig.enabled &&
          prev.currentStealthPort === nextConfig.currentStealthPort &&
          prev.dpiEvasionProfile === nextConfig.dpiEvasionProfile &&
          prev.autoDetectThrottling === nextConfig.autoDetectThrottling &&
          prev.aggressivePacketMorph === nextConfig.aggressivePacketMorph &&
          prev.multiPathFragmentation === nextConfig.multiPathFragmentation &&
          prev.decoyEchoTunnel === nextConfig.decoyEchoTunnel &&
          prev.portHopping === nextConfig.portHopping
        ) {
          return prev;
        }
        return { ...nextConfig };
      });

      const nextHistory = torrentEngine.getSpeedHistory();
      setSpeedHistory((prev) => {
        const lastPrev = prev[prev.length - 1];
        const lastNext = nextHistory[nextHistory.length - 1];
        if (lastPrev && lastNext && lastPrev.time === lastNext.time && prev.length === nextHistory.length) {
          return prev;
        }
        return [...nextHistory];
      });

      const nextLogs = torrentEngine.getLogs();
      setLogs((prev) => (prev.length === nextLogs.length && prev[0]?.id === nextLogs[0]?.id ? prev : [...nextLogs]));

      const throttlingActive = torrentEngine.isThrottlingActive();
      setIsThrottlingActive((prev) => (prev === throttlingActive ? prev : throttlingActive));

      const nextStats = torrentEngine.getSessionStats();
      setSessionStats((prev) =>
        prev.sessionDownloaded === nextStats.sessionDownloaded && prev.sessionUploaded === nextStats.sessionUploaded
          ? prev
          : { ...nextStats }
      );

      const rustConnected = torrentEngine.isRustDaemonConnected();
      setRustConnected((prev) => (prev === rustConnected ? prev : rustConnected));

      const defaultDir = torrentEngine.getDefaultDownloadDirectory();
      setDefaultDownloadDir((prev) => (prev === defaultDir ? prev : defaultDir));
    });

    const playCompletionChime = () => {
      try {
        const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        if (!AudioCtx) return;
        const ctx = new AudioCtx();
        const now = ctx.currentTime;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(587.33, now);
        osc.frequency.setValueAtTime(880, now + 0.12);
        gain.gain.setValueAtTime(0.08, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.onended = () => {
          void ctx.close().catch(() => {});
        };
        osc.start(now);
        osc.stop(now + 0.36);
      } catch {
        // Ignore audio playback errors
      }
    };

    const unsubComplete = torrentEngine.onTransferCompleted((completed) => {
      const opts = completed.completionOptions;
      if (!opts || opts.playSoundOnComplete) {
        playCompletionChime();
      }
      showToast('Download Completed', completed.name);
      if (opts?.openFolderOnComplete) {
        void handleOpenFolder(completed.id);
      }
      if (opts?.exitOnComplete) {
        void handleExitApplication();
      }
    });

    // Load persisted settings from backend
    apiClient.getSettings().then((persisted) => {
      if (persisted) {
        if (persisted.systemSettings) {
          const resolvedDl = resolveOsDownloadDirectory(persisted.systemSettings.downloadDirectory, osStyle);
          setSystemSettingsState((prev) => ({
            ...prev,
            ...persisted.systemSettings,
            downloadDirectory: resolvedDl,
          }));
          torrentEngine.setDefaultDownloadDirectory(resolvedDl, false);
          const savedView = persisted.systemSettings.viewMode as 'dark' | 'light' | 'system' | undefined;
          if (savedView) {
            setViewModePreference(savedView);
            if (savedView === 'system') {
              setTheme(window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
            } else {
              setTheme(savedView);
            }
          }
        }
        if (persisted.bandwidthLimits) {
          torrentEngine.setBandwidthLimits(persisted.bandwidthLimits);
        }
        if (persisted.httpSettings) {
          torrentEngine.setHttpSettings(persisted.httpSettings);
        }
        if (persisted.libqrbitConfig) {
          const cfg = { ...persisted.libqrbitConfig };
          if (cfg.randomPortOnStartup) {
            const startupPort = Math.floor(49152 + Math.random() * (65535 - 49152));
            cfg.currentStealthPort = startupPort;
            torrentEngine.addLog('SECURITY', `Random port on startup enabled: bound to ephemeral port ${startupPort}.`);
          }
          torrentEngine.updateLibqrbitConfig(cfg);
        }
      }
    });

    // Check if the OS launched FlowDown via double-clicked .torrent file or magnet:// link
    import('@tauri-apps/api/core')
      .then(async ({ invoke }) => {
        const payload = await invoke<{
          kind?: 'torrent' | 'magnet';
          magnetUri?: string;
          filePath?: string;
          fileName?: string;
          fileSize?: number;
          infoHash?: string;
          files?: any[];
          pieceLength?: number;
          pieceCount?: number;
          trackers?: string[];
        } | null>('get_startup_open_payload');
        if (!payload?.kind) return;
        if (payload.kind === 'magnet' && payload.magnetUri) {
          // Open unified AddTorrentModal pre-populated with magnet URI
          setPendingStartupTorrent({
            magnetUri: payload.magnetUri,
            fileName: payload.fileName,
            fileSize: payload.fileSize,
            infoHash: payload.infoHash,
            files: payload.files,
            pieceLength: payload.pieceLength,
            pieceCount: payload.pieceCount,
            trackers: payload.trackers,
          });
          setIsAddTorrentOpen(true);
        } else if (payload.kind === 'torrent') {
          // Open AddTorrentModal pre-populated with probed metadata and file list like qBittorrent
          setPendingStartupTorrent({
            filePath: payload.filePath,
            fileName: payload.fileName,
            fileSize: payload.fileSize,
            infoHash: payload.infoHash,
            files: payload.files,
            pieceLength: payload.pieceLength,
            pieceCount: payload.pieceCount,
            trackers: payload.trackers,
          });
          setIsAddTorrentOpen(true);
        }
      })
      .catch(() => {});

    return () => {
      unsubscribe();
      unsubComplete();
    };
  }, []);

  // Listen to OS system theme when viewModePreference === 'system'
  useEffect(() => {
    if (viewModePreference !== 'system') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => setTheme(mq.matches ? 'dark' : 'light');
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [viewModePreference]);

  // Global keyboard shortcuts (Ctrl+O Add Torrent, Ctrl+U Add Magnet, Ctrl+, Preferences)
  useEffect(() => {
    const onGlobalKeyDown = (e: KeyboardEvent) => {
      if (
        document.activeElement instanceof HTMLInputElement ||
        document.activeElement instanceof HTMLTextAreaElement ||
        document.activeElement instanceof HTMLSelectElement
      ) {
        return;
      }
      if (e.ctrlKey || e.metaKey) {
        const key = e.key.toLowerCase();
        if (key === 'o' || key === 'u') {
          e.preventDefault();
          setIsAddTorrentOpen(true);
        } else if (key === ',') {
          e.preventDefault();
          setIsLibqrbitSettingsOpen(true);
        }
      }
    };
    window.addEventListener('keydown', onGlobalKeyDown);
    return () => window.removeEventListener('keydown', onGlobalKeyDown);
  }, []);

  // Prevent desktop webview navigation/reload when dropping files outside dedicated drop zones
  useEffect(() => {
    const preventDragNav = (e: DragEvent) => {
      e.preventDefault();
    };
    window.addEventListener('dragover', preventDragNav);
    window.addEventListener('drop', preventDragNav);
    return () => {
      window.removeEventListener('dragover', preventDragNav);
      window.removeEventListener('drop', preventDragNav);
    };
  }, []);

  // Sync OS palette & Light/Dark theme with document root
  useEffect(() => {
    document.documentElement.setAttribute('data-os', osStyle);
    if (theme === 'dark') {
      document.documentElement.classList.add('dark');
      document.documentElement.classList.remove('light');
    } else {
      document.documentElement.classList.remove('dark');
      document.documentElement.classList.add('light');
    }
  }, [osStyle, theme]);

  // Theme synchronization with HTML element
  const toggleTheme = () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    setViewModePreference(next);
    setTheme(next);
    torrentEngine.addLog('INFO', `Switched desktop palette to ${osStyle.toUpperCase()} ${next === 'dark' ? 'Dark' : 'Light'}.`);
  };

  // Filter torrents
  const filteredTorrents = useMemo(() => {
    return torrents.filter((t) => {
      // Search
      if (searchFilter.trim()) {
        const query = searchFilter.toLowerCase();
        const matchName = t.name.toLowerCase().includes(query);
        const matchHash = t.hash.toLowerCase().includes(query);
        const matchTag = t.tags.some((tag) => tag.toLowerCase().includes(query));
        if (!matchName && !matchHash && !matchTag) return false;
      }

      // Status
      if (selectedStatus === 'downloading') {
        const isDownloadingLike =
          t.status === 'downloading' ||
          t.status === 'stealth_active' ||
          t.status === 'checking' ||
          t.status === 'queued' ||
          (t.progress < 100 && t.status !== 'paused');
        if (!isDownloadingLike) return false;
      }
      if (selectedStatus === 'seeding' && t.status !== 'seeding') return false;
      if (selectedStatus === 'completed' && t.progress < 100) return false;
      if (selectedStatus === 'paused' && t.status !== 'paused') return false;
      if (selectedStatus === 'throttled' && t.status !== 'throttled') return false;
      if (selectedStatus === 'stealth' && (!t.libqrbitEnabled || t.status !== 'stealth_active')) return false;

      // Category
      if (selectedCategory !== 'All' && t.category !== selectedCategory) return false;

      // Tag
      if (selectedTag !== 'All' && !t.tags.includes(selectedTag)) return false;

      return true;
    });
  }, [torrents, searchFilter, selectedStatus, selectedCategory, selectedTag]);

  // Aggregate Speeds
  const totalDownSpeed = torrents.reduce((acc, t) => acc + (t.downloadSpeed || 0), 0);
  const totalUpSpeed = torrents.reduce((acc, t) => acc + (t.uploadSpeed || 0), 0);

  // Selected item (primary selected item for detail tabs)
  const primaryId = selectedId || (selectedIds.length > 0 ? selectedIds[0] : null);
  const selectedTorrent = torrents.find((t) => t.id === primaryId) || null;
  const selectedIsDownloading = useMemo(() => {
    const activeIds = selectedIds.length > 0 ? selectedIds : selectedId ? [selectedId] : [];
    if (activeIds.length === 0) return false;
    return activeIds.some((id) => {
      const tor = torrents.find((t) => t.id === id);
      return (
        tor &&
        (tor.status === 'downloading' ||
          tor.status === 'stealth_active' ||
          tor.status === 'throttled' ||
          tor.status === 'checking')
      );
    });
  }, [torrents, selectedIds, selectedId]);

  // Actions (operating on multi-selected items)
  const handleResumeSelected = () => {
    if (selectedIds.length > 0) {
      selectedIds.forEach((id) => torrentEngine.resumeTorrent(id));
    } else if (selectedId) {
      torrentEngine.resumeTorrent(selectedId);
    }
  };

  const handleStopSelected = () => {
    if (selectedIds.length > 0) {
      selectedIds.forEach((id) => torrentEngine.stopTorrent(id));
    } else if (selectedId) {
      torrentEngine.stopTorrent(selectedId);
    }
  };

  const handlePauseSelected = () => {
    if (selectedIds.length > 0) {
      selectedIds.forEach((id) => torrentEngine.pauseTorrent(id));
    } else if (selectedId) {
      torrentEngine.pauseTorrent(selectedId);
    }
  };

  const handleRequestDelete = (ids: string[]) => {
    const targets = torrents.filter((t) => ids.includes(t.id));
    if (targets.length > 0) {
      setDeleteConfirmation({ items: targets });
    }
  };

  const handleConfirmDelete = (deleteFiles: boolean) => {
    if (!deleteConfirmation) return;
    const count = deleteConfirmation.items.length;
    deleteConfirmation.items.forEach((t) => torrentEngine.deleteTorrent(t.id, deleteFiles));
    setSelectedIds([]);
    setSelectedId(null);
    setDeleteConfirmation(null);
    showToast('Transfers Removed', `Removed ${count} transfer(s)${deleteFiles ? ' (files erased from disk)' : ''}.`);
  };

  const handleDeleteSelected = () => {
    const ids = selectedIds.length > 0 ? selectedIds : selectedId ? [selectedId] : [];
    if (ids.length > 0) {
      handleRequestDelete(ids);
    }
  };

  const handleSelectAll = () => {
    const allIds = filteredTorrents.map((t) => t.id);
    setSelectedIds(allIds);
    setSelectedId(allIds[0] || null);
  };

  const handleMoveUp = () => {
    const targetId = primaryId;
    if (!targetId) return;
    torrentEngine.moveTorrent(targetId, 'up');
  };

  const handleMoveDown = () => {
    const targetId = primaryId;
    if (!targetId) return;
    torrentEngine.moveTorrent(targetId, 'down');
  };

  const handleToggleLibqrbitGlobal = () => {
    const nextState = !libqrbitConfig.enabled;
    torrentEngine.setLibqrbitEnabled(nextState);
  };

  const handleTriggerPortHop = async () => {
    const rpcRes = await apiClient.randomizeStealthPortRpc();
    const newPort =
      rpcRes?.port && rpcRes.port > 0
        ? rpcRes.port
        : Math.floor(49152 + Math.random() * (65535 - 49152));
    torrentEngine.updateLibqrbitConfig({ currentStealthPort: newPort });
    torrentEngine.addLog(
      'SECURITY',
      `Dynamic Port Hopping: Bound ephemeral UDP/TCP socket on Port ${newPort}.`
    );
  };

  // Handle applying optimal evasion profile from analyzer
  const handleApplyOptimalEvasion = (optimal: {
    dpiProfile: LibqrbitConfig['dpiEvasionProfile'];
    obfuscationLevel: ObfuscationLevel;
    shards: number;
    jitterMs: number;
    decoyProtocol: 'QUIC/TLS1.3' | 'DoH-Jitter' | 'WebRTC-Stream' | 'HTTP3-Echo';
    port: number;
  }) => {
    torrentEngine.updateLibqrbitConfig({
      enabled: true,
      dpiEvasionProfile: optimal.dpiProfile,
      currentStealthPort: optimal.port,
      packetPaddingJitterMs: optimal.jitterMs,
      aggressivePacketMorph: true,
      multiPathFragmentation: true,
      decoyEchoTunnel: true,
      dohResolver: 'cloudflare',
    });
    torrentEngine.setHttpSettings({ dohResolver: 'cloudflare' });
    void apiClient.setStealthRpc(true);

    // Update all active torrents with the new optimal evasion level & decoy protocol
    const allTorrents = torrentEngine.getTorrents();
    allTorrents.forEach((t) => {
      torrentEngine.setTorrentObfuscationLevel(t.id, optimal.obfuscationLevel);
    });

    torrentEngine.addLog(
      'LIBQRBIT',
      `[Optimizer] Applied MSE/PE + DoH evasion: Level ${optimal.obfuscationLevel} [${optimal.decoyProtocol}] with ${optimal.shards} multi-path shards on Port ${optimal.port}.`
    );
  };

  const handleMinimizeToTray = async () => {
    setIsClosePromptOpen(false);
    torrentEngine.addLog('INFO', 'FlowDown minimized to system tray.');
    try {
      const { getCurrentWindow } = await import('@tauri-apps/api/window');
      await getCurrentWindow().minimize();
    } catch {
      // browser fallback
    }
  };

  const handleExitApplication = async () => {
    setIsClosePromptOpen(false);
    torrentEngine.pauseAll();
    torrentEngine.addLog('INFO', 'All transfers paused. Application session ended.');
    try {
      const { getCurrentWindow } = await import('@tauri-apps/api/window');
      await getCurrentWindow().close();
    } catch {
      window.close();
    }
  };

  return (
    <div
      data-os={osStyle}
      onContextMenu={(e) => e.preventDefault()}
      className={`w-screen h-screen flex flex-col overflow-hidden select-none bg-[var(--os-bg-window)] text-[var(--os-text)] font-sans ${
        theme === 'dark' ? 'dark' : ''
      }`}
    >
      {/* 1. Classic Qt Menu Bar */}
      <QtMenuBar
        onOpenAddTorrent={() => setIsAddTorrentOpen(true)}
        onOpenAddUrl={() => setIsAddUrlOpen(true)}
        onOpenCreateTorrent={() => setIsTorrentCreatorOpen(true)}
        onOpenLibqrbitSettings={() => setIsLibqrbitSettingsOpen(true)}
        onOpenScheduler={() => setIsSchedulerOpen(true)}
            onOpenDiagnostic={() => setIsDiagnosticOpen(true)}
            onOpenAnalyzer={(tab) => handleOpenAnalyzer(tab)}
            onOpenAbout={() => setIsAboutOpen(true)}
            onCheckUpdates={() => setIsUpdateModalOpen(true)}
            onPauseAll={() => torrentEngine.pauseAll()}
            onResumeAll={() => torrentEngine.resumeAll()}
            onOpenDownloadInfo={() => {
              if (primaryId) setDownloadInfoTorrentId(primaryId);
            }}
            hasSelectedTorrent={!!primaryId}
            onToggleTurtle={() => torrentEngine.toggleTurtleMode()}
            onToggleLibqrbit={handleToggleLibqrbitGlobal}
            onToggleTheme={toggleTheme}
            theme={theme}
            libqrbitActive={libqrbitConfig.enabled}
            turtleActive={bandwidthLimits.altSpeedActive}
            osStyle={osStyle}
            onExit={() => setIsClosePromptOpen(true)}
            onSelectAll={handleSelectAll}
            showSidebar={showSidebar}
            onToggleSidebar={() => setShowSidebar((s) => !s)}
            showDetailTabs={showDetailTabs}
            onToggleDetailTabs={() => setShowDetailTabs((s) => !s)}
            showStatusBar={showStatusBar}
            onToggleStatusBar={() => setShowStatusBar((s) => !s)}
          />

          {/* 3. Qt Desktop Action Toolbar */}
          <QtToolBar
            onOpenAddTorrent={() => setIsAddTorrentOpen(true)}
            onOpenAddUrl={() => setIsAddUrlOpen(true)}
            onResumeSelected={handleResumeSelected}
            onStopSelected={handleStopSelected}
            onPauseSelected={handlePauseSelected}
            onDeleteSelected={handleDeleteSelected}
            onMoveUp={handleMoveUp}
            onMoveDown={handleMoveDown}
            onToggleTurtle={() => torrentEngine.toggleTurtleMode()}
            onSetTurtle={(active) => torrentEngine.setTurtleMode(active)}
            turtleActive={bandwidthLimits.altSpeedActive}
            onToggleLibqrbit={handleToggleLibqrbitGlobal}
            onSetLibqrbit={(active) => torrentEngine.setLibqrbitEnabled(active)}
            libqrbitActive={libqrbitConfig.enabled}
            onOpenSettings={() => setIsLibqrbitSettingsOpen(true)}
            searchFilter={searchFilter}
            onSearchChange={setSearchFilter}
            selectedCount={selectedIds.length}
            selectedIsDownloading={selectedIsDownloading}
            altDownloadLimitKbps={bandwidthLimits.altDownloadLimit}
          />

      {/* 4. Main Work Area: Resizable Left Sidebar + Resizable Bottom Detail Pane */}
      <div className={`flex-1 flex overflow-hidden ${isDraggingSidebar || isDraggingDetail ? 'select-none' : ''}`}>
        {/* Left Category / Status Tree Sidebar */}
        {showSidebar && (
          <>
            <QtCategorySidebar
              width={sidebarWidth}
              torrents={torrents}
              selectedCategory={selectedCategory}
              onSelectCategory={setSelectedCategory}
              selectedStatus={selectedStatus}
              onSelectStatus={setSelectedStatus}
              selectedTag={selectedTag}
              onSelectTag={setSelectedTag}
            />

            {/* Left Sidebar Interactive Vertical Splitter */}
            <div
              onMouseDown={handleSidebarMouseDown}
              onDoubleClick={() => setSidebarWidth(210)}
              title="Drag to resize sidebar width (Double-click to reset)"
              className={`w-1 hover:w-1.5 cursor-col-resize select-none relative z-20 group shrink-0 transition-all ${
                isDraggingSidebar
                  ? 'bg-[var(--os-accent)] w-1.5'
                  : 'bg-[var(--os-border)] hover:bg-[var(--os-accent)]'
              }`}
            >
              {/* Extended grab hit area */}
              <div className="absolute inset-y-0 -left-1.5 -right-1.5 z-30" />
            </div>
          </>
        )}

        {/* Right Area: Top Transfer Table + Horizontal Splitter + Bottom Detail Pane */}
        <div className="flex-1 flex flex-col overflow-hidden min-w-0">
          {/* Transfer Table with Draggable Marquee Selection */}
          <QtTransferTable
            torrents={filteredTorrents}
            selectedId={selectedId}
            selectedIds={selectedIds}
            onSelectTorrent={(id) => {
              setSelectedId(id);
              setSelectedIds([id]);
            }}
            onSelectTorrents={(ids, primary) => {
              setSelectedIds(ids);
              setSelectedId(primary ?? (ids.length > 0 ? ids[0] : null));
            }}
            onResume={(id) => torrentEngine.resumeTorrent(id)}
            onStop={(id) => torrentEngine.stopTorrent(id)}
            onPause={(id) => torrentEngine.pauseTorrent(id)}
            onDelete={(id) => handleRequestDelete([id])}
            onDeleteSelected={handleDeleteSelected}
            onForceRecheck={(id) => {
              const target = torrents.find((t) => t.id === id);
              torrentEngine.forceRecheck(id);
              showToast('Force Recheck Started', target ? `Verifying SHA-1 pieces for ${target.name}` : 'Verifying piece hashes on disk...');
            }}
            onSetPriority={(id, p) => torrentEngine.setPriority(id, p)}
            onSetHealthMode={(id, m) => torrentEngine.setHealthPriorityMode(id, m)}
            onToggleLibqrbit={(id) => torrentEngine.toggleTorrentLibqrbit(id)}
            onSetObfuscation={(id, lvl) => torrentEngine.setTorrentObfuscationLevel(id, lvl)}
            onOpenDownloadInfo={(id) => setDownloadInfoTorrentId(id)}
            onOpenFolder={handleOpenFolder}
            onOpenItem={handleOpenItem}
            onRequestRename={(id) => setRenameTorrentId(id)}
            onCopyName={handleCopyName}
            onCopyInfoHash={handleCopyInfoHash}
            onCopyMagnet={handleCopyMagnet}
            compactDensity={Boolean(systemSettingsState.compactDensity)}
          />

          {/* Bottom Detail Pane Interactive Horizontal Splitter & Tabs */}
          {showDetailTabs && (
            <>
              <div
                onMouseDown={handleDetailMouseDown}
                onDoubleClick={() => setDetailHeight(detailHeight > 40 ? 36 : 200)}
                title="Drag to resize detail pane height (Double-click to toggle collapse)"
                className={`h-1.5 hover:h-2 cursor-row-resize select-none relative z-20 group shrink-0 flex items-center justify-center transition-all ${
                  isDraggingDetail
                    ? 'bg-[var(--os-accent)] h-2'
                    : 'bg-[var(--os-border)] hover:bg-[var(--os-accent)]'
                }`}
              >
                {/* Extended grab hit area */}
                <div className="absolute -top-1.5 -bottom-1.5 inset-x-0 z-30" />
                {/* Visual grab handle dots indicator */}
                <div className="flex gap-1 items-center opacity-50 group-hover:opacity-100 transition-opacity">
                  <span className="w-1 h-1 rounded-full bg-[var(--os-text-muted)]" />
                  <span className="w-1 h-1 rounded-full bg-[var(--os-text-muted)]" />
                  <span className="w-1 h-1 rounded-full bg-[var(--os-text-muted)]" />
                </div>
              </div>

              {/* Split Bottom Detail Tabs (General, Trackers, Peers, Pieces, Speed Graph, libqrbit Lab, Logs) */}
              <QtDetailTabs
                height={detailHeight}
                torrent={selectedTorrent}
                speedHistory={speedHistory}
                logs={logs}
                theme={theme}
                stealthPort={libqrbitConfig.currentStealthPort}
                stealthEnabled={libqrbitConfig.enabled}
                onTriggerPortHop={handleTriggerPortHop}
                onOpenDiagnostic={() => setIsDiagnosticOpen(true)}
                onOpenAnalyzer={() => handleOpenAnalyzer('p2p')}
              />
            </>
          )}
        </div>
      </div>

      {/* 5. Classic Qt Status Bar */}
      {showStatusBar && (
        <QtStatusBar
          totalDownSpeed={totalDownSpeed}
          totalUpSpeed={totalUpSpeed}
          sessionDownloaded={sessionStats.sessionDownloaded}
          sessionUploaded={sessionStats.sessionUploaded}
          bandwidthLimits={bandwidthLimits}
          libqrbitActive={libqrbitConfig.enabled}
          stealthPort={libqrbitConfig.currentStealthPort}
          rustConnected={rustConnected}
          activePeersCount={torrents.reduce((acc, t) => acc + (t.status === 'paused' ? 0 : t.peersConnected + t.seedsConnected), 0)}
          onToggleTurtle={() => torrentEngine.toggleTurtleMode()}
          onSetGlobalLimit={(down, up) => torrentEngine.setGlobalLimits(down, up)}
          onOpenScheduler={() => setIsSchedulerOpen(true)}
          onOpenLibqrbitSettings={() => setIsLibqrbitSettingsOpen(true)}
          onResetSessionStats={handleResetSessionStats}
        />
      )}

      {/* Modals & Dialogs */}
      <AddTorrentModal
        isOpen={isAddTorrentOpen}
        onClose={() => {
          setIsAddTorrentOpen(false);
          setPendingStartupTorrent(null);
        }}
        defaultDownloadDirectory={defaultDownloadDir}
        initialTorrent={pendingStartupTorrent}
        onAdd={(data) => {
          const dup = torrentEngine.findDuplicate({
            hash: data.hash,
            name: data.name,
            savePath: data.savePath,
            magnetUri: data.magnetUri,
          });
          if (dup) {
            setIsAddTorrentOpen(false);
            setPendingStartupTorrent(null);
            setDuplicateConflict({
              existingItem: dup,
              newItemName: data.name,
              type: 'torrent',
              data,
            });
            return;
          }
          setIsAddTorrentOpen(false);
          setPendingStartupTorrent(null);
          torrentEngine.addTorrent(data);
          showToast('Transfer Added', data.name);
        }}
      />

      <AddUrlModal
        isOpen={isAddUrlOpen}
        onClose={() => setIsAddUrlOpen(false)}
        defaultDownloadDirectory={defaultDownloadDir}
        onAdd={(data) => {
          const dup = torrentEngine.findDuplicate({
            url: data.url,
            name: data.name,
            savePath: data.savePath,
          });
          if (dup) {
            setIsAddUrlOpen(false);
            setDuplicateConflict({
              existingItem: dup,
              newItemName: data.name,
              type: 'http',
              data,
            });
            return;
          }
          setIsAddUrlOpen(false);
          torrentEngine.addHttpUrlDownload(data);
          showToast('Download Started', data.name);
        }}
      />

      <OptionsModal
        isOpen={isLibqrbitSettingsOpen}
        onClose={() => setIsLibqrbitSettingsOpen(false)}
        config={libqrbitConfig}
        limits={bandwidthLimits}
        httpSettings={torrentEngine.getHttpSettings()}
        theme={theme}
        viewModePreference={viewModePreference}
        systemSettings={systemSettingsState}
        defaultDownloadDirectory={defaultDownloadDir}
        onSaveDownloadDirectory={(dir, applyAll) => torrentEngine.setDefaultDownloadDirectory(dir, applyAll ?? true)}
        onSaveConfig={(cfg) => torrentEngine.updateLibqrbitConfig(cfg)}
        onSaveLimits={(lms) => {
          torrentEngine.setBandwidthLimits(lms);
        }}
        onSaveHttpSettings={(s) => {
          torrentEngine.setHttpSettings(s);
        }}
        onSaveSystemSettings={(sys) => {
          setSystemSettingsState((prev) => ({ ...prev, ...sys }));
        }}
        onSetViewMode={(mode) => setViewModePreference(mode)}
        onSetTheme={(t) => {
          setTheme(t);
          if (t === 'dark') {
            document.documentElement.classList.add('dark');
            document.documentElement.classList.remove('light');
          } else {
            document.documentElement.classList.remove('dark');
            document.documentElement.classList.add('light');
          }
        }}
        onOpenAnalyzer={() => {
          setIsLibqrbitSettingsOpen(false);
          handleOpenAnalyzer('p2p');
        }}
      />

      <BandwidthSchedulerModal
        isOpen={isSchedulerOpen}
        onClose={() => setIsSchedulerOpen(false)}
        limits={bandwidthLimits}
        onSave={(lms) => {
          torrentEngine.setBandwidthLimits(lms);
        }}
      />

      {/* Network Throttling & HTTP Multi-Part Analyzer Modal */}
      <AnalyzerModal
        isOpen={isAnalyzerOpen}
        onClose={() => setIsAnalyzerOpen(false)}
        currentConfig={libqrbitConfig}
        onApplyOptimal={handleApplyOptimalEvasion}
        onApplyHttpOptimal={(segments, multiPath) => {
          torrentEngine.applyHttpOptimalSettings(segments, multiPath);
        }}
        initialTab={analyzerInitialTab}
      />

      <DiagnosticModal
        isOpen={isDiagnosticOpen}
        onClose={() => setIsDiagnosticOpen(false)}
        onApplyEvasion={(measured) => {
          const validProfile = (
            measured?.profileName === 'Government Firewall' ||
            measured?.profileName === 'Strict Campus/Dorm' ||
            measured?.profileName === 'ISP Deep Inspection'
              ? measured.profileName
              : 'ISP Deep Inspection'
          ) as LibqrbitConfig['dpiEvasionProfile'];
          const nextPort = measured?.port || libqrbitConfig.currentStealthPort || 52841;
          torrentEngine.updateLibqrbitConfig({
            enabled: true,
            aggressivePacketMorph: true,
            multiPathFragmentation: true,
            decoyEchoTunnel: true,
            dpiEvasionProfile: validProfile,
            currentStealthPort: nextPort,
            dohResolver: 'cloudflare',
          });
          torrentEngine.setHttpSettings({ dohResolver: 'cloudflare' });
          void apiClient.setStealthRpc(true);
          if (measured?.recommendedSegments) {
            torrentEngine.applyHttpOptimalSettings(measured.recommendedSegments, true);
          }
          const allTorrents = torrentEngine.getTorrents();
          allTorrents.forEach((t) => {
            torrentEngine.setTorrentObfuscationLevel(t.id, 3);
          });
          torrentEngine.addLog(
            'LIBQRBIT',
            `Enforced MSE/PE 768-bit DH + RC4 shield (${(measured?.mseEntropyBits ?? 7.42).toFixed(2)} bits/B), Cloudflare DoH, Port ${nextPort}, and ${measured?.recommendedSegments ?? 8}x HTTP segments.`
          );
          showToast(
            'libqrbit Automated Bypass Active',
            `Port ${nextPort} • MSE/PE RC4 • Cloudflare DoH • ${measured?.recommendedSegments ?? 8}x Segments`
          );
        }}
      />

      <TorrentCreatorModal
        isOpen={isTorrentCreatorOpen}
        onClose={() => setIsTorrentCreatorOpen(false)}
        onCreated={(name, size) => {
          const fullName = `${name}.mkv`;
          const dup = torrentEngine.findDuplicate({
            name: fullName,
            savePath: defaultDownloadDir,
          });
          const data = {
            name: fullName,
            size,
            category: 'Media',
            priority: 'Normal' as Priority,
            libqrbitEnabled: true,
            obfuscationLevel: 3 as ObfuscationLevel,
            savePath: defaultDownloadDir,
          };
          if (dup) {
            setDuplicateConflict({
              existingItem: dup,
              newItemName: fullName,
              type: 'torrent',
              data,
            });
            return;
          }
          torrentEngine.addTorrent(data);
          showToast('Torrent Created & Added', fullName);
        }}
      />

      <AboutModal
        isOpen={isAboutOpen}
        onClose={() => setIsAboutOpen(false)}
      />

      <UpdateModal
        isOpen={isUpdateModalOpen}
        onClose={() => setIsUpdateModalOpen(false)}
        osStyle={osStyle}
      />

      <DownloadInfoModal
        isOpen={!!downloadInfoTorrentId}
        torrent={downloadInfoTorrent}
        onClose={() => setDownloadInfoTorrentId(null)}
        onResume={(id) => torrentEngine.resumeTorrent(id)}
        onPause={(id) => torrentEngine.pauseTorrent(id)}
        onMinimize={() => setDownloadInfoTorrentId(null)}
        onCancel={(id) => {
          handleRequestDelete([id]);
          setDownloadInfoTorrentId(null);
        }}
        onSetSpeedLimit={(id, limitKb) => {
          torrentEngine.setTransferSpeedLimit(id, limitKb);
        }}
        onSaveCompletionOptions={(id, opts) => {
          torrentEngine.setCompletionOptions(id, opts);
        }}
      />

      <RenameTransferModal
        isOpen={!!renameTorrentId}
        torrent={renameTorrentTarget}
        onClose={() => setRenameTorrentId(null)}
        onRename={(id, newName) => {
          torrentEngine.renameTorrent(id, newName);
          showToast('Transfer Renamed', newName);
        }}
      />

      {duplicateConflict && (
        <DuplicateTransferModal
          isOpen={!!duplicateConflict}
          onClose={() => setDuplicateConflict(null)}
          existingItem={duplicateConflict.existingItem}
          newItemName={duplicateConflict.newItemName}
          onOverwrite={() => {
            torrentEngine.deleteTorrent(duplicateConflict.existingItem.id, true);
            if (duplicateConflict.type === 'torrent') {
              torrentEngine.addTorrent(duplicateConflict.data);
            } else {
              torrentEngine.addHttpUrlDownload(duplicateConflict.data);
            }
            showToast('Transfer Overwritten', duplicateConflict.newItemName);
            setDuplicateConflict(null);
          }}
          onDoNotAdd={() => {
            showToast('Duplicate Ignored', `Kept existing "${duplicateConflict.existingItem.name}".`);
            setDuplicateConflict(null);
          }}
          onCancel={() => setDuplicateConflict(null)}
          osStyle={osStyle}
        />
      )}

      {deleteConfirmation && (
        <DeleteConfirmModal
          isOpen={!!deleteConfirmation}
          onClose={() => setDeleteConfirmation(null)}
          items={deleteConfirmation.items}
          onConfirmDelete={handleConfirmDelete}
          osStyle={osStyle}
        />
      )}

      {toast && (
        <div className="fixed bottom-8 right-4 z-50 max-w-sm bg-[var(--os-bg-content)] border border-[var(--os-accent)] rounded shadow-2xl px-3 py-2 text-xs text-[var(--os-text)] animate-in fade-in slide-in-from-bottom-2 duration-150 pointer-events-auto">
          <div className="font-semibold text-[11px] text-[var(--os-accent)]">{toast.title}</div>
          <div className="font-mono text-[10px] text-[var(--os-text-muted)] truncate mt-0.5">{toast.detail}</div>
        </div>
      )}

      {/* Qt Native OS Close Confirmation Dialog */}
      {isClosePromptOpen && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-xs flex items-center justify-center z-50 p-4 select-none">
          <div className={`w-full max-w-md bg-[var(--os-bg-window)] border border-[var(--os-border)] shadow-2xl overflow-hidden text-[var(--os-text)] text-xs font-sans flex flex-col ${
            osStyle === 'macos' ? 'rounded-2xl' : osStyle === 'windows' ? 'rounded-lg' : 'rounded-md'
          }`}>
            {/* Title bar */}
            <SubwindowHeader
              onClose={() => setIsClosePromptOpen(false)}
              title="Exit FlowDown"
              osStyle={osStyle}
            />

            <div className="p-4 space-y-3">
              <p className="text-sm font-medium text-[var(--os-text)]">
                Are you sure you want to exit FlowDown?
              </p>
              <p className="text-[var(--os-text-muted)] text-xs leading-relaxed">
                Active BitTorrent downloads and libqrbit anti-throttling shields will pause if the process is terminated. You can minimize to the system tray to let background transfers continue.
              </p>

              <div className="pt-2 flex flex-col sm:flex-row gap-2 justify-end">
                <button
                  onClick={() => setIsClosePromptOpen(false)}
                  className="px-3 py-1.5 rounded bg-[var(--os-bg-control)] hover:bg-[var(--os-bg-hover)] border border-[var(--os-border)] text-[var(--os-text)] text-xs font-medium"
                >
                  Cancel
                </button>
                <button
                  onClick={handleMinimizeToTray}
                  className="px-3 py-1.5 rounded bg-[var(--os-accent)] hover:bg-[var(--os-accent-hover)] text-white text-xs font-semibold shadow-2xs"
                >
                  Minimize to Tray
                </button>
                <button
                  onClick={handleExitApplication}
                  className="px-3 py-1.5 rounded bg-rose-600 hover:bg-rose-500 text-white text-xs font-semibold shadow-2xs"
                >
                  Exit Application
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
