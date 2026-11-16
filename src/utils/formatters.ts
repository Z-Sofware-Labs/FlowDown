/**
 * Formatting and calculation utilities for Qt Downloader & libqrbit
 */

export function formatBytes(bytes: number, decimals = 1): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  if (i < 0) return `${bytes} B`;
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
}

export function formatSpeed(bytesPerSec: number): string {
  if (!bytesPerSec || bytesPerSec <= 0) return '0.0 B/s';
  const k = 1024;
  const sizes = ['B/s', 'KB/s', 'MB/s', 'GB/s'];
  const i = Math.floor(Math.log(bytesPerSec) / Math.log(k));
  if (i < 0) return `${Math.round(bytesPerSec)} B/s`;
  const val = (bytesPerSec / Math.pow(k, i)).toFixed(1);
  return `${val} ${sizes[i]}`;
}

export function formatEta(seconds: number): string {
  if (!seconds || seconds <= 0 || !isFinite(seconds)) return '∞';
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  if (mins < 60) return `${mins}m ${secs}s`;
  const hours = Math.floor(mins / 60);
  const remMins = mins % 60;
  if (hours < 24) return `${hours}h ${remMins}m`;
  const days = Math.floor(hours / 24);
  const remHours = hours % 24;
  return `${days}d ${remHours}h`;
}

export function calculateEta(remainingBytes: number, speedBytesPerSec: number): string {
  if (speedBytesPerSec <= 0 || remainingBytes <= 0) return '∞';
  const seconds = remainingBytes / speedBytesPerSec;
  return formatEta(seconds);
}

export function generateHash(): string {
  const chars = '0123456789abcdef';
  let hash = '';
  for (let i = 0; i < 40; i++) {
    hash += chars[Math.floor(Math.random() * chars.length)];
  }
  return hash;
}

export function generateHexDump(length = 32): string {
  const hex = '0123456789ABCDEF';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += hex[Math.floor(Math.random() * 16)] + hex[Math.floor(Math.random() * 16)] + ' ';
    if ((i + 1) % 8 === 0) result += ' ';
  }
  return result.trim();
}
