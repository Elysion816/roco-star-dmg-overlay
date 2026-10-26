'use strict';
/**
 * src/main/main.js —— Electron 主进程
 * ---------------------------------------------------------------------------
 * 职责：
 *  1. 创建透明、无边框、始终置顶的浮窗（压住「无边框窗口全屏」的游戏）
 *  2. 鼠标点击穿透 / 接管的状态机 + 全局快捷键
 *  3. 收成小条（高度 46px）
 *  4. 状态持久化（窗口位置尺寸 + 业务状态）到 userData/state.json
 *  5. 启动时从 https://stardmg.top 拉取最新图鉴数据（3s 超时，失败静默用内置包）
 *  6. 托盘菜单
 */
const { app, BrowserWindow, globalShortcut, ipcMain, Tray, Menu, nativeImage, shell, screen } = require('electron');
const path = require('node:path');
const fs = require('node:fs');

const ROOT = path.resolve(__dirname, '..', '..');
const ICON_PNG = path.join(ROOT, 'src', 'assets', 'icon.png');
const PRELOAD = path.join(__dirname, 'preload.js');
const INDEX = path.join(ROOT, 'src', 'renderer', 'index.html');

const WIN_DEFAULT = { width: 620, height: 880 };
const COLLAPSED_HEIGHT = 46;
const MIN_WIDTH = 460;
const MIN_HEIGHT = 46;
const TOP_LEVEL = 'screen-saver'; // 比游戏窗口更高的层级

// ---- 诊断（XY_DEBUG=1 / XY_DIAG=1）：把窗口矩形与内容矩形写进 userData/debug.log ----
const DEBUG = process.env.XY_DEBUG === '1' || process.env.XY_DIAG === '1';
const DIAG = process.env.XY_DIAG === '1';
let debugStream = null;
function debugFile() { return path.join(app.getPath('userData'), 'debug.log'); }
function debugLog(channel, payload) {
  if (!DEBUG) return;
  try {
    if (!debugStream) {
      fs.mkdirSync(app.getPath('userData'), { recursive: true });
      const f = debugFile();
      try {
        const st = fs.existsSync(f) ? fs.statSync(f) : null;
        if (st && st.size > 1024 * 1024) fs.renameSync(f, f + '.old'); // 超过 1MB 换新文件
      } catch (e) { /* 忽略 */ }
      debugStream = fs.createWriteStream(f, { flags: 'a' }); // 追加，不覆盖
    }
    debugStream.write(JSON.stringify(Object.assign({ t: Date.now(), channel: channel }, payload)) + '\n');
  } catch (e) { /* 忽略 */ }
}
function logRects(why) {
  if (!DEBUG || !win || win.isDestroyed()) return;
  try {
    const b = win.getBounds();
    const c = win.getContentBounds();
    const d = screen.getDisplayMatching(b);
    debugLog('main', {
      why: why,
      bounds: b,
      content: c,
      resizable: win.isResizable(),
      scaleFactor: d.scaleFactor,
      workArea: d.workArea,
      passthrough: passthrough,
      collapsed: collapsed,
    });
  } catch (e) { /* 忽略 */ }
}

const DATA_HOST = 'stardmg.top';
const DATA_FILES = ['sprites', 'skills', 'types', 'others'];
const DATA_TIMEOUT_MS = 3000;

// ---------------------------------------------------------------------------
// 状态持久化
// ---------------------------------------------------------------------------
const STATE_FILE = () => path.join(app.getPath('userData'), 'state.json');
const DATA_CACHE_DIR = () => path.join(app.getPath('userData'), 'data');

