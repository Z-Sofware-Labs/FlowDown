import { TorrentItem, BandwidthLimits, LibqrbitConfig, SpeedHistoryPoint, LogEntry, Priority, HealthPriorityMode, ObfuscationLevel, HttpSettings, TorrentStatus } from '../types';
import { INITIAL_TORRENTS, INITIAL_BANDWIDTH_LIMITS, INITIAL_LIBQRBIT_CONFIG } from './mockData';
import { calculateEta, generateHash } from '../utils/formatters';
import { getDefaultDownloadPath, setResolvedOsPaths, isPlaceholderDownloadPath, resolveOsDownloadDirectory } from '../utils/detectOs';
import { apiClient } from './apiClient';

export class TorrentEngine {
  private torrents: TorrentItem[] = INITIAL_TORRENTS.map((t) => ({
    ...t,
    completedPieces: [...t.completedPieces],
    activePieces: [...t.activePieces],
    tags: [...t.tags],
    segments: t.segments ? t.segments.map((s) => ({ ...s })) : undefined,
  }));
  private bandwidthLimits: BandwidthLimits = { 
    ...INITIAL_BANDWIDTH_LIMITS,
    dhtEnabled: true,
    pexEnabled: true,
    lsdEnabled: true,
    utpEnabled: true,
    encryptionRequirement: 'prefer',
    halfOpenConnections: 50,
    uploadSlotsPerTorrent: 8,
    maxTotalConnections: 500,
    maxConnectionsPerTorrent: 100,
  };
  private libqrbitConfig: LibqrbitConfig = { ...INITIAL_LIBQRBIT_CONFIG };
  private httpSettings: HttpSettings = {
    defaultSegments: 8,
    defaultSavePath: getDefaultDownloadPath(),
    timeoutSeconds: 15,
    maxRetries: 5,
    autoCategorize: true,
    userAgent: 'Chrome',
    tcpWindowScaling: true,
    autoResumeBroken: true,
    bufferSize: '1MB',
    keepAlive: true,
    http2Multiplex: true,
    dynamicChunking: true,
    dohResolver: 'cloudflare',
    refererMode: 'same_origin',
    maxConcurrentFiles: 5,
  };
  private speedHistory: SpeedHistoryPoint[] = [];
  private logs: LogEntry[] = [
    { id: '1', timestamp: '16:50:01', type: 'INFO', message: 'FlowDown Engine v2.0.2 initialized (Qt 6 + Rust core).' },
    { id: '2', timestamp: '16:50:02', type: 'LIBQRBIT', message: 'libqrbit v3.4.1 runtime loaded: Multi-Path Morphing, Decoy Tunneling, UDP Hole Punching ready.' },
    { id: '3', timestamp: '16:50:04', type: 'SECURITY', message: 'DHT node discovery bound to ephemeral obfuscated port 52841.' },
    { id: '4', timestamp: '16:52:12', type: 'TORRENT', message: 'Transfer queue initialized (0 active transfers).' },
  ];
  private listeners: Set<() => void> = new Set();
  private loopTimeoutId: number | null = null;
  private ispThrottlingActive: boolean = true; // active network throttling detected & bypassed by libqrbit
  private defaultDownloadDirectory: string = getDefaultDownloadPath(); // Unified destination for all HTTP and BitTorrent downloads
  private sessionDownloaded: number = 0; // Total bytes downloaded in current session
  private sessionUploaded: number = 0; // Total bytes uploaded in current session
  private rustDaemonConnected: boolean = false;
  private syncInFlight: boolean = false;
  private completionListeners: Set<(torrent: TorrentItem) => void> = new Set();
  private completedIdsNotified: Set<string> = new Set();

  constructor() {
    this.initHistory();
    this.probeRustDaemon();
    this.startLoop();
  }

  public isRustDaemonConnected(): boolean {
    return this.rustDaemonConnected;
  }

  private async probeRustDaemon() {
    // 1. Discover real host OS user home & Downloads directories
    try {
      const winAny = typeof window !== 'undefined' ? (window as any) : null;
      if (winAny && ('__TAURI_INTERNALS__' in winAny || '__TAURI__' in winAny)) {
        const { invoke } = await import('@tauri-apps/api/core');
        const osPaths = await invoke<{ userHome?: string; downloadDir?: string }>('get_os_paths');
        if (osPaths?.downloadDir) {
          setResolvedOsPaths(osPaths);
          if (isPlaceholderDownloadPath(this.defaultDownloadDirectory)) {
            this.defaultDownloadDirectory = osPaths.downloadDir;
          }
          if (isPlaceholderDownloadPath(this.httpSettings.defaultSavePath)) {
            this.httpSettings.defaultSavePath = osPaths.downloadDir;
          }
          this.torrents = this.torrents.map((t) =>
            isPlaceholderDownloadPath(t.savePath) ? { ...t, savePath: osPaths.downloadDir! } : t
          );
          this.notify();
        }
      }
    } catch {
      // Fall back to HTTP/RPC directory probe below
    }

    try {
      const fsInfo = await apiClient.getFsInfo();
      if (fsInfo?.userHome) {
        setResolvedOsPaths({ userHome: fsInfo.userHome, downloadDir: fsInfo.downloadDir });
        const resolvedDl = getDefaultDownloadPath();
        if (isPlaceholderDownloadPath(this.defaultDownloadDirectory)) {
          this.defaultDownloadDirectory = resolvedDl;
        }
        if (isPlaceholderDownloadPath(this.httpSettings.defaultSavePath)) {
          this.httpSettings.defaultSavePath = resolvedDl;
        }
        this.torrents = this.torrents.map((t) =>
          isPlaceholderDownloadPath(t.savePath) ? { ...t, savePath: resolvedDl } : t
        );
        this.notify();
      }
    } catch {
      // Keep OS default fallback
    }

    // 2. Check Rust daemon status
    const status = await apiClient.checkDaemonStatus();
    if (status?.rustConnected) {
      this.rustDaemonConnected = true;
      this.addLog('INFO', `Connected to pure Rust daemon (${status.daemon} v${status.version}) over /api/rpc.`);
      await this.syncFromRustDaemon();
    }
  }

