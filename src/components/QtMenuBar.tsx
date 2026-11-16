import React, { useState, useRef, useEffect } from 'react';
import { ChevronRight, Minus, Square, Copy, X } from 'lucide-react';

import { OsStyle } from '../types';

interface QtMenuBarProps {
  onOpenAddTorrent: () => void;
  onOpenAddUrl: () => void;
  onOpenCreateTorrent: () => void;
  onOpenLibqrbitSettings: () => void;
  onOpenScheduler: () => void;
  onOpenDiagnostic: () => void;
  onOpenAnalyzer: (initialTab?: 'p2p' | 'http') => void;
  onOpenAbout: () => void;
  onCheckUpdates?: () => void;
  onPauseAll: () => void;
  onResumeAll: () => void;
  onToggleTurtle: () => void;
  onToggleLibqrbit: () => void;
  onToggleTheme: () => void;
  theme: 'dark' | 'light';
  libqrbitActive: boolean;
  turtleActive: boolean;
  osStyle?: OsStyle;
  onOpenDownloadInfo?: () => void;
  hasSelectedTorrent?: boolean;
  onExit?: () => void;
  onSelectAll?: () => void;
  showSidebar?: boolean;
  onToggleSidebar?: () => void;
  showDetailTabs?: boolean;
  onToggleDetailTabs?: () => void;
  showStatusBar?: boolean;
  onToggleStatusBar?: () => void;
}