/** 默认业务状态（渲染层也会兜底一份，这里保证首次启动有值） */
function defaultUI() {
  return {
    // 默认组合：两只攻方在默认三档上都打得出数（暮星辰 9~3 层 / 祭礼巨像 5~3 层）
    slots: { atk1: '暮星辰', atk2: '祭礼巨像', atk3: '粉耳星兔', def: '尖嘴狐仙' },
    // 技能：null = 自动（攻击方取威力最高，防御方取「无」）
    skills: { atk1: null, atk2: null, atk3: null, def: null },
    // 攻方配置：具体 natureKey / ivsKey（null = 由渲染层按主攻属性给默认档）
    configs: {
      atk1: { natureKey: null, ivsKey: null },
      atk2: { natureKey: null, ivsKey: null },
      atk3: { natureKey: null, ivsKey: null },
    },
    configTouched: { atk1: false, atk2: false, atk3: false },
    // 攻击加成是百分比；威力加成是**威力点数**（直接加到技能威力上）
    mods: {
      atk1: { atkPct: 0, powerAdd: 0 },
      atk2: { atkPct: 0, powerAdd: 0 },
      atk3: { atkPct: 0, powerAdd: 0 },
    },
    maxLayer: 50,
    tipDismissed: false,
    maxLayerTouched: false,
  };
}

let state = {
  window: { x: null, y: null, width: WIN_DEFAULT.width, height: WIN_DEFAULT.height, expandedHeight: WIN_DEFAULT.height },
  ui: defaultUI(),
  collapsed: false,
};

function loadState() {
  try {
    const raw = fs.readFileSync(STATE_FILE(), 'utf8');
    const parsed = JSON.parse(raw);
    state.window = Object.assign(state.window, parsed.window || {});
    state.ui = Object.assign(defaultUI(), parsed.ui || {});
    const uiIn = parsed.ui || {};
    // 层上限迁移：旧默认 10 / 缺失 → 50；用户自己改过（maxLayerTouched）则保留
    const legacyLayer = uiIn.maxLayer;
    if (!uiIn.maxLayerTouched && (legacyLayer === undefined || legacyLayer === null || legacyLayer === 10)) {
      state.ui.maxLayer = 50;
    }
    state.ui.slots = Object.assign(defaultUI().slots, (parsed.ui && parsed.ui.slots) || {});
    state.ui.skills = Object.assign(defaultUI().skills, (parsed.ui && parsed.ui.skills) || {});
    state.ui.configs = Object.assign(defaultUI().configs, (parsed.ui && parsed.ui.configs) || {});
    // 加成迁移到新结构：旧存档的 powerPct 是「百分比」口径，与新版「威力点数」不可互换 → 丢弃为 0
    for (const row of ['atk1', 'atk2', 'atk3']) {
      const m = (state.ui.mods && state.ui.mods[row]) || {};
      state.ui.mods[row] = {
        atkPct: Number(m.atkPct) || 0,
        powerAdd: Number(m.powerAdd) || 0,
      };
    }
    state.collapsed = false; // 关闭时若处于小条，下次启动仍展开（避免看不到内容）
  } catch (e) {
    // 首次启动 / 文件损坏：用默认值
  }
}

let saveTimer = null;
function saveState(immediate = false) {
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
  const write = () => {
    try {
      fs.mkdirSync(path.dirname(STATE_FILE()), { recursive: true });
      fs.writeFileSync(STATE_FILE(), JSON.stringify(state, null, 2), 'utf8');
    } catch (e) {
      console.warn('[main] 状态写入失败：', e.message);
    }
  };
  if (immediate) write();
  else saveTimer = setTimeout(write, 350);
}

// ---------------------------------------------------------------------------
// 窗口
// ---------------------------------------------------------------------------
let win = null;
let tray = null;
let passthrough = false; // 启动默认「接管」，用户可直接点浮窗
// 小条里点「靶子」/聚焦搜索框时，窗口会临时向下（或向上）撑出一块放小菜单；
// 这里记住撑开前的窗口矩形，关闭菜单时原样还原
let tempExpandedFromMini = false;
let miniBoundsBeforeExpand = null;
let collapsed = false;
let onlineData = null;
let dataStatus = { source: 'builtin', fetchedAt: 0, message: '内置数据' };

