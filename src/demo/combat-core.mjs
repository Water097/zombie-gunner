// 要塞射击 Web Demo —— 战斗内核（引擎无关，node 与浏览器通用）
// 直接复用 14 册状态系统 src/status/status-system.mjs，做到 1:1 复用、零逻辑分叉。
//
// 本文件不含任何 DOM / Canvas 代码，只维护一个世界状态对象 world 并提供纯函数：
//   createWorld()            —— 新建一局
//   update(world, dtMs)      —— 推进一帧（移动 / 开火 / 换弹 / 状态结算 / 碰撞 / 波次 / 要塞受击）
//   castSkill(world, id)     —— 释放技能（干冰 / 温压 / 电磁）
//   manualReload(world)      —— 手动换弹
//   chooseCard(world, i)     —— 选卡（三选一，暂停时调用）
// 渲染层（main.mjs）只读取 world 并画出来；输入层只调用上面这些函数。
//
// 设计纪律对齐：局外输出纪律、状态单一真相源、施加与结算分离，在这里同样成立——
// 内核只"申请施加"状态（apply），从不自己存状态；伤害结算只问 status-system。

import {
  makeEnemy, apply, has, read, tick, onDeath, clear,
  vehicleRammedMultiplier, getKnockDistance, applyKnockToPosition,
} from '../status/status-system.mjs';
import { CARDS, MERCY_CARD, rollCards, MAX_LEVEL, xpForLevel } from './cards.mjs';

// ── 世界尺寸（逻辑像素，竖屏）──
export const WORLD = { W: 450, H: 800 };

// ── 一局结构（03 册：局内等级 1→20；用户约定共 20 波，第 19 波前后到 20 级，最后一波收尾）──
export const RUN = { maxWave: 20, waveMs: 22000, maxLevel: MAX_LEVEL };

// ── 要塞炮塔（玩家）基准参数 ──
export const PLAYER = {
  x: WORLD.W / 2,
  y: WORLD.H - 92,       // 要塞位于屏幕下方（玩家前方），下方留出墙体放要塞血条
  baseDamage: 20,         // 每发基础伤害：普通僵尸 60 血 → 3 发一只
  fireIntervalMs: 500,    // 射速：1 秒 2 发
  magSize: 30,            // 弹匣固定 30（用户决定：不随卡变化）
  reloadMs: 1600,         // 换弹耗时
  range: 560,             // 自动瞄准射程
  bulletSpeed: 700,       // 子弹速度 px/s
  bulletRadius: 5,
  bulletPierce: 2,        // 初始穿透 2：可穿透第一个敌人打到第二个
  petOffset: { dx: 52, dy: -4 }, // 宠物机器人站位（玩家右侧悬浮，对齐参考视频），技能全部由它释放
};

// ── 要塞：位于玩家前方，敌人抵达后停在防线前持续攻击（不是撞上去就消失）──
export const FORTRESS = {
  maxHp: 300,
  regenPerSec: 2,            // 常驻缓回（设计册"要塞生命回复"）：漏怪掉血可被清场扳回，压迫变成拉锯而非瞬间崩盘
  attackLine: WORLD.H - 152, // 敌人推进到此线即停住，转为攻击姿态
};

// 宠物机器人位置：技能弹的发射原点（玩家对象只管主武器射击与换弹）
export function petPos(world) {
  const p = world.player;
  return { x: p.x + PLAYER.petOffset.dx, y: p.y + PLAYER.petOffset.dy };
}

// ── 敌人类型（对齐 14 册 targetType 与 04 册出怪纪律）──
// 新增 atkDmg / atkIntervalMs：抵达要塞后的攻击力与攻击频率
// 行为标记（05 册八种＋蜂群）：
//   swarm     蜂群：极小成片、横向铺开、数量即血条；死亡不产尸爆（锁死温压连锁反向超神）
//   standoff  远程兵：推进到 standoffFrac·H 处停住，向要塞喷吐弹丸（不冲线）
//   bomber    自爆兵：抵线即爆，造成大额要塞伤害后消失
//   flyer     飞行兵：air=true，悬浮直线飞向要塞（Demo 内无地面阻挡，行为等同直线推进，仅渲染有翼）
//   splitter  分裂兵：死亡裂成 2 只小兵，子代 splitChild=true 不再分裂（防递归）
export const ENEMY_TYPES = {
  zombie:  { name: '普通僵尸', targetType: 'normal',  hp: 60,  speed: 14, radius: 16, color: '#7fb069', score: 60,  xp: 10, atkDmg: 4,  atkIntervalMs: 1500 },
  runner:  { name: '疾行尸',   targetType: 'normal',  hp: 40,  speed: 30, radius: 12, color: '#e9c46a', score: 45,  xp: 12, atkDmg: 3,  atkIntervalMs: 1200 },
  armored: { name: '装甲尸车', targetType: 'armored', hp: 300, speed: 10, radius: 24, color: '#577590', score: 200, xp: 40, atkDmg: 9, atkIntervalMs: 2000, vehicleLevel: 20 },
  // ── 05 册八种：下列 5 种为 2026-11-03 补齐（数值阶段统一校准，当前为临时基准值）──
  swarm:   { name: '蜂群',     targetType: 'normal',  hp: 9,   speed: 34, radius: 5,  color: '#c9a83a', score: 8,   xp: 5,  atkDmg: 2,  atkIntervalMs: 1500, swarm: true, noCorpseBoom: true },
  ranged:  { name: '远程尸',   targetType: 'normal',  hp: 35,  speed: 16, radius: 13, color: '#9d8ec4', score: 70,  xp: 14, atkDmg: 5,  atkIntervalMs: 1800, standoff: true, standoffFrac: 0.34 },
  bomber:  { name: '自爆尸',   targetType: 'normal',  hp: 30,  speed: 22, radius: 15, color: '#ff6b4a', score: 60,  xp: 10, atkDmg: 0,  atkIntervalMs: 0,    bomber: true, boomDmg: 40 },
  flyer:   { name: '飞行尸',   targetType: 'normal',  hp: 28,  speed: 24, radius: 12, color: '#8fd0e8', score: 55,  xp: 12, atkDmg: 3,  atkIntervalMs: 1400, flyer: true, air: true },
  splitter:{ name: '分裂尸',   targetType: 'normal',  hp: 70,  speed: 14, radius: 19, color: '#a8c66c', score: 90,  xp: 16, atkDmg: 4,  atkIntervalMs: 1500, splitter: true },
};

// ── 波次压力曲线（2026-11-03 实装，对齐 04 册 §三 职能表）──
// 04 册那张 20 波职能表（起手/热身/引入/精英峰/上升/喘息×2/高压 16-18/清算/尸墙）一直没进 Demo，
// 之前是匀速出怪 → 赢的局全程满血、零起伏。现在落成"密度峰谷 + 两次喘息"。
// 设计纪律（04 册 §七 + 用户 2026-11-03 拍板）：以密度为主、血量为辅；逐波显式系数，不套公式。
//   **初版一局（20 波）总阵容上限 = 5 种**（普通·疾行·装甲·自爆·远程），非 8 种齐发；
//   蜂群/飞行/分裂已定义并留作后续章节，本轮不进场。每波渐进引入、后期轮替，锚定 Build 维度：
//     - 波 1-3 只普通+疾行（教学 / 快速兵）→ 波 4 引入自爆 → 波 9 引入远程+装甲（齐 5 种）
//     - 波 8、14 两次喘息落潮；波 12/16/19 轮替时抽掉普通制造重甲压制感
//   composition：各敌人权重（zombie/runner/armored/ranged/bomber，不需归一化，轮盘赌自动归一）
//   batch：本批出怪只数；extraChance：本批额外 +1 只的概率（制造疏密抖动）
//   interval：出怪间隔(ms)；name：职能标签（未来波次预告 UI 用）；breath：喘息波标记
// 单体成长（hpScale/spdScale/atkScale，见 makeEnemyEntity）仍随波次连续抬升（"更多但更软"方向不变），
// 此处只塑密度骨架——密度峰谷 + 两次落潮，把"差点没守住"的紧张感做出来。
export const WAVE_SCRIPT = [
  { name: '起手',     composition: { zombie: 1.00 },                                                            batch: 1, extraChance: 0.00, interval: 1100, breath: false }, // 1  教学：最稀，看清枪在打什么（1 种）
  { name: '热身',     composition: { zombie: 0.75, runner: 0.25 },                                              batch: 2, extraChance: 0.00, interval: 1000, breath: false }, // 2  密度缓升，出现快速兵（2 种）
  { name: '热身',     composition: { zombie: 0.65, runner: 0.35 },                                              batch: 2, extraChance: 0.20, interval: 950,  breath: false }, // 3  前 2-3 次升级，Build 有雏形（2 种）
  { name: '引入·自爆',composition: { zombie: 0.55, runner: 0.30, bomber: 0.15 },                                batch: 2, extraChance: 0.20, interval: 900,  breath: false }, // 4  首次出现自爆兵（爆发/单体考验，3 种）
  { name: '精英峰',   composition: { zombie: 0.45, runner: 0.35, bomber: 0.20 },                                batch: 3, extraChance: 0.30, interval: 850,  breath: false }, // 5  第一个压力峰（3 种）
  { name: '上升',     composition: { zombie: 0.50, runner: 0.40, bomber: 0.10 },                                batch: 2, extraChance: 0.20, interval: 880,  breath: false }, // 6  密度爬坡（3 种）
  { name: '上升',     composition: { zombie: 0.45, runner: 0.45, bomber: 0.10 },                                batch: 3, extraChance: 0.30, interval: 820,  breath: false }, // 7  建立"越来越挤"预期（3 种）
  { name: '喘息',     composition: { zombie: 0.65, runner: 0.30 },                                              batch: 1, extraChance: 0.20, interval: 1200, breath: true  }, // 8  密度骤降（≈基线一半，2 种）
  { name: '引入·远程/装甲',composition: { zombie: 0.40, runner: 0.30, bomber: 0.10, ranged: 0.12, armored: 0.08 }, batch: 3, extraChance: 0.30, interval: 820,  breath: false }, // 9  齐 5 种（上限），远程/装甲引入
  { name: '精英峰',   composition: { zombie: 0.30, runner: 0.35, bomber: 0.10, ranged: 0.13, armored: 0.12 },     batch: 3, extraChance: 0.40, interval: 750,  breath: false }, // 10 中段大考（5 种）
  { name: '上升',     composition: { zombie: 0.28, runner: 0.38, bomber: 0.12, ranged: 0.12, armored: 0.10 },     batch: 3, extraChance: 0.40, interval: 760,  breath: false }, // 11 密度继续爬（5 种）
  { name: '轮替·装甲流',composition: { runner: 0.34, zombie: 0.16, bomber: 0.13, ranged: 0.15, armored: 0.22 }, batch: 3, extraChance: 0.40, interval: 740,  breath: false }, // 12 轮替：装甲温和抬升（5 种）
  { name: '上升',     composition: { zombie: 0.30, runner: 0.35, bomber: 0.10, ranged: 0.15, armored: 0.10 },     batch: 3, extraChance: 0.40, interval: 740,  breath: false }, // 13 密度继续爬（5 种）
  { name: '喘息',     composition: { zombie: 0.50, runner: 0.40 },                                              batch: 2, extraChance: 0.20, interval: 1150, breath: true  }, // 14 第二次呼吸（2 种）
  { name: '高压',     composition: { zombie: 0.22, runner: 0.40, bomber: 0.13, ranged: 0.10, armored: 0.15 },     batch: 3, extraChance: 0.40, interval: 720,  breath: false }, // 15 终局前最后一道坎（5 种）
  { name: '轮替·装甲流',composition: { runner: 0.36, zombie: 0.14, bomber: 0.12, ranged: 0.18, armored: 0.20 }, batch: 3, extraChance: 0.40, interval: 720,  breath: false }, // 16 轮替：装甲温和抬升（5 种）
  { name: '高压',     composition: { zombie: 0.20, runner: 0.38, bomber: 0.12, ranged: 0.15, armored: 0.15 },     batch: 3, extraChance: 0.40, interval: 700,  breath: false }, // 17 满屏压力（5 种）
  { name: '高压',     composition: { zombie: 0.15, runner: 0.40, bomber: 0.12, ranged: 0.18, armored: 0.15 },     batch: 3, extraChance: 0.40, interval: 700,  breath: false }, // 18 满屏压力（5 种）
  { name: '清算',     composition: { runner: 0.33, zombie: 0.10, bomber: 0.15, ranged: 0.15, armored: 0.27 },     batch: 3, extraChance: 0.35, interval: 700,  breath: false }, // 19 清算前最后一道坎（5 种）
  { name: '尸墙',     composition: { zombie: 0.12, runner: 0.40, bomber: 0.12, ranged: 0.16, armored: 0.20 },     batch: 3, extraChance: 0.35, interval: 680,  breath: false }, // 20 最高密度收尾（5 种）
];

