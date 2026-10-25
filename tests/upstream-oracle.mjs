#!/usr/bin/env node
// ============================================================================
// 星陨斩杀线 — 上游权威数值 Oracle（CDP / headless Chrome）
// ----------------------------------------------------------------------------
// 只读访问 _intermediates/upstream/：起本地静态服务 + 无头 Chrome + CDP，
// 在真实页面里调用上游的 computeFinalDamage(ctx) 取权威值。
//
// 用法：
//   模块：  import { createOracle } from './upstream-oracle.mjs'
//           const oracle = await createOracle();
//           const rows = await oracle.computeBatch([req, ...]);
//           await oracle.close();
//   CLI：   node tests/upstream-oracle.mjs --self-test
//           node tests/upstream-oracle.mjs --info
//
// req 形状（与 LEAD-SPEC 第 2/3 节一致）：
//   {
//     attackerId, skillId, defenderId, defenseSkillId: null | '__none__' | 技能id,
//     attackerNature: {up, down}, attackerIVs: [...],
//     defenderNature: {up, down}, defenderIVs: [...],
//     starLayer,                              // 必填 0..99
//     attackerCombo?, attackerPowerBoost?     // 可选 UI chip，默认 0
//   }
// ============================================================================
import { spawn } from 'node:child_process';
import http from 'node:http';
import { WebSocket } from 'ws';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const ROOT = resolve(__dirname, '..');
export const SITE_DIR = join(ROOT, '_intermediates', 'upstream');
export const HTTP_PORT = Number(process.env.QA_HTTP_PORT || 8765);
export const BASE_URL = 'http://127.0.0.1:' + HTTP_PORT;
export const PAGE_URL = BASE_URL + '/calculator.html';
export const CHROME_EXE =
  process.env.QA_CHROME ||
  'C:\\Users\\12249\\.dsh\\browsers\\chrome-for-testing-155\\win64-155.0.8059.84\\chrome-win64\\chrome.exe';

// ---------------------------------------------------------------------------
// 靶子三档（LEAD-SPEC 1.6，固定不可编辑）
// ---------------------------------------------------------------------------
export const TARGET_TIERS = {
  t1: { key: 't1', label: '档①性格生命+生命防御', nature: { up: 'hp', down: 'atk' }, ivs: ['hp', 'def', 'mdef'] },
  t2: { key: 't2', label: '档②仅生命防御', nature: { up: 'spd', down: 'atk' }, ivs: ['hp', 'def', 'mdef'] },
  t3: { key: 't3', label: '档③仅生命', nature: { up: 'spd', down: 'atk' }, ivs: ['hp'] },
};

