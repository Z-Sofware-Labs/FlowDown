#![allow(dead_code)]

use crate::bencode::{
    hex_encode, percent_encode_bytes, BencodeValue, ParsedTorrent, TorrentFileEntry,
};
use crate::libqrbit::{resolve_host_doh, LibqrbitEngine, PeerStream};
use rand::Rng;
use ring::digest::{digest, SHA1_FOR_LEGACY_USE_ONLY};
use std::collections::BTreeMap;
use std::net::{IpAddr, Ipv4Addr, Ipv6Addr, SocketAddr};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU32, AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tokio::fs::OpenOptions;
use tokio::io::{AsyncSeekExt, AsyncWriteExt, SeekFrom};
use tokio::net::UdpSocket;
use tokio::sync::{watch, Mutex, RwLock};
use tracing::{info, warn};

const BLOCK_SIZE: usize = 16 * 1024;

#[derive(Debug, Clone)]
pub struct TrackerAnnounceReport {
    pub peers: Vec<SocketAddr>,
    pub seeders: u32,
    pub leechers: u32,
}

pub struct LiveSwarmTracker {
    pub total_size: AtomicU64,
    pub downloaded_bytes: AtomicU64,
    pub uploaded_bytes: AtomicU64,
    pub seeds_connected: AtomicU32,
    pub seeds_total: AtomicU32,
    pub peers_connected: AtomicU32,
    pub peers_total: AtomicU32,
    pub metadata_resolved: AtomicBool,
    pub completed: AtomicBool,
    pub completed_pieces: AtomicU32,
    pub total_pieces: AtomicU32,
    pub status_note: RwLock<String>,
    pub resolved_name: RwLock<Option<String>>,
    pub files: RwLock<Vec<TorrentFileEntry>>,
}

impl LiveSwarmTracker {
    pub fn new(
        total_size: u64,
        total_pieces: u32,
        metadata_resolved: bool,
        files: Vec<TorrentFileEntry>,
    ) -> Arc<Self> {
        Arc::new(Self {
            total_size: AtomicU64::new(total_size),
            downloaded_bytes: AtomicU64::new(0),
            uploaded_bytes: AtomicU64::new(0),
            seeds_connected: AtomicU32::new(0),
            seeds_total: AtomicU32::new(0),
            peers_connected: AtomicU32::new(0),
            peers_total: AtomicU32::new(0),
            metadata_resolved: AtomicBool::new(metadata_resolved),
            completed: AtomicBool::new(false),
            completed_pieces: AtomicU32::new(0),
            total_pieces: AtomicU32::new(total_pieces),
            status_note: RwLock::new(if metadata_resolved {
                "Announcing to trackers...".to_string()
            } else {
                "Fetching magnet metadata (BEP-9)...".to_string()
            }),
            resolved_name: RwLock::new(None),
            files: RwLock::new(files),
        })
    }
}

pub fn generate_peer_id() -> [u8; 20] {
    let mut id = [0u8; 20];
    id[..8].copy_from_slice(b"-FD2000-");
    rand::thread_rng().fill(&mut id[8..]);
    id
}

/// Announces to all configured HTTP/HTTPS and UDP (BEP-15) trackers concurrently
/// to collect peer SocketAddrs and live seeder/leecher counts.
pub async fn announce_trackers(
    trackers: &[String],
    info_hash: [u8; 20],
    peer_id: [u8; 20],
    listen_port: u16,
    downloaded: u64,
    uploaded: u64,
    left: u64,
) -> TrackerAnnounceReport {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_millis(2400))
        .user_agent("FlowDown/2.0.5")
        .build()
        .unwrap_or_default();

    let mut handles = Vec::new();
    for tr in trackers.iter().take(12) {
        let tr_url = tr.trim().to_string();
        let client_c = client.clone();
        handles.push(tokio::spawn(async move {
            if tr_url.starts_with("http://") || tr_url.starts_with("https://") {
                announce_http_tracker(
                    &client_c, &tr_url, info_hash, peer_id, listen_port, downloaded, uploaded, left,
                )
                .await
            } else if tr_url.starts_with("udp://") {
                announce_udp_tracker(
                    &tr_url, info_hash, peer_id, listen_port, downloaded, uploaded, left,
                )
                .await
            } else {
                Err("Unsupported tracker scheme".to_string())
            }
        }));
    }

    let mut all_peers: Vec<SocketAddr> = Vec::new();
    let mut max_seeds = 0u32;
    let mut max_leechers = 0u32;

    for h in handles {
        if let Ok(Ok(rep)) = h.await {
            max_seeds = max_seeds.max(rep.seeders);
            max_leechers = max_leechers.max(rep.leechers);
            for p in rep.peers {
                if !all_peers.contains(&p) {
                    all_peers.push(p);
                }
            }
        }
    }

    TrackerAnnounceReport {
        peers: all_peers,
        seeders: max_seeds,
        leechers: max_leechers,
    }
}

