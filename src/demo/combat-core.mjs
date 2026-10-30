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
import { CARDS, MERCY_CARD, rollCards } from './cards.mjs';

// ── 世界尺寸（逻辑像素，竖屏）──
export const WORLD = { W: 450, H: 800 };

// ── 要塞炮塔（玩家）基准参数 ──
export const PLAYER = {
  x: WORLD.W / 2,
  y: WORLD.H - 64,       // 要塞位于屏幕下方（玩家前方）
  baseDamage: 20,         // 每发基础伤害：普通僵尸 60 血 → 3 发一只
  fireIntervalMs: 500,    // 射速：1 秒 2 发
  magSize: 12,            // 弹匣容量
  reloadMs: 1600,         // 换弹耗时
  range: 560,             // 自动瞄准射程
  bulletSpeed: 700,       // 子弹速度 px/s
  bulletRadius: 5,
  bulletPierce: 2,        // 初始穿透 2：可穿透第一个敌人打到第二个
};

// ── 要塞：位于玩家前方，敌人抵达后停在防线前持续攻击（不是撞上去就消失）──
export const FORTRESS = {
  maxHp: 100,
  attackLine: WORLD.H - 110, // 敌人推进到此线即停住，转为攻击姿态
};

// ── 敌人类型（对齐 14 册 targetType 与 04 册出怪纪律）──
// 新增 atkDmg / atkIntervalMs：抵达要塞后的攻击力与攻击频率
export const ENEMY_TYPES = {
  zombie:  { name: '普通僵尸', targetType: 'normal',  hp: 60,  speed: 14, radius: 16, color: '#7fb069', score: 60,  xp: 10, atkDmg: 6,  atkIntervalMs: 1500 },
  runner:  { name: '疾行尸',   targetType: 'normal',  hp: 40,  speed: 30, radius: 12, color: '#e9c46a', score: 45,  xp: 12, atkDmg: 5,  atkIntervalMs: 1200 },
  armored: { name: '装甲尸车', targetType: 'armored', hp: 300, speed: 10, radius: 24, color: '#577590', score: 200, xp: 40, atkDmg: 14, atkIntervalMs: 2000, vehicleLevel: 20 },
};

// ── 三技能（9 技能里的代表：冰弹穿透 / 温压爆炸 / 电磁雷击）──
// 对齐 02 册：每个技能是"独立攻击体系 + 弹道"，不是要塞静态光环。
// 设计形态：温压=点→圆（落点爆炸）／干冰=点→小圆（穿透）／电磁=线（穿透溅射）。
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
  shock: {
    name: '电磁', key: '3', color: '#ffe14d', cooldownMs: 10000,
    speed: 420, pierce: true, explodeR: 0, radius: 5, knock: 40, // 速度由 1000 下调：原值太快看不见弹道
    hit: (e, m) => {
      apply(e.st, 'stun', 1, 1100, { sourceId: 'skill-shock', sourceLevel: 1, displaceType: 'normal' });
      apply(e.st, 'shock', 0.6, 2600 + m.shockDurBonus, { sourceId: 'skill-shock', sourceLevel: 1, displaceType: 'normal' });
      apply(e.st, 'knock', 40, 0, { sourceId: 'skill-shock', sourceLevel: 1, displaceType: 'normal' }); // 普通位移，装甲不免疫
    },
  },
};

let _idSeq = 1;

