#![cfg_attr(target_os = "windows", windows_subsystem = "windows")]


use serde::{Deserialize, Serialize};
use std::{
    collections::{HashMap, HashSet},
    fs::OpenOptions,
    io::{Seek, SeekFrom, Write},
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicU64, AtomicUsize, Ordering},
        Arc, Mutex,
    },
    time::{Duration, Instant},
};

use librqbit::{api::{Api, TorrentIdOrHash}, AddTorrent, AddTorrentOptions, Session};
use tauri::ipc::Channel;
use tauri::{Emitter, Manager};
use tauri_plugin_opener::OpenerExt;
use tauri_plugin_http::reqwest::{self, header};

const MIN_PARALLEL: usize = 2;
const MAX_PARALLEL: usize = 16;
const MIN_CHUNK: u64 = 8 * 1024 * 1024;
const MAX_CHUNK: u64 = 32 * 1024 * 1024;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase", tag = "event", content = "data")]
enum DownloadEvent {
    Started {
        total: u64,
        connections: usize,
        segmented: bool,
    },
    Progress {
        downloaded: u64,
        total: u64,
        speed: u64,
        connections: usize,
    },
    Finished,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ProbeResult {
    size: u64,
    supports_ranges: bool,
    final_url: String,
    source: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct TorrentMetadataFile {
    path: String,
    size: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct TorrentMetadataResult {
    name: String,
    info_hash: String,
    total: u64,
    files: Vec<TorrentMetadataFile>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct TorrentStartResult {
    torrent_id: usize,
    info_hash: String,
    name: Option<String>,
    total: u64,
    sub_folder: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct TorrentProgressResult {
    torrent_id: usize,
    state: String,
    downloaded: u64,
    total: u64,
    speed: u64,
    uploaded: u64,
    finished: bool,
    error: Option<String>,
    info_hash: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct TorrentEngineConfig {
    pub listen_port: Option<u16>,
    pub randomize_port: Option<bool>,
    pub disable_dht: Option<bool>,
    pub anonymous_mode: Option<bool>,
    pub client_id_spoof: Option<String>,
}

fn make_session_options(config: Option<&TorrentEngineConfig>) -> librqbit::SessionOptions {
    let mut opts = librqbit::SessionOptions::default();

    if let Some(cfg) = config {
        // 1. Custom / Random Non-Standard Listening Port
        if cfg.randomize_port.unwrap_or(false) {
            let nanos = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .subsec_nanos();
            let random_port = 49152 + ((nanos % (65535 - 49152 + 1)) as u16);
            opts.listen_port_range = Some(random_port..(random_port.saturating_add(1)));
        } else if let Some(port) = cfg.listen_port.filter(|p| *p >= 1024) {
            opts.listen_port_range = Some(port..(port.saturating_add(1)));
        }

        // 2. Disable DHT / Public Peer Discovery (Strict Tracker Mode)
        if cfg.disable_dht.unwrap_or(false) {
            opts.disable_dht = true;
            opts.disable_dht_persistence = true;
        }

        // 3. Anonymous Mode / Peer ID Spoofing
        if cfg.anonymous_mode.unwrap_or(true) {
            let mut peer_id_bytes = [0u8; 20];
            let prefix = match cfg.client_id_spoof.as_deref() {
                Some("qBittorrent") => b"-qB4600-",
                _ => b"-TR3000-", // Standard generic Transmission 3.00 signature
            };
            peer_id_bytes[..prefix.len()].copy_from_slice(prefix);
            let nanos = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .subsec_nanos();
            for i in prefix.len()..20 {
                peer_id_bytes[i] = b'a' + (((nanos + (i as u32 * 31)) % 26) as u8);
            }
            opts.peer_id = Some(librqbit_core::hash_id::Id(peer_id_bytes));
        }
    }

    opts
}

#[derive(Clone)]
struct TorrentState {
    session: Arc<tokio::sync::RwLock<Arc<Session>>>,
    config: Arc<Mutex<TorrentEngineConfig>>,
}

impl TorrentState {
    async fn get_session(&self) -> Arc<Session> {
        self.session.read().await.clone()
    }
}

struct HttpTransferState {
    cancellations: Mutex<HashMap<String, Arc<std::sync::atomic::AtomicBool>>>,
}

struct PendingExternalTransfer(Mutex<Vec<String>>);

#[derive(Clone, Debug, Serialize)]
struct ExternalTransferPayload {
    source: String,
}

fn is_local_torrent_source(source: &str) -> bool {
    let trimmed = source.trim();
    if trimmed.is_empty() {
        return false;
    }

    if trimmed.to_ascii_lowercase().starts_with("magnet:")
        || trimmed.to_ascii_lowercase().starts_with("http://")
        || trimmed.to_ascii_lowercase().starts_with("https://")
    {
        return false;
    }

    true
}

fn torrent_source(source: &str) -> Result<AddTorrent<'static>, String> {
    let trimmed = source.trim();

    if is_local_torrent_source(trimmed) {
        let path = trimmed.strip_prefix("file://").unwrap_or(trimmed);
        AddTorrent::from_local_filename(path)
            .map_err(|e| format!("Failed to read local torrent file: {e}"))
    } else {
        Ok(AddTorrent::from_url(trimmed.to_string()))
    }
}

#[cfg(windows)]
fn write_at(file: &std::fs::File, offset: u64, buf: &[u8]) -> std::io::Result<()> {
    use std::os::windows::fs::FileExt;
    let mut total_written = 0;
    while total_written < buf.len() {
        let written = file.seek_write(&buf[total_written..], offset + total_written as u64)?;
        if written == 0 {
            return Err(std::io::Error::new(
                std::io::ErrorKind::WriteZero,
                "failed to write whole buffer",
            ));
        }
        total_written += written;
    }
    Ok(())
}

#[cfg(unix)]
fn write_at(file: &std::fs::File, offset: u64, buf: &[u8]) -> std::io::Result<()> {
    use std::os::unix::fs::FileExt;
    file.write_all_at(buf, offset)
}

#[cfg(not(any(windows, unix)))]
fn write_at(file: &std::fs::File, _offset: u64, _buf: &[u8]) -> std::io::Result<()> {
    Err(std::io::Error::new(
        std::io::ErrorKind::Unsupported,
        "Target platform unsupported for positioned writes",
    ))
}

const HTTP_PAUSED: &str = "__FLOWDOWN_PAUSED__";

#[derive(Debug, Clone, Serialize, Deserialize)]
struct HttpResumeState {
    url: String,
    total: u64,
    chunk_size: u64,
    completed_ranges: Vec<(u64, u64)>,
}

fn http_resume_state_path(file_path: &str) -> PathBuf {
    PathBuf::from(format!("{file_path}.flowdown.state.json"))
}

fn load_http_resume_state(
    path: &Path,
    url: &str,
    total: u64,
    chunk_size: u64,
) -> Option<HttpResumeState> {
    let text = std::fs::read_to_string(path).ok()?;
    let state: HttpResumeState = serde_json::from_str(&text).ok()?;

    if state.url == url
        && state.total == total
        && state.chunk_size == chunk_size
    {
        Some(state)
    } else {
        None
    }
}

fn save_http_resume_state_atomic(path: &Path, state: &HttpResumeState) -> Result<(), String> {
    let json = serde_json::to_vec_pretty(state)
        .map_err(|e| format!("Could not serialize HTTP resume state: {e}"))?;
    let tmp_path = path.with_extension(format!("tmp.{}", std::process::id()));
    std::fs::write(&tmp_path, json)
        .map_err(|e| format!("Could not write temporary HTTP resume state: {e}"))?;
    
    // On Windows std::fs::rename will fail if target exists, so remove it first if needed.
    #[cfg(windows)]
    if path.exists() {
        let _ = std::fs::remove_file(path);
    }

    std::fs::rename(&tmp_path, path)
        .map_err(|e| format!("Could not finalize HTTP resume state: {e}"))
}

pub fn sanitize_download_filename(raw_name: &str) -> String {
    let decoded = urlencoding_decode(raw_name);
    // Extract base component if path separators exist
    let base = decoded
        .replace('\\', "/")
        .split('/')
        .filter(|segment| !segment.is_empty() && *segment != "." && *segment != "..")
        .last()
        .unwrap_or("")
        .to_string();

    let cleaned = base
        .chars()
        .map(|c| {
            if c.is_control() || matches!(c, '<' | '>' | ':' | '"' | '|' | '?' | '*') {
                ' '
            } else {
                c
            }
        })
        .collect::<String>();

    let mut result = cleaned.trim().trim_matches('.').trim().to_string();

    const RESERVED_NAMES: &[&str] = &[
        "CON", "PRN", "AUX", "NUL",
        "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8", "COM9",
        "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
    ];

    let root_stem = result.split('.').next().unwrap_or("");

    if RESERVED_NAMES.iter().any(|&r| root_stem.eq_ignore_ascii_case(r)) {
        result = format!("_{result}");
    }

    if result.is_empty() {
        "downloaded_file.bin".to_string()
    } else if result.len() > 240 {
        result[..240].trim_end().to_string()
    } else {
        result
    }
}

pub fn safe_join_download_path(base_dir: &Path, filename: &str) -> Result<PathBuf, String> {
    let sanitized = sanitize_download_filename(filename);
    let joined = base_dir.join(sanitized);
    Ok(joined)
}

fn urlencoding_decode(s: &str) -> String {
    let mut bytes = Vec::new();
    let mut chars = s.as_bytes().iter().copied();
    while let Some(b) = chars.next() {
        if b == b'%' {
            let h1 = chars.next();
            let h2 = chars.next();
            if let (Some(c1), Some(c2)) = (h1, h2) {
                let hex_str = [c1, c2];
                if let Ok(val) = u8::from_str_radix(std::str::from_utf8(&hex_str).unwrap_or(""), 16) {
                    bytes.push(val);
                    continue;
                } else {
                    bytes.push(b'%');
                    bytes.push(c1);
                    bytes.push(c2);
                    continue;
                }
            } else {
                bytes.push(b'%');
                if let Some(c1) = h1 { bytes.push(c1); }
                continue;
            }
        }
        bytes.push(b);
    }
    String::from_utf8_lossy(&bytes).into_owned()
}

fn parse_content_range(header_val: &str) -> Option<(u64, u64, u64)> {
    let s = header_val.trim();
    if !s.to_ascii_lowercase().starts_with("bytes ") {
        return None;
    }
    let parts: Vec<&str> = s[6..].split('/').collect();
    if parts.len() != 2 {
        return None;
    }
    let total = parts[1].trim().parse::<u64>().ok()?;
    let range_parts: Vec<&str> = parts[0].trim().split('-').collect();
    if range_parts.len() != 2 {
        return None;
    }
    let start = range_parts[0].trim().parse::<u64>().ok()?;
    let end = range_parts[1].trim().parse::<u64>().ok()?;
    if start <= end {
        Some((start, end, total))
    } else {
        None
    }
}

fn validate_http_url(url: &str) -> Result<(), String> {
    let parsed =
        reqwest::Url::parse(url).map_err(|e| format!("Invalid URL: {e}"))?;

    match parsed.scheme() {
        "http" | "https" => Ok(()),
        _ => Err("Only HTTP(S) URLs are supported by the HTTP engine".into()),
    }
}

fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::limited(10))
        .user_agent("FlowDown/1.0")
        .build()
        .map_err(|e| format!("Could not create HTTP client: {e}"))
}

#[tauri::command]
async fn probe_remote_file(url: String) -> Result<ProbeResult, String> {
    validate_http_url(&url)?;

    let client = client()?;

    // First try HEAD.
    if let Ok(response) = client.head(&url).send().await {
        if response.status().is_success() {
            let final_url = response.url().to_string();

            if let Some(len) = response.content_length().filter(|v| *v > 0) {
                // Test whether the server supports byte ranges.
                let range = client
                    .get(response.url().clone())
                    .header(header::RANGE, "bytes=0-0")
                    .header(header::ACCEPT_ENCODING, "identity")
                    .send()
                    .await;

                if let Ok(range_response) = range {
                    if range_response.status()
                        == reqwest::StatusCode::PARTIAL_CONTENT
                    {
                        return Ok(ProbeResult {
                            size: len,
                            supports_ranges: true,
                            final_url,
                            source: "HEAD Content-Length + Range support".into(),
                        });
                    }
                }

                return Ok(ProbeResult {
                    size: len,
                    supports_ranges: false,
                    final_url,
                    source: "HEAD Content-Length".into(),
                });
            }
        }
    }

    // Fallback: one-byte range request.
    let response = client
        .get(&url)
        .header(header::RANGE, "bytes=0-0")
        .header(header::ACCEPT_ENCODING, "identity")
        .send()
        .await
        .map_err(|e| format!("Range probe failed: {e}"))?;

    let final_url = response.url().to_string();

    if response.status() == reqwest::StatusCode::PARTIAL_CONTENT {
        let total = response
            .headers()
            .get(header::CONTENT_RANGE)
            .and_then(|v| v.to_str().ok())
            .and_then(|v| v.rsplit('/').next())
            .and_then(|v| v.parse::<u64>().ok())
            .or_else(|| response.content_length());

        if let Some(size) = total.filter(|v| *v > 0) {
            return Ok(ProbeResult {
                size,
                supports_ranges: true,
                final_url,
                source: "Range Content-Range".into(),
            });
        }
    }

    // Server ignored Range.
    let size = response.content_length().unwrap_or(0);

    Ok(ProbeResult {
        size,
        supports_ranges: false,
        final_url,
        source: if size > 0 {
            "Server Content-Length (no range support)".into()
        } else {
            "Unknown Size".into()
        },
    })
}

fn sanitize_torrent_subfolder(value: &str) -> String {
    let mut cleaned = value
        .replace('\\', " ")
        .replace('/', " ")
        .chars()
        .map(|c| if c.is_control() { ' ' } else { c })
        .collect::<String>();

    while cleaned.contains("..") {
        cleaned = cleaned.replace("..", ".");
    }

    cleaned = cleaned.trim().trim_matches('.').to_string();

    if cleaned.is_empty() {
        "Torrent".to_string()
    } else {
        cleaned
    }
}

#[tauri::command]
async fn inspect_torrent(
    url: String,
    _save_path: String,
    state: tauri::State<'_, TorrentState>,
) -> Result<TorrentMetadataResult, String> {
    // Metadata inspection does not write any torrent payload, so there is no
    // reason to provide an output folder here. Keeping this as list-only also
    // prevents inspection from creating or managing a real download.
    let options = AddTorrentOptions {
        list_only: true,
        ..Default::default()
    };

    let session = state.get_session().await;
    let response = session
        .add_torrent(torrent_source(&url)?, Some(options))
        .await
        .map_err(|e| format!("Failed to inspect torrent: {e}"))?;

    match response {
        librqbit::AddTorrentResponse::ListOnly(list) => {
            let files = list
                .info
                .iter_file_details()
                .map_err(|e| format!("Failed to read torrent files: {e}"))?
                .map(|detail| TorrentMetadataFile {
                    path: detail
                        .filename
                        .to_string()
                        .unwrap_or_else(|_| "<invalid filename>".to_string()),
                    size: detail.len,
                })
                .collect::<Vec<_>>();

            let total = files.iter().map(|file| file.size).sum();
            let name = list
                .info
                .name
                .as_ref()
                .map(|name| String::from_utf8_lossy(name.as_ref()).into_owned())
                .filter(|name| !name.is_empty())
                .unwrap_or_else(|| "Torrent".to_string());

            Ok(TorrentMetadataResult {
                name,
                info_hash: format!("{:?}", list.info_hash),
                total,
                files,
            })
        }
        librqbit::AddTorrentResponse::AlreadyManaged(_, torrent)
        | librqbit::AddTorrentResponse::Added(_, torrent) => torrent
            .with_metadata(|metadata| {
                let files = metadata
                    .info
                    .iter_file_details()
                    .map_err(|e| format!("Failed to read torrent files: {e}"))?
                    .map(|detail| TorrentMetadataFile {
                        path: detail
                            .filename
                            .to_string()
                            .unwrap_or_else(|_| "<invalid filename>".to_string()),
                        size: detail.len,
                    })
                    .collect::<Vec<_>>();

                let total = files.iter().map(|file| file.size).sum();
                let name = torrent_name_from_metadata(&metadata.info);

                Ok(TorrentMetadataResult {
                    name,
                    info_hash: format!("{:?}", torrent.info_hash()),
                    total,
                    files,
                })
            })
            .map_err(|e| format!("Torrent metadata is not available yet: {e}"))?,
    }
}

fn torrent_name_from_metadata(
    info: &librqbit::TorrentMetaV1Info<librqbit::ByteBufOwned>,
) -> String {
    info.name
        .as_ref()
        .map(|name| String::from_utf8_lossy(name.as_ref()).into_owned())
        .filter(|name| !name.is_empty())
        .unwrap_or_else(|| "Torrent".to_string())
}

#[tauri::command]
async fn start_torrent(
    url: String,
    save_path: String,
    only_files: Option<Vec<usize>>,
    overwrite: bool,
    sub_folder: Option<String>,
    state: tauri::State<'_, TorrentState>,
) -> Result<TorrentStartResult, String> {
    // librqbit does not allow `output_folder` and `sub_folder` together.
    // For multi-file torrents FlowDown supplies a sanitized torrent folder
    // and makes that the actual output folder. Single-file torrents stay
    // directly in the user's selected Downloads directory.
    let torrent_sub_folder = sub_folder
        .map(|value| sanitize_torrent_subfolder(&value));

    let torrent_output_folder = match &torrent_sub_folder {
        Some(folder) => Path::new(&save_path)
            .join(folder)
            .to_string_lossy()
            .into_owned(),
        None => save_path.clone(),
    };

    let options = AddTorrentOptions {
        output_folder: Some(torrent_output_folder),
        overwrite,
        only_files,
        ..Default::default()
    };

    let session = state.get_session().await;
    let response = session
        .add_torrent(
            torrent_source(&url)?,
            Some(options),
        )
        .await
        .map_err(|e| format!("Failed to add torrent: {e}"))?;

    let (torrent_id, torrent) = match response {
        librqbit::AddTorrentResponse::Added(id, torrent) => (id, torrent),
        librqbit::AddTorrentResponse::AlreadyManaged(id, torrent) => (id, torrent),
        librqbit::AddTorrentResponse::ListOnly(_) => {
            return Err("Torrent was only inspected and was not added".into());
        }
    };

    let stats = torrent.stats();

    Ok(TorrentStartResult {
        torrent_id,
        info_hash: format!("{:?}", torrent.info_hash()),
        name: torrent.name(),
        total: stats.total_bytes,
        sub_folder: torrent_sub_folder.unwrap_or_default(),
    })
}

#[tauri::command]
async fn pause_torrent(
    torrent_id: usize,
    state: tauri::State<'_, TorrentState>,
) -> Result<(), String> {
    let session = state.get_session().await;
    let torrent = session
        .get(torrent_id.into())
        .ok_or_else(|| format!("Torrent {torrent_id} not found"))?;

    session
        .pause(&torrent)
        .await
        .map_err(|e| format!("Failed to pause torrent {torrent_id}: {e}"))
}

#[tauri::command]
async fn resume_torrent(
    torrent_id: usize,
    state: tauri::State<'_, TorrentState>,
) -> Result<(), String> {
    let session = state.get_session().await;
    let torrent = session
        .get(torrent_id.into())
        .ok_or_else(|| format!("Torrent {torrent_id} not found"))?;

    session
        .unpause(&torrent)
        .await
        .map_err(|e| format!("Failed to resume torrent {torrent_id}: {e}"))
}

#[tauri::command]
async fn torrent_progress(
    torrent_id: usize,
    state: tauri::State<'_, TorrentState>,
) -> Result<TorrentProgressResult, String> {
    let session = state.get_session().await;
    let torrent = session
        .get(torrent_id.into())
        .ok_or_else(|| format!("Torrent {torrent_id} not found"))?;

    let stats = torrent.stats();

    let speed = stats
        .live
        .as_ref()
        .map(|live| {
            // librqbit 8.x exposes live download speed in Mbps.
            (live.download_speed.mbps as f64 * 1_000_000.0 / 8.0) as u64
        })
        .unwrap_or(0);

    Ok(TorrentProgressResult {
        torrent_id,
        state: format!("{:?}", stats.state).to_ascii_lowercase(),
        downloaded: stats.progress_bytes,
        total: stats.total_bytes,
        speed,
        uploaded: stats.uploaded_bytes,
        finished: stats.finished,
        error: stats.error,
        info_hash: format!("{:?}", torrent.info_hash()),
    })
}

#[tauri::command]
async fn torrent_wait_until_ready(
    torrent_id: usize,
    state: tauri::State<'_, TorrentState>,
) -> Result<(), String> {
    let session = state.get_session().await;
    let torrent = session
        .get(torrent_id.into())
        .ok_or_else(|| format!("Torrent {torrent_id} not found"))?;

    // First wait for librqbit's own completion barrier. This is the point at
    // which all selected pieces have been downloaded and verified.
    torrent
        .wait_until_completed()
        .await
        .map_err(|e| format!("Torrent {torrent_id} did not finish cleanly: {e}"))?;

    // ManagedTorrentShared::options is private outside librqbit itself.
    // Use librqbit's public Api facade to retrieve the effective output folder.
    let api = Api::new(session.clone(), None);
    let details = api
        .api_torrent_details(TorrentIdOrHash::from(torrent_id))
        .map_err(|e| format!("Failed to determine torrent output folder: {e}"))?;
    let output_folder = PathBuf::from(details.output_folder);
    let only_files = torrent.only_files();

    let files: Vec<(PathBuf, u64)> = torrent
        .with_metadata(|metadata| {
            let mut files = Vec::new();
            let details = metadata
                .info
                .iter_file_details()
                .map_err(|e| format!("Failed to read torrent files: {e}"))?;

            for (index, detail) in details.enumerate() {
                if let Some(selected) = &only_files {
                    if !selected.contains(&index) {
                        continue;
                    }
                }

                let relative = detail
                    .filename
                    .to_string()
                    .map_err(|_| "Torrent contains an invalid file path".to_string())?;
                files.push((output_folder.join(relative), detail.len));
            }

            Ok::<Vec<(PathBuf, u64)>, String>(files)
        })
        .map_err(|e| format!("Failed to inspect completed torrent files: {e}"))??;

    // A completed torrent can still have librqbit's disk/storage machinery
    // holding Windows file handles open. The download is complete, but that
    // does NOT mean the files are ready for other applications yet. Remove the
    // managed torrent while keeping its files on disk; this shuts down its
    // torrent/storage tasks and releases their handles.
    //
    // IMPORTANT: drop our local Arc first. delete_files=false means this is a
    // forget/release operation, not a deletion of the user's completed
    // download.
    drop(torrent);

    session
        .delete(torrent_id.into(), false)
        .await
        .map_err(|e| format!("Failed to release completed torrent file handles: {e}"))?;

    // The completion barrier guarantees that the selected pieces were
    // downloaded and verified. After the managed torrent is released, keep
    // the remaining readiness check lightweight: confirm final paths, sizes,
    // and that another process can open the files for reading. Do not perform
    // a second full-file verification.
    let deadline = Instant::now() + Duration::from_secs(30);

    loop {
        let mut ready = true;

        for (path, expected_size) in &files {
            let metadata = match std::fs::metadata(path) {
                Ok(metadata) => metadata,
                Err(_) => {
                    ready = false;
                    break;
                }
            };

            if metadata.len() != *expected_size || !file_is_ready(path) {
                ready = false;
                break;
            }
        }

        if ready {
            return Ok(());
        }

        if Instant::now() >= deadline {
            return Err(
                "Torrent data is complete, but one or more output files are still unavailable.
                 Please wait briefly and try opening the file again."
                    .replace('\n', " ")
            );
        }

        tokio::time::sleep(Duration::from_millis(250)).await;
    }
}

fn file_is_ready(path: &Path) -> bool {
    // A normal read-open is the correct readiness test. On Windows, requiring
    // share_mode(0) asks for an exclusive handle and can fail even though the
    // file is perfectly usable by Explorer and other applications.
    std::fs::File::open(path).is_ok()
}

#[tauri::command]
async fn open_local_path(
    path: String,
    app: tauri::AppHandle,
) -> Result<(), String> {
    let target = PathBuf::from(path.trim());

    if target.as_os_str().is_empty() {
        return Err("No path was provided".into());
    }

    if !target.exists() {
        return Err(format!("Path does not exist: {}", target.display()));
    }

    // Use Tauri's opener plugin rather than invoking Explorer/cmd/open/xdg-open
    // directly. This delegates to the platform's default file manager/application
    // on Windows, macOS and Linux without hard-coding an OS shell executable.
    app.opener()
        .open_path(target.to_string_lossy().into_owned(), None::<&str>)
        .map_err(|e| format!("Could not open local path: {e}"))?;

    Ok(())
}

#[tauri::command]
fn create_local_directory(path: String) -> Result<String, String> {
    let target = PathBuf::from(path.trim());

    if target.as_os_str().is_empty() {
        return Err("No directory path was provided".into());
    }

    std::fs::create_dir_all(&target)
        .map_err(|e| format!("Could not create directory {}: {e}", target.display()))?;

    Ok(target.to_string_lossy().into_owned())
}

#[tauri::command]
async fn download_adaptive(
    url: String,
    file_path: String,
    max_connections: Option<usize>,
    transfer_id: String,
    on_event: Channel<DownloadEvent>,
    state: tauri::State<'_, HttpTransferState>,
) -> Result<(), String> {
    validate_http_url(&url)?;

    let cancellation = Arc::new(std::sync::atomic::AtomicBool::new(false));
    {
        let mut transfers = state
            .cancellations
            .lock()
            .map_err(|_| "HTTP transfer state lock poisoned".to_string())?;
        transfers.insert(transfer_id.clone(), cancellation.clone());
    }

    let cleanup = || {
        if let Ok(mut transfers) = state.cancellations.lock() {
            transfers.remove(&transfer_id);
        }
    };

    let result = async {
        let client = client()?;
        let probe = probe_remote_file(url.clone()).await?;
        let total = probe.size;

        let max_connections = max_connections
            .unwrap_or(MAX_PARALLEL)
            .clamp(MIN_PARALLEL, MAX_PARALLEL);

        if total == 0 {
            return Err("The server did not provide a usable file size".into());
        }

        if let Some(parent) = Path::new(&file_path).parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| format!("Could not create destination directory: {e}"))?;
        }

        // A server without byte-range support cannot safely resume a partial
        // HTTP response. It can still be paused/cancelled, but a later resume
        // restarts that transfer from the beginning.
        if !probe.supports_ranges {
            on_event
                .send(DownloadEvent::Started {
                    total,
                    connections: 1,
                    segmented: false,
                })
                .map_err(|e| e.to_string())?;

            return single_stream_download(
                &client,
                &probe.final_url,
                &file_path,
                total,
                cancellation.clone(),
                on_event,
            )
            .await;
        }

        let chunk_size = ((total / (max_connections as u64 * 8))
            .clamp(MIN_CHUNK, MAX_CHUNK))
            .max(MIN_CHUNK);
        let resume_path = http_resume_state_path(&file_path);

        let resume_state = load_http_resume_state(
            &resume_path,
            &probe.final_url,
            total,
            chunk_size,
        )
        .unwrap_or_else(|| HttpResumeState {
            url: probe.final_url.clone(),
            total,
            chunk_size,
            completed_ranges: Vec::new(),
        });

        let completed_set: HashSet<(u64, u64)> =
            resume_state.completed_ranges.iter().copied().collect();

        let mut ranges = Vec::new();
        let mut start = 0u64;
        while start < total {
            let end = (start + chunk_size - 1).min(total - 1);
            ranges.push((start, end));
            start = end + 1;
        }

        // Preallocate without truncating an existing partial download. This
        // is what allows a paused transfer to retain its completed ranges.
        let file = OpenOptions::new()
            .create(true)
            .read(true)
            .write(true)
            .open(&file_path)
            .map_err(|e| format!("Could not create destination file: {e}"))?;

        file.set_len(total)
            .map_err(|e| format!("Could not preallocate destination file: {e}"))?;

        let file = Arc::new(file);
        let completed_ranges = Arc::new(Mutex::new(resume_state.clone()));
        let downloaded = Arc::new(AtomicU64::new(
            completed_set
                .iter()
                .map(|(range_start, range_end)| range_end - range_start + 1)
                .sum(),
        ));
        let next_range = Arc::new(AtomicUsize::new(0));
        let active_limit = Arc::new(AtomicUsize::new(
            MIN_PARALLEL.min(max_connections),
        ));
        let last_sample_bytes = Arc::new(AtomicU64::new(downloaded.load(Ordering::Acquire)));
        let last_sample_at = Arc::new(Mutex::new(Instant::now()));
        let worker_error = Arc::new(Mutex::new(None::<String>));
        let resume_dirty = Arc::new(std::sync::atomic::AtomicBool::new(false));
        let last_resume_save = Arc::new(Mutex::new(Instant::now()));

        // Persist the state before workers start so a sudden process exit still
        // has a valid manifest for the already-completed ranges.
        save_http_resume_state_atomic(&resume_path, &resume_state)?;

        on_event
            .send(DownloadEvent::Started {
                total,
                connections: active_limit.load(Ordering::Relaxed),
                segmented: true,
            })
            .map_err(|e| e.to_string())?;

        let mut tasks = Vec::with_capacity(max_connections);

        for worker_id in 0..max_connections {
            let client = client.clone();
            let request_url = probe.final_url.clone();
            let file = file.clone();
            let ranges = ranges.clone();
            let next_range = next_range.clone();
            let completed_ranges = completed_ranges.clone();
            let downloaded = downloaded.clone();
            let active_limit = active_limit.clone();
            let worker_error = worker_error.clone();
            let cancellation = cancellation.clone();
            let resume_path = resume_path.clone();
            let resume_dirty = resume_dirty.clone();
            let last_resume_save = last_resume_save.clone();

            tasks.push(tauri::async_runtime::spawn(async move {
                let result: Result<(), String> = async {
                    loop {
                        if cancellation.load(Ordering::Acquire) {
                            return Err(HTTP_PAUSED.into());
                        }

                        let allowed = active_limit.load(Ordering::Acquire);
                        if worker_id >= allowed {
                            tokio::time::sleep(Duration::from_millis(100)).await;
                            continue;
                        }

                        let range_index = next_range.fetch_add(1, Ordering::AcqRel);
                        if range_index >= ranges.len() {
                            break;
                        }

                        let (start, end) = ranges[range_index];
                        {
                            let state = completed_ranges
                                .lock()
                                .map_err(|_| "HTTP resume state lock poisoned".to_string())?;
                            if state.completed_ranges.contains(&(start, end)) {
                                continue;
                            }
                        }

                        let mut response = None;
                        let mut last_status = None;

                        for attempt in 0..6u32 {
                            if cancellation.load(Ordering::Acquire) {
                                return Err(HTTP_PAUSED.into());
                            }

                            let candidate = client
                                .get(&request_url)
                                .header(
                                    header::RANGE,
                                    format!("bytes={start}-{end}"),
                                )
                                .header(header::ACCEPT_ENCODING, "identity")
                                .send()
                                .await
                                .map_err(|e| {
                                    format!(
                                        "Range request {start}-{end} failed: {e}"
                                    )
                                })?;

                            if candidate.status()
                                == reqwest::StatusCode::PARTIAL_CONTENT
                            {
                                response = Some(candidate);
                                break;
                            }

                            let status = candidate.status();
                            last_status = Some(status);

                            let retryable = status
                                == reqwest::StatusCode::TOO_MANY_REQUESTS
                                || status == reqwest::StatusCode::REQUEST_TIMEOUT
                                || status.is_server_error();

                            if !retryable || attempt == 5 {
                                break;
                            }

                            if status == reqwest::StatusCode::TOO_MANY_REQUESTS {
                                let current = active_limit.load(Ordering::Acquire);
                                if current > MIN_PARALLEL {
                                    active_limit.store(
                                        (current / 2).max(MIN_PARALLEL),
                                        Ordering::Release,
                                    );
                                }
                            }

                            let backoff_ms =
                                400u64.saturating_mul(1u64 << attempt.min(4));
                            tokio::time::sleep(Duration::from_millis(backoff_ms)).await;
                        }

                        let mut response = match response {
                            Some(response) => response,
                            None => {
                                return Err(match last_status {
                                    Some(status) => format!(
                                        "Range request {start}-{end} could not be completed after retries (HTTP {status})"
                                    ),
                                    None => format!(
                                        "Range request {start}-{end} could not be completed"
                                    ),
                                });
                            }
                        };

                        // Validate Content-Range header if present
                        if let Some(cr) = response.headers().get(header::CONTENT_RANGE).and_then(|v| v.to_str().ok()) {
                            if let Some((r_start, r_end, _)) = parse_content_range(cr) {
                                if r_start != start || r_end != end {
                                    return Err(format!(
                                        "Server returned mismatched Content-Range: requested bytes={start}-{end}, received {cr}"
                                    ));
                                }
                            }
                        }

                        let mut offset = start;
                        while let Some(chunk) = response
                            .chunk()
                            .await
                            .map_err(|e| format!("Reading range {start}-{end} failed: {e}"))?
                        {
                            if cancellation.load(Ordering::Acquire) {
                                return Err(HTTP_PAUSED.into());
                            }

                            let bytes = chunk.to_vec();
                            let bytes_len = bytes.len() as u64;
                            let write_offset = offset;

                            // Direct positioned write without global file-position lock
                            write_at(&file, write_offset, &bytes)
                                .map_err(|e| format!("Failed to write chunk at offset {write_offset}: {e}"))?;

                            offset += bytes_len;
                            downloaded.fetch_add(bytes_len, Ordering::AcqRel);
                        }

                        if offset != end + 1 {
                            return Err(format!(
                                "Range request {start}-{end} ended early (received {} bytes)",
                                offset.saturating_sub(start)
                            ));
                        }

                        {
                            let mut state = completed_ranges
                                .lock()
                                .map_err(|_| "HTTP resume state lock poisoned".to_string())?;
                            if !state.completed_ranges.contains(&(start, end)) {
                                state.completed_ranges.push((start, end));
                                resume_dirty.store(true, Ordering::Release);

                                // Checkpoint resume state if more than 3 seconds since last save
                                let mut last_save = last_resume_save
                                    .lock()
                                    .map_err(|_| "resume save lock poisoned".to_string())?;
                                if last_save.elapsed() >= Duration::from_secs(3) {
                                    let _ = save_http_resume_state_atomic(&resume_path, &state);
                                    *last_save = Instant::now();
                                    resume_dirty.store(false, Ordering::Release);
                                }
                            }
                        }
                    }

                    Ok(())
                }
                .await;

                if let Err(error) = &result {
                    if let Ok(mut guard) = worker_error.lock() {
                        if guard.is_none() {
                            *guard = Some(error.clone());
                        }
                    }
                }

                result
            }));
        }

        let started = Instant::now();
        let mut last_emit = Instant::now();
        let mut previous_speed = 0u64;

        loop {
            if cancellation.load(Ordering::Acquire) {
                for task in &tasks {
                    task.abort();
                }
                for task in tasks {
                    let _ = task.await;
                }
                // Flush dirty resume state upon pause
                if resume_dirty.load(Ordering::Acquire) {
                    if let Ok(state) = completed_ranges.lock() {
                        let _ = save_http_resume_state_atomic(&resume_path, &state);
                    }
                }
                return Err(HTTP_PAUSED.into());
            }

            if let Some(error) = worker_error
                .lock()
                .ok()
                .and_then(|guard| guard.clone())
            {
                for task in &tasks {
                    task.abort();
                }
                for task in tasks {
                    let _ = task.await;
                }
                // Flush dirty resume state upon error
                if resume_dirty.load(Ordering::Acquire) {
                    if let Ok(state) = completed_ranges.lock() {
                        let _ = save_http_resume_state_atomic(&resume_path, &state);
                    }
                }
                return Err(error);
            }

            let completed = downloaded.load(Ordering::Acquire).min(total);
            let now = Instant::now();
            let elapsed = now.duration_since(last_emit);

            if elapsed >= Duration::from_millis(250) {
                let previous = last_sample_bytes.swap(completed, Ordering::AcqRel);
                let sample_seconds = elapsed.as_secs_f64().max(0.001);
                let current_speed =
                    ((completed.saturating_sub(previous)) as f64 / sample_seconds) as u64;

                on_event
                    .send(DownloadEvent::Progress {
                        downloaded: completed,
                        total,
                        speed: current_speed,
                        connections: active_limit.load(Ordering::Relaxed),
                    })
                    .map_err(|e| e.to_string())?;

                last_emit = now;

                if now
                    .duration_since(*last_sample_at.lock().unwrap())
                    >= Duration::from_secs(2)
                {
                    let mut sample_at = last_sample_at.lock().unwrap();
                    *sample_at = now;
                    let current = current_speed;
                    let limit = active_limit.load(Ordering::Acquire);

                    if current > 0 && previous_speed > 0 {
                        let ratio = current as f64 / previous_speed as f64;
                        if ratio < 0.85 && limit > MIN_PARALLEL {
                            active_limit.fetch_sub(1, Ordering::AcqRel);
                        } else if ratio >= 0.97 && limit < max_connections {
                            active_limit.fetch_add(1, Ordering::AcqRel);
                        }
                    } else if current > 0 && limit < max_connections {
                        active_limit.fetch_add(1, Ordering::AcqRel);
                    }
                    previous_speed = current;
                }
            }

            if completed >= total {
                break;
            }

            let _ = started;
            tokio::time::sleep(Duration::from_millis(50)).await;
        }

        for task in tasks {
            task.await.map_err(|e| e.to_string())??;
        }

        file.sync_all()
            .map_err(|e| format!("Could not finalize destination file: {e}"))?;

        let _ = std::fs::remove_file(&resume_path);

        on_event
            .send(DownloadEvent::Progress {
                downloaded: total,
                total,
                speed: 0,
                connections: 0,
            })
            .map_err(|e| e.to_string())?;

        on_event
            .send(DownloadEvent::Finished)
            .map_err(|e| e.to_string())?;

        Ok::<(), String>(())
    }
    .await;

    cleanup();
    result
}

async fn single_stream_download(
    client: &reqwest::Client,
    url: &str,
    file_path: &str,
    total: u64,
    cancellation: Arc<std::sync::atomic::AtomicBool>,
    on_event: Channel<DownloadEvent>,
) -> Result<(), String> {
    let existing_len = std::fs::metadata(file_path)
        .map(|metadata| metadata.len().min(total))
        .unwrap_or(0);

    if existing_len >= total {
        on_event
            .send(DownloadEvent::Progress {
                downloaded: total,
                total,
                speed: 0,
                connections: 1,
            })
            .map_err(|e| e.to_string())?;
        on_event
            .send(DownloadEvent::Finished)
            .map_err(|e| e.to_string())?;
        return Ok(());
    }

    let mut request = client
        .get(url)
        .header(header::ACCEPT_ENCODING, "identity");

    if existing_len > 0 {
        request = request.header(header::RANGE, format!("bytes={existing_len}-"));
    }

    let response = request
        .send()
        .await
        .map_err(|e| format!("Download request failed: {e}"))?;

    if existing_len > 0 && response.status() != reqwest::StatusCode::PARTIAL_CONTENT {
        // The server ignored the range request. Restart cleanly rather than
        // corrupting the file by appending a second copy.
        return single_stream_restart(
            client,
            url,
            file_path,
            total,
            cancellation,
            on_event,
        )
        .await;
    }

    if !response.status().is_success() {
        return Err(format!("Download failed with HTTP {}", response.status()));
    }

    let mut file = OpenOptions::new()
        .create(true)
        .read(true)
        .write(true)
        .open(file_path)
        .map_err(|e| format!("Could not open destination: {e}"))?;
    file.seek(SeekFrom::Start(existing_len))
        .map_err(|e| e.to_string())?;

    let mut downloaded = existing_len;
    let mut response = response;
    let mut last_at = Instant::now();
    let mut last_bytes = downloaded;

    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|e| format!("Reading download failed: {e}"))?
    {
        if cancellation.load(Ordering::Acquire) {
            return Err(HTTP_PAUSED.into());
        }

        file.write_all(&chunk)
            .map_err(|e| format!("Writing download failed: {e}"))?;
        downloaded = (downloaded + chunk.len() as u64).min(total);

        let now = Instant::now();
        if now.duration_since(last_at) >= Duration::from_millis(250) {
            let secs = now.duration_since(last_at).as_secs_f64().max(0.001);
            let speed = ((downloaded.saturating_sub(last_bytes)) as f64 / secs) as u64;
            on_event
                .send(DownloadEvent::Progress {
                    downloaded,
                    total,
                    speed,
                    connections: 1,
                })
                .map_err(|e| e.to_string())?;
            last_at = now;
            last_bytes = downloaded;
        }
    }

