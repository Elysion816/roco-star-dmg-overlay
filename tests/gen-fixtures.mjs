#!/usr/bin/env node
// ============================================================================
// 星陨斩杀线 — fixtures 生成器
// ----------------------------------------------------------------------------
// 用上游 oracle（真实页面 computeFinalDamage）生成固化用例 tests/fixtures.json。
// 覆盖维度：物攻/魔攻/自适应、有/无 STAB、相性 0.25/0.5/1/2/3、连击技能、
// 特性 mod（坠星/和弦共振/多维击打/天体吸积）、应对状态分支、防御技能 reduction、
// UI chip、以及 0 层即斩 / 需要多层 / 不可斩（由 0..99 层扫描自动判定）。
//
// 用法：node tests/gen-fixtures.mjs [--verbose]
// 只写 tests/fixtures.json，不触碰 _intermediates/upstream 与 src。
// ============================================================================
import { createOracle, TARGET_TIERS } from './upstream-oracle.mjs';
import { writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const OUT = join(__dirname, 'fixtures.json');

// 攻方配置（nature up≠down；ivs 6 键取 3）
const PROFILES = {
  phys: { nature: { up: 'atk', down: 'matk' }, ivs: ['atk', 'hp', 'spd'] },
  magic: { nature: { up: 'matk', down: 'atk' }, ivs: ['matk', 'hp', 'spd'] },
  speed: { nature: { up: 'spd', down: 'def' }, ivs: ['spd', 'atk', 'matk'] },
};

// ---------------------------------------------------------------------------
// 静态用例：a=攻方 s=技能 d=靶子 ds=防御技能 p=profile tier=靶子档 n=星陨层
// ---------------------------------------------------------------------------
const CASES = [
  // ---- 物攻 ----
  { id: 'phys-stab-evil', tags: ['物攻', 'STAB', '相性1'], note: '恶系物攻 STAB 打 机械+火',
    a: '龙息帕尔', s: '彼岸之手', d: '贝古斯', ds: null, p: 'phys', tier: 't1', n: 3 },
  { id: 'phys-no-stab-dragon', tags: ['物攻', '无STAB', '相性0.5'], note: '恶系精灵打龙系技能，无 STAB',
    a: '龙息帕尔', s: '吹炎', d: '贝古斯', ds: null, p: 'phys', tier: 't1', n: 3 },
  { id: 'phys-default-bat-zero', tags: ['物攻', 'STAB', '0层'], note: '规格示例技能 蝙蝠，0 层',
    a: '龙息帕尔', s: '蝙蝠', d: '贝古斯', ds: null, p: 'phys', tier: 't1', n: 0 },
  { id: 'phys-eff3-fire', tags: ['物攻', 'STAB', '相性3'], note: '火系物攻双克制 机械+虫',
    a: '音速犬', s: '火云车', d: '飞飞钥', ds: null, p: 'phys', tier: 't1', n: 2 },
  { id: 'phys-combo2', tags: ['物攻', '连击2', '无STAB'], note: '2 连击技能基础值',
    a: '龙息帕尔', s: '连续爪击', d: '窃光蚊', ds: null, p: 'phys', tier: 't2', n: 4 },
  { id: 'phys-extreme', tags: ['物攻', 'STAB', '相性1', '档③'], note: '档③只有生命加点',
    a: '龙息帕尔', s: '极限撕裂', d: '贝古斯', ds: null, p: 'phys', tier: 't3', n: 1 },

  // ---- 魔攻 ----
  { id: 'magic-stab-phantom', tags: ['魔攻', 'STAB', '相性0.5'], note: '幻系魔攻被机械+火抵抗',
    a: '落陨星兔', s: '大爆炸', d: '贝古斯', ds: null, p: 'magic', tier: 't1', n: 5 },
  { id: 'magic-no-stab-normal', tags: ['魔攻', '无STAB', '相性0.5'], note: '普通系魔攻无 STAB',
    a: '粉耳星兔', s: '音爆', d: '贝古斯', ds: null, p: 'magic', tier: 't1', n: 5 },
  { id: 'magic-dragon', tags: ['魔攻', '无STAB', '相性1'], note: '高威力龙系魔攻',
    a: '落陨星兔', s: '升龙咆哮', d: '燃薪虫', ds: null, p: 'magic', tier: 't1', n: 4 },
  { id: 'magic-stab-eff1', tags: ['魔攻', 'STAB', '相性1'], note: '幻系魔攻对地+翼中性',
    a: '暮星辰', s: '四维降解', d: '泥吼牙', ds: null, p: 'magic', tier: 't2', n: 6 },
  { id: 'magic-high-matk', tags: ['魔攻', 'STAB', '档③'], note: '高魔攻精灵打档③',
    a: '粉耳星兔', s: '大爆炸', d: '燃薪虫', ds: null, p: 'magic', tier: 't3', n: 2 },

  // ---- 自适应（愿力冲击，18 系合成技能）----
  { id: 'adaptive-phys-path', tags: ['自适应', '物攻路径', 'STAB'], note: '物攻 127 > 魔攻 57，走物攻；恶 vs 机械火 = 1',
    a: '龙息帕尔', s: '__yuanli_恶__', d: '贝古斯', ds: null, p: 'phys', tier: 't1', n: 4 },
  { id: 'adaptive-magic-path', tags: ['自适应', '魔攻路径', 'STAB'], note: '魔攻 125 > 物攻 61，走魔攻',
    a: '落陨星兔', s: '__yuanli_幻__', d: '泥吼牙', ds: null, p: 'magic', tier: 't1', n: 5 },
  { id: 'adaptive-state-25', tags: ['自适应', '应对状态', '相性2'], note: '愿力冲击 + 聚能：威力 ×2.5，地 vs 水+电 = 2',
    a: '祭礼巨像', s: '__yuanli_地__', d: '利灯鱼', ds: '__state__', p: 'magic', tier: 't1', n: 2 },

  // ---- 相性全谱 ----
  { id: 'eff-025', tags: ['相性0.25'], note: '恶系打在 恶+光 双抵抗',
    a: '龙息帕尔', s: '彼岸之手', d: '窃光蚊', ds: null, p: 'phys', tier: 't2', n: 6 },
  { id: 'eff-05', tags: ['相性0.5'], note: '幻系被 机械+虫 抵抗',
    a: '落陨星兔', s: '大爆炸', d: '飞飞钥', ds: null, p: 'magic', tier: 't2', n: 8 },
  { id: 'eff-1', tags: ['相性1'], note: '幻系对 火+草 中性',
    a: '落陨星兔', s: '大爆炸', d: '燃薪虫', ds: null, p: 'magic', tier: 't2', n: 6 },
  { id: 'eff-2', tags: ['相性2', '无STAB'], note: '火系打 机械 单克制（恶系精灵无火 STAB）',
    a: '龙息帕尔', s: '火云车', d: '贝古斯', ds: null, p: 'phys', tier: 't2', n: 3 },
  { id: 'eff-3', tags: ['相性3', 'STAB', '档③'], note: '火系双克制 机械+虫',
    a: '音速犬', s: '火云车', d: '飞飞钥', ds: null, p: 'phys', tier: 't3', n: 1 },

  // ---- 连击 ----
  { id: 'combo-2', tags: ['连击2'], note: '普通 2 连击',
    a: '龙息帕尔', s: '连续爪击', d: '贝古斯', ds: null, p: 'phys', tier: 't3', n: 5 },
  { id: 'combo-3', tags: ['连击3', 'STAB'], note: '幽系 3 连击，幻系精灵无幽 STAB？——落陨星兔有幽系',
    a: '落陨星兔', s: '灵光', d: '爆焰喷喷', ds: null, p: 'magic', tier: 't2', n: 4 },
  { id: 'combo-mod-multi', tags: ['连击', '特性mod'], note: '多维击打：敌方每 1 层星陨连击 +1（1+6=7）',
    a: '落陨星兔', s: '多维击打', d: '贝古斯', ds: null, p: 'magic', tier: 't2', n: 6 },
  { id: 'combo-fire-3', tags: ['连击3', '相性2'], note: '火系 3 连击对 火+草',
    a: '粉耳星兔', s: '流火', d: '燃薪虫', ds: null, p: 'magic', tier: 't2', n: 3 },

  // ---- 特性 mod ----
  { id: 'ability-zhuixing-on', tags: ['特性mod', '坠星'], note: '祭礼巨像特性坠星：威力 ×(1+0.2n)',
    a: '祭礼巨像', s: '抛石', d: '飞飞钥', ds: null, p: 'phys', tier: 't1', n: 3 },
  { id: 'ability-zhuixing-off', tags: ['特性mod', '0层'], note: '同组合 0 层对照（特性不触发）',
    a: '祭礼巨像', s: '抛石', d: '飞飞钥', ds: null, p: 'phys', tier: 't1', n: 0 },
  { id: 'ability-heti-matk', tags: ['特性mod', '和弦共振'], note: '离心舞者特性：场上印记存在时魔攻 +50%',
    a: '离心舞者', s: '大爆炸', d: '贝古斯', ds: null, p: 'magic', tier: 't1', n: 3 },
  { id: 'ability-tianti', tags: ['特性mod', '技能mod', 'powerAdd'], note: '天体吸积：威力 +20n；叠加坠星 powerMult',
    a: '祭礼巨像', s: '天体吸积', d: '飞飞钥', ds: null, p: 'phys', tier: 't2', n: 7 },

  // ---- 应对状态分支（防御技能 category === 状态）----
  { id: 'state-dark-raid', tags: ['应对状态', 'powerMult2'], note: '暗突袭 + 聚能：威力 ×2',
    a: '龙息帕尔', s: '暗突袭', d: '贝古斯', ds: '__state__', p: 'phys', tier: 't1', n: 3 },
  { id: 'state-combo-double', tags: ['应对状态', '连击翻倍'], note: '连续爪击 + 聚能：连击 ×2',
    a: '龙息帕尔', s: '连续爪击', d: '贝古斯', ds: '__state__', p: 'phys', tier: 't1', n: 3 },
  { id: 'state-yuanli-25', tags: ['应对状态', 'powerMult2.5'], note: '愿力冲击 + 聚能：威力 ×2.5',
    a: '落陨星兔', s: '__yuanli_幽__', d: '爆焰喷喷', ds: '__state__', p: 'magic', tier: 't2', n: 4 },
  { id: 'state-chongji-ignore', tags: ['应对状态', 'ignoreResist'], note: '虫击 + 聚能：威力 ×2 且把 0.25 抗性中和为 1',
    a: '丢丢（草地附近的样子）', s: '虫击', d: '贝古斯', ds: '__state__', p: 'speed', tier: 't1', n: 2 },

  // ---- 真实防御技能 reduction ----
  { id: 'defskill-03', tags: ['防御技能'], note: '贝古斯 防御（reduction 0.3）',
    a: '龙息帕尔', s: '彼岸之手', d: '贝古斯', ds: '防御', p: 'phys', tier: 't1', n: 5 },
  { id: 'defskill-05', tags: ['防御技能'], note: '贝古斯 有效预防（reduction 0.5）',
    a: '落陨星兔', s: '大爆炸', d: '贝古斯', ds: '有效预防', p: 'magic', tier: 't2', n: 7 },

  // ---- UI chip ----
  { id: 'chip-combo', tags: ['chip', '连击'], note: '连击 chip +1 叠加到 2 连击技能',
    a: '龙息帕尔', s: '连续爪击', d: '贝古斯', ds: null, p: 'phys', tier: 't2', n: 3, combo: 1 },
  { id: 'chip-power', tags: ['chip', '威力'], note: '威力 chip +30 加在基础威力上',
    a: '龙息帕尔', s: '彼岸之手', d: '贝古斯', ds: null, p: 'phys', tier: 't2', n: 3, powerBoost: 30 },
];

// ---------------------------------------------------------------------------
// 扫描用例：0..99 层逐层求最小斩杀层，自动判定 0层即斩 / 需多层 / 不可斩
// ---------------------------------------------------------------------------
const SCANS = [
  { id: 'scan-medium', note: '中坚物攻打档①', a: '龙息帕尔', s: '彼岸之手', d: '贝古斯', ds: null, p: 'phys', tier: 't1' },
  { id: 'scan-fast', note: '双克制物攻，可能 0 层即斩', a: '音速犬', s: '火云车', d: '飞飞钥', ds: null, p: 'phys', tier: 't1' },
  { id: 'scan-weak-magic', note: '低魔攻打高特防，预期不可斩', a: '落陨星兔', s: '升龙咆哮', d: '贝古斯', ds: null, p: 'magic', tier: 't1' },
  { id: 'scan-bulky', note: '高 HP 火系靶子', a: '粉耳星兔', s: '音爆', d: '火焰猿', ds: null, p: 'magic', tier: 't1' },
  { id: 'scan-low-tier', note: '档③低血量靶子', a: '祭礼巨像', s: '抛石', d: '飞飞钥', ds: null, p: 'phys', tier: 't3' },
  { id: 'scan-combo-mod', note: '多维击打高连击成长', a: '落陨星兔', s: '多维击打', d: '泥吼牙', ds: null, p: 'magic', tier: 't1' },
  // 幻系技能不触发星陨伤害（starLayer 无加成），低攻打高防 → 99 层仍不可斩
  { id: 'scan-unkillable-phantom', note: '离心舞者念力膨胀（幻系，无星陨伤害）打飞飞钥档①', a: '离心舞者', s: '念力膨胀', d: '飞飞钥', ds: null, p: 'phys', tier: 't1' },
  { id: 'scan-unkillable-extreme', note: '空空颅多维击打（幻系魔攻 p15）对最高血量档①，极端不可斩', a: '空空颅', s: '多维击打', d: '飞飞钥', ds: null, p: 'magic', tier: 't1' },
];

function buildReq(def, n) {
  const tier = TARGET_TIERS[def.tier];
  const prof = PROFILES[def.p];
  return {
    attackerId: def.a,
    skillId: def.s,
    defenderId: def.d,
    defenseSkillId: def.ds || null,
    attackerNature: prof.nature,
    attackerIVs: prof.ivs,
    defenderNature: tier.nature,
    defenderIVs: tier.ivs,
    starLayer: n,
    attackerCombo: def.combo || 0,
    attackerPowerBoost: def.powerBoost || 0,
  };
}

function upstreamRev() {
  try {
    return execSync('git -C "' + join(ROOT, '_intermediates', 'upstream') + '" rev-parse --short HEAD', { encoding: 'utf8' }).trim();
  } catch (e) { return null; }
}

async function main() {
  const oracle = await createOracle();
  try {
    // 1) 静态用例展开
    const entries = CASES.map((c) => ({ def: c, n: c.n == null ? 0 : c.n, origin: 'static' }));

    // 2) 扫描用例：0..99 找最小斩杀层
    const scanSummary = [];
    for (const sc of SCANS) {
      const reqs = [];
      for (let n = 0; n <= 99; n++) reqs.push(buildReq(sc, n));
      const rows = await oracle.computeBatch(reqs);
      let minKill = null;
      for (let n = 0; n < rows.length; n++) { if (rows[n].isKill) { minKill = n; break; } }
      scanSummary.push({ id: sc.id, note: sc.note, minKillLayer: minKill });

      const mk = (id, tags, note) => Object.assign({}, sc, { id: id, tags: tags, note: note });
      if (minKill === 0) {
        entries.push({ def: mk(sc.id + '-zero', ['0层即斩', sc.id], sc.note), n: 0, origin: 'scan' });
      } else if (minKill === null) {
        entries.push({ def: mk(sc.id + '-unkillable', ['不可斩', sc.id], sc.note + '（99 层仍不够）'), n: 99, origin: 'scan' });
      } else {
        entries.push({ def: mk(sc.id + '-kill', ['需多层', 'minKill=' + minKill, sc.id], sc.note), n: minKill, origin: 'scan' });
        if (minKill > 0) {
          entries.push({ def: mk(sc.id + '-below', ['临界未斩', 'minKill=' + minKill, sc.id], sc.note + '（比 minKill 少 1 层）'), n: minKill - 1, origin: 'scan' });
        }
      }
      console.error('[gen] ' + sc.id + ' minKillLayer=' + minKill);
    }

    // 3) 一次性取权威值
    const reqs = entries.map((e) => buildReq(e.def, e.n));
    const rows = await oracle.computeBatch(reqs);

    // 4) 组装
    const cases = entries.map((e, i) => ({
      index: i,
      id: e.def.id,
      tags: e.def.tags,
      note: e.def.note,
      origin: e.origin,
      req: reqs[i],
      expected: rows[i],
    }));

    const bad = cases.filter((c) => !c.expected || c.expected.error || !Number.isFinite(c.expected.finalDamage) || !Number.isFinite(c.expected.defHP));
    if (bad.length) {
      console.error('生成失败：' + bad.length + ' 组无有效 oracle 结果');
      for (const b of bad.slice(0, 5)) console.error('  ' + b.id + ': ' + JSON.stringify(b.expected));
      process.exitCode = 1;
      return;
    }

    const tagCount = {};
    for (const c of cases) for (const t of c.tags) tagCount[t] = (tagCount[t] || 0) + 1;

    const out = {
      meta: {
        generatedAt: new Date().toISOString(),
        generator: 'tests/gen-fixtures.mjs',
        oracle: {
          page: 'http://127.0.0.1:8765/calculator.html',
          upstreamGit: upstreamRev(),
          dataDir: '_intermediates/upstream/datas/final',
          counts: oracle.pageInfo.counts,
          fn: 'computeFinalDamage(ctx) @ calculator.js:3948',
        },
        targetTiers: TARGET_TIERS,
        attackerProfiles: PROFILES,
        caseCount: cases.length,
        tagCount,
        scanSummary,
        compareFields: ['finalDamage', 'skillDmg', 'starDmg', 'defHP'],
        diagnosticFields: ['starPower', 'stab', 'skillEff', 'skillEffRaw', 'starEff', 'combo', 'isMagic', 'atkStat', 'defStat', 'isKill', 'starTriggered', 'isSkillIllusion'],
      },
      cases,
    };
    writeFileSync(OUT, JSON.stringify(out, null, 2), 'utf8');
    console.log('[gen] 写出 ' + OUT + '（' + cases.length + ' 组）');
    const zero = cases.filter((c) => c.tags.some((t) => t.startsWith('0层') || t === '0层即斩')).length;
    const unk = cases.filter((c) => c.tags.includes('不可斩')).length;
    const multi = cases.filter((c) => c.tags.includes('需多层')).length;
    console.log('[gen] 0层即斩 ' + zero + ' / 需多层 ' + multi + ' / 不可斩 ' + unk);
    console.log('[gen] tags: ' + JSON.stringify(tagCount));
  } finally {
    await oracle.close();
  }
}

main().catch((e) => { console.error('GEN ERROR: ' + (e && e.stack ? e.stack : e)); process.exitCode = 1; });
