#!/usr/bin/env node
/**
 * tools/pack.mjs
 * ---------------------------------------------------------------------------
 * 打包成 Windows 绿色文件夹（免安装，双击 exe 即用）。
 *
 * 优先用 @electron/packager；若它因为网络/依赖原因不可用，则回退到"手工组装"：
 *   复制 node_modules/electron/dist/* → dist/星陨斩杀线-win32-x64/
 *   把 package.json + src/ 放进 resources/app/
 *   把 electron.exe 改名为 星陨斩杀线.exe
 * 两种方式产出的都是可以直接双击运行的绿色文件夹。
 *
 * 运行：node tools/pack.mjs    （或 npm run pack）
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');
const APP_NAME = '星陨斩杀线';
const OUT_DIR_NAME = APP_NAME + '-win32-x64';

const IGNORE = [/^\/_intermediates/, /^\/work/, /^\/dist/, /^\/\.git/, /^\/tests/, /^\/node_modules\//];

function rmrf(p) { fs.rmSync(p, { recursive: true, force: true }); }
function copyDir(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dst, entry.name);
    if (entry.isDirectory()) copyDir(s, d);
    else if (entry.isSymbolicLink()) fs.symlinkSync(fs.readlinkSync(s), d);
    else fs.copyFileSync(s, d);
  }
}

/** 手工组装（离线兜底） */
function manualPack() {
  const electronPkg = path.join(ROOT, 'node_modules', 'electron');
  const electronDist = path.join(electronPkg, 'dist');
  if (!fs.existsSync(electronDist)) {
    throw new Error('找不到 ' + electronDist + '，请先 npm install');
  }
  const out = path.join(DIST, OUT_DIR_NAME);
  rmrf(out);
  copyDir(electronDist, out);

  const appDir = path.join(out, 'resources', 'app');
  fs.mkdirSync(appDir, { recursive: true });
  fs.copyFileSync(path.join(ROOT, 'package.json'), path.join(appDir, 'package.json'));
  copyDir(path.join(ROOT, 'src'), path.join(appDir, 'src'));

  // electron.exe → 星陨斩杀线.exe（同时删除旧名）
  const exe = path.join(out, 'electron.exe');
  const renamed = path.join(out, APP_NAME + '.exe');
  if (fs.existsSync(exe)) {
    fs.renameSync(exe, renamed);
  }
  return out;
}

/** 找本机 electron 缓存里的 zip（packager 可用它离线工作，避免连 GitHub 超时） */
function findLocalElectronZip() {
  const version = JSON.parse(fs.readFileSync(path.join(ROOT, 'node_modules', 'electron', 'package.json'), 'utf8')).version;
  const cacheRoot = path.join(process.env.LOCALAPPDATA || '', 'electron', 'Cache');
  const zipName = 'electron-v' + version + '-win32-x64.zip';
  try {
    for (const dir of fs.readdirSync(cacheRoot)) {
      const zip = path.join(cacheRoot, dir, zipName);
      if (fs.existsSync(zip)) return zip;
    }
  } catch (e) { /* 没有缓存目录 */ }
  return null;
}

async function packagerPack() {
  const { default: packager } = await import('@electron/packager');
  const zip = findLocalElectronZip();
  const paths = await packager({
    dir: ROOT,
    name: APP_NAME,
    executableName: APP_NAME,
    platform: 'win32',
    arch: 'x64',
    out: DIST,
    overwrite: true,
    asar: false,
    prune: true,
    icon: path.join(ROOT, 'src', 'assets', 'icon.ico'),
    ignore: IGNORE,
    appVersion: readPkg().version,
    // 命中本机缓存 → 打包不联网
    ...(zip ? { electronZipDir: path.dirname(zip) } : {}),
    download: { timeout: 0 },
  });
  return paths[0];
}

function readPkg() {
  return JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
}

const t0 = Date.now();
let out = null;
try {
  out = await packagerPack();
  console.log('[pack] ✓ @electron/packager 打包完成：' + path.relative(ROOT, out));
} catch (e) {
  console.warn('[pack] ! @electron/packager 失败：' + (e && e.message));
  try {
    out = manualPack();
    console.log('[pack] ✓ 手工组装完成（离线兜底）：' + path.relative(ROOT, out));
  } catch (e2) {
    console.error('[pack] ✗ 打包失败：' + e2.message);
    process.exit(1);
  }
}
console.log('[pack]   耗时 ' + ((Date.now() - t0) / 1000).toFixed(1) + 's');
console.log('[pack]   可执行文件：' + path.join(path.relative(ROOT, out), APP_NAME + '.exe'));