    file.sync_all()
        .map_err(|e| format!("Could not finalize destination file: {e}"))?;

    on_event
        .send(DownloadEvent::Progress {
            downloaded,
            total,
            speed: 0,
            connections: 1,
        })
        .map_err(|e| e.to_string())?;
    on_event
        .send(DownloadEvent::Finished)
        .map_err(|e| e.to_string())?;

    Ok(())
}

async fn single_stream_restart(
    client: &reqwest::Client,
    url: &str,
    file_path: &str,
    total: u64,
    cancellation: Arc<std::sync::atomic::AtomicBool>,
    on_event: Channel<DownloadEvent>,
) -> Result<(), String> {
    let response = client
        .get(url)
        .header(header::ACCEPT_ENCODING, "identity")
        .send()
        .await
        .map_err(|e| format!("Download request failed: {e}"))?;

    if !response.status().is_success() {
        return Err(format!("Download failed with HTTP {}", response.status()));
    }

    let mut file = OpenOptions::new()
        .create(true)
        .write(true)
        .truncate(true)
        .open(file_path)
        .map_err(|e| format!("Could not open destination: {e}"))?;

    let mut response = response;
    let mut downloaded = 0u64;
    let mut last_at = Instant::now();
    let mut last_bytes = 0u64;

    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|e| format!("Reading download failed: {e}"))?
    {
        if cancellation.load(Ordering::Acquire) {
            return Err(HTTP_PAUSED.into());
        }

        file.write_all(&chunk)
            .map_err(|e| format!("Writing download failed: {e}"))?;
        downloaded = (downloaded + chunk.len() as u64).min(total);

        let now = Instant::now();
        if now.duration_since(last_at) >= Duration::from_millis(250) {
            let secs = now.duration_since(last_at).as_secs_f64().max(0.001);
            let speed = ((downloaded.saturating_sub(last_bytes)) as f64 / secs) as u64;
            on_event
                .send(DownloadEvent::Progress {
                    downloaded,
                    total,
                    speed,
                    connections: 1,
                })
                .map_err(|e| e.to_string())?;
            last_at = now;
            last_bytes = downloaded;
        }
    }

    file.sync_all()
        .map_err(|e| format!("Could not finalize destination file: {e}"))?;

    on_event
        .send(DownloadEvent::Progress {
            downloaded,
            total,
            speed: 0,
            connections: 1,
        })
        .map_err(|e| e.to_string())?;
    on_event
        .send(DownloadEvent::Finished)
        .map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
