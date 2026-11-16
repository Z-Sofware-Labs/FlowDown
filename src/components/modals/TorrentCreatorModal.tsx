import React, { useState } from 'react';
import { X, PlusCircle, Folder, HardDrive, ShieldCheck, Zap } from 'lucide-react';
import { detectHostOs, getDefaultDownloadPath, getOsPathSeparator } from '../../utils/detectOs';
import { pickOsFile } from '../../utils/osFilePicker';
import { apiClient } from '../../services/apiClient';
import { SubwindowHeader } from './SubwindowHeader';

interface TorrentCreatorModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreated: (name: string, sizeBytes: number) => void;
}

export const TorrentCreatorModal: React.FC<TorrentCreatorModalProps> = ({
  isOpen,
  onClose,
  onCreated,
}) => {
  const defaultSource = `${getDefaultDownloadPath()}${getOsPathSeparator()}open-source-dataset-2026`;
  const [sourcePath, setSourcePath] = useState(defaultSource);
  const [sourceSizeBytes, setSourceSizeBytes] = useState<number>(4294967296);
  const [torrentName, setTorrentName] = useState('OpenSource-Research-Dataset-2026.torrent');
  const [pieceSize, setPieceSize] = useState('4 MB');
  const [trackers, setTrackers] = useState(
    'udp://tracker.opentrackr.org:1337/announce\nhttps://torrent.ubuntu.com/announce\nudp://libqrbit-stealth-dht.v4.internal:443/announce'
  );
  const [isPrivate, setIsPrivate] = useState(false);
  const [includeLibqrbitSignature, setIncludeLibqrbitSignature] = useState(true);

  if (!isOpen) return null;

  const handleBrowseTargetFile = async () => {
    const picked = await pickOsFile({ os: detectHostOs() });
    if (!picked) return;
    setSourcePath(picked.displayPath);
    if (picked.size > 0) {
      setSourceSizeBytes(picked.size);
    }
    const baseName = picked.name.replace(/\.[^.]+$/, '') || picked.name;
    setTorrentName(`${baseName}.torrent`);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const pieceBytesMap: Record<string, number> = {
      '512 KB': 512 * 1024,
      '1 MB': 1024 * 1024,
      '2 MB': 2 * 1024 * 1024,
      '4 MB': 4 * 1024 * 1024,
      '8 MB': 8 * 1024 * 1024,
      '16 MB': 16 * 1024 * 1024,
    };
    const sep = getOsPathSeparator(detectHostOs());
    const normalizedOut = torrentName.endsWith('.torrent') ? torrentName : `${torrentName}.torrent`;
    const outputPath = `${getDefaultDownloadPath()}${sep}${normalizedOut}`;
    const created = await apiClient.createTorrentRpc({
      source_path: sourcePath,
      output_path: outputPath,
      trackers: trackers.split('\n').map((t) => t.trim()).filter(Boolean),
      piece_length: pieceBytesMap[pieceSize] || 4 * 1024 * 1024,
      comment: includeLibqrbitSignature ? 'FlowDown 2.0.2 libqrbit Stealth Swarm' : undefined,
      private: isPrivate,
    });
    onCreated(created?.name || torrentName.replace('.torrent', ''), created?.total_size || sourceSizeBytes);
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-xs flex items-center justify-center z-50 p-4 select-none">
      <div className="w-full max-w-lg bg-[var(--os-bg-window)] border border-[var(--os-border)] rounded shadow-2xl overflow-hidden text-[var(--os-text)] text-xs font-sans">
        <SubwindowHeader
          onClose={onClose}
          icon={<PlusCircle className="w-4 h-4 text-[var(--os-accent)] shrink-0" />}
          title="Create New .torrent Package"
        />

        <form onSubmit={handleSubmit} className="p-4 space-y-3">
          <div>
            <label className="text-[11px] text-[var(--os-text)] font-medium block mb-1">Select Source Folder / File:</label>
            <div className="flex gap-2">
              <input
                type="text"
                value={sourcePath}
                onChange={(e) => setSourcePath(e.target.value)}
                className="flex-1 px-2.5 py-1 rounded bg-[var(--os-bg-content)] border border-[var(--os-border)] text-[var(--os-text)] focus:outline-none focus:border-[var(--os-accent)] font-mono text-[11px]"
              />
              <button
                type="button"
                onClick={handleBrowseTargetFile}
                title="Open OS file manager to browse for the target file"
                className="px-2.5 py-1 rounded bg-[var(--os-bg-control)] hover:bg-[var(--os-bg-hover)] border border-[var(--os-border)] text-[var(--os-text)] text-xs flex items-center gap-1"
              >
                <Folder className="w-3.5 h-3.5" />
                <span>Browse...</span>
              </button>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[11px] text-[var(--os-text)] block mb-1">Target .torrent Filename:</label>
              <input
                type="text"
                value={torrentName}
                onChange={(e) => setTorrentName(e.target.value)}
                className="w-full px-2.5 py-1 rounded bg-[var(--os-bg-content)] border border-[var(--os-border)] text-[var(--os-text)] focus:outline-none focus:border-[var(--os-accent)] text-xs font-mono"
              />
            </div>
            <div>
              <label className="text-[11px] text-[var(--os-text)] block mb-1">Piece Size:</label>
              <select
                value={pieceSize}
                onChange={(e) => setPieceSize(e.target.value)}
                className="w-full px-2.5 py-1 rounded bg-[var(--os-bg-content)] border border-[var(--os-border)] text-[var(--os-text)] focus:outline-none focus:border-[var(--os-accent)] text-xs"
              >
                <option value="512 KB">512 KB</option>
                <option value="1 MB">1 MB</option>
                <option value="2 MB">2 MB</option>
                <option value="4 MB">4 MB (Recommended for &gt;2 GB)</option>
                <option value="8 MB">8 MB</option>
                <option value="16 MB">16 MB</option>
              </select>
            </div>
          </div>

          <div>
            <label className="text-[11px] text-[var(--os-text)] font-medium block mb-1">Tracker Announce URLs (one per line):</label>
            <textarea
              rows={3}
              value={trackers}
              onChange={(e) => setTrackers(e.target.value)}
              className="w-full px-2.5 py-1 rounded bg-[var(--os-bg-content)] border border-[var(--os-border)] text-[var(--os-text)] focus:outline-none focus:border-[var(--os-accent)] font-mono text-[10px] leading-relaxed"
            />
          </div>

          <div className="p-2.5 rounded bg-[var(--os-bg-alt)] border border-[var(--os-border)] space-y-1.5">
            <label className="flex items-center gap-2 cursor-pointer text-[11px]">
              <input
                type="checkbox"
                checked={includeLibqrbitSignature}
                onChange={(e) => setIncludeLibqrbitSignature(e.target.checked)}
                className="rounded accent-[var(--os-accent)]"
              />
              <span className="font-semibold text-[var(--os-text)] flex items-center gap-1.5">
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                Inject libqrbit Stealth Swarm Metadata (BEP-62)
              </span>
            </label>
            <p className="text-[10px] text-[var(--os-text-muted)] pl-5">
              Allows compliant seeders and downloaders to automatically negotiate QUIC-morphing tunnels and dynamic UDP hole punching without unencrypted handshakes.
            </p>
          </div>

          <div className="flex items-center justify-end gap-2 pt-2 border-t border-[var(--os-border)]">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-1.5 rounded bg-[var(--os-bg-control)] hover:bg-[var(--os-bg-hover)] border border-[var(--os-border)] text-[var(--os-text)] text-xs"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-5 py-1.5 rounded bg-[var(--os-accent)] hover:bg-[var(--os-accent-hover)] text-white text-xs font-semibold shadow-2xs flex items-center gap-1.5"
            >
              <Zap className="w-3.5 h-3.5 text-yellow-300 fill-yellow-300" />
              <span>Generate .torrent File</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
