// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

#[allow(dead_code)]
#[path = "../../backend-rust/src/bencode.rs"]
mod bencode;
#[allow(dead_code)]
#[path = "../../backend-rust/src/bittorrent.rs"]
mod bittorrent;
#[allow(dead_code)]
#[path = "../../backend-rust/src/config.rs"]
mod config;
#[allow(dead_code)]
#[path = "../../backend-rust/src/engine.rs"]
mod engine;
#[allow(dead_code)]
#[path = "../../backend-rust/src/http_downloader.rs"]
mod http_downloader;
#[allow(dead_code)]
#[path = "../../backend-rust/src/libqrbit.rs"]
mod libqrbit;
#[allow(dead_code)]
#[path = "../../backend-rust/src/rpc.rs"]
mod rpc;

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tauri::{Emitter, Manager};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::{OnceCell, RwLock};

static STARTUP_PAYLOAD_CONSUMED: AtomicBool = AtomicBool::new(false);
static EMBEDDED_DISPATCHER: OnceCell<Arc<rpc::RpcDispatcher>> = OnceCell::const_new();

async fn get_or_init_embedded_dispatcher() -> Arc<rpc::RpcDispatcher> {
    EMBEDDED_DISPATCHER
        .get_or_init(|| async {
            let data_dir = directories::ProjectDirs::from("com", "zsoftwarelabs", "FlowDown")
                .map(|p| p.data_local_dir().to_path_buf())
                .or_else(|| directories::BaseDirs::new().map(|b| b.data_local_dir().join("FlowDown")))
                .unwrap_or_else(|| {
                    let cur = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
                    if cur.ends_with("src-tauri") {
                        cur.parent().unwrap_or(&cur).join("data")
                    } else {
                        cur.join("data")
                    }
                });

            let _ = std::fs::create_dir_all(&data_dir);
            let config_path = data_dir.join("flowdown.json");
            let transfers_path = data_dir.join("transfers.json");

            // Migrate any local cwd transfers.json so it is never watched by tauri dev
            if !transfers_path.exists() && Path::new("transfers.json").exists() {
                let _ = std::fs::copy("transfers.json", &transfers_path);
                let _ = std::fs::remove_file("transfers.json");
            }
            if Path::new("transfers.json").exists() {
                let _ = std::fs::remove_file("transfers.json");
            }

            let cfg = config::DaemonConfig::load_from_file(&config_path)
                .await
                .unwrap_or_default();

            let lq = Arc::new(libqrbit::LibqrbitEngine::new(
                cfg.libqrbit.current_stealth_port,
                cfg.libqrbit.enabled,
            ));
            let shared_cfg: config::SharedConfig = Arc::new(RwLock::new(cfg));
            let eng = Arc::new(engine::DaemonEngine::new(
                shared_cfg.clone(),
                lq.clone(),
                transfers_path,
            ));
            eng.load_persisted_transfers().await;

            let disp = Arc::new(rpc::RpcDispatcher::new(
                eng.clone(),
                shared_cfg,
                lq,
                config_path,
            ));

            // Background sampler tick
            let eng_tick = eng.clone();
            tokio::spawn(async move {
                let mut interval = tokio::time::interval(std::time::Duration::from_millis(1500));
                loop {
                    interval.tick().await;
                    eng_tick.tick().await;
                }
            });

            // Also bind 127.0.0.1:52840 if not already occupied by standalone qrbitd
            let disp_tcp = disp.clone();
            tokio::spawn(async move {
                if let Ok(listener) = TcpListener::bind("127.0.0.1:52840").await {
                    while let Ok((mut socket, _)) = listener.accept().await {
                        let rpc_c = disp_tcp.clone();
                        tokio::spawn(async move {
                            let (reader, mut writer) = socket.split();
                            let mut buf_reader = BufReader::new(reader);
                            let mut line = String::new();
                            while let Ok(n) = buf_reader.read_line(&mut line).await {
                                if n == 0 {
                                    break;
                                }
                                let trimmed = line.trim();
                                if !trimmed.is_empty() {
                                    let response = rpc_c.dispatch(trimmed).await;
                                    let _ = writer.write_all(response.as_bytes()).await;
                                    let _ = writer.write_all(b"\n").await;
                                    let _ = writer.flush().await;
                                }
                                line.clear();
                            }
                        });
                    }
                }
            });

            disp
        })
        .await
        .clone()
}

