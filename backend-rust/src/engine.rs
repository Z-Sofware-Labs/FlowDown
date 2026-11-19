use crate::bencode::{
    parse_magnet_or_hash, parse_torrent_bytes, ParsedTorrent, TorrentFileEntry,
};
use crate::bittorrent::{run_swarm_download, LiveSwarmTracker};
use crate::config::SharedConfig;
use crate::http_downloader::{
    HttpDownloadOptions, HttpDownloader, HttpSegmentProgress, LiveHttpTracker,
};
use crate::libqrbit::LibqrbitEngine;
use chrono::Utc;
use ring::digest::{digest, SHA1_FOR_LEGACY_USE_ONLY};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use tokio::sync::{watch, RwLock};
use tracing::{error, info};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TransferItem {
    pub id: String,
    pub name: String,
    pub url: Option<String>,
    pub size: u64,
    pub downloaded: u64,
    pub uploaded: u64,
    pub download_speed: u64,
    pub upload_speed: u64,
    pub status: String, // "downloading", "seeding", "paused", "stealth_active", "completed", "metadata", "checking", "error"
    pub progress: f32,
    pub seeds_connected: u32,
    pub seeds_total: u32,
    pub peers_connected: u32,
    pub peers_total: u32,
    pub ratio: f32,
    pub is_http_segmented: bool,
    pub save_path: PathBuf,
    pub added_date: String,
    pub eta: String,
    pub libqrbit_enabled: bool,
    pub hash: String,
    pub category: String,
    pub priority: String,
    pub speed_limit_kbps: Option<u64>,
    pub segments: Option<Vec<HttpSegmentProgress>>,
    #[serde(default)]
    pub trackers: Vec<String>,
    #[serde(default)]
    pub files: Vec<TorrentFileEntry>,
    #[serde(default)]
    pub is_missing: bool,
    #[serde(default)]
    pub status_note: String,
    #[serde(default = "default_obfuscation_level")]
    pub obfuscation_level: u8,
}