// 整体密度微调旋钮（不影响峰谷相对形状，只把所有波的间隔等比例缩放）：
// 1.0 = 剧本原值；>1 降低整体密度（拉回可玩基线）。当前 1.2：装甲车等守线技能实装后机制已 drift，
// 16 册基线（smart 87%/random 77%）是旧代码测的，现版需整体降一档才能回到可玩区间。
const SPAWN_INTERVAL_TUNE = 1.2;

// ── 三技能（9 技能里的代表：冰弹穿透 / 温压爆炸 / 电磁天雷）──
// 对齐 02 册：每个技能是"独立攻击体系"，不是要塞静态光环。
// 设计形态（2026-11-02 用户重定电磁）：温压=点→圆（落点爆炸）／干冰=点→小圆（穿透弹）／
//   电磁=锁敌天雷——随机锁定场上一个敌人，从天而降的闪电打击：范围伤害 + 感电（与干冰的穿透弹形态区分）。
// 冷却好且场上有敌人即自动释放（对齐向僵尸开炮手感）；按钮可提前触发。
// 命中后才"申请施加"状态（apply），伤害/控制结算只问 status-system。
export const SKILLS = {
  freeze: {
    name: '干冰', key: '1', color: '#5ad1ff', cooldownMs: 8000,
    speed: 560, pierce: true, explodeR: 0, radius: 6, knock: 0,
    // ⚠️ 临时基准值：直接命中伤害。2026-11-03 补——原先干冰弹只有冻结没有伤害，
    // 伤害全靠状态，与 02 册"伤害 299 / 溅射 249"的差太远（那组是局外满级值，Demo 另定）
    dmg: 34,
    hit: (e, m, world) => {
      if (world) dealDamage(world, e, SKILLS.freeze.dmg * m.freezeDmgMul, 'freeze');
      apply(e.st, 'freeze', 1, 2500 + m.freezeDurBonus, { sourceId: 'skill-freeze', sourceLevel: 1, displaceType: 'normal' });
    },
  },
  burn: {
    name: '温压', key: '2', color: '#ff7a3c', cooldownMs: 9000,
    speed: 480, pierce: false, explodeR: 95, radius: 7, knock: 25, // 击退由 60 下调：原值过强
    // ⚠️ 临时基准值：爆炸直接伤害（2026-11-03 补，原先温压只有灼烧 DoT、没有直接伤害）
    dmg: 46,
    // 温压是"命中即爆炸"：伤害与状态统一在 explode 里结算，
    // 否则命中目标会先吃一次 hit 伤害、再被 explode 覆盖一次，同一个目标吃两遍。
    hit: () => {},
    explode: (e, m, world) => {
      if (world) dealDamage(world, e, SKILLS.burn.dmg * m.burnHitMul, 'burn');
      apply(e.st, 'burn', 18 * m.burnDmgMul, 3000, { sourceId: 'skill-burn', sourceLevel: 1, displaceType: 'normal' });
      apply(e.st, 'knock', m.burnKnock, 0, { sourceId: 'skill-burn', sourceLevel: 1, displaceType: 'normal' }); // 普通位移，装甲不免疫
    },
  },
  // ⚠️ 临时基准值：全部 strike*/arc*/storm* 待数值阶段统一校准
  // 局外 12 / 15 / 20 级节点在 Demo 里用「引雷针 / 弹射电弧 / 雷暴」三张卡代表（02 册 2.3）
  shock: {
    name: '电磁', key: '3', color: '#ffe14d', cooldownMs: 10000,
    strikeR: 70,    // 感电打击半径（闪电落点的伤害/感电范围）
    strikeDmg: 55,  // 单次闪电伤害（55 → 45 又回 55：经验供给由出怪节奏决定、与技能伤害基本无关，45 是对模拟噪声的过度修正）
    arcCount: 2,      // 15 级「弹射电弧」：落点向几个敌人弹射
    arcRange: 130,    // 弹射射程（从落点算）
    arcRatio: 0.4,    // 弹射伤害比例
    stormR: 140,      // 20 级「雷暴」：雷雨区半径
    stormMs: 2000,    // 雷雨区持续
    stormTickMs: 400, // 区内落雷间隔（3000/400 ≈ 5 道）
    stormDmgRatio: 0.35, // 每道小闪电伤害比例
    stormStrikeRRatio: 0.6, // 小闪电自身落点半径 = strikeR × 此值
  },
  // 装甲车（02 册 2.3 / 六格 · 物理系 · 击退守线）
  // 形态：从要塞出发沿纵向碾上去的实体载具，路上多段伤害 + 击退 + 减速。
  // 它是唯一能主动把敌人推回警戒线的技能——价值在"推回去"，不在"打死"。
  // 判定几何（2026-11-02 用户粗调）：**只用车身矩形**，不是车身外一圈圆。
  // 车身尺寸与 main.mjs 画的模型同源（bodyW/bodyH 由这里给出，渲染直接读 v.w/v.h）。
  vehicle: {
    name: '装甲车', key: '4', color: '#6b8f4e',
    cooldownMs: 17400,
    dmg: 17,            // 单段冲撞伤害（02 册基础值）
    speed: 168,         // 行进速度 px/s（420 → 210 → 168：2026-11-02 两次下调，第二次再慢 20%）
    bodyW: 34,          // 车身宽（普通车）
    bodyH: 52,          // 车身高
    bodyHeavyW: 52,     // 重型装甲车（⑥ 质变卡）：模型放大，**判定同步放大**（物理一致）
    bodyHeavyH: 78,     //   放大幅度 +18/+26px（面积 ×2.3），远小于旧设计的"范围 +80%"
    heavySpeedMul: 0.8, // 重型减速 20%（代价），伤害在 vehicleHit 里 ×1.8（收益）
    hitIntervalMs: 100, // 多段伤害间隔
    knock: 25,          // 撞击击退距离（守线杠杆，每车每目标只结算一次）
    slowMag: 0.3,       // 减速幅度 30%
    slowMs: 2000,       // 基础减速时长（③ 卡 +4s）
    laneOffset: 62,     // 多车同场时的横向间隔
    lifeMs: 6500,       // 存在时间上限（防止卡在场上）；每次降速都等比例延长，保证行进总距离不变（原 420×2.6s ≈ 1092px → 168×6.5s）
  },

  // ── 五技能补齐（2026-11-03）：高能射线 / 制导激光 / 哨戒机 / 燃烧地带 / 旋转刀轮 ──
  // 形态与 02 册 3.1 空间占位一一对应；⚠️ 全部临时基准值，数值阶段统一校准。
  // 高能射线（2026-11-03 用户反馈改形态）：原"逐 tick 多段小伤害"体验差（间隔小、宽度窄），
  // 改为**瞬发大额直线伤害**：施放瞬间对沿线上所有敌人结算一次，光束只作表现残留。
  ray: {
    name: '高能射线', key: '5', color: '#3fe0d0',
    cooldownMs: 5000,
    dmg: 90,            // 瞬间伤害（单次全额）
    len: 620,           // 光束长度
    halfWidth: 14,      // 光束半宽（判定宽度 28px）
    flashMs: 260,       // 纯表现：光束残留时长
    echoDelayMs: 400,   // 「二次脉冲」卡：0.4s 后沿原路径再打一次（50% 伤害）
  },
  // 制导激光：窄扇形左右扫射，逐 tick 命中扇面内敌人（对空/对散开队形覆盖）。
  laser: {
    name: '制导激光', key: '6', color: '#ffe14d',
    cooldownMs: 10300,
    dmg: 10,            // 每 tick 伤害
    durMs: 4000,
    tickMs: 200,
    range: 540,         // 扫射长度
    halfAngle: 0.11,    // 扇面半角（≈6°，窄）
    sweepAmp: 0.9,      // 左右扫动幅度（rad）
  },
  // 哨戒机：在要塞前方部署一台固定炮台，自动打射程内最近敌人（兜底·不需瞄准）。
  turret: {
    name: '哨戒机', key: '7', color: '#9aa5b1',
    cooldownMs: 14000,
    dmg: 45,
    fireIntervalMs: 500,
    range: 250,
    r: 12,
    lifeMs: 14000,      // 存在 14s ≈ 与 CD 同步，常驻 1 台（02 册"共存 1"）
  },
  // 燃烧地带：在场地中段留一片火区，逐 0.5s 灼烧并减速区域内敌人（封锁地面）。
  flame: {
    name: '燃烧地带', key: '8', color: '#d1493a',
    cooldownMs: 6500,
    dmgTick: 22,        // 每 0.5s 一跳 ≈ 44/s（2026-11-03 用户反馈"伤害比较小"，15→22）
    tickMs: 500,
    r: 72,
    lifeMs: 5000,
    burnMs: 2000,
    slowMag: 0.25,
    slowMs: 1000,
  },
  // 旋转刀轮：从一侧横向滚过整屏，路上敌人各吃一次切割（清越线者）。
  saw: {
    name: '旋转刀轮', key: '9', color: '#cfd8e3',
    cooldownMs: 5200,
    dmg: 35,
    speed: 300,
    r: 18,
    lifeMs: 6000,
  },
};

let _idSeq = 1;

// ── 子弹属性卡（06 册 §3.2.1）──
// 边界：只作用于**主武器子弹**，与 9 技能完全独立（技能照常按 02 册运行）。
// 纪律：① 显著弱于同名技能（这里是"常驻弱版"）② 子子弹不继承主子弹的火/爆炸（防雪球）
//      ③ 子子弹不再分裂（防递归）④ 修饰卡自身不生效，只在主卡在手时才进池
// ⚠️ 全部为 06 册校准后的临时基准值，数值阶段复核。
export const BULLET_TRAITS = {
  fireDpsRatio: 0.08,   // 火属性弹头：每秒 8% × 子弹伤害
  fireMs: 2000,         //   持续 2s（总约 16% 子弹伤害，单目标无 AOE）
  explodeDmgRatio: 0.12,// 爆炸弹头：12% × 子弹伤害
  explodeR: 35,         //   半径 35px（温压弹 120 的约 30%，硬约束"显著小于技能"）
  splitMin: 2,          // 命中分裂：2-4 颗（均值 3）
  splitMax: 4,
  subDmgRatio: 0.20,    // 子子弹 = 20% 主伤（"子子弹伤害 +30%" 卡把它抬到 26%）
  subRange: 90,         // 子子弹射程 90px
  subConeDeg: 30,       // ⚠️ 已作废（2026-11-02 用户改为四周任意方向，360°）；保留仅为对照 06 册原设计
  subSpeed: 520,        // 子子弹飞行速度 px/s
  subExplodeDmgRatio: 0.30, // 子子弹爆炸：30% × 子伤（即 6% 主伤）
  subExplodeR: 25,      //   半径 25px
};