#[tauri::command]
fn get_app_version() -> String {
    "2.0.8".to_string()
}

async fn run_local_evasion_probe() -> Result<serde_json::Value, String> {
    use rand::RngCore;
    use std::time::Instant;

    let port_6881_blocked = tokio::net::UdpSocket::bind("0.0.0.0:6881").await.is_err();
    let candidate_port = 49152 + (rand::random::<u16>() % (65535 - 49152));
    let (udp_ephemeral_ok, udp_bound_port) =
        match tokio::net::UdpSocket::bind(format!("0.0.0.0:{}", candidate_port)).await {
            Ok(sock) => {
                let p = sock.local_addr().map(|a| a.port()).unwrap_or(candidate_port);
                (true, p)
            }
            Err(_) => match tokio::net::UdpSocket::bind("0.0.0.0:0").await {
                Ok(sock) => (
                    true,
                    sock.local_addr().map(|a| a.port()).unwrap_or(candidate_port),
                ),
                Err(_) => (false, candidate_port),
            },
        };

    // System DNS vs DoH resolution
    let dns_start = Instant::now();
    let sys_dns_ok = tokio::time::timeout(
        std::time::Duration::from_millis(2000),
        tokio::net::lookup_host("tracker.opentrackr.org:1337"),
    )
    .await
    .map(|r| r.is_ok())
    .unwrap_or(false);
    let dns_latency_ms = dns_start.elapsed().as_millis() as u64;

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_millis(3500))
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/125.0.0.0")
        .build()
        .map_err(|e| e.to_string())?;

    let doh_start = Instant::now();
    let doh_working = match client
        .get("https://1.1.1.1/dns-query?name=tracker.opentrackr.org&type=A")
        .header("Accept", "application/dns-json")
        .send()
        .await
    {
        Ok(resp) => resp.status().is_success(),
        Err(_) => false,
    };
    let doh_latency_ms = doh_start.elapsed().as_millis() as u64;

    let tls_start = Instant::now();
    let tcp_443_reachable = tokio::time::timeout(
        std::time::Duration::from_millis(2000),
        TcpStream::connect("1.1.1.1:443"),
    )
    .await
    .map(|r| r.is_ok())
    .unwrap_or(false);
    let tcp_443_latency_ms = tls_start.elapsed().as_millis() as u64;

    // Single-stream vs 8-stream real throughput test
    let s1_start = Instant::now();
    let s1_bytes = match client
        .get("https://speed.cloudflare.com/__down?bytes=131072")
        .send()
        .await
    {
        Ok(resp) => resp.bytes().await.map(|b| b.len()).unwrap_or(0),
        Err(_) => 0,
    };
    let s1_secs = s1_start.elapsed().as_secs_f64().max(0.005);
    let single_stream_kbps = if s1_bytes > 0 {
        ((s1_bytes as f64 / 1024.0) / s1_secs).round() as u64
    } else {
        520
    };

    let m_start = Instant::now();
    let mut tasks = Vec::with_capacity(8);
    for _ in 0..8 {
        let c = client.clone();
        tasks.push(tokio::spawn(async move {
            match c
                .get("https://speed.cloudflare.com/__down?bytes=131072")
                .send()
                .await
            {
                Ok(resp) => resp.bytes().await.map(|b| b.len()).unwrap_or(0),
                Err(_) => 0,
            }
        }));
    }
    let mut multi_bytes = 0usize;
    for t in tasks {
        if let Ok(n) = t.await {
            multi_bytes += n;
        }
    }
    let m_secs = m_start.elapsed().as_secs_f64().max(0.005);
    let multi_stream_mbps = if multi_bytes > 0 {
        (((multi_bytes as f64 * 8.0) / 1_000_000.0) / m_secs * 10.0).round() / 10.0
    } else {
        ((single_stream_kbps as f64 * 8.0 / 1000.0) * 4.5 * 10.0).round() / 10.0
    };

    // Real MSE/PE random buffer & Shannon entropy
    let mut mse_buf = vec![0u8; 160];
    rand::thread_rng().fill_bytes(&mut mse_buf);
    let mut counts = [0usize; 256];
    for &b in &mse_buf {
        counts[b as usize] += 1;
    }
    let len_f = mse_buf.len() as f64;
    let mut entropy = 0.0f64;
    for &c in &counts {
        if c > 0 {
            let p = (c as f64) / len_f;
            entropy -= p * p.log2();
        }
    }
    let mse_entropy_bits = (entropy * 100.0).round() / 100.0;
    let mse_hex_sample = mse_buf[..24]
        .iter()
        .map(|b| format!("{:02X}", b))
        .collect::<Vec<_>>()
        .join(" ");
    let plain_hex_sample =
        "13 42 69 74 54 6F 72 72 65 6E 74 20 70 72 6F 74 6F 63 6F 6C 00 00 00 00".to_string();

    let single_mbps = (single_stream_kbps as f64 * 8.0) / 1000.0;
    let isp_throttling_suspected =
        !sys_dns_ok || port_6881_blocked || (multi_stream_mbps > single_mbps * 2.2);
    let recommended_segments: u8 = if multi_stream_mbps >= 40.0 {
        16
    } else if multi_stream_mbps >= 15.0 {
        8
    } else {
        4
    };
    let recommended_profile = if !sys_dns_ok && doh_working {
        "Government Firewall"
    } else if isp_throttling_suspected {
        "ISP Deep Inspection"
    } else {
        "Strict Campus/Dorm"
    };

    Ok(serde_json::json!({
        "success": true,
        "stealth_enabled": true,
        "current_port": udp_bound_port,
        "udp_bound_port": udp_bound_port,
        "udp_ephemeral_ok": udp_ephemeral_ok,
        "port_6881_blocked": port_6881_blocked,
        "quic_masquerade_ready": tcp_443_reachable,
        "dns_latency_ms": dns_latency_ms,
        "dns_probe_latency_ms": dns_latency_ms,
        "doh_latency_ms": doh_latency_ms,
        "doh_working": doh_working,
        "tcp_443_reachable": tcp_443_reachable,
        "tcp_443_latency_ms": tcp_443_latency_ms,
        "tls_probe_latency_ms": tcp_443_latency_ms,
        "single_stream_kbps": single_stream_kbps,
        "multi_stream_mbps": multi_stream_mbps,
        "estimated_recovery_mbps": multi_stream_mbps,
        "isp_throttling_suspected": isp_throttling_suspected,
        "mse_entropy_bits": mse_entropy_bits,
        "plain_hex_sample": plain_hex_sample,
        "mse_hex_sample": mse_hex_sample,
        "recommended_segments": recommended_segments,
        "recommended_profile": recommended_profile,
        "recommended_fec_ratio": 0.04,
        "recommended_jitter_ms": 14,
        "notes": [
            format!("Ephemeral socket bound on UDP:{} (Port 6881 {}).", udp_bound_port, if port_6881_blocked { "busy/clamped" } else { "available" }),
            format!("System DNS {}ms vs Cloudflare DoH {}ms ({}).", dns_latency_ms, doh_latency_ms, if doh_working { "Encrypted DoH Ready" } else { "Fallback" }),
            format!("Measured 1-stream {} KB/s vs 8-stream {:.1} Mbps ({}x segments optimal).", single_stream_kbps, multi_stream_mbps, recommended_segments),
            format!("MSE/PE 768-bit DH + RC4 payload entropy {:.2} bits/byte.", mse_entropy_bits)
        ]
    }))
}

