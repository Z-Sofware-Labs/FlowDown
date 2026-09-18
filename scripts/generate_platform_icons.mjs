import fs from 'fs';
import path from 'path';
import sharp from 'sharp';

// 1. Extract raw 32-bit BGRA bitmap from Windows .ico and convert to RGBA Sharp image
function extractRgbaFromIco(icoPath) {
  const buf = fs.readFileSync(icoPath);
  const count = buf.readUInt16LE(4);
  let bestEntry = null;
  let maxDim = 0;
  for (let i = 0; i < count; i++) {
    const offset = 6 + i * 16;
    const w = buf[offset] === 0 ? 256 : buf[offset];
    const h = buf[offset + 1] === 0 ? 256 : buf[offset + 1];
    const size = buf.readUInt32LE(offset + 8);
    const imgOffset = buf.readUInt32LE(offset + 12);
    if (w >= maxDim) {
      maxDim = w;
      bestEntry = { w, h, size, imgOffset, data: buf.subarray(imgOffset, imgOffset + size) };
    }
  }

  const headerSize = bestEntry.data.readUInt32LE(0);
  const width = bestEntry.data.readInt32LE(4);
  const height = bestEntry.data.readInt32LE(8) / 2;
  const bpp = bestEntry.data.readUInt16LE(14);
  if (bpp !== 32) {
    throw new Error(`Expected 32 bpp, got ${bpp}`);
  }

  const pixelBytes = width * height * 4;
  const rawBgra = bestEntry.data.subarray(headerSize, headerSize + pixelBytes);
  const rgba = Buffer.alloc(pixelBytes);

  for (let row = 0; row < height; row++) {
    const srcRow = height - 1 - row;
    for (let col = 0; col < width; col++) {
      const srcIdx = (srcRow * width + col) * 4;
      const dstIdx = (row * width + col) * 4;
      rgba[dstIdx] = rawBgra[srcIdx + 2];     // R
      rgba[dstIdx + 1] = rawBgra[srcIdx + 1]; // G
      rgba[dstIdx + 2] = rawBgra[srcIdx];     // B
      rgba[dstIdx + 3] = rawBgra[srcIdx + 3]; // A
    }
  }

  return sharp(rgba, { raw: { width, height, channels: 4 } });
}

// 2. Build Apple ICNS file containing PNG payloads for modern macOS
// OSType mappings for PNG chunks:
// icp4: 16x16
// icp5: 32x32
// icp6: 64x64
// ic07: 128x128
// ic08: 256x256
// ic11: 16x16@2x (32x32)
// ic12: 32x32@2x (64x64)
// ic13: 128x128@2x (256x256)
async function createIcns(sharpImage, outPath) {
  const iconDefs = [
    { type: 'icp4', size: 16 },
    { type: 'icp5', size: 32 },
    { type: 'ic11', size: 32 },
    { type: 'icp6', size: 64 },
    { type: 'ic12', size: 64 },
    { type: 'ic07', size: 128 },
    { type: 'ic08', size: 256 },
    { type: 'ic13', size: 256 },
  ];

  const chunks = [];
  let totalDataLength = 8; // 'icns' (4) + file length (4)

  for (const def of iconDefs) {
    const pngBuf = await sharpImage
      .clone()
      .resize(def.size, def.size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toBuffer();

    const chunkLen = 8 + pngBuf.length;
    totalDataLength += chunkLen;

    const chunkHeader = Buffer.alloc(8);
    chunkHeader.write(def.type, 0, 4, 'ascii');
    chunkHeader.writeUInt32BE(chunkLen, 4);
    chunks.push(Buffer.concat([chunkHeader, pngBuf]));
  }

  const fileHeader = Buffer.alloc(8);
  fileHeader.write('icns', 0, 4, 'ascii');
  fileHeader.writeUInt32BE(totalDataLength, 4);

  const icnsBuffer = Buffer.concat([fileHeader, ...chunks]);
  fs.writeFileSync(outPath, icnsBuffer);
  console.log(`Generated ICNS: ${outPath} (${icnsBuffer.length} bytes)`);
}

// 3. Generate Linux hicolor theme mimetype icons
// Freedesktop specification:
// /usr/share/icons/hicolor/{size}x{size}/mimetypes/{name}.png
async function generateLinuxMimeIcons(sharpImage, mimeBaseName, outDir) {
  const sizes = [16, 32, 48, 64, 128, 256];
  for (const s of sizes) {
    const targetDir = path.join(outDir, `${s}x${s}`, 'mimetypes');
    fs.mkdirSync(targetDir, { recursive: true });
    const targetPath = path.join(targetDir, `${mimeBaseName}.png`);
    await sharpImage
      .clone()
      .resize(s, s, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toFile(targetPath);
    console.log(`Generated Linux icon: ${targetPath}`);
  }
}

async function main() {
  const torrentSharp = extractRgbaFromIco('src-tauri/icons/torrent.ico');
  const magnetSharp = extractRgbaFromIco('src-tauri/icons/magnet.ico');

  // Generate macOS .icns files
  await createIcns(torrentSharp, 'src-tauri/icons/torrent.icns');
  await createIcns(magnetSharp, 'src-tauri/icons/magnet.icns');

  // Generate Linux hicolor icons
  const linuxIconsBase = 'src-tauri/linux/icons/hicolor';
  await generateLinuxMimeIcons(torrentSharp, 'application-x-bittorrent', linuxIconsBase);
  await generateLinuxMimeIcons(torrentSharp, 'x-bittorrent', linuxIconsBase);
  await generateLinuxMimeIcons(magnetSharp, 'x-scheme-handler-magnet', linuxIconsBase);

  console.log('All platform icon assets successfully generated.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
