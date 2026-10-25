#!/usr/bin/env node
// ============================================================================
// 星陨斩杀线 — 数值对拍（上游 oracle fixtures vs 工程师的 src/core/calc-core.js）
// ----------------------------------------------------------------------------
// 用法：
//   node tests/compare-core.mjs             # 对拍 + 写 tests/REPORT.md
//   node tests/compare-core.mjs --json      # 只打印 JSON 摘要
//   node tests/compare-core.mjs --no-report # 不写 REPORT.md
//
// 对拍字段（逐位相等，不做近似）：finalDamage / skillDmg / starDmg / defHP
// 诊断字段（不计入通过率）：starPower / stab / skillEff / combo / isMagic / atkStat / defStat / isKill
//
// 只读 src/ 与 datas/final，只写 tests/REPORT.md。
// ============================================================================
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const CORE_PATH = join(ROOT, 'src', 'core', 'calc-core.js');
const DOMAIN_PATH = join(ROOT, 'src', 'core', 'domain.js');
const DATA_DIR = join(ROOT, '_intermediates', 'upstream', 'datas', 'final');
const FIXTURES = join(__dirname, 'fixtures.json');
const REPORT = join(__dirname, 'REPORT.md');

const COMPARE_FIELDS = ['finalDamage', 'skillDmg', 'starDmg', 'defHP'];
const DIAG_FIELDS = ['starPower', 'stab', 'skillEff', 'starEff', 'combo', 'isMagic', 'atkStat', 'defStat', 'isKill', 'starTriggered'];

function loadData() {
  return {
    sprites: JSON.parse(readFileSync(join(DATA_DIR, 'sprites.json'), 'utf8')),
    skills: JSON.parse(readFileSync(join(DATA_DIR, 'skills.json'), 'utf8')),
    types: JSON.parse(readFileSync(join(DATA_DIR, 'types.json'), 'utf8')),
    others: JSON.parse(readFileSync(join(DATA_DIR, 'others.json'), 'utf8')),
  };
}

// calc-core.js 抽取行段不含 YUANLI_SKILLS（上游 890-905 行），这里按上游定义复刻。
function buildYuanliSkills(types) {
  return Object.keys(types).map((el) => ({
    id: '__yuanli_' + el + '__',
    name: '愿力冲击',
    category: '攻击',
    element: el + '系',
    damage_class: '自适应',
    power: 80,
    modKey: '__yuanli__',
    desc: '造成伤害，伤害类型取决于精灵双攻更高的一项，应对状态：本次威力+150%。',
    icon_url: '',
  }));
}

function resolveSkill(skills, yuanli, id) {
  if (!id) return null;
  if (id.indexOf('__yuanli_') === 0) return yuanli.find((s) => s.id === id) || null;
  return skills[id] || null;
}

function resolveDefense(skills, id) {
  if (!id || id === '__none__') return null;
  if (id === '__state__') return { id: '__state__', name: '聚能', category: '状态', desc: '用于使攻击方能够应对状态。' };
  return skills[id] || null;
}

