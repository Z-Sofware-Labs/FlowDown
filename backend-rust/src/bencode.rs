#![allow(dead_code)]

use ring::digest::{digest, SHA1_FOR_LEGACY_USE_ONLY};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::fs::File;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum BencodeValue {
    Int(i64),
    Bytes(Vec<u8>),
    List(Vec<BencodeValue>),
    Dict(BTreeMap<Vec<u8>, BencodeValue>),
}

impl BencodeValue {
    pub fn as_bytes(&self) -> Option<&[u8]> {
        match self {
            BencodeValue::Bytes(b) => Some(b),
            _ => None,
        }
    }

    pub fn as_str_lossy(&self) -> Option<String> {
        self.as_bytes()
            .map(|b| String::from_utf8_lossy(b).into_owned())
    }

    pub fn as_int(&self) -> Option<i64> {
        match self {
            BencodeValue::Int(i) => Some(*i),
            _ => None,
        }
    }

    pub fn as_list(&self) -> Option<&[BencodeValue]> {
        match self {
            BencodeValue::List(l) => Some(l),
            _ => None,
        }
    }

    pub fn as_dict(&self) -> Option<&BTreeMap<Vec<u8>, BencodeValue>> {
        match self {
            BencodeValue::Dict(d) => Some(d),
            _ => None,
        }
    }

    pub fn encode(&self) -> Vec<u8> {
        let mut out = Vec::new();
        self.encode_into(&mut out);
        out
    }

    fn encode_into(&self, out: &mut Vec<u8>) {
        match self {
            BencodeValue::Int(n) => {
                out.push(b'i');
                out.extend_from_slice(n.to_string().as_bytes());
                out.push(b'e');
            }
            BencodeValue::Bytes(b) => {
                out.extend_from_slice(b.len().to_string().as_bytes());
                out.push(b':');
                out.extend_from_slice(b);
            }
            BencodeValue::List(items) => {
                out.push(b'l');
                for item in items {
                    item.encode_into(out);
                }
                out.push(b'e');
            }
            BencodeValue::Dict(map) => {
                out.push(b'd');
                for (k, v) in map {
                    out.extend_from_slice(k.len().to_string().as_bytes());
                    out.push(b':');
                    out.extend_from_slice(k);
                    v.encode_into(out);
                }
                out.push(b'e');
            }
        }
    }

    pub fn decode(data: &[u8]) -> Result<BencodeValue, String> {
        let (val, pos, _) = decode_at(data, 0, false)?;
        if pos != data.len() {
            // Trailing bytes can appear in malformed files, allow only if whitespace
            if data[pos..].iter().any(|b| !b.is_ascii_whitespace()) {
                return Err("Unexpected trailing bytes after bencode root".to_string());
            }
        }
        Ok(val)
    }
}