async fn announce_http_tracker(
    client: &reqwest::Client,
    tracker_url: &str,
    info_hash: [u8; 20],
    peer_id: [u8; 20],
    port: u16,
    downloaded: u64,
    uploaded: u64,
    left: u64,
) -> Result<TrackerAnnounceReport, String> {
    let sep = if tracker_url.contains('?') { '&' } else { '?' };
    let url = format!(
        "{}{}info_hash={}&peer_id={}&port={}&uploaded={}&downloaded={}&left={}&compact=1&numwant=50&event=started",
        tracker_url,
        sep,
        percent_encode_bytes(&info_hash),
        percent_encode_bytes(&peer_id),
        port,
        uploaded,
        downloaded,
        left
    );

    let resp = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("HTTP tracker error: {}", e))?;
    let body = resp
        .bytes()
        .await
        .map_err(|e| format!("HTTP tracker body read error: {}", e))?;

    let decoded = BencodeValue::decode(&body)?;
    let dict = decoded
        .as_dict()
        .ok_or_else(|| "Tracker response is not a bencode dictionary".to_string())?;

    if let Some(fail) = dict
        .get(b"failure reason".as_slice())
        .and_then(|v| v.as_str_lossy())
    {
        return Err(format!("Tracker failure: {}", fail));
    }

    let seeders = dict
        .get(b"complete".as_slice())
        .and_then(|v| v.as_int())
        .unwrap_or(0)
        .max(0) as u32;
    let leechers = dict
        .get(b"incomplete".as_slice())
        .and_then(|v| v.as_int())
        .unwrap_or(0)
        .max(0) as u32;

    let mut peers = Vec::new();
    if let Some(peers_val) = dict.get(b"peers".as_slice()) {
        if let Some(compact) = peers_val.as_bytes() {
            for chunk in compact.chunks_exact(6) {
                let ip = Ipv4Addr::new(chunk[0], chunk[1], chunk[2], chunk[3]);
                let p = u16::from_be_bytes([chunk[4], chunk[5]]);
                if p > 0 {
                    peers.push(SocketAddr::new(IpAddr::V4(ip), p));
                }
            }
        } else if let Some(list) = peers_val.as_list() {
            for item in list {
                if let Some(d) = item.as_dict() {
                    if let (Some(ip_str), Some(p)) = (
                        d.get(b"ip".as_slice()).and_then(|v| v.as_str_lossy()),
                        d.get(b"port".as_slice()).and_then(|v| v.as_int()),
                    ) {
                        if let Ok(ip) = ip_str.parse::<IpAddr>() {
                            if p > 0 && p <= u16::MAX as i64 {
                                peers.push(SocketAddr::new(ip, p as u16));
                            }
                        }
                    }
                }
            }
        }
    }

    // BEP-7: Parse compact IPv6 peers ("peers6" = 16-byte IPv6 + 2-byte port)
    if let Some(peers6_val) = dict.get(b"peers6".as_slice()) {
        if let Some(compact6) = peers6_val.as_bytes() {
            for chunk in compact6.chunks_exact(18) {
                let mut octets = [0u8; 16];
                octets.copy_from_slice(&chunk[0..16]);
                let ip6 = Ipv6Addr::from(octets);
                let p = u16::from_be_bytes([chunk[16], chunk[17]]);
                if p > 0 {
                    peers.push(SocketAddr::new(IpAddr::V6(ip6), p));
                }
            }
        }
    }

    Ok(TrackerAnnounceReport {
        peers,
        seeders,
        leechers,
    })
}