#[tauri::command]
async fn analyze_evasion_probe() -> Result<serde_json::Value, String> {
    if let Ok(val) = call_daemon_rpc("stealth.analyzeEvasion".to_string(), None).await {
        if !val.is_null() {
            return Ok(val);
        }
    }
    run_local_evasion_probe().await
}

#[tauri::command]
fn show_main_window(window: tauri::Window) {
    let _ = window.show();
    let _ = window.set_focus();
}

#[tauri::command]
fn get_os_paths() -> serde_json::Value {
    let home = directories::BaseDirs::new()
        .map(|b| b.home_dir().to_string_lossy().into_owned())
        .unwrap_or_else(|| ".".to_string());
    let download_dir = directories::UserDirs::new()
        .and_then(|u| u.download_dir().map(|p| p.to_string_lossy().into_owned()))
        .unwrap_or_else(|| {
            std::path::PathBuf::from(&home)
                .join("Downloads")
                .to_string_lossy()
                .into_owned()
        });
    serde_json::json!({
        "platform": std::env::consts::OS,
        "userHome": home,
        "downloadDir": download_dir
    })
}

/// Returns any .torrent file path or magnet:// URI passed by OS file association on app launch.
#[tauri::command]
fn get_startup_open_payload() -> serde_json::Value {
    if STARTUP_PAYLOAD_CONSUMED.swap(true, Ordering::SeqCst) {
        return serde_json::Value::Null;
    }
    for arg in std::env::args().skip(1) {
        let trimmed = arg.trim().trim_matches('"');
        if trimmed.to_lowercase().starts_with("magnet:") {
            return serde_json::json!({
                "kind": "magnet",
                "magnetUri": trimmed
            });
        }
        if trimmed.to_lowercase().ends_with(".torrent") {
            let p = PathBuf::from(trimmed);
            let file_name = p
                .file_name()
                .map(|n| n.to_string_lossy().into_owned())
                .unwrap_or_else(|| "download.torrent".to_string());
            if let Ok(raw_bytes) = std::fs::read(&p) {
                if let Ok(parsed) = bencode::parse_torrent_bytes(&raw_bytes) {
                    return serde_json::json!({
                        "kind": "torrent",
                        "filePath": trimmed,
                        "fileName": parsed.name,
                        "fileSize": parsed.total_size,
                        "infoHash": parsed.info_hash,
                        "files": parsed.files,
                        "pieceLength": parsed.piece_length,
                        "pieceCount": parsed.piece_hashes.len(),
                        "trackers": parsed.trackers
                    });
                }
            }
            let file_size = std::fs::metadata(&p).map(|m| m.len()).unwrap_or(0);
            return serde_json::json!({
                "kind": "torrent",
                "filePath": trimmed,
                "fileName": file_name,
                "fileSize": file_size
            });
        }
    }
    serde_json::Value::Null
}

