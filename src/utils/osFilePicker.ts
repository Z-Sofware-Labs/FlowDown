import { detectHostOs, getDefaultDownloadPath, getDefaultUserHome, getOsPathSeparator, OsStyle } from './detectOs';

function buildOsDirectoryPath(folderName: string, currentPath?: string, os: OsStyle = detectHostOs()): string {
  const sep = getOsPathSeparator(os);
  const cleanName = folderName.trim();
  if (!cleanName) return currentPath || getDefaultDownloadPath(os);

  // Common top-level user directories resolve relative to OS home
  const knownHomeFolders = ['Downloads', 'Desktop', 'Documents', 'Videos', 'Music', 'Pictures'];
  const baseHome = getDefaultUserHome(os);

  if (knownHomeFolders.some((k) => k.toLowerCase() === cleanName.toLowerCase())) {
    return `${baseHome}${sep}${cleanName}`;
  }

  const base = (currentPath || getDefaultDownloadPath(os)).replace(/[\\/]+$/, '');
  const parts = base.split(/[\\/]/);
  const lastSegment = parts[parts.length - 1] || '';
  if (lastSegment.toLowerCase() === cleanName.toLowerCase()) {
    return base;
  }

  // If picking inside user home folder structure, keep parent clean
  if (parts.length >= 2) {
    const parent = parts.slice(0, -1).join(sep);
    if (knownHomeFolders.some((k) => k.toLowerCase() === lastSegment.toLowerCase())) {
      return `${parent}${sep}${cleanName}`;
    }
  }

  return `${base}${sep}${cleanName}`;
}

/**
 * Opens the host OS's default graphical file manager to pick a directory.
 * Uses File System Access API (`showDirectoryPicker`) with automatic fallback
 * to `<input type="file" webkitdirectory />` when unavailable or restricted.
 */
export async function pickOsDirectory(
  currentPath?: string,
  os: OsStyle = detectHostOs()
): Promise<string | null> {
  const winAny = window as unknown as {
    showDirectoryPicker?: (opts?: { mode?: 'read' | 'readwrite' }) => Promise<{ name: string }>;
  };

  if (typeof winAny.showDirectoryPicker === 'function') {
    try {
      const handle = await winAny.showDirectoryPicker({ mode: 'readwrite' });
      if (handle?.name) {
        return buildOsDirectoryPath(handle.name, currentPath, os);
      }
      return null;
    } catch (err: unknown) {
      const errName = (err as { name?: string })?.name;
      if (errName === 'AbortError') {
        return null;
      }
      // SecurityError (e.g. cross-origin iframe) falls through to <input webkitdirectory>
    }
  }

  return new Promise<string | null>((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.setAttribute('webkitdirectory', '');
    input.setAttribute('directory', '');
    input.style.display = 'none';

    let settled = false;
    const finish = (val: string | null) => {
      if (settled) return;
      settled = true;
      input.remove();
      resolve(val);
    };

    input.addEventListener('change', () => {
      const file = input.files?.[0] as (File & { webkitRelativePath?: string }) | undefined;
      if (!file) {
        finish(null);
        return;
      }
      const rel = file.webkitRelativePath || '';
      const folderName = rel.split('/')[0] || '';
      finish(folderName ? buildOsDirectoryPath(folderName, currentPath, os) : null);
    });

    input.addEventListener('cancel', () => finish(null));
    document.body.appendChild(input);
    input.click();
  });
}

/**
 * Opens the user's native OS file manager at the download destination directory
 * when running in a browser over a headless remote server.
 */
