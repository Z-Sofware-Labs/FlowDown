import React from 'react';
import { 
  Download, 
  Plus, 
  PauseCircle, 
  PlayCircle, 
  Trash2, 
  Settings as SettingsIcon, 
  Info,
  ArrowDownCircle, 
  Zap, 
  Gauge, 
  Sun, 
  Moon, 
  Laptop, 
  ShieldCheck, 
  Radio,
  Sparkles
} from 'lucide-react';
import { formatSpeed } from '../utils/formatters';

interface HeaderProps {
  totalSpeed: number;
  activeCount: number;
  totalDownloadedToday: number;
  onOpenAddModal: () => void;
  onPauseAll: () => void;
  onResumeAll: () => void;
  onClearCompleted: () => void;
  onOpenSettings: () => void;
  onOpenAbout: () => void;
  onOpenUpdates?: () => void;
  hasUpdateAvailable?: boolean;
  globalSpeedLimit: number; // 0 = unlimited
  onSetGlobalSpeedLimit: (limit: number) => void;
  theme: 'light' | 'dark' | 'system';
  onToggleTheme: () => void;
  isStealthActive?: boolean;
}

export const Header: React.FC<HeaderProps> = ({
  totalSpeed,
  activeCount,
  onOpenAddModal,
  onPauseAll,
  onResumeAll,
  onClearCompleted,
  onOpenSettings,
  onOpenAbout,
  onOpenUpdates,
  hasUpdateAvailable = false,
  globalSpeedLimit,
  onSetGlobalSpeedLimit,
  theme,
  onToggleTheme,
  isStealthActive = true,
}) => {
  return (
    <header className="bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 text-slate-800 dark:text-slate-100 px-4 lg:px-6 py-2.5 sticky top-0 z-20 shadow-xs transition-colors duration-200">
      <div className="flex flex-row flex-wrap md:flex-nowrap items-center justify-between gap-3">

        {/* Live Bandwidth & Speed Stats Pill */}
        <div className="flex items-center space-x-3 bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700/80 px-3.5 py-1.5 rounded-xl">
          <div className="flex items-center space-x-2 border-r border-slate-200 dark:border-slate-700 pr-3">
            <ArrowDownCircle className={`h-4 w-4 ${totalSpeed > 0 ? 'text-blue-600 dark:text-blue-400 animate-bounce' : 'text-slate-400'}`} />
            <div>
              <div className="text-[10px] uppercase text-slate-400 dark:text-slate-400 font-semibold">Speed</div>
              <div className="text-xs font-mono font-bold text-slate-900 dark:text-white">
                {formatSpeed(totalSpeed)}
              </div>
            </div>
          </div>

          <div className="flex items-center space-x-2 border-r border-slate-200 dark:border-slate-700 pr-3">
            <Zap className="h-4 w-4 text-amber-500" />
            <div>
              <div className="text-[10px] uppercase text-slate-400 dark:text-slate-400 font-semibold">Active</div>
              <div className="text-xs font-mono font-bold text-slate-800 dark:text-slate-200">
                {activeCount} active
              </div>
            </div>
          </div>

          <div className="flex items-center space-x-2">
            <Gauge className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
            <div>
              <div className="text-[10px] uppercase text-slate-400 dark:text-slate-400 font-semibold">Speed Limit</div>
              <select
                value={globalSpeedLimit}
                onChange={(e) => onSetGlobalSpeedLimit(Number(e.target.value))}
                className="bg-transparent text-xs font-mono font-semibold text-slate-700 dark:text-slate-200 focus:outline-none cursor-pointer"
              >
                <option value={0} className="bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100">Unlimited</option>
                <option value={2000000} className="bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100">2 MB/s</option>
                <option value={5000000} className="bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100">5 MB/s</option>
                <option value={10000000} className="bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100">10 MB/s</option>
                <option value={25000000} className="bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100">25 MB/s</option>
              </select>
            </div>
          </div>
        </div>

        {/* Global Control Buttons */}
        <div className="flex items-center space-x-2 md:flex-1 md:justify-end">
          <button
            onClick={onOpenAddModal}
            className="p-2 bg-blue-600 hover:bg-blue-700 dark:bg-blue-600 dark:hover:bg-blue-500 text-white rounded-full transition-colors shadow-xs active:scale-95 cursor-pointer"
            title="New Transfer (Add URL or Magnet Link)"
          >
            <Plus className="h-4 w-4" />
          </button>

          {/* Theme Quick Toggle Button */}
          <button
            onClick={onToggleTheme}
            className="p-2 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:text-blue-600 dark:hover:text-blue-400 hover:bg-slate-50 dark:hover:bg-slate-800 rounded-full transition-colors cursor-pointer"
            title={`Theme: ${theme.toUpperCase()} (Click to toggle)`}
          >
            {theme === 'dark' ? (
              <Moon className="h-4 w-4 text-indigo-400" />
            ) : theme === 'light' ? (
              <Sun className="h-4 w-4 text-amber-500" />
            ) : (
              <Laptop className="h-4 w-4 text-blue-500" />
            )}
          </button>

          <button
            onClick={onPauseAll}
            className="p-2 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:text-amber-600 hover:bg-slate-50 dark:hover:bg-slate-800 rounded-full transition-colors cursor-pointer"
            title="Pause All Downloads"
          >
            <PauseCircle className="h-4 w-4" />
          </button>

          <button
            onClick={onResumeAll}
            className="p-2 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:text-emerald-600 hover:bg-slate-50 dark:hover:bg-slate-800 rounded-full transition-colors cursor-pointer"
            title="Resume All Downloads"
          >
            <PlayCircle className="h-4 w-4" />
          </button>

          <button
            onClick={onClearCompleted}
            className="p-2 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:text-rose-600 hover:bg-slate-50 dark:hover:bg-slate-800 rounded-full transition-colors cursor-pointer"
            title="Clear Finished Items"
          >
            <Trash2 className="h-4 w-4" />
          </button>

          {onOpenUpdates && (
            <button
              onClick={onOpenUpdates}
              className={`p-2 border rounded-full transition-all relative cursor-pointer ${
                hasUpdateAvailable
                  ? 'border-blue-500 bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400 hover:bg-blue-100 shadow-xs'
                  : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:text-blue-600 dark:hover:text-blue-400 hover:bg-slate-50 dark:hover:bg-slate-800'
              }`}
              title={hasUpdateAvailable ? 'New Update Available on GitHub!' : 'Check for Updates'}
            >
              <Sparkles className="h-4 w-4" />
              {hasUpdateAvailable && (
                <span className="absolute -top-0.5 -right-0.5 flex h-2.5 w-2.5">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-blue-600"></span>
                </span>
              )}
            </button>
          )}

          <button
            onClick={onOpenSettings}
            className="p-2 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white hover:bg-slate-50 dark:hover:bg-slate-800 rounded-full transition-colors cursor-pointer"
            title="Manager Settings"
          >
            <SettingsIcon className="h-4 w-4" />
          </button>

          <button
            onClick={onOpenAbout}
            className="p-2 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:text-blue-600 dark:hover:text-blue-400 hover:bg-slate-50 dark:hover:bg-slate-800 rounded-full transition-colors cursor-pointer"
            title="About FlowDown"
          >
            <Info className="h-4 w-4" />
          </button>
        </div>
      </div>
    </header>
  );
};