async fn announce_udp_tracker(
    tracker_url: &str,
    info_hash: [u8; 20],
    peer_id: [u8; 20],
    port: u16,
    downloaded: u64,
    uploaded: u64,
    left: u64,
) -> Result<TrackerAnnounceReport, String> {
    let stripped = tracker_url.trim_start_matches("udp://");
    let host_port = stripped.split('/').next().unwrap_or(stripped);

    let mut resolved: Vec<SocketAddr> = match tokio::time::timeout(
        Duration::from_secs(2),
        tokio::net::lookup_host(host_port),
    )
    .await
    {
        Ok(Ok(iter)) => iter.collect(),
        _ => Vec::new(),
    };

    // Automated DoH Bypass: if system UDP:53 DNS failed or was blocked, resolve via encrypted DoH
    if resolved.is_empty() {
        let (host_only, port_num) = match host_port.rsplit_once(':') {
            Some((h, p)) => (h, p.parse::<u16>().unwrap_or(80)),
            None => (host_port, 80),
        };
        if let Ok(doh_addrs) = resolve_host_doh(host_only, port_num).await {
            resolved = doh_addrs;
        }
    }

    if resolved.is_empty() {
        return Err("UDP tracker DNS + DoH resolution failed".to_string());
    }

    // Prefer IPv4 when available, falling back cleanly to IPv6 on IPv6-only networks/trackers
    let target = resolved
        .iter()
        .copied()
        .find(|a| a.is_ipv4())
        .or_else(|| resolved.first().copied())
        .ok_or_else(|| "No address resolved for UDP tracker".to_string())?;

    let bind_addr = if target.is_ipv6() {
        "[::]:0"
    } else {
        "0.0.0.0:0"
    };
    let sock = UdpSocket::bind(bind_addr)
        .await
        .map_err(|e| format!("UDP bind error: {}", e))?;
    sock.connect(target)
        .await
        .map_err(|e| format!("UDP connect error: {}", e))?;

    // BEP-15 Connect Request
    let tx_id: u32 = rand::thread_rng().gen();
    let mut connect_req = [0u8; 16];
    connect_req[0..8].copy_from_slice(&0x0417_2710_1980u64.to_be_bytes());
    connect_req[8..12].copy_from_slice(&0u32.to_be_bytes());
    connect_req[12..16].copy_from_slice(&tx_id.to_be_bytes());

    sock.send(&connect_req)
        .await
        .map_err(|e| format!("UDP send connect error: {}", e))?;

    let mut buf = [0u8; 2048];
    let n = tokio::time::timeout(Duration::from_secs(3), sock.recv(&mut buf))
        .await
        .map_err(|_| "UDP tracker connect timeout".to_string())?
        .map_err(|e| format!("UDP recv connect error: {}", e))?;

    if n < 16 {
        return Err("Invalid UDP tracker connect response".to_string());
    }
    let action = u32::from_be_bytes([buf[0], buf[1], buf[2], buf[3]]);
    let rx_tx = u32::from_be_bytes([buf[4], buf[5], buf[6], buf[7]]);
    if action != 0 || rx_tx != tx_id {
        return Err("UDP tracker connect mismatch".to_string());
    }
    let conn_id = u64::from_be_bytes([
        buf[8], buf[9], buf[10], buf[11], buf[12], buf[13], buf[14], buf[15],
    ]);

    // BEP-15 Announce Request
    let tx_id2: u32 = rand::thread_rng().gen();
    let key: u32 = rand::thread_rng().gen();
    let mut req = [0u8; 98];
    req[0..8].copy_from_slice(&conn_id.to_be_bytes());
    req[8..12].copy_from_slice(&1u32.to_be_bytes()); // action = announce
    req[12..16].copy_from_slice(&tx_id2.to_be_bytes());
    req[16..36].copy_from_slice(&info_hash);
    req[36..56].copy_from_slice(&peer_id);
    req[56..64].copy_from_slice(&downloaded.to_be_bytes());
    req[64..72].copy_from_slice(&left.to_be_bytes());
    req[72..80].copy_from_slice(&uploaded.to_be_bytes());
    req[80..84].copy_from_slice(&2u32.to_be_bytes()); // event = started
    req[84..88].copy_from_slice(&0u32.to_be_bytes()); // IP = default
    req[88..92].copy_from_slice(&key.to_be_bytes());
    req[92..96].copy_from_slice(&(-1i32).to_be_bytes()); // num_want = -1
    req[96..98].copy_from_slice(&port.to_be_bytes());

    sock.send(&req)
        .await
        .map_err(|e| format!("UDP announce send error: {}", e))?;

    let n2 = tokio::time::timeout(Duration::from_secs(3), sock.recv(&mut buf))
        .await
        .map_err(|_| "UDP announce timeout".to_string())?
        .map_err(|e| format!("UDP announce recv error: {}", e))?;

    if n2 < 20 {
        return Err("Invalid UDP announce response".to_string());
    }
    let action2 = u32::from_be_bytes([buf[0], buf[1], buf[2], buf[3]]);
    let rx_tx2 = u32::from_be_bytes([buf[4], buf[5], buf[6], buf[7]]);
    if action2 != 1 || rx_tx2 != tx_id2 {
        return Err("UDP announce mismatch".to_string());
    }
    let leechers = u32::from_be_bytes([buf[12], buf[13], buf[14], buf[15]]);
    let seeders = u32::from_be_bytes([buf[16], buf[17], buf[18], buf[19]]);

    let mut peers = Vec::new();
    let peer_bytes = &buf[20..n2];
    if target.is_ipv6() && peer_bytes.len() % 18 == 0 {
        for chunk in peer_bytes.chunks_exact(18) {
            let mut octets = [0u8; 16];
            octets.copy_from_slice(&chunk[0..16]);
            let ip6 = Ipv6Addr::from(octets);
            let p = u16::from_be_bytes([chunk[16], chunk[17]]);
            if p > 0 {
                peers.push(SocketAddr::new(IpAddr::V6(ip6), p));
            }
        }
    } else {
        for chunk in peer_bytes.chunks_exact(6) {
            let ip = Ipv4Addr::new(chunk[0], chunk[1], chunk[2], chunk[3]);
            let p = u16::from_be_bytes([chunk[4], chunk[5]]);
            if p > 0 {
                peers.push(SocketAddr::new(IpAddr::V4(ip), p));
            }
        }
    }

    Ok(TrackerAnnounceReport {
        peers,
        seeders,
        leechers,
    })
}

