import React, { useState, useEffect, useRef, useCallback } from 'react';
import { X, Globe, Folder, Loader2, Gauge, CheckCircle2, RefreshCw } from 'lucide-react';
import { Priority, ObfuscationLevel } from '../../types';
import { getDefaultDownloadPath } from '../../utils/detectOs';
import { pickOsDirectory, formatProbedSize, formatExactBytes } from '../../utils/osFilePicker';
import { apiClient, OptimalSegmentsResponse } from '../../services/apiClient';
import { SubwindowHeader } from './SubwindowHeader';

interface AddUrlModalProps {
  isOpen: boolean;
  onClose: () => void;
  defaultDownloadDirectory?: string;
  onAdd: (data: {
    url: string;
    name: string;
    size: number;
    segmentsCount: number;
    category: string;
    priority: Priority;
    libqrbitEnabled?: boolean;
    obfuscationLevel?: ObfuscationLevel;
    savePath?: string;
  }) => void;
}

type SegmentMode = 'auto' | '1' | '2' | '4' | '8' | '16' | '32';

export const AddUrlModal: React.FC<AddUrlModalProps> = ({
  isOpen,
  onClose,
  onAdd,
  defaultDownloadDirectory = getDefaultDownloadPath(),
}) => {
  const [url, setUrl] = useState('');
  const [resolvedStreamUrl, setResolvedStreamUrl] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [nameManuallyEdited, setNameManuallyEdited] = useState(false);
  const [probedBytes, setProbedBytes] = useState<number>(0);
  const [isProbingUrl, setIsProbingUrl] = useState(false);
  const [probeCompleted, setProbeCompleted] = useState(false);
  const [probeError, setProbeError] = useState<string | null>(null);
  const [supportsRange, setSupportsRange] = useState<boolean | null>(null);
  const [serverLatencyMs, setServerLatencyMs] = useState<number | null>(null);

  const [segmentMode, setSegmentMode] = useState<SegmentMode>('auto');
  const [isProbingSegments, setIsProbingSegments] = useState(false);
  const [optimalProbe, setOptimalProbe] = useState<OptimalSegmentsResponse | null>(null);

  const [category, setCategory] = useState('Default');
  const [priority, setPriority] = useState<Priority>('Normal');
  const [savePath, setSavePath] = useState(defaultDownloadDirectory);
  const urlProbeTimerRef = useRef<number | null>(null);

  const runSegmentProbe = useCallback(async (targetUrl?: string) => {
    setIsProbingSegments(true);
    const res = await apiClient.probeOptimalSegments(targetUrl);
    if (res) {
      setOptimalProbe(res);
    }
    setIsProbingSegments(false);
  }, []);

  useEffect(() => {
    if (isOpen) {
      setSavePath(defaultDownloadDirectory);
      if (segmentMode === 'auto') {
        runSegmentProbe(url.trim());
      }
    }
  }, [isOpen, defaultDownloadDirectory]); // eslint-disable-line react-hooks/exhaustive-deps

  // Automatically probe HTTP/FTP URL for remote Content-Length, filename & range support
  useEffect(() => {
    if (!isOpen) return;

    const trimmedUrl = url.trim();

    if (!trimmedUrl || !/^(https?|ftps?):\/\//i.test(trimmedUrl)) {
      setProbedBytes(0);
      setSupportsRange(null);
      setServerLatencyMs(null);
      setResolvedStreamUrl(null);
      setProbeCompleted(false);
      setProbeError(null);
      setIsProbingUrl(false);
      return;
    }

    if (urlProbeTimerRef.current) {
      window.clearTimeout(urlProbeTimerRef.current);
    }

    let cancelled = false;
    setProbedBytes(0);
    setSupportsRange(null);
    setServerLatencyMs(null);
    setResolvedStreamUrl(null);
    setProbeCompleted(false);
    setProbeError(null);
    setIsProbingUrl(true);

    urlProbeTimerRef.current = window.setTimeout(async () => {
      const res = await apiClient.probeHttpUrl(trimmedUrl);
      if (cancelled) return;
      if (res && res.success) {
        setProbedBytes(res.size > 0 ? res.size : 0);
        if (res.resolvedUrl) {
          setResolvedStreamUrl(res.resolvedUrl);
        } else {
          setResolvedStreamUrl(null);
        }
        if (res.fileName) {
          setName((prev) => (nameManuallyEdited && prev ? prev : res.fileName));
        }
        setSupportsRange(res.supportsRange);
        setServerLatencyMs(res.latencyMs);
        setProbeError(null);
      } else {
        setProbedBytes(0);
        setSupportsRange(null);
        setProbeError('Could not probe remote headers');
      }
      setProbeCompleted(true);
      setIsProbingUrl(false);
      if (!cancelled && segmentMode === 'auto' && res?.success) {
        runSegmentProbe(res.resolvedUrl || trimmedUrl);
      }
    }, 350);

    return () => {
      cancelled = true;
      if (urlProbeTimerRef.current) {
        window.clearTimeout(urlProbeTimerRef.current);
      }
    };
  }, [isOpen, url, segmentMode, nameManuallyEdited, runSegmentProbe]);

  if (!isOpen) return null;

  const handleSegmentModeChange = (nextMode: SegmentMode) => {
    setSegmentMode(nextMode);
    if (nextMode === 'auto') {
      runSegmentProbe(url.trim());
    }
  };

  const handleBrowseSaveDir = async () => {
    const selected = await pickOsDirectory(savePath);
    if (selected) {
      setSavePath(selected);
    }
  };

  const resolvedSegmentsCount =
    segmentMode === 'auto'
      ? optimalProbe?.optimalSegments ?? 16
      : parseInt(segmentMode, 10) || 16;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const bytes = probedBytes > 0 ? probedBytes : 0;
    onAdd({
      url: resolvedStreamUrl || url.trim(),
      name: name.trim() || 'download.bin',
      size: bytes,
      segmentsCount: resolvedSegmentsCount,
      category,
      priority,
      libqrbitEnabled: false,
      obfuscationLevel: 1,
      savePath,
    });
    onClose();
  };

  const estimatedSizeDisplay = isProbingUrl
    ? 'Probing server...'
    : probedBytes > 0
    ? formatProbedSize(probedBytes)
    : probeError
    ? 'Unknown (Probe failed)'
    : probeCompleted
    ? 'Unknown (Single-Stream)'
    : 'Enter URL to probe';

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-xs flex items-center justify-center z-50 p-4 select-none">
      <div className="w-full max-w-lg bg-[var(--os-bg-window)] border border-[var(--os-border)] rounded shadow-2xl overflow-hidden text-[var(--os-text)] text-xs font-sans">
        {/* Native OS Dialog Title Bar */}
        <SubwindowHeader
          onClose={onClose}
          icon={<Globe className="w-3.5 h-3.5 text-[var(--os-accent)] shrink-0" />}
          title="Add Direct HTTP/FTP Download"
        />

        {/* Dialog Body */}
        <form onSubmit={handleSubmit} className="p-4 space-y-4">
          {/* Download URL */}
          <div className="space-y-1">
            <label className="text-[11px] text-[var(--os-text)] font-medium flex items-center justify-between">
              <span>Download URL (HTTP, HTTPS, FTP):</span>
              {isProbingUrl && (
                <span className="text-[10px] text-[var(--os-accent)] flex items-center gap-1 font-mono">
                  <Loader2 className="w-3 h-3 animate-spin" />
                  Inspecting headers...
                </span>
              )}
              {!isProbingUrl && supportsRange !== null && (
                <span className="text-[10px] text-emerald-600 dark:text-emerald-400 flex items-center gap-1 font-mono">
                  <CheckCircle2 className="w-3 h-3" />
                  {supportsRange ? 'Accept-Ranges: bytes' : 'Single-Stream'}
                  {serverLatencyMs !== null ? ` • ${serverLatencyMs} ms` : ''}
                </span>
              )}
            </label>
            <input
              type="url"
              required
              value={url}
              placeholder="https://example.com/archive.iso"
              onChange={(e) => {
                const nextUrl = e.target.value;
                setUrl(nextUrl);
                setNameManuallyEdited(false);
                const parts = nextUrl.split('/');
                const last = parts[parts.length - 1];
                if (last && last.includes('.')) setName(last.split('?')[0]);
              }}
              className="w-full px-2.5 py-1.5 rounded bg-[var(--os-bg-content)] border border-[var(--os-border)] text-[var(--os-text)] focus:outline-none focus:border-[var(--os-accent)] font-mono text-[11px]"
            />
          </div>

          {/* Save As Filename & Parallel Multi-Segment Dropdown */}
          <div className="space-y-1.5">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[11px] text-[var(--os-text)] block mb-1">
                  Save As Filename:
                </label>
                <input
                  type="text"
                  required
                  value={name}
                  placeholder="archive.iso"
                  onChange={(e) => {
                    setName(e.target.value);
                    setNameManuallyEdited(true);
                  }}
                  className="w-full px-2.5 py-1 rounded bg-[var(--os-bg-content)] border border-[var(--os-border)] text-[var(--os-text)] text-xs font-mono focus:outline-none focus:border-[var(--os-accent)]"
                />
              </div>
              <div>
                <label className="text-[11px] text-[var(--os-text)] flex items-center gap-1 mb-1">
                  <span>Parallel Multi-Segment:</span>
                  {isProbingSegments && <Loader2 className="w-3 h-3 animate-spin text-[var(--os-accent)]" />}
                </label>
                <select
                  value={segmentMode}
                  onChange={(e) => handleSegmentModeChange(e.target.value as SegmentMode)}
                  className="w-full px-2 py-1 rounded bg-[var(--os-bg-content)] border border-[var(--os-border)] text-[var(--os-text)] text-xs focus:outline-none focus:border-[var(--os-accent)]"
                >
                  <option value="auto">
                    Auto (Probe Optimal{optimalProbe ? `: ${optimalProbe.optimalSegments} Streams` : ''})
                  </option>
                  <option value="1">1 Stream (Single Connection)</option>
                  <option value="2">2 Streams</option>
                  <option value="4">4 Streams</option>
                  <option value="8">8 Streams (Balanced)</option>
                  <option value="16">16 Streams (High-Speed)</option>
                  <option value="32">32 Streams (Maximum IDM)</option>
                </select>
              </div>
            </div>

            {segmentMode === 'auto' && (
              <div className="flex items-center justify-between gap-2 px-2.5 py-1 rounded bg-[var(--os-bg-selected-soft)] border border-[var(--os-border)] text-[10px] text-[var(--os-text-selected-soft)]">
                <div className="flex items-center gap-1.5 truncate font-mono">
                  <Gauge className="w-3 h-3 shrink-0 text-[var(--os-accent)]" />
                  {isProbingSegments ? (
                    <span>Probing connection throughput &amp; RTT...</span>
                  ) : optimalProbe ? (
                    <span className="truncate" title={optimalProbe.reason}>
                      Optimal: <strong>{optimalProbe.optimalSegments} Streams</strong> ({optimalProbe.measuredMbps} Mbps • {optimalProbe.rttMs} ms RTT)
                    </span>
                  ) : (
                    <span>Using broadband default (16 Streams)</span>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => runSegmentProbe(url.trim())}
                  disabled={isProbingSegments}
                  title="Re-probe internet connection for optimal parallel segments"
                  className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-[var(--os-bg-control)] hover:bg-[var(--os-bg-hover)] border border-[var(--os-border)] text-[var(--os-text)] text-[10px] font-medium shrink-0 disabled:opacity-50"
                >
                  <RefreshCw className={`w-2.5 h-2.5 ${isProbingSegments ? 'animate-spin' : ''}`} />
                  <span>Probe</span>
                </button>
              </div>
            )}
          </div>

          {/* Probed Size (Read-Only), Category, Bandwidth Priority in 3-Column Grid */}
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="text-[11px] text-[var(--os-text)] flex items-center gap-1 mb-1">
                <span>Probed File Size:</span>
                {isProbingUrl && <Loader2 className="w-3 h-3 animate-spin text-[var(--os-accent)]" />}
              </label>
              <input
                type="text"
                readOnly
                tabIndex={-1}
                value={estimatedSizeDisplay}
                title={
                  probedBytes > 0
                    ? `Exact probed Content-Length: ${formatExactBytes(probedBytes)}`
                    : 'Automatically probed from remote server Content-Length / Content-Range headers'
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

          {/* Save Directory */}
          <div className="space-y-1">
            <label className="text-[11px] text-[var(--os-text)] block">Save Path:</label>
            <div className="flex gap-2">
              <input
                type="text"
                value={savePath}
                onChange={(e) => setSavePath(e.target.value)}
                className="flex-1 px-2.5 py-1 rounded bg-[var(--os-bg-content)] border border-[var(--os-border)] text-[var(--os-text)] focus:outline-none focus:border-[var(--os-accent)] font-mono text-[11px]"
              />
              <button
                type="button"
                onClick={handleBrowseSaveDir}
                title="Open OS file manager to choose destination folder"
                className="px-2.5 py-1 rounded bg-[var(--os-bg-control)] hover:bg-[var(--os-bg-hover)] border border-[var(--os-border)] text-[var(--os-text)] text-xs flex items-center gap-1"
              >
                <Folder className="w-3.5 h-3.5" />
                <span>Browse...</span>
              </button>
            </div>
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
              className="px-5 py-1.5 rounded bg-[var(--os-accent)] hover:bg-[var(--os-accent-hover)] text-white text-xs font-semibold shadow-xs flex items-center gap-1.5"
            >
              <span>Start Download</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
