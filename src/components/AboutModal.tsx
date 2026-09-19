import React from 'react';
import { X, ExternalLink } from 'lucide-react';
import { isTauri } from '@tauri-apps/api/core';
import { openUrl } from '@tauri-apps/plugin-opener';

export const ZSoftwareLabsLogo: React.FC<{ className?: string }> = ({
  className = 'h-4 w-4',
}) => (
  <svg
    viewBox="0 0 1000 1000"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    className={className}
    style={{ display: 'inline-block', verticalAlign: 'middle' }}
    aria-label="Z Software Labs Logo"
  >
    {/* Top Red Slanted Bar */}
    <polygon points="248,198 908,198 756,404 96,404" fill="#D91424" />
    {/* Middle Yellow/Gold Slanted Bar */}
    <polygon points="372,426 732,426 628,574 268,574" fill="#FFC400" />
    {/* Bottom Blue Slanted Bar */}
    <polygon points="248,596 908,596 756,802 96,802" fill="#0038A8" />
  </svg>
);

interface AboutModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const AboutModal: React.FC<AboutModalProps> = ({
  isOpen,
  onClose,
}) => {
  if (!isOpen) return null;

  const handleOpenLicense = async (e: React.MouseEvent) => {
    e.preventDefault();
    const licenseUrl = 'https://opensource.org/licenses/MIT';
    if (isTauri()) {
      try {
        await openUrl(licenseUrl);
        return;
      } catch (err) {
        console.warn('[FlowDown] Could not open license with plugin-opener:', err);
      }
    }
    window.open(licenseUrl, '_blank', 'noopener,noreferrer');
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-[#181a20] dark:bg-[#181a20] border border-white/10 rounded-2xl w-full max-w-[360px] shadow-2xl animate-in fade-in zoom-in-95 duration-150 text-slate-200 flex flex-col items-center text-center p-5 relative select-none">
        {/* Header bar: Title on left, Close on right */}
        <div className="w-full flex items-center justify-between mb-4">
          <span className="text-xs font-semibold text-slate-300">About FlowDown</span>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* App Icon */}
        <div className="mb-3 flex items-center justify-center">
          <img
            src="/icon.png"
            alt="FlowDown App Icon"
            className="w-14 h-14 object-contain drop-shadow-md rounded-xl"
            onError={(e) => {
              const target = e.currentTarget;
              target.style.display = 'none';
            }}
          />
        </div>

        {/* App Title */}
        <h2 className="text-lg font-bold tracking-tight text-white">
          FlowDown
        </h2>

        {/* Version */}
        <div className="mt-0.5 flex items-center justify-center space-x-1.5 text-xs text-slate-400">
          <span>Version 1.0.8</span>
        </div>

        {/* Copyright notice with Z Software Labs Logo */}
        <div className="mt-2.5 flex flex-wrap items-center justify-center gap-1.5 text-[11px] text-slate-400">
          <span>Copyright © 2026</span>
          <ZSoftwareLabsLogo className="h-3 w-3 inline-block shrink-0" />
          <span className="text-slate-300">Z Software Labs.</span>
          <span>All rights reserved.</span>
        </div>

        {/* Description */}
        <p className="mt-3 text-[11.5px] leading-relaxed text-slate-300/90 max-w-[290px]">
          FlowDown is a lightweight, utility-driven desktop download manager designed for fast, effortless download workflows.
        </p>

        {/* License */}
        <p className="mt-2.5 text-[11px] text-slate-400">
          This application is licensed under{' '}
          <a
            href="https://opensource.org/licenses/MIT"
            onClick={handleOpenLicense}
            className="text-blue-400 hover:text-blue-300 hover:underline font-medium inline-flex items-center space-x-0.5 cursor-pointer"
          >
            <span>MIT</span>
            <ExternalLink className="h-2.5 w-2.5 inline ml-0.5 text-blue-400" />
          </a>
        </p>

        {/* License Box */}
        <div className="mt-3 w-full p-2.5 bg-[#121318] border border-white/5 rounded-xl text-[10.5px] leading-relaxed text-slate-400 text-left space-y-1.5 h-24 overflow-y-auto font-mono scrollbar-thin">
          <p>
            Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the &quot;Software&quot;), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:
          </p>
          <p>
            The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.
          </p>
          <p className="uppercase text-[9.5px] tracking-wide text-slate-500">
            THE SOFTWARE IS PROVIDED &quot;AS IS&quot;, WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.
          </p>
        </div>

        {/* Bottom OK Action Button */}
        <div className="mt-3.5 w-full flex justify-center">
          <button
            onClick={onClose}
            className="px-6 py-1.5 rounded-lg bg-[#272a34] hover:bg-[#323642] active:bg-[#20222a] border border-white/10 text-white font-medium text-xs transition-colors cursor-pointer shadow-xs"
          >
            OK
          </button>
        </div>
      </div>
    </div>
  );
};
