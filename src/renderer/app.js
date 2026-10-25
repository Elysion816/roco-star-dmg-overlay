/**
 * src/renderer/app.js
 * ---------------------------------------------------------------------------
 * 浮窗 UI 逻辑（原生 JS，无框架）。
 *
 * 结构：
 *   1. 状态（ui：会被持久化；view：纯界面态）
 *   2. 精灵选择器（三槽共用：属性筛选 → 点选；也支持名字/拼音/首字母/图鉴号）
 *   3. 卡片渲染（技能下拉、配置下拉）
 *   4. 6 格结果（2 攻方 × 3 档）+ 小条摘要
 *   5. 20 组明细面板（分组清单 / 矩阵 + 三个过滤器）
 *   6. 主进程事件（穿透/小条/在线数据）
 */
(function () {
  'use strict';

  const D = window.RocoDomain;
  const CORE = window.RocoCore;
  const api = window.api || null;

  const $ = sel => document.querySelector(sel);
  const $$ = sel => Array.prototype.slice.call(document.querySelectorAll(sel));
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // -------------------------------------------------------------------------
  // 1. 数据与状态
  // -------------------------------------------------------------------------
  let DATA = window.__ROCO_DATA__ || { sprites: {}, skills: {}, types: {}, others: {} };
  D.bindData(DATA);

  const ui = {
    slots: { atk1: null, atk2: null, def: null },
    skills: { atk1: null, atk2: null, def: null },
    // 当前生效配置（默认按精灵主攻属性给，不再有"自动最优"）
    configs: {
      atk1: { natureKey: null, ivsKey: null },
      atk2: { natureKey: null, ivsKey: null },
    },
    /** 用户是否手动改过配置（没改过的话换精灵会重新给默认档） */
    configTouched: { atk1: false, atk2: false },
    // 攻方加成（百分比）：攻击加成 → attackerBuff；威力加成 → 内核 flat powerBoost
    mods: {
      atk1: { atkPct: 0, powerPct: 0 },
      atk2: { atkPct: 0, powerPct: 0 },
    },
    maxLayer: 50,
    maxLayerTouched: false,
    tipDismissed: false,
  };

  const view = {
    collapsed: false,
    passthrough: true,
    detail: null,          // { row: 'atk1'|'atk2', tierKey }
    detailView: 'groups',  // groups | matrix
    filters: { atkNature: false, killable: false, atkIvs: false },
    collapsedGroups: Object.create(null),
    highlight: -1,
    grid: null,
  };

  const ROWS = ['atk1', 'atk2'];
  const SLOT_NAME = { atk1: '攻①', atk2: '攻②', def: '靶子' };

  let saveTimer = null;
  function saveUI() {
    if (!api) return;
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      api.saveUI({
        slots: ui.slots,
        skills: ui.skills,
        configs: ui.configs,
        configTouched: ui.configTouched,
        mods: ui.mods,
        maxLayer: ui.maxLayer,
        maxLayerTouched: ui.maxLayerTouched,
        tipDismissed: ui.tipDismissed,
      });
    }, 250);
  }

  // -------------------------------------------------------------------------
  // 2. 基础查询
  // -------------------------------------------------------------------------
  const spriteOf = slot => D.getSprite(ui.slots[slot]);
  const typeEmoji = t => {
    const el = CORE.ELEMENTS[CORE.stripXi(t)];
    return el ? el.emoji : '❔';
  };
  const typeName = t => CORE.stripXi(t) || '无';

  /**
   * 头像：有 illustration_url 用 <img>，加载失败则降级成属性 emoji（见 wireAvatars）。
   * 注意：CSP 禁止内联事件处理器，错误处理统一走 JS 绑定。
   */
  function avatarHTML(sprite, size) {
    const emoji = sprite && sprite.types && sprite.types[0] ? typeEmoji(sprite.types[0]) : '❔';
    if (sprite && sprite.illustration_url) {
      const cls = size === 'big' ? 'avatar' : '';
      return '<img class="' + cls + '" src="' + esc(sprite.illustration_url) + '" alt="" data-emoji="' + esc(emoji) + '" />';
    }
    return '<span class="avatar-fallback">' + emoji + '</span>';
  }

  /** 给新渲染出来的头像补上加载失败降级（幂等） */
  function wireAvatars(root) {
    const scope = root || document;
    const imgs = scope.querySelectorAll('img[data-emoji]');
    for (const img of imgs) {
      if (img.dataset.wired) continue;
      img.dataset.wired = '1';
      img.addEventListener('error', () => {
        const span = document.createElement('span');
        span.className = 'avatar-fallback';
        span.textContent = img.dataset.emoji || '❔';
        img.replaceWith(span);
      });
    }
  }
  function typePills(sprite) {
    if (!sprite || !sprite.types) return '';
    return sprite.types.map(t => '<span class="type-pill" title="' + esc(typeName(t)) + '">' +
      typeEmoji(t) + ' ' + esc(typeName(t)) + '</span>').join('');
  }

  // -------------------------------------------------------------------------
  // 3. 选择器（三槽共用）
  // -------------------------------------------------------------------------
  const picker = {
    slot: null,
    query: '',
    type: '全部',
    items: [],
    cursor: 0,
    el: null,
    // 关闭选择器后要执行的回调（小条里的"临时展开"靠它收回去）
    afterClose: null,
  };

  function allSprites() {
    return Object.keys(DATA.sprites || {}).map(id => DATA.sprites[id]).filter(Boolean);
  }

  function matchSprite(sprite, q) {
    if (!q) return 1;
    const name = String(sprite.name || '');
    const py = String(sprite.pinyin || '').toLowerCase();
    const ini = String(sprite.pinyin_initials || '').toLowerCase();
    const hb = String(sprite.hbid == null ? '' : sprite.hbid);
    if (name === q) return 100;
    if (hb && hb === q) return 95;
    if (ini === q) return 90;
    if (py === q) return 85;
    if (name.indexOf(q) === 0) return 80;
    if (ini.indexOf(q) === 0) return 70;
    if (py.indexOf(q) === 0) return 65;
    if (hb.indexOf(q) === 0) return 60;
    if (name.indexOf(q) >= 0) return 50;
    if (ini.indexOf(q) >= 0) return 40;
    if (py.indexOf(q) >= 0) return 30;
    if (hb.indexOf(q) >= 0) return 20;
    return 0;
  }

  function filterSprites() {
    const q = picker.query.trim().toLowerCase();
    const type = picker.type;
    const out = [];
    for (const sprite of allSprites()) {
      if (type !== '全部') {
        const ts = (sprite.types || []).map(typeName);
        if (ts.indexOf(type) < 0) continue;
      }
      const score = matchSprite(sprite, q);
      if (score <= 0) continue;
      out.push({ sprite, score });
    }
    if (q) {
      out.sort((a, b) => b.score - a.score || (a.sprite.hbid || 0) - (b.sprite.hbid || 0));
    } else {
      out.sort((a, b) => (a.sprite.hbid || 0) - (b.sprite.hbid || 0));
    }
    return out.map(x => x.sprite);
  }

  function renderPickerTypes() {
    const types = Object.keys(DATA.types || {});
    const chips = ['全部'].concat(types);
    $('#pickerTypes').innerHTML = chips.map(t => {
      const on = picker.type === t ? ' is-on' : '';
      const label = t === '全部' ? '全部' : typeEmoji(t + '系') + ' ' + t;
      return '<button class="type-chip' + on + '" data-type="' + esc(t) + '">' + esc(label) + '</button>';
    }).join('');
  }

  function renderPickerList() {
    const list = $('#pickerList');
    picker.items = filterSprites();
    const show = picker.items.slice(0, 200);
    if (!show.length) {
      list.innerHTML = '<div class="picker-empty">无匹配精灵</div>';
      $('#pickerCount').textContent = '0 只';
      return;
    }
    if (picker.cursor >= show.length) picker.cursor = 0;
    const currentId = ui.slots[picker.slot];
    list.innerHTML = show.map((s, i) => {
      const cls = 'plist-item' + (i === picker.cursor ? ' is-cursor' : '') + (s.id === currentId ? ' is-current' : '');
      return '<button class="' + cls + '" data-id="' + esc(s.id) + '">' +
        avatarHTML(s) +
        '<span class="plist-name"><b>' + esc(s.name) + '</b><span>#' + esc(s.hbid == null ? '-' : s.hbid) +
        (s.pinyin_initials ? ' · ' + esc(s.pinyin_initials) : '') + '</span></span>' +
        '<span class="plist-types">' + typePills(s) + '</span>' +
        '<span class="plist-stats">HP' + s.hp + ' 攻' + s.atk + ' 魔' + s.matk + '</span>' +
        '</button>';
    }).join('');
    $('#pickerCount').textContent = picker.items.length + ' 只' +
      (picker.items.length > show.length ? '（显示前 ' + show.length + '）' : '');
    wireAvatars(list);
    const cursorEl = list.querySelector('.is-cursor');
    if (cursorEl && cursorEl.scrollIntoView) cursorEl.scrollIntoView({ block: 'nearest' });
  }

  /**
   * 打开精灵选择器。
   * @param {'atk1'|'atk2'|'def'} slot
   * @param {{afterClose?: Function}} [opts] 关闭（选中 / ✕ / Esc / 点空白）后执行一次
   */
  function openPicker(slot, opts) {
    picker.slot = slot;
    picker.afterClose = (opts && typeof opts.afterClose === 'function') ? opts.afterClose : null;
    picker.query = '';
    picker.type = '全部';
    picker.cursor = 0;
    $('#pickerTitle').textContent = '为 ' + SLOT_NAME[slot] + ' 选择精灵';
    const input = $('#pickerSearch');
    input.value = '';
    renderPickerTypes();
    renderPickerList();
    $('#picker').classList.remove('is-hidden');
    $('#picker').setAttribute('aria-hidden', 'false');
    input.focus();
  }

  /**
   * 关闭选择器。三条关闭路径（选中 / ✕ / Esc / 点空白底）都会走这里，
   * 因此 afterClose 一定执行，窗口不会卡在临时展开态。
   */
  function closePicker() {
    const el = $('#picker');
    const wasOpen = el && !el.classList.contains('is-hidden');
    if (el) {
      el.classList.add('is-hidden');
      el.setAttribute('aria-hidden', 'true');
    }
    picker.slot = null;
    const cb = picker.afterClose;
    picker.afterClose = null;
    if (wasOpen && cb) {
      try { cb(); } catch (e) { console.error('[app] afterClose 失败', e); }
    }
  }

  function pickSprite(id) {
    const slot = picker.slot;
    if (!slot) return;
    const sprite = D.getSprite(id);
    if (!sprite) return;
    ui.slots[slot] = id;
    if (slot === 'def') {
      ui.skills.def = '__none__';
    } else {
      ui.skills[slot] = D.defaultAttackSkillId(sprite);
      // 用户没手动改过配置 → 按新精灵主攻属性重新给默认档
      if (!ui.configTouched[slot]) {
        const def = D.defaultConfigFor(sprite);
        ui.configs[slot] = { natureKey: def.natureKey, ivsKey: def.ivsKey };
      }
    }
    closePicker();
    renderCards();
    recompute();
    saveUI();
  }

  // -------------------------------------------------------------------------
  // 4. 卡片渲染
  // -------------------------------------------------------------------------
  /** 首次启动的默认三槽（与主进程 defaultUI 保持一致） */
  const DEFAULT_SLOTS = { atk1: '暮星辰', atk2: '祭礼巨像', def: '尖嘴狐仙' };

  function ensureValidState() {
    const attackers = (DATA.others && DATA.others.common_attackers) || [];
    const defenders = (DATA.others && DATA.others.common_defenders) || [];
    const spriteIds = Object.keys(DATA.sprites || {});
    const fallbackAtk = (id, alt) => spriteIds.indexOf(id) >= 0 ? id : spriteIds.indexOf(alt) >= 0 ? alt : spriteIds[0];

    if (!D.getSprite(ui.slots.atk1)) ui.slots.atk1 = fallbackAtk(DEFAULT_SLOTS.atk1, attackers[0]);
    if (!D.getSprite(ui.slots.atk2)) ui.slots.atk2 = fallbackAtk(DEFAULT_SLOTS.atk2, attackers[1]);
    if (!D.getSprite(ui.slots.def)) ui.slots.def = fallbackAtk(DEFAULT_SLOTS.def, defenders[0]);

    for (const row of ROWS) {
      const sprite = D.getSprite(ui.slots[row]);
      const list = D.getAttackerSkills(sprite);
      const ids = list.map(s => s.id);
      if (!ui.skills[row] || ids.indexOf(ui.skills[row]) < 0) ui.skills[row] = ids[0] || null;
      if (!ui.mods) ui.mods = {};
      if (!ui.mods[row]) ui.mods[row] = { atkPct: 0, powerPct: 0 };
      ui.mods[row].atkPct = D.clampMod(ui.mods[row].atkPct);
      ui.mods[row].powerPct = D.clampMod(ui.mods[row].powerPct);

      if (!ui.configs[row]) ui.configs[row] = { natureKey: null, ivsKey: null };
      if (!ui.configTouched) ui.configTouched = { atk1: false, atk2: false };
      const cfg = ui.configs[row];
      // 旧存档里的 'auto' / 全量键 / 空值 → 一律按精灵主攻属性换算成具体档位
      const natKeys = D.CONFIG_NATURES.map(n => n.nature.up + '>' + n.nature.down);
      const ivsKeys = D.CONFIG_IVS.map(v => v.ivs.slice().sort((x, y) => D.STAT_KEYS.indexOf(x) - D.STAT_KEYS.indexOf(y)).join('+'));
      const badNat = !cfg.natureKey || cfg.natureKey === 'auto' || natKeys.indexOf(cfg.natureKey) < 0;
      const badIvs = !cfg.ivsKey || cfg.ivsKey === 'auto' || ivsKeys.indexOf(cfg.ivsKey) < 0;
      if (badNat || badIvs) {
        const def = D.defaultConfigFor(sprite);
        if (badNat) cfg.natureKey = def.natureKey;
        if (badIvs) cfg.ivsKey = def.ivsKey;
        if (!ui.configTouched[row]) ui.configTouched[row] = false;
      }
    }

    const defSprite = D.getSprite(ui.slots.def);
    const defSkillIds = D.getDefenderSkills(defSprite).map(s => s.id);
    if (!ui.skills.def || defSkillIds.indexOf(ui.skills.def) < 0) ui.skills.def = '__none__';

    if (!(ui.maxLayer >= 0 && ui.maxLayer <= D.HARD_MAX_LAYER)) ui.maxLayer = D.DEFAULT_MAX_LAYER;
  }

  /** 把 ui.mods 同步到控件（数值、边界禁用、非 0 高亮） */
  function syncModControls(row) {
    const mods = (ui.mods && ui.mods[row]) || { atkPct: 0, powerPct: 0 };
    for (const key of ['atkPct', 'powerPct']) {
      const v = D.clampMod(mods[key]);
      mods[key] = v;
      const inp = document.querySelector('.mod-input[data-slot="' + row + '"][data-mod="' + key + '"]');
      if (inp) {
        if (document.activeElement !== inp) inp.value = String(v);
        inp.classList.toggle('is-on', v !== 0);
      }
      const minus = document.querySelector('.mod-btn[data-slot="' + row + '"][data-mod="' + key + '"][data-dir="-1"]');
      const plus = document.querySelector('.mod-btn[data-slot="' + row + '"][data-mod="' + key + '"][data-dir="1"]');
      if (minus) minus.disabled = v <= D.MOD_MIN;
      if (plus) plus.disabled = v >= D.MOD_MAX;
    }
  }

  /** 改加成：夹紧到 [-100, 300] 的整数，重算 + 落盘 */
  function setMod(row, key, value) {
    if (!ui.mods[row]) ui.mods[row] = { atkPct: 0, powerPct: 0 };
    const before = ui.mods[row][key];
    const next = D.clampMod(value);
    if (next === before) { syncModControls(row); return next; }
    ui.mods[row][key] = next;
    syncModControls(row);
    recompute();
    saveUI();
    return next;
  }

  /** 加成摘要文本（0 不显示） */
  function modsText(row) {
    const m = (ui.mods && ui.mods[row]) || { atkPct: 0, powerPct: 0 };
    const out = [];
    if (m.atkPct) out.push('攻击' + (m.atkPct > 0 ? '+' : '') + m.atkPct + '%');
    if (m.powerPct) out.push('威力' + (m.powerPct > 0 ? '+' : '') + m.powerPct + '%');
    return out.join(' ');
  }

  /** 攻方卡片底部小字：当前生效的档位（自动最优时显示实际选中的组合） */
  function renderCfgHint(row) {
    const el = document.querySelector('.cfg-hint[data-slot="' + row + '"]');
    if (!el) return;
    const entry = view.grid ? view.grid.cells.filter(c => c.row === row)[0] : null;
    const cell = entry && entry.cell;
    const natKey = (ui.configs[row] && ui.configs[row].natureKey) || '';
    const ivsKey = (ui.configs[row] && ui.configs[row].ivsKey) || '';
    const natCfg = D.CONFIG_NATURES.filter(n => (n.nature.up + '>' + n.nature.down) === natKey)[0];
    const ivsCfg = D.CONFIG_IVS.filter(v => v.ivs.slice().sort((x, y) => D.STAT_KEYS.indexOf(x) - D.STAT_KEYS.indexOf(y)).join('+') === ivsKey)[0];
    el.innerHTML = '当前：<b>' + esc((natCfg ? natCfg.key + ' ' + natCfg.label : natKey) + ' · ' +
      (ivsCfg ? ivsCfg.key + ' ' + ivsCfg.label : ivsKey)) + '</b>';
    const extra = modsText(row);
    if (extra) el.innerHTML += ' · <b>' + esc(extra) + '</b>';
    el.title = (cell ? ('完整定义：' + (cell.natureFull || cell.natureLabel) + ' · ' + cell.ivsLabel) : el.textContent) +
      (extra ? '　加成：' + extra : '');
  }

  function renderCards() {
    for (const slot of ['atk1', 'atk2', 'def']) {
      const sprite = spriteOf(slot);
      const btn = document.querySelector('.picker-btn[data-slot="' + slot + '"]');
      if (!btn) continue;
      btn.innerHTML = avatarHTML(sprite, 'big') +
        '<span class="name">' + esc(sprite ? sprite.name : '未选择') + '</span>' +
        '<span class="types">' + typePills(sprite) + '</span>' +
        '<span class="caret">▾</span>';
    }

    for (const row of ROWS) {
      const sprite = spriteOf(row);
      const sel = document.querySelector('.skill-select[data-slot="' + row + '"]');
      const skills = D.getAttackerSkills(sprite);
      const primary = D.primaryDamageClass(sprite);
      sel.innerHTML = skills.map(s => {
        const cls = s.damage_class || '物攻';
        const mismatch = !D.isDamageClassMatched(sprite, s);
        return '<option value="' + esc(s.id) + '">' + esc(s.name) + ' · 威力' + (s.power || 0) +
          ' · ' + esc(cls) + (s.combo ? ' · 连击' + s.combo : '') +
          (mismatch ? ' · 与主攻不符' : '') + '</option>';
      }).join('') || '<option value="">（无攻击技能）</option>';
      sel.title = sprite ? (sprite.name + '：主攻 ' + primary + '（物攻 ' + sprite.atk + ' / 魔攻 ' + sprite.matk + '）') : '';
      sel.value = ui.skills[row] || '';

      // 配置下拉：5 性格 + 4 加点（与 20 组同源，选项直接用 CONFIG_NATURES / CONFIG_IVS）
      const natSel = document.querySelector('.cfg-nature[data-slot="' + row + '"]');
      natSel.innerHTML = D.CONFIG_NATURES.map(n =>
        '<option value="' + esc(n.nature.up + '>' + n.nature.down) + '">' + esc(n.key + ' ' + n.label) + '</option>').join('');
      natSel.value = (ui.configs[row] && ui.configs[row].natureKey) || '';

      const ivsSel = document.querySelector('.cfg-ivs[data-slot="' + row + '"]');
      ivsSel.innerHTML = D.CONFIG_IVS.map(v =>
        '<option value="' + esc(v.ivs.slice().sort((x, y) => D.STAT_KEYS.indexOf(x) - D.STAT_KEYS.indexOf(y)).join('+')) + '">' +
        esc(v.key + ' ' + v.label + ' · ' + v.ivs.map(k => D.STAT_LABELS[k]).join('/')) + '</option>').join('');
      ivsSel.value = (ui.configs[row] && ui.configs[row].ivsKey) || '';

      // 加成控件数值 / 边界禁用 / 高亮
      syncModControls(row);

      // 底部小字：当前是哪个档位组合
      renderCfgHint(row);
    }

    const defSprite = spriteOf('def');
    const defSel = document.querySelector('.skill-select[data-slot="def"]');
    defSel.innerHTML = D.getDefenderSkills(defSprite).map(s => {
      const red = s.reduction != null ? ' · 减伤' + Math.round((1 - s.reduction) * 100) + '%' : '';
      return '<option value="' + esc(s.id) + '">' + esc(s.name) + red + '</option>';
    }).join('');
    defSel.value = ui.skills.def || '__none__';

    wireAvatars(document);
  }

  // -------------------------------------------------------------------------
  // 5. 计算与 6 格渲染
  // -------------------------------------------------------------------------
  function tierOf(key) {
    return D.DEFENDER_TIERS.filter(t => t.key === key)[0];
  }

  function computeGrid() {
    const t0 = performance.now();
    const cells = [];
    let cold = 0;
    for (const row of ROWS) {
      for (const tier of D.DEFENDER_TIERS) {
        const mods = ui.mods[row] || { atkPct: 0, powerPct: 0 };
        const cfg = ui.configs[row] || {};
        const scene = D.buildScene({
          attackerId: ui.slots[row],
          attackSkillId: ui.skills[row],
          defenderId: ui.slots.def,
          defenseSkillId: ui.skills.def,
          tierKey: tier.key,
          natureKey: cfg.natureKey,
          ivsKey: cfg.ivsKey,
          atkPct: mods.atkPct,
          powerPct: mods.powerPct,
        });
        let cell = null;
        try {
          if (scene && !D.isCellCached(scene, ui.maxLayer)) cold++;
          cell = scene ? D.cellResult(scene, ui.maxLayer) : null;
        } catch (e) {
          console.error('[app] 计算失败', row, tier.key, e);
        }
        cells.push({ row, tier, scene, cell });
      }
    }
    return { cells, ms: performance.now() - t0, cold };
  }

  /** 超限哨兵的显示文案：{maxLayer}+（不是数字，别当层数用） */
  function overLayerText() { return ui.maxLayer + '+'; }

  function layerClass(cell) {
    if (!cell || !cell.cell) return 'lv-none';
    const L = cell.cell.layer;
    if (L === null) return 'lv-none';
    if (L === 0) return 'lv-0';
    if (L <= 2) return 'lv-low';
    if (L <= 5) return 'lv-mid';
    return 'lv-high';
  }

  function cellHTML(entry) {
    const { row, tier, cell } = entry;
    if (!cell) {
      return '<button class="cell lv-none" data-row="' + row + '" data-tier="' + tier.key + '" disabled>' +
        '<span class="cell-main">—</span><span class="cell-pct">缺少数据</span></button>';
    }
    const L = cell.layer;
    const main = L === null
      ? esc(overLayerText())
      : L + '<span class="unit">层</span>';
    // 性格写进行头（只写一次）；格子里只留 层数 + 0层伤害% + 加点角标
    const cfgObj = cell.index >= 0 ? D.CONFIGS[cell.index] : null;
    const jKey = cfgObj ? String(cfgObj.key).split('·')[1] : '';
    const jLabel = cell.ivsLabel || '';
    const natCfg = D.CONFIG_NATURES.filter(n => (n.nature.up + '>' + n.nature.down) === cell.natureKey)[0];
    const cfgLabel = (natCfg ? natCfg.key + ' ' + natCfg.label : cell.natureLabel) + ' · ' + jKey;
    const detailTitle = cfgLabel + ' → ' + (L === null ? '上限 ' + ui.maxLayer + ' 层内不可斩（显示 ' + overLayerText() + '）' : L + ' 层') +
      '　0层伤害 ' + D.formatPct(cell.pct0) + '（' + cell.dmg0 + ' / ' + cell.defHP + '）' +
      '　点击查看 ' + D.CONFIGS.length + ' 组参考';
    return '<button class="cell ' + layerClass(entry) + '' + '" ' +
      'data-row="' + row + '" data-tier="' + tier.key + '" title="' + esc(detailTitle) + '">' +
      (jKey ? '<span class="cell-j" title="' + esc('加点 ' + jKey + '：' + jLabel) + '">' + esc(jKey) + '</span>' : '') +
      '<span class="cell-main">' + main + '</span>' +
      '<span class="cell-pct">' + D.formatPct(cell.pct0) + '</span>' +
      '</button>';
  }

  /** 展开态：按内容实际高度自适应窗口（主进程决定是否采纳） */
  let autoHeightTimer = null;
  let lastAutoHeight = 0;
  function scheduleAutoHeight() {
    if (!api || !api.autoHeight) return;
    if (view.collapsed) return;
    if (autoHeightTimer) clearTimeout(autoHeightTimer);
    autoHeightTimer = setTimeout(() => {
      autoHeightTimer = null;
      const content = document.getElementById('content');
      const frame = document.getElementById('frame');
      const bar = document.getElementById('titlebar');
      if (!content || !frame) return;
      // 内容的"自然高度"：子元素高度之和 + 间距（flex 容器会被拉满，不能直接用 scrollHeight）
      const cs = getComputedStyle(content);
      const gap = parseFloat(cs.rowGap || cs.gap || '4') || 4;
      let natural = 0;
      const kids = Array.prototype.slice.call(content.children).filter(el => !el.classList.contains('is-hidden'));
      for (const el of kids) natural += el.getBoundingClientRect().height;
      natural += Math.max(0, kids.length - 1) * gap;
      const fs2 = getComputedStyle(frame);
      const padY = (parseFloat(fs2.paddingTop) || 0) + (parseFloat(fs2.paddingBottom) || 0);
      const gapY = (parseFloat(fs2.rowGap || fs2.gap || '6') || 6);
      const barH = bar ? bar.getBoundingClientRect().height : 38;
      const h = Math.ceil(natural + padY + gapY + barH + 2);
      if (!h || Math.abs(h - lastAutoHeight) < 4) return;
      lastAutoHeight = h;
      api.autoHeight(h);
    }, 160);
  }

  function renderGrid() {
    const grid = view.grid;
    for (const row of ROWS) {
      const rowEl = document.querySelector('.grid-row[data-row="' + row + '"]');
      if (!rowEl) continue;
      const sprite = spriteOf(row);
      const nameEl = rowEl.querySelector('.row-name');
      if (nameEl) nameEl.textContent = sprite ? sprite.name : '-';
      // 行头第二行：该行最优配置的性格（6 格性格一致，只写一次）
      const cfgEl = rowEl.querySelector('.row-cfg');
      if (cfgEl) {
        const first = grid && grid.cells.filter(c => c.row === row)[0];
        const nat = first && first.cell ? first.cell.natureLabel : '';
        const full = first && first.cell ? (first.cell.natureFull || first.cell.natureLabel) : '';
        cfgEl.textContent = nat || '—';
        cfgEl.title = full ? ('性格：' + full) : '';
      }
      // 保留 row-head，重建 3 个格子
      Array.prototype.slice.call(rowEl.querySelectorAll('.cell')).forEach(el => el.remove());
      for (const tier of D.DEFENDER_TIERS) {
        const entry = grid && grid.cells.filter(c => c.row === row && c.tier.key === tier.key)[0];
        if (!entry) continue;
        rowEl.insertAdjacentHTML('beforeend', cellHTML(entry));
      }
    }

    // 底部说明 + 层上限
    const note = $('#gridNote');
    // 只有「6 格全部真正重算」的耗时才算「全量」；命中缓存 / 半量重算都不覆盖。
    // 多次采样取最小值：一次测量可能正好撞上系统其它进程占 CPU，最小值更接近稳态。
    if (grid && grid.cold === 6 && grid.ms > 2) {
      view.lastFullMs = view.lastFullMs ? Math.min(view.lastFullMs, grid.ms) : grid.ms;
    }
    const ms = (view.lastFullMs || (grid ? grid.ms : 0)).toFixed(0);
    const killText = (() => {
      if (!grid) return '';
      let best = null;
      for (const c of grid.cells) {
        if (!c.cell) continue;
        const L = c.cell.layer;
        if (L === null) continue;
        if (!best || L < best.L) best = { L, row: c.row, tier: c.tier };
      }
      if (!best) return '当前 ' + ui.maxLayer + ' 层上限内两只攻方都无法斩杀任何档位（全部显示 ' + overLayerText() + '）';
      return '最快：' + SLOT_NAME[best.row] + ' × ' + best.tier.label + ' → ' + best.L + ' 层';
    })();
    note.innerHTML = '<span>' + esc(killText) + '</span>' +
      '<span class="note-right" title="6 格 = 2 攻方 × 3 档 × 1 套当前配置 = 6 次伤害求解（明细面板里的 ' + D.CONFIGS.length + ' 组只作参考，点开才算）">全量 ' +
      ms + 'ms · ' + (ROWS.length * D.DEFENDER_TIERS.length) + ' 次求解 · 层上限' +
      '<select id="maxLayerSel" class="select" style="height:18px;margin-left:4px;font-size:10px">' +
      [5, 10, 15, 20, 30, 50, 99].map(v => '<option value="' + v + '"' + (v === ui.maxLayer ? ' selected' : '') + '>' + v + '</option>').join('') +
      '</select></span>';

    const sel = $('#maxLayerSel');
    if (sel) {
      sel.addEventListener('change', () => {
        ui.maxLayer = Number(sel.value) || D.DEFAULT_MAX_LAYER;
        ui.maxLayerTouched = true; // 用户手动改过 → 下次启动不再迁移成 50
        recompute();
        saveUI();
      });
    }
  }

  function renderMinibar() {
    const sum = $('#miniSum');
    if (!sum) return;
    const grid = view.grid;
    if (!grid) { sum.innerHTML = ''; return; }
    const parts = [];
    for (const row of ROWS) {
      const layers = D.DEFENDER_TIERS.map(tier => {
        const entry = grid.cells.filter(c => c.row === row && c.tier.key === tier.key)[0];
        return entry && entry.cell ? entry.cell.layer : null;
      });
      // 不可斩别用 ✗（像报错）：单档写「不可」，三档全不可斩就压成「全不可」
      let body;
      if (layers.every(L => L === null)) {
        body = '<i class="lv-none" title="三档都超出上限">' + esc(overLayerText()) + '</i>';
      } else {
        body = layers.map(L => L === null ? '<i class="lv-none">' + esc(overLayerText()) + '</i>' : '<i>' + L + '</i>').join(' <b>/</b> ');
      }
      // 标签用真实精灵名（取不到时退回「攻①/攻②」）；名字过长由 CSS 截断，数字始终完整
      const sprite = spriteOf(row);
      const label = sprite && sprite.name ? sprite.name : SLOT_NAME[row];
      const mtext = modsText(row);
      const boost = mtext
        ? '<span class="mini-boost" title="' + esc(mtext) + '">⁺</span>'
        : '';
      parts.push('<span class="mini-item" data-row="' + row + '">' +
        '<b class="mini-name" title="' + esc(sprite ? sprite.name : SLOT_NAME[row]) + '">' + esc(label) + '</b>' +
        boost + body + '</span>');
    }
    sum.innerHTML = parts.join('');

    // 靶子按钮（点击后撑出一块小菜单，不再撑满整窗）
    const defSprite = spriteOf('def');
    const defEmoji = defSprite && defSprite.types && defSprite.types[0] ? typeEmoji(defSprite.types[0]) : '❔';
    const target = $('#miniTarget');
    if (target) {
      target.innerHTML = '<span class="mt-emoji">' + defEmoji + '</span>' +
        '<span class="mt-name">' + esc(defSprite ? defSprite.name : '未选择') + '</span>' +
        '<span class="mt-caret">▾</span>';
    }
  }

  // -------------------------------------------------------------------------
  // 6.5 小条里的轻量守方菜单（300px 高的小面板，不再撑满整窗）
  // -------------------------------------------------------------------------
  const miniMenu = {
    open: false,
    level: 1,          // 1 = 属性 chips，2 = 精灵列表（搜索结果也走这里）
    type: '全部',
    query: '',
    items: [],
    cursor: 0,
  };

  const MINI_MENU_HEIGHT = 300; // 46 标题栏 + 约 250 的菜单区
  // 关闭菜单时窗口会从 300 缩回 46，Chromium 可能让搜索框"重新获得焦点"并触发 focus 事件，
  // 导致菜单刚关就被 focus 处理器又打开。这里加一个短暂的抑制窗口。
  let miniMenuSuppressFocusUntil = 0;

  function miniMenuIsOpen() { return miniMenu.open; }

  /** 菜单按内容算窗口高度（clamp 160~300）：一级 ~4 行属性，二级 7 行精灵 */
  function miniMenuHeight() {
    const el = $('#miniMenu');
    if (!el) return 220;
    const prev = el.style.maxHeight;
    el.style.maxHeight = 'none';
    const h = el.scrollHeight; // 内容自然高度（不受窗口裁剪影响）
    el.style.maxHeight = prev;
    return Math.max(160, Math.min(290, Math.round(h + 46 + 6)));
  }

  /** 把菜单当前视图的高度同步给主进程（切换一级/二级都调用） */
  function syncMiniMenuHeight() {
    if (!api || !api.tempExpand) return;
    if (!miniMenu.open || !view.collapsed) return;
    const h = miniMenuHeight();
    if (h === miniMenu.lastHeight) return;
    miniMenu.lastHeight = h;
    try { api.tempExpand(true, h); } catch (e) { /* 忽略 */ }
  }

  /** 打开/复用菜单：mode='types' 停在属性列表，mode='search' 展示搜索结果 */
  async function openMiniMenu(mode) {
    if (!view.collapsed) return; // 展开态有自己的全屏选择器
    if (!miniMenu.open) {
      miniMenu.open = true;
      miniMenu.lastHeight = 0;
      document.body.classList.add('mini-menu-open');
      const el = $('#miniMenu');
      if (el) {
        el.classList.remove('is-hidden');
        el.setAttribute('aria-hidden', 'false');
      }
      // 先按当前内容估个高度撑开（renderMiniMenu 之后还会再校正一次）
      if (api) {
        try { await api.tempExpand(true, 230); } catch (e) { /* 撑不开也照样显示 */ }
      }
    }
    if (mode === 'search') {
      const q = ($('#miniSearch') || {}).value || '';
      miniMenu.query = q;
      miniMenu.level = q.trim() ? 2 : 1;
    } else if (mode === 'types') {
      miniMenu.query = '';
      miniMenu.level = 1;
    }
    miniMenu.cursor = 0;
    renderMiniMenu();
    syncMiniMenuHeight();
  }

  /** 关闭菜单并收回 46px（restore=false 时只隐藏，不动窗口） */
  function closeMiniMenu(restore) {
    if (!miniMenu.open) return;
    miniMenu.open = false;
    miniMenuSuppressFocusUntil = (typeof performance !== 'undefined' ? performance.now() : Date.now()) + 600;
    document.body.classList.remove('mini-menu-open');
    const el = $('#miniMenu');
    if (el) {
      el.classList.add('is-hidden');
      el.setAttribute('aria-hidden', 'true');
    }
    const input = $('#miniSearch');
    if (input) input.value = '';
    miniMenu.query = '';
    miniMenu.level = 1;
    miniMenu.cursor = 0;
    miniMenu.items = [];
    if (restore !== false && api) api.tempExpand(false);
  }

  /** 候选列表：有搜索词走 matchSprite（跨属性），否则按属性/常用守方 */
  function miniCandidates() {
    const q = miniMenu.query.trim().toLowerCase();
    if (q) {
      const scored = [];
      for (const sprite of allSprites()) {
        const score = matchSprite(sprite, q);
        if (score > 0) scored.push({ sprite, score });
      }
      scored.sort((x, y) => y.score - x.score || (x.sprite.hbid || 0) - (y.sprite.hbid || 0));
      return scored.map(x => x.sprite);
    }
    if (miniMenu.type === '全部') {
      // 「全部」给常用守方，避免一次列 622 只
      const common = (DATA.others && DATA.others.common_defenders) || [];
      const list = common.map(id => D.getSprite(id)).filter(Boolean);
      return list.length ? list : allSprites().slice(0, 60);
    }
    return allSprites().filter(s => (s.types || []).map(typeName).indexOf(miniMenu.type) >= 0)
      .sort((x, y) => (y.hp || 0) - (x.hp || 0) || (x.hbid || 0) - (y.hbid || 0));
  }

  function renderMiniMenu() {
    const body = $('#mmBody');
    const backBtn = $('#mmBack');
    const titleEl = $('#mmTitle');
    if (!body) return;
    const searching = !!miniMenu.query.trim();

    if (!searching && miniMenu.level === 1) {
      if (backBtn) backBtn.classList.add('is-hidden');
      if (titleEl) titleEl.textContent = '选择守方';
      const types = Object.keys(DATA.types || {});
      body.innerHTML = '<div class="mm-types">' + ['全部'].concat(types).map(t => {
        const label = t === '全部' ? '全部' : typeEmoji(t + '系') + ' ' + t;
        return '<button class="mm-type" data-type="' + esc(t) + '">' + esc(label) + '</button>';
      }).join('') + '</div>';
      return;
    }

    if (backBtn) backBtn.classList.toggle('is-hidden', searching);
    if (titleEl) titleEl.textContent = searching ? '搜索：' + miniMenu.query.trim() : miniMenu.type + '系';

    const list = miniCandidates();
    const show = list.slice(0, 200);
    miniMenu.items = show;
    if (!show.length) {
      body.innerHTML = '<div class="mm-empty">无匹配精灵</div>';
      return;
    }
    if (miniMenu.cursor >= show.length) miniMenu.cursor = 0;
    const currentId = ui.slots.def;
    body.innerHTML = '<div class="mm-list">' + show.map((s, i) => {
      const cls = 'mm-item' + (i === miniMenu.cursor ? ' is-cursor' : '') + (s.id === currentId ? ' is-current' : '');
      return '<button class="' + cls + '" data-id="' + esc(s.id) + '">' +
        avatarHTML(s) +
        '<span class="mm-name">' + esc(s.name) + '</span>' +
        '<span class="mm-stats">HP' + s.hp + ' 攻' + s.atk + ' 魔' + s.matk + '</span>' +
        '</button>';
    }).join('') + '</div>';
    wireAvatars(body);
    const cursorEl = body.querySelector('.is-cursor');
    if (cursorEl && cursorEl.scrollIntoView) cursorEl.scrollIntoView({ block: 'nearest' });
  }

  /** 小条里选中守方：更新 → 收回 46px → 重算 */
  function selectDefenderFromMini(id) {
    const sprite = D.getSprite(id);
    if (!sprite) return;
    ui.slots.def = id;
    ui.skills.def = '__none__';
    closeMiniMenu();       // 收回小条，并清空搜索框
    renderCards();
    renderMinibar();
    recompute();
    saveUI();
  }

  function moveMiniCursor(delta) {
    if (!miniMenu.items.length) return;
    const n = miniMenu.items.length;
    miniMenu.cursor = (miniMenu.cursor + delta + n) % n;
    const body = $('#mmBody');
    if (!body) return;
    Array.prototype.slice.call(body.querySelectorAll('.mm-item')).forEach((el, i) => {
      el.classList.toggle('is-cursor', i === miniMenu.cursor);
    });
    const cur = body.querySelector('.is-cursor');
    if (cur && cur.scrollIntoView) cur.scrollIntoView({ block: 'nearest' });
  }

  function recompute() {
    view.grid = computeGrid();
    renderGrid();
    renderMinibar();
    for (const row of ROWS) renderCfgHint(row);
    scheduleAutoHeight();
    if (view.detail) renderDetail();
  }

  // -------------------------------------------------------------------------
  // 6. 明细面板
  // -------------------------------------------------------------------------
  function currentDetailEntry() {
    if (!view.detail || !view.grid) return null;
    const entry = view.grid.cells.filter(c => c.row === view.detail.row && c.tier.key === view.detail.tierKey)[0];
    if (entry && view.detail.refAll) entry.refAll = view.detail.refAll;
    return entry || null;
  }

  /**
   * 明细行模型：20 组参考结果（点格子时才计算），并标出"当前配置"那一行。
   * 行 = { idx, key, natureLabel, ivsLabel, ivsArr, up, layer, pct0, dmg, current }
   */
  function detailRows(entry) {
    if (!entry || !entry.scene) return [];
    const all = entry.refAll || (entry.refAll = D.referenceAll(entry.scene, ui.maxLayer));
    if (!all || !all.configs) return [];
    const cur = entry.cell || {};
    return all.configs.map((cfg, i) => {
      const nat = D.CONFIG_NATURES.filter(n => n.nature.up + '>' + n.nature.down === cfg.natureKey)[0];
      const iv = D.IVS_LIST.filter(v => v.key === cfg.ivsKey)[0];
      return {
        idx: i,
        key: cfg.key,
        zi: cfg.zi,
        ji: cfg.ji,
        natureLabel: nat ? nat.label : D.shortNatureLabel(cfg.natureKey),
        natureFull: nat ? nat.full : D.fullNatureLabel(cfg.natureKey),
        ivsLabel: iv ? iv.label : cfg.ivs.map(k => D.STAT_LABELS[k]).join('/'),
        ivsArr: cfg.ivs,
        up: cfg.nature.up,
        layer: all.layers[i] === D.NO_KILL ? null : all.layers[i],
        pct0: all.pct0[i],
        dmg: all.dmg[i],
        current: cfg.natureKey === cur.natureKey && cfg.ivsKey === cur.ivsKey,
      };
    });
  }

  function rowPasses(row) {
    if (view.filters.atkNature && row.up !== 'atk' && row.up !== 'matk') return false;
    if (view.filters.atkIvs && row.ivsArr.indexOf('atk') < 0 && row.ivsArr.indexOf('matk') < 0) return false;
    if (view.filters.killable && row.layer === null) return false;
    return true;
  }

  function openDetail(row, tierKey) {
    view.detail = { row, tierKey };
    view.highlight = -1;
    $('#detail').classList.remove('is-hidden');
    $('#detail').setAttribute('aria-hidden', 'false');
    renderDetail();
  }

  function closeDetail() {
    view.detail = null;
    $('#detail').classList.add('is-hidden');
    $('#detail').setAttribute('aria-hidden', 'true');
  }

  function renderDetail() {
    const entry = currentDetailEntry();
    if (!entry) { closeDetail(); return; }
    const { row, tier, scene, cell } = entry;
    if (!cell) {
      $('#detailTitle').textContent = SLOT_NAME[row] + ' × ' + tier.label + ' ' + (tier.name || '') + '：缺少数据';
      $('#detailSum').textContent = '请检查攻方/靶子是否已选定，且攻方有攻击技能。';
      $('#detailBody').innerHTML = '';
      $('#detailFoot').textContent = '';
      return;
    }

    const atkName = scene ? scene.attacker.name : '-';
    const skillName = scene ? scene.attackSkill.name : '-';
    const cls = scene && scene.attackSkill.damage_class ? scene.attackSkill.damage_class : '物攻';
    const defName = scene ? scene.defender.name : '-';
    const defSkillName = scene ? scene.defenseSkill.name : '无';
    $('#detailTitle').textContent = SLOT_NAME[row] + ' × ' + tier.label + ' ' + (tier.name || '') + '｜' + atkName + ' · ' +
      skillName + '（' + cls + '）→ ' + defName + ' · ' + defSkillName + '防';

    const all = entry.refAll || (entry.refAll = D.referenceAll(entry.scene, ui.maxLayer));
    const L = cell.layer;
    const natCfg = D.CONFIG_NATURES.filter(n => (n.nature.up + '>' + n.nature.down) === cell.natureKey)[0];
    const curLabel = (natCfg ? natCfg.key + ' ' + natCfg.label : cell.natureLabel) + ' · ' + cell.ivsLabel;
    $('#detailSum').innerHTML =
      '当前配置：<span class="hl">' + esc(curLabel) + '</span> → ' +
      (L === null
        ? '<span class="hl" style="color:#ff5a5a">' + ui.maxLayer + ' 层内不可斩（' + esc(overLayerText()) + '）</span>'
        : '<span class="hl">' + L + ' 层</span> 可斩杀') +
      '　｜　0 层伤害 ' + D.formatPct(cell.pct0) + '（' + cell.dmg0 + ' / ' + cell.defHP + '）' +
      (all ? '　｜　参考：' + all.configs.length + ' 组里有 ' + all.killed + ' 组可斩' : '');
    $('#detailBody').innerHTML = view.detailView === 'matrix' ? matrixHTML(entry) : groupsHTML(entry);
    $('#detailFoot').textContent = view.highlight >= 0
      ? footText(entry, view.highlight)
      : '高亮行 = 当前配置；其余 ' + (D.CONFIGS.length - 1) + ' 组仅作参考，点击任意行查看详情';

    // 过滤器 chip 状态
    $$('#filterRow .chip').forEach(chip => {
      const key = chip.getAttribute('data-filter');
      chip.classList.toggle('is-on', !!view.filters[key]);
    });
    $$('.detail-tools .tab').forEach(tab => {
      tab.classList.toggle('is-on', tab.getAttribute('data-view') === view.detailView);
    });
  }

  function footText(entry, index) {
    const row = detailRows(entry).filter(r => r.idx === index)[0];
    if (!row) return '点击任意组合查看该组合详情';
    const L = row.layer === null ? '上限内不可斩（' + overLayerText() + '）' : row.layer + ' 层';
    return (row.manual ? '[手动] ' : '[' + row.key + '] ') + row.natureLabel + ' · ' + row.ivsLabel + ' → ' + L +
      '　0层伤害 ' + row.dmg + '（' + D.formatPct(row.pct0) + '）' +
      '　选中层伤害 ' + row.dmg + ' / ' + entry.cell.all.defHP;
  }

  function groupsHTML(entry) {
    const rowsAll = detailRows(entry);
    if (!rowsAll.length) return '<div class="picker-empty">暂无数据</div>';
    const buckets = new Map();
    for (const row of rowsAll) {
      if (!rowPasses(row)) continue;
      const L = row.layer === null ? -1 : row.layer;
      if (!buckets.has(L)) buckets.set(L, []);
      buckets.get(L).push(row);
    }
    if (!buckets.size) return '<div class="picker-empty">当前过滤器下没有组合</div>';
    const keys = Array.from(buckets.keys()).sort((a, b) => (a === -1 ? 1 : b === -1 ? -1 : a - b));

    return keys.map(L => {
      const items = buckets.get(L).sort((a, b) => b.dmg - a.dmg);
      const gkey = entry.tier.key + '|' + entry.row + '|' + L;
      const collapsed = !!view.collapsedGroups[gkey];
      const head = '<button class="group-head" data-gkey="' + gkey + '">' +
        '<span class="gcaret">' + (collapsed ? '▸' : '▾') + '</span>' +
        '<span class="glv">' + (L === -1 ? esc(overLayerText()) + ' 层（超出上限，实际需要更多层或永远不可斩）' : L + ' 层') + '</span>' +
        '<span class="gcount">' + items.length + ' 组</span>' +
        '</button>';
      const rows = items.map(row => {
        const noKill = L === -1 ? ' no-kill' : '';
        const sel = row.current ? ' is-sel' : '';
        const cls = 'crow' + noKill + sel;
        return '<div class="' + cls + '" data-index="' + row.idx + '">' +
          '<span class="ck">' + esc(row.key) + (row.current ? '<em class="cur-tag">当前</em>' : '') + '</span>' +
          '<span class="cnat" title="' + esc(row.natureFull || row.natureLabel) + '">' + esc(row.natureLabel) + '</span>' +
          '<span class="civs">' + esc(row.ivsLabel) + '</span>' +
          '<span class="clv">' + (L === -1 ? esc(overLayerText()) : L + '层') + '</span>' +
          '<span class="cpct">' + D.formatPct(row.pct0) + '</span>' +
          '</div>';
      }).join('');
      return '<div class="group' + (collapsed ? ' is-collapsed' : '') + '" data-gkey="' + gkey + '">' +
        head + '<div class="group-items">' + rows + '</div></div>';
    }).join('');
  }

  function matrixHTML(entry) {
    const all = entry.refAll || (entry.refAll = D.referenceAll(entry.scene, ui.maxLayer));
    if (!all) return '<div class="picker-empty">暂无参考数据</div>';
    const legend = '行＝性格 Z1..Z5（物攻↑ / 魔攻↑ / 不加攻；Z1/Z2 另含牺牲另一项攻击），列＝加点 J1..J4（物攻向 / 魔攻向 / 双攻 / 无攻）；数字＝所需星陨层数，' + overLayerText() + '＝上限内不可斩';
    const headCells = D.CONFIG_IVS.map(v =>
      '<div class="mhead-h" title="' + esc(v.key + ' ' + v.label + '：' + v.ivs.map(k => D.STAT_LABELS[k]).join('/')) + '">' +
      esc(v.key) + ' ' + esc(v.short) + '</div>').join('');

    const rows = [];
    for (let zi = 0; zi < D.CONFIG_NATURES.length; zi++) {
      const nat = D.CONFIG_NATURES[zi];
      const cells = [];
      for (let ji = 0; ji < D.CONFIG_IVS.length; ji++) {
        const idx = zi * D.CONFIG_IVS.length + ji;
        const rawL = all.layers[idx];
        const L = rawL === D.NO_KILL ? null : rawL;
        let cls = 'mcell';
        if (L === null) cls += ' m5';
        else if (L === 0) cls += ' m0';
        else if (L <= 2) cls += ' m1';
        else if (L <= 5) cls += ' m3';
        else cls += ' m4';
        const rowObj = { up: nat.nature.up, ivsArr: D.CONFIG_IVS[ji].ivs, layer: L };
        if (!rowPasses(rowObj)) cls += ' dim';
        if (idx === entry.cell.manualConfigIndex) cls += ' is-sel';
        if (idx === view.highlight) cls += ' is-pick';
        const title = nat.key + ' ' + nat.full + ' · ' + D.CONFIG_IVS[ji].key + ' ' + D.CONFIG_IVS[ji].label;
        cells.push('<div class="' + cls + '" data-index="' + idx + '" title="' + esc(title) + '">' +
          (L === null ? esc(overLayerText()) : L) + '</div>');
      }
      rows.push('<div class="mrow"><div class="mrh" title="' + esc(nat.full) + '">' +
        esc(nat.key) + ' ' + esc(nat.label) + '</div>' + cells.join('') + '</div>');
    }
    return '<div class="matrix matrix-4"><div class="mrow mhead"><div class="mrh">性格＼加点</div>' + headCells + '</div>' +
      rows.join('') + '</div>' +
      '<div class="detail-foot" style="margin-top:6px">' + esc(legend) + '</div>';
  }

  // -------------------------------------------------------------------------
  // 7. 事件绑定
  // -------------------------------------------------------------------------
  function bindEvents() {
    // 选择器按钮
    $$('.picker-btn').forEach(btn => {
      btn.addEventListener('click', () => openPicker(btn.getAttribute('data-slot')));
    });

    // 技能 / 配置下拉
    $$('.skill-select').forEach(sel => {
      sel.addEventListener('change', () => {
        const slot = sel.getAttribute('data-slot');
        ui.skills[slot] = sel.value;
        recompute();
        saveUI();
      });
    });
    $$('.cfg-nature').forEach(sel => {
      sel.addEventListener('change', () => {
        const row = sel.getAttribute('data-slot');
        if (!sel.value) return; // 空值（极少见）不覆盖当前配置
        ui.configs[row].natureKey = sel.value;
        ui.configTouched[row] = true; // 用户改过 → 换精灵时不再重置
        renderCfgHint(row);
        recompute();
        saveUI();
      });
    });
    $$('.cfg-ivs').forEach(sel => {
      sel.addEventListener('change', () => {
        const row = sel.getAttribute('data-slot');
        if (!sel.value) return;
        ui.configs[row].ivsKey = sel.value;
        ui.configTouched[row] = true;
        renderCfgHint(row);
        recompute();
        saveUI();
      });
    });

    // 结果格 → 明细
    document.addEventListener('click', e => {
      const cellEl = e.target.closest ? e.target.closest('.cell') : null;
      if (cellEl && !cellEl.disabled) {
        openDetail(cellEl.getAttribute('data-row'), cellEl.getAttribute('data-tier'));
        return;
      }
    });

    // 明细面板内的交互
    $('#detail').addEventListener('click', e => {
      const tab = e.target.closest('.tab');
      if (tab) {
        view.detailView = tab.getAttribute('data-view');
        renderDetail();
        return;
      }
      const chip = e.target.closest('.chip');
      if (chip) {
        const key = chip.getAttribute('data-filter');
        view.filters[key] = !view.filters[key];
        renderDetail();
        return;
      }
      const ghead = e.target.closest('.group-head');
      if (ghead) {
        const k = ghead.getAttribute('data-gkey');
        view.collapsedGroups[k] = !view.collapsedGroups[k];
        renderDetail();
        return;
      }
      const crow = e.target.closest('.crow');
      if (crow) {
        view.highlight = Number(crow.getAttribute('data-index'));
        $('#detailFoot').textContent = footText(currentDetailEntry(), view.highlight);
        return;
      }
      const mcell = e.target.closest('.mcell');
      if (mcell) {
        view.highlight = Number(mcell.getAttribute('data-index'));
        $$('#detailBody .mcell.is-sel').forEach(el => el.classList.remove('is-sel'));
        mcell.classList.add('is-sel');
        $('#detailFoot').textContent = footText(currentDetailEntry(), view.highlight);
        return;
      }
    });
    $('#detailClose').addEventListener('click', () => closeDetail());

    // 选择器浮层
    $('#pickerClose').addEventListener('click', () => closePicker());
    $('#picker').addEventListener('click', e => {
      if (e.target === $('#picker')) { closePicker(); return; }
      const chip = e.target.closest('.type-chip');
      if (chip) {
        picker.type = chip.getAttribute('data-type');
        picker.cursor = 0;
        renderPickerTypes();
        renderPickerList();
        return;
      }
      const item = e.target.closest('.plist-item');
      if (item) { pickSprite(item.getAttribute('data-id')); return; }
    });
    $('#pickerSearch').addEventListener('input', e => {
      picker.query = e.target.value;
      picker.cursor = 0;
      renderPickerList();
    });
    $('#pickerSearch').addEventListener('keydown', e => {
      if (e.key === 'ArrowDown') { e.preventDefault(); picker.cursor = Math.min(picker.cursor + 1, Math.min(picker.items.length, 200) - 1); renderPickerList(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); picker.cursor = Math.max(picker.cursor - 1, 0); renderPickerList(); }
      else if (e.key === 'Enter') {
        e.preventDefault();
        const item = picker.items[picker.cursor];
        if (item) pickSprite(item.id);
      } else if (e.key === 'Escape') {
        // 关选择器就够了，必须阻止继续冒泡到 document 的 Esc（否则会被当成"交还鼠标"再处理一次）
        e.preventDefault();
        e.stopPropagation();
        closePicker();
      }
    });

    // ---------- 小条：靶子按钮 + 内联搜索 + 轻量菜单 ----------
    const miniTargetBtn = $('#miniTarget');
    if (miniTargetBtn) {
      miniTargetBtn.addEventListener('click', () => {
        if (miniMenu.open && miniMenu.level === 1 && !miniMenu.query) closeMiniMenu();
        else openMiniMenu('types');
      });
    }

    const miniSearchInput = $('#miniSearch');
    if (miniSearchInput) {
      miniSearchInput.addEventListener('focus', () => {
        const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
        if (now < miniMenuSuppressFocusUntil) return; // 刚关过菜单，忽略缩放引起的焦点回弹
        openMiniMenu('search');
      });
      miniSearchInput.addEventListener('input', () => {
        miniMenuSuppressFocusUntil = 0; // 用户在打字，说明确实要用菜单
        miniMenu.query = miniSearchInput.value;
        miniMenu.level = miniSearchInput.value.trim() ? 2 : 1;
        miniMenu.cursor = 0;
        if (!miniMenu.open) openMiniMenu('search');
        else { renderMiniMenu(); syncMiniMenuHeight(); }
      });
      miniSearchInput.addEventListener('keydown', e => {
        if (e.key === 'ArrowDown') { e.preventDefault(); e.stopPropagation(); moveMiniCursor(1); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); e.stopPropagation(); moveMiniCursor(-1); }
        else if (e.key === 'Enter') {
          e.preventDefault(); e.stopPropagation();
          const item = miniMenu.items[miniMenu.cursor];
          if (item) selectDefenderFromMini(item.id);
        } else if (e.key === 'Escape') {
          // 只关菜单，别让 Esc 继续冒泡（否则会被当成"交还鼠标"）
          e.preventDefault(); e.stopPropagation();
          closeMiniMenu();
        }
      });
    }

    // 攻方加成：−/+ 按 50 步进；输入框失焦/回车生效
    $$('.mod-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const row = btn.getAttribute('data-slot');
        const key = btn.getAttribute('data-mod');
        const dir = Number(btn.getAttribute('data-dir')) || 1;
        const cur = (ui.mods[row] && ui.mods[row][key]) || 0;
        setMod(row, key, cur + dir * 50);
      });
    });
    $$('.mod-input').forEach(inp => {
      const commit = () => setMod(inp.getAttribute('data-slot'), inp.getAttribute('data-mod'), inp.value);
      inp.addEventListener('change', commit);
      inp.addEventListener('blur', commit);
      inp.addEventListener('keydown', e => {
        if (e.key === 'Enter') { e.preventDefault(); commit(); inp.blur(); }
        e.stopPropagation();
      });
    });

    const mm = $('#miniMenu');
    if (mm) {
      mm.addEventListener('click', e => {
        if (e.target.closest('#mmClose')) { closeMiniMenu(); return; }
        if (e.target.closest('#mmBack')) { miniMenu.type = '全部'; miniMenu.level = 1; miniMenu.query = ''; const inp = $('#miniSearch'); if (inp) inp.value = ''; miniMenu.cursor = 0; renderMiniMenu(); syncMiniMenuHeight(); return; }
        const typeBtn = e.target.closest('.mm-type');
        if (typeBtn) {
          miniMenu.type = typeBtn.getAttribute('data-type');
          miniMenu.level = 2;
          miniMenu.cursor = 0;
          renderMiniMenu();
          syncMiniMenuHeight();
          return;
        }
        const item = e.target.closest('.mm-item');
        if (item) selectDefenderFromMini(item.getAttribute('data-id'));
      });
    }

    // 点菜单外部（窗口内）→ 关闭并收回。菜单打开期间标题栏是 no-drag，
    // 所以点在摘要/空白/标题栏上都能收到事件。
    const outsideHandler = e => {
      if (!miniMenu.open) return;
      const t = e.target;
      if (!t || !t.closest) { closeMiniMenu(); return; }
      if (t.closest('#miniMenu') || t.closest('#miniTarget') || t.closest('#miniSearch')) return;
      if (t.closest('#btnCollapse') || t.closest('#btnPass') || t.closest('#btnClose')) return; // 交给它们自己的逻辑
      closeMiniMenu();
    };
    document.addEventListener('mousedown', outsideHandler, true);

    // 窗口失焦（点了桌面/别的窗口）——与主进程 blur 双保险：谁先到谁关
    window.addEventListener('blur', () => {
      if (miniMenu.open) closeMiniMenu();
    });

    // ⓘ：重新展开/收起使用提示
    const btnTip = $('#btnTip');
    if (btnTip) {
      btnTip.addEventListener('click', () => {
        const el = $('#tip');
        if (!el) return;
        const show = el.classList.contains('is-hidden');
        el.classList.toggle('is-hidden', !show);
        btnTip.classList.toggle('is-on', show);
        if (!show) { ui.tipDismissed = true; saveUI(); }
        scheduleAutoHeight();
      });
    }

    // 标题栏按钮
    $('#btnPass').addEventListener('click', () => {
      if (api) api.togglePassthrough();
    });
    // 收起 / 展开：交给主进程翻转（渲染层的 view.collapsed 只用于显示文字）
    $('#btnCollapse').addEventListener('click', () => {
      if (api) api.toggleCollapse();
    });
    $('#btnClose').addEventListener('click', () => {
      if (api) api.close();
    });
    $('#tipClose').addEventListener('click', () => {
      ui.tipDismissed = true;
      $('#tip').classList.add('is-hidden');
      saveUI();
    });

    // 全局键盘
    document.addEventListener('keydown', e => {
      if (e.defaultPrevented) return; // 内层（搜索框等）已经处理过，别重复执行
      if (e.key === 'Escape') {
        if (miniMenu.open) { closeMiniMenu(); return; }
        if (!$('#picker').classList.contains('is-hidden')) { closePicker(); return; }
        if (!$('#detail').classList.contains('is-hidden')) { closeDetail(); return; }
        // 再按 Esc：交还鼠标，回到穿透状态（继续操作游戏）
        if (api && !view.passthrough) api.setPassthrough(true);
      }
    });

    // 主进程模式事件
    if (api) {
      api.onMode(mode => {
        // 诊断用：记录最近几次 mode 事件（QA/自动化排查状态不同步）
        window.__modeLog = window.__modeLog || [];
        window.__modeLog.push({ c: !!mode.collapsed, p: !!mode.passthrough, t: Date.now() });
        if (window.__modeLog.length > 20) window.__modeLog.shift();
        applyMode(mode);
      });
      if (api.onMiniMenuClose) api.onMiniMenuClose(() => closeMiniMenu(false));
      api.onOnlineData(payload => applyOnlineData(payload, 'online'));
      api.onDataStatus(st => {
        const tag = $('#dataTag');
        if (tag) tag.textContent = st && st.source === 'online' ? '在线数据' : '内置数据';
        if (tag) tag.title = st ? st.message || '' : '';
      });
    }
  }

  /** 诊断：上报渲染层矩形（主进程只在 XY_DEBUG/XY_DIAG 下写盘） */
  function reportRects(why) {
    if (!api || !api.debugRects) return;
    try {
      const f = document.getElementById('frame');
      const tb = document.getElementById('titlebar');
      const r = el => {
        if (!el) return null;
        const b = el.getBoundingClientRect();
        return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) };
      };
      const de = document.documentElement;
      const sum = document.getElementById('miniSum');
      api.debugRects({
        why: why,
        inner: { w: window.innerWidth, h: window.innerHeight },
        html: { scrollW: de.scrollWidth, clientW: de.clientWidth, offsetW: de.offsetWidth },
        bodyW: { scrollW: document.body.scrollWidth, clientW: document.body.clientWidth },
        parts: {
          minibar: (function(){ const el = document.getElementById('minibar'); return el ? Math.round(el.getBoundingClientRect().width) : null; })(),
          sum: sum ? Math.round(sum.getBoundingClientRect().width) : null,
          target: (function(){ const el = document.getElementById('miniTarget'); return el ? Math.round(el.getBoundingClientRect().width) : null; })(),
          search: (function(){ const el = document.getElementById('miniSearch'); return el ? Math.round(el.getBoundingClientRect().width) : null; })(),
          btns: (function(){ const el = document.querySelector('.win-btns'); return el ? Math.round(el.getBoundingClientRect().width) : null; })(),
          btnsRight: (function(){ const el = document.querySelector('.win-btns'); const b = el && el.getBoundingClientRect(); return b ? Math.round(b.right - window.innerWidth) : null; })(),
          scrollW: (function(){ const el = document.getElementById('titlebar'); return el ? el.scrollWidth : null; })(),
          clientW: (function(){ const el = document.getElementById('titlebar'); return el ? el.clientWidth : null; })(),
        },
        right: {
          frame: f ? Math.round(f.getBoundingClientRect().right - window.innerWidth) : null,
          titlebar: tb ? Math.round(tb.getBoundingClientRect().right - window.innerWidth) : null,
          miniSum: sum ? Math.round(sum.getBoundingClientRect().right - window.innerWidth) : null,
        },
        dpr: window.devicePixelRatio,
        body: r(document.body),
        frame: r(f),
        titlebar: r(tb),
        collapsed: view.collapsed,
      });
    } catch (e) { /* 忽略 */ }
  }

  function applyMode(mode) {
    if (!mode) return;
    view.collapsed = !!mode.collapsed;
    view.passthrough = !!mode.passthrough;
    document.body.classList.toggle('collapsed', view.collapsed);
    // 展开态不该留着小菜单（窗口尺寸已由主进程接管，这里只隐藏）
    if (!view.collapsed && miniMenu.open) closeMiniMenu(false);
    document.body.classList.toggle('passthrough', view.passthrough);
    $('#btnPass').classList.toggle('is-on', !view.passthrough);
    $('#btnPass').textContent = view.passthrough ? '穿透' : '接管中';
    $('#btnCollapse').textContent = view.collapsed ? '展开' : '收起';
    if (view.collapsed) renderMinibar();
    reportRects('mode');
  }

  // -------------------------------------------------------------------------
  // 8. 在线数据
  // -------------------------------------------------------------------------
  function applyOnlineData(payload, source) {
    if (!payload || !payload.sprites || !payload.skills || !payload.types) return;
    const ids = Object.keys(payload.sprites);
    if (ids.length < 100) return;
    DATA = payload;
    D.bindData(DATA);
    D.clearCache();
    const tag = $('#dataTag');
    if (tag) { tag.textContent = '在线数据'; tag.title = '已从 stardmg.top 更新（' + ids.length + ' 只精灵）'; }
    ensureValidState();
    renderCards();
    recompute();
  }

  async function initData() {
    if (!api) return;
    try {
      const payload = await api.getOnlineData();
      if (payload) applyOnlineData(payload, 'online');
      const st = await api.getDataStatus();
      const tag = $('#dataTag');
      if (tag && st) { tag.textContent = st.source === 'online' ? '在线数据' : '内置数据'; tag.title = st.message || ''; }
    } catch (e) { /* 静默：内置包已可用 */ }
  }

  // -------------------------------------------------------------------------
  // 9. 启动
  // -------------------------------------------------------------------------
  /**
   * JIT 预热：先跑一遍全量（结果丢弃、缓存清空），让 V8 把热路径编译掉。
   * 不做的话首屏会把 ~60ms 的编译开销算进「6 格耗时」里。
   */
  function runAllScenes() {
    for (const row of ROWS) {
      for (const tier of D.DEFENDER_TIERS) {
        const scene = D.buildScene({
          attackerId: ui.slots[row],
          attackSkillId: ui.skills[row],
          defenderId: ui.slots.def,
          defenseSkillId: ui.skills.def,
          tierKey: tier.key,
        });
        if (scene) D.evaluateAll(scene, ui.maxLayer);
      }
    }
  }

  /**
   * 预热 + 计时：
   *   ① 立刻跑一遍全量 → 结果进缓存，首屏窗口一出现就是最终数字（零等待）
   *   ② 界面稳定后再清缓存跑一遍并计时 → 这才是「6 格全量冷算」的稳态耗时，
   *      直接写进结果区右下角，避免把首帧的 JIT/排版开销算进去。
   */
  function warmup() {
    try {
      runAllScenes();
    } catch (e) { /* 预热失败不影响正常流程 */ }

    // 界面空闲时测冷启动全量（避开首屏排版/头像加载的 CPU 争抢），取多次较小值
    const measure = () => {
      try {
        D.clearCache();
        const t0 = performance.now();
        runAllScenes();
        const ms = performance.now() - t0;
        if (ms > 2) {
          view.lastFullMs = view.lastFullMs ? Math.min(view.lastFullMs, ms) : ms;
          renderGrid();
        }
      } catch (e) { /* 忽略 */ }
    };
    const idle = typeof requestIdleCallback === 'function'
      ? (cb, timeout) => requestIdleCallback(cb, { timeout })
      : (cb) => setTimeout(cb, 600);
    // 采样三次空闲帧，取最小值（避开首屏排版 / 头像加载 / 其它进程的抖动）
    idle(() => idle(() => idle(measure, 2500), 1800), 900);
  }

  async function boot() {
    // 先应用主进程持久化状态
    if (api) {
      try {
        const st = await api.getState();
        if (st && st.ui) {
          if (st.ui.slots) Object.assign(ui.slots, st.ui.slots);
          if (st.ui.skills) Object.assign(ui.skills, st.ui.skills);
          if (st.ui.configs) Object.assign(ui.configs, st.ui.configs);
          if (st.ui.configTouched) Object.assign(ui.configTouched, st.ui.configTouched);
          if (st.ui.mods) {
            for (const row of ['atk1', 'atk2']) {
              const m = st.ui.mods[row] || {};
              ui.mods[row] = {
                atkPct: D.clampMod(m.atkPct),
                powerPct: D.clampMod(m.powerPct),
              };
            }
          }
          if (typeof st.ui.maxLayer === 'number') ui.maxLayer = st.ui.maxLayer;
          if (st.ui.maxLayerTouched) ui.maxLayerTouched = true;
          if (st.ui.tipDismissed) ui.tipDismissed = true;
        }
        applyMode(st && st.mode ? st.mode : { passthrough: st ? st.passthrough : true, collapsed: st ? st.collapsed : false });
      } catch (e) { /* 忽略，用默认值 */ }
    }

    // 提示条：默认只在首次显示（关掉后可通过标题栏 ⓘ 重新展开）
    const tipEl = $('#tip');
    if (tipEl) tipEl.classList.toggle('is-hidden', !!ui.tipDismissed);

    ensureValidState();
    renderCards();
    bindEvents();
    window.addEventListener('resize', () => reportRects('resize'));
    reportRects('boot');
    warmup();     // V8 预热：让首屏显示的耗时是真实稳态值
    recompute();
    initData();
  }

  // 调试钩子（只读，便于 QA/自动化确认内部性能数字）
  window.__xyDebug = {
    get configs() { return JSON.parse(JSON.stringify(ui.configs)); },
    get touched() { return JSON.parse(JSON.stringify(ui.configTouched)); },
    get miniOpen() { return miniMenu.open; },
    get miniLevel() { return miniMenu.level; },
    get lastFullMs() { return view.lastFullMs; },
    get gridMs() { return view.grid ? view.grid.ms : -1; },
    get values() { return view.grid ? view.grid.cells.map(c => (c.cell ? c.cell.layer : 'x')) : []; },
    recompute: () => recompute(),
  };

  boot();
})();
