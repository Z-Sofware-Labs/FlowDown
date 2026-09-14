import React, { useState, useEffect } from 'react';
import {
  X,
  Sparkles,
  DownloadCloud,
  CheckCircle2,
  RefreshCw,
  AlertCircle,
  Clock,
  Tag,
  ArrowRight,
  ExternalLink,
} from 'lucide-react';
import {
  AppUpdateInfo,
  UpdateDownloadProgress,
  downloadAndInstallUpdate,
  relaunchApp,
} from '../utils/updater';
import { formatBytes } from '../utils/formatters';

interface UpdateModalProps {
  isOpen: boolean;
  onClose: () => void;
  updateInfo: AppUpdateInfo | null;
  onCheckAgain: () => Promise<void>;
  isChecking: boolean;
}

export const UpdateModal: React.FC<UpdateModalProps> = ({
  isOpen,
  onClose,
  updateInfo,
  onCheckAgain,
  isChecking,
}) => {
  const [isInstalling, setIsInstalling] = useState(false);
  const [downloadProgress, setDownloadProgress] =
    useState<UpdateDownloadProgress | null>(null);
  const [installError, setInstallError] = useState<string | null>(null);
  const [isReadyToRestart, setIsReadyToRestart] = useState(false);

  if (!isOpen) return null;

  const handleInstall = async () => {
    if (!updateInfo?.rawUpdate) return;

    try {
      setIsInstalling(true);
      setInstallError(null);
      await downloadAndInstallUpdate(updateInfo.rawUpdate, (progress) => {
        setDownloadProgress(progress);
      });
      setIsReadyToRestart(true);
    } catch (err: any) {
      console.error('[FlowDown] Update install failed:', err);
      setInstallError(
        err?.message ||
          'Failed to download and install update. Please check your network connection.'
      );
    } finally {
      setIsInstalling(false);
    }
  };

  // User initiates the update download and installation deliberately via the Install button

  const handleRestart = async () => {
    try {
      await relaunchApp();
    } catch (err) {
      console.error('[FlowDown] Relaunch failed:', err);
    }
  };

  const hasUpdate = Boolean(updateInfo?.available && updateInfo.version);

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl w-full max-w-lg max-h-[90vh] overflow-hidden shadow-2xl animate-in fade-in zoom-in-95 duration-200 text-slate-800 dark:text-slate-100 flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40">
          <div className="flex items-center space-x-2.5">
            <div className="p-2 bg-blue-500/10 dark:bg-blue-400/10 text-blue-600 dark:text-blue-400 rounded-xl">
              <Sparkles className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-900 dark:text-white">
                Software Updates
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                GitHub Release & Channel Sync
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            disabled={isInstalling}
            className="p-1.5 rounded-xl border border-slate-200 dark:border-slate-700/80 text-slate-400 hover:text-slate-700 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors disabled:opacity-50 cursor-pointer shadow-xs"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Content Body */}
        <div className="p-6 space-y-5 overflow-y-auto text-xs flex-1">
          {/* Status Banner */}
          {hasUpdate ? (
            <div className="bg-blue-50/80 dark:bg-blue-950/40 border border-blue-200/80 dark:border-blue-800/60 rounded-2xl p-4 space-y-3">
              <div className="flex items-center justify-between">
                <span className="inline-flex items-center space-x-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-blue-600 text-white shadow-xs">
                  <Tag className="h-3 w-3" />
                  <span>Update Available</span>
                </span>
                {(() => {
                  if (!updateInfo?.date) return null;
                  try {
                    const parsed = new Date(updateInfo.date);
                    if (isNaN(parsed.getTime())) return null;
                    return (
                      <span className="text-[11px] text-slate-500 dark:text-slate-400 flex items-center space-x-1">
                        <Clock className="h-3 w-3" />
                        <span>{parsed.toLocaleDateString()}</span>
                      </span>
                    );
                  } catch {
                    return null;
                  }
                })()}
              </div>

              <div className="flex items-center space-x-3 text-sm">
                <span className="font-semibold text-slate-600 dark:text-slate-400">
                  v{updateInfo?.currentVersion || '1.0.5'}
                </span>
                <ArrowRight className="h-4 w-4 text-blue-500 shrink-0" />
                <span className="font-extrabold text-blue-600 dark:text-blue-400 text-base">
                  v{updateInfo?.version}
                </span>
              </div>

              <p className="text-xs text-slate-600 dark:text-slate-300">
                A new version of FlowDown is available on GitHub Releases with
                performance improvements and new capabilities.
              </p>
            </div>
          ) : (
            <div className="bg-slate-50 dark:bg-slate-800/50 border border-slate-200/80 dark:border-slate-700/60 rounded-2xl p-5 text-center space-y-2">
              <div className="inline-flex p-3 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 mb-1">
                <CheckCircle2 className="h-6 w-6" />
              </div>
              <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                FlowDown is Up to Date
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 max-w-xs mx-auto">
                You are running version{' '}
                <span className="font-mono font-semibold text-slate-700 dark:text-slate-300">
                  v{updateInfo?.currentVersion || '1.0.5'}
                </span>
                . No newer releases were found on GitHub.
              </p>
            </div>
          )}

          {/* Release Notes */}
          {hasUpdate && updateInfo?.body && (
            <div className="space-y-1.5">
              <h4 className="text-[11px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider">
                What&apos;s New in v{updateInfo.version}
              </h4>
              <div className="bg-slate-50 dark:bg-slate-950/50 border border-slate-200 dark:border-slate-800 rounded-xl p-3.5 max-h-40 overflow-y-auto text-slate-700 dark:text-slate-300 text-xs font-mono leading-relaxed whitespace-pre-wrap">
                {updateInfo.body}
              </div>
            </div>
          )}

          {/* Progress Bar while downloading */}
          {isInstalling && (
            <div className="space-y-2 bg-slate-50 dark:bg-slate-800/40 p-3.5 rounded-xl border border-slate-200 dark:border-slate-700/80">
              <div className="flex items-center justify-between text-xs font-semibold text-slate-700 dark:text-slate-300">
                <span className="flex items-center space-x-1.5">
                  <RefreshCw className="h-3.5 w-3.5 animate-spin text-blue-500" />
                  <span>Downloading update from GitHub...</span>
                </span>
                <span>
                  {downloadProgress?.percentage !== undefined
                    ? `${downloadProgress.percentage}%`
                    : 'Connecting...'}
                </span>
              </div>
              <div className="w-full bg-slate-200 dark:bg-slate-700 h-2 rounded-full overflow-hidden">
                <div
                  className="bg-blue-600 h-full rounded-full transition-all duration-300 ease-out"
                  style={{
                    width: `${downloadProgress?.percentage || 0}%`,
                  }}
                />
              </div>
              {downloadProgress?.downloaded !== undefined && (
                <div className="flex justify-between text-[10px] text-slate-400 font-mono">
                  <span>{formatBytes(downloadProgress.downloaded)}</span>
                  {downloadProgress.contentLength && (
                    <span>of {formatBytes(downloadProgress.contentLength)}</span>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Error notice */}
          {installError && (
            <div className="bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800/80 rounded-xl p-3 flex items-start space-x-2 text-rose-700 dark:text-rose-300">
              <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
              <p className="text-xs leading-relaxed">{installError}</p>
            </div>
          )}

          {/* Ready to restart message */}
          {isReadyToRestart && (
            <div className="bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 rounded-xl p-3.5 flex items-center space-x-3 text-emerald-800 dark:text-emerald-300">
              <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-600 dark:text-emerald-400" />
              <div>
                <p className="text-xs font-bold">Update Ready to Apply</p>
                <p className="text-[11px] opacity-90">
                  Restart FlowDown now to complete the update installation.
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="px-6 py-4 border-t border-slate-100 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-800/40 flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => void onCheckAgain()}
            disabled={isChecking || isInstalling}
            className="px-3.5 py-2 rounded-xl border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-50 text-slate-600 dark:text-slate-300 font-semibold text-xs transition-colors flex items-center space-x-1.5 cursor-pointer"
          >
            <RefreshCw
              className={`h-3.5 w-3.5 ${isChecking ? 'animate-spin text-blue-500' : ''}`}
            />
            <span>{isChecking ? 'Checking...' : 'Check Again'}</span>
          </button>

          <div className="flex items-center space-x-2">
            {!isReadyToRestart && (
              <button
                type="button"
                onClick={onClose}
                disabled={isInstalling}
                className="px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-700/80 text-slate-600 dark:text-slate-400 hover:text-slate-800 dark:hover:text-white text-xs font-semibold hover:bg-slate-100 dark:hover:bg-slate-800/60 transition-colors disabled:opacity-50 cursor-pointer shadow-xs"
              >
                Close
              </button>
            )}

            {isReadyToRestart ? (
              <button
                type="button"
                onClick={() => void handleRestart()}
                className="px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 active:scale-95 text-white font-bold text-xs shadow-xs transition-all flex items-center space-x-1.5 cursor-pointer"
              >
                <RefreshCw className="h-4 w-4" />
                <span>Restart FlowDown</span>
              </button>
            ) : hasUpdate ? (
              <button
                type="button"
                onClick={() => void handleInstall()}
                disabled={isInstalling}
                className="px-5 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 active:scale-95 text-white font-bold text-xs shadow-xs transition-all flex items-center space-x-1.5 disabled:opacity-50 cursor-pointer"
              >
                <DownloadCloud className="h-4 w-4" />
                <span>
                  {isInstalling ? 'Installing...' : `Update to v${updateInfo?.version}`}
                </span>
              </button>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
};
