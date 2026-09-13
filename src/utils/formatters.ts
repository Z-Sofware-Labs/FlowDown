import { FileType } from '../types';

export function formatBytes(bytes: number, decimals: number = 2): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
}

export function formatSpeed(bytesPerSec: number): string {
  if (bytesPerSec <= 0) return '0 B/s';
  return `${formatBytes(bytesPerSec)}/s`;
}

export function formatEta(seconds: number): string {
  if (!isFinite(seconds) || seconds <= 0) return '--:--';
  if (seconds < 60) return `${Math.ceil(seconds)}s`;
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  if (mins < 60) return `${mins}m ${secs}s`;
  const hours = Math.floor(mins / 60);
  const remainingMins = mins % 60;
  return `${hours}h ${remainingMins}m`;
}

export function getFileTypeBadgeColor(type: FileType): { bg: string; text: string; border: string; iconBg: string } {
  switch (type) {
    case 'video':
      return { 
        bg: 'bg-indigo-50 dark:bg-indigo-950/60', 
        text: 'text-indigo-700 dark:text-indigo-300', 
        border: 'border-indigo-200 dark:border-indigo-800', 
        iconBg: 'bg-indigo-100 dark:bg-indigo-900/60 text-indigo-600 dark:text-indigo-400' 
      };
    case 'audio':
      return { 
        bg: 'bg-emerald-50 dark:bg-emerald-950/60', 
        text: 'text-emerald-700 dark:text-emerald-300', 
        border: 'border-emerald-200 dark:border-emerald-800', 
        iconBg: 'bg-emerald-100 dark:bg-emerald-900/60 text-emerald-600 dark:text-emerald-400' 
      };
    case 'software':
      return { 
        bg: 'bg-blue-50 dark:bg-blue-950/60', 
        text: 'text-blue-700 dark:text-blue-300', 
        border: 'border-blue-200 dark:border-blue-800', 
        iconBg: 'bg-blue-100 dark:bg-blue-900/60 text-blue-600 dark:text-blue-400' 
      };
    case 'archive':
      return { 
        bg: 'bg-amber-50 dark:bg-amber-950/60', 
        text: 'text-amber-700 dark:text-amber-300', 
        border: 'border-amber-200 dark:border-amber-800', 
        iconBg: 'bg-amber-100 dark:bg-amber-900/60 text-amber-600 dark:text-amber-400' 
      };
    case 'document':
      return { 
        bg: 'bg-rose-50 dark:bg-rose-950/60', 
        text: 'text-rose-700 dark:text-rose-300', 
        border: 'border-rose-200 dark:border-rose-800', 
        iconBg: 'bg-rose-100 dark:bg-rose-900/60 text-rose-600 dark:text-rose-400' 
      };
    case 'image':
      return { 
        bg: 'bg-purple-50 dark:bg-purple-950/60', 
        text: 'text-purple-700 dark:text-purple-300', 
        border: 'border-purple-200 dark:border-purple-800', 
        iconBg: 'bg-purple-100 dark:bg-purple-900/60 text-purple-600 dark:text-purple-400' 
      };
    case 'torrent':
      return { 
        bg: 'bg-teal-50 dark:bg-teal-950/60', 
        text: 'text-teal-700 dark:text-teal-300', 
        border: 'border-teal-200 dark:border-teal-800', 
        iconBg: 'bg-teal-100 dark:bg-teal-900/60 text-teal-600 dark:text-teal-400' 
      };
    default:
      return { 
        bg: 'bg-slate-50 dark:bg-slate-800/60', 
        text: 'text-slate-700 dark:text-slate-300', 
        border: 'border-slate-200 dark:border-slate-700', 
        iconBg: 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400' 
      };
  }
}

