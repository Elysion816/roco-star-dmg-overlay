#!/usr/bin/env node
// ============================================================================
// 星陨斩杀线 — 性能基准（Node 层，domain.js + calc-core.js）
// ----------------------------------------------------------------------------
// 规格第 3 节：单次全量 = 2 攻方 × 600 组 × 3 档 ≈ 3600 次斩杀线求解，必须 < 100ms。
// 用法：node tests/perf-bench.mjs [--rounds 20]
// 只读 src/ 与 datas/final，不写任何文件。
// ============================================================================
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const DATA_DIR = join(ROOT, '_intermediates', 'upstream', 'datas', 'final');

const BUDGET_MS = 100;
const args = process.argv.slice(2);
const roundsArg = args.indexOf('--rounds');
const ROUNDS = roundsArg >= 0 ? Number(args[roundsArg + 1]) || 20 : 20;

function loadData() {
  return {
    sprites: JSON.parse(readFileSync(join(DATA_DIR, 'sprites.json'), 'utf8')),
    skills: JSON.parse(readFileSync(join(DATA_DIR, 'skills.json'), 'utf8')),
    types: JSON.parse(readFileSync(join(DATA_DIR, 'types.json'), 'utf8')),
    others: JSON.parse(readFileSync(join(DATA_DIR, 'others.json'), 'utf8')),
  };
}

const now = () => Number(process.hrtime.bigint() / 1000n) / 1000; // ms

function stats(arr) {
  const sorted = arr.slice().sort((a, b) => a - b);
  const mid = sorted[Math.floor(sorted.length / 2)];
  return {
    min: Math.round(sorted[0] * 1000) / 1000,
    median: Math.round(mid * 1000) / 1000,
    max: Math.round(sorted[sorted.length - 1] * 1000) / 1000,
  };
}

function main() {
  let D;
  try {
    D = require(join(ROOT, 'src', 'core', 'domain.js'));
  } catch (e) {
    console.error('[perf] 无法加载 src/core/domain.js：' + (e && e.message ? e.message : e));
    process.exitCode = 2;
    return;
  }

  const data = loadData();
  D.bindData(data);

  const ATTACKERS = args.includes('--attackers') ? args[args.indexOf('--attackers') + 1].split(',') : ['龙息帕尔', '落陨星兔'];
  const DEFENDER = args.includes('--defender') ? args[args.indexOf('--defender') + 1] : '贝古斯';
  const MAX_LAYER = 10; // 与 domain.DEFAULT_MAX_LAYER 一致

  const scenes = [];
  for (const a of ATTACKERS) {
    const sp = D.getSprite(a);
    if (!sp) { console.error('[perf] 找不到攻方 ' + a); process.exitCode = 2; return; }
    const skillId = D.defaultAttackSkillId(sp);
    for (const tier of ['t1', 't2', 't3']) {
      const sc = D.buildScene({ attackerId: a, attackSkillId: skillId, defenderId: DEFENDER, defenseSkillId: null, tierKey: tier });
      if (!sc) { console.error('[perf] buildScene 失败 ' + a + ' x ' + tier); process.exitCode = 2; return; }
      scenes.push(sc);
    }
  }

  console.log('[perf] 场景：' + ATTACKERS.join(' + ') + ' × 3 档（靶子 ' + DEFENDER + '），每场景 ' + D.COMBOS.length + ' 组，层上限 ' + MAX_LAYER);
  console.log('[perf] 目标：6 场景合计 < ' + BUDGET_MS + 'ms');

  const coldRuns = [];
  for (let r = 0; r < ROUNDS; r++) {
    D.clearCache();
    const t0 = now();
    for (const sc of scenes) D.evaluateAll(sc, MAX_LAYER);
    coldRuns.push(now() - t0);
  }
  const cold = stats(coldRuns);
  console.log('[perf] 冷启动（每次 clearCache 后 6 场景全量）：中位 ' + cold.median + 'ms  最快 ' + cold.min + 'ms  最慢 ' + cold.max + 'ms');

  const warmRuns = [];
  for (let r = 0; r < ROUNDS; r++) {
    const t0 = now();
    for (const sc of scenes) D.evaluateAll(sc, MAX_LAYER);
    warmRuns.push(now() - t0);
  }
  const warm = stats(warmRuns);
  console.log('[perf] 暖缓存（重复调用 6 场景）：中位 ' + warm.median + 'ms  最快 ' + warm.min + 'ms  最慢 ' + warm.max + 'ms');

  // 明细面板：单场景 600 组 + groupByLayer
  const detailRuns = [];
  for (let r = 0; r < ROUNDS; r++) {
    D.clearCache();
    const t0 = now();
    const all = D.evaluateAll(scenes[0], MAX_LAYER);
    D.groupByLayer(all);
    detailRuns.push(now() - t0);
  }
  const detail = stats(detailRuns);
  console.log('[perf] 明细面板（1 场景 600 组 + groupByLayer）：中位 ' + detail.median + 'ms  最快 ' + detail.min + 'ms  最慢 ' + detail.max + 'ms');

  // 手动配置覆盖：cellResult 指定 nature/ivs
  const nat = D.NATURES[0].key;
  const ivs = D.IVS_LIST[0].key;
  const manualRuns = [];
  for (let r = 0; r < ROUNDS; r++) {
    const t0 = now();
    for (const sc of scenes) D.cellResult(sc, MAX_LAYER, { natureKey: nat, ivsKey: ivs });
    manualRuns.push(now() - t0);
  }
  const manual = stats(manualRuns);
  console.log('[perf] 手动配置覆盖（6 场景 cellResult）：中位 ' + manual.median + 'ms  最快 ' + manual.min + 'ms  最慢 ' + manual.max + 'ms');

  const verdict = cold.median < BUDGET_MS;
  console.log('[perf] 结论：' + (verdict ? 'PASS' : 'FAIL') + '（冷启动中位 ' + cold.median + 'ms ' + (verdict ? '<' : '>=') + ' ' + BUDGET_MS + 'ms）');
  if (!verdict) process.exitCode = 1;
}

main();
