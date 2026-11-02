# 要塞射击（zombie-gunner）

> 一个《向僵尸开炮》风格的**竖屏弹幕射击手游**设计项目：**设计文档 + 可直接玩的网页 Demo + 数值校准脚本**。
> 所有玩法拆解、系统设计、数值模型均为原创，不复制任何现有游戏的美术资源（Demo 用 Canvas2D 画的几何图形占位）。

## 这是什么

- **设计文档（`docs/`）**：00–15 共 16 本分册，覆盖核心玩法、技能体系、武器与换弹、关卡波次、敌人、加成卡、局外养成、伤害公式、收益曲线、状态系统、奖励兑换、决策档案、工作路线图等。
- **换机器接手先读**：[`docs/16-进度与交接.md`](docs/16-进度与交接.md) —— 现状 / 怎么跑 / 待校准项 / 下一步，一页足够。
- **项目记忆（`memory/`）**：工作记忆的仓库镜像（长期结论 + 按日工作日志）。换机器 clone 后跑一条命令就能还原到本地记忆目录，助手直接接着干。见下方「换机器」。被 clone 下来即可读，不需要额外上下文。
- **网页 Demo（`src/`）**：可玩的竖屏射击 Demo，用来验证手感与机制，不是最终美术版。
- **数值校准脚本（根目录 `*.mjs`）**：Monte Carlo 验证 ×2.0 局外攻击纪律、加成卡倍率、弹道经济、装备/独占机制等假设值。
- **早期草稿（`docs/archive/`）**：v0.2 / v0.3 的 GDD 前身，记录设计演进。

## 跑起来

Demo 是 ES module，**必须走 http 服务**（不能双击 `index.html`）：

```bash
python3 -m http.server 8123      # 然后打开 http://localhost:8123
```

自测与平衡模拟（纯 Node，不需要浏览器）：

```bash
node src/demo/combat-core.test.mjs    # 战斗内核单测（当前 109 条）
node src/demo/balance-sim.mjs         # 无头 20 波模拟：smart 专精流 vs random 随机流
node src/demo/balance-sim.mjs --supply  # 额外打印每波经验供给表（校 XP 曲线用）
node src/demo/balance-sim.mjs --runs=100 # 放大样本做正式校准（默认 12 局只够冒烟）
```

## 目录结构

```
zombie-gunner/
├── index.html                  # Demo 入口
├── src/
│   ├── status/                 # 引擎无关状态系统（7 状态：减速/冻结/感电/灼烧/眩晕/击退/易伤）
│   │   ├── status-system.mjs   # apply / read / tick / clear / onDeath / snapshot
│   │   └── status-config.mjs
│   └── demo/
│       ├── combat-core.mjs     # 战斗内核（无 DOM 依赖，Node 可测）：开火/换弹/技能/伤害/升级选卡
│       ├── cards.mjs           # 卡池 + 经验曲线 XP_TABLE + 方案四抽卡算法
│       ├── main.mjs            # Canvas2D 渲染层 + 输入
│       ├── combat-core.test.mjs
│       └── balance-sim.mjs     # 无头平衡模拟
├── docs/                       # 00–15 设计册 + 16 进度与交接 + archive/ 早期草稿
├── memory/                     # 项目记忆镜像（MEMORY.md 长期结论 + 按日工作日志）
├── scripts/memory-sync.mjs     # 记忆同步：本地 .workbuddy/memory ⇄ 仓库 memory/
├── calibrate-*.mjs / monte-carlo.mjs   # 局外数值校准脚本
├── balance.json / mc-result.txt / numbers-v0.4.md
└── README.md
```

## 换机器

`.workbuddy/`（助手的工作记忆目录）不进仓库，所以记忆另存了一份镜像在 `memory/`。新机器上：

```bash
git clone git@github.com:Water097/zombie-gunner.git
cd zombie-gunner
node scripts/memory-sync.mjs --pull     # 把 memory/ 还原到 .workbuddy/memory/，助手即可读到
python3 -m http.server 8123
```

日常改完记忆后（写完日志/更新长期记忆），跑一次反向同步再提交：

```bash
node scripts/memory-sync.mjs            # 本地 → memory/（镜像，会清掉已删除的旧日志）
node scripts/memory-sync.mjs --check    # 只检查是否同步（有差异退出码 1）
```

`--pull` 只补不删：本地已存在且内容不同的同名文件会被跳过并提示，避免覆盖另一台机器上的新记录。

## 当前状态（2026-11-02）

- **设计侧**：00–15 全稿闭环；局外攻击 ×2.0 纪律已用 Monte Carlo 落地核账。
- **Demo 侧**：可玩。主武器 + 宠物机器人释放 4 个技能（干冰弹 / 温压弹 / 电磁天雷 / 装甲车）、20 波 20 级、三选一海克斯（学卡 / 武器卡 / 技能卡 / 加成卡 / 功能卡）、7 状态与硬门禁（冻结 → 装甲尸车 ×3）。
- **未做**：场景 Demo（阶段 3）、手感打磨（阶段 4）、其余 5 个技能（仅设计未实装）、局外养成系统。
- 所有带 `⚠️ 临时基准值` 标记的数值（碎片量 / 金币 / 经验 / 衰减斜率 / 技能数值 / 回血数值）待机器模拟游戏时统一校准。

## 运行校准脚本

```bash
node calibrate-weapon-cards.mjs
node calibrate-upgrade-reward.mjs
node calibrate-pellet-economy.mjs
node calibrate-gear-exclusives.mjs
```

## 许可证

设计文档与代码为原创内容，仅供个人学习交流使用。
