export interface TorrentFileDetail {
  path: string;
  size: number;
}

export interface ParsedTorrentInfo {
  name: string;
  totalSize: number;
  fileCount: number;
  isMultiFile: boolean;
  files: TorrentFileDetail[];
  infoHash?: string;
}

/**
 * Decodes a Bencoded Uint8Array or ArrayBuffer into JavaScript objects
 */
export function decodeBencode(input: ArrayBuffer | Uint8Array): any {
  const buf = input instanceof Uint8Array ? input : new Uint8Array(input);
  let pos = 0;

  function readNext(): any {
    if (pos >= buf.length) throw new Error('Unexpected end of bencoded data');
    const byte = buf[pos];

    // Integer: i<number>e
    if (byte === 105 /* 'i' */) {
      pos++;
      const end = buf.indexOf(101 /* 'e' */, pos);
      if (end === -1) throw new Error('Unterminated integer');
      const numStr = new TextDecoder().decode(buf.subarray(pos, end));
      pos = end + 1;
      return parseInt(numStr, 10);
    }

    // List: l<items>e
    if (byte === 108 /* 'l' */) {
      pos++;
      const list: any[] = [];
      while (pos < buf.length && buf[pos] !== 101 /* 'e' */) {
        list.push(readNext());
      }
      pos++; // skip 'e'
      return list;
    }

    // Dictionary: d<key><value>e
    if (byte === 100 /* 'd' */) {
      pos++;
      const dict: Record<string, any> = {};
      while (pos < buf.length && buf[pos] !== 101 /* 'e' */) {
        const keyRaw = readNext();
        const key = typeof keyRaw === 'string' ? keyRaw : new TextDecoder().decode(keyRaw);
        const val = readNext();
        dict[key] = val;
      }
      pos++; // skip 'e'
      return dict;
    }

    // Byte String: <length>:<bytes>
    if (byte >= 48 && byte <= 57 /* '0' - '9' */) {
      const colon = buf.indexOf(58 /* ':' */, pos);
      if (colon === -1) throw new Error('Invalid bencode string specifier');
      const len = parseInt(new TextDecoder().decode(buf.subarray(pos, colon)), 10);
      pos = colon + 1;
      const strBytes = buf.subarray(pos, pos + len);
      pos += len;
      return strBytes;
    }

    throw new Error(`Unknown bencode token byte: ${byte} at position ${pos}`);
  }

  return readNext();
}

/**
 * Helper to convert Uint8Array / string / Array to string
 */
function toStr(val: any): string {
  if (typeof val === 'string') return val;
  if (val instanceof Uint8Array) return new TextDecoder().decode(val);
  return String(val || '');
}

/**
 * Parses a .torrent binary buffer and extracts full directory / multi-file / single-file details
 */
export function parseTorrentBuffer(buffer: ArrayBuffer | Uint8Array): ParsedTorrentInfo {
  const decoded = decodeBencode(buffer);
  const info = decoded?.info || decoded;

  if (!info) {
    throw new Error('Invalid .torrent file structure: missing info dictionary');
  }

  const name = toStr(info.name) || 'Torrent Download Directory';

  // Multi-file Directory
  if (Array.isArray(info.files) && info.files.length > 0) {
    let totalSize = 0;
    const files: TorrentFileDetail[] = [];

    for (const fileObj of info.files) {
      const size = typeof fileObj.length === 'number' ? fileObj.length : 0;
      totalSize += size;

      let relativePath = '';
      if (Array.isArray(fileObj.path)) {
        relativePath = fileObj.path.map((p: any) => toStr(p)).join('/');
      } else if (fileObj.path) {
        relativePath = toStr(fileObj.path);
      }

      files.push({
        path: relativePath || `file_${files.length + 1}`,
        size,
      });
    }

    return {
      name,
      totalSize,
      fileCount: files.length,
      isMultiFile: true,
      files,
    };
  }

  // Single File
  const totalSize = typeof info.length === 'number' ? info.length : 0;
  return {
    name,
    totalSize,
    fileCount: 1,
    isMultiFile: false,
    files: [{ path: name, size: totalSize }],
  };
}
