#!/usr/bin/env node
/**
 * tools/start.mjs
 * ---------------------------------------------------------------------------
 * 用正确的方式启动 Electron。
 *
 * 为什么需要它：某些 IDE / 终端 / 沙箱环境会带上 ELECTRON_RUN_AS_NODE=1，
 * 这会让 electron 二进制以「纯 Node」模式运行（require('electron') 只返回路径字符串），
 * 表现就是窗口起不来或直接退出。这里在 spawn 子进程前把它摘掉。
 *
 * 用法：npm start        （等价于 node tools/start.mjs）
 *      npm start -- --no-sandbox
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

let electronPath;
try {
  electronPath = require('electron');
} catch (e) {
  console.error('[start] 找不到 electron，请先执行 npm install');
  process.exit(1);
}
if (typeof electronPath !== 'string' || !fs.existsSync(electronPath)) {
  console.error('[start] electron 可执行文件不存在：' + electronPath + '（试试 npm rebuild electron 或删掉 node_modules/electron 重装）');
  process.exit(1);
}

const env = Object.assign({}, process.env);
delete env.ELECTRON_RUN_AS_NODE;
delete env.ELECTRON_NO_ATTACH_CONSOLE;

const args = ['.'].concat(process.argv.slice(2));
const child = spawn(electronPath, args, { cwd: ROOT, stdio: 'inherit', env });
child.on('close', code => process.exit(code == null ? 0 : code));