// ── 加成/武器/技能卡的累计修正（08 册约束3：同桶加算，不连乘）──
function defaultMods() {
  return {
    bulletDamage: 1,      // 子弹伤害倍率
    fireRate: 1,          // 射速倍率（间隔 = 基础 / 此值）
    reloadMul: 1,         // 换弹时间倍率（代价卡用；弹匣容量已固定）
    pierceBonus: 0,       // 穿透加值
    spreadLanes: 0,       // 分裂子弹层数 a（散射弹道，上限 3）
    doubleShot: 0,        // 连发层数 b（同向多发，上限 3）
    freezeDmgMul: 1,      // 干冰弹直接伤害倍率（冰锥强化）
    freezeCount: 0,       // 干冰弹每次多发数（三连冰弹）
    freezeDurBonus: 0,    // 冻结时长加值 ms
    burnHitMul: 1,        // 温压弹爆炸直接伤害倍率（高爆装药）
    burnCount: 0,         // 温压弹每次多发数（双联装填）
    burnRadiusMul: 1,     // 温压爆炸半径倍率
    burnDmgMul: 1,        // 灼烧伤害倍率
    burnKnock: 25,        // 温压击退距离
    shockDurBonus: 0,     // 感电时长加值 ms
    shockDmgMul: 1,       // 闪电伤害倍率（高压雷球）
    shockRadiusMul: 1,    // 感电打击半径倍率（电场扩张）
    shockCount: 0,        // 额外闪电数量（引雷针）
    shockArc: 0,          // 弹射电弧（落点向附近敌人弹射，0/1 一次性卡）
    shockStorm: 0,        // 雷暴（落点形成雷雨区，0/1 一次性卡）
    dmgVsFrozen: 1,       // 破冰：对冻结目标
    dmgVsBurn: 1,         // 助燃：对燃烧目标
    dmgVsShock: 1,        // 导电体：对感电目标
    xpRate: 1,            // 快速学习
    skillCdMul: { freeze: 1, burn: 1, shock: 1, vehicle: 1, ray: 1, laser: 1, turret: 1, flame: 1, saw: 1 },
    // ── 五技能（2026-11-03 补齐 + 同日海克斯扩容）：三角 + 形态/状态/质变 ──
    rayDmgMul: 1, rayCount: 0, rayWidthMul: 1,
    raySlow: 0,           // 灼热光束（减速幅度，0/0.4）
    rayVuln: 0,           // 感光标记（0/1）
    rayKnock: 0,          // 冲击光束击退距离
    rayEcho: 0,           // 二次脉冲（0/1）
    laserDmgMul: 1, laserRangeMul: 1, laserWidthMul: 1, laserCount: 0,
    laserSlow: 0, laserVuln: 0, laserBurn: 0, laserKnock: 0, laserFinale: 0,
    turretDmgMul: 1, turretRangeMul: 1, turretCount: 0,
    turretSlow: 0, turretVuln: 0, turretNetwork: 0, turretBoom: 0,
    flameDmgMul: 1, flameRadiusMul: 1, flameCount: 0,
    flameSlowAdd: 0,      // 粘性焦土（在基础减速上叠加）
    flameVuln: 0, flameBurnMul: 1, flameDurMul: 1,
    sawDmgMul: 1, sawSpeedMul: 1, sawCount: 0,
    sawBounce: 0,         // 来回反弹次数（撞边折返并清命中记录）
    sawSlow: 0, sawVuln: 0, sawGiant: 0, sawKnock: 0,
    // ── 装甲车（02 册六格 + 12/15/18/20 节点）──
    vehicleDmgMul: 1,       // ① 冲撞伤害倍率
    vehicleCount: 0,        // ② 冲撞次数（每次施放出场车辆数）
    vehicleSlowBonus: 0,    // ③ 减速持续加值 ms
    vehicleVuln: 0,         // ④ 撞击目标易伤（0/1）
    vehicleKnockMul: 0,     // ⑤ 击退距离倍率加值
    vehicleStunChance: 0,   // ⑤ 眩晕概率（+10%/张）
    vehicleStun5: 0,        // 局外 15 级：额外 5% 眩晕 2s
    vehicleHeavy: 0,        // ⑥ 重型装甲车（质变）
    vehicleTar: 0,          // 局外 12 级：粘性焦油（追加目标最大生命 3%）
    vehicleFirstBoom: 0,    // 局外 18 级：首次命中后小范围爆炸 200%
    vehicleLevel: 0,        // 局外 20 级：碾过冻结单位 +200%（喂给 14 册硬门禁接口）
    // ── 子弹属性卡（06 册 §3.2.1）：常驻弱版，与技能独立 ──
    bulletFire: 0,          // ① 火属性弹头（命中附加灼烧）
    bulletExplode: 0,       // ② 爆炸弹头（命中小爆炸）
    bulletExplodeMul: 1,    // ③ 爆炸范围 +100% → ×2（修饰卡）
    bulletSplit: 0,         // ④⑤ 命中分裂（子子弹 20% 主伤）
    subDmgMul: 1,           // ⑥ 子子弹伤害 +30%（修饰卡）
    subExplode: 0,          // ⑦ 子子弹爆炸（修饰卡）
  };
}

export function createWorld() {
  return {
    time: 0,
    running: false,
    started: false,
    gameOver: false,
    player: {
      x: PLAYER.x, y: PLAYER.y, angle: -Math.PI / 2,
      ammo: PLAYER.magSize, reloading: false, reloadTimer: 0,
      fireTimer: 0, targetId: null,
    },
    enemies: [],
    bullets: [],
    pendingBullets: [], // 本帧新生成的子子弹（分裂卡）：循环后再并入，避免边遍历边追加
    skillShots: [],
    strikes: [],  // 电磁天雷的视觉残留（闪电柱 + 落点电圈，纯表现层，伤害在施放时瞬时结算）
    arcs: [],     // 弹射电弧的视觉残留（落点 → 附近敌人的短折线）
    storms: [],   // 雷雨区（20 级雷暴）：{x,y,r,life,tick}，update 里持续落小闪电
    vehicles: [], // 装甲车实体：{x,y,r,vy,life,hitCd(每人冷却),firstHit,ramp}
    enemyShots: [], // 远程兵喷吐的弹丸（打要塞）：{x,y,vx,vy,dmg,life,radius,color}
    pendingEnemies: [], // 本帧新生成的敌人（分裂子代/蜂群），循环后再并入，避免边遍历边追加
    // ── 五技能实体（2026-11-03 补齐）──
    beams: [],      // 高能射线：{x,y,ang,life,maxLife,tickTimer,dmg,len,halfWidth,color}
    sweeps: [],     // 制导激光：{x,y,ang0,t,life,maxLife,tickTimer,dmg,range,halfAngle,sweepAmp,color}
    turrets: [],    // 哨戒机：{x,y,life,maxLife,fireTimer,range,dmg,r,color}
    turretShots: [],// 哨戒机开火的视觉弹道（纯表现）：{x,y,tx,ty,life}
    flames: [],     // 燃烧地带：{x,y,r,life,maxLife,tickTimer,dmgTick,burnMs,slowMag,slowMs,color}
    saws: [],       // 旋转刀轮：{x,y,vx,r,life,dmg,hitIds,color,spin}
    particles: [],
    floaters: [],
    rings: [],
    skills: {}, // 开局没有任何技能（对齐参考视频），技能靠「学习技能卡」解锁
    mods: defaultMods(),
    // ── 升级 / 选卡（03 册）──
    level: 1,
    xp: 0,
    xpNext: xpForLevel(1),
    xpGained: 0,          // 累计获得经验（balance-sim 校准供给用）
    lastCardLevel: 1,     // 上次弹选卡的等级（级联升级只弹一次）
    won: false,
    pendingCards: [],
    cardPhase: false,
    // ── 测试用定制模式（2026-11-02 用户要求）──
    // true 时开局即允许按 C 打开卡池面板自选海克斯（不受等级/槽位限制），
    // 用于验证"某个 build 在实战里到底怎样"；正常模式下这两个字段都是 false。
    customMode: false,
    // ── 定制模式测试开关（2026-11-03 用户要求：定制模式 = 纯测试模式）──
    // noFire：主武器停火（F 切换）——测技能时不被主武器抢人头
    // godFortress：要塞无敌（G 切换）——局不会因要塞破而结束，可长测
    cheats: { noFire: false, godFortress: false },
    panelOpen: false,    // 面板打开 → 战斗暂停（见 update 早退）
    cardStacks: {},      // 每张卡已叠层数（叠满移出池）
    slotLevels: { weapon: 1, freeze: 0, burn: 0, shock: 0, vehicle: 0, ray: 0, laser: 0, turret: 0, flame: 0, saw: 0 }, // 各槽累计吃了几张卡（右上角显示）；武器开局即 1 级（角色初始 1 级）
    bonusTaken: 0,       // 已拿加成卡数（08 册软上限：按等级分层解锁）
    petFlash: 0,         // 宠物机器人释放技能时的闪光
    mercyArmed: false,   // 要塞血量首次跌破 50% → 下一抽出现「要塞急救」
    mercyUsed: false,
    fortressHp: FORTRESS.maxHp,
    fortressMaxHp: FORTRESS.maxHp,
    fortressRegenHold: 0,   // 受击后回血暂停计时
    fortressFlash: 0,
    spawnTimer: 700,
    wave: 1,
    waveName: '起手',
    waveBreath: false,
    swarmQueued: 0, // 蜂群检查点波：进入该波时写入待投放数量，出怪循环消费一次后归零（05 册约束：只波 7/13/17）
    score: 0,
    killCount: 0,
  };
}

function dist2(ax, ay, bx, by) { const dx = ax - bx, dy = ay - by; return dx * dx + dy * dy; }

// 弹匣容量固定 30（用户决定：不随卡变化）
export function magSizeOf() {
  return PLAYER.magSize;
}

// 移动倍率：冻结/眩晕直接 0；减速/感电按幅度叠加，封顶 90%
// 注意：状态函数作用在状态宿主 enemy.st 上，不是 demo 包装对象
function movementMultiplier(enemy) {
  const st = enemy.st;
  if (has(st, 'freeze')) return 0;
  if (has(st, 'stun')) return 0;
  let s = read(st, 'slow') + read(st, 'shock');
  return Math.max(0, 1 - Math.min(s, 0.9));
}

function addFloater(world, x, y, text, color) {
  world.floaters.push({ x, y, text, color, life: 700, maxLife: 700 });
}

function addParticle(world, x, y, vx, vy, life, color, size) {
  world.particles.push({ x, y, vx, vy, life, maxLife: life, color, size });
}

function addRing(world, x, y, maxR, color) {
  world.rings.push({ x, y, r: 8, maxR, life: 420, maxLife: 420, color });
}

// 波次缩放（压迫感核心旋钮）：血量/速度/攻击随波次成长，玩家输出必须跟上海克斯选择质量。
// 抽成函数，供普通出怪 / 蜂群 / 分裂子代复用，避免缩放逻辑散落多处（重构点：2026-11-03 补齐 5 种敌人）。
function waveScales(world) {
  const wv = world.wave;
  // 血量超线性：前期温和、第 10 波起陡增——混搭乱选的 DPS 跟不上，专精+放大器才行
  // 2026-11-02「加大密集程度」的配套：出怪数提升约 1.6 倍后，若单体照旧会把总压力乘成 1.7 倍，
  // 游戏直接从"偶尔翻车"变"地狱"。这里把单体血量/攻击同比例下调（**更多但更软**），
  // 保留尸群的密集观感与压迫感，但总压力只微增。
  const DENSITY_COMP = 0.74;
  const hpScale = (1 + (wv - 1) * 0.03 + Math.pow((wv - 1) / 19, 2) * 0.45) * DENSITY_COMP;  // 第20波 ≈ 2.0×
  const spdScale = Math.min(1.5, 1 + (wv - 1) * 0.025);
  const atkScale = (1 + (wv - 1) * 0.06) * DENSITY_COMP;   // 攻城伤害随波次抬升：漏怪就要持续付出要塞血量代价
  return { hpScale, spdScale, atkScale };
}

// 构造一个已按波次缩放的敌人实体（内部复用入口，不直推 world.enemies）。
// opts：hpMul / spMul（分裂子代血量/速度折扣）；splitChild（标记子代不再分裂）；x/y 覆盖出生点。
function makeEnemyEntity(world, typeKey, x, y, opts = {}) {
  const t = ENEMY_TYPES[typeKey];
  const { hpScale, spdScale, atkScale } = waveScales(world);
  const hpMul = opts.hpMul || 1, spMul = opts.spMul || 1;
  const e = {
    id: _idSeq++,
    type: typeKey,
    ...t,
    x, y,
    hp: Math.round(t.hp * hpScale * hpMul),
    maxHp: Math.round(t.hp * hpScale * hpMul),
    speed: t.speed * spdScale * spMul,
    atkDmg: Math.round(t.atkDmg * atkScale * hpMul),
    st: makeEnemy(t.targetType),
    alive: true,
    hitFlash: 0,
    attacking: false,     // 是否已抵达防线 / standoff 线转为攻击姿态
    attackTimer: 0,
    attackFlash: 0,
    splitChild: !!opts.splitChild,
    standoffY: t.standoff ? Math.round(WORLD.H * t.standoffFrac) : 0,
  };
  if (t.bomber) e.boomDmgScaled = Math.round(t.boomDmg * atkScale); // 自爆兵抵线爆炸伤害随波次成长
  return e;
}

function spawnEnemy(world, typeKey) {
  const lane = 40 + Math.random() * (WORLD.W - 80);
  world.enemies.push(makeEnemyEntity(world, typeKey, lane, -30));
}