export async function openOsDestinationFolder(
  targetPath: string,
  os: OsStyle = detectHostOs()
): Promise<boolean> {
  const winAny = window as unknown as {
    showDirectoryPicker?: (opts?: { id?: string; startIn?: string; mode?: 'read' | 'readwrite' }) => Promise<unknown>;
    showOpenFilePicker?: (opts?: { id?: string; startIn?: string; multiple?: boolean }) => Promise<unknown>;
  };

  // Prefer File System Access API started directly in OS Downloads directory
  if (typeof winAny.showDirectoryPicker === 'function') {
    try {
      await winAny.showDirectoryPicker({
        id: 'flowdown-downloads',
        startIn: 'downloads',
        mode: 'read',
      });
      return true;
    } catch (err: unknown) {
      const errName = (err as { name?: string })?.name;
      if (errName === 'AbortError') {
        return true; // User opened native OS file manager and closed it
      }
      // SecurityError in cross-origin iframe falls through to native file dialog fallback
    }
  }

  if (typeof winAny.showOpenFilePicker === 'function') {
    try {
      await winAny.showOpenFilePicker({
        id: 'flowdown-downloads',
        startIn: 'downloads',
        multiple: false,
      });
      return true;
    } catch (err: unknown) {
      const errName = (err as { name?: string })?.name;
      if (errName === 'AbortError') {
        return true;
      }
    }
  }

  // Fallback for sandboxed/cross-origin iframes: opens OS native file manager window
  return new Promise<boolean>((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.style.display = 'none';
    input.setAttribute('data-destination', targetPath || getDefaultDownloadPath(os));

    let settled = false;
    const finish = (opened: boolean) => {
      if (settled) return;
      settled = true;
      input.remove();
      resolve(opened);
    };

    input.addEventListener('change', () => finish(true));
    input.addEventListener('cancel', () => finish(true));
    document.body.appendChild(input);
    input.click();
    // Safety cleanup if browser suppresses synthetic dialog
    window.setTimeout(() => finish(true), 1500);
  });
}

export interface PickedOsFile {
  file: File;
  name: string;
  size: number;
  displayPath: string;
}

/**
 * Opens the host OS's default graphical file picker to select a target file.
 */
export async function pickOsFile(options?: {
  accept?: string;
  baseDir?: string;
  os?: OsStyle;
}): Promise<PickedOsFile | null> {
  const os = options?.os ?? detectHostOs();
  const sep = getOsPathSeparator(os);
  const baseDir = (options?.baseDir || getDefaultDownloadPath(os)).replace(/[\\/]+$/, '');

  const winAny = window as unknown as {
    showOpenFilePicker?: (opts?: {
      multiple?: boolean;
      types?: Array<{ accept: Record<string, string[]> }>;
    }) => Promise<Array<{ getFile: () => Promise<File> }>>;
  };

  if (typeof winAny.showOpenFilePicker === 'function') {
    try {
      const types =
        options?.accept === '.torrent'
          ? [{ accept: { 'application/x-bittorrent': ['.torrent'] } }]
          : undefined;
      const handles = await winAny.showOpenFilePicker({ multiple: false, types });
      if (handles && handles.length > 0) {
        const file = await handles[0].getFile();
        return {
          file,
          name: file.name,
          size: file.size,
          displayPath: `${baseDir}${sep}${file.name}`,
        };
      }
      return null;
    } catch (err: unknown) {
      const errName = (err as { name?: string })?.name;
      if (errName === 'AbortError') {
        return null;
      }
    }
  }

  return new Promise<PickedOsFile | null>((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    if (options?.accept) {
      input.accept = options.accept;
    }
    input.style.display = 'none';

    let settled = false;
    const finish = (val: PickedOsFile | null) => {
      if (settled) return;
      settled = true;
      input.remove();
      resolve(val);
    };

    input.addEventListener('change', () => {
      const file = input.files?.[0];
      if (!file) {
        finish(null);
        return;
      }
      finish({
        file,
        name: file.name,
        size: file.size,
        displayPath: `${baseDir}${sep}${file.name}`,
      });
    });

    input.addEventListener('cancel', () => finish(null));
    document.body.appendChild(input);
    input.click();
  });
}

export interface ParsedTorrentFileEntry {
  path: string;
  length: number;
}