function pickBounds() {
  const w = state.window || {};
  const width = Math.max(MIN_WIDTH, Number(w.width) || WIN_DEFAULT.width);
  const height = Math.max(200, Number(w.height) || WIN_DEFAULT.height);
  if (Number.isFinite(w.x) && Number.isFinite(w.y)) {
    // 校验是否落在某个显示器里（拔掉副屏后不至于跑到屏幕外）
    const displays = screen.getAllDisplays();
    const visible = displays.some(d => {
      const b = d.workArea;
      return w.x + 80 > b.x && w.x < b.x + b.width - 40 && w.y + 40 > b.y && w.y < b.y + b.height - 40;
    });
    if (visible) return { x: w.x, y: w.y, width, height };
  }
  const primary = screen.getPrimaryDisplay().workArea;
  return {
    width, height,
    x: Math.round(primary.x + primary.width - width - 24),
    y: Math.round(primary.y + 24),
  };
}

function createWindow() {
  const bounds = pickBounds();
  win = new BrowserWindow({
    width: bounds.width,
    height: bounds.height,
    x: bounds.x,
    y: bounds.y,
    minWidth: MIN_WIDTH,
    minHeight: MIN_HEIGHT,
    transparent: true,
    frame: false,
    thickFrame: false, // 去掉 DWM 的不可见 resize 边框（透明窗口边缘发白的常见来源）
    resizable: true,
    movable: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    backgroundColor: '#00000000',
    fullscreenable: false,
    maximizable: false,
    show: false,
    title: '星陨斩杀线',
    icon: fs.existsSync(ICON_PNG) ? ICON_PNG : undefined,
    webPreferences: {
      preload: PRELOAD,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false,
      spellcheck: false,
    },
  });

  // 压住窗口化/无边框全屏的游戏
  win.setHasShadow(false);
  win.setAlwaysOnTop(true, TOP_LEVEL);
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  win.setMenuBarVisibility(false);
  win.setBackgroundColor('#00000000');
  win.loadFile(INDEX);

  win.once('ready-to-show', () => {
    shownAt = Date.now();
    win.show();
    forceRepaint();
    setPassthrough(false); // 启动默认「接管」：只抢这一次焦点，之后 show/hide 不再抢
    sendMode();
  });

  // 渲染层报错打到主进程 stdout（便于排查，也供 --smoke 自检使用）
  win.webContents.on('console-message', (_e, level, message, line, sourceId) => {
    if (level >= 2) console.error('[renderer] ' + message + ' (' + sourceId + ':' + line + ')');
  });
  win.webContents.on('render-process-gone', (_e, details) => console.error('[renderer] 进程退出：', details));
  win.webContents.on('did-fail-load', (_e, code, desc) => console.error('[renderer] 加载失败：', code, desc));

  // 自检模式：XY_SMOKE=1 时交给 smoke.js 跑一遍完整交互并截图，完成后退出
  if (DIAG) runDiag();
  if (process.env.XY_SMOKE === '1') {
    win.webContents.once('did-finish-load', () => {
      setTimeout(() => require('./smoke.js').run(win, app, ROOT), 1500);
    });
  }

  // 菜单打开时窗口失焦（点到桌面 / 别的窗口）→ 主进程负责关菜单并收回小条；
  // 渲染层收不到窗外的点击，这条是"点外部关闭"的唯一可靠来源。
  win.on('blur', () => {
    if (!tempExpandedFromMini) return;
    // 只做"关菜单 + 收回 46px + 保持接管"；不抢焦点（抢焦点会打断用户刚点的游戏窗口）
    closeMiniAndRestore();
  });

  // 拖动（含点住 drag 区再松手）结束后补一次重绘，避免透明窗口残留白块
  let moveRepaintTimer = null;
  win.on('resize', () => logRects('resize'));
  win.on('move', () => logRects('move'));

  win.on('move', () => {
    if (moveRepaintTimer) clearTimeout(moveRepaintTimer);
    moveRepaintTimer = setTimeout(() => {
      moveRepaintTimer = null;
      forceRepaint();
      setTimeout(forceRepaint, 80);
    }, 150);
  });

  win.on('move', persistBounds);
  win.on('resize', persistBounds);
  win.on('closed', () => { win = null; });
  win.on('show', sendMode);
  win.on('hide', sendMode);
  // 失焦时若仍处于交互态，主进程不强行切穿透（避免用户在系统弹窗时被打断）
}