// 蜂群：05 册约束——极小成片、横向铺开、间距明显、不聚堆；单次 8-12 只；死亡不产尸爆。
// 横向均匀铺满屏幕宽度，加少量随机抖动，避免叠在一起被一发穿透秒光（那会废掉"数量即血条"）。
function spawnSwarm(world, count) {
  const margin = 28, span = WORLD.W - margin * 2;
  for (let i = 0; i < count; i++) {
    const x = margin + (count <= 1 ? span / 2 : (span * i) / (count - 1)) + (Math.random() * 14 - 7);
    const y = -20 - Math.random() * 46;
    world.enemies.push(makeEnemyEntity(world, 'swarm', x, y));
  }
}

// 分裂兵死亡：裂成 2 只小兵（子代不再分裂，防递归雪球）。
function spawnSplitChildren(world, parent) {
  for (let s = -1; s <= 1; s += 2) {
    world.pendingEnemies.push(
      makeEnemyEntity(world, 'splitter', parent.x + s * 14, parent.y - 4, { splitChild: true, hpMul: 0.4, spMul: 1.15 })
    );
  }
}

// 加权随机出怪：读当前波的 composition（WAVE_SCRIPT），轮盘赌自动归一化。
// composition 只含常规出怪类型；蜂群由 swarmQueued 单独投放（见 update 出怪块），不进此池。
const ENEMY_POOL = ['zombie', 'runner', 'armored', 'ranged', 'bomber', 'flyer', 'splitter'];
function pickEnemyType(world) {
  const comp = (WAVE_SCRIPT[world.wave - 1] || WAVE_SCRIPT[WAVE_SCRIPT.length - 1]).composition;
  const entries = ENEMY_POOL.map((k) => [k, comp[k] || 0]).filter(([, w]) => w > 0);
  const total = entries.reduce((s, [, w]) => s + w, 0);
  if (total <= 0) return 'zombie';
  let x = Math.random() * total;
  for (const [k, w] of entries) { if ((x -= w) < 0) return k; }
  return 'zombie';
}

// 伤害结算：唯一入口。装甲车×冻结硬门禁 + 条件增伤在此生效。
// 放大器触发时飘字带标注（破冰/助燃/导电/交叉）并按方向配色——让"加成真的在生效"看得见。
function dealDamage(world, enemy, raw, source = 'weapon') {
  const cond = conditionMultiplier(world, enemy);
  const gate = enemy.vehicleLevel ? vehicleRammedMultiplier(enemy.st, enemy.vehicleLevel) : 1;
  const dmg = raw * cond.mult * gate;
  enemy.hp -= dmg;
  enemy.hitFlash = 90;
  if (gate > 1) addFloater(world, enemy.x, enemy.y - enemy.radius, `×3  ${Math.round(dmg)}`, '#ff4d4d');
  else if (cond.tag) addFloater(world, enemy.x, enemy.y - enemy.radius, `${cond.tag} ${Math.round(dmg)}`, cond.color);
  else addFloater(world, enemy.x, enemy.y - enemy.radius, `${Math.round(dmg)}`, source === 'burn' ? '#ff9a3c' : source === 'shock' ? '#ffe14d' : source === 'vehicle' ? '#a8d08d' : source === 'freeze' ? '#8ce6ff' : '#ffffff');
  if (enemy.hp <= 0) killEnemy(world, enemy);
}

// 条件增伤（08 册 A 类放大器：每张只奖励一种配合，带主语）
// 返回 { mult, tag, color }：tag/color 用于飘字标注，把"这次伤害为什么变高"显示出来
const AMPLIFIERS = [
  { test: (st) => has(st, 'freeze'), get: (m) => m.dmgVsFrozen, tag: '破冰', color: '#5ad1ff' },
  { test: (st) => has(st, 'burn'), get: (m) => m.dmgVsBurn, tag: '助燃', color: '#ff9a3c' },
  { test: (st) => has(st, 'shock'), get: (m) => m.dmgVsShock, tag: '导电', color: '#ffe14d' },
];
function conditionMultiplier(world, enemy) {
  const st = enemy.st, m = world.mods;
  let d = 1, tag = null, color = null;
  for (const a of AMPLIFIERS) {
    if (a.test(st) && a.get(m) > 1) {
      d *= a.get(m);
      if (!tag) { tag = a.tag; color = a.color; }
    }
  }
  // 易伤（14 册 amplify 类，不可叠加）：装甲车 ④「撞击目标 6s 内受伤 +20%」等
  // 与放大器同乘一个伤害桶——它奖励的不是配合，是"被这辆车撞过"
  const vuln = read(st, 'vuln');
  if (vuln > 0) {
    d *= 1 + vuln;
    if (!tag) { tag = '易伤'; color = '#ffb3d9'; }
  }
  // ❌ 交叉火力已删除（2026-11-02）：常驻条件增伤超模
  return { mult: d, tag, color };
}
function killEnemy(world, enemy, scored = true) {
  if (!enemy.alive) return;
  enemy.alive = false;
  onDeath(enemy.st); // 状态单一真相源：死亡即清空，防止 DoT 打到尸体（传入状态宿主 .st，非 demo 包装）
  if (scored) {
    world.score += enemy.score;
    world.killCount += 1;
    gainXp(world, enemy.xp);
  }
  // 分裂兵：死亡裂成 2 只小兵（子代不再分裂，防递归）。推迟到 pendingEnemies，
  // 避免在敌人循环遍历中增长数组；在 update 末尾并入。
  if (enemy.splitter && !enemy.splitChild) spawnSplitChildren(world, enemy);
  // 死亡爆裂粒子
  const n = 10;
  for (let i = 0; i < n; i++) {
    const a = (Math.PI * 2 * i) / n + Math.random();
    const sp = 60 + Math.random() * 120;
    addParticle(world, enemy.x, enemy.y, Math.cos(a) * sp, Math.sin(a) * sp, 420, enemy.color, 3);
  }
}

// 自爆兵抵线爆炸：对要塞造成大额伤害后消失（自身也计分，视为被消灭）。
// 爆炸光环 + 碎片纯表现；核心是把"漏掉自爆兵"的代价做成"要塞掉一大块血"，而非瞬间团灭。
function bomberExplode(world, e) {
  addRing(world, e.x, e.y, 42, e.color);
  for (let i = 0; i < 16; i++) {
    const a = Math.random() * Math.PI * 2, sp = 60 + Math.random() * 150;
    addParticle(world, e.x, e.y, Math.cos(a) * sp, Math.sin(a) * sp, 380, e.color, 3);
  }
  damageFortress(world, e.boomDmgScaled || e.boomDmg, e);
  killEnemy(world, e);
}

// 远程兵喷吐：从自身**垂直直线**砸向要塞（不瞄准角色/玩家位置）。
// 用户 2026-11-03 修正：敌人攻击的是"角色前面的要塞"，不是角色本身——弹丸应沿自身车道笔直下落到防线，而不是朝玩家汇聚成一点。
function spawnEnemyShot(world, e) {
  const sp = 260;
  world.enemyShots.push({
    x: e.x, y: e.y,
    vx: 0, vy: sp,   // 垂直向下：直线砸向要塞防线
    dmg: e.atkDmg, life: 4500, radius: 5, color: '#c8a8ff',
  });
}

// ── 经验 / 升级（03 册一节：经验来自击杀，每波保证至少升一级）──
function gainXp(world, amount) {
  world.xp += amount * world.mods.xpRate;
  world.xpGained += amount * world.mods.xpRate; // 供给计量（balance-sim 校准用）
  // 级联升级：一只怪的经验可能跨多级（如前期装甲尸车 40xp vs 首级 20xp）
  while (world.xp >= world.xpNext && world.level < MAX_LEVEL) {
    world.xp -= world.xpNext;
    world.level += 1;
    world.xpNext = xpForLevel(world.level);
  }
  if (world.xp >= world.xpNext) {
    world.xp = world.xpNext;  // 已满级，经验条封顶
    return;
  }
  if (world.level > world.lastCardLevel) {
    world.lastCardLevel = world.level;
    // 定制模式：不弹随机三选一，改成玩家自己按 C 打开面板挑（否则"自选"会被随机卡打断）
    if (world.customMode) return;
    world.pendingCards = rollCards(world);
    world.cardPhase = true;   // 暂停战斗，等玩家选卡（级联只弹一次）
  }
}

// 定制模式专用：直接给一张卡（不消耗三选一、不看等级与槽位），用来现场搭一套 build 做测试。
// 与 chooseCard 的区别：不要求 cardPhase、不弹选卡、不受卡池规则限制；
// 但仍然遵守"一次性卡不重复 / 有层数上限的到顶为止 / 已学技能不重复学"这类硬约束，
// 否则会把状态写成非法值（比如 doubleShot 到 4 层）。
export function takeCard(world, card) {
  if (!card || world.gameOver) return false;
  const stacks = world.cardStacks[card.id] || 0;
  if (card.kind === 'learn') {
    if (world.skills[card.target]) return false;
    world.skills[card.target] = { cd: 0 };
  } else if (card.id === MERCY_CARD.id) {
    if (world.mercyUsed) return false;
    world.mercyUsed = true;
    world.fortressHp = Math.min(world.fortressMaxHp, world.fortressHp + world.fortressMaxHp * 0.3);
  } else {
    if (card.once && stacks >= 1) return false;
    if (card.maxStacks && stacks >= card.maxStacks) return false;
    card.apply(world.mods);
    if (card.kind === 'bonus') world.bonusTaken += 1;
  }
  world.cardStacks[card.id] = stacks + 1;
  if (card.target && world.slotLevels[card.target] !== undefined) world.slotLevels[card.target] += 1;
  return true;
}

export function chooseCard(world, idx) {
  if (!world.cardPhase) return false;
  const card = world.pendingCards[idx];
  if (!card) return false;
  if (card.kind === 'learn') {
    // 学会一个新技能：解锁槽位，之后它的强化卡才会进池
    world.skills[card.target] = { cd: 0 };
    world.cardStacks[card.id] = (world.cardStacks[card.id] || 0) + 1;
    if (world.slotLevels[card.target] !== undefined) world.slotLevels[card.target] += 1;
    world.pendingCards = [];
    world.cardPhase = false;
    return true;
  }
  if (card.id === MERCY_CARD.id) {
    // 功能卡「要塞急救」：立即回复最大血量 30%（03 册九节，一局仅一次）
    world.fortressHp = Math.min(world.fortressMaxHp, world.fortressHp + world.fortressMaxHp * 0.3);
    addFloater(world, world.player.x, world.player.y - 40, '要塞急救 +30%', '#7fe07f');
  } else {
    card.apply(world.mods);
    world.cardStacks[card.id] = (world.cardStacks[card.id] || 0) + 1;
    if (card.kind === 'bonus') world.bonusTaken += 1;
    // 记录该槽累计吃了几张卡（右上角武器/技能槽显示）
    if (card.target && world.slotLevels[card.target] !== undefined) world.slotLevels[card.target] += 1;
  }
  world.pendingCards = [];
  world.cardPhase = false;
  return true;
}

// 要塞受击：敌人按自身攻击频率持续掉要塞的血（不是撞上来一次性扣命）
function damageFortress(world, dmg, enemy) {
  if (world.cheats?.godFortress) return; // 定制模式「要塞无敌」（G 切换）：不掉血、局不结束
  world.fortressHp = Math.max(0, world.fortressHp - dmg);
  world.fortressFlash = 220;
  world.fortressRegenHold = 3000; // 受击后 3 秒内不回血（防止边啃边回显得假）
  addFloater(world, world.player.x + (Math.random() * 40 - 20), world.player.y - 30, `-${dmg}`, '#ff6b6b');
  for (let i = 0; i < 6; i++) {
    const a = Math.random() * Math.PI * 2, sp = 40 + Math.random() * 90;
    addParticle(world, world.player.x, world.player.y - 10, Math.cos(a) * sp, Math.sin(a) * sp, 300, '#ff6b6b', 3);
  }
  // 功能卡触发：要塞血量首次跌破 50%
  if (!world.mercyArmed && !world.mercyUsed && world.fortressHp < world.fortressMaxHp * 0.5) {
    world.mercyArmed = true;
  }
  if (world.fortressHp <= 0) { world.gameOver = true; world.running = false; }
}

