// 技能类别 · 9 个技能图标（02 册已定稿名单）
// 沿用概念图定稿的「元素发光球 + 琥珀金属边框」，改成硬像素色阶版。
// 球体颜色 = 技能系别，中心符号 = 技能形态，两者分开读，避免 9 个球长一个样。

import {
  WHITE, INK, TAU, clamp, wrap, RAMPS, step,
  frameMeta, makeFx,
} from './pixel-lib.mjs';

const W = 96, H = 96, DUR = 2.0;

const SYMBOLS = {
  dryice: (p, x, y, R, u) => {                       // 冰：菱形 + 十字霜针
    p.poly([[x, y - 12], [x + 9, y], [x, y + 12], [x - 9, y]], R[7], 1);
    for (const an of [0, Math.PI / 2]) {
      p.line(x - Math.cos(an) * 13, y - Math.sin(an) * 13, x + Math.cos(an) * 13, y + Math.sin(an) * 13, R[7], 0.8);
    }
    p.circle(x, y, 2.5, WHITE, 1);
  },
  thermo: (p, x, y, R, u) => {                       // 火：8 向爆炸星
    const a = u * TAU;
    for (let i = 0; i < 8; i++) {
      const an = a + i * TAU / 8;
      p.line(x + Math.cos(an) * 3, y + Math.sin(an) * 3,
        x + Math.cos(an) * (10 + 3 * Math.sin(u * TAU * 2)), y + Math.sin(an) * (10 + 3 * Math.sin(u * TAU * 2)), R[7], 0.9);
    }
    p.circle(x, y, 4, WHITE, 1);
  },
  thunder: (p, x, y, R) => {                         // 雷：折线闪电
    p.polyline([[x + 3, y - 13], [x - 6, y - 1], [x + 1, y - 1], [x - 4, y + 13], [x + 8, y - 3], [x + 1, y - 3], [x + 6, y - 13]], R[7], 1);
    p.circle(x - 4, y + 13, 1.5, WHITE, 1);
  },
  vehicle: (p, x, y, R, u) => {                      // 装甲车：车体 + 双轮 + 前铲
    const dx = Math.sin(u * TAU) * 2;
    p.rect(x - 12 + dx, y - 5, 22, 10, R[7], 1);
    p.rect(x - 7 + dx, y - 10, 11, 6, R[6], 1);
    p.rect(x + 10 + dx, y - 3, 6, 6, R[7], 1);
    for (const wx of [-8, 6]) { p.circle(x + wx + dx, y + 7, 3.5, R[3], 1); p.dot(x + wx + dx, y + 7, R[7], 1); }
    p.line(x - 18 + dx, y + 2, x - 12 + dx, y + 2, R[6], 1);
  },
  beam: (p, x, y, R, u) => {                         // 高能射线：贯穿直线
    const k = 0.6 + 0.4 * Math.sin(u * TAU * 2);
    p.beam(x - 16, y, x + 16, y, 5 * k, R[7], 1);
    p.beam(x - 16, y, x + 16, y, 9 * k, R[5], 0.35);
    p.circle(x - 16, y, 2, WHITE, 1);
  },
  laser: (p, x, y, R, u) => {                        // 制导激光：窄扇面扫射
    const sweep = Math.sin(u * TAU) * 0.42;
    p.poly([[x - 14, y + 11], [x + 13 + sweep * 10, y - 12], [x + 17 + sweep * 10, y - 10], [x - 8, y + 13]], R[6], 0.45);
    p.line(x - 13, y + 11, x + 15 + sweep * 10, y - 11, R[7], 1);
    p.line(x - 13, y + 11, x + 11 + sweep * 10, y - 11, WHITE, 0.7);
  },
  turret: (p, x, y, R, u) => {                       // 哨戒机：底座 + 旋转炮管
    p.rect(x - 11, y + 4, 22, 7, R[6], 1);
    p.rect(x - 9, y + 4, 18, 1, R[7], 1);
    p.circle(x, y - 1, 7, R[4], 1);
    const an = -0.9 + Math.sin(u * TAU) * 0.5;
    p.beam(x, y - 1, x + Math.cos(an) * 15, y - 1 + Math.sin(an) * 15, 4, R[7], 1);
    p.dot(x, y - 1, WHITE, 1);
  },
  flamezone: (p, x, y, R, u) => {                    // 燃烧地带：地面火带
    for (let i = 0; i < 3; i++) {
      const yy = y + i * 5 - 3;
      for (let q = -12; q < 12; q += 4) {
        const h = 3 + 3 * Math.sin(u * TAU * 3 + q * 0.5 + i);
        p.line(x + q, yy, x + q + 2, yy - h, step(R, 0.5 + 0.3 * Math.sin(u * TAU + q)), 0.9);
      }
    }
    p.glow(x, y + 3, 16, R[5], 0.3);
  },
  saw: (p, x, y, R, u) => {                          // 旋转刀轮：齿轮
    const a = u * TAU * 2, n = 8;
    const pts = [];
    for (let i = 0; i < n * 2; i++) {
      const an = a + i * TAU / (n * 2), rr = i % 2 ? 10 : 14;
      pts.push([x + Math.cos(an) * rr, y + Math.sin(an) * rr]);
    }
    p.poly(pts, R[6], 1);
    p.circle(x, y, 5, INK, 1);
    p.circle(x, y, 2.5, R[7], 1);
  },
};

