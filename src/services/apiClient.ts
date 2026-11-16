import { HttpSettings, BandwidthLimits, LibqrbitConfig, SystemSettings } from '../types';

export interface FsInfoResponse {
  path: string;
  exists: boolean;
  isDirectory: boolean;
  writable: boolean;
  userHome: string;
  downloadDir?: string;
  platform: string;
  diskStats: {
    totalGB: number;
    freeGB: number;
    usedPercentage: number;
  };
}

export interface OpenFolderResponse {
  success: boolean;
  launchedNative: boolean;
  headlessServer: boolean;
  platform: string;
  fileManager: string;
  resolvedPath: string;
  fileHighlighted: boolean;
}

export interface AssociationResponse {
  success: boolean;
  platform: string;
  torrentsAssociated: boolean;
  magnetsAssociated: boolean;
  message: string;
  timestamp: string;
}

export interface UpdateCheckResponse {
  success: boolean;
  currentVersion: string;
  latestVersion: string;
  channel: string;
  hasUpdate?: boolean;
  isUpToDate?: boolean;
  releaseDate?: string;
  mirror: string;
  sha256?: string;
  features?: string[];
  checkedAt?: string;
  releaseUrl?: string;
  releaseNotes?: string;
  publishedAt?: string;
  assets?: Array<{ name: string; downloadUrl: string; size: number }>;
}

export interface ProbeResponse {
  success: boolean;
  statusCode?: number;
  size: number;
  supportsRange: boolean;
  contentType?: string;
  fileName: string;
  resolvedUrl?: string;
  latencyMs: number;
  server?: string;
  message?: string;
}

export interface PortTestResponse {
  port: number;
  available: boolean;
  status: string;
  protocol?: string;
  reason?: string;
  testedAt?: string;
}

export interface TorrentFileItem {
  path: string;
  length: number;
  offset?: number;
}

export interface TorrentProbeResponse {
  success: boolean;
  name: string;
  size: number;
  infoHash?: string;
  files?: TorrentFileItem[];
  pieceLength?: number;
  pieceCount?: number;
  trackers?: string[];
  seeders: number;
  peers: number;
  latencyMs: number;
}

export interface MagnetResolveResponse {
  success: boolean;
  valid: boolean;
  infoHash?: string;
  name?: string;
  size?: number;
  files?: TorrentFileItem[];
  pieceLength?: number;
  pieceCount?: number;
  trackers?: string[];
  seeders?: number;
  peers?: number;
  dhtNodes?: number;
  magnetUri?: string;
  latencyMs?: number;
  error?: string;
}

export interface OptimalSegmentsResponse {
  success: boolean;
  optimalSegments: number;
  supportsRange: boolean;
  measuredMbps: number;
  rttMs: number;
  serverLatencyMs?: number;
  reason: string;
}

// JSON-RPC 2.0 Client (Direct Tauri IPC to Rust Daemon with HTTP Bridge Fallback)
export async function callRpc<T = any>(method: string, params?: Record<string, unknown>): Promise<T | null> {
  try {
    const winAny = typeof window !== 'undefined' ? (window as any) : null;
    if (winAny && ('__TAURI_INTERNALS__' in winAny || '__TAURI__' in winAny)) {
      const { invoke } = await import('@tauri-apps/api/core');
      const directRes = await invoke<T>('call_daemon_rpc', { method, params: params ?? null });
      if (directRes !== undefined && directRes !== null) {
        return directRes;
      }
    }
  } catch {
    // Fall back to /api/rpc HTTP bridge if Tauri direct socket isn't ready
  }

  try {
    const res = await fetch('/api/rpc', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method, params }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (data.error) return null;
    return (data.result ?? null) as T | null;
  } catch {
    return null;
  }
}

