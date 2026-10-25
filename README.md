# 星陨斩杀线 · 桌面置顶浮窗

[![Release](https://img.shields.io/github/v/release/Elysion816/roco-star-dmg-overlay?label=release)](https://github.com/Elysion816/roco-star-dmg-overlay/releases/latest)
[![Downloads](https://img.shields.io/github/downloads/Elysion816/roco-star-dmg-overlay/total)](https://github.com/Elysion816/roco-star-dmg-overlay/releases)
[![License](https://img.shields.io/github/license/Elysion816/roco-star-dmg-overlay)](LICENSE)

> **本项目基于 [Bartzh/roco-star-dmg](https://github.com/Bartzh/roco-star-dmg) 开发。**
> 
> 数值内核（伤害公式、属性结算、特性表）由该项目的 `calculator.js` 按行段逐字抽取生成，
> 图鉴数据（精灵 / 技能 / 属性相克）来自该项目的 `datas/final/*.json`，
> 原始数据出自 [BWiki 洛克王国 Wiki](https://wiki.biligame.com/nrc/)（CC BY-NC-SA 4.0）。
> 本仓库只新增桌面浮窗层与交互，**不修改上游任何数值逻辑**；许可与第三方声明见 [LICENSE](LICENSE)。

《洛克王国：世界》星陨玩法的「一击斩杀线」查询浮窗：选两只攻击精灵 + 一个防御靶子，直接给出
**2 攻方 × 3 档靶子 = 6 个斩杀层数**（最少需要几层星陨印记才能一击秒杀）。6 格按卡片上选定的那套配置计算
（性格 5 档 × 加点 4 档，默认按精灵的主攻属性自动给出），点任意格子可展开该格的 20 组参考明细。

数值内核（`src/core/calc-core.js`）是从上游网页 https://stardmg.top 的 `calculator.js`
**按行段逐字抽取**的，不含任何手写重算，公式与线上版本完全一致。

---

## 1. 这是什么

- 一个 **Windows 桌面浮窗**（Electron，绿色免安装），常驻置顶，压在「无边框窗口全屏」的游戏画面上。
  **[→ 去 Releases 下载 zip](https://github.com/Elysion816/roco-star-dmg-overlay/releases/latest)**，解压后双击 `星陨斩杀线.exe` 即可运行。
- 启动默认 **接管鼠标**（可以直接点浮窗操作）；按 `Alt+X` 把鼠标交还给游戏（点击穿透），再按一次收回。
- 三档靶子固定（纯肉 / 防血能力值 / 仅血量能力值），不用每次自己调性格与加点，直接横向对比两只攻方的斩杀线。
- 数据每次启动自动从 stardmg.top 拉取最新图鉴，失败自动用内置离线包。

---

## 2. 下载与启动

### 方式 A：下载现成版本（推荐 · 免安装）

打开 **[Releases](https://github.com/Elysion816/roco-star-dmg-overlay/releases/latest)**，下载最新的 zip：

```
roco-star-dmg-overlay-v1.0.0-win32-x64.zip     （约 119 MB）
```

解压后双击里面的 **`星陨斩杀线.exe`** 即可运行。

- 免安装、免 Node，解压到任意位置或拷到别的机器都能直接用（Windows x64）
- 解压后约 286MB，主要体积是 Electron 运行时本身（Chromium + Node）
- 未做代码签名，首次运行 Windows SmartScreen 可能提示「未知发布者」→ 点「更多信息 → 仍要运行」

### 方式 B：从源码运行

```bash
git clone https://github.com/Elysion816/roco-star-dmg-overlay.git
cd roco-star-dmg-overlay
npm install     # 首次；只装 electron 35.7.5 与 @electron/packager（devDependencies）
npm start       # 已内置 tools/start.mjs：会先清掉 ELECTRON_RUN_AS_NODE 再拉起 Electron
```

> `npm start` 走的是 `tools/start.mjs`。某些 IDE / 终端 / 沙箱会带上 `ELECTRON_RUN_AS_NODE=1`，
> 那会让 electron 以「纯 Node」模式运行（窗口起不来），这个脚本会先把该变量摘掉。

> 想自己产出绿色版：`npm run pack` → `dist/星陨斩杀线-win32-x64/`（详见 [11. 打包](#11-打包)）。

---

## 3. 游戏设置前提（重要）

浮窗通过「始终置顶（`screen-saver` 层级）」压在游戏上面，**只能覆盖窗口化 / 无边框窗口全屏**：

- 游戏里请把画面设为 **窗口** 或 **无边框窗口全屏**。
- **独占全屏（Exclusive Fullscreen）压不住**：独占全屏绕过桌面合成器，任何置顶窗口都会被盖住。

---

## 4. 快捷键

| 快捷键 | 作用 |
| --- | --- |
| `Alt+X` | 呼出浮窗并接管鼠标（可点击）；再按一次交还鼠标，回到点击穿透（窗口仍可见） |
| `Ctrl+Alt+T` | 切换点击穿透 / 接管鼠标 |
| `Ctrl+Shift+M` | 收成小条（只剩标题 + 6 格摘要）/ 展开 |
| `Esc` | 依次关闭明细面板 → 精灵选择器；都关着时「交还鼠标，回到穿透」 |
| 托盘图标 | 左键＝呼出/接管；右键＝显示/隐藏、穿透、小条、重新拉取数据、打开数据目录、退出 |

启动后默认 **接管鼠标**（可以直接点浮窗）。不想挡游戏操作时按 `Alt+X` 或 `Ctrl+Alt+T` 交还鼠标（点击穿透），
再按一次收回；操作完也可以按 `Esc` 交还。

> 穿透状态下窗口不接收键盘和点击（Windows `setIgnoreMouseEvents` 的语义），
> 只能用全局快捷键或托盘唤回。

---

## 5. 界面说明

1. **标题栏**：★ 星陨斩杀线 · 数据来源（内置数据 / 在线数据）· 穿透状态 · 收起 · 关闭。整条可拖动移动窗口。
2. **攻方① / 攻方②**
   - 点精灵按钮弹出选择器：**先按属性筛选，再点选**；也能直接输入名字 / 全拼 / 首字母 / 图鉴号
     （`lxpe` → 龙息帕尔，`1` → 图鉴号 1）。
   - 技能下拉：只列该精灵的**攻击技能**，标注「威力 / 物攻·魔攻 / 连击」；
     默认取 **与主攻类别（物攻 或 魔攻，看种族值更高的一侧）一致** 的技能里威力最高者，
     与主攻不符的技能会加后缀「与主攻不符」提示（这不影响你手动选择——选了就按你选的算）。
   - 配置下拉：**性格**（默认「自动最优」，另有 30 种手选）+ **加点**（默认「自动最优」，另有 20 种手选）。
     手动指定后该行 3 格按手动配置重算，格子上会标「手动」。
3. **靶子**：同款选择器 + 防御技能下拉（含「无」）。靶子性格/加点固定三档：
   - 档①「纯肉」：性格 生命↑物攻↓，加点 生命/物防/魔防
   - 档②「防血能力值」：性格 速度↑物攻↓（防御三维无加成），加点 生命/物防/魔防
   - 档③「仅血量能力值」：性格 速度↑物攻↓，加点 仅生命
4. **6 格结果**：大号数字＝最少需要几层星陨印记才能一击秒杀；`不可斩`＝层上限内打不死。
   下方小字是该格采用的性格/加点，以及该组合 0 层伤害占靶子 HP 的比例。
   配色：0 层绿、1–2 层青、3–5 层金、6 层以上橙、不可斩红。
5. **点格子 → 明细面板**（该「攻方 × 档」的全部 20 组）
   - 分组清单：按斩杀层数分组（0 层 / 1 层 / … / 不可斩），可折叠，★ 标最优组合；
   - 矩阵视图：行＝30 种性格、列＝20 种加点，格子＝层数，金框＝最优，点击可高亮；
   - 三个过滤器：只看攻击型性格 / 只看可斩杀 / 加点含攻击属性。
6. **层上限**：结果区右下角可切换 5/10/15/20/30/50/99，超过上限即视为「不可斩」。

---

## 6. 数据：启动自动更新 + 离线兜底

- **内置包**：`src/data/roco-data.js`（622 只精灵 / 824 个技能 / 18 系，离线首启即可用）。
- **每次启动自动拉取**（主进程执行，只认 `stardmg.top`；GitHub Pages 那份是旧版，已禁用）：
  `https://stardmg.top/datas/final/{sprites,skills,types,others}.json`
  - 超时 **3 秒**；
  - 校验：JSON 可解析、sprites ≥ 100 条且每条含 id/hp/atk/types、skills 非空、types ≥ 18 系、拒绝重定向到站外；
  - 通过 → 缓存到 `%APPDATA%/星陨斩杀线/data/*.json` 并热替换（标题栏显示「在线数据」）；
  - 任何失败 → **静默回落内置包**（标题栏显示「内置数据」），不影响使用。
- 手动重拉：托盘右键 → 重新拉取在线数据。

---

## 7. 状态持久化

`%APPDATA%/星陨斩杀线/state.json` 保存：窗口位置与尺寸、三槽精灵、技能、手动配置、层上限、提示条状态。
关窗写盘，下次启动原样恢复。

---

## 8. 目录结构

```
src/
  main/
    main.js        主进程：透明置顶窗口 / 穿透状态机 / 全局快捷键 / 托盘 / 状态持久化 / 在线数据
    preload.js     contextBridge 安全桥（渲染层无 Node 权限）
    smoke.js       无头自检：驱动 UI 并逐帧截图（XY_SMOKE=1 时使用）
  renderer/
    index.html     浮窗页面
    styles.css     深色玻璃拟态样式（透明窗口，卡片自带半透明底）
    app.js         UI 逻辑：选择器 / 6 格结果 / 20 组明细（原生 JS，无框架）
  core/
    calc-core.js   ★脚本生成，勿手改：上游伤害公式逐字抽取
    domain.js      配置枚举（20 组；另保留 600 组全量枚举供回归校验）/ 斩杀线求解 / 结果缓存
  data/roco-data.js ★脚本生成：内置图鉴数据
  assets/          icon.png / icon.ico
tools/
  extract-core.mjs 按行段抽取 calc-core.js（锚点校验 + vm 自检）
  build-data.mjs   生成 src/data/roco-data.js
  verify-core.mjs  回归校验（抽取保真 / 独立公式对拍 / 斩杀线语义 / 组合空间 / 性能）
  make-icon.mjs    生成图标
  start.mjs        清 ELECTRON_RUN_AS_NODE 后启动 Electron（npm start 用）
  pack.mjs         打包绿色文件夹
_intermediates/    上游源码（只读）与构建中间产物，不参与打包
```

---

## 9. 常用命令

```bash
npm start           # 运行浮窗
npm run verify      # 数值内核回归校验（离线，几十毫秒）
npm run extract     # 重新从上游抽取 calc-core.js
npm run build:data  # 重新生成内置数据包
npm run rebuild     # extract + build:data + verify 一条龙
npm run pack        # 重新打包 dist/星陨斩杀线-win32-x64/
```

无头自检（不需要盯屏幕，跑完自动退出并打印 6 格结果 + 各步截图）：

```bash
XY_SMOKE=1 ./node_modules/electron/dist/electron.exe . --no-sandbox
# 截图输出到 _intermediates/smoke-*.png
```

---

## 10. 数值内核怎么来的（可复现）

`tools/extract-core.mjs` 从 `_intermediates/upstream/calculator.js`（只读）按行段抽取：

| 段 | 行号 | 内容 |
| --- | --- | --- |
| A | 1–53 | 18 系元素表 / stripXi / elOf |
| B | 119–133 | 属性键、性格与加点常量 |
| G | 867–870 | getBuff（SKILL_MODS 内部依赖，公共清单外补抽） |
| C | 942–1020 | getFinalStat / STAB / 相性 |
| D | 2693–2764 | 特性查询、skill mod ctx、能耗 |
| E | 3356–3937 | SKILL_MODS 全表（约 130 条）、先手表、computeSkillDynamicModifiers |
| F | 3948–4051 | computeFinalDamage |

脚本对每段做首/末行锚点校验（上游漂移立即报错退出），生成后自检符号齐全、vm 加载、用真实数据跑通一次伤害。

`npm run verify` 的校验项：

1. **抽取保真**：生成文件里 7 个段与上游对应行**逐字相同**；
2. **独立实现对拍**：另写一份按规格文字重写的公式（不调用 calc-core 任何函数），在动态修正为空的场景下
   重算 skillDmg / starDmg / finalDamage / defHP，要求逐值相等（≥ 20 组 × 4 个层数）；
3. **斩杀线语义**：命中层前一层必打不死、命中层必打死、0..上限伤害单调非递减；
   快速求解（二次估计 + 局部验证）与纯二分结果完全一致；
4. **组合空间**：默认口径 5 性格 × 4 加点 = 20 组；全量枚举 30 性格（up≠down）× 20 加点 = 600 且无重复（仅回归校验用），三档靶子定义正确；
5. **性能**：主路径 2 攻方 × 3 档 × 1 套配置 = 6 次求解，全量 < 20ms；
6. **默认值**：攻击技能默认按主攻类别匹配、防御列表含「无」、手动性格覆盖生效。

求解策略（为什么快）：

- 每条组合先算 n=0；打不死再用 n=上限 判档 —— 硬靶子到这就结束，只有 2 次伤害计算；
- 确需定位时，用星陨威力 sp(n)=n²+24n−24 的二次关系估一个起点，再局部验证/二分（通常 4 次，纯二分要 6 次）；
- 最终判定始终用真实伤害计算，估计只用来选起点，结果与纯二分**逐位一致**（见校验项 3）；
- 计算用「精简精灵」：calc-core 算伤害只用到 6 项种族值 + types + 第一条特性，
  因此把 skills 裁到只剩那条特性，省掉每次计算几十次技能表查找（校验项 3 里有精简/原始逐值对拍）；
- 结果按 (攻方, 技能, 靶子, 靶子技能, 档位, 层上限) 缓存，重复查看即时返回（<1ms）。

实测（本机 i5 级 + 系统无负载时）：Node 下 6 格全量（6 次求解）约 **1ms**，明细 20 组参考约 1ms；
Electron 渲染进程内约 **80–100ms**（透明置顶窗口叠加合成开销），结果区右下角显示的是
「6 格全量」在界面空闲时的最快采样值；命中缓存后的刷新 < 1ms。

---

## 11. 打包

```bash
npm run pack
# → dist/星陨斩杀线-win32-x64/星陨斩杀线.exe（绿色文件夹，免安装）
```

- 优先 `@electron/packager`，并使用本机 Electron 缓存
  （`%LOCALAPPDATA%/electron/Cache` 里的 electron-v35.7.5-win32-x64.zip），因此打包不需要联网。
- 若 packager 因网络等原因不可用，脚本会自动回退到「手工组装」：复制 electron dist、
  放好 `resources/app`、把 electron.exe 改名为 星陨斩杀线.exe，产出同样可双击运行。
- 未内置代码签名，首次运行 SmartScreen 可能提示「未知发布者」，选「仍要运行」即可。

---

## 12. 已知限制

1. **独占全屏压不住**：只支持窗口化 / 无边框窗口全屏（见第 3 节）。
2. **愿力冲击（上游的 18 个 YUANLI_SKILLS）不在 calc-core 里**：它是上游 UI 给攻击技能列表末尾动态追加的
   「固定技能」，不属于任何精灵的 `skills`；本浮窗按规格只列精灵自带的攻击技能，因此没有该入口。
   数据里没有精灵拥有它，不影响斩杀线口径，此条仅作记录。
3. **属性 buff / 威力 chip / 连击 chip 未开放**：calc-core 里相关入口保留（shim 固定为 0），浮窗只做
   「无 buff」的标准斩杀线；上游网页通过 buff 面板调出来的伤害可能更高。
4. **透明窗口的边缘缩放不稳定**：窗口 `resizable`，但 Windows 对无边框透明窗口的鼠标边缘拖拽支持时好时坏；
   拖不到边时可先拖标题栏移动，或改 `state.json` 里的 width/height。
5. **穿透状态不接收键盘**：`Esc` 只在接管鼠标后有效；穿透时请用 `Alt+X` / `Ctrl+Alt+T` / 托盘唤回。
6. **头像来自 patchwiki 外链**：离线时头像加载失败会自动降级为属性 emoji，不影响功能。
7. **「自动最优」并列规则**：层数最小优先；同层取伤害更高者；仍并列时取组合序号靠前者。
8. **体积**：绿色文件夹约 286MB，主要是 Electron 运行时；这是「免安装 + 自带 Chromium」的代价。

---

## 13. 数据与公式出处

- 上游项目：https://github.com/Bartzh/roco-star-dmg （本地只读副本在 `_intermediates/upstream/`）
- 线上版本：https://stardmg.top
- 伤害与属性公式：`_intermediates/LEAD-SPEC.md` 第 2 节（逐字锁定，禁止改写）