let applyingBounds = false;
/** 透明窗口在 setBounds 后偶发残留上一帧（右侧/底部白块）：重新声明背景色 + 让合成器重绘 */
function forceRepaint() {
  if (!win || win.isDestroyed()) return;
  try {
    logRects('forceRepaint');
    win.setBackgroundColor('#00000000');
    if (win.webContents && !win.webContents.isDestroyed()) win.webContents.invalidate();
  } catch (e) { /* 忽略 */ }
}

function setBoundsSafe(b) {
  if (!win) return;
  applyingBounds = true;
  debugLog('setBounds', { to: b, from: win.getBounds() });
  win.setBounds(b);
  forceRepaint();
  setTimeout(() => {
    applyingBounds = false;
    forceRepaint(); // 尺寸落定后再补一次，抹掉缩放过程留下的残影
  }, 80);
}

let shownAt = 0;
/** npm run diag：收起小条 → 等 2s → 真实桌面截图 → 退出，并打印日志/截图路径 */
async function runDiag() {
  const { desktopCapturer } = require('electron');
  const outDir = path.join(ROOT, '_intermediates');
  try { fs.mkdirSync(outDir, { recursive: true }); } catch (e) { /* 忽略 */ }
  setTimeout(() => {
    try { setCollapsed(true); } catch (e) { /* 忽略 */ }
    debugLog('diag', { step: 'collapsed', bounds: win.getBounds() });
    logRects('diag-after-collapse');
  }, 1500);
  setTimeout(async () => {
    try {
      logRects('diag-before-shot');
      const disp = screen.getPrimaryDisplay();
      const sf = disp.scaleFactor || 1;
      const sources = await desktopCapturer.getSources({
        types: ['screen'],
        thumbnailSize: { width: Math.round(disp.size.width * sf), height: Math.round(disp.size.height * sf) },
      });
      const shot = sources && sources[0] ? sources[0].thumbnail : null;
      const shotPath = path.join(outDir, 'diag-shot.png');
      if (shot && !shot.isEmpty()) {
        fs.writeFileSync(shotPath, shot.toPNG());
        debugLog('diag', { step: 'screenshot', path: shotPath, size: shot.getSize() });
      } else {
        debugLog('diag', { step: 'screenshot', error: 'desktopCapturer 返回空图像' });
      }
      console.log('[diag] 日志：' + debugFile());
      console.log('[diag] 截图：' + shotPath);
      console.log('[diag] 窗口矩形：' + JSON.stringify(win.getBounds()));
    } catch (e) {
      console.error('[diag] 失败：', e && e.message);
    }
    if (debugStream) { try { debugStream.end(); } catch (e) {} }
    setTimeout(() => app.quit(), 200);
  }, 3600);
}

function persistBounds() {
  if (!win || collapsed) return;
  // 用户手动拖高过 → 记住，之后不再自动改高度
  // （窗口刚显示时的系统 resize 不算用户操作，否则自适应高度永远被拦）
  if (!applyingBounds && shownAt && Date.now() - shownAt > 1600) {
    state.window.heightUserSet = true;
    state.window.heightUserSetAt = Date.now();
  }
  const b = win.getBounds();
  state.window.x = b.x;
  state.window.y = b.y;
  state.window.width = b.width;
  state.window.height = b.height;
  state.window.expandedHeight = b.height;
  saveState();
}

