import React from 'react';
import { ExternalLink } from 'lucide-react';
import { SubwindowHeader } from './SubwindowHeader';

interface AboutModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const MIT_LICENSE_TEXT = `Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.`;

export const AboutModal: React.FC<AboutModalProps> = ({ isOpen, onClose }) => {
  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 bg-black/40 dark:bg-black/55 backdrop-blur-xs flex items-center justify-center z-50 p-4 select-none"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="about-flowdown-title"
        className="w-[364px] h-[475px] max-w-full max-h-[calc(100vh-2rem)] bg-[var(--os-bg-window)] border border-[var(--os-border)] rounded-[11px] shadow-[0_20px_50px_rgba(0,0,0,0.22)] dark:shadow-[0_20px_50px_rgba(0,0,0,0.65)] flex flex-col overflow-hidden text-[var(--os-text)] font-sans"
      >
        {/* Top bar */}
        <SubwindowHeader title="About FlowDown" onClose={onClose} />

        {/* Body */}
        <div className="flex-1 min-h-0 px-6 pt-2.5 pb-5 flex flex-col items-center text-center">
          {/* App Icon */}
          <div className="mb-3 shrink-0">
            <img
              src="/assets/aistudio/2_b40fbc92.png"
              alt="FlowDown icon"
              className="w-[54px] h-[54px] rounded-[12px] shadow-[0_4px_12px_rgba(0,0,0,0.2)] dark:shadow-[0_4px_12px_rgba(0,0,0,0.45)] object-cover"
            />
          </div>

          {/* App Name & Version */}
          <h2 className="text-[18px] font-bold text-[var(--os-text)] tracking-[-0.015em] leading-tight shrink-0">
            FlowDown
          </h2>
          <p className="mt-0.5 text-[12px] font-medium text-[var(--os-text-muted)] shrink-0">
            Version 2.0.2
          </p>

          {/* Copyright + Publisher Emblem */}
          <div className="mt-3 flex items-center justify-center whitespace-nowrap text-[11px] leading-none shrink-0">
            <span className="text-[var(--os-text-muted)]">Copyright © 2026</span>
            <img
              src="/assets/aistudio/Z_Software_Labs_69db8091.png"
              alt="Z Software Labs"
              className="w-3.5 h-3.5 mx-1.5 inline-block object-contain shrink-0"
            />
            <span className="text-[var(--os-text)] font-medium">Z Software Labs.</span>
            <span className="ml-1 text-[var(--os-text-muted)]">All rights reserved.</span>
          </div>

          {/* Description */}
          <p className="mt-3.5 px-1 text-[11.5px] leading-[1.48] text-[var(--os-text)] opacity-85 shrink-0">
            FlowDown is a lightweight, utility-driven desktop download manager designed for fast, effortless download workflows.
          </p>

          {/* License Line */}
          <p className="mt-3.5 mb-2.5 text-[11px] text-[var(--os-text-muted)] flex items-center justify-center gap-1 shrink-0">
            <span>This application is licensed under</span>
            <a
              href="https://opensource.org/licenses/MIT"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-[var(--os-accent)] hover:text-[var(--os-accent-hover)] hover:underline font-medium"
            >
              <span>MIT</span>
              <ExternalLink className="w-2.5 h-2.5" />
            </a>
          </p>

          {/* Scrollable License Box */}
          <div className="flex-1 min-h-0 w-full rounded-[6px] bg-[var(--os-bg-content)] border border-[var(--os-border)] overflow-y-auto px-2.5 py-2 text-left font-mono text-[10.5px] leading-[1.52] text-[var(--os-text)] opacity-90 select-text whitespace-pre-wrap">
            {MIT_LICENSE_TEXT}
          </div>

          {/* OK Button */}
          <div className="mt-3.5 shrink-0">
            <button
              type="button"
              onClick={onClose}
              className="min-w-[66px] px-5 py-1.5 rounded-[6px] bg-[var(--os-bg-control)] hover:bg-[var(--os-bg-hover)] border border-[var(--os-border)] text-[var(--os-text)] text-[12px] font-semibold transition-colors shadow-2xs"
            >
              OK
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