const SKILLS = [
  { id: 'dryice', name: '干冰弹', el: '冰系 · 纵向线穿透', shape: '穿透→冻结', r: RAMPS.ice, sym: 'dryice' },
  { id: 'thermo', name: '温压弹', el: '火系 · 落点圆', shape: '爆炸→灼烧+击退', r: RAMPS.fire, sym: 'thermo' },
  { id: 'thunder', name: '电磁天雷', el: '能量系 · 空降点选', shape: '锁敌落雷+感电', r: RAMPS.volt, sym: 'thunder' },
  { id: 'vehicle', name: '装甲车', el: '物理系 · 守线', shape: '碾击退', r: RAMPS.armor, sym: 'vehicle' },
  { id: 'beam', name: '高能射线', el: '能量系 · 持续光束', shape: '锁敌直线多段', r: RAMPS.flyer, sym: 'beam' },
  { id: 'laser', name: '制导激光', el: '能量系 · 窄扇面', shape: '左右扫射', r: RAMPS.arcane, sym: 'laser' },
  { id: 'turret', name: '哨戒机', el: '物理系 · 定点炮台', shape: '射程内兜底', r: RAMPS.gold, sym: 'turret' },
  { id: 'flamezone', name: '燃烧地带', el: '火系 · 地面火区', shape: '灼烧+减速', r: RAMPS.bomb, sym: 'flamezone' },
  { id: 'saw', name: '旋转刀轮', el: '物理系 · 横向滚刀', shape: '清越线敌', r: RAMPS.armor, sym: 'saw' },
];

function drawOrb(p, t, c) {
  const u = wrap(t, DUR) / DUR;
  const R = c.r, F = RAMPS.gold;
  const pulse = 0.5 + 0.5 * Math.sin(u * TAU * 2);
  // 琥珀 / 金属边框
  p.rect(-28, -30, 56, 60, INK, 1);
  p.rect(-27, -29, 54, 58, F[2], 1);
  p.rect(-25, -27, 50, 54, F[5], 1);
  p.rect(-23, -25, 46, 50, INK, 1);
  for (const [gx, gy] of [[-26, -28], [22, -28], [-26, 24], [22, 24]]) {
    p.rect(gx, gy, 4, 4, F[7], 1);
    p.dot(gx + 1, gy + 1, WHITE, 1);
  }
  // 元素球：硬色阶 + 脉动 + 加色辉光
  const rad = 16 + 1.6 * pulse;
  p.circle(0, -2, rad, (d) => step(R, clamp(0.78 - 0.58 * d + 0.14 * pulse)), 1);
  p.circle(-4, -7, 3.5, R[7], 0.85);
  p.glow(0, -2, 23 + 6 * pulse, R[5], 0.26 + 0.16 * pulse);
  // 形态符号
  SYMBOLS[c.sym](p, 0, -2, R, u);
  // 底部系别条
  p.rect(-18, 19, 36, 2, R[5], 0.9);
  p.rect(-18, 19, 12 + 10 * pulse, 2, R[7], 1);
}

export const SKILL_EFFECTS = SKILLS.map((c) => ({
  id: c.id, name: c.name, spec: c.el, mech: c.shape, read: `元素球 + ${c.shape} 符号`,
  source: '内核新写', demoHook: `skill.id === '${c.id}' → drawSkillIcon()`,
  mod: makeFx(frameMeta(c.name, W, H, {
    desc: `${c.el}｜${c.shape}`, tags: ['skill', c.id], duration: DUR, oy: H / 2,
  }), (p, t) => drawOrb(p, t, c)),
}));