/** 穿透 / 交互 切换 */
function setPassthrough(on) {
  // 菜单开着（窗口临时撑到 300）时切换穿透：先把菜单收起并还原 46px，再按目标状态办理
  if (tempExpandedFromMini) closeMiniAndRestore({ keepPassthrough: true });
  passthrough = !!on;
  if (!win) return passthrough;
  try {
    if (passthrough) {
      // 先放弃焦点再让鼠标穿透，避免窗口抢键盘
      win.setIgnoreMouseEvents(true, { forward: true });
      win.setFocusable(false);
      win.blur();
    } else {
      win.setFocusable(true);
      win.setIgnoreMouseEvents(false);
      if (!win.isVisible()) win.show();
      win.focus();
    }
  } catch (e) {
    console.warn('[main] 切换穿透失败：', e.message);
  }
  sendMode();
  updateTrayMenu();
  return passthrough;
}

function togglePassthrough() { return setPassthrough(!passthrough); }

/**
 * 小条模式。
 * 进入小条时如果正处于「点击穿透」，会自动切到接管态：46px 的条几乎不挡游戏，
 * 但它必须能被点开（穿透态下 OS 会把点击全部交给下层窗口，按钮点了没反应）。
 * 退出小条时**强制接管**：展开后如果还是穿透态，等于「展开了却不能点」，用户会以为又坏了。
 * 要交还鼠标按 Esc / Alt+X（README 第 4 节的语义）。
 */
function setCollapsed(on) {
  const next = !!on;
  // 任何显式收起/展开，先把菜单这层临时态收口（还原 46px 的正确矩形）
  if (tempExpandedFromMini) closeMiniAndRestore({ keepPassthrough: true });
  if (next && !collapsed && passthrough) setPassthrough(false); // 收条前先接管鼠标
  if (!next) setPassthrough(false);                              // 展开后一律接管：用户点「展开」就是要马上能操作
  collapsed = next;
  // 先把 collapsed 语义发给渲染层（让它立刻切到小条布局），再改窗口尺寸，
  // 否则缩放瞬间合成器可能残留上一帧（右侧/底部白块）
  sendMode();
  if (win) {
    const b = win.getBounds();
    if (collapsed) {
      // 只有"确实比小条高"的矩形才配当作用户的展开高度（避免把 46/300 记进去）
      if (!state.collapsed && b.height > COLLAPSED_HEIGHT + 16) state.window.expandedHeight = b.height;
      win.setResizable(false);
      setBoundsSafe({ x: b.x, y: b.y, width: b.width, height: COLLAPSED_HEIGHT });
    } else {
      const h = Math.max(320, Number(state.window.expandedHeight) || WIN_DEFAULT.height);
      win.setResizable(true);
      setBoundsSafe({ x: b.x, y: b.y, width: b.width, height: h });
    }
  }
  if (!collapsed && win && !win.isDestroyed()) win.webContents.send('mini-menu:close');
  state.collapsed = collapsed;
  saveState();
  sendMode();
  updateTrayMenu();
  return collapsed;
}

/**
 * 从小条撑出一块高度给菜单用（46 → h）。
 * 方向：默认向下扩；若下沿会超出当前显示器工作区，则改为向上扩（底边不动）。
 */
function expandWindowFromMini(height) {
  if (!win) return;
  const b = win.getBounds();
  const area = screen.getDisplayMatching(b).workArea;
  const h = Math.max(180, Math.min(420, Math.round(Number(height)) || 300));
  if (!miniBoundsBeforeExpand) miniBoundsBeforeExpand = { x: b.x, y: b.y, width: b.width, height: b.height };
  let y = b.y;
  if (y + h > area.y + area.height) {
    // 贴屏幕底部：保持窗口底边不动，向上长
    y = Math.max(area.y, b.y + b.height - h);
  }
  win.setResizable(true);
  setBoundsSafe({ x: b.x, y, width: b.width, height: h });
}

/**
 * 关闭小条菜单并还原窗口 —— **所有关闭路径的唯一出口**。
 * 触发点：窗口失焦、✕、点外部、选中精灵、Esc、Ctrl+Shift+M、展开/收起、穿透切换。
 *
 * @param {{keepPassthrough?: boolean}} [opts] keepPassthrough=true 时不动穿透（由调用方决定）
 */
