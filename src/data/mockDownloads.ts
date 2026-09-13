import { DownloadItem, QuickPreset } from '../types';

export const INITIAL_DOWNLOADS: DownloadItem[] = [];

export const QUICK_PRESETS: QuickPreset[] = [
  {
    name: 'Windows 11 24H2 / 25H2 x64 ISO (HTTP Direct)',
    url: 'https://software-static.download.prss.microsoft.com/db_cert/Win11_25H2_English_x64_v2.iso',
    size: 5872025600, // ~5.87 GB
    fileType: 'software',
    category: 'Operating Systems',
  },
  {
    name: 'Arch Linux 2026.08 ISO (librqbit Stealth Magnet)',
    url: 'magnet:?xt=urn:btih:3b8c2912a7e4e10291df128490a12e841289a231&dn=ArchLinux-2026.08.01-x86_64.iso',
    size: 1180000000,
    fileType: 'torrent',
    category: 'Torrents',
    isTorrent: true,
    seeders: 312,
    leechers: 14,
  },
  {
    name: 'Ubuntu 24.04.1 LTS Desktop ISO (HTTP Direct)',
    url: 'https://releases.ubuntu.com/24.04/ubuntu-24.04.1-desktop-amd64.iso',
    size: 5872025600,
    fileType: 'software',
    category: 'Operating Systems',
  },
  {
    name: 'Blender Open Movie Sintel (librqbit Stealth Magnet)',
    url: 'magnet:?xt=urn:btih:08a18012010190d7031102919318182910398101&dn=Sintel_4K_Movie.mkv',
    size: 4250000000,
    fileType: 'torrent',
    category: 'Torrents',
    isTorrent: true,
    seeders: 540,
    leechers: 8,
  },
  {
    name: 'VS Code Installer (Windows x64)',
    url: 'https://code.visualstudio.com/sha/download?build=stable&os=win32-x64',
    size: 98000000,
    fileType: 'software',
    category: 'Software',
  },
];
