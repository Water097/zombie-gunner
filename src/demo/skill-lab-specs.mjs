// 技能实验室的「测试实体工厂」—— 引擎/DOM 无关，Node 可直接跑桩验证。
//
// 这里造的 world 实体字段与 combat-core.mjs 的真实实体一一对应，参数全部取自 SKILLS
// （不是编的数字）。渲染直接调 skill-art.mjs —— 与 Demo 实机同一份代码。
// 所以本页 =「用可控的测试 world 驱动实机渲染层」：不用抽卡、不用等 CD、没有怪物干扰，
// 每个技能都能立刻、反复、干净地看完整演出。

import { WORLD } from './combat-core.mjs';
import * as Art from './skill-art.mjs';
import { S } from './lab-params.mjs';

export const LAB = {
  W: WORLD.W, H: WORLD.H,
  PET: { x: WORLD.W / 2, y: WORLD.H - 150 },   // 宠物机器人（技能发射点）
  FOE: { x: WORLD.W / 2, y: 250 },             // 目标敌人（正上方）
};

/** 目标方向角（标准 atan2，与 combat-core 的 acquireTarget 一致）。 */
export const toFoe = () => Math.atan2(LAB.FOE.y - LAB.PET.y, LAB.FOE.x - LAB.PET.x);

/** 一个空白测试世界：只包含 skill-art 会读的数组。 */
export const blankWorld = () => ({
  skillShots: [], strikes: [], storms: [], arcs: [], beams: [], sweeps: [],
  turrets: [], turretShots: [], saws: [], vehicles: [], flames: [],
});

/**
 * 舞台背景：简化战场 + 敌人剪影 + 发射点 + 目标方向轴。
 * 目标轴尤其重要 —— 一眼就能看出技能是不是「朝敌人打」（制导激光方向 bug 就是靠它暴露的）。
 */
export function drawBackdrop(ctx, o = {}) {
  const { W, H, PET, FOE } = LAB;
  ctx.save();
  ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
  ctx.fillStyle = '#0c1018'; ctx.fillRect(0, 0, W, H);
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, 'rgba(127,224,255,0.03)'); g.addColorStop(1, 'rgba(0,0,0,0.30)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  // 砖纹
  ctx.strokeStyle = 'rgba(127,224,255,0.045)'; ctx.lineWidth = 1; ctx.beginPath();
  for (let y = 0; y < H; y += 24) { ctx.moveTo(0, y + 0.5); ctx.lineTo(W, y + 0.5); }
  ctx.stroke();
  // 中线警戒线
  ctx.strokeStyle = 'rgba(255,210,87,0.20)'; ctx.setLineDash([8, 10]); ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(0, H * 0.5); ctx.lineTo(W, H * 0.5); ctx.stroke();
  ctx.setLineDash([]);
  // 目标方向轴
  if (o.axis) {
    ctx.strokeStyle = 'rgba(255,210,87,0.55)'; ctx.setLineDash([5, 7]); ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(PET.x, PET.y); ctx.lineTo(FOE.x, FOE.y); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(255,210,87,0.9)'; ctx.font = '11px monospace'; ctx.textAlign = 'left';
    ctx.fillText('目标方向', PET.x + 12, (PET.y + FOE.y) / 2);
  }
  // 敌人剪影（低对比参照物，不抢技能视线）
  for (const [x, y, r] of [[FOE.x, FOE.y, 20], [FOE.x - 105, FOE.y + 95, 16], [FOE.x + 110, FOE.y + 130, 17]]) {
    ctx.fillStyle = '#1a2430'; ctx.strokeStyle = '#3a4b5c'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#4a6076'; ctx.fillRect(x - 5, y - 3, 3, 3); ctx.fillRect(x + 3, y - 3, 3, 3);
  }
  // 发射点（宠物机器人）
  ctx.fillStyle = '#2b3a4c'; ctx.strokeStyle = '#7fe0ff'; ctx.lineWidth = 1.5;
  ctx.fillRect(PET.x - 11, PET.y - 9, 22, 18);
  ctx.strokeRect(PET.x - 11, PET.y - 9, 22, 18);
  ctx.fillStyle = '#7fe0ff'; ctx.font = '10px monospace'; ctx.textAlign = 'center';
  ctx.fillText('发射点', PET.x, PET.y + 28);
  if (o.axis) { ctx.fillStyle = 'rgba(255,210,87,0.8)'; ctx.fillText('目标', FOE.x, FOE.y - 28); }
  ctx.restore();
}