fn pause_http_download(
    transfer_id: String,
    state: tauri::State<'_, HttpTransferState>,
) -> Result<(), String> {
    let transfers = state
        .cancellations
        .lock()
        .map_err(|_| "HTTP transfer state lock poisoned".to_string())?;

    match transfers.get(&transfer_id) {
        Some(cancellation) => {
            cancellation.store(true, Ordering::Release);
            Ok(())
        }
        None => Err("HTTP transfer is not currently active".into()),
    }
}

#[tauri::command]
async fn delete_incomplete_transfer(
    path: String,
    torrent_id: Option<usize>,
    torrent_is_multi_file: bool,
    torrent_state: tauri::State<'_, TorrentState>,
) -> Result<(), String> {
    // If this is a managed torrent, remove it first so librqbit releases any
    // open file handles before Windows/Linux/macOS are asked to delete files.
    let session = torrent_state.get_session().await;
    if let Some(id) = torrent_id {
        if session.get(id.into()).is_some() {
            session
                .delete(id.into(), true)
                .await
                .map_err(|e| format!("Failed to release incomplete torrent files: {e}"))?;
        }
    }

    let target = PathBuf::from(&path);
    let resume_state = http_resume_state_path(&path);

    // For a multi-file torrent `path` points at the torrent's dedicated output
    // directory. For HTTP and single-file torrents it points at the partial file.
    if torrent_is_multi_file {
        if target.exists() {
            std::fs::remove_dir_all(&target)
                .map_err(|e| format!("Failed to delete incomplete download directory '{}': {e}", target.display()))?;
        }
    } else if target.exists() {
        std::fs::remove_file(&target)
            .map_err(|e| format!("Failed to delete incomplete download '{}': {e}", target.display()))?;
    }

    // HTTP pause/resume metadata is an implementation detail and must not be
    // left behind after the user deletes the transfer.
    if resume_state.exists() {
        let _ = std::fs::remove_file(&resume_state);
    }

    Ok(())
}