// ---------------------------------------------------------------------------
// 页面内注入的 __qa 桥（在 calculator.html 的全局作用域执行）
// ---------------------------------------------------------------------------
const QA_BRIDGE = [
  '(function () {',
  '  function pick(fn, fallback) { try { var v = fn(); return v == null ? (fallback || null) : v; } catch (e) { return fallback || null; } }',
  '  var self = {',
  "    SPRITES: pick(function () { return (typeof SPRITES !== 'undefined') ? SPRITES : null; }, window.SPRITES),",
  "    SKILLS:  pick(function () { return (typeof SKILLS  !== 'undefined') ? SKILLS  : null; }, window.SKILLS),",
  "    TYPES:   pick(function () { return (typeof TYPES   !== 'undefined') ? TYPES   : null; }, window.TYPES),",
  "    YUANLI_SKILLS: pick(function () { return (typeof YUANLI_SKILLS !== 'undefined') ? YUANLI_SKILLS : null; }, window.YUANLI_SKILLS),",
  "    FN: pick(function () { return (typeof computeFinalDamage !== 'undefined') ? computeFinalDamage : null; }, window.computeFinalDamage)",
  '  };',
  '  // computeFinalDamage 是纯函数，但其 buildSkillModCtx 读全局 state 的速度 chip；归零以保证可复现。',
  "  try { if (typeof state !== 'undefined' && state) { state.attackerSpeed = 0; state.defenderSpeed = 0; } } catch (e) {}",
  "  self.ready = !!(self.SPRITES && self.SKILLS && self.TYPES && typeof self.FN === 'function');",
  '  self.counts = {',
  '    sprites: self.SPRITES ? Object.keys(self.SPRITES).length : 0,',
  '    skills: self.SKILLS ? Object.keys(self.SKILLS).length : 0,',
  '    types: self.TYPES ? Object.keys(self.TYPES).length : 0,',
  '    yuanli: self.YUANLI_SKILLS ? self.YUANLI_SKILLS.length : 0',
  '  };',
  '  self.resolveSkill = function (id) {',
  '    if (!id) return null;',
  "    if (id.indexOf('__yuanli_') === 0) {",
  '      var list = self.YUANLI_SKILLS || [];',
  '      for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];',
  '      return null;',
  '    }',
  '    return self.SKILLS[id] || null;',
  '  };',
  '  self.resolveDefense = function (id) {',
  "    if (!id || id === '__none__') return null; // computeFinalDamage 内部回落 {reduction:1}",
  "    if (id === '__state__') return { id: '__state__', name: '聚能', category: '状态', desc: '用于使攻击方能够应对状态。' };",
  '    return self.SKILLS[id] || null;',
  '  };',
  '  self.computeOne = function (r) {',
  '    var atk = self.SPRITES[r.attackerId];',
  '    var def = self.SPRITES[r.defenderId];',
  '    var skill = self.resolveSkill(r.skillId);',
  '    var defSkill = self.resolveDefense(r.defenseSkillId);',
  "    if (!atk) return { error: 'unknown attacker: ' + r.attackerId };",
  "    if (!def) return { error: 'unknown defender: ' + r.defenderId };",
  "    if (!skill) return { error: 'unknown skill: ' + r.skillId };",
  '    var ctx = {',
  '      attacker: atk, defender: def, attackSkill: skill, defenseSkill: defSkill,',
  '      attackerNature: r.attackerNature, defenderNature: r.defenderNature,',
  '      attackerIVs: r.attackerIVs, defenderIVs: r.defenderIVs,',
  '      attackerBuff: { atk: 0, matk: 0 }, defenderBuff: { def: 0, mdef: 0 },',
  '      attackerSpeed: 0, defenderSpeed: 0,',
  '      attackerPowerBoost: r.attackerPowerBoost || 0,',
  '      attackerCombo: r.attackerCombo || 0,',
  '      starLayer: r.starLayer',
  '    };',
  '    var res = self.FN(ctx);',
  '    return {',
  '      finalDamage: res.finalDamage, skillDmg: res.skillDmg, starDmg: res.starDmg, defHP: res.defHP,',
  '      starPower: res.starPower, stab: res.stab, skillEff: res.skillEff, skillEffRaw: res.skillEffRaw,',
  '      starEff: res.starEff, combo: res.combo, isMagic: res.isMagic, atkStat: res.atkStat, defStat: res.defStat,',
  '      isKill: res.isKill, starTriggered: res.starTriggered, isSkillIllusion: res.isSkillIllusion, overflow: res.overflow',
  '    };',
  '  };',
  '  self.computeBatch = function (reqs) { return reqs.map(self.computeOne); };',
  '  window.__qa = self;',
  '  return true;',
  '})();',
].join('\n');

// ---------------------------------------------------------------------------
// 极简 CDP 客户端（Node 24 内置 WebSocket）
// ---------------------------------------------------------------------------
class CDPSession {
  constructor(wsUrl) {
    this.nextId = 1;
    this.pending = new Map();
    this.closed = false;
    this.ws = new WebSocket(wsUrl, { perMessageDeflate: false, handshakeTimeout: 15000, maxPayload: 512 * 1024 * 1024 });
    this._open = new Promise((res, rej) => {
      this.ws.once('open', () => res(true));
      this.ws.once('error', (e) => rej(new Error('CDP WebSocket error: ' + (e && e.message ? e.message : e))));
    });
    this.ws.on('message', (data) => {
      let msg;
      try { msg = JSON.parse(data.toString()); } catch { return; }
      if (msg.id && this.pending.has(msg.id)) {
        const p = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        clearTimeout(p.timer);
        if (msg.error) p.reject(new Error('CDP ' + p.method + ': ' + msg.error.message));
        else p.resolve(msg.result);
      }
    });
    this.ws.on('close', () => { this.closed = true; });
    this.ws.on('error', () => {});
  }
  async ready() { await this._open; }
  send(method, params, timeoutMs) {
    if (this.closed) return Promise.reject(new Error('CDP session closed'));
    const id = this.nextId++;
    const ms = timeoutMs || 30000;
    return new Promise((res, rej) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        rej(new Error('CDP timeout: ' + method + ' (' + ms + 'ms)'));
      }, ms);
      this.pending.set(id, { resolve: res, reject: rej, timer, method });
      this.ws.send(JSON.stringify({ id, method, params: params || {} }));
    });
  }
  async evaluate(expression, opts) {
    const o = opts || {};
    const awaitPromise = o.awaitPromise !== false;
    const timeoutMs = o.timeoutMs || 60000;
    const r = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise, userGesture: true }, timeoutMs);
    if (r.exceptionDetails) {
      const d = r.exceptionDetails;
      throw new Error('page exception: ' + (d.exception && d.exception.description ? d.exception.description : d.text));
    }
    return r.result ? r.result.value : undefined;
  }
  close() { try { this.ws.close(); } catch (e) {} }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 用 node:http（agent:false）而非内置 fetch：Node 24.21 的 undici 在
