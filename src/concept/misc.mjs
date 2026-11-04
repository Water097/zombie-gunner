// 角色 / 宠物 / 要塞 —— 库里没有实体立绘，用 Painter 从零写的像素帧动画。
// 三者都是 pure effect，createFx 可直接调用。

import {
  WHITE, INK, TAU, wrap, clamp, C, RAMPS, step, blob, eyes, groundShadow,
  frameMeta, makeFx,
} from './pixel-lib.mjs';

const SKIN = C(['#241610', '#4a2c18', '#7c4a28', '#b37642', '#dba066', '#f2c894', '#ffe8c8', '#ffffff']);

// ── 角色：Q 版炮手，大头 + 头盔 + 软边面罩 + 持枪，开火时后坐 + 枪口闪白 ──
function drawHero(p, t) {
  const u = wrap(t, 1.6) / 1.6;
  const bob = Math.sin(u * TAU) * 1;
  const ph = wrap(u * 3, 1);
  const firing = ph < 0.18;
  const recoil = firing ? 1.5 : 0;
  const M = RAMPS.metal;
  groundShadow(p, 0, 12, 0, 0.45);

  // 腿 + 靴
  p.rect(-6, -6 + bob, 5, 6, M[2], 1);
  p.rect(2, -6 + bob, 5, 6, M[2], 1);
  p.rect(-7, -2, 6, 2, M[5], 1);
  p.rect(2, -2, 6, 2, M[5], 1);
  // 身体
  p.rect(-9, -19 + bob, 18, 14, SKIN[2], 1);
  p.rect(-9, -19 + bob, 18, 2, SKIN[5], 1);
  p.rect(-9, -8 + bob, 18, 1, INK, 1);
  p.rect(-3, -17 + bob, 6, 8, RAMPS.volt[4], 1);   // 胸口能量核
  p.glow(0, -13 + bob, 8, RAMPS.volt[5], 0.28);
  // 手臂 + 枪
  p.rect(7 - recoil, -16 + bob, 6, 5, SKIN[3], 1);
  p.rect(10 - recoil, -15 + bob, 18, 3, M[4], 1);
  p.rect(10 - recoil, -15 + bob, 18, 1, M[7], 1);
  p.rect(9 - recoil, -13 + bob, 5, 6, M[2], 1);
  // 头
  blob(p, 0, -29 + bob, 10, 9, SKIN, { noGlint: true });
  eyes(p, 0, -30 + bob, 4, { closed: u > 0.93 });
  // 头盔（深青柔边改成硬色阶板）
  p.rect(-11, -39 + bob, 22, 6, M[3], 1);
  p.rect(-11, -39 + bob, 22, 1, M[7], 1);
  p.rect(-11, -34 + bob, 3, 5, M[2], 1);
  p.rect(8, -34 + bob, 3, 5, M[2], 1);
  p.rect(-6, -36 + bob, 12, 3, RAMPS.volt[4], 1);  // 面罩光条
  // 开火
  if (firing) {
    const k = 1 - ph / 0.18, mx = 29 - recoil;
    p.circle(mx, -13.5 + bob, 2 + 4 * k, RAMPS.volt[7], 0.9 * k);
    p.glow(mx, -13.5 + bob, 12, RAMPS.volt[6], 0.4 * k);
    p.line(mx + 2, -13.5 + bob, mx + 14, -13.5 + bob, RAMPS.volt[7], 0.8 * k);
  }
}

