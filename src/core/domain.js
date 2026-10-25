/**
 * src/core/domain.js
 * ---------------------------------------------------------------------------
 * 业务层：组合枚举 + 斩杀线求解 + 最优组合挑选。
 *
 * 职责边界
 *   - calc-core.js：逐字移植的上游伤害公式（唯一真相，不许在此重算公式）
 *   - 本文件      ：把「性格 × 加点」的 20 组默认配置（另保留 600 组全量枚举供手动配置与回归校验）、三档靶子、二分求最小星陨层数
 *                   这些东西组织好，并提供带缓存的高性能批量求解
 *   - app.js      ：只负责把结果画出来
 *
 * 性能：主路径 2 攻方 × 3 档 × 1 套当前配置 = 6 次求解；明细参考 20 组按需计算，每次约 1 + log2(层上限) 次伤害计算。
 *      全部走 TypedArray + 字符串 key 缓存，实测见 tools/verify-core.mjs 的输出。
 *
 * 环境：浏览器（<script>，依赖 window.RocoCore）与 Node（require）双通道。
 */
(function (root) {
  'use strict';

  const CORE = (typeof require === 'function' && typeof module !== 'undefined' && module.exports !== undefined)
    ? require('./calc-core.js')
    : root.RocoCore;

  if (!CORE) throw new Error('domain.js: 找不到 RocoCore（请先加载 calc-core.js）');

  // ---------------------------------------------------------------------------
  // 常量
  // ---------------------------------------------------------------------------
  const STAT_KEYS = ['hp', 'atk', 'matk', 'def', 'mdef', 'spd'];
  const STAT_LABELS = { hp: '生命', atk: '物攻', matk: '魔攻', def: '物防', mdef: '魔防', spd: '速度' };
  /** 矩阵视图列头用的单字缩写（宽度只有 1 个字） */
  const STAT_SHORT = { hp: '命', atk: '攻', matk: '魔', def: '防', mdef: '御', spd: '速' };

  const DEFAULT_MAX_LAYER = 50;
  const HARD_MAX_LAYER = 99; // 与上游 findMinKillLayer 的搜索上界一致

  /** 「不可斩」在 TypedArray 里的哨兵值 */
  const NO_KILL = -1;

  // ---------------------------------------------------------------------------
  // 组合空间：30 种性格 × 20 种加点 = 600
  // ---------------------------------------------------------------------------
  const NATURES = [];
  for (const up of STAT_KEYS) {
    for (const down of STAT_KEYS) {
      if (up === down) continue;
      NATURES.push({
        key: up + '>' + down,
        up,
        down,
        nature: { up, down },
        label: '↑' + STAT_LABELS[up] + '↓' + STAT_LABELS[down],
      });
    }
  }

  const IVS_LIST = [];
  for (let a = 0; a < STAT_KEYS.length; a++) {
    for (let b = a + 1; b < STAT_KEYS.length; b++) {
      for (let c = b + 1; c < STAT_KEYS.length; c++) {
        const ivs = [STAT_KEYS[a], STAT_KEYS[b], STAT_KEYS[c]];
        IVS_LIST.push({ key: ivs.join('+'), ivs, label: ivs.map(k => STAT_LABELS[k]).join('/') });
      }
    }
  }

  /** 600 个组合，index 即组合序号（矩阵按 index 定位） */
  const COMBOS = [];
  for (let ni = 0; ni < NATURES.length; ni++) {
    for (let ii = 0; ii < IVS_LIST.length; ii++) {
      const n = NATURES[ni];
      const v = IVS_LIST[ii];
      COMBOS.push({
        index: COMBOS.length,
        natureIndex: ni,
        ivsIndex: ii,
        natureKey: n.key,
        ivsKey: v.key,
        nature: n.nature,     // 直接给 calc-core 用的对象
        ivs: v.ivs,           // 直接给 calc-core 用的数组
        label: n.label + ' · ' + v.label,
      });
    }
  }

  // ---------------------------------------------------------------------------
  // 攻方配置：5 性格 × 4 加点 = 20 组（默认口径）
  // ---------------------------------------------------------------------------
  // 用户口径：『是否加物攻/魔攻』×『加点是否含攻击』，另加一档 Z5「不加攻」。
  // 常量放这里，以后要改档位只动这张表。
  // label = 界面显示用的短标签；full = 完整定义（title/tooltip 用）
  // Z1/Z2 的「魔攻↓/物攻↓」是"牺牲另一项攻击"的实质区别，保留；
  // Z3/Z4 的「生命↓」与斩杀线无关（只影响生存），按用户要求从显示里去掉。
  const CONFIG_NATURES = [
    { key: 'Z1', label: '物攻↑魔攻↓', full: '物攻↑ 魔攻↓', short: '物攻↑魔攻↓', nature: { up: 'atk', down: 'matk' } },
    { key: 'Z2', label: '魔攻↑物攻↓', full: '魔攻↑ 物攻↓', short: '魔攻↑物攻↓', nature: { up: 'matk', down: 'atk' } },
    { key: 'Z3', label: '物攻↑', full: '物攻↑ 生命↓', short: '物攻↑', nature: { up: 'atk', down: 'hp' } },
    { key: 'Z4', label: '魔攻↑', full: '魔攻↑ 生命↓', short: '魔攻↑', nature: { up: 'matk', down: 'hp' } },
    // Z5「不加攻」：既不加物攻也不加魔攻（用 hp↑ / spd↓ 这对，明确不碰 atk/matk）
    { key: 'Z5', label: '不加攻', full: '生命↑ 速度↓', short: '不加攻', nature: { up: 'hp', down: 'spd' } },
  ]

  /** 性格短标签：命中 4 档用其 label，否则「↓生命」也省略（生命下降只影响生存，与斩杀线无关） */
  function shortNatureLabel(natureKey) {
    const hit = CONFIG_NATURES.filter(n => (n.nature.up + '>' + n.nature.down) === natureKey)[0];
    if (hit) return hit.label;
    const nat = NATURES.filter(n => n.key === natureKey)[0];
    if (!nat) return String(natureKey || '');
    if (nat.down === 'hp') return '↑' + STAT_LABELS[nat.up];
    return nat.label;
  }

  /** 性格完整标签（tooltip 用） */
  function fullNatureLabel(natureKey) {
    const hit = CONFIG_NATURES.filter(n => (n.nature.up + '>' + n.nature.down) === natureKey)[0];
    if (hit) return hit.full;
    const nat = NATURES.filter(n => n.key === natureKey)[0];
    if (!nat) return String(natureKey || '');
    if (nat.down === 'hp') return '↑' + STAT_LABELS[nat.up] + ' 生命↓';
    return nat.label;
  }
  const CONFIG_IVS = [
    { key: 'J1', label: '物攻向', short: '物攻向', ivs: ['atk', 'hp', 'spd'] },
    { key: 'J2', label: '魔攻向', short: '魔攻向', ivs: ['matk', 'hp', 'spd'] },
    { key: 'J3', label: '双攻', short: '双攻', ivs: ['atk', 'matk', 'hp'] },
    { key: 'J4', label: '无攻', short: '无攻', ivs: ['hp', 'def', 'mdef'] },
  ];

  /** 20 组：index = zi * 4 + ji */
  const CONFIGS = [];
  for (let zi = 0; zi < CONFIG_NATURES.length; zi++) {
    for (let ji = 0; ji < CONFIG_IVS.length; ji++) {
      const n = CONFIG_NATURES[zi];
      const v = CONFIG_IVS[ji];
      // 加点按 STAT_KEYS 规范顺序排列，保证 ivsKey 与全量 IVS_LIST 的键一致
      const ivs = v.ivs.slice().sort((a, b) => STAT_KEYS.indexOf(a) - STAT_KEYS.indexOf(b));
      CONFIGS.push({
        index: CONFIGS.length,
        zi,
        ji,
        key: n.key + '·' + v.key,
        natureKey: n.nature.up + '>' + n.nature.down,
        ivsKey: ivs.join('+'),
        nature: n.nature,
        ivs,
        label: n.label + ' · ' + v.label,
      });
    }
  }

  /** 供 UI 直接取用的 20 组（含 6 位性格/加点名称） */
  function getConfigs16() { return CONFIGS; }

  // ---------------------------------------------------------------------------
  // 靶子三档（固定，不由用户编辑）
  // ---------------------------------------------------------------------------
  const DEFENDER_TIERS = [
    {
      key: 't1',
      label: '档①',
      name: '纯肉',
      short: '纯肉',
      desc: '性格 生命↑物攻↓ · 加点 生命/物防/魔防',
      nature: { up: 'hp', down: 'atk' },
      ivs: ['hp', 'def', 'mdef'],
    },
    {
      key: 't2',
      label: '档②',
      name: '防血能力值',
      short: '防血能力值',
      desc: '性格 速度↑物攻↓（防御三维无加成）· 加点 生命/物防/魔防',
      nature: { up: 'spd', down: 'atk' },
      ivs: ['hp', 'def', 'mdef'],
    },
    {
      key: 't3',
      label: '档③',
      name: '仅血量能力值',
      short: '仅血量能力值',
      desc: '性格 速度↑物攻↓ · 加点 仅生命',
      nature: { up: 'spd', down: 'atk' },
      ivs: ['hp'],
    },
  ];

  // ---------------------------------------------------------------------------
  // calc-core 需要的固定上下文片段（浮窗不开放属性 buff / 威力 / 连击修正）
  // ---------------------------------------------------------------------------
  const ATK_BUFF = Object.freeze({ atk: 0, matk: 0 });
  const DEF_BUFF = Object.freeze({ def: 0, mdef: 0 });

  /** 防御技能的「无」占位 */
  const NO_DEFENSE_SKILL = Object.freeze({ id: '__none__', name: '无', reduction: 1, _pseudo: true });

  // ---------------------------------------------------------------------------
  // 数据查询
  // ---------------------------------------------------------------------------
  let SPRITES = {};
  let SKILLS = {};
  let TYPES = {};
  let OTHERS = {};

  /** 绑定图鉴数据（内置包或运行时在线数据） */
  function bindData(data) {
    SPRITES = (data && data.sprites) || {};
    SKILLS = (data && data.skills) || {};
    TYPES = (data && data.types) || {};
    OTHERS = (data && data.others) || {};
    CORE.bindData({ sprites: SPRITES, skills: SKILLS, types: TYPES, others: OTHERS });
    leanCache.clear();
    clearCache();
  }

  const getSprite = id => SPRITES[id] || null;

  /**
   * 伤害计算用的「精简精灵」：
   * calc-core 计算伤害时只会用到精灵的 6 项种族值、types，以及 skills 里**第一条特性**
   * （computeSkillDynamicModifiers 的 foreach 命中第一条 特性 就 break）。
   * 把 skills 裁到只剩那条特性，可以让每次伤害计算少扫几十个技能表、少几十次哈希查找，
   * 数值完全不受影响（校验脚本里有「精简 vs 原始」的逐值对拍）。
   */
  const leanCache = new Map();
  function leanSprite(sprite) {
    if (!sprite) return null;
    const key = sprite.id || sprite.name;
    const hit = leanCache.get(key);
    if (hit) return hit;
    let abilityId = null;
    for (const sid of sprite.skills || []) {
      const sk = SKILLS[sid];
      if (sk && sk.category === '特性') { abilityId = sid; break; }
    }
    const lean = {
      id: sprite.id,
      name: sprite.name,
      types: sprite.types,
      hp: sprite.hp, atk: sprite.atk, matk: sprite.matk,
      def: sprite.def, mdef: sprite.mdef, spd: sprite.spd,
      illustration_url: sprite.illustration_url,
      skills: abilityId ? [abilityId] : [],
    };
    leanCache.set(key, lean);
    return lean;
  }
  const getSkill = id => SKILLS[id] || null;
  const allSprites = () => Object.values(SPRITES);

  /** 攻击技能列表：该精灵 skills 里 category==='攻击'，按威力降序（威力空按 0） */
  function getAttackerSkills(sprite) {
    if (!sprite) return [];
    const out = [];
    for (const sid of sprite.skills || []) {
      const sk = SKILLS[sid];
      if (sk && sk.category === '攻击') out.push(sk);
    }
    out.sort((a, b) => (b.power || 0) - (a.power || 0) || String(a.name).localeCompare(String(b.name)));
    return out;
  }

  /** 防御技能列表：前缀「无」+ 该精灵 skills 里 category==='防御' */
  function getDefenderSkills(sprite) {
    const out = [NO_DEFENSE_SKILL];
    if (!sprite) return out;
    for (const sid of sprite.skills || []) {
      const sk = SKILLS[sid];
      if (sk && sk.category === '防御') out.push(sk);
    }
    return out;
  }

  /**
   * 主攻类别：物攻 / 魔攻 —— 取种族值更高的一侧。
   * 用途：挑默认技能、给技能下拉打「与主攻不符」标注（不影响任何手动选择）。
   */
  function primaryDamageClass(sprite) {
    if (!sprite) return '物攻';
    return (sprite.atk || 0) >= (sprite.matk || 0) ? '物攻' : '魔攻';
  }

  /** 该技能的伤害类别是否与精灵主攻类别匹配（'自适应' 视为匹配） */
  function isDamageClassMatched(sprite, skill) {
    if (!skill) return false;
    const cls = skill.damage_class || '物攻';
    return cls === '自适应' || cls === primaryDamageClass(sprite);
  }

  /**
   * 默认攻击技能：
   *   ① 先按主攻类别过滤（'自适应' 也算匹配），取威力最高者；
   *   ② 该精灵没有同类技能时，退回「全部攻击技能里威力最高」。
   * 只是默认值，用户手选的结果永远以用户为准。
   */
  function defaultAttackSkillId(sprite) {
    const list = getAttackerSkills(sprite);
    if (!list.length) return null;
    const matched = list.filter(s => isDamageClassMatched(sprite, s));
    return (matched.length ? matched : list)[0].id;
  }

  // ---------------------------------------------------------------------------
  // 场景（一次求解的全部输入）
  // ---------------------------------------------------------------------------
  /**
   * @param {{attackerId:string, attackSkillId?:string|null, defenderId:string,
   *          defenseSkillId?:string|null, tierKey?:string}} cfg
   * @returns {null|object} 缺少精灵/技能时返回 null
   */
  const MOD_MIN = -100;
  const MOD_MAX = 300;
  const clampMod = v => {
    const n = Math.round(Number(v) || 0);
    return Math.min(MOD_MAX, Math.max(MOD_MIN, n));
  };

  /** CONFIG_IVS 项的规范键（与 IVS_LIST 的键一致） */
  function ivsKeyOf(v) {
    return v.ivs.slice().sort((a, b) => STAT_KEYS.indexOf(a) - STAT_KEYS.indexOf(b)).join('+');
  }

  /** 主攻取向给默认档：物攻手 → Z1+J1；魔攻手 → Z2+J2 */
  function defaultConfigFor(sprite) {
    const magic = sprite && (sprite.matk || 0) > (sprite.atk || 0);
    const ni = magic ? 1 : 0;
    const n = CONFIG_NATURES[ni];
    return {
      natureKey: n.nature.up + '>' + n.nature.down,
      ivsKey: ivsKeyOf(CONFIG_IVS[ni]),
    };
  }

  /** 把任意（可能来自旧存档的）性格/加点键解析成合法组合 */
  function resolveConfig(natureKey, ivsKey) {
    const nat = NATURES.filter(n => n.key === natureKey)[0] ||
      NATURES.filter(n => n.key === CONFIG_NATURES[0].nature.up + '>' + CONFIG_NATURES[0].nature.down)[0] || NATURES[0];
    const ivs = IVS_LIST.filter(v => v.key === ivsKey)[0] ||
      IVS_LIST.filter(v => v.key === ivsKeyOf(CONFIG_IVS[0]))[0] || IVS_LIST[0];
    return { nature: nat, ivsDef: ivs, natureKey: nat.key, ivsKey: ivs.key };
  }

  function buildScene(cfg) {
    const attacker = getSprite(cfg.attackerId);
    const defender = getSprite(cfg.defenderId);
    if (!attacker || !defender) return null;

    const atkSkills = getAttackerSkills(attacker);
    let attackSkill = cfg.attackSkillId ? getSkill(cfg.attackSkillId) : null;
    if (!attackSkill) attackSkill = atkSkills.length ? atkSkills[0] : null;
    if (!attackSkill) return null;

    const defSkills = getDefenderSkills(defender);
    let defenseSkill = null;
    if (cfg.defenseSkillId) {
      for (const s of defSkills) if (s.id === cfg.defenseSkillId) { defenseSkill = s; break; }
    }
    if (!defenseSkill) defenseSkill = NO_DEFENSE_SKILL;

    const tier = DEFENDER_TIERS.find(t => t.key === cfg.tierKey) || DEFENDER_TIERS[0];

    const def = defaultConfigFor(attacker);
    const conf = resolveConfig(cfg.natureKey || def.natureKey, cfg.ivsKey || def.ivsKey);
    const scene = {
      // 当前生效的性格 / 加点（6 格按这一套算，不再遍历全部组合挑最优）
      natureKey: conf.natureKey,
      ivsKey: conf.ivsKey,
      nature: conf.nature.nature,
      ivs: conf.ivsDef.ivs,
      natureLabel: conf.nature.label,
      ivsLabel: conf.ivsDef.label,
      // 攻方加成（百分比）：攻击加成直接进 attackerBuff，威力加成换算成 flat powerBoost
      atkPct: clampMod(cfg.atkPct),
      powerPct: clampMod(cfg.powerPct),
      attackerId: attacker.id,
      attacker: leanSprite(attacker),
      attackSkillId: attackSkill.id,
      attackSkill,
      defenderId: defender.id,
      defender: leanSprite(defender),
      defenseSkillId: defenseSkill.id,
      defenseSkill,
      tier,
    };
    scene.key = [scene.attackerId, scene.attackSkillId, scene.defenderId, scene.defenseSkillId, tier.key,
      'a' + scene.atkPct, 'p' + scene.powerPct].join('|');
    // 20 组批量结果与"当前配置"无关，单独用不含 config 的键
    scene.allKey = scene.key;
    scene.key += '|' + scene.natureKey + '|' + scene.ivsKey;
    return scene;
  }

  // ---------------------------------------------------------------------------
  // 事务：求解
  // ---------------------------------------------------------------------------
  /** 加成 → ctx 字段：攻击加成按百分比进 buff；威力加成按「威力×pct/100」换算成内核的 flat powerBoost */
  function modFields(scene) {
    const atkPct = scene.atkPct || 0;
    const powerPct = scene.powerPct || 0;
    const power = (scene.attackSkill && scene.attackSkill.power) || 0;
    return {
      attackerBuff: atkPct
        ? { atk: ATK_BUFF.atk + atkPct, matk: ATK_BUFF.matk + atkPct }
        : ATK_BUFF,
      attackerPowerBoost: power > 0 && powerPct ? Math.round(power * powerPct / 100) : 0,
    };
  }

  function makeCtx(scene, combo, starLayer) {
    return {
      attacker: scene.attacker,
      attackSkill: scene.attackSkill,
      defender: scene.defender,
      defenseSkill: scene.defenseSkill,
      starLayer,
      attackerNature: combo.nature,
      defenderNature: scene.tier.nature,
      attackerIVs: combo.ivs,
      defenderIVs: scene.tier.ivs,
      attackerBuff: modFields(scene).attackerBuff,
      defenderBuff: DEF_BUFF,
      attackerPowerBoost: modFields(scene).attackerPowerBoost,
      attackerCombo: 0,
    };
  }

  /**
   * 复用同一个 ctx 对象做批量求解（避开每组合一次对象分配）。
   * calc-core 的 computeFinalDamage 是纯函数、只读 ctx，因此复用安全。
   */
  function createScratch(scene) {
    const mods = modFields(scene);
    return {
      attacker: scene.attacker,
      attackSkill: scene.attackSkill,
      defender: scene.defender,
      defenseSkill: scene.defenseSkill,
      starLayer: 0,
      attackerNature: null,
      defenderNature: scene.tier.nature,
      attackerIVs: null,
      defenderIVs: scene.tier.ivs,
      attackerBuff: mods.attackerBuff,
      defenderBuff: DEF_BUFF,
      attackerPowerBoost: mods.attackerPowerBoost,
      attackerCombo: 0,
    };
  }

  /**
   * 单个组合在当前档位下「最少需要几层星陨才能一击秒杀」。
   *
   * 与上游 findMinKillLayer 语义一致：伤害关于 n 单调非递减，故二分。
   * 为了速度采用「三探针」策略（结果与纯二分完全等价，但把常见路径从 5 次
   * 伤害计算压到 1~2 次）：
   *   探针① n=0        —— 本来就要求（UI 要展示 n=0 伤害占比）
   *   探针② n=上限     —— 打不死则可直接判定「不可斩」，覆盖大多数硬靶子
   *   探针③ 仅在 ①打不死 且 ②打得死 时，对 [1, 上限-1] 二分
   * 上层内打不死 → layer = null（不可斩）。
   *
   * @returns {{layer:number|null, dmg:number, pct0:number, defHP:number}}
   */
  function solveWithScratch(scene, scratch, combo, maxLayer) {
    const limit = Math.min(HARD_MAX_LAYER, Math.max(0, maxLayer | 0));
    scratch.attackerNature = combo.nature;
    scratch.attackerIVs = combo.ivs;

    scratch.starLayer = 0;
    const r0 = CORE.computeFinalDamage(scratch);
    const defHP = r0.defHP || 0;
    const dmg0 = r0.finalDamage;
    const pct0 = defHP > 0 ? (dmg0 / defHP) * 100 : 0;

    if (dmg0 >= defHP) return { layer: 0, dmg: dmg0, dmg0, pct0, defHP };
    if (limit < 1) return { layer: null, dmg: dmg0, dmg0, pct0, defHP };

    scratch.starLayer = limit;
    const rl = CORE.computeFinalDamage(scratch);
    if (rl.finalDamage < defHP) return { layer: null, dmg: rl.finalDamage, dmg0, pct0, defHP };
    if (limit === 1) return { layer: 1, dmg: rl.finalDamage, dmg0, pct0, defHP };

    const dmgAt = n => {
      scratch.starLayer = n;
      return CORE.computeFinalDamage(scratch).finalDamage;
    };
    /** 在 [lo, hi] 里二分出「最小可行层」；没有可行层返回 -1 */
    const bisect = (lo, hi) => {
      let hit = -1, hitDmg = 0;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        const dmg = dmgAt(mid);
        if (dmg >= defHP) { hit = mid; hitDmg = dmg; hi = mid - 1; }
        else lo = mid + 1;
      }
      return hit < 0 ? null : { layer: hit, dmg: hitDmg };
    };

    // ── 用星陨威力的二次关系猜一个起点，把常见路径从「纯二分 4 次」压到 2 次 ──
    // 星陨威力 sp(n) = n² + 24n - 24（与内核同式），仅用于估计起点，判定始终靠真实伤害。
    const spLimit = limit * limit + 24 * limit - 24;
    const delta = rl.finalDamage - dmg0;             // n=limit 相对 n=0 多出来的星陨伤害
    let guess = -1;
    if (spLimit > 0 && delta > 0) {
      const K = delta / spLimit;                     // 每单位星陨威力的伤害
      const spNeed = (defHP - dmg0) / K;
      guess = Math.ceil((-24 + Math.sqrt(576 + 4 * (spNeed + 24))) / 2);
      if (!Number.isFinite(guess)) guess = -1;
      else guess = Math.max(1, Math.min(limit - 1, guess));
    }

    if (guess > 0) {
      const dGuess = dmgAt(guess);
      if (dGuess >= defHP) {
        // 猜大了或正好：再看前一层
        if (guess === 1) return { layer: 1, dmg: dGuess, dmg0, pct0, defHP };
        const dPrev = dmgAt(guess - 1);
        if (dPrev < defHP) return { layer: guess, dmg: dGuess, dmg0, pct0, defHP };
        const sub = bisect(1, guess - 2);
        if (sub) return { layer: sub.layer, dmg: sub.dmg, dmg0, pct0, defHP };
        return { layer: guess - 1, dmg: dPrev, dmg0, pct0, defHP };
      }
      // 猜小了：在 [guess+1, limit-1] 里继续（limit 已知可行）
      const sub = bisect(guess + 1, limit - 1);
      if (sub) return { layer: sub.layer, dmg: sub.dmg, dmg0, pct0, defHP };
      return { layer: limit, dmg: rl.finalDamage, dmg0, pct0, defHP };
    }

    const full = bisect(1, limit - 1);
    if (full) return { layer: full.layer, dmg: full.dmg, dmg0, pct0, defHP };
    return { layer: limit, dmg: rl.finalDamage, dmg0, pct0, defHP };
  }

  /** 单次求解（自建 scratch，供外部零散调用） */
  function solveCombo(scene, combo, maxLayer) {
    return solveWithScratch(scene, createScratch(scene), combo, maxLayer);
  }

  // ---------------------------------------------------------------------------
  // 批量：20 组配置（带缓存）
  // ---------------------------------------------------------------------------
  const cache = new Map();
  const cellCache = new Map();
  const CACHE_LIMIT = 240; // 两攻方 × 若干技能/靶子组合，足够热

  function clearCache() { cache.clear(); cellCache.clear(); }

  function cacheKey(scene, maxLayer) {
    return (scene.allKey || scene.key) + '|' + maxLayer;
  }

  /** 该场景是否已经在缓存里（供 UI 判断"这次到底是真算还是命中"） */
  function isCached(scene, maxLayer) {
    if (!scene) return false;
    const limit = Math.min(HARD_MAX_LAYER, Math.max(0, maxLayer | 0));
    return cache.has(cacheKey(scene, limit));
  }

  /**
   * 求某个（攻方 × 技能 × 靶子 × 靶子技能 × 靶子档 × 层上限）下全部 20 组的结果。
   * @returns {{layers:Int16Array, dmg:Int32Array, pct0:Float32Array, defHP:number,
   *            maxLayer:number, ms:number, bestIndex:number, killed:number}}
   */
  function evaluateAll(scene, maxLayer) {
    if (!scene) return null;
    const limit = Math.min(HARD_MAX_LAYER, Math.max(0, maxLayer | 0));
    const key = cacheKey(scene, limit);
    const hit = cache.get(key);
    if (hit) return hit;

    const t0 = now();
    const n = CONFIGS.length; // 20 组（5 性格 × 4 加点）
    const layers = new Int16Array(n);
    const dmgArr = new Int32Array(n);
    const dmg0Arr = new Int32Array(n);
    const pct0 = new Float32Array(n);
    const scratch = createScratch(scene);
    let defHP = 0, killed = 0;

    for (let i = 0; i < n; i++) {
      const r = solveWithScratch(scene, scratch, CONFIGS[i], limit);
      layers[i] = r.layer === null ? NO_KILL : r.layer;
      dmgArr[i] = r.dmg;
      dmg0Arr[i] = r.dmg0;
      pct0[i] = r.pct0;
      if (i === 0) defHP = r.defHP;
      if (r.layer !== null) killed++;
    }

    const result = {
      scene,
      maxLayer: limit,
      defHP,
      layers,
      dmg: dmgArr,
      dmg0: dmg0Arr,
      pct0,
      killed,
      bestIndex: pickBestIndex(layers, dmgArr),
      ms: now() - t0,
    };
    result.configs = CONFIGS;
    result.best = describeCombo(result.bestIndex, layers, dmgArr, pct0, defHP, dmg0Arr);
    cache.set(key, result);
    if (cache.size > CACHE_LIMIT) {
      // 简单 FIFO 淘汰
      const first = cache.keys().next().value;
      cache.delete(first);
    }
    return result;
  }

  /** 最优组合：层数最小；同层取伤害更高者 */
  function pickBestIndex(layers, dmgArr) {
    let best = 0, bestLayer = Infinity, bestDmg = -1;
    for (let i = 0; i < layers.length; i++) {
      const L = layers[i] === NO_KILL ? Infinity : layers[i];
      const d = dmgArr[i];
      if (L < bestLayer || (L === bestLayer && d > bestDmg)) { best = i; bestLayer = L; bestDmg = d; }
    }
    return best;
  }

  /** 把某个组合序号变成 UI 需要的一句话结构 */
  function describeCombo(index, layers, dmgArr, pct0, defHP, dmg0Arr) {
    const combo = CONFIGS[index] || COMBOS[index];
    const layer = layers[index] === NO_KILL ? null : layers[index];
    return {
      index,
      combo,
      layer,
      dmg: dmgArr ? dmgArr[index] : 0,
      dmg0: dmg0Arr ? dmg0Arr[index] : 0,
      pct0: pct0 ? pct0[index] : 0,
      defHP: defHP || 0,
      natureLabel: shortNatureLabel(combo.natureKey),
      natureFull: fullNatureLabel(combo.natureKey),
      ivsLabel: (IVS_LIST.filter(v => v.key === combo.ivsKey)[0] ||
        { label: (combo.ivs || []).map(k => STAT_LABELS[k]).join('/') }).label,
    };
  }

  /** 手动指定性格/加点：返回组合序号；无效返回 -1 */
  function comboIndexOf(natureKey, ivsKey) {
    const ni = NATURES.findIndex(n => n.key === natureKey);
    const ii = IVS_LIST.findIndex(v => v.key === ivsKey);
    if (ni < 0 || ii < 0) return -1;
    return ni * IVS_LIST.length + ii;
  }

  /** 由（性格序号, 加点序号）得到组合序号（越界自动夹紧） */
  function comboAt(natureIndex, ivsIndex) {
    const ni = Math.max(0, Math.min(NATURES.length - 1, natureIndex | 0));
    const ii = Math.max(0, Math.min(IVS_LIST.length - 1, ivsIndex | 0));
    return ni * IVS_LIST.length + ii;
  }

  // ---------------------------------------------------------------------------
  // 便捷包装
  // ---------------------------------------------------------------------------
  /**
   * 单格结果：**只按当前配置算一次**（不再遍历全部组合挑最优）。
   * 20 组批量结果只在明细面板里当"参考"，由 referenceAll 按需计算。
   */
  function cellResult(scene, maxLayer) {
    if (!scene) return null;
    const limit = Math.min(HARD_MAX_LAYER, Math.max(0, maxLayer | 0));
    const key = 'cell:' + scene.key + '|' + limit;
    const hit = cellCache.get(key);
    if (hit) return hit;

    const combo = { nature: scene.nature, ivs: scene.ivs, natureKey: scene.natureKey, ivsKey: scene.ivsKey };
    const r = solveCombo(scene, combo, limit);
    const cfgIdx = CONFIGS.findIndex(c => c.natureKey === scene.natureKey && c.ivsKey === scene.ivsKey);

    const out = {
      scene,
      index: cfgIdx,
      layer: r.layer,
      dmg: r.dmg,
      dmg0: r.dmg0,
      pct0: r.pct0,
      defHP: r.defHP,
      natureLabel: scene.natureLabel,
      natureFull: fullNatureLabel(scene.natureKey),
      ivsLabel: scene.ivsLabel,
      natureKey: scene.natureKey,
      ivsKey: scene.ivsKey,
      combo,
      manualApplied: true,
      manualConfigIndex: cfgIdx,
      manualRow: null,
    };
    if (cellCache.size > 400) cellCache.clear();
    cellCache.set(key, out);
    return out;
  }

  /** 明细面板用：20 组参考结果（点格子才算） */
  function referenceAll(scene, maxLayer) {
    return evaluateAll(scene, maxLayer);
  }

  /** 单格结果是否已缓存（UI 用它判断"这次是真算还是命中"） */
  function isCellCached(scene, maxLayer) {
    if (!scene) return false;
    const limit = Math.min(HARD_MAX_LAYER, Math.max(0, maxLayer | 0));
    return cellCache.has('cell:' + scene.key + '|' + limit);
  }

  /** 组内排序：层数升序（不可斩最后），同层伤害降序 */
  function groupByLayer(all) {
    const groups = new Map();
    for (let i = 0; i < all.layers.length; i++) {
      const L = all.layers[i] === NO_KILL ? -1 : all.layers[i];
      if (!groups.has(L)) groups.set(L, []);
      groups.get(L).push(i);
    }
    const keys = [...groups.keys()].sort((a, b) => (a === -1 ? 1 : b === -1 ? -1 : a - b));
    return keys.map(k => ({
      layer: k === -1 ? null : k,
      items: groups.get(k).sort((a, b) => all.dmg[b] - all.dmg[a]),
      count: groups.get(k).length,
    }));
  }

  const now = typeof performance !== 'undefined' && performance.now
    ? () => performance.now()
    : () => Date.now();

  // 格式化小工具（UI 与日志共用）
  function formatLayer(layer) { return layer === null ? '不可斩' : layer + ' 层'; }
  function formatPct(v) { return (v >= 100 ? v.toFixed(0) : v.toFixed(1)) + '%'; }

  const api = {
    // 常量
    STAT_KEYS, STAT_LABELS, STAT_SHORT, DEFAULT_MAX_LAYER, HARD_MAX_LAYER, NO_KILL,
    NATURES, IVS_LIST, COMBOS, DEFENDER_TIERS, NO_DEFENSE_SKILL,
    CONFIG_NATURES, CONFIG_IVS, CONFIGS, getConfigs16, shortNatureLabel, fullNatureLabel,
    MOD_MIN, MOD_MAX, clampMod, defaultConfigFor, resolveConfig, referenceAll, isCellCached, ivsKeyOf,
    // 数据
    bindData, getSprite, getSkill, allSprites,
    getAttackerSkills, getDefenderSkills, defaultAttackSkillId, primaryDamageClass, isDamageClassMatched, leanSprite,
    // 场景与求解
    buildScene, solveCombo, evaluateAll, cellResult, groupByLayer, isCached,
    pickBestIndex, describeCombo, comboIndexOf, comboAt,
    clearCache,
    // 展示
    formatLayer, formatPct,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.RocoDomain = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
