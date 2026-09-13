import sharp from 'sharp';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const src = path.resolve(__dirname, '../src-tauri/icons/icon_source.png');
const iconsDir = path.resolve(__dirname, '../src-tauri/icons');

const pngSizes = [
  { name: '32x32.png',             size: 32  },
  { name: '64x64.png',             size: 64  },
  { name: '128x128.png',           size: 128 },
  { name: '128x128@2x.png',        size: 256 },
  { name: 'icon.png',              size: 512 },
  // Windows Square logos
  { name: 'Square30x30Logo.png',   size: 30  },
  { name: 'Square44x44Logo.png',   size: 44  },
  { name: 'Square71x71Logo.png',   size: 71  },
  { name: 'Square89x89Logo.png',   size: 89  },
  { name: 'Square107x107Logo.png', size: 107 },
  { name: 'Square142x142Logo.png', size: 142 },
  { name: 'Square150x150Logo.png', size: 150 },
  { name: 'Square284x284Logo.png', size: 284 },
  { name: 'Square310x310Logo.png', size: 310 },
  { name: 'StoreLogo.png',         size: 50  },
];

console.log('Generating PNG icons...');
for (const { name, size } of pngSizes) {
  await sharp(src).resize(size, size).png().toFile(path.join(iconsDir, name));
  console.log(`  ✓ ${name} (${size}x${size})`);
}

// Generate ICO (multi-size Windows icon)
console.log('\nGenerating icon.ico...');
const icoSizes = [16, 24, 32, 48, 64, 128, 256];
const icoBuffers = await Promise.all(
  icoSizes.map(s => sharp(src).resize(s, s).png().toBuffer())
);

// Build ICO file manually
function buildIco(pngBuffers) {
  const count = pngBuffers.length;
  const headerSize = 6;
  const dirEntrySize = 16;
  const dirSize = headerSize + count * dirEntrySize;

  let dataOffset = dirSize;
  const entries = pngBuffers.map((buf, i) => {
    const w = icoSizes[i];
    const entry = { width: w > 255 ? 0 : w, height: w > 255 ? 0 : w, buf, offset: dataOffset };
    dataOffset += buf.length;
    return entry;
  });

  const totalSize = dataOffset;
  const ico = Buffer.alloc(totalSize);

  // ICONDIR header
  ico.writeUInt16LE(0, 0);     // reserved
  ico.writeUInt16LE(1, 2);     // type: icon
  ico.writeUInt16LE(count, 4); // count

  let dirPos = 6;
  for (const e of entries) {
    ico.writeUInt8(e.width, dirPos);       // width
    ico.writeUInt8(e.height, dirPos + 1);  // height
    ico.writeUInt8(0, dirPos + 2);         // color count
    ico.writeUInt8(0, dirPos + 3);         // reserved
    ico.writeUInt16LE(1, dirPos + 4);      // planes
    ico.writeUInt16LE(32, dirPos + 6);     // bit count
    ico.writeUInt32LE(e.buf.length, dirPos + 8);  // bytes in image
    ico.writeUInt32LE(e.offset, dirPos + 12);     // offset
    dirPos += 16;

    e.buf.copy(ico, e.offset);
  }
  return ico;
}

const icoBuffer = buildIco(icoBuffers);
fs.writeFileSync(path.join(iconsDir, 'icon.ico'), icoBuffer);
console.log('  ✓ icon.ico');

// Generate ICNS (macOS) - embed 512x512 and 256x256 as ic09/ic08
console.log('\nGenerating icon.icns...');
const icnsSizes = [
  { ostype: 'icp4', size: 16 },
  { ostype: 'icp5', size: 32 },
  { ostype: 'icp6', size: 64 },
  { ostype: 'ic07', size: 128 },
  { ostype: 'ic08', size: 256 },
  { ostype: 'ic09', size: 512 },
  { ostype: 'ic10', size: 1024 },
  { ostype: 'ic11', size: 32 },   // @2x of 16
  { ostype: 'ic12', size: 64 },   // @2x of 32
  { ostype: 'ic13', size: 256 },  // @2x of 128
  { ostype: 'ic14', size: 512 },  // @2x of 256
];

const icnsBuffers = await Promise.all(
  icnsSizes.map(({ size }) => sharp(src).resize(size, size).png().toBuffer())
);

function buildIcns(sizes, buffers) {
  const chunks = sizes.map(({ ostype }, i) => {
    const buf = buffers[i];
    const chunk = Buffer.alloc(8 + buf.length);
    chunk.write(ostype, 0, 'ascii');
    chunk.writeUInt32BE(8 + buf.length, 4);
    buf.copy(chunk, 8);
    return chunk;
  });

  const totalData = chunks.reduce((a, c) => a + c.length, 0);
  const header = Buffer.alloc(8);
  header.write('icns', 0, 'ascii');
  header.writeUInt32BE(8 + totalData, 4);
  return Buffer.concat([header, ...chunks]);
}

const icnsBuffer = buildIcns(icnsSizes, icnsBuffers);
fs.writeFileSync(path.join(iconsDir, 'icon.icns'), icnsBuffer);
console.log('  ✓ icon.icns');

// Android icons
const androidDir = path.join(iconsDir, 'android');
const androidSizes = [
  { dir: 'mipmap-mdpi',    size: 48  },
  { dir: 'mipmap-hdpi',    size: 72  },
  { dir: 'mipmap-xhdpi',   size: 96  },
  { dir: 'mipmap-xxhdpi',  size: 144 },
  { dir: 'mipmap-xxxhdpi', size: 192 },
];

console.log('\nGenerating Android icons...');
for (const { dir, size } of androidSizes) {
  const dirPath = path.join(androidDir, dir);
  fs.mkdirSync(dirPath, { recursive: true });
  await sharp(src).resize(size, size).png().toFile(path.join(dirPath, 'ic_launcher.png'));
  await sharp(src).resize(size, size).png().toFile(path.join(dirPath, 'ic_launcher_round.png'));
  console.log(`  ✓ ${dir} (${size}x${size})`);
}

// iOS icons
const iosDir = path.join(iconsDir, 'ios');
const iosSizes = [
  { name: 'AppIcon-20@1x.png', size: 20 },
  { name: 'AppIcon-20@2x.png', size: 40 },
  { name: 'AppIcon-20@3x.png', size: 60 },
  { name: 'AppIcon-29@1x.png', size: 29 },
  { name: 'AppIcon-29@2x.png', size: 58 },
  { name: 'AppIcon-29@3x.png', size: 87 },
  { name: 'AppIcon-40@1x.png', size: 40 },
  { name: 'AppIcon-40@2x.png', size: 80 },
  { name: 'AppIcon-40@3x.png', size: 120 },
  { name: 'AppIcon-60@2x.png', size: 120 },
  { name: 'AppIcon-60@3x.png', size: 180 },
  { name: 'AppIcon-76@1x.png', size: 76 },
  { name: 'AppIcon-76@2x.png', size: 152 },
  { name: 'AppIcon-83.5@2x.png', size: 167 },
  { name: 'AppIcon-512@2x.png', size: 1024 },
];

console.log('\nGenerating iOS icons...');
fs.mkdirSync(iosDir, { recursive: true });
for (const { name, size } of iosSizes) {
  await sharp(src).resize(size, size).png().toFile(path.join(iosDir, name));
  console.log(`  ✓ ${name} (${size}x${size})`);
}

console.log('\n✅ All icons generated successfully!');