// 自动瞄准：选射程内、离要塞最近的存活敌人
function acquireTarget(world) {
  const p = world.player;
  let best = null, bestD = Infinity;
  for (const e of world.enemies) {
    if (!e.alive) continue;
    const d = dist2(p.x, p.y, e.x, e.y);
    if (d <= PLAYER.range * PLAYER.range && d < bestD) { bestD = d; best = e; }
  }
  return best;
}

// 弹道经济（06册3.2.0）：N=(1+a)×(1+b) 乘法；一枪只扣 1 tick（弹夹=扳机次数）；
// 每颗弹丸伤害按降伤表衰减（第 k 张同类卡 ×0.65/×0.833/×0.90，每类型上限 3 层）
export function pelletFactor(k) {
  const P = [1, 0.65, 0.65 * 0.833, 0.65 * 0.833 * 0.9];
  return P[Math.min(k, 3)];
}
export function bulletsPerShot(m) {
  return (1 + m.spreadLanes) * (1 + m.doubleShot);
}

function fire(world, target) {
  const p = world.player;
  const m = world.mods;
  const ang = Math.atan2(target.y - p.y, target.x - p.x);
  p.angle = ang;
  const pierce = PLAYER.bulletPierce + m.pierceBonus;
  const perBullet = PLAYER.baseDamage * m.bulletDamage * pelletFactor(m.spreadLanes) * pelletFactor(m.doubleShot);
  const lanes = 1 + m.spreadLanes;          // 散射：扇面铺开
  const SPREAD_STEP = 0.07;                 // 相邻弹道间隔 ≈4°
  const BURST_GAP = 41;                     // 连发：沿射向前后错开（24 → 41，用户 2026-11-02 要求间距 +70%）；700px/s × 16ms ≈ 11px/帧
  for (let lane = 0; lane < lanes; lane++) {
    const laneAng = ang + (lane - (lanes - 1) / 2) * SPREAD_STEP;
    for (let d = 0; d < 1 + m.doubleShot; d++) { // 连发：同一条射线上前后排开
      // 同向多发若都在同一点出生会完全重叠，肉眼看起来只有一颗 → 沿射向错开，
      // 方向仍严格一致（同向同落点），只是出膛位置前后拉开，伤害与命中逻辑不变。
      // 上限不超过到目标的距离，避免贴脸时后面的子弹"越过"目标少打一发。
      const aimDist = Math.hypot(target.x - p.x, target.y - p.y);
      const spawn = Math.min(28 + d * BURST_GAP, Math.max(20, aimDist - 6));
      world.bullets.push({
        x: p.x + Math.cos(laneAng) * spawn,
        y: p.y + Math.sin(laneAng) * spawn,
        vx: Math.cos(laneAng) * PLAYER.bulletSpeed,
        vy: Math.sin(laneAng) * PLAYER.bulletSpeed,
        damage: perBullet,
        life: 1400,
        radius: PLAYER.bulletRadius,
        pierceLeft: pierce,   // 穿透：可连续命中 pierce 个敌人
        hitIds: [],           // 同一敌人不重复结算
        burstIdx: d,          // 连发序号（0=首发），渲染层用来画拖尾衔接
      });
    }
  }
  p.ammo -= 1; // 只扣 1 tick：加弹道/连发不增加弹药消耗（06册3.2.0）
  p.fireTimer = PLAYER.fireIntervalMs / m.fireRate;
  if (p.ammo <= 0 && !p.reloading) startReload(world);
}

function startReload(world) {
  const p = world.player;
  if (p.reloading || p.ammo >= magSizeOf(world)) return;
  p.reloading = true;
  p.reloadTimer = PLAYER.reloadMs * world.mods.reloadMul;
}

export function manualReload(world) {
  if (world.gameOver) return;
  startReload(world);
}

// ── 电磁天雷（2026-11-02 用户重定形态）：随机锁定场上敌人，从天而降的闪电打击 ──
// 闪电数量 = 1 + shockCount（引雷针卡）；每次闪电独立随机选目标（可重复锁定同一只）。
// 落点半径内所有敌人：受伤 + 感电。瞬时结算，strikes 只留视觉。
function castSkyStrike(world) {
  const m = world.mods, sk = SKILLS.shock;
  const alive = world.enemies.filter((e) => e.alive);
  if (!alive.length) return false;
  const radius = sk.strikeR * m.shockRadiusMul;
  const count = 1 + Math.round(m.shockCount);
  for (let i = 0; i < count; i++) {
    const tgt = alive[Math.floor(Math.random() * alive.length)];
    resolveSkyStrike(world, tgt.x, tgt.y, radius, sk.strikeDmg * m.shockDmgMul);
  }
  return true;
}

// 单道闪电：结算伤害/感电 + 生成闪电视觉（锯齿路径预生成，渲染层只画）
// opts.minor = true 表示雷雨区内的次级落雷：不再弹射电弧、不再生成新雷暴（防递归）
function resolveSkyStrike(world, x, y, radius, dmg, opts = {}) {
  const color = SKILLS.shock.color;
  const minor = !!opts.minor;
  // 预生成闪电折线：从屏幕顶 (x,0) 落到 (x,y)，中途随机横向抖动
  const bolt = [];
  const segs = 6;
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    const jx = i === 0 || i === segs ? 0 : (Math.random() * 2 - 1) * 22;
    bolt.push({ x: x + jx, y: y * t });
  }
  bolt[segs] = { x, y };
  const life = minor ? 200 : 280;
  world.strikes.push({ x, y, radius, bolt, color, life, maxLife: life, minor });
  addRing(world, x, y, radius, color);
  const struck = [];
  for (const e of world.enemies) {
    if (!e.alive) continue;
    const rr = radius + e.radius;
    if (dist2(x, y, e.x, e.y) <= rr * rr) {
      dealDamage(world, e, dmg, 'shock');
      apply(e.st, 'shock', 0.6, 2600 + world.mods.shockDurBonus, { sourceId: 'skill-shock', sourceLevel: 1, displaceType: 'normal' });
      struck.push(e);
    }
  }
  if (!minor) {
    const m = world.mods, sk = SKILLS.shock;
    // 15 级「弹射电弧」：落点向附近（未被主闪电覆盖的）敌人弹射 —— 补落点边缘的散兵
    if (m.shockArc > 0) {
      const cands = world.enemies
        .filter((e) => e.alive && !struck.includes(e))
        .map((e) => ({ e, d: dist2(x, y, e.x, e.y) }))
        .filter((it) => it.d <= sk.arcRange * sk.arcRange)
        .sort((a, b) => a.d - b.d)
        .slice(0, sk.arcCount);
      for (const { e } of cands) {
        addArc(world, x, y, e.x, e.y, color);
        dealDamage(world, e, dmg * sk.arcRatio, 'shock');
        apply(e.st, 'shock', 0.6, 2600 + m.shockDurBonus, { sourceId: 'skill-shock', sourceLevel: 1, displaceType: 'normal' });
      }
    }
    // 20 级「雷暴」：落点形成短暂雷雨区（同一时间只保留一片，重复施放视为刷新位置）
    if (m.shockStorm > 0 && !world.storms.length) {
      world.storms.push({ x, y, r: sk.stormR, life: sk.stormMs, maxLife: sk.stormMs, tick: 0, color });
    }
  }
  for (let i = 0; i < 10; i++) {
    const a = Math.random() * Math.PI * 2, sp = 40 + Math.random() * 120;
    addParticle(world, x, y, Math.cos(a) * sp, Math.sin(a) * sp, 300, color, 2);
  }
}

// 弹射电弧的视觉：落点 → 目标的一条短折线
function addArc(world, x1, y1, x2, y2, color) {
  const pts = [];
  const segs = 4;
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    const j = i === 0 || i === segs ? 0 : 10;
    pts.push({
      x: x1 + (x2 - x1) * t + (Math.random() * 2 - 1) * j,
      y: y1 + (y2 - y1) * t + (Math.random() * 2 - 1) * j,
    });
  }
  world.arcs.push({ pts, color, life: 220, maxLife: 220 });
}

// ── 装甲车（02 册：物理系 · 击退守线）──
// 从要塞出发、沿纵向碾上去的实体载具：对路上每个敌人每 100ms 结算一段伤害 + 击退 + 减速。
// 它不是输出技能——价值在"把越线的敌人推回警戒线"（04 册中线纪律），
// 所以 ②冲撞次数 是核心、①伤害几乎不点（见 02 册 3.2 正确投法）。
const META_VEHICLE = { sourceId: 'skill-vehicle', sourceLevel: 1, displaceType: 'normal' };

function castVehicle(world) {
  const m = world.mods, sk = SKILLS.vehicle;
  const count = 1 + Math.round(m.vehicleCount);
  const heavy = !!m.vehicleHeavy;
  // 判定几何 = 模型尺寸（2026-11-03 用户拍板：模型变大碾压范围就该跟着变，物理一致；
  // 旧设计直接"范围 +80%"才是超模的原因，现在只 +18/+26px）
  const w = heavy ? sk.bodyHeavyW : sk.bodyW;
  const h = heavy ? sk.bodyHeavyH : sk.bodyH;
  let rampAcc = 0;
  for (let i = 0; i < count; i++) {
    // 2026-11-03 用户要求：多车不再横排等距出发，改为**随机车道 + 随机发车间隔**
    const x = Math.max(w * 0.5, Math.min(WORLD.W - w * 0.5, w * 0.5 + Math.random() * (WORLD.W - w)));
    if (i > 0) rampAcc += 140 + Math.random() * 380; // 相邻两车 140~520ms，不挨着出发
    world.vehicles.push({
      x,
      y: world.player.y + 30,
      w,
      h,
      vy: -sk.speed * (heavy ? sk.heavySpeedMul : 1),
      life: sk.lifeMs / (heavy ? sk.heavySpeedMul : 1), // 降速后同步延长存在时间，保证走完全程
      ramp: rampAcc,       // 随机发车间隔
      hitCd: new Map(),    // enemyId → 剩余冷却（多段伤害节流）
      knocked: new Set(),  // 已被这辆车推过的目标（击退每车每目标只结算一次）
      firstHit: false,     // 局外 18 级「冲撞爆破」每车只炸一次
      heavy,
      color: sk.color,
    });
  }
  return true;
}

// 单段冲撞：伤害 → 击退 → 减速 → 易伤 → 眩晕 → 首撞爆破
function vehicleHit(world, v, e) {
  const m = world.mods, sk = SKILLS.vehicle;
  let dmg = sk.dmg * m.vehicleDmgMul * (v.heavy ? 1.8 : 1); // 重型：伤害 ×1.8（不换范围）
  // 局外 20 级：碾过【冻结】单位 +200%——复用 14 册硬门禁接口，
  // 只读 has('freeze')，不关心冰冻是谁挂的（跨技能联动成立的技术原因，见 02 册 6.2）
  dmg *= vehicleRammedMultiplier(e.st, m.vehicleLevel);
  dealDamage(world, e, dmg, 'vehicle');
  // 局外 12 级「粘性焦油」：追加目标最大生命 3%
  if (m.vehicleTar && e.alive) dealDamage(world, e, e.maxHp * 0.03, 'vehicle');
  if (!e.alive) return;
  // 击退（守线核心）：推离要塞方向 = y 减小。
  // 只在【每辆车对该目标的第一次撞击】时推一次——多段伤害不是多次撞飞，
  // 否则同一只怪在车下被 100ms 推一段，等于永久驱逐，压迫感直接归零（2026-11-02 校准）。
  if (!v.knocked.has(e.id)) {
    v.knocked.add(e.id);
    apply(e.st, 'knock', sk.knock * (1 + m.vehicleKnockMul), 0, META_VEHICLE);
  }
  // 减速：粘在履带下
  apply(e.st, 'slow', sk.slowMag, sk.slowMs + m.vehicleSlowBonus, META_VEHICLE);
  // ④ 撞击目标 6s 内受伤 +20%（vuln 不可叠加，由状态系统保证）
  if (m.vehicleVuln) apply(e.st, 'vuln', 0.2, 6000, META_VEHICLE);
  // ⑤ 10%/张 + 局外 15 级 5%：眩晕
  const stunP = m.vehicleStunChance + (m.vehicleStun5 ? 0.05 : 0);
  if (stunP > 0 && Math.random() < stunP) {
    apply(e.st, 'stun', 1, m.vehicleStun5 ? 2000 : 1000, META_VEHICLE);
  }
  // 局外 18 级「冲撞爆破」：每辆车命中首个目标后小范围爆炸（200% 伤害）
  if (m.vehicleFirstBoom && !v.firstHit) {
    v.firstHit = true;
    vehicleBoom(world, e.x, e.y, 70, dmg * 2);
  }
}

