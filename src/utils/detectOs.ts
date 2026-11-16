export type OsStyle = 'windows' | 'macos' | 'linux';

let resolvedUserHome: string | null = null;
let resolvedDownloadDir: string | null = null;

/**
 * Updates the runtime-resolved OS user home and Downloads directories
 * once discovered from the Tauri host or backend daemon.
 */
export function setResolvedOsPaths(paths: { userHome?: string; downloadDir?: string }) {
  if (paths.userHome && paths.userHome.trim()) {
    resolvedUserHome = paths.userHome.trim();
  }
  if (paths.downloadDir && paths.downloadDir.trim()) {
    resolvedDownloadDir = paths.downloadDir.trim();
  }
}

/**
 * Automatically and strictly detects the host operating system
 * from browser environment cues (navigator.userAgentData, platform, userAgent).
 * Conforms strictly to OS interface guidelines without manual user override.
 */
export function detectHostOs(): OsStyle {
  if (typeof navigator !== 'undefined') {
    const navAny = navigator as any;
    if (navAny.userAgentData && navAny.userAgentData.platform) {
      const p = String(navAny.userAgentData.platform).toLowerCase();
      if (p.includes('mac') || p.includes('ios')) return 'macos';
      if (p.includes('win')) return 'windows';
      if (p.includes('linux')) return 'linux';
    }

    const ua = (navigator.userAgent || navigator.platform || '').toLowerCase();
    if (ua.includes('mac') || ua.includes('iphone') || ua.includes('ipad') || ua.includes('darwin')) {
      return 'macos';
    }
    if (ua.includes('linux') || ua.includes('x11') || ua.includes('bsd')) {
      return 'linux';
    }
    if (ua.includes('win')) {
      return 'windows';
    }
  }
  return 'windows';
}

/**
 * Returns the user's home directory for the detected host OS.
 */
export function getDefaultUserHome(os: OsStyle = detectHostOs()): string {
  if (resolvedUserHome) {
    return resolvedUserHome;
  }
  switch (os) {
    case 'windows':
      return 'C:\\Users\\user';
    case 'macos':
      return '/Users/user';
    case 'linux':
    default:
      return '/home/user';
  }
}

/**
 * Returns true if the given path is empty or uses the generic placeholder "user" home directory
 * (e.g. C:\Users\user\Downloads, /Users/user/Downloads, /home/user/Downloads).
 */
export function isPlaceholderDownloadPath(pathStr?: string | null): boolean {
  if (!pathStr || !pathStr.trim()) return true;
  const trimmed = pathStr.trim();
  return /^(?:[a-zA-Z]:\\Users\\user|\/Users\/user|\/home\/user)(?:[\\/]|$)/i.test(trimmed);
}

/**
 * Returns the full default Downloads directory path for the detected host OS.
 * Follows OS guidelines:
 * - Windows: C:\Users\<Username>\Downloads (KNOWNFOLDERID_Downloads)
 * - macOS: /Users/<Username>/Downloads (NSDownloadsDirectory)
 * - Linux: $XDG_DOWNLOAD_DIR or /home/<username>/Downloads (XDG Base Directory / user-dirs)
 */
export function getDefaultDownloadPath(os: OsStyle = detectHostOs()): string {
  if (resolvedDownloadDir) {
    return resolvedDownloadDir;
  }
  const sep = getOsPathSeparator(os);
  if (resolvedUserHome) {
    return `${resolvedUserHome.replace(/[\\/]+$/, '')}${sep}Downloads`;
  }
  switch (os) {
    case 'windows':
      return 'C:\\Users\\Alvin\\Downloads';
    case 'macos':
      return '/Users/user/Downloads';
    case 'linux':
    default:
      return '/home/user/Downloads';
  }
}

/**
 * Resolves a saved download directory, upgrading any empty or placeholder path
 * to the real OS Downloads directory.
 */
export function resolveOsDownloadDirectory(savedPath?: string | null, os: OsStyle = detectHostOs()): string {
  if (!savedPath || isPlaceholderDownloadPath(savedPath)) {
    return getDefaultDownloadPath(os);
  }
  return savedPath.trim();
}

export function getOsPathSeparator(os: OsStyle = detectHostOs()): '\\' | '/' {
  return os === 'windows' ? '\\' : '/';
}

