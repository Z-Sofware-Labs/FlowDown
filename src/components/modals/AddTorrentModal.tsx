import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  FileText,
  Magnet,
  ShieldCheck,
  Folder,
  Loader2,
  CheckCircle2,
  HardDrive,
  FileCheck,
  Clipboard,
  Link2,
  Globe,
  Hash,
} from 'lucide-react';
import { Priority, ObfuscationLevel } from '../../types';
import { getDefaultDownloadPath } from '../../utils/detectOs';
import {
  pickOsDirectory,
  pickOsFile,
  parseTorrentMetadata,
  formatProbedSize,
  formatExactBytes,
  ParsedTorrentFileEntry,
} from '../../utils/osFilePicker';
import { apiClient } from '../../services/apiClient';
import { SubwindowHeader } from './SubwindowHeader';

export interface StartupTorrentPayload {
  filePath?: string;
  fileName?: string;
  fileSize?: number;
  infoHash?: string;
  files?: ParsedTorrentFileEntry[];
  pieceLength?: number;
  pieceCount?: number;
  trackers?: string[];
  magnetUri?: string;
}

interface AddTorrentModalProps {
  isOpen: boolean;
  onClose: () => void;
  defaultDownloadDirectory?: string;
  initialTorrent?: StartupTorrentPayload | null;
  onAdd: (data: {
    name: string;
    size: number;
    category: string;
    priority: Priority;
    libqrbitEnabled: boolean;
    obfuscationLevel: ObfuscationLevel;
    savePath: string;
    hash?: string;
    magnetUri?: string;
    contentBase64?: string;
    filePath?: string;
    tags?: string[];
  }) => void;
}

type InputKind = 'file' | 'magnet' | 'hash' | 'url' | 'empty';

function detectSourceKind(input: string): InputKind {
  const str = input.trim();
  if (!str) return 'empty';
  if (str.startsWith('magnet:?')) return 'magnet';
  if (/^[a-fA-F0-9]{40}$/i.test(str)) return 'hash';
  if (str.startsWith('http://') || str.startsWith('https://')) return 'url';
  return 'file';
}

function extractDisplayNameFromMagnet(magnet: string): string | undefined {
  try {
    const match = magnet.match(/(?:[?&])dn=([^&]+)/i);
    if (match && match[1]) {
      return decodeURIComponent(match[1].replace(/\+/g, ' '));
    }
  } catch {
    // ignore decode error
  }
  return undefined;
}

function extractHashFromInput(input: string): string | undefined {
  const str = input.trim();
  // 1. Direct 40-char hex
  if (/^[a-fA-F0-9]{40}$/i.test(str)) {
    return str.toLowerCase();
  }
  // 2. magnet:?xt=urn:btih:
  const magnetMatch = str.match(/xt=urn:btih:([a-fA-F0-9]{40})/i);
  if (magnetMatch && magnetMatch[1]) {
    return magnetMatch[1].toLowerCase();
  }
  // 3. Embedded in URL or string
  const embeddedMatch = str.match(/[a-fA-F0-9]{40}/i);
  if (embeddedMatch) {
    return embeddedMatch[0].toLowerCase();
  }
  return undefined;
}

