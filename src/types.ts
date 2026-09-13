export type DownloadStatus = 'downloading' | 'paused' | 'completed' | 'queued' | 'error';

export type FileType = 'video' | 'audio' | 'document' | 'software' | 'archive' | 'image' | 'torrent' | 'other';

export interface DownloadChunk {
  id: number;
  progress: number; // 0 - 100
  status: 'downloading' | 'completed' | 'idle';
}

export interface TorrentFile {
  name: string;
  size: number;
  progress: number;
  selected?: boolean;
}

export interface StealthConfig {
  protocolEncryption: boolean; // MSE/PE packet header encryption
  portRandomization: boolean;  // Dynamic port hopping
  spoofClientId: string;       // e.g. "Transmission/3.00", "qBittorrent/4.6.5"
  dhtObfuscation: boolean;     // Encrypted DHT / Trackerless stealth
  antiThrottlingNoise: boolean; // Micro-pacing packet shaping
}

export interface DownloadItem {
  id: string;
  name: string;
  url: string;
  size: number; // in Bytes
  downloaded: number; // in Bytes
  speed: number; // in Bytes per second
  speedLimit?: number; // in Bytes per second (0 = unlimited)
  status: DownloadStatus;
  fileType: FileType;
  category: string;
  savePath: string;
  addedAt: string;
  completedAt?: string;
  connections: number; // maximum HTTP connections / configured torrent peers
  activeConnections?: number; // actual adaptive HTTP connections currently in use
  chunks: DownloadChunk[];
  hash?: string;
  serverIp?: string;
  speedHistory: number[]; // last N speed values for mini graph
  
  // Torrent / librqbit Engine Attributes
  isTorrent?: boolean;
  engine?: 'librqbit' | 'http';
  infoHash?: string;
  torrentId?: number;
  seeders?: number;
  leechers?: number;
  dhtNodes?: number;
  stealthEnabled?: boolean;
  stealthConfig?: StealthConfig;
  torrentFiles?: TorrentFile[];
  torrentSubfolder?: string;
  torrentIsMultiFile?: boolean;
  preparing?: boolean;
  preparingLabel?: string;
}

export interface GlobalSettings {
  maxSimultaneousDownloads: number;
  globalSpeedLimit: number; // 0 = unlimited
  defaultSavePath: string;
  autoStartNext: boolean;
  soundNotifications: boolean;
  theme: 'dark' | 'light' | 'system';
  minimizeToTaskbar?: boolean;
  stealthEnabled?: boolean;
  protocolEncryptionRequired?: boolean;
  hardwareAcceleration: boolean;
  
  // Torrent & Stealth Global Settings
  torrentEngine: 'librqbit' | 'http';
  torrentListenPort: number;
  torrentRandomizePort: boolean;
  disableDht: boolean;
  anonymousMode: boolean;
  stealthProtocolEncryption: boolean;
  stealthPortRandomization: boolean;
  stealthSpoofClientId: string;
  stealthDhtObfuscation: boolean;
  stealthAntiThrottlingNoise: boolean;
  uploadSpeedLimit: number; // in Bytes per second
  maxPeersPerTorrent: number;
}

export interface QuickPreset {
  name: string;
  url: string;
  size: number;
  fileType: FileType;
  category: string;
  isTorrent?: boolean;
  seeders?: number;
  leechers?: number;
}