const P = (sk) => (label, value) => [label, String(value)];

// ── 9 个技能，每个一段独立可循环的演出 ─────────────────────────
export const SPECS = [
  {
    id: 'freeze', name: '干冰弹', tag: '冰系 · 点→小圆（落点）', color: S.freeze.color,
    read: '菱形冰晶弹 + 冷雾尾直线飞行 → 命中冻结。全程无火：霜点、冰棱、冷调压到底。',
    dur: 1.2,
    make(w) {
      const sk = S.freeze;
      w.skillShots.push({ id: 'freeze', x: LAB.PET.x, y: LAB.PET.y, vx: 0, vy: -sk.speed, radius: sk.radius, color: sk.color });
    },
    tick(w, dt) { for (const s of w.skillShots) { s.x += s.vx * dt; s.y += s.vy * dt; } },
    draw: (c, w, t) => Art.drawSkillShots(c, w, t),
    params: () => [['飞行速度', S.freeze.speed + ' px/s'], ['弹体半径', S.freeze.radius], ['命中', S.freeze.dmg + ' 伤害 + 冻结 2.5s'], ['冷却', (S.freeze.cooldownMs / 1000).toFixed(1) + 's']],
  },
  {
    id: 'burn', name: '温压弹', tag: '火系 · 点→圆（落点）', color: S.burn.color,
    read: '火红拖尾弹头直线飞行 → 接触即爆。命中爆炸反馈在实机由 soft-fx 的 rings/particles 承担。',
    dur: 1.2,
    make(w) {
      const sk = S.burn;
      w.skillShots.push({ id: 'burn', x: LAB.PET.x, y: LAB.PET.y, vx: 0, vy: -sk.speed, radius: sk.radius, color: sk.color });
    },
    tick(w, dt) { for (const s of w.skillShots) { s.x += s.vx * dt; s.y += s.vy * dt; } },
    draw: (c, w, t) => Art.drawSkillShots(c, w, t),
    params: () => [['飞行速度', S.burn.speed + ' px/s'], ['弹体半径', S.burn.radius], ['爆炸半径', S.burn.explodeR], ['命中', S.burn.dmg + ' 伤害 + 灼烧 + 击退'], ['冷却', (S.burn.cooldownMs / 1000).toFixed(1) + 's']],
  },
  {
    id: 'shock', name: '电磁天雷', tag: '能量系 · 精准单点（空降）', color: S.shock.color,
    read: '闪现渐显 → 折线雷从云底长下来击中目标 → 贴地椭圆电环 + 弹射电弧 → 消失。默认很快，可调「落雷演出时长」逐拍看清。',
    dur: 2.4,
    make(w) {
      const sk = S.shock, { FOE } = LAB;
      // 演出时长用实验室参数（实机固定 280/220ms，渲染层按 maxLife 归一化，同一份代码）
      w.strikes.push({ x: FOE.x, y: FOE.y, radius: sk.strikeR, minor: false, color: sk.color, life: sk.flashMs, maxLife: sk.flashMs, bolt: [] });
      w.arcs.push({ pts: [{ x: FOE.x, y: FOE.y }, { x: FOE.x + 58, y: FOE.y + 34 }, { x: FOE.x + 112, y: FOE.y + 16 }], color: sk.color, life: sk.arcMs, maxLife: sk.arcMs });
      w.storms.push({ x: FOE.x, y: FOE.y, r: sk.stormR, color: sk.color, life: sk.stormMs, maxLife: sk.stormMs });
    },
    tick(w, dt) {
      for (const s of w.strikes) s.life -= dt * 1000;
      for (const a of w.arcs) a.life -= dt * 1000;
      for (const s of w.storms) s.life -= dt * 1000;
    },
    draw: (c, w, t) => { Art.drawStorms(c, w, t); Art.drawStrikes(c, w, t); Art.drawArcs(c, w); },
    params: () => [['单发伤害', S.shock.strikeDmg], ['打击半径', S.shock.strikeR], ['弹射', S.shock.arcCount + ' 个 · ' + (S.shock.arcRatio * 100) + '%'], ['雷暴半径', S.shock.stormR], ['冷却', (S.shock.cooldownMs / 1000).toFixed(1) + 's']],
  },
  {
    id: 'vehicle', name: '装甲车', tag: '物理系 · 实体（纵向）', color: S.vehicle.color,
    read: '方盒子装甲车从要塞向上碾压，只有履带在滚、车身不动。左=重型（放大 + 侧裙反应装甲）。',
    dur: 3.2,
    make(w) {
      const sk = S.vehicle, y = LAB.PET.y + 40;
      w.vehicles.push({ x: LAB.PET.x + 60, y, w: sk.bodyW, h: sk.bodyH, vy: -sk.speed, life: 400, ramp: 0, heavy: false, color: sk.color });
      w.vehicles.push({ x: LAB.PET.x - 60, y: y + 30, w: sk.bodyHeavyW, h: sk.bodyHeavyH, vy: -sk.speed * sk.heavySpeedMul, life: 400, ramp: 0, heavy: true, color: sk.color });
    },
    tick(w, dt) { for (const v of w.vehicles) v.y += v.vy * dt; },
    draw: (c, w, t) => Art.drawVehicles(c, w, t),
    params: () => [['行进速度', S.vehicle.speed + ' px/s'], ['车身', S.vehicle.bodyW + '×' + S.vehicle.bodyH], ['重型', S.vehicle.bodyHeavyW + '×' + S.vehicle.bodyHeavyH], ['单段伤害', S.vehicle.dmg + ' / ' + S.vehicle.hitIntervalMs + 'ms'], ['击退/减速', S.vehicle.knock + ' / ' + (S.vehicle.slowMag * 100) + '%'], ['冷却', (S.vehicle.cooldownMs / 1000).toFixed(1) + 's']],
  },
  {
    id: 'ray', name: '高能射线', tag: '能量系 · 线（持续）', color: S.ray.color,
    read: '发生器 → 一根不动的持续光束，脉冲 = 多段伤害的可视化，顶端打点灼烧。',
    dur: 2.0,
    make(w) {
      const sk = S.ray;
      w.beams.push({ x: LAB.PET.x, y: LAB.PET.y, ang: toFoe(), len: sk.len, halfWidth: sk.halfWidth, life: sk.durMs, maxLife: sk.durMs, color: sk.color });
    },
    tick(w, dt) { for (const b of w.beams) b.life -= dt * 1000; },
    draw: (c, w, t) => Art.drawBeams(c, w, t),
    params: () => [['每跳伤害', S.ray.dmg], ['持续', S.ray.durMs / 1000 + 's'], ['跳数', Math.round(S.ray.durMs / S.ray.tickMs) + ' 段'], ['光束长度', S.ray.len + '（全屏）'], ['半宽', S.ray.halfWidth], ['冷却', (S.ray.cooldownMs / 1000).toFixed(1) + 's']],
  },
  {
    id: 'laser', name: '制导激光', tag: '能量系 · 面（扇面扫射）', color: S.laser.color,
    read: '窄扇面绕「目标方向」左右扫 + 扫痕 + 到边小爆。⚠️ 方向必须与目标轴一致（2026-11-11 修复）。',
    dur: 4.0,
    make(w) {
      const sk = S.laser;
      w.sweeps.push({ x: LAB.PET.x, y: LAB.PET.y, ang0: toFoe(), t: 0, life: sk.durMs, maxLife: sk.durMs, range: sk.range, halfAngle: sk.halfAngle, sweepAmp: sk.sweepAmp, color: sk.color });
    },
    tick(w, dt) { for (const s of w.sweeps) { s.t += dt * 1000; s.life -= dt * 1000; } },
    draw: (c, w) => Art.drawSweeps(c, w),
    params: () => [['每跳伤害', S.laser.dmg], ['持续', S.laser.durMs / 1000 + 's'], ['射程', S.laser.range], ['扇面半角', S.laser.halfAngle + ' rad'], ['扫动幅度', '±' + S.laser.sweepAmp + ' rad'], ['冷却', (S.laser.cooldownMs / 1000).toFixed(1) + 's']],
  },
  {
    id: 'turret', name: '哨戒机', tag: '物理系 · 实体（定点）', color: S.turret.color,
    read: '浮空哨戒无人机（形态 B · 已定稿）：环形主体 + 中央独眼 + 两侧能量翼 + 底部推进光；枪口始终对准目标，开火时独眼充能并射出青白能量束。',
    dur: 3.0,
    make(w) {
      const sk = S.turret, x = LAB.PET.x - 95, y = LAB.PET.y - 160;
      w.turrets.push({ x, y, r: sk.r, range: sk.range, life: 800, color: sk.color });
      w.turretShots.push({ x, y: y - 14, tx: LAB.FOE.x, ty: LAB.FOE.y, life: 120 });
    },
    tick(w, dt, cycle) {
      const period = S.turret.fireIntervalMs / 1000;
      const k = (cycle % period) / period;
      for (const s of w.turretShots) s.life = 120 * (1 - k);
    },
    draw: (c, w, t) => Art.drawTurrets(c, w, t),
    params: () => [['单发伤害', S.turret.dmg], ['射击间隔', S.turret.fireIntervalMs + 'ms'], ['射程', S.turret.range], ['存在', S.turret.lifeMs / 1000 + 's'], ['冷却', (S.turret.cooldownMs / 1000).toFixed(1) + 's']],
  },
  {
    id: 'flame', name: '燃烧地带', tag: '区域 · 面（封锁地面）', color: S.flame.color,
    read: '中心起燃 → 扩散到半径 → 持续 → 慢慢熄灭。概念图与实机共用 flame-field.mjs 同一份实现。',
    dur: 4.0,
    make(w) {
      const sk = S.flame;
      w.flames.push({ x: LAB.FOE.x, y: LAB.FOE.y + 40, r: sk.r, life: sk.lifeMs, maxLife: sk.lifeMs, color: sk.color });
    },
    tick() { /* FlameSprites 自己按 dt 推进 */ },
    draw: (c, w, t, dt, sprites) => { for (const f of w.flames) sprites.draw(c, f, dt); sprites.reap(w.flames); },
    params: () => [['每跳伤害', S.flame.dmgTick + ' / ' + S.flame.tickMs + 'ms'], ['半径', S.flame.r], ['持续', S.flame.lifeMs / 1000 + 's'], ['减速', (S.flame.slowMag * 100) + '% / ' + S.flame.slowMs + 'ms'], ['冷却', (S.flame.cooldownMs / 1000).toFixed(1) + 's']],
  },
  {
    id: 'saw', name: '旋转刀轮', tag: '物理系 · 实体（横向）', color: S.saw.color,
    read: '唯一横向作用的技能：巨型锯片横滚 + 火花 + 撞边折返，画面上要读成「横着扫过去」。',
    dur: 2.0,
    make(w) { w.saws.push({ x: -22, y: LAB.FOE.y + 30, r: S.saw.r, spin: 0, color: S.saw.color }); },
    tick(w, dt, cycle) {
      for (const s of w.saws) { s.x = -22 + ((cycle * S.saw.speed) % (LAB.W + 44)); s.spin = cycle; }
    },
    draw: (c, w, t) => Art.drawSaws(c, w, t),
    params: () => [['切割伤害', S.saw.dmg], ['横滚速度', S.saw.speed + ' px/s'], ['半径', S.saw.r], ['存在', S.saw.lifeMs / 1000 + 's'], ['冷却', (S.saw.cooldownMs / 1000).toFixed(1) + 's']],
  },
];

export const specById = (id) => SPECS.find((s) => s.id === id) ?? SPECS[0];