#[tauri::command]
fn take_external_transfer(
    state: tauri::State<'_, PendingExternalTransfer>,
) -> Option<String> {
    state
        .0
        .lock()
        .ok()?
        .pop()
}

/// Register or unregister .torrent / magnet file associations in the current
/// user's registry hive (HKCU) without spawning any subprocess or requiring UAC.
/// Writing to HKCU works for both per-user and per-machine installs without elevation.
#[cfg(windows)]
fn do_register_file_associations_hkcu(torrent: bool, magnet: bool) -> Result<(), String> {
    use winreg::enums::HKEY_CURRENT_USER;
    use winreg::RegKey;

    let exe_path = std::env::current_exe()
        .map_err(|e| format!("Could not resolve executable path: {e}"))?;
    let exe_str = exe_path.to_string_lossy();
    let open_cmd = format!("\"{}\" \"%1\"", exe_str);

    let exe_dir = exe_path.parent().unwrap_or(&exe_path);
    let torrent_ico = exe_dir.join("torrent.ico");
    let magnet_ico = exe_dir.join("magnet.ico");
    let torrent_ico_str = if torrent_ico.exists() {
        format!("\"{}\"", torrent_ico.to_string_lossy())
    } else {
        format!("\"{}\",0", exe_str)
    };
    let magnet_ico_str = if magnet_ico.exists() {
        format!("\"{}\"", magnet_ico.to_string_lossy())
    } else {
        format!("\"{}\",0", exe_str)
    };

    // ── .torrent ─────────────────────────────────────────────────────────────
    if torrent {
        // File-type class
        let (cls, _) = hkcu
            .create_subkey("Software\\Classes\\FlowDown.Torrent")
            .map_err(|e| format!("Registry error (FlowDown.Torrent): {e}"))?;
        cls.set_value("", &"BitTorrent File")
            .map_err(|e| format!("Registry error: {e}"))?;

        let (icon, _) = hkcu
            .create_subkey("Software\\Classes\\FlowDown.Torrent\\DefaultIcon")
            .map_err(|e| format!("Registry error (DefaultIcon): {e}"))?;
        icon.set_value("", &torrent_ico_str)
            .map_err(|e| format!("Registry error: {e}"))?;

        let (cmd, _) = hkcu
            .create_subkey("Software\\Classes\\FlowDown.Torrent\\shell\\open\\command")
            .map_err(|e| format!("Registry error (shell\\open\\command): {e}"))?;
        cmd.set_value("", &open_cmd)
            .map_err(|e| format!("Registry error: {e}"))?;

        // Extension → class mapping
        let (ext, _) = hkcu
            .create_subkey("Software\\Classes\\.torrent")
            .map_err(|e| format!("Registry error (.torrent): {e}"))?;
        ext.set_value("", &"FlowDown.Torrent")
            .map_err(|e| format!("Registry error: {e}"))?;

        // OpenWithProgids mapping
        if let Ok((openwith, _)) = hkcu.create_subkey("Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\FileExts\\.torrent\\OpenWithProgids") {
            let _ = openwith.set_value("FlowDown.Torrent", &"");
        }

        // Applications\flowdown.exe mapping so Open With also resolves DefaultIcon & SupportedTypes
        if let Ok((app_key, _)) = hkcu.create_subkey("Software\\Classes\\Applications\\flowdown.exe") {
            let _ = app_key.set_value("FriendlyAppName", &"FlowDown");
            if let Ok((app_icon, _)) = app_key.create_subkey("DefaultIcon") {
                let _ = app_icon.set_value("", &torrent_ico_str);
            }
            if let Ok((app_types, _)) = app_key.create_subkey("SupportedTypes") {
                let _ = app_types.set_value(".torrent", &"");
            }
        }
    } else {
        // Only remove our own registration; never touch another app's entry.
        if let Ok(ext) = hkcu.open_subkey("Software\\Classes\\.torrent") {
            let current: String = ext.get_value("").unwrap_or_default();
            if current == "FlowDown.Torrent" {
                let _ = hkcu.delete_subkey_all("Software\\Classes\\FlowDown.Torrent");
                let _ = hkcu.delete_subkey_all("Software\\Classes\\.torrent");
            }
        }
        if let Ok(openwith) = hkcu.open_subkey("Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\FileExts\\.torrent\\OpenWithProgids") {
            let _ = openwith.delete_value("FlowDown.Torrent");
        }
    }

    // ── magnet: URI scheme ────────────────────────────────────────────────────
    if magnet {
        let (proto, _) = hkcu
            .create_subkey("Software\\Classes\\magnet")
            .map_err(|e| format!("Registry error (magnet): {e}"))?;
        proto.set_value("", &"URL:Magnet Protocol")
            .map_err(|e| format!("Registry error: {e}"))?;
        proto.set_value("URL Protocol", &"")
            .map_err(|e| format!("Registry error: {e}"))?;

        let (icon, _) = hkcu
            .create_subkey("Software\\Classes\\magnet\\DefaultIcon")
            .map_err(|e| format!("Registry error (magnet DefaultIcon): {e}"))?;
        icon.set_value("", &magnet_ico_str)
            .map_err(|e| format!("Registry error: {e}"))?;

        let (cmd, _) = hkcu
            .create_subkey("Software\\Classes\\magnet\\shell\\open\\command")
            .map_err(|e| format!("Registry error (magnet shell\\open\\command): {e}"))?;
        cmd.set_value("", &open_cmd)
            .map_err(|e| format!("Registry error: {e}"))?;
    } else {
        if let Ok(proto) = hkcu.open_subkey("Software\\Classes\\magnet\\shell\\open\\command") {
            let current: String = proto.get_value("").unwrap_or_default();
            if current == open_cmd {
                let _ = hkcu.delete_subkey_all("Software\\Classes\\magnet");
            }
        }
    }

    // Notify the shell so Explorer / taskbar update immediately.
    unsafe {
        windows_sys::Win32::UI::Shell::SHChangeNotify(
            windows_sys::Win32::UI::Shell::SHCNE_ASSOCCHANGED as i32,
            windows_sys::Win32::UI::Shell::SHCNF_IDLIST,
            std::ptr::null(),
            std::ptr::null(),
        );
    }

    Ok(())
}

