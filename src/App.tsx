import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowUpDown,
  CheckSquare,
  Copy,
  Download,
  FolderOpen,
  Maximize2,
  Pause,
  Play,
  Plus,
  Search,
  SlidersHorizontal,
  Square,
  Trash2,
  X,
} from 'lucide-react';
import {
  DownloadItem,
  FileType,
  GlobalSettings,
  StealthConfig,
  TorrentFile,
} from './types';
import { INITIAL_DOWNLOADS } from './data/mockDownloads';
import {
  getDefaultDirectoryList,
  getDefaultDownloadsPath,
  extractUrlFromDataTransfer,
} from './utils/urlHelper';
import { Header } from './components/Header';
import { Sidebar } from './components/Sidebar';
import { DownloadItemRow } from './components/DownloadItemRow';
import { ToastContainer, ToastMessage } from './components/Toast';
import { formatSpeed } from './utils/formatters';
import {
  createDownloadDirectory,
  deleteIncompleteTransferNative,
  downloadFileNative,
  getTorrentProgressNative,
  waitForTorrentReadyNative,
  joinPathNative,
  openDirectoryNative,
  openPathNative,
  resolveDownloadPath,
  isTauriEnvironment,
  startTorrentNative,
  pauseTorrentNative,
  pauseHttpDownloadNative,
  resumeTorrentNative,
  updateTorrentEngineConfigNative,
} from './utils/tauri';
import { checkForUpdate, AppUpdateInfo } from './utils/updater';
import { ErrorBoundary } from './components/ErrorBoundary';
import { logger } from './utils/logger';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { restoreStateCurrent, saveWindowState, StateFlags } from '@tauri-apps/plugin-window-state';

const AddDownloadModal = React.lazy(() =>
  import('./components/AddDownloadModal').then((m) => ({
    default: m.AddDownloadModal,
  }))
);
const DownloadDetailModal = React.lazy(() =>
  import('./components/DownloadDetailModal').then((m) => ({
    default: m.DownloadDetailModal,
  }))
);
const SettingsModal = React.lazy(() =>
  import('./components/SettingsModal').then((m) => ({
    default: m.SettingsModal,
  }))
);
const AboutModal = React.lazy(() =>
  import('./components/AboutModal').then((m) => ({
    default: m.AboutModal,
  }))
);
const DirectoryPromptModal = React.lazy(() =>
  import('./components/DirectoryPromptModal').then((m) => ({
    default: m.DirectoryPromptModal,
  }))
);
const UpdateModal = React.lazy(() =>
  import('./components/UpdateModal').then((m) => ({
    default: m.UpdateModal,
  }))
);

let startupLogWritten = false;

type NewDownloadData = {
  name: string;
  url: string;
  size: number;
  fileType: FileType;
  category: string;
  savePath: string;
  connections: number;
  startImmediately: boolean;
  isTorrent?: boolean;
  engine?: 'librqbit' | 'http';
  stealthConfig?: StealthConfig;
  torrentFiles?: TorrentFile[];
};

