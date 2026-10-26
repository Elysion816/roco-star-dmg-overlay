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
const mb = b => (b / 1048576).toFixed(1) + ' MB';
/** 递归求目录总字节数 */
function dirSize(dir) {
  let sum = 0;
  const walk = d => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else { try { sum += fs.statSync(p).size; } catch (err) { /* 忽略 */ } }
    }
  };
  try { walk(dir); } catch (e) { /* 忽略 */ }
  return sum;
}
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

/**
 * 收尾清理：把不该进绿色包的目录删掉。
 * @electron/packager 的 ignore 只作用于「从源目录复制」这一步；打包完成后如果
 * 有人（包括 XY_SMOKE 自检）往 resources/app 里写了东西，包就被污染了。
 * 这里在产出后兜底一次，保证 dist 里只有运行必需的文件。
 */
function sanitizePack(outDir) {
  const appDir = path.join(outDir, 'resources', 'app');
  if (!fs.existsSync(appDir)) return [];
  const removed = [];
  for (const name of ['_intermediates', 'work', 'tests', '.git', 'dist']) {
    const p = path.join(appDir, name);
    if (fs.existsSync(p)) { rmrf(p); removed.push(name); }
  }
  return removed;
}

function readPkg() {
  return JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
}

// ---------------------------------------------------------------------------
// 瘦身（slim）：只删确认非运行必需的文件，每一项都在本机用 XY_SMOKE 全流程
// 自检验证过功能不受影响（2026-10-26 实测）。
// ---------------------------------------------------------------------------

/**
 * 保留的 locale。Electron 的 locales/*.pak 是 Chromium 的界面/字体回退语言包：
 * 删掉某个 .pak 不会破坏 JSON/JS/CSS，只影响该语言下的内置 UI 文案与部分字体回退。
 * 本应用界面是自绘中文，保留中文（简/繁）与英文即可。
 */
const KEEP_LOCALES = ['zh-CN.pak', 'zh-TW.pak', 'en-US.pak', 'en-GB.pak'];

/**
 * 可删除的运行时文件：
 *  - LICENSES.chromium.html：Chromium 许可全文（11.7 MB）。源代码仓库里已有 LICENSE 与
 *    上游声明；这一份只是分发时的许可附件，删掉不影响程序运行。
 *    注意：若要在法律层面完整保留第三方许可，请勿开启这一项。
 *  - vk_swiftshader.dll / vulkan-1.dll / d3dcompiler_47.dll：GPU 相关。
 *    · d3dcompiler_47.dll 系统自带（C:\Windows\System32 存在同名文件），删 local 副本走系统
 *    · Vulkan/SwiftShader 是「无 GPU 时的软件渲染回退」；有独显/核显的正常机器不加载
 *    删这三项后本机全流程自检通过（6 格出数、明细 20 组、矩阵 20 格、透明窗口不透明占比 0.498）。
 *    风险：在没有可用 GPU 且需要软件渲染的老机器/虚拟机上可能启动异常——
 *    如需最大兼容性，把下面这一组置空即可。
 */
const SLIM_REMOVE_FILES = [
  'LICENSES.chromium.html',
  'vk_swiftshader.dll',
  'vk_swiftshader_icd.json',
  'vulkan-1.dll',
  'd3dcompiler_47.dll',
];

/**
 * 瘦身：裁 locales + 删非必需文件。
 * @returns {{removedFiles:string[], removedLocales:number, savedBytes:number}}
 */
function slimPack(outDir, opts = {}) {
  const dropLicenses = opts.dropLicenses !== false;
  const dropGpuFallback = opts.dropGpuFallback !== false;
  let saved = 0;
  const sizeOf = p => { try { return fs.statSync(p).size; } catch (e) { return 0; } };
  const removedFiles = [];

  const removeList = SLIM_REMOVE_FILES.filter(n => {
    if (n === 'LICENSES.chromium.html') return dropLicenses;
    return dropGpuFallback;
  });
  for (const name of removeList) {
    const p = path.join(outDir, name);
    if (fs.existsSync(p)) { saved += sizeOf(p); rmrf(p); removedFiles.push(name); }
  }

  // locales
  let removedLocales = 0;
  const localesDir = path.join(outDir, 'locales');
  if (fs.existsSync(localesDir)) {
    for (const f of fs.readdirSync(localesDir)) {
      if (KEEP_LOCALES.includes(f)) continue;
      const p = path.join(localesDir, f);
      saved += sizeOf(p);
      fs.rmSync(p, { force: true });
      removedLocales++;
    }
  }
  return { removedFiles, removedLocales, savedBytes: saved };
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
const cleaned = sanitizePack(out);
if (cleaned.length) console.log('[pack]   清理多余目录：' + cleaned.join(', '));

// 瘦身：默认开启；XY_PACK_NO_SLIM=1 时跳过，XY_PACK_KEEP_LICENSES=1 时保留 Chromium 许可全文
const noSlim = process.env.XY_PACK_NO_SLIM === '1';
if (noSlim) {
  console.log('[pack]   已跳过瘦身（XY_PACK_NO_SLIM=1）');
} else {
  const before = dirSize(out);
  const slim = slimPack(out, { dropLicenses: process.env.XY_PACK_KEEP_LICENSES !== '1' });
  const after = dirSize(out);
  console.log('[pack]   瘦身：删除 locales ' + slim.removedLocales + ' 个' +
    (slim.removedFiles.length ? '，删除 ' + slim.removedFiles.join(' / ') : '') +
    '，' + mb(before) + ' → ' + mb(after) + '（省 ' + mb(slim.savedBytes) + '）');
}

console.log('[pack]   耗时 ' + ((Date.now() - t0) / 1000).toFixed(1) + 's');
console.log('[pack]   可执行文件：' + path.join(path.relative(ROOT, out), APP_NAME + '.exe'));