#[cfg(windows)]
#[tauri::command]
fn register_file_associations(
    _app: tauri::AppHandle,
    torrent: bool,
    magnet: bool,
) -> Result<(), String> {
    do_register_file_associations_hkcu(torrent, magnet)
}

/// File association registration on Linux (via xdg-mime) and macOS (handled by bundle Info.plist).
#[cfg(target_os = "linux")]
#[tauri::command]
fn register_file_associations(
    _app: tauri::AppHandle,
    torrent: bool,
    magnet: bool,
) -> Result<(), String> {
    if torrent {
        let status = std::process::Command::new("xdg-mime")
            .args(["default", "flowdown.desktop", "application/x-bittorrent"])
            .status()
            .map_err(|e| format!("Failed to run xdg-mime: {e}"))?;
        if !status.success() {
            return Err("xdg-mime failed to set .torrent file association".into());
        }
    }
    if magnet {
        let status = std::process::Command::new("xdg-mime")
            .args(["default", "flowdown.desktop", "x-scheme-handler/magnet"])
            .status()
            .map_err(|e| format!("Failed to run xdg-mime: {e}"))?;
        if !status.success() {
            return Err("xdg-mime failed to set magnet URI association".into());
        }
    }
    Ok(())
}

#[cfg(target_os = "macos")]
#[tauri::command]
fn register_file_associations(
    _app: tauri::AppHandle,
    _torrent: bool,
    _magnet: bool,
) -> Result<(), String> {
    // On macOS, file and URL scheme associations are automatically handled
    // by LaunchServices via the app bundle's Info.plist.
    Ok(())
}