// ---------------------------------------------------------------------------
// 加载 calc-core.js：优先 vm（脚本/CJS 风格），含 export 时退化为 ESM data-url 导入
// ---------------------------------------------------------------------------
async function loadCore() {
  if (!existsSync(CORE_PATH)) {
    throw new Error('未找到 src/core/calc-core.js —— 等待工程师交付（tools/extract-core.mjs 生成）');
  }
  const src = readFileSync(CORE_PATH, 'utf8');
  const need = ['bindData', 'computeFinalDamage'];
  const looksEsm = /^\s*export\s+(function|const|let|class|\{)/m.test(src);

  if (looksEsm) {
    const mod = await import('data:text/javascript;base64,' + Buffer.from(src, 'utf8').toString('base64'));
    const api = {};
    for (const k of ['bindData', 'computeFinalDamage', 'computeSkillDynamicModifiers', 'getFinalStat', 'effectiveness', 'getStabMultiplier', 'buildSkillModCtx', 'SKILL_MODS']) {
      if (typeof mod[k] !== 'undefined') api[k] = mod[k];
    }
    if (!need.every((k) => typeof api[k] === 'function')) {
      throw new Error('calc-core.js（ESM）缺少导出：' + need.filter((k) => typeof api[k] !== 'function').join(', '));
    }
    return api;
  }

  const sandbox = { console, module: { exports: {} }, exports: {} };
  sandbox.exports = sandbox.module.exports;
  sandbox.globalThis = sandbox;
  const ctx = vm.createContext(sandbox);
  vm.runInContext(src, ctx, { filename: CORE_PATH });

  const sources = [sandbox, sandbox.module.exports || {}];
  const api = {};
  for (const k of ['bindData', 'computeFinalDamage', 'computeSkillDynamicModifiers', 'getFinalStat', 'effectiveness', 'getStabMultiplier', 'buildSkillModCtx', 'SKILL_MODS']) {
    for (const s of sources) {
      if (s && typeof s[k] !== 'undefined') { api[k] = s[k]; break; }
    }
  }
  if (!need.every((k) => typeof api[k] === 'function')) {
    throw new Error('calc-core.js 缺少符号：' + need.filter((k) => typeof api[k] !== 'function').join(', ') +
      '（期望顶层 function 声明或 module.exports）');
  }
  return api;
}

async function loadDomain() {
  if (!existsSync(DOMAIN_PATH)) return null;
  try {
    const src = readFileSync(DOMAIN_PATH, 'utf8');
    if (/^\s*export\s+(function|const|let|class|\{)/m.test(src)) {
      return await import('data:text/javascript;base64,' + Buffer.from(src, 'utf8').toString('base64'));
    }
    const sandbox = { console, module: { exports: {} }, exports: {} };
    sandbox.exports = sandbox.module.exports;
    sandbox.globalThis = sandbox;
    const ctx = vm.createContext(sandbox);
    vm.runInContext(src, ctx, { filename: DOMAIN_PATH });
    return sandbox.module.exports && Object.keys(sandbox.module.exports).length ? sandbox.module.exports : sandbox;
  } catch (e) {
    return { __loadError: String(e && e.message ? e.message : e) };
  }
}

function buildCtx(fixtureReq, data, yuanli) {
  const atk = data.sprites[fixtureReq.attackerId];
  const def = data.sprites[fixtureReq.defenderId];
  const skill = resolveSkill(data.skills, yuanli, fixtureReq.skillId);
  if (!atk) return { error: 'unknown attacker: ' + fixtureReq.attackerId };
  if (!def) return { error: 'unknown defender: ' + fixtureReq.defenderId };
  if (!skill) return { error: 'unknown skill: ' + fixtureReq.skillId };
  return {
    ctx: {
      attacker: atk,
      defender: def,
      attackSkill: skill,
      defenseSkill: resolveDefense(data.skills, fixtureReq.defenseSkillId),
      attackerNature: fixtureReq.attackerNature,
      defenderNature: fixtureReq.defenderNature,
      attackerIVs: fixtureReq.attackerIVs,
      defenderIVs: fixtureReq.defenderIVs,
      attackerBuff: { atk: 0, matk: 0 },
      defenderBuff: { def: 0, mdef: 0 },
      attackerSpeed: 0,
      defenderSpeed: 0,
      attackerPowerBoost: fixtureReq.attackerPowerBoost || 0,
      attackerCombo: fixtureReq.attackerCombo || 0,
      starLayer: fixtureReq.starLayer,
    },
  };
}

async function main() {
  const args = process.argv.slice(2);
  const jsonOnly = args.includes('--json');
  const noReport = args.includes('--no-report');

  const selfCheck = args.includes('--self-check');
  const fixtures = JSON.parse(readFileSync(FIXTURES, 'utf8'));
  // --self-check：突变 3 组 starLayer，验证对拍器确实能检出差异（防假阳性）
  const mutated = [];
  if (selfCheck) {
    for (const i of [0, 20, 40]) {
      fixtures.cases[i].req.starLayer = fixtures.cases[i].req.starLayer + 1;
      mutated.push(i);
    }
  }
  const data = loadData();
  const yuanli = buildYuanliSkills(data.types);

  let core;
  try {
    core = await loadCore();
  } catch (e) {
    console.error('[compare] ' + (e && e.message ? e.message : e));
    process.exitCode = 2;
    return;
  }

  core.bindData({ sprites: data.sprites, skills: data.skills, types: data.types, others: data.others });

  const results = [];
  for (const c of fixtures.cases) {
    const built = buildCtx(c.req, data, yuanli);
    if (built.error) {
      results.push({ index: c.index, id: c.id, tags: c.tags, status: 'error', message: built.error });
      continue;
    }
    let actual;
    try {
      actual = core.computeFinalDamage(built.ctx);
    } catch (e) {
      results.push({ index: c.index, id: c.id, tags: c.tags, status: 'throw', message: String(e && e.stack ? e.stack : e) });
      continue;
    }
    const fieldDiffs = [];
    for (const f of COMPARE_FIELDS) {
      const exp = c.expected[f];
      const act = actual ? actual[f] : undefined;
      if (!Object.is(exp, act)) fieldDiffs.push({ field: f, expected: exp, actual: act });
    }
    const diagDiffs = [];
    for (const f of DIAG_FIELDS) {
      const exp = c.expected[f];
      const act = actual ? actual[f] : undefined;
      if (!Object.is(exp, act)) diagDiffs.push({ field: f, expected: exp, actual: act });
    }
    results.push({
      index: c.index, id: c.id, tags: c.tags, status: fieldDiffs.length ? 'fail' : 'pass',
      fieldDiffs, diagDiffs, expected: c.expected, actual,
    });
  }

  const total = results.length;
  const passed = results.filter((r) => r.status === 'pass').length;
  const failed = results.filter((r) => r.status === 'fail');
  const errored = results.filter((r) => r.status === 'error' || r.status === 'throw');

  const summary = {
    generatedAt: new Date().toISOString(),
    corePath: 'src/core/calc-core.js',
    total, passed, failed: failed.length, errored: errored.length,
    passRate: total ? Math.round((passed / total) * 10000) / 100 : 0,
    compareFields: COMPARE_FIELDS,
  };

  if (selfCheck) {
    const expected = new Set(mutated);
    const okSelf = failed.length === expected.size && failed.every((f) => expected.has(f.index));
    console.log('[self-check] 突变 ' + mutated.join(',') + ' → 检出失败 ' + failed.map((f) => f.index).join(',') +
      '（' + (okSelf ? '对拍器敏感度正常' : '对拍器可能假通过') + '）');
    process.exitCode = okSelf ? 0 : 3;
    return;
  }

  if (jsonOnly) {
    console.log(JSON.stringify({ summary, failures: failed.concat(errored) }, null, 2));
  } else {
    console.log('[compare] ' + passed + '/' + total + ' 通过（' + summary.passRate + '%）' +
      (failed.length ? '，失败 ' + failed.length : '') + (errored.length ? '，异常 ' + errored.length : ''));
    for (const f of failed.slice(0, 10)) {
      console.log('  FAIL #' + f.index + ' ' + f.id + ' -> ' + f.fieldDiffs.map((d) => d.field + ' 期望 ' + d.expected + ' 实际 ' + d.actual).join('; '));
    }
    for (const f of errored.slice(0, 5)) {
      console.log('  ERROR #' + f.index + ' ' + f.id + ' -> ' + String(f.message || '').split('\n')[0]);
    }
  }

  if (!noReport) {
    const domain = await loadDomain();
    const lines = [];
    lines.push('# 数值对拍报告（上游 oracle vs calc-core）');
    lines.push('');
    lines.push('- 生成时间：' + summary.generatedAt);
    lines.push('- 被测量：src/core/calc-core.js · computeFinalDamage(ctx)');
    lines.push('- 权威源：_intermediates/upstream/calculator.html 页面内 computeFinalDamage（CDP 实测）');
    lines.push('- 数据源：_intermediates/upstream/datas/final/*.json（622 精灵 / 824 技能 / 18 系）');
    lines.push('- 判定标准：**逐位完全相等**（Object.is），不含任何容差');
    lines.push('');
    lines.push('## 汇总');
    lines.push('');
    lines.push('| 指标 | 值 |');
    lines.push('| --- | --- |');
    lines.push('| 用例数 | ' + total + ' |');
    lines.push('| 通过 | ' + passed + ' |');
    lines.push('| 失败 | ' + failed.length + ' |');
    lines.push('| 异常 | ' + errored.length + ' |');
    lines.push('| 通过率 | ' + summary.passRate + '% |');
    lines.push('| 对拍字段 | ' + COMPARE_FIELDS.join(' / ') + ' |');
    lines.push('');
    if (failed.length || errored.length) {
      lines.push('## 失败明细（阻塞）');
      lines.push('');
      lines.push('| # | 用例 | 字段 | 期望（上游） | 实际（calc-core） | 标签 |');
      lines.push('| --- | --- | --- | --- | --- | --- |');
      for (const f of failed.concat(errored)) {
        if (f.status === 'fail') {
          const brief = (f.tags || []).join(',');
          for (const d of f.fieldDiffs) {
            lines.push('| ' + f.index + ' | ' + f.id + ' | ' + d.field + ' | ' + d.expected + ' | ' + d.actual + ' | ' + brief + ' |');
          }
        } else {
          lines.push('| ' + f.index + ' | ' + f.id + ' | 异常 | — | ' + String(f.message || '').split('\n')[0] + ' | — |');
        }
      }
      lines.push('');
    } else {
      lines.push('## 失败明细');
      lines.push('');
      lines.push('无。全部用例四项数值逐位一致。');
      lines.push('');
    }
    const diagFail = results.filter((r) => r.status === 'pass' && r.diagDiffs && r.diagDiffs.length);
    lines.push('## 诊断字段差异（不阻塞，仅供参考）');
    lines.push('');
    if (!diagFail.length) {
      lines.push('无。');
    } else {
      lines.push('| # | 用例 | 字段 | 期望 | 实际 |');
      lines.push('| --- | --- | --- | --- | --- |');
      for (const r of diagFail) for (const d of r.diagDiffs) lines.push('| ' + r.index + ' | ' + r.id + ' | ' + d.field + ' | ' + d.expected + ' | ' + d.actual + ' |');
    }
    lines.push('');
    lines.push('## 用例清单');
    lines.push('');
    lines.push('| # | id | 层 | 标签 | 期望 finalDamage | 实际 finalDamage | 结果 |');
    lines.push('| --- | --- | --- | --- | --- | --- | --- |');
    for (const r of results) {
      const n = fixtures.cases[r.index].req.starLayer;
      const exp = r.expected ? r.expected.finalDamage : '—';
      const act = r.actual ? r.actual.finalDamage : '—';
      lines.push('| ' + r.index + ' | ' + r.id + ' | ' + n + ' | ' + (r.tags || []).join(',') + ' | ' + exp + ' | ' + act + ' | ' +
        (r.status === 'pass' ? 'PASS' : r.status === 'fail' ? 'FAIL' : 'ERROR') + ' |');
    }
    lines.push('');
    if (domain && domain.__loadError) {
      lines.push('> 注：src/core/domain.js 加载失败（' + domain.__loadError + '），DN 层未纳入对拍。');
      lines.push('');
    }
    writeFileSync(REPORT, lines.join('\n'), 'utf8');
    console.log('[compare] 报告已写入 ' + REPORT);
  }

  if (failed.length || errored.length) process.exitCode = 1;
}

main().catch((e) => { console.error('COMPARE ERROR: ' + (e && e.stack ? e.stack : e)); process.exitCode = 2; });