/// Runs a real BitTorrent swarm session: tracker announce -> BEP-9 metadata (if magnet) ->
/// piece download with SHA-1 verification and file placement on disk.
#[allow(dead_code)]
pub async fn run_swarm_download(
    info_hash: [u8; 20],
    trackers: Vec<String>,
    initial_torrent: Option<ParsedTorrent>,
    save_dir: PathBuf,
    tracker: Arc<LiveSwarmTracker>,
    libqrbit: Arc<LibqrbitEngine>,
    max_peers: usize,
    mut stop_rx: watch::Receiver<bool>,
) {
    let peer_id = generate_peer_id();
    let listen_port = libqrbit.get_port().await;

    let left = initial_torrent
        .as_ref()
        .map(|t| t.total_size)
        .unwrap_or_else(|| tracker.total_size.load(Ordering::Relaxed));

    let announce = announce_trackers(
        &trackers,
        info_hash,
        peer_id,
        listen_port,
        0,
        0,
        left,
    )
    .await;

    tracker
        .seeds_total
        .store(announce.seeders, Ordering::Relaxed);
    tracker
        .peers_total
        .store(announce.leechers.max(announce.peers.len() as u32), Ordering::Relaxed);

    if *stop_rx.borrow() {
        *tracker.status_note.write().await = "Paused".to_string();
        return;
    }

    if announce.peers.is_empty() {
        *tracker.status_note.write().await =
            "Waiting for peers (no peers returned from trackers)".to_string();
        info!(
            "[BitTorrent] {} announced: 0 peers returned (seeders={}, leechers={})",
            hex_encode(&info_hash),
            announce.seeders,
            announce.leechers
        );
        // Stay parked gracefully watching stop_rx; periodical re-announce every 30s
        loop {
            tokio::select! {
                _ = stop_rx.changed() => {
                    if *stop_rx.borrow() {
                        *tracker.status_note.write().await = "Paused".to_string();
                        return;
                    }
                }
                _ = tokio::time::sleep(Duration::from_secs(30)) => {
                    let retry = announce_trackers(&trackers, info_hash, peer_id, listen_port, 0, 0, left).await;
                    tracker.seeds_total.store(retry.seeders, Ordering::Relaxed);
                    tracker.peers_total.store(retry.leechers.max(retry.peers.len() as u32), Ordering::Relaxed);
                    if !retry.peers.is_empty() {
                        break;
                    }
                }
            }
        }
    }

    // Re-collect peers if loop broke on retry
    let mut peer_list = if !announce.peers.is_empty() {
        announce.peers
    } else {
        announce_trackers(&trackers, info_hash, peer_id, listen_port, 0, 0, left)
            .await
            .peers
    };

    // Resolve BEP-9 metadata if we started from a magnet without .torrent info dictionary
    let parsed = match initial_torrent {
        Some(t) => t,
        None => {
            let hash_hex = hex_encode(&info_hash);
            let mut resolved_meta: Option<ParsedTorrent> = None;
            let mut attempts = 0;

            while resolved_meta.is_none() && attempts < 8 && !*stop_rx.borrow() {
                attempts += 1;
                *tracker.status_note.write().await = format!(
                    "Fetching metadata from {} peers (BEP-9 attempt {}/8)...",
                    peer_list.len(),
                    attempts
                );

                if let Some(m) = fetch_metadata_from_peers(&peer_list, info_hash, peer_id, &stop_rx).await {
                    resolved_meta = Some(m);
                    break;
                }

                if let Some(m) = fetch_torrent_from_public_caches(&hash_hex).await {
                    resolved_meta = Some(m);
                    break;
                }

                if attempts < 8 && !*stop_rx.borrow() {
                    tokio::select! {
                        _ = stop_rx.changed() => {
                            if *stop_rx.borrow() { break; }
                        }
                        _ = tokio::time::sleep(std::time::Duration::from_millis(1500)) => {}
                    }
                    if !*stop_rx.borrow() {
                        let more_peers = announce_trackers(
                            &trackers,
                            info_hash,
                            peer_id,
                            libqrbit.get_port().await,
                            0,
                            0,
                            0,
                        )
                        .await
                        .peers;
                        for p in more_peers {
                            if !peer_list.contains(&p) {
                                peer_list.push(p);
                            }
                        }
                    }
                }
            }

            match resolved_meta {
                Some(meta) => {
                    tracker.total_size.store(meta.total_size, Ordering::Relaxed);
                    tracker
                        .total_pieces
                        .store(meta.piece_hashes.len() as u32, Ordering::Relaxed);
                    tracker.metadata_resolved.store(true, Ordering::Relaxed);
                    *tracker.resolved_name.write().await = Some(meta.name.clone());
                    *tracker.files.write().await = meta.files.clone();
                    meta
                }
                None => {
                    *tracker.status_note.write().await = if *stop_rx.borrow() {
                        "Paused".to_string()
                    } else {
                        "Metadata unresolved (waiting for swarm peers)...".to_string()
                    };
                    return;
                }
            }
        }
    };

    if parsed.piece_hashes.is_empty() || parsed.total_size == 0 {
        *tracker.status_note.write().await = "Completed (empty swarm payload)".to_string();
        tracker.completed.store(true, Ordering::Relaxed);
        return;
    }

    // Pre-create directory layout for torrent files
    let base_dir = if parsed.files.len() > 1 {
        save_dir.join(&parsed.name)
    } else {
        save_dir.clone()
    };
    if let Err(e) = tokio::fs::create_dir_all(&base_dir).await {
        warn!("[BitTorrent] Failed to create dir {}: {}", base_dir.display(), e);
        *tracker.status_note.write().await = format!("Filesystem error: {}", e);
        return;
    }

    let piece_count = parsed.piece_hashes.len();
    let next_piece = Arc::new(Mutex::new(0usize));
    let piece_done = Arc::new(RwLock::new(vec![false; piece_count]));
    let torrent_arc = Arc::new(parsed);
    let file_lock = Arc::new(Mutex::new(()));

    *tracker.status_note.write().await = "Connected to swarm".to_string();

    let mut worker_handles = Vec::new();
    for addr in peer_list.into_iter().take(max_peers.clamp(1, 24)) {
        let tor_c = torrent_arc.clone();
        let tracker_c = tracker.clone();
        let next_c = next_piece.clone();
        let done_c = piece_done.clone();
        let base_c = base_dir.clone();
        let flock_c = file_lock.clone();
        let stop_c = stop_rx.clone();

        worker_handles.push(tokio::spawn(async move {
            peer_download_worker(
                addr,
                info_hash,
                peer_id,
                tor_c,
                tracker_c,
                next_c,
                done_c,
                base_c,
                flock_c,
                stop_c,
            )
            .await;
        }));
    }

    for h in worker_handles {
        let _ = h.await;
    }

    let all_done = done_count(&piece_done).await == piece_count;
    if all_done {
        tracker.completed.store(true, Ordering::Relaxed);
        *tracker.status_note.write().await = "Seeding".to_string();
    } else if *stop_rx.borrow() {
        *tracker.status_note.write().await = "Paused".to_string();
    } else {
        *tracker.status_note.write().await = "Waiting for remaining pieces".to_string();
    }
}