export default function App() {
  const [downloads, setDownloads] = useState<DownloadItem[]>(() => {
    try {
      const saved = localStorage.getItem('flowdown_downloads_v2');
      if (saved) return JSON.parse(saved) as DownloadItem[];
    } catch {
      // Ignore malformed persisted state.
    }
    return INITIAL_DOWNLOADS;
  });

  const [existingDirectories, setExistingDirectories] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem('flowdown_existing_dirs_v2');
      if (saved) {
        const parsed = JSON.parse(saved) as string[];
        if (!parsed.some((p) => p.includes('C:/Downloads'))) {
          return parsed;
        }
      }
    } catch {
      // Use defaults below.
    }
    return getDefaultDirectoryList();
  });

  const [activeTab, setActiveTab] = useState('all');
  const [selectedFileType, setSelectedFileType] = useState<FileType | 'all'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState<
    'addedAt' | 'name' | 'size' | 'speed' | 'progress'
  >('addedAt');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [externalTransferSource, setExternalTransferSource] = useState<string | undefined>();
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isAboutOpen, setIsAboutOpen] = useState(false);
  const [isUpdateModalOpen, setIsUpdateModalOpen] = useState(false);
  const [appUpdateInfo, setAppUpdateInfo] = useState<AppUpdateInfo | null>(null);
  const [isCheckingUpdate, setIsCheckingUpdate] = useState(false);
  const [inspectingItem, setInspectingItem] = useState<DownloadItem | null>(null);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const [pendingDownloadData, setPendingDownloadData] = useState<NewDownloadData | null>(null);
  const [contextMenu, setContextMenu] = useState<{
    item: DownloadItem;
    x: number;
    y: number;
  } | null>(null);

  const handleCheckForUpdates = async (showModalIfNoUpdate = true) => {
    try {
      setIsCheckingUpdate(true);
      const info = await checkForUpdate();
      setAppUpdateInfo(info);
      if (info.available) {
        setIsUpdateModalOpen(true);
      } else if (showModalIfNoUpdate) {
        setIsUpdateModalOpen(true);
      }
    } catch (err: any) {
      console.warn('[FlowDown] Update check failed:', err);
      if (showModalIfNoUpdate) {
        const errorMsg = String(err?.message || err || '');
        let userMessage = 'Could not connect to GitHub Releases.';
        if (errorMsg.includes('404') || errorMsg.toLowerCase().includes('not found')) {
          userMessage = 'No release manifest found on GitHub. FlowDown is currently up to date.';
        } else if (errorMsg) {
          userMessage = errorMsg;
        }
        addToast('Update Check Failed', userMessage, 'error');
      }
    } finally {
      setIsCheckingUpdate(false);
    }
  };

  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    if (typeof window !== 'undefined' && window.matchMedia) {
      return window.matchMedia('(prefers-color-scheme: dark)').matches
        ? 'dark'
        : 'light';
    }
    return 'dark';
  });

  const [settings, setSettings] = useState<GlobalSettings>(() => ({
    maxSimultaneousDownloads: 3,
    globalSpeedLimit: 0,
    defaultSavePath: getDefaultDownloadsPath(),
    autoStartNext: true,
    soundNotifications: true,
    theme,
    minimizeToTaskbar: false,
    stealthEnabled: true,
    protocolEncryptionRequired: true,
    hardwareAcceleration: true,
    torrentEngine: 'librqbit',
    torrentListenPort: 51413,
    torrentRandomizePort: false,
    disableDht: false,
    anonymousMode: true,
    stealthProtocolEncryption: true,
    stealthPortRandomization: true,
    stealthSpoofClientId: 'FlowDown/1.0',
    stealthDhtObfuscation: true,
    stealthAntiThrottlingNoise: false,
    uploadSpeedLimit: 0,
    maxPeersPerTorrent: 80,
  }));

  const activeTransfers = useRef<Set<string>>(new Set());
  const pausedTorrentIds = useRef<Set<string>>(new Set());
  const abortedTransferIds = useRef<Set<string>>(new Set());

  useEffect(() => {
    try {
      localStorage.setItem('flowdown_downloads_v2', JSON.stringify(downloads));
    } catch {
      // Ignore storage failures.
    }
  }, [downloads]);


  // Handle .torrent files and magnet: links opened by the operating system.
  // Cold-start arguments are read from Rust state; subsequent invocations are
  // forwarded by the single-instance plugin to this running window.
  useEffect(() => {
    if (!isTauriEnvironment()) return;

    let cancelled = false;
    let unlisten: (() => void) | undefined;

    const openExternalTransfer = (source: string) => {
      const trimmed = source.trim();
      if (!trimmed) return;
      setExternalTransferSource(trimmed);
      setIsAddModalOpen(true);
    };

    void invoke<string | null>('take_external_transfer')
      .then((source) => {
        if (!cancelled && source) openExternalTransfer(source);
      })
      .catch((error) => {
        console.debug('[FlowDown] No external transfer argument available', error);
      });

    void listen<{ source: string }>('external-transfer', (event) => {
      openExternalTransfer(event.payload.source);
    }).then((stop) => {
      if (cancelled) {
        stop();
      } else {
        unlisten = stop;
      }
    });

    // Handle files (.torrent files) dragged and dropped directly onto the Tauri window
    let unlistenWebviewDrop: (() => void) | undefined;
    try {
      void getCurrentWebview().onDragDropEvent((event) => {
        if (event.payload.type === 'drop' && event.payload.paths?.length) {
          for (const filePath of event.payload.paths) {
            const trimmed = filePath.trim();
            if (trimmed.toLowerCase().endsWith('.torrent') || trimmed.toLowerCase().startsWith('magnet:')) {
              openExternalTransfer(trimmed);
              break;
            }
          }
        }
      }).then((stop) => {
        if (cancelled) {
          stop();
        } else {
          unlistenWebviewDrop = stop;
        }
      });
    } catch (err) {
      console.debug('[FlowDown] Could not attach native webview onDragDropEvent', err);
    }

    return () => {
      cancelled = true;
      unlisten?.();
      unlistenWebviewDrop?.();
    };
  }, []);

  const handleWindowDragOver = (e: React.DragEvent) => {
    // Enable dropping links or text directly into the window
    e.preventDefault();
    if (e.dataTransfer) {
      e.dataTransfer.dropEffect = 'copy';
    }
  };

  const handleWindowDrop = (e: React.DragEvent) => {
    e.preventDefault();
    if (!e.dataTransfer) return;

    const extracted = extractUrlFromDataTransfer(e.dataTransfer);
    if (extracted) {
      setExternalTransferSource(extracted);
      setIsAddModalOpen(true);
      addToast('Link Received', extracted, 'info');
    }
  };

  // Window-state plugin: restore position/size/maximized state on startup and
  // save changes while the native window is moved or resized. This is kept in
  // the Tauri layer so the same behavior works on Windows, macOS and Linux.
  useEffect(() => {
    if (!isTauriEnvironment()) return;

    let cancelled = false;
    let saveTimer: ReturnType<typeof setTimeout> | null = null;
    let unlistenMoved: (() => void) | undefined;
    let unlistenResized: (() => void) | undefined;
    const persistentFlags = StateFlags.ALL & ~StateFlags.VISIBLE;

    const scheduleSave = () => {
      if (saveTimer) clearTimeout(saveTimer);
      saveTimer = setTimeout(() => {
        void saveWindowState(persistentFlags).catch((error) => {
          console.debug('[FlowDown] Could not save window state', error);
        });
      }, 250);
    };

    const showFallbackTimer = setTimeout(async () => {
      try {
        await getCurrentWindow().show();
      } catch {
        // Window might already be visible.
      }
    }, 500);

    void restoreStateCurrent(persistentFlags)
      .catch((error) => {
        console.debug('[FlowDown] Could not restore window state', error);
      })
      .finally(async () => {
        clearTimeout(showFallbackTimer);
        if (cancelled) return;
        try {
          await getCurrentWindow().show();
        } catch {
          // The window may already be visible.
        }
      });

    void (async () => {
      const currentWindow = getCurrentWindow();
      try {
        unlistenMoved = await currentWindow.onMoved(scheduleSave);
        unlistenResized = await currentWindow.onResized(scheduleSave);
      } catch (error) {
        console.debug('[FlowDown] Could not subscribe to window state events', error);
      }
    })();

    const handleBeforeUnload = () => {
      void saveWindowState(persistentFlags).catch(() => undefined);
    };
    window.addEventListener('beforeunload', handleBeforeUnload);

    return () => {
      cancelled = true;
      clearTimeout(showFallbackTimer);
      if (saveTimer) clearTimeout(saveTimer);
      window.removeEventListener('beforeunload', handleBeforeUnload);
      unlistenMoved?.();
      unlistenResized?.();
      void saveWindowState(persistentFlags).catch(() => undefined);
    };
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(
        'flowdown_existing_dirs_v2',
        JSON.stringify(existingDirectories)
      );
    } catch {
      // Ignore storage failures.
    }
  }, [existingDirectories]);

  useEffect(() => {
    try {
      const savedSettings = localStorage.getItem('flowdown_settings_v2');
      if (!savedSettings) return;

      const parsed = JSON.parse(savedSettings) as Partial<GlobalSettings>;
      const defaultPath =
        parsed.defaultSavePath === 'C:/Downloads' || !parsed.defaultSavePath
          ? getDefaultDownloadsPath()
          : parsed.defaultSavePath;

      setSettings((current) => ({
        ...current,
        ...parsed,
        defaultSavePath: defaultPath,
      }));

      if (parsed.theme === 'dark' || parsed.theme === 'light') {
        setTheme(parsed.theme);
      }
    } catch {
      // Ignore malformed persisted settings.
    }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem('flowdown_settings_v2', JSON.stringify(settings));
    } catch {
      // Ignore storage failures.
    }

    void updateTorrentEngineConfigNative({
      listenPort: settings.torrentListenPort,
      randomizePort: settings.torrentRandomizePort,
      disableDht: settings.disableDht,
      anonymousMode: settings.anonymousMode,
      clientIdSpoof: settings.stealthSpoofClientId,
    }).catch((err) => {
      console.debug('[FlowDown] Could not update torrent engine config', err);
    });
  }, [
    settings,
    settings.torrentListenPort,
    settings.torrentRandomizePort,
    settings.disableDht,
    settings.anonymousMode,
    settings.stealthSpoofClientId,
  ]);

  useEffect(() => {
    void resolveDownloadPath(settings.defaultSavePath)
      .then((actualPath) => {
        if (actualPath && actualPath !== settings.defaultSavePath) {
          setSettings((current) => ({ ...current, defaultSavePath: actualPath }));
        }
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void Promise.all(existingDirectories.map(async (directory) => resolveDownloadPath(directory)))
      .then((resolved) => {
        if (!cancelled) {
          const unique = Array.from(new Set(resolved));
          if (unique.some((path, index) => path !== existingDirectories[index]) || unique.length !== existingDirectories.length) {
            setExistingDirectories(unique);
          }
        }
      })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void Promise.all(
      downloads.map(async (download) => ({
        id: download.id,
        path: await resolveDownloadPath(download.savePath),
      }))
    )
      .then((resolved) => {
        if (cancelled) return;
        const changed = resolved.some((entry) => {
          const current = downloads.find((download) => download.id === entry.id);
          return current && current.savePath !== entry.path;
        });
        if (!changed) return;
        setDownloads((current) =>
          current.map((download) => {
            const entry = resolved.find((item) => item.id === download.id);
            return entry ? { ...download, savePath: entry.path } : download;
          })
        );
      })
      .catch(() => undefined);

    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle('dark', theme === 'dark');
    root.style.colorScheme = theme;
  }, [theme]);

  useEffect(() => {
    if (startupLogWritten) return;
    startupLogWritten = true;
    void logger.log('FlowDown UI started');
  }, []);

  useEffect(() => {
    if (!inspectingItem) return;
    const current = downloads.find((d) => d.id === inspectingItem.id);
    if (current) setInspectingItem(current);
  }, [downloads, inspectingItem]);

  const addToast = (
    title: string,
    description: string,
    type: 'success' | 'info' | 'error' = 'info'
  ) => {
    const id = `toast-${Date.now()}-${Math.random()}`;
    setToasts((prev) => [...prev, { id, title, description, type }]);
    window.setTimeout(() => {
      setToasts((prev) => prev.filter((toast) => toast.id !== id));
    }, 4000);
  };

  const removeToast = (id: string) => {
    setToasts((prev) => prev.filter((toast) => toast.id !== id));
  };

  const playChime = () => {
    if (!settings.soundNotifications) return;

    try {
      const AudioContextCtor =
        window.AudioContext ||
        (window as typeof window & { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext;
      if (!AudioContextCtor) return;

      const ctx = new AudioContextCtor();
      const oscillator = ctx.createOscillator();
      const gain = ctx.createGain();

      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(587.33, ctx.currentTime);
      oscillator.frequency.setValueAtTime(880, ctx.currentTime + 0.1);
      gain.gain.setValueAtTime(0.1, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
      oscillator.connect(gain);
      gain.connect(ctx.destination);
      oscillator.start();
      oscillator.stop(ctx.currentTime + 0.3);
    } catch {
      // Audio may be blocked until a user gesture.
    }
  };

  const toggleTheme = () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    setSettings((current) => ({ ...current, theme: next }));
  };

  const handleAddDirectory = (path: string) => {
    setExistingDirectories((previous) =>
      previous.includes(path) ? previous : [...previous, path]
    );
  };

  const startTransfer = async (item: DownloadItem) => {
    if (activeTransfers.current.has(item.id)) return;

    activeTransfers.current.add(item.id);

    setDownloads((previous) =>
      previous.map((download) =>
        download.id === item.id
          ? { ...download, status: 'downloading', speed: 0 }
          : download
      )
    );

    try {
      if (
        item.isTorrent ||
        item.fileType === 'torrent' ||
        item.engine === 'librqbit'
      ) {
        await logger.log(
          `Starting BitTorrent download: ${item.name} | ${item.url}`
        );
        await logger.log(`Requested torrent save path: ${item.savePath}`);

        const selectedFileIndexes = item.torrentFiles
          ?.map((file, index) => (file.selected === false ? undefined : index))
          .filter((index): index is number => index !== undefined);

        let torrentId = item.torrentId;
        let torrentInfoHash = item.infoHash;
        let torrentName = item.name;
        let torrentTotal = item.size;
        const torrentIsMultiFile =
          item.torrentIsMultiFile ?? ((item.torrentFiles?.length ?? 0) > 1);
        let torrentSubfolder = torrentIsMultiFile
          ? (item.torrentSubfolder || item.name)
          : undefined;

        if (torrentId !== undefined) {
          await resumeTorrentNative(torrentId);
          pausedTorrentIds.current.delete(item.id);
          await logger.log(`Resumed native torrent: ${torrentId}`);
        } else {
          const torrent = await startTorrentNative(
            item.url,
            item.savePath,
            selectedFileIndexes && selectedFileIndexes.length > 0
              ? selectedFileIndexes
              : undefined,
            true,
            torrentIsMultiFile ? item.name : undefined
          );

          torrentId = torrent.torrentId;
          torrentInfoHash = torrent.infoHash;
          torrentName = torrent.name || item.name;
          torrentTotal = torrent.total > 0 ? torrent.total : item.size;
          torrentSubfolder = torrentIsMultiFile
            ? (torrent.subFolder || torrentName)
            : undefined;

          await logger.log(`Native torrent started: ${torrent.torrentId}`);
          await logger.log(`Native torrent info hash: ${torrent.infoHash}`);
        }

        if (torrentId === undefined) {
          throw new Error('Native torrent did not return a torrent ID');
        }

        const managedTorrentId = torrentId;

        setDownloads((previous) =>
          previous.map((download) =>
            download.id === item.id
              ? {
                  ...download,
                  torrentId: managedTorrentId,
                  infoHash: torrentInfoHash,
                  name: torrentName,
                  size: torrentTotal,
                  torrentSubfolder,
                  torrentIsMultiFile,
                  isTorrent: true,
                  engine: 'librqbit',
                  status: 'downloading',
                  preparing: true,
                  preparingLabel: 'Preparing torrent...',
                }
              : download
          )
        );

        let lastDownloaded = item.downloaded;
        let lastAt = performance.now();

        while (true) {
          if (abortedTransferIds.current.has(item.id)) {
            return;
          }

          if (pausedTorrentIds.current.has(item.id)) {
            await new Promise<void>((resolve) => {
              window.setTimeout(resolve, 500);
            });
            continue;
          }

          let progress;
          try {
            progress = await getTorrentProgressNative(managedTorrentId);
          } catch (error) {
            if (abortedTransferIds.current.has(item.id)) {
              return;
            }
            throw error;
          }

          if (abortedTransferIds.current.has(item.id)) {
            return;
          }

          if (progress.error) {
            if (abortedTransferIds.current.has(item.id)) {
              return;
            }
            throw new Error(progress.error);
          }

          const now = performance.now();
          const elapsed = Math.max((now - lastAt) / 1000, 0.001);

          const initializing = progress.state.toLowerCase() === 'initializing';
          const liveDownloading = !initializing && !progress.finished;
          const delta = liveDownloading
            ? Math.max(0, progress.downloaded - lastDownloaded)
            : 0;
          const measuredSpeed = liveDownloading
            ? Math.round(delta / elapsed)
            : 0;

          if (initializing) {
            lastDownloaded = 0;
            lastAt = now;
          } else {
            lastDownloaded = progress.downloaded;
            lastAt = now;
          }

          const total =
            progress.total > 0
              ? progress.total
              : torrentTotal;

          const displayDownloaded = initializing
            ? 0
            : progress.finished
              ? total
              : Math.min(progress.downloaded, total);
          const percent =
            total > 0 ? Math.min(100, (displayDownloaded / total) * 100) : 0;

          setDownloads((previous) =>
            previous.map((download) => {
              if (download.id !== item.id) return download;

              const previousDownloaded = download.downloaded;
              const downloaded = initializing
                ? 0
                : progress.finished
                  ? total
                  : Math.max(
                      previousDownloaded,
                      Math.min(progress.downloaded, total),
                    );

              return {
                ...download,
                infoHash: progress.infoHash || torrentInfoHash,
                size: total,
                downloaded,
                speed: initializing || progress.finished ? 0 : measuredSpeed,
                preparing: progress.finished || initializing,
                preparingLabel: progress.finished
                  ? 'Preparing file...'
                  : initializing
                    ? 'Preparing torrent...'
                    : undefined,
                activeConnections: initializing || progress.finished
                  ? 0
                  : download.connections,
                speedHistory:
                  initializing || progress.finished
                    ? download.speedHistory
                    : [
                        ...download.speedHistory.slice(-9),
                        Number(
                          (measuredSpeed / (1024 * 1024)).toFixed(1)
                        ),
                      ],
                chunks: download.chunks.map((chunk) => ({
                  ...chunk,
                  progress: Math.floor(percent),
                  status: progress.finished
                    ? 'downloading'
                    : initializing
                      ? 'idle'
                      : 'downloading',
                })),
              };
            })
          );

          if (progress.finished) {
            await logger.log(
              `Torrent reached 100%: ${torrentName}. All selected pieces are complete and verified.`
            );
            await logger.log(`Preparing completed file(s): releasing torrent file handles...`);
            await waitForTorrentReadyNative(managedTorrentId);
            await logger.log(`Completed file(s) are ready: ${torrentName}`);
            break;
          }

          await new Promise<void>((resolve) => {
            window.setTimeout(resolve, 750);
          });
        }

        const finishedAt = new Date().toISOString();

        setDownloads((previous) =>
          previous.map((download) => {
            if (download.id !== item.id) return download;

            const finalSize =
              download.size > 0 ? download.size : download.downloaded;

            return {
              ...download,
              size: finalSize,
              downloaded: finalSize,
              speed: 0,
              activeConnections: 0,
              status: 'completed',
              preparing: false,
              preparingLabel: undefined,
              completedAt: finishedAt,
              chunks: download.chunks.map((chunk) => ({
                ...chunk,
                progress: 100,
                status: 'completed',
              })),
            };
          })
        );

        pausedTorrentIds.current.delete(item.id);
        await logger.log(`BitTorrent download completed: ${item.name}`);
        playChime();
        addToast('Torrent Completed', item.name, 'success');
        return;
      }

      if (!/^https?:\/\//i.test(item.url)) {
        throw new Error(
          'Only HTTP(S) downloads or BitTorrent magnet/.torrent inputs are supported'
        );
      }

      let lastProgress = item.downloaded;
      let lastProgressAt = performance.now();

      await logger.log(`Starting HTTP download: ${item.name} | ${item.url}`);
      await logger.log(`Requested save path: ${item.savePath}`);

      const result = await downloadFileNative(
        item.url,
        `${item.savePath}/${item.name}`,
        item.connections || 16,
        (progress, total, transferSpeed = 0, activeConnections = 1) => {
          const now = performance.now();
          const elapsedSeconds = Math.max(
            (now - lastProgressAt) / 1000,
            0.001
          );
          const bytesDelta = Math.max(0, progress - lastProgress);
          const measuredSpeed = Math.round(bytesDelta / elapsedSeconds);
          const speed =
            transferSpeed > 0 ? Math.round(transferSpeed) : measuredSpeed;

          lastProgress = progress;
          lastProgressAt = now;

          setDownloads((previous) =>
            previous.map((download) => {
              if (download.id !== item.id) return download;

              const nextSize = total > 0 ? total : download.size;
              const nextDownloaded = Math.max(
                download.downloaded,
                progress
              );
              const percent =
                nextSize > 0
                  ? Math.min(100, (nextDownloaded / nextSize) * 100)
                  : 0;

              return {
                ...download,
                status: 'downloading',
                size: nextSize,
                downloaded: nextDownloaded,
                speed,
                activeConnections,
                speedHistory: [
                  ...download.speedHistory.slice(-9),
                  Number((speed / (1024 * 1024)).toFixed(1)),
                ],
                chunks: download.chunks.map((chunk) => ({
                  ...chunk,
                  progress: Math.floor(percent),
                  status: 'downloading' as const,
                })),
              };
            })
          );
        },
        item.id,
      );

      if (result.paused) {
        setDownloads((previous) =>
          previous.map((download) =>
            download.id === item.id
              ? {
                  ...download,
                  status: 'paused',
                  speed: 0,
                  activeConnections: 0,
                }
              : download
          )
        );
        await logger.log(`HTTP download paused: ${item.name}`);
        addToast('Download Paused', item.name, 'info');
        return;
      }

      if (!result.success) {
        throw result.error instanceof Error
          ? result.error
          : new Error(`Download failed (${result.method})`);
      }

      const finishedAt = new Date().toISOString();

      setDownloads((previous) =>
        previous.map((download) => {
          if (download.id !== item.id) return download;

          const finalSize =
            download.size > 0 ? download.size : download.downloaded;

          return {
            ...download,
            size: finalSize,
            downloaded: finalSize,
            speed: 0,
            activeConnections: 1,
            status: 'completed',
            completedAt: finishedAt,
            chunks: download.chunks.map((chunk) => ({
              ...chunk,
              progress: 100,
              status: 'completed' as const,
            })),
          };
        })
      );

      await logger.log(`Download completed: ${item.name}`);
      await logger.log(
        `Resolved file path: ${
          result.filePath || `${item.savePath}/${item.name}`
        }`
      );

      playChime();
      addToast('Download Completed', item.name, 'success');
    } catch (error) {
      if (abortedTransferIds.current.has(item.id)) {
        await logger.log(`Transfer cancelled/deleted by user: ${item.name}`);
        return;
      }

      await logger.error(`Transfer failed: ${item.name}`, error);

      setDownloads((previous) =>
        previous.map((download) =>
          download.id === item.id
            ? { ...download, status: 'error', speed: 0 }
            : download
        )
      );

      addToast(
        'Download Failed',
        `${item.name}: ${
          error instanceof Error ? error.message : String(error)
        }`,
        'error'
      );
    } finally {
      activeTransfers.current.delete(item.id);
      abortedTransferIds.current.delete(item.id);
    }
  };

  const filteredDownloads = useMemo(() => {
    return downloads
      .filter((item) => {
        if (activeTab !== 'all' && item.status !== activeTab) return false;

        if (selectedFileType !== 'all') {
          if (
            selectedFileType === 'torrent' &&
            !(item.fileType === 'torrent' || item.isTorrent)
          ) {
            return false;
          }
          if (
            selectedFileType !== 'torrent' &&
            item.fileType !== selectedFileType
          ) {
            return false;
          }
        }

        if (searchQuery.trim()) {
          const query = searchQuery.toLowerCase();
          return (
            item.name.toLowerCase().includes(query) ||
            item.url.toLowerCase().includes(query) ||
            item.category.toLowerCase().includes(query)
          );
        }

        return true;
      })
      .sort((a, b) => {
        let comparison = 0;

        switch (sortBy) {
          case 'addedAt':
            comparison =
              new Date(a.addedAt).getTime() -
              new Date(b.addedAt).getTime();
            break;
          case 'name':
            comparison = a.name.localeCompare(b.name);
            break;
          case 'size':
            comparison = a.size - b.size;
            break;
          case 'speed':
            comparison = a.speed - b.speed;
            break;
          case 'progress': {
            const progressA = a.size > 0 ? a.downloaded / a.size : 0;
            const progressB = b.size > 0 ? b.downloaded / b.size : 0;
            comparison = progressA - progressB;
            break;
          }
        }

        return sortOrder === 'desc' ? -comparison : comparison;
      });
  }, [
    downloads,
    activeTab,
    selectedFileType,
    searchQuery,
    sortBy,
    sortOrder,
  ]);

  const counts = useMemo(
    () => ({
      all: downloads.length,
      downloading: downloads.filter((d) => d.status === 'downloading').length,
      paused: downloads.filter((d) => d.status === 'paused').length,
      completed: downloads.filter((d) => d.status === 'completed').length,
      queued: downloads.filter((d) => d.status === 'queued').length,
      torrent: downloads.filter((d) => d.fileType === 'torrent' || d.isTorrent)
        .length,
      video: downloads.filter((d) => d.fileType === 'video').length,
      audio: downloads.filter((d) => d.fileType === 'audio').length,
      software: downloads.filter((d) => d.fileType === 'software').length,
      archive: downloads.filter((d) => d.fileType === 'archive').length,
      document: downloads.filter((d) => d.fileType === 'document').length,
      image: downloads.filter((d) => d.fileType === 'image').length,
    }),
    [downloads]
  );

  const totalActiveSpeed = useMemo(
    () =>
      downloads
        .filter((download) => download.status === 'downloading')
        .reduce((sum, download) => sum + download.speed, 0),
    [downloads]
  );

  const activeCount = useMemo(
    () => downloads.filter((download) => download.status === 'downloading').length,
    [downloads]
  );

  const totalDownloadedToday = useMemo(
    () => downloads.reduce((sum, download) => sum + download.downloaded, 0),
    [downloads]
  );

  const handleTogglePause = async (id: string) => {
    const item = downloads.find((download) => download.id === id);
    if (!item) return;

    const isTorrent =
      item.isTorrent || item.fileType === 'torrent' || item.engine === 'librqbit';

    if (isTorrent) {
      if (item.status === 'downloading' && item.torrentId !== undefined) {
        pausedTorrentIds.current.add(item.id);
        void pauseTorrentNative(item.torrentId)
          .then(async () => {
            await logger.log(`Paused native torrent ${item.torrentId}: ${item.name}`);
            setDownloads((previous) =>
              previous.map((download) =>
                download.id === item.id
                  ? { ...download, status: 'paused', speed: 0, activeConnections: 0 }
                  : download
              )
            );
            addToast('Torrent Paused', item.name, 'info');
          })
          .catch((error) => {
            pausedTorrentIds.current.delete(item.id);
            addToast(
              'Could Not Pause Torrent',
              error instanceof Error ? error.message : String(error),
              'error'
            );
          });
        return;
      }

      if (item.status === 'paused' && item.torrentId !== undefined) {
        pausedTorrentIds.current.delete(item.id);
        void resumeTorrentNative(item.torrentId)
          .then(async () => {
            await logger.log(`Resumed native torrent ${item.torrentId}: ${item.name}`);
            setDownloads((previous) =>
              previous.map((download) =>
                download.id === item.id
                  ? { ...download, status: 'downloading' }
                  : download
              )
            );
            addToast('Torrent Resumed', item.name, 'success');
          })
          .catch((error) => {
            pausedTorrentIds.current.add(item.id);
            addToast(
              'Could Not Resume Torrent',
              error instanceof Error ? error.message : String(error),
              'error'
            );
          });
        return;
      }

      if (item.status === 'queued' || (item.status === 'paused' && item.torrentId === undefined)) {
        void startTransfer(item);
      }
      return;
    }

    if (item.status === 'downloading') {
      try {
        await pauseHttpDownloadNative(item.id);
        await logger.log(`Pause requested for HTTP download: ${item.name}`);
      } catch (error) {
        addToast(
          'Could Not Pause Download',
          error instanceof Error ? error.message : String(error),
          'error'
        );
      }
      return;
    }

    if (item.status === 'queued' || item.status === 'paused') {
      void startTransfer(item);
    }
  };

  const cleanupIncompleteTransferFiles = async (item: DownloadItem) => {
    if (item.status === 'completed') return;

    const isTorrent =
      item.isTorrent ||
      item.engine === 'librqbit' ||
      item.fileType === 'torrent';
    const targetPath = isTorrent && item.torrentIsMultiFile
      ? await joinPathNative(
          item.savePath,
          item.torrentSubfolder || item.name,
        )
      : await joinPathNative(item.savePath, item.name);

    await deleteIncompleteTransferNative({
      path: targetPath,
      torrentId: isTorrent ? item.torrentId : undefined,
      torrentIsMultiFile: Boolean(isTorrent && item.torrentIsMultiFile),
    });

    await logger.log(`Deleted incomplete transfer files: ${targetPath}`);
  };

  const handleDelete = async (id: string) => {
    const item = downloads.find((download) => download.id === id);
    if (!item) return false;

    abortedTransferIds.current.add(id);

    try {
      await cleanupIncompleteTransferFiles(item);
    } catch (error) {
      await logger.error(`Failed to delete incomplete transfer files: ${item.name}`, error);
      addToast(
        'Could Not Delete Download Files',
        error instanceof Error ? error.message : String(error),
        'error',
      );
      return false;
    }

    setDownloads((previous) => previous.filter((download) => download.id !== id));
    setSelectedIds((previous) => previous.filter((selectedId) => selectedId !== id));
    pausedTorrentIds.current.delete(id);
    activeTransfers.current.delete(id);
    addToast('Transfer Removed', item.name, 'info');
    return true;
  };

  const handlePauseAll = () => {
    const active = downloads.filter((download) => download.status === 'downloading');
    const torrentTransfers = active.filter(
      (download) =>
        (download.isTorrent || download.fileType === 'torrent' || download.engine === 'librqbit') &&
        download.torrentId !== undefined
    );
    const httpTransfers = active.filter(
      (download) => !download.isTorrent && download.fileType !== 'torrent' && download.engine !== 'librqbit'
    );

    torrentTransfers.forEach((item) => handleTogglePause(item.id));

    httpTransfers.forEach((item) => {
      void handleTogglePause(item.id);
    });
  };

  const handleResumeAll = () => {
    const resumable = downloads.filter(
      (download) => download.status === 'paused' || download.status === 'queued'
    );

    resumable.forEach((item) => handleTogglePause(item.id));

    if (resumable.length > 0) {
      addToast(
        'Transfers Resuming',
        `Resuming ${resumable.length} queued or paused transfer(s)`,
        'info'
      );
    }
  };

  const handleClearCompleted = () => {
    const count = downloads.filter((download) => download.status === 'completed')
      .length;
    setDownloads((previous) =>
      previous.filter((download) => download.status !== 'completed')
    );
    addToast('Cleared Finished', `Removed ${count} completed items`, 'info');
  };

  const handleToggleSelect = (id: string, event?: React.MouseEvent) => {
    if (event?.shiftKey && selectedIds.length > 0) {
      const lastId = selectedIds[selectedIds.length - 1];
      const firstIndex = filteredDownloads.findIndex((item) => item.id === lastId);
      const secondIndex = filteredDownloads.findIndex((item) => item.id === id);

      if (firstIndex !== -1 && secondIndex !== -1) {
        const start = Math.min(firstIndex, secondIndex);
        const end = Math.max(firstIndex, secondIndex);
        const rangeIds = filteredDownloads
          .slice(start, end + 1)
          .map((item) => item.id);
        setSelectedIds((previous) =>
          Array.from(new Set([...previous, ...rangeIds]))
        );
        return;
      }
    }

    setSelectedIds((previous) =>
      previous.includes(id)
        ? previous.filter((selectedId) => selectedId !== id)
        : [...previous, id]
    );
  };

  const handleSelectAll = () => {
    if (
      filteredDownloads.length > 0 &&
      selectedIds.length === filteredDownloads.length
    ) {
      setSelectedIds([]);
    } else {
      setSelectedIds(filteredDownloads.map((item) => item.id));
    }
  };

  const handlePauseSelected = () => {
    const active = downloads.filter(
      (item) => selectedIds.includes(item.id) && item.status === 'downloading'
    );

    active.forEach((item) => handleTogglePause(item.id));
  };

  const handleResumeSelected = () => {
    const resumable = downloads.filter(
      (item) =>
        selectedIds.includes(item.id) &&
        (item.status === 'paused' || item.status === 'queued')
    );

    resumable.forEach((item) => handleTogglePause(item.id));

    if (resumable.length > 0) {
      addToast(
        'Batch Action',
        `Resuming ${resumable.length} selected transfer(s)`,
        'info'
      );
    }
  };

  const handleDeleteSelected = async () => {
    const items = downloads.filter((item) => selectedIds.includes(item.id));
    if (items.length === 0) return;

    const removableIds: string[] = [];
    for (const item of items) {
      if (await handleDelete(item.id)) {
        removableIds.push(item.id);
      }
    }

    setSelectedIds((previous) =>
      previous.filter((id) => !removableIds.includes(id))
    );
  };

  const createAndStartDownload = (data: NewDownloadData) => {
    const isTorrent = data.isTorrent || data.fileType === 'torrent';
    const connectionCount = isTorrent ? data.connections : 16;

    const newItem: DownloadItem = {
      id: `dl-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      name: data.name,
      url: data.url,
      size: data.size,
      downloaded: 0,
      speed: 0,
      status: data.startImmediately ? 'downloading' : 'queued',
      fileType: data.fileType,
      category: data.category,
      savePath: data.savePath,
      addedAt: new Date().toISOString(),
      connections: connectionCount,
      activeConnections: isTorrent ? connectionCount : 1,
      chunks: Array.from(
        { length: Math.max(1, Math.min(16, connectionCount || 1)) },
        (_, index) => ({
          id: index,
          progress: 0,
          status: data.startImmediately ? 'downloading' : 'idle',
        })
      ),
      hash: Math.random().toString(16).slice(2, 22),
      serverIp: isTorrent ? 'P2P Swarm' : undefined,
      speedHistory: [],
      isTorrent,
      engine: data.engine || (isTorrent ? 'librqbit' : 'http'),
      stealthConfig: data.stealthConfig,
      torrentFiles: data.torrentFiles,
      torrentIsMultiFile: isTorrent && (data.torrentFiles?.length ?? 0) > 1,
      torrentSubfolder:
        isTorrent && (data.torrentFiles?.length ?? 0) > 1
          ? data.name
          : undefined,
    };

    setDownloads((previous) => [newItem, ...previous]);
    addToast(
      isTorrent ? 'librqbit Torrent Added' : 'Transfer Added',
      data.name,
      'success'
    );

    if (data.startImmediately) {
      void startTransfer(newItem);
    }
  };

  const handleAddDownload = (data: NewDownloadData) => {
    void resolveDownloadPath(data.savePath)
      .then((actualPath) => {
        const normalizedData = { ...data, savePath: actualPath };
        const knownDirectory = existingDirectories.some((directory) => directory === actualPath || directory === data.savePath);
        if (!knownDirectory) {
          setPendingDownloadData(normalizedData);
          return;
        }
        createAndStartDownload(normalizedData);
      })
      .catch(() => {
        setPendingDownloadData(data);
      });
  };

  const handleConfirmPendingDirectory = async (path: string) => {
    try {
      const actualPath = await createDownloadDirectory(path);
      handleAddDirectory(path);
      await logger.log(`Created download directory: ${actualPath}`);
      addToast('Directory Created', `Created ${actualPath}`, 'success');

      if (pendingDownloadData) {
        createAndStartDownload({ ...pendingDownloadData, savePath: actualPath });
        setPendingDownloadData(null);
      }
    } catch (error) {
      await logger.error(`Failed to create download directory: ${path}`, error);
      addToast(
        'Directory Creation Failed',
        error instanceof Error ? error.message : String(error),
        'error'
      );
    }
  };


  return (
    <div 
      onDragOver={handleWindowDragOver}
      onDrop={handleWindowDrop}
      className="h-screen overflow-hidden bg-slate-100 dark:bg-slate-950 text-slate-800 dark:text-slate-100 font-sans antialiased flex flex-col select-none transition-colors duration-200"
    >
      <Header
        theme={theme}
        onToggleTheme={toggleTheme}
        totalSpeed={totalActiveSpeed}
        activeCount={activeCount}
        totalDownloadedToday={totalDownloadedToday}
        onOpenAddModal={() => setIsAddModalOpen(true)}
        onPauseAll={handlePauseAll}
        onResumeAll={handleResumeAll}
        onClearCompleted={handleClearCompleted}
        onOpenSettings={() => setIsSettingsOpen(true)}
        onOpenAbout={() => setIsAboutOpen(true)}
        onOpenUpdates={() => void handleCheckForUpdates(true)}
        hasUpdateAvailable={Boolean(appUpdateInfo?.available)}
        globalSpeedLimit={settings.globalSpeedLimit}
        onSetGlobalSpeedLimit={(limit) =>
          setSettings((current) => ({ ...current, globalSpeedLimit: limit }))
        }
        isStealthActive={
          Boolean(
            settings.stealthEnabled && settings.protocolEncryptionRequired
          )
        }
      />

      <div className="flex flex-1 overflow-hidden">
        <Sidebar
          activeTab={activeTab}
          setActiveTab={setActiveTab}
          selectedFileType={selectedFileType}
          setSelectedFileType={setSelectedFileType}
          counts={counts}
          totalDownloadedBytes={totalDownloadedToday}
          isEncryptionActive={Boolean(
            settings.stealthEnabled && settings.protocolEncryptionRequired
          )}
        />

        <main className="flex-1 flex flex-col p-4 lg:p-6 overflow-y-auto space-y-4 bg-slate-100 dark:bg-slate-950">
          <div className="flex flex-wrap items-center justify-between gap-3 bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 p-3.5 rounded-2xl shadow-xs">
            <div className="relative flex-1 min-w-[240px]">
              <Search className="absolute left-3.5 top-2.5 h-4 w-4 text-slate-400 dark:text-slate-500" />
              <input
                type="text"
                placeholder="Search transfers, magnet links, or URLs..."
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                className="w-full bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 focus:border-blue-500 focus:bg-white dark:focus:bg-slate-900 rounded-xl pl-10 pr-3.5 py-1.5 text-xs text-slate-800 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none transition-all"
              />
            </div>

            <div className="flex items-center space-x-2">
              <button
                onClick={handleSelectAll}
                className="h-8 flex items-center space-x-1.5 bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 px-3 rounded-xl text-xs text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white transition-colors"
                title="Select or deselect all items"
              >
                {selectedIds.length > 0 &&
                selectedIds.length === filteredDownloads.length ? (
                  <CheckSquare className="h-3.5 w-3.5 text-blue-500" />
                ) : (
                  <Square className="h-3.5 w-3.5 text-slate-400" />
                )}
                <span className="font-semibold text-[11px]">
                  Select All ({filteredDownloads.length})
                </span>
              </button>

              <div className="h-8 flex items-center space-x-2 bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 px-3.5 rounded-xl text-xs">
                <SlidersHorizontal className="h-3.5 w-3.5 text-slate-500 dark:text-slate-400" />
                <span className="text-slate-400 dark:text-slate-500 font-medium text-[11px]">
                  Sort:
                </span>
                <select
                  value={sortBy}
                  onChange={(event) =>
                    setSortBy(
                      event.target.value as
                        | 'addedAt'
                        | 'name'
                        | 'size'
                        | 'speed'
                        | 'progress'
                    )
                  }
                  className="bg-transparent text-slate-800 dark:text-slate-100 font-semibold focus:outline-none cursor-pointer"
                >
                  <option value="addedAt">Date Added</option>
                  <option value="name">File Name</option>
                  <option value="size">File Size</option>
                  <option value="speed">Transfer Speed</option>
                  <option value="progress">Progress %</option>
                </select>
              </div>

              <button
                onClick={() =>
                  setSortOrder((current) => (current === 'asc' ? 'desc' : 'asc'))
                }
                className="p-2 bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white transition-colors"
                title={`Sort ${sortOrder === 'asc' ? 'Ascending' : 'Descending'}`}
              >
                <ArrowUpDown className="h-4 w-4" />
              </button>
            </div>
          </div>

          {selectedIds.length > 0 && (
            <div className="sticky top-0 z-30 bg-blue-600 text-white p-3 px-4 rounded-2xl shadow-xl flex flex-wrap items-center justify-between gap-3 border border-blue-500">
              <button
                onClick={handleSelectAll}
                className="flex items-center space-x-2 text-xs font-bold bg-white/20 hover:bg-white/30 px-3 py-1.5 rounded-xl transition-colors"
              >
                <CheckSquare className="h-4 w-4" />
                <span>
                  {selectedIds.length} of {filteredDownloads.length} Selected
                </span>
              </button>

              <div className="flex items-center space-x-2">
                <button
                  onClick={handleResumeSelected}
                  className="flex items-center space-x-1.5 bg-emerald-500 hover:bg-emerald-600 text-white font-bold text-xs px-3.5 py-1.5 rounded-xl"
                >
                  <Play className="h-3.5 w-3.5" />
                  <span>Resume</span>
                </button>
                <button
                  onClick={handlePauseSelected}
                  className="flex items-center space-x-1.5 bg-amber-500 hover:bg-amber-600 text-white font-bold text-xs px-3.5 py-1.5 rounded-xl"
                >
                  <Pause className="h-3.5 w-3.5" />
                  <span>Pause</span>
                </button>
                <button
                  onClick={handleDeleteSelected}
                  className="flex items-center space-x-1.5 bg-rose-500 hover:bg-rose-600 text-white font-bold text-xs px-3.5 py-1.5 rounded-xl"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  <span>Delete</span>
                </button>
                <button
                  onClick={() => setSelectedIds([])}
                  className="p-1.5 hover:bg-white/20 rounded-lg"
                  title="Clear selection"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>
          )}

          <div className="flex-1 space-y-3 relative min-h-[300px]">
            {filteredDownloads.length > 0 ? (
              filteredDownloads.map((item) => (
                <DownloadItemRow
                  key={item.id}
                  item={item}
                  isSelected={selectedIds.includes(item.id)}
                  onToggleSelect={handleToggleSelect}
                  onTogglePause={handleTogglePause}
                  onDelete={handleDelete}
                  onInspect={setInspectingItem}
                  onOpenLocation={async (download) => {
                    const actualPath = await resolveDownloadPath(download.savePath);
                    const isTorrent =
                      download.isTorrent ||
                      download.engine === 'librqbit' ||
                      download.fileType === 'torrent';
                    const targetDirectory =
                      isTorrent && download.torrentIsMultiFile
                        ? await joinPathNative(
                            actualPath,
                            download.torrentSubfolder || download.name
                          )
                        : actualPath;

                    const result = await openDirectoryNative(targetDirectory);
                    if (!result.success) {
                      addToast(
                        'Could Not Open Folder',
                        `Unable to open ${targetDirectory}`,
                        'error'
                      );
                    }
                  }}
                  onOpenFile={async (download) => {
                    const actualPath = await resolveDownloadPath(download.savePath);
                    const isTorrent =
                      download.isTorrent ||
                      download.engine === 'librqbit' ||
                      download.fileType === 'torrent';

                    let targetPath = await joinPathNative(actualPath, download.name);

                    if (isTorrent && download.torrentIsMultiFile) {
                      targetPath = await joinPathNative(
                        actualPath,
                        download.torrentSubfolder || download.name
                      );
                    }

                    const result = await openPathNative(targetPath);
                    if (!result.success) {
                      addToast(
                        'Could Not Launch File',
                        `Unable to open ${download.name}`,
                        'error'
                      );
                    }
                  }}
                  onContextMenu={(event, download) => {
                    event.preventDefault();
                    setContextMenu({
                      item: download,
                      x: event.clientX,
                      y: event.clientY,
                    });
                  }}
                  onNotCompletedDoubleClick={(download) => {
                    const percent =
                      download.size > 0
                        ? Math.min(
                            100,
                            Math.floor(
                              (download.downloaded / download.size) * 100
                            )
                          )
                        : 0;
                    addToast(
                      'File Still Downloading',
                      `"${download.name}" is currently at ${percent}% progress.`,
                      'info'
                    );
                  }}
                />
              ))
            ) : (
              <div className={`bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-12 text-center space-y-3 flex flex-col items-center justify-center mb-8 shadow-xs ${selectedIds.length > 0 ? 'mt-16' : 'mt-2'}`}>
                <div className="p-3 bg-slate-100 dark:bg-slate-800 rounded-2xl text-slate-400 dark:text-slate-500">
                  <Download className="h-8 w-8" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-slate-800 dark:text-slate-200">
                    No transfers found
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 max-w-sm">
                    {searchQuery
                      ? 'No items match your search query. Try clearing the filter.'
                      : 'There are no files in this category. Click “New Transfer” to start downloading.'}
                  </p>
                </div>
                <button
                  onClick={() => setIsAddModalOpen(true)}
                  className="mt-2 flex items-center space-x-2 bg-blue-600 hover:bg-blue-700 text-white font-semibold text-xs px-4 py-2.5 rounded-full"
                >
                  <Plus className="h-4 w-4" />
                  <span>Add First Transfer</span>
                </button>
              </div>
            )}
          </div>
        </main>
      </div>

      <React.Suspense fallback={null}>
        <AddDownloadModal
          isOpen={isAddModalOpen}
          initialUrl={externalTransferSource}
          onClose={() => {
            setIsAddModalOpen(false);
            setExternalTransferSource(undefined);
          }}
          defaultSavePath={settings.defaultSavePath}
          onToast={addToast}
          onAdd={handleAddDownload}
        />

        {pendingDownloadData && (
          <DirectoryPromptModal
            isOpen={true}
            directoryPath={pendingDownloadData.savePath}
            onConfirm={handleConfirmPendingDirectory}
            onCancel={() => {
              addToast(
                'Transfer Cancelled',
                'Save directory was not created',
                'info'
              );
              setPendingDownloadData(null);
            }}
          />
        )}

        <DownloadDetailModal
          item={inspectingItem}
          onClose={() => setInspectingItem(null)}
          onSetItemSpeedLimit={(id, limit) => {
            setDownloads((previous) =>
              previous.map((download) =>
                download.id === id
                  ? { ...download, speedLimit: limit }
                  : download
              )
            );
          }}
        />

        <SettingsModal
          isOpen={isSettingsOpen}
          onClose={() => setIsSettingsOpen(false)}
          settings={settings}
          onUpdateSettings={(newSettings) => {
            setSettings((previous) => ({ ...previous, ...newSettings }));
            if (newSettings.theme === 'dark' || newSettings.theme === 'light') {
              setTheme(newSettings.theme);
            }
          }}
          onCheckForUpdates={() => void handleCheckForUpdates(true)}
          isCheckingUpdates={isCheckingUpdate}
        />

        <AboutModal
          isOpen={isAboutOpen}
          onClose={() => setIsAboutOpen(false)}
        />

        <ErrorBoundary fallbackTitle="Software Updates Error" onReset={() => setIsUpdateModalOpen(false)}>
          <UpdateModal
            isOpen={isUpdateModalOpen}
            onClose={() => setIsUpdateModalOpen(false)}
            updateInfo={appUpdateInfo}
            onCheckAgain={() => handleCheckForUpdates(true)}
            isChecking={isCheckingUpdate}
          />
        </ErrorBoundary>
      </React.Suspense>

      {contextMenu && (
        <div
          className="fixed inset-0 z-50"
          onClick={() => setContextMenu(null)}
          onContextMenu={(event) => {
            event.preventDefault();
            setContextMenu(null);
          }}
        >
          <div
            className="absolute bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-2xl py-1.5 min-w-[210px] z-50 text-slate-800 dark:text-slate-100"
            style={{
              top: Math.min(contextMenu.y, window.innerHeight - 260),
              left: Math.min(contextMenu.x, window.innerWidth - 230),
            }}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="px-3 py-1.5 border-b border-slate-100 dark:border-slate-800 mb-1">
              <p className="text-[11px] font-bold text-slate-400 truncate max-w-[200px]">
                {contextMenu.item.name}
              </p>
            </div>

            <button
              onClick={() => {
                const item = contextMenu.item;
                setContextMenu(null);
                if (item.status === 'completed') {
                  void (async () => {
                    const actualPath = await resolveDownloadPath(item.savePath);
                    const isTorrent =
                      item.isTorrent ||
                      item.engine === 'librqbit' ||
                      item.fileType === 'torrent';
                    let targetPath = await joinPathNative(actualPath, item.name);
                    if (isTorrent && item.torrentIsMultiFile) {
                      targetPath = await joinPathNative(
                        actualPath,
                        item.torrentSubfolder || item.name
                      );
                    }
                    const result = await openPathNative(targetPath);
                    if (!result.success) {
                      addToast(
                        'Could Not Launch File',
                        `Unable to open ${item.name}`,
                        'error'
                      );
                    }
                  })();
                } else {
                  const percent =
                    item.size > 0
                      ? Math.floor((item.downloaded / item.size) * 100)
                      : 0;
                  addToast(
                    'File In Progress',
                    `"${item.name}" is still downloading (${percent}%).`,
                    'info'
                  );
                }
              }}
              className="w-full text-left px-3.5 py-2 text-xs font-medium hover:bg-blue-50 dark:hover:bg-blue-950/50 hover:text-blue-600 dark:hover:text-blue-400 flex items-center space-x-2.5"
            >
              <FolderOpen className="h-4 w-4 text-blue-500" />
              <span>
                {contextMenu.item.status === 'completed'
                  ? 'Open Completed File'
                  : 'Open File Directory'}
              </span>
            </button>

            <button
              onClick={() => {
                const id = contextMenu.item.id;
                setContextMenu(null);
                handleTogglePause(id);
              }}
              className="w-full text-left px-3.5 py-2 text-xs font-medium hover:bg-slate-50 dark:hover:bg-slate-800 flex items-center space-x-2.5"
            >
              {contextMenu.item.status === 'paused' ? (
                <>
                  <Play className="h-4 w-4 text-emerald-500" />
                  <span>Resume Transfer</span>
                </>
              ) : (
                <>
                  <Pause className="h-4 w-4 text-amber-500" />
                  <span>Pause Transfer</span>
                </>
              )}
            </button>

            <button
              onClick={() => {
                const item = contextMenu.item;
                setContextMenu(null);
                setInspectingItem(item);
              }}
              className="w-full text-left px-3.5 py-2 text-xs font-medium hover:bg-slate-50 dark:hover:bg-slate-800 flex items-center space-x-2.5"
            >
              <Maximize2 className="h-4 w-4 text-purple-500" />
              <span>Inspect Details</span>
            </button>

            <button
              onClick={() => {
                const item = contextMenu.item;
                setContextMenu(null);
                void navigator.clipboard.writeText(item.url);
                addToast('URL Copied', item.url, 'success');
              }}
              className="w-full text-left px-3.5 py-2 text-xs font-medium hover:bg-slate-50 dark:hover:bg-slate-800 flex items-center space-x-2.5"
            >
              <Copy className="h-4 w-4 text-slate-400" />
              <span>Copy Download Link</span>
            </button>

            <div className="border-t border-slate-100 dark:border-slate-800 my-1" />

            <button
              onClick={() => {
                const id = contextMenu.item.id;
                setContextMenu(null);
                void handleDelete(id);
              }}
              className="w-full text-left px-3.5 py-2 text-xs font-semibold text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/50 flex items-center space-x-2.5"
            >
              <Trash2 className="h-4 w-4 text-rose-500" />
              <span>Delete Transfer</span>
            </button>
          </div>
        </div>
      )}

      <ToastContainer toasts={toasts} onDismiss={removeToast} />
    </div>
  );
}
