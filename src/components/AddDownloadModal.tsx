import React, { useEffect, useRef, useState } from 'react';
import { 
  X, 
  Link2, 
  Download, 
  Upload, 
  Cpu, 
  Server, 
  Loader2,
  HardDrive,
  Folder,
  FolderOpen,
  Zap
} from 'lucide-react';
import { FileType, StealthConfig, TorrentFile } from '../types';
import { cleanUrlAndFilename, fetchRemoteServerFileSize, safeEncodeURIComponent } from '../utils/urlHelper';
import { parseTorrentBuffer } from '../utils/torrentParser';
import { formatBytes } from '../utils/formatters';
import { inspectTorrentNative, openPathNative, resolveDownloadPath } from '../utils/tauri';
import { 
  TorrentDirectoryTree, 
  DirectoryTreeNode, 
  getAllFilePathsInNode 
} from './TorrentDirectoryTree';

interface AddDownloadModalProps {
  isOpen: boolean;
  initialUrl?: string;
  onClose: () => void;
  defaultSavePath?: string;
  onToast?: (title: string, desc: string, type?: 'success' | 'info' | 'error') => void;
  onAdd: (data: {
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
  }) => void;
}

export const AddDownloadModal: React.FC<AddDownloadModalProps> = ({
  isOpen,
  initialUrl,
  onClose,
  defaultSavePath = 'Downloads',
  onToast,
  onAdd,
}) => {
  const [url, setUrl] = useState('');
  const [name, setName] = useState('');
  const [fileType, setFileType] = useState<FileType>('software');
  const [category, setCategory] = useState('Software');
  // Keep the stored/default path portable, while displaying the actual OS path.
  const [savePath, setSavePath] = useState(defaultSavePath);
  const [displaySavePath, setDisplaySavePath] = useState(defaultSavePath);
  const [connections, setConnections] = useState(16);
  const [startImmediately, setStartImmediately] = useState(true);

  const handleOpenDirectory = async () => {
    const res = await openPathNative(savePath);
    if (res.success) {
      onToast?.('Directory Opened', `Opened ${displaySavePath}`, 'success');
    } else {
      onToast?.('Could Not Open Directory', 'The selected save location could not be opened by the operating system.', 'error');
    }
  };

  React.useEffect(() => {
    if (!isOpen) return;

    // Every time the Add Transfer window opens, start with a clean form.
    // In particular, do not carry the previous torrent's file tree or
    // checkbox selection into a new transfer.
    setUrl('');
    setName('');
    setFileType('software');
    setCategory('Software');
    setConnections(16);
    setStartImmediately(true);
    setIsTorrent(false);
    setEngine('http');
    setServerSize(0);
    setIsFetchingSize(false);
    setDirectoryFiles([]);
    setIsMultiFileDir(false);
    setSelectedPaths({});
    setTorrentProbeError(null);
    torrentProbeId.current += 1;
    sizeProbeId.current += 1;

    if (torrentProbeTimer.current) {
      clearTimeout(torrentProbeTimer.current);
      torrentProbeTimer.current = null;
    }
    if (sizeProbeTimer.current) {
      clearTimeout(sizeProbeTimer.current);
      sizeProbeTimer.current = null;
    }

    if (defaultSavePath) {
      setSavePath(defaultSavePath);
      void resolveDownloadPath(defaultSavePath)
        .then(setDisplaySavePath)
        .catch(() => setDisplaySavePath(defaultSavePath));
    }
  }, [isOpen, defaultSavePath]);

  const handleSavePathChange = (value: string) => {
    setSavePath(value);
    setDisplaySavePath(value);
  };

  const handleSavePathBlur = () => {
    void resolveDownloadPath(savePath)
      .then(setDisplaySavePath)
      .catch(() => setDisplaySavePath(savePath));
  };

  // Server-Fetched File Size & Multi-File Directory Details
  const [serverSize, setServerSize] = useState<number>(0);
  const [isFetchingSize, setIsFetchingSize] = useState<boolean>(false);
  const [directoryFiles, setDirectoryFiles] = useState<{ path: string; size: number }[]>([]);
  const [isMultiFileDir, setIsMultiFileDir] = useState<boolean>(false);
  const [selectedPaths, setSelectedPaths] = useState<Record<string, boolean>>({});
  const [torrentProbeError, setTorrentProbeError] = useState<string | null>(null);

  // Torrent & librqbit Stealth Mode
  const [isTorrent, setIsTorrent] = useState(false);
  const [engine, setEngine] = useState<'librqbit' | 'http'>('librqbit');
  const [stealthConfig, setStealthConfig] = useState<StealthConfig>({
    protocolEncryption: true,
    portRandomization: true,
    spoofClientId: 'Transmission/3.00 (librqbit-stealth)',
    dhtObfuscation: true,
    antiThrottlingNoise: true,
  });

  const sizeProbeId = useRef(0);
  const sizeProbeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const torrentProbeId = useRef(0);
  const torrentProbeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Probe only after the user pauses typing. This prevents a request storm
  // and, more importantly, prevents an older request from overwriting the
  // result for the current URL.
  useEffect(() => {
    return () => {
      if (sizeProbeTimer.current) clearTimeout(sizeProbeTimer.current);
      if (torrentProbeTimer.current) clearTimeout(torrentProbeTimer.current);
    };
  }, []);

  const updateDirectoryFilesState = (files: { path: string; size: number }[]) => {
    setDirectoryFiles(files);
    const initialMap: Record<string, boolean> = {};
    files.forEach((f) => {
      initialMap[f.path] = true;
    });
    setSelectedPaths(initialMap);
  };

  const handleTogglePath = (path: string, select: boolean) => {
    setSelectedPaths((prev) => ({
      ...prev,
      [path]: select,
    }));
  };

  const handleToggleFolder = (node: DirectoryTreeNode, select: boolean) => {
    const filePaths = getAllFilePathsInNode(node);
    setSelectedPaths((prev) => {
      const next = { ...prev };
      filePaths.forEach((p) => {
        next[p] = select;
      });
      return next;
    });
  };

  const handleSelectAll = () => {
    const next: Record<string, boolean> = {};
    directoryFiles.forEach((f) => {
      next[f.path] = true;
    });
    setSelectedPaths(next);
  };

  const handleDeselectAll = () => {
    const next: Record<string, boolean> = {};
    directoryFiles.forEach((f) => {
      next[f.path] = false;
    });
    setSelectedPaths(next);
  };

  const effectiveSize = directoryFiles.length > 0
    ? directoryFiles.reduce((acc, f) => (selectedPaths[f.path] !== false ? acc + f.size : acc), 0)
    : serverSize;

  const handleUrlChange = (val: string) => {
    setUrl(val);
    const trimmed = val.trim();
    const { filename, detectedFileType, detectedCategory } = cleanUrlAndFilename(trimmed);

    if (filename && trimmed) {
      setName(filename);
    }

    const isMagnet = trimmed.toLowerCase().startsWith('magnet:?');
    const isTorrentFile = (() => {
      if (isMagnet) return false;

      try {
        const parsed = new URL(trimmed);
        return parsed.pathname.toLowerCase().endsWith('.torrent');
      } catch {
        return trimmed.toLowerCase().endsWith('.torrent');
      }
    })();

    if (isMagnet || isTorrentFile) {
      setIsTorrent(true);
      setFileType('torrent');
      setCategory('Torrents');
      setEngine('librqbit');
    } else {
      setIsTorrent(false);
      setEngine('http');
      setFileType(detectedFileType || 'other');
      setCategory(detectedCategory || 'Other');
    }

    if (sizeProbeTimer.current) clearTimeout(sizeProbeTimer.current);
    const probeId = ++sizeProbeId.current;

    // BitTorrent metadata is resolved through the embedded librqbit engine.
    // This works for both magnet links and remote .torrent URLs, and does not
    // start the transfer. The user can then choose individual files before
    // the actual torrent is added.
    if (isMagnet || isTorrentFile) {
      setIsFetchingSize(true);
      setTorrentProbeError(null);
      setServerSize(0);
      setIsMultiFileDir(false);
      updateDirectoryFilesState([]);

      if (torrentProbeTimer.current) clearTimeout(torrentProbeTimer.current);
      const torrentId = ++torrentProbeId.current;

      torrentProbeTimer.current = setTimeout(() => {
        void inspectTorrentNative(trimmed, savePath)
          .then((metadata) => {
            if (torrentId !== torrentProbeId.current) return;
            setName((prev) => metadata.name || prev);
            setServerSize(metadata.total);
            setIsMultiFileDir(metadata.files.length > 1);
            updateDirectoryFilesState(metadata.files);
          })
          .catch((error) => {
            if (torrentId !== torrentProbeId.current) return;
            console.warn('[FlowDown] Torrent metadata probe failed', error);
            setServerSize(0);
            setIsMultiFileDir(false);
            updateDirectoryFilesState([]);
            setTorrentProbeError(
              error instanceof Error ? error.message : String(error)
            );
          })
          .finally(() => {
            if (torrentId === torrentProbeId.current) setIsFetchingSize(false);
          });
      }, 350);

      return;
    }

    if (!trimmed || !/^https?:\/\//i.test(trimmed)) {
      setIsFetchingSize(false);
      setServerSize(0);
      setIsMultiFileDir(false);
      updateDirectoryFilesState([]);
      return;
    }

    setIsFetchingSize(true);
    setServerSize(0);

    sizeProbeTimer.current = setTimeout(() => {
      void fetchRemoteServerFileSize(trimmed)
        .then(({ size, isMultiFile, files }) => {
          if (probeId !== sizeProbeId.current) return;
          setServerSize(size);
          setIsMultiFileDir(!!isMultiFile);
          updateDirectoryFilesState(files && files.length > 0 ? files : []);
        })
        .catch((error) => {
          if (probeId !== sizeProbeId.current) return;
          console.warn('[FlowDown] File-size probe failed', error);
          setServerSize(0);
          setIsMultiFileDir(false);
          updateDirectoryFilesState([]);
        })
        .finally(() => {
          if (probeId === sizeProbeId.current) setIsFetchingSize(false);
        });
    }, 500);
  };

  useEffect(() => {
    if (!isOpen || !initialUrl?.trim()) return;
    handleUrlChange(initialUrl.trim());
    // handleUrlChange intentionally acts on the latest external transfer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, initialUrl]);

  const handleTorrentFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setIsTorrent(true);
      setFileType('torrent');
      setCategory('Torrents');
      setEngine('librqbit');
      setUrl(`file://${file.name}`);

      try {
        const buffer = await file.arrayBuffer();
        const parsed = parseTorrentBuffer(buffer);
        setName(parsed.name || file.name.replace(/\.torrent$/i, ''));
        setServerSize(parsed.totalSize);
        setIsMultiFileDir(parsed.isMultiFile);
        updateDirectoryFilesState(parsed.files || []);
        
        if (parsed.isMultiFile) {
        } else {
        }
      } catch {
        setName(file.name.replace(/\.torrent$/i, ''));
        setServerSize(0);
        setIsMultiFileDir(false);
        updateDirectoryFilesState([]);
      }
      setIsFetchingSize(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!url.trim() && !name.trim()) return;
    if (isFetchingSize && !isTorrent) return;

    const { filename } = cleanUrlAndFilename(url);
    const finalName = name.trim() || filename || 'download_file.bin';

    const torrentFilesPayload: TorrentFile[] | undefined = isTorrent && directoryFiles.length > 0
      ? directoryFiles.map((f) => ({
          name: f.path,
          size: f.size,
          progress: 0,
          selected: selectedPaths[f.path] !== false,
        }))
      : undefined;

    if (isTorrent && directoryFiles.length > 0 && !directoryFiles.some((file) => selectedPaths[file.path] !== false)) {
      onToast?.('No Torrent Files Selected', 'Select at least one file to download.', 'error');
      return;
    }

    onAdd({
      name: finalName,
      url: url.trim() || `magnet:?xt=urn:btih:${Math.random().toString(16).substring(2, 22)}&dn=${safeEncodeURIComponent(finalName)}`,
      size: effectiveSize,
      fileType: isTorrent ? 'torrent' : fileType,
      category: isTorrent ? 'Torrents' : category,
      savePath,
      connections,
      startImmediately,
      isTorrent,
      engine,
      stealthConfig,
      torrentFiles: torrentFilesPayload,
    });

    // Reset & close
    setUrl('');
    setName('');
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl w-full max-w-2xl shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200 text-slate-800 dark:text-slate-100">
        
        {/* Modal Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-800/80">
          <div className="flex items-center space-x-3">
            <div className="p-2.5 bg-blue-100 dark:bg-blue-900/50 rounded-xl text-blue-600 dark:text-blue-400">
              <Download className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-900 dark:text-white flex items-center space-x-2">
                <span>Add New Transfer</span>
                {isTorrent && (
                  <span className="bg-teal-100 dark:bg-teal-900/60 text-teal-800 dark:text-teal-300 text-[10px] font-mono px-2 py-0.5 rounded-full font-bold">
                    librqbit Active
                  </span>
                )}
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Enter URL, Magnet link, or upload .torrent file
              </p>
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

        <form onSubmit={handleSubmit} className="p-6 space-y-5 max-h-[82vh] overflow-y-auto">

          {/* Source Input */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="text-[11px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider flex items-center space-x-1">
                <Link2 className="h-3 w-3 text-blue-500" />
                <span>Source URL / Magnet Link</span>
              </label>

              <label className="cursor-pointer text-[11px] font-bold text-blue-600 dark:text-blue-400 hover:underline flex items-center space-x-1">
                <Upload className="h-3 w-3" />
                <span>Upload .torrent file</span>
                <input
                  type="file"
                  accept=".torrent"
                  className="hidden"
                  onChange={handleTorrentFileUpload}
                />
              </label>
            </div>

            <div className="relative">
              <textarea
                rows={2}
                value={url}
                onChange={(e) => handleUrlChange(e.target.value)}
                placeholder="https://example.com/file.zip  or  magnet:?xt=urn:btih:..."
                className="w-full bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2 text-xs font-mono text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500 transition-all resize-none"
              />
            </div>
          </div>

          {/* Name & File Size */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="sm:col-span-2 space-y-1.5">
              <label className="text-[11px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider">
                File / Folder Name
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Name of transfer..."
                className="w-full bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2 text-xs font-mono text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500/50"
              />
            </div>

            {/* Read-Only Server File Size readout */}
            <div className="space-y-1.5">
              <label className="text-[11px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider flex items-center space-x-1">
                <Server className="h-3 w-3 text-emerald-500" />
                <span>Size</span>
              </label>
              
              <div className="w-full h-[34px] bg-slate-100 dark:bg-slate-800/90 border border-slate-200 dark:border-slate-700 rounded-xl px-3 flex items-center text-xs font-mono font-bold text-slate-800 dark:text-slate-100">
                <div className="flex items-center space-x-1.5 min-w-0 w-full">
                  {isFetchingSize && (
                    <Loader2 className="h-3.5 w-3.5 animate-spin text-blue-500 shrink-0" />
                  )}
                  {effectiveSize > 0 && !isFetchingSize && (
                    <HardDrive className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
                  )}
                  <span
                    className={`truncate text-xs font-mono ${
                      isFetchingSize
                        ? 'text-blue-500'
                        : effectiveSize > 0
                          ? 'text-slate-700 dark:text-slate-200'
                          : 'text-slate-500 dark:text-slate-400'
                    }`}
                  >
                    {!url.trim() ? '' : isFetchingSize ? 'Probing' : effectiveSize > 0 ? formatBytes(effectiveSize) : 'Unknown'}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {isTorrent && torrentProbeError && (
            <div className="rounded-xl border border-rose-200 dark:border-rose-900/60 bg-rose-50 dark:bg-rose-950/30 p-3 text-[11px] text-rose-700 dark:text-rose-300">
              <div className="font-bold">Could not read torrent contents</div>
              <div className="mt-1 font-mono break-words">{torrentProbeError}</div>
            </div>
          )}

          {/* Directory Multi-File Tree Inspector (Torrent / magnet only) */}
          {isTorrent && isMultiFileDir && directoryFiles.length > 1 && (
            <TorrentDirectoryTree
              files={directoryFiles}
              selectedPaths={selectedPaths}
              onTogglePath={handleTogglePath}
              onToggleFolder={handleToggleFolder}
              onSelectAll={handleSelectAll}
              onDeselectAll={handleDeselectAll}
            />
          )}

          {/* Engine Selection & Protocol Settings */}
          <div className="bg-teal-50/90 dark:bg-teal-950/50 border border-teal-200 dark:border-teal-900/80 rounded-xl p-3.5 space-y-2.5">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <Cpu className="h-4 w-4 text-teal-600 dark:text-teal-400" />
                <span className="text-xs font-bold text-teal-900 dark:text-teal-200">Download Engine</span>
              </div>

              <span
                className={`px-2.5 py-1 text-[11px] font-mono font-bold rounded-lg shadow-xs ${
                  isTorrent
                    ? 'bg-teal-600 text-white'
                    : 'bg-blue-600 text-white'
                }`}
              >
                {isTorrent ? 'librqbit 8.1.1' : 'Standard HTTP'}
              </span>
            </div>

            <div className="pt-2 border-t border-teal-200/60 dark:border-teal-900/60">
              {isTorrent ? (
                <>
                  <div className="flex items-center space-x-2">
                    <span className="text-xs font-medium text-teal-800 dark:text-teal-300">
                      BitTorrent engine
                    </span>
                    <span className="text-[10px] font-mono text-teal-600 dark:text-teal-400">
                      Peer-based download
                    </span>
                  </div>
                  <p className="mt-1 text-[11px] text-teal-700/80 dark:text-teal-400/80">
                    Magnet links and .torrent files are handled by librqbit.
                  </p>
                </>
              ) : (
                <>
                  <div className="flex items-center space-x-2">
                    <span className="text-xs font-medium text-blue-800 dark:text-blue-300">
                      Standard Multi-Thread HTTP
                    </span>
                    <span className="text-[10px] font-mono text-blue-600 dark:text-blue-400">
                      Automatic connection tuning
                    </span>
                  </div>
                  <p className="mt-1 text-[11px] text-blue-700/80 dark:text-blue-400/80">
                    The app automatically tunes HTTP connections for download performance.
                  </p>
                </>
              )}
            </div>

            {/* Stealth & Encryption Toggles when librqbit is active */}
            {isTorrent && engine === 'librqbit' && (
              <div className="pt-2 border-t border-teal-200/60 dark:border-teal-900/60 grid grid-cols-2 sm:grid-cols-3 gap-2 text-[11px]">
                <label className="flex items-center space-x-1.5 cursor-pointer text-teal-800 dark:text-teal-300 font-medium">
                  <input
                    type="checkbox"
                    checked={stealthConfig.protocolEncryption}
                    onChange={(e) => setStealthConfig(s => ({ ...s, protocolEncryption: e.target.checked }))}
                    className="rounded text-teal-600 focus:ring-teal-500"
                  />
                  <span>MSE/PE Encryption</span>
                </label>

                <label className="flex items-center space-x-1.5 cursor-pointer text-teal-800 dark:text-teal-300 font-medium">
                  <input
                    type="checkbox"
                    checked={stealthConfig.portRandomization}
                    onChange={(e) => setStealthConfig(s => ({ ...s, portRandomization: e.target.checked }))}
                    className="rounded text-teal-600 focus:ring-teal-500"
                  />
                  <span>Port Hopping</span>
                </label>

                <label className="flex items-center space-x-1.5 cursor-pointer text-teal-800 dark:text-teal-300 font-medium">
                  <input
                    type="checkbox"
                    checked={stealthConfig.dhtObfuscation}
                    onChange={(e) => setStealthConfig(s => ({ ...s, dhtObfuscation: e.target.checked }))}
                    className="rounded text-teal-600 focus:ring-teal-500"
                  />
                  <span>Trackerless Obfuscation</span>
                </label>
              </div>
            )}
          </div>

          {/* Options: Save Path, Threads, Autostart */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-1">
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="text-[11px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider flex items-center space-x-1">
                  <Folder className="h-3 w-3 text-amber-500" />
                  <span>Save Location</span>
                </label>
                <button
                  type="button"
                  onClick={handleOpenDirectory}
                  className="text-[11px] text-blue-600 dark:text-blue-400 hover:underline flex items-center space-x-1 font-medium transition-colors"
                  title="Open directory or copy path"
                >
                  <FolderOpen className="h-3 w-3" />
                  <span>Open Directory</span>
                </button>
              </div>
              <input
                type="text"
                value={displaySavePath}
                onChange={(e) => handleSavePathChange(e.target.value)}
                onBlur={handleSavePathBlur}
                className="w-full bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2 text-xs font-mono text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500/50"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-[11px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider flex items-center space-x-1">
                <Zap className="h-3 w-3 text-blue-500" />
                <span>{isTorrent ? 'Parallel Connections / Peers' : 'HTTP Connections'}</span>
              </label>
              {isTorrent ? (
                <select
                  value={connections}
                  onChange={(e) => setConnections(Number(e.target.value))}
                  className="w-full bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2 text-xs font-mono text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500/50"
                >
                  <option value={4}>4 Peers</option>
                  <option value={8}>8 Peers</option>
                  <option value={16}>16 Peers</option>
                  <option value={32}>32 Peers</option>
                  <option value={64}>64 Peers</option>
                </select>
              ) : (
                <div className="w-full bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2 text-xs font-mono text-slate-700 dark:text-slate-200 flex items-center justify-between">
                  <span>Automatic — engine tunes 2–16 connections</span>
                  <span className="text-emerald-600 dark:text-emerald-400 font-bold">AUTO</span>
                </div>
              )}
            </div>
          </div>

          {/* Footer Submit Buttons */}
          <div className="flex items-center justify-between pt-4 border-t border-slate-200 dark:border-slate-800">
            <label className="flex items-center space-x-2 text-xs font-medium text-slate-600 dark:text-slate-300 cursor-pointer">
              <input
                type="checkbox"
                checked={startImmediately}
                onChange={(e) => setStartImmediately(e.target.checked)}
                className="rounded text-blue-600 focus:ring-blue-500"
              />
              <span>Start transfer immediately</span>
            </label>

            <div className="flex items-center space-x-3">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-xs font-bold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isFetchingSize && !isTorrent}
                className={`px-5 py-2 text-xs font-bold rounded-xl transition-all flex items-center space-x-2 ${
                  isFetchingSize && !isTorrent
                    ? 'bg-slate-300 dark:bg-slate-800 text-slate-400 dark:text-slate-500 cursor-not-allowed shadow-none'
                    : 'text-white bg-blue-600 hover:bg-blue-500 shadow-lg shadow-blue-500/20'
                }`}
              >
                {isFetchingSize && !isTorrent ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    <span>Probing file size...</span>
                  </>
                ) : (
                  <>
                    <Download className="h-4 w-4" />
                    <span>
                      Add Transfer ({effectiveSize > 0 ? formatBytes(effectiveSize) : isTorrent && isFetchingSize ? 'Resolving...' : 'Unknown'})
                    </span>
                  </>
                )}
              </button>
            </div>
          </div>

        </form>
      </div>
    </div>
  );
};