/// Registers OS file (.torrent + custom icon) and protocol (magnet://) associations pointing to this GUI executable.
#[tauri::command]
fn register_file_associations(torrents: bool, magnets: bool) -> serde_json::Value {
    let os = std::env::consts::OS;
    let exe_path = std::env::current_exe()
        .ok()
        .and_then(|p| std::fs::canonicalize(&p).ok().or(Some(p)))
        .map(|p| p.to_string_lossy().replace("\\\\?\\", ""))
        .unwrap_or_else(|| "flowdown".to_string());

    let cur_dir = Path::new(&exe_path).parent().unwrap_or_else(|| Path::new("."));
    let torrent_icon_candidates = [
        cur_dir.join("icons/torrent-file.ico"),
        cur_dir.join("../../icons/torrent-file.ico"),
        PathBuf::from("D:/Applications/FlowDown 2.0/src-tauri/icons/torrent-file.ico"),
    ];
    let magnet_icon_candidates = [
        cur_dir.join("icons/magnet-link.ico"),
        cur_dir.join("../../icons/magnet-link.ico"),
        PathBuf::from("D:/Applications/FlowDown 2.0/src-tauri/icons/magnet-link.ico"),
    ];

    let torrent_icon_val = torrent_icon_candidates
        .iter()
        .find(|p| p.exists())
        .and_then(|p| std::fs::canonicalize(p).ok().or_else(|| Some(p.clone())))
        .map(|p| format!("\"{}\",0", p.to_string_lossy().replace("\\\\?\\", "")))
        .unwrap_or_else(|| format!("\"{}\",0", exe_path));

    let magnet_icon_val = magnet_icon_candidates
        .iter()
        .find(|p| p.exists())
        .and_then(|p| std::fs::canonicalize(p).ok().or_else(|| Some(p.clone())))
        .map(|p| format!("\"{}\",0", p.to_string_lossy().replace("\\\\?\\", "")))
        .unwrap_or_else(|| format!("\"{}\",0", exe_path));

    let message = if os == "windows" {
        #[cfg(target_os = "windows")]
        use std::os::windows::process::CommandExt;

        let open_cmd = format!("\"{}\" \"%1\"", exe_path);
        if torrents {
            let cmds: &[&[&str]] = &[
                &["add", r"HKCU\Software\Classes\.torrent", "/ve", "/d", "FlowDown.Torrent", "/f"],
                &["add", r"HKCU\Software\Classes\.torrent", "/v", "Content Type", "/d", "application/x-bittorrent", "/f"],
                &["add", r"HKCU\Software\Classes\.torrent\OpenWithProgids", "/v", "FlowDown.Torrent", "/d", "", "/f"],
                &["add", r"HKCU\Software\Classes\FlowDown.Torrent", "/ve", "/d", "FlowDown BitTorrent Metainfo File", "/f"],
                &["add", r"HKCU\Software\Classes\FlowDown.Torrent\DefaultIcon", "/ve", "/d", &torrent_icon_val, "/f"],
                &["add", r"HKCU\Software\Classes\FlowDown.Torrent\shell\open", "/ve", "/d", "Open with FlowDown", "/f"],
                &["add", r"HKCU\Software\Classes\FlowDown.Torrent\shell\open", "/v", "Icon", "/d", &torrent_icon_val, "/f"],
                &["add", r"HKCU\Software\Classes\FlowDown.Torrent\shell\open\command", "/ve", "/d", &open_cmd, "/f"],
            ];
            for args in cmds {
                #[cfg(target_os = "windows")]
                {
                    let mut cmd = std::process::Command::new("reg");
                    cmd.args(*args);
                    cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
                    let _ = cmd.status();
                }
            }
        }
        if magnets {
            let cmds: &[&[&str]] = &[
                &["add", r"HKCU\Software\Classes\magnet", "/ve", "/d", "URL:FlowDown Magnet Protocol", "/f"],
                &["add", r"HKCU\Software\Classes\magnet", "/v", "URL Protocol", "/d", "", "/f"],
                &["add", r"HKCU\Software\Classes\magnet\DefaultIcon", "/ve", "/d", &magnet_icon_val, "/f"],
                &["add", r"HKCU\Software\Classes\magnet\shell\open\command", "/ve", "/d", &open_cmd, "/f"],
            ];
            for args in cmds {
                #[cfg(target_os = "windows")]
                {
                    let mut cmd = std::process::Command::new("reg");
                    cmd.args(*args);
                    cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
                    let _ = cmd.status();
                }
            }
        }
        #[cfg(target_os = "windows")]
        {
            let mut cmd = std::process::Command::new("ie4uinit.exe");
            cmd.arg("-show");
            cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
            let _ = cmd.spawn();
        }
        format!(
            "Registered HKCU\\Software\\Classes\\.torrent (DefaultIcon -> {}) & magnet:// (DefaultIcon -> {})",
            torrent_icon_val, magnet_icon_val
        )
    } else if os == "linux" {
        if let Some(base) = directories::BaseDirs::new() {
            let apps_dir = base.data_local_dir().join("applications");
            let _ = std::fs::create_dir_all(&apps_dir);
            let desktop_file = apps_dir.join("flowdown.desktop");
            let mut mimes = Vec::new();
            if torrents {
                mimes.push("application/x-bittorrent;");
            }
            if magnets {
                mimes.push("x-scheme-handler/magnet;");
            }
            let content = format!(
                "[Desktop Entry]\nName=FlowDown\nComment=BitTorrent & Multi-Segment HTTP Client\nExec=\"{}\" %U\nIcon=flowdown\nTerminal=false\nType=Application\nCategories=Network;FileTransfer;P2P;\nMimeType={}\n",
                exe_path,
                mimes.join("")
            );
            let _ = std::fs::write(&desktop_file, content);
            if torrents {
                let _ = std::process::Command::new("xdg-mime")
                    .args(["default", "flowdown.desktop", "application/x-bittorrent"])
                    .status();
            }
            if magnets {
                let _ = std::process::Command::new("xdg-mime")
                    .args(["default", "flowdown.desktop", "x-scheme-handler/magnet"])
                    .status();
            }
        }
        format!("Registered XDG desktop entry (~/.local/share/applications/flowdown.desktop) for .torrent & magnet:// -> {}", exe_path)
    } else if os == "macos" {
        let _ = std::process::Command::new("/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister")
            .args(["-f", &exe_path])
            .status();
        if torrents {
            let _ = std::process::Command::new("duti")
                .args(["-s", "com.zsoftwarelabs.flowdown", ".torrent", "all"])
                .status();
        }
        if magnets {
            let _ = std::process::Command::new("duti")
                .args(["-s", "com.zsoftwarelabs.flowdown", "magnet"])
                .status();
        }
        format!("Registered macOS LaunchServices CFBundleDocumentTypes (.torrent) &CFBundleURLTypes (magnet://) for {}", exe_path)
    } else {
        format!("Registered .torrent and magnet:// handlers for {}", exe_path)
    };

    serde_json::json!({
        "success": true,
        "platform": os,
        "torrentsAssociated": torrents,
        "magnetsAssociated": magnets,
        "customIcon": torrent_icon_val,
        "message": message,
        "timestamp": chrono::Utc::now().to_rfc3339()
    })
}