async fn done_count(flags: &Arc<RwLock<Vec<bool>>>) -> usize {
    flags.read().await.iter().filter(|&&b| b).count()
}

/// Concurrently queries public .torrent metadata caches (itorrents.org, torrage.info, btcache.me)
/// with a standard browser User-Agent and verifies the returned bencode dictionary against `info_hash`.
pub async fn fetch_torrent_from_public_caches(info_hash_hex: &str) -> Option<ParsedTorrent> {
    let upper = info_hash_hex.trim().to_ascii_uppercase();
    let lower = info_hash_hex.trim().to_ascii_lowercase();
    if upper.len() != 40 {
        return None;
    }

    let urls = vec![
        format!("https://itorrents.org/torrent/{}.torrent", upper),
        format!("https://torrage.info/torrent.php?h={}", upper),
        format!("http://btcache.me/torrent/{}", upper),
    ];

    let client = reqwest::Client::builder()
        .timeout(Duration::from_millis(2400))
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36")
        .build()
        .ok()?;

    let mut set = tokio::task::JoinSet::new();
    for url in urls {
        let c = client.clone();
        let expected_hash = lower.clone();
        set.spawn(async move {
            let resp = c.get(&url).send().await.ok()?;
            if !resp.status().is_success() {
                return None;
            }
            let bytes = resp.bytes().await.ok()?;
            if bytes.len() < 32 || bytes[0] != b'd' {
                return None;
            }
            let parsed = crate::bencode::parse_torrent_bytes(&bytes).ok()?;
            if parsed.info_hash.eq_ignore_ascii_case(&expected_hash) && parsed.total_size > 0 {
                Some(parsed)
            } else {
                None
            }
        });
    }

    while let Some(res) = set.join_next().await {
        if let Ok(Some(parsed)) = res {
            set.abort_all();
            return Some(parsed);
        }
    }
    None
}

