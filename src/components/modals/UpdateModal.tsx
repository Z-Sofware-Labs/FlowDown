import React, { useState, useEffect, useCallback, useRef } from 'react';
import { RefreshCw, CheckCircle2, Download, ShieldCheck, AlertCircle } from 'lucide-react';
import { SubwindowHeader } from './SubwindowHeader';
import { apiClient, UpdateCheckResponse } from '../../services/apiClient';

interface UpdateModalProps {
  isOpen: boolean;
  onClose: () => void;
  osStyle?: 'windows' | 'macos' | 'linux';
}

type UpdateState = 'checking' | 'up-to-date' | 'downloading' | 'elevating' | 'error';

export const UpdateModal: React.FC<UpdateModalProps> = ({ isOpen, onClose, osStyle = 'windows' }) => {
  const [state, setState] = useState<UpdateState>('checking');
  const [currentVersion, setCurrentVersion] = useState('2.0.7');
  const [latestVersion, setLatestVersion] = useState<string | null>(null);
  const [downloadProgress, setDownloadProgress] = useState<{ downloaded: number; total: number; percentage: number }>({
    downloaded: 0,
    total: 0,
    percentage: 0,
  });
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const activeCheckRef = useRef(false);

  const startUpdateFlow = useCallback(async () => {
    setState('checking');
    setErrorMessage(null);
    setDownloadProgress({ downloaded: 0, total: 0, percentage: 0 });

    try {
      const res: UpdateCheckResponse | null = await apiClient.checkForUpdates();
      if (!res) {
        setState('error');
        setErrorMessage('Unable to reach update server. Please check your internet connection.');
        return;
      }

      setCurrentVersion(res.currentVersion || '2.0.7');

      if (!res.hasUpdate) {
        setState('up-to-date');
        return;
      }

      // Update available -> trigger automated download & elevation procedure immediately
      setLatestVersion(res.latestVersion);
      const assets = res.assets || [];
      const targetAsset =
        assets.find((a) => a.name.toLowerCase().endsWith('-setup.exe') || a.name.toLowerCase().endsWith('setup.exe')) ||
        assets.find((a) => a.name.toLowerCase().endsWith('.exe')) ||
        assets.find((a) => a.name.toLowerCase().endsWith('.msi')) ||
        assets[0];

      if (!targetAsset) {
        setState('error');
        setErrorMessage('No executable installer package found in the latest release.');
        return;
      }

      setState('downloading');

      // Listen for download progress and execute installer with elevation
      await apiClient.downloadAndApplyUpdate(targetAsset.downloadUrl, targetAsset.name, (p) => {
        setDownloadProgress(p);
        if (p.percentage >= 100) {
          setState('elevating');
        }
      });

      setState('elevating');
    } catch (err: any) {
      console.error('[UpdateModal] Error in automated update flow:', err);
      setState('error');
      setErrorMessage(
        err?.message || (typeof err === 'string' ? err : 'Update could not be installed. Elevation may have been denied.')
      );
    }
  }, []);

  useEffect(() => {
    if (isOpen) {
      activeCheckRef.current = true;
      startUpdateFlow();
    } else {
      activeCheckRef.current = false;
    }
  }, [isOpen, startUpdateFlow]);

  if (!isOpen) return null;

  const formatMb = (bytes: number) => {
    if (!bytes || bytes <= 0) return '0.0 MB';
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <div
      className="fixed inset-0 bg-black/40 dark:bg-black/60 backdrop-blur-xs flex items-center justify-center z-50 p-4 select-none"
      onClick={(e) => {
        if (e.target === e.currentTarget && state !== 'downloading' && state !== 'elevating') {
          onClose();
        }
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="update-flowdown-title"
        className="w-[420px] max-w-full bg-[var(--os-bg-window)] border border-[var(--os-border)] rounded-[10px] shadow-[0_20px_50px_rgba(0,0,0,0.35)] flex flex-col overflow-hidden text-[var(--os-text)] font-sans"
      >
        <SubwindowHeader
          title="Software Update"
          onClose={() => {
            if (state !== 'downloading' && state !== 'elevating') {
              onClose();
            }
          }}
          osStyle={osStyle}
        />

        <div className="p-5 flex flex-col items-center text-center">
          {/* Status Icon */}
          <div className="mb-3.5">
            {state === 'checking' && (
              <div className="w-12 h-12 rounded-full bg-[var(--os-accent)]/10 text-[var(--os-accent)] flex items-center justify-center">
                <RefreshCw className="w-6 h-6 animate-spin" />
              </div>
            )}
            {state === 'up-to-date' && (
              <div className="w-12 h-12 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 flex items-center justify-center">
                <CheckCircle2 className="w-6 h-6" />
              </div>
            )}
            {state === 'downloading' && (
              <div className="w-12 h-12 rounded-full bg-blue-500/10 text-blue-500 flex items-center justify-center">
                <Download className="w-6 h-6 animate-bounce" />
              </div>
            )}
            {state === 'elevating' && (
              <div className="w-12 h-12 rounded-full bg-amber-500/10 text-amber-500 flex items-center justify-center">
                <ShieldCheck className="w-6 h-6 animate-pulse" />
              </div>
            )}
            {state === 'error' && (
              <div className="w-12 h-12 rounded-full bg-rose-500/10 text-rose-500 flex items-center justify-center">
                <AlertCircle className="w-6 h-6" />
              </div>
            )}
          </div>

          {/* Heading */}
          <h3 id="update-flowdown-title" className="text-sm font-bold text-[var(--os-text)]">
            {state === 'checking' && 'Checking for Updates...'}
            {state === 'up-to-date' && 'FlowDown is Up to Date'}
            {state === 'downloading' && `Downloading FlowDown v${latestVersion || ''}`}
            {state === 'elevating' && 'Applying Update...'}
            {state === 'error' && 'Update Check Failed'}
          </h3>

          {/* Detail Description */}
          <div className="mt-1.5 text-xs text-[var(--os-text-muted)] max-w-sm leading-relaxed">
            {state === 'checking' && 'Connecting to GitHub Releases to check for new versions of FlowDown...'}
            {state === 'up-to-date' && (
              <>
                FlowDown <span className="font-semibold text-[var(--os-text)]">v{currentVersion} Stable</span> is currently the newest version available.
              </>
            )}
            {state === 'downloading' && (
              <>
                An official release <span className="font-semibold text-[var(--os-text)]">v{latestVersion}</span> was found. Downloading package directly...
              </>
            )}
            {state === 'elevating' && (
              <>
                Please approve the system permission prompt if requested. FlowDown will apply the update and relaunch automatically.
              </>
            )}
            {state === 'error' && (
              <span className="text-rose-600 dark:text-rose-400 font-medium">
                {errorMessage || 'An error occurred during update.'}
              </span>
            )}
          </div>

          {/* Download Progress Bar */}
          {state === 'downloading' && (
            <div className="w-full mt-4 space-y-1.5">
              <div className="w-full bg-[var(--os-bg-content)] h-2 rounded-full overflow-hidden border border-[var(--os-border)]">
                <div
                  className="bg-[var(--os-accent)] h-full transition-all duration-200 rounded-full"
                  style={{ width: `${Math.min(100, Math.max(0, downloadProgress.percentage))}%` }}
                />
              </div>
              <div className="flex justify-between text-[11px] font-mono text-[var(--os-text-muted)]">
                <span>
                  {formatMb(downloadProgress.downloaded)} / {formatMb(downloadProgress.total)}
                </span>
                <span className="font-semibold text-[var(--os-text)]">
                  {downloadProgress.percentage}%
                </span>
              </div>
            </div>
          )}

          {/* Elevation Banner */}
          {state === 'elevating' && (
            <div className="w-full mt-4 p-2.5 rounded bg-amber-500/10 border border-amber-500/30 text-left text-[11px] text-amber-700 dark:text-amber-300 space-y-1">
              <div className="font-semibold flex items-center gap-1.5">
                <ShieldCheck className="w-3.5 h-3.5 shrink-0" />
                <span>Action Required</span>
              </div>
              <p className="opacity-90 leading-tight">
                Confirm the system permission prompt if requested to allow the update to install and relaunch FlowDown automatically.
              </p>
            </div>
          )}

          {/* Action Buttons */}
          <div className="mt-5 w-full flex items-center justify-end gap-2 pt-3 border-t border-[var(--os-border-subtle)]">
            {state === 'up-to-date' && (
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-1.5 rounded-md bg-[var(--os-accent)] hover:bg-[var(--os-accent-hover)] text-white text-xs font-semibold shadow-2xs transition-colors"
              >
                OK
              </button>
            )}

            {state === 'error' && (
              <>
                <button
                  type="button"
                  onClick={onClose}
                  className="px-3.5 py-1.5 rounded-md bg-[var(--os-bg-control)] hover:bg-[var(--os-bg-hover)] border border-[var(--os-border)] text-[var(--os-text)] text-xs font-medium transition-colors"
                >
                  Close
                </button>
                <button
                  type="button"
                  onClick={startUpdateFlow}
                  className="px-4 py-1.5 rounded-md bg-[var(--os-accent)] hover:bg-[var(--os-accent-hover)] text-white text-xs font-semibold shadow-2xs transition-colors flex items-center gap-1.5"
                >
                  <RefreshCw className="w-3 h-3" />
                  <span>Retry</span>
                </button>
              </>
            )}

            {state === 'checking' && (
              <button
                type="button"
                onClick={onClose}
                className="px-3.5 py-1.5 rounded-md bg-[var(--os-bg-control)] hover:bg-[var(--os-bg-hover)] border border-[var(--os-border)] text-[var(--os-text)] text-xs font-medium transition-colors"
              >
                Cancel
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
