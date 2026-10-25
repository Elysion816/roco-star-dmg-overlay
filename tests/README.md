# tests/ —— 星陨斩杀线 数值对拍基础设施

QA 严过关（Yan）· 2026-10-24

本目录只做**验证**，不改 src/、不改 _intermediates/upstream/。

## 文件

| 文件 | 作用 |
| --- | --- |
| upstream-oracle.mjs | 上游权威数值 Oracle：本地静态服务 + headless Chrome + CDP，在 calculator.html 页面内直接调用 computeFinalDamage(ctx) 取权威值。可当模块用，也可 CLI 自检。 |
| gen-fixtures.mjs | 用 oracle 生成固化用例 tests/fixtures.json（覆盖性选型 + 0..99 层扫描判定 0层即斩/需多层/不可斩）。 |
| fixtures.json | 固化用例（当前 48 组），每组含 req 输入与 expected 上游返回值。**这是对拍的唯一期望来源。** |
| compare-core.mjs | 对拍：加载 src/core/calc-core.js（bindData 喂 datas/final），逐组算 finalDamage/skillDmg/starDmg/defHP，与 fixtures 逐位比较（Object.is，零容差），写 REPORT.md。 |
| REPORT.md | 对拍报告（用例数/通过数/失败明细/诊断字段差异/用例清单）。 |
| package.json / node_modules | 仅为 cd 依赖（ws），不参与打包。 |

## 前置条件

1. 上游静态服务（calculator.html 需要 http 才能 fetch datas/final）：
   - 脚本会**自动检测并复用** http://127.0.0.1:8765；没有则自己起 python -m http.server 8765（在 _intermediates/upstream 下）。
2. Chrome：默认 C:\Users\12249\.dsh\browsers\chrome-for-testing-155\win64-155.0.8059.84\chrome-win64\chrome.exe，
   可用环境变量 QA_CHROME 覆盖。
3. Node 24（已装 ws；CDP 走 ws 而不是内置 WebSocket —— Node 24.21 的 undici 在 DevTools HTTP 端点半关闭时会崩 assert(!this.paused)，故 HTTP 探测一律走 node:http）。

## 用法

    # 1) 自检 oracle（在真实页面里跑一组固定输入）
    node tests/upstream-oracle.mjs --self-test

    # 2) 重新生成 fixtures（会启动 Chrome，约 15s）
    node tests/gen-fixtures.mjs

    # 3) 对拍 + 生成报告
    node tests/compare-core.mjs

    # 4) 对拍器负向自检（突变 3 组，必须恰好检出 3 组失败，否则怀疑假通过）
    node tests/compare-core.mjs --self-check

    # 5) 只看 JSON 摘要（CI 友好，失败时退出码 1）
    node tests/compare-core.mjs --json

## fixtures.json 结构

    meta   : 生成时间、oracle 页面与上游 git 版本、靶子三档定义、攻方 profile、
             计数、扫描摘要、compareFields/diagnosticFields
    cases[]: index / id / tags / note / origin(static|scan) / req / expected

req 与 LEAD-SPEC 第 2 节 ctx 一一对应：

    attackerId, skillId, defenderId, defenseSkillId(null|'__none__'|'__state__'|技能id),
    attackerNature{up,down}, attackerIVs[3], defenderNature{up,down}, defenderIVs[3],
    starLayer, attackerCombo, attackerPowerBoost

靶子三档（固定，来自 LEAD-SPEC 1.6）：
- 档① t1：nature{up:'hp',down:'atk'}, ivs['hp','def','mdef']
- 档② t2：nature{up:'spd',down:'atk'}, ivs['hp','def','mdef']
- 档③ t3：nature{up:'spd',down:'atk'}, ivs['hp']

攻方 profile：
- phys  {up:'atk',down:'matk'}  ivs['atk','hp','spd']
- magic {up:'matk',down:'atk'}  ivs['matk','hp','spd']
- speed {up:'spd',down:'def'}   ivs['spd','atk','matk']

## 覆盖矩阵（当前 48 组）

- 伤害类别：物攻 / 魔攻 / 自适应（愿力冲击，走物攻路径与魔攻路径各一组）
- STAB：有（11 组）/ 无（5 组）
- 相性：0.25 / 0.5 / 1 / 2 / 3（各至少 1 组，含档③）
- 连击：2 连击、3 连击、多维击打（敌方每层星陨 +1 连击，最高测到 combo=100）
- 特性 mod：祭礼巨像「坠星」、离心舞者「和弦共振」、多维击打、天体吸积（powerAdd）
- 应对状态分支（防御技能 category='状态'）：暗突袭 ×2、连续爪击连击翻倍、愿力 ×2.5、虫击 ignoreResist
- 真实防御技能 reduction：贝古斯「防御」0.3、「有效预防」0.5
- UI chip：威力 +30、连击 +1
- 斩杀线：0 层即斩 3 组 / 需多层 5 组（minKillLayer 5..22）/ 不可斩 2 组（幻系技能无星陨伤害 + 低攻打高防，99 层仍不够）

## 重要说明：愿力冲击（自适应）

上游 YUANLI_SKILLS 定义在 calculator.js 890-905 行，**不在 LEAD-SPEC 第 2 节的抽取行段 A-F 内**，
所以 calc-core.js 里没有它。对拍脚本按上游定义复刻了 18 个 __yuanli_<元素>__ 技能对象再传给 core
（tests/compare-core.mjs 的 buildYuanliSkills）。若产品 UI 也要支持愿力冲击，domain.js/app.js 需要自行构造同样的对象。

## 纪律

- 不改 src/、不改 _intermediates/upstream/、不 git commit。
- 发现源码 bug：最小可复现用例 + 期望/实际 发给 lead，不自己改源码。