pub async fn fetch_metadata_from_peers(
    peers: &[SocketAddr],
    info_hash: [u8; 20],
    peer_id: [u8; 20],
    stop_rx: &watch::Receiver<bool>,
) -> Option<ParsedTorrent> {
    if peers.is_empty() || *stop_rx.borrow() {
        return None;
    }

    let mut set = tokio::task::JoinSet::new();
    for &addr in peers.iter().take(24) {
        set.spawn(async move {
            match tokio::time::timeout(
                std::time::Duration::from_millis(2500),
                try_bep9_from_peer(addr, info_hash, peer_id),
            )
            .await
            {
                Ok(res) => res,
                Err(_) => Ok(None),
            }
        });
    }

    let mut stop_c = stop_rx.clone();
    loop {
        tokio::select! {
            _ = stop_c.changed() => {
                if *stop_c.borrow() {
                    set.abort_all();
                    return None;
                }
            }
            next = set.join_next() => {
                match next {
                    Some(Ok(Ok(Some(meta)))) => {
                        set.abort_all();
                        return Some(meta);
                    }
                    Some(_) => continue,
                    None => break,
                }
            }
        }
    }
    None
}

async fn try_bep9_from_peer(
    addr: SocketAddr,
    info_hash: [u8; 20],
    peer_id: [u8; 20],
) -> Result<Option<ParsedTorrent>, String> {
    // Connect with fast standard handshake first so responsive peers exchange BEP-9 metadata in <500ms,
    // falling back to MSE/PE encrypted handshake if plaintext handshake is rejected.
    let (mut stream, remote_ext) =
        match PeerStream::connect_and_handshake(addr, info_hash, peer_id, false).await {
            Ok(pair) => pair,
            Err(_) => PeerStream::connect_and_handshake(addr, info_hash, peer_id, true).await?,
        };
    if !remote_ext {
        return Ok(None);
    }

    send_extended_handshake(&mut stream).await?;

    let mut ut_metadata_id: Option<u8> = None;
    let mut metadata_size: usize = 0;
    let mut metadata_pieces: Vec<Option<Vec<u8>>> = Vec::new();

    for _ in 0..64 {
        let Some((msg_id, payload)) = recv_bt_message(&mut stream).await? else {
            break;
        };
        if msg_id != 20 || payload.is_empty() {
            continue;
        }
        let ext_id = payload[0];
        let body = &payload[1..];
        if ext_id == 0 {
            if let Ok(val) = BencodeValue::decode(body) {
                if let Some(dict) = val.as_dict() {
                    if let Some(m) = dict.get(b"m".as_slice()).and_then(|v| v.as_dict()) {
                        if let Some(id) = m.get(b"ut_metadata".as_slice()).and_then(|v| v.as_int()) {
                            ut_metadata_id = Some(id as u8);
                        }
                    }
                    if let Some(sz) = dict.get(b"metadata_size".as_slice()).and_then(|v| v.as_int()) {
                        if sz > 0 && sz <= 16 * 1024 * 1024 {
                            metadata_size = sz as usize;
                            let count = metadata_size.div_ceil(BLOCK_SIZE);
                            metadata_pieces = vec![None; count];
                        }
                    }
                }
            }

            if let Some(remote_ut_id) = ut_metadata_id {
                for piece_idx in 0..metadata_pieces.len() {
                    let mut req = BTreeMap::new();
                    req.insert(b"msg_type".to_vec(), BencodeValue::Int(0));
                    req.insert(b"piece".to_vec(), BencodeValue::Int(piece_idx as i64));
                    let enc = BencodeValue::Dict(req).encode();
                    let mut pkt = Vec::with_capacity(1 + enc.len());
                    pkt.push(remote_ut_id);
                    pkt.extend_from_slice(&enc);
                    send_bt_message(&mut stream, 20, &pkt).await?;
                }
            }
        } else if (ext_id == 1 || Some(ext_id) == ut_metadata_id || ext_id == 2 || ext_id == 3) && metadata_size > 0 {
            if let Some((dict_val, raw_piece)) = split_metadata_message(body) {
                if let Some(d) = dict_val.as_dict() {
                    let msg_type = d.get(b"msg_type".as_slice()).and_then(|v| v.as_int()).unwrap_or(-1);
                    let piece_idx = d.get(b"piece".as_slice()).and_then(|v| v.as_int()).unwrap_or(-1) as usize;
                    if msg_type == 1 && piece_idx < metadata_pieces.len() {
                        metadata_pieces[piece_idx] = Some(raw_piece.to_vec());
                        if metadata_pieces.iter().all(|p| p.is_some()) {
                            let mut info_bytes = Vec::with_capacity(metadata_size);
                            for part in metadata_pieces.iter().flatten() {
                                info_bytes.extend_from_slice(part);
                            }
                            info_bytes.truncate(metadata_size);
                            let h = digest(&SHA1_FOR_LEGACY_USE_ONLY, &info_bytes);
                            if h.as_ref() == info_hash {
                                let mut wrapper = BTreeMap::new();
                                let info_val = BencodeValue::decode(&info_bytes)?;
                                wrapper.insert(b"info".to_vec(), info_val);
                                let full_raw = BencodeValue::Dict(wrapper).encode();
                                if let Ok(parsed) = crate::bencode::parse_torrent_bytes(&full_raw) {
                                    return Ok(Some(parsed));
                                }
                            }
                            return Ok(None);
                        }
                    }
                }
            }
        }
    }

    Ok(None)
}

