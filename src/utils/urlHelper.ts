export interface CleanUrlResult {
  cleanUrl: string;
  filename: string;
  detectedFileType?: FileType;
  detectedCategory?: string;
  magnetXlSize?: number;
}

export interface RemoteFileSizeResult {
  size: number;
  source: string;
  isMultiFile?: boolean;
  fileCount?: number;
  files?: { path: string; size: number }[];
}

import { FileType } from '../types';
import { fetch } from '@tauri-apps/plugin-http';
import { invoke, isTauri } from '@tauri-apps/api/core';

export function safeDecodeURIComponent(str: string): string {
  try {
    return decodeURIComponent(str);
  } catch {
    return str;
  }
}

export function safeEncodeURIComponent(str: string): string {
  try {
    return encodeURIComponent(str);
  } catch {
    return str;
  }
}

export function cleanUrlAndFilename(rawUrl: string): CleanUrlResult {
  let url = rawUrl.trim();
  let filename = '';
  let detectedFileType: FileType | undefined = undefined;
  let detectedCategory: string | undefined = undefined;
  let magnetXlSize: number | undefined = undefined;

  if (url.toLowerCase().startsWith('magnet:?')) {
    const matchDn = url.match(/[?&]dn=([^&]+)/i);
    if (matchDn && matchDn[1]) {
      filename = safeDecodeURIComponent(matchDn[1]);
    } else {
      filename = 'torrent_directory_download';
    }

    const matchXl = url.match(/[?&]xl=([0-9]+)/i);
    if (matchXl && matchXl[1]) {
      magnetXlSize = parseInt(matchXl[1], 10);
    }

    return { 
      cleanUrl: url, 
      filename, 
      detectedFileType: 'torrent', 
      detectedCategory: 'Torrents',
      magnetXlSize
    };
  }

  try {
    const parsed = new URL(url);
    const pathname = parsed.pathname;
    let baseName = pathname.split('/').filter(Boolean).pop() || '';
    baseName = safeDecodeURIComponent(baseName);
    
    baseName = baseName.split('?')[0].split('#')[0];
    
    if (baseName) {
      filename = baseName;
    }
  } catch {
    const cleanNoQuery = url.split('?')[0].split('#')[0];
    const parts = cleanNoQuery.split('/').filter(Boolean);
    if (parts.length > 0) {
      filename = safeDecodeURIComponent(parts[parts.length - 1]);
    }
  }

  if (!filename) {
    filename = 'downloaded_file.bin';
  }

  // Category auto-detection based on filename extension / keywords
  const lowerName = (filename + ' ' + url).toLowerCase();
  
  if (/\.(m4a|mp3|flac|wav|aac|ogg|wma|aiff)(\?|$)/i.test(lowerName)) {
    detectedFileType = 'audio';
    detectedCategory = 'Audio & Music';
  } else if (/\.(mp4|mkv|avi|mov|webm|flv|m4v)(\?|$)/i.test(lowerName)) {
    detectedFileType = 'video';
    detectedCategory = 'Video & Film';
  } else if (/\.(pdf|docx?|xlsx?|pptx?|txt|rtf|epub)(\?|$)/i.test(lowerName)) {
    detectedFileType = 'document';
    detectedCategory = 'Documents';
  } else if (/\.(zip|rar|7z|tar|gz|bz2)(\?|$)/i.test(lowerName)) {
    detectedFileType = 'archive';
    detectedCategory = 'Archives';
  } else if (/\.(png|jpe?g|gif|webp|svg|bmp)(\?|$)/i.test(lowerName)) {
    detectedFileType = 'image';
    detectedCategory = 'Images';
  } else if (/\.(exe|msi|dmg|deb|appimage|pkg)(\?|$)/i.test(lowerName)) {
    detectedFileType = 'software';
    detectedCategory = 'Software';
  } else if (lowerName.includes('.iso')) {
    detectedFileType = 'software';
    detectedCategory = 'Operating Systems';
  }

  return { cleanUrl: url, filename, detectedFileType, detectedCategory };
}