// ── 加成/武器/技能卡的累计修正（08 册约束3：同桶加算，不连乘）──
function defaultMods() {
  return {
    bulletDamage: 1,      // 子弹伤害倍率
    fireRate: 1,          // 射速倍率（间隔 = 基础 / 此值）
    magBonus: 0,          // 弹匣加值（发）
    magMul: 1,            // 弹匣倍率（代价卡用）
    pierceBonus: 0,       // 穿透加值
    freezeDurBonus: 0,    // 冻结时长加值 ms
    burnRadiusMul: 1,     // 温压爆炸半径倍率
    burnDmgMul: 1,        // 灼烧伤害倍率
    burnKnock: 25,        // 温压击退距离
    shockDurBonus: 0,     // 感电时长加值 ms
    dmgVsFrozen: 1,       // 破冰：对冻结目标
    dmgVsBurn: 1,         // 助燃：对燃烧目标
    dmgVsShock: 1,        // 导电体：对感电目标
    crossfire: 1,         // 交叉火力：场上敌人 ≥8 时生效
    xpRate: 1,            // 快速学习
    skillCdMul: { freeze: 1, burn: 1, shock: 1 },
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
    particles: [],
    floaters: [],
    rings: [],
    skills: { freeze: { cd: 0 }, burn: { cd: 0 }, shock: { cd: 0 } },
    mods: defaultMods(),
    // ── 升级 / 选卡（03 册）──
    level: 1,
    xp: 0,
    xpNext: 40,
    pendingCards: [],
    cardPhase: false,
    cardStacks: {},      // 每张卡已叠层数（叠满移出池）
    bonusTaken: 0,       // 已拿加成卡数（08 册软上限：按等级分层解锁）
    mercyArmed: false,   // 要塞血量首次跌破 50% → 下一抽出现「要塞急救」
    mercyUsed: false,
    fortressHp: FORTRESS.maxHp,
    fortressMaxHp: FORTRESS.maxHp,
    fortressFlash: 0,
    spawnTimer: 700,
    wave: 1,
    score: 0,
    killCount: 0,
  };
}

function dist2(ax, ay, bx, by) { const dx = ax - bx, dy = ay - by; return dx * dx + dy * dy; }

