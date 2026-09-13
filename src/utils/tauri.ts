// Tauri API helpers for desktop shell interaction.
import { Channel, invoke, isTauri } from '@tauri-apps/api/core';
import { download, upload } from '@tauri-apps/plugin-upload';
import { basename, downloadDir, join } from '@tauri-apps/api/path';

export interface NativeDownloadResult {
  success: boolean;
  method: string;
  filePath?: string;
  paused?: boolean;
  error?: unknown;
}

export function isTauriEnvironment(): boolean {
  try {
    return isTauri();
  } catch {
    return false;
  }
}

/**
 * Resolve the app's historical display paths to a real OS path.
 * Tauri's downloadDir() uses the platform's actual Downloads location
 * (including a user-customised Windows Downloads folder).
 */
export async function resolveDownloadPath(filePath: string): Promise<string> {
  const normalized = filePath.trim();
  const lower = normalized.toLowerCase().replace(/\\/g, '/');

  const aliases = [
    '%userprofile%/downloads',
    '%username%/downloads',
    '~/downloads',
    '$download',
    'downloads',
  ];

  const downloadPath = await downloadDir();

  for (const alias of aliases) {
    if (lower === alias) {
      return downloadPath;
    }

    if (lower.startsWith(`${alias}/`)) {
      const relative = normalized
        .replace(/\\/g, '/')
        .slice(alias.length)
        .replace(/^[/\\]+/, '');
      return relative ? join(downloadPath, relative) : downloadPath;
    }
  }

  return normalized;
}

/**
 * Download a direct HTTP(S) file with Tauri's upload plugin.
 *
 * Important: if the app is running inside Tauri and the native download fails,
 * we return the error instead of silently starting a second browser download.
 * That keeps the transfer state truthful.
 */
export interface AdaptiveDownloadEvent {
  event: 'started' | 'progress' | 'finished';
  data: {
    total?: number;
    downloaded?: number;
    speed?: number;
    connections?: number;
    segmented?: boolean;
  };
}

/**
 * Native adaptive HTTP downloader.
 *
 * The Rust side probes the server, checks byte-range support, and then uses
 * multiple HTTP range requests only when the server can safely support them.
 * `maxConnections` is a ceiling, not a fixed thread count: the engine starts
 * conservatively and raises/lowers the active connection count according to
 * measured throughput.
 */
export async function downloadFileNative(
  url: string,
  filePath: string,
  maxConnections = 16,
  onProgress?: (progress: number, total: number, transferSpeed?: number, connections?: number) => void,
  transferId?: string,
): Promise<NativeDownloadResult> {
  const trimmedUrl = url.trim();

  if (!/^https?:\/\//i.test(trimmedUrl)) {
    return {
      success: false,
      method: trimmedUrl.toLowerCase().startsWith('magnet:')
        ? 'torrent-engine-not-installed'
        : 'unsupported-url',
      error: new Error('The HTTP downloader only accepts http:// or https:// URLs.'),
    };
  }

  if (isTauriEnvironment()) {
    const actualPath = await resolveDownloadPath(filePath);

    try {
      console.info('[FlowDown] Adaptive native download starting', {
        url: trimmedUrl,
        filePath: actualPath,
        maxConnections,
      });

      const channel = new Channel<AdaptiveDownloadEvent>();
      channel.onmessage = (message) => {
        if (message.event === 'started') {
          console.info('[FlowDown] Download engine started', message.data);
          return;
        }
        if (message.event === 'progress') {
          onProgress?.(
            Number(message.data.downloaded ?? 0),
            Number(message.data.total ?? 0),
            Number(message.data.speed ?? 0),
            Number(message.data.connections ?? 1),
          );
        }
      };

      await invoke('download_adaptive', {
        url: trimmedUrl,
        filePath: actualPath,
        maxConnections,
        transferId: transferId ?? actualPath,
        onEvent: channel,
      });

      console.info('[FlowDown] Adaptive native download finished', {
        url: trimmedUrl,
        filePath: actualPath,
      });

      return {
        success: true,
        method: 'flowdown-adaptive-http',
        filePath: actualPath,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes('__FLOWDOWN_PAUSED__')) {
        console.info('[FlowDown] Adaptive native download paused', {
          url: trimmedUrl,
          filePath: actualPath,
        });
        return {
          success: false,
          paused: true,
          method: 'flowdown-adaptive-http',
          filePath: actualPath,
        };
      }

      console.error('[FlowDown] Adaptive native download failed', error);
      return {
        success: false,
        method: 'flowdown-adaptive-http',
        filePath,
        error,
      };
    }
  }

  // Browser-only fallback. Native Tauri failures never fall through to this.
  try {
    const a = document.createElement('a');
    a.href = trimmedUrl;
    a.download = (await basename(filePath)) || 'download.bin';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    return { success: true, method: 'browser-fallback-download', filePath };
  } catch (error) {
    return { success: false, method: 'browser-fallback-download', filePath, error };
  }
}