fn decode_at(
    data: &[u8],
    start: usize,
    track_info: bool,
) -> Result<(BencodeValue, usize, Option<(usize, usize)>), String> {
    if start >= data.len() {
        return Err("Unexpected end of bencode stream".to_string());
    }

    match data[start] {
        b'i' => {
            let end_rel = data[start + 1..]
                .iter()
                .position(|&b| b == b'e')
                .ok_or_else(|| "Unterminated bencode integer".to_string())?;
            let end = start + 1 + end_rel;
            let num_str = std::str::from_utf8(&data[start + 1..end])
                .map_err(|_| "Invalid UTF-8 in bencode integer".to_string())?;
            let val = num_str
                .parse::<i64>()
                .map_err(|e| format!("Invalid bencode integer '{}': {}", num_str, e))?;
            Ok((BencodeValue::Int(val), end + 1, None))
        }
        b'l' => {
            let mut idx = start + 1;
            let mut items = Vec::new();
            while idx < data.len() && data[idx] != b'e' {
                let (item, next_idx, _) = decode_at(data, idx, false)?;
                items.push(item);
                idx = next_idx;
            }
            if idx >= data.len() || data[idx] != b'e' {
                return Err("Unterminated bencode list".to_string());
            }
            Ok((BencodeValue::List(items), idx + 1, None))
        }
        b'd' => {
            let mut idx = start + 1;
            let mut map = BTreeMap::new();
            let mut info_span: Option<(usize, usize)> = None;

            while idx < data.len() && data[idx] != b'e' {
                let (key_val, after_key, _) = decode_at(data, idx, false)?;
                let key = match key_val {
                    BencodeValue::Bytes(k) => k,
                    _ => return Err("Bencode dictionary key must be a byte string".to_string()),
                };
                let val_start = after_key;
                let (val, after_val, _) = decode_at(data, val_start, false)?;
                if track_info && key.as_slice() == b"info" {
                    info_span = Some((val_start, after_val));
                }
                map.insert(key, val);
                idx = after_val;
            }
            if idx >= data.len() || data[idx] != b'e' {
                return Err("Unterminated bencode dictionary".to_string());
            }
            Ok((BencodeValue::Dict(map), idx + 1, info_span))
        }
        b'0'..=b'9' => {
            let colon_rel = data[start..]
                .iter()
                .position(|&b| b == b':')
                .ok_or_else(|| "Missing colon in bencode byte string".to_string())?;
            let colon = start + colon_rel;
            let len_str = std::str::from_utf8(&data[start..colon])
                .map_err(|_| "Invalid UTF-8 in bencode string length".to_string())?;
            let len = len_str
                .parse::<usize>()
                .map_err(|e| format!("Invalid bencode string length '{}': {}", len_str, e))?;
            let bytes_start = colon + 1;
            let bytes_end = bytes_start
                .checked_add(len)
                .ok_or_else(|| "Bencode byte string length overflow".to_string())?;
            if bytes_end > data.len() {
                return Err("Truncated bencode byte string".to_string());
            }
            Ok((
                BencodeValue::Bytes(data[bytes_start..bytes_end].to_vec()),
                bytes_end,
                None,
            ))
        }
        other => Err(format!("Unexpected bencode byte 0x{:02x} at {}", other, start)),
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TorrentFileEntry {
    pub path: String,
    pub length: u64,
    pub offset: u64,
}

#[derive(Debug, Clone)]
pub struct ParsedTorrent {
    pub name: String,
    pub info_hash: String,
    pub info_hash_bytes: [u8; 20],
    pub total_size: u64,
    pub piece_length: u64,
    pub piece_hashes: Vec<[u8; 20]>,
    pub trackers: Vec<String>,
    pub files: Vec<TorrentFileEntry>,
    pub comment: Option<String>,
    pub is_private: bool,
    pub info_bytes: Vec<u8>,
}

pub fn parse_torrent_bytes(raw: &[u8]) -> Result<ParsedTorrent, String> {
    let (root, _, info_span) = decode_at(raw, 0, true)?;
    let root_dict = root
        .as_dict()
        .ok_or_else(|| "Torrent root must be a bencode dictionary".to_string())?;

    let (info_start, info_end) =
        info_span.ok_or_else(|| "Torrent is missing required 'info' dictionary".to_string())?;
    let info_slice = &raw[info_start..info_end];
    let info_digest = digest(&SHA1_FOR_LEGACY_USE_ONLY, info_slice);
    let mut info_hash_bytes = [0u8; 20];
    info_hash_bytes.copy_from_slice(info_digest.as_ref());
    let info_hash = hex_encode(&info_hash_bytes);

    let info_val = root_dict
        .get(b"info".as_slice())
        .and_then(|v| v.as_dict())
        .ok_or_else(|| "'info' entry must be a bencode dictionary".to_string())?;

    let name = info_val
        .get(b"name.utf-8".as_slice())
        .or_else(|| info_val.get(b"name".as_slice()))
        .and_then(|v| v.as_str_lossy())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| format!("Swarm-{}", &info_hash[..10]));

    let piece_length = info_val
        .get(b"piece length".as_slice())
        .and_then(|v| v.as_int())
        .filter(|&n| n > 0)
        .unwrap_or(262_144) as u64;

    let mut piece_hashes = Vec::new();
    if let Some(pieces_raw) = info_val.get(b"pieces".as_slice()).and_then(|v| v.as_bytes()) {
        for chunk in pieces_raw.chunks_exact(20) {
            let mut arr = [0u8; 20];
            arr.copy_from_slice(chunk);
            piece_hashes.push(arr);
        }
    }

    let mut files = Vec::new();
    let total_size: u64;

    if let Some(file_list) = info_val.get(b"files".as_slice()).and_then(|v| v.as_list()) {
        let mut offset = 0u64;
        for f in file_list {
            let fdict = f
                .as_dict()
                .ok_or_else(|| "Invalid file entry in multi-file torrent".to_string())?;
            let length = fdict
                .get(b"length".as_slice())
                .and_then(|v| v.as_int())
                .filter(|&n| n >= 0)
                .ok_or_else(|| "Torrent file entry missing valid length".to_string())?
                as u64;
            let path_parts: Vec<String> = fdict
                .get(b"path.utf-8".as_slice())
                .or_else(|| fdict.get(b"path".as_slice()))
                .and_then(|v| v.as_list())
                .map(|list| {
                    list.iter()
                        .filter_map(|p| p.as_str_lossy())
                        .collect::<Vec<_>>()
                })
                .unwrap_or_default();
            let rel_path = if path_parts.is_empty() {
                "file.bin".to_string()
            } else {
                path_parts.join("/")
            };
            // Skip BEP-47 padding files (attr="p" or .pad/<size>) so alignment padding never inflates total download size
            let is_padding = fdict
                .get(b"attr".as_slice())
                .and_then(|v| v.as_str_lossy())
                .map(|a| a.contains('p'))
                .unwrap_or(false)
                || path_parts.first().map(|p| p == ".pad").unwrap_or(false)
                || rel_path.starts_with(".pad/");
            if is_padding {
                offset = offset.saturating_add(length);
                continue;
            }
            files.push(TorrentFileEntry {
                path: rel_path,
                length,
                offset,
            });
            offset = offset.saturating_add(length);
        }
        total_size = files.iter().map(|f| f.length).sum();
    } else if let Some(length) = info_val
        .get(b"length".as_slice())
        .and_then(|v| v.as_int())
        .filter(|&n| n >= 0)
    {
        let len_u64 = length as u64;
        files.push(TorrentFileEntry {
            path: name.clone(),
            length: len_u64,
            offset: 0,
        });
        total_size = len_u64;
    } else if let Some(file_tree) = info_val.get(b"file tree".as_slice()).and_then(|v| v.as_dict()) {
        // BEP-52 BitTorrent v2 'file tree' dictionary traversal
        let mut offset = 0u64;
        collect_bep52_file_tree(file_tree, &mut Vec::new(), &mut offset, &mut files);
        total_size = files.iter().map(|f| f.length).sum();
    } else {
        return Err("Torrent is missing valid 'length', 'files', or 'file tree'".to_string());
    }

    if piece_hashes.is_empty() && total_size > 0 && piece_length > 0 {
        let synth_count = total_size.div_ceil(piece_length).min(4096) as usize;
        piece_hashes = vec![[0u8; 20]; synth_count];
    }

    let mut trackers = Vec::new();
    if let Some(announce) = root_dict
        .get(b"announce".as_slice())
        .and_then(|v| v.as_str_lossy())
    {
        if !announce.trim().is_empty() {
            trackers.push(announce.trim().to_string());
        }
    }
    if let Some(tiers) = root_dict
        .get(b"announce-list".as_slice())
        .and_then(|v| v.as_list())
    {
        for tier in tiers {
            if let Some(list) = tier.as_list() {
                for item in list {
                    if let Some(tr) = item.as_str_lossy() {
                        let clean = tr.trim().to_string();
                        if !clean.is_empty() && !trackers.contains(&clean) {
                            trackers.push(clean);
                        }
                    }
                }
            }
        }
    }

    let comment = root_dict
        .get(b"comment".as_slice())
        .and_then(|v| v.as_str_lossy());
    let is_private = info_val
        .get(b"private".as_slice())
        .and_then(|v| v.as_int())
        .unwrap_or(0)
        == 1;

    Ok(ParsedTorrent {
        name,
        info_hash,
        info_hash_bytes,
        total_size,
        piece_length,
        piece_hashes,
        trackers,
        files,
        comment,
        is_private,
        info_bytes: info_slice.to_vec(),
    })
}

fn collect_bep52_file_tree(
    node: &BTreeMap<Vec<u8>, BencodeValue>,
    prefix: &mut Vec<String>,
    offset: &mut u64,
    out: &mut Vec<TorrentFileEntry>,
) {
    if let Some(leaf) = node.get(b"".as_slice()).and_then(|v| v.as_dict()) {
        if let Some(length) = leaf
            .get(b"length".as_slice())
            .and_then(|v| v.as_int())
            .filter(|&n| n >= 0)
        {
            let len_u64 = length as u64;
            let rel_path = if prefix.is_empty() {
                "file.bin".to_string()
            } else {
                prefix.join("/")
            };
            let is_padding = leaf
                .get(b"attr".as_slice())
                .and_then(|v| v.as_str_lossy())
                .map(|a| a.contains('p'))
                .unwrap_or(false)
                || prefix.first().map(|p| p == ".pad").unwrap_or(false)
                || rel_path.starts_with(".pad/");
            if !is_padding {
                out.push(TorrentFileEntry {
                    path: rel_path,
                    length: len_u64,
                    offset: *offset,
                });
            }
            *offset = offset.saturating_add(len_u64);
        }
        return;
    }

    for (k, v) in node {
        if k.is_empty() {
            continue;
        }
        if let Some(child_dict) = v.as_dict() {
            let seg = String::from_utf8_lossy(k).into_owned();
            prefix.push(seg);
            collect_bep52_file_tree(child_dict, prefix, offset, out);
            prefix.pop();
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreatedTorrentResult {
    pub output_path: String,
    pub info_hash: String,
    pub name: String,
    pub total_size: u64,
    pub piece_length: usize,
    pub piece_count: usize,
    pub file_count: usize,
}

pub fn create_torrent(
    source_path: &Path,
    output_path: &Path,
    trackers: &[String],
    requested_piece_length: usize,
    comment: Option<&str>,
    is_private: bool,
) -> Result<CreatedTorrentResult, String> {
    if !source_path.exists() {
        return Err(format!(
            "Source path does not exist: {}",
            source_path.display()
        ));
    }

    let source_name = source_path
        .file_name()
        .map(|s| s.to_string_lossy().into_owned())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "FlowDown-Payload".to_string());

    let mut file_entries: Vec<(PathBuf, Vec<String>, u64)> = Vec::new();
    let is_dir = source_path.is_dir();

    if is_dir {
        collect_files_recursive(source_path, source_path, &mut file_entries)?;
        file_entries.sort_by(|a, b| a.1.cmp(&b.1));
    } else {
        let len = std::fs::metadata(source_path)
            .map_err(|e| format!("Failed to read source metadata: {}", e))?
            .len();
        file_entries.push((source_path.to_path_buf(), vec![source_name.clone()], len));
    }

    if file_entries.is_empty() {
        return Err("Source directory contains no files".to_string());
    }

    let total_size: u64 = file_entries.iter().map(|f| f.2).sum();
    let piece_length = if requested_piece_length >= 16 * 1024 {
        requested_piece_length
    } else {
        auto_piece_length(total_size)
    };

    // Stream all files sequentially in piece_length chunks to build SHA-1 piece hashes
    let mut pieces_concat = Vec::new();
    let mut buf = vec![0u8; piece_length];
    let mut filled = 0usize;

    for (abs_path, _, _) in &file_entries {
        let mut f = File::open(abs_path)
            .map_err(|e| format!("Failed to open '{}': {}", abs_path.display(), e))?;
        loop {
            let n = f
                .read(&mut buf[filled..])
                .map_err(|e| format!("Failed to read '{}': {}", abs_path.display(), e))?;
            if n == 0 {
                break;
            }
            filled += n;
            if filled == piece_length {
                let h = digest(&SHA1_FOR_LEGACY_USE_ONLY, &buf[..filled]);
                pieces_concat.extend_from_slice(h.as_ref());
                filled = 0;
            }
        }
    }
    if filled > 0 {
        let h = digest(&SHA1_FOR_LEGACY_USE_ONLY, &buf[..filled]);
        pieces_concat.extend_from_slice(h.as_ref());
    }

    let piece_count = pieces_concat.len() / 20;

    let mut info_dict = BTreeMap::new();
    info_dict.insert(b"name".to_vec(), BencodeValue::Bytes(source_name.as_bytes().to_vec()));
    info_dict.insert(b"piece length".to_vec(), BencodeValue::Int(piece_length as i64));
    info_dict.insert(b"pieces".to_vec(), BencodeValue::Bytes(pieces_concat));
    if is_private {
        info_dict.insert(b"private".to_vec(), BencodeValue::Int(1));
    }

    if is_dir {
        let mut list = Vec::with_capacity(file_entries.len());
        for (_, rel_parts, len) in &file_entries {
            let mut fdict = BTreeMap::new();
            fdict.insert(b"length".to_vec(), BencodeValue::Int(*len as i64));
            let path_vals = rel_parts
                .iter()
                .map(|p| BencodeValue::Bytes(p.as_bytes().to_vec()))
                .collect();
            fdict.insert(b"path".to_vec(), BencodeValue::List(path_vals));
            list.push(BencodeValue::Dict(fdict));
        }
        info_dict.insert(b"files".to_vec(), BencodeValue::List(list));
    } else {
        info_dict.insert(b"length".to_vec(), BencodeValue::Int(total_size as i64));
    }

    let info_val = BencodeValue::Dict(info_dict);
    let encoded_info = info_val.encode();
    let info_hash_digest = digest(&SHA1_FOR_LEGACY_USE_ONLY, &encoded_info);
    let info_hash = hex_encode(info_hash_digest.as_ref());

    let mut root_dict = BTreeMap::new();
    let clean_trackers: Vec<String> = trackers
        .iter()
        .map(|t| t.trim().to_string())
        .filter(|t| !t.is_empty())
        .collect();

    if let Some(first) = clean_trackers.first() {
        root_dict.insert(
            b"announce".to_vec(),
            BencodeValue::Bytes(first.as_bytes().to_vec()),
        );
        if clean_trackers.len() > 1 {
            let tiers: Vec<BencodeValue> = clean_trackers
                .iter()
                .map(|tr| BencodeValue::List(vec![BencodeValue::Bytes(tr.as_bytes().to_vec())]))
                .collect();
            root_dict.insert(b"announce-list".to_vec(), BencodeValue::List(tiers));
        }
    }

    if let Some(c) = comment.map(str::trim).filter(|c| !c.is_empty()) {
        root_dict.insert(b"comment".to_vec(), BencodeValue::Bytes(c.as_bytes().to_vec()));
    }

    let created_ts = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);
    root_dict.insert(b"creation date".to_vec(), BencodeValue::Int(created_ts));
    root_dict.insert(
        b"created by".to_vec(),
        BencodeValue::Bytes(b"FlowDown 2.0.0".to_vec()),
    );
    root_dict.insert(b"info".to_vec(), info_val);

    if let Some(parent) = output_path.parent() {
        if !parent.as_os_str().is_empty() {
            std::fs::create_dir_all(parent)
                .map_err(|e| format!("Failed to create output directory: {}", e))?;
        }
    }

    let encoded_root = BencodeValue::Dict(root_dict).encode();
    std::fs::write(output_path, &encoded_root)
        .map_err(|e| format!("Failed to write torrent file: {}", e))?;

    Ok(CreatedTorrentResult {
        output_path: output_path.to_string_lossy().into_owned(),
        info_hash,
        name: source_name,
        total_size,
        piece_length,
        piece_count,
        file_count: file_entries.len(),
    })
}

fn collect_files_recursive(
    root: &Path,
    dir: &Path,
    out: &mut Vec<(PathBuf, Vec<String>, u64)>,
) -> Result<(), String> {
    let entries = std::fs::read_dir(dir)
        .map_err(|e| format!("Failed to read directory '{}': {}", dir.display(), e))?;
    for entry in entries {
        let entry = entry.map_err(|e| format!("Directory entry error: {}", e))?;
        let path = entry.path();
        if path.is_dir() {
            collect_files_recursive(root, &path, out)?;
        } else if path.is_file() {
            let rel = path
                .strip_prefix(root)
                .map_err(|e| format!("Path prefix error: {}", e))?;
            let parts: Vec<String> = rel
                .components()
                .map(|c| c.as_os_str().to_string_lossy().into_owned())
                .collect();
            let len = std::fs::metadata(&path)
                .map_err(|e| format!("Metadata error for '{}': {}", path.display(), e))?
                .len();
            out.push((path, parts, len));
        }
    }
    Ok(())
}

fn auto_piece_length(total_size: u64) -> usize {
    if total_size <= 16 * 1024 * 1024 {
        32 * 1024
    } else if total_size <= 128 * 1024 * 1024 {
        128 * 1024
    } else if total_size <= 512 * 1024 * 1024 {
        256 * 1024
    } else if total_size <= 2 * 1024 * 1024 * 1024 {
        512 * 1024
    } else if total_size <= 8 * 1024 * 1024 * 1024 {
        1024 * 1024
    } else {
        2 * 1024 * 1024
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ResolvedMagnet {
    pub info_hash: String,
    pub info_hash_bytes: [u8; 20],
    pub name: String,
    pub size: u64,
    pub trackers: Vec<String>,
    pub magnet_uri: String,
}

pub fn parse_magnet_or_hash(raw_input: &str) -> Result<ResolvedMagnet, String> {
    let raw = raw_input.trim();
    if raw.is_empty() {
        return Err("Magnet URI or Info Hash is required".to_string());
    }

    let mut info_hash = String::new();
    let mut name = String::new();
    let mut exact_length: u64 = 0;
    let mut trackers = Vec::new();

    if raw.len() == 40 && raw.chars().all(|c| c.is_ascii_hexdigit()) {
        info_hash = raw.to_lowercase();
    } else if raw.len() == 32 && is_valid_base32(raw) {
        info_hash = base32_to_hex(raw)?;
    } else if raw.to_ascii_lowercase().starts_with("magnet:?") {
        let query = &raw[8..];
        for part in query.split('&') {
            let Some((k, v)) = part.split_once('=') else {
                continue;
            };
            let key = k.to_ascii_lowercase();
            let decoded = percent_decode(v);
            match key.as_str() {
                "xt" => {
                    if let Some(btih) = extract_btih(&decoded) {
                        info_hash = btih;
                    }
                }
                "dn" if name.is_empty() => {
                    let trimmed = decoded.trim();
                    if !trimmed.is_empty() {
                        name = trimmed.to_string();
                    }
                }
                "xl" => {
                    if let Ok(len) = decoded.trim().parse::<u64>() {
                        exact_length = len;
                    }
                }
                "tr" => {
                    let tr = decoded.trim();
                    if !tr.is_empty() && !trackers.contains(&tr.to_string()) {
                        trackers.push(tr.to_string());
                    }
                }
                _ => {}
            }
        }
    } else {
        // Handle web download URLs containing a 40-char SHA-1 hex hash or 32-char Base32 hash
        // (e.g. https://yts.gg/torrent/download/785C930838F4111CD1AFFD9B4B2DAA2588D1D2EA)
        for part in raw.split(|c: char| !c.is_ascii_alphanumeric()) {
            if part.len() == 40 && part.chars().all(|c| c.is_ascii_hexdigit()) {
                info_hash = part.to_lowercase();
                break;
            } else if part.len() == 32 && is_valid_base32(part) {
                if let Ok(h) = base32_to_hex(part) {
                    info_hash = h;
                    break;
                }
            }
        }

        if !info_hash.is_empty() && name.is_empty() {
            if let Some(stripped) = raw.strip_prefix("http://").or_else(|| raw.strip_prefix("https://")) {
                let path_start = stripped.find('/').unwrap_or(stripped.len());
                let host = &stripped[..path_start];
                let path = &stripped[path_start..];
                if let Some(last_seg) = path.split('/').filter(|s| !s.is_empty()).last() {
                    let clean = last_seg.split('?').next().unwrap_or(last_seg);
                    if !clean.is_empty() && !clean.chars().all(|c| c.is_ascii_hexdigit()) {
                        name = clean.trim_end_matches(".torrent").replace(['+', '_', '.'], " ");
                    }
                }
                if name.is_empty() && !host.is_empty() {
                    name = format!("{}-{}", host.trim_start_matches("www."), &info_hash[..10]);
                }
            }
        }
    }

    if info_hash.len() != 40 {
        return Err(
            "Invalid Magnet URI or BTIH Info Hash (expected magnet:?xt=urn:btih:... or 40-char hex hash)".to_string(),
        );
    }

    let info_hash_bytes = hex_decode_20(&info_hash)?;
    if name.is_empty() {
        name = format!("Swarm-{}", &info_hash[..10]);
    }
    let default_trackers = [
        "udp://tracker.opentrackr.org:1337/announce",
        "udp://open.stealth.si:80/announce",
        "udp://tracker.torrent.eu.org:451/announce",
        "udp://exodus.desync.com:6969/announce",
        "udp://open.demonii.com:1337/announce",
        "http://tracker.opentrackr.org:1337/announce",
    ];
    for dt in default_trackers {
        if !trackers.iter().any(|t| t.eq_ignore_ascii_case(dt)) {
            trackers.push(dt.to_string());
        }
    }

    let magnet_uri = if raw.to_ascii_lowercase().starts_with("magnet:?") {
        raw.to_string()
    } else {
        format!(
            "magnet:?xt=urn:btih:{}&dn={}{}",
            info_hash,
            percent_encode(&name),
            if exact_length > 0 {
                format!("&xl={}", exact_length)
            } else {
                String::new()
            }
        )
    };

    Ok(ResolvedMagnet {
        info_hash,
        info_hash_bytes,
        name,
        size: exact_length,
        trackers,
        magnet_uri,
    })
}

fn extract_btih(s: &str) -> Option<String> {
    let lower = s.to_ascii_lowercase();
    let idx = lower.find("urn:btih:")?;
    let token = s[idx + 9..].trim();
    if token.len() == 40 && token.chars().all(|c| c.is_ascii_hexdigit()) {
        Some(token.to_ascii_lowercase())
    } else if token.len() == 32 && is_valid_base32(token) {
        base32_to_hex(token).ok()
    } else {
        None
    }
}

fn is_valid_base32(s: &str) -> bool {
    s.bytes().all(|b| matches!(b, b'A'..=b'Z' | b'a'..=b'z' | b'2'..=b'7'))
}

fn base32_to_hex(input: &str) -> Result<String, String> {
    let mut buffer: u32 = 0;
    let mut bits_left: u8 = 0;
    let mut out = Vec::with_capacity(20);

    for ch in input.bytes() {
        let val: u32 = match ch {
            b'A'..=b'Z' => (ch - b'A') as u32,
            b'a'..=b'z' => (ch - b'a') as u32,
            b'2'..=b'7' => (ch - b'2' + 26) as u32,
            _ => return Err("Invalid Base32 BTIH hash".to_string()),
        };
        buffer = (buffer << 5) | val;
        bits_left += 5;
        if bits_left >= 8 {
            bits_left -= 8;
            out.push(((buffer >> bits_left) & 0xFF) as u8);
        }
    }

    if out.len() != 20 {
        return Err("Decoded Base32 BTIH hash is not 20 bytes".to_string());
    }
    Ok(hex_encode(&out))
}

pub fn hex_encode(bytes: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut out = String::with_capacity(bytes.len() * 2);
    for &b in bytes {
        out.push(HEX[(b >> 4) as usize] as char);
        out.push(HEX[(b & 0x0f) as usize] as char);
    }
    out
}

pub fn hex_decode_20(hex: &str) -> Result<[u8; 20], String> {
    if hex.len() != 40 {
        return Err("Info hash hex must be 40 characters".to_string());
    }
    let bytes = hex.as_bytes();
    let mut out = [0u8; 20];
    for i in 0..20 {
        let hi = from_hex_nibble(bytes[i * 2])?;
        let lo = from_hex_nibble(bytes[i * 2 + 1])?;
        out[i] = (hi << 4) | lo;
    }
    Ok(out)
}

fn from_hex_nibble(b: u8) -> Result<u8, String> {
    match b {
        b'0'..=b'9' => Ok(b - b'0'),
        b'a'..=b'f' => Ok(b - b'a' + 10),
        b'A'..=b'F' => Ok(b - b'A' + 10),
        _ => Err("Invalid hex character".to_string()),
    }
}

pub fn percent_decode(input: &str) -> String {
    let raw = input.replace('+', " ");
    let bytes = raw.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let (Ok(hi), Ok(lo)) = (from_hex_nibble(bytes[i + 1]), from_hex_nibble(bytes[i + 2])) {
                out.push((hi << 4) | lo);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

pub fn percent_encode(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    for b in input.bytes() {
        if b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_' | b'.' | b'~') {
            out.push(b as char);
        } else {
            out.push_str(&format!("%{:02X}", b));
        }
    }
    out
}

pub fn percent_encode_bytes(bytes: &[u8]) -> String {
    let mut out = String::with_capacity(bytes.len() * 3);
    for &b in bytes {
        if b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_' | b'.' | b'~') {
            out.push(b as char);
        } else {
            out.push_str(&format!("%{:02X}", b));
        }
    }
    out
}

pub fn decode_base64(input: &str) -> Result<Vec<u8>, String> {
    let clean: Vec<u8> = input
        .bytes()
        .filter(|b| !b.is_ascii_whitespace())
        .collect();
    if clean.len() % 4 != 0 {
        return Err("Invalid base64 length".to_string());
    }
    let mut out = Vec::with_capacity((clean.len() / 4) * 3);
    for chunk in clean.chunks_exact(4) {
        let mut vals = [0u8; 4];
        let mut pad = 0;
        for (i, &c) in chunk.iter().enumerate() {
            if c == b'=' {
                pad += 1;
                vals[i] = 0;
            } else {
                vals[i] = match c {
                    b'A'..=b'Z' => c - b'A',
                    b'a'..=b'z' => c - b'a' + 26,
                    b'0'..=b'9' => c - b'0' + 52,
                    b'+' => 62,
                    b'/' => 63,
                    _ => return Err("Invalid character in base64 data".to_string()),
                };
            }
        }
        out.push((vals[0] << 2) | (vals[1] >> 4));
        if pad < 2 {
            out.push((vals[1] << 4) | (vals[2] >> 2));
        }
        if pad < 1 {
            out.push((vals[2] << 6) | vals[3]);
        }
    }
    Ok(out)
}