function vehicleBoom(world, x, y, r, dmg) {
  const color = SKILLS.vehicle.color;
  addRing(world, x, y, r, color);
  for (const e of world.enemies) {
    if (!e.alive) continue;
    const rr = r + e.radius;
    if (dist2(x, y, e.x, e.y) <= rr * rr) dealDamage(world, e, dmg, 'vehicle');
  }
  for (let i = 0; i < 12; i++) {
    const a = Math.random() * Math.PI * 2, sp = 60 + Math.random() * 140;
    addParticle(world, x, y, Math.cos(a) * sp, Math.sin(a) * sp, 320, color, 3);
  }
}

// ── 子弹属性卡结算（06 册 §3.2.1）──
// 主子弹命中：火（给目标挂灼烧）→ 爆炸（命中点小爆炸）→ 分裂（命中点炸出子子弹）
// 子子弹命中：只可能触发「子子弹爆炸」——不再分裂、不继承火/爆炸（防递归/雪球）
const META_BULLET_FIRE = { sourceId: 'bullet-fire', sourceLevel: 1, displaceType: 'normal' };

function bulletOnHit(world, b, e, hx, hy) {
  const m = world.mods, T = BULLET_TRAITS;
  if (b.isSub) {
    if (m.subExplode) {
      blast(world, hx, hy, b.damage * T.subExplodeDmgRatio, T.subExplodeR * m.bulletExplodeMul, '#ffcf5c');
    }
    return;
  }
  // ① 火属性弹头：单目标 DoT，伤害按这颗子弹实际伤害折算（吃子弹伤害加成）
  if (m.bulletFire && e.alive) {
    apply(e.st, 'burn', b.damage * T.fireDpsRatio, T.fireMs, META_BULLET_FIRE);
  }
  // ② 爆炸弹头：命中点小爆炸（③ 爆炸范围卡把半径 ×2）
  if (m.bulletExplode) {
    blast(world, hx, hy, b.damage * T.explodeDmgRatio, T.explodeR * m.bulletExplodeMul, '#ffb347');
  }
  // ④⑤ 命中分裂：2-4 颗子子弹，±30° 锥角飞出
  if (m.bulletSplit) spawnSubBullets(world, b, hx, hy);
}

// 通用小范围伤害（不吃子弹属性卡，防递归）
function blast(world, x, y, dmg, r, color) {
  addRing(world, x, y, r, color);
  for (const e of world.enemies) {
    if (!e.alive) continue;
    const rr = r + e.radius;
    if (dist2(x, y, e.x, e.y) <= rr * rr) dealDamage(world, e, dmg, 'weapon');
  }
  for (let i = 0; i < 6; i++) {
    const a = Math.random() * Math.PI * 2, sp = 50 + Math.random() * 90;
    addParticle(world, x, y, Math.cos(a) * sp, Math.sin(a) * sp, 260, color, 2);
  }
}

function spawnSubBullets(world, b, x, y) {
  const m = world.mods, T = BULLET_TRAITS;
  const n = T.splitMin + Math.floor(Math.random() * (T.splitMax - T.splitMin + 1));
  // 2026-11-02 用户要求：子子弹朝**四周任意方向**飞（不再限制在主弹方向的 ±30° 锥角内）
  const FULL_CIRCLE = Math.PI * 2;
  const dmg = b.damage * T.subDmgRatio * m.subDmgMul;
  // 2026-11-03 用户要求：子子弹就是"减伤 + 体积变小"的真子弹，**不再限制 90px 射程**，
  // 速度与存活时间都跟主子弹一致，能一路飞到屏幕外（越界由统一的 offscreen 判定回收）。
  for (let i = 0; i < n; i++) {
    const ang = Math.random() * FULL_CIRCLE;
    // 进 pending 队列而不是直接 push：正在 for..of 遍历 world.bullets，直接 push 会让新子弹同帧被处理
    world.pendingBullets.push({
      x, y,
      vx: Math.cos(ang) * PLAYER.bulletSpeed,
      vy: Math.sin(ang) * PLAYER.bulletSpeed,
      damage: dmg,
      life: 1400,          // 同主子弹寿命（≈980px 射程，基本飞满全屏）
      radius: 3,           // 形态比主子弹小（减伤版的"小弹"）
      pierceLeft: 1,
      hitIds: [],
      isSub: true,
    });
  }
}

export function castSkill(world, id) {
  if (world.gameOver) return false;
  const sk = SKILLS[id];
  if (!sk) return false;
  const slot = world.skills[id];
  if (!slot || slot.cd > 0) return false;
  const m = world.mods;

  // 电磁天雷：不走弹道，施放即结算——随机锁定场上敌人，从天而降的闪电打击
  if (id === 'shock') {
    if (!castSkyStrike(world)) return false; // 场上没有敌人：不消耗冷却
    world.petFlash = 320; // 机器人出手闪光
    slot.cd = sk.cooldownMs * m.skillCdMul[id];
    return true;
  }

  // 装甲车：不走弹道，出场即实体载具——从要塞碾上去，路上多段冲撞
  if (id === 'vehicle') {
    castVehicle(world);
    world.petFlash = 320;
    slot.cd = sk.cooldownMs * m.skillCdMul[id];
    return true;
  }

  // ── 五技能（2026-11-03 补齐）：均不走 skillShots，各自建实体 ──
  // 高能射线（瞬发版）：施放瞬间对沿线上所有敌人结算一次，光束只作表现残留
  if (id === 'ray') {
    const tgt = acquireTarget(world);
    if (!tgt) return false;
    const pet = petPos(world);
    const baseAng = Math.atan2(tgt.y - pet.y, tgt.x - pet.x);
    const n = 1 + m.rayCount;
    for (let i = 0; i < n; i++) {
      fireRayBeam(world, baseAng + (i - (n - 1) / 2) * 0.14);
    }
    world.petFlash = 320;
    slot.cd = sk.cooldownMs * m.skillCdMul[id];
    return true;
  }
  // 制导激光：朝最近敌人方向左右扫射的窄扇面
  if (id === 'laser') {
    const tgt = acquireTarget(world);
    if (!tgt) return false;
    const pet = petPos(world);
    const baseAng = Math.atan2(tgt.y - pet.y, tgt.x - pet.x);
    const n = 1 + m.laserCount;
    for (let i = 0; i < n; i++) {
      const a = baseAng + (i - (n - 1) / 2) * 0.5;
      world.sweeps.push({
        x: pet.x, y: pet.y, ang0: a, t: 0, life: sk.durMs, maxLife: sk.durMs,
        tickTimer: 0, dmg: sk.dmg * m.laserDmgMul, range: sk.range * m.laserRangeMul,
        halfAngle: sk.halfAngle * m.laserWidthMul, sweepAmp: sk.sweepAmp, color: sk.color,
      });
    }
    world.petFlash = 320;
    slot.cd = sk.cooldownMs * m.skillCdMul[id];
    return true;
  }
  // 哨戒机：在要塞前方部署 1~N 台固定炮台
  if (id === 'turret') {
    const n = 1 + m.turretCount;
    for (let i = 0; i < n; i++) {
      const lane = 60 + Math.random() * (WORLD.W - 120);
      world.turrets.push({
        x: lane + (i - (n - 1) / 2) * 64, y: FORTRESS.attackLine - 140,
        life: sk.lifeMs, maxLife: sk.lifeMs, fireTimer: 0,
        range: sk.range * m.turretRangeMul, dmg: sk.dmg * m.turretDmgMul, r: sk.r, color: sk.color,
      });
    }
    world.petFlash = 320;
    slot.cd = sk.cooldownMs * m.skillCdMul[id];
    return true;
  }
  // 燃烧地带（2026-11-03 用户反馈：随机落点体验差）→ 优先放在**敌人最密集处**，无敌人再随机
  if (id === 'flame') {
    const n = 1 + m.flameCount;
    let cx = null, cy = null;
    const band = world.enemies.filter((e) => e.alive && e.y > WORLD.H * 0.3 && e.y < FORTRESS.attackLine);
    if (band.length) {
      let bestN = -1;
      for (const e0 of band) {
        let cnt = 0, sx = 0, sy = 0;
        for (const e of band) {
          if (dist2(e0.x, e0.y, e.x, e.y) <= 80 * 80) { cnt++; sx += e.x; sy += e.y; }
        }
        if (cnt > bestN) { bestN = cnt; cx = sx / cnt; cy = sy / cnt; }
      }
    }
    for (let i = 0; i < n; i++) {
      const x = cx != null ? cx + (i - (n - 1) / 2) * 74 : 60 + Math.random() * (WORLD.W - 120);
      const y = cy != null ? cy : Math.round(WORLD.H * 0.5);
      world.flames.push({
        x: Math.max(40, Math.min(WORLD.W - 40, x)),
        y: Math.max(WORLD.H * 0.3, Math.min(FORTRESS.attackLine - 60, y)),
        r: sk.r * m.flameRadiusMul,
        life: sk.lifeMs * m.flameDurMul, maxLife: sk.lifeMs * m.flameDurMul, tickTimer: 0,
        dmgTick: sk.dmgTick * m.flameDmgMul, burnMs: sk.burnMs, burnMul: m.flameBurnMul,
        slowMag: sk.slowMag + m.flameSlowAdd, slowMs: sk.slowMs, color: sk.color,
      });
    }
    world.petFlash = 320;
    slot.cd = sk.cooldownMs * m.skillCdMul[id];
    return true;
  }
  // 旋转刀轮：从随机一侧横向滚过整屏（巨型卡放大体积/伤害；反弹卡给折返次数）
  if (id === 'saw') {
    const n = 1 + m.sawCount;
    const giant = m.sawGiant ? 1 : 0;
    for (let i = 0; i < n; i++) {
      const fromLeft = Math.random() < 0.5;
      const y = 200 + Math.random() * (FORTRESS.attackLine - 320);
      world.saws.push({
        x: fromLeft ? -22 : WORLD.W + 22, y: y + (i - (n - 1) / 2) * 72,
        vx: (fromLeft ? 1 : -1) * sk.speed * m.sawSpeedMul,
        r: sk.r * (giant ? 1.6 : 1),
        life: sk.lifeMs + m.sawBounce * 3500, // 反弹折返需要更长的存在时间
        dmg: sk.dmg * m.sawDmgMul * (giant ? 1.3 : 1),
        bounces: m.sawBounce, hitIds: [], color: sk.color, spin: 0,
      });
    }
    world.petFlash = 320;
    slot.cd = sk.cooldownMs * m.skillCdMul[id];
    return true;
  }

  // 技能由宠物机器人释放：发射原点是机器人，不是要塞炮塔
  const pet = petPos(world);
  // 自动瞄准：取射程内最近敌人；无目标则朝正上方（避免空放）
  const tgt = acquireTarget(world) || { x: pet.x, y: 0 };
  const ang = Math.atan2(tgt.y - pet.y, tgt.x - pet.x);
  // 数量卡（2026-11-03）：干冰/温压可一次多发，微散射角避免完全重叠
  const n = 1 + (id === 'freeze' ? m.freezeCount : id === 'burn' ? m.burnCount : 0);
  const STEP_ANG = 0.10; // ≈6°
  for (let i = 0; i < n; i++) {
    const a2 = ang + (i - (n - 1) / 2) * STEP_ANG;
    world.skillShots.push({
      id, color: sk.color,
      x: pet.x + Math.cos(a2) * (14 + i * 6), y: pet.y + Math.sin(a2) * (14 + i * 6),
      vx: Math.cos(a2) * sk.speed, vy: Math.sin(a2) * sk.speed,
      pierce: sk.pierce,
      explodeR: sk.explodeR * m.burnRadiusMul,
      radius: sk.radius, life: 2000, dead: false,
      hitIds: [], // 穿透弹每帧都会与同一敌人重叠，靠它保证"每个敌人只生效一次"
    });
  }
  world.petFlash = 320; // 机器人出手闪光
  slot.cd = sk.cooldownMs * m.skillCdMul[id];
  return true;
}

