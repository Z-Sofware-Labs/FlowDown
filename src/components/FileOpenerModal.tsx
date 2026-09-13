import React, { useState } from 'react';
import { 
  FolderOpen, 
  ExternalLink, 
  Copy, 
  Check, 
  X, 
  File, 
  HardDrive, 
  Terminal,
  CheckCircle2,
  FolderPlus
} from 'lucide-react';
import { DownloadItem } from '../types';
import { formatBytes } from '../utils/formatters';
import { DirectoryPromptModal } from './DirectoryPromptModal';

import { openDirectoryNative, openPathNative } from '../utils/tauri';

interface FileOpenerModalProps {
  item: DownloadItem | null;
  onClose: () => void;
  onToast: (title: string, desc: string, type?: 'success' | 'info' | 'error') => void;
  existingDirectories: string[];
  onAddDirectory: (path: string) => void;
}

export const FileOpenerModal: React.FC<FileOpenerModalProps> = ({
  item,
  onClose,
  onToast,
  existingDirectories,
  onAddDirectory,
}) => {
  const [copied, setCopied] = useState(false);
  const [promptPath, setPromptPath] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<'folder' | 'file' | null>(null);

  if (!item) return null;

  const fullPath = `${item.savePath}/${item.name}`.replace(/\/\//g, '/');

  const handleCopyPath = () => {
    navigator.clipboard.writeText(fullPath);
    setCopied(true);
    onToast('Path Copied', fullPath, 'success');
    setTimeout(() => setCopied(false), 2000);
  };

  const triggerOpenFolderLogic = async () => {
    const res = await openDirectoryNative(item.savePath);
    if (res.success) {
      onToast('Opened Directory', `Accessed via ${res.method} at: ${item.savePath}`, 'success');
    } else {
      navigator.clipboard.writeText(item.savePath);
      onToast('Directory Path Copied', `Path: ${item.savePath} (Copied to clipboard)`, 'info');
    }
    onClose();
  };

  const triggerOpenFileLogic = async () => {
    if (item.status !== 'completed') {
      onToast('File Transfer In Progress', `Progress: ${Math.floor((item.downloaded / item.size) * 100)}%. Previewing file stream.`, 'info');
    } else {
      const res = await openPathNative(fullPath);
      if (res.success) {
        onToast('File Launched', `Opened ${item.name} with the system default application`, 'success');
      } else {
        onToast('Could Not Launch File', `Could not open ${item.name}. The file may have been moved or no application is associated with it.`, 'error');
      }
    }
    onClose();
  };

  const handleOpenFolder = () => {
    const isFolderExisting = existingDirectories.includes(item.savePath);
    if (!isFolderExisting) {
      setPromptPath(item.savePath);
      setPendingAction('folder');
    } else {
      triggerOpenFolderLogic();
    }
  };

  const handleOpenFile = () => {
    const isFolderExisting = existingDirectories.includes(item.savePath);
    if (!isFolderExisting) {
      setPromptPath(item.savePath);
      setPendingAction('file');
    } else {
      triggerOpenFileLogic();
    }
  };

  const handleConfirmCreateDirectory = (path: string) => {
    onAddDirectory(path);
    onToast('Directory Created', `Successfully created directory: ${path}`, 'success');
    setPromptPath(null);

    if (pendingAction === 'folder') {
      triggerOpenFolderLogic();
    } else if (pendingAction === 'file') {
      triggerOpenFileLogic();
    }
    setPendingAction(null);
  };

  return (
    <>
      <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl max-w-lg w-full shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200 text-slate-800 dark:text-slate-100">
          
          {/* Modal Header */}
          <div className="flex items-center justify-between px-6 py-4 bg-slate-50 dark:bg-slate-800/80 border-b border-slate-200 dark:border-slate-700/80">
            <div className="flex items-center space-x-3">
              <div className="p-2.5 bg-blue-100 dark:bg-blue-900/50 text-blue-600 dark:text-blue-400 rounded-xl">
                <FolderOpen className="h-5 w-5" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-slate-900 dark:text-white flex items-center space-x-2">
                  <span>File Location Launcher</span>
                  <span className="bg-emerald-100 dark:bg-emerald-950/80 text-emerald-700 dark:text-emerald-300 text-[10px] font-mono px-2 py-0.5 rounded-full border border-emerald-200 dark:border-emerald-800">
                    Native Shell
                  </span>
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400">Target File & Directory Inspector</p>
              </div>
            </div>

            <button
              onClick={onClose}
              className="p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-lg hover:bg-slate-200/50 dark:hover:bg-slate-700/50 transition-colors"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Modal Body */}
          <div className="p-6 space-y-5">
            {/* Item Box */}
            <div className="p-4 bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700/80 rounded-xl space-y-3">
              <div className="flex items-start space-x-3">
                <div className="p-2 bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300 rounded-lg mt-0.5">
                  <File className="h-5 w-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <h4 className="text-xs font-bold text-slate-900 dark:text-slate-100 truncate">
                    {item.name}
                  </h4>
                  <div className="flex items-center space-x-3 text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 font-mono">
                    <span>Size: {formatBytes(item.size)}</span>
                    <span>•</span>
                    <span>Status: <strong className="capitalize text-slate-700 dark:text-slate-300">{item.status}</strong></span>
                    {item.isTorrent && (
                      <>
                        <span>•</span>
                        <span className="text-teal-600 dark:text-teal-400 font-semibold">librqbit Torrent</span>
                      </>
                    )}
                  </div>
                </div>
              </div>

              {/* Path Breadcrumbs */}
              <div className="pt-2 border-t border-slate-200/80 dark:border-slate-700/60">
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1">
                  System File Location Path
                </label>
                <div className="flex items-center justify-between bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 px-3 py-2 rounded-lg text-xs font-mono text-slate-800 dark:text-slate-200">
                  <span className="truncate mr-2">{fullPath}</span>
                  <button
                    onClick={handleCopyPath}
                    className="p-1 text-slate-400 hover:text-slate-700 dark:hover:text-white transition-colors shrink-0"
                    title="Copy Full Path"
                  >
                    {copied ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
                  </button>
                </div>
              </div>
            </div>

            {/* Plugin Details */}
            <div className="bg-blue-50/80 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-900/60 rounded-xl p-3.5 flex items-start space-x-3 text-xs text-blue-800 dark:text-blue-300">
              <Terminal className="h-4 w-4 text-blue-600 dark:text-blue-400 shrink-0 mt-0.5" />
              <div className="space-y-1">
                <div className="font-bold flex items-center space-x-1.5">
                  <span>Opener Dispatcher Ready</span>
                  <CheckCircle2 className="h-3.5 w-3.5 text-blue-500" />
                </div>
                <p className="text-[11px] text-blue-700/90 dark:text-blue-300/80 leading-relaxed">
                  Directing system file explorer to target location without interrupting background download tasks.
                </p>
              </div>
            </div>
          </div>

          {/* Modal Actions Footer */}
          <div className="px-6 py-4 bg-slate-50 dark:bg-slate-800/80 border-t border-slate-200 dark:border-slate-700/80 flex items-center justify-end space-x-3">
            <button
              onClick={handleOpenFolder}
              className="flex items-center space-x-1.5 bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-600 font-semibold text-xs px-4 py-2 rounded-xl transition-all shadow-2xs cursor-pointer"
            >
              <FolderOpen className="h-4 w-4 text-slate-500" />
              <span>Show Containing Folder</span>
            </button>

            <button
              onClick={handleOpenFile}
              className="flex items-center space-x-1.5 bg-blue-600 hover:bg-blue-700 text-white font-semibold text-xs px-4.5 py-2 rounded-xl transition-all shadow-xs active:scale-95 cursor-pointer"
            >
              <ExternalLink className="h-4 w-4" />
              <span>Launch File</span>
            </button>
          </div>

        </div>
      </div>

      {promptPath && (
        <DirectoryPromptModal
          isOpen={!!promptPath}
          directoryPath={promptPath}
          onConfirm={handleConfirmCreateDirectory}
          onCancel={() => {
            setPromptPath(null);
            setPendingAction(null);
          }}
        />
      )}
    </>
  );
};