// 当前弹匣容量（受卡影响，实时算）
export function magSizeOf(world) {
  return Math.max(1, Math.round((PLAYER.magSize + world.mods.magBonus) * world.mods.magMul));
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
  world.enemies.push({
    id: _idSeq++,
    type: typeKey,
    ...t,
    x: lane,
    y: -30,
    hp: t.hp,
    maxHp: t.hp,
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

// 伤害结算：唯一入口。装甲车×冻结硬门禁在此生效。
function dealDamage(world, enemy, raw, source = 'weapon') {
  const mult = enemy.vehicleLevel ? vehicleRammedMultiplier(enemy.st, enemy.vehicleLevel) : 1;
  const dmg = raw * mult;
  enemy.hp -= dmg;
  enemy.hitFlash = 90;
  if (mult > 1) addFloater(world, enemy.x, enemy.y - enemy.radius, `×${mult}  ${Math.round(dmg)}`, '#ff4d4d');
  else addFloater(world, enemy.x, enemy.y - enemy.radius, `${Math.round(dmg)}`, source === 'burn' ? '#ff9a3c' : '#ffffff');
  if (enemy.hp <= 0) killEnemy(world, enemy);
}

// 条件增伤（08 册 A 类放大器：每张只奖励一种配合，带主语）
function conditionMultiplier(world, enemy) {
  const st = enemy.st, m = world.mods;
  let d = 1;
  if (has(st, 'freeze')) d *= m.dmgVsFrozen;
  if (has(st, 'burn')) d *= m.dmgVsBurn;
  if (has(st, 'shock')) d *= m.dmgVsShock;
  if (m.crossfire > 1 && world.enemies.length >= 8) d *= m.crossfire;
  return d;
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
  if (world.xp >= world.xpNext) {
    world.xp -= world.xpNext;
    world.level += 1;
    world.xpNext = Math.round(world.xpNext * 1.35);
    world.pendingCards = rollCards(world);
    world.cardPhase = true;   // 暂停战斗，等玩家选卡
  }
}

export function chooseCard(world, idx) {
  if (!world.cardPhase) return false;
  const card = world.pendingCards[idx];
  if (!card) return false;
  if (card.id === MERCY_CARD.id) {
    // 功能卡「要塞急救」：立即回复最大血量 30%（03 册九节，一局仅一次）
    world.fortressHp = Math.min(world.fortressMaxHp, world.fortressHp + world.fortressMaxHp * 0.3);
    addFloater(world, world.player.x, world.player.y - 40, '要塞急救 +30%', '#7fe07f');
  } else {
    card.apply(world.mods);
    world.cardStacks[card.id] = (world.cardStacks[card.id] || 0) + 1;
    if (card.kind === 'bonus') world.bonusTaken += 1;
  }
  world.pendingCards = [];
  world.cardPhase = false;
  return true;
}

// 要塞受击：敌人按自身攻击频率持续掉要塞的血（不是撞上来一次性扣命）
function damageFortress(world, dmg, enemy) {
  world.fortressHp = Math.max(0, world.fortressHp - dmg);
  world.fortressFlash = 220;
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

function fire(world, target) {
  const p = world.player;
  const m = world.mods;
  const ang = Math.atan2(target.y - p.y, target.x - p.x);
  p.angle = ang;
  const pierce = PLAYER.bulletPierce + m.pierceBonus;
  world.bullets.push({
    x: p.x + Math.cos(ang) * 28,
    y: p.y + Math.sin(ang) * 28,
    vx: Math.cos(ang) * PLAYER.bulletSpeed,
    vy: Math.sin(ang) * PLAYER.bulletSpeed,
    damage: PLAYER.baseDamage * m.bulletDamage,
    life: 1400,
    radius: PLAYER.bulletRadius,
    pierceLeft: pierce,   // 穿透：可连续命中 pierce 个敌人
    hitIds: [],           // 同一敌人不重复结算
  });
  p.ammo -= 1;
  p.fireTimer = PLAYER.fireIntervalMs / m.fireRate;
  if (p.ammo <= 0 && !p.reloading) startReload(world);
}

function startReload(world) {
  const p = world.player;
  if (p.reloading || p.ammo >= magSizeOf(world)) return;
  p.reloading = true;
  p.reloadTimer = PLAYER.reloadMs;
}

export function manualReload(world) {
  if (world.gameOver) return;
  startReload(world);
}

export function castSkill(world, id) {
  if (world.gameOver) return false;
  const sk = SKILLS[id];
  if (!sk) return false;
  const slot = world.skills[id];
  if (!slot || slot.cd > 0) return false;
  const p = world.player;
  const m = world.mods;
  // 自动瞄准：取射程内最近敌人；无目标则朝正上方（避免空放）
  const tgt = acquireTarget(world) || { x: p.x, y: 0 };
  const ang = Math.atan2(tgt.y - p.y, tgt.x - p.x);
  world.skillShots.push({
    id, color: sk.color,
    x: p.x + Math.cos(ang) * 30, y: p.y + Math.sin(ang) * 30,
    vx: Math.cos(ang) * sk.speed, vy: Math.sin(ang) * sk.speed,
    pierce: sk.pierce,
    explodeR: sk.explodeR * m.burnRadiusMul,
    radius: sk.radius, life: 2000, dead: false,
    hitIds: [], // 穿透弹每帧都会与同一敌人重叠，靠它保证"每个敌人只生效一次"
  });
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
  world.spawnTimer -= dtMs;
  if (world.spawnTimer <= 0) {
    const batch = 1 + (Math.random() < 0.3 ? 1 : 0);
    for (let i = 0; i < batch; i++) spawnEnemy(world, pickEnemyType(world));
    const speedUp = Math.max(420, 900 - world.wave * 22);
    world.spawnTimer = speedUp;
    if (world.time > world.wave * 22000) world.wave += 1;
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
    if (dot > 0) { e.hp -= dot; if (e.hp <= 0) { killEnemy(world, e); continue; } }
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
        dealDamage(world, e, b.damage * conditionMultiplier(world, e), 'weapon');
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
  if (world.fortressFlash > 0) world.fortressFlash -= dtMs;

  // ── 清理死亡实体 ──
  world.enemies = world.enemies.filter((e) => e.alive);
  world.bullets = world.bullets.filter((b) => !b.dead);
  world.skillShots = world.skillShots.filter((s) => !s.dead);
  world.particles = world.particles.filter((p2) => p2.life > 0);
  world.floaters = world.floaters.filter((f) => f.life > 0);
  world.rings = world.rings.filter((r) => r.life > 0);
}

export { CARDS, MERCY_CARD };
