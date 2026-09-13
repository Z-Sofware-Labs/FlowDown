import React from 'react';
import { 
  Download, 
  Play, 
  Pause, 
  CheckCircle2, 
  Clock, 
  Folder, 
  FolderOpen,
  Film, 
  Music, 
  Code, 
  Archive, 
  FileText, 
  Image as ImageIcon, 
  HardDrive,
  Layers,
  Sparkles,
  Radio,
  ShieldCheck
} from 'lucide-react';
import { logger } from '../utils/logger';
import { FileType } from '../types';
import { formatBytes } from '../utils/formatters';

interface SidebarProps {
  activeTab: string; // 'all' | 'downloading' | 'paused' | 'completed' | 'queued'
  setActiveTab: (tab: string) => void;
  selectedFileType: FileType | 'all';
  setSelectedFileType: (type: FileType | 'all') => void;
  counts: {
    all: number;
    downloading: number;
    paused: number;
    completed: number;
    queued: number;
    video: number;
    audio: number;
    software: number;
    archive: number;
    document: number;
    image: number;
    torrent?: number;
  };
  totalDownloadedBytes: number;
  isEncryptionActive: boolean;
}

export const Sidebar: React.FC<SidebarProps> = ({
  activeTab,
  setActiveTab,
  selectedFileType,
  setSelectedFileType,
  counts,
  totalDownloadedBytes,
  isEncryptionActive,
}) => {
  const [width, setWidth] = React.useState(() => {
    const saved = localStorage.getItem('sidebar_width');
    return saved ? parseInt(saved, 10) : 256;
  });
  const [isResizing, setIsResizing] = React.useState(false);

  const startResizing = React.useCallback((mouseDownEvent: React.MouseEvent) => {
    setIsResizing(true);
    mouseDownEvent.preventDefault();
  }, []);

  const stopResizing = React.useCallback(() => {
    setIsResizing(false);
  }, []);

  const resize = React.useCallback(
    (mouseMoveEvent: MouseEvent) => {
      if (isResizing) {
        const newWidth = mouseMoveEvent.clientX;
        if (newWidth >= 180 && newWidth <= 400) {
          setWidth(newWidth);
          localStorage.setItem('sidebar_width', String(newWidth));
        }
      }
    },
    [isResizing]
  );

  React.useEffect(() => {
    if (isResizing) {
      window.addEventListener('mousemove', resize);
      window.addEventListener('mouseup', stopResizing);
    } else {
      window.removeEventListener('mousemove', resize);
      window.removeEventListener('mouseup', stopResizing);
    }
    return () => {
      window.removeEventListener('mousemove', resize);
      window.removeEventListener('mouseup', stopResizing);
    };
  }, [isResizing, resize, stopResizing]);

  const statusNav = [
    { id: 'all', label: 'All Transfers', icon: Layers, count: counts.all, color: 'text-slate-500 dark:text-slate-400' },
    { id: 'downloading', label: 'Downloading', icon: Download, count: counts.downloading, color: 'text-blue-600 dark:text-blue-400' },
    { id: 'paused', label: 'Paused', icon: Pause, count: counts.paused, color: 'text-amber-500 dark:text-amber-400' },
    { id: 'completed', label: 'Completed', icon: CheckCircle2, count: counts.completed, color: 'text-emerald-600 dark:text-emerald-400' },
    { id: 'queued', label: 'Queued', icon: Clock, count: counts.queued, color: 'text-purple-600 dark:text-purple-400' },
  ];

  const fileTypesNav: { type: FileType; label: string; icon: React.ElementType; count: number }[] = [
    { type: 'torrent', label: 'Torrents (librqbit)', icon: Radio, count: counts.torrent || 0 },
    { type: 'video', label: 'Videos & Movies', icon: Film, count: counts.video },
    { type: 'software', label: 'Apps & Installers', icon: Code, count: counts.software },
    { type: 'archive', label: 'Zip & Archives', icon: Archive, count: counts.archive },
    { type: 'audio', label: 'Audio & Music', icon: Music, count: counts.audio },
    { type: 'document', label: 'Documents & PDFs', icon: FileText, count: counts.document },
    { type: 'image', label: 'Images & Photos', icon: ImageIcon, count: counts.image },
  ];

  return (
    <aside 
      style={{ width: `${width}px` }}
      className="relative bg-white dark:bg-slate-900 border-r border-slate-200 dark:border-slate-800 flex flex-col justify-between h-[calc(100vh-65px)] overflow-y-auto select-none p-4 text-slate-700 dark:text-slate-300 transition-colors duration-200 shrink-0"
    >
      {/* Draggable border resize handle */}
      <div
        onMouseDown={startResizing}
        className={`absolute top-0 right-0 w-1.5 h-full cursor-col-resize hover:bg-blue-500/40 active:bg-blue-500/70 transition-colors duration-150 z-30 ${
          isResizing ? 'bg-blue-500/50' : ''
        }`}
      />

      <div className="space-y-6">
        {/* Status Filters */}
        <div>
          <div className="px-3 text-[11px] font-bold tracking-wider text-slate-400 dark:text-slate-500 uppercase mb-2">
            Transfers
          </div>
          <nav className="space-y-1">
            {statusNav.map((item) => {
              const Icon = item.icon;
              const isActive = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => setActiveTab(item.id)}
                  className={`w-full flex items-center justify-between px-3.5 py-2 rounded-lg text-xs font-medium transition-all ${
                    isActive
                      ? 'bg-slate-100 dark:bg-slate-800 text-slate-900 dark:text-white font-semibold'
                      : 'hover:bg-slate-50 dark:hover:bg-slate-800/60 text-slate-600 dark:text-slate-400'
                  }`}
                >
                  <div className="flex items-center space-x-2.5">
                    <Icon className={`h-4 w-4 ${isActive ? 'text-slate-900 dark:text-white' : item.color}`} />
                    <span>{item.label}</span>
                  </div>
                  {item.count > 0 && (
                    <span
                      className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                        isActive ? 'bg-slate-200 dark:bg-slate-700 text-slate-800 dark:text-slate-200' : 'bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400'
                      }`}
                    >
                      {item.count}
                    </span>
                  )}
                </button>
              );
            })}
          </nav>
        </div>

        {/* File Categories */}
        <div>
          <div className="px-3 text-[11px] font-bold tracking-wider text-slate-400 dark:text-slate-500 uppercase mb-2">
            Categories
          </div>
          <nav className="space-y-1">
            <button
              onClick={() => setSelectedFileType('all')}
              className={`w-full flex items-center justify-between px-3.5 py-2 rounded-lg text-xs font-medium transition-all ${
                selectedFileType === 'all'
                  ? 'bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 font-semibold'
                  : 'hover:bg-slate-50 dark:hover:bg-slate-800/60 text-slate-600 dark:text-slate-400'
              }`}
            >
              <div className="flex items-center space-x-2.5">
                <Folder className="h-3.5 w-3.5 text-slate-400 dark:text-slate-500" />
                <span>All File Types</span>
              </div>
            </button>

            {fileTypesNav.map((item) => {
              const Icon = item.icon;
              const isActive = selectedFileType === item.type;
              return (
                <button
                  key={item.type}
                  onClick={() => setSelectedFileType(item.type)}
                  className={`w-full flex items-center justify-between px-3.5 py-2 rounded-lg text-xs font-medium transition-all ${
                    isActive
                      ? 'bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 font-semibold'
                      : 'hover:bg-slate-50 dark:hover:bg-slate-800/60 text-slate-600 dark:text-slate-400'
                  }`}
                >
                  <div className="flex items-center space-x-2.5">
                    <Icon className="h-3.5 w-3.5 text-slate-400 dark:text-slate-500" />
                    <span>{item.label}</span>
                  </div>
                  {item.count > 0 && (
                    <span className="text-[10px] text-slate-400 dark:text-slate-500 font-mono">{item.count}</span>
                  )}
                </button>
              );
            })}
          </nav>
        </div>
      </div>

      {/* Stealth Guard Status */}
      {isEncryptionActive && (
        <div className="pt-4 border-t border-slate-100 dark:border-slate-800 space-y-3">
          <div className="flex items-center space-x-2">
            <button 
              onClick={() => logger.openLogDirectory()} 
              className="text-slate-400 hover:text-teal-600 dark:hover:text-teal-400 p-2 hover:bg-teal-50 dark:hover:bg-teal-950/60 rounded-lg shrink-0 transition-colors"
              title="Open Log Directory"
            >
              <FolderOpen className="h-4 w-4" />
            </button>
            <div className="bg-teal-50/80 dark:bg-teal-950/40 border border-teal-200/80 dark:border-teal-900/60 rounded-xl p-2.5 flex items-center space-x-2 text-xs text-teal-800 dark:text-teal-300 font-medium grow">
              <ShieldCheck className="h-4 w-4 text-teal-600 dark:text-teal-400 shrink-0" />
              <div className="text-[11px]">
                <span>Stealth Traffic: </span>
                <strong className="text-teal-900 dark:text-teal-200 font-bold">MSE/PE Encrypted</strong>
              </div>
            </div>
          </div>
        </div>
      )}
    </aside>
  );
};

