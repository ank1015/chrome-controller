import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const packageDir = dirname(dirname(fileURLToPath(import.meta.url)));
const outputDir = join(packageDir, 'dist', 'chrome', 'icons');
const sizes = [16, 32, 48, 128];
const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function buildCrcTable() {
  const table = new Uint32Array(256);

  for (let index = 0; index < 256; index += 1) {
    let value = index;

    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) === 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }

    table[index] = value >>> 0;
  }

  return table;
}

const crcTable = buildCrcTable();

function crc32(buffer) {
  let value = 0xffffffff;

  for (const byte of buffer) {
    value = crcTable[(value ^ byte) & 0xff] ^ (value >>> 8);
  }

  return (value ^ 0xffffffff) >>> 0;
}

function createChunk(type, data) {
  const typeBuffer = Buffer.from(type, 'ascii');
  const lengthBuffer = Buffer.alloc(4);
  lengthBuffer.writeUInt32BE(data.length, 0);

  const crcBuffer = Buffer.alloc(4);
  crcBuffer.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);

  return Buffer.concat([lengthBuffer, typeBuffer, data, crcBuffer]);
}

function insideRoundedRect(x, y, size, padding, radius) {
  const left = padding;
  const top = padding;
  const right = size - padding - 1;
  const bottom = size - padding - 1;

  if (x < left || x > right || y < top || y > bottom) {
    return false;
  }

  const innerLeft = left + radius;
  const innerRight = right - radius;
  const innerTop = top + radius;
  const innerBottom = bottom - radius;

  if ((x >= innerLeft && x <= innerRight) || (y >= innerTop && y <= innerBottom)) {
    return true;
  }

  const cornerX = x < innerLeft ? innerLeft : innerRight;
  const cornerY = y < innerTop ? innerTop : innerBottom;
  const dx = x - cornerX;
  const dy = y - cornerY;

  return dx * dx + dy * dy <= radius * radius;
}

function colorForPixel(x, y, size) {
  const outer = [15, 23, 42, 255];
  const panel = [37, 99, 235, 255];
  const header = [191, 219, 254, 255];
  const accent = [245, 158, 11, 255];

  const padding = Math.max(1, Math.round(size * 0.12));
  const radius = Math.max(2, Math.round(size * 0.18));
  const panelTop = padding + Math.max(1, Math.round(size * 0.12));
  const panelLeft = padding;
  const panelRight = size - padding - 1;
  const panelBottom = size - padding - 1;
  const headerHeight = Math.max(2, Math.round(size * 0.16));
  const accentWidth = Math.max(2, Math.round(size * 0.12));
  const accentHeight = Math.max(2, Math.round(size * 0.42));
  const accentLeft = panelLeft + Math.max(2, Math.round(size * 0.18));
  const accentTop = panelTop + Math.max(2, Math.round(size * 0.18));

  if (!insideRoundedRect(x, y, size, padding, radius)) {
    return outer;
  }

  if (y < panelTop) {
    return header;
  }

  if (
    x >= accentLeft &&
    x < accentLeft + accentWidth &&
    y >= accentTop &&
    y < accentTop + accentHeight &&
    x <= panelRight &&
    y <= panelBottom
  ) {
    return accent;
  }

  const diagonalBand = Math.max(1, Math.round(size * 0.06));
  const diagonalDistance = Math.abs(y - (panelTop + (x - panelLeft) * 0.72));
  if (
    x >= panelLeft &&
    x <= panelRight &&
    y >= panelTop &&
    y <= panelBottom &&
    diagonalDistance <= diagonalBand
  ) {
    return accent;
  }

  return panel;
}

function createPng(size) {
  const rowLength = size * 4 + 1;
  const raw = Buffer.alloc(rowLength * size);

  for (let y = 0; y < size; y += 1) {
    const rowStart = y * rowLength;
    raw[rowStart] = 0;

    for (let x = 0; x < size; x += 1) {
      const offset = rowStart + 1 + x * 4;
      const [red, green, blue, alpha] = colorForPixel(x, y, size);
      raw[offset] = red;
      raw[offset + 1] = green;
      raw[offset + 2] = blue;
      raw[offset + 3] = alpha;
    }
  }

  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8;
  header[9] = 6;
  header[10] = 0;
  header[11] = 0;
  header[12] = 0;

  return Buffer.concat([
    pngSignature,
    createChunk('IHDR', header),
    createChunk('IDAT', deflateSync(raw)),
    createChunk('IEND', Buffer.alloc(0)),
  ]);
}

await mkdir(outputDir, { recursive: true });

for (const size of sizes) {
  const iconPath = join(outputDir, `icon${size}.png`);
  await writeFile(iconPath, createPng(size));
}

