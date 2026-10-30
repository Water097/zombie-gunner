# 要塞射击（zombie-gunner）— 游戏设计文档仓库

> 一个《向僵尸开炮》风格的**竖屏放置/塔防射击手游**的**原创设计文档与数值校准脚本集合**。
> 纯设计阶段项目：**目前没有任何游戏代码、没有任何像素资源、不复制任何现有游戏的美术风格**。
> 所有内容均为原创玩法拆解、系统设计、数值模型与 Monte Carlo 校准脚本，用于个人学习与验证。

## 这是什么

- **设计文档（`docs/`）**：00–15 共 16 本分册，覆盖核心玩法、技能体系、武器与换弹、关卡波次、敌人、加成卡、局外养成、伤害公式、收益曲线、状态系统、奖励兑换、决策档案、工作路线图等。
- **早期草稿（`docs/archive/`）**：v0.2 / v0.3 的 GDD 前身，记录设计演进。
- **数值校准脚本（`*.mjs`）**：用 Monte Carlo 验证 ×2.0 局外攻击纪律、加成卡倍率、弹道经济、装备/独占机制等假设值。
- **中间产物**：`balance.json`、`mc-result.txt`、`numbers-v0.4.md`、`monte-carlo.mjs` 等。

## 目录结构

```
zombie-gunner/
├── README.md
├── .gitignore
├── docs/
│   ├── 00-整体设计方案.md
│   ├── 01-核心玩法与战斗循环.md
│   ├── ... (02 ~ 15 设计册)
│   └── archive/
│       ├── gdd-v0.2.md
│       └── gdd-v0.3.md
├── calibrate-weapon-cards.mjs
├── calibrate-upgrade-reward.mjs
├── calibrate-pellet-economy.mjs
├── calibrate-gear-exclusives.mjs
├── monte-carlo.mjs
├── balance.json
├── mc-result.txt
└── numbers-v0.4.md
```

## 当前状态

- 设计侧主要模块均已出稿（含数值校准）。
- **零代码、零像素**：尚未进入场景/手感 Demo 实现阶段。
- 所有带 `⚠️ 临时基准值` 标记的数值，将在后续机器模拟游戏时再校准。

## 运行校准脚本

```bash
node calibrate-weapon-cards.mjs
node calibrate-upgrade-reward.mjs
node calibrate-pellet-economy.mjs
node calibrate-gear-exclusives.mjs
```

## 许可证

设计文档与脚本为原创内容，仅供个人学习交流使用。
