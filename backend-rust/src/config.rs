use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tokio::sync::RwLock;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct BandwidthLimits {
    pub global_download_limit_kbps: u64, // 0 = unlimited
    pub global_upload_limit_kbps: u64,
    pub alt_speed_active: bool,          // Turtle mode
    pub alt_download_limit_kbps: u64,    // 2048 KB/s
    pub alt_upload_limit_kbps: u64,      // 512 KB/s
    pub dht_enabled: bool,
    pub pex_enabled: bool,
    pub lsd_enabled: bool,
    pub utp_enabled: bool,
    pub encryption_requirement: String,  // "require" | "prefer" | "allow"
    pub max_total_connections: u32,
    pub max_connections_per_torrent: u32,
    pub half_open_connections: u32,
    pub upload_slots_per_torrent: u32,
}

impl Default for BandwidthLimits {
    fn default() -> Self {
        Self {
            global_download_limit_kbps: 0,
            global_upload_limit_kbps: 5120,
            alt_speed_active: false,
            alt_download_limit_kbps: 2048,
            alt_upload_limit_kbps: 512,
            dht_enabled: true,
            pex_enabled: true,
            lsd_enabled: true,
            utp_enabled: true,
            encryption_requirement: "prefer".to_string(),
            max_total_connections: 500,
            max_connections_per_torrent: 100,
            half_open_connections: 50,
            upload_slots_per_torrent: 8,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct LibqrbitConfig {
    pub enabled: bool,
    pub auto_detect_throttling: bool,
    pub aggressive_packet_morph: bool,
    pub multi_path_fragmentation: bool,
    pub decoy_echo_tunnel: bool,
    pub port_hopping: bool,
    pub random_port_on_startup: bool,
    pub stealth_port_min: u16,
    pub stealth_port_max: u16,
    pub current_stealth_port: u16,
    pub dpi_evasion_profile: String,
    pub fec_overhead_ratio: f32,
    pub packet_padding_jitter_ms: u32,
}

impl Default for LibqrbitConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            auto_detect_throttling: true,
            aggressive_packet_morph: true,
            multi_path_fragmentation: true,
            decoy_echo_tunnel: true,
            port_hopping: true,
            random_port_on_startup: false,
            stealth_port_min: 49152,
            stealth_port_max: 65535,
            current_stealth_port: 52841,
            dpi_evasion_profile: "ISP Deep Inspection".to_string(),
            fec_overhead_ratio: 0.04,
            packet_padding_jitter_ms: 14,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct HttpSettings {
    pub default_segments: usize,
    pub max_concurrent_files: usize,
    pub buffer_size: String, // "64KB" | "256KB" | "1MB" | "4MB"
    pub timeout_seconds: u64,
    pub max_retries: u32,
    pub user_agent: String,
    pub custom_user_agent: String,
    pub referer_mode: String, // "same_origin" | "empty" | "custom"
    pub custom_referer: String,
    pub doh_resolver: String, // "system" | "cloudflare" | "google" | "quad9"
    pub tcp_window_scaling: bool,
    pub keep_alive: bool,
    pub http2_multiplex: bool,
    pub auto_resume_broken: bool,
    pub dynamic_chunking: bool,
}

impl Default for HttpSettings {
    fn default() -> Self {
        Self {
            default_segments: 8,
            max_concurrent_files: 5,
            buffer_size: "1MB".to_string(),
            timeout_seconds: 15,
            max_retries: 5,
            user_agent: "Chrome".to_string(),
            custom_user_agent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) FlowDown/2.0 (RustCore)".to_string(),
            referer_mode: "same_origin".to_string(),
            custom_referer: String::new(),
            doh_resolver: "cloudflare".to_string(),
            tcp_window_scaling: true,
            keep_alive: true,
            http2_multiplex: true,
            auto_resume_broken: true,
            dynamic_chunking: true,
        }
    }
}

impl HttpSettings {
    pub fn resolve_user_agent(&self) -> String {
        match self.user_agent.as_str() {
            "Chrome" => "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36".to_string(),
            "Firefox" => "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:131.0) Gecko/20100101 Firefox/131.0".to_string(),
            "Edge" => "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0".to_string(),
            "curl" | "cURL" => "curl/8.10.1".to_string(),
            "Custom" if !self.custom_user_agent.trim().is_empty() => self.custom_user_agent.clone(),
            _ => "FlowDown/2.0.6 (RustCore)".to_string(),
        }
    }

    pub fn resolve_buffer_bytes(&self) -> usize {
        match self.buffer_size.as_str() {
            "64KB" => 64 * 1024,
            "256KB" => 256 * 1024,
            "4MB" => 4 * 1024 * 1024,
            _ => 1024 * 1024,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct SystemSettings {
    pub theme_mode: String, // "light" | "dark" | "system"
    pub auto_subfolders: bool,
    pub associate_torrents: bool,
    pub associate_magnets: bool,
    pub start_on_boot: bool,
    pub minimize_to_tray: bool,
    pub auto_check_updates: bool,
}

impl Default for SystemSettings {
    fn default() -> Self {
        Self {
            theme_mode: "dark".to_string(),
            auto_subfolders: true,
            associate_torrents: true,
            associate_magnets: true,
            start_on_boot: false,
            minimize_to_tray: true,
            auto_check_updates: true,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct DaemonConfig {
    pub download_directory: PathBuf,
    pub socket_path: PathBuf,
    pub bind_rpc_port: u16,
    pub bandwidth: BandwidthLimits,
    pub libqrbit: LibqrbitConfig,
    pub http: HttpSettings,
    pub system: SystemSettings,
}

impl Default for DaemonConfig {
    fn default() -> Self {
        let home = directories::UserDirs::new()
            .and_then(|u| u.download_dir().map(|p| p.to_path_buf()))
            .unwrap_or_else(|| PathBuf::from("./downloads"));

        let sock = if cfg!(windows) {
            PathBuf::from(r"\\.\pipe\flowdownd")
        } else {
            PathBuf::from("/tmp/flowdownd.sock")
        };

        Self {
            download_directory: home,
            socket_path: sock,
            bind_rpc_port: 52840,
            bandwidth: BandwidthLimits::default(),
            libqrbit: LibqrbitConfig::default(),
            http: HttpSettings::default(),
            system: SystemSettings::default(),
        }
    }
}

pub type SharedConfig = Arc<RwLock<DaemonConfig>>;

impl DaemonConfig {
    pub async fn load_from_file<P: AsRef<Path>>(
        path: P,
    ) -> Result<Self, Box<dyn std::error::Error + Send + Sync>> {
        if path.as_ref().exists() {
            let content = tokio::fs::read_to_string(path).await?;
            let cfg: DaemonConfig = serde_json::from_str(&content)?;
            Ok(cfg)
        } else {
            let default_cfg = Self::default();
            default_cfg.save_to_file(path).await?;
            Ok(default_cfg)
        }
    }

    pub async fn save_to_file<P: AsRef<Path>>(
        &self,
        path: P,
    ) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        if let Some(parent) = path.as_ref().parent() {
            if !parent.as_os_str().is_empty() {
                tokio::fs::create_dir_all(parent).await?;
            }
        }
        let serialized = serde_json::to_string_pretty(self)?;
        tokio::fs::write(path, serialized).await?;
        Ok(())
    }
}