// DevTools HTTP 端点半关闭连接时会触发 assert(!this.paused) 崩溃。
function httpGet(url, timeoutMs) {
  return new Promise((resolve, reject) => {
    const req = http.request(url, { method: 'GET', timeout: timeoutMs || 1500, agent: false }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { body += c; });
      res.on('end', () => resolve({ status: res.statusCode, body }));
      res.on('error', reject);
    });
    req.on('timeout', () => req.destroy(new Error('timeout ' + url)));
    req.on('error', reject);
    req.end();
  });
}

async function fetchJson(url, timeoutMs) {
  const r = await httpGet(url, timeoutMs);
  if (r.status !== 200) throw new Error('HTTP ' + r.status + ' for ' + url);
  return JSON.parse(r.body);
}

// ---------------------------------------------------------------------------
// 静态服务
// ---------------------------------------------------------------------------
async function httpAlive() {
  try {
    const r = await httpGet(BASE_URL + '/calculator.html', 1200);
    return r.status === 200;
  } catch (e) { return false; }
}

async function ensureHttpServer(log) {
  if (await httpAlive()) { log('[oracle] 复用已在运行的静态服务 ' + BASE_URL); return { owned: false, proc: null }; }
  if (!existsSync(join(SITE_DIR, 'calculator.html'))) throw new Error('上游目录不存在或缺 calculator.html: ' + SITE_DIR);
  const proc = spawn('python', ['-m', 'http.server', String(HTTP_PORT), '--bind', '127.0.0.1'], {
    cwd: SITE_DIR, stdio: 'ignore', windowsHide: true,
  });
  proc.on('error', () => {});
  for (let i = 0; i < 80; i++) {
    await sleep(250);
    if (await httpAlive()) { log('[oracle] 已启动静态服务 ' + BASE_URL + ' (pid ' + proc.pid + ')'); return { owned: true, proc }; }
  }
  try { proc.kill(); } catch (e) {}
  throw new Error('静态服务启动超时（python -m http.server ' + HTTP_PORT + '）');
}

// ---------------------------------------------------------------------------
// Chrome + CDP
// ---------------------------------------------------------------------------
async function pickFreeCdpPort(start) {
  const from = start || 9222;
  for (let p = from; p < from + 12; p++) {
    let busy = false;
    try { await fetchJson('http://127.0.0.1:' + p + '/json/version', 500); busy = true; } catch (e) { busy = false; }
    if (!busy) return p;
  }
  throw new Error('找不到空闲的 CDP 端口（9222-9233）');
}

async function launchChrome(log) {
  if (!existsSync(CHROME_EXE)) throw new Error('Chrome 不存在: ' + CHROME_EXE);
  const cdpPort = await pickFreeCdpPort(Number(process.env.QA_CDP_PORT || 9222));
  const profile = mkdtempSync(join(tmpdir(), 'stardmg-qa-'));
  const args = [
    '--headless=new',
    '--remote-debugging-port=' + cdpPort,
    '--user-data-dir=' + profile,
    '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--disable-dev-shm-usage',
    '--disable-background-networking', '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding', '--disable-features=Translate,BackForwardCache,MediaRouter',
    '--hide-scrollbars', '--mute-audio', '--remote-allow-origins=*',
    '--window-size=1440,1000', '--no-sandbox', 'about:blank',
  ];
  const proc = spawn(CHROME_EXE, args, { stdio: 'ignore', windowsHide: true });
  proc.on('error', () => {});
  for (let i = 0; i < 150; i++) {
    await sleep(200);
    try {
      const targets = await fetchJson('http://127.0.0.1:' + cdpPort + '/json/list', 1200);
      const page = targets.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
      if (page) {
        log('[oracle] Chrome 就绪 port=' + cdpPort + ' target=' + String(page.id).slice(0, 8));
        return { proc, profile, cdpPort, wsUrl: page.webSocketDebuggerUrl };
      }
    } catch (e) { /* 继续等 */ }
  }
  try { proc.kill(); } catch (e) {}
  throw new Error('Chrome CDP 启动超时（端口 ' + cdpPort + '）');
}