/** Request a native HTTP transfer to pause. The Rust side preserves completed
 * byte ranges so a later start/resume continues from the existing partial file. */
export async function pauseHttpDownloadNative(transferId: string): Promise<void> {
  if (!isTauriEnvironment()) {
    throw new Error('HTTP pause requires the Tauri desktop application.');
  }

  await invoke('pause_http_download', { transferId });
}

/**
 * Uploads a file using Tauri v2 plugin-upload.
 */
export async function uploadFileNative(
  url: string,
  filePath: string,
  headers?: Record<string, string>,
  onProgress?: (progress: number, total: number) => void,
): Promise<{ success: boolean; method: string; error?: unknown }> {
  try {
    if (isTauriEnvironment()) {
      await upload(
        url,
        filePath,
        ((progress: number, total: number) => {
          onProgress?.(progress, total);
        }) as any,
        headers as any,
      );
      return { success: true, method: 'tauri-plugin-upload' };
    }
  } catch (err) {
    console.warn('Tauri upload error:', err);
  }
  return { success: false, method: 'unsupported' };
}

/**
 * Open a directory in the operating system's default file manager.
 *
 * This is deliberately directory-only: no reveal operation, browser fallback,
 * URL handling, or FlowDown sub-window is used. In Tauri, openPath(directory)
 * delegates directly to the OS file manager (Explorer on Windows).
 */
export async function openDirectoryNative(
  directoryPath: string,
): Promise<{ success: boolean; method: string; error?: unknown }> {
  if (!directoryPath) return { success: false, method: 'none' };

  if (!isTauriEnvironment()) {
    console.warn('[FlowDown] Open directory requested outside Tauri', directoryPath);
    return { success: false, method: 'not-tauri' };
  }

  try {
    const actualPath = await resolveDownloadPath(directoryPath);
    await invoke('open_local_path', { path: actualPath });
    return { success: true, method: 'tauri-native-shell-open-directory' };
  } catch (error) {
    console.error('[FlowDown] Failed to open directory', { directoryPath, error });
    return { success: false, method: 'tauri-opener-open-directory', error };
  }
}

/**
 * Open a completed local file with the operating system's associated app.
 * There is intentionally NO browser/URL fallback.
 */
export async function openPathNative(
  targetPath: string,
): Promise<{ success: boolean; method: string; error?: unknown }> {
  if (!targetPath) return { success: false, method: 'none' };

  if (!isTauriEnvironment()) {
    console.warn('[FlowDown] Open file requested outside Tauri', targetPath);
    return { success: false, method: 'not-tauri' };
  }

  try {
    const actualPath = await resolveDownloadPath(targetPath);
    await invoke('open_local_path', { path: actualPath });
    return { success: true, method: 'tauri-native-shell-open-file' };
  } catch (error) {
    console.error('[FlowDown] Failed to launch local file', { targetPath, error });
    return { success: false, method: 'tauri-opener-open-file', error };
  }
}

/**
 * Create a download directory using the same path resolution rules as the
 * downloader. Returns the real path that was created/resolved.
 */
export async function createDownloadDirectory(path: string): Promise<string> {
  if (!isTauriEnvironment()) return path;

  const actualPath = await resolveDownloadPath(path);
  return invoke<string>('create_local_directory', { path: actualPath });
}

export interface TorrentMetadataFile {
  path: string;
  size: number;
}

export interface TorrentMetadataResult {
  name: string;
  infoHash: string;
  total: number;
  files: TorrentMetadataFile[];
}

export interface TorrentStartResult {
  torrentId: number;
  infoHash: string;
  name?: string;
  total: number;
  subFolder: string;
}

export interface TorrentProgressResult {
  torrentId: number;
  state: string;
  downloaded: number;
  total: number;
  speed: number;
  uploaded: number;
  finished: boolean;
  error?: string;
  infoHash: string;
}