// 高能射线（瞬发版）：沿 ang 直线结算一次伤害 + 光束表现残留。
// dmgRatio：二次脉冲复用（0.5）；echo 卡只挂在本体光束上。
function fireRayBeam(world, ang, dmgRatio = 1) {
  const sk = SKILLS.ray, m = world.mods;
  const halfWidth = sk.halfWidth * m.rayWidthMul;
  const pet = petPos(world);
  const dx = Math.cos(ang), dy = Math.sin(ang);
  for (const e of world.enemies) {
    if (!e.alive) continue;
    const rx = e.x - pet.x, ry = e.y - pet.y;
    const along = rx * dx + ry * dy;
    if (along < 0 || along > sk.len) continue;
    if (Math.abs(rx * -dy + ry * dx) > halfWidth + e.radius) continue;
    dealDamage(world, e, sk.dmg * m.rayDmgMul * dmgRatio, 'ray');
    if (!e.alive) continue;
    if (m.raySlow) apply(e.st, 'slow', m.raySlow, 1500, { sourceId: 'skill-ray', sourceLevel: 1, displaceType: 'normal' });
    if (m.rayVuln) apply(e.st, 'vuln', 0.25, 5000, { sourceId: 'skill-ray', sourceLevel: 1, displaceType: 'normal' });
    if (m.rayKnock) apply(e.st, 'knock', m.rayKnock, 0, { sourceId: 'skill-ray', sourceLevel: 1, displaceType: 'normal' });
  }
  const withEcho = !!m.rayEcho && dmgRatio === 1;
  const life = sk.flashMs + (withEcho ? sk.echoDelayMs + sk.flashMs : 0);
  world.beams.push({
    x: pet.x, y: pet.y, ang, len: sk.len, halfWidth, life, maxLife: life, color: sk.color,
    echo: withEcho, echoTimer: withEcho ? sk.echoDelayMs : 0, echoDone: false,
  });
}

// 制导激光「终焉爆裂」（20 级节点卡）：扫射结束时沿光路终点追加一次爆炸
function explodeLaserFinale(world, s) {
  const m = world.mods;
  const ang = s.ang0 + Math.sin((s.t / 1000) * Math.PI * 1.1) * s.sweepAmp;
  const px = s.x + Math.cos(ang) * s.range * 0.6;
  const py = s.y + Math.sin(ang) * s.range * 0.6;
  for (const e of world.enemies) {
    if (!e.alive) continue;
    const rr = 90 + e.radius;
    if (dist2(px, py, e.x, e.y) <= rr * rr) dealDamage(world, e, 120 * m.laserDmgMul, 'laser');
  }
  addRing(world, px, py, 90, SKILLS.laser.color);
  for (let i = 0; i < 12; i++) {
    const a = Math.random() * Math.PI * 2, sp = 60 + Math.random() * 130;
    addParticle(world, px, py, Math.cos(a) * sp, Math.sin(a) * sp, 340, SKILLS.laser.color, 3);
  }
}

function skillShotOffscreen(s) {
  return s.x < -40 || s.x > WORLD.W + 40 || s.y < -40 || s.y > WORLD.H + 40;
}

// 温压弹落点爆炸：对范围内敌人施加灼烧 + 击退，并画爆炸光环与碎片
function explodeSkill(world, s) {
  for (const e of world.enemies) {
    if (!e.alive) continue;
    const rr = s.explodeR + e.radius;
    if (dist2(s.x, s.y, e.x, e.y) <= rr * rr) SKILLS[s.id].explode(e, world.mods, world);
  }
  addRing(world, s.x, s.y, s.explodeR, s.color);
  for (let i = 0; i < 14; i++) {
    const a = Math.random() * Math.PI * 2, sp = 60 + Math.random() * 140;
    addParticle(world, s.x, s.y, Math.cos(a) * sp, Math.sin(a) * sp, 360, s.color, 3);
  }
}