function closeMiniAndRestore(opts) {
  if (!tempExpandedFromMini) return false;
  tempExpandedFromMini = false;
  restoreWindowFromMenu();                                   // 还原成原小条矩形（含原 y）
  if (win && !win.isDestroyed()) win.webContents.send('mini-menu:close');
  if (opts && opts.keepPassthrough) {
    sendMode();
  } else {
    setPassthrough(false);                                   // 关完保持接管：用户还能立刻再点开
  }
  return true;
}

/**
 * 用户主动触发的"收起/展开"：菜单开着时先收菜单（回到 46），不做状态翻转。
 *
 * 去抖：一次按键可能被投递两次（全局快捷键重复投递 / 键盘 auto-repeat），
 * 第一次把菜单收掉后 tempExpandedFromMini 已清，第二次会走 setCollapsed(!collapsed)
 * 把窗口展开成 800px —— 这正是"按一次 Ctrl+Shift+M 变成 800"的成因。
 * 这里对 280ms 内的重复触发直接忽略（按钮连点同理，语义仍是"一次操作一次翻转"）。
 */
let lastCollapseToggleAt = 0;
function toggleCollapsedFromUser() {
  const now = Date.now();
  if (now - lastCollapseToggleAt < 280) {
    return collapsed; // 去抖：忽略同一次按键的重复投递
  }
  lastCollapseToggleAt = now;
  if (tempExpandedFromMini) {
    closeMiniAndRestore();
    return collapsed; // 收完菜单仍是小条态：collapsed 保持 true
  }
  return setCollapsed(!collapsed);
}

/** 菜单关闭：还原成原来的小条矩形 */
function restoreWindowFromMenu() {
  const b = miniBoundsBeforeExpand;
  miniBoundsBeforeExpand = null;
  if (!b || !win) return;
  setBoundsSafe({ x: b.x, y: b.y, width: b.width, height: b.height });
  win.setResizable(false); // 小条固定尺寸
}

function sendMode() {
  if (!win) return;
  win.webContents.send('mode', {
    passthrough,
    collapsed,
    visible: win.isVisible(),
    alwaysOnTop: win.isAlwaysOnTop(),
  });
}

// ---------------------------------------------------------------------------
// 快捷键
// ---------------------------------------------------------------------------
/** Alt+X：呼出并接管鼠标；已在交互态则交还鼠标（窗口保持可见） */
function hotkeyToggleFocus() {
  if (!win) return;
  if (!win.isVisible()) win.show();
  if (passthrough) setPassthrough(false);
  else setPassthrough(true);
}

function registerShortcuts() {
  const bindings = [
    ['Alt+X', hotkeyToggleFocus],
    ['Control+Alt+T', () => setPassthrough(!passthrough)],
    ['Control+Shift+M', () => toggleCollapsedFromUser()],
  ];
  for (const [acc, fn] of bindings) {
    try {
      if (globalShortcut.isRegistered(acc)) {
        console.warn('[main] 快捷键已注册，跳过重复绑定：' + acc);
        continue;
      }
      if (!globalShortcut.register(acc, fn)) console.warn('[main] 快捷键注册失败（可能被占用）：' + acc);
    } catch (e) {
      console.warn('[main] 快捷键异常：' + acc + ' ' + e.message);
    }
  }
}

// ---------------------------------------------------------------------------
// 托盘
// ---------------------------------------------------------------------------
function updateTrayMenu() {
  if (!tray) return;
  const menu = Menu.buildFromTemplate([
    { label: win && win.isVisible() ? '隐藏浮窗' : '显示浮窗', click: () => { if (!win) return; win.isVisible() ? win.hide() : win.show(); } },
    { label: '点击穿透（Alt+X / Ctrl+Alt+T）', type: 'checkbox', checked: passthrough, click: () => setPassthrough(!passthrough) },
    { label: '收成小条（Ctrl+Shift+M）', type: 'checkbox', checked: collapsed, click: () => toggleCollapsedFromUser() },
    { type: 'separator' },
    { label: '重新拉取在线数据', click: () => fetchOnlineData(true) },
    { label: '打开数据目录', click: () => shell.openPath(DATA_CACHE_DIR()) },
    { label: '关于：数据来源 stardmg.top', enabled: false },
    { type: 'separator' },
    { label: '退出', click: () => { app.isQuitting = true; app.quit(); } },
  ]);
  tray.setContextMenu(menu);
}

