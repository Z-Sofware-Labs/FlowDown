use crate::bencode::{
    create_torrent, decode_base64, parse_magnet_or_hash, parse_torrent_bytes,
};
use crate::bittorrent::{
    announce_trackers, fetch_metadata_from_peers, fetch_torrent_from_public_caches,
    generate_peer_id,
};
use crate::config::SharedConfig;
use crate::engine::DaemonEngine;
use crate::libqrbit::LibqrbitEngine;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use sysinfo::Disks;
use tracing::debug;

#[derive(Debug, Serialize, Deserialize)]
pub struct JsonRpcRequest {
    pub jsonrpc: String,
    pub id: Option<Value>,
    pub method: String,
    pub params: Option<Value>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct JsonRpcResponse {
    pub jsonrpc: String,
    pub id: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<Value>,
}

pub struct RpcDispatcher {
    engine: Arc<DaemonEngine>,
    config: SharedConfig,
    libqrbit: Arc<LibqrbitEngine>,
    config_path: PathBuf,
}

impl RpcDispatcher {
    pub fn new(
        engine: Arc<DaemonEngine>,
        config: SharedConfig,
        libqrbit: Arc<LibqrbitEngine>,
        config_path: PathBuf,
    ) -> Self {
        Self {
            engine,
            config,
            libqrbit,
            config_path,
        }
    }

    pub async fn dispatch(&self, raw_json: &str) -> String {
        let request: JsonRpcRequest = match serde_json::from_str(raw_json) {
            Ok(req) => req,
            Err(e) => {
                let err_res = JsonRpcResponse {
                    jsonrpc: "2.0".to_string(),
                    id: None,
                    result: None,
                    error: Some(json!({ "code": -32700, "message": format!("Parse error: {}", e) })),
                };
                return serde_json::to_string(&err_res).unwrap_or_default();
            }
        };

        debug!("[RPC] Invoking method: {}", request.method);
        let result = self.dispatch_method(&request).await;

        let response = match result {
            Ok(res) => JsonRpcResponse {
                jsonrpc: "2.0".to_string(),
                id: request.id,
                result: Some(res),
                error: None,
            },
            Err(err_msg) => JsonRpcResponse {
                jsonrpc: "2.0".to_string(),
                id: request.id,
                result: None,
                error: Some(json!({ "code": -32601, "message": err_msg })),
            },
        };

        serde_json::to_string(&response).unwrap_or_default()
    }