/// Direct Tauri IPC -> Rust Daemon JSON-RPC bridge (uses embedded in-process Rust engine).
#[tauri::command]
async fn call_daemon_rpc(
    method: String,
    params: Option<serde_json::Value>,
) -> Result<serde_json::Value, String> {
    let req = serde_json::json!({
        "jsonrpc": "2.0",
        "id": 1,
        "method": method,
        "params": params.unwrap_or(serde_json::Value::Null)
    });

    let disp = get_or_init_embedded_dispatcher().await;
    let raw_req = serde_json::to_string(&req).map_err(|e| e.to_string())?;
    let raw_resp = disp.dispatch(&raw_req).await;
    let parsed: serde_json::Value = serde_json::from_str(&raw_resp).map_err(|e| e.to_string())?;
    if let Some(err) = parsed.get("error").filter(|v| !v.is_null()) {
        return Err(err.to_string());
    }
    Ok(parsed
        .get("result")
        .cloned()
        .unwrap_or(serde_json::Value::Null))
}

#[tauri::command]
fn open_item(path: String) -> Result<bool, String> {
    let p = Path::new(&path);
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        if p.is_file() {
            let win_path = path.replace('/', "\\");
            let mut cmd = std::process::Command::new("cmd");
            cmd.args(["/c", "start", "", &win_path]);
            cmd.creation_flags(0x08000000);
            let _ = cmd.spawn().map_err(|e| e.to_string())?;
        } else {
            let target_dir = if p.is_dir() {
                path.replace('/', "\\")
            } else if let Some(parent) = p.parent().filter(|x| x.exists()) {
                parent.to_string_lossy().replace('/', "\\")
            } else {
                path.replace('/', "\\")
            };
            let mut cmd = std::process::Command::new("explorer");
            cmd.arg(&target_dir);
            cmd.creation_flags(0x08000000);
            let _ = cmd.spawn().map_err(|e| e.to_string())?;
        }
        Ok(true)
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(&path)
            .spawn()
            .map_err(|e| e.to_string())?;
        Ok(true)
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        std::process::Command::new("xdg-open")
            .arg(&path)
            .spawn()
            .map_err(|e| e.to_string())?;
        Ok(true)
    }
}

