'use strict';
/**
 * src/main/smoke.js
 * ---------------------------------------------------------------------------
 * 无头自检（XY_SMOKE=1 时由 main.js 调用）。
 * 用 executeJavaScript 驱动 UI：开选择器 → 搜索 → 选中 → 明细 → 矩阵 → 靶子选择器，
 * 每步截图并统计不透明像素占比——「整窗变透明」这类合成问题会直接体现在占比上。
 *
 * 截图输出：默认 <app>/_intermediates/smoke-*.png；用 XY_SMOKE_OUT=<dir> 覆盖
 *          （在打包版里跑自检必须覆盖，否则会写进 resources/app 污染绿色包）
 */
const fs = require('node:fs');
const path = require('node:path');
const { globalShortcut, screen } = require('electron');

function createRunner(win, app, ROOT) {
  const js = code => win.webContents.executeJavaScript(code, true);
  const wait = ms => new Promise(r => setTimeout(r, ms));
  // 截图输出目录：默认 <app>/_intermediates。
  // 用 XY_SMOKE_OUT 覆盖——在**打包版**里跑自检时 ROOT 是 resources/app，
  // 不覆盖就会把 50+ 张截图写进绿色包，污染待发布的产物。
  const outDir = process.env.XY_SMOKE_OUT
    ? path.resolve(process.env.XY_SMOKE_OUT)
    : path.join(ROOT, '_intermediates');

  async function capture(name) {
    try {
      fs.mkdirSync(outDir, { recursive: true });
      const img = await win.webContents.capturePage();
      const size = img.getSize();
      const buf = img.toBitmap();
      let opaque = 0;
      for (let i = 3; i < buf.length; i += 4) if (buf[i] > 16) opaque++;
      fs.writeFileSync(path.join(outDir, name), img.toPNG());
      // 非透明像素包围盒（用来核对"内容是否越出窗口/是否留白块"）
      let minX = size.width, minY = size.height, maxX = -1, maxY = -1;
      for (let y = 0; y < size.height; y++) {
        for (let x = 0; x < size.width; x++) {
          if (buf[(y * size.width + x) * 4 + 3] > 16) {
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
          }
        }
      }
      lastBox = { w: size.width, h: size.height, x0: minX, y0: minY, x1: maxX, y1: maxY };
      return Number((opaque / Math.max(1, size.width * size.height)).toFixed(3));
    } catch (e) {
      return 'capture-error:' + (e && e.message);
    }
  }

  let lastBox = null;
  return { js, wait, capture, getBox: () => lastBox, outDir };
}

