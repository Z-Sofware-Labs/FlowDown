export type TorrentStatus = 
  | 'downloading'
  | 'seeding'
  | 'paused'
  | 'queued'
  | 'checking'
  | 'error'
  | 'throttled'
  | 'stealth_active';

export type Priority = 'Max' | 'High' | 'Normal' | 'Low';

export type HealthPriorityMode = 'rarest_first' | 'super_seed' | 'sequential_preview' | 'balanced';

export type ObfuscationLevel = 1 | 2 | 3 | 4;

export interface HttpSegment {
  id: number;
  startByte: number;
  endByte: number;
  downloadedBytes: number;
  speed: number; // bytes per sec
  status: 'active' | 'completed' | 'connecting';
}

export interface PeerInfo {
  ip: string;
  country: string;
  client: string;
  flags: string;
  downloadSpeed: number; // B/s
  uploadSpeed: number; // B/s
  progress: number; // 0-100
  isLibqrbitPeer: boolean;
  encryption: 'Full RC4/TLS1.3' | 'Plaintext' | 'libqrbit MP-Morph';
  relevance: string;
}

export interface TrackerInfo {
  url: string;
  status: 'Working' | 'Updating' | 'Connection Error' | 'Not Contacted';
  seeders: number;
  leechers: number;
  downloaded: number;
  interval: string;
  message: string;
}

export interface TorrentItem {
  id: string;
  name: string;
  size: number; // bytes
  downloaded: number; // bytes
  uploaded: number; // bytes
  downloadSpeed: number; // bytes/sec
  uploadSpeed: number; // bytes/sec
  status: TorrentStatus;
  progress: number; // 0 - 100
  seedsConnected: number;
  seedsTotal: number;
  peersConnected: number;
  peersTotal: number;
  swarmHealth: number; // e.g. 1.0 to 10.0 availability
  healthGrade: 'A+' | 'A' | 'B' | 'C' | 'Poor' | 'N/A';
  ratio: number;
  eta: string; // e.g. "4m 12s" or "∞"
  addedDate: string;
  savePath: string;
  hash: string;
  category: string;
  priority: Priority;
  tags: string[];
  piecesCount: number;
  completedPieces: boolean[];
  activePieces: number[];
  healthPriorityMode: HealthPriorityMode;

  // Multi-stream HTTP / IDM download flag
  isHttpSegmented?: boolean;
  httpUrl?: string;
  segments?: HttpSegment[];
  files?: { path: string; length: number; offset: number }[];
  isMissing?: boolean;
  statusNote?: string;

  // libqrbit stealth & anti-throttling engine
  libqrbitEnabled: boolean;
  obfuscationLevel: ObfuscationLevel;
  throttlingDetected: boolean;
  throttlingRatio: number; // percentage of line rate throttled by ISP before libqrbit (e.g. 75%)
  bypassedSpeedGain: number; // speed recovered via libqrbit (bytes/sec)
  decoyProtocol: 'QUIC/TLS1.3' | 'DoH-Jitter' | 'WebRTC-Stream' | 'HTTP3-Echo';
  packetMorphEfficiency: number; // e.g. 96.4%
  shardingRoutesCount: number; // e.g. 4 paths
  perTransferLimitKbps?: number; // 0 or undefined = unlimited
  completionOptions?: {
    exitOnComplete: boolean;
    shutdownOnComplete: boolean;
    playSoundOnComplete: boolean;
    openFileOnComplete: boolean;
    openFolderOnComplete: boolean;
  };
}

export interface BandwidthLimits {
  globalDownloadLimit: number; // KB/s, 0 = unlimited
  globalUploadLimit: number; // KB/s, 0 = unlimited
  altSpeedActive: boolean; // Turtle mode
  altDownloadLimit: number; // KB/s
  altUploadLimit: number; // KB/s
  scheduledAltSpeed: boolean;
  scheduleStartHour: number;
  scheduleEndHour: number;
  maxTotalConnections?: number;
  maxConnectionsPerTorrent?: number;
  maxActiveDownloads?: number;
  maxActiveUploads?: number;
  dhtEnabled?: boolean;
  pexEnabled?: boolean;
  lsdEnabled?: boolean;
  utpEnabled?: boolean;
  encryptionRequirement?: 'require' | 'prefer' | 'allow';
  halfOpenConnections?: number;
  uploadSlotsPerTorrent?: number;
}

export interface LibqrbitConfig {
  enabled: boolean;
  autoDetectThrottling: boolean;
  aggressivePacketMorph: boolean;
  multiPathFragmentation: boolean;
  decoyEchoTunnel: boolean;
  portHopping: boolean;
  randomPortOnStartup?: boolean;
  stealthPortMin: number;
  stealthPortMax: number;
  currentStealthPort: number;
  dpiEvasionProfile: 'Strict Campus/Dorm' | 'Mobile Carrier Bypass' | 'ISP Deep Inspection' | 'Government Firewall' | 'Custom';
  fecOverheadRatio: number; // 2% - 8%
  packetPaddingJitterMs: number;
  simulatedThrottleStrength: number; // 0 to 90%
  dohResolver?: 'system' | 'cloudflare' | 'google' | 'quad9';
}

export interface HttpSettings {
  defaultSegments: number; // e.g. 8
  defaultSavePath: string;
  timeoutSeconds: number;
  maxRetries: number;
  autoCategorize: boolean;
  userAgent: 'Chrome' | 'Firefox' | 'Edge' | 'Safari' | 'IDM' | 'cURL' | 'Custom';
  customUserAgent?: string;
  tcpWindowScaling: boolean;
  autoResumeBroken: boolean;
  bufferSize?: '64KB' | '256KB' | '1MB' | '4MB';
  keepAlive?: boolean;
  http2Multiplex?: boolean;
  dynamicChunking?: boolean;
  dohResolver?: 'system' | 'cloudflare' | 'google' | 'quad9';
  refererMode?: 'same_origin' | 'empty' | 'custom';
  customReferer?: string;
  maxConcurrentFiles?: number;
}

export type OsStyle = 'windows' | 'macos' | 'linux';

export interface SystemSettings {
  viewMode: 'dark' | 'light' | 'system';
  osStyle?: OsStyle;
  downloadDirectory: string; // Unified download path for all HTTP and BitTorrent transfers
  autoSubfolders: boolean;
  associateTorrents: boolean;
  associateMagnets: boolean;
  startOnBoot: boolean;
  minimizeToTray: boolean;
  preventSleepDuringTransfers: boolean;
  updateChannel: 'stable' | 'beta';
  autoCheckUpdates?: boolean;
  checkIntervalDays?: number;
  compactDensity?: boolean;
}

export interface SpeedHistoryPoint {
  time: string;
  downloadSpeed: number; // KB/s
  uploadSpeed: number; // KB/s
  bypassedSpeed: number; // KB/s
}

export interface LogEntry {
  id: string;
  timestamp: string;
  type: 'INFO' | 'LIBQRBIT' | 'THROTTLE' | 'TORRENT' | 'SECURITY';
  message: string;
}
