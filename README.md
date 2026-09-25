<p align="center">
  <img src="assets/icon.png" alt="FlowDown App Icon" width="100" height="100" />
</p>

# <p align="center">FlowDown Download Manager</p>

<p align="center">
  A fast, lightweight, specialized desktop download manager built with <b>Tauri v2</b>, <b>React</b>, and <b>librqbit</b> for high-performance HTTP and BitTorrent transfers with stealth protocol encryption.
</p>

<p align="center">
  <img src="assets/screenshot.png" alt="FlowDown Screenshot" width="100%" />
</p>

---

## Overview & Usage

FlowDown is designed as a **manual-style download manager**:

- **Manual Link Input**: Links are added by either copying & pasting URLs into the transfer dialog or by directly dragging and dropping links / files into the application window.
- **Protocol Handling**:
  - **BitTorrent & Magnet Links**: FlowDown can register as your system's default handler for `.torrent` files and `magnet:` links, launching automatically when opened from your browser or file manager.
  - **HTTP/HTTPS Transfers**: FlowDown is a **manual downloader** for direct web files — it **does not** automatically intercept or catch HTTP/HTTPS downloads from your browser. Paste or drop the direct download link into the app to start downloading.

---

## Key Features

- **Multi-protocol Support**: High-speed multi-connection HTTP(S) downloads with dynamic byte-range probing, plus full BitTorrent support via `librqbit`.
- **Stealth Protocol Shield**: Anti-throttling traffic obfuscation, randomized ports, client spoofing, and forced BitTorrent protocol encryption.
- **Drag & Drop Workflow**: Drag links directly from your browser or `.torrent` files from your desktop into the FlowDown window.
- **Automatic GitHub Updates**: Built-in updater with cryptographic signature verification that checks for new releases directly from GitHub.
- **Speed & Bandwidth Controls**: Global and per-transfer speed limits, pause/resume queues, and categorized downloads.
- **Native OS Integration**: Clean window state persistence, light/dark themes, and system notifications.

---

## Installation

You can download pre-built installers and packages directly from the [GitHub Releases](https://github.com/Z-Sofware-Labs/FlowDown/releases) page.

### Windows (x64)
1. Download the `.exe` setup package (NSIS installer).
2. Run the installer and follow the on-screen setup wizard.
3. FlowDown registers per-user without prompting for elevated UAC privileges.

### macOS (Universal: Apple Silicon & Intel)
1. Download the Universal `.dmg` file (`universal-apple-darwin`), which runs natively on both Apple Silicon (M1/M2/M3/M4) and Intel Macs.
2. Open the `.dmg` and drag **FlowDown** into your **Applications** folder.

> [!NOTE]
> **macOS Gatekeeper Notice**:
> If macOS displays a message saying *"FlowDown cannot be opened because the developer cannot be verified"* or *"is damaged and can’t be opened"*:
> 1. Right-click (or Control-click) the **FlowDown** app in your Applications folder and select **Open**.
> 2. Click **Open** in the dialog prompt.
> 
> Alternatively, you can allow it via **System Settings > Privacy & Security** by scrolling down to the Security section and clicking **Open Anyway**, or remove the quarantine attribute via Terminal:
> ```bash
> xattr -cr /Applications/FlowDown.app
> ```

### Linux (x86_64)
Pre-built packages are generated for `x86_64` (ARM64 can be built directly from source):
- **Debian / Ubuntu (`.deb`)**:
  ```bash
  sudo dpkg -i flowdown_*_amd64.deb
  # If there are missing dependencies:
  sudo apt-get install -f
  ```
- **Fedora / RHEL / openSUSE (`.rpm`)**:
  ```bash
  sudo rpm -i flowdown-*.rpm
  ```
- **AppImage**:
  ```bash
  chmod +x FlowDown_*.AppImage
  ./FlowDown_*.AppImage
  ```

---

## Building from Source

### Prerequisites

- [Node.js](https://nodejs.org/) (v18+)
- [Rust](https://www.rust-lang.org/) (stable toolchain)

### Setup & Development

```bash
# Clone the repository
git clone https://github.com/Z-Sofware-Labs/FlowDown.git
cd flowdown

# Install dependencies
npm install

# Start development server with Tauri desktop window
npm run tauri dev
```

### Production Build

```bash
npm run tauri build
```

The compiled installer and standalone executable will be generated in `src-tauri/target/release/bundle/`.

---

## License

This project is licensed under the [MIT License](https://opensource.org/licenses/MIT).