export const AddTorrentModal: React.FC<AddTorrentModalProps> = ({
  isOpen,
  onClose,
  onAdd,
  defaultDownloadDirectory = getDefaultDownloadPath(),
  initialTorrent = null,
}) => {
  const [sourceInput, setSourceInput] = useState('');
  const [name, setName] = useState('');
  const [nameCustomized, setNameCustomized] = useState(false);
  const [parsedInfoHash, setParsedInfoHash] = useState('');
  const [contentBase64, setContentBase64] = useState<string | undefined>(undefined);
  const [localFilePath, setLocalFilePath] = useState<string | undefined>(undefined);
  const [probedBytes, setProbedBytes] = useState<number>(0);
  const [probedFiles, setProbedFiles] = useState<ParsedTorrentFileEntry[]>([]);
  const [pieceLength, setPieceLength] = useState<number | undefined>(undefined);
  const [pieceCount, setPieceCount] = useState<number | undefined>(undefined);
  const [seedersCount, setSeedersCount] = useState<number>(0);
  const [peersCount, setPeersCount] = useState<number>(0);
  const [isProbing, setIsProbing] = useState(false);
  const [isBackgroundProbing, setIsBackgroundProbing] = useState(false);
  const [fromLocalTorrentFile, setFromLocalTorrentFile] = useState(false);
  const [category, setCategory] = useState('Default');
  const [priority, setPriority] = useState<Priority>('Normal');
  const [savePath, setSavePath] = useState(defaultDownloadDirectory);
  const [libqrbitEnabled, setLibqrbitEnabled] = useState(true);
  const [obfuscationLevel, setObfuscationLevel] = useState<ObfuscationLevel>(3);
  const [pasteSuccess, setPasteSuccess] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const probeTimerRef = useRef<number | null>(null);
  const retryTimerRef = useRef<number | null>(null);

  // Initialize modal state on open
  useEffect(() => {
    if (isOpen) {
      setSavePath(defaultDownloadDirectory);
      setPasteSuccess(false);
      setIsSubmitting(false);

      if (initialTorrent) {
        if (initialTorrent.magnetUri) {
          setFromLocalTorrentFile(false);
          setSourceInput(initialTorrent.magnetUri);
          const dn = extractDisplayNameFromMagnet(initialTorrent.magnetUri);
          if (dn) setName(dn);
        } else {
          setFromLocalTorrentFile(true);
          setSourceInput(initialTorrent.fileName || initialTorrent.filePath || '');
          setName(initialTorrent.fileName || '');
          setLocalFilePath(initialTorrent.filePath);
          setProbedBytes(initialTorrent.fileSize || 0);
          setParsedInfoHash(initialTorrent.infoHash || '');
          setProbedFiles(initialTorrent.files || []);
          setPieceLength(initialTorrent.pieceLength);
          setPieceCount(initialTorrent.pieceCount);

          if (initialTorrent.filePath && (!initialTorrent.fileSize || !initialTorrent.files?.length)) {
            setIsProbing(true);
            void apiClient
              .probeTorrent('', initialTorrent.fileName, undefined, initialTorrent.filePath)
              .then((res) => {
                if (res) {
                  if (res.size > 0) setProbedBytes(res.size);
                  if (res.name && !nameCustomized) setName(res.name);
                  if (res.infoHash) setParsedInfoHash(res.infoHash);
                  if (res.files?.length) setProbedFiles(res.files);
                  if (res.pieceLength) setPieceLength(res.pieceLength);
                  if (res.pieceCount) setPieceCount(res.pieceCount);
                  setSeedersCount(res.seeders || 0);
                  setPeersCount(res.peers || 0);
                }
                setIsProbing(false);
              });
          }
        }
      } else {
        // Reset when opened fresh
        setSourceInput('');
        setName('');
        setNameCustomized(false);
        setParsedInfoHash('');
        setContentBase64(undefined);
        setLocalFilePath(undefined);
        setProbedBytes(0);
        setProbedFiles([]);
        setPieceLength(undefined);
        setPieceCount(undefined);
        setSeedersCount(0);
        setPeersCount(0);
        setIsProbing(false);
        setFromLocalTorrentFile(false);
      }
    }
  }, [isOpen, defaultDownloadDirectory, initialTorrent]);

  const loadSelectedFile = useCallback(async (file: File) => {
    setIsProbing(true);
    setFromLocalTorrentFile(true);
    setLocalFilePath(undefined);
    setSourceInput(file.name);

    try {
      const [meta, arrBuf] = await Promise.all([
        parseTorrentMetadata(file),
        file.arrayBuffer(),
      ]);
      const bytes = new Uint8Array(arrBuf);
      let binary = '';
      for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i]);
      }
      const b64 = btoa(binary);
      setContentBase64(b64);
      if (!nameCustomized) {
        setName(meta.name);
      }
      setProbedBytes(meta.totalBytes);
      setParsedInfoHash(meta.infoHash || '');
      setProbedFiles(meta.files || []);
      setPieceLength(meta.pieceLength);
      setPieceCount(meta.pieceCount);

      // Scrape live swarm seeders/peers via Rust backend
      const rpcProbe = await apiClient.probeTorrent('', meta.name, b64);
      if (rpcProbe) {
        if (rpcProbe.size > 0) setProbedBytes(rpcProbe.size);
        if (rpcProbe.name && !nameCustomized) setName(rpcProbe.name);
        if (rpcProbe.infoHash) setParsedInfoHash(rpcProbe.infoHash);
        if (rpcProbe.files && rpcProbe.files.length > 0) setProbedFiles(rpcProbe.files);
        if (rpcProbe.pieceLength) setPieceLength(rpcProbe.pieceLength);
        if (rpcProbe.pieceCount) setPieceCount(rpcProbe.pieceCount);
        setSeedersCount(rpcProbe.seeders || 0);
        setPeersCount(rpcProbe.peers || 0);
      }
    } catch (err) {
      console.warn('Failed to parse local torrent file:', err);
    } finally {
      setIsProbing(false);
    }
  }, [nameCustomized]);

  const handleBrowseTorrentFile = async () => {
    const picked = await pickOsFile({ accept: '.torrent', baseDir: savePath });
    if (!picked) return;
    await loadSelectedFile(picked.file);
  };

  const handlePasteClipboard = async () => {
    try {
      const text = await navigator.clipboard.readText();
      const trimmed = text ? text.trim() : '';
      if (trimmed) {
        setFromLocalTorrentFile(false);
        setContentBase64(undefined);
        setLocalFilePath(undefined);
        setSourceInput(trimmed);
        setPasteSuccess(true);
        setTimeout(() => setPasteSuccess(false), 1500);
      }
    } catch (err) {
      console.warn('Could not read clipboard:', err);
    }
  };

  const handleDropTorrentFile = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const droppedFile = e.dataTransfer?.files?.[0];
    if (droppedFile) {
      await loadSelectedFile(droppedFile);
      return;
    }
    const textData = e.dataTransfer?.getData('text');
    if (textData && textData.trim()) {
      setFromLocalTorrentFile(false);
      setContentBase64(undefined);
      setLocalFilePath(undefined);
      setSourceInput(textData.trim());
    }
  };

  // Automated Probing & Magnet/URL/Hash Resolution
  useEffect(() => {
    if (!isOpen || fromLocalTorrentFile) return;

    const trimmed = sourceInput.trim();
    if (!trimmed) {
      setProbedBytes(0);
      setProbedFiles([]);
      setPieceLength(undefined);
      setPieceCount(undefined);
      setParsedInfoHash('');
      setSeedersCount(0);
      setPeersCount(0);
      setIsProbing(false);
      setIsBackgroundProbing(false);
      return;
    }

    if (probeTimerRef.current) {
      window.clearTimeout(probeTimerRef.current);
    }
    if (retryTimerRef.current) {
      window.clearTimeout(retryTimerRef.current);
    }

    const detectedKind = detectSourceKind(trimmed);
    const hash = extractHashFromInput(trimmed);
    if (hash) {
      setParsedInfoHash(hash);
    }

    if (detectedKind === 'magnet') {
      const dn = extractDisplayNameFromMagnet(trimmed);
      if (dn && !nameCustomized) {
        setName(dn);
      }
    } else if (detectedKind === 'hash' && !nameCustomized && !name) {
      setName(`Swarm_${hash?.slice(0, 8)}`);
    }

    setIsProbing(true);
    let cancelled = false;

    probeTimerRef.current = window.setTimeout(async () => {
      try {
        // If it's a magnet, hash, or URL containing hash, resolve trackers and metadata
        const magnetOrHash =
          detectedKind === 'magnet' || detectedKind === 'hash'
            ? trimmed
            : hash || (detectedKind === 'url' ? trimmed : undefined);

        if (magnetOrHash) {
          const res = await apiClient.resolveMagnet(magnetOrHash);
          if (!cancelled && res && res.valid) {
            if (res.name && !nameCustomized) setName(res.name);
            if (res.infoHash) setParsedInfoHash(res.infoHash);
            if (res.size && res.size > 0) setProbedBytes(res.size);
            if (res.files && res.files.length > 0) setProbedFiles(res.files);
            if (res.pieceLength) setPieceLength(res.pieceLength);
            if (res.pieceCount) setPieceCount(res.pieceCount);
            if (res.seeders) setSeedersCount(res.seeders);
            if (res.peers) setPeersCount(res.peers);

            // If size is still 0 (waiting for BEP-9 metadata in peer swarm), retry in background
            if (!res.size || res.size <= 0) {
              setIsBackgroundProbing(true);
              let attempts = 0;
              const pollSwarm = async () => {
                if (cancelled || attempts >= 3) {
                  setIsBackgroundProbing(false);
                  return;
                }
                attempts++;
                const nextRes = await apiClient.resolveMagnet(magnetOrHash);
                if (!cancelled && nextRes?.valid) {
                  if (nextRes.size && nextRes.size > 0) {
                    setProbedBytes(nextRes.size);
                    if (nextRes.name && !nameCustomized) setName(nextRes.name);
                    if (nextRes.files?.length) setProbedFiles(nextRes.files);
                    if (nextRes.pieceLength) setPieceLength(nextRes.pieceLength);
                    if (nextRes.pieceCount) setPieceCount(nextRes.pieceCount);
                    setSeedersCount(nextRes.seeders || 0);
                    setPeersCount(nextRes.peers || 0);
                    setIsBackgroundProbing(false);
                    return;
                  }
                  if (attempts < 3) {
                    retryTimerRef.current = window.setTimeout(pollSwarm, 2800);
                  } else {
                    setIsBackgroundProbing(false);
                  }
                }
              };
              retryTimerRef.current = window.setTimeout(pollSwarm, 2500);
            }
          }
        }

        // Also query torrent probe endpoint
        const torrentRes = await apiClient.probeTorrent(trimmed, name || trimmed);
        if (!cancelled && torrentRes) {
          if (torrentRes.size > 0) setProbedBytes(torrentRes.size);
          if (torrentRes.name && !nameCustomized) setName(torrentRes.name);
          if (torrentRes.infoHash) setParsedInfoHash(torrentRes.infoHash);
          if (torrentRes.files && torrentRes.files.length > 0) setProbedFiles(torrentRes.files);
          if (torrentRes.pieceLength) setPieceLength(torrentRes.pieceLength);
          if (torrentRes.pieceCount) setPieceCount(torrentRes.pieceCount);
          if (torrentRes.seeders) setSeedersCount(torrentRes.seeders);
          if (torrentRes.peers) setPeersCount(torrentRes.peers);
        }
      } catch (err) {
        console.warn('Probe error:', err);
      } finally {
        if (!cancelled) {
          setIsProbing(false);
        }
      }
    }, 350);

    return () => {
      cancelled = true;
      if (probeTimerRef.current) window.clearTimeout(probeTimerRef.current);
      if (retryTimerRef.current) window.clearTimeout(retryTimerRef.current);
    };
  }, [isOpen, sourceInput, fromLocalTorrentFile, nameCustomized, name]);

  if (!isOpen) return null;

  const detectedKind = detectSourceKind(sourceInput);

  const handleBrowseSaveFolder = async () => {
    const selected = await pickOsDirectory(savePath);
    if (selected) {
      setSavePath(selected);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;
    setIsSubmitting(true);
    const trimmedSource = sourceInput.trim();
    const finalHash =
      parsedInfoHash ||
      extractHashFromInput(trimmedSource) ||
      undefined;

    const isRemoteUrl = trimmedSource.startsWith('http://') || trimmedSource.startsWith('https://');
    const isMagnet = trimmedSource.startsWith('magnet:?');
    const finalFilePath = localFilePath || (isRemoteUrl ? trimmedSource : undefined);

    const displayName =
      name.trim() ||
      extractDisplayNameFromMagnet(trimmedSource) ||
      (finalHash ? `Torrent_${finalHash.slice(0, 8)}` : 'Download.torrent');

    let finalMagnetUri: string | undefined = undefined;
    if (isMagnet) {
      finalMagnetUri = trimmedSource;
    } else if (finalHash && !contentBase64 && !localFilePath) {
      finalMagnetUri = `magnet:?xt=urn:btih:${finalHash}&dn=${encodeURIComponent(
        displayName
      )}&tr=udp://tracker.opentrackr.org:1337/announce&tr=udp://open.demonii.com:1337/announce&tr=udp://tracker.openbittorrent.com:80/announce&tr=udp://tracker.coppersurfer.tk:6969&tr=udp://glotorrents.pw:6969/announce&tr=udp://p4p.arenabg.com:1337`;
    }

    const bytes = probedBytes > 0 ? probedBytes : 0;

    // If magnet transfer, also inform the backend magnet route
    if (finalMagnetUri) {
      void apiClient.addMagnet({
        magnetUri: finalMagnetUri,
        infoHash: finalHash,
        name: displayName,
        size: bytes,
        savePath,
      });
    }

    onAdd({
      name: displayName,
      size: bytes,
      category,
      priority,
      libqrbitEnabled,
      obfuscationLevel,
      savePath,
      hash: finalHash,
      magnetUri: finalMagnetUri,
      contentBase64,
      filePath: finalFilePath,
      tags: [category, libqrbitEnabled ? 'libqrbit' : 'Standard'],
    });

    onClose();
  };

  const estimatedSizeDisplay = isProbing
    ? 'Probing metadata...'
    : isBackgroundProbing
    ? 'Probing swarm metadata...'
    : probedBytes > 0
    ? formatProbedSize(probedBytes)
    : parsedInfoHash
    ? `Swarm (${parsedInfoHash.slice(0, 8)}...) - Resolving size`
    : sourceInput.trim().startsWith('http')
    ? 'Probing remote link...'
    : 'Paste Magnet / URL / Hash, or browse .torrent';

  return (
    <div
      onDragOver={(e) => e.preventDefault()}
      onDrop={handleDropTorrentFile}
      className="fixed inset-0 bg-black/50 backdrop-blur-xs flex items-center justify-center z-50 p-4 select-none"
    >
      <div className="w-full max-w-xl bg-[var(--os-bg-window)] border border-[var(--os-border)] rounded shadow-2xl overflow-hidden text-[var(--os-text)] text-xs font-sans">
        {/* Native OS Dialog Title Bar */}
        <SubwindowHeader
          onClose={onClose}
          icon={
            detectedKind === 'magnet' ? (
              <Magnet className="w-3.5 h-3.5 text-purple-500 shrink-0" />
            ) : detectedKind === 'hash' ? (
              <Hash className="w-3.5 h-3.5 text-amber-500 shrink-0" />
            ) : detectedKind === 'url' ? (
              <Globe className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
            ) : (
              <FileText className="w-3.5 h-3.5 text-[var(--os-accent)] shrink-0" />
            )
          }
          title="Add Torrent / Magnet Link"
        />

        {/* Dialog Body */}
        <form onSubmit={handleSubmit} className="p-4 space-y-3.5">
          {/* Target Torrent Source: .torrent file, Magnet URI, Hash, or URL */}
          <div className="space-y-1">
            <div className="text-[11px] text-[var(--os-text)] font-medium flex items-center justify-between">
              <span className="flex items-center gap-1.5">
                <span>Torrent File, Magnet URI, or Hash:</span>
                {detectedKind === 'magnet' && (
                  <span className="px-1.5 py-0.5 rounded text-[10px] bg-purple-500/10 text-purple-600 dark:text-purple-400 border border-purple-500/30 font-medium flex items-center gap-1">
                    <Magnet className="w-2.5 h-2.5" />
                    Magnet Link
                  </span>
                )}
                {detectedKind === 'hash' && (
                  <span className="px-1.5 py-0.5 rounded text-[10px] bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/30 font-medium flex items-center gap-1">
                    <Hash className="w-2.5 h-2.5" />
                    BTIH Info Hash
                  </span>
                )}
                {detectedKind === 'url' && (
                  <span className="px-1.5 py-0.5 rounded text-[10px] bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30 font-medium flex items-center gap-1">
                    <Globe className="w-2.5 h-2.5" />
                    Web URL
                  </span>
                )}
                {detectedKind === 'file' && fromLocalTorrentFile && (
                  <span className="px-1.5 py-0.5 rounded text-[10px] bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/30 font-medium flex items-center gap-1">
                    <FileText className="w-2.5 h-2.5" />
                    .torrent File
                  </span>
                )}
              </span>

              {probedBytes > 0 && !isProbing && (
                <span className="text-[10px] text-emerald-600 dark:text-emerald-400 flex items-center gap-1 font-mono">
                  <CheckCircle2 className="w-3 h-3" />
                  Metadata Verified ({formatProbedSize(probedBytes)}
                  {seedersCount > 0 || peersCount > 0 ? ` • ${seedersCount}S / ${peersCount}P` : ''})
                </span>
              )}
            </div>

            <div className="flex gap-2">
              <input
                type="text"
                required
                value={sourceInput}
                placeholder="Paste magnet:?xt=... URI, 40-char hash, web URL, or browse a .torrent file"
                onChange={(e) => {
                  setFromLocalTorrentFile(false);
                  setParsedInfoHash('');
                  setContentBase64(undefined);
                  setLocalFilePath(undefined);
                  setSourceInput(e.target.value);
                }}
                className="flex-1 px-2.5 py-1.5 rounded bg-[var(--os-bg-content)] border border-[var(--os-border)] text-[var(--os-text)] focus:outline-none focus:border-[var(--os-accent)] font-mono text-[11px]"
              />
              <button
                type="button"
                onClick={handlePasteClipboard}
                title="Paste magnet link, hash, or URL from clipboard"
                className="px-2.5 py-1.5 rounded bg-[var(--os-bg-control)] hover:bg-[var(--os-bg-hover)] border border-[var(--os-border)] text-[var(--os-text)] text-xs flex items-center gap-1 shrink-0"
              >
                <Clipboard className="w-3.5 h-3.5" />
                <span>{pasteSuccess ? 'Pasted!' : 'Paste'}</span>
              </button>
              <button
                type="button"
                onClick={handleBrowseTorrentFile}
                title="Open OS file manager to select a .torrent file"
                className="px-2.5 py-1.5 rounded bg-[var(--os-bg-control)] hover:bg-[var(--os-bg-hover)] border border-[var(--os-border)] text-[var(--os-text)] text-xs flex items-center gap-1 shrink-0"
              >
                <Folder className="w-3.5 h-3.5" />
                <span>Browse...</span>
              </button>
            </div>
          </div>

          {/* Torrent / Display Name (Editable for Magnets, Hashes, and URLs) */}
          <div className="space-y-1">
            <label className="text-[11px] text-[var(--os-text)] block font-medium">
              Display Name:
            </label>
            <input
              type="text"
              value={name}
              placeholder={
                isProbing
                  ? 'Resolving torrent name from swarm...'
                  : 'Enter custom name or detected automatically'
              }
              onChange={(e) => {
                setName(e.target.value);
                setNameCustomized(true);
              }}
              className="w-full px-2.5 py-1 rounded bg-[var(--os-bg-content)] border border-[var(--os-border)] text-[var(--os-text)] focus:outline-none focus:border-[var(--os-accent)] font-mono text-[11px]"
            />
          </div>

          {/* Probed Size (Read-Only), Category, Bandwidth Priority */}
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="text-[11px] text-[var(--os-text)] flex items-center gap-1 mb-1">
                <span>Probed File Size:</span>
                {(isProbing || isBackgroundProbing) && (
                  <Loader2 className="w-3 h-3 animate-spin text-[var(--os-accent)]" />
                )}
              </label>
              <input
                type="text"
                readOnly
                tabIndex={-1}
                value={estimatedSizeDisplay}
                title={
                  probedBytes > 0
                    ? `Exact probed payload size: ${formatExactBytes(probedBytes)} (BEP-47 padding excluded)`
                    : 'Select a .torrent file or enter a magnet link to probe its exact size and file list'
                }
                className={`w-full px-2 py-1 rounded bg-[var(--os-bg-alt)] border border-[var(--os-border)] text-xs font-mono cursor-default select-all focus:outline-none ${
                  probedBytes > 0
                    ? 'text-emerald-600 dark:text-emerald-400 font-semibold'
                    : 'text-[var(--os-text-muted)]'
                }`}
              />
            </div>
            <div>
              <label className="text-[11px] text-[var(--os-text)] block mb-1">Category:</label>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="w-full px-2 py-1 rounded bg-[var(--os-bg-content)] border border-[var(--os-border)] text-[var(--os-text)] text-xs focus:outline-none focus:border-[var(--os-accent)]"
              >
                <option value="Default">Default</option>
                <option value="Linux">Linux</option>
                <option value="Datasets">Datasets</option>
                <option value="Media">Media</option>
                <option value="Archives">Archives</option>
                <option value="Software">Software</option>
                <option value="Other">Other</option>
              </select>
            </div>
            <div>
              <label className="text-[11px] text-[var(--os-text)] block mb-1">Bandwidth Priority:</label>
              <select
                value={priority}
                onChange={(e) => setPriority(e.target.value as Priority)}
                className="w-full px-2 py-1 rounded bg-[var(--os-bg-content)] border border-[var(--os-border)] text-[var(--os-text)] text-xs focus:outline-none focus:border-[var(--os-accent)]"
              >
                <option value="Max">Max (140%)</option>
                <option value="High">High (120%)</option>
                <option value="Normal">Normal (100%)</option>
                <option value="Low">Low (50%)</option>
              </select>
            </div>
          </div>

          {/* qBittorrent-style Probed Torrent Contents / Legitimacy Verification Panel */}
          {(probedBytes > 0 || probedFiles.length > 0) && (
            <div className="rounded bg-[var(--os-bg-alt)] border border-[var(--os-border)] overflow-hidden">
              <div className="px-2.5 py-1.5 bg-[var(--os-bg-control)] border-b border-[var(--os-border)] flex items-center justify-between text-[10px]">
                <span className="font-semibold text-[var(--os-text)] flex items-center gap-1.5">
                  <FileCheck className="w-3.5 h-3.5 text-[var(--os-accent)]" />
                  <span>
                    Probed Torrent Contents ({probedFiles.length || 1}{' '}
                    {(probedFiles.length || 1) === 1 ? 'file' : 'files'})
                  </span>
                </span>
                <span className="font-mono text-emerald-600 dark:text-emerald-400 font-semibold">
                  {formatProbedSize(probedBytes)} ({formatExactBytes(probedBytes)})
                </span>
              </div>
              <div className="max-h-28 overflow-y-auto divide-y divide-[var(--os-border)] bg-[var(--os-bg-content)]">
                {(probedFiles.length > 0
                  ? probedFiles
                  : [{ path: name || 'Download.torrent', length: probedBytes }]
                ).map((f, idx) => (
                  <div
                    key={`${f.path}-${idx}`}
                    className="px-2.5 py-1 flex items-center justify-between gap-2 text-[10px] font-mono hover:bg-[var(--os-bg-hover)]"
                  >
                    <span className="truncate text-[var(--os-text)]" title={f.path}>
                      {f.path}
                    </span>
                    <span className="shrink-0 text-[var(--os-text-muted)]">
                      {formatProbedSize(f.length)}
                    </span>
                  </div>
                ))}
              </div>
              {(parsedInfoHash || (pieceCount && pieceLength)) && (
                <div className="px-2.5 py-1 bg-[var(--os-bg-alt)] border-t border-[var(--os-border)] flex items-center justify-between text-[10px] font-mono text-[var(--os-text-muted)]">
                  <span className="truncate">
                    {parsedInfoHash ? `BTIH: ${parsedInfoHash}` : ''}
                  </span>
                  {pieceCount && pieceLength ? (
                    <span className="shrink-0 flex items-center gap-1">
                      <HardDrive className="w-3 h-3" />
                      {pieceCount} pieces × {formatProbedSize(pieceLength)}
                    </span>
                  ) : null}
                </div>
              )}
            </div>
          )}

          {/* Save Directory */}
          <div className="space-y-1">
            <label className="text-[11px] text-[var(--os-text)] block">
              Save Path:
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={savePath}
                onChange={(e) => setSavePath(e.target.value)}
                className="flex-1 px-2.5 py-1 rounded bg-[var(--os-bg-content)] border border-[var(--os-border)] text-[var(--os-text)] focus:outline-none focus:border-[var(--os-accent)] font-mono text-[11px]"
              />
              <button
                type="button"
                onClick={handleBrowseSaveFolder}
                title="Open OS file manager to choose destination folder"
                className="px-2.5 py-1 rounded bg-[var(--os-bg-control)] hover:bg-[var(--os-bg-hover)] border border-[var(--os-border)] text-[var(--os-text)] text-xs flex items-center gap-1"
              >
                <Folder className="w-3.5 h-3.5" />
                <span>Browse...</span>
              </button>
            </div>
          </div>

          {/* libqrbit Stealth Section */}
          <div className="p-3 rounded bg-[var(--os-bg-alt)] border border-[var(--os-border)] space-y-2">
            <div className="flex items-center justify-between">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={libqrbitEnabled}
                  onChange={(e) => setLibqrbitEnabled(e.target.checked)}
                  className="rounded accent-[var(--os-accent)]"
                />
                <span className="font-semibold text-[var(--os-text)] flex items-center gap-1.5">
                  <ShieldCheck className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                  Enable libqrbit Stealth Anti-Throttling Engine
                </span>
              </label>
              <span className="text-[10px] font-mono text-emerald-700 dark:text-emerald-400 bg-emerald-500/10 px-1.5 py-0.5 rounded border border-emerald-500/30 font-semibold">
                Recommended
              </span>
            </div>

            {libqrbitEnabled && (
              <div className="pl-5 pt-1 flex items-center justify-between gap-3 text-[11px]">
                <label
                  htmlFor="torrent-obfuscation-strength"
                  className="text-[var(--os-text-muted)] shrink-0"
                >
                  Obfuscation Strength:
                </label>
                <select
                  id="torrent-obfuscation-strength"
                  value={obfuscationLevel}
                  onChange={(e) => setObfuscationLevel(Number(e.target.value) as ObfuscationLevel)}
                  className="px-2 py-1 rounded bg-[var(--os-bg-content)] border border-[var(--os-border)] text-[var(--os-text)] text-xs focus:outline-none focus:border-[var(--os-accent)]"
                >
                  <option value={1}>L1 (Light Header Padding)</option>
                  <option value={2}>L2 (Standard TLS Mimicry)</option>
                  <option value={3}>L3 (QUIC-Morph)</option>
                  <option value={4}>L4 (MultiPath Fragmentation)</option>
                </select>
              </div>
            )}
          </div>

          {/* Footer Buttons */}
          <div className="flex items-center justify-end gap-2 pt-2 border-t border-[var(--os-border)]">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-1.5 rounded bg-[var(--os-bg-control)] hover:bg-[var(--os-bg-hover)] border border-[var(--os-border)] text-[var(--os-text)] text-xs font-medium"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="px-5 py-1.5 rounded bg-[var(--os-accent)] hover:bg-[var(--os-accent-hover)] text-white text-xs font-semibold shadow-xs flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <span>{isSubmitting ? 'Starting...' : 'Start Download'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
