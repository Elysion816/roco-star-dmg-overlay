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

《洛克王国：世界》星陨玩法的「一击斩杀线」查询浮窗：选三只攻击精灵 + 一个防御靶子，直接给出
**3 攻方 × 3 档靶子 = 9 个斩杀层数**（最少需要几层星陨印记才能一击秒杀）。9 格按卡片上选定的那套配置计算
（性格 5 档 × 加点 4 档，默认按精灵的主攻属性自动给出），点任意格子可展开该格的 20 组参考明细。

数值内核（`src/core/calc-core.js`）是从上游网页 https://stardmg.top 的 `calculator.js`
**按行段逐字抽取**的，不含任何手写重算，公式与线上版本完全一致。

---

## 1. 这是什么

- 一个 **Windows 桌面浮窗**（Electron，绿色免安装），常驻置顶，压在「无边框窗口全屏」的游戏画面上。
  **[→ 去 Releases 下载 zip](https://github.com/Elysion816/roco-star-dmg-overlay/releases/latest)**，解压后双击 `星陨斩杀线.exe` 即可运行。
- 启动默认 **接管鼠标**（可以直接点浮窗操作）；按 `Alt+X` 把鼠标交还给游戏（点击穿透），再按一次收回。
- 三档靶子固定（纯肉 / 防血能力值 / 仅血量能力值），不用每次自己调性格与加点，直接横向对比三只攻方的斩杀线。
- 第三个攻方槽位是 **多维手**：默认锁定「多维击打」（幻系 15 威力，每层星陨 +1 连击，幻系不引爆星陨）。
- 每只攻方各有一个 **攻击加成**（百分比）与 **威力加成**（数值点数）输入，用来贴合游戏里的实际 buff。
- 数据每次启动自动从 stardmg.top 拉取最新图鉴，失败自动用内置离线包。

---

## 2. 下载与启动

### 方式 A：下载现成版本（推荐 · 免安装）

打开 **[Releases](https://github.com/Elysion816/roco-star-dmg-overlay/releases/latest)**，下载最新的 zip：

```
roco-star-dmg-overlay-v1.0.2-win32-x64.zip    （约 72 MB）
roco-star-dmg-overlay-v1.0.2-win32-x64.7z     （约 63 MB，需 7-Zip / Bandizip 解压）
```

> Release 资产名使用 ASCII：GitHub 上传接口会丢掉文件名里的非 ASCII 前缀。
> 解压出来的目录仍然是 `星陨斩杀线-win32-x64/`，里面就是 `星陨斩杀线.exe`。

解压后双击里面的 **`星陨斩杀线.exe`** 即可运行。

- 免安装、免 Node，解压到任意位置或拷到别的机器都能直接用（Windows x64）
- 解压后约 224MB，主要体积是 Electron 运行时本身（Chromium + Node，其中 exe 本体 192MB）
- 未做代码签名，首次运行 Windows SmartScreen 可能提示「未知发布者」→ 点「更多信息 → 仍要运行」

### 方式 B：从源码运行

```bash
git clone https://github.com/Elysion816/roco-star-dmg-overlay.git
cd roco-star-dmg-overlay
npm install     # 首次；只装 electron 35.7.5 与 @electron/packager（devDependencies）
npm start       # 已内置 tools/start.mjs：会先清掉 ELECTRON_RUN_AS_NODE 再拉起 Electron
```

> `npm start` 走的是 `tools/start.mjs`。某些 IDE / 终端 / 沙箱会带上 `ELECTRON_RUN_AS_NODE=1`，
> 那会让 electron 以「纯 Node」模式运行（窗口起不来，报 `Cannot read properties of undefined (reading 'requestSingleInstanceLock')`），
> 这个脚本会先把该变量摘掉。**手动敲 electron 命令时也要注意这点**（见第 9 节）。

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
| `Ctrl+Shift+M` | 收成小条（只剩标题 + 9 格摘要 + 靶子按钮 + 搜索框 + ⋯ 菜单）/ 展开 |
| 小条里的 `⋯` | 下拉菜单：快捷键 / 切穿透·接管 / 展开面板 / 关闭浮窗 |
| `Esc` | 按「小条菜单 → 精灵选择器 → 明细面板」的顺序逐层关闭；都关着时「交还鼠标，回到穿透」 |
| 托盘图标 | 左键＝呼出/接管；右键＝显示/隐藏、穿透、小条、重新拉取数据、打开数据目录、退出 |

启动后默认 **接管鼠标**（可以直接点浮窗）。不想挡游戏操作时按 `Alt+X` 或 `Ctrl+Alt+T` 交还鼠标（点击穿透），
再按一次收回；操作完也可以按 `Esc` 交还。

> 穿透状态下窗口不接收键盘和点击（Windows `setIgnoreMouseEvents` 的语义），
> 只能用全局快捷键或托盘唤回。

> 收起小条与展开都会**强制回到接管态**：46px 的条如果还在穿透，点了没反应会让人以为坏了；
> 展开后若仍是穿透，等于「展开了却不能点」。要交还鼠标请按 `Esc` / `Alt+X` / `Ctrl+Alt+T`。

---

## 5. 界面说明

1. **标题栏**：★ 星陨斩杀线 · 数据来源（内置数据 / 在线数据）· ⌘ 快捷键一览 · 穿透状态（按钮显示「穿透」或「接管中」）· 收起 · 关闭。整条可拖动移动窗口。
   点 ⌘ 展开**快捷键面板**（键帽样式列出 Alt+X / Ctrl+Alt+T / Ctrl+Shift+M / Esc 四条）。
2. **攻方① / 攻方② / 多维手（攻③）**
   - 点精灵按钮弹出选择器：**先按属性筛选，再点选**；也能直接输入名字 / 全拼 / 首字母 / 图鉴号
     （`lxpe` → 龙息帕尔，`1` → 图鉴号 1）。
   - 技能下拉：只列该精灵的**攻击技能**，标注「威力 / 物攻·魔攻 / 连击」；
     默认取 **与主攻类别（物攻 或 魔攻，看种族值更高的一侧）一致** 的技能里威力最高者，
     与主攻不符的技能会加后缀「与主攻不符」提示（这不影响你手动选择——选了就按你选的算）。
   - 配置下拉：**性格** 5 档（Z1 物攻↑魔攻↓ / Z2 魔攻↑物攻↓ / Z3 物攻↑ / Z4 魔攻↑ / Z5 不加攻）
     + **加点** 4 档（J1 物攻向 / J2 魔攻向 / J3 双攻 / J4 无攻）。
     没有「自动最优」这一档：**默认按精灵主攻属性给 Z1+J1（物攻手）或 Z2+J2（魔攻手）**，
     手动改过之后换精灵也保留你的选择，卡片底部小字实时显示当前生效的档位。
   - **攻击加成**：百分比，范围 −100% ~ +300%，按钮步进 ±50%，也可直接输入任意整数。
     进内核的 `attackerBuff`，按百分比放大攻方的攻击/魔攻终值。
   - **威力加成**：**数值点数**（不是百分比），范围 −100 ~ +300，按钮步进 **±20 威力**，也可直接输入。
     直接加到技能基础威力上（威力 200 的技能 +20 → 220），进内核的 `attackerPowerBoost`。
     负加成最多把威力压到 0，不会出现负威力。
     两者非 0 时输入框高亮，卡片底部与摘要（如「威力+40」）会单独标出。
3. **靶子**：同款选择器 + 防御技能下拉（含「无」与减伤百分比）。靶子性格/加点固定三档：
   - 档①「纯肉」：性格 生命↑物攻↓，加点 生命/物防/魔防
   - 档②「防血能力值」：性格 速度↑物攻↓（防御三维无加成），加点 生命/物防/魔防
   - 档③「仅血量能力值」：性格 速度↑物攻↓，加点 仅生命
4. **9 格结果（3 攻方 × 3 档）**：大号数字＝最少需要几层星陨印记才能一击秒杀。
   超出层上限时显示 **`{上限}+`**（如层上限 50 就是 `50+`，红色），表示该上限内打不死、实际需要更多层或永远打不死。
   性格写在这一行的行头（该行 3 格共用同一套性格+加点），格子里是层数 + 右上角加点角标 + 下方 0 层伤害占靶子 HP 的比例。
   配色：0 层绿、1–2 层青、3–5 层金、6 层以上橙、超出上限红。
   结果区下方左侧给一句「最快：攻① × 档② → N 层」，右侧是本次全量求解耗时与层上限选择。
5. **点格子 → 明细面板**（该「攻方 × 档」的全部 20 组参考）
   - 分组清单：按斩杀层数分组（0 层 / 1 层 / … / 超出上限），可折叠；标「当前」的是当前配置那一组；
   - 矩阵视图：行＝性格 Z1–Z5、列＝加点 J1–J4，共 20 格，格子＝层数；点击任意格会加白色描边并在底部显示该组合详情，被过滤器排除的格变暗；
   - 三个过滤器：只看攻击型性格 / 只看可斩杀 / 加点含攻击属性（可叠加，矩阵里以变暗表示被过滤）。
6. **层上限**：结果区右下角可切换 5/10/15/20/30/50/99（默认 50），超过上限即显示 `{上限}+`。

### 多维手（攻③）

第三个攻方槽位是「多维手」，专为**多维击打**这类「随星陨层数涨连击」的技能准备：

- 默认精灵取「常用攻方里带多维击打、且魔攻最高」的一只（当前是粉耳星兔，魔攻 148）；
- 该槽位选中带多维击打的精灵时，技能下拉**默认锁到多维击打**（仍可手选别的）；
- 多维击打是**幻系**技能，幻系不引爆星陨印记，所以该行**只有技能伤害、没有星陨引爆伤害**，
  伤害随层数近似线性增长（连击数 = 层数 + 1）。

### 小条模式

`Ctrl+Shift+M` 收成 46px：

- 左侧 = 三个攻方的 9 格摘要（名字可截断，数字始终完整）；
- 中间 = **靶子按钮**（点开按属性挑守方）+ **搜索框**（输名字/拼音，选中后自动收回 46px 并重算）；
- 右侧**只剩 ⋯ 一个按钮**：原来的「⌘ 快捷键 / 穿透·接管 / 收起·展开 / 关闭浮窗」四个按钮全部收进下拉菜单，
  菜单项文案随状态变化（「切到穿透 ↔ 切到接管」「展开面板 ↔ 收成小条」）。
  菜单打开时窗口从 46px 临时撑到「标题栏 + 菜单」的实际高度（约 160–320px，随菜单内容自适应），
  选完 / 点外部 / 按 Esc 自动收回 46px。
- 展开态不受影响：四个按钮照旧平铺在标题栏右侧。
- 搜索框右侧有一个**状态圆点**（不带文字，只占 14px）：金色实心＝接管鼠标，红色空心＝点击穿透；
  点一下即可切换。鼠标悬停时圆点会微放大。
- 字号比展开态大一号（数字 15px / 名字 11.5px / 控件高 26px），把 38px 的条撑满；
  窗口变窄时自动降档（≤600px / ≤520px 两级）。
- 搜索框 620 宽下占 56px、守方按钮 64px（都被压缩过），把空间让给三个攻方：
  **全两位数斩杀线**（如 `30 / 27 / 25`、`50+ / 48 / 42`）在 620 / 560 / 500 三个宽度下都能完整显示，
  实测第三项右边缘均未越界。

---

## 6. 数据：启动自动更新 + 离线兜底

- **内置包**：`src/data/roco-data.js`（622 只精灵 / 824 个技能 / 18 系，离线首启即可用）。
- **每次启动自动拉取**（主进程执行，只认 `stardmg.top`；GitHub Pages 那份是旧版，已禁用）：
  `https://stardmg.top/datas/final/{sprites,skills,types,others}.json`
  - 超时 **3 秒**；
  - 校验：JSON 可解析、sprites ≥ 100 条且每条含 id/hp/atk/types、skills 非空、types ≥ 18 系、拒绝重定向到站外；
  - 通过 → 通过 IPC 热替换渲染层数据（标题栏显示「在线数据」）；
  - 同时把四个 JSON 落盘到 `%APPDATA%/星陨斩杀线/data/`，**仅供排查与手工取用，启动时不会读回**；
  - 任何失败 → **静默回落内置包**（标题栏显示「内置数据」），不影响使用。
- 手动重拉：托盘右键 → 重新拉取在线数据。

---

## 7. 状态持久化

`%APPDATA%/星陨斩杀线/state.json` 保存：窗口位置与尺寸（含是否被用户手动拖高过）、四槽（三攻方 + 靶子）精灵与技能、
攻方性格与加点（含是否手动改过）、攻击加成与威力加成、层上限（及是否手动改过）。
> 旧存档里的「威力加成」是百分比口径（`powerPct`），与现在的「威力点数」（`powerAdd`）不可换算，升级时会**归零**。
关窗写盘，下次启动原样恢复。

---

## 8. 目录结构

```
src/
  main/
    main.js        主进程：透明置顶窗口 / 穿透状态机 / 全局快捷键 / 托盘 / 状态持久化 / 在线数据
    preload.js     contextBridge 安全桥（渲染层无 Node 权限，只暴露白名单方法）
    smoke.js       无头自检：驱动 UI 并逐帧截图（XY_SMOKE=1 时使用）
  renderer/
    index.html     浮窗页面
    styles.css     深色玻璃拟态样式（透明窗口，卡片自带半透明底）
    app.js         UI 逻辑：选择器 / 9 格结果 / 20 组明细 / 小条（原生 JS，无框架）
  core/
    calc-core.js   ★脚本生成，勿手改：上游伤害公式逐字抽取
    domain.js      配置枚举（20 组；另保留 600 组全量枚举供回归校验）/ 斩杀线求解 / 结果缓存
  data/roco-data.js ★脚本生成：内置图鉴数据
  assets/          icon.png / icon.ico
tools/
  extract-core.mjs 按行段抽取 calc-core.js（锚点校验 + vm 自检）
  build-data.mjs   生成 src/data/roco-data.js
  verify-core.mjs  回归校验（抽取保真 / 独立公式对拍 / 斩杀线语义 / 组合空间 / 性能 / 默认值）
  diag.mjs         一键取证：启动 XY_DIAG → 收起小条 → 桌面截图 → 退出
  make-icon.mjs    生成图标
  start.mjs        清 ELECTRON_RUN_AS_NODE 后启动 Electron（npm start 用）
  pack.mjs         打包绿色文件夹
tests/             上游权威值对拍（不参与打包，独立依赖 ws，见 tests/README.md）
  upstream-oracle.mjs  本地 http + headless Chrome + CDP，在真实页面里取 computeFinalDamage
  gen-fixtures.mjs     生成固化用例 tests/fixtures.json
  compare-core.mjs     逐位对拍 + 写 REPORT.md；--self-check 负向自检，--json CI 友好
  perf-bench.mjs       性能基准
start-debug.bat    带 XY_DEBUG=1 启动已打包的绿色版（排查白块/残影用）
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
npm run make:icon   # 重新生成 src/assets/icon.png 与 icon.ico
npm run pack        # 重新打包 dist/星陨斩杀线-win32-x64/
npm run diag        # 一键取证（自动收起小条并截桌面图，产物在 _intermediates/）
```

`extract` 与 `build:data` 都是**确定性**的：输入不变则产物逐字节不变（可以放心重跑、看 `git diff` 为空）。

### 无头自检（不需要盯屏幕）

```bash
# 本机若带 ELECTRON_RUN_AS_NODE=1，必须先清掉（bash）
ELECTRON_RUN_AS_NODE= XY_SMOKE=1 ./node_modules/electron/dist/electron.exe . --no-sandbox
# 截图与结果输出到 _intermediates/smoke-*.png，跑完自动退出
```

`smoke.js` 会依次驱动：选精灵 → 搜索 → 明细 → 矩阵 → 换靶子 → 小条与守方菜单 → 穿透/展开各种组合，
每一步都截图并**统计不透明像素占比与非透明包围盒**——「整窗变透明」「内容越出窗口」这类合成问题会直接体现在数字上。

> 在**打包版**里跑自检时要加 `XY_SMOKE_OUT=<外部目录>`：打包版的截图根目录是
> `resources/app`，不指定就会把 50+ 张截图写进绿色包。

### 与上游页面逐位对拍（tests/）

`npm run verify` 只证明「抽取没走样 + 自己跟自己对得上」；`tests/` 那套是拿**真实上游页面**当权威值：

```bash
cd tests && npm install        # 只装 ws（tests/node_modules 不入库）

node tests/compare-core.mjs    # 48 组固化用例逐位对拍，结果写入 tests/REPORT.md
node tests/compare-core.mjs --self-check   # 负向自检：故意扰动 3 组，必须恰好检出 3 组失败
node tests/compare-core.mjs --json         # CI 友好摘要，失败退出码 1
node tests/perf-bench.mjs      # 性能基准
```

前置条件与细节（Chrome 路径可用 `QA_CHROME` 覆盖、8765 静态服务会自动检测复用、
fixtures 的覆盖矩阵与 req 字段）见 `tests/README.md`。注意：`compare-core.mjs` 会重写 `tests/REPORT.md` 的生成时间。

当前结果：**48/48 逐位相等**（`Object.is`，零容差），对拍字段 finalDamage / skillDmg / starDmg / defHP。

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
生成文件头部记录了上游 `sha256`，可与 `_intermediates/upstream/calculator.js` 直接比对。

`npm run verify` 的校验项：

1. **抽取保真**：生成文件里 7 个段与上游对应行**逐字相同**；
2. **独立实现对拍**：另写一份按规格文字重写的公式（不调用 calc-core 任何函数），在动态修正为空的场景下
   重算 skillDmg / starDmg / finalDamage / defHP，要求逐值相等（≥ 20 组 × 4 个层数）；
3. **斩杀线语义**：命中层前一层必打不死、命中层必打死、0..上限伤害单调非递减；
   快速求解（二次估计 + 局部验证）与纯二分结果完全一致；精简精灵与原始精灵逐值一致；
4. **组合空间**：默认口径 5 性格 × 4 加点 = 20 组；全量枚举 30 性格（up≠down）× 20 加点 = 600 且无重复（仅回归校验用），三档靶子定义正确；
5. **性能**：主路径 3 攻方 × 3 档 × 1 套配置 = 9 次求解，冷启动 **< 100ms**（实际约 2ms）；
6. **默认值**：攻击技能默认按主攻类别匹配、防御列表含「无」、手动性格覆盖生效。

求解策略（为什么快）：

- 每条组合先算 n=0；打不死再用 n=上限 判档 —— 硬靶子到这就结束，只有 2 次伤害计算；
- 确需定位时，用星陨威力 sp(n)=n²+24n−24 的二次关系估一个起点，再局部验证/二分（通常 4 次，纯二分要 6 次）；
- 最终判定始终用真实伤害计算，估计只用来选起点，结果与纯二分**逐位一致**（见校验项 3）；
- 计算用「精简精灵」：calc-core 算伤害只用到 6 项种族值 + types + 第一条特性，
  因此把 skills 裁到只剩那条特性，省掉每次计算几十次技能表查找（校验项 3 里有精简/原始逐值对拍）；
- 结果按 (攻方, 技能, 靶子, 靶子技能, 档位, 加成, 层上限) 缓存，重复查看即时返回（<1ms）。

实测（本机 i5 级 + 系统无负载时）：Node 下 9 格全量（9 次求解）约 **2ms**，明细 20 组参考约 0.1ms；
Electron 渲染进程内约 **80–100ms**（透明置顶窗口叠加合成开销），结果区右下角显示的是
「9 格全量」在界面空闲时的最快采样值；命中缓存后的刷新 < 1ms。

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
打包脚本会在产出后做两件事：

1. **清理**：删掉 `resources/app` 里误入的 `_intermediates` / `tests` 等目录；
   这些目录通常是被 `XY_SMOKE` 自检写进去的（打包版的截图根目录是 `resources/app`）。
2. **瘦身**（默认开启）：见下节。

### 产物体积

| 形态 | 体积 |
| --- | --- |
| 绿色文件夹 | 约 224 MB（未瘦身 285 MB） |
| zip（LZMA） | 约 72 MB（未瘦身 deflate 112 MB） |
| 7z（LZMA2） | 约 63 MB |

### 瘦身做了什么

`tools/pack.mjs` 的 `slimPack()` 只删**确认非运行必需**的文件，每一项都在本机跑过完整的
`XY_SMOKE` 自检（9 格出数 / 明细 20 组 / 矩阵 20 格 / 小条 46px 无横向溢出 / 透明窗口不透明占比 0.498 / 快捷键）：

| 删除项 | 原始体积 | 依据 |
| --- | --- | --- |
| `locales/*.pak` 除 zh-CN / zh-TW / en-US / en-GB 外 51 个 | 40.2 MB | 界面自绘中文，语言包只影响 Chromium 内置文案与字体回退 |
| `LICENSES.chromium.html` | 11.7 MB | Chromium 许可全文；仓库 LICENSE 已含第三方声明 |
| `vk_swiftshader.dll` + `vulkan-1.dll` | 6.2 MB | Vulkan 软件渲染回退，有显卡的正常机器不加载 |
| `d3dcompiler_47.dll` | 4.7 MB | 系统自带同名文件（`C:\Windows\System32`），删除 local 副本走系统 |

开关：

```bash
XY_PACK_NO_SLIM=1 npm run pack         # 完全不瘦身
XY_PACK_KEEP_LICENSES=1 npm run pack   # 瘦身但保留 Chromium 许可全文
```

> **兼容性取舍**：删掉 Vulkan/SwiftShader 后，在「无可用 GPU 且需要软件渲染」的老机器或
> 部分虚拟机上可能启动异常。若目标机器不确定，用 `XY_PACK_NO_SLIM=1` 出全量包。
>
> **未采用的方案**：UPX 压缩 `星陨斩杀线.exe` 能把 192 MB 压到 58 MB（-70%），但本机实测
> **段错误（exit 139）**——Chromium 的 V8 快照与自解压外壳不兼容，已放弃。

---

## 12. 已知限制

1. **独占全屏压不住**：只支持窗口化 / 无边框窗口全屏（见第 3 节）。
2. **愿力冲击（上游的 18 个 YUANLI_SKILLS）不在 calc-core 里**：它是上游 UI 给攻击技能列表末尾动态追加的
   「固定技能」，不属于任何精灵的 `skills`；本浮窗按规格只列精灵自带的攻击技能，因此没有该入口。
   内置数据里没有任何精灵携带它，不影响斩杀线口径，此条仅作记录。
3. **连击 chip 未开放**：攻击加成（属性 buff）与威力加成已经做了输入框（见第 5 节第 2 条），但连击修正仍固定为 0，
   上游网页通过连击面板调出来的伤害可能不同。
4. **矩阵视图的两种描边**：当前生效的配置那格是**青色描边**（`.mcell.is-sel`），点击选中的格是**白色描边**
   （`.mcell.is-pick`）。`.mcell.is-best`（金框＝最优组合）样式已预留，但代码目前不会给它加 class。
5. **在线数据只写不读**：拉取成功的数据会落盘到 `%APPDATA%/星陨斩杀线/data/`，但启动时不读回，
   断网启动始终使用内置包（内置包与线上版本可能有版本差）。
6. **透明窗口的边缘缩放不稳定**：窗口 `resizable`，但 Windows 对无边框透明窗口的鼠标边缘拖拽支持时好时坏；
   拖不到边时可先拖标题栏移动，或改 `state.json` 里的 width/height。
7. **穿透状态不接收键盘**：`Esc` 只在接管鼠标后有效；穿透时请用 `Alt+X` / `Ctrl+Alt+T` / 托盘唤回。
8. **头像来自 patchwiki 外链**：离线时头像加载失败会自动降级为属性 emoji，不影响功能。
9. **选择器列表默认只渲染前 200 只**（共 622）：输入搜索词会跨全量匹配。
10. **体积**：绿色文件夹约 224MB（瘦身后），主要是 Electron 运行时（exe 本体就有 192MB）；
    这是「免安装 + 自带 Chromium」的代价，换 Electron 以外的方案才能进一步下降。

---

## 13. 数据与公式出处

- 上游项目：[Bartzh/roco-star-dmg](https://github.com/Bartzh/roco-star-dmg)（本地只读副本在 `_intermediates/upstream/`）
- 线上版本：<https://stardmg.top>
- 伤害与属性公式：`_intermediates/LEAD-SPEC.md` 第 2 节（逐字锁定，禁止改写），
  对应生成文件 `src/core/calc-core.js`（头部记录了上游 `calculator.js` 的 sha256）
- 图鉴数据：上游 `datas/final/{sprites,skills,types,others}.json` → 生成 `src/data/roco-data.js`
  （622 只精灵 / 824 个技能 / 18 系）
- 原始数据与许可：数据出自 [BWiki 洛克王国 Wiki](https://wiki.biligame.com/nrc/)，按 **CC BY-NC-SA 4.0** 使用；
  本仓库代码以 MIT 发布，第三方声明的完整清单见 [LICENSE](LICENSE)

> 重新生成：`npm run extract`（抽取公式）+ `npm run build:data`（生成数据包），两者都是确定性的，
> 通常用 `npm run rebuild` 一条龙跑完并自动校验。

