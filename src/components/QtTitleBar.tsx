import React, { useState } from 'react';
import { OsStyle } from '../types';

interface QtTitleBarProps {
  osStyle: OsStyle;
  isMaximized?: boolean;
  onToggleMaximize?: () => void;
  onMinimize?: () => void;
  onClose?: () => void;
  // Optional for compatibility
  theme?: 'dark' | 'light';
  onToggleTheme?: () => void;
  totalDownSpeed?: number;
  totalUpSpeed?: number;
  libqrbitActive?: boolean;
  isThrottlingActive?: boolean;
  onOpenDiagnostic?: () => void;
  onOpenAnalyzer?: () => void;
  onSetOsStyle?: (style: OsStyle) => void;
}

export const QtTitleBar: React.FC<QtTitleBarProps> = ({
  osStyle,
  isMaximized = false,
  onToggleMaximize,
  onMinimize,
  onClose,
  theme = 'dark',
}) => {
  const [trafficHover, setTrafficHover] = useState(false);

  // Standard OS Title Bar surface driven by CSS OS palette variables
  const getTitlebarBg = () => {
    return 'bg-[var(--os-bg-titlebar)] border-b border-[var(--os-border)] text-[var(--os-text)]';
  };

  return (
    <div
      onDoubleClick={onToggleMaximize}
      className={`h-8 px-2 flex items-center justify-between select-none text-xs font-medium tracking-tight transition-colors relative z-40 ${getTitlebarBg()}`}
    >
      {/* ========================================================= */}
      {/* LEFT SECTION                                              */}
      {/* If macOS: Traffic Lights are on the LEFT                  */}
      {/* If Windows/Linux: App Icon + Clean Title on the LEFT      */}
      {/* ========================================================= */}
      <div className="flex items-center gap-2 overflow-hidden min-w-0">
        {osStyle === 'macos' ? (
          /* macOS Traffic Lights Controls (Red, Yellow, Green) */
          <div
            className="flex items-center gap-2 pr-2 py-1"
            onMouseEnter={() => setTrafficHover(true)}
            onMouseLeave={() => setTrafficHover(false)}
          >
            {/* Close Button (Red) */}
            <button
              type="button"
              onClick={onClose}
              title="Close window (Cmd+W)"
              className="w-3 h-3 rounded-full bg-[#ff5f56] border border-[#e0443e] hover:brightness-95 active:brightness-90 flex items-center justify-center transition-all shadow-xs shrink-0"
            >
              {trafficHover && (
                <svg className="w-1.5 h-1.5 text-[#4c0000] stroke-current" viewBox="0 0 6 6" fill="none" strokeWidth="1.2" strokeLinecap="round">
                  <line x1="1" y1="1" x2="5" y2="5" />
                  <line x1="5" y1="1" x2="1" y2="5" />
                </svg>
              )}
            </button>

            {/* Minimize Button (Yellow) */}
            <button
              type="button"
              onClick={onMinimize}
              title="Minimize window (Cmd+M)"
              className="w-3 h-3 rounded-full bg-[#ffbd2e] border border-[#dea123] hover:brightness-95 active:brightness-90 flex items-center justify-center transition-all shadow-xs shrink-0"
            >
              {trafficHover && (
                <svg className="w-1.5 h-1.5 text-[#593900] stroke-current" viewBox="0 0 6 6" fill="none" strokeWidth="1.2" strokeLinecap="round">
                  <line x1="1" y1="3" x2="5" y2="3" />
                </svg>
              )}
            </button>

            {/* Maximize / Zoom Button (Green) */}
            <button
              type="button"
              onClick={onToggleMaximize}
              title={isMaximized ? "Restore window" : "Zoom / Fullscreen (Cmd+Ctrl+F)"}
              className="w-3 h-3 rounded-full bg-[#27c93f] border border-[#1aab29] hover:brightness-95 active:brightness-90 flex items-center justify-center transition-all shadow-xs shrink-0"
            >
              {trafficHover && (
                <svg className="w-1.5 h-1.5 text-[#003800] fill-current" viewBox="0 0 6 6">
                  <path d="M1 1 L3 1 L1 3 Z M5 5 L3 5 L5 3 Z" />
                </svg>
              )}
            </button>
          </div>
        ) : (
          /* Windows / Linux Brand Icon */
          <img
            src="/assets/aistudio/2_b40fbc92.png"
            alt="FlowDown"
            className="w-4 h-4 rounded object-cover shadow-xs shrink-0"
          />
        )}

        {/* Clean Application Title Only */}
        <span className="font-semibold text-[11px] truncate text-[var(--os-text)] flex items-center gap-1.5">
          {osStyle === 'macos' && (
            <img
              src="/assets/aistudio/2_b40fbc92.png"
              alt="FlowDown"
              className="w-3.5 h-3.5 rounded object-cover shrink-0"
            />
          )}
          <span>FlowDown 2.0.5</span>
        </span>
      </div>

      {/* ========================================================= */}
      {/* RIGHT SECTION: Native Min, Max/Restore & Close Buttons     */}
      {/* ========================================================= */}
      <div className="flex items-center h-full">
        {/* Windows Flush Window Controls */}
        {osStyle === 'windows' && (
          <div className="flex items-center -mr-2 h-full text-[var(--os-text)]">
            {/* Windows Minimize */}
            <button
              type="button"
              onClick={onMinimize}
              title="Minimize (Win+Down)"
              className="w-11 h-8 flex items-center justify-center hover:bg-black/10 dark:hover:bg-white/10 active:bg-black/20 dark:active:bg-white/20 transition-colors"
            >
              <div className="w-2.5 h-[1.2px] bg-current" />
            </button>

            {/* Windows Maximize / Restore (Fully vibrant, not grayed out) */}
            <button
              type="button"
              onClick={onToggleMaximize}
              title={isMaximized ? "Restore Window (Win+Down)" : "Maximize Window (Win+Up)"}
              className="w-11 h-8 flex items-center justify-center hover:bg-black/10 dark:hover:bg-white/10 active:bg-black/20 dark:active:bg-white/20 transition-colors"
            >
              {isMaximized ? (
                /* Windows 11 Restore Icon (two overlapping squares) */
                <svg className="w-2.5 h-2.5 stroke-current" viewBox="0 0 10 10" fill="none" strokeWidth="1.2">
                  <path d="M2.5 1.5 L8.5 1.5 L8.5 7.5 L7.5 7.5 L7.5 2.5 L2.5 2.5 Z" />
                  <rect x="1.5" y="3.5" width="6" height="5" />
                </svg>
              ) : (
                /* Windows 11 Single Maximize Square (Crisp 1.2px stroke, solid color) */
                <svg className="w-2.5 h-2.5 stroke-current" viewBox="0 0 10 10" fill="none" strokeWidth="1.2">
                  <rect x="1" y="1" width="8" height="8" />
                </svg>
              )}
            </button>

            {/* Windows Close (Red on hover) */}
            <button
              type="button"
              onClick={onClose}
              title="Close (Alt+F4)"
              className="w-11 h-8 flex items-center justify-center hover:bg-[#e81123] hover:text-white active:bg-[#c4101f] transition-colors"
            >
              <svg className="w-2.5 h-2.5 stroke-current" viewBox="0 0 10 10" strokeWidth="1.2" strokeLinecap="round">
                <line x1="1" y1="1" x2="9" y2="9" />
                <line x1="9" y1="1" x2="1" y2="9" />
              </svg>
            </button>
          </div>
        )}

        {/* Linux KDE Breeze Style Buttons */}
        {osStyle === 'linux' && (
          <div className="flex items-center gap-1 text-neutral-800 dark:text-neutral-100">
            {/* KDE Minimize */}
            <button
              type="button"
              onClick={onMinimize}
              title="Minimize Window"
              className="w-6 h-6 rounded-full hover:bg-black/10 dark:hover:bg-white/10 active:bg-black/20 flex items-center justify-center transition-colors"
            >
              <div className="w-2.5 h-[1.2px] bg-current" />
            </button>

            {/* KDE Maximize / Restore (Fully vibrant, not grayed out) */}
            <button
              type="button"
              onClick={onToggleMaximize}
              title={isMaximized ? "Restore Window" : "Maximize Window"}
              className="w-6 h-6 rounded-full hover:bg-black/10 dark:hover:bg-white/10 active:bg-black/20 flex items-center justify-center transition-colors"
            >
              {isMaximized ? (
                <svg className="w-2.5 h-2.5 stroke-current" viewBox="0 0 10 10" fill="none" strokeWidth="1.2">
                  <path d="M3 1 L9 1 L9 7 L7 7 L7 3 L3 3 Z" />
                  <rect x="1" y="3" width="6" height="6" />
                </svg>
              ) : (
                <svg className="w-2.5 h-2.5 stroke-current" viewBox="0 0 10 10" fill="none" strokeWidth="1.2">
                  <rect x="1" y="1" width="8" height="8" rx="0.5" />
                </svg>
              )}
            </button>

            {/* KDE Close (Circular Red Hover) */}
            <button
              type="button"
              onClick={onClose}
              title="Close Window (Ctrl+Q)"
              className="w-6 h-6 rounded-full hover:bg-rose-600 hover:text-white active:bg-rose-700 flex items-center justify-center transition-colors"
            >
              <svg className="w-2.5 h-2.5 stroke-current" viewBox="0 0 8 8" strokeWidth="1.3" strokeLinecap="round">
                <line x1="1" y1="1" x2="7" y2="7" />
                <line x1="7" y1="1" x2="1" y2="7" />
              </svg>
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