fn split_metadata_message(body: &[u8]) -> Option<(BencodeValue, &[u8])> {
    // Find end of leading bencode dictionary by trying bounded prefix scan
    for split in 2..=body.len() {
        if body[split - 1] == b'e' {
            if let Ok(v) = BencodeValue::decode(&body[..split]) {
                return Some((v, &body[split..]));
            }
        }
    }
    None
}

async fn peer_download_worker(
    addr: SocketAddr,
    info_hash: [u8; 20],
    peer_id: [u8; 20],
    torrent: Arc<ParsedTorrent>,
    tracker: Arc<LiveSwarmTracker>,
    next_piece: Arc<Mutex<usize>>,
    piece_done: Arc<RwLock<Vec<bool>>>,
    base_dir: PathBuf,
    file_lock: Arc<Mutex<()>>,
    mut stop_rx: watch::Receiver<bool>,
) {
    let Ok((mut stream, _)) =
        PeerStream::connect_and_handshake(addr, info_hash, peer_id, true).await
    else {
        return;
    };

    tracker.peers_connected.fetch_add(1, Ordering::Relaxed);
    tracker.seeds_connected.fetch_add(1, Ordering::Relaxed);

    // Express interest
    let _ = send_bt_message(&mut stream, 2, &[]).await; // Interested

    let mut peer_choking = true;
    let piece_count = torrent.piece_hashes.len();

    'outer: loop {
        if *stop_rx.borrow() {
            break;
        }

        // Wait until unchoked
        while peer_choking {
            tokio::select! {
                _ = stop_rx.changed() => {
                    if *stop_rx.borrow() {
                        break 'outer;
                    }
                }
                msg = recv_bt_message(&mut stream) => {
                    match msg {
                        Ok(Some((1, _))) => peer_choking = false, // Unchoke
                        Ok(Some((0, _))) => peer_choking = true,  // Choke
                        Ok(Some(_)) => {}
                        _ => break 'outer,
                    }
                }
            }
        }

        // Claim next piece
        let piece_idx = {
            let mut guard = next_piece.lock().await;
            let done_r = piece_done.read().await;
            while *guard < piece_count && done_r[*guard] {
                *guard += 1;
            }
            if *guard >= piece_count {
                break;
            }
            let idx = *guard;
            *guard += 1;
            idx
        };

        let piece_offset = piece_idx as u64 * torrent.piece_length;
        let this_piece_len = (torrent.total_size.saturating_sub(piece_offset))
            .min(torrent.piece_length) as usize;
        let mut piece_buf = vec![0u8; this_piece_len];
        let mut received = 0usize;

        while received < this_piece_len {
            if *stop_rx.borrow() {
                break 'outer;
            }
            let req_len = (this_piece_len - received).min(BLOCK_SIZE);
            let mut req_payload = [0u8; 12];
            req_payload[0..4].copy_from_slice(&(piece_idx as u32).to_be_bytes());
            req_payload[4..8].copy_from_slice(&(received as u32).to_be_bytes());
            req_payload[8..12].copy_from_slice(&(req_len as u32).to_be_bytes());

            if send_bt_message(&mut stream, 6, &req_payload).await.is_err() {
                break 'outer;
            }

            loop {
                tokio::select! {
                    _ = stop_rx.changed() => {
                        if *stop_rx.borrow() {
                            break 'outer;
                        }
                    }
                    msg = recv_bt_message(&mut stream) => {
                        match msg {
                            Ok(Some((7, payload))) if payload.len() >= 8 => {
                                let p_idx = u32::from_be_bytes([payload[0], payload[1], payload[2], payload[3]]) as usize;
                                let begin = u32::from_be_bytes([payload[4], payload[5], payload[6], payload[7]]) as usize;
                                let block = &payload[8..];
                                if p_idx == piece_idx && begin == received && begin + block.len() <= this_piece_len {
                                    piece_buf[begin..begin + block.len()].copy_from_slice(block);
                                    received += block.len();
                                    tracker.downloaded_bytes.fetch_add(block.len() as u64, Ordering::Relaxed);
                                    break;
                                }
                            }
                            Ok(Some((0, _))) => {
                                peer_choking = true;
                                continue 'outer;
                            }
                            Ok(Some((1, _))) => peer_choking = false,
                            Ok(Some(_)) => {}
                            _ => break 'outer,
                        }
                    }
                }
            }
        }

        // Verify SHA-1 piece hash
        let actual_hash = digest(&SHA1_FOR_LEGACY_USE_ONLY, &piece_buf);
        if actual_hash.as_ref() == torrent.piece_hashes[piece_idx] {
            if write_piece_to_files(&base_dir, &torrent.files, piece_offset, &piece_buf, &file_lock)
                .await
                .is_ok()
            {
                let mut done_w = piece_done.write().await;
                if !done_w[piece_idx] {
                    done_w[piece_idx] = true;
                    tracker.completed_pieces.fetch_add(1, Ordering::Relaxed);
                }
            }
        } else {
            warn!("[BitTorrent] Piece {} failed SHA-1 verification from {}", piece_idx, addr);
        }
    }

    tracker.peers_connected.fetch_sub(1, Ordering::Relaxed);
    tracker.seeds_connected.fetch_sub(1, Ordering::Relaxed);
}