#[cfg(not(any(windows, target_os = "linux", target_os = "macos")))]
#[tauri::command]
fn register_file_associations(
    _app: tauri::AppHandle,
    _torrent: bool,
    _magnet: bool,
) -> Result<(), String> {
    Err("File association registration is not supported on this platform.".into())
}

#[tauri::command]
async fn update_torrent_engine_config(
    config: TorrentEngineConfig,
    app: tauri::AppHandle,
    state: tauri::State<'_, TorrentState>,
) -> Result<(), String> {
    let requires_session_restart = {
        if let Ok(current_cfg) = state.config.lock() {
            current_cfg.listen_port != config.listen_port
                || current_cfg.randomize_port != config.randomize_port
                || current_cfg.disable_dht != config.disable_dht
        } else {
            false
        }
    };

    if requires_session_restart {
        let output_folder = app
            .path()
            .download_dir()
            .map_err(|e| format!("Failed to get Downloads directory: {e}"))?;

        let opts = make_session_options(Some(&config));
        let new_session = Session::new_with_opts(output_folder, opts)
            .await
            .map_err(|e| format!("Failed to update BitTorrent session: {e}"))?;

        let mut write_lock = state.session.write().await;
        *write_lock = new_session;
    }

    if let Ok(mut cfg_guard) = state.config.lock() {
        *cfg_guard = config;
    }

    Ok(())
}