function createTray() {
  try {
    const img = fs.existsSync(ICON_PNG) ? nativeImage.createFromPath(ICON_PNG) : nativeImage.createEmpty();
    tray = new Tray(img);
    tray.setToolTip('星陨斩杀线 · 置顶浮窗');
    updateTrayMenu();
    tray.on('click', hotkeyToggleFocus);
  } catch (e) {
    console.warn('[main] 托盘创建失败：', e.message);
  }
}

// ---------------------------------------------------------------------------
// 在线数据
// ---------------------------------------------------------------------------
/** 只认 stardmg.top（GitHub Pages 镜像为旧版，禁用） */
async function fetchOne(name, signal) {
  const url = 'https://' + DATA_HOST + '/datas/final/' + name + '.json';
  const res = await fetch(url, { signal, cache: 'no-store' });
  if (!res.ok) throw new Error(name + ' HTTP ' + res.status);
  // 防重定向到站外
  try {
    const finalHost = new URL(res.url).hostname;
    if (finalHost !== DATA_HOST) throw new Error(name + ' 重定向到非白名单域名：' + finalHost);
  } catch (e) {
    if (!String(e.message).includes('重定向')) throw new Error(name + ' URL 异常');
    throw e;
  }
  return await res.json();
}

function validateOnline(d) {
  if (!d || typeof d !== 'object') return '数据为空';
  const sprites = d.sprites, skills = d.skills, types = d.types;
  if (!sprites || typeof sprites !== 'object') return 'sprites 缺失';
  const ids = Object.keys(sprites);
  if (ids.length < 100) return 'sprites 数量异常(' + ids.length + ')';
  for (const id of ids.slice(0, 60)) {
    const s = sprites[id];
    if (!s || !s.id || typeof s.hp !== 'number' || typeof s.atk !== 'number' || !Array.isArray(s.types)) return '精灵结构异常：' + id;
  }
  if (!skills || typeof skills !== 'object' || !Object.keys(skills).length) return 'skills 异常';
  if (!types || typeof types !== 'object' || Object.keys(types).length < 18) return 'types 不足 18 系';
  if (!d.others || typeof d.others !== 'object') return 'others 缺失';
  return null;
}

async function fetchOnlineData(manual = false) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DATA_TIMEOUT_MS);
  try {
    const arr = await Promise.all(DATA_FILES.map(n => fetchOne(n, controller.signal)));
    clearTimeout(timer);
    const payload = { sprites: arr[0], skills: arr[1], types: arr[2], others: arr[3] };
    const bad = validateOnline(payload);
    if (bad) throw new Error('校验失败：' + bad);
    onlineData = payload;
    dataStatus = { source: 'online', fetchedAt: Date.now(), message: '在线数据' };
    // 落盘缓存，便于排查与离线复用
    try {
      fs.mkdirSync(DATA_CACHE_DIR(), { recursive: true });
      DATA_FILES.forEach((n, i) => fs.writeFileSync(path.join(DATA_CACHE_DIR(), n + '.json'), JSON.stringify(arr[i])));
    } catch (e) { /* 缓存失败不影响使用 */ }
    if (win) win.webContents.send('data:online', onlineData);
    updateTrayMenu();
  } catch (e) {
    clearTimeout(timer);
    dataStatus = { source: 'builtin', fetchedAt: 0, message: '内置数据（在线拉取失败：' + (e && e.name === 'AbortError' ? '超时 3s' : (e && e.message) || '未知错误') + '）' };
    if (manual && win) win.webContents.send('data:status', dataStatus);
  }
  return dataStatus;
}