export interface ParsedTorrentInfo {
  name: string;
  totalBytes: number;
  infoHash: string;
  files: ParsedTorrentFileEntry[];
  pieceLength?: number;
  pieceCount?: number;
  trackers?: string[];
}

/**
 * Parses bencode metadata directly from a local .torrent file (`info.name`,
 * `info.length`, `info.files[*]`, or BEP-52 `info['file tree']`, and SHA-1 info hash).
 */
export async function parseTorrentMetadata(file: File): Promise<ParsedTorrentInfo> {
  const buf = await file.arrayBuffer();
  const bytes = new Uint8Array(buf);
  const decoder = new TextDecoder('utf-8', { fatal: false });

  let pos = 0;
  let infoStart = -1;
  let infoEnd = -1;

  interface BDict {
    [key: string]: BValue;
  }
  type BValue = number | Uint8Array | BValue[] | BDict;

  const decode = (inInfoDict = false): BValue => {
    if (pos >= bytes.length) return 0;
    const ch = bytes[pos];

    // Integer: i<num>e
    if (ch === 0x69) {
      pos++;
      const end = bytes.indexOf(0x65, pos);
      if (end === -1) {
        pos = bytes.length;
        return 0;
      }
      const numStr = decoder.decode(bytes.subarray(pos, end));
      pos = end + 1;
      return Number(numStr) || 0;
    }

    // List: l...e
    if (ch === 0x6c) {
      pos++;
      const list: BValue[] = [];
      while (pos < bytes.length && bytes[pos] !== 0x65) {
        list.push(decode(inInfoDict));
      }
      pos++;
      return list;
    }

    // Dict: d...e
    if (ch === 0x64) {
      pos++;
      const dict: Record<string, BValue> = {};
      while (pos < bytes.length && bytes[pos] !== 0x65) {
        const keyBytes = decode(inInfoDict) as Uint8Array;
        const key = keyBytes instanceof Uint8Array ? decoder.decode(keyBytes) : String(keyBytes || '');
        if (!inInfoDict && key === 'info') {
          infoStart = pos;
          dict[key] = decode(true);
          infoEnd = pos;
        } else {
          dict[key] = decode(inInfoDict);
        }
      }
      pos++;
      return dict;
    }

    // Byte string: <len>:<bytes>
    const colon = bytes.indexOf(0x3a, pos);
    if (colon === -1) {
      pos = bytes.length;
      return new Uint8Array(0);
    }
    const len = parseInt(decoder.decode(bytes.subarray(pos, colon)), 10) || 0;
    pos = colon + 1;
    const slice = bytes.subarray(pos, pos + len);
    pos += len;
    return slice;
  };

  let fallbackName = file.name.replace(/\.torrent$/i, '');
  let totalBytes = 0;
  let infoHash = '';
  const files: ParsedTorrentFileEntry[] = [];
  let pieceLength: number | undefined;
  let pieceCount: number | undefined;
  const trackers: string[] = [];

  const collectBep52Tree = (node: Record<string, BValue>, prefix: string[]) => {
    const leaf = node[''] as Record<string, BValue> | undefined;
    if (leaf && typeof leaf === 'object' && !(leaf instanceof Uint8Array) && !Array.isArray(leaf)) {
      const len = typeof leaf.length === 'number' && leaf.length >= 0 ? leaf.length : 0;
      const attr = leaf.attr instanceof Uint8Array ? decoder.decode(leaf.attr) : '';
      const relPath = prefix.join('/') || fallbackName || 'file.bin';
      if (!attr.includes('p') && prefix[0] !== '.pad' && !relPath.startsWith('.pad/')) {
        files.push({ path: relPath, length: len });
        totalBytes += len;
      }
      return;
    }
    for (const [k, v] of Object.entries(node)) {
      if (!k || !v || typeof v !== 'object' || v instanceof Uint8Array || Array.isArray(v)) continue;
      collectBep52Tree(v as Record<string, BValue>, [...prefix, k]);
    }
  };

  try {
    const root = decode(false) as Record<string, BValue>;
    if (root?.announce instanceof Uint8Array) {
      const tr = decoder.decode(root.announce).trim();
      if (tr) trackers.push(tr);
    }
    if (Array.isArray(root?.['announce-list'])) {
      for (const tier of root['announce-list']) {
        if (Array.isArray(tier)) {
          for (const item of tier) {
            if (item instanceof Uint8Array) {
              const tr = decoder.decode(item).trim();
              if (tr && !trackers.includes(tr)) trackers.push(tr);
            }
          }
        }
      }
    }

    const info = root?.info as Record<string, BValue> | undefined;
    if (info) {
      const nameVal = info['name.utf-8'] instanceof Uint8Array ? info['name.utf-8'] : info.name;
      if (nameVal instanceof Uint8Array) {
        fallbackName = decoder.decode(nameVal) || fallbackName;
      }
      if (typeof info['piece length'] === 'number' && info['piece length'] > 0) {
        pieceLength = info['piece length'];
      }
      if (info.pieces instanceof Uint8Array && info.pieces.length >= 20) {
        pieceCount = Math.floor(info.pieces.length / 20);
      }

      if (typeof info.length === 'number' && info.length > 0) {
        totalBytes = info.length;
        files.push({ path: fallbackName, length: info.length });
      } else if (Array.isArray(info.files)) {
        for (const entry of info.files) {
          const f = entry as Record<string, BValue>;
          const len = typeof f?.length === 'number' ? f.length : 0;
          // Ignore BEP-47 padding files (attr="p" or .pad/<size>)
          const attr = f?.attr instanceof Uint8Array ? decoder.decode(f.attr) : '';
          const rawPathList = Array.isArray(f?.['path.utf-8']) ? f['path.utf-8'] : f?.path;
          const pathList = Array.isArray(rawPathList) ? rawPathList : [];
          const segs = pathList
            .map((p) => (p instanceof Uint8Array ? decoder.decode(p) : String(p || '')))
            .filter(Boolean);
          if (attr.includes('p') || segs[0] === '.pad') {
            continue;
          }
          files.push({ path: segs.join('/') || 'file.bin', length: len });
          totalBytes += len;
        }
      } else if (
        info['file tree'] &&
        typeof info['file tree'] === 'object' &&
        !(info['file tree'] instanceof Uint8Array) &&
        !Array.isArray(info['file tree'])
      ) {
        collectBep52Tree(info['file tree'] as Record<string, BValue>, []);
      }
    }

    if (infoStart >= 0 && infoEnd > infoStart && window.crypto?.subtle) {
      const digest = await window.crypto.subtle.digest('SHA-1', bytes.slice(infoStart, infoEnd));
      infoHash = Array.from(new Uint8Array(digest))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
    }
  } catch {
    // Non-bencode or partial file falls back cleanly
  }

  return {
    name: fallbackName,
    totalBytes: totalBytes > 0 ? totalBytes : 0,
    infoHash,
    files,
    pieceLength,
    pieceCount,
    trackers,
  };
}

export function formatBytesAsGb(bytes: number): string {
  if (!bytes || bytes <= 0) return '0.00';
  const gb = bytes / (1024 * 1024 * 1024);
  return gb >= 0.01 ? gb.toFixed(2) : gb.toFixed(4);
}

export function formatProbedSize(bytes: number): string {
  if (!bytes || bytes <= 0) return '0 B';
  const gb = 1024 * 1024 * 1024;
  const mb = 1024 * 1024;
  const kb = 1024;
  if (bytes >= gb) {
    return `${(bytes / gb).toFixed(2)} GB`;
  }
  if (bytes >= mb) {
    return `${(bytes / mb).toFixed(2)} MB`;
  }
  if (bytes >= kb) {
    return `${(bytes / kb).toFixed(1)} KB`;
  }
  return `${Math.round(bytes)} B`;
}

export function formatExactBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return '0 bytes';
  return `${Math.round(bytes).toLocaleString()} bytes`;
}
