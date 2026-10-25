#!/usr/bin/env node
/**
 * tools/make-icon.mjs
 * ---------------------------------------------------------------------------
 * 生成浮窗/托盘/打包用的图标（纯 Node，无第三方依赖）：
 *   src/assets/icon.png  256×256 透明底金色星辉
 *   src/assets/icon.ico  PNG 内嵌式 ICO（Windows Vista+ 支持），给 electron-packager 用
 *
 * 运行：node tools/make-icon.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = path.join(ROOT, 'src', 'assets');
const SIZE = 256;

// ---- 画一颗五角星（3×3 超采样抗锯齿）----
const cx = SIZE / 2, cy = SIZE / 2;
const R_OUT = SIZE * 0.46, R_IN = SIZE * 0.19;
const pts = [];
for (let i = 0; i < 10; i++) {
  const ang = -Math.PI / 2 + (i * Math.PI) / 5;
  const r = i % 2 === 0 ? R_OUT : R_IN;
  pts.push([cx + Math.cos(ang) * r, cy + Math.sin(ang) * r]);
}
function inStar(x, y) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i], [xj, yj] = pts[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

const rgba = Buffer.alloc(SIZE * SIZE * 4);
const SS = 3;
for (let y = 0; y < SIZE; y++) {
  for (let x = 0; x < SIZE; x++) {
    let hit = 0;
    for (let sy = 0; sy < SS; sy++) {
      for (let sx = 0; sx < SS; sx++) {
        if (inStar(x + (sx + 0.5) / SS, y + (sy + 0.5) / SS)) hit++;
      }
    }
    const cov = hit / (SS * SS);
    // 柔和外发光
    const d = Math.hypot(x - cx, y - cy) / (SIZE * 0.5);
    const glow = Math.max(0, 1 - d) ** 3 * 0.55;
    const a = Math.min(1, cov + glow * (1 - cov));
    if (a <= 0.004) continue;
    // 金色渐变（上亮下深）+ 高光
    const t = y / SIZE;
    const r = Math.round(255 - 30 * t);
    const g = Math.round(214 - 60 * t);
    const b = Math.round(120 - 40 * t);
    const i = (y * SIZE + x) * 4;
    rgba[i] = r; rgba[i + 1] = g; rgba[i + 2] = b;
    rgba[i + 3] = Math.round(a * 255);
  }
}

// ---- PNG 编码 ----
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();
function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const typeBuf = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])));
  return Buffer.concat([len, typeBuf, data, crc]);
}
function encodePng(width, height, pixels) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0;
    pixels.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

const png = encodePng(SIZE, SIZE, rgba);

// ---- ICO（PNG 内嵌，仅一个 256×256 项）----
const icoHeader = Buffer.alloc(6);
icoHeader.writeUInt16LE(0, 0); icoHeader.writeUInt16LE(1, 2); icoHeader.writeUInt16LE(1, 4);
const entry = Buffer.alloc(16);
entry[0] = 0; // 256 → 0
entry[1] = 0;
entry[2] = 0; entry[3] = 0;
entry.writeUInt16LE(1, 4);
entry.writeUInt16LE(32, 6);
entry.writeUInt32LE(png.length, 8);
entry.writeUInt32LE(22, 12);
const ico = Buffer.concat([icoHeader, entry, png]);

fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(path.join(OUT_DIR, 'icon.png'), png);
fs.writeFileSync(path.join(OUT_DIR, 'icon.ico'), ico);
console.log('[make-icon] ✓ icon.png ' + png.length + ' B / icon.ico ' + ico.length + ' B');