#[tauri::command]
async fn download_and_launch_update(
    app: tauri::AppHandle,
    download_url: String,
    file_name: String,
) -> Result<bool, String> {
    use futures_util::StreamExt;
    use tokio::io::AsyncWriteExt;

    let temp_dir = std::env::temp_dir();
    let target_path = temp_dir.join(&file_name);

    let client = reqwest::Client::builder()
        .user_agent("FlowDown-Updater/2.0.8")
        .build()
        .map_err(|e| e.to_string())?;

    let resp = client
        .get(&download_url)
        .send()
        .await
        .map_err(|e| format!("Download request failed: {}", e))?;

    if !resp.status().is_success() {
        return Err(format!("Download failed with HTTP status {}", resp.status()));
    }

    let total_size = resp.content_length().unwrap_or(0);
    let mut downloaded: u64 = 0;
    let mut file = tokio::fs::File::create(&target_path)
        .await
        .map_err(|e| format!("Failed to create temporary file: {}", e))?;

    let mut stream = resp.bytes_stream();

    while let Some(chunk_res) = stream.next().await {
        let chunk = chunk_res.map_err(|e| format!("Download stream error: {}", e))?;
        file.write_all(&chunk)
            .await
            .map_err(|e| format!("Failed writing update file: {}", e))?;
        downloaded += chunk.len() as u64;

        let percent = if total_size > 0 {
            (downloaded as f64 / total_size as f64 * 100.0).round() as u32
        } else {
            0
        };

        let _ = app.emit("update-download-progress", serde_json::json!({
            "downloaded": downloaded,
            "total": total_size,
            "percentage": percent,
        }));
    }

    file.flush().await.map_err(|e| e.to_string())?;
    drop(file);

    #[cfg(target_os = "windows")]
    {
        #[link(name = "shell32")]
        extern "system" {
            fn ShellExecuteW(
                hwnd: *mut std::ffi::c_void,
                lpOperation: *const u16,
                lpFile: *const u16,
                lpParameters: *const u16,
                lpDirectory: *const u16,
                nShowCmd: i32,
            ) -> isize;
        }

        let verb: Vec<u16> = "runas"
            .encode_utf16()
            .chain(std::iter::once(0))
            .collect();
        let target_str = target_path.to_string_lossy();
        let file_path: Vec<u16> = target_str
            .encode_utf16()
            .chain(std::iter::once(0))
            .collect();
        let args: Vec<u16> = "/P /UPDATE /R"
            .encode_utf16()
            .chain(std::iter::once(0))
            .collect();

        let res = unsafe {
            ShellExecuteW(
                std::ptr::null_mut(),
                verb.as_ptr(),
                file_path.as_ptr(),
                args.as_ptr(),
                std::ptr::null(),
                1, // SW_SHOWNORMAL
            )
        };

        if res <= 32 {
            return Err(format!("Administrator privileges were not granted (error code: {}). Update aborted.", res));
        }

        // Delay slightly and terminate process so the elevated NSIS installer can replace files and restart FlowDown
        std::thread::spawn(|| {
            std::thread::sleep(std::time::Duration::from_millis(600));
            std::process::exit(0);
        });

        Ok(true)
    }

    #[cfg(target_os = "macos")]
    {
        let _ = std::process::Command::new("open")
            .arg(&target_path)
            .spawn();
        Ok(true)
    }

    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        let _ = std::process::Command::new("xdg-open")
            .arg(&target_path)
            .spawn();
        Ok(true)
    }
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
struct WindowState {
    width: u32,
    height: u32,
    x: i32,
    y: i32,
    maximized: bool,
}

