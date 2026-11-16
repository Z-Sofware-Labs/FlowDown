import { TorrentItem, PeerInfo, TrackerInfo, BandwidthLimits, LibqrbitConfig } from '../types';
import { getDefaultDownloadPath } from '../utils/detectOs';

export const INITIAL_BANDWIDTH_LIMITS: BandwidthLimits = {
  globalDownloadLimit: 0, // 0 = unlimited
  globalUploadLimit: 5120, // 5 MB/s
  altSpeedActive: false,
  altDownloadLimit: 2048, // 2 MB/s in turtle mode
  altUploadLimit: 512, // 512 KB/s
  scheduledAltSpeed: false,
  scheduleStartHour: 9,
  scheduleEndHour: 17,
};

export const INITIAL_LIBQRBIT_CONFIG: LibqrbitConfig = {
  enabled: true,
  autoDetectThrottling: true,
  aggressivePacketMorph: true,
  multiPathFragmentation: true,
  decoyEchoTunnel: true,
  portHopping: true,
  stealthPortMin: 49152,
  stealthPortMax: 65535,
  currentStealthPort: 52841,
  dpiEvasionProfile: 'ISP Deep Inspection',
  fecOverheadRatio: 0.04,
  packetPaddingJitterMs: 14,
  simulatedThrottleStrength: 80, // Default 80% throttling ISP attempt that libqrbit bypasses
};

export const INITIAL_TORRENTS: TorrentItem[] = [];

export const MOCK_PEERS: PeerInfo[] = [
  {
    ip: '198.51.100.42:58120',
    country: 'DE',
    client: 'libqrbit/3.4 (Stealth Qt)',
    flags: 'u I E ? S',
    downloadSpeed: 5240000,
    uploadSpeed: 420000,
    progress: 100,
    isLibqrbitPeer: true,
    encryption: 'libqrbit MP-Morph',
    relevance: 'High Availability',
  },
  {
    ip: '203.0.113.88:6881',
    country: 'JP',
    client: 'qBittorrent/5.0.1',
    flags: 'd H E',
    downloadSpeed: 3890000,
    uploadSpeed: 180000,
    progress: 94.2,
    isLibqrbitPeer: false,
    encryption: 'Full RC4/TLS1.3',
    relevance: 'Rare Piece Seeder',
  },
  {
    ip: '192.0.2.145:49811',
    country: 'US',
    client: 'libqrbit/3.4 (Daemon)',
    flags: 'u I E S K',
    downloadSpeed: 6420000,
    uploadSpeed: 890000,
    progress: 100,
    isLibqrbitPeer: true,
    encryption: 'libqrbit MP-Morph',
    relevance: 'Super Seeder Hub',
  },
  {
    ip: '185.190.140.23:51413',
    country: 'NL',
    client: 'Transmission/4.1.0',
    flags: 'd E',
    downloadSpeed: 2150000,
    uploadSpeed: 120000,
    progress: 78.5,
    isLibqrbitPeer: false,
    encryption: 'Full RC4/TLS1.3',
    relevance: 'Swarm Peer',
  },
  {
    ip: '103.21.244.6:59021',
    country: 'SG',
    client: 'libqrbit/3.3-arm64',
    flags: 'u I E ? S',
    downloadSpeed: 4120000,
    uploadSpeed: 340000,
    progress: 88.0,
    isLibqrbitPeer: true,
    encryption: 'libqrbit MP-Morph',
    relevance: 'Low Latency Route',
  },
  {
    ip: '194.67.210.12:6999',
    country: 'FI',
    client: 'Deluge/2.1.1 (libtorrent 2.0)',
    flags: 'd E',
    downloadSpeed: 1850000,
    uploadSpeed: 95000,
    progress: 65.3,
    isLibqrbitPeer: false,
    encryption: 'Full RC4/TLS1.3',
    relevance: 'Swarm Peer',
  },
];

export const MOCK_TRACKERS: TrackerInfo[] = [
  {
    url: 'udp://tracker.opentrackr.org:1337/announce',
    status: 'Working',
    seeders: 124,
    leechers: 42,
    downloaded: 45290,
    interval: '28m 10s',
    message: 'Announce successful (DHT active)',
  },
  {
    url: 'https://torrent.ubuntu.com/announce',
    status: 'Working',
    seeders: 182,
    leechers: 64,
    downloaded: 89201,
    interval: '14m 20s',
    message: 'HTTP 200 OK - Tracker responsive',
  },
  {
    url: 'udp://libqrbit-stealth-dht.v4.internal:443/announce',
    status: 'Working',
    seeders: 95,
    leechers: 18,
    downloaded: 14200,
    interval: '9m 45s',
    message: 'libqrbit Obfuscated TLS 1.3 Tunnel OK',
  },
  {
    url: 'udp://tracker.openbittorrent.com:6969/announce',
    status: 'Updating',
    seeders: 89,
    leechers: 31,
    downloaded: 31200,
    interval: '0m 12s',
    message: 'Scraping swarm health metrics...',
  },
  {
    url: 'udp://explodie.org:6969/announce',
    status: 'Working',
    seeders: 64,
    leechers: 22,
    downloaded: 18450,
    interval: '22m 05s',
    message: 'Tier 2 fallback active',
  },
];
