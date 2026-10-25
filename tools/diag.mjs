// npm run diag —— 一键取证：清日志 → 启动（XY_DIAG=1）→ 收起小条 → 桌面截图 → 退出
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const APP_DATA = path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), '星陨斩杀线');
const LOG = path.join(APP_DATA, 'debug.log');
const SHOT = path.join(ROOT, '_intermediates', 'diag-shot.png');

for (const f of [LOG, SHOT]) { try { fs.rmSync(f, { force: true }); } catch {} }
fs.mkdirSync(path.join(ROOT, '_intermediates'), { recursive: true });

const isWin = process.platform === 'win32';
const exe = isWin
  ? path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe')
  : path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron');
const env = { ...process.env, XY_DIAG: '1', XY_DEBUG: '1' };
delete env.ELECTRON_RUN_AS_NODE;

console.log('[diag] 启动：', exe);
const child = spawn(exe, ['.', '--no-sandbox'], { cwd: ROOT, env, stdio: 'inherit' });

child.on('exit', code => {
  console.log('[diag] 退出码', code);
  console.log('[diag] 日志：' + LOG + (fs.existsSync(LOG) ? ' ✓' : ' ✗ 未生成'));
  console.log('[diag] 截图：' + SHOT + (fs.existsSync(SHOT) ? ' ✓' : ' ✗ 未生成'));
  if (fs.existsSync(LOG)) {
    const lines = fs.readFileSync(LOG, 'utf8').trim().split('\n');
    console.log('[diag] 日志行数 ' + lines.length + '，末 6 行：');
    for (const l of lines.slice(-6)) console.log('  ' + l);
  }
});
