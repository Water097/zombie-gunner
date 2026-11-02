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
export const ENEMY_TYPES = {
  zombie:  { name: '普通僵尸', targetType: 'normal',  hp: 60,  speed: 14, radius: 16, color: '#7fb069', score: 60,  xp: 10, atkDmg: 4,  atkIntervalMs: 1500 },
  runner:  { name: '疾行尸',   targetType: 'normal',  hp: 40,  speed: 30, radius: 12, color: '#e9c46a', score: 45,  xp: 12, atkDmg: 3,  atkIntervalMs: 1200 },
  armored: { name: '装甲尸车', targetType: 'armored', hp: 300, speed: 10, radius: 24, color: '#577590', score: 200, xp: 40, atkDmg: 9, atkIntervalMs: 2000, vehicleLevel: 20 },
};

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
    hit: (e, m) => apply(e.st, 'freeze', 1, 2500 + m.freezeDurBonus, { sourceId: 'skill-freeze', sourceLevel: 1, displaceType: 'normal' }),
  },
  burn: {
    name: '温压', key: '2', color: '#ff7a3c', cooldownMs: 9000,
    speed: 480, pierce: false, explodeR: 95, radius: 7, knock: 25, // 击退由 60 下调：原值过强
    hit: (e, m) => apply(e.st, 'burn', 18 * m.burnDmgMul, 3000, { sourceId: 'skill-burn', sourceLevel: 1, displaceType: 'normal' }),
    explode: (e, m) => {
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
  // "范围 180"= 冲撞判定直径（半径 90）；伤害间隔 0.1s = 同一目标被反复碾。
  vehicle: {
    name: '装甲车', key: '4', color: '#6b8f4e',
    cooldownMs: 17400,
    dmg: 17,            // 单段冲撞伤害（02 册基础值）
    radius: 90,         // 冲撞判定半径（范围 180 的半径）
    speed: 420,         // 行进速度 px/s
    hitIntervalMs: 100, // 多段伤害间隔
    knock: 25,          // 撞击击退距离（守线杠杆，每车每目标只结算一次）
    slowMag: 0.3,       // 减速幅度 30%
    slowMs: 2000,       // 基础减速时长（③ 卡 +4s）
    laneOffset: 62,     // 多车同场时的横向间隔
    lifeMs: 2600,       // 存在时间上限（防止卡在场上）
  },
};

let _idSeq = 1;

// ── 加成/武器/技能卡的累计修正（08 册约束3：同桶加算，不连乘）──
function defaultMods() {
  return {
    bulletDamage: 1,      // 子弹伤害倍率
    fireRate: 1,          // 射速倍率（间隔 = 基础 / 此值）
    reloadMul: 1,         // 换弹时间倍率（代价卡用；弹匣容量已固定）
    pierceBonus: 0,       // 穿透加值
    spreadLanes: 0,       // 分裂子弹层数 a（散射弹道，上限 3）
    doubleShot: 0,        // 连发层数 b（同向多发，上限 3）
    freezeDurBonus: 0,    // 冻结时长加值 ms
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
    skillCdMul: { freeze: 1, burn: 1, shock: 1, vehicle: 1 },
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
    skillShots: [],
    strikes: [],  // 电磁天雷的视觉残留（闪电柱 + 落点电圈，纯表现层，伤害在施放时瞬时结算）
    arcs: [],     // 弹射电弧的视觉残留（落点 → 附近敌人的短折线）
    storms: [],   // 雷雨区（20 级雷暴）：{x,y,r,life,tick}，update 里持续落小闪电
    vehicles: [], // 装甲车实体：{x,y,r,vy,life,hitCd(每人冷却),firstHit,ramp}
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
    cardStacks: {},      // 每张卡已叠层数（叠满移出池）
    slotLevels: { weapon: 1, freeze: 0, burn: 0, shock: 0, vehicle: 0 }, // 各槽累计吃了几张卡（右上角显示）；武器开局即 1 级（角色初始 1 级）
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

function spawnEnemy(world, typeKey) {
  const t = ENEMY_TYPES[typeKey];
  const lane = 40 + Math.random() * (WORLD.W - 80);
  // ── 波次缩放（压迫感核心旋钮）：血量/速度/攻击随波次成长，玩家输出必须跟上海克斯选择质量 ──
  const wv = world.wave;
  // 血量超线性：前期温和、第 10 波起陡增——混搭乱选的 DPS 跟不上，专精+放大器才行
  const hpScale = 1 + (wv - 1) * 0.03 + Math.pow((wv - 1) / 19, 2) * 0.45;  // 第20波 ≈ 2.8×
  const spdScale = Math.min(1.5, 1 + (wv - 1) * 0.025);
  const atkScale = 1 + (wv - 1) * 0.06;   // 攻城伤害随波次抬升：漏怪就要持续付出要塞血量代价
  world.enemies.push({
    id: _idSeq++,
    type: typeKey,
    ...t,
    x: lane,
    y: -30,
    hp: Math.round(t.hp * hpScale),
    maxHp: Math.round(t.hp * hpScale),
    speed: t.speed * spdScale,
    atkDmg: Math.round(t.atkDmg * atkScale),
    st: makeEnemy(t.targetType),
    alive: true,
    hitFlash: 0,
    attacking: false,     // 是否已抵达防线转为攻击姿态
    attackTimer: 0,
    attackFlash: 0,
  });
}

// 加权随机出怪：普通最多，装甲间隔出现
function pickEnemyType(world) {
  const r = Math.random();
  if (world.wave >= 2 && r < 0.18) return 'armored';
  if (r < 0.45) return 'runner';
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
  else addFloater(world, enemy.x, enemy.y - enemy.radius, `${Math.round(dmg)}`, source === 'burn' ? '#ff9a3c' : source === 'shock' ? '#ffe14d' : source === 'vehicle' ? '#a8d08d' : '#ffffff');
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
  // 死亡爆裂粒子
  const n = 10;
  for (let i = 0; i < n; i++) {
    const a = (Math.PI * 2 * i) / n + Math.random();
    const sp = 60 + Math.random() * 120;
    addParticle(world, enemy.x, enemy.y, Math.cos(a) * sp, Math.sin(a) * sp, 420, enemy.color, 3);
  }
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
    world.pendingCards = rollCards(world);
    world.cardPhase = true;   // 暂停战斗，等玩家选卡（级联只弹一次）
  }
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
  const BURST_GAP = 24;                     // 连发：沿射向前后错开约 2 帧位移（700px/s × 16ms ≈ 11px）
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
  const baseX = world.player.x;
  const half = (count - 1) / 2;
  for (let i = 0; i < count; i++) {
    const r = sk.radius * (m.vehicleHeavy ? 1.8 : 1);
    // 多车时横向铺开但不出屏（半辆车身也算出屏，按半径夹住）
    const x = Math.max(r * 0.5, Math.min(WORLD.W - r * 0.5, baseX + (i - half) * sk.laneOffset));
    world.vehicles.push({
      x,
      y: world.player.y + 30,
      r,
      vy: -sk.speed,
      life: sk.lifeMs,
      ramp: i * 200,       // 依次出场，避免多车挤成一堵墙
      hitCd: new Map(),    // enemyId → 剩余冷却（多段伤害节流）
      knocked: new Set(),  // 已被这辆车推过的目标（击退每车每目标只结算一次）
      firstHit: false,     // 局外 18 级「冲撞爆破」每车只炸一次
      heavy: !!m.vehicleHeavy,
      color: sk.color,
    });
  }
  return true;
}

// 单段冲撞：伤害 → 击退 → 减速 → 易伤 → 眩晕 → 首撞爆破
function vehicleHit(world, v, e) {
  const m = world.mods, sk = SKILLS.vehicle;
  let dmg = sk.dmg * m.vehicleDmgMul * (v.heavy ? 1.5 : 1);
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

  // 技能由宠物机器人释放：发射原点是机器人，不是要塞炮塔
  const pet = petPos(world);
  // 自动瞄准：取射程内最近敌人；无目标则朝正上方（避免空放）
  const tgt = acquireTarget(world) || { x: pet.x, y: 0 };
  const ang = Math.atan2(tgt.y - pet.y, tgt.x - pet.x);
  world.skillShots.push({
    id, color: sk.color,
    x: pet.x + Math.cos(ang) * 14, y: pet.y + Math.sin(ang) * 14,
    vx: Math.cos(ang) * sk.speed, vy: Math.sin(ang) * sk.speed,
    pierce: sk.pierce,
    explodeR: sk.explodeR * m.burnRadiusMul,
    radius: sk.radius, life: 2000, dead: false,
    hitIds: [], // 穿透弹每帧都会与同一敌人重叠，靠它保证"每个敌人只生效一次"
  });
  world.petFlash = 320; // 机器人出手闪光
  slot.cd = sk.cooldownMs * m.skillCdMul[id];
  return true;
}

function skillShotOffscreen(s) {
  return s.x < -40 || s.x > WORLD.W + 40 || s.y < -40 || s.y > WORLD.H + 40;
}

// 温压弹落点爆炸：对范围内敌人施加灼烧 + 击退，并画爆炸光环与碎片
function explodeSkill(world, s) {
  for (const e of world.enemies) {
    if (!e.alive) continue;
    const rr = s.explodeR + e.radius;
    if (dist2(s.x, s.y, e.x, e.y) <= rr * rr) SKILLS[s.id].explode(e, world.mods);
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
  world.time += dtMs;
  const p = world.player;
  const m = world.mods;

  // ── 波次 / 出怪（出怪不出中线，04 册纪律；这里出在顶部 y<0 自然满足）──
  // 共 20 波：第 20 波走完停止出怪，场上清空即通关（最后一波用于收尾）
  const timeUp = world.time > RUN.maxWave * RUN.waveMs;
  world.spawnTimer -= dtMs;
  if (!timeUp && world.spawnTimer <= 0) {
    // 出怪密度随波次抬升：基础 1~2 只，第 8 波起有概率三连出
    const batch = 1 + (Math.random() < 0.3 ? 1 : 0) + (world.wave >= 8 && Math.random() < 0.25 ? 1 : 0);
    for (let i = 0; i < batch; i++) spawnEnemy(world, pickEnemyType(world));
    const speedUp = Math.max(400, 960 - world.wave * 26);
    world.spawnTimer = speedUp;
    if (world.time > world.wave * RUN.waveMs) world.wave += 1;
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
    if (target && p.fireTimer <= 0 && p.ammo > 0) fire(world, target);
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

    // 抵达防线：停住并转为持续攻击姿态（不会一次性消失）
    if (e.attacking) {
      const frozen = has(e.st, 'freeze') || has(e.st, 'stun');
      if (!frozen) {
        e.attackTimer -= dtMs;
        if (e.attackTimer <= 0) {
          e.attackTimer = e.atkIntervalMs;
          e.attackFlash = 220;
          damageFortress(world, e.atkDmg, e);
        }
      }
      continue; // 攻击姿态下不再推进
    }

    const mult = movementMultiplier(e);
    e.y += e.speed * mult * (dtMs / 1000);
    // 击退（一次性，结算即清）
    const kd = getKnockDistance(e.st);
    if (kd > 0) { e.y = applyKnockToPosition(e.y, kd, -9999).y; clear(e.st, 'knock'); if (e.y < FORTRESS.attackLine) e.attacking = false; }
    if (e.y >= FORTRESS.attackLine) {
      e.y = FORTRESS.attackLine;
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
      const rr = v.r + e.radius;
      if (dist2(v.x, v.y, e.x, e.y) <= rr * rr) {
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
        dealDamage(world, e, b.damage, 'weapon');
        b.hitIds.push(e.id);
        b.pierceLeft -= 1;
        for (let i = 0; i < 4; i++) {
          const a = Math.random() * Math.PI * 2, sp = 40 + Math.random() * 80;
          addParticle(world, b.x, b.y, Math.cos(a) * sp, Math.sin(a) * sp, 220, '#ffd36e', 2);
        }
        if (b.pierceLeft <= 0) { b.dead = true; break; }
        // 仍有穿透次数：继续飞，不 break
      }
    }
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
        SKILLS[s.id].hit(e, m);
        s.hitIds.push(e.id);
        if (!s.pierce) { explodeSkill(world, s); s.dead = true; break; }
      }
    }
  }

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
  world.enemies = world.enemies.filter((e) => e.alive);
  world.bullets = world.bullets.filter((b) => !b.dead);
  world.skillShots = world.skillShots.filter((s) => !s.dead);
  world.strikes = world.strikes.filter((s) => s.life > 0);
  world.arcs = world.arcs.filter((a) => a.life > 0);
  world.storms = world.storms.filter((s) => s.life > 0);
  world.vehicles = world.vehicles.filter((v) => !v.dead);
  world.particles = world.particles.filter((p2) => p2.life > 0);
  world.floaters = world.floaters.filter((f) => f.life > 0);
  world.rings = world.rings.filter((r) => r.life > 0);
}

export { CARDS, MERCY_CARD };