export const QtMenuBar: React.FC<QtMenuBarProps> = ({
  onOpenAddTorrent,
  onOpenAddUrl,
  onOpenCreateTorrent,
  onOpenLibqrbitSettings,
  onOpenScheduler,
  onOpenDiagnostic,
  onOpenAnalyzer,
  onOpenAbout,
  onCheckUpdates,
  onPauseAll,
  onResumeAll,
  onToggleTurtle,
  onToggleLibqrbit,
  onToggleTheme,
  theme,
  libqrbitActive,
  turtleActive,
  osStyle = 'windows',
  onOpenDownloadInfo,
  hasSelectedTorrent = false,
  onExit,
  onSelectAll,
  showSidebar = true,
  onToggleSidebar,
  showDetailTabs = true,
  onToggleDetailTabs,
  showStatusBar = true,
  onToggleStatusBar,
}) => {
  const [activeMenu, setActiveMenu] = useState<string | null>(null);
  const [submenuOpen, setSubmenuOpen] = useState<string | null>(null);
  const [isMaximized, setIsMaximized] = useState<boolean>(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const isTauriDesktop =
    typeof window !== 'undefined' &&
    ('__TAURI_INTERNALS__' in (window as any) || '__TAURI__' in (window as any));

  const handleMinimizeWindow = async () => {
    try {
      const { getCurrentWindow } = await import('@tauri-apps/api/window');
      await getCurrentWindow().minimize();
    } catch {
      // Browser preview fallback
    }
  };

  const handleToggleMaximizeWindow = async () => {
    try {
      const { getCurrentWindow } = await import('@tauri-apps/api/window');
      const win = getCurrentWindow();
      await win.toggleMaximize();
      const maxState = await win.isMaximized();
      setIsMaximized(maxState);
      return;
    } catch {
      // Browser fullscreen fallback
    }
    setIsMaximized((prev) => !prev);
    try {
      if (!document.fullscreenElement) {
        await document.documentElement.requestFullscreen();
      } else {
        await document.exitFullscreen();
      }
    } catch {
      // Ignore if fullscreen is blocked
    }
  };

  const handleCloseWindow = () => {
    onExit?.();
  };

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setActiveMenu(null);
        setSubmenuOpen(null);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleMenuClick = (menuName: string) => {
    setActiveMenu(activeMenu === menuName ? null : menuName);
    setSubmenuOpen(null);
  };

  const handleAction = (callback: () => void) => {
    setActiveMenu(null);
    setSubmenuOpen(null);
    callback();
  };

  return (
    <div
      ref={menuRef}
      data-tauri-drag-region
      className="relative h-7 bg-[var(--os-bg-menubar)] border-b border-[var(--os-border)] text-[var(--os-text)] text-xs flex items-center px-1.5 select-none z-50 font-normal transition-colors"
    >
      {/* macOS Traffic Lights on Left Side of Main UI */}
      {osStyle === 'macos' && (
        <div className="flex items-center gap-1.5 pl-1 pr-2.5 shrink-0">
          <button
            type="button"
            onClick={handleCloseWindow}
            title="Close Window"
            aria-label="Close Window"
            className="group w-3 h-3 rounded-full bg-[#ff5f57] hover:bg-[#ff4b42] border border-[#e0443e] flex items-center justify-center shadow-2xs transition-colors"
          >
            <X className="w-2 h-2 text-[#4d0000] opacity-0 group-hover:opacity-100 stroke-[2.8]" />
          </button>
          <button
            type="button"
            onClick={handleMinimizeWindow}
            title="Minimize Window"
            aria-label="Minimize Window"
            className="group w-3 h-3 rounded-full bg-[#febc2e] hover:bg-[#f5b016] border border-[#dfa123] flex items-center justify-center shadow-2xs transition-colors"
          >
            <Minus className="w-2 h-2 text-[#5a3900] opacity-0 group-hover:opacity-100 stroke-[2.8]" />
          </button>
          <button
            type="button"
            onClick={handleToggleMaximizeWindow}
            title={isMaximized ? 'Restore Window' : 'Maximize Window'}
            aria-label={isMaximized ? 'Restore Window' : 'Maximize Window'}
            className="group w-3 h-3 rounded-full bg-[#28c840] hover:bg-[#1db934] border border-[#1aab29] flex items-center justify-center shadow-2xs transition-colors"
          >
            <Square className="w-1.5 h-1.5 text-[#003d00] opacity-0 group-hover:opacity-100 stroke-[2.8]" />
          </button>
        </div>
      )}

      {/* File Menu */}
      <div className="relative">
        <button
          onClick={() => handleMenuClick('file')}
          className={`px-2 py-0.5 rounded text-[11px] hover:bg-[var(--os-bg-hover)] transition-colors ${
            activeMenu === 'file' ? 'bg-[var(--os-accent)] text-white' : ''
          }`}
        >
          File
        </button>
        {activeMenu === 'file' && (
          <div className="absolute top-full left-0 mt-0.5 w-60 bg-[var(--os-bg-content)] border border-[var(--os-border)] rounded shadow-xl py-1 text-[11px] text-[var(--os-text)] z-50">
            <button
              onClick={() => handleAction(onOpenAddTorrent)}
              className="w-full flex items-center justify-between px-3 py-1.5 hover:bg-[var(--os-accent)] hover:text-white text-left transition-colors"
            >
              <span>Add Torrent / Magnet Link...</span>
              <span className="text-[10px] text-[var(--os-text-muted)] font-mono">Ctrl+O</span>
            </button>
            <button
              onClick={() => handleAction(onOpenAddUrl)}
              className="w-full flex items-center justify-between px-3 py-1.5 hover:bg-[var(--os-accent)] hover:text-white text-left transition-colors"
            >
              <span>Add HTTP / Direct Download (IDM)...</span>
            </button>
            <div className="my-1 border-t border-[var(--os-border-subtle)]" />
            <button
              onClick={() => handleAction(onOpenCreateTorrent)}
              className="w-full flex items-center justify-between px-3 py-1.5 hover:bg-[var(--os-accent)] hover:text-white text-left transition-colors"
            >
              <span>Torrent Creator...</span>
            </button>
            <div className="my-1 border-t border-[var(--os-border-subtle)]" />
            <button
              onClick={() => {
                setActiveMenu(null);
                onExit?.();
              }}
              className="w-full flex items-center justify-between px-3 py-1.5 hover:bg-rose-600 hover:text-white text-left transition-colors"
            >
              <span>Exit FlowDown</span>
            </button>
          </div>
        )}
      </div>

      {/* Edit Menu */}
      <div className="relative">
        <button
          onClick={() => handleMenuClick('edit')}
          className={`px-2 py-0.5 rounded text-[11px] hover:bg-[var(--os-bg-hover)] transition-colors ${
            activeMenu === 'edit' ? 'bg-[var(--os-accent)] text-white' : ''
          }`}
        >
          Edit
        </button>
        {activeMenu === 'edit' && (
          <div className="absolute top-full left-0 mt-0.5 w-52 bg-[var(--os-bg-content)] border border-[var(--os-border)] rounded shadow-xl py-1 text-[11px] text-[var(--os-text)] z-50">
            <button
              onClick={() => handleAction(onResumeAll)}
              className="w-full flex items-center justify-between px-3 py-1.5 hover:bg-[var(--os-accent)] hover:text-white text-left transition-colors"
            >
              <span>Resume All Transfers</span>
            </button>
            <button
              onClick={() => handleAction(onPauseAll)}
              className="w-full flex items-center justify-between px-3 py-1.5 hover:bg-[var(--os-accent)] hover:text-white text-left transition-colors"
            >
              <span>Pause All Transfers</span>
            </button>
            <div className="my-1 border-t border-[var(--os-border-subtle)]" />
            <button
              onClick={() => {
                if (onOpenDownloadInfo) handleAction(onOpenDownloadInfo);
              }}
              disabled={!hasSelectedTorrent}
              className="w-full flex items-center justify-between px-3 py-1.5 hover:bg-[var(--os-accent)] hover:text-white disabled:opacity-35 disabled:hover:bg-transparent disabled:hover:text-inherit text-left transition-colors"
            >
              <span>Download Info (Properties)...</span>
            </button>
            <div className="my-1 border-t border-[var(--os-border-subtle)]" />
            <button
              onClick={() => handleAction(() => onSelectAll?.())}
              className="w-full flex items-center justify-between px-3 py-1.5 hover:bg-[var(--os-accent)] hover:text-white text-left transition-colors"
            >
              <span>Select All</span>
            </button>
          </div>
        )}
      </div>

      {/* View Menu */}
      <div className="relative">
        <button
          onClick={() => handleMenuClick('view')}
          className={`px-2 py-0.5 rounded text-[11px] hover:bg-[var(--os-bg-hover)] transition-colors ${
            activeMenu === 'view' ? 'bg-[var(--os-accent)] text-white' : ''
          }`}
        >
          View
        </button>
        {activeMenu === 'view' && (
          <div className="absolute top-full left-0 mt-0.5 w-60 bg-[var(--os-bg-content)] border border-[var(--os-border)] rounded shadow-xl py-1 text-[11px] text-[var(--os-text)] z-50">
            <div className="px-3 py-1 text-[10px] uppercase font-semibold text-[var(--os-accent)] tracking-wider">
              Color Scheme
            </div>
            <button
              onClick={() => handleAction(onToggleTheme)}
              className="w-full flex items-center justify-between px-3 py-1.5 hover:bg-[var(--os-accent)] hover:text-white text-left transition-colors"
            >
              <span>{theme === 'dark' ? 'Switch to Light Mode' : 'Switch to Dark Mode'}</span>
            </button>
            <div className="my-1 border-t border-[var(--os-border-subtle)]" />
            <div className="px-3 py-1 text-[10px] uppercase font-semibold text-[var(--os-text-muted)] tracking-wider">
              Panes & Toolbars
            </div>
            <button
              onClick={() => handleAction(() => onToggleSidebar?.())}
              className="w-full flex items-center justify-between px-3 py-1.5 hover:bg-[var(--os-accent)] hover:text-white text-left transition-colors group"
            >
              <span>Sidebar Categories</span>
              {showSidebar && <span className="text-[var(--os-accent)] group-hover:text-white font-bold">✓</span>}
            </button>
            <button
              onClick={() => handleAction(() => onToggleDetailTabs?.())}
              className="w-full flex items-center justify-between px-3 py-1.5 hover:bg-[var(--os-accent)] hover:text-white text-left transition-colors group"
            >
              <span>Bottom Detail Tabs</span>
              {showDetailTabs && <span className="text-[var(--os-accent)] group-hover:text-white font-bold">✓</span>}
            </button>
            <button
              onClick={() => handleAction(() => onToggleStatusBar?.())}
              className="w-full flex items-center justify-between px-3 py-1.5 hover:bg-[var(--os-accent)] hover:text-white text-left transition-colors group"
            >
              <span>Status Bar</span>
              {showStatusBar && <span className="text-[var(--os-accent)] group-hover:text-white font-bold">✓</span>}
            </button>
          </div>
        )}
      </div>

      {/* Tools Menu (with cascading libqrbit Stealth submenu) */}
      <div className="relative">
        <button
          onClick={() => handleMenuClick('tools')}
          className={`px-2 py-0.5 rounded text-[11px] hover:bg-[var(--os-bg-hover)] transition-colors ${
            activeMenu === 'tools' ? 'bg-[var(--os-accent)] text-white' : ''
          }`}
        >
          Tools
        </button>
        {activeMenu === 'tools' && (
          <div className="absolute top-full left-0 mt-0.5 w-64 bg-[var(--os-bg-content)] border border-[var(--os-border)] rounded shadow-xl py-1 text-[11px] text-[var(--os-text)] z-50">
            {/* Cascading libqrbit Stealth Submenu */}
            <div
              className="relative group"
              onMouseEnter={() => setSubmenuOpen('libqrbit')}
              onMouseLeave={() => setSubmenuOpen(null)}
            >
              <button
                type="button"
                onClick={() => setSubmenuOpen(submenuOpen === 'libqrbit' ? null : 'libqrbit')}
                className={`w-full flex items-center justify-between px-3 py-1.5 hover:bg-[var(--os-accent)] hover:text-white text-left transition-colors ${
                  submenuOpen === 'libqrbit' ? 'bg-[var(--os-accent)] text-white' : ''
                }`}
              >
                <span className="font-semibold">libqrbit Stealth Suite</span>
                <ChevronRight className="w-3 h-3 text-[var(--os-text-muted)] group-hover:text-white" />
              </button>

              {/* Cascading Submenu Flyout */}
              {submenuOpen === 'libqrbit' && (
                <div className="absolute top-0 left-full -ml-0.5 w-60 bg-[var(--os-bg-content)] border border-[var(--os-border)] rounded shadow-2xl py-1 text-[11px] text-[var(--os-text)] z-50 animate-in fade-in duration-150">
                  {/* Analyze Feature */}
                  <button
                    onClick={() => handleAction(() => onOpenAnalyzer('p2p'))}
                    className="w-full flex items-center justify-between px-3 py-1.5 bg-[var(--os-bg-selected-soft)] text-[var(--os-text-selected-soft)] hover:bg-[var(--os-accent)] hover:text-white text-left transition-colors"
                  >
                    <span className="font-semibold">Analyze Best Evasion Settings...</span>
                  </button>

                  <button
                    onClick={() => handleAction(onToggleLibqrbit)}
                    className="w-full flex items-center justify-between px-3 py-1.5 hover:bg-[var(--os-accent)] hover:text-white text-left transition-colors group"
                  >
                    <span>Packet Morphing Shield</span>
                    {libqrbitActive && <span className="text-[var(--os-accent)] group-hover:text-white font-bold">✓</span>}
                  </button>

                  <button
                    onClick={() => handleAction(onOpenDiagnostic)}
                    className="w-full flex items-center justify-between px-3 py-1.5 hover:bg-[var(--os-accent)] hover:text-white text-left transition-colors"
                  >
                    <span>Run Throttling Diagnostic...</span>
                  </button>
                </div>
              )}
            </div>

            <div className="my-1 border-t border-[var(--os-border-subtle)]" />

            <button
              onClick={() => handleAction(() => onOpenAnalyzer('http'))}
              className="w-full flex items-center justify-between px-3 py-1.5 hover:bg-[var(--os-accent)] hover:text-white text-left transition-colors"
            >
              <span>HTTP Multi-Part Acceleration Analyzer...</span>
            </button>

            <button
              onClick={() => handleAction(onToggleTurtle)}
              className="w-full flex items-center justify-between px-3 py-1.5 hover:bg-[var(--os-accent)] hover:text-white text-left transition-colors group"
            >
              <span>Alternative Speed Limits (Turtle)</span>
              {turtleActive && <span className="text-[var(--os-accent)] group-hover:text-white font-bold">✓</span>}
            </button>

            <button
              onClick={() => handleAction(onOpenScheduler)}
              className="w-full flex items-center justify-between px-3 py-1.5 hover:bg-[var(--os-accent)] hover:text-white text-left transition-colors"
            >
              <span>Bandwidth Scheduler Grid...</span>
            </button>

            <div className="my-1 border-t border-[var(--os-border-subtle)]" />

            <button
              onClick={() => handleAction(onOpenLibqrbitSettings)}
              className="w-full flex items-center justify-between px-3 py-1.5 hover:bg-[var(--os-accent)] hover:text-white text-left transition-colors"
            >
              <span>Preferences...</span>
            </button>
          </div>
        )}
      </div>

      {/* Help Menu */}
      <div className="relative">
        <button
          onClick={() => handleMenuClick('help')}
          className={`px-2 py-0.5 rounded text-[11px] hover:bg-[var(--os-bg-hover)] transition-colors ${
            activeMenu === 'help' ? 'bg-[var(--os-accent)] text-white' : ''
          }`}
        >
          Help
        </button>
        {activeMenu === 'help' && (
          <div className="absolute top-full left-0 mt-0.5 w-52 bg-[var(--os-bg-content)] border border-[var(--os-border)] rounded shadow-xl py-1 text-[11px] text-[var(--os-text)] z-50">
            <button
              onClick={() => handleAction(onOpenAbout)}
              className="w-full flex items-center justify-between px-3 py-1.5 hover:bg-[var(--os-accent)] hover:text-white text-left transition-colors"
            >
              <span>About FlowDown</span>
            </button>
            <div className="h-px bg-[var(--os-border-subtle)] my-1" />
            <button
              onClick={() => handleAction(() => onCheckUpdates ? onCheckUpdates() : onOpenLibqrbitSettings())}
              className="w-full flex items-center justify-between px-3 py-1.5 hover:bg-[var(--os-accent)] hover:text-white text-left transition-colors"
            >
              <span>Check for Updates...</span>
            </button>
          </div>
        )}
      </div>

      {/* Drag spacer */}
      <div className="flex-1 h-full" data-tauri-drag-region />

      {/* Linux & Windows Right-Side Main UI Window Controls (Minimize, Maximize/Restore, Close) */}
      {(osStyle === 'linux' || (osStyle === 'windows' && !isTauriDesktop)) && (
        <div className="flex items-center gap-0.5 shrink-0">
          <button
            type="button"
            onClick={handleMinimizeWindow}
            title="Minimize"
            aria-label="Minimize"
            className={
              osStyle === 'linux'
                ? 'w-5 h-5 rounded-full flex items-center justify-center text-[var(--os-text-muted)] hover:bg-[var(--os-bg-hover)] hover:text-[var(--os-text)] transition-colors'
                : 'w-7 h-6 flex items-center justify-center text-[var(--os-text-muted)] hover:bg-[var(--os-bg-hover)] hover:text-[var(--os-text)] transition-colors'
            }
          >
            <Minus className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={handleToggleMaximizeWindow}
            title={isMaximized ? 'Restore' : 'Maximize'}
            aria-label={isMaximized ? 'Restore' : 'Maximize'}
            className={
              osStyle === 'linux'
                ? 'w-5 h-5 rounded-full flex items-center justify-center text-[var(--os-text-muted)] hover:bg-[var(--os-bg-hover)] hover:text-[var(--os-text)] transition-colors'
                : 'w-7 h-6 flex items-center justify-center text-[var(--os-text-muted)] hover:bg-[var(--os-bg-hover)] hover:text-[var(--os-text)] transition-colors'
            }
          >
            {isMaximized ? <Copy className="w-3 h-3" /> : <Square className="w-3 h-3" />}
          </button>
          <button
            type="button"
            onClick={handleCloseWindow}
            title="Close"
            aria-label="Close"
            className={
              osStyle === 'linux'
                ? 'w-5 h-5 rounded-full flex items-center justify-center text-[var(--os-text-muted)] hover:bg-rose-600 hover:text-white transition-colors'
                : 'w-8 h-6 flex items-center justify-center text-[var(--os-text-muted)] hover:bg-rose-600 hover:text-white transition-colors'
            }
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
    </div>
  );
};