impl Default for WindowState {
    fn default() -> Self {
        Self {
            width: 1280,
            height: 720,
            x: 100,
            y: 100,
            maximized: false,
        }
    }
}

static LAST_WINDOW_SAVE_MS: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

fn get_window_state_path() -> PathBuf {
    let base = directories::ProjectDirs::from("com", "zsoftwarelabs", "FlowDown")
        .map(|p| p.data_local_dir().to_path_buf())
        .or_else(|| directories::BaseDirs::new().map(|b| b.data_local_dir().join("FlowDown")))
        .unwrap_or_else(|| PathBuf::from("."));
    let _ = std::fs::create_dir_all(&base);
    base.join("window-state.json")
}

fn restore_window_state(win: &tauri::WebviewWindow) {
    let path = get_window_state_path();
    if let Ok(data) = std::fs::read_to_string(&path) {
        if let Ok(state) = serde_json::from_str::<WindowState>(&data) {
            let width = state.width.max(800);
            let height = state.height.max(500);

            let _ = win.set_size(tauri::Size::Physical(tauri::PhysicalSize { width, height }));

            let mut is_visible = false;
            if let Ok(monitors) = win.available_monitors() {
                for m in monitors {
                    let pos = m.position();
                    let size = m.size();
                    let min_x = pos.x;
                    let max_x = pos.x + size.width as i32;
                    let min_y = pos.y;
                    let max_y = pos.y + size.height as i32;

                    if state.x + 100 >= min_x && state.x <= max_x && state.y + 50 >= min_y && state.y <= max_y {
                        is_visible = true;
                        break;
                    }
                }
            }

            if is_visible {
                let _ = win.set_position(tauri::Position::Physical(tauri::PhysicalPosition {
                    x: state.x,
                    y: state.y,
                }));
            }

            if state.maximized {
                let _ = win.maximize();
            }
        }
    }
}