fn main() {
    tauri::Builder::default()
        // Keep FlowDown single-instance so opening a .torrent or magnet link
        // while the app is already running reuses the existing window.
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            if let Some(source) = argv.iter().skip(1).find(|arg| {
                let value = arg.trim().to_ascii_lowercase();
                value.starts_with("magnet:") || value.ends_with(".torrent") || value.starts_with("file:")
            }) {
                let _ = app.emit(
                    "external-transfer",
                    ExternalTransferPayload {
                        source: source.clone(),
                    },
                );
            }

            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_upload::init())
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .setup(|app| {
            let output_folder = app
                .path()
                .download_dir()
                .map_err(|e| {
                    format!(
                        "Failed to get Downloads directory: {e}"
                    )
                })?;

            let default_config = TorrentEngineConfig {
                listen_port: Some(51413),
                randomize_port: Some(false),
                disable_dht: Some(false),
                anonymous_mode: Some(true),
                client_id_spoof: Some("Transmission".to_string()),
            };

            let opts = make_session_options(Some(&default_config));
            let session = tauri::async_runtime::block_on(
                Session::new_with_opts(output_folder, opts)
            )
            .map_err(|e| {
                format!(
                    "Failed to create BitTorrent session: {e}"
                )
            })?;

            app.manage(TorrentState {
                session: Arc::new(tokio::sync::RwLock::new(session)),
                config: Arc::new(Mutex::new(default_config)),
            });
            app.manage(PendingExternalTransfer(Mutex::new(
                std::env::args()
                    .skip(1)
                    .filter(|arg| {
                        let value = arg.trim().to_ascii_lowercase();
                        value.starts_with("magnet:")
                            || value.ends_with(".torrent")
                            || value.starts_with("file:")
                    })
                    .collect(),
            )));
            app.manage(HttpTransferState {
                cancellations: Mutex::new(HashMap::new()),
            });

            // Suppress the WebView2 browser context menu on non-interactive areas.
            // Runs via eval so it is registered before any app JS can fire.
            // Editable inputs and [data-context-menu] elements still get their menus.
            if let Some(win) = app.get_webview_window("main") {
                let _ = win.eval(
                    "document.addEventListener('contextmenu', function(e) { \
                        var t = e.target; \
                        var editable = t instanceof HTMLInputElement \
                            || t instanceof HTMLTextAreaElement \
                            || t.isContentEditable \
                            || !!t.closest('[data-context-menu]'); \
                        if (!editable) e.preventDefault(); \
                    }, true);"
                );
            }

            #[cfg(windows)]
            {
                // Self-heal stale association in HKCU if pointing to a non-existent executable
                use winreg::enums::HKEY_CURRENT_USER;
                use winreg::RegKey;
                let hkcu = RegKey::predef(HKEY_CURRENT_USER);
                if let Ok(proto) = hkcu.open_subkey("Software\\Classes\\magnet\\shell\\open\\command") {
                    let current: String = proto.get_value("").unwrap_or_default();
                    if current.to_ascii_lowercase().contains("wanderlust.exe") {
                        let _ = do_register_file_associations_hkcu(false, true);
                    }
                }
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            probe_remote_file,
            download_adaptive,
            pause_http_download,
            delete_incomplete_transfer,
            open_local_path,
            create_local_directory,
            start_torrent,
            inspect_torrent,
            pause_torrent,
            resume_torrent,
            torrent_progress,
            torrent_wait_until_ready,
            update_torrent_engine_config,
            take_external_transfer,
            register_file_associations
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_sanitize_download_filename_traversal() {
        assert_eq!(sanitize_download_filename("../file.exe"), "file.exe");
        assert_eq!(sanitize_download_filename("../../file.exe"), "file.exe");
        assert_eq!(sanitize_download_filename(r"..\..\file.exe"), "file.exe");
        assert_eq!(sanitize_download_filename(r"C:\file.exe"), "file.exe");
        assert_eq!(sanitize_download_filename(r"\\server\share\file.exe"), "file.exe");
    }

    #[test]
    fn test_sanitize_download_filename_windows_reserved() {
        assert_eq!(sanitize_download_filename("CON"), "_CON");
        assert_eq!(sanitize_download_filename("con.txt"), "_con.txt");
        assert_eq!(sanitize_download_filename("NUL"), "_NUL");
        assert_eq!(sanitize_download_filename("nul.tar.gz"), "_nul.tar.gz");
        assert_eq!(sanitize_download_filename("AUX"), "_AUX");
        assert_eq!(sanitize_download_filename("COM1"), "_COM1");
        assert_eq!(sanitize_download_filename("LPT1"), "_LPT1");
    }

    #[test]
    fn test_sanitize_download_filename_special_chars() {
        assert_eq!(sanitize_download_filename("file:name.exe"), "file name.exe");
        assert_eq!(sanitize_download_filename("file?.exe"), "file .exe");
        assert_eq!(sanitize_download_filename("file*.exe"), "file .exe");
        assert_eq!(sanitize_download_filename("file with trailing space "), "file with trailing space");
        assert_eq!(sanitize_download_filename("file with trailing dot."), "file with trailing dot");
        assert_eq!(sanitize_download_filename(""), "downloaded_file.bin");
    }

    #[test]
    fn test_safe_join_download_path() {
        let base = PathBuf::from("C:\\Users\\User\\Downloads");
        let safe = safe_join_download_path(&base, "../../etc/passwd").unwrap();
        assert_eq!(safe, base.join("passwd"));
    }

    #[test]
    fn test_parse_content_range_valid() {
        assert_eq!(parse_content_range("bytes 0-499/1234"), Some((0, 499, 1234)));
        assert_eq!(parse_content_range("bytes 100-200/5000"), Some((100, 200, 5000)));
    }

    #[test]
    fn test_parse_content_range_invalid() {
        assert_eq!(parse_content_range("none"), None);
        assert_eq!(parse_content_range("bytes 500-400/1000"), None);
        assert_eq!(parse_content_range("bytes invalid"), None);
    }

    #[test]
    fn test_http_resume_state_atomic_save_load() {
        let dir = tempfile::tempdir().unwrap();
        let target = dir.path().join("test.bin.flowdown.state.json");
        let state = HttpResumeState {
            url: "https://example.com/test.bin".into(),
            total: 1024,
            chunk_size: 256,
            completed_ranges: vec![(0, 255), (256, 511)],
        };

        save_http_resume_state_atomic(&target, &state).unwrap();
        let loaded = load_http_resume_state(&target, "https://example.com/test.bin", 1024, 256).unwrap();
        assert_eq!(loaded.completed_ranges.len(), 2);
        assert_eq!(loaded.completed_ranges[0], (0, 255));
    }
}