async function navigateAndReady(cdp, log) {
  await cdp.send('Page.enable', {});
  await cdp.send('Runtime.enable', {});
  await cdp.send('Page.navigate', { url: PAGE_URL }, 30000);
  let pageInfo = null;
  for (let i = 0; i < 200; i++) {
    await sleep(120);
    try {
      const st = await cdp.evaluate('document.readyState', { awaitPromise: false });
      if (st !== 'complete') continue;
      await cdp.evaluate(QA_BRIDGE, { awaitPromise: false });
      pageInfo = await cdp.evaluate('({ready: !!(window.__qa && window.__qa.ready), counts: (window.__qa && window.__qa.counts) || null})', { awaitPromise: false });
      if (pageInfo && pageInfo.ready && pageInfo.counts && pageInfo.counts.sprites > 100) {
        log('[oracle] 页面就绪 sprites=' + pageInfo.counts.sprites + ' skills=' + pageInfo.counts.skills +
          ' types=' + pageInfo.counts.types + ' yuanli=' + pageInfo.counts.yuanli);
        return pageInfo;
      }
    } catch (e) { /* 页面切换中，重试 */ }
  }
  throw new Error('页面初始化超时：SPRITES/SKILLS/computeFinalDamage 未就绪 ' + JSON.stringify(pageInfo));
}

// ---------------------------------------------------------------------------
// 公开 API
// ---------------------------------------------------------------------------
export async function createOracle(opts) {
  const o = opts || {};
  const verbose = o.verbose !== false;
  const log = verbose ? (m) => console.error(m) : () => {};
  const http = await ensureHttpServer(log);
  const chrome = await launchChrome(log);
  const cdp = new CDPSession(chrome.wsUrl);
  await cdp.ready();
  let pageInfo;
  try {
    pageInfo = await navigateAndReady(cdp, log);
  } catch (e) {
    cdp.close();
    try { chrome.proc.kill(); } catch (e2) {}
    throw e;
  }

  let closed = false;
  return {
    pageInfo,
    evaluate(expr, opts2) { return cdp.evaluate(expr, opts2); },

    async computeBatch(reqs) {
      if (!Array.isArray(reqs)) throw new Error('computeBatch 需要数组');
      if (reqs.length === 0) return [];
      const out = [];
      const CHUNK = 200;
      for (let i = 0; i < reqs.length; i += CHUNK) {
        const slice = reqs.slice(i, i + CHUNK);
        const res = await cdp.evaluate('__qa.computeBatch(' + JSON.stringify(slice) + ')', { awaitPromise: true });
        if (!Array.isArray(res)) throw new Error('computeBatch 返回非数组');
        out.push.apply(out, res);
      }
      return out;
    },

    async compute(req) {
      const rows = await this.computeBatch([req]);
      return rows[0];
    },

    dumpData() {
      return cdp.evaluate('({sprites: __qa.SPRITES, skills: __qa.SKILLS, types: __qa.TYPES, yuanli: __qa.YUANLI_SKILLS})', { awaitPromise: false, timeoutMs: 180000 });
    },

    async close() {
      if (closed) return;
      closed = true;
      cdp.close();
      try { chrome.proc.kill(); } catch (e) {}
      await sleep(300);
      try { rmSync(chrome.profile, { recursive: true, force: true }); } catch (e) {}
      if (http.owned && http.proc) { try { http.proc.kill(); } catch (e) {} }
    },
  };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------
const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));

async function main() {
  const mode = process.argv[2] || '--self-test';
  const oracle = await createOracle();
  try {
    if (mode === '--info') {
      const info = await oracle.evaluate('({counts: __qa.counts, sampleSprites: Object.keys(__qa.SPRITES).slice(0,5), types: Object.keys(__qa.TYPES), yuanliIds: (__qa.YUANLI_SKILLS||[]).map(function(s){return s.id;})})');
      console.log(JSON.stringify(info, null, 2));
      return;
    }
    const req = {
      attackerId: '龙息帕尔', skillId: '追打', defenderId: '贝古斯', defenseSkillId: '__none__',
      attackerNature: { up: 'atk', down: 'matk' }, attackerIVs: ['atk', 'spd', 'hp'],
      defenderNature: TARGET_TIERS.t1.nature, defenderIVs: TARGET_TIERS.t1.ivs,
      starLayer: 0,
    };
    const r0 = await oracle.compute(req);
    const r5 = await oracle.compute(Object.assign({}, req, { starLayer: 5 }));
    console.log('self-test starLayer=0: ' + JSON.stringify(r0));
    console.log('self-test starLayer=5: ' + JSON.stringify(r5));
    const ok = r0 && !r0.error && Number.isFinite(r0.finalDamage) && r5.finalDamage > r0.finalDamage;
    console.log(ok ? 'SELF-TEST PASS' : 'SELF-TEST FAIL');
    if (!ok) process.exitCode = 1;
  } finally {
    await oracle.close();
  }
}

if (isMain) {
  main().catch((e) => { console.error('ORACLE ERROR: ' + (e && e.stack ? e.stack : e)); process.exitCode = 1; });
}