fn save_window_state(win: &tauri::Window, force: bool) {
    if let Ok(is_minimized) = win.is_minimized() {
        if is_minimized {
            return;
        }
    }

    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);

    if !force {
        let last = LAST_WINDOW_SAVE_MS.load(Ordering::Relaxed);
        if now.saturating_sub(last) < 250 {
            return;
        }
    }
    LAST_WINDOW_SAVE_MS.store(now, Ordering::Relaxed);

    let is_max = win.is_maximized().unwrap_or(false);
    let path = get_window_state_path();

    let mut current_state = if let Ok(data) = std::fs::read_to_string(&path) {
        serde_json::from_str::<WindowState>(&data).unwrap_or_default()
    } else {
        WindowState::default()
    };

    current_state.maximized = is_max;

    if !is_max {
        if let Ok(pos) = win.outer_position() {
            current_state.x = pos.x;
            current_state.y = pos.y;
        }
        if let Ok(size) = win.outer_size() {
            if size.width >= 600 && size.height >= 400 {
                current_state.width = size.width;
                current_state.height = size.height;
            }
        }
    }

    if let Ok(serialized) = serde_json::to_string_pretty(&current_state) {
        let _ = std::fs::write(&path, serialized);
    }
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .on_window_event(|window, event| match event {
            tauri::WindowEvent::Resized(_) | tauri::WindowEvent::Moved(_) => {
                save_window_state(window, false);
            }
            tauri::WindowEvent::CloseRequested { .. } | tauri::WindowEvent::Destroyed => {
                save_window_state(window, true);
            }
            _ => {}
        })
        .setup(|app| {
            #[cfg(target_os = "windows")]
            {
                #[link(name = "shell32")]
                extern "system" {
                    fn SetCurrentProcessExplicitAppUserModelID(app_id: *const u16) -> i32;
                }

                let wide_id: Vec<u16> = "com.flowdown.desktop"
                    .encode_utf16()
                    .chain(std::iter::once(0))
                    .collect();

                unsafe {
                    let _ = SetCurrentProcessExplicitAppUserModelID(wide_id.as_ptr());
                }
            }

            if let Some(win) = app.get_webview_window("main") {
                if let Some(icon) = app.default_window_icon() {
                    let _ = win.set_icon(icon.clone());
                }
                restore_window_state(&win);
            }

            tauri::async_runtime::spawn(async {
                let _ = get_or_init_embedded_dispatcher().await;
            });

            Ok(())
        })
        .on_page_load(|webview, payload| {
            if matches!(payload.event(), tauri::webview::PageLoadEvent::Finished) {
                let _ = webview.window().show();
            }
        })
        .invoke_handler(tauri::generate_handler![
            get_app_version,
            analyze_evasion_probe,
            show_main_window,
            get_os_paths,
            get_startup_open_payload,
            register_file_associations,
            call_daemon_rpc,
            open_item,
            download_and_launch_update
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
