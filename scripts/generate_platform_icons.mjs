import fs from 'fs';
import path from 'path';

// 1. Build Apple ICNS file containing PNG payloads for modern macOS
async function createIcns(pngBuffer, outPath, sharpModule) {
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
    const pngBuf = await sharpModule(pngBuffer)
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

// 2. Generate Linux hicolor theme mimetype icons
async function generateLinuxMimeIcons(pngBuffer, mimeBaseName, outDir, sharpModule) {
  const sizes = [16, 32, 48, 64, 128, 256];
  for (const s of sizes) {
    const targetDir = path.join(outDir, `${s}x${s}`, 'mimetypes');
    fs.mkdirSync(targetDir, { recursive: true });
    const targetPath = path.join(targetDir, `${mimeBaseName}.png`);
    await sharpModule(pngBuffer)
      .resize(s, s, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toFile(targetPath);
    console.log(`Generated Linux icon: ${targetPath}`);
  }
}

// 3. Generate Linux Breeze theme mimetype icons (KDE Plasma)
async function generateBreezeMimeIcons(pngBuffer, mimeBaseName, themeName, sharpModule) {
  const sizes = [16, 22, 24, 32, 64];
  for (const s of sizes) {
    const targetDir = path.join('src-tauri/linux/icons', themeName, 'mimetypes', `${s}`);
    fs.mkdirSync(targetDir, { recursive: true });
    const targetPath = path.join(targetDir, `${mimeBaseName}.png`);
    await sharpModule(pngBuffer)
      .resize(s, s, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toFile(targetPath);
    console.log(`Generated Breeze icon: ${targetPath}`);
  }
}

// 4. Copy Scalable SVGs
function deployScalableSvgs() {
  const hicolorScalable = 'src-tauri/linux/icons/hicolor/scalable/mimetypes';
  fs.mkdirSync(hicolorScalable, { recursive: true });
  fs.copyFileSync('src-tauri/icons/torrent.svg', path.join(hicolorScalable, 'application-x-bittorrent.svg'));
  fs.copyFileSync('src-tauri/icons/torrent.svg', path.join(hicolorScalable, 'x-bittorrent.svg'));
  fs.copyFileSync('src-tauri/icons/magnet.svg', path.join(hicolorScalable, 'x-scheme-handler-magnet.svg'));

  for (const theme of ['breeze', 'breeze-dark']) {
    const breeze64 = path.join('src-tauri/linux/icons', theme, 'mimetypes', '64');
    fs.mkdirSync(breeze64, { recursive: true });
    fs.copyFileSync('src-tauri/icons/torrent.svg', path.join(breeze64, 'application-x-bittorrent.svg'));
    fs.copyFileSync('src-tauri/icons/torrent.svg', path.join(breeze64, 'x-bittorrent.svg'));
    fs.copyFileSync('src-tauri/icons/magnet.svg', path.join(breeze64, 'x-scheme-handler-magnet.svg'));
  }
  console.log('Deployed scalable SVGs to Hicolor, Breeze, and Breeze-Dark.');
}

async function main() {
  let sharpModule;
  try {
    const imported = await import('sharp');
    sharpModule = imported.default || imported;
  } catch {
    console.log('Sharp not installed; relying on Python icon generator for raster icons.');
  }

  // Always deploy SVGs
  deployScalableSvgs();

  if (sharpModule) {
    const torrentPng = fs.readFileSync('src-tauri/icons/torrent.png');
    const magnetPng = fs.readFileSync('src-tauri/icons/magnet.png');

    await createIcns(torrentPng, 'src-tauri/icons/torrent.icns', sharpModule);
    await createIcns(magnetPng, 'src-tauri/icons/magnet.icns', sharpModule);

    const linuxIconsBase = 'src-tauri/linux/icons/hicolor';
    await generateLinuxMimeIcons(torrentPng, 'application-x-bittorrent', linuxIconsBase, sharpModule);
    await generateLinuxMimeIcons(torrentPng, 'x-bittorrent', linuxIconsBase, sharpModule);
    await generateLinuxMimeIcons(magnetPng, 'x-scheme-handler-magnet', linuxIconsBase, sharpModule);

    for (const theme of ['breeze', 'breeze-dark']) {
      await generateBreezeMimeIcons(torrentPng, 'application-x-bittorrent', theme, sharpModule);
      await generateBreezeMimeIcons(torrentPng, 'x-bittorrent', theme, sharpModule);
      await generateBreezeMimeIcons(magnetPng, 'x-scheme-handler-magnet', theme, sharpModule);
    }
  }

  console.log('All platform icon assets successfully processed.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