// ── 宠物：机械猫，悬浮在角色旁，耳 + 面罩 + 尾巴光点 ──
function drawPet(p, t) {
  const u = wrap(t, 2.0) / 2.0;
  const fy = -14 - Math.sin(u * TAU) * 3;
  const M = RAMPS.metal, A = RAMPS.flyer;
  groundShadow(p, 0, 9, Math.abs(fy + 10), 0.22);
  // 尾巴
  p.polyline([[8, fy + 6], [14, fy + 3], [16, fy - 2], [13, fy - 6]], M[3], 1);
  p.dot(13, fy - 6, A[6], 1);
  p.glow(13, fy - 6, 5, A[5], 0.3);
  // 身体 + 头
  p.rect(-8, fy - 1, 16, 10, M[3], 1);
  p.rect(-8, fy - 1, 16, 1, M[6], 1);
  blob(p, 0, fy - 6, 8, 7, M, { noGlint: true });
  // 猫耳
  p.poly([[-8, fy - 10], [-8, fy - 18], [-2, fy - 12]], M[4], 1);
  p.poly([[8, fy - 10], [8, fy - 18], [2, fy - 12]], M[4], 1);
  p.poly([[-6, fy - 11], [-7, fy - 16], [-3, fy - 12]], A[4], 1);
  p.poly([[6, fy - 11], [7, fy - 16], [3, fy - 12]], A[4], 1);
  // 面罩 + 眼
  p.rect(-6, fy - 8, 12, 4, A[3], 1);
  p.rect(-4, fy - 7, 3, 2, A[7], 1);
  p.rect(2, fy - 7, 3, 2, A[7], 1);
  p.glow(0, fy - 6, 10, A[5], 0.22);
  // 爪
  p.rect(-7, fy + 8, 5, 3, M[5], 1);
  p.rect(3, fy + 8, 5, 3, M[5], 1);
}

// ── 要塞：工业墙体 + 金属板缝 + 上半能量护罩 + 中央炮台 ──
function drawFortress(p, t) {
  const u = wrap(t, 2.4) / 2.4;
  const M = RAMPS.metal, A = RAMPS.flyer;
  const pulse = 0.5 + 0.5 * Math.sin(u * TAU * 1.5);
  // 墙体
  p.rect(-42, -44, 84, 44, M[2], 1);
  p.rect(-42, -44, 84, 3, M[6], 1);
  p.rect(-42, -4, 84, 4, M[1], 1);
  for (const gx of [-28, -8, 12, 32]) p.line(gx, -41, gx, -4, M[1], 0.9);
  for (const gy of [-32, -20]) p.line(-42, gy, 42, gy, M[1], 0.9);
  // 铆钉
  for (const gx of [-36, -18, 0, 18, 36]) {
    p.dot(gx, -42, M[7], 1);
    p.dot(gx, -6, M[6], 1);
  }
  // 中央炮台
  p.rect(-11, -56, 22, 14, M[4], 1);
  p.rect(-11, -56, 22, 2, M[7], 1);
  p.rect(-4, -64, 8, 9, M[5], 1);
  p.rect(-2, -64, 4, 2, A[7], 1);
  p.circle(0, -49, 3, A[6], 1);
  p.glow(0, -49, 10, A[5], 0.3);
  // 能量护罩上半（arc：π→2π 正好是上半圆）
  p.arc(0, -4, 44, 2, Math.PI, TAU, A[5], 0.28 + 0.24 * pulse);
  p.arc(0, -4, 40, 1, Math.PI, TAU, A[6], 0.20 + 0.20 * pulse);
  p.glow(0, -30, 46, A[4], 0.10 + 0.08 * pulse);
  // 护罩扫光
  const an = Math.PI + wrap(u, 1) * Math.PI;
  p.dot(Math.cos(an) * 44, -4 + Math.sin(an) * 44, A[7], 0.8);
}

const ACTORS = [
  { id: 'hero', name: '角色 · 炮手', desc: '固定在要塞前 · 自动瞄准 / 自动开火', w: 96, h: 88, fn: drawHero, dur: 1.6 },
  { id: 'pet', name: '宠物 · 机械猫', desc: '角色旁发射技能 · 跟随悬浮', w: 96, h: 88, fn: drawPet, dur: 2.0 },
  { id: 'fortress', name: '要塞', desc: '300 血 · 缓回 2/s · 受击停 3s', w: 128, h: 96, fn: drawFortress, dur: 2.4 },
];

export const ACTOR_EFFECTS = ACTORS.map((a) => ({
  id: a.id, name: a.name, spec: a.desc, mech: a.desc, read: '像素实体帧动画',
  source: '内核新写', demoHook: `draw${a.id[0].toUpperCase() + a.id.slice(1)}()`,
  mod: makeFx(frameMeta(a.name, a.w, a.h, {
    desc: a.desc, tags: ['actor', a.id], duration: a.dur, oy: a.h - 12,
  }), a.fn),
}));
