# 数值对拍报告（上游 oracle vs calc-core）

- 生成时间：2026-10-24T16:48:16.067Z
- 被测量：src/core/calc-core.js · computeFinalDamage(ctx)
- 权威源：_intermediates/upstream/calculator.html 页面内 computeFinalDamage（CDP 实测）
- 数据源：_intermediates/upstream/datas/final/*.json（622 精灵 / 824 技能 / 18 系）
- 判定标准：**逐位完全相等**（Object.is），不含任何容差

## 汇总

| 指标 | 值 |
| --- | --- |
| 用例数 | 48 |
| 通过 | 48 |
| 失败 | 0 |
| 异常 | 0 |
| 通过率 | 100% |
| 对拍字段 | finalDamage / skillDmg / starDmg / defHP |

## 失败明细

无。全部用例四项数值逐位一致。

## 诊断字段差异（不阻塞，仅供参考）

无。

## 用例清单

| # | id | 层 | 标签 | 期望 finalDamage | 实际 finalDamage | 结果 |
| --- | --- | --- | --- | --- | --- | --- |
| 0 | phys-stab-evil | 3 | 物攻,STAB,相性1 | 281 | 281 | PASS |
| 1 | phys-no-stab-dragon | 3 | 物攻,无STAB,相性0.5 | 147 | 147 | PASS |
| 2 | phys-default-bat-zero | 0 | 物攻,STAB,0层 | 105 | 105 | PASS |
| 3 | phys-eff3-fire | 2 | 物攻,STAB,相性3 | 632 | 632 | PASS |
| 4 | phys-combo2 | 4 | 物攻,连击2,无STAB | 147 | 147 | PASS |
| 5 | phys-extreme | 1 | 物攻,STAB,相性1,档③ | 266 | 266 | PASS |
| 6 | magic-stab-phantom | 5 | 魔攻,STAB,相性0.5 | 55 | 55 | PASS |
| 7 | magic-no-stab-normal | 5 | 魔攻,无STAB,相性0.5 | 123 | 123 | PASS |
| 8 | magic-dragon | 4 | 魔攻,无STAB,相性1 | 400 | 400 | PASS |
| 9 | magic-stab-eff1 | 6 | 魔攻,STAB,相性1 | 158 | 158 | PASS |
| 10 | magic-high-matk | 2 | 魔攻,STAB,档③ | 239 | 239 | PASS |
| 11 | adaptive-phys-path | 4 | 自适应,物攻路径,STAB | 187 | 187 | PASS |
| 12 | adaptive-magic-path | 5 | 自适应,魔攻路径,STAB | 126 | 126 | PASS |
| 13 | adaptive-state-25 | 2 | 自适应,应对状态,相性2 | 697 | 697 | PASS |
| 14 | eff-025 | 6 | 相性0.25 | 177 | 177 | PASS |
| 15 | eff-05 | 8 | 相性0.5 | 53 | 53 | PASS |
| 16 | eff-1 | 6 | 相性1 | 174 | 174 | PASS |
| 17 | eff-2 | 3 | 相性2,无STAB | 401 | 401 | PASS |
| 18 | eff-3 | 1 | 相性3,STAB,档③ | 741 | 741 | PASS |
| 19 | combo-2 | 5 | 连击2 | 142 | 142 | PASS |
| 20 | combo-3 | 4 | 连击3,STAB | 240 | 240 | PASS |
| 21 | combo-mod-multi | 6 | 连击,特性mod | 58 | 58 | PASS |
| 22 | combo-fire-3 | 3 | 连击3,相性2 | 227 | 227 | PASS |
| 23 | ability-zhuixing-on | 3 | 特性mod,坠星 | 325 | 325 | PASS |
| 24 | ability-zhuixing-off | 0 | 特性mod,0层 | 184 | 184 | PASS |
| 25 | ability-heti-matk | 3 | 特性mod,和弦共振 | 76 | 76 | PASS |
| 26 | ability-tianti | 7 | 特性mod,技能mod,powerAdd | 253 | 253 | PASS |
| 27 | state-dark-raid | 3 | 应对状态,powerMult2 | 265 | 265 | PASS |
| 28 | state-combo-double | 3 | 应对状态,连击翻倍 | 115 | 115 | PASS |
| 29 | state-yuanli-25 | 4 | 应对状态,powerMult2.5 | 446 | 446 | PASS |
| 30 | state-chongji-ignore | 2 | 应对状态,ignoreResist | 133 | 133 | PASS |
| 31 | defskill-03 | 5 | 防御技能 | 96 | 96 | PASS |
| 32 | defskill-05 | 7 | 防御技能 | 27 | 27 | PASS |
| 33 | chip-combo | 3 | chip,连击 | 95 | 95 | PASS |
| 34 | chip-power | 3 | chip,威力 | 330 | 330 | PASS |
| 35 | scan-medium-kill | 13 | 需多层,minKill=13,scan-medium | 541 | 541 | PASS |
| 36 | scan-medium-below | 12 | 临界未斩,minKill=13,scan-medium | 509 | 509 | PASS |
| 37 | scan-fast-zero | 0 | 0层即斩,scan-fast | 616 | 616 | PASS |
| 38 | scan-weak-magic-kill | 22 | 需多层,minKill=22,scan-weak-magic | 525 | 525 | PASS |
| 39 | scan-weak-magic-below | 21 | 临界未斩,minKill=22,scan-weak-magic | 495 | 495 | PASS |
| 40 | scan-bulky-kill | 11 | 需多层,minKill=11,scan-bulky | 612 | 612 | PASS |
| 41 | scan-bulky-below | 10 | 临界未斩,minKill=11,scan-bulky | 555 | 555 | PASS |
| 42 | scan-low-tier-kill | 5 | 需多层,minKill=5,scan-low-tier | 519 | 519 | PASS |
| 43 | scan-low-tier-below | 4 | 临界未斩,minKill=5,scan-low-tier | 454 | 454 | PASS |
| 44 | scan-combo-mod-kill | 20 | 需多层,minKill=20,scan-combo-mod | 499 | 499 | PASS |
| 45 | scan-combo-mod-below | 19 | 临界未斩,minKill=20,scan-combo-mod | 475 | 475 | PASS |
| 46 | scan-unkillable-phantom-unkillable | 99 | 不可斩,scan-unkillable-phantom | 38 | 38 | PASS |
| 47 | scan-unkillable-extreme-unkillable | 99 | 不可斩,scan-unkillable-extreme | 365 | 365 | PASS |

> 注：src/core/domain.js 加载失败（domain.js: 找不到 RocoCore（请先加载 calc-core.js）），DN 层未纳入对拍。
