#!/usr/bin/env node
/**
 * tools/smoke.mjs —— 无头自检入口（XY_SMOKE）
 * ---------------------------------------------------------------------------
 * 存在的意义：把「跑自检」这件事从一长串手工命令 + 环境变量约定
 * 收敛成一个可被 CI / pre-push 直接调用的命令，并保证退出码可信。
 *
 * 它负责：
 *   1. 清掉 ELECTRON_RUN_AS_NODE / ELECTRON_NO_ATTACH_CONSOLE —— 有这两个变量时
 *      electron 会以纯 Node 跑，窗口起不来，报的却是 "Cannot read properties of
 *      undefined (reading 'requestSingleInstanceLock')"，很难一眼看懂。
 *   2. 默认把截图写到 _intermediates/smoke/（可用 XY_SMOKE_OUT 覆盖），
 *      避免在打包版里跑时把 50+ 张 PNG 写进 resources/app。
 *   3. 透传 Electron 的退出码：smoke.js 里断言失败会 app.exit(1)。
 *
 * 用法：
 *   node tools/smoke.mjs                 # 完整自检（含截图与透明占比断言）
 *   XY_SMOKE_NO_CAPTURE=1 node tools/smoke.mjs   # 只跑 DOM/几何断言，跳过 capturePage
 *   XY_SMOKE_KEEP_STATE=1 node tools/smoke.mjs   # 保留自检用的临时 userData 目录
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

let electron;
try {
  electron = require('electron');
} catch (e) {
  console.error('[smoke] ✗ 找不到 electron，请先 npm install');
  process.exit(1);
}
if (typeof electron === 'string' && !fs.existsSync(electron)) {
  console.error('[smoke] ✗ electron 可执行文件不存在：' + electron + '（试试 npm rebuild electron）');
  process.exit(1);
}

const env = Object.assign({}, process.env);
delete env.ELECTRON_RUN_AS_NODE;   // 必须删，置空不算删除
delete env.ELECTRON_NO_ATTACH_CONSOLE;
env.XY_SMOKE = '1';
if (!env.XY_SMOKE_OUT) env.XY_SMOKE_OUT = path.join(ROOT, '_intermediates', 'smoke');

const outDir = path.resolve(env.XY_SMOKE_OUT);
fs.mkdirSync(outDir, { recursive: true });

// --no-capture 是本脚本自己的开关，不要透传给 Electron（它不认识）
const rawArgs = process.argv.slice(2);
const passthroughArgs = [];
for (const a of rawArgs) {
  if (a === '--no-capture') env.XY_SMOKE_NO_CAPTURE = '1';
  else passthroughArgs.push(a);
}
const args = ['.'].concat(passthroughArgs);
console.log('[smoke] 启动：' + path.basename(electron) + ' ' + args.join(' '));
console.log('[smoke] 截图/结果目录：' + outDir +
  (env.XY_SMOKE_NO_CAPTURE === '1' ? '（已关闭截图）' : ''));

const child = spawn(electron, args, { cwd: ROOT, stdio: 'inherit', env });
child.on('exit', code => {
  const resultFile = path.join(outDir, 'smoke-result.json');
  if (fs.existsSync(resultFile)) {
    try {
      const r = JSON.parse(fs.readFileSync(resultFile, 'utf8'));
      if (r.asserts) {
        console.log('[smoke] 断言 ' + r.asserts.passed + '/' + r.asserts.total + ' 通过' +
          (r.asserts.failed.length ? '，失败项：\n  - ' + r.asserts.failed.join('\n  - ') : ''));
      }
    } catch (e) { /* 结果文件损坏时只报退出码 */ }
  }
  process.exit(code == null ? 1 : code);
});
