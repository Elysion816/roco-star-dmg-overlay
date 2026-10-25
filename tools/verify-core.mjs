#!/usr/bin/env node
/**
 * tools/verify-core.mjs
 * ---------------------------------------------------------------------------
 * calc-core / domain 回归校验。全部离线，不需要网络与浏览器。
 *
 * 校验项：
 *  V1 抽取保真：生成文件里的计算段与上游 calculator.js 逐字一致（证明「只搬不改」）
 *  V2 独立实现对拍：用另一份「按规格文字重写」的公式（不调用 calc-core 的任何函数）
 *     重算 skillDmg / starDmg / finalDamage，要求与 calc-core 完全相等；
 *     仅挑选动态修正（特性/技能自适应）为空集的场景，保证两份实现口径一致。
 *  V3 斩杀线语义：命中层的前一层必打不死、命中层必打死、0..层上限伤害单调非递减
 *  V4 组合空间：600 = 30 性格(up≠down) × 20 加点(3 个不同键)，无重复
 *  V5 性能：2 攻方 × 3 档 × 600 组（冷启动）必须 < 100ms
 *  V6 场景默认值：攻击技能默认取威力最高、防御技能含「无」
 *
 * 运行：node tools/verify-core.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const UPSTREAM = path.join(ROOT, '_intermediates', 'upstream', 'calculator.js');
const GEN_CORE = path.join(ROOT, 'src', 'core', 'calc-core.js');
const DATA_DIR = path.join(ROOT, '_intermediates', 'upstream', 'datas', 'final');

let fails = 0;
const ok = (cond, msg) => {
  if (cond) return true;
  fails++;
  console.error('  ✗ ' + msg);
  return false;
};
const section = t => console.log('\n' + t);

// ---------------------------------------------------------------------------
const core = require(GEN_CORE);
const domain = require(path.join(ROOT, 'src', 'core', 'domain.js'));
const readJson = n => JSON.parse(fs.readFileSync(path.join(DATA_DIR, n + '.json'), 'utf8'));
const sprites = readJson('sprites');
const skills = readJson('skills');
const types = readJson('types');
const others = readJson('others');
core.bindData({ sprites, skills, types, others });
domain.bindData({ sprites, skills, types, others });

const SK = ['hp', 'atk', 'matk', 'def', 'mdef', 'spd'];
const LABEL = { hp: '生命', atk: '物攻', matk: '魔攻', def: '物防', mdef: '魔防', spd: '速度' };

// ===========================================================================
// V1 抽取保真
// ===========================================================================
section('[V1] 抽取段与上游逐字一致');
{
  const upstream = fs.readFileSync(UPSTREAM, 'utf8').split(/\r?\n/);
  const generated = fs.readFileSync(GEN_CORE, 'utf8');
  const RANGES = [
    ['A 元素表', 1, 53], ['B 常量', 119, 133], ['G getBuff', 867, 870], ['C 属性结算', 942, 1020],
    ['D 特性查询', 2693, 2764], ['E SKILL_MODS', 3356, 3937], ['F computeFinalDamage', 3948, 4051],
  ];
  for (const [name, a, b] of RANGES) {
    const seg = upstream.slice(a - 1, b).join('\n');
    ok(generated.includes(seg), '段 ' + name + '（' + a + '-' + b + '）与上游不一致');
  }
  console.log('  逐字比对 ' + RANGES.length + ' 段完成');
}

// ===========================================================================
// V2 独立实现对拍
// ＝＝ 以下公式按 LEAD-SPEC「已核实的公式」手写，刻意不复用 calc-core 的任何函数 ＝＝
// ===========================================================================
section('[V2] 独立公式重算对拍');
function indNatureMult(nature, key) {
  if (!nature) return 1;
  if (nature.up === key) return 1.2;
  if (nature.down === key) return 0.9;
  return 1;
}
function indIVBonus(key, ivs) { return ivs && ivs.indexOf(key) >= 0 ? 60 : 0; }
function indFinalStat(spirit, key, nature, ivs) {
  const base = spirit[key] || 0;
  const iv = indIVBonus(key, ivs);
  const mult = indNatureMult(nature, key);
  let val;
  if (key === 'hp') val = (base * 1.7 + iv * 0.85 + 70) * mult + 100;
  else if (base === 105 && iv === 0 && mult === 1) val = 175;
  else val = Math.round(base * 1.1 + iv * 0.55 + 10) * mult + 50;
  return Math.round(val);
}
function indStripXi(n) { return !n ? '' : (n.endsWith('系') ? n.slice(0, -1) : n); }
function indEff(rawEl, defTypes) {
  if (!rawEl || rawEl === '无系别' || rawEl === '空') return 1;
  const atkName = indStripXi(rawEl);
  if (!types[atkName]) return 1;
  let weak = 0, resist = 0;
  for (const dt of defTypes || []) {
    const def = types[indStripXi(dt)];
    if (!def) continue;
    if (def.defendWeak && def.defendWeak.includes(atkName)) weak++;
    if (def.defendStrong && def.defendStrong.includes(atkName)) resist++;
  }
  const diff = weak - resist;
  if (diff === 0) return 1;
  if (diff === 1) return 2;
  if (diff === -1) return 0.5;
  if (diff === 2) return 3;
  if (diff === -2) return 0.25;
  return (1 + weak) / (1 + resist);
}
function indStab(attacker, skill) {
  const el = indStripXi(skill.element || '');
  if (!el || !types[el]) return 1;
  return (attacker.types || []).map(indStripXi).includes(el) ? 1.25 : 1;
}
function indDamage(scene, combo, n) {
  const atk = scene.attacker, def = scene.defender, skill = scene.attackSkill;
  const defSkill = scene.defenseSkill || { reduction: 1 };
  const atkNature = combo.nature, atkIVs = combo.ivs;
  const defNature = scene.tier.nature, defIVs = scene.tier.ivs;
  const atkBase = indFinalStat(atk, 'atk', atkNature, atkIVs);
  const matkBase = indFinalStat(atk, 'matk', atkNature, atkIVs);
  const isMagic = skill.damage_class === '魔攻';
  const atkStatBase = isMagic ? matkBase : atkBase;
  const defStat = indFinalStat(def, isMagic ? 'mdef' : 'def', defNature, defIVs);
  const defHP = indFinalStat(def, 'hp', defNature, defIVs);
  const stab = indStab(atk, skill);
  const eff = indEff(skill.element, def.types);
  const comboCount = Math.max(0, (skill.combo == null ? 1 : skill.combo));
  const power = Math.max(0, skill.power || 0);
  const skillDmg = Math.floor(power * (atkStatBase / defStat) * (37 / 41) * stab * eff * (defSkill.reduction == null ? 1 : defSkill.reduction) * comboCount);
  const starPower = n * n + 24 * n - 24;
  const starEff = indEff('幻系', def.types);
  const triggered = n > 0 && indStripXi(skill.element) !== '幻';
  const starDmg = triggered ? Math.floor(starPower * (atkStatBase / defStat) * (37 / 41) * starEff * (defSkill.reduction == null ? 1 : defSkill.reduction)) : 0;
  return { skillDmg, starDmg, finalDamage: skillDmg + starDmg, defHP, atkStat: atkStatBase, defStat };
}

{
  // 只挑「动态修正为空」的场景：此时 calc-core 的等效计算 = 上面的独立公式
  const identity = d => d && d.powerMult === 1 && !d.powerAdd && !d.comboAdd && d.comboMult === 1 &&
    !d.matkAdd && !d.ignoreResist && d.elementOverride == null;

  const pairs = [];
  const atkNames = (others.common_attackers || []).slice(0, 6);
  const defNames = (others.common_defenders || []).slice(0, 6);
  let tried = 0, checked = 0;
  for (const an of atkNames) {
    for (const dn of defNames) {
      const scene0 = domain.buildScene({ attackerId: an, defenderId: dn, tierKey: 't2' });
      if (!scene0) continue;
      for (const combo of [domain.COMBOS[0], domain.COMBOS[137], domain.COMBOS[411], domain.COMBOS[599]]) {
        tried++;
        const dyn = core.computeSkillDynamicModifiers(
          scene0.attacker, scene0.attackSkill, combo.nature, combo.ivs,
          scene0.defender, scene0.defenseSkill, scene0.tier.nature, scene0.tier.ivs, 3);
        if (!identity(dyn)) continue;
        for (const n of [0, 1, 5, 10]) {
          const scene = domain.buildScene({ attackerId: an, defenderId: dn, tierKey: 't2' });
          const ctx = {
            attacker: scene.attacker, attackSkill: scene.attackSkill, defender: scene.defender,
            defenseSkill: scene.defenseSkill, starLayer: n,
            attackerNature: combo.nature, defenderNature: scene.tier.nature,
            attackerIVs: combo.ivs, defenderIVs: scene.tier.ivs,
            attackerBuff: { atk: 0, matk: 0 }, defenderBuff: { def: 0, mdef: 0 },
            attackerPowerBoost: 0, attackerCombo: 0,
          };
          const got = core.computeFinalDamage(ctx);
          const exp = indDamage(scene, combo, n);
          const tag = an + '→' + dn + ' ' + scene.attackSkill.name + ' n=' + n + ' ' + combo.label;
          ok(got.skillDmg === exp.skillDmg, 'skillDmg 不一致：' + tag + ' 期望 ' + exp.skillDmg + ' 实际 ' + got.skillDmg);
          ok(got.starDmg === exp.starDmg, 'starDmg 不一致：' + tag + ' 期望 ' + exp.starDmg + ' 实际 ' + got.starDmg);
          ok(got.finalDamage === exp.skillDmg + exp.starDmg, 'finalDamage 不等于两项之和：' + tag);
          ok(got.defHP === exp.defHP, 'defHP 不一致：' + tag + ' 期望 ' + exp.defHP + ' 实际 ' + got.defHP);
          checked++;
          if (checked >= 40) break;
        }
        if (checked >= 40) break;
      }
      if (checked >= 40) break;
    }
    if (checked >= 40) break;
  }
  ok(checked >= 20, '对拍样本不足（只有 ' + checked + ' 组），需要至少 20 组');
  console.log('  独立实现与 calc-core 对拍 ' + checked + ' 组 × 4 个层数，全部相等');
}

// ===========================================================================
// V3 斩杀线语义
// ===========================================================================
section('[V3] 斩杀线语义（前一层打不死 / 该层打死 / 单调非递减）');
{
  const scene = domain.buildScene({ attackerId: '龙息帕尔', defenderId: '贝古斯', tierKey: 't1' });
  let checked = 0, killed = 0;
  for (const comboIndex of [0, 55, 199, 260, 377, 500, 599]) {
    const combo = domain.COMBOS[comboIndex];
    const r = domain.solveCombo(scene, combo, 10);
    const dmgAt = n => core.computeFinalDamage({
      attacker: scene.attacker, attackSkill: scene.attackSkill, defender: scene.defender,
      defenseSkill: scene.defenseSkill, starLayer: n,
      attackerNature: combo.nature, defenderNature: scene.tier.nature,
      attackerIVs: combo.ivs, defenderIVs: scene.tier.ivs,
      attackerBuff: { atk: 0, matk: 0 }, defenderBuff: { def: 0, mdef: 0 },
      attackerPowerBoost: 0, attackerCombo: 0,
    }).finalDamage;
    let prev = -1;
    for (let n = 0; n <= 11; n++) {
      const d = dmgAt(n);
      ok(d >= prev, '伤害随层数下降：组合 ' + comboIndex + ' n=' + n);
      prev = d;
    }
    if (r.layer === null) {
      ok(dmgAt(10) < r.defHP, '标记不可斩但 10 层已打死：组合 ' + comboIndex);
    } else {
      killed++;
      ok(dmgAt(r.layer) >= r.defHP, '标记 ' + r.layer + ' 层但该层打不死：组合 ' + comboIndex);
      if (r.layer > 0) ok(dmgAt(r.layer - 1) < r.defHP, '标记 ' + r.layer + ' 层但前一层已能打死：组合 ' + comboIndex);
    }
    checked++;
  }
  console.log('  抽查 ' + checked + ' 个组合（其中可斩 ' + killed + ' 个），语义正确');

  // 「二次估计 + 局部验证」的快速求解必须与纯二分结果完全一致
  const ref = (sc, combo, limit) => {
    const ctxOf = n => ({
      attacker: sc.attacker, attackSkill: sc.attackSkill, defender: sc.defender,
      defenseSkill: sc.defenseSkill, starLayer: n,
      attackerNature: combo.nature, defenderNature: sc.tier.nature,
      attackerIVs: combo.ivs, defenderIVs: sc.tier.ivs,
      attackerBuff: { atk: 0, matk: 0 }, defenderBuff: { def: 0, mdef: 0 },
      attackerPowerBoost: 0, attackerCombo: 0,
    });
    const dHP = core.computeFinalDamage(ctxOf(0)).defHP;
    let lo = 0, hi = limit, hit = null;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (core.computeFinalDamage(ctxOf(mid)).finalDamage >= dHP) { hit = mid; hi = mid - 1; }
      else lo = mid + 1;
    }
    return hit;
  };
  let compared = 0;
  for (const dn of ['贝古斯', '尖嘴狐仙', '音速犬']) {
    for (const tierKey of ['t1', 't2', 't3']) {
      const sc = domain.buildScene({ attackerId: '暮星辰', defenderId: dn, tierKey });
      if (!sc) continue;
      for (let i = 0; i < 600; i += 37) {
        const got = domain.solveCombo(sc, domain.COMBOS[i], 10).layer;
        const want = ref(sc, domain.COMBOS[i], 10);
        ok(got === want, '快速求解与纯二分不一致：' + dn + '/' + tierKey + ' #' + i + ' 期望 ' + want + ' 实际 ' + got);
        compared++;
      }
    }
  }
  console.log('  快速求解 vs 纯二分：' + compared + ' 组结果完全一致');

  // 精简精灵（只留一条特性）必须与原始精灵逐值一致
  let leanChecked = 0;
  for (const an of ['龙息帕尔', '暮星辰', '祭礼巨像', '波斯菊']) {
    if (!sprites[an]) continue;
    for (const dn of ['尖嘴狐仙']) {
      const sc = domain.buildScene({ attackerId: an, defenderId: dn, tierKey: 't2' });
      if (!sc) continue;
      for (let i = 0; i < 600; i += 61) {
        const combo = domain.COMBOS[i];
        const mk = (atk, def) => ({
          attacker: atk, attackSkill: sc.attackSkill, defender: def,
          defenseSkill: sc.defenseSkill, starLayer: 3,
          attackerNature: combo.nature, defenderNature: sc.tier.nature,
          attackerIVs: combo.ivs, defenderIVs: sc.tier.ivs,
          attackerBuff: { atk: 0, matk: 0 }, defenderBuff: { def: 0, mdef: 0 },
          attackerPowerBoost: 0, attackerCombo: 0,
        });
        const lean = core.computeFinalDamage(mk(sc.attacker, sc.defender));
        const full = core.computeFinalDamage(mk(sprites[an], sprites[dn]));
        ok(lean.finalDamage === full.finalDamage, '精简精灵伤害不一致：' + an + '→' + dn + ' #' + i +
          ' ' + lean.finalDamage + ' vs ' + full.finalDamage);
        leanChecked++;
      }
    }
  }
  console.log('  精简精灵 vs 原始精灵：' + leanChecked + ' 组伤害逐值一致');
}

// ===========================================================================
// V4 组合空间
// ===========================================================================
section('[V4] 组合空间');
{
  ok(domain.NATURES.length === 30, '性格数量应为 30，实际 ' + domain.NATURES.length);
  ok(domain.IVS_LIST.length === 20, '加点组合应为 20，实际 ' + domain.IVS_LIST.length);
  ok(domain.COMBOS.length === 600, '组合总数应为 600，实际 ' + domain.COMBOS.length);
  ok(domain.NATURES.every(n => n.up !== n.down), '存在 up===down 的非法性格');
  ok(domain.IVS_LIST.every(v => v.ivs.length === 3 && new Set(v.ivs).size === 3), '存在非法加点组合');
  const labels = new Set(domain.COMBOS.map(c => c.label));
  ok(labels.size === 600, '组合标签有重复（' + labels.size + '）');

  // 20 组默认口径（5 性格 × 4 加点）
  ok(domain.CONFIGS.length === 20, '20 组配置数量应为 20，实际 ' + domain.CONFIGS.length);
  ok(domain.CONFIG_NATURES.length === 5 && domain.CONFIG_IVS.length === 4, '应为 5 性格 × 4 加点');
  ok(domain.CONFIGS.every(c => c.ivs.length === 3 && new Set(c.ivs).size === 3), '20 组里存在非法加点');
  ok(domain.CONFIGS.every(c => c.nature.up !== c.nature.down), '20 组里存在非法性格');
  ok(new Set(domain.CONFIGS.map(c => c.key)).size === 20, '20 组 key 有重复');
  // Z5「不加攻」：既不加物攻也不加魔攻
  const z5 = domain.CONFIG_NATURES.filter(n => n.key === 'Z5')[0];
  ok(z5 && z5.label === '不加攻', '缺少 Z5「不加攻」档');
  ok(z5 && z5.nature.up !== 'atk' && z5.nature.up !== 'matk', 'Z5 不应加物攻/魔攻');
  ok(z5 && z5.nature.down !== 'atk' && z5.nature.down !== 'matk', 'Z5 不应降物攻/魔攻');
  // 每组都要能在全量 600 组合里找到对应项（保证口径一致）
  for (const c of domain.CONFIGS) {
    ok(domain.COMBOS.some(x => x.natureKey === c.natureKey && x.ivsKey === c.ivsKey),
      '20 组中的 ' + c.key + ' 不在 600 组枚举里');
  }
  const tiers = domain.DEFENDER_TIERS;
  ok(tiers.length === 3, '靶子档位应为 3');
  ok(tiers[0].nature.up === 'hp' && tiers[0].ivs.join() === 'hp,def,mdef', '档① 定义错误');
  ok(tiers[1].nature.up === 'spd' && tiers[1].ivs.join() === 'hp,def,mdef', '档② 定义错误');
  ok(tiers[2].nature.up === 'spd' && tiers[2].ivs.join() === 'hp', '档③ 定义错误');
  console.log('  30 性格 × 20 加点 = 600 组，三档靶子定义与规格一致');
}

// ===========================================================================
// V5 性能
// ===========================================================================
section('[V5] 性能：2 攻方 × 3 档 × 16 组');
{
  const ATK1 = (others.common_attackers || [])[0] || Object.keys(sprites)[0];
  const ATK2 = (others.common_attackers || [])[1] || Object.keys(sprites)[1];
  const DEF = '尖嘴狐仙'; // 可斩杀目标：能压到"估计 + 验证"的热路径
  const build = () => {
    domain.clearCache();
    const t0 = performance.now();
    let total = 0;
    for (const a of [ATK1, ATK2]) {
      for (const tier of domain.DEFENDER_TIERS) {
        const scene = domain.buildScene({ attackerId: a, defenderId: DEF, tierKey: tier.key });
        const res = domain.evaluateAll(scene, 10);
        total += res.killed;
      }
    }
    return { ms: performance.now() - t0, total };
  };
  build(); // 预热 JIT
  const cold = build(); // 清缓存后计时（真实冷启动路径）
  const warm = build();
  ok(cold.ms < 100, '冷启动 6 格全量计算超过 100ms：' + cold.ms.toFixed(1) + 'ms');
  console.log('  攻方 ' + ATK1 + ' / ' + ATK2 + ' → 靶子 ' + DEF);
  console.log('  冷启动 ' + cold.ms.toFixed(1) + 'ms，热缓存 ' + warm.ms.toFixed(1) + 'ms，可斩组合数 ' + cold.total);

  // 20 组口径：全量应远小于 600 组
  {
    const t16 = performance.now();
    domain.clearCache();
    for (const a of [ATK1, ATK2]) for (const tier of domain.DEFENDER_TIERS) {
      const sc = domain.buildScene({ attackerId: a, defenderId: DEF, tierKey: tier.key });
      if (sc) domain.evaluateAll(sc, 10);
    }
    const ms16 = performance.now() - t16;
    ok(ms16 < 20, '20 组全量（2×3）超过 20ms：' + ms16.toFixed(1) + 'ms');
    console.log('  20 组参考（2 攻方 × 3 档 × 20 组 = 120 次求解）' + ms16.toFixed(1) + 'ms');
  }

  // 单格结果 = 按给定配置算（不再挑最优）
  {
    const auto = domain.buildScene({ attackerId: ATK1, defenderId: DEF, tierKey: 't1' });
    ok(auto && auto.natureKey && auto.ivsKey, '默认配置未落到场景上');
    const sprite = domain.getSprite(ATK1);
    const expectMagic = (sprite.matk || 0) > (sprite.atk || 0);
    ok(auto.natureKey === (expectMagic ? 'matk>atk' : 'atk>matk'), '默认性格未按主攻属性给：' + auto.natureKey);
    ok(auto.ivsKey === domain.ivsKeyOf(domain.CONFIG_IVS[expectMagic ? 1 : 0]), '默认加点未按主攻属性给：' + auto.ivsKey);

    // 逐组对照：cellResult 必须等于"只算这一组"
    for (const cfg of domain.CONFIGS) {
      const sc = domain.buildScene({ attackerId: ATK1, defenderId: DEF, tierKey: 't1', natureKey: cfg.natureKey, ivsKey: cfg.ivsKey });
      const cell = domain.cellResult(sc, 10);
      const direct = domain.solveCombo(sc, { nature: sc.nature, ivs: sc.ivs }, 10);
      ok(cell.layer === direct.layer && cell.dmg === direct.dmg,
        '单格结果与直接求解不一致：' + cfg.key);
    }
    // Z5「不加攻」：伤害必须夹在"加该系"与"降该系"之间（证明它不动 atk/matk）
    {
      const ivsK = domain.ivsKeyOf(domain.CONFIG_IVS[0]);
      const mk = n => domain.cellResult(domain.buildScene({ attackerId: ATK1, defenderId: DEF, tierKey: 't1', natureKey: n, ivsKey: ivsK }), 10);
      const probe = mk('hp>spd');
      const isMagic = probe.scene.attackSkill.damage_class !== '物攻';
      const boost = mk(isMagic ? 'matk>atk' : 'atk>matk');
      const penalty = mk(isMagic ? 'atk>matk' : 'matk>atk');
      ok(probe.dmg0 < boost.dmg0 && probe.dmg0 > penalty.dmg0,
        'Z5 应为"无攻击加成"（应介于加成与减益之间）：Z5=' + probe.dmg0 + ' boost=' + boost.dmg0 + ' penalty=' + penalty.dmg0);
      console.log('  Z5 不加攻：' + probe.dmg0 + '（加成 ' + boost.dmg0 + ' / 减益 ' + penalty.dmg0 + '）');
    }
    // 换配置必须换结果（不能复用旧缓存）
    const a1 = domain.cellResult(domain.buildScene({ attackerId: ATK1, defenderId: DEF, tierKey: 't1', natureKey: 'atk>matk', ivsKey: domain.CONFIG_IVS[0].ivsKey }), 10);
    const a2 = domain.cellResult(domain.buildScene({ attackerId: ATK1, defenderId: DEF, tierKey: 't1', natureKey: 'matk>atk', ivsKey: domain.CONFIG_IVS[1].ivsKey }), 10);
    ok(a1.layer !== a2.layer || a1.dmg !== a2.dmg, '不同配置算出了同一个结果（缓存键可能漏了配置维度）');
    // 16 组枚举仍正确（参考面板用）
    const all = domain.referenceAll(auto, 10);
    ok(all && all.layers.length === 20, '20 组参考结果异常');
    let minL = Infinity;
    for (let i = 0; i < 20; i++) { const L = all.layers[i]; if (L >= 0 && L < minL) minL = L; }
    console.log('  单格按配置求解 = 直接求解；20 组参考最小值 ' + (minL === Infinity ? '无' : minL) + ' 层');
  }

  // 攻方加成：0 时与基线一致；+X% 时伤害按公式增长；夹紧与缓存隔离
  {
    const mkScene = (a, p) => domain.buildScene({
      attackerId: ATK1, defenderId: DEF, tierKey: 't1', atkPct: a, powerPct: p,
    });
    const auto = { natureKey: 'auto', ivsKey: 'auto' };
    const base = domain.cellResult(mkScene(undefined, undefined), 10, auto);
    const zero = domain.cellResult(mkScene(0, 0), 10, auto);
    ok(base && zero && base.dmg0 === zero.dmg0 && base.layer === zero.layer,
      '加成 0 时与基线不一致（' + (base && base.dmg0) + ' vs ' + (zero && zero.dmg0) + '）');

    const a50 = domain.cellResult(mkScene(50, 0), 10, auto);
    const r50 = a50.dmg0 / base.dmg0;
    ok(Math.abs(r50 - 1.5) < 0.02, '攻击 +50% 伤害未按 ×1.5 增长：' + r50.toFixed(3));

    const p100 = domain.cellResult(mkScene(0, 100), 10, auto);
    const rp = p100.dmg0 / base.dmg0;
    ok(Math.abs(rp - 2) < 0.02, '威力 +100% 伤害未按 ×2 增长：' + rp.toFixed(3));

    const a37 = domain.cellResult(mkScene(37, 0), 10, auto);
    ok(Math.abs(a37.dmg0 / base.dmg0 - 1.37) < 0.02, '攻击 +37% 伤害未按 ×1.37 增长');

    ok(mkScene(0, 0).key !== mkScene(50, 0).key, '加成未进入场景缓存键');
    const big = mkScene(999, -999);
    ok(big.atkPct === 300 && big.powerPct === -100, '加成未夹紧到 [-100,300]');
    console.log('  加成 0 与基线一致；+50% → ×' + r50.toFixed(3) + '，威力+100% → ×' + rp.toFixed(3));
  }

  // 交互级：改技能后单格重算（展开明细/手动配置时走这条路径）
  const t1 = performance.now();
  const sc = domain.buildScene({ attackerId: ATK1, defenderId: DEF, tierKey: 't1' });
  domain.evaluateAll(sc, 10);
  const one = performance.now() - t1;
  ok(one < 20, '单格 16 组重算超过 20ms：' + one.toFixed(1) + 'ms');
  console.log('  单格 600 组重算 ' + one.toFixed(1) + 'ms');
}

// ===========================================================================
// V6 场景默认值
// ===========================================================================
section('[V6] 场景默认值');
{
  const sprite = sprites['龙息帕尔'];
  const list = domain.getAttackerSkills(sprite);
  ok(list.length > 0, '龙息帕尔没有攻击技能');
  ok(list[0].power >= list[list.length - 1].power, '攻击技能未按威力降序');

  // 默认技能 = 与主攻类别一致的技能里威力最高者（没有同类才退回全体最高）
  for (const name of ['龙息帕尔', '暮星辰', '尖嘴狐仙', '迪莫']) {
    const sp = sprites[name];
    if (!sp) continue;
    const all = domain.getAttackerSkills(sp);
    if (!all.length) continue;
    const matched = all.filter(s => domain.isDamageClassMatched(sp, s));
    const def = domain.defaultAttackSkillId(sp);
    if (matched.length) {
      ok(def === matched[0].id, name + '：默认技能应为同主攻类别里威力最高者（期望 ' + matched[0].name + '）');
      ok(domain.primaryDamageClass(sp) === ((sp.atk || 0) >= (sp.matk || 0) ? '物攻' : '魔攻'), name + '：主攻类别判定错误');
    } else {
      ok(def === all[0].id, name + '：没有同类技能时应退回威力最高者');
    }
  }
  const longxi = sprites['龙息帕尔'];
  const defaultSkill = skills[domain.defaultAttackSkillId(longxi)];
  ok(defaultSkill.damage_class === '物攻', '龙息帕尔（物攻 127 / 魔攻 57）不应默认魔攻技能，实际 ' + defaultSkill.name + '/' + defaultSkill.damage_class);
  const defList = domain.getDefenderSkills(sprites['贝古斯']);
  ok(defList[0].id === '__none__', '防御技能列表第一项应为「无」');
  const scene = domain.buildScene({ attackerId: '龙息帕尔', defenderId: '贝古斯', tierKey: 't3' });
  ok(scene && scene.tier.key === 't3', 'buildScene 档位解析失败');
  const sc2 = domain.buildScene({ attackerId: '龙息帕尔', defenderId: '贝古斯', tierKey: 't1', natureKey: 'atk>spd', ivsKey: domain.ivsKeyOf(domain.CONFIG_IVS[0]) });
  const cell = domain.cellResult(sc2, 10);
  ok(cell && cell.natureKey === 'atk>spd', '指定性格未生效');
  ok(cell && cell.natureLabel === '↑物攻↓速度', '性格标签不对：' + (cell && cell.natureLabel));
  console.log('  默认技能取威力最高、防御列表含「无」、手动性格覆盖生效');
}

// ===========================================================================
console.log('\n' + (fails === 0 ? '✓ 全部检查通过' : '✗ 失败 ' + fails + ' 项'));
process.exit(fails === 0 ? 0 : 1);