// ---------------------------------------------------------------------------
// IPC
// ---------------------------------------------------------------------------
function registerIPC() {
  ipcMain.handle('state:get', () => ({ ui: state.ui, collapsed, passthrough, dataStatus }));
  ipcMain.handle('state:set', (_e, ui) => {
    if (ui && typeof ui === 'object') {
      state.ui = Object.assign(state.ui, ui);
      saveState();
    }
    return true;
  });
  ipcMain.handle('win:collapse', (_e, v) => setCollapsed(!!v));
  // 由主进程自己翻转：渲染层不需要知道当前状态，快速连点也不会错乱
  ipcMain.handle('win:toggle-collapse', () => toggleCollapsedFromUser());
  // 小条模式下临时展开：撑开到原高度 → 选完/取消后再收回 46px
  // 小条里临时撑开指定高度（放小菜单用）；收起时还原原矩形
  ipcMain.handle('win:temp-expand', (_e, on, height) => {
    if (on) {
      if (!collapsed) return false; // 只在真正的小条里用（展开态走自己的 UI）
      // 注意顺序：必须先把穿透切掉，再置 tempExpandedFromMini。
      // 反过来的话 setPassthrough 里的"菜单开着就先收口"会把刚撑开的窗口立刻还原。
      if (passthrough) setPassthrough(false);
      tempExpandedFromMini = true;
      expandWindowFromMini(height);
      return true;
    }
    return closeMiniAndRestore();
  });
  // 展开态自适应高度：用户没手动拖过才采纳
  // 渲染层矩形上报（诊断）
  ipcMain.on('debug:rect', (_e, payload) => debugLog('renderer', payload || {}));

  ipcMain.handle('win:auto-height', (_e, height) => {
    if (!win || collapsed || tempExpandedFromMini) return false;
    if (state.window.heightUserSet) return false; // 尊重用户手动高度
    // 三攻方后内容更高：上限从 900 抬到 1000（3 卡片 + 3 行结果）
    const h = Math.max(480, Math.min(1000, Math.round(Number(height) || 0)));
    if (!h) return false;
    const b = win.getBounds();
    if (Math.abs(b.height - h) < 2) return false;
    win.setResizable(true);
    setBoundsSafe({ x: b.x, y: b.y, width: b.width, height: h });
    state.window.expandedHeight = h;
    saveState();
    return true;
  });

  ipcMain.handle('win:passthrough', (_e, v) => setPassthrough(!!v));
  ipcMain.handle('win:toggle-passthrough', () => togglePassthrough());
  ipcMain.handle('win:close', () => { saveState(true); if (win) win.close(); app.quit(); return true; });
  ipcMain.handle('data:online', () => onlineData);
  ipcMain.handle('data:status', () => dataStatus);
  ipcMain.handle('data:refresh', () => fetchOnlineData(true));
  ipcMain.handle('app:info', () => ({
    version: app.getVersion(),
    electron: process.versions.electron,
    node: process.versions.node,
    dataStatus,
  }));
  ipcMain.handle('app:open-url', (_e, url) => {
    if (typeof url === 'string' && /^https?:\/\//.test(url)) shell.openExternal(url);
    return true;
  });
}

// ---------------------------------------------------------------------------
// 生命周期
// ---------------------------------------------------------------------------
loadState();

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (win) { win.show(); setPassthrough(false); }
    if (collapsed) setCollapsed(false);
  });

  app.whenReady().then(() => {
    registerIPC();
    createWindow();
    if (process.env.XY_SMOKE !== '1') createTray();
    registerShortcuts(); // 自检模式也要注册，才能验证快捷键是否真的绑定成功
    fetchOnlineData(); // 不阻塞窗口显示
  });

  app.on('will-quit', () => {
    globalShortcut.unregisterAll();
    saveState(true);
  });

  app.on('window-all-closed', () => app.quit());
}

process.on('uncaughtException', err => {
  console.error('[main] 未捕获异常：', err);
});