export async function fetchRemoteServerFileSize(rawUrl: string): Promise<RemoteFileSizeResult> {
  const { cleanUrl, magnetXlSize } = cleanUrlAndFilename(rawUrl);

  if (!cleanUrl) {
    return { size: 0, source: 'Awaiting URL Input' };
  }

  if (magnetXlSize && magnetXlSize > 0) {
    return { size: magnetXlSize, source: 'Magnet Metadata (xl exact total size)' };
  }

  if (cleanUrl.toLowerCase().startsWith('magnet:?')) {
    return { size: 0, source: 'Waiting for torrent metadata' };
  }

  if (!/^https?:\/\//i.test(cleanUrl)) {
    return { size: 0, source: 'Unknown Size' };
  }

  // Desktop/Tauri: probe through Rust so redirects, HEAD, Range and server
  // headers are handled outside the browser/webview security model.
  if (isTauri()) {
    try {
      const result = await invoke<{
        size: number;
        supportsRanges: boolean;
        finalUrl: string;
        source: string;
      }>('probe_remote_file', { url: cleanUrl });
      if (result.size > 0) {
        return {
          size: result.size,
          source: result.supportsRanges
            ? `${result.source} • segmented HTTP ready`
            : `${result.source} • single connection`,
        };
      }
      return { size: 0, source: result.source || 'Unknown Size' };
    } catch (error) {
      console.debug('[FlowDown] Native file-size probe failed', error);
    }
  }

  // Web/dev fallback. HEAD first, then a one-byte range request.
  try {
    const response = await fetch(cleanUrl, { method: 'HEAD' });
    const contentLength = response.headers.get('content-length');
    if (response.ok && contentLength && Number(contentLength) > 0) {
      return { size: Number(contentLength), source: 'Server HTTP Content-Length Header' };
    }
  } catch (error) {
    console.debug('[FlowDown] HEAD size probe failed', error);
  }

  try {
    const rangeRes = await fetch(cleanUrl, {
      method: 'GET',
      headers: { Range: 'bytes=0-0', 'Accept-Encoding': 'identity' },
    });
    if (rangeRes.status === 206) {
      const contentRange = rangeRes.headers.get('content-range');
      const totalMatch = contentRange?.match(/\/([0-9]+)$/);
      if (totalMatch?.[1]) {
        return { size: Number(totalMatch[1]), source: 'Server HTTP Content-Range Header' };
      }
    }
  } catch (error) {
    console.debug('[FlowDown] Range size probe failed', error);
  }

  return { size: 0, source: 'Unknown Size (server did not expose length)' };
}

export function getDefaultDownloadsPath(): string {
  // Keep the persisted/default representation platform-neutral. In the Tauri
  // desktop app, resolveDownloadPath() maps this alias to the OS's actual
  // Downloads directory (including customized locations).
  return 'Downloads';
}

export function getDefaultDirectoryList(): string[] {
  const base = getDefaultDownloadsPath();
  const sep = base.includes('\\') ? '\\' : '/';
  const cleanBase = base.replace(/[/\\]$/, '');
  return [
    cleanBase,
    `${cleanBase}${sep}Software`,
    `${cleanBase}${sep}Torrents`,
    `${cleanBase}${sep}OS`,
  ];
}

export function isPotentialDownloadUrl(text: string): boolean {
  if (!text) return false;
  const trimmed = text.trim();
  if (/^(https?|ftp|file):\/\//i.test(trimmed)) return true;
  if (/^magnet:\?/i.test(trimmed)) return true;
  if (/\.torrent(\?.*)?$/i.test(trimmed)) return true;
  // Local file path to .torrent file (Windows C:\... or Unix /...)
  if ((/^[a-zA-Z]:[/\\]/i.test(trimmed) || trimmed.startsWith('/')) && /\.torrent$/i.test(trimmed)) return true;
  return false;
}

export function extractUrlFromDataTransfer(dataTransfer: DataTransfer): string | null {
  // 1. Check URI list (standard format for dragged links from browsers)
  const uriList = dataTransfer.getData('text/uri-list');
  if (uriList) {
    const lines = uriList.split(/[\r\n]+/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith('#') && isPotentialDownloadUrl(trimmed)) {
        return trimmed;
      }
    }
  }

  // 2. Check HTML content (dragging an <a> anchor tag or image from a webpage)
  const html = dataTransfer.getData('text/html');
  if (html) {
    try {
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, 'text/html');
      const anchor = doc.querySelector('a[href]');
      if (anchor) {
        const href = anchor.getAttribute('href')?.trim();
        if (href && isPotentialDownloadUrl(href)) {
          return href;
        }
      }
      const img = doc.querySelector('img[src]');
      if (img) {
        const src = img.getAttribute('src')?.trim();
        if (src && isPotentialDownloadUrl(src)) {
          return src;
        }
      }
    } catch {
      // Ignore HTML parsing errors and continue to text
    }
  }

  // 3. Check plain text
  const plainText = dataTransfer.getData('text/plain');
  if (plainText) {
    const lines = plainText.split(/[\r\n]+/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (isPotentialDownloadUrl(trimmed)) {
        return trimmed;
      }
    }
  }

  // 4. Check if files were dropped directly (e.g., .torrent file from desktop)
  if (dataTransfer.files && dataTransfer.files.length > 0) {
    for (let i = 0; i < dataTransfer.files.length; i++) {
      const file = dataTransfer.files[i];
      if (file.name.toLowerCase().endsWith('.torrent')) {
        // If the browser/Tauri provides path or name
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const anyFile = file as any;
        if (anyFile.path) {
          return anyFile.path;
        }
      }
    }
  }

  return null;
}

