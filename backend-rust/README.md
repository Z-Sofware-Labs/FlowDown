# qrbitd - Rust BitTorrent & Multi-Segment HTTP Engine Daemon

`qrbitd` is the headless, high-performance BitTorrent and multi-segment HTTP downloading daemon designed for the **Option A (Qt Frontend + Rust Backend)** architecture of qrBit.

## Architecture: Option A (Client-Daemon via IPC)

```
+-------------------------------------------------------------+
|               Native Qt 6 GUI Client (qrbit-qt)             |
|   (Breeze / Fusion / Win11 Styles, Transfer Table, Tabs)    |
+-------------------------------------------------------------+
                              |
                     JSON-RPC 2.0 / IPC
              (Unix Socket / Named Pipe / TCP 52840)
                              |
                              v
+-------------------------------------------------------------+
|                   Rust Daemon (qrbitd)                      |
|                                                             |
|  +-------------------------------------------------------+  |
|  |                 Async Tokio Event Loop                |  |
|  +-------------------------------------------------------+  |
|  | BitTorrent Swarm Engine (librqbit / DHT / PeX / uTP)  |  |
|  | HTTP Multi-Segment Range Chunk Downloader             |  |
|  | libqrbit DPI Evasion & UDP Ephemeral Port Hopping     |  |
|  | Session Upload/Download Counters (Zero-Interruption)   |  |
|  | Atomic Config Persistence (`qrbitd.json`)             |  |
|  +-------------------------------------------------------+  |
+-------------------------------------------------------------+
```

## Features

- **Decoupled Reliability**: The Qt GUI can be closed, reopened, or crashed without losing transfer progress or dropping peer connections.
- **Pure Async Rust**: Built on `tokio`, `reqwest`, `serde`, and `interprocess`.
- **Live Session Statistics**: Zero-interruption session metrics reset via `core.resetSessionStats`.
- **libqrbit Anti-Throttling**: UDP frame masquerading with QUIC/TLS 1.3 fake envelopes and dynamic port hopping.
- **Multi-Segment HTTP IDM**: Pre-allocates files and streams concurrent byte ranges asynchronously via `tokio::fs::File`.

## Building & Running

### Requirements
- Rust 1.75+ (`rustup default stable`)
- Linux / macOS / Windows

```bash
cd backend-rust
cargo build --release
```

The compiled binary will be located at:
```bash
./target/release/qrbitd
```

### Running the Daemon
```bash
# Run standalone
./target/release/qrbitd

# With custom RPC port
./target/release/qrbitd --port 52840
```

## JSON-RPC 2.0 API Methods

| Method | Parameters | Description |
|---|---|---|
| `core.getVersion` | None | Returns daemon version, OS, and protocol. |
| `core.getSessionStats` | None | Returns total downloaded/uploaded in session, active counts. |
| `core.resetSessionStats` | None | Resets session upload/download counters back to 0 B without interrupting transfers. |
| `torrents.list` | None | Returns all active BitTorrent and HTTP transfers. |
| `torrents.pause` | `{"id": "..."}` | Pauses an active transfer. |
| `torrents.resume` | `{"id": "..."}` | Resumes a transfer. |
| `torrents.delete` | `{"id": "..."}` | Deletes a transfer. |
| `bandwidth.toggleTurtle` | None | Toggles speed mode between Limited and Unlimited. |
| `bandwidth.setTurtle` | `{"active": true/false}` | Explicitly sets speed mode to Limited or Unlimited. |
| `stealth.toggle` | None | Toggles libqrbit anti-throttling On / Off. |
| `http.probe` | `{"url": "..."}` | Queries remote server for Content-Length, ranges, latency. |
| `settings.get` | None | Retrieves persistent daemon settings. |
| `settings.update` | `{...}` | Updates settings (download path, bandwidth caps, etc.). |