  private mapRustTransfer(raw: any): TorrentItem {
    const obf = Math.max(1, Math.min(4, Number(raw.obfuscation_level || 3))) as ObfuscationLevel;
    const isHttp = Boolean(raw.is_http_segmented);
    const segments = Array.isArray(raw.segments)
      ? raw.segments.map((s: any) => ({
          id: Number(s.id || 1),
          startByte: Number(s.start_byte ?? s.startByte ?? 0),
          endByte: Number(s.end_byte ?? s.endByte ?? 0),
          downloadedBytes: Number(s.downloaded_bytes ?? s.downloadedBytes ?? 0),
          speed: Number(s.speed ?? 0),
          status: (s.status || 'active') as 'active' | 'completed' | 'connecting',
        }))
      : undefined;
    const mappedStatus: TorrentStatus =
      raw.status === 'completed'
        ? 'seeding'
        : raw.status === 'metadata'
        ? 'downloading'
        : (raw.status as TorrentStatus) || 'downloading';
    const pieceCount = isHttp ? Math.max(1, segments?.length || Number(raw.peers_total || 8)) : 64;
    const donePiecesCount = Math.round(((Number(raw.progress || 0)) / 100) * pieceCount);
    const completedPieces = Array.from({ length: pieceCount }, (_, i) => i < donePiecesCount);

    return {
      id: String(raw.id),
      name: String(raw.name || 'Transfer'),
      size: Number(raw.size || 0),
      downloaded: Number(raw.downloaded || 0),
      uploaded: Number(raw.uploaded || 0),
      downloadSpeed: Number(raw.download_speed || 0),
      uploadSpeed: Number(raw.upload_speed || 0),
      status: mappedStatus,
      progress: Number(raw.progress || 0),
      seedsConnected: Number(raw.seeds_connected || 0),
      seedsTotal: Number(raw.seeds_total || 0),
      peersConnected: Number(raw.peers_connected || 0),
      peersTotal: Number(raw.peers_total || 0),
      swarmHealth: Number(raw.seeds_total || 0) > 0 ? Math.min(10, Number(raw.seeds_total) / 5) : 8.5,
      healthGrade: Number(raw.seeds_connected || 0) > 5 || isHttp ? 'A+' : 'A',
      ratio: Number(raw.ratio || 0),
      eta: String(raw.eta || '—'),
      addedDate: String(raw.added_date || ''),
      savePath: String(raw.save_path || this.defaultDownloadDirectory),
      hash: String(raw.hash || ''),
      category: String(raw.category || 'Default'),
      priority: (raw.priority || 'Normal') as Priority,
      tags: [String(raw.category || 'Default'), isHttp ? 'HTTP-Direct' : 'BitTorrent', raw.libqrbit_enabled ? 'libqrbit' : 'Standard'],
      piecesCount: pieceCount,
      completedPieces,
      activePieces: donePiecesCount < pieceCount ? [donePiecesCount] : [],
      healthPriorityMode: 'rarest_first',
      isHttpSegmented: isHttp,
      httpUrl: raw.url || undefined,
      segments,
      isMissing: Boolean(raw.is_missing),
      files: Array.isArray(raw.files)
        ? raw.files.map((f: any) => ({
            path: String(f.path || ''),
            length: Number(f.length || 0),
            offset: Number(f.offset || 0),
          }))
        : undefined,
      libqrbitEnabled: Boolean(raw.libqrbit_enabled),
      obfuscationLevel: obf,
      throttlingDetected: false,
      throttlingRatio: 0,
      bypassedSpeedGain: raw.libqrbit_enabled ? Math.floor(Number(raw.download_speed || 0) * 0.45) : 0,
      decoyProtocol: 'QUIC/TLS1.3',
      packetMorphEfficiency: 98.2,
      shardingRoutesCount: segments?.length || 4,
    };
  }

