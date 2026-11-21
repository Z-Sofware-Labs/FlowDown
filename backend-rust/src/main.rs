mod bencode;
mod bittorrent;
mod config;
mod engine;
mod http_downloader;
mod libqrbit;
mod rpc;

use config::{DaemonConfig, SharedConfig};
use engine::DaemonEngine;
use libqrbit::LibqrbitEngine;
use rpc::RpcDispatcher;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::TcpListener;
use tokio::sync::RwLock;
use tracing::{info, warn, Level};
use tracing_subscriber::FmtSubscriber;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let subscriber = FmtSubscriber::builder()
        .with_max_level(Level::INFO)
        .with_target(false)
        .finish();
    tracing::subscriber::set_global_default(subscriber)?;

    let mut cli_port: Option<u16> = None;
    let mut config_path = PathBuf::from("flowdown.json");
    if !config_path.exists() && PathBuf::from("qrbitd.json").exists() {
        config_path = PathBuf::from("qrbitd.json");
    }

    let args: Vec<String> = std::env::args().collect();
    let mut i = 1;
    while i < args.len() {
        match args[i].as_str() {
            "--port" if i + 1 < args.len() => {
                if let Ok(p) = args[i + 1].parse::<u16>() {
                    cli_port = Some(p);
                }
                i += 2;
            }
            "--config" if i + 1 < args.len() => {
                config_path = PathBuf::from(&args[i + 1]);
                i += 2;
            }
            _ => i += 1,
        }
    }

    info!("========================================================");
    info!(" FlowDown Daemon (flowdownd v2.0.8) - Pure Rust Core");
    info!(" Architecture: Qt 6 / Bridge GUI <-> Rust Daemon (JSON-RPC 2.0)");
    info!("========================================================");

    let data_dir = directories::ProjectDirs::from("com", "zsoftwarelabs", "FlowDown")
        .map(|p| p.data_local_dir().to_path_buf())
        .or_else(|| directories::BaseDirs::new().map(|b| b.data_local_dir().join("FlowDown")))
        .unwrap_or_else(|| PathBuf::from("data"));
    let _ = std::fs::create_dir_all(&data_dir);

    if config_path.as_os_str() == "flowdown.json" || config_path.as_os_str() == "qrbitd.json" {
        config_path = data_dir.join("flowdown.json");
    }
    let transfers_path = data_dir.join("transfers.json");

    // Clean up any stray transfers.json in cwd to prevent tauri dev file-watch loops
    if !transfers_path.exists() && Path::new("transfers.json").exists() {
        let _ = std::fs::copy("transfers.json", &transfers_path);
        let _ = std::fs::remove_file("transfers.json");
    }
    if Path::new("transfers.json").exists() {
        let _ = std::fs::remove_file("transfers.json");
    }

    let mut cfg = DaemonConfig::load_from_file(&config_path).await?;

    let libqrbit = Arc::new(LibqrbitEngine::new(
        cfg.libqrbit.current_stealth_port,
        cfg.libqrbit.enabled,
    ));

    if cfg.libqrbit.random_port_on_startup {
        match libqrbit
            .bind_ephemeral_port(cfg.libqrbit.stealth_port_min, cfg.libqrbit.stealth_port_max)
            .await
        {
            Ok(port) => {
                cfg.libqrbit.current_stealth_port = port;
                let _ = cfg.save_to_file(&config_path).await;
                info!("[Startup] Randomized listening port to {}", port);
            }
            Err(e) => {
                warn!(
                    "[Startup] Random port bind failed ({}), using {}",
                    e, cfg.libqrbit.current_stealth_port
                );
            }
        }
    }

    let rpc_port = cli_port.unwrap_or(cfg.bind_rpc_port);
    let config: SharedConfig = Arc::new(RwLock::new(cfg));
    info!("[Config] Loaded configuration from {:?}", config_path);

    let engine = Arc::new(DaemonEngine::new(
        config.clone(),
        libqrbit.clone(),
        transfers_path,
    ));
    engine.load_persisted_transfers().await;

    let dispatcher = Arc::new(RpcDispatcher::new(
        engine.clone(),
        config.clone(),
        libqrbit.clone(),
        config_path.clone(),
    ));

    let tcp_addr = format!("127.0.0.1:{}", rpc_port);
    let listener = TcpListener::bind(&tcp_addr).await?;
    info!(
        "[IPC Server] Listening for Qt 6 / bridge connections on {}",
        tcp_addr
    );

    // Background transfer speed & progress sampler
    let engine_tick = engine.clone();
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(tokio::time::Duration::from_millis(1500));
        loop {
            interval.tick().await;
            engine_tick.tick().await;
        }
    });

    // Graceful Ctrl+C handler persisting transfer queue before exit
    let engine_shutdown = engine.clone();
    tokio::spawn(async move {
        if tokio::signal::ctrl_c().await.is_ok() {
            info!("[Shutdown] Pausing active transfers and flushing state...");
            engine_shutdown.pause_all().await;
            std::process::exit(0);
        }
    });

    loop {
        let (mut socket, _peer_addr) = listener.accept().await?;
        let rpc = dispatcher.clone();

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
                    let response = rpc.dispatch(trimmed).await;
                    let _ = writer.write_all(response.as_bytes()).await;
                    let _ = writer.write_all(b"\n").await;
                    let _ = writer.flush().await;
                }
                line.clear();
            }
        });
    }
}