async fn write_piece_to_files(
    base_dir: &PathBuf,
    files: &[TorrentFileEntry],
    piece_offset: u64,
    data: &[u8],
    file_lock: &Arc<Mutex<()>>,
) -> Result<(), String> {
    let _guard = file_lock.lock().await;
    let piece_end = piece_offset + data.len() as u64;

    for entry in files {
        let f_start = entry.offset;
        let f_end = entry.offset + entry.length;
        if piece_end <= f_start || piece_offset >= f_end {
            continue;
        }
        let overlap_start = piece_offset.max(f_start);
        let overlap_end = piece_end.min(f_end);
        let slice_start = (overlap_start - piece_offset) as usize;
        let slice_end = (overlap_end - piece_offset) as usize;
        let file_seek = overlap_start - f_start;

        let target_path = base_dir.join(&entry.path);
        if let Some(parent) = target_path.parent() {
            let _ = tokio::fs::create_dir_all(parent).await;
        }
        let mut file = OpenOptions::new()
            .create(true)
            .write(true)
            .open(&target_path)
            .await
            .map_err(|e| format!("File open error: {}", e))?;
        file.seek(SeekFrom::Start(file_seek))
            .await
            .map_err(|e| format!("File seek error: {}", e))?;
        file.write_all(&data[slice_start..slice_end])
            .await
            .map_err(|e| format!("File write error: {}", e))?;
        file.flush()
            .await
            .map_err(|e| format!("File flush error: {}", e))?;
    }
    Ok(())
}

async fn send_extended_handshake(stream: &mut PeerStream) -> Result<(), String> {
    let mut m = BTreeMap::new();
    m.insert(b"ut_metadata".to_vec(), BencodeValue::Int(1));
    let mut root = BTreeMap::new();
    root.insert(b"m".to_vec(), BencodeValue::Dict(m));
    root.insert(b"v".to_vec(), BencodeValue::Bytes(b"FlowDown 2.0.5".to_vec()));
    let enc = BencodeValue::Dict(root).encode();
    let mut payload = Vec::with_capacity(1 + enc.len());
    payload.push(0); // extended msg id 0 = handshake
    payload.extend_from_slice(&enc);
    send_bt_message(stream, 20, &payload).await
}

async fn send_bt_message(stream: &mut PeerStream, msg_id: u8, payload: &[u8]) -> Result<(), String> {
    let len = (1 + payload.len()) as u32;
    let mut header = [0u8; 5];
    header[0..4].copy_from_slice(&len.to_be_bytes());
    header[4] = msg_id;
    stream
        .write_all(&header)
        .await
        .map_err(|e| format!("Message header write failed: {}", e))?;
    if !payload.is_empty() {
        stream
            .write_all(payload)
            .await
            .map_err(|e| format!("Message payload write failed: {}", e))?;
    }
    stream
        .flush()
        .await
        .map_err(|e| format!("Message flush failed: {}", e))
}

async fn recv_bt_message(stream: &mut PeerStream) -> Result<Option<(u8, Vec<u8>)>, String> {
    loop {
        let mut len_buf = [0u8; 4];
        match tokio::time::timeout(Duration::from_secs(10), stream.read_exact(&mut len_buf)).await {
            Ok(Ok(_)) => {}
            Ok(Err(e)) => return Err(format!("Peer closed connection: {}", e)),
            Err(_) => return Ok(None),
        }
        let len = u32::from_be_bytes(len_buf) as usize;
        if len == 0 {
            continue; // keep-alive
        }
        if len > 4 * 1024 * 1024 {
            return Err("Peer message exceeded 4 MiB limit".to_string());
        }
        let mut buf = vec![0u8; len];
        tokio::time::timeout(Duration::from_secs(10), stream.read_exact(&mut buf))
            .await
            .map_err(|_| "Peer payload read timeout".to_string())?
            .map_err(|e| format!("Peer payload read error: {}", e))?;
        let msg_id = buf[0];
        let payload = buf[1..].to_vec();
        return Ok(Some((msg_id, payload)));
    }
}