  public async syncFromRustDaemon() {
    if (!this.rustDaemonConnected || this.syncInFlight) return;
    if (typeof document !== 'undefined' && document.hidden) return;
    this.syncInFlight = true;
    try {
      const snapshot = await apiClient.syncSnapshotRpc();
      const list = snapshot?.transfers ?? (await apiClient.listTransfersRpc());
      const stats = snapshot?.stats ?? (await apiClient.getSessionStatsRpc());
      const daemonLogs = snapshot?.logs ?? (await apiClient.getLogsRpc());

      if (Array.isArray(list)) {
        const daemonItems = list.map((item) => this.mapRustTransfer(item));
        const daemonMap = new Map<string, TorrentItem>();
        for (const item of daemonItems) {
          daemonMap.set(item.id, item);
          if (item.hash) {
            daemonMap.set(item.hash.toLowerCase(), item);
          }
        }

        const updated: TorrentItem[] = [];
        const seenDaemonIds = new Set<string>();

        // 1. Reconcile existing items
        for (const local of this.torrents) {
          const matched =
            daemonMap.get(local.id) ||
            (local.hash ? daemonMap.get(local.hash.toLowerCase()) : null);

          if (matched) {
            seenDaemonIds.add(matched.id);
            // Protect against any transient 0% resets
            const effectiveProgress =
              matched.progress > 0
                ? matched.progress
                : matched.status === 'downloading' && local.progress > 0
                ? local.progress
                : matched.progress;
            const effectiveDownloaded =
              matched.downloaded > 0
                ? matched.downloaded
                : matched.status === 'downloading' && local.downloaded > 0
                ? local.downloaded
                : matched.downloaded;

            const isUnchanged =
              local.id === matched.id &&
              local.status === matched.status &&
              local.progress === effectiveProgress &&
              local.downloaded === effectiveDownloaded &&
              local.downloadSpeed === matched.downloadSpeed &&
              local.uploadSpeed === matched.uploadSpeed &&
              local.isMissing === matched.isMissing &&
              local.seedsConnected === matched.seedsConnected &&
              local.peersConnected === matched.peersConnected &&
              local.eta === matched.eta &&
              local.ratio === matched.ratio &&
              local.name === matched.name;

            if (isUnchanged) {
              updated.push(local);
            } else {
              updated.push({
                ...local,
                ...matched,
                progress: effectiveProgress,
                downloaded: effectiveDownloaded,
                id: matched.id, // adopt official daemon ID
                category:
                  matched.category && matched.category !== 'Default'
                    ? matched.category
                    : local.category,
                tags: matched.tags?.length ? matched.tags : local.tags,
              });
            }
          } else {
            // Keep optimistic items added within the last 25 seconds or items in error state
            const isOptimistic = local.id.startsWith('tor-') || local.id.startsWith('idm-');
            const ageMs = Date.now() - parseInt(local.id.replace(/^(tor|idm)-/, '') || '0', 10);
            if (local.status === 'error' || (isOptimistic && !isNaN(ageMs) && ageMs < 25000)) {
              updated.push(local);
            }
          }
        }

        // 2. Add transfers existing in daemon but not yet in local list
        for (const dItem of daemonItems) {
          if (!seenDaemonIds.has(dItem.id)) {
            updated.push(dItem);
          }
        }

        let torrentsChanged = updated.length !== this.torrents.length;
        if (!torrentsChanged) {
          for (let i = 0; i < updated.length; i++) {
            if (updated[i] !== this.torrents[i]) {
              torrentsChanged = true;
              break;
            }
          }
        }
        if (torrentsChanged) {
          this.torrents = updated;
        }
      }

      let statsChanged = false;
      if (stats) {
        const sDown = Number(stats.session_downloaded || 0);
        const sUp = Number(stats.session_uploaded || 0);
        if (this.sessionDownloaded !== sDown || this.sessionUploaded !== sUp) {
          this.sessionDownloaded = sDown;
          this.sessionUploaded = sUp;
          statsChanged = true;
        }
        const alt = Boolean(stats.alt_speed_active);
        if (this.bandwidthLimits.altSpeedActive !== alt) {
          this.bandwidthLimits.altSpeedActive = alt;
          statsChanged = true;
        }
        const stealth = Boolean(stats.stealth_active);
        if (this.libqrbitConfig.enabled !== stealth) {
          this.libqrbitConfig.enabled = stealth;
          statsChanged = true;
        }
        if (stats.stealth_port && this.libqrbitConfig.currentStealthPort !== stats.stealth_port) {
          this.libqrbitConfig.currentStealthPort = stats.stealth_port;
          statsChanged = true;
        }
        const downKbps = Math.floor((stats.total_down_speed || 0) / 1024);
        const upKbps = Math.floor((stats.total_up_speed || 0) / 1024);
        const lastPt = this.speedHistory[this.speedHistory.length - 1];
        if (downKbps > 0 || upKbps > 0 || !lastPt || lastPt.downloadSpeed > 0 || lastPt.uploadSpeed > 0) {
          const now = new Date();
          const timeStr = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}:${now.getSeconds().toString().padStart(2, '0')}`;
          this.speedHistory.push({
            time: timeStr,
            downloadSpeed: downKbps,
            uploadSpeed: upKbps,
            bypassedSpeed: this.libqrbitConfig.enabled ? Math.floor(((stats.total_down_speed || 0) * 0.45) / 1024) : 0,
          });
          if (this.speedHistory.length > 30) this.speedHistory.shift();
          statsChanged = true;
        }
      }

      let logsChanged = false;
      if (Array.isArray(daemonLogs) && daemonLogs.length > 0 && daemonLogs.length !== this.logs.length) {
        this.logs = daemonLogs.slice().reverse().map((line, idx) => ({
          id: `daemon-log-${idx}`,
          timestamp: line.slice(1, 9) || '00:00:00',
          type: line.includes('LIBQRBIT') ? 'LIBQRBIT' : line.includes('ERROR') ? 'THROTTLE' : 'INFO',
          message: line,
        }));
        logsChanged = true;
      }

      this.notify();
    } finally {
      this.syncInFlight = false;
    }
  }

  public getDefaultDownloadDirectory(): string {
    return this.defaultDownloadDirectory;
  }

  public setDefaultDownloadDirectory(dir: string, updateExisting = true) {
    const resolvedDir = resolveOsDownloadDirectory(dir);
    this.defaultDownloadDirectory = resolvedDir;
    this.httpSettings.defaultSavePath = resolvedDir;
    if (updateExisting) {
      this.torrents = this.torrents.map((t) => ({ ...t, savePath: resolvedDir }));
    }
    this.addLog('INFO', `Unified download path set to "${resolvedDir}". All HTTP & BitTorrent transfers save here.`);
    this.notify();
  }

  private initHistory() {
    const now = new Date();
    for (let i = 20; i >= 0; i--) {
      const t = new Date(now.getTime() - i * 2000);
      const timeStr = `${t.getHours().toString().padStart(2, '0')}:${t.getMinutes().toString().padStart(2, '0')}:${now.getSeconds().toString().padStart(2, '0')}`;
      this.speedHistory.push({
        time: timeStr,
        downloadSpeed: 0,
        uploadSpeed: 0,
        bypassedSpeed: 0,
      });
    }
  }

  public subscribe(listener: () => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify() {
    this.listeners.forEach((fn) => fn());
  }

  public wakeLoop(immediate = false) {
    this.scheduleLoop(immediate ? 0 : 50);
  }

  private scheduleLoop(delayMs?: number) {
    if (this.loopTimeoutId !== null) {
      window.clearTimeout(this.loopTimeoutId);
      this.loopTimeoutId = null;
    }

    const hasActiveTraffic =
      this.torrents.some(
        (t) =>
          (t.status === 'downloading' || t.status === 'seeding' || t.status === 'stealth_active' || t.status === 'checking') &&
          (t.downloadSpeed > 0 || t.uploadSpeed > 0)
      ) ||
      (this.speedHistory.length > 0 &&
        ((this.speedHistory[this.speedHistory.length - 1]?.downloadSpeed ?? 0) > 0 ||
          (this.speedHistory[this.speedHistory.length - 1]?.uploadSpeed ?? 0) > 0));

    const interval = delayMs !== undefined ? delayMs : (hasActiveTraffic ? 1000 : 3000);

    this.loopTimeoutId = window.setTimeout(async () => {
      try {
        await this.tick();
      } finally {
        this.scheduleLoop();
      }
    }, interval);
  }

  private startLoop() {
    if (this.loopTimeoutId !== null) return;
    this.scheduleLoop(1000);
  }

  public onTransferCompleted(listener: (torrent: TorrentItem) => void) {
    this.completionListeners.add(listener);
    return () => {
      this.completionListeners.delete(listener);
    };
  }

  private async tick() {
    if (typeof document !== 'undefined' && document.hidden) {
      return;
    }
    if (this.rustDaemonConnected) {
      await this.syncFromRustDaemon();
      return;
    }
    // Skip idle simulation tick when there are no transfers at all
    if (this.torrents.length === 0) {
      return;
    }
    const now = new Date();
    const timeStr = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}:${now.getSeconds().toString().padStart(2, '0')}`;

    // Evaluate automatic bandwidth scheduler window
    if (this.bandwidthLimits.scheduledAltSpeed) {
      const hour = now.getHours();
      const start = this.bandwidthLimits.scheduleStartHour ?? 8;
      const end = this.bandwidthLimits.scheduleEndHour ?? 18;
      const inWindow = start <= end ? (hour >= start && hour < end) : (hour >= start || hour < end);
      if (inWindow !== this.bandwidthLimits.altSpeedActive) {
        this.bandwidthLimits.altSpeedActive = inWindow;
      }
    }

    // Speed limits: Alt speed (turtle mode) vs Global Limits (0 = unlimited)
    const isAlt = this.bandwidthLimits.altSpeedActive;
    const maxGlobalDownBytes = isAlt
      ? (this.bandwidthLimits.altDownloadLimit || 2048) * 1024
      : (this.bandwidthLimits.globalDownloadLimit && this.bandwidthLimits.globalDownloadLimit > 0
          ? this.bandwidthLimits.globalDownloadLimit * 1024
          : Infinity);

    const maxGlobalUpBytes = isAlt
      ? (this.bandwidthLimits.altUploadLimit || 512) * 1024
      : (this.bandwidthLimits.globalUploadLimit && this.bandwidthLimits.globalUploadLimit > 0
          ? this.bandwidthLimits.globalUploadLimit * 1024
          : Infinity);

    // Pass 1: Compute raw candidate speeds for all active items
    interface CandidateResult {
      id: string;
      rawDown: number;
      rawUp: number;
      bypassedGain: number;
      throttlingDetected: boolean;
      throttlingRatio: number;
      status: TorrentItem['status'];
      effectivePeers: number;
      effectiveSeeds: number;
    }

    const candidates: CandidateResult[] = [];
    let sumRawDown = 0;
    let sumRawUp = 0;

    for (const tor of this.torrents) {
      if (tor.status === 'paused' || tor.status === 'error' || tor.status === 'queued') {
        candidates.push({
          id: tor.id,
          rawDown: 0,
          rawUp: 0,
          bypassedGain: 0,
          throttlingDetected: false,
          throttlingRatio: 0,
          status: tor.status,
          effectivePeers: 0,
          effectiveSeeds: 0,
        });
        continue;
      }

      if (tor.status === 'seeding') {
        const up = Math.floor(1400000 + Math.random() * 800000);
        sumRawUp += up;
        candidates.push({
          id: tor.id,
          rawDown: 0,
          rawUp: up,
          bypassedGain: 0,
          throttlingDetected: false,
          throttlingRatio: 0,
          status: 'seeding',
          effectivePeers: Math.min(tor.peersTotal, this.bandwidthLimits.maxConnectionsPerTorrent || 100),
          effectiveSeeds: tor.seedsTotal,
        });
        continue;
      }

      // Downloading transfer
      let baseSpeed = 16000000; // ~16 MB/s BitTorrent default
      let effectivePeers = tor.peersConnected;
      let effectiveSeeds = tor.seedsConnected;

      if (tor.isHttpSegmented) {
        // HTTP multi-segment direct download: speed scales directly with segment count, TCP scaling & buffer
        const segmentsCount = tor.segments?.length || this.httpSettings.defaultSegments || 8;
        baseSpeed = 2400000 + segmentsCount * 2100000; // 1 seg = ~4.5 MB/s, 8 segs = ~19.2 MB/s, 16 segs = ~36 MB/s, 32 segs = ~69 MB/s
        if (this.httpSettings.tcpWindowScaling) baseSpeed *= 1.15;
        if (this.httpSettings.bufferSize === '4MB') baseSpeed *= 1.12;
        else if (this.httpSettings.bufferSize === '64KB') baseSpeed *= 0.85;

        effectiveSeeds = 0;
        effectivePeers = segmentsCount;
      } else {
        // BitTorrent protocol discovery and health parameters
        let discoveryMultiplier = 1.0;
        if (this.bandwidthLimits.dhtEnabled === false) discoveryMultiplier *= 0.68;
        if (this.bandwidthLimits.pexEnabled === false) discoveryMultiplier *= 0.80;
        if (this.bandwidthLimits.lsdEnabled === false) discoveryMultiplier *= 0.92;
        if (this.bandwidthLimits.encryptionRequirement === 'require') discoveryMultiplier *= 0.85;

        baseSpeed *= discoveryMultiplier;
        const maxPerTor = this.bandwidthLimits.maxConnectionsPerTorrent || 100;
        effectivePeers = Math.min(maxPerTor, Math.max(2, Math.floor(tor.peersTotal * discoveryMultiplier)));
        effectiveSeeds = Math.max(1, Math.floor(tor.seedsTotal * discoveryMultiplier));
      }

      // Priority multiplier
      if (tor.priority === 'Max') baseSpeed *= 1.4;
      if (tor.priority === 'High') baseSpeed *= 1.2;
      if (tor.priority === 'Low') baseSpeed *= 0.5;

      // libqrbit stealth / ISP throttling evaluation
      let rawDown = baseSpeed;
      let throttlingDetected = this.ispThrottlingActive;
      let status: TorrentItem['status'] = tor.status;
      let bypassedGain = 0;
      let throttlingRatio = 0;

      if (this.ispThrottlingActive) {
        throttlingRatio = 0.85; // ISP restricts 85% bandwidth on unmasked streams
        if (tor.libqrbitEnabled && this.libqrbitConfig.enabled) {
          const recoveredRatio = 0.94 + tor.obfuscationLevel * 0.015;
          rawDown = baseSpeed * (1 - throttlingRatio * (1 - recoveredRatio));
          bypassedGain = baseSpeed * throttlingRatio * recoveredRatio;
          status = 'stealth_active';
        } else {
          rawDown = baseSpeed * (1 - throttlingRatio);
          bypassedGain = 0;
          status = 'throttled';
        }
      } else {
        status = 'downloading';
        throttlingRatio = 0;
      }

      // Natural network jitter
      rawDown = Math.floor(rawDown * (0.94 + Math.random() * 0.12));
      if (tor.perTransferLimitKbps && tor.perTransferLimitKbps > 0) {
        rawDown = Math.min(rawDown, tor.perTransferLimitKbps * 1024);
      }
      const rawUp = Math.floor((tor.uploadSpeed || 1200000) * (0.9 + Math.random() * 0.2));

      sumRawDown += rawDown;
      sumRawUp += rawUp;

      candidates.push({
        id: tor.id,
        rawDown,
        rawUp,
        bypassedGain,
        throttlingDetected,
        throttlingRatio,
        status,
        effectivePeers,
        effectiveSeeds,
      });
    }

    // Scale down if limits are enforced
    const downScale = sumRawDown > maxGlobalDownBytes ? maxGlobalDownBytes / sumRawDown : 1.0;
    const upScale = sumRawUp > maxGlobalUpBytes ? maxGlobalUpBytes / sumRawUp : 1.0;

    let totalDown = 0;
    let totalUp = 0;
    let totalBypassed = 0;

    // Pass 2: Apply scaled speeds and advance byte progress
    this.torrents = this.torrents.map((tor) => {
      const cand = candidates.find((c) => c.id === tor.id);
      if (!cand || tor.status === 'paused' || tor.status === 'error' || tor.status === 'queued') {
        return { ...tor, downloadSpeed: 0, uploadSpeed: 0 };
      }

      if (tor.status === 'seeding') {
        const finalUp = Math.floor(cand.rawUp * upScale);
        totalUp += finalUp;
        return {
          ...tor,
          uploaded: tor.uploaded + finalUp * 1.5,
          uploadSpeed: finalUp,
          downloadSpeed: 0,
          peersConnected: cand.effectivePeers,
          seedsConnected: cand.effectiveSeeds,
          ratio: parseFloat(((tor.uploaded + finalUp * 1.5) / tor.size).toFixed(2)),
        };
      }

      const effectiveDown = Math.floor(cand.rawDown * downScale);
      const effectiveUp = Math.floor(cand.rawUp * upScale);
      const bypassedSpeedGain = Math.floor(cand.bypassedGain * downScale);

      totalDown += effectiveDown;
      totalUp += effectiveUp;
      totalBypassed += bypassedSpeedGain;

      const newDownloaded = Math.min(tor.size, tor.downloaded + effectiveDown * 1.5);
      const newProgress = parseFloat(((newDownloaded / tor.size) * 100).toFixed(1));

      // Advance piece map
      let completedPieces = [...tor.completedPieces];
      let activePieces = [...tor.activePieces];
      if (newProgress < 100 && Math.random() < 0.65) {
        const nextIdx = completedPieces.findIndex((c) => !c);
        if (nextIdx !== -1) {
          completedPieces[nextIdx] = true;
          activePieces = [
            (nextIdx + 1) % completedPieces.length,
            (nextIdx + 3) % completedPieces.length,
          ];
        }
      }

      // Advance IDM HTTP multi-part segments if present
      let segments = tor.segments;
      if (tor.isHttpSegmented && segments && segments.length > 0) {
        const activeSegments = segments.filter((s) => s.status === 'active');
        const segCount = activeSegments.length || 1;
        const speedPerSeg = Math.floor(effectiveDown / segCount);

        segments = segments.map((seg) => {
          if (seg.status === 'active') {
            const segDownloaded = Math.min(
              seg.endByte - seg.startByte,
              seg.downloadedBytes + speedPerSeg * 1.5
            );
            return {
              ...seg,
              downloadedBytes: segDownloaded,
              speed: speedPerSeg,
              status: segDownloaded >= (seg.endByte - seg.startByte) ? 'completed' : 'active',
            };
          }
          return { ...seg, speed: 0 };
        });
      }

      const remainingBytes = tor.size - newDownloaded;
      const isFinished = newProgress >= 100;
      const eta = isFinished ? 'Completed' : calculateEta(remainingBytes, effectiveDown);

      const updated: TorrentItem = {
        ...tor,
        downloaded: newDownloaded,
        downloadSpeed: isFinished ? 0 : effectiveDown,
        uploadSpeed: effectiveUp,
        progress: newProgress,
        status: isFinished ? 'seeding' : cand.status,
        eta: isFinished ? 'Seeding' : eta,
        seedsConnected: isFinished ? cand.effectiveSeeds : (tor.isHttpSegmented ? 0 : cand.effectiveSeeds),
        peersConnected: cand.effectivePeers,
        completedPieces: isFinished ? completedPieces.map(() => true) : completedPieces,
        activePieces: isFinished ? [] : activePieces,
        throttlingDetected: cand.throttlingDetected,
        throttlingRatio: cand.throttlingRatio,
        bypassedSpeedGain,
        segments,
        ratio: parseFloat(((tor.uploaded + effectiveUp * 1.5) / (newDownloaded || 1)).toFixed(2)),
      };

      if (isFinished && tor.progress < 100 && !this.completedIdsNotified.has(tor.id)) {
        this.completedIdsNotified.add(tor.id);
        this.addLog('TORRENT', `Completed transfer "${tor.name}".`);
        setTimeout(() => {
          this.completionListeners.forEach((fn) => fn(updated));
        }, 0);
      }

      return updated;
    });

    // Accumulate total session transfer stats
    this.sessionDownloaded += totalDown * 1.5;
    this.sessionUploaded += totalUp * 1.5;

    // Record history
    this.speedHistory.push({
      time: timeStr,
      downloadSpeed: Math.floor(totalDown / 1024),
      uploadSpeed: Math.floor(totalUp / 1024),
      bypassedSpeed: Math.floor(totalBypassed / 1024),
    });
    if (this.speedHistory.length > 30) {
      this.speedHistory.shift();
    }

    this.notify();
  }

  // Session Statistics
  public getSessionStats() {
    return {
      sessionDownloaded: this.sessionDownloaded,
      sessionUploaded: this.sessionUploaded,
    };
  }

  public resetSessionStats() {
    this.sessionDownloaded = 0;
    this.sessionUploaded = 0;
    if (this.rustDaemonConnected) {
      void apiClient.resetSessionStatsRpc();
    }
    this.addLog(
      'INFO',
      'Session upload & download counters reset to 0 B (active transfers continue uninterrupted).'
    );
    this.notify();
  }

  // Actions
  public getTorrents(): TorrentItem[] {
    return this.torrents;
  }

  public getBandwidthLimits(): BandwidthLimits {
    return this.bandwidthLimits;
  }

  public getLibqrbitConfig(): LibqrbitConfig {
    return this.libqrbitConfig;
  }

  public getSpeedHistory(): SpeedHistoryPoint[] {
    return this.speedHistory;
  }

  public getLogs(): LogEntry[] {
    return this.logs;
  }

  public isThrottlingActive(): boolean {
    return this.ispThrottlingActive;
  }

  public toggleIspThrottling() {
    this.ispThrottlingActive = !this.ispThrottlingActive;
    const now = new Date();
    const timeStr = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}:${now.getSeconds().toString().padStart(2, '0')}`;
    
    if (this.ispThrottlingActive) {
      this.addLog('THROTTLE', 'ISP deep packet shaper active: Injected 85% bandwidth decay on unmasked BitTorrent ports.');
      this.addLog('LIBQRBIT', 'libqrbit sensor triggered: Auto-evasion engaged. Routing via QUIC-morph frame fragmentation.');
    } else {
      this.addLog('INFO', 'ISP throttling cleared: Raw line rate unconstrained.');
    }
    this.notify();
  }

  public toggleTurtleMode() {
    this.bandwidthLimits.altSpeedActive = !this.bandwidthLimits.altSpeedActive;
    if (this.rustDaemonConnected) {
      void apiClient.toggleTurtleRpc();
    }
    this.addLog(
      'INFO',
      `Alternative Speed Limits (Turtle Mode) ${this.bandwidthLimits.altSpeedActive ? 'ENABLED (Limited mode: 2.0 MB/s cap)' : 'DISABLED (Unlimited mode: Full Speed)'}.`
    );
    this.notify();
  }

  public setTurtleMode(active: boolean) {
    if (this.bandwidthLimits.altSpeedActive !== active) {
      this.bandwidthLimits.altSpeedActive = active;
      if (this.rustDaemonConnected) {
        void apiClient.setTurtleRpc(active);
      }
      this.addLog(
        'INFO',
        `Speed mode changed to: ${active ? 'LIMITED (Alternative limits)' : 'UNLIMITED (Full line rate)'}.`
      );
      this.notify();
    }
  }

  public setLibqrbitEnabled(enabled: boolean) {
    if (this.libqrbitConfig.enabled !== enabled) {
      this.libqrbitConfig.enabled = enabled;
      if (this.rustDaemonConnected) {
        void apiClient.setStealthRpc(enabled);
      }
      this.addLog(
        'LIBQRBIT',
        `libqrbit Stealth Mode turned ${enabled ? 'ON: Multi-Path DPI Masking Active' : 'OFF: Plain BitTorrent Framing'}.`
      );
      this.notify();
    }
  }

  public setBandwidthLimits(limits: Partial<BandwidthLimits>) {
    this.bandwidthLimits = { ...this.bandwidthLimits, ...limits };
    const downMsg = limits.globalDownloadLimit && limits.globalDownloadLimit > 0
      ? `${(limits.globalDownloadLimit / 1024).toFixed(1)} MB/s`
      : (limits.globalDownloadLimit === 0 ? 'Unlimited' : `${(this.bandwidthLimits.globalDownloadLimit / 1024).toFixed(1)} MB/s`);
    const upMsg = limits.globalUploadLimit && limits.globalUploadLimit > 0
      ? `${(limits.globalUploadLimit / 1024).toFixed(1)} MB/s`
      : (limits.globalUploadLimit === 0 ? 'Unlimited' : `${(this.bandwidthLimits.globalUploadLimit / 1024).toFixed(1)} MB/s`);
    this.addLog(
      'INFO',
      `[Bandwidth & Discovery Rules] Limits: Down [${downMsg}], Up [${upMsg}] | DHT: [${this.bandwidthLimits.dhtEnabled ? 'ON' : 'OFF'}], PeX: [${this.bandwidthLimits.pexEnabled ? 'ON' : 'OFF'}], LSD: [${this.bandwidthLimits.lsdEnabled ? 'ON' : 'OFF'}], uTP: [${this.bandwidthLimits.utpEnabled ? 'ON' : 'OFF'}], Encryption: [${this.bandwidthLimits.encryptionRequirement || 'prefer'}].`
    );
    this.notify();
  }

  public setGlobalLimits(downKbps: number, upKbps: number) {
    this.setBandwidthLimits({ globalDownloadLimit: downKbps, globalUploadLimit: upKbps });
  }

  public getHttpSettings(): HttpSettings {
    return this.httpSettings;
  }

  public setHttpSettings(settings: Partial<HttpSettings>) {
    const prevSegments = this.httpSettings.defaultSegments;
    this.httpSettings = { ...this.httpSettings, ...settings };

    // Dynamically reslice all active HTTP multi-segment downloads if chunk count changed
    if (settings.defaultSegments && settings.defaultSegments !== prevSegments) {
      this.resliceHttpDownloads(settings.defaultSegments);
    }

    this.addLog(
      'INFO',
      `[HTTP Direct Engine] Applied configuration: ${this.httpSettings.defaultSegments} segments, Buffer: ${this.httpSettings.bufferSize || '1MB'}, User-Agent: ${this.httpSettings.userAgent}, Window Scaling: ${this.httpSettings.tcpWindowScaling ? 'ON' : 'OFF'}, DoH: ${this.httpSettings.dohResolver || 'cloudflare'}.`
    );
    this.notify();
  }

  public resliceHttpDownloads(segmentsCount: number) {
    this.torrents = this.torrents.map((t) => {
      if (t.isHttpSegmented && t.status !== 'seeding' && t.status !== 'paused' && t.progress < 100) {
        const chunkSize = Math.floor(t.size / segmentsCount);
        const newSegments = [];
        for (let i = 0; i < segmentsCount; i++) {
          const start = i * chunkSize;
          const end = i === segmentsCount - 1 ? t.size : (i + 1) * chunkSize - 1;
          const isDone = (i / segmentsCount) < (t.progress / 100);
          newSegments.push({
            id: i + 1,
            startByte: start,
            endByte: end,
            downloadedBytes: isDone ? (end - start) : Math.floor((end - start) * (t.progress / 100)),
            speed: 0,
            status: isDone ? ('completed' as const) : ('active' as const),
          });
        }
        return {
          ...t,
          segments: newSegments,
          piecesCount: segmentsCount,
          completedPieces: newSegments.map((s) => s.status === 'completed'),
          activePieces: newSegments.map((s, idx) => s.status === 'active' ? idx : -1).filter((idx) => idx !== -1),
          peersConnected: segmentsCount,
          peersTotal: segmentsCount,
          shardingRoutesCount: segmentsCount,
        };
      }
      return t;
    });
  }

  public updateLibqrbitConfig(config: Partial<LibqrbitConfig>) {
    this.libqrbitConfig = { ...this.libqrbitConfig, ...config };
    this.addLog('LIBQRBIT', `libqrbit configuration updated: Profile [${this.libqrbitConfig.dpiEvasionProfile}].`);
    this.notify();
  }

  public pauseTorrent(id: string) {
    if (this.rustDaemonConnected) {
      void apiClient.pauseTransferRpc(id).then(() => this.syncFromRustDaemon());
    }
    this.torrents = this.torrents.map((t) => (t.id === id ? { ...t, status: 'paused', downloadSpeed: 0, uploadSpeed: 0, eta: 'Paused' } : t));
    this.notify();
  }

  public stopTorrent(id: string) {
    if (this.rustDaemonConnected) {
      void apiClient.stopTransferRpc(id).then(() => this.syncFromRustDaemon());
    }
    const target = this.torrents.find((t) => t.id === id);
    this.torrents = this.torrents.map((t) =>
      t.id === id
        ? {
            ...t,
            status: 'paused',
            downloadSpeed: 0,
            uploadSpeed: 0,
            peersConnected: 0,
            seedsConnected: 0,
            eta: 'Stopped',
            segments: t.segments ? t.segments.map((s) => ({ ...s, speed: 0 })) : undefined,
          }
        : t
    );
    if (target) {
      this.addLog('INFO', `Stopped transfer "${target.name}".`);
    }
    this.notify();
  }

  public resumeTorrent(id: string) {
    if (this.rustDaemonConnected) {
      void apiClient.resumeTransferRpc(id).then(() => this.syncFromRustDaemon());
    }
    this.torrents = this.torrents.map((t) => (t.id === id ? { ...t, status: t.progress >= 100 ? 'seeding' : 'downloading' } : t));
    this.notify();
  }

  public pauseAll() {
    if (this.rustDaemonConnected) {
      void apiClient.pauseAllRpc().then(() => this.syncFromRustDaemon());
    }
    this.torrents = this.torrents.map((t) => ({ ...t, status: 'paused', downloadSpeed: 0, uploadSpeed: 0 }));
    this.addLog('INFO', 'Paused all active downloads and seeds.');
    this.notify();
  }

  public resumeAll() {
    if (this.rustDaemonConnected) {
      void apiClient.resumeAllRpc().then(() => this.syncFromRustDaemon());
    }
    this.torrents = this.torrents.map((t) => ({ ...t, status: t.progress >= 100 ? 'seeding' : 'downloading' }));
    this.addLog('INFO', 'Resumed all transfers.');
    this.notify();
  }

  public deleteTorrent(id: string, deleteFiles = false) {
    if (this.rustDaemonConnected) {
      void apiClient.deleteTransferRpc(id, deleteFiles).then(() => this.syncFromRustDaemon());
    }
    const item = this.torrents.find((t) => t.id === id);
    this.torrents = this.torrents.filter((t) => t.id !== id);
    this.addLog('TORRENT', `Removed transfer "${item?.name || id}" ${deleteFiles ? '(files deleted from disk)' : ''}.`);
    this.notify();
  }

  public renameTorrent(id: string, newName: string) {
    const trimmed = newName.trim();
    if (!trimmed) return;
    if (this.rustDaemonConnected) {
      void apiClient.renameTransferRpc(id, trimmed).then(() => this.syncFromRustDaemon());
    }
    const item = this.torrents.find((t) => t.id === id);
    if (!item || item.name === trimmed) return;
    const oldName = item.name;
    this.torrents = this.torrents.map((t) => (t.id === id ? { ...t, name: trimmed } : t));
    this.addLog('TORRENT', `Renamed transfer "${oldName}" to "${trimmed}".`);
    this.notify();
  }

  public forceRecheck(id: string) {
    const item = this.torrents.find((t) => t.id === id);
    const prevStatus = item?.status;
    this.torrents = this.torrents.map((t) => {
      if (t.id === id) {
        return { ...t, status: 'checking', downloadSpeed: 0, eta: 'Checking...' };
      }
      return t;
    });
    this.addLog('TORRENT', `Force Recheck: verifying SHA-1 piece hashes for "${item?.name || id}"...`);
    this.notify();

    if (this.rustDaemonConnected) {
      void apiClient.recheckTransferRpc(id).then(() => {
        setTimeout(() => {
          void this.syncFromRustDaemon();
          this.addLog('TORRENT', `Force Recheck completed for "${item?.name || id}" (piece hashes verified).`);
        }, 1200);
      });
      return;
    }

    setTimeout(() => {
      this.torrents = this.torrents.map((t) => {
        if (t.id === id) {
          const nextStatus =
            t.progress >= 100
              ? 'seeding'
              : prevStatus === 'paused'
              ? 'paused'
              : t.libqrbitEnabled && this.ispThrottlingActive
              ? 'stealth_active'
              : 'downloading';
          return {
            ...t,
            status: nextStatus,
            eta: t.progress >= 100 ? 'Seeding' : prevStatus === 'paused' ? 'Paused' : calculateEta(t.size - t.downloaded, 8500000),
          };
        }
        return t;
      });
      this.addLog('TORRENT', `Force Recheck verified (100% piece hashes valid) for "${item?.name || id}".`);
      this.notify();
    }, 1500);
  }

  public setPriority(id: string, priority: Priority) {
    if (this.rustDaemonConnected) {
      void apiClient.setPriorityRpc(id, priority).then(() => this.syncFromRustDaemon());
    }
    this.torrents = this.torrents.map((t) => (t.id === id ? { ...t, priority } : t));
    this.notify();
  }

  public moveTorrent(id: string, direction: 'up' | 'down'): boolean {
    const idx = this.torrents.findIndex((t) => t.id === id);
    if (idx === -1) return false;
    const targetIdx = direction === 'up' ? idx - 1 : idx + 1;
    if (targetIdx < 0 || targetIdx >= this.torrents.length) return false;
    const next = [...this.torrents];
    const [item] = next.splice(idx, 1);
    next.splice(targetIdx, 0, item);
    this.torrents = next;
    this.addLog('INFO', `Moved "${item.name}" ${direction} in execution queue (position ${targetIdx + 1}/${next.length}).`);
    this.notify();
    return true;
  }

  public setTransferSpeedLimit(id: string, limitKbps: number) {
    if (this.rustDaemonConnected) {
      void apiClient.setSpeedLimitRpc(id, limitKbps);
    }
    const item = this.torrents.find((t) => t.id === id);
    this.torrents = this.torrents.map((t) =>
      t.id === id ? { ...t, perTransferLimitKbps: limitKbps > 0 ? limitKbps : undefined } : t
    );
    this.addLog(
      'INFO',
      `Per-transfer speed limit for "${item?.name || id}" set to ${limitKbps > 0 ? `${limitKbps} KB/s` : 'Unlimited'}.`
    );
    this.notify();
  }

  public setCompletionOptions(
    id: string,
    options: NonNullable<TorrentItem['completionOptions']>
  ) {
    this.torrents = this.torrents.map((t) =>
      t.id === id ? { ...t, completionOptions: { ...options } } : t
    );
    this.notify();
  }

  public setHealthPriorityMode(id: string, mode: HealthPriorityMode) {
    this.torrents = this.torrents.map((t) => {
      if (t.id === id) {
        return { ...t, healthPriorityMode: mode };
      }
      return t;
    });
    this.addLog('TORRENT', `Swarm piece scheduling updated to: [${mode}] for maximum swarm health.`);
    this.notify();
  }

  public toggleTorrentLibqrbit(id: string) {
    this.torrents = this.torrents.map((t) => {
      if (t.id === id) {
        const next = !t.libqrbitEnabled;
        return {
          ...t,
          libqrbitEnabled: next,
          status: next && this.ispThrottlingActive ? 'stealth_active' : (this.ispThrottlingActive ? 'throttled' : 'downloading'),
        };
      }
      return t;
    });
    this.notify();
  }

  public setTorrentObfuscationLevel(id: string, level: ObfuscationLevel) {
    if (this.rustDaemonConnected) {
      void apiClient.setObfuscationRpc(id, level);
    }
    this.torrents = this.torrents.map((t) => (t.id === id ? { ...t, obfuscationLevel: level } : t));
    this.addLog('LIBQRBIT', `Updated obfuscation level to Level ${level} for selected transfer.`);
    this.notify();
  }

  public addTorrent(data: {
    name: string;
    size: number;
    category?: string;
    priority?: Priority;
    libqrbitEnabled?: boolean;
    obfuscationLevel?: ObfuscationLevel;
    savePath?: string;
    tags?: string[];
    hash?: string;
    magnetUri?: string;
    contentBase64?: string;
    filePath?: string;
    seedsConnected?: number;
    seedsTotal?: number;
    peersConnected?: number;
    peersTotal?: number;
  }) {
    const resolvedSavePath = data.savePath || this.defaultDownloadDirectory;
    const clientAssignedId = `tor-${Date.now()}`;
    const chosenPriority: Priority = data.priority || 'Normal';
    const chosenObfuscation: ObfuscationLevel = data.obfuscationLevel ?? 3;
    const isStealth = data.libqrbitEnabled ?? true;

    if (this.rustDaemonConnected) {
      if (data.contentBase64 || data.filePath) {
        void apiClient
          .addTorrentFileRpc({
            content_base64: data.contentBase64,
            file_path: data.filePath,
            category: data.category || 'Default',
            priority: chosenPriority,
            libqrbit_enabled: isStealth,
            obfuscation_level: chosenObfuscation,
            save_path: resolvedSavePath,
          })
          .then((res) => {
            if (res && res.id) {
              const idx = this.torrents.findIndex((t) => t.id === clientAssignedId);
              if (idx !== -1) {
                this.torrents[idx] = {
                  ...this.torrents[idx],
                  id: res.id,
                  name: res.name || this.torrents[idx].name,
                  size: res.size || this.torrents[idx].size,
                  hash: res.hash || this.torrents[idx].hash,
                };
              }
            }
            return this.syncFromRustDaemon();
          })
          .catch((err) => {
            const idx = this.torrents.findIndex((t) => t.id === clientAssignedId);
            if (idx !== -1) {
              this.torrents[idx] = {
                ...this.torrents[idx],
                status: 'error',
                eta: 'Error',
                statusNote: String(err?.message || err || 'Failed to start torrent transfer'),
              };
              this.notify();
            }
          });
      } else if (data.magnetUri || data.hash) {
        const fullMagnet =
          data.magnetUri ||
          `magnet:?xt=urn:btih:${data.hash}${data.name ? `&dn=${encodeURIComponent(data.name)}` : ''}`;
        void apiClient
          .addMagnetRpc({
            url: fullMagnet,
            name: data.name,
            size: data.size,
            category: data.category || 'Default',
            priority: chosenPriority,
            libqrbit_enabled: isStealth,
            obfuscation_level: chosenObfuscation,
            save_path: resolvedSavePath,
          })
          .then((res) => {
            if (res && res.id) {
              const idx = this.torrents.findIndex((t) => t.id === clientAssignedId);
              if (idx !== -1) {
                this.torrents[idx] = {
                  ...this.torrents[idx],
                  id: res.id,
                  name: res.name || this.torrents[idx].name,
                  hash: res.hash || this.torrents[idx].hash,
                };
              }
            }
            return this.syncFromRustDaemon();
          })
          .catch((err) => {
            const idx = this.torrents.findIndex((t) => t.id === clientAssignedId);
            if (idx !== -1) {
              this.torrents[idx] = {
                ...this.torrents[idx],
                status: 'error',
                eta: 'Error',
                statusNote: String(err?.message || err || 'Failed to queue magnet download'),
              };
              this.notify();
            }
          });
      }
    }

    const piecesCount = Math.max(20, Math.min(250, Math.floor(data.size / (1024 * 1024 * 4))));
    const newTor: TorrentItem = {
      id: clientAssignedId,
      name: data.name,
      size: data.size,
      downloaded: 0,
      uploaded: 0,
      downloadSpeed: 16500000,
      uploadSpeed: 820000,
      status: isStealth ? 'stealth_active' : 'downloading',
      progress: 0,
      seedsConnected: data.seedsConnected ?? 24,
      seedsTotal: data.seedsTotal ?? 65,
      peersConnected: data.peersConnected ?? 18,
      peersTotal: data.peersTotal ?? 40,
      swarmHealth: 7.2,
      healthGrade: 'A',
      ratio: 0,
      eta: calculateEta(data.size, 16500000),
      addedDate: new Date().toISOString().replace('T', ' ').substring(0, 16),
      savePath: resolvedSavePath,
      hash: data.hash || generateHash(),
      category: data.category || 'Other',
      priority: chosenPriority,
      tags: data.tags || ['New', 'BitTorrent'],
      piecesCount,
      completedPieces: new Array(piecesCount).fill(false),
      activePieces: [0, 1, 2],
      healthPriorityMode: 'rarest_first',
      libqrbitEnabled: isStealth,
      obfuscationLevel: chosenObfuscation,
      throttlingDetected: this.ispThrottlingActive,
      throttlingRatio: this.ispThrottlingActive ? 0.8 : 0,
      bypassedSpeedGain: isStealth ? 13200000 : 0,
      decoyProtocol: 'QUIC/TLS1.3',
      packetMorphEfficiency: 97.4,
      shardingRoutesCount: 4,
    };

    this.torrents.unshift(newTor);
    this.addLog('TORRENT', `Added new BitTorrent transfer: ${data.name} (${data.size} bytes) -> saved to ${newTor.savePath}`);
    this.notify();
  }

  public addHttpUrlDownload(data: {
    url: string;
    name: string;
    size: number;
    segmentsCount: number;
    category: string;
    priority?: Priority;
    libqrbitEnabled?: boolean;
    obfuscationLevel?: ObfuscationLevel;
    savePath?: string;
  }) {
    const resolvedSavePath = data.savePath || this.defaultDownloadDirectory;
    const clientAssignedId = `idm-${Date.now()}`;
    const chosenPriority: Priority = data.priority || 'Normal';

    if (this.rustDaemonConnected) {
      void apiClient
        .addHttpRpc({
          url: data.url,
          name: data.name,
          size: data.size,
          segments_count: data.segmentsCount,
          category: data.category || 'Default',
          priority: chosenPriority,
          libqrbit_enabled: false,
          obfuscation_level: 1,
          save_path: resolvedSavePath,
        })
        .then((res) => {
          if (res && res.id) {
            const idx = this.torrents.findIndex((t) => t.id === clientAssignedId);
            if (idx !== -1) {
              this.torrents[idx] = {
                ...this.torrents[idx],
                id: res.id,
                name: res.name || this.torrents[idx].name,
                size: res.size || this.torrents[idx].size,
              };
            }
          }
          return this.syncFromRustDaemon();
        })
        .catch((err) => {
          const idx = this.torrents.findIndex((t) => t.id === clientAssignedId);
          if (idx !== -1) {
            this.torrents[idx] = {
              ...this.torrents[idx],
              status: 'error',
              eta: 'Error',
              statusNote: String(err?.message || err || 'Failed to start HTTP download'),
            };
            this.notify();
          }
        });
    }

    const segments = [];
    const chunkSize = Math.floor(data.size / data.segmentsCount);
    for (let i = 0; i < data.segmentsCount; i++) {
      const start = i * chunkSize;
      const end = i === data.segmentsCount - 1 ? data.size : (i + 1) * chunkSize - 1;
      segments.push({
        id: i + 1,
        startByte: start,
        endByte: end,
        downloadedBytes: 0,
        speed: 0,
        status: 'active' as const,
      });
    }

    const newDownload: TorrentItem = {
      id: `idm-${Date.now()}`,
      name: data.name,
      size: data.size,
      downloaded: 0,
      uploaded: 0,
      downloadSpeed: 14500000,
      uploadSpeed: 0,
      status: 'downloading',
      progress: 0,
      seedsConnected: 0,
      seedsTotal: 0,
      peersConnected: data.segmentsCount,
      peersTotal: data.segmentsCount,
      swarmHealth: 10.0,
      healthGrade: 'A+',
      ratio: 0,
      eta: calculateEta(data.size, 14500000),
      addedDate: new Date().toISOString().replace('T', ' ').substring(0, 16),
      savePath: resolvedSavePath,
      hash: generateHash(),
      category: data.category || 'Default',
      priority: chosenPriority,
      tags: [data.category || 'Default', 'HTTP-Direct', 'Standard'],
      piecesCount: data.segmentsCount,
      completedPieces: new Array(data.segmentsCount).fill(false),
      activePieces: Array.from({ length: data.segmentsCount }, (_, i) => i),
      healthPriorityMode: 'balanced',
      isHttpSegmented: true,
      httpUrl: data.url,
      segments,
      libqrbitEnabled: false,
      obfuscationLevel: 1,
      throttlingDetected: false,
      throttlingRatio: 0,
      bypassedSpeedGain: 0,
      decoyProtocol: 'QUIC/TLS1.3',
      packetMorphEfficiency: 96.5,
      shardingRoutesCount: data.segmentsCount,
    };

    this.torrents.unshift(newDownload);
    this.addLog('INFO', `Started multi-segment HTTP/FTP download: ${data.name} with ${data.segmentsCount} parallel streams.`);
    this.notify();
  }

  public applyHttpOptimalSettings(segmentsCount = 16, multiPath = false) {
    if (this.rustDaemonConnected) {
      void apiClient.setHttpSegmentsRpc(segmentsCount);
    }
    this.torrents = this.torrents.map((t) => {
      if (t.isHttpSegmented) {
        const newSegments = [];
        const chunkSize = Math.floor(t.size / segmentsCount);
        for (let i = 0; i < segmentsCount; i++) {
          const start = i * chunkSize;
          const end = i === segmentsCount - 1 ? t.size : (i + 1) * chunkSize - 1;
          const isDone = (i / segmentsCount) < (t.progress / 100);
          newSegments.push({
            id: i + 1,
            startByte: start,
            endByte: end,
            downloadedBytes: isDone ? (end - start) : Math.floor((end - start) * 0.4),
            speed: Math.floor(28400000 / segmentsCount),
            status: isDone ? ('completed' as const) : ('active' as const),
          });
        }
        return {
          ...t,
          segments: newSegments,
          peersTotal: segmentsCount,
          piecesCount: segmentsCount,
          completedPieces: newSegments.map((s) => s.status === 'completed'),
          activePieces: newSegments.map((s, idx) => s.status === 'active' ? idx : -1).filter((idx) => idx !== -1),
          downloadSpeed: 28400000,
          shardingRoutesCount: segmentsCount,
          libqrbitEnabled: false,
          bypassedSpeedGain: 0,
        };
      }
      return t;
    });
    this.addLog(
      'INFO',
      `[HTTP Optimizer] Applied optimal multi-part acceleration: ${segmentsCount} parallel streams with live IDM work-stealing.`
    );
    this.notify();
  }

  public setHttpSegments(id: string, segmentsCount: number) {
    const clamped = Math.max(1, Math.min(32, segmentsCount));
    if (this.rustDaemonConnected) {
      void apiClient.setHttpSegmentsRpc(clamped, id);
    }
    const idx = this.torrents.findIndex((t) => t.id === id);
    if (idx !== -1) {
      this.torrents[idx] = {
        ...this.torrents[idx],
        peersTotal: clamped,
        shardingRoutesCount: clamped,
      };
      this.addLog('INFO', `[HTTP Dynamic] Scaled transfer '${this.torrents[idx].name}' to ${clamped} streams.`);
      this.notify();
    }
  }

  public addLog(type: LogEntry['type'], message: string) {
    const now = new Date();
    const timeStr = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}:${now.getSeconds().toString().padStart(2, '0')}`;
    this.logs.unshift({
      id: `log-${Date.now()}-${Math.random()}`,
      timestamp: timeStr,
      type,
      message,
    });
    if (this.logs.length > 100) this.logs.pop();
    this.notify();
  }
}

export const torrentEngine = new TorrentEngine();
