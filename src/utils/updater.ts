import { isTauri } from '@tauri-apps/api/core';
import { check, Update } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';

export interface AppUpdateInfo {
  available: boolean;
  currentVersion: string;
  version?: string;
  date?: string;
  body?: string;
  rawUpdate?: Update;
}

export type UpdateDownloadProgress = {
  downloaded: number;
  contentLength: number | null;
  percentage: number;
};

/**
 * Check GitHub Releases for available FlowDown updates.
 */
export async function checkForUpdate(): Promise<AppUpdateInfo> {
  if (!isTauri()) {
    return {
      available: false,
      currentVersion: '1.0.5',
    };
  }

  try {
    const update = await check();
    if (!update) {
      return {
        available: false,
        currentVersion: '1.0.5',
      };
    }

    return {
      available: update.available,
      currentVersion: update.currentVersion,
      version: update.version,
      date: update.date,
      body: update.body,
      rawUpdate: update,
    };
  } catch (err) {
    console.error('[FlowDown Updater] Check failed:', err);
    throw err;
  }
}

/**
 * Download and install the update with download progress callbacks.
 */
export async function downloadAndInstallUpdate(
  update: Update,
  onProgress?: (progress: UpdateDownloadProgress) => void
): Promise<void> {
  let downloaded = 0;
  let contentLength: number | null = null;

  await update.downloadAndInstall((event) => {
    switch (event.event) {
      case 'Started':
        contentLength = event.data.contentLength ?? null;
        if (onProgress) {
          onProgress({
            downloaded: 0,
            contentLength,
            percentage: 0,
          });
        }
        break;
      case 'Progress':
        downloaded += event.data.chunkLength;
        if (onProgress) {
          const percentage =
            contentLength && contentLength > 0
              ? Math.min(100, Math.round((downloaded / contentLength) * 100))
              : 0;
          onProgress({
            downloaded,
            contentLength,
            percentage,
          });
        }
        break;
      case 'Finished':
        if (onProgress) {
          onProgress({
            downloaded,
            contentLength,
            percentage: 100,
          });
        }
        break;
    }
  });
}

/**
 * Relaunch the application after an update has been installed.
 */
export async function relaunchApp(): Promise<void> {
  if (isTauri()) {
    try {
      await relaunch();
    } catch {
      window.location.reload();
    }
  } else {
    window.location.reload();
  }
}