export function update(world, dtMs) {
  if (world.gameOver || !world.running) return;
  if (world.cardPhase) return; // 选卡时战斗暂停
  if (world.panelOpen) return;  // 定制模式卡池面板打开时同样暂停
  world.time += dtMs;
  const p = world.player;
  const m = world.mods;

  // ── 波次 / 出怪（出怪不出中线，04 册纪律；这里出在顶部 y<0 自然满足）──
  // 共 20 波：第 20 波走完停止出怪，场上清空即通关（最后一波用于收尾）
  const timeUp = world.time > RUN.maxWave * RUN.waveMs;
  world.spawnTimer -= dtMs;
  if (!timeUp && world.spawnTimer <= 0) {
    // 波次压力曲线（2026-11-03）：出怪参数全部读 WAVE_SCRIPT 当前波，形成密度峰谷 + 两次喘息。
    // 单体成长（hpScale 等）仍随波次连续抬升，见 spawnEnemy——这里只塑密度骨架。
    const script = WAVE_SCRIPT[world.wave - 1] || WAVE_SCRIPT[WAVE_SCRIPT.length - 1];
    world.waveName = script.name;
    world.waveBreath = !!script.breath;
    let batch = script.batch;
    if (Math.random() < script.extraChance) batch += 1;
    for (let i = 0; i < batch; i++) spawnEnemy(world, pickEnemyType(world));
    // 蜂群检查点波：一次性投放一整片蜂群（05 册约束：只波 7/13/17，单次 8-12 只），随后归零
    if (world.swarmQueued > 0) { spawnSwarm(world, world.swarmQueued); world.swarmQueued = 0; }
    world.spawnTimer = script.interval * SPAWN_INTERVAL_TUNE;
  }
  // 波次推进：按时间（04 册"波间无停顿"，上一波超时即接下一波），封顶 20 波
  if (!timeUp && world.time > world.wave * RUN.waveMs && world.wave < RUN.maxWave) {
    world.wave += 1;
    const next = WAVE_SCRIPT[world.wave - 1] || WAVE_SCRIPT[WAVE_SCRIPT.length - 1];
    world.waveName = next.name;
    world.waveBreath = !!next.breath;
    world.swarmQueued = next.swarm || 0; // 进入检查点波即写入待投放蜂群数
  }
  if (timeUp && world.enemies.length === 0 && !world.gameOver) {
    world.won = true; world.gameOver = true; world.running = false;
  }

  // ── 技能冷却 + 自动释放（冷却好且场上有敌人即自动开火，对齐向僵尸开炮）──
  for (const k of Object.keys(world.skills)) {
    const slot = world.skills[k];
    if (slot.cd > 0) { slot.cd = Math.max(0, slot.cd - dtMs); continue; }
    if (world.enemies.some((e) => e.alive)) castSkill(world, k);
  }

  // ── 自动瞄准 + 开火 / 换弹 ──
  const target = acquireTarget(world);
  p.targetId = target ? target.id : null;
  if (p.reloading) {
    p.reloadTimer -= dtMs;
    if (p.reloadTimer <= 0) { p.reloading = false; p.ammo = magSizeOf(world); }
  } else {
    p.fireTimer -= dtMs;
    // 定制模式「主武器停火」（F 切换）：测技能时不被主武器抢人头
    if (target && p.fireTimer <= 0 && p.ammo > 0 && !world.cheats?.noFire) fire(world, target);
  }

  // ── 敌人推进 + 状态结算（tick 推进冻结/眩晕/灼烧等生命周期）──
  for (const e of world.enemies) {
    if (!e.alive) continue;
    const dot = tick(e.st, dtMs); // burn DoT 在此结算；同时推进 _now 供冻结 DR
    if (dot > 0) {
      // DoT 走统一伤害入口（放大器/飘字生效）；按 ~0.5s 聚合跳字，避免每帧刷屏
      e.dotAcc = (e.dotAcc || 0) + dot;
      if (e.dotAcc >= 9) {
        const acc = e.dotAcc;
        e.dotAcc = 0;
        dealDamage(world, e, acc, 'burn');
        if (!e.alive) continue;
      }
    }
    if (e.hitFlash > 0) e.hitFlash -= dtMs;
    if (e.attackFlash > 0) e.attackFlash -= dtMs;

    // 攻击姿态（已抵达防线 or 远程兵已到 standoff 线）：停住并持续输出
    if (e.attacking) {
      const frozen = has(e.st, 'freeze') || has(e.st, 'stun');
      if (!frozen) {
        e.attackTimer -= dtMs;
        if (e.attackTimer <= 0) {
          e.attackTimer = e.atkIntervalMs;
          e.attackFlash = 220;
          if (e.standoff) spawnEnemyShot(world, e); // 远程兵：向要塞喷吐弹丸（不直接啃防线）
          else damageFortress(world, e.atkDmg, e);  // 地面兵：持续啃要塞
        }
      }
      continue; // 攻击姿态下不再推进
    }

    // 自爆兵：触及防线即引爆（不走持续攻击，见 bomberExplode）
    if (e.bomber && e.y >= FORTRESS.attackLine) {
      bomberExplode(world, e);
      continue;
    }

    const mult = movementMultiplier(e);
    e.y += e.speed * mult * (dtMs / 1000);
    // 击退（一次性，结算即清）
    const kd = getKnockDistance(e.st);
    if (kd > 0) { e.y = applyKnockToPosition(e.y, kd, -9999).y; clear(e.st, 'knock'); if (e.y < FORTRESS.attackLine) e.attacking = false; }
    // 抵达线：地面兵到防线、远程兵到 standoff 线即转入攻击姿态
    const reached = e.standoff ? e.standoffY : FORTRESS.attackLine;
    if (e.y >= reached) {
      e.y = reached;
      e.attacking = true;
      e.attackTimer = e.atkIntervalMs * 0.5; // 抵达后半拍就出手
    }
  }

  // ── 装甲车推进 + 多段冲撞（同一目标每 100ms 才再吃一段）──
  for (const v of world.vehicles) {
    v.life -= dtMs;
    if (v.ramp > 0) { v.ramp -= dtMs; continue; } // 出场延迟中：还没进场
    v.y += v.vy * (dtMs / 1000);
    for (const [eid, cd] of v.hitCd) {
      const n = cd - dtMs;
      if (n <= 0) v.hitCd.delete(eid); else v.hitCd.set(eid, n);
    }
    for (const e of world.enemies) {
      if (!e.alive) continue;
      if (v.hitCd.has(e.id)) continue;
      // 判定 = 车身矩形（按敌人半径外扩，近似圆-矩形碰撞）。
      // 2026-11-02 用户粗调：原来是"车身外半径 90 的圆"，怪物站在车旁边一截也算被碾，
      // 观感上"周围一圈都在掉血"；现在只有真正被车身压到的才受伤。
      const hw = v.w / 2 + e.radius;
      const hh = v.h / 2 + e.radius;
      if (Math.abs(e.x - v.x) <= hw && Math.abs(e.y - v.y) <= hh) {
        vehicleHit(world, v, e);
        v.hitCd.set(e.id, SKILLS.vehicle.hitIntervalMs);
      }
    }
    if (v.y < -60 || v.life <= 0) v.dead = true;
  }

  // ── 子弹推进 + 碰撞（穿透：命中后 pierceLeft-1，为 0 才消失）──
  for (const b of world.bullets) {
    b.x += b.vx * (dtMs / 1000);
    b.y += b.vy * (dtMs / 1000);
    b.life -= dtMs;
    if (b.life <= 0 || b.x < -20 || b.x > WORLD.W + 20 || b.y < -20 || b.y > WORLD.H + 20) { b.dead = true; continue; }
    for (const e of world.enemies) {
      if (!e.alive) continue;
      if (b.hitIds.includes(e.id)) continue;
      const rr = (e.radius + b.radius);
      if (dist2(b.x, b.y, e.x, e.y) <= rr * rr) {
        const hx = b.x, hy = b.y;   // 命中点：爆炸/分裂发生在接触点，不是敌人中心
        dealDamage(world, e, b.damage, 'weapon');
        b.hitIds.push(e.id);
        b.pierceLeft -= 1;
        bulletOnHit(world, b, e, hx, hy);
        for (let i = 0; i < 4; i++) {
          const a = Math.random() * Math.PI * 2, sp = 40 + Math.random() * 80;
          addParticle(world, b.x, b.y, Math.cos(a) * sp, Math.sin(a) * sp, 220, '#ffd36e', 2);
        }
        if (b.pierceLeft <= 0) { b.dead = true; break; }
        // 仍有穿透次数：继续飞，不 break
      }
    }
  }
  // 分裂出的子子弹下一帧开始飞（本帧不参与碰撞，避免"刚分裂就命中"）
  if (world.pendingBullets.length > 0) {
    world.bullets.push(...world.pendingBullets);
    world.pendingBullets.length = 0;
  }

  // ── 技能弹推进 + 命中（弹道飞向敌人，命中/爆炸才施加状态）──
  for (const s of world.skillShots) {
    s.x += s.vx * (dtMs / 1000);
    s.y += s.vy * (dtMs / 1000);
    s.life -= dtMs;
    if (s.life <= 0 || skillShotOffscreen(s)) {
      if (s.explodeR > 0) explodeSkill(world, s);
      s.dead = true; continue;
    }
    for (const e of world.enemies) {
      if (!e.alive) continue;
      if (s.hitIds.includes(e.id)) continue; // 已命中过，穿透弹不重复生效
      const rr = e.radius + s.radius;
      if (dist2(s.x, s.y, e.x, e.y) <= rr * rr) {
        SKILLS[s.id].hit(e, m, world);
        s.hitIds.push(e.id);
        if (!s.pierce) { explodeSkill(world, s); s.dead = true; break; }
      }
    }
  }

  // ── 远程兵弹丸推进 + 命中要塞 ──
  for (const s of world.enemyShots) {
    s.x += s.vx * (dtMs / 1000);
    s.y += s.vy * (dtMs / 1000);
    s.life -= dtMs;
    if (s.life <= 0 || s.x < -20 || s.x > WORLD.W + 20 || s.y > WORLD.H + 20) { s.dead = true; continue; }
    // 弹丸越过防线即命中要塞（远程兵的"攻击"结算点在墙，而非贴脸）
    if (s.y >= FORTRESS.attackLine) {
      damageFortress(world, s.dmg, { type: 'ranged' });
      s.dead = true;
    }
  }

  // ── 五技能实体推进 / 结算（2026-11-03 补齐，统一走 dealDamage）──
  // 高能射线（瞬发版）：光束只是表现残留；「二次脉冲」卡到点后沿原路径补一次 50% 伤害
  for (const b of [...world.beams]) {
    b.life -= dtMs;
    if (b.echo && !b.echoDone) {
      b.echoTimer -= dtMs;
      if (b.echoTimer <= 0) { b.echoDone = true; fireRayBeam(world, b.ang, 0.5); }
    }
  }
  world.beams = world.beams.filter((b) => b.life > 0);

  // 制导激光：扇面左右扫动，逐 tick 命中扇面内敌人（cos 夹角判定）+ 状态卡
  for (const s of world.sweeps) {
    s.life -= dtMs; s.t += dtMs; s.tickTimer -= dtMs;
    if (s.tickTimer <= 0) {
      s.tickTimer = SKILLS.laser.tickMs;
      const ang = s.ang0 + Math.sin((s.t / 1000) * Math.PI * 1.1) * s.sweepAmp;
      const dx = Math.cos(ang), dy = Math.sin(ang);
      const cosHalf = Math.cos(s.halfAngle);
      for (const e of world.enemies) {
        if (!e.alive) continue;
        const rx = e.x - s.x, ry = e.y - s.y;
        const d = Math.hypot(rx, ry);
        if (d < 1 || d > s.range + e.radius) continue;
        if ((rx * dx + ry * dy) / d < cosHalf) continue;
        dealDamage(world, e, s.dmg, 'laser');
        if (!e.alive) continue;
        if (m.laserSlow) apply(e.st, 'slow', 0.15, 1200, { sourceId: 'skill-laser', sourceLevel: 1, displaceType: 'normal' });
        if (m.laserVuln) apply(e.st, 'vuln', 0.2, 5000, { sourceId: 'skill-laser', sourceLevel: 1, displaceType: 'normal' });
        if (m.laserBurn) apply(e.st, 'burn', 6, 2000, { sourceId: 'skill-laser', sourceLevel: 1, displaceType: 'normal' });
        if (m.laserKnock) apply(e.st, 'knock', 18, 0, { sourceId: 'skill-laser', sourceLevel: 1, displaceType: 'normal' });
      }
    }
  }
  // 「终焉爆裂」卡（20 级节点）：扫射结束时沿光路终点追加一次爆炸
  for (const s of world.sweeps) {
    if (s.life > 0 || !m.laserFinale) continue;
    explodeLaserFinale(world, s);
  }
  world.sweeps = world.sweeps.filter((s) => s.life > 0);

  // 哨戒机：到点就打射程内最近敌人（瞬时结算 + 视觉弹道）+ 状态/协同卡
  for (const t of world.turrets) {
    t.life -= dtMs; t.fireTimer -= dtMs;
    if (t.fireTimer <= 0) {
      let best = null, bd = Infinity;
      for (const e of world.enemies) {
        if (!e.alive) continue;
        const d = dist2(t.x, t.y, e.x, e.y);
        if (d <= t.range * t.range && d < bd) { bd = d; best = e; }
      }
      if (best) {
        t.fireTimer = SKILLS.turret.fireIntervalMs;
        world.turretShots.push({ x: t.x, y: t.y, tx: best.x, ty: best.y, life: 120 });
        // 协同射击（⑥）：每多存在一台炮台，所有炮台伤害 +10%
        const net = m.turretNetwork ? 1 + 0.1 * Math.max(0, world.turrets.length - 1) : 1;
        dealDamage(world, best, t.dmg * net, 'turret');
        if (best.alive) {
          if (m.turretSlow) apply(best.st, 'slow', 0.15, 1000, { sourceId: 'skill-turret', sourceLevel: 1, displaceType: 'normal' });
          if (m.turretVuln) apply(best.st, 'vuln', 0.15, 5000, { sourceId: 'skill-turret', sourceLevel: 1, displaceType: 'normal' });
        }
      }
    }
  }
  // 「到期自爆」卡：炮台存在结束时对周围爆炸
  for (const t of world.turrets) {
    if (t.life > 0 || !m.turretBoom) continue;
    for (const e of world.enemies) {
      if (!e.alive) continue;
      const rr = 70 + e.radius;
      if (dist2(t.x, t.y, e.x, e.y) <= rr * rr) dealDamage(world, e, 60, 'turret');
    }
    addRing(world, t.x, t.y, 70, SKILLS.turret.color);
  }
  world.turrets = world.turrets.filter((t) => t.life > 0);
  for (const s of world.turretShots) s.life -= dtMs;
  world.turretShots = world.turretShots.filter((s) => s.life > 0);

  // 燃烧地带：逐 tick 灼烧 + 减速区域内敌人
  for (const f of world.flames) {
    f.life -= dtMs; f.tickTimer -= dtMs;
    if (f.tickTimer <= 0) {
      f.tickTimer = SKILLS.flame.tickMs;
      for (const e of world.enemies) {
        if (!e.alive) continue;
        const rr = f.r + e.radius;
        if (dist2(f.x, f.y, e.x, e.y) > rr * rr) continue;
        dealDamage(world, e, f.dmgTick, 'burn');
        if (!e.alive) continue;
        apply(e.st, 'burn', f.dmgTick * 0.4 * (f.burnMul || 1), f.burnMs, { sourceId: 'skill-flame', sourceLevel: 1, displaceType: 'normal' });
        apply(e.st, 'slow', f.slowMag, f.slowMs, { sourceId: 'skill-flame', sourceLevel: 1, displaceType: 'normal' });
        if (m.flameVuln) apply(e.st, 'vuln', 0.2, 5000, { sourceId: 'skill-flame', sourceLevel: 1, displaceType: 'normal' });
      }
    }
  }
  world.flames = world.flames.filter((f) => f.life > 0);

  // 旋转刀轮：横向滚动，每个敌人只吃一次切割；「来回反弹」卡撞边折返并清命中记录（回程可再打一轮）
  for (const s of world.saws) {
    s.life -= dtMs;
    s.x += s.vx * (dtMs / 1000);
    s.spin += dtMs;
    if ((s.x < s.r && s.vx < 0) || (s.x > WORLD.W - s.r && s.vx > 0)) {
      if (s.bounces > 0) { s.bounces -= 1; s.vx *= -1; s.hitIds.length = 0; }
    }
    for (const e of world.enemies) {
      if (!e.alive || s.hitIds.includes(e.id)) continue;
      const rr = s.r + e.radius;
      if (dist2(s.x, s.y, e.x, e.y) <= rr * rr) {
        s.hitIds.push(e.id);
        dealDamage(world, e, s.dmg, 'saw');
        if (!e.alive) continue;
        if (m.sawSlow) apply(e.st, 'slow', 0.2, 1500, { sourceId: 'skill-saw', sourceLevel: 1, displaceType: 'normal' });
        if (m.sawVuln) apply(e.st, 'vuln', 0.2, 5000, { sourceId: 'skill-saw', sourceLevel: 1, displaceType: 'normal' });
        if (m.sawKnock) apply(e.st, 'knock', 20, 0, { sourceId: 'skill-saw', sourceLevel: 1, displaceType: 'normal' });
      }
    }
  }
  world.saws = world.saws.filter((s) => s.life > 0 && s.x > -80 && s.x < WORLD.W + 80);

  // ── 粒子 / 浮字 / 光环寿命 ──
  for (const pt of world.particles) { pt.x += pt.vx * (dtMs / 1000); pt.y += pt.vy * (dtMs / 1000); pt.life -= dtMs; }
  for (const f of world.floaters) { f.y -= 22 * (dtMs / 1000); f.life -= dtMs; }
  for (const r of world.rings) { r.r += (r.maxR - r.r) * 0.18; r.life -= dtMs; }
  for (const s of world.strikes) s.life -= dtMs;
  for (const a of world.arcs) a.life -= dtMs;
  // ── 雷雨区（20 级「雷暴」）：区内持续随机落小闪电 ──
  for (const s of world.storms) {
    s.life -= dtMs;
    s.tick -= dtMs;
    if (s.life <= 0 || s.tick > 0) continue;
    s.tick += SKILLS.shock.stormTickMs;
    const sk = SKILLS.shock;
    const inside = world.enemies.filter((e) => e.alive && dist2(s.x, s.y, e.x, e.y) <= s.r * s.r);
    let tx, ty;
    if (inside.length) {
      const t = inside[Math.floor(Math.random() * inside.length)];
      tx = t.x; ty = t.y;
    } else {
      // 区内没敌人就落在区内随机点（保留"雷雨在下的感觉"，不浪费表现）
      const ang = Math.random() * Math.PI * 2, d = Math.sqrt(Math.random()) * s.r;
      tx = s.x + Math.cos(ang) * d; ty = s.y + Math.sin(ang) * d;
    }
    resolveSkyStrike(world, tx, ty, sk.strikeR * sk.stormStrikeRRatio,
      sk.strikeDmg * world.mods.shockDmgMul * sk.stormDmgRatio, { minor: true });
  }
  if (world.fortressFlash > 0) world.fortressFlash -= dtMs;
  // 要塞常驻缓回：脱战 3 秒后按 regenPerSec 回复（解耦清波的回血机制，设计册基准）
  if (world.fortressRegenHold > 0) world.fortressRegenHold -= dtMs;
  else if (world.fortressHp > 0 && world.fortressHp < world.fortressMaxHp) {
    world.fortressHp = Math.min(world.fortressMaxHp, world.fortressHp + (FORTRESS.regenPerSec * dtMs) / 1000);
  }
  if (world.petFlash > 0) world.petFlash -= dtMs;

  // ── 清理死亡实体 ──
  // 先并入本帧生成的敌人（分裂子代/蜂群），再统一过滤——分裂在 killEnemy 里推到 pendingEnemies，
  // 若直接 push 到 world.enemies 会在上面的敌人循环遍历中增长数组。
  if (world.pendingEnemies.length > 0) {
    world.enemies.push(...world.pendingEnemies);
    world.pendingEnemies.length = 0;
  }
  world.enemies = world.enemies.filter((e) => e.alive);
  world.bullets = world.bullets.filter((b) => !b.dead);
  world.skillShots = world.skillShots.filter((s) => !s.dead);
  world.enemyShots = world.enemyShots.filter((s) => !s.dead);
  world.strikes = world.strikes.filter((s) => s.life > 0);
  world.arcs = world.arcs.filter((a) => a.life > 0);
  world.storms = world.storms.filter((s) => s.life > 0);
  world.vehicles = world.vehicles.filter((v) => !v.dead);
  world.particles = world.particles.filter((p2) => p2.life > 0);
  world.floaters = world.floaters.filter((f) => f.life > 0);
  world.rings = world.rings.filter((r) => r.life > 0);
}

export { CARDS, MERCY_CARD };