export const apiClient = {
  callRpc,
  // 1. Fetch persistent settings from backend
  async getSettings(): Promise<{
    httpSettings?: Partial<HttpSettings>;
    bandwidthLimits?: Partial<BandwidthLimits>;
    libqrbitConfig?: Partial<LibqrbitConfig>;
    systemSettings?: Partial<SystemSettings>;
  } | null> {
    try {
      const res = await fetch('/api/settings');
      if (!res.ok) return null;
      const data = await res.json();
      return data.settings;
    } catch {
      return null;
    }
  },

  // 2. Persist settings to backend JSON storage
  async saveSettings(payload: {
    httpSettings?: Partial<HttpSettings>;
    bandwidthLimits?: Partial<BandwidthLimits>;
    libqrbitConfig?: Partial<LibqrbitConfig>;
    systemSettings?: Partial<SystemSettings>;
  }): Promise<boolean> {
    try {
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      return res.ok;
    } catch {
      return false;
    }
  },

  // 3. Inspect filesystem and query drive space
  async getFsInfo(dirPath?: string): Promise<FsInfoResponse | null> {
    try {
      const url = dirPath ? `/api/system/fs/info?path=${encodeURIComponent(dirPath)}` : '/api/system/fs/info';
      const res = await fetch(url);
      if (!res.ok) return null;
      return await res.json();
    } catch {
      return null;
    }
  },

  // 4. Create directory on host filesystem
  async createDirectory(dirPath: string): Promise<boolean> {
    try {
      const res = await fetch('/api/system/fs/create-dir', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: dirPath }),
      });
      return res.ok;
    } catch {
      return false;
    }
  },

  // 4b. Launch native OS file manager at transfer destination directory
  async openDestinationFolder(dirPath: string, fileName?: string): Promise<OpenFolderResponse | null> {
    try {
      const res = await fetch('/api/system/fs/open-folder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: dirPath, fileName }),
      });
      if (!res.ok) return null;
      return await res.json();
    } catch {
      return null;
    }
  },

  // 4c. Open file directly with default application, or open folder if directory
  async openItem(targetPath: string): Promise<boolean> {
    try {
      const winAny = typeof window !== 'undefined' ? (window as any) : null;
      if (winAny && ('__TAURI_INTERNALS__' in winAny || '__TAURI__' in winAny)) {
        const { invoke } = await import('@tauri-apps/api/core');
        await invoke('open_item', { path: targetPath });
        return true;
      }
    } catch {
      // Fall through to RPC / HTTP
    }

    const rpcRes = await callRpc<{ success: boolean }>('system.fs.openItem', { path: targetPath });
    if (rpcRes?.success) return true;

    try {
      const res = await fetch('/api/system/fs/open-item', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: targetPath }),
      });
      return res.ok;
    } catch {
      return false;
    }
  },

  // 5. Register MIME file & magnet URI associations (+ custom .torrent document icon) on host OS
  async registerAssociations(torrents = true, magnets = true): Promise<AssociationResponse | null> {
    try {
      const winAny = typeof window !== 'undefined' ? (window as any) : null;
      if (winAny && ('__TAURI_INTERNALS__' in winAny || '__TAURI__' in winAny)) {
        const { invoke } = await import('@tauri-apps/api/core');
        const tauriRes = await invoke<AssociationResponse>('register_file_associations', { torrents, magnets });
        if (tauriRes?.success) return tauriRes;
      }
    } catch {
      // Fall back to RPC / HTTP below
    }

    const rpcRes = await callRpc<AssociationResponse>('system.associations.register', { torrents, magnets });
    if (rpcRes?.success) {
      return rpcRes;
    }

    try {
      const res = await fetch('/api/system/associations/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ torrents, magnets }),
      });
      if (!res.ok) return null;
      return await res.json();
    } catch {
      return null;
    }
  },

  // 6. Check official software updates on-demand against GitHub Releases
  async checkForUpdates(): Promise<UpdateCheckResponse | null> {
    const currentVersion = '2.0.4';
    try {
      const resp = await fetch('https://api.github.com/repos/Z-Sofware-Labs/FlowDown/releases/latest', {
        headers: {
          'Accept': 'application/vnd.github.v3+json',
        },
      });

      if (resp.ok) {
        const data = await resp.json();
        const tag = String(data.tag_name || '').trim();
        const cleanLatest = tag.replace(/^v/i, '');

        // Compare semver
        const p1 = cleanLatest.split('.').map((x: string) => parseInt(x, 10) || 0);
        const p2 = currentVersion.split('.').map((x: string) => parseInt(x, 10) || 0);
        let hasUpdate = false;
        for (let i = 0; i < Math.max(p1.length, p2.length); i++) {
          const n1 = p1[i] ?? 0;
          const n2 = p2[i] ?? 0;
          if (n1 > n2) {
            hasUpdate = true;
            break;
          }
          if (n1 < n2) {
            hasUpdate = false;
            break;
          }
        }

        const assets = Array.isArray(data.assets)
          ? data.assets.map((a: any) => ({
            name: String(a.name || ''),
            downloadUrl: String(a.browser_download_url || ''),
            size: Number(a.size || 0),
          }))
          : [];

        return {
          success: true,
          currentVersion,
          latestVersion: cleanLatest || currentVersion,
          hasUpdate,
          channel: 'Stable',
          mirror: 'GitHub Releases (Z-Sofware-Labs/FlowDown)',
          releaseUrl: data.html_url || 'https://github.com/Z-Sofware-Labs/FlowDown/releases',
          releaseNotes: data.body || '',
          publishedAt: data.published_at,
          assets,
        };
      }
    } catch (err) {
      console.warn('[Updater] On-demand GitHub API check error:', err);
    }

    return {
      success: true,
      currentVersion,
      latestVersion: currentVersion,
      hasUpdate: false,
      channel: 'Stable',
      mirror: 'GitHub Releases (Z-Sofware-Labs/FlowDown)',
      releaseUrl: 'https://github.com/Z-Sofware-Labs/FlowDown/releases',
    };
  },

  // 6b. Download and automatically execute the update installer with elevation
  async downloadAndApplyUpdate(
    downloadUrl: string,
    fileName: string,
    onProgress?: (data: { downloaded: number; total: number; percentage: number }) => void
  ): Promise<boolean> {
    try {
      const winAny = typeof window !== 'undefined' ? (window as any) : null;
      if (winAny && ('__TAURI_INTERNALS__' in winAny || '__TAURI__' in winAny)) {
        const { invoke } = await import('@tauri-apps/api/core');
        const { listen } = await import('@tauri-apps/api/event');
        let unlisten: (() => void) | null = null;
        if (onProgress) {
          unlisten = await listen<{ downloaded: number; total: number; percentage: number }>(
            'update-download-progress',
            (event) => onProgress(event.payload)
          );
        }
        try {
          return await invoke<boolean>('download_and_launch_update', { downloadUrl, fileName });
        } finally {
          if (unlisten) unlisten();
        }
      }
    } catch (err: any) {
      const msg = typeof err === 'string' ? err : err?.message || 'Failed to download and launch update installer';
      throw new Error(msg);
    }
    // Web fallback
    window.open(downloadUrl, '_blank');
    return true;
  },

  // 7. Probe remote HTTP URL for byte ranges and direct speed potential
  async probeHttpUrl(url: string, userAgent?: string): Promise<ProbeResponse | null> {
    const rpcRes = await callRpc<any>('http.probe', { url });
    if (rpcRes && (rpcRes.content_length !== undefined || rpcRes.file_name)) {
      return {
        success: true,
        statusCode: 200,
        size: Number(rpcRes.content_length || 0),
        supportsRange: Boolean(rpcRes.supports_ranges ?? true),
        contentType: String(rpcRes.content_type || 'application/octet-stream'),
        fileName: String(rpcRes.file_name || 'download.bin'),
        resolvedUrl: rpcRes.url && rpcRes.url !== url ? String(rpcRes.url) : undefined,
        latencyMs: Number(rpcRes.latency_ms || 15),
        server: String(rpcRes.server || 'http-server'),
      };
    }

    try {
      const res = await fetch('/api/http/probe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, userAgent }),
      });
      if (!res.ok) return null;
      return await res.json();
    } catch {
      return null;
    }
  },

  // 7a. Measure client connection RTT + throughput and probe optimal HTTP segment count
  async probeOptimalSegments(url?: string): Promise<OptimalSegmentsResponse | null> {
    try {
      // 1. Primary: Direct RPC to Rust daemon HTTP downloader probe
      const rpcRes = await callRpc<any>('http.probeOptimalSegments', { url: url || '' });
      if (rpcRes && typeof rpcRes.optimal_segments === 'number') {
        return {
          success: Boolean(rpcRes.success),
          optimalSegments: Number(rpcRes.optimal_segments || 16),
          supportsRange: Boolean(rpcRes.supports_ranges ?? true),
          measuredMbps: Number(rpcRes.measured_mbps || 28.4),
          rttMs: Number(rpcRes.rtt_ms || 24),
          serverLatencyMs: Number(rpcRes.rtt_ms || 24),
          reason: String(rpcRes.reason || ''),
        };
      }
    } catch {
      // fallback to browser fetch if running in pure web mode
    }

    try {
      let rttMs = 28;
      let measuredMbps = 0;

      // Measure live RTT + 256 KB download throughput against server
      try {
        const t0 = performance.now();
        const pingRes = await fetch('/api/settings', { cache: 'no-store' });
        if (pingRes.ok) {
          rttMs = Math.max(2, Math.round(performance.now() - t0));
        }

        const bwStart = performance.now();
        const bwRes = await fetch('/api/network/probe-bandwidth', { cache: 'no-store' });
        if (bwRes.ok) {
          const buf = await bwRes.arrayBuffer();
          const elapsedSec = Math.max(0.002, (performance.now() - bwStart - rttMs * 0.5) / 1000);
          const rawMbps = (buf.byteLength * 8) / (elapsedSec * 1_000_000);
          const navConn = (navigator as Navigator & { connection?: { downlink?: number; rtt?: number; effectiveType?: string } }).connection;
          if (navConn?.downlink && navConn.downlink > 0 && rawMbps > 400) {
            measuredMbps = navConn.downlink;
            if (navConn.rtt && navConn.rtt > 0) rttMs = navConn.rtt;
          } else {
            measuredMbps = Math.min(1000, Number(rawMbps.toFixed(1)));
          }
        }
      } catch {
        const navConn = (navigator as Navigator & { connection?: { downlink?: number; rtt?: number } }).connection;
        measuredMbps = navConn?.downlink || 35;
        rttMs = navConn?.rtt || 30;
      }

      const navConn = (navigator as Navigator & { connection?: { effectiveType?: string } }).connection;
      const res = await fetch('/api/http/probe-optimal-segments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: url || '',
          measuredMbps,
          rttMs,
          effectiveType: navConn?.effectiveType || '4g',
        }),
      });
      if (!res.ok) {
        return {
          success: true,
          optimalSegments: 16,
          supportsRange: true,
          measuredMbps: 28.4,
          rttMs: 24,
          serverLatencyMs: 24,
          reason: 'Broadband connection (16 parallel streams optimal).',
        };
      }
      return await res.json();
    } catch {
      return {
        success: true,
        optimalSegments: 16,
        supportsRange: true,
        measuredMbps: 28.4,
        rttMs: 24,
        serverLatencyMs: 24,
        reason: 'Broadband connection (16 parallel streams optimal).',
      };
    }
  },

  // 7b. Probe magnet URI / info hash / torrent name / .torrent base64 for metadata size & file list
  async probeTorrent(
    magnet: string,
    name?: string,
    contentBase64?: string,
    filePath?: string
  ): Promise<TorrentProbeResponse | null> {
    const rpcRes = await callRpc<any>('torrents.probe', {
      magnet,
      name,
      content_base64: contentBase64,
      file_path: filePath,
    });
    if (rpcRes && (rpcRes.name || rpcRes.info_hash || rpcRes.size)) {
      return {
        success: true,
        name: String(rpcRes.name || name || 'Download.torrent'),
        size: Number(rpcRes.size || 0),
        infoHash: String(rpcRes.info_hash || rpcRes.infoHash || ''),
        files: Array.isArray(rpcRes.files) ? rpcRes.files : [],
        pieceLength: rpcRes.piece_length ? Number(rpcRes.piece_length) : undefined,
        pieceCount: rpcRes.piece_count ? Number(rpcRes.piece_count) : undefined,
        trackers: Array.isArray(rpcRes.trackers) ? rpcRes.trackers : [],
        seeders: Number(rpcRes.seeders || 0),
        peers: Number(rpcRes.peers || 0),
        latencyMs: 18,
      };
    }

    try {
      const res = await fetch('/api/torrent/probe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ magnet, name, contentBase64 }),
      });
      if (!res.ok) return null;
      return await res.json();
    } catch {
      return null;
    }
  },

  // 7c. Resolve Magnet URI / BTIH info hash via backend
  async resolveMagnet(input: string): Promise<MagnetResolveResponse | null> {
    const rpcRes = await callRpc<any>('magnet.resolve', { input, announce: true });
    if (rpcRes && rpcRes.valid !== undefined) {
      return {
        success: Boolean(rpcRes.valid),
        valid: Boolean(rpcRes.valid),
        infoHash: rpcRes.info_hash || rpcRes.infoHash,
        name: rpcRes.name,
        size: Number(rpcRes.size || 0),
        files: Array.isArray(rpcRes.files) ? rpcRes.files : [],
        pieceLength: rpcRes.piece_length ? Number(rpcRes.piece_length) : undefined,
        pieceCount: rpcRes.piece_count ? Number(rpcRes.piece_count) : undefined,
        trackers: rpcRes.trackers || [],
        seeders: Number(rpcRes.seeders || 0),
        peers: Number(rpcRes.peers || 0),
        magnetUri: rpcRes.magnet_uri || rpcRes.magnetUri,
        error: rpcRes.error,
      };
    }

    try {
      const res = await fetch('/api/magnet/resolve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ input }),
      });
      if (!res.ok) return null;
      return await res.json();
    } catch {
      return null;
    }
  },

  // 7d. Queue resolved magnet transfer with backend
  async addMagnet(payload: {
    magnetUri: string;
    infoHash?: string;
    name: string;
    size: number;
    savePath: string;
  }): Promise<boolean> {
    try {
      const res = await fetch('/api/magnet/add', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      return res.ok;
    } catch {
      return false;
    }
  },

  // 8. Test stealth port on backend network interface
  async testStealthPort(port: number): Promise<PortTestResponse | null> {
    try {
      const res = await fetch('/api/stealth/test-port', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ port }),
      });
      if (!res.ok) return null;
      return await res.json();
    } catch {
      return null;
    }
  },

  async syncSnapshotRpc(): Promise<{
    transfers?: any[];
    stats?: {
      session_downloaded: number;
      session_uploaded: number;
      active_torrents_count: number;
      active_http_count: number;
      total_down_speed: number;
      total_up_speed: number;
      stealth_active: boolean;
      stealth_port: number;
      alt_speed_active: boolean;
    };
    logs?: string[];
  } | null> {
    return callRpc('core.syncSnapshot');
  },

  async checkDaemonStatus(): Promise<{
    daemon: string;
    app?: string;
    version: string;
    rustConnected: boolean;
  } | null> {
    const res = await callRpc<{ daemon?: string; app?: string; version?: string }>('core.getVersion');
    if (!res) return null;
    return {
      daemon: res.daemon || 'node-preview',
      app: res.app || 'FlowDown',
      version: res.version || '2.0.4',
      rustConnected: res.daemon === 'flowdownd',
    };
  },

  async listTransfersRpc(): Promise<any[] | null> {
    return callRpc<any[]>('torrents.list');
  },

  async getSessionStatsRpc(): Promise<{
    session_downloaded: number;
    session_uploaded: number;
    active_torrents_count: number;
    active_http_count: number;
    total_down_speed: number;
    total_up_speed: number;
    stealth_active: boolean;
    stealth_port: number;
    alt_speed_active: boolean;
  } | null> {
    return callRpc('core.getSessionStats');
  },

  async resetSessionStatsRpc(): Promise<boolean> {
    const res = await callRpc<{ success?: boolean }>('core.resetSessionStats');
    return !!res?.success;
  },

  async getLogsRpc(): Promise<string[] | null> {
    return callRpc<string[]>('core.getLogs');
  },

  async addHttpRpc(params: {
    url: string;
    name: string;
    size: number;
    segments_count: number;
    category: string;
    priority: string;
    libqrbit_enabled: boolean;
    obfuscation_level: number;
    save_path: string;
  }) {
    return callRpc('torrents.addHttp', params);
  },

  async addMagnetRpc(params: {
    url: string;
    name?: string;
    size?: number;
    category: string;
    priority: string;
    libqrbit_enabled: boolean;
    obfuscation_level: number;
    save_path: string;
  }) {
    return callRpc('torrents.addMagnet', params);
  },

  async addTorrentFileRpc(params: {
    file_path?: string;
    content_base64?: string;
    category: string;
    priority: string;
    libqrbit_enabled: boolean;
    obfuscation_level: number;
    save_path: string;
  }) {
    return callRpc('torrents.addFile', params);
  },

  async createTorrentRpc(params: {
    source_path: string;
    output_path: string;
    trackers: string[];
    piece_length: number;
    comment?: string;
    private?: boolean;
  }) {
    return callRpc<{
      info_hash?: string;
      name?: string;
      total_size?: number;
      piece_length?: number;
      piece_count?: number;
      output_path?: string;
    }>('torrents.create', params);
  },

  async analyzeEvasionRpc() {
    return callRpc<{
      recommended_profile?: string;
      udp_ephemeral_ok?: boolean;
      udp_bound_port?: number;
      port_6881_blocked?: boolean;
      dns_latency_ms?: number;
      doh_latency_ms?: number;
      doh_working?: boolean;
      tcp_443_reachable?: boolean;
      tcp_443_latency_ms?: number;
      single_stream_kbps?: number;
      multi_stream_mbps?: number;
      isp_throttling_suspected?: boolean;
      estimated_recovery_mbps?: number;
      mse_entropy_bits?: number;
      plain_hex_sample?: string;
      mse_hex_sample?: string;
      recommended_segments?: number;
      notes?: string[];
    }>('stealth.analyzeEvasion');
  },

  async pauseTransferRpc(id: string) {
    return callRpc('torrents.pause', { id });
  },

  async stopTransferRpc(id: string) {
    return callRpc('torrents.stop', { id });
  },

  async resumeTransferRpc(id: string) {
    return callRpc('torrents.resume', { id });
  },

  async deleteTransferRpc(id: string, delete_files = false) {
    return callRpc('torrents.delete', { id, delete_files });
  },

  async renameTransferRpc(id: string, name: string) {
    return callRpc('torrents.rename', { id, name });
  },

  async recheckTransferRpc(id: string) {
    return callRpc('torrents.recheck', { id });
  },

  async setPriorityRpc(id: string, priority: string) {
    return callRpc('torrents.setPriority', { id, priority });
  },

  async setSpeedLimitRpc(id: string, limit_kbps: number | null) {
    return callRpc('torrents.setSpeedLimit', { id, limit_kbps });
  },

  async setObfuscationRpc(id: string, obfuscation_level: number) {
    return callRpc('torrents.setObfuscationLevel', { id, obfuscation_level });
  },

  async pauseAllRpc() {
    return callRpc('torrents.pauseAll');
  },

  async resumeAllRpc() {
    return callRpc('torrents.resumeAll');
  },

  async toggleTurtleRpc() {
    return callRpc<{ limited?: boolean }>('bandwidth.toggleTurtle');
  },

  async setTurtleRpc(active: boolean) {
    return callRpc('bandwidth.setTurtle', { active });
  },

  async setStealthRpc(active: boolean) {
    return callRpc('stealth.set', { active });
  },

  async randomizeStealthPortRpc() {
    return callRpc<{ success?: boolean; port?: number }>('stealth.randomizePort');
  },

  async setHttpSegmentsRpc(segmentsCount: number, id?: string) {
    return callRpc<{ success: boolean; segments_count: number }>('torrents.setSegments', {
      segments_count: segmentsCount,
      id: id || undefined,
    });
  },
};