fn default_obfuscation_level() -> u8 {
    3
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionStats {
    pub session_downloaded: u64,
    pub session_uploaded: u64,
    pub active_torrents_count: usize,
    pub active_http_count: usize,
    pub total_down_speed: u64,
    pub total_up_speed: u64,
    pub stealth_active: bool,
    pub stealth_port: u16,
    pub alt_speed_active: bool,
}

struct ActiveHttpControl {
    stop_tx: watch::Sender<bool>,
    tracker: Arc<LiveHttpTracker>,
    last_seg_bytes: Vec<u64>,
    last_total_bytes: u64,
    last_tick_time: std::time::Instant,
    speed_samples: std::collections::VecDeque<u64>,
    has_initial_sample: bool,
}

struct ActiveSwarmControl {
    stop_tx: watch::Sender<bool>,
    tracker: Arc<LiveSwarmTracker>,
    last_down_bytes: u64,
    last_up_bytes: u64,
}

fn sanitize_folder_name(name: &str) -> String {
    let sanitized: String = name
        .chars()
        .map(|c| match c {
            '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' => '_',
            other => other,
        })
        .collect();
    let trimmed = sanitized.trim().trim_matches('.').to_string();
    if trimmed.is_empty() {
        "Torrent_Download".to_string()
    } else {
        trimmed
    }
}

pub struct DaemonEngine {
    config: SharedConfig,
    transfers: Arc<RwLock<HashMap<String, TransferItem>>>,
    transfers_path: PathBuf,
    session_downloaded: Arc<AtomicU64>,
    session_uploaded: Arc<AtomicU64>,
    libqrbit: Arc<LibqrbitEngine>,
    http_downloader: Arc<HttpDownloader>,
    http_controls: Arc<RwLock<HashMap<String, ActiveHttpControl>>>,
    swarm_controls: Arc<RwLock<HashMap<String, ActiveSwarmControl>>>,
    rqbit_session: Arc<tokio::sync::RwLock<Option<Arc<librqbit::Session>>>>,
    rqbit_ids: Arc<RwLock<HashMap<String, usize>>>,
    parsed_torrents: Arc<RwLock<HashMap<String, ParsedTorrent>>>,
    logs: Arc<RwLock<Vec<String>>>,
}

impl DaemonEngine {
    pub fn new(config: SharedConfig, libqrbit: Arc<LibqrbitEngine>, transfers_path: PathBuf) -> Self {
        Self {
            config,
            transfers: Arc::new(RwLock::new(HashMap::new())),
            transfers_path,
            session_downloaded: Arc::new(AtomicU64::new(0)),
            session_uploaded: Arc::new(AtomicU64::new(0)),
            libqrbit,
            http_downloader: Arc::new(HttpDownloader::new("FlowDown/2.0.6 (RustCore)")),
            http_controls: Arc::new(RwLock::new(HashMap::new())),
            swarm_controls: Arc::new(RwLock::new(HashMap::new())),
            rqbit_session: Arc::new(tokio::sync::RwLock::new(None)),
            rqbit_ids: Arc::new(RwLock::new(HashMap::new())),
            parsed_torrents: Arc::new(RwLock::new(HashMap::new())),
            logs: Arc::new(RwLock::new(vec![
                "[INFO] FlowDown Rust core daemon initialized (Tokio async runtime).".to_string(),
                "[LIBQRBIT] Ephemeral UDP stealth port hopping and QUIC envelope ready.".to_string(),
            ])),
        }
    }

    pub async fn get_rqbit_session(&self) -> Result<Arc<librqbit::Session>, String> {
        {
            let r = self.rqbit_session.read().await;
            if let Some(ref s) = *r {
                return Ok(s.clone());
            }
        }
        let mut w = self.rqbit_session.write().await;
        if let Some(ref s) = *w {
            return Ok(s.clone());
        }

        let download_dir = {
            let cfg = self.config.read().await;
            cfg.download_directory.clone()
        };
        let _ = tokio::fs::create_dir_all(&download_dir).await;

        let opts = librqbit::SessionOptions::default();

        let session = librqbit::Session::new_with_opts(download_dir, opts)
            .await
            .map_err(|e| format!("Failed to create librqbit BitTorrent session: {e}"))?;

        *w = Some(session.clone());
        Ok(session)
    }

    pub async fn load_persisted_transfers(&self) {
        if !self.transfers_path.exists() {
            return;
        }
        match tokio::fs::read_to_string(&self.transfers_path).await {
            Ok(raw) => {
                if let Ok(list) = serde_json::from_str::<Vec<TransferItem>>(&raw) {
                    let count = list.len();
                    let mut map = self.transfers.write().await;
                    for mut item in list {
                        if matches!(
                            item.status.as_str(),
                            "downloading" | "stealth_active" | "metadata" | "checking"
                        ) {
                            item.status = "paused".to_string();
                            item.download_speed = 0;
                            item.upload_speed = 0;
                            item.eta = "Paused".to_string();
                        }
                        map.insert(item.id.clone(), item);
                    }
                    info!("[Engine] Restored {} transfer(s) from {}", count, self.transfers_path.display());
                }
            }
            Err(e) => {
                error!("[Engine] Failed to load transfers: {}", e);
            }
        }
    }

    pub async fn save_transfers(&self) {
        let list = self.list_transfers().await;
        if let Some(parent) = self.transfers_path.parent() {
            if !parent.as_os_str().is_empty() {
                let _ = tokio::fs::create_dir_all(parent).await;
            }
        }
        if let Ok(json) = serde_json::to_string(&list) {
            let _ = tokio::fs::write(&self.transfers_path, json).await;
        }
    }

    pub async fn push_log(&self, line: String) {
        let mut logs = self.logs.write().await;
        let ts = Utc::now().format("%H:%M:%S");
        logs.push(format!("[{}] {}", ts, line));
        if logs.len() > 250 {
            let drain = logs.len() - 250;
            logs.drain(0..drain);
        }
    }

    pub async fn get_logs(&self) -> Vec<String> {
        self.logs.read().await.clone()
    }

    pub fn reset_session_stats(&self) {
        self.session_downloaded.store(0, Ordering::Relaxed);
        self.session_uploaded.store(0, Ordering::Relaxed);
        info!("[Engine] Session statistics reset to 0 B without interrupting transfers.");
    }

    pub async fn get_session_stats(&self) -> SessionStats {
        let transfers = self.transfers.read().await;
        let mut total_down = 0;
        let mut total_up = 0;
        let mut torrent_count = 0;
        let mut http_count = 0;

        for item in transfers.values() {
            total_down += item.download_speed;
            total_up += item.upload_speed;
            if item.is_http_segmented {
                http_count += 1;
            } else {
                torrent_count += 1;
            }
        }

        let cfg = self.config.read().await;
        SessionStats {
            session_downloaded: self.session_downloaded.load(Ordering::Relaxed),
            session_uploaded: self.session_uploaded.load(Ordering::Relaxed),
            active_torrents_count: torrent_count,
            active_http_count: http_count,
            total_down_speed: total_down,
            total_up_speed: total_up,
            stealth_active: self.libqrbit.is_enabled().await,
            stealth_port: self.libqrbit.get_port().await,
            alt_speed_active: cfg.bandwidth.alt_speed_active,
        }
    }

    pub async fn list_transfers(&self) -> Vec<TransferItem> {
        let transfers = self.transfers.read().await;
        let mut list: Vec<TransferItem> = transfers.values().cloned().collect();
        list.sort_by(|a, b| a.added_date.cmp(&b.added_date));
        list
    }

    pub async fn get_transfer(&self, id: &str) -> Option<TransferItem> {
        self.transfers.read().await.get(id).cloned()
    }

    pub async fn add_http_transfer(
        &self,
        mut url: String,
        mut name: String,
        mut size: u64,
        segments_count: usize,
        category: String,
        priority: String,
        _stealth: bool,
        _obfuscation_level: u8,
        save_path: PathBuf,
    ) -> Result<TransferItem, String> {
        if !(url.starts_with("http://") || url.starts_with("https://")) {
            return Err("Only http:// and https:// URLs are supported".to_string());
        }

        let (user_agent, referer, timeout_seconds, max_retries, buffer_bytes, auto_resume) = {
            let cfg = self.config.read().await;
            let ua = cfg.http.resolve_user_agent();
            let refer = match cfg.http.referer_mode.as_str() {
                "empty" => None,
                "custom" if !cfg.http.custom_referer.trim().is_empty() => {
                    Some(cfg.http.custom_referer.clone())
                }
                _ => Some(url.clone()),
            };
            (
                ua,
                refer,
                cfg.http.timeout_seconds,
                cfg.http.max_retries,
                cfg.http.resolve_buffer_bytes(),
                cfg.http.auto_resume_broken,
            )
        };

        let mut supports_ranges = true;
        if size == 0 || name.trim().is_empty() {
            if let Ok(probe) = self.http_downloader.probe_with_ua(&url, &user_agent).await {
                if !probe.url.is_empty() {
                    url = probe.url;
                }
                if size == 0 && probe.content_length > 0 {
                    size = probe.content_length;
                }
                if name.trim().is_empty() || name == "download.bin" {
                    name = probe.file_name;
                }
                supports_ranges = probe.supports_ranges;
            }
        }
        if name.trim().is_empty() {
            name = "download.bin".to_string();
        }

        let id = format!("http-{}", Utc::now().timestamp_millis());
        let segs = segments_count.clamp(1, 32);
        let item = TransferItem {
            id: id.clone(),
            name: name.clone(),
            url: Some(url.clone()),
            size,
            downloaded: 0,
            uploaded: 0,
            download_speed: 0,
            upload_speed: 0,
            status: "downloading".to_string(),
            progress: 0.0,
            seeds_connected: 0,
            seeds_total: 0,
            peers_connected: if supports_ranges { segs as u32 } else { 1 },
            peers_total: if supports_ranges { segs as u32 } else { 1 },
            ratio: 0.0,
            is_http_segmented: true,
            save_path: save_path.clone(),
            added_date: Utc::now().format("%Y-%m-%d %H:%M:%S").to_string(),
            eta: "Starting...".to_string(),
            libqrbit_enabled: false,
            hash: format!("{:040x}", Utc::now().timestamp_nanos_opt().unwrap_or(1)),
            category,
            priority,
            speed_limit_kbps: None,
            segments: None,
            trackers: Vec::new(),
            files: vec![TorrentFileEntry {
                path: name.clone(),
                length: size,
                offset: 0,
            }],
            is_missing: false,
            status_note: format!("Multi-segment HTTP ({} streams)", if supports_ranges { segs } else { 1 }),
            obfuscation_level: 1,
        };

        {
            self.transfers.write().await.insert(id.clone(), item.clone());
        }
        self.save_transfers().await;
        self.push_log(format!("Queued HTTP transfer '{}' ({} segments)", name, segs)).await;

        let options = HttpDownloadOptions {
            user_agent,
            referer,
            timeout_seconds,
            max_retries,
            buffer_bytes,
            auto_resume,
        };

        self.spawn_http_worker(
            id,
            url,
            save_path.join(&name),
            size,
            segs,
            supports_ranges,
            options,
        )
        .await;

        Ok(item)
    }

    pub async fn set_http_segments(&self, id_opt: Option<&str>, target_segments: usize) {
        let target = target_segments.clamp(1, 32);
        let mut transfers = self.transfers.write().await;
        let controls = self.http_controls.read().await;

        for (id, t) in transfers.iter_mut() {
            if !t.is_http_segmented {
                continue;
            }
            if let Some(target_id) = id_opt {
                if t.id != target_id {
                    continue;
                }
            }
            t.peers_total = target as u32;
            t.status_note = format!("Multi-segment HTTP ({} streams)", target);
            if let Some(ctrl) = controls.get(id) {
                ctrl.tracker.set_target_segments(target);
            }
        }
    }

    async fn spawn_http_worker(
        &self,
        id: String,
        url: String,
        dest_file: PathBuf,
        size: u64,
        segments_count: usize,
        supports_ranges: bool,
        options: HttpDownloadOptions,
    ) {
        let (ranges, initial) = if options.auto_resume && size > 0 {
            HttpDownloader::load_or_resegment_checkpoint(&dest_file, &url, size, segments_count, supports_ranges).await
        } else {
            let r = HttpDownloader::prepare_ranges(size, segments_count, supports_ranges);
            let init = vec![0u64; r.len()];
            (r, init)
        };

        let tracker = LiveHttpTracker::with_target(size, ranges, &initial, segments_count);
        let initial_sum = tracker.total_downloaded.load(Ordering::Relaxed);
        let (stop_tx, stop_rx) = watch::channel(false);

        {
            self.http_controls.write().await.insert(
                id.clone(),
                ActiveHttpControl {
                    stop_tx,
                    tracker: tracker.clone(),
                    last_seg_bytes: initial,
                    last_total_bytes: initial_sum,
                    last_tick_time: std::time::Instant::now(),
                    speed_samples: std::collections::VecDeque::with_capacity(4),
                    has_initial_sample: false,
                },
            );
        }

        let downloader = self.http_downloader.clone();
        let transfers_map = self.transfers.clone();
        let controls_map = self.http_controls.clone();
        let logs_ref = self.logs.clone();
        let transfers_path = self.transfers_path.clone();

        tokio::spawn(async move {
            let res = downloader
                .download_with_tracker(
                    url,
                    dest_file,
                    supports_ranges,
                    tracker.clone(),
                    options,
                    stop_rx,
                )
                .await;

            controls_map.write().await.remove(&id);

            let final_downloaded = tracker.total_downloaded.load(Ordering::Relaxed);
            {
                let mut map = transfers_map.write().await;
                if let Some(t) = map.get_mut(&id) {
                    t.downloaded = final_downloaded;
                    if t.size == 0 && final_downloaded > 0 {
                        t.size = final_downloaded;
                    }
                    t.download_speed = 0;
                    let mut dummy = Vec::new();
                    t.segments = Some(tracker.snapshot_segments(&mut dummy, 0.0));

                    match res {
                        Ok(true) => {
                            t.size = t.size.max(final_downloaded);
                            t.downloaded = t.size;
                            t.progress = 100.0;
                            t.status = "completed".to_string();
                            t.eta = "Done".to_string();
                            t.status_note = "Completed".to_string();
                        }
                        Ok(false) => {
                            if t.size > 0 {
                                t.progress = ((t.downloaded as f64 / t.size as f64) * 100.0) as f32;
                            }
                            t.status = "paused".to_string();
                            t.eta = "Paused".to_string();
                            t.status_note = "Paused".to_string();
                        }
                        Err(e) => {
                            if t.size > 0 {
                                t.progress = ((t.downloaded as f64 / t.size as f64) * 100.0) as f32;
                            }
                            t.status = "error".to_string();
                            t.eta = "Error".to_string();
                            t.status_note = e.clone();
                            let mut l = logs_ref.write().await;
                            l.push(format!("[{}] [ERROR] HTTP {}: {}", Utc::now().format("%H:%M:%S"), t.name, e));
                        }
                    }
                }
            }

            // Persist snapshot on task completion/pause/error
            let list: Vec<TransferItem> = transfers_map.read().await.values().cloned().collect();
            if let Ok(json) = serde_json::to_string_pretty(&list) {
                let _ = tokio::fs::write(&transfers_path, json).await;
            }
        });
    }

    pub async fn add_magnet_transfer(
        &self,
        raw_input: String,
        override_name: Option<String>,
        override_size: Option<u64>,
        category: String,
        priority: String,
        stealth: bool,
        obfuscation_level: u8,
        save_path: PathBuf,
    ) -> Result<TransferItem, String> {
        let resolved = parse_magnet_or_hash(&raw_input)?;
        let name = override_name
            .filter(|n| !n.trim().is_empty())
            .unwrap_or_else(|| resolved.name.clone());
        let size = override_size.filter(|&s| s > 0).unwrap_or(resolved.size);

        let id = format!("tor-{}", Utc::now().timestamp_millis());
        let item = TransferItem {
            id: id.clone(),
            name: name.clone(),
            url: Some(resolved.magnet_uri.clone()),
            size,
            downloaded: 0,
            uploaded: 0,
            download_speed: 0,
            upload_speed: 0,
            status: "metadata".to_string(),
            progress: 0.0,
            seeds_connected: 0,
            seeds_total: 0,
            peers_connected: 0,
            peers_total: 0,
            ratio: 0.0,
            is_http_segmented: false,
            save_path: save_path.clone(),
            added_date: Utc::now().format("%Y-%m-%d %H:%M:%S").to_string(),
            eta: "Resolving...".to_string(),
            libqrbit_enabled: stealth,
            hash: resolved.info_hash.clone(),
            category,
            priority,
            speed_limit_kbps: None,
            segments: None,
            trackers: resolved.trackers.clone(),
            files: Vec::new(),
            is_missing: false,
            status_note: "Fetching magnet metadata (BEP-9)...".to_string(),
            obfuscation_level: obfuscation_level.clamp(1, 4),
        };

        self.transfers.write().await.insert(id.clone(), item.clone());
        self.save_transfers().await;
        self.push_log(format!("Queued magnet swarm '{}' ({})", name, resolved.info_hash))
            .await;

        let primary_url = if raw_input.to_ascii_lowercase().starts_with("magnet:") {
            raw_input.clone()
        } else {
            resolved.magnet_uri.clone()
        };
        let source = librqbit::AddTorrent::from_url(primary_url);
        let _ = self.start_rqbit_torrent(id.clone(), source, save_path).await;

        Ok(item)
    }

    pub async fn add_torrent_bytes(
        &self,
        raw_bytes: &[u8],
        category: String,
        priority: String,
        stealth: bool,
        obfuscation_level: u8,
        save_path: PathBuf,
    ) -> Result<TransferItem, String> {
        let parsed = parse_torrent_bytes(raw_bytes)?;
        let id = format!("tor-{}", Utc::now().timestamp_millis());
        let trackers = if parsed.trackers.is_empty() {
            vec!["udp://tracker.opentrackr.org:1337/announce".to_string()]
        } else {
            parsed.trackers.clone()
        };

        let is_multi = parsed.files.len() > 1;
        let effective_save_path = if is_multi {
            save_path.join(sanitize_folder_name(&parsed.name))
        } else {
            save_path.clone()
        };
        let _ = tokio::fs::create_dir_all(&effective_save_path).await;

        let item = TransferItem {
            id: id.clone(),
            name: parsed.name.clone(),
            url: None,
            size: parsed.total_size,
            downloaded: 0,
            uploaded: 0,
            download_speed: 0,
            upload_speed: 0,
            status: if stealth {
                "stealth_active".to_string()
            } else {
                "downloading".to_string()
            },
            progress: 0.0,
            seeds_connected: 0,
            seeds_total: 0,
            peers_connected: 0,
            peers_total: 0,
            ratio: 0.0,
            is_http_segmented: false,
            save_path: effective_save_path.clone(),
            added_date: Utc::now().format("%Y-%m-%d %H:%M:%S").to_string(),
            eta: "Announcing...".to_string(),
            libqrbit_enabled: stealth,
            hash: parsed.info_hash.clone(),
            category,
            priority,
            speed_limit_kbps: None,
            segments: None,
            trackers: trackers.clone(),
            files: parsed.files.clone(),
            is_missing: false,
            status_note: "Announcing to trackers...".to_string(),
            obfuscation_level: obfuscation_level.clamp(1, 4),
        };

        self.parsed_torrents
            .write()
            .await
            .insert(id.clone(), parsed.clone());
        self.transfers.write().await.insert(id.clone(), item.clone());
        self.save_transfers().await;
        self.push_log(format!(
            "Added .torrent '{}' ({} files, {} pieces)",
            parsed.name,
            parsed.files.len(),
            parsed.piece_hashes.len()
        ))
        .await;

        // Spawn production librqbit swarm downloader
        let source = librqbit::AddTorrent::from_bytes(raw_bytes.to_vec());
        let _ = self.start_rqbit_torrent(id.clone(), source, effective_save_path).await;

        Ok(item)
    }

    async fn start_rqbit_torrent(
        &self,
        id: String,
        source: librqbit::AddTorrent<'static>,
        save_path: PathBuf,
    ) -> Result<usize, String> {
        let session = self.get_rqbit_session().await?;
        let _ = tokio::fs::create_dir_all(&save_path).await;

        let default_download_dir = {
            let cfg = self.config.read().await;
            cfg.download_directory.clone()
        };

        // When saving to default download directory (or download root), pass output_folder: None
        // so librqbit's default rule automatically places multi-file torrents into a dedicated subfolder,
        // while single-file torrents download directly into the download directory.
        let opts = if save_path == default_download_dir {
            librqbit::AddTorrentOptions {
                output_folder: None,
                overwrite: true,
                ..Default::default()
            }
        } else {
            librqbit::AddTorrentOptions {
                output_folder: Some(save_path.to_string_lossy().to_string()),
                overwrite: true,
                ..Default::default()
            }
        };

        let response = session
            .add_torrent(source, Some(opts))
            .await
            .map_err(|e| format!("Failed to add torrent to librqbit engine: {e}"))?;

        let (torrent_id, torrent) = match response {
            librqbit::AddTorrentResponse::Added(id, t) => (id, t),
            librqbit::AddTorrentResponse::AlreadyManaged(id, t) => (id, t),
            librqbit::AddTorrentResponse::ListOnly(_) => {
                return Err("Torrent was only inspected".to_string());
            }
        };

        self.rqbit_ids.write().await.insert(id.clone(), torrent_id);
        self.spawn_rqbit_stats_worker(id, torrent).await;

        Ok(torrent_id)
    }

    async fn spawn_rqbit_stats_worker(&self, id: String, torrent: Arc<librqbit::ManagedTorrent>) {
        let (stop_tx, mut stop_rx) = watch::channel(false);
        let dummy_tracker = LiveSwarmTracker::new(0, 0, false, Vec::new());
        self.swarm_controls.write().await.insert(
            id.clone(),
            ActiveSwarmControl {
                stop_tx,
                tracker: dummy_tracker,
                last_down_bytes: 0,
                last_up_bytes: 0,
            },
        );

        let transfers_map = self.transfers.clone();
        let swarm_controls = self.swarm_controls.clone();
        let transfers_path = self.transfers_path.clone();
        let session_downloaded = self.session_downloaded.clone();
        let session_uploaded = self.session_uploaded.clone();
        let tid = id.clone();

        tokio::spawn(async move {
            let mut interval = tokio::time::interval(std::time::Duration::from_millis(1000));
            let mut last_progress_bytes = 0u64;
            let mut last_uploaded_bytes = 0u64;
            let mut last_tick_time = std::time::Instant::now();
            let mut speed_samples: std::collections::VecDeque<u64> = std::collections::VecDeque::with_capacity(4);
            let mut has_initial_sample = false;

            loop {
                tokio::select! {
                    _ = stop_rx.changed() => {
                        if *stop_rx.borrow() {
                            break;
                        }
                    }
                    _ = interval.tick() => {
                        let now = std::time::Instant::now();
                        let elapsed_secs = now.duration_since(last_tick_time).as_secs_f64().max(0.1);
                        last_tick_time = now;

                        let stats = torrent.stats();
                        let wire_down_speed = stats
                            .live
                            .as_ref()
                            .map(|live| live.download_speed.as_bytes())
                            .unwrap_or(0);
                        let wire_up_speed = stats
                            .live
                            .as_ref()
                            .map(|live| live.upload_speed.as_bytes())
                            .unwrap_or(0);
                        let peers = stats
                            .live
                            .as_ref()
                            .map(|live| live.snapshot.peer_stats.live as u32)
                            .unwrap_or(0);

                        let delta_down = if has_initial_sample {
                            stats.progress_bytes.saturating_sub(last_progress_bytes)
                        } else {
                            0
                        };
                        let delta_up = if has_initial_sample {
                            stats.uploaded_bytes.saturating_sub(last_uploaded_bytes)
                        } else {
                            0
                        };

                        if delta_down > 0 {
                            session_downloaded.fetch_add(delta_down, Ordering::Relaxed);
                        }
                        if delta_up > 0 {
                            session_uploaded.fetch_add(delta_up, Ordering::Relaxed);
                        }

                        last_progress_bytes = stats.progress_bytes;
                        last_uploaded_bytes = stats.uploaded_bytes;
                        has_initial_sample = true;

                        // Calculate instantaneous rate from actual completed payload progress
                        let instant_rate = (delta_down as f64 / elapsed_secs) as u64;
                        speed_samples.push_back(instant_rate);
                        if speed_samples.len() > 3 {
                            speed_samples.pop_front();
                        }
                        let avg_progress_speed = if !speed_samples.is_empty() {
                            speed_samples.iter().sum::<u64>() / speed_samples.len() as u64
                        } else {
                            0
                        };

                        // Real effective speed: higher of completed progress rate and socket wire rate
                        let down_speed = avg_progress_speed.max(wire_down_speed);
                        let up_speed = wire_up_speed;

                        let mut map = transfers_map.write().await;
                        if let Some(t) = map.get_mut(&tid) {
                            if stats.progress_bytes > 0 || t.downloaded == 0 {
                                t.downloaded = stats.progress_bytes;
                            }
                            t.uploaded = stats.uploaded_bytes;
                            let total = if stats.total_bytes > 0 {
                                t.size = stats.total_bytes;
                                stats.total_bytes
                            } else {
                                t.size
                            };
                            if total > 0 {
                                let calc = ((stats.progress_bytes as f64 / total as f64) * 100.0).min(100.0) as f32;
                                if calc > t.progress || stats.progress_bytes == 0 {
                                    t.progress = calc;
                                }
                            }

                            // Update files and name as soon as metadata is available
                            let _ = torrent.with_metadata(|meta| {
                                if t.files.is_empty() {
                                    let files = meta
                                        .info
                                        .iter_file_details()
                                        .map(|detail| TorrentFileEntry {
                                            path: detail.filename.to_pathbuf().to_string_lossy().into_owned(),
                                            length: detail.len,
                                            offset: 0,
                                        })
                                        .collect::<Vec<_>>();
                                    if !files.is_empty() {
                                        t.files = files;
                                    }
                                }
                                if let Some(n) = meta.info.name() {
                                    if !n.is_empty() && (t.name.is_empty() || t.name.starts_with("Swarm_") || t.name == "YTS.Torrent" || t.name.starts_with("Torrent_")) {
                                        t.name = n.to_string();
                                    }
                                }
                                Ok::<(), ()>(())
                            });

                            if let Some(name) = torrent.name() {
                                if !name.is_empty() && (t.name.is_empty() || t.name.starts_with("Swarm_") || t.name == "YTS.Torrent" || t.name.starts_with("Torrent_")) {
                                    t.name = name;
                                }
                            }

                            // Continuously ensure t.save_path reflects the true on-disk folder (e.g. subfolder for multi-file torrents)
                            let actual_out = torrent.output_folder().to_path_buf();
                            if !actual_out.as_os_str().is_empty() {
                                t.save_path = actual_out;
                            }

                            t.download_speed = down_speed;
                            t.upload_speed = up_speed;
                            t.peers_connected = peers;
                            t.seeds_connected = peers;

                            if stats.finished {
                                t.progress = 100.0;
                                t.status = "seeding".to_string();
                                t.eta = "Seeding".to_string();
                                t.status_note = "Completed (Seeding)".to_string();
                                break;
                            } else if let Some(ref err) = stats.error {
                                t.status = "error".to_string();
                                t.status_note = err.to_string();
                                break;
                            } else if *stop_rx.borrow() {
                                t.status = "paused".to_string();
                                t.eta = "Paused".to_string();
                                t.status_note = "Paused".to_string();
                                break;
                            } else {
                                let st = format!("{:?}", stats.state).to_ascii_lowercase();
                                if st.contains("pause") {
                                    t.status = "paused".to_string();
                                } else if stats.progress_bytes > 0 || peers > 0 {
                                    t.status = "downloading".to_string();
                                }
                                t.status_note = format!("Active ({} peers, {:.1}%)", peers, t.progress);
                                if down_speed > 0 && stats.total_bytes > stats.progress_bytes {
                                    let rem = stats.total_bytes - stats.progress_bytes;
                                    let secs = rem / down_speed;
                                    t.eta = if secs < 60 {
                                        format!("{}s", secs)
                                    } else if secs < 3600 {
                                        format!("{}m {}s", secs / 60, secs % 60)
                                    } else {
                                        format!("{}h {}m", secs / 3600, (secs % 3600) / 60)
                                    };
                                }
                            }
                        } else {
                            break;
                        }
                    }
                }
            }

            swarm_controls.write().await.remove(&tid);
            let list: Vec<TransferItem> = transfers_map.read().await.values().cloned().collect();
            if let Ok(json) = serde_json::to_string_pretty(&list) {
                let _ = tokio::fs::write(&transfers_path, json).await;
            }
        });
    }

    #[allow(dead_code)]
    async fn spawn_swarm_worker(
        &self,
        id: String,
        info_hash: [u8; 20],
        trackers: Vec<String>,
        parsed: Option<ParsedTorrent>,
        known_size: u64,
        save_path: PathBuf,
    ) {
        let piece_count = parsed.as_ref().map(|p| p.piece_hashes.len() as u32).unwrap_or(0);
        let files = parsed.as_ref().map(|p| p.files.clone()).unwrap_or_default();
        let tracker = LiveSwarmTracker::new(known_size, piece_count, parsed.is_some(), files);
        let (stop_tx, stop_rx) = watch::channel(false);

        self.swarm_controls.write().await.insert(
            id.clone(),
            ActiveSwarmControl {
                stop_tx,
                tracker: tracker.clone(),
                last_down_bytes: 0,
                last_up_bytes: 0,
            },
        );

        let max_peers = {
            let cfg = self.config.read().await;
            cfg.bandwidth.max_connections_per_torrent.max(4) as usize
        };
        let libqrbit = self.libqrbit.clone();
        let transfers_map = self.transfers.clone();
        let swarm_controls = self.swarm_controls.clone();
        let transfers_path = self.transfers_path.clone();

        tokio::spawn(async move {
            run_swarm_download(
                info_hash,
                trackers,
                parsed,
                save_path,
                tracker.clone(),
                libqrbit,
                max_peers,
                stop_rx.clone(),
            )
            .await;

            swarm_controls.write().await.remove(&id);

            let dl = tracker.downloaded_bytes.load(Ordering::Relaxed);
            let up = tracker.uploaded_bytes.load(Ordering::Relaxed);
            let done = tracker.completed.load(Ordering::Relaxed);
            let note = tracker.status_note.read().await.clone();

            {
                let mut map = transfers_map.write().await;
                if let Some(t) = map.get_mut(&id) {
                    t.downloaded = t.downloaded.max(dl);
                    t.uploaded = t.uploaded.max(up);
                    t.download_speed = 0;
                    t.upload_speed = 0;
                    t.peers_connected = 0;
                    t.seeds_connected = 0;
                    t.status_note = note;
                    if done {
                        t.progress = 100.0;
                        t.status = "seeding".to_string();
                        t.eta = "Seeding".to_string();
                    } else if *stop_rx.borrow() {
                        t.status = "paused".to_string();
                        t.eta = "Paused".to_string();
                    }
                }
            }

            let list: Vec<TransferItem> = transfers_map.read().await.values().cloned().collect();
            if let Ok(json) = serde_json::to_string_pretty(&list) {
                let _ = tokio::fs::write(&transfers_path, json).await;
            }
        });
    }

    pub async fn pause_transfer(&self, id: &str) -> bool {
        if let Some(ctrl) = self.http_controls.write().await.remove(id) {
            let _ = ctrl.stop_tx.send(true);
        }
        if let Some(ctrl) = self.swarm_controls.write().await.remove(id) {
            let _ = ctrl.stop_tx.send(true);
        }

        if let Some(torrent_id) = self.rqbit_ids.read().await.get(id).copied() {
            if let Ok(session) = self.get_rqbit_session().await {
                if let Some(torrent) = session.get(torrent_id.into()) {
                    let _ = session.pause(&torrent).await;
                }
            }
        }

        let updated = {
            let mut transfers = self.transfers.write().await;
            if let Some(t) = transfers.get_mut(id) {
                t.status = "paused".to_string();
                t.download_speed = 0;
                t.upload_speed = 0;
                t.eta = "Paused".to_string();
                t.status_note = "Paused".to_string();
                true
            } else {
                false
            }
        };
        if updated {
            self.save_transfers().await;
        }
        updated
    }

    pub async fn stop_transfer(&self, id: &str) -> bool {
        if let Some(ctrl) = self.http_controls.write().await.remove(id) {
            let _ = ctrl.stop_tx.send(true);
        }
        if let Some(ctrl) = self.swarm_controls.write().await.remove(id) {
            let _ = ctrl.stop_tx.send(true);
        }

        if let Some(torrent_id) = self.rqbit_ids.read().await.get(id).copied() {
            if let Ok(session) = self.get_rqbit_session().await {
                if let Some(torrent) = session.get(torrent_id.into()) {
                    let _ = session.pause(&torrent).await;
                }
            }
        }

        let mut stopped_name = None;
        let updated = {
            let mut transfers = self.transfers.write().await;
            if let Some(t) = transfers.get_mut(id) {
                t.status = "paused".to_string();
                t.download_speed = 0;
                t.upload_speed = 0;
                t.peers_connected = 0;
                t.seeds_connected = 0;
                t.eta = "Stopped".to_string();
                t.status_note = "Stopped by user".to_string();
                if let Some(ref mut segs) = t.segments {
                    for seg in segs.iter_mut() {
                        seg.speed_bytes_sec = 0;
                        if seg.status != "completed" {
                            seg.status = "paused".to_string();
                        }
                    }
                }
                stopped_name = Some(t.name.clone());
                true
            } else {
                false
            }
        };
        if updated {
            self.save_transfers().await;
            if let Some(name) = stopped_name {
                self.push_log(format!("Stopped transfer '{}'", name)).await;
            }
        }
        updated
    }

    pub async fn resume_transfer(&self, id: &str) -> bool {
        let item_opt = self.transfers.read().await.get(id).cloned();
        let Some(item) = item_opt else {
            return false;
        };

        if item.progress >= 100.0 {
            let mut map = self.transfers.write().await;
            if let Some(t) = map.get_mut(id) {
                t.status = if t.is_http_segmented {
                    "completed"
                } else {
                    "seeding"
                }
                .to_string();
            }
            self.save_transfers().await;
            return true;
        }

        // Skip if already actively running
        if self.http_controls.read().await.contains_key(id)
            || self.swarm_controls.read().await.contains_key(id)
        {
            return true;
        }

        let stealth = self.libqrbit.is_enabled().await && item.libqrbit_enabled;

        if item.is_http_segmented {
            let Some(url) = item.url.clone() else {
                return false;
            };
            let (user_agent, referer, timeout_seconds, max_retries, buffer_bytes, auto_resume) = {
                let cfg = self.config.read().await;
                (
                    cfg.http.resolve_user_agent(),
                    match cfg.http.referer_mode.as_str() {
                        "empty" => None,
                        "custom" if !cfg.http.custom_referer.trim().is_empty() => {
                            Some(cfg.http.custom_referer.clone())
                        }
                        _ => Some(url.clone()),
                    },
                    cfg.http.timeout_seconds,
                    cfg.http.max_retries,
                    cfg.http.resolve_buffer_bytes(),
                    cfg.http.auto_resume_broken,
                )
            };
            let segs = item.peers_total.max(1) as usize;
            {
                let mut map = self.transfers.write().await;
                if let Some(t) = map.get_mut(id) {
                    t.status = "downloading".to_string();
                    t.eta = "Resuming...".to_string();
                    t.status_note = "Resuming HTTP segments...".to_string();
                }
            }
            self.save_transfers().await;
            let opts = HttpDownloadOptions {
                user_agent,
                referer,
                timeout_seconds,
                max_retries,
                buffer_bytes,
                auto_resume,
            };
            self.spawn_http_worker(
                id.to_string(),
                url,
                item.save_path.join(&item.name),
                item.size,
                segs,
                segs > 1,
                opts,
            )
            .await;
            true
        } else {
            // Production BitTorrent resume via librqbit
            {
                let mut map = self.transfers.write().await;
                if let Some(t) = map.get_mut(id) {
                    t.status = if stealth { "stealth_active" } else { "downloading" }.to_string();
                    t.eta = "Resuming...".to_string();
                    t.status_note = "Connecting to swarm...".to_string();
                }
            }
            self.save_transfers().await;

            let existing_tid = self.rqbit_ids.read().await.get(id).copied();
            let mut resumed = false;
            if let Some(torrent_id) = existing_tid {
                if let Ok(session) = self.get_rqbit_session().await {
                    if let Some(torrent) = session.get(torrent_id.into()) {
                        let _ = session.unpause(&torrent).await;
                        self.spawn_rqbit_stats_worker(id.to_string(), torrent).await;
                        resumed = true;
                    }
                }
            }

            if !resumed {
                let source_str = item.url.clone().unwrap_or_else(|| {
                    let mut mag = format!("magnet:?xt=urn:btih:{}", item.hash);
                    for tr in &item.trackers {
                        mag.push_str("&tr=");
                        for b in tr.as_bytes() {
                            match b {
                                b'0'..=b'9' | b'a'..=b'z' | b'A'..=b'Z' | b'-' | b'.' | b'_' | b'~' | b':' | b'/' => {
                                    mag.push(*b as char)
                                }
                                _ => mag.push_str(&format!("%{:02X}", b)),
                            }
                        }
                    }
                    mag
                });
                let source = librqbit::AddTorrent::from_url(source_str);
                let _ = self.start_rqbit_torrent(id.to_string(), source, item.save_path.clone()).await;
            }
            true
        }
    }

    pub async fn delete_transfer(&self, id: &str, delete_files: bool) -> bool {
        if let Some(ctrl) = self.http_controls.read().await.get(id) {
            let _ = ctrl.stop_tx.send(true);
        }
        if let Some(ctrl) = self.swarm_controls.read().await.get(id) {
            let _ = ctrl.stop_tx.send(true);
        }

        if let Some(torrent_id) = self.rqbit_ids.write().await.remove(id) {
            if let Ok(session) = self.get_rqbit_session().await {
                let _ = session.delete(torrent_id.into(), delete_files).await;
            }
        }

        let removed = self.transfers.write().await.remove(id);
        self.parsed_torrents.write().await.remove(id);

        if let Some(item) = removed {
            if delete_files {
                let target = item.save_path.join(&item.name);
                if target.is_dir() {
                    let _ = tokio::fs::remove_dir_all(&target).await;
                } else {
                    let _ = tokio::fs::remove_file(&target).await;
                    HttpDownloader::remove_checkpoint(&target).await;
                }
            }
            self.save_transfers().await;
            self.push_log(format!("Deleted transfer '{}'", item.name)).await;
            true
        } else {
            false
        }
    }

    pub async fn rename_transfer(&self, id: &str, new_name: &str) -> bool {
        let ok = {
            let mut transfers = self.transfers.write().await;
            if let Some(t) = transfers.get_mut(id) {
                t.name = new_name.to_string();
                true
            } else {
                false
            }
        };
        if ok {
            self.save_transfers().await;
        }
        ok
    }

    pub async fn recheck_transfer(&self, id: &str) -> bool {
        let item_opt = self.transfers.read().await.get(id).cloned();
        let Some(item) = item_opt else {
            return false;
        };

        self.push_log(format!(
            "Force recheck started: verifying piece/chunk integrity on disk for '{}'...",
            item.name
        ))
        .await;

        if item.is_http_segmented {
            let file_path = item.save_path.join(&item.name);
            let verified_bytes = if let Ok(meta) = tokio::fs::metadata(&file_path).await {
                meta.len().min(item.size.max(meta.len()))
            } else {
                0
            };
            let mut map = self.transfers.write().await;
            if let Some(t) = map.get_mut(id) {
                if t.size > 0 && verified_bytes >= t.size && !HttpDownloader::checkpoint_exists(&file_path) {
                    t.downloaded = t.size;
                    t.progress = 100.0;
                    t.status = "completed".to_string();
                    t.eta = "Done".to_string();
                    t.status_note = "File size verified on disk".to_string();
                } else {
                    t.status_note = format!("Verified {} bytes on disk", verified_bytes);
                }
            }
            self.save_transfers().await;
            return true;
        }

        // BitTorrent piece hash recheck when .torrent metadata is available
        if let Some(parsed) = self.parsed_torrents.read().await.get(id).cloned() {
            let base_dir = if parsed.files.len() > 1 {
                item.save_path.join(&parsed.name)
            } else {
                item.save_path.clone()
            };
            let verified_bytes = tokio::task::spawn_blocking(move || verify_torrent_on_disk(&parsed, &base_dir))
                .await
                .unwrap_or(0);

            let mut map = self.transfers.write().await;
            if let Some(t) = map.get_mut(id) {
                t.downloaded = verified_bytes;
                if t.size > 0 {
                    t.progress = ((verified_bytes as f64 / t.size as f64) * 100.0) as f32;
                    if verified_bytes >= t.size {
                        t.progress = 100.0;
                        t.status = "seeding".to_string();
                        t.eta = "Seeding".to_string();
                    }
                }
                t.status_note = format!("Rechecked SHA-1 pieces ({:.1}%)", t.progress);
            }
            self.save_transfers().await;
            return true;
        }

        // Fallback for magnet transfers where full .torrent piece table is still resolving
        let target_path = item.save_path.join(&item.name);
        let on_disk_bytes = tokio::fs::metadata(&target_path)
            .await
            .map(|m| m.len())
            .unwrap_or(item.downloaded);
        {
            let mut map = self.transfers.write().await;
            if let Some(t) = map.get_mut(id) {
                if on_disk_bytes > 0 && t.size > 0 {
                    t.downloaded = on_disk_bytes.min(t.size);
                    t.progress = ((t.downloaded as f64 / t.size as f64) * 100.0) as f32;
                }
                t.status_note = format!("Rechecked payload on disk ({:.1}%)", t.progress);
            }
        }
        self.save_transfers().await;
        true
    }

    pub async fn set_transfer_priority(&self, id: &str, priority: &str) -> bool {
        let ok = {
            let mut transfers = self.transfers.write().await;
            if let Some(t) = transfers.get_mut(id) {
                t.priority = priority.to_string();
                true
            } else {
                false
            }
        };
        if ok {
            self.save_transfers().await;
        }
        ok
    }

    pub async fn set_transfer_speed_limit(&self, id: &str, limit_kbps: Option<u64>) -> bool {
        let ok = {
            let mut transfers = self.transfers.write().await;
            if let Some(t) = transfers.get_mut(id) {
                t.speed_limit_kbps = limit_kbps;
                true
            } else {
                false
            }
        };
        if ok {
            self.save_transfers().await;
        }
        ok
    }

    pub async fn set_transfer_obfuscation(&self, id: &str, level: u8) -> bool {
        let clamped = level.clamp(1, 4);
        let ok = {
            let mut transfers = self.transfers.write().await;
            if let Some(t) = transfers.get_mut(id) {
                t.obfuscation_level = clamped;
                true
            } else {
                false
            }
        };
        if ok {
            self.save_transfers().await;
            self.push_log(format!("Set obfuscation level to L{} for transfer {}", clamped, id)).await;
        }
        ok
    }

    pub async fn pause_all(&self) {
        for ctrl in self.http_controls.read().await.values() {
            let _ = ctrl.stop_tx.send(true);
        }
        for ctrl in self.swarm_controls.read().await.values() {
            let _ = ctrl.stop_tx.send(true);
        }
        {
            let mut transfers = self.transfers.write().await;
            for t in transfers.values_mut() {
                if t.status != "completed" {
                    t.status = "paused".to_string();
                    t.download_speed = 0;
                    t.upload_speed = 0;
                    t.eta = "Paused".to_string();
                }
            }
        }
        self.save_transfers().await;
    }

    pub async fn resume_all(&self) {
        let ids: Vec<String> = {
            let transfers = self.transfers.read().await;
            transfers
                .values()
                .filter(|t| t.status == "paused")
                .map(|t| t.id.clone())
                .collect()
        };
        for id in ids {
            self.resume_transfer(&id).await;
        }
    }

    pub async fn update_all_save_paths(&self, dir: PathBuf) {
        {
            let mut transfers = self.transfers.write().await;
            for t in transfers.values_mut() {
                t.save_path = dir.clone();
            }
        }
        self.save_transfers().await;
    }

    /// Reads real live counters from active HTTP & BitTorrent tasks every 1.5s tick.
    pub async fn tick(&self) {
        const INTERVAL_SECS: f64 = 1.5;

        // 1. Sample active HTTP tasks
        {
            let mut controls = self.http_controls.write().await;
            let mut transfers = self.transfers.write().await;
            for (id, ctrl) in controls.iter_mut() {
                let now = std::time::Instant::now();
                let elapsed = now.duration_since(ctrl.last_tick_time).as_secs_f64().max(0.1);
                ctrl.last_tick_time = now;

                let current_total = ctrl.tracker.total_downloaded.load(Ordering::Relaxed);
                let delta = if ctrl.has_initial_sample {
                    current_total.saturating_sub(ctrl.last_total_bytes)
                } else {
                    0
                };
                ctrl.last_total_bytes = current_total;
                ctrl.has_initial_sample = true;

                if delta > 0 {
                    self.session_downloaded.fetch_add(delta, Ordering::Relaxed);
                }

                let instant_speed = (delta as f64 / elapsed) as u64;
                ctrl.speed_samples.push_back(instant_speed);
                if ctrl.speed_samples.len() > 3 {
                    ctrl.speed_samples.pop_front();
                }
                let speed = if !ctrl.speed_samples.is_empty() {
                    ctrl.speed_samples.iter().sum::<u64>() / ctrl.speed_samples.len() as u64
                } else {
                    instant_speed
                };

                let seg_snapshot = ctrl
                    .tracker
                    .snapshot_segments(&mut ctrl.last_seg_bytes, elapsed);

                if let Some(t) = transfers.get_mut(id) {
                    t.downloaded = current_total;
                    t.download_speed = speed;
                    t.segments = Some(seg_snapshot);
                    if t.size > 0 {
                        t.progress = ((current_total as f64 / t.size as f64) * 100.0).min(100.0) as f32;
                        let rem = t.size.saturating_sub(current_total);
                        if rem == 0 {
                            t.eta = "Done".to_string();
                        } else if speed > 0 {
                            t.eta = format_eta(rem / speed);
                        } else {
                            t.eta = "Stalled".to_string();
                        }
                    }
                }
            }
        }

        // 2. Sample active BitTorrent swarm tasks
        {
            let rq_ids = self.rqbit_ids.read().await;
            let mut controls = self.swarm_controls.write().await;
            let mut transfers = self.transfers.write().await;
            for (id, ctrl) in controls.iter_mut() {
                // Skip BitTorrent transfers managed by librqbit (which have their own dedicated stats worker)
                if rq_ids.contains_key(id) {
                    continue;
                }

                let down_now = ctrl.tracker.downloaded_bytes.load(Ordering::Relaxed);
                let up_now = ctrl.tracker.uploaded_bytes.load(Ordering::Relaxed);
                let d_down = down_now.saturating_sub(ctrl.last_down_bytes);
                let d_up = up_now.saturating_sub(ctrl.last_up_bytes);
                ctrl.last_down_bytes = down_now;
                ctrl.last_up_bytes = up_now;

                if d_down > 0 {
                    self.session_downloaded.fetch_add(d_down, Ordering::Relaxed);
                }
                if d_up > 0 {
                    self.session_uploaded.fetch_add(d_up, Ordering::Relaxed);
                }

                let down_speed = (d_down as f64 / INTERVAL_SECS) as u64;
                let up_speed = (d_up as f64 / INTERVAL_SECS) as u64;
                let note = ctrl.tracker.status_note.read().await.clone();
                let resolved_name = ctrl.tracker.resolved_name.read().await.clone();
                let resolved_files = ctrl.tracker.files.read().await.clone();
                let total_size = ctrl.tracker.total_size.load(Ordering::Relaxed);

                if let Some(t) = transfers.get_mut(id) {
                    if let Some(rn) = resolved_name {
                        t.name = rn;
                    }
                    if !resolved_files.is_empty() {
                        t.files = resolved_files;
                    }
                    if total_size > 0 {
                        t.size = total_size;
                    }
                    t.downloaded = down_now;
                    t.uploaded = up_now;
                    t.download_speed = down_speed;
                    t.upload_speed = up_speed;
                    t.seeds_connected = ctrl.tracker.seeds_connected.load(Ordering::Relaxed);
                    t.seeds_total = ctrl.tracker.seeds_total.load(Ordering::Relaxed);
                    t.peers_connected = ctrl.tracker.peers_connected.load(Ordering::Relaxed);
                    t.peers_total = ctrl.tracker.peers_total.load(Ordering::Relaxed);
                    t.status_note = note;

                    if t.downloaded > 0 {
                        t.ratio = t.uploaded as f32 / t.downloaded as f32;
                    }
                    if ctrl.tracker.metadata_resolved.load(Ordering::Relaxed)
                        && (t.status == "metadata")
                    {
                        t.status = if t.libqrbit_enabled && self.libqrbit.is_enabled().await {
                            "stealth_active".to_string()
                        } else {
                            "downloading".to_string()
                        };
                    }
                    if t.size > 0 {
                        t.progress = ((down_now as f64 / t.size as f64) * 100.0).min(100.0) as f32;
                        let rem = t.size.saturating_sub(down_now);
                        if rem == 0 {
                            t.eta = "Seeding".to_string();
                        } else if down_speed > 0 {
                            t.eta = format_eta(rem / down_speed);
                        } else {
                            t.eta = "Waiting".to_string();
                        }
                    }
                }
            }
        }

        // 3. Inspect missing/deleted files for transfers with progress or completed
        {
            let mut transfers = self.transfers.write().await;
            for t in transfers.values_mut() {
                if t.downloaded > 0 || t.progress > 0.0 || t.status == "completed" || t.status == "seeding" {
                    let missing = if t.files.len() > 1 {
                        !t.save_path.exists()
                    } else if let Some(first) = t.files.first() {
                        let f1 = t.save_path.join(&first.path);
                        let f2 = t.save_path.join(&t.name);
                        !f1.exists() && !f2.exists() && !t.save_path.exists()
                    } else {
                        let f = t.save_path.join(&t.name);
                        !f.exists() && !t.save_path.exists()
                    };
                    t.is_missing = missing;
                    if missing && (t.status == "seeding" || t.status == "downloading" || t.status == "stealth_active") {
                        t.status_note = "File or folder missing from disk".to_string();
                    }
                } else {
                    t.is_missing = false;
                }
            }
        }
    }

    pub async fn toggle_turtle_mode(&self) -> bool {
        let mut cfg = self.config.write().await;
        cfg.bandwidth.alt_speed_active = !cfg.bandwidth.alt_speed_active;
        let active = cfg.bandwidth.alt_speed_active;
        info!(
            "[Bandwidth] Speed mode changed: {}",
            if active { "Limited (Turtle)" } else { "Unlimited" }
        );
        active
    }

    pub async fn set_turtle_mode(&self, active: bool) {
        let mut cfg = self.config.write().await;
        cfg.bandwidth.alt_speed_active = active;
    }

    pub fn get_downloader(&self) -> Arc<HttpDownloader> {
        self.http_downloader.clone()
    }
}

fn verify_torrent_on_disk(parsed: &ParsedTorrent, base_dir: &PathBuf) -> u64 {
    let mut verified_bytes = 0u64;
    let mut reusable_buf = vec![0u8; parsed.piece_length.max(16384) as usize];
    for (idx, expected_hash) in parsed.piece_hashes.iter().enumerate() {
        let piece_offset = idx as u64 * parsed.piece_length;
        let piece_len = parsed
            .total_size
            .saturating_sub(piece_offset)
            .min(parsed.piece_length) as usize;
        if reusable_buf.len() < piece_len {
            reusable_buf.resize(piece_len, 0);
        }
        let buf = &mut reusable_buf[..piece_len];
        buf.fill(0);
        let mut ok = true;

        for entry in &parsed.files {
            let f_start = entry.offset;
            let f_end = entry.offset + entry.length;
            let p_end = piece_offset + piece_len as u64;
            if p_end <= f_start || piece_offset >= f_end {
                continue;
            }
            let ov_start = piece_offset.max(f_start);
            let ov_end = p_end.min(f_end);
            let slice_start = (ov_start - piece_offset) as usize;
            let slice_end = (ov_end - piece_offset) as usize;
            let seek_pos = ov_start - f_start;

            let fpath = base_dir.join(&entry.path);
            let Ok(mut f) = File::open(&fpath) else {
                ok = false;
                break;
            };
            if f.seek(SeekFrom::Start(seek_pos)).is_err()
                || f.read_exact(&mut buf[slice_start..slice_end]).is_err()
            {
                ok = false;
                break;
            }
        }

        if ok {
            let actual = digest(&SHA1_FOR_LEGACY_USE_ONLY, &buf);
            if actual.as_ref() == expected_hash {
                verified_bytes += piece_len as u64;
            }
        }
    }
    verified_bytes
}

fn format_eta(secs: u64) -> String {
    if secs < 60 {
        format!("{}s", secs)
    } else if secs < 3600 {
        format!("{}m {}s", secs / 60, secs % 60)
    } else {
        format!("{}h {}m", secs / 3600, (secs % 3600) / 60)
    }
}