async function run(win, app, ROOT) {
  const runner = createRunner(win, app, ROOT);
  const { js, wait, capture } = runner;
  const results = {};
  const SEL_PICKER_ATK1 = '.picker-btn[data-slot="atk1"]';
  const SEL_PICKER_DEF = '.picker-btn[data-slot="def"]';
  try {
    // 自适应高度（首次展开，用户还没手动拖过）
    await wait(700);
    results.autoHeight = {
      window: win.getBounds().height,
      bodyScroll: await js('document.body.scrollHeight'),
      contentNatural: await js('(function(){ var c = document.getElementById("content"); var cs = getComputedStyle(c); var gap = parseFloat(cs.rowGap || cs.gap || "4") || 4; var kids = Array.prototype.slice.call(c.children).filter(function(el){ return !el.classList.contains("is-hidden"); }); var n = 0; kids.forEach(function(el){ n += el.getBoundingClientRect().height; }); return Math.round(n + Math.max(0, kids.length - 1) * gap); })()'),
      tipVisible: await js('!document.getElementById("tip").classList.contains("is-hidden")')
    };
    results.initial = await js('({ cells: document.querySelectorAll(".cell").length, values: Array.from(document.querySelectorAll(".cell-main")).map(function(e){return e.textContent;}), note: (document.getElementById("gridNote")||{}).textContent||"" })');
    results.tierHeads = await js('Array.prototype.slice.call(document.querySelectorAll(".tier-head")).map(function(e){ return { text: e.textContent.trim(), title: e.title, w: Math.round(e.getBoundingClientRect().width), h: Math.round(e.getBoundingClientRect().height), clipped: e.scrollWidth > e.clientWidth + 1 }; })');
    results.a1 = await capture('smoke-1-initial.png');

    // ① 打开攻①选择器
    await js('document.querySelector(\'' + SEL_PICKER_ATK1 + '\').click()');
    await wait(500);
    results.picker1 = await js('({ visible: !document.getElementById("picker").classList.contains("is-hidden"), items: document.querySelectorAll(".plist-item").length, first: (document.querySelector(".plist-item .plist-name b")||{}).textContent||"" })');
    results.a2 = await capture('smoke-2-picker.png');

    // ② 搜索拼音首字母 lxpe
    await js('(function(){ var i = document.getElementById("pickerSearch"); i.value = "lxpe"; i.dispatchEvent(new Event("input")); return true; })()');
    await wait(300);
    results.search = await js('(function(){ var items = Array.prototype.slice.call(document.querySelectorAll(".plist-item")); return { count: items.length, first: items[0] ? items[0].querySelector(".plist-name b").textContent : null }; })()');
    results.a3 = await capture('smoke-3-search.png');

    // ③ 选中第一个结果
    await js('document.querySelector(".plist-item").click()');
    await wait(400);
    results.afterPick = await js('({ slot: (document.querySelector(".picker-btn[data-slot=atk1] .name")||{}).textContent, skill: (document.querySelector(".skill-select[data-slot=atk1]")||{}).value, pickerHidden: document.getElementById("picker").classList.contains("is-hidden"), cells: Array.prototype.slice.call(document.querySelectorAll(".cell-main")).map(function(e){return e.textContent;}) })');
    results.a4 = await capture('smoke-4-after-pick.png');
    results.noteRightAfterPick = await js('(document.getElementById("gridNote")||{}).textContent||""');
    results.pickDebug = await js('({ lastFullMs: Math.round(window.__xyDebug.lastFullMs||0), gridMs: Number((window.__xyDebug.gridMs||0).toFixed(2)), values: window.__xyDebug.values })');
    results.manualRecompute = await js('(function(){ var t = performance.now(); window.__xyDebug.recompute(); return Number((performance.now()-t).toFixed(1)); })()');
    results.afterManual = await js('({ lastFullMs: Math.round(window.__xyDebug.lastFullMs||0), gridMs: Number((window.__xyDebug.gridMs||0).toFixed(2)) })');

    // ④ 展开明细（分组清单）
    await js('document.querySelector(".cell").click()');
    await wait(400);
    results.detail = await js('({ open: !document.getElementById("detail").classList.contains("is-hidden"), rows: document.querySelectorAll(".crow").length, groups: document.querySelectorAll(".group").length, sum: (document.getElementById("detailSum")||{}).textContent || "", foot: (document.getElementById("detailFoot")||{}).textContent||"" })');
    results.a5 = await capture('smoke-5-detail.png');

    // ⑤ 矩阵视图
    await js('document.querySelector(".tab[data-view=matrix]").click()');
    await wait(350);
    results.matrix = await js('({ rows: document.querySelectorAll(".mrow").length, cells: document.querySelectorAll(".mcell").length, heads: Array.prototype.slice.call(document.querySelectorAll(".mhead-h")).map(function(e){ return e.textContent; }), rowHeads: Array.prototype.slice.call(document.querySelectorAll(".mrow .mrh")).map(function(e){ return e.textContent; }) })');
    results.a6 = await capture('smoke-6-matrix.png');

    // ⑤b 配置下拉 4+4：短标签 + 完整 title
    await js('document.querySelector(".tab[data-view=groups]").click()');
    await wait(200);
    await js('document.getElementById("detailClose").click()');
    await wait(200);
    results.cfgDropdowns = {
      natureOptions: await js('Array.prototype.slice.call(document.querySelectorAll(".cfg-nature[data-slot=atk1] option")).map(function(o){ return o.textContent; })'),
      ivsOptions: await js('Array.prototype.slice.call(document.querySelectorAll(".cfg-ivs[data-slot=atk1] option")).map(function(o){ return o.textContent; })'),
      defaultValues: await js('({ nature: document.querySelector(".cfg-nature[data-slot=atk1]").value, ivs: document.querySelector(".cfg-ivs[data-slot=atk1]").value, hint: (document.querySelector(".cfg-hint[data-slot=atk1]")||{}).textContent })')
    };

    // Z3 + J1：显示「物攻↑」，完整「物攻↑ 生命↓」只在 title 里
    await js('(function(){ var n = document.querySelector(".cfg-nature[data-slot=atk1]"); n.value = "atk>hp"; n.dispatchEvent(new Event("change")); var v = document.querySelector(".cfg-ivs[data-slot=atk1]"); v.value = "hp+atk+spd"; v.dispatchEvent(new Event("change")); return true; })()');
    await wait(800);
    results.label = {
      hint: await js('(document.querySelector(".cfg-hint[data-slot=atk1]")||{}).textContent || ""'),
      hintTitle: await js('(document.querySelector(".cfg-hint[data-slot=atk1]")||{}).title || ""'),
      cells: await js('Array.prototype.slice.call(document.querySelectorAll(".grid-row[data-row=atk1] .cell-main")).map(function(e){ return e.textContent; })'),
      badges: await js('document.querySelectorAll(".grid-row[data-row=atk1] .cell-manual").length'),
      rowCfg: await js('(document.querySelector(".grid-row[data-row=atk1] .row-cfg")||{}).textContent || ""'),
      rowCfgTitle: await js('(document.querySelector(".grid-row[data-row=atk1] .row-cfg")||{}).title || ""'),
      cellPct: await js('(document.querySelector(".grid-row[data-row=atk1] .cell-pct")||{}).textContent || ""'),
      cellTitle: await js('(document.querySelector(".grid-row[data-row=atk1] .cell")||{}).title || ""')
    };

    await js('document.querySelector(".grid-row[data-row=atk1] .cell").click()');
    await wait(500);
    results.label.detail = {
      sum: await js('document.getElementById("detailSum").textContent'),
      currentRows: await js('document.querySelectorAll(".crow.is-sel").length'),
      currentTag: await js('(document.querySelector(".cur-tag")||{}).textContent || ""'),
      selectedRows: await js('document.querySelectorAll(".crow.is-sel").length'),
      manualRows: await js('document.querySelectorAll(".crow.is-manual").length'),
      rows: await js('document.querySelectorAll(".crow").length'),
      rowKey: await js('(document.querySelector(".crow.is-sel .ck")||{}).textContent || ""'),
      rowNat: await js('(document.querySelector(".crow.is-sel .cnat")||{}).textContent || ""'),
      rowNatTitle: await js('(document.querySelector(".crow.is-sel .cnat")||{}).title || ""')
    };
    await js('document.querySelector(".tab[data-view=matrix]").click()');
    await wait(400);
    results.label.matrix = {
      rowHeads: await js('Array.prototype.slice.call(document.querySelectorAll(".mrow .mrh")).map(function(e){ return e.textContent; })'),
      rowTitles: await js('Array.prototype.slice.call(document.querySelectorAll(".mrow .mrh")).map(function(e){ return e.title; })'),
      legend: await js('(document.querySelector(".detail-foot")||{}).textContent || ""')
    };
    results.a19 = await capture('smoke-19-matrix-labels.png');

    // Z1：仍然要显示「物攻↑魔攻↓」
    await js('document.querySelector(".tab[data-view=groups]").click()');
    await wait(300);
    await js('(function(){ var n = document.querySelector(".cfg-nature[data-slot=atk1]"); n.value = "atk>matk"; n.dispatchEvent(new Event("change")); return true; })()');
    await wait(700);
    results.label.z1 = {
      hint: await js('(document.querySelector(".cfg-hint[data-slot=atk1]")||{}).textContent || ""'),
      selectedOption: await js('(function(){ var o = document.querySelector(".cfg-nature[data-slot=atk1] option:checked"); return o ? o.textContent : ""; })()'),
      cellPct: await js('(document.querySelector(".grid-row[data-row=atk1] .cell-pct")||{}).textContent || ""'),
      rowCfg: await js('(document.querySelector(".grid-row[data-row=atk1] .row-cfg")||{}).textContent || ""')
    };

    // 复位
    await js('document.getElementById("detailClose").click()');
    await wait(200);
    await js('(function(){ var D = window.RocoDomain; var sp = D.getSprite(window.__xyDebug ? document.querySelector(".slot-card[data-slot=atk1] .picker-btn .name").textContent : ""); var n = document.querySelector(".cfg-nature[data-slot=atk1]"); var v = document.querySelector(".cfg-ivs[data-slot=atk1]"); var cfg = window.__xyDebug.configs.atk1; n.value = "atk>matk"; n.dispatchEvent(new Event("change")); v.value = "hp+atk+spd"; v.dispatchEvent(new Event("change")); return true; })()');
    await wait(600);
    results.label.afterReset = {
      badges: await js('document.querySelectorAll(".cell-manual").length'),
      hint: await js('(document.querySelector(".cfg-hint[data-slot=atk1]")||{}).textContent || ""')
    };

    // ⑥ 关明细 → 靶子选择器
    await js('document.querySelector(".tab[data-view=groups]").click(); document.getElementById("detailClose").click();');
    await wait(200);
    await js('document.querySelector(\'' + SEL_PICKER_DEF + '\').click()');
    await wait(350);
    results.pickerDef = await js('({ visible: !document.getElementById("picker").classList.contains("is-hidden"), items: document.querySelectorAll(".plist-item").length })');
    results.a7 = await capture('smoke-7-def-picker.png');
    await js('document.getElementById("pickerClose").click()');
    await wait(150);
    results.a8 = await capture('smoke-8-final.png');






    // ⑧ 小条（收起 / 展开）——本 bug 的回归用例
    results.collapse = {};
    results.collapse.hotkeyRegistered = globalShortcut.isRegistered('Control+Shift+M');
    results.collapse.heightBefore = win.getBounds().height;

    await js('document.getElementById("btnCollapse").click()');
    await wait(450);
    // 小条态下 btnCollapse 已被收进「⋯」，命中检测改测 ⋯ 按钮本身
    results.collapse.afterCollapse = await js('({ height: 0, bodyClass: document.body.className, btn: document.getElementById("btnCollapse").textContent, mini: (document.getElementById("minibar")||{}).textContent || "", contentDisplay: getComputedStyle(document.getElementById("content")).display, hit: (function(){ var b = document.getElementById("btnMore"); if (!b) return null; var r = b.getBoundingClientRect(); var el = document.elementFromPoint(r.left + r.width/2, r.top + r.height/2); return el ? (el.id || el.className || el.tagName) : null; })() })');
    results.collapse.afterCollapse.realHeight = win.getBounds().height;

    // 小条布局：三攻方是否都在、搜索框收窄、「⋯」是否收纳了其它按钮、状态圆点
    results.collapse.miniLayout = await js('(function(){'
      + ' var w = function(s){ var e=document.querySelector(s); return e ? Math.round(e.getBoundingClientRect().width) : null; };'
      + ' var disp = function(s){ var e=document.querySelector(s); return e ? getComputedStyle(e).display : null; };'
      + ' var tb = document.getElementById("titlebar");'
      + ' return {'
      + '   winW: window.innerWidth,'
      + '   sum: w("#miniSum"), target: w("#miniTarget"), search: w("#miniSearch"), btns: w(".win-btns"),'
      + '   overflow: tb.scrollWidth - tb.clientWidth,'
      + '   dispTip: disp("#btnTip"), dispPass: disp("#btnPass"), dispCollapse: disp("#btnCollapse"), dispClose: disp("#btnClose"), dispMore: disp("#btnMore"),'
      + '   status: (function(){ var e=document.getElementById("miniStatus"); if(!e) return null;'
      + '     var cs=getComputedStyle(e,"::before");'
      + '     return { disp: getComputedStyle(e).display, cls: e.className, aria: e.getAttribute("aria-label"),'
      + '       w: Math.round(e.getBoundingClientRect().width),'
      + '       dotW: cs.width, dotBg: cs.backgroundColor, dotBorder: cs.borderTopColor }; })(),'
      + '   targetName: (document.querySelector("#miniTarget .mt-name")||{}).textContent,'
      + '   targetClipped: (function(){ var n=document.querySelector("#miniTarget .mt-name"); return n ? n.scrollWidth > n.clientWidth + 1 : null; })(),'
      + '   items: Array.prototype.map.call(document.querySelectorAll(".mini-item"), function(e){'
      + '     return { t: e.textContent.replace(/\s+/g," ").trim(), w: Math.round(e.getBoundingClientRect().width), clipped: e.scrollWidth > e.clientWidth + 1 }; }),'
      + '   names: Array.prototype.map.call(document.querySelectorAll(".mini-item .mini-name"), function(e){'
      + '     return { t: e.textContent, clipped: e.scrollWidth > e.clientWidth + 1, w: Math.round(e.getBoundingClientRect().width) }; })'
      + ' }; })()');

    // 「⋯」下拉：点开 → 菜单在窗口内、四项齐全、窗口被撑高 → 再点收回
    await js('document.getElementById("btnMore").click()');
    await wait(600);
    results.collapse.moreMenu = await js('(function(){'
      + ' var m = document.getElementById("moreMenu"); var b = m.getBoundingClientRect();'
      + ' return { visible: !m.classList.contains("is-hidden"), w: Math.round(b.width), h: Math.round(b.height),'
      + '   insideRight: b.right <= window.innerWidth + 1, insideBottom: b.bottom <= window.innerHeight + 1,'
      + '   items: Array.prototype.map.call(m.querySelectorAll(".more-item .more-txt"), function(e){ return e.textContent.trim(); }) }; })()');
    results.collapse.moreMenuWinH = win.getBounds().height;
    // 关键：撑高后菜单必须完整落在窗口内（46px 时菜单只有一半可见）
    results.collapse.moreMenuFits = await js('(function(){'
      + ' var m = document.getElementById("moreMenu"); var b = m.getBoundingClientRect();'
      + ' return { bottomGap: Math.round(window.innerHeight - b.bottom), rightGap: Math.round(window.innerWidth - b.right), winH: window.innerHeight }; })()');
    results.a14b = await capture('smoke-14b-cold-mini-more-menu.png');
    await js('document.getElementById("btnMore").click()');
    await wait(600);
    results.collapse.moreMenuClosed = await js('(function(){ return { hidden: document.getElementById("moreMenu").classList.contains("is-hidden") }; })()');
    results.collapse.moreMenuClosedWinH = win.getBounds().height;

    // 快捷键面板（原「使用提示」条改造）：点标题栏 ⌘ 应展开、4 行 9 个键帽
    await js('document.getElementById("btnTip").click()');
    await wait(350);
    results.collapse.shortcutPanel = await js('(function(){ var e=document.getElementById("tip"); var b=e.getBoundingClientRect();'
      + ' return { open: !e.classList.contains("is-hidden"), h: Math.round(b.height), rows: e.querySelectorAll(".sc-row").length,'
      + '   kbds: e.querySelectorAll("kbd").length, title: (e.querySelector(".tip-title")||{}).textContent,'
      + '   btnOn: document.getElementById("btnTip").classList.contains("is-on") }; })()');
    results.aTip = await capture('smoke-14c-shortcut-panel.png');
    await js('document.getElementById("tipClose").click()');
    await wait(250);
    results.collapse.shortcutPanelClosed = await js('(function(){ var e=document.getElementById("tip");'
      + ' return { hidden: e.classList.contains("is-hidden"), btnOn: document.getElementById("btnTip").classList.contains("is-on") }; })()');

    // 状态圆点：接管 → 穿透 应改变颜色/文案（小条态下这是唯一的常驻状态指示）
    results.collapse.dotTakeover = await js('(function(){ var e=document.getElementById("miniStatus"); var cs=getComputedStyle(e,"::before");'
      + ' return { cls: e.className, aria: e.getAttribute("aria-label"), w: Math.round(e.getBoundingClientRect().width), dotBg: cs.backgroundColor, dotBorder: cs.borderTopColor }; })()');
    await js('window.api.setPassthrough(true)');
    await wait(400);
    results.collapse.dotPassthrough = await js('(function(){ var e=document.getElementById("miniStatus"); var cs=getComputedStyle(e,"::before");'
      + ' return { cls: e.className, aria: e.getAttribute("aria-label"), w: Math.round(e.getBoundingClientRect().width), dotBg: cs.backgroundColor, dotBorder: cs.borderTopColor }; })()');
    await js('window.api.setPassthrough(false)');
    await wait(300);
    results.a9 = await capture('smoke-9-collapsed.png');

    // 小条态展开：按钮已收进 ⋯，走菜单项 data-act="expand"
    await js('document.getElementById("btnMore").click()');
    await wait(400);
    await js('document.querySelector(\'#moreMenu .more-item[data-act="expand"]\').click()');
    await wait(500);
    results.collapse.afterExpand = await js('({ bodyClass: document.body.className, btn: document.getElementById("btnCollapse").textContent, cells: document.querySelectorAll(".cell").length, values: Array.prototype.slice.call(document.querySelectorAll(".cell-main")).map(function(e){return e.textContent;}), contentDisplay: getComputedStyle(document.getElementById("content")).display })');
    results.collapse.afterExpand.realHeight = win.getBounds().height;
    results.a10 = await capture('smoke-10-expanded.png');

    // 快速连点 3 次（主进程翻转 → 奇数次应为「收起」，不会错乱）
    await js('(function(){ var b = document.getElementById("btnCollapse"); b.click(); b.click(); b.click(); return true; })()');
    await wait(600);
    results.collapse.rapid3 = {
      realHeight: win.getBounds().height,
      state: await js('({ bodyClass: document.body.className, btn: document.getElementById("btnCollapse").textContent })')
    };

    // 再点一次 → 必须能回到展开
    await js('document.getElementById("btnCollapse").click()');
    await wait(500);
    results.collapse.afterRapidFix = {
      realHeight: win.getBounds().height,
      state: await js('({ bodyClass: document.body.className, btn: document.getElementById("btnCollapse").textContent, cells: document.querySelectorAll(".cell").length })')
    };

    // 快捷键走的同一条链路（api.toggleCollapse → 主进程 setCollapsed(!collapsed)）
    await js('window.api.toggleCollapse()');
    await wait(400);
    results.collapse.viaIpcCollapse = win.getBounds().height;
    await js('window.api.toggleCollapse()');
    await wait(400);
    results.collapse.viaIpcExpand = win.getBounds().height;

    // 展开后明细与选择器仍然可用
    await js('document.querySelector(".cell").click()');
    await wait(350);
    results.collapse.detailAfterExpand = await js('({ open: !document.getElementById("detail").classList.contains("is-hidden"), rows: document.querySelectorAll(".crow").length })');
    await js('document.getElementById("detailClose").click()');
    await wait(150);
    await js('document.querySelector(".picker-btn[data-slot=atk2]").click()');
    await wait(300);
    results.collapse.pickerAfterExpand = await js('({ visible: !document.getElementById("picker").classList.contains("is-hidden"), items: document.querySelectorAll(".plist-item").length })');
    await js('document.getElementById("pickerClose").click()');
    await wait(150);


    // ⑨ 真机序列 A：接管态 收起 → 展开，穿透状态必须不变（保持"接管中"）
    await js('window.api.setPassthrough(false)');
    await wait(300);
    results.leadSeq = { afterTakeover: await js('({ btn: document.getElementById("btnPass").textContent, on: document.getElementById("btnPass").classList.contains("is-on") })') };
    await js('document.getElementById("btnCollapse").click()');
    await wait(450);
    results.leadSeq.afterCollapse = await js('({ btnPass: document.getElementById("btnPass").textContent, btnCollapse: document.getElementById("btnCollapse").textContent, height: 0 })');
    results.leadSeq.afterCollapse.realHeight = win.getBounds().height;
    await js('document.getElementById("btnCollapse").click()');
    await wait(450);
    results.leadSeq.afterExpand = await js('({ btnPass: document.getElementById("btnPass").textContent, on: document.getElementById("btnPass").classList.contains("is-on"), btnCollapse: document.getElementById("btnCollapse").textContent, cells: document.querySelectorAll(".cell").length })');
    results.leadSeq.afterExpand.realHeight = win.getBounds().height;

    // ⑩ 真机序列 B：穿透态 → Ctrl+Shift+M 收起 → 应自动接管、按钮可点 → 一次点开成功
    await js('window.api.setPassthrough(true)');
    await wait(300);
    results.leadSeq.passthroughBefore = await js('({ btnPass: document.getElementById("btnPass").textContent, on: document.getElementById("btnPass").classList.contains("is-on") })');
    await js('window.api.toggleCollapse()'); // 与全局快捷键 Ctrl+Shift+M 完全同一条链路
    await wait(500);
    // 小条态下 btnPass / btnCollapse 已收进「⋯」，命中检测改测 ⋯
    results.leadSeq.fromPassthroughCollapse = await js('({ btnPass: document.getElementById("btnPass").textContent, btnCollapse: document.getElementById("btnCollapse").textContent, bodyClass: document.body.className, hit: (function(){ var b = document.getElementById("btnMore"); if (!b) return null; var r = b.getBoundingClientRect(); var el = document.elementFromPoint(r.left + r.width/2, r.top + r.height/2); return el ? (el.id || el.className || el.tagName) : null; })() })');
    results.leadSeq.fromPassthroughCollapse.realHeight = win.getBounds().height;
    results.a11 = await capture('smoke-11-collapsed-from-passthrough.png');
    // 小条态展开：走「⋯ → 展开面板」
    await js('document.getElementById("btnMore").click()');
    await wait(400);
    await js('document.querySelector(\'#moreMenu .more-item[data-act="expand"]\').click()');
    await wait(500);
    results.leadSeq.fromPassthroughExpand = await js('({ btnPass: document.getElementById("btnPass").textContent, btnCollapse: document.getElementById("btnCollapse").textContent, cells: document.querySelectorAll(".cell").length })');
    results.leadSeq.fromPassthroughExpand.realHeight = win.getBounds().height;

    // 展开后立刻点一个格子：能进明细 = 窗格真的可点（不是穿透态）
    await js('document.querySelector(".cell").click()');
    await wait(400);
    results.leadSeq.clickCellAfterExpand = await js('({ detailOpen: !document.getElementById("detail").classList.contains("is-hidden"), rows: document.querySelectorAll(".crow").length, btnPass: document.getElementById("btnPass").textContent })');
    await js('document.getElementById("detailClose").click()');
    await wait(200);


    // ⑪ 小条轻量菜单 + 内联搜索
    await js('window.api.setCollapsed(true)');
    await wait(450);
    results.mini = {
      height: win.getBounds().height,
      brandDisplay: await js('getComputedStyle(document.querySelector(".brand")).display'),
      hasTarget: await js('!!document.getElementById("miniTarget")'),
      hasSearch: await js('!!document.getElementById("miniSearch")'),
      targetText: await js('(document.querySelector("#miniTarget .mt-name")||{}).textContent || ""')
    };
    results.a12 = await capture('smoke-12-minibar.png');

    // a) 点靶子按钮 → 约 300px + 小菜单（不是整窗 800）
    await js('document.getElementById("miniTarget").click()');
    await wait(700);
    results.mini.menuOpen = {
      windowHeight: win.getBounds().height,
      menuHeight: await js('Math.round(document.getElementById("miniMenu").getBoundingClientRect().height)'),
      chips6col: await js('getComputedStyle(document.querySelector(".mm-types")).gridTemplateColumns.split(" ").length'),
      chipHeight: await js('Math.round(document.querySelector(".mm-type").getBoundingClientRect().height)'),
      menuBottomGap: await js('(function(){ var m = document.getElementById("miniMenu"); return Math.round(window.innerHeight - (m.getBoundingClientRect().bottom)); })()'),
      menuVisible: await js('!document.getElementById("miniMenu").classList.contains("is-hidden")'),
      chips: await js('document.querySelectorAll(".mm-type").length'),
      title: await js('document.getElementById("mmTitle").textContent')
    };
    results.a13 = await capture('smoke-13-mini-menu.png');

    // b) 点「恶」系 → 二级列表 → 选「恶魔狼」→ 收回 46px
    await js('(function(){ var b = Array.prototype.slice.call(document.querySelectorAll(".mm-type")).filter(function(e){ return e.getAttribute("data-type") === "恶"; })[0]; b.click(); return true; })()');
    await wait(400);
    results.mini.afterType = {
      windowHeight: win.getBounds().height,
      menuHeight: await js('Math.round(document.getElementById("miniMenu").getBoundingClientRect().height)'),
      itemHeight: await js('Math.round((document.querySelector(".mm-item")||{getBoundingClientRect:function(){return{height:0}}}).getBoundingClientRect().height)'),
      bodyScrollable: await js('(function(){ var b = document.getElementById("mmBody"); return b.scrollHeight > b.clientHeight + 1; })()'),
      items: await js('document.querySelectorAll(".mm-item").length'),
      title: await js('document.getElementById("mmTitle").textContent'),
      backVisible: await js('!document.getElementById("mmBack").classList.contains("is-hidden")')
    };
    await js('(function(){ var it = Array.prototype.slice.call(document.querySelectorAll(".mm-item")).filter(function(e){ return e.textContent.indexOf("恶魔狼") >= 0; })[0]; it.click(); return true; })()');
    await wait(800);
    results.mini.afterMenuPick = {
      height: win.getBounds().height,
      targetText: await js('(document.querySelector("#miniTarget .mt-name")||{}).textContent || ""'),
      minibarText: await js('(document.getElementById("miniSum")||{}).textContent || ""'),
      searchValue: await js('document.getElementById("miniSearch").value')
    };

    // c) 内联搜索 eml → Enter
    await js('document.getElementById("miniSearch").focus()');
    await wait(500);
    await js('(function(){ var i = document.getElementById("miniSearch"); i.value = "eml"; i.dispatchEvent(new Event("input")); return true; })()');
    await wait(400);
    results.mini.searchState = {
      windowHeight: win.getBounds().height,
      items: await js('document.querySelectorAll(".mm-item").length'),
      first: await js('(document.querySelector(".mm-item .mm-name")||{}).textContent || ""')
    };
    await js('(function(){ var i = document.getElementById("miniSearch"); i.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true })); return true; })()');
    await wait(800);
    results.mini.afterEnter = {
      height: win.getBounds().height,
      targetText: await js('(document.querySelector("#miniTarget .mt-name")||{}).textContent || ""'),
      searchValue: await js('document.getElementById("miniSearch").value')
    };

    // d) 搜索 beigusi → Enter → 小条应显示「全不可」
    await js('document.getElementById("miniSearch").focus()');
    await wait(400);
    await js('(function(){ var i = document.getElementById("miniSearch"); i.value = "beigusi"; i.dispatchEvent(new Event("input")); return true; })()');
    await wait(400);
    await js('(function(){ var i = document.getElementById("miniSearch"); i.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true })); return true; })()');
    await wait(900);
    results.mini.afterBeigusi = {
      height: win.getBounds().height,
      targetText: await js('(document.querySelector("#miniTarget .mt-name")||{}).textContent || ""'),
      minibarText: await js('(document.getElementById("miniSum")||{}).textContent || ""'),
      pass: await js('document.getElementById("btnPass").textContent')
    };

    // e1) Esc 关闭菜单
    await js('document.getElementById("miniTarget").click()');
    await wait(600);
    const hEscMenu = win.getBounds().height;
    await js('(function(){ var i = document.getElementById("miniSearch"); i.focus(); i.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })); return true; })()');
    await wait(700);
    results.mini.menuEsc = {
      expanded: hEscMenu,
      after: win.getBounds().height,
      menuHidden: await js('document.getElementById("miniMenu").classList.contains("is-hidden")'),
      pass: await js('document.getElementById("btnPass").textContent')
    };

    // e2) ✕ 关闭
    await js('document.getElementById("miniTarget").click()');
    await wait(600);
    const hX = win.getBounds().height;
    await js('document.getElementById("mmClose").click()');
    await wait(700);
    results.mini.menuCloseBtn = { expanded: hX, after: win.getBounds().height };

    // e3) 点菜单外部关闭
    await js('document.getElementById("miniTarget").click()');
    await wait(600);
    const hOut = win.getBounds().height;
    await js('document.getElementById("content").dispatchEvent(new MouseEvent("mousedown", { bubbles: true }))');
    await wait(700);
    results.mini.menuClickOutside = { expanded: hOut, after: win.getBounds().height };


    const openMiniForTest = async () => {
      for (let i = 0; i < 3; i++) {
        await js('document.getElementById("miniTarget").click()');
        await wait(700);
        if (win.getBounds().height > 100) return win.getBounds().height;
      }
      return win.getBounds().height;
    };
    // ⑫ P2：点窗口外（blur）关闭 / 窗口内空白关闭 / ✕ 热区
    results.p2 = {};
    // 先强制回到小条态，保证起点确定
    await js('window.api.setCollapsed(true)');
    await wait(600);
    // a) 窗口失焦（= 点了桌面或别的窗口）
    const beforeBlur = await openMiniForTest();
    win.focus();
    await wait(200);
    const focusedBeforeBlur = win.isFocused();
    win.blur();
    await wait(300);
    // 某些自动化环境拿不到真实焦点，blur() 不会触发事件；这里直接触发同一个 handler 验证逻辑
    if (!focusedBeforeBlur || win.getBounds().height !== 46) win.emit('blur');
    await wait(900);
    results.p2.blur = {
      focusedBeforeBlur: focusedBeforeBlur,
      before: beforeBlur,
      after: win.getBounds().height,
      menuHidden: await js('document.getElementById("miniMenu").classList.contains("is-hidden")'),
      pass: await js('document.getElementById("btnPass").textContent')
    };

    // b) 窗口内空白（标题栏摘要区）
    const beforeInside = await openMiniForTest();
    const dbgBefore = await js('({ open: window.__xyDebug.miniOpen, collapsed: window.__xyDebug && document.body.className })');
    await js('window.__dbgOpenSeq = ""');
    await js('document.getElementById("miniSum").dispatchEvent(new MouseEvent("mousedown", { bubbles: true }))');
    await wait(800);
    results.p2.insideBlank = {
      before: beforeInside,
      after: win.getBounds().height,
      dbgBefore: dbgBefore,
      dbgAfter: await js('({ open: window.__xyDebug.miniOpen, outside: window.__dbgOutside || 0, close: window.__dbgClose || 0, key: window.__dbgKey || 0, seq: window.__dbgOpenSeq || "" })'),
      menuHidden: await js('document.getElementById("miniMenu").classList.contains("is-hidden")')
    };

    // c) ✕ 热区（应 ≥24×24）与点击关闭
    const beforeX = await openMiniForTest();
    results.p2.closeBtnHit = await js('(function(){ var b = document.getElementById("mmClose"); var r = b.getBoundingClientRect(); var el = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return { w: Math.round(r.width), h: Math.round(r.height), hit: el ? (el.id || el.className || el.tagName) : null }; })()');
    await js('document.getElementById("mmClose").click()');
    await wait(800);
    results.p2.closeBtn = { before: beforeX, after: win.getBounds().height };

    // d) 关完之后能立刻再开，且标签仍是接管中
    await openMiniForTest();
    results.p2.reopen = {
      height: win.getBounds().height,
      menuVisible: await js('!document.getElementById("miniMenu").classList.contains("is-hidden")'),
      chips: await js('document.querySelectorAll(".mm-type").length'),
      pass: await js('document.getElementById("btnPass").textContent')
    };
    const escDbgBefore = await js('({ open: window.__xyDebug.miniOpen, active: document.activeElement && document.activeElement.id })');
    await js('(function(){ var i = document.getElementById("miniSearch"); i.focus(); i.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })); return true; })()');
    await wait(700);
    results.p2.afterEsc = { height: win.getBounds().height, pass: await js('document.getElementById("btnPass").textContent'), dbgBefore: escDbgBefore, dbgAfter: await js('({ open: window.__xyDebug.miniOpen })') };

    // g) 贴屏幕底部时，菜单应向上展开、不出屏
    const waArea = screen.getDisplayMatching(win.getBounds()).workArea;
    win.setBounds({ x: waArea.x + 40, y: waArea.y + waArea.height - 46, width: 620, height: 46 });
    await wait(400);
    await js('document.getElementById("miniTarget").click()');
    await wait(800);
    const bottomBounds = win.getBounds();
    results.mini.bottomExpand = {
      y: bottomBounds.y,
      height: bottomBounds.height,
      bottomEdge: bottomBounds.y + bottomBounds.height,
      workBottom: waArea.y + waArea.height,
      menuVisible: await js('!document.getElementById("miniMenu").classList.contains("is-hidden")')
    };
    await js('document.getElementById("mmClose").click()');
    await wait(700);
    results.mini.bottomRestore = { y: win.getBounds().y, height: win.getBounds().height };

    // f) 展开态：靶子卡片仍用原来的全屏 picker
    win.setBounds({ x: waArea.x + waArea.width - 660, y: waArea.y + 40, width: 620, height: 800 });
    await js('window.api.setCollapsed(false)');
    await wait(600);
    await js('document.querySelector(".picker-btn[data-slot=def]").click()');
    await wait(500);
    results.mini.expandedPicker = {
      height: win.getBounds().height,
      pickerVisible: await js('!document.getElementById("picker").classList.contains("is-hidden")'),
      miniMenuHidden: await js('document.getElementById("miniMenu").classList.contains("is-hidden")'),
      pickerTitle: await js('document.getElementById("pickerTitle").textContent')
    };
    results.a14 = await capture('smoke-14-expanded-picker.png');
    await js('document.getElementById("pickerClose").click()');
    await wait(300);
    results.mini.expandedState = {
      height: win.getBounds().height,
      brandDisplay: await js('getComputedStyle(document.querySelector(".brand")).display'),
      brandText: await js('(document.querySelector(".brand-name")||{}).textContent || ""'),
      cards: await js('document.querySelectorAll(".slot-card").length'),
      cells: await js('document.querySelectorAll(".cell").length')
    };

    // ⑬ 菜单态 × 折叠态 时序（统一关闭路径）
    results.p3 = {};
    await js('window.api.setCollapsed(true)');
    await wait(600);
    // a) 菜单开着时按 Ctrl+Shift+M（= api.toggleCollapse）→ 必回 46，不翻转成 800
    const beforeHotkey = await openMiniForTest();
    await js('window.api.toggleCollapse()');
    await wait(800);
    results.p3.hotkeyWhileMenuOpen = {
      before: beforeHotkey,
      after: win.getBounds().height,
      bodyClass: await js('document.body.className'),
      pass: await js('document.getElementById("btnPass").textContent'),
      menuHidden: await js('document.getElementById("miniMenu").classList.contains("is-hidden")')
    };

    // b) 菜单开着时切穿透（Alt+X / Ctrl+Alt+T 同链路）→ 先关菜单回 46，再按目标状态
    const beforePassChange = await openMiniForTest();
    await js('window.api.setPassthrough(true)');
    await wait(800);
    results.p3.passthroughWhileMenuOpen = {
      before: beforePassChange,
      after: win.getBounds().height,
      pass: await js('document.getElementById("btnPass").textContent'),
      menuHidden: await js('document.getElementById("miniMenu").classList.contains("is-hidden")')
    };
    await js('window.api.setPassthrough(false)');
    await wait(500);
    results.p3.backToTakeover = { height: win.getBounds().height, pass: await js('document.getElementById("btnPass").textContent') };

    // c) 关闭后能立刻再开菜单
    await openMiniForTest();
    results.p3.reopenAfterHotkey = {
      height: win.getBounds().height,
      menuVisible: await js('!document.getElementById("miniMenu").classList.contains("is-hidden")'),
      pass: await js('document.getElementById("btnPass").textContent')
    };
    await js('document.getElementById("mmClose").click()');
    await wait(700);

    // d0) 去抖：菜单开着时连发两次 toggle（模拟快捷键重复投递）→ 仍应稳定在 46
    await openMiniForTest();
    await js('(function(){ window.api.toggleCollapse(); window.api.toggleCollapse(); return true; })()');
    await wait(900);
    results.p3.doubleToggleWhileMenu = {
      height: win.getBounds().height,
      menuHidden: await js('document.getElementById("miniMenu").classList.contains("is-hidden")'),
      pass: await js('document.getElementById("btnPass").textContent')
    };
    // 隔开 300ms 后再按一次 → 正常展开（去抖不影响真实连按）
    await wait(400);
    await js('window.api.toggleCollapse()');
    await wait(700);
    results.p3.afterDebounceWindow = { height: win.getBounds().height };
    await js('window.api.setCollapsed(true)');
    await wait(500);

    // d) 展开高度不被菜单的 300px 污染：800 → 收起 → 菜单 → 失焦关闭 → 再展开应回 800
    await js('window.api.setCollapsed(false)');
    await wait(700);
    const expandedH0 = win.getBounds().height;
    await js('window.api.setCollapsed(true)');
    await wait(600);
    const menuH = await openMiniForTest();
    win.focus();
    await wait(150);
    win.blur();
    await wait(800);
    const afterBlurH = win.getBounds().height;
    await js('window.api.toggleCollapse()');
    await wait(800);
    results.p3.expandedHeightIntact = {
      expandedH0: expandedH0,
      menuH: menuH,
      afterBlurH: afterBlurH,
      reExpandH: win.getBounds().height
    };


    // ⑭ 小条摘要显示真实精灵名（长名截断、数字完整、不撑破布局）
    results.p4 = {};
    await js('window.api.setCollapsed(false)');
    await wait(600);
    await js('document.querySelector(".picker-btn[data-slot=atk1]").click()');
    await wait(500);
    await js('(function(){ var i = document.getElementById("pickerSearch"); i.value = "鸭吉吉国王"; i.dispatchEvent(new Event("input")); return true; })()');
    await wait(400);
    await js('document.querySelector(".plist-item").click()');
    await wait(600);
    await js('window.api.setCollapsed(true)');
    await wait(800);
    results.p4.longName = await js('(function(){ var n = document.querySelector(".mini-sum .mini-name"); var sum = document.getElementById("miniSum"); var bar = document.getElementById("minibar"); var r = n.getBoundingClientRect(); return { text: n.textContent, title: n.title, width: Math.round(r.width), truncated: n.scrollWidth > n.clientWidth + 1, digits: Array.prototype.slice.call(sum.querySelectorAll("i")).map(function(e){ return e.textContent; }), sumOverflow: sum.scrollWidth - sum.clientWidth, barOverflow: bar.scrollWidth - bar.clientWidth }; })()');
    results.p4.longName.sumText = await js('(document.getElementById("miniSum")||{}).textContent || ""');
    results.a16 = await capture('smoke-16-minibar-names.png');

    // 换回短名并测宽窗口
    await js('window.api.setCollapsed(false)');
    await wait(500);
    await js('document.querySelector(".picker-btn[data-slot=atk1]").click()');
    await wait(500);
    await js('(function(){ var i = document.getElementById("pickerSearch"); i.value = "暮星辰"; i.dispatchEvent(new Event("input")); return true; })()');
    await wait(400);
    await js('document.querySelector(".plist-item").click()');
    await wait(600);
    win.setBounds({ x: 100, y: 80, width: 1400, height: 800 });
    await wait(500);
    await js('window.api.setCollapsed(true)');
    await wait(800);
    results.p4.shortName620 = await js('(function(){ var n = document.querySelector(".mini-sum .mini-name"); var bar = document.getElementById("minibar"); return { text: n.textContent, nameWidth: Math.round(n.getBoundingClientRect().width), barOverflow: bar.scrollWidth - bar.clientWidth, sumText: document.getElementById("miniSum").textContent, searchWidth: Math.round(document.getElementById("miniSearch").getBoundingClientRect().width) }; })()');
    results.a17 = await capture('smoke-17-minibar-wide.png');
    await js('window.api.setCollapsed(false)');
    await wait(400);
    win.setBounds({ x: 100, y: 80, width: 620, height: 800 });
    await wait(400);
    results.p4.afterReset = { height: win.getBounds().height, width: win.getBounds().width };

    // 默认组合（尖嘴狐仙）下的最终样子，供验收对照
    await js('window.api.setCollapsed(true)');
    await wait(600);
    await js('document.getElementById("miniTarget").click()');
    await wait(800);
    await js('(function(){ var i = document.getElementById("miniSearch"); i.focus(); i.value = "尖嘴狐仙"; i.dispatchEvent(new Event("input")); return true; })()');
    await wait(450);
    await js('(function(){ var i = document.getElementById("miniSearch"); i.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true })); return true; })()');
    await wait(900);
    results.p4.finalState = {
      height: win.getBounds().height,
      sumText: await js('(document.getElementById("miniSum")||{}).textContent || ""'),
      target: await js('(document.querySelector("#miniTarget .mt-name")||{}).textContent || ""'),
      barOverflow: await js('(function(){ var b = document.getElementById("minibar"); return b.scrollWidth - b.clientWidth; })()')
    };
    results.a18 = await capture('smoke-18-minibar-default.png');


    // ⑮ 攻方加成：按钮步进 / 手填 / 边界 / 隔离 / 小条标记
    results.mods = {};
    await js('window.api.setCollapsed(false)');
    await wait(500);
    // 复位两个加成到 0：自检不能依赖上一次运行残留的 state.json
    await js('(function(){'
      + ' var pairs = [["atk1","atkPct"],["atk1","powerAdd"],["atk2","atkPct"],["atk2","powerAdd"]];'
      + ' pairs.forEach(function(p){'
      + '   var i = document.querySelector(".mod-input[data-slot=" + p[0] + "][data-mod=" + p[1] + "]");'
      + '   if (i) { i.value = "0"; i.dispatchEvent(new Event("change")); }'
      + ' });'
      + ' return true; })()');
    await wait(600);
    results.mods.baseline = await js('Array.prototype.slice.call(document.querySelectorAll(".cell-main")).map(function(e){ return e.textContent; })');

    // 威力加成是「数值」加成：点一次 + 应恰好 +20（不是 +20%），且控件不再带 % 单位
    const powerBase = await js('({ values: window.__xyDebug.values, pct: Array.prototype.slice.call(document.querySelectorAll(".cell-pct")).map(function(e){ return e.textContent; }) })');
    await js('(function(){ var b = document.querySelector(".mod-btn[data-slot=atk1][data-mod=powerAdd][data-dir=\'1\']"); b.click(); return true; })()');
    await wait(600);
    results.mods.powerAddStep = await js('(function(){'
      + ' var i = document.querySelector(".mod-input[data-slot=atk1][data-mod=powerAdd]");'
      + ' var item = i ? i.closest(".mod-item") : null;'
      + ' var hintEl = document.querySelector(".cfg-hint[data-slot=atk1]");'
      + ' return {'
      + '   value: i ? i.value : null,'
      + '   domKey: (item && item.querySelector(".mod-input")) ? item.querySelector(".mod-input").getAttribute("data-mod") : null,'
      + '   hasPercentUnit: item ? !!item.querySelector(".mod-unit") : null,'
      + '   hint: hintEl ? hintEl.textContent : null,'
      + '   cells: Array.prototype.slice.call(document.querySelectorAll(".cell-main")).map(function(e){ return e.textContent; })'
      + ' }; })()');
    // 层数是整数刻度，+20 威力（默认技能威力 200，仅 +10%）常常跨不了层；
    // 真正该断言的是「伤害确实变了」→ 比较 0 层伤害占比
    results.mods.powerAddPctChanged = JSON.stringify(powerBase.pct) !== JSON.stringify(await js('Array.prototype.slice.call(document.querySelectorAll(".cell-pct")).map(function(e){ return e.textContent; })'));
    results.mods.powerAddLayersSame = JSON.stringify(powerBase.values) === JSON.stringify(await js('window.__xyDebug.values'));
    // 再点一次 → 40，确认是叠加而不是取整
    await js('(function(){ var b = document.querySelector(".mod-btn[data-slot=atk1][data-mod=powerAdd][data-dir=\'1\']"); b.click(); return true; })()');
    await wait(500);
    results.mods.powerAddStep2 = await js('document.querySelector(".mod-input[data-slot=atk1][data-mod=powerAdd]").value');
    // 加满到 +100 威力（威力 200 → 300，+50%），层数应当明显下降
    await js('(function(){ var i = document.querySelector(".mod-input[data-slot=atk1][data-mod=powerAdd]"); i.value = "100"; i.dispatchEvent(new Event("change")); return true; })()');
    await wait(600);
    results.mods.powerAdd100 = {
      cells: await js('Array.prototype.slice.call(document.querySelectorAll(".cell-main")).map(function(e){ return e.textContent; })'),
      pct: await js('Array.prototype.slice.call(document.querySelectorAll(".cell-pct")).map(function(e){ return e.textContent; })'),
      hint: await js('(document.querySelector(".cfg-hint[data-slot=atk1]")||{}).textContent || ""')
    };
    // 层数应当真的下降（威力 200 → 300）
    results.mods.powerAdd100Dropped = (function(a, b){ return Array.isArray(a) && Array.isArray(b) && b.length >= 3 && a.slice(0,3).join() !== b.slice(0,3).join(); })(results.mods.baseline, results.mods.powerAdd100.cells);
    // 复位，避免 +100 威力污染后面的明细 / 小条断言
    await js('(function(){ var i = document.querySelector(".mod-input[data-slot=atk1][data-mod=powerAdd]"); if (i) { i.value = "0"; i.dispatchEvent(new Event("change")); } return true; })()');
    await wait(500);
    // 复位
    await js('(function(){ var i = document.querySelector(".mod-input[data-slot=atk1][data-mod=powerAdd]"); if (i) { i.value = "0"; i.dispatchEvent(new Event("change")); } return true; })()');
    await wait(500);

    // 攻① 攻击 +50%
    await js('document.querySelector(".mod-btn[data-slot=atk1][data-mod=atkPct][data-dir=\'1\']").click()');
    await wait(600);
    results.mods.atk1Plus50 = {
      cells: await js('Array.prototype.slice.call(document.querySelectorAll(".cell-main")).map(function(e){ return e.textContent; })'),
      input: await js('document.querySelector(".mod-input[data-slot=atk1][data-mod=atkPct]").value'),
      hint: await js('(document.querySelector(".cfg-hint[data-slot=atk1]")||{}).textContent || ""'),
      atk2Hint: await js('(document.querySelector(".cfg-hint[data-slot=atk2]")||{}).textContent || ""')
    };

    // 攻② 威力加成点两次 +（每档 20 威力 → 共 +40）
    await js('(function(){ var b = document.querySelector(".mod-btn[data-slot=atk2][data-mod=powerAdd][data-dir=\'1\']"); b.click(); b.click(); return true; })()');
    await wait(600);
    results.mods.atk2PowerAdd40 = {
      cells: await js('Array.prototype.slice.call(document.querySelectorAll(".cell-main")).map(function(e){ return e.textContent; })'),
      value: await js('document.querySelector(".mod-input[data-slot=atk2][data-mod=powerAdd]").value'),
      hint: await js('(document.querySelector(".cfg-hint[data-slot=atk2]")||{}).textContent || ""')
    };

    // 边界：攻① 攻击一路减到 -100 后按钮禁用
    await js('(function(){ var b = document.querySelector(".mod-btn[data-slot=atk1][data-mod=atkPct][data-dir=\'-1\']"); for (var i = 0; i < 6; i++) b.click(); return true; })()');
    await wait(700);
    results.mods.lowerBound = {
      value: await js('document.querySelector(".mod-input[data-slot=atk1][data-mod=atkPct]").value'),
      plusDisabled: await js('document.querySelector(".mod-btn[data-slot=atk1][data-mod=atkPct][data-dir=\'1\']").disabled'),
      minusDisabled: await js('document.querySelector(".mod-btn[data-slot=atk1][data-mod=atkPct][data-dir=\'-1\']").disabled')
    };

    // 手填 37（攻击加成，百分比口径）
    await js('(function(){ var i = document.querySelector(".mod-input[data-slot=atk1][data-mod=atkPct]"); i.value = "37"; i.dispatchEvent(new Event("change")); return true; })()');
    await wait(700);
    results.mods.manual37 = {
      value: await js('document.querySelector(".mod-input[data-slot=atk1][data-mod=atkPct]").value'),
      cells: await js('Array.prototype.slice.call(document.querySelectorAll(".cell-main")).map(function(e){ return e.textContent; })'),
      hint: await js('(document.querySelector(".cfg-hint[data-slot=atk1]")||{}).textContent || ""'),
      gridMs: await js('window.__xyDebug.gridMs')
    };

    // 明细：16 组都按加成后算
    await js('document.querySelector(".grid-row[data-row=atk1] .cell").click()');
    await wait(500);
    results.mods.detail = {
      rows: await js('document.querySelectorAll(".crow").length'),
      sum: await js('document.getElementById("detailSum").textContent'),
      firstPct: await js('(document.querySelector(".crow .cpct")||{}).textContent || ""')
    };
    await js('document.getElementById("detailClose").click()');
    await wait(200);

    // 小条标记 + 不换行
    await js('window.api.setCollapsed(true)');
    await wait(700);
    results.mods.minibar = await js('(function(){ var b = document.getElementById("minibar"); var boosts = document.querySelectorAll(".mini-boost").length; var names = Array.prototype.map.call(document.querySelectorAll(".mini-name"), function(e){ return { t: e.textContent, clipped: e.scrollWidth > e.clientWidth + 1 }; }); return { boosts: boosts, names: names, sumText: (document.getElementById("miniSum")||{}).textContent || "", overflow: b.scrollWidth - b.clientWidth, height: document.getElementById("titlebar").getBoundingClientRect().height }; })()');
    results.a20 = await capture('smoke-20-minibar-boost.png');

    // 持久化：saveUI 后读回 state
    await wait(600);
    results.mods.persisted = await js('(async function(){ var st = await window.api.getState(); return st && st.ui && st.ui.mods ? st.ui.mods : null; })()');

    // 复位
    await js('window.api.setCollapsed(false)');
    await wait(500);
    await js('(function(){ var a = document.querySelector(".mod-input[data-slot=atk1][data-mod=atkPct]"); a.value="0"; a.dispatchEvent(new Event("change")); var b = document.querySelector(".mod-input[data-slot=atk2][data-mod=powerAdd]"); b.value="0"; b.dispatchEvent(new Event("change")); return true; })()');
    await wait(600);
    results.mods.afterReset = await js('Array.prototype.slice.call(document.querySelectorAll(".cell-main")).map(function(e){ return e.textContent; })');


    // ⑯ 紧凑布局：内容高度 / 信息完整性 / 自适应窗口
    await js('window.api.setCollapsed(false)');
    await wait(700);
    results.compact = {
      contentHeight: await js('document.getElementById("content").scrollHeight'),
      natural: await js('(function(){ var c = document.getElementById("content"); var cs = getComputedStyle(c); var gap = parseFloat(cs.rowGap || cs.gap || "4") || 4; var kids = Array.prototype.slice.call(c.children).filter(function(el){ return !el.classList.contains("is-hidden"); }); var n = 0; kids.forEach(function(el){ n += el.getBoundingClientRect().height; }); return Math.round(n + Math.max(0, kids.length - 1) * gap); })()'),
      titlebar: await js('Math.round(document.getElementById("titlebar").getBoundingClientRect().height)'),
      cards: await js('Array.prototype.slice.call(document.querySelectorAll(".slot-card")).map(function(e){ return Math.round(e.getBoundingClientRect().height); })'),
      grid: await js('Math.round(document.querySelector(".grid-wrap").getBoundingClientRect().height)'),
      winHeight: win.getBounds().height,
      parts: await js('(function(){ var s = document.getElementById("content"); var out = {}; Array.prototype.forEach.call(s.children, function(el, i){ out[(el.className||"").split(" ")[0] + i] = Math.round(el.getBoundingClientRect().height); }); return out; })()')
    };
    results.compact.names = await js('Array.prototype.slice.call(document.querySelectorAll(".slot-line .picker-btn .name")).map(function(e){ return { text: e.textContent, truncated: e.scrollWidth > e.clientWidth + 1, w: Math.round(e.getBoundingClientRect().width) }; })');
    results.a21 = await capture('smoke-21-compact.png');

    // 信息完整性：每张卡片该有的控件都在
    results.compact.info = {
      atk1: await js('(function(){ var c = document.querySelector(".slot-card[data-slot=atk1]"); return { name: (c.querySelector(".picker-btn .name")||{}).textContent, skill: !!c.querySelector(".skill-select").value, nature: !!c.querySelector(".cfg-nature").value, ivs: !!c.querySelector(".cfg-ivs").value, atkBtn: !!c.querySelector("[data-mod=atkPct][data-dir=\'1\']"), powerBtn: !!c.querySelector("[data-mod=powerAdd][data-dir=\'1\']"), hint: (c.querySelector(".cfg-hint")||{}).textContent }; })()'),
      def: await js('(function(){ var c = document.querySelector(".slot-card-def"); return { name: (c.querySelector(".picker-btn .name")||{}).textContent, skill: (c.querySelector(".def-skill")||{}).value, height: Math.round(c.getBoundingClientRect().height) }; })()'),
      cells: await js('Array.prototype.slice.call(document.querySelectorAll(".cell")).map(function(c){ return { main: (c.querySelector(".cell-main")||{}).textContent, pct: (c.querySelector(".cell-pct")||{}).textContent, j: (c.querySelector(".cell-j")||{}).textContent }; })'),
      rowCfg: await js('Array.prototype.slice.call(document.querySelectorAll(".grid-row .row-cfg")).map(function(e){ return e.textContent; })'),
      note: await js('(document.getElementById("gridNote")||{}).textContent || ""')
    };

    // 点格子仍能打开明细
    await js('document.querySelector(".grid-row[data-row=atk1] .cell").click()');
    await wait(500);
    results.compact.detail = {
      open: await js('!document.getElementById("detail").classList.contains("is-hidden")'),
      rows: await js('document.querySelectorAll(".crow").length'),
      overflow: await js('(function(){ var b = document.getElementById("detailBody"); return b.scrollHeight - b.clientHeight; })()')
    };
    await js('document.querySelector(".tab[data-view=matrix]").click()');
    await wait(300);
    results.compact.detailMatrix = {
      cells: await js('document.querySelectorAll(".mcell").length'),
      overflow: await js('(function(){ var b = document.getElementById("detailBody"); return b.scrollHeight - b.clientHeight; })()')
    };
    await js('document.querySelector(".tab[data-view=groups]").click()');
    await wait(200);
    await js('document.getElementById("detailClose").click()');
    await wait(300);


    // 1300 宽布局不错位
    win.setBounds({ x: 100, y: 80, width: 1300, height: win.getBounds().height });
    await wait(600);
    results.compact.wide = await js('(function(){ var c = document.querySelector(".slot-card[data-slot=atk1]"); var sels = c.querySelectorAll(".slot-selects .select"); return { widths: Array.prototype.map.call(sels, function(e){ return Math.round(e.getBoundingClientRect().width); }), overflow: document.getElementById("content").scrollWidth - document.getElementById("content").clientWidth }; })()');
    results.a22 = await capture('smoke-22-wide.png');
    win.setBounds({ x: 100, y: 80, width: 670, height: win.getBounds().height });
    await wait(600);
    results.compact.narrow = await js('(function(){ var c = document.getElementById("content"); return { overflow: c.scrollWidth - c.clientWidth, cardOverflow: Array.prototype.map.call(document.querySelectorAll(".slot-card"), function(e){ return e.scrollWidth - e.clientWidth; }) }; })()');
    results.a23 = await capture('smoke-23-narrow.png');

    // 小条模式不受影响
    await js('window.api.setCollapsed(true)');
    await wait(700);
    results.compact.minibar = await js('(function(){ var b = document.getElementById("minibar"); return { overflow: b.scrollWidth - b.clientWidth, height: Math.round(document.getElementById("titlebar").getBoundingClientRect().height) }; })()');
    results.a24 = await capture('smoke-24-minibar-compact.png');
    await js('window.api.setCollapsed(false)');
    await wait(500);


    // ⑰ 配置驱动：默认档按主攻属性 / 手动后保持 / 6 次求解
    results.cfgDrive = {};
    await js('window.api.setCollapsed(false)');
    await wait(500);
    results.cfgDrive.before = {
      atk2Sprite: await js('(document.querySelector(".slot-card[data-slot=atk2] .picker-btn .name")||{}).textContent || ""'),
      atk2Nature: await js('document.querySelector(".cfg-nature[data-slot=atk2]").value'),
      atk2Ivs: await js('document.querySelector(".cfg-ivs[data-slot=atk2]").value'),
      atk2Touched: await js('window.__xyDebug.touched.atk2')
    };
    // 未改过的 atk2 换成物攻手（龙息帕尔 atk 127 / matk 57）→ 应自动变 Z1 + J1
    await js('document.querySelector(".picker-btn[data-slot=atk2]").click()');
    await wait(400);
    await js('(function(){ var i = document.getElementById("pickerSearch"); i.value = "龙息帕尔"; i.dispatchEvent(new Event("input")); return true; })()');
    await wait(400);
    await js('document.querySelector(".plist-item").click()');
    await wait(700);
    results.cfgDrive.afterPhysicalPick = {
      sprite: await js('(document.querySelector(".slot-card[data-slot=atk2] .picker-btn .name")||{}).textContent || ""'),
      nature: await js('document.querySelector(".cfg-nature[data-slot=atk2]").value'),
      ivs: await js('document.querySelector(".cfg-ivs[data-slot=atk2]").value'),
      hint: await js('(document.querySelector(".cfg-hint[data-slot=atk2]")||{}).textContent || ""')
    };
    // 手动改 Z3 + J4 → 换精灵后必须保持
    await js('(function(){ var n = document.querySelector(".cfg-nature[data-slot=atk2]"); n.value = "atk>hp"; n.dispatchEvent(new Event("change")); var v = document.querySelector(".cfg-ivs[data-slot=atk2]"); v.value = "hp+def+mdef"; v.dispatchEvent(new Event("change")); return true; })()');
    await wait(700);
    results.cfgDrive.manual = {
      nature: await js('document.querySelector(".cfg-nature[data-slot=atk2]").value'),
      ivs: await js('document.querySelector(".cfg-ivs[data-slot=atk2]").value'),
      cells: await js('Array.prototype.slice.call(document.querySelectorAll(".grid-row[data-row=atk2] .cell-main")).map(function(e){ return e.textContent; })'),
      hint: await js('(document.querySelector(".cfg-hint[data-slot=atk2]")||{}).textContent || ""')
    };
    await js('document.querySelector(".picker-btn[data-slot=atk2]").click()');
    await wait(400);
    await js('(function(){ var i = document.getElementById("pickerSearch"); i.value = "祭礼巨像"; i.dispatchEvent(new Event("input")); return true; })()');
    await wait(400);
    await js('document.querySelector(".plist-item").click()');
    await wait(700);
    results.cfgDrive.keptAfterSpriteChange = {
      sprite: await js('(document.querySelector(".slot-card[data-slot=atk2] .picker-btn .name")||{}).textContent || ""'),
      nature: await js('document.querySelector(".cfg-nature[data-slot=atk2]").value'),
      ivs: await js('document.querySelector(".cfg-ivs[data-slot=atk2]").value'),
      touched: await js('window.__xyDebug.touched.atk2')
    };
    results.cfgDrive.note = await js('(document.getElementById("gridNote")||{}).textContent || ""');
    results.a25 = await capture('smoke-25-config-driven.png');


    // ⑱ 层上限默认 50 + 超限显示 {n}+
    results.overLimit = {};
    results.overLimit.defaultMaxLayer = await js('(document.getElementById("maxLayerSel")||{}).value || ""');
    // 造一个 50 层打不动的组合：贝古斯（仅血量能力值档，防御高）
    await js('window.api.setCollapsed(false)');
    await wait(400);
    await js('document.querySelector(".picker-btn[data-slot=def]").click()');
    await wait(400);
    await js('(function(){ var i = document.getElementById("pickerSearch"); i.value = "贝古斯"; i.dispatchEvent(new Event("input")); return true; })()');
    await wait(400);
    await js('document.querySelector(".plist-item").click()');
    await wait(800);
    results.overLimit.atk50 = {
      atk1: await js('Array.prototype.slice.call(document.querySelectorAll(".grid-row[data-row=atk1] .cell-main")).map(function(e){ return e.textContent; })'),
      atk2: await js('Array.prototype.slice.call(document.querySelectorAll(".grid-row[data-row=atk2] .cell-main")).map(function(e){ return e.textContent; })'),
      tooltip: await js('(document.querySelector(".grid-row[data-row=atk1] .cell")||{}).title || ""')
    };
    // 上限调成 20 → 文案跟 20+
    await js('(function(){ var sel = document.getElementById("maxLayerSel"); sel.value = "20"; sel.dispatchEvent(new Event("change")); return true; })()');
    await wait(800);
    results.overLimit.atk20 = {
      atk1: await js('Array.prototype.slice.call(document.querySelectorAll(".grid-row[data-row=atk1] .cell-main")).map(function(e){ return e.textContent; })'),
      atk2: await js('Array.prototype.slice.call(document.querySelectorAll(".grid-row[data-row=atk2] .cell-main")).map(function(e){ return e.textContent; })'),
      note: await js('(document.getElementById("gridNote")||{}).textContent || ""')
    };
    results.a26 = await capture('smoke-26-overlimit.png');

    // 明细分组标题 / 矩阵格
    await js('document.querySelector(".grid-row[data-row=atk2] .cell").click()');
    await wait(600);
    results.overLimit.detail = {
      groups: await js('Array.prototype.slice.call(document.querySelectorAll(".group .glv")).map(function(e){ return e.textContent; })'),
      sum: await js('document.getElementById("detailSum").textContent')
    };
    await js('document.querySelector(".tab[data-view=matrix]").click()');
    await wait(400);
    results.overLimit.matrix = await js('Array.prototype.slice.call(document.querySelectorAll(".mcell")).map(function(e){ return e.textContent; }).slice(0, 6)');
    await js('document.querySelector(".tab[data-view=groups]").click()');
    await wait(200);
    await js('document.getElementById("detailClose").click()');
    await wait(300);

    // 小条
    await js('window.api.setCollapsed(true)');
    await wait(700);
    results.overLimit.minibar = await js('(document.getElementById("miniSum")||{}).textContent || ""');
    results.a27 = await capture('smoke-27-overlimit-mini.png');
    await js('window.api.setCollapsed(false)');
    await wait(400);
    // 复位上限 50，再换一套弱配置 → 50 层内打不掉 → 应显示 50+
    await js('(function(){ var sel = document.getElementById("maxLayerSel"); sel.value = "50"; sel.dispatchEvent(new Event("change")); return true; })()');
    await wait(600);
    await js('(function(){ var v = document.querySelector(".cfg-ivs[data-slot=atk2]"); v.value = "hp+def+mdef"; v.dispatchEvent(new Event("change")); return true; })()');
    await wait(700);
    results.overLimit.at50plus = {
      cells: await js('Array.prototype.slice.call(document.querySelectorAll(".grid-row[data-row=atk2] .cell-main")).map(function(e){ return e.textContent; })'),
      tip: await js('(document.querySelector(".grid-row[data-row=atk2] .cell")||{}).title || ""')
    };
    // 上限 30：atk1 需要 32 层 → 应显示 30+
    await js('(function(){ var sel = document.getElementById("maxLayerSel"); sel.value = "30"; sel.dispatchEvent(new Event("change")); return true; })()');
    await wait(700);
    results.overLimit.at30plus = {
      atk1: await js('Array.prototype.slice.call(document.querySelectorAll(".grid-row[data-row=atk1] .cell-main")).map(function(e){ return e.textContent; })'),
      tip: await js('(document.querySelector(".grid-row[data-row=atk1] .cell")||{}).title || ""')
    };
    await js('(function(){ var sel = document.getElementById("maxLayerSel"); sel.value = "50"; sel.dispatchEvent(new Event("change")); return true; })()');
    await wait(600);
    // 复原配置
    await js('(function(){ var v = document.querySelector(".cfg-ivs[data-slot=atk2]"); v.value = "hp+atk+spd"; v.dispatchEvent(new Event("change")); return true; })()');
    await wait(600);


    // ⑲ Z5「不加攻」档
    results.z5 = {};
    await js('window.api.setCollapsed(false)');
    await wait(400);
    results.z5.options = await js('Array.prototype.slice.call(document.querySelectorAll(".cfg-nature[data-slot=atk1] option")).map(function(o){ return o.textContent; })');
    // 同一只精灵：Z1 与 Z5 的层数对比
    await js('(function(){ var n = document.querySelector(".cfg-nature[data-slot=atk1]"); n.value = "atk>matk"; n.dispatchEvent(new Event("change")); return true; })()');
    await wait(600);
    results.z5.z1 = { cells: await js('Array.prototype.slice.call(document.querySelectorAll(".grid-row[data-row=atk1] .cell-main")).map(function(e){ return e.textContent; })') };
    await js('(function(){ var n = document.querySelector(".cfg-nature[data-slot=atk1]"); n.value = "hp>spd"; n.dispatchEvent(new Event("change")); return true; })()');
    await wait(700);
    results.z5.z5 = {
      cells: await js('Array.prototype.slice.call(document.querySelectorAll(".grid-row[data-row=atk1] .cell-main")).map(function(e){ return e.textContent; })'),
      hint: await js('(document.querySelector(".cfg-hint[data-slot=atk1]")||{}).textContent || ""'),
      selected: await js('document.querySelector(".cfg-nature[data-slot=atk1]").value')
    };
    // 明细：20 行 + 5×4 矩阵
    await js('document.querySelector(".grid-row[data-row=atk1] .cell").click()');
    await wait(600);
    results.z5.detail = {
      title: await js('(document.getElementById("detailTitle")||{}).textContent || ""'),
      rows: await js('document.querySelectorAll(".crow").length'),
      sum: await js('document.getElementById("detailSum").textContent'),
      current: await js('(document.querySelector(".crow.is-sel .ck")||{}).textContent || ""')
    };
    await js('document.querySelector(".tab[data-view=matrix]").click()');
    await wait(400);
    results.z5.matrix = {
      rows: await js('document.querySelectorAll(".mrow").length'),
      cells: await js('document.querySelectorAll(".mcell").length'),
      rowHeads: await js('Array.prototype.slice.call(document.querySelectorAll(".mrow .mrh")).map(function(e){ return e.textContent; })')
    };
    results.a28 = await capture('smoke-28-z5-matrix.png');
    await js('document.querySelector(".tab[data-view=groups]").click()');
    await wait(200);
    await js('document.getElementById("detailClose").click()');
    await wait(300);
    results.z5.note = await js('(document.getElementById("gridNote")||{}).textContent || ""');


    // ⑳ 透明窗口残影：反复进出小条 / 拖宽 / 开关菜单，逐步做 alpha 包围盒检查
    results.ghost = { samples: [] };
    const sample = async (label) => {
      const ratio = await capture('smoke-ghost-' + label + '.png');
      const box = runner.getBox();
      const b = win.getBounds();
      results.ghost.samples.push({
        label: label,
        win: { w: b.width, h: b.height },
        cap: box ? { w: box.w, h: box.h } : null,
        box: box ? { x0: box.x0, y0: box.y0, x1: box.x1, y1: box.y1 } : null,
        // 右侧 80px / 底部 20px 是否有不透明像素
        rightBand: box ? Math.max(0, box.x1 - (box.w - 80)) : -1,
        bottomBand: box ? Math.max(0, box.y1 - (box.h - 20)) : -1,
        ratio: ratio
      });
    };
    for (let i = 0; i < 10; i++) {
      await js('window.api.setCollapsed(' + (i % 2 === 0 ? 'true' : 'false') + ')');
      await wait(260);
      await sample('t' + i + (i % 2 === 0 ? '-mini' : '-full'));
    }
    // 小条 + 拖动改宽 5 次
    await js('window.api.setCollapsed(true)');
    await wait(300);
    for (let i = 0; i < 5; i++) {
      const b = win.getBounds();
      win.setBounds({ x: b.x, y: b.y, width: 380 + i * 70, height: 46 });
      await wait(240);
      await sample('w' + i);
    }
    // 开关守方菜单 5 次
    for (let i = 0; i < 5; i++) {
      await js('document.getElementById("miniTarget").click()');
      await wait(500);
      await sample('m' + i + '-open');
      await js('document.getElementById("mmClose").click()');
      await wait(420);
      await sample('m' + i + '-close');
    }
    // 右下角 200% 放大证据
    results.ghost.zoom = await capture('smoke-ghost-final.png');
    {
      const b = win.getBounds();
      const img = await win.webContents.capturePage({ x: Math.max(0, b.width - 140), y: Math.max(0, b.height - 70), width: 140, height: 70 });
      const zoomed = img.resize({ width: 280, height: 140, quality: 'best' });
      fs.writeFileSync(path.join(runner.outDir, 'smoke-ghost-corner-2x.png'), zoomed.toPNG());
    }
    // 小条态行剖面：每行不透明像素比例 + 首尾行平均色（定位残影位置与颜色）
    {
      await js('window.api.setCollapsed(true)');
      await wait(400);
      const b = win.getBounds();
      const img = await win.webContents.capturePage();
      const size = img.getSize();
      const buf = img.toBitmap();
      const rows = [];
      for (let y = 0; y < size.height; y++) {
        let op = 0, rs = 0, gs = 0, bs = 0;
        for (let x = 0; x < size.width; x++) {
          const k = (y * size.width + x) * 4;
          if (buf[k + 3] > 16) { op++; rs += buf[k]; gs += buf[k + 1]; bs += buf[k + 2]; }
        }
        if (op > 0) rows.push({ y: y, frac: Number((op / size.width).toFixed(2)), rgb: [Math.round(rs / op), Math.round(gs / op), Math.round(bs / op)] });
      }
      results.ghost.profile = { h: size.height, w: size.width, winH: b.height, first: rows.slice(0, 3), last: rows.slice(-4), rowCount: rows.length };
    }
    results.ghost.worstRight = Math.max.apply(null, results.ghost.samples.map(x => x.rightBand));
    results.ghost.worstBottom = Math.max.apply(null, results.ghost.samples.map(x => x.bottomBand));

    // ⑦ 性能基准：清缓存后连续跑 3 次「3 攻方 × 3 档 × 20 组 = 180 次求解」全量
    results.bench = await js('(function(){ var D = window.RocoDomain; var rows = ["atk1","atk2"]; var out = []; var note = "";' +
      ' for (var run = 0; run < 3; run++) { D.clearCache(); var t0 = performance.now();' +
      ' for (var r = 0; r < rows.length; r++) { for (var t = 0; t < D.DEFENDER_TIERS.length; t++) {' +
      ' var sc = D.buildScene({ attackerId: document.querySelector(".picker-btn[data-slot=" + rows[r] + "] .name").textContent, defenderId: (document.querySelector(".picker-btn[data-slot=def] .name")||{}).textContent, tierKey: D.DEFENDER_TIERS[t].key });' +
      ' if (!sc) continue; var scene = D.buildScene({ attackerId: sc.attackerId, attackSkillId: (document.querySelector(".skill-select[data-slot=" + rows[r] + "]")||{}).value, defenderId: document.querySelector(".picker-btn[data-slot=def] .name").textContent, defenseSkillId: (document.querySelector(".skill-select[data-slot=def]")||{}).value, tierKey: D.DEFENDER_TIERS[t].key });' +
      ' if (scene) D.evaluateAll(scene, 10); } } out.push(Number((performance.now() - t0).toFixed(1))); }' +
      ' return out; })()');
    results.noteAfterPick = await js('(document.getElementById("gridNote")||{}).textContent||""');

  } catch (e) {
    results.error = String((e && e.message) || e);
    results.errorStack = String((e && e.stack) || '');
    results.errorAt = results.lastStep || null;
  }
  console.log('[smoke] ' + JSON.stringify(results));
  app.exit(results.error ? 1 : 0);
}

module.exports = { run };