/** Wait until librqbit has completed the torrent and released its output files. */
export async function waitForTorrentReadyNative(
  torrentId: number,
): Promise<void> {
  if (!isTauriEnvironment()) {
    throw new Error('The BitTorrent engine requires the Tauri desktop application.');
  }

  await invoke('torrent_wait_until_ready', { torrentId });
}

/** Start a real BitTorrent transfer through the embedded librqbit engine. */
export async function startTorrentNative(
  url: string,
  savePath: string,
  onlyFiles?: number[],
  overwrite = false,
  subFolder?: string,
): Promise<TorrentStartResult> {
  if (!isTauriEnvironment()) {
    throw new Error('The BitTorrent engine requires the Tauri desktop application.');
  }

  const actualPath = await resolveDownloadPath(savePath);
  return invoke<TorrentStartResult>('start_torrent', {
    url: url.trim(),
    savePath: actualPath,
    onlyFiles,
    overwrite,
    subFolder,
  });
}


/** Inspect torrent/magnet metadata without starting a managed torrent. */
export async function inspectTorrentNative(
  url: string,
  savePath: string,
): Promise<TorrentMetadataResult> {
  if (!isTauriEnvironment()) {
    throw new Error('The BitTorrent engine requires the Tauri desktop application.');
  }

  const actualPath = await resolveDownloadPath(savePath);
  return invoke<TorrentMetadataResult>('inspect_torrent', {
    url: url.trim(),
    savePath: actualPath,
  });
}

/** Read current librqbit progress for a managed torrent. */
export async function getTorrentProgressNative(
  torrentId: number,
): Promise<TorrentProgressResult> {
  if (!isTauriEnvironment()) {
    throw new Error('The BitTorrent engine requires the Tauri desktop application.');
  }

  return invoke<TorrentProgressResult>('torrent_progress', { torrentId });
}

/** Pause a managed librqbit torrent without deleting its state or files. */
export async function pauseTorrentNative(
  torrentId: number,
): Promise<void> {
  if (!isTauriEnvironment()) {
    throw new Error('The BitTorrent engine requires the Tauri desktop application.');
  }

  await invoke('pause_torrent', { torrentId });
}

/** Resume a paused managed librqbit torrent. */
export async function resumeTorrentNative(
  torrentId: number,
): Promise<void> {
  if (!isTauriEnvironment()) {
    throw new Error('The BitTorrent engine requires the Tauri desktop application.');
  }

  await invoke('resume_torrent', { torrentId });
}


/** Remove incomplete transfer artifacts from disk. Completed transfers are never passed here. */
export async function deleteIncompleteTransferNative(options: {
  path: string;
  torrentId?: number;
  torrentIsMultiFile?: boolean;
}): Promise<void> {
  if (!isTauriEnvironment()) return;

  const actualPath = await resolveDownloadPath(options.path);
  await invoke('delete_incomplete_transfer', {
    path: actualPath,
    torrentId: options.torrentId,
    torrentIsMultiFile: options.torrentIsMultiFile ?? false,
  });
}

/** Join filesystem path components using the host operating system. */
export async function joinPathNative(...parts: string[]): Promise<string> {
  const filtered = parts.filter(Boolean);
  if (filtered.length === 0) return '';
  return join(...filtered);
}

export interface TorrentEngineConfigPayload {
  listenPort?: number;
  randomizePort?: boolean;
  disableDht?: boolean;
  anonymousMode?: boolean;
  clientIdSpoof?: string;
}

/** Update the native BitTorrent engine configuration dynamically. */
export async function updateTorrentEngineConfigNative(
  config: TorrentEngineConfigPayload,
): Promise<void> {
  if (!isTauriEnvironment()) return;

  await invoke('update_torrent_engine_config', { config });
}

/**
 * Register or unregister .torrent / magnet file associations from within the
 * running app (e.g. triggered from the Settings window).
 *
 * Implemented via a native Rust command that writes HKCU registry keys
 * directly — no reg.exe / powershell subprocess is ever spawned, so no CMD
 * window appears.
 */
export async function registerFileAssociationsNative(options: {
  torrent: boolean;
  magnet: boolean;
}): Promise<void> {
  if (!isTauriEnvironment()) return;

  await invoke('register_file_associations', {
    torrent: options.torrent,
    magnet: options.magnet,
  });
}