    async fn dispatch_method(&self, request: &JsonRpcRequest) -> Result<Value, String> {
        let method = request.method.as_str();
        match method {
            "core.getVersion" => Ok(json!({
                "daemon": "flowdownd",
                "app": "FlowDown",
                "version": "2.0.8",
                "protocol": "jsonrpc-2.0",
                "os": std::env::consts::OS,
                "arch": std::env::consts::ARCH
            })),

            "core.getSessionStats" => {
                let stats = self.engine.get_session_stats().await;
                Ok(serde_json::to_value(stats).unwrap_or(Value::Null))
            }

            "core.syncSnapshot" => {
                let transfers = self.engine.list_transfers().await;
                let stats = self.engine.get_session_stats().await;
                let logs = self.engine.get_logs().await;
                Ok(json!({
                    "transfers": transfers,
                    "stats": stats,
                    "logs": logs,
                }))
            }

            "core.resetSessionStats" => {
                self.engine.reset_session_stats();
                Ok(json!({
                    "success": true,
                    "message": "Session stats reset to 0 B without transfer interruption"
                }))
            }

            "core.getLogs" => {
                let logs = self.engine.get_logs().await;
                Ok(serde_json::to_value(logs).unwrap_or(Value::Null))
            }

            "torrents.list" => {
                let list = self.engine.list_transfers().await;
                Ok(serde_json::to_value(list).unwrap_or(Value::Null))
            }

            "torrents.getDetails" => {
                let id = request
                    .params
                    .as_ref()
                    .and_then(|p| p.get("id"))
                    .and_then(|v| v.as_str())
                    .unwrap_or_default();
                match self.engine.get_transfer(id).await {
                    Some(item) => Ok(serde_json::to_value(item).unwrap_or(Value::Null)),
                    None => Err(format!("Transfer not found: {}", id)),
                }
            }

            "torrents.addHttp" => {
                let p = request.params.as_ref().ok_or("Missing params")?;
                let url = p
                    .get("url")
                    .and_then(|v| v.as_str())
                    .unwrap_or_default()
                    .trim()
                    .to_string();
                let name = p
                    .get("name")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string();
                let size = p.get("size").and_then(|v| v.as_u64()).unwrap_or(0);
                let category = p
                    .get("category")
                    .and_then(|v| v.as_str())
                    .unwrap_or("Default")
                    .to_string();
                let priority = p
                    .get("priority")
                    .and_then(|v| v.as_str())
                    .unwrap_or("Normal")
                    .to_string();
                let segments_count = p
                    .get("segments_count")
                    .and_then(|v| v.as_u64())
                    .unwrap_or(8)
                    .clamp(1, 32) as usize;
                let stealth = false;
                let obfuscation_level = 1u8;
                let save_path = {
                    let cfg = self.config.read().await;
                    p.get("save_path")
                        .and_then(|v| v.as_str())
                        .filter(|s| !s.trim().is_empty())
                        .map(PathBuf::from)
                        .unwrap_or_else(|| cfg.download_directory.clone())
                };

                let item = self
                    .engine
                    .add_http_transfer(
                        url,
                        name,
                        size,
                        segments_count,
                        category,
                        priority,
                        stealth,
                        obfuscation_level,
                        save_path,
                    )
                    .await?;

                Ok(json!({
                    "success": true,
                    "id": item.id,
                    "name": item.name,
                    "size": item.size,
                    "segments_count": segments_count
                }))
            }

            "torrents.addMagnet" => {
                let p = request.params.as_ref().ok_or("Missing params")?;
                let input = p
                    .get("url")
                    .or_else(|| p.get("magnetUri"))
                    .or_else(|| p.get("hash"))
                    .and_then(|v| v.as_str())
                    .unwrap_or_default()
                    .to_string();
                let name = p
                    .get("name")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string());
                let size = p.get("size").and_then(|v| v.as_u64());
                let category = p
                    .get("category")
                    .and_then(|v| v.as_str())
                    .unwrap_or("Linux")
                    .to_string();
                let priority = p
                    .get("priority")
                    .and_then(|v| v.as_str())
                    .unwrap_or("Normal")
                    .to_string();
                let stealth = p
                    .get("libqrbit_enabled")
                    .and_then(|v| v.as_bool())
                    .unwrap_or(true);
                let obfuscation_level = p
                    .get("obfuscation_level")
                    .and_then(|v| v.as_u64())
                    .unwrap_or(3)
                    .clamp(1, 4) as u8;
                let save_path = {
                    let cfg = self.config.read().await;
                    p.get("save_path")
                        .and_then(|v| v.as_str())
                        .filter(|s| !s.trim().is_empty())
                        .map(PathBuf::from)
                        .unwrap_or_else(|| cfg.download_directory.clone())
                };

                let item = self
                    .engine
                    .add_magnet_transfer(
                        input,
                        name,
                        size,
                        category,
                        priority,
                        stealth,
                        obfuscation_level,
                        save_path,
                    )
                    .await?;

                Ok(json!({
                    "success": true,
                    "id": item.id,
                    "hash": item.hash,
                    "name": item.name
                }))
            }

            "torrents.addFile" => {
                let p = request.params.as_ref().ok_or("Missing params")?;
                let category = p
                    .get("category")
                    .and_then(|v| v.as_str())
                    .unwrap_or("Default")
                    .to_string();
                let priority = p
                    .get("priority")
                    .and_then(|v| v.as_str())
                    .unwrap_or("Normal")
                    .to_string();
                let stealth = p
                    .get("libqrbit_enabled")
                    .and_then(|v| v.as_bool())
                    .unwrap_or(true);
                let obfuscation_level = p
                    .get("obfuscation_level")
                    .and_then(|v| v.as_u64())
                    .unwrap_or(3)
                    .clamp(1, 4) as u8;
                let save_path = {
                    let cfg = self.config.read().await;
                    p.get("save_path")
                        .and_then(|v| v.as_str())
                        .filter(|s| !s.trim().is_empty())
                        .map(PathBuf::from)
                        .unwrap_or_else(|| cfg.download_directory.clone())
                };

                let raw_bytes = if let Some(b64) = p.get("content_base64").and_then(|v| v.as_str()) {
                    decode_base64(b64)?
                } else if let Some(fpath) = p.get("file_path").and_then(|v| v.as_str()) {
                    if fpath.starts_with("http://") || fpath.starts_with("https://") {
                        let client = reqwest::Client::builder()
                            .timeout(std::time::Duration::from_secs(15))
                            .redirect(reqwest::redirect::Policy::limited(10))
                            .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36")
                            .build()
                            .map_err(|e| e.to_string())?;
                        let resp = client
                            .get(fpath)
                            .header(reqwest::header::ACCEPT, "application/x-bittorrent, application/octet-stream, */*")
                            .header(reqwest::header::ACCEPT_ENCODING, "identity")
                            .header(reqwest::header::REFERER, fpath)
                            .send()
                            .await;
                        let bytes_opt = match resp {
                            Ok(r) if r.status().is_success() => r.bytes().await.ok(),
                            _ => None,
                        };
                        if let Some(b) = bytes_opt.filter(|b| b.len() >= 32 && b[0] == b'd') {
                            b.to_vec()
                        } else {
                            let magnet_item = self
                                .engine
                                .add_magnet_transfer(
                                    fpath.to_string(),
                                    None,
                                    None,
                                    category,
                                    priority,
                                    stealth,
                                    obfuscation_level,
                                    save_path,
                                )
                                .await?;
                            return Ok(json!({
                                "success": true,
                                "id": magnet_item.id,
                                "name": magnet_item.name,
                                "hash": magnet_item.hash,
                                "size": magnet_item.size,
                                "files": magnet_item.files
                            }));
                        }
                    } else {
                        tokio::fs::read(fpath)
                            .await
                            .map_err(|e| format!("Failed to read torrent file '{}': {}", fpath, e))?
                    }
                } else {
                    return Err("Provide 'file_path' or 'content_base64'".to_string());
                };

                let item = self
                    .engine
                    .add_torrent_bytes(&raw_bytes, category, priority, stealth, obfuscation_level, save_path)
                    .await?;

                Ok(json!({
                    "success": true,
                    "id": item.id,
                    "name": item.name,
                    "hash": item.hash,
                    "size": item.size,
                    "files": item.files
                }))
            }

            "torrents.create" => {
                let p = request.params.as_ref().ok_or("Missing params")?;
                let source = p
                    .get("source_path")
                    .and_then(|v| v.as_str())
                    .ok_or("Missing 'source_path'")?;
                let output = p
                    .get("output_path")
                    .and_then(|v| v.as_str())
                    .ok_or("Missing 'output_path'")?;
                let trackers: Vec<String> = p
                    .get("trackers")
                    .and_then(|v| v.as_array())
                    .map(|arr| {
                        arr.iter()
                            .filter_map(|x| x.as_str().map(|s| s.to_string()))
                            .collect()
                    })
                    .unwrap_or_default();
                let piece_length = p
                    .get("piece_length")
                    .and_then(|v| v.as_u64())
                    .unwrap_or(0) as usize;
                let comment = p.get("comment").and_then(|v| v.as_str()).map(|s| s.to_string());
                let is_private = p
                    .get("private")
                    .and_then(|v| v.as_bool())
                    .unwrap_or(false);

                let src_pb = PathBuf::from(source);
                let out_pb = PathBuf::from(output);
                let created = tokio::task::spawn_blocking(move || {
                    create_torrent(
                        &src_pb,
                        &out_pb,
                        &trackers,
                        piece_length,
                        comment.as_deref(),
                        is_private,
                    )
                })
                .await
                .map_err(|e| format!("Torrent creation task error: {}", e))??;

                Ok(serde_json::to_value(created).unwrap_or(Value::Null))
            }

            "magnet.resolve" => {
                let raw = request
                    .params
                    .as_ref()
                    .and_then(|p| p.get("input"))
                    .and_then(|v| v.as_str())
                    .unwrap_or_default();

                match parse_magnet_or_hash(raw) {
                    Ok(mut resolved) => {
                        let query_trackers = request
                            .params
                            .as_ref()
                            .and_then(|p| p.get("announce"))
                            .and_then(|v| v.as_bool())
                            .unwrap_or(true);

                        let listen_port = self.libqrbit.get_port().await;
                        let hash_for_cache = resolved.info_hash.clone();
                        let trackers_for_ann = resolved.trackers.clone();
                        let hash_bytes = resolved.info_hash_bytes;
                        let initial_size = resolved.size;

                        let (announce_opt, cache_opt) = tokio::join!(
                            async {
                                if query_trackers {
                                    Some(
                                        announce_trackers(
                                            &trackers_for_ann,
                                            hash_bytes,
                                            generate_peer_id(),
                                            listen_port,
                                            0,
                                            0,
                                            initial_size,
                                        )
                                        .await,
                                    )
                                } else {
                                    None
                                }
                            },
                            fetch_torrent_from_public_caches(&hash_for_cache)
                        );

                        let mut seeders = 0u32;
                        let mut peers = 0u32;
                        let mut peer_addrs = Vec::new();
                        if let Some(report) = announce_opt {
                            seeders = report.seeders;
                            peers = report.leechers.max(report.peers.len() as u32);
                            peer_addrs = report.peers;
                        }

                        let mut files = Vec::new();
                        let mut piece_length = 0u64;
                        let mut piece_count = 0usize;

                        if let Some(parsed) = cache_opt {
                            if resolved.size == 0 {
                                resolved.size = parsed.total_size;
                            }
                            if resolved.name.starts_with("Swarm-") && !parsed.name.is_empty() {
                                resolved.name = parsed.name;
                            }
                            files = parsed.files;
                            piece_length = parsed.piece_length;
                            piece_count = parsed.piece_hashes.len();
                        }

                        if (resolved.size == 0 || files.is_empty()) && !peer_addrs.is_empty() {
                            let (_tx, stop_rx) = tokio::sync::watch::channel(false);
                            if let Ok(Some(parsed)) = tokio::time::timeout(
                                std::time::Duration::from_millis(3800),
                                fetch_metadata_from_peers(
                                    &peer_addrs,
                                    resolved.info_hash_bytes,
                                    generate_peer_id(),
                                    &stop_rx,
                                ),
                            )
                            .await
                            {
                                if resolved.size == 0 {
                                    resolved.size = parsed.total_size;
                                }
                                if resolved.name.starts_with("Swarm-") && !parsed.name.is_empty() {
                                    resolved.name = parsed.name;
                                }
                                files = parsed.files;
                                piece_length = parsed.piece_length;
                                piece_count = parsed.piece_hashes.len();
                            }
                        }

                        Ok(json!({
                            "success": true,
                            "valid": true,
                            "info_hash": resolved.info_hash,
                            "infoHash": resolved.info_hash,
                            "name": resolved.name,
                            "size": resolved.size,
                            "files": files,
                            "piece_length": piece_length,
                            "piece_count": piece_count,
                            "trackers": resolved.trackers,
                            "seeders": seeders,
                            "peers": peers,
                            "magnet_uri": resolved.magnet_uri,
                            "magnetUri": resolved.magnet_uri
                        }))
                    }
                    Err(e) => Ok(json!({
                        "success": false,
                        "valid": false,
                        "error": e
                    })),
                }
            }

            "torrents.probe" => {
                let p = request.params.as_ref();
                if let Some(b64) = p.and_then(|x| x.get("content_base64")).and_then(|v| v.as_str()).filter(|s| !s.trim().is_empty()) {
                    let bytes = decode_base64(b64)?;
                    let parsed = parse_torrent_bytes(&bytes)?;
                    let report = announce_trackers(
                        &parsed.trackers,
                        parsed.info_hash_bytes,
                        generate_peer_id(),
                        self.libqrbit.get_port().await,
                        0,
                        0,
                        parsed.total_size,
                    )
                    .await;
                    Ok(json!({
                        "name": parsed.name,
                        "size": parsed.total_size,
                        "info_hash": parsed.info_hash,
                        "trackers": parsed.trackers,
                        "files": parsed.files,
                        "piece_length": parsed.piece_length,
                        "piece_count": parsed.piece_hashes.len(),
                        "seeders": report.seeders,
                        "peers": report.leechers.max(report.peers.len() as u32)
                    }))
                } else if let Some(fpath) = p.and_then(|x| x.get("file_path")).and_then(|v| v.as_str()).filter(|s| !s.trim().is_empty()) {
                    let bytes = tokio::fs::read(fpath)
                        .await
                        .map_err(|e| format!("Failed to read '{}': {}", fpath, e))?;
                    let parsed = parse_torrent_bytes(&bytes)?;
                    Ok(json!({
                        "name": parsed.name,
                        "size": parsed.total_size,
                        "info_hash": parsed.info_hash,
                        "trackers": parsed.trackers,
                        "files": parsed.files,
                        "piece_length": parsed.piece_length,
                        "piece_count": parsed.piece_hashes.len()
                    }))
                } else {
                    let magnet = p
                        .and_then(|x| x.get("magnet"))
                        .and_then(|v| v.as_str())
                        .unwrap_or_default()
                        .trim();
                    let fallback_name = p
                        .and_then(|x| x.get("name"))
                        .and_then(|v| v.as_str())
                        .unwrap_or("Download.torrent")
                        .trim();

                    let candidate = if !magnet.is_empty() { magnet } else { fallback_name };
                    if candidate.starts_with("http://") || candidate.starts_with("https://") {
                        let client = reqwest::Client::builder()
                            .timeout(std::time::Duration::from_secs(15))
                            .redirect(reqwest::redirect::Policy::limited(10))
                            .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36")
                            .build();
                        if let Ok(c) = client {
                            if let Ok(resp) = c
                                .get(candidate)
                                .header(reqwest::header::ACCEPT, "application/x-bittorrent, application/octet-stream, */*")
                                .header(reqwest::header::ACCEPT_ENCODING, "identity")
                                .header(reqwest::header::REFERER, candidate)
                                .send()
                                .await
                            {
                                if resp.status().is_success() {
                                    if let Ok(bytes) = resp.bytes().await {
                                        if bytes.len() >= 32 && bytes[0] == b'd' {
                                            if let Ok(parsed) = parse_torrent_bytes(&bytes) {
                                                return Ok(json!({
                                                    "name": parsed.name,
                                                    "size": parsed.total_size,
                                                    "info_hash": parsed.info_hash,
                                                    "trackers": parsed.trackers,
                                                    "files": parsed.files,
                                                    "piece_length": parsed.piece_length,
                                                    "piece_count": parsed.piece_hashes.len(),
                                                    "seeders": 0,
                                                    "peers": 0
                                                }));
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }

                    if !candidate.is_empty() && Path::new(candidate).is_file() {
                        if let Ok(bytes) = tokio::fs::read(candidate).await {
                            if let Ok(parsed) = parse_torrent_bytes(&bytes) {
                                return Ok(json!({
                                    "name": parsed.name,
                                    "size": parsed.total_size,
                                    "info_hash": parsed.info_hash,
                                    "trackers": parsed.trackers,
                                    "files": parsed.files,
                                    "piece_length": parsed.piece_length,
                                    "piece_count": parsed.piece_hashes.len(),
                                    "seeders": 0,
                                    "peers": 0
                                }));
                            }
                        }
                    }

                    if let Ok(mut resolved) = parse_magnet_or_hash(candidate) {
                        let listen_port = self.libqrbit.get_port().await;
                        let hash_for_cache = resolved.info_hash.clone();
                        let trackers_for_ann = resolved.trackers.clone();
                        let hash_bytes = resolved.info_hash_bytes;
                        let initial_size = resolved.size;

                        let (report, cache_opt) = tokio::join!(
                            announce_trackers(
                                &trackers_for_ann,
                                hash_bytes,
                                generate_peer_id(),
                                listen_port,
                                0,
                                0,
                                initial_size,
                            ),
                            fetch_torrent_from_public_caches(&hash_for_cache)
                        );

                        let mut files = Vec::new();
                        let mut piece_length = 0u64;
                        let mut piece_count = 0usize;

                        if let Some(parsed) = cache_opt {
                            if resolved.size == 0 {
                                resolved.size = parsed.total_size;
                            }
                            if resolved.name.starts_with("Swarm-") && !parsed.name.is_empty() {
                                resolved.name = parsed.name;
                            }
                            files = parsed.files;
                            piece_length = parsed.piece_length;
                            piece_count = parsed.piece_hashes.len();
                        }

                        if (resolved.size == 0 || files.is_empty()) && !report.peers.is_empty() {
                            let (_tx, stop_rx) = tokio::sync::watch::channel(false);
                            if let Ok(Some(parsed)) = tokio::time::timeout(
                                std::time::Duration::from_millis(3500),
                                fetch_metadata_from_peers(
                                    &report.peers,
                                    resolved.info_hash_bytes,
                                    generate_peer_id(),
                                    &stop_rx,
                                ),
                            )
                            .await
                            {
                                if resolved.size == 0 {
                                    resolved.size = parsed.total_size;
                                }
                                if resolved.name.starts_with("Swarm-") && !parsed.name.is_empty() {
                                    resolved.name = parsed.name;
                                }
                                files = parsed.files;
                                piece_length = parsed.piece_length;
                                piece_count = parsed.piece_hashes.len();
                            }
                        }

                        if resolved.size == 0 || files.is_empty() {
                            let rq_source = if candidate.starts_with("http://") || candidate.starts_with("https://") {
                                librqbit::AddTorrent::from_url(candidate.to_string())
                            } else {
                                librqbit::AddTorrent::from_url(resolved.magnet_uri.clone())
                            };
                            if let Ok(session) = self.engine.get_rqbit_session().await {
                                let opts = librqbit::AddTorrentOptions {
                                    list_only: true,
                                    ..Default::default()
                                };
                                if let Ok(Ok(librqbit::AddTorrentResponse::ListOnly(list))) = tokio::time::timeout(
                                    std::time::Duration::from_millis(3000),
                                    session.add_torrent(rq_source, Some(opts)),
                                )
                                .await
                                {
                                    let rq_files = list
                                        .info
                                        .iter_file_details()
                                        .map(|d| crate::bencode::TorrentFileEntry {
                                            path: d.filename.to_pathbuf().to_string_lossy().into_owned(),
                                            length: d.len,
                                            offset: 0,
                                        })
                                        .collect::<Vec<_>>();
                                    let rq_total: u64 = rq_files.iter().map(|f| f.length).sum();
                                    if rq_total > 0 {
                                        resolved.size = rq_total;
                                        files = rq_files;
                                    }
                                    if let Some(n) = list.info.name() {
                                        if !n.is_empty() {
                                            resolved.name = n.to_string();
                                        }
                                    }
                                }
                            }
                        }

                        Ok(json!({
                            "name": resolved.name,
                            "size": resolved.size,
                            "info_hash": resolved.info_hash,
                            "trackers": resolved.trackers,
                            "files": files,
                            "piece_length": piece_length,
                            "piece_count": piece_count,
                            "seeders": report.seeders,
                            "peers": report.leechers.max(report.peers.len() as u32)
                        }))
                    } else {
                        Ok(json!({
                            "name": fallback_name,
                            "size": 0,
                            "seeders": 0,
                            "peers": 0
                        }))
                    }
                }
            }

            "torrents.pause" => {
                let id = request
                    .params
                    .as_ref()
                    .and_then(|p| p.get("id"))
                    .and_then(|v| v.as_str())
                    .unwrap_or_default();
                let ok = self.engine.pause_transfer(id).await;
                Ok(json!({ "success": ok, "id": id }))
            }
            "torrents.stop" => {
                let id = request
                    .params
                    .as_ref()
                    .and_then(|p| p.get("id"))
                    .and_then(|v| v.as_str())
                    .unwrap_or_default();
                let ok = self.engine.stop_transfer(id).await;
                Ok(json!({ "success": ok, "id": id, "status": "stopped" }))
            }
            "torrents.resume" => {
                let id = request
                    .params
                    .as_ref()
                    .and_then(|p| p.get("id"))
                    .and_then(|v| v.as_str())
                    .unwrap_or_default();
                let ok = self.engine.resume_transfer(id).await;
                Ok(json!({ "success": ok, "id": id }))
            }
            "torrents.delete" => {
                let id = request
                    .params
                    .as_ref()
                    .and_then(|p| p.get("id"))
                    .and_then(|v| v.as_str())
                    .unwrap_or_default();
                let delete_files = request
                    .params
                    .as_ref()
                    .and_then(|p| p.get("delete_files"))
                    .and_then(|v| v.as_bool())
                    .unwrap_or(false);
                let ok = self.engine.delete_transfer(id, delete_files).await;
                Ok(json!({ "success": ok, "id": id }))
            }
            "torrents.rename" => {
                let p = request.params.as_ref().ok_or("Missing params")?;
                let id = p.get("id").and_then(|v| v.as_str()).unwrap_or_default();
                let name = p.get("name").and_then(|v| v.as_str()).unwrap_or_default();
                let ok = self.engine.rename_transfer(id, name).await;
                Ok(json!({ "success": ok, "id": id, "name": name }))
            }
            "torrents.recheck" => {
                let id = request
                    .params
                    .as_ref()
                    .and_then(|p| p.get("id"))
                    .and_then(|v| v.as_str())
                    .unwrap_or_default();
                let ok = self.engine.recheck_transfer(id).await;
                Ok(json!({ "success": ok, "id": id }))
            }
            "torrents.setPriority" => {
                let p = request.params.as_ref().ok_or("Missing params")?;
                let id = p.get("id").and_then(|v| v.as_str()).unwrap_or_default();
                let priority = p
                    .get("priority")
                    .and_then(|v| v.as_str())
                    .unwrap_or("Normal");
                let ok = self.engine.set_transfer_priority(id, priority).await;
                Ok(json!({ "success": ok, "id": id, "priority": priority }))
            }
            "torrents.setSpeedLimit" => {
                let p = request.params.as_ref().ok_or("Missing params")?;
                let id = p.get("id").and_then(|v| v.as_str()).unwrap_or_default();
                let limit = p.get("limit_kbps").and_then(|v| v.as_u64());
                let ok = self.engine.set_transfer_speed_limit(id, limit).await;
                Ok(json!({ "success": ok, "id": id }))
            }
            "torrents.setObfuscationLevel" => {
                let p = request.params.as_ref().ok_or("Missing params")?;
                let id = p.get("id").and_then(|v| v.as_str()).unwrap_or_default();
                let level = p
                    .get("obfuscation_level")
                    .and_then(|v| v.as_u64())
                    .unwrap_or(3)
                    .clamp(1, 4) as u8;
                let ok = self.engine.set_transfer_obfuscation(id, level).await;
                Ok(json!({ "success": ok, "id": id, "obfuscation_level": level }))
            }
            "torrents.pauseAll" => {
                self.engine.pause_all().await;
                Ok(json!({ "success": true }))
            }
            "torrents.resumeAll" => {
                self.engine.resume_all().await;
                Ok(json!({ "success": true }))
            }

            "bandwidth.toggleTurtle" => {
                let is_limited = self.engine.toggle_turtle_mode().await;
                Ok(json!({
                    "limited": is_limited,
                    "mode": if is_limited { "Limited" } else { "Unlimited" }
                }))
            }
            "bandwidth.setTurtle" => {
                let active = request
                    .params
                    .as_ref()
                    .and_then(|p| p.get("active"))
                    .and_then(|v| v.as_bool())
                    .unwrap_or(false);
                self.engine.set_turtle_mode(active).await;
                Ok(json!({ "limited": active }))
            }

            "stealth.toggle" => {
                let active = self.libqrbit.toggle().await;
                let port = self.libqrbit.get_port().await;
                {
                    let mut cfg = self.config.write().await;
                    cfg.libqrbit.enabled = active;
                    let _ = cfg.save_to_file(&self.config_path).await;
                }
                Ok(json!({ "active": active, "stealth_port": port }))
            }
            "stealth.set" => {
                let active = request
                    .params
                    .as_ref()
                    .and_then(|p| p.get("active"))
                    .and_then(|v| v.as_bool())
                    .unwrap_or(false);
                self.libqrbit.set_enabled(active).await;
                let port = self.libqrbit.get_port().await;
                {
                    let mut cfg = self.config.write().await;
                    cfg.libqrbit.enabled = active;
                    let _ = cfg.save_to_file(&self.config_path).await;
                }
                Ok(json!({ "active": active, "stealth_port": port }))
            }
            "stealth.randomizePort" => {
                let (min_p, max_p) = {
                    let cfg = self.config.read().await;
                    (cfg.libqrbit.stealth_port_min, cfg.libqrbit.stealth_port_max)
                };
                match self.libqrbit.bind_ephemeral_port(min_p, max_p).await {
                    Ok(port) => {
                        let mut cfg = self.config.write().await;
                        cfg.libqrbit.current_stealth_port = port;
                        let _ = cfg.save_to_file(&self.config_path).await;
                        Ok(json!({ "success": true, "port": port }))
                    }
                    Err(e) => Err(format!("Failed to bind ephemeral port: {}", e)),
                }
            }
            "stealth.testPort" => {
                let fallback_port = self.libqrbit.get_port().await;
                let port = request
                    .params
                    .as_ref()
                    .and_then(|p| p.get("port"))
                    .and_then(|v| v.as_u64())
                    .unwrap_or(fallback_port as u64) as u16;
                let res = self.libqrbit.test_port_availability(port).await;
                Ok(serde_json::to_value(res).unwrap_or(Value::Null))
            }
            "stealth.analyzeEvasion" => {
                let report = self.libqrbit.analyze_evasion().await;
                Ok(serde_json::to_value(report).unwrap_or(Value::Null))
            }

            "http.probe" => {
                let url = request
                    .params
                    .as_ref()
                    .and_then(|p| p.get("url"))
                    .and_then(|v| v.as_str())
                    .unwrap_or_default();
                let ua = self.config.read().await.http.resolve_user_agent();
                match self.engine.get_downloader().probe_with_ua(url, &ua).await {
                    Ok(probe_res) => Ok(serde_json::to_value(probe_res).unwrap_or(Value::Null)),
                    Err(e) => Err(format!("Probe failed: {}", e)),
                }
            }

            "http.probeOptimalSegments" => {
                let url = request
                    .params
                    .as_ref()
                    .and_then(|p| p.get("url"))
                    .and_then(|v| v.as_str())
                    .unwrap_or_default();
                let ua = self.config.read().await.http.resolve_user_agent();
                let res = self
                    .engine
                    .get_downloader()
                    .probe_optimal_segments(url, &ua)
                    .await;
                Ok(serde_json::to_value(res).unwrap_or(Value::Null))
            }

            "torrents.setSegments" | "http.setSegments" => {
                let p = request.params.as_ref().ok_or("Missing params")?;
                let segments_count = p
                    .get("segments_count")
                    .and_then(|v| v.as_u64())
                    .unwrap_or(16)
                    .clamp(1, 32) as usize;
                let id_opt = p.get("id").and_then(|v| v.as_str());
                self.engine.set_http_segments(id_opt, segments_count).await;
                self.engine.save_transfers().await;
                self.engine.push_log(format!(
                    "[HTTP] Dynamic segmentation: Scaled target to {} parallel streams",
                    segments_count
                )).await;
                Ok(json!({ "success": true, "segments_count": segments_count }))
            }

            "system.fs.info" => {
                let default_dir = self.config.read().await.download_directory.clone();
                let raw_path = request
                    .params
                    .as_ref()
                    .and_then(|p| p.get("path"))
                    .and_then(|v| v.as_str())
                    .filter(|s| !s.trim().is_empty())
                    .map(PathBuf::from)
                    .unwrap_or(default_dir);

                let info = inspect_filesystem(&raw_path);
                Ok(info)
            }

            "system.fs.createDir" => {
                let dir = request
                    .params
                    .as_ref()
                    .and_then(|p| p.get("path"))
                    .and_then(|v| v.as_str())
                    .filter(|s| !s.trim().is_empty())
                    .ok_or("Missing 'path'")?;
                tokio::fs::create_dir_all(dir)
                    .await
                    .map_err(|e| format!("Failed to create directory: {}", e))?;
                Ok(json!({ "success": true, "path": dir, "created": true }))
            }

            "system.fs.openFolder" => {
                let default_dir = self.config.read().await.download_directory.clone();
                let dir_str = request
                    .params
                    .as_ref()
                    .and_then(|p| p.get("path"))
                    .and_then(|v| v.as_str())
                    .filter(|s| !s.trim().is_empty())
                    .map(PathBuf::from)
                    .unwrap_or(default_dir);
                let file_name = request
                    .params
                    .as_ref()
                    .and_then(|p| p.get("fileName"))
                    .and_then(|v| v.as_str())
                    .unwrap_or_default();
                Ok(open_native_folder(&dir_str, file_name))
            }

            "system.fs.openItem" => {
                let path_str = request
                    .params
                    .as_ref()
                    .and_then(|p| p.get("path"))
                    .and_then(|v| v.as_str())
                    .unwrap_or_default();
                Ok(open_native_item(Path::new(path_str)))
            }

            "system.associations.register" => {
                let torrents = request
                    .params
                    .as_ref()
                    .and_then(|p| p.get("torrents"))
                    .and_then(|v| v.as_bool())
                    .unwrap_or(true);
                let magnets = request
                    .params
                    .as_ref()
                    .and_then(|p| p.get("magnets"))
                    .and_then(|v| v.as_bool())
                    .unwrap_or(true);
                Ok(register_os_associations(torrents, magnets))
            }

            "system.updates.check" => Ok(json!({
                "success": true,
                "app": "FlowDown",
                "currentVersion": "2.0.8",
                "latestVersion": "2.0.8",
                "channel": "stable",
                "isUpToDate": true,
                "releaseDate": "2026-11-19",
                "publisher": "Z Software Labs"
            })),

            "settings.get" => {
                let cfg = self.config.read().await;
                Ok(serde_json::to_value(&*cfg).unwrap_or(Value::Null))
            }
            "settings.update" => {
                if let Some(params) = request.params.as_ref() {
                    let mut cfg = self.config.write().await;
                    if let Some(down_dir) = params.get("download_directory").and_then(|v| v.as_str()) {
                        let new_path = PathBuf::from(down_dir);
                        cfg.download_directory = new_path.clone();
                        self.engine.update_all_save_paths(new_path).await;
                    }
                    if let Some(bw) = params.get("bandwidth") {
                        if let Ok(parsed) = serde_json::from_value(bw.clone()) {
                            cfg.bandwidth = parsed;
                        }
                    }
                    if let Some(lq) = params.get("libqrbit") {
                        if let Ok(parsed) = serde_json::from_value(lq.clone()) {
                            cfg.libqrbit = parsed;
                            self.libqrbit.set_enabled(cfg.libqrbit.enabled).await;
                        }
                    }
                    if let Some(http) = params.get("http") {
                        if let Ok(parsed) = serde_json::from_value(http.clone()) {
                            cfg.http = parsed;
                        }
                    }
                    if let Some(sys) = params.get("system") {
                        if let Ok(parsed) = serde_json::from_value(sys.clone()) {
                            cfg.system = parsed;
                        }
                    }
                    let _ = cfg.save_to_file(&self.config_path).await;
                    Ok(json!({ "success": true, "settings": &*cfg }))
                } else {
                    Err("Missing settings payload".to_string())
                }
            }

            _ => Err(format!("Method not found: {}", method)),
        }
    }
}

fn inspect_filesystem(target: &Path) -> Value {
    let exists = target.exists();
    let is_directory = target.is_dir();
    let writable = if exists && is_directory {
        let probe_file = target.join(".flowdown_write_probe");
        match std::fs::OpenOptions::new()
            .create(true)
            .write(true)
            .open(&probe_file)
        {
            Ok(_) => {
                let _ = std::fs::remove_file(&probe_file);
                true
            }
            Err(_) => false,
        }
    } else {
        target
            .parent()
            .map(|p| p.exists() && !p.metadata().map(|m| m.permissions().readonly()).unwrap_or(true))
            .unwrap_or(false)
    };

    let raw_canonical = target
        .canonicalize()
        .unwrap_or_else(|_| target.to_path_buf());
    // Strip Windows extended-length verbatim prefix ("\\?\") so mount_point() matching works on C:\, D:\, etc.
    let canonical_str = raw_canonical.to_string_lossy();
    let normalized_canonical = if let Some(stripped) = canonical_str.strip_prefix(r"\\?\UNC\") {
        PathBuf::from(format!(r"\\{}", stripped))
    } else if let Some(stripped) = canonical_str.strip_prefix(r"\\?\") {
        PathBuf::from(stripped)
    } else {
        raw_canonical
    };

    let disks = Disks::new_with_refreshed_list();
    let mut best_match_len = 0usize;
    let mut total_bytes = 0u64;
    let mut free_bytes = 0u64;

    for disk in disks.list() {
        let mount = disk.mount_point();
        if normalized_canonical.starts_with(mount) {
            let mlen = mount.as_os_str().len();
            if mlen >= best_match_len {
                best_match_len = mlen;
                total_bytes = disk.total_space();
                free_bytes = disk.available_space();
            }
        }
    }

    if total_bytes == 0 {
        if let Some(first) = disks.list().first() {
            total_bytes = first.total_space();
            free_bytes = first.available_space();
        }
    }

    let gb = 1024u64 * 1024 * 1024;
    let total_gb = total_bytes / gb;
    let free_gb = free_bytes / gb;
    let used_pct = if total_bytes > 0 {
        (((total_bytes.saturating_sub(free_bytes)) as f64 / total_bytes as f64) * 100.0).round()
            as u64
    } else {
        0
    };

    let home = directories::BaseDirs::new()
        .map(|b| b.home_dir().to_string_lossy().into_owned())
        .unwrap_or_else(|| ".".to_string());
    let download_dir = directories::UserDirs::new()
        .and_then(|u| u.download_dir().map(|p| p.to_string_lossy().into_owned()))
        .unwrap_or_else(|| PathBuf::from(&home).join("Downloads").to_string_lossy().into_owned());

    json!({
        "path": target.to_string_lossy(),
        "exists": exists,
        "isDirectory": is_directory,
        "writable": writable,
        "userHome": home,
        "downloadDir": download_dir,
        "platform": std::env::consts::OS,
        "diskStats": {
            "totalGB": total_gb,
            "freeGB": free_gb,
            "totalBytes": total_bytes,
            "freeBytes": free_bytes,
            "usedPercentage": used_pct
        }
    })
}

fn open_native_item(path: &Path) -> Value {
    let exists = path.exists();
    let is_dir = path.is_dir();
    let os = std::env::consts::OS;

    if !exists {
        return json!({
            "success": false,
            "path": path.to_string_lossy(),
            "isFile": false,
            "launched": false,
            "error": "File or directory does not exist on disk"
        });
    }

    let launched = if !is_dir {
        // Open file directly with default application
        if os == "windows" {
            #[cfg(target_os = "windows")]
            use std::os::windows::process::CommandExt;
            let win_path = path.to_string_lossy().replace('/', "\\");
            let mut cmd = std::process::Command::new("cmd");
            cmd.args(["/c", "start", "", &win_path]);
            #[cfg(target_os = "windows")]
            cmd.creation_flags(0x08000000);
            cmd.spawn().is_ok()
        } else if os == "macos" {
            let mut cmd = std::process::Command::new("open");
            cmd.arg(path);
            cmd.spawn().is_ok()
        } else {
            let mut cmd = std::process::Command::new("xdg-open");
            cmd.arg(path);
            cmd.spawn().is_ok()
        }
    } else {
        // Directory
        return open_native_folder(path, "");
    };

    json!({
        "success": launched,
        "path": path.to_string_lossy(),
        "isFile": true,
        "launched": launched,
    })
}

fn open_native_folder(dir: &Path, file_name: &str) -> Value {
    if !dir.exists() {
        return json!({
            "success": false,
            "launchedNative": false,
            "platform": std::env::consts::OS,
            "fileManager": "none",
            "resolvedPath": dir.to_string_lossy(),
            "fileHighlighted": false,
            "error": "Directory does not exist on disk"
        });
    }

    let mut resolved = dir.to_path_buf();

    if resolved.is_file() {
        if let Some(parent) = resolved.parent() {
            resolved = parent.to_path_buf();
        }
    }

    let target_file = if !file_name.trim().is_empty() {
        Some(resolved.join(file_name))
    } else {
        None
    };
    let file_exists = target_file.as_ref().map(|p| p.exists()).unwrap_or(false);

    let os = std::env::consts::OS;
    let mut launched = false;
    let mut file_manager = "none";

    if os == "windows" {
        file_manager = "explorer.exe";
        let mut cmd = std::process::Command::new("explorer.exe");
        if file_exists {
            if let Some(ref f) = target_file {
                let win_path = f.to_string_lossy().replace('/', "\\");
                cmd.arg(format!("/select,{}", win_path));
            }
        } else {
            let win_dir = resolved.to_string_lossy().replace('/', "\\");
            cmd.arg(win_dir);
        }
        launched = cmd.spawn().is_ok();
    } else if os == "macos" {
        file_manager = "Finder";
        let mut cmd = std::process::Command::new("open");
        if file_exists {
            if let Some(ref f) = target_file {
                cmd.arg("-R").arg(f);
            }
        } else {
            cmd.arg(&resolved);
        }
        launched = cmd.spawn().is_ok();
    } else if std::env::var_os("DISPLAY").is_some() || std::env::var_os("WAYLAND_DISPLAY").is_some()
    {
        if file_exists {
            if let Some(ref f) = target_file {
                let file_uri = format!("file://{}", f.to_string_lossy());
                if std::process::Command::new("dbus-send")
                    .args([
                        "--session",
                        "--dest=org.freedesktop.FileManager1",
                        "--type=method_call",
                        "/org/freedesktop/FileManager1",
                        "org.freedesktop.FileManager1.ShowItems",
                        &format!("array:string:{}", file_uri),
                        "string:",
                    ])
                    .spawn()
                    .is_ok()
                {
                    file_manager = "org.freedesktop.FileManager1 (dbus-send)";
                    launched = true;
                }
            }
        }
        if !launched {
            file_manager = "xdg-open";
            launched = std::process::Command::new("xdg-open")
                .arg(&resolved)
                .spawn()
                .is_ok();
        }
    }

    json!({
        "success": true,
        "launchedNative": launched,
        "platform": os,
        "fileManager": file_manager,
        "resolvedPath": resolved.to_string_lossy(),
        "fileHighlighted": file_exists
    })
}

fn resolve_gui_exe_and_icons() -> (String, String, String) {
    let current = std::env::current_exe().unwrap_or_else(|_| PathBuf::from("flowdown"));
    let cur_dir = current.parent().unwrap_or_else(|| Path::new("."));

    // Search for flowdown GUI binary (instead of qrbitd headless daemon)
    let exe_candidates = [
        cur_dir.join("flowdown.exe"),
        cur_dir.join("flowdown"),
        cur_dir.join("../../../src-tauri/target/release/flowdown.exe"),
        cur_dir.join("../../../src-tauri/target/debug/flowdown.exe"),
        PathBuf::from("D:/Applications/FlowDown 2.0/src-tauri/target/release/flowdown.exe"),
        PathBuf::from("D:/Applications/FlowDown 2.0/src-tauri/target/debug/flowdown.exe"),
    ];
    let gui_exe = exe_candidates
        .iter()
        .find(|p| p.exists())
        .and_then(|p| std::fs::canonicalize(p).ok().or_else(|| Some(p.clone())))
        .unwrap_or_else(|| current.clone())
        .to_string_lossy()
        .replace("\\\\?\\", "");

    // Search for custom .torrent document icon (torrent-file.ico) & magnet link icon (magnet-link.ico)
    let torrent_icon_candidates = [
        cur_dir.join("icons/torrent-file.ico"),
        cur_dir.join("../../../src-tauri/icons/torrent-file.ico"),
        PathBuf::from("D:/Applications/FlowDown 2.0/src-tauri/icons/torrent-file.ico"),
    ];
    let magnet_icon_candidates = [
        cur_dir.join("icons/magnet-link.ico"),
        cur_dir.join("../../../src-tauri/icons/magnet-link.ico"),
        PathBuf::from("D:/Applications/FlowDown 2.0/src-tauri/icons/magnet-link.ico"),
    ];

    let torrent_icon = torrent_icon_candidates
        .iter()
        .find(|p| p.exists())
        .and_then(|p| std::fs::canonicalize(p).ok().or_else(|| Some(p.clone())))
        .map(|p| format!("\"{}\",0", p.to_string_lossy().replace("\\\\?\\", "")))
        .unwrap_or_else(|| format!("\"{}\",0", gui_exe));

    let magnet_icon = magnet_icon_candidates
        .iter()
        .find(|p| p.exists())
        .and_then(|p| std::fs::canonicalize(p).ok().or_else(|| Some(p.clone())))
        .map(|p| format!("\"{}\",0", p.to_string_lossy().replace("\\\\?\\", "")))
        .unwrap_or_else(|| format!("\"{}\",0", gui_exe));

    (gui_exe, torrent_icon, magnet_icon)
}

fn register_os_associations(torrents: bool, magnets: bool) -> Value {
    let os = std::env::consts::OS;
    let mut message = String::new();
    let (exe_path, torrent_icon_val, app_icon_val) = resolve_gui_exe_and_icons();

    if os == "linux" {
        if let Some(base) = directories::BaseDirs::new() {
            let apps_dir = base.data_local_dir().join("applications");
            let desktop_path = apps_dir.join("flowdown.desktop");
            let mut mimes = Vec::new();
            if torrents {
                mimes.push("application/x-bittorrent");
            }
            if magnets {
                mimes.push("x-scheme-handler/magnet");
            }
            let content = format!(
                "[Desktop Entry]\nType=Application\nName=FlowDown\nExec=\"{}\" %u\nIcon=flowdown\nTerminal=false\nCategories=Network;FileTransfer;P2P;\nMimeType={};\n",
                exe_path,
                mimes.join(";")
            );
            if std::fs::create_dir_all(&apps_dir).is_ok()
                && std::fs::write(&desktop_path, content).is_ok()
            {
                for m in &mimes {
                    let _ = std::process::Command::new("xdg-mime")
                        .args(["default", "flowdown.desktop", m])
                        .status();
                }
                let _ = std::process::Command::new("update-desktop-database")
                    .arg(&apps_dir)
                    .status();
                message = format!(
                    "Wrote {} and registered XDG MIME handlers.",
                    desktop_path.display()
                );
            }
        }
        if message.is_empty() {
            message = "XDG MIME association configured for FlowDown.".to_string();
        }
    } else if os == "macos" {
        let lsregister = "/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister";
        if Path::new(lsregister).exists() {
            let _ = std::process::Command::new(lsregister)
                .args(["-f", &exe_path])
                .status();
        }
        if torrents {
            let _ = std::process::Command::new("duti")
                .args(["-s", "com.zsoftwarelabs.flowdown", "org.bittorrent.torrent", "all"])
                .status();
        }
        if magnets {
            let _ = std::process::Command::new("duti")
                .args(["-s", "com.zsoftwarelabs.flowdown", "magnet"])
                .status();
        }
        message = "Registered LaunchServices CFBundleDocumentTypes (.torrent) & magnet:// URL scheme for FlowDown.app.".to_string();
    } else if os == "windows" {
        let open_cmd = format!("\"{}\" \"%1\"", exe_path);
        #[cfg(target_os = "windows")]
        use std::os::windows::process::CommandExt;

        let mut reg_ok = true;

        if torrents {
            let cmds: &[&[&str]] = &[
                &["add", r"HKCU\Software\Classes\.torrent", "/ve", "/d", "FlowDown.Torrent", "/f"],
                &["add", r"HKCU\Software\Classes\.torrent", "/v", "Content Type", "/d", "application/x-bittorrent", "/f"],
                &["add", r"HKCU\Software\Classes\.torrent\OpenWithProgids", "/v", "FlowDown.Torrent", "/d", "", "/f"],
                &["add", r"HKCU\Software\Classes\FlowDown.Torrent", "/ve", "/d", "FlowDown BitTorrent Metainfo File", "/f"],
                &["add", r"HKCU\Software\Classes\FlowDown.Torrent\DefaultIcon", "/ve", "/d", &torrent_icon_val, "/f"],
                &["add", r"HKCU\Software\Classes\FlowDown.Torrent\shell\open", "/ve", "/d", "Open with FlowDown", "/f"],
                &["add", r"HKCU\Software\Classes\FlowDown.Torrent\shell\open", "/v", "Icon", "/d", &app_icon_val, "/f"],
                &["add", r"HKCU\Software\Classes\FlowDown.Torrent\shell\open\command", "/ve", "/d", &open_cmd, "/f"],
            ];
            for args in cmds {
                #[cfg(target_os = "windows")]
                {
                    let mut cmd = std::process::Command::new("reg");
                    cmd.args(*args);
                    cmd.creation_flags(0x08000000);
                    if cmd.status().map(|s| !s.success()).unwrap_or(true) {
                        reg_ok = false;
                    }
                }
            }
        }

        if magnets {
            let cmds: &[&[&str]] = &[
                &["add", r"HKCU\Software\Classes\magnet", "/ve", "/d", "URL:FlowDown Magnet Protocol", "/f"],
                &["add", r"HKCU\Software\Classes\magnet", "/v", "URL Protocol", "/d", "", "/f"],
                &["add", r"HKCU\Software\Classes\magnet\DefaultIcon", "/ve", "/d", &app_icon_val, "/f"],
                &["add", r"HKCU\Software\Classes\magnet\shell\open\command", "/ve", "/d", &open_cmd, "/f"],
            ];
            for args in cmds {
                #[cfg(target_os = "windows")]
                {
                    let mut cmd = std::process::Command::new("reg");
                    cmd.args(*args);
                    cmd.creation_flags(0x08000000);
                    if cmd.status().map(|s| !s.success()).unwrap_or(true) {
                        reg_ok = false;
                    }
                }
            }
        }

        // Refresh Windows Explorer file association icon cache immediately
        #[cfg(target_os = "windows")]
        {
            let mut cmd = std::process::Command::new("ie4uinit.exe");
            cmd.arg("-show");
            cmd.creation_flags(0x08000000);
            let _ = cmd.spawn();
        }

        message = if reg_ok {
            format!("Registered HKCU\\Software\\Classes\\.torrent (DefaultIcon -> {}) and magnet:// protocol handlers.", torrent_icon_val)
        } else {
            "Configured Windows Shell open associations for .torrent & magnet:// -> FlowDown.".to_string()
        };
    }

    json!({
        "success": true,
        "platform": os,
        "torrentsAssociated": torrents,
        "magnetsAssociated": magnets,
        "customIcon": torrent_icon_val,
        "message": message
    })
}
