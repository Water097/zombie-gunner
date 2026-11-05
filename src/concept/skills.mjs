// 技能类别 · 9 个技能各自的「技能演出」
//
// ── 第五版（2026-11-05 重做）────────────────────────────────
// 用户原话：「所有的技能都是一个圆球，只是不同的颜色罢了，根本没有自己的技能形态。」
// 说得对。旧版是「元素球 + 中心符号」，那是图标，不是技能。
//
// 本版把每个技能当成一次**事件**来画，统一四拍：
//
//     出手 → 飞行 / 展开 → 命中 → 残留
//
// 每一拍都必须能让玩家读出「这个技能在干什么」，而不是「这个技能是什么颜色」。
// 02 册 3.1 的「九个空间占位」是硬约束，画面必须和它对齐：
//
//   温压弹   点→圆（落点）     弹头升空 + 火尾 + 两段火爆
//   干冰弹   点→小圆（落点）   冰弹 + 冷雾尾 + 霜环 + 冰封
//   电磁天雷 点→圆（空降）     积云 + 折线雷 + 电环 + 爬电
//   装甲车   实体（纵向移动）  履带推进 + 车身抖动 + 扬尘（重型版更大更硬）
//   高能射线 线（持续）        发生器 + 脉冲光束 + 打点灼烧
//   制导激光 面（扇面扫射）    窄扇面左右扫 + 扫痕 + 终点爆
//   哨戒机   实体（定点）      底座炮塔 + 转塔锁敌 + 连点射
//   燃烧地带 面（区域）        从 0 起燃 → 扩散到半径 → 持续 → 慢慢熄灭
//   旋转刀轮 实体（横向移动）  巨型锯片横滚 + 火花 + 撞边折返
//
// 纪律（沿用装备图标规范 v1）：硬形体 a=1；半透明只用 p.disc；光走加色；主色系唯一 + 白核表示能量峰值。

import { WHITE, frameMeta, makeFx } from './pixel-lib.mjs';
import { hex } from '../../vendor/pixelfx/src/core/color.js';
import { wrap, TAU, clamp, ease } from '../../vendor/pixelfx/src/core/index.js';
import { R, GROUND, rnd, groundRing, shockRing, trail, blast, smoke, embers, scorch, arc } from './skill-lib.mjs';

const W = 112, H = 88;

// ── 每个技能的主色系（显式 7 档；不经过 RAMPS，避免命名与实际色值错位）──
const EL = {
  fire:  R(['#1a0603', '#3d0d05', '#7a1e08', '#c43a0c', '#f2681a', '#ffa64a', '#fff0c8']),
  ice:   R(['#071a2e', '#0d3355', '#16618f', '#2a9bd4', '#66cdf0', '#b8ecff', '#f0feff']),
  volt:  R(['#0d0a24', '#1e1652', '#3a2c96', '#5f4ad6', '#8b7af0', '#c0b4ff', '#f2eeff']),
  steel: R(['#0e1318', '#1a222b', '#2b3644', '#41505f', '#5d6e80', '#8b9aa8', '#c6cfd9']),
  // 军绿：装甲车专用（02 册定「军绿」）
  olive: R(['#0a1408', '#12260f', '#1e3d18', '#2f5c22', '#4a7f2f', '#79a84a', '#c8e09a']),
  cyan:  R(['#04161c', '#08303c', '#0d5566', '#158a9e', '#35c2d4', '#8ee8f2', '#e0feff']),
  laser: R(['#1f1805', '#43350a', '#7a6110', '#b8911a', '#e8c23c', '#ffe680', '#fffce0']),
  ember: R(['#120607', '#2a0a0d', '#4d1216', '#7a1e22', '#a83535', '#d05c4e', '#f0a882']),
  chrome:R(['#0b0d10', '#1b1f24', '#2e343c', '#4a525c', '#6f7a86', '#a8b3bf', '#e8eef5']),
};

const INKC = hex('#080e14');
const seg = (t, a, b) => clamp((t - a) / (b - a || 1e-9));

// ─────────────────────────────────────────────────────────────
// 1 · 温压弹：弹头升空（火红拖尾）→ 落点两段火爆（燃料空气弹）
// ─────────────────────────────────────────────────────────────
function drawThermo(p, t) {
  const D = 3.2, T0 = 0.95, T1 = 1.55;
  const u = wrap(t, D);
  const C = EL.fire;
  if (u > T0) scorch(p, 0, 30, 0.5);

  if (u < T0) {
    // 上升：前快后慢，带轻微横摆
    const k = ease.outQuad(u / T0);
    const y = 40 - 56 * k;
    const x = Math.sin(u * 14) * (1 - k) * 3;
    trail(p, x, y + 7, 24, 6, C, u);
    // 弹体：白尖 + 橙身 + 尾翼
    p.poly([[x, y - 11], [x + 3.5, y - 5], [x + 3.5, y + 5], [x - 3.5, y + 5], [x - 3.5, y - 5]], C[5], 1);
    p.poly([[x, y - 11], [x + 2.5, y - 6], [x - 2.5, y - 6]], WHITE, 1);
    p.rect(x - 4, y + 2, 9, 2, C[2], 1);
    p.line(x - 6, y + 6, x - 3.5, y - 2, C[2], 1);
    p.line(x + 6, y + 6, x + 3.5, y - 2, C[2], 1);
    p.glow(x, y + 10, 10, C[4], 0.30);
    return;
  }

  // 第一段爆
  const k1 = (u - T0) / 0.5;
  if (k1 < 1) blast(p, 0, -12, 30, k1, C, { debris: 12 });
  // 第二段爆（燃料空气弹：延迟 0.35s，范围小一圈）
  const k2 = (u - (T0 + 0.35)) / 0.45;
  if (k2 > 0 && k2 < 1) blast(p, 2, -8, 20, k2, C, { debris: 8 });

  // 残留：烟上升 + 地面余烬 + 火圈
  const after = seg(u, T1, D);
  if (after > 0) {
    // 残留：地面还在烧的一圈小火 + 余烟 + 余烬（温压弹的「灼烧」要看得见）
    smoke(p, -6, -10 - 14 * after, 18, 0.85 * (1 - after * 0.25));
    smoke(p, 10, -14 - 16 * after, 12, 0.60 * (1 - after * 0.35));
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * TAU + 0.5;
      const rr = 18 + 4 * rnd(i);
      const x = Math.cos(a) * rr, y = GROUND + Math.sin(a) * rr * 0.34;
      const h = (5 + 4 * rnd(i, 2)) * (1 - after * 0.55) * (0.8 + 0.2 * Math.sin(u * 11 + i));
      p.poly([[x - 2, y], [x, y - h], [x + 2, y]], C[2], 1);
      p.poly([[x - 1, y], [x + 0.2, y - h * 0.6], [x + 1, y]], C[5], 1);
    }
    embers(p, 0, GROUND - 6, 40, 12, C, u, 0.95 * (1 - after * 0.4));
    groundRing(p, 0, GROUND, 26, C[2], 1, 1);
    p.glow(0, GROUND, 34, C[3], 0.32 * (1 - after));
  }
}

// ─────────────────────────────────────────────────────────────
// 2 · 干冰弹：冰弹 + 冷雾尾 → 霜环 + 冰封
// ─────────────────────────────────────────────────────────────
function drawDryice(p, t) {
  const D = 2.8, T0 = 0.8;
  const u = wrap(t, D);
  const C = EL.ice;

  if (u < T0) {
    const k = ease.outQuad(u / T0);
    const y = 40 - 50 * k;
    const x = Math.sin(u * 10) * (1 - k) * 2;
    trail(p, x, y + 6, 18, 4, C, u, { sway: 1.6 });
    // 冰弹：菱形晶体
    p.poly([[x, y - 9], [x + 4, y - 2], [x, y + 6], [x - 4, y - 2]], C[5], 1);
    p.poly([[x, y - 9], [x + 4, y - 2], [x, y - 2]], WHITE, 1);
    p.poly([[x, y - 9], [x - 4, y - 2], [x, y - 2]], C[3], 1);
    // 冷雾：向两侧飘的霜点
    for (let i = 0; i < 6; i++) {
      const ph = (u * 2 + rnd(i)) % 1;
      p.dot(Math.round(x + (rnd(i, 2) - 0.5) * 20), Math.round(y + 8 + ph * 16), C[6], 0.6 * (1 - ph));
    }
    return;
  }

  // 命中：霜环扩散 + 霜针生长
  const k = seg(u, T0, T0 + 0.55);
  const r = 8 + 26 * ease.outQuad(k);
  groundRing(p, 0, GROUND - 2, r, C[5], 1, k < 0.7 ? 2 : 1);
  groundRing(p, 0, GROUND - 2, r * 0.62, C[6], 0.9, 1);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * TAU + 0.4;
    const rr = r * 0.85;
    const x = Math.round(Math.cos(a) * rr), y = Math.round(GROUND - 2 + Math.sin(a) * rr * 0.34);
    const h = Math.round((6 + 7 * rnd(i)) * Math.min(1, k * 2));
    p.poly([[x - 1.6, y], [x + 0.6, y - h], [x + 2.2, y]], C[3], 1);
    p.poly([[x - 1.6, y], [x + 0.6, y - h], [x - 0.4, y - h * 0.2]], C[6], 1);
  }
  p.glow(0, GROUND - 2, 34, C[4], 0.22 * (1 - seg(u, T0 + 0.5, D)));

  // 冰封：中心长起一簇冰晶（代表被冻住的目标）
  const fb = seg(u, T0 + 0.12, T0 + 0.45);
  if (fb > 0) {
    const G = GROUND - 2;
    const crystals = [
      [0, 22, 7, 0],       // x, 高度, 半宽, 倾斜
      [-9, 13, 5, -1],
      [8, 15, 5, 1],
    ];
    for (const [cxx, hh, hw, tilt] of crystals) {
      const h = hh * fb;
      const bx = cxx, tx = cxx + tilt * 2;
      // 暗面
      p.poly([[bx - hw, G], [tx + tilt, G - h], [tx + hw * 0.7 + tilt, G - h], [bx + hw, G]], C[2], 1);
      // 亮面
      p.poly([[bx - hw, G], [tx + tilt, G - h], [tx + tilt, G - 1], [bx - hw * 0.2, G]], C[5], 1);
      // 顶棱
      p.line(tx + tilt, G - h, tx + hw * 0.7 + tilt, G - h, C[6], 1);
      p.dot(tx + tilt, G - h - 1, WHITE, 1);
    }
    p.glow(0, G - 8, 18, C[5], 0.30 * fb);
  }
  // 寒气下沉
  if (u > T0) {
    for (let i = 0; i < 5; i++) {
      const ph = (u * 0.8 + rnd(i, 4)) % 1;
      p.dot(Math.round(-20 + rnd(i, 6) * 40), Math.round(GROUND + ph * 8), C[6], 0.35 * (1 - ph));
    }
  }
}

// ─────────────────────────────────────────────────────────────
// 3 · 电磁天雷：积云 → 折线雷劈下 → 电环 + 爬电
// ─────────────────────────────────────────────────────────────
function drawThunder(p, t) {
  const D = 2.8, T0 = 0.62, T1 = 1.25;
  const u = wrap(t, D);
  const C = EL.volt;

  // 积云：三团暗紫云，落雷前会闪
  const charge = seg(u, 0, T0);
  const flash = u > T0 - 0.12 && u < T1 ? (Math.sin(u * 90) > 0 ? 1 : 0.35) : 1;
  // 积云：一簇球压出平底，上方再补一层受光
  const puffs = [[-20, -26, 11], [-9, -30, 13], [4, -31, 14], [17, -28, 12], [25, -25, 9]];
  for (const [cx, cy, r] of puffs) {
    const rr = r * (0.88 + 0.12 * charge);
    p.disc(cx, cy, rr, hex('#1e1734'), 0.95);
  }
  p.ellipse(3, -22, 30, 7, hex('#1e1734'), 0.95);             // 云底压平成椭圆
  for (const [cx, cy, r] of puffs) p.disc(cx - 2, cy - 3, r * 0.62, hex('#3a2f5e'), 0.55 * flash);

  p.glow(0, -30, 26, C[4], 0.10 + 0.30 * charge * flash);

  // 落雷
  if (u >= T0 && u < T1 + 0.2) {
    const f = Math.floor(u * 60);           // 每帧重掷折线 → 抖动感
    const a = u < T1 ? 1 : 1 - seg(u, T1, T1 + 0.2);
    // 主雷
    const EY = GROUND - 6;
    p.line(2, -22, 0, EY, C[6], a);
    arc(p, 2, -22, 0, EY, C[5], f, 3);
    arc(p, 2, -22, 0, EY, WHITE, f + 7, 1.5);
    // 分叉
    arc(p, 0, -6, -13, 6, C[4], f + 3, 2.5);
    arc(p, 0, -2, 12, 8, C[4], f + 5, 2.5);
    p.glowLine(2, -22, 0, EY, 8, C[4], 0.55 * a);
  }

  // 落点：电环 + 爬电
  if (u > T0 + 0.04) {
    const k = seg(u, T0 + 0.04, T0 + 0.5);
    groundRing(p, 0, GROUND - 4, 8 + 24 * ease.outQuad(k), C[4], 1, 2);
    groundRing(p, 0, GROUND - 4, 5 + 14 * ease.outQuad(k), C[6], 0.9, 1);
    p.glow(0, GROUND - 4, 30, C[3], 0.30 * (1 - k * 0.6));
    // 爬电：三条短线在地面乱窜
    for (let i = 0; i < 3; i++) {
      const f = Math.floor(u * 30) + i * 13;
      const a0 = rnd(f) * TAU, a1 = a0 + (rnd(f, 2) - 0.5) * 2;
      const r0 = 10 + rnd(f, 3) * 16, r1 = 10 + rnd(f, 4) * 16;
      arc(p, Math.cos(a0) * r0, GROUND - 4 + Math.sin(a0) * r0 * 0.34,
        Math.cos(a1) * r1, GROUND - 4 + Math.sin(a1) * r1 * 0.34, C[5], f, 2);
    }
  }

  // 云散
  const fade = seg(u, T1 + 0.2, D);
  if (fade > 0) p.disc(0, -30, 40, hex('#080e14'), 0.0);
}

// ─────────────────────────────────────────────────────────────
// 4 · 装甲车：履带推进 + 车身抖动 + 扬尘；重型版更大、更硬
// ─────────────────────────────────────────────────────────────
function drawVehicle(p, t, heavy) {
  const D = 3.6;
  const u = wrap(t, D);
  const C = heavy ? EL.olive : EL.olive;
  const K = heavy ? 1.3 : 1.0;

  // 推进：0→1.9s 从底部走到中上，之后驻停
  const move = ease.outQuad(clamp(u / 1.9));
  const cy = 44 - 26 * move;
  const moving = move < 0.98;
  const shake = moving ? Math.round(Math.sin(t * 24) * 1) : 0;
  const x = shake;
  const y = cy + (moving ? Math.round(Math.cos(t * 21)) : 0);

  // 尺寸：窄而长才像车，方块就是箱子
  const TW = 7 * K;                        // 履带宽
  const HW = 20 * K;                       // 车体宽
  const L = (heavy ? 40 : 32) * K;         // 车体长
  const full = HW + TW * 2;
  const top = y - L / 2, bot = y + L / 2;

  // 地面投影
  p.ellipse(x, GROUND + 2, full * 0.62, full * 0.20, INKC, 0.45);

  // 履带（左右各一条）：底比车体暗、纹路比底亮，否则整条变黑板
  for (const s of [-1, 1]) {
    const tx = x + s * (HW / 2 + TW / 2);
    p.rect(tx - TW / 2, top + 2, TW, L - 4, C[2], 1);
    p.rect(tx - TW / 2, top + 2, 2, L - 4, C[3], 1);
    for (let i = 0; i <= 6; i++) p.rect(tx - TW / 2, top + 3 + i * ((L - 6) / 6), TW, 1, C[1], 1);
    p.rect(tx - TW / 2, top + 2, TW, 1, C[4], 1);
    p.rect(tx - TW / 2, bot - 3, TW, 1, C[1], 1);
  }

  // 车体
  p.rect(x - HW / 2, top + 6, HW, L - 12, C[4], 1);
  p.rect(x - HW / 2, top + 6, 3, L - 12, C[5], 1);      // 左侧受光
  p.rect(x + HW / 2 - 3, top + 6, 3, L - 12, C[3], 1);  // 右侧压暗
  p.rect(x - HW / 2, bot - 6, HW, 2, C[3], 1);          // 尾板
  // 前装甲（前倾楔形：车头收窄成一点，这是「车」最强的形态信号）
  p.poly([[x - HW / 2, top + 8], [x - HW * 0.28, top - 2], [x + HW * 0.28, top - 2], [x + HW / 2, top + 8]], C[5], 1);
  p.poly([[x, top - 2], [x + HW / 2, top + 8], [x + HW * 0.28, top - 2]], C[3], 1);
  p.line(x - HW * 0.28, top - 2, x + HW * 0.28, top - 2, C[6], 1);
  // 侧裙 / 挡泥板
  for (const s of [-1, 1]) {
    p.rect(x + s * (HW / 2) - (s > 0 ? 4 : 0), top + 10, 4, L - 18, C[2], 1);
    p.rect(x + s * (HW / 2) - (s > 0 ? 4 : 0), top + 10, 4, 1, C[4], 1);
  }

  // 炮塔（偏后：真实坦克的炮塔不在正中）
  const ty = y + L * 0.06;
  const tr = (heavy ? 9.5 : 8) * 1;
  p.ellipse(x, ty, tr, tr * 0.9, C[4], 1);
  p.ellipse(x - 2, ty - 2, tr * 0.55, tr * 0.5, C[5], 1);
  p.ellipse(x, ty, tr * 0.34, tr * 0.3, C[2], 1);        // 舱盖

  // 炮管（朝前，轻微俯仰）
  const pitch = Math.sin(u * 3) * 2;
  const bl = (heavy ? 22 : 17) * 1;
  if (heavy) {
    for (const off of [-3.5, 3.5]) {
      p.rect(x + off - 1.5, ty - tr - bl + pitch, 3, bl, C[3], 1);
      p.rect(x + off - 1.5, ty - tr - bl + pitch, 1, bl, C[5], 1);
      p.rect(x + off - 2.5, ty - tr - bl - 2 + pitch, 5, 4, C[2], 1);   // 炮口制退器
    }
    p.rect(x - 6, ty - tr - 3 + pitch, 12, 4, C[3], 1);  // 炮盾
    p.rect(x - 6, ty - tr - 3 + pitch, 12, 1, C[5], 1);
  } else {
    p.rect(x - 1.5, ty - tr - bl + pitch, 3, bl, C[3], 1);
    p.rect(x - 1.5, ty - tr - bl + pitch, 1, bl, C[5], 1);
    p.rect(x - 3, ty - tr - bl - 2 + pitch, 6, 4, C[2], 1);   // 炮口制退器
    p.rect(x - 3, ty - tr - bl - 2 + pitch, 6, 1, C[4], 1);
    p.rect(x - 3, ty - tr - 2 + pitch, 6, 3, C[4], 1);        // 炮盾
  }

  // 重型：侧裙反应装甲块 + 撞角
  if (heavy) {
    for (const s of [-1, 1]) {
      for (let i = 0; i < 4; i++) {
        const by = top + 8 + i * ((L - 16) / 4);
        p.rect(x + s * (HW / 2 + TW) - (s > 0 ? 5 : 0), by, 5, 6, C[2], 1);
        p.rect(x + s * (HW / 2 + TW) - (s > 0 ? 5 : 0), by, 5, 1, C[4], 1);
      }
    }
    // 撞角
    p.poly([[x - HW / 2, top + 2], [x - HW / 2 - 3, top + 12], [x - HW / 2 + 2, top + 12]], C[5], 1);
    p.poly([[x + HW / 2, top + 2], [x + HW / 2 + 3, top + 12], [x + HW / 2 - 2, top + 12]], C[5], 1);
  } else {
    p.rect(x + HW * 0.22, ty - 2, 7, 3, C[5], 1);        // 车顶机枪
  }

  // 扬尘：只在移动时
  if (moving) {
    for (let i = 0; i < 8; i++) {
      const ph = (t * 1.5 + rnd(i)) % 1;
      const px = x + (rnd(i, 2) - 0.5) * (full * 1.5);
      const py = bot + 2 + ph * 12;
      p.disc(px, py, 3 + ph * 4, hex('#6b5f45'), 0.32 * (1 - ph));
    }
  }
  // 撞击瞬间
  const hitK = seg(u, 1.9, 2.1);
  if (hitK > 0 && hitK < 1) {
    p.glow(x, top - 8, 24, C[5], 0.5 * (1 - hitK));
    for (let i = 0; i < 8; i++) {
      const a2 = -Math.PI / 2 + (i / 8 - 0.5) * 2.0;
      const d = 6 + hitK * 16;
      p.dot(Math.round(x + Math.cos(a2) * d), Math.round(top - 8 + Math.sin(a2) * d), i % 2 ? C[6] : WHITE, 0.9 * (1 - hitK));
    }
  }
}

// ─────────────────────────────────────────────────────────────
// 5 · 高能射线：发生器 + 脉冲光束 + 打点灼烧
// ─────────────────────────────────────────────────────────────
function drawBeam(p, t) {
  const D = 2.6;
  const u = wrap(t, D);
  const C = EL.cyan;
  const on = seg(u, 0.18, 0.4) * (1 - seg(u, 2.1, 2.5));
  if (on <= 0) return;

  // 脉冲（多段伤害的可视化）：每 0.42s 一次峰值
  const pulse = 0.55 + 0.45 * Math.max(0, Math.sin((u / 0.42) * Math.PI * 2));
  const w = (5 + 3 * pulse) * on;
  const top = -40;

  // 光束本体：外辉 → 中层 → 白核
  p.glowLine(0, 34, 0, top, w * 3.2, C[3], 0.30 * on);
  p.beam(0, 34, 0, top, w * 1.5, C[3], 1);      // 外层青
  p.beam(0, 34, 0, top, w, C[5], 1);            // 中层亮青
  p.beam(0, 34, 0, top, w * 0.34, C[6], 1);     // 近白
  p.beam(0, 34, 0, top, 1, WHITE, 1);           // 1px 芯
  // 光束上的能量节点（脉冲时更亮）
  for (let i = 0; i < 4; i++) {
    const yy = 26 - i * 20;
    p.rect(-2, yy, 5, 2, C[6], 0.5 + 0.5 * pulse);
  }
  // 发生器（底部装置）
  p.rect(-10, 28, 20, 10, EL.steel[2], 1);
  p.rect(-10, 28, 20, 2, EL.steel[4], 1);
  p.rect(-4, 24, 8, 5, C[3], 1);
  p.rect(-3, 25, 6, 2, WHITE, 0.9);
  p.glow(0, 26, 14, C[4], 0.45 * on);
  // 打点：顶部命中处的灼烧火花
  const hitY = top;
  p.disc(0, hitY, 6, C[6], 0.9 * on);
  for (let i = 0; i < 6; i++) {
    const ph = (u * 2 + rnd(i)) % 1;
    p.dot(Math.round((rnd(i, 3) - 0.5) * 18), Math.round(hitY - ph * 10 + 4), C[5], on * (1 - ph));
  }
  p.glow(0, hitY, 16, C[5], 0.35 * on);
}

// ─────────────────────────────────────────────────────────────
// 6 · 制导激光：窄扇面左右扫 + 扫痕 + 终点爆
// ─────────────────────────────────────────────────────────────
function drawLaser(p, t) {
  const D = 2.8;
  const u = wrap(t, D);
  const C = EL.laser;
  const OX = 0, OY = 34;
  const LEN = 66;
  // 扫射角：-0.55 → +0.55 → 回
  const sweep = Math.sin(u * TAU) * 0.55;
  const half = 0.09 + 0.03 * Math.sin(u * TAU * 3);   // 扇面半角（窄）

  // 扇面：填充实体 + 两条边线 + 中轴（比 16 条同色线清楚得多）
  const a0 = sweep - half, a1 = sweep + half;
  const tip = (ang, len) => [OX + Math.sin(ang) * len, OY - Math.cos(ang) * len];
  const [ex0, ey0] = tip(a0, LEN), [ex1, ey1] = tip(a1, LEN);
  p.poly([[OX, OY], [ex0, ey0], [ex1, ey1]], C[2], 1);                 // 扇面底
  const [ix0, iy0] = tip(a0, LEN * 0.82), [ix1, iy1] = tip(a1, LEN * 0.82);
  p.poly([[OX, OY], [ix0, iy0], [ix1, iy1]], C[3], 1);                 // 内层
  p.line(OX, OY, ex0, ey0, C[5], 1);                                   // 左边缘
  p.line(OX, OY, ex1, ey1, C[5], 1);                                   // 右边缘
  // 中轴
  const mx = OX + Math.sin(sweep) * LEN, my = OY - Math.cos(sweep) * LEN;
  p.line(OX, OY + 2, mx, my, C[6], 1);
  p.glowLine(OX, OY, mx, my, 6, C[4], 0.35);
  // 发射器
  p.rect(-9, 28, 18, 9, EL.steel[2], 1);
  p.rect(-9, 28, 18, 2, EL.steel[4], 1);
  p.poly([[OX - 5, 30], [OX + 5, 30], [OX + 3, 24], [OX - 3, 24]], C[3], 1);
  p.glow(OX, 28, 12, C[4], 0.4);

  // 终点爆（20 级「结束时高额爆炸」的开端）：扫到最右/最左时端点小爆
  const atEdge = Math.abs(Math.sin(u * TAU)) > 0.93;
  if (atEdge) {
    const ex = OX + Math.sin(sweep) * LEN, ey = OY - Math.cos(sweep) * LEN;
    p.disc(ex, ey, 7, C[6], 0.8);
    p.glow(ex, ey, 14, C[5], 0.5);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * TAU;
      p.dot(Math.round(ex + Math.cos(a) * 9), Math.round(ey + Math.sin(a) * 9), C[6], 0.8);
    }
  }
}

// ─────────────────────────────────────────────────────────────
// 7 · 哨戒机：底座炮塔 + 转塔锁敌 + 连点射
// ─────────────────────────────────────────────────────────────
function drawTurret(p, t) {
  const D = 2.6;
  const u = wrap(t, D);
  const C = EL.steel;
  const BX = 0, BY = GROUND;

  // 地面投影
  p.ellipse(BX, BY + 2, 14, 5, INKC, 0.4);
  // 三脚架
  p.line(BX - 2, BY - 4, BX - 11, BY + 2, C[2], 1);
  p.line(BX + 2, BY - 4, BX + 11, BY + 2, C[2], 1);
  p.line(BX, BY - 4, BX, BY + 2, C[2], 1);
  // 底座
  p.rect(BX - 9, BY - 10, 18, 7, C[3], 1);
  p.rect(BX - 9, BY - 10, 18, 2, C[5], 1);
  // 炮塔（圆形，随目标旋转）
  const aim = -1.5 + Math.sin(u * 4) * 0.8;      // 弧度，向上为主
  const rc = Math.max(0, 1 - ((u * 3) % 1) * 3) * -1; // 后坐
  p.ellipse(BX, BY - 14, 9, 8, C[4], 1);
  p.ellipse(BX - 2, BY - 16, 5, 4, C[5], 1);
  // 双管
  const bx = Math.cos(aim), by = Math.sin(aim);
  for (const off of [-2.5, 2.5]) {
    const ox = BX - by * -off * 0, oy = BY - 14;
    p.line(ox + off * 0.5, oy + rc, ox + bx * 16 + off * 0.5, oy + by * 16 + rc, C[2], 1);
    p.line(ox + off * 0.5, oy + rc - 1, ox + bx * 16 + off * 0.5, oy + by * 16 + rc - 1, C[5], 1);
  }
  // 连点射：每 0.36s 一发
  const shots = [0.15, 0.51, 0.87, 1.23, 1.59, 1.95, 2.31];
  for (const s of shots) {
    if (u < s || u > s + 0.30) continue;
    const k = (u - s) / 0.30;
    const ex = BX + bx * 30, ey = BY - 14 + by * 30;
    // 弹道
    p.line(BX + bx * 18, BY - 14 + by * 18, BX + bx * (18 + 12 * k), BY - 14 + by * (18 + 12 * k), C[6], 1 - k * 0.7);
    // 枪口闪光
    if (k < 0.3) {
      p.disc(BX + bx * 18, BY - 14 + by * 18, 4, WHITE, 1 - k / 0.3);
      p.glow(BX + bx * 18, BY - 14 + by * 18, 10, C[6], 0.6 * (1 - k / 0.3));
    }
    // 命中火花
    if (k > 0.5) {
      const kk = (k - 0.5) / 0.5;
      p.disc(ex, ey, 3 + 3 * kk, C[6], 1 - kk);
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * TAU + s;
        p.dot(Math.round(ex + Math.cos(a) * 6 * kk), Math.round(ey + Math.sin(a) * 6 * kk), C[5], 1 - kk);
      }
    }
  }
  // 炮塔指示灯
  p.dot(BX, BY - 14, Math.sin(u * 12) > 0 ? hex('#ff5a4a') : C[6], 1);
}

// ─────────────────────────────────────────────────────────────
// 8 · 燃烧地带：从 0 起燃 → 扩散到设定半径 → 持续 → 慢慢熄灭
// ─────────────────────────────────────────────────────────────
const FLAMES = Array.from({ length: 16 }, (_, i) => ({
  a: (i / 16) * TAU + rnd(i) * 0.4,
  rk: 0.55 + rnd(i, 2) * 0.45,
  hk: 0.7 + rnd(i, 3) * 0.6,
  ph: rnd(i, 4) * TAU,
}));

function drawFlamezone(p, t) {
  const D = 4.0;
  const u = wrap(t, D);
  const C = EL.ember;
  const RMAX = 30;

  const grow = ease.outQuad(seg(u, 0.10, 1.45));     // 扩散
  const fade = ease.inQuad(seg(u, 2.85, 3.80));      // 熄灭
  const R0 = 3 + (RMAX - 3) * grow;
  const heat = 1 - fade * 0.85;                      // 总体热度

  // 焦土（先烧黑，熄灭后留着）
  if (u > 0.1) p.ellipse(0, GROUND, R0 * 1.06, R0 * 0.36, hex('#140c0a'), 1);
  // 地面热辉
  if (heat > 0.05) p.glow(0, GROUND, R0 * 1.5, C[3], 0.36 * heat);

  // 起燃点：中心小火苗（0 ~ 0.5s）
  if (u < 0.55) {
    const k = seg(u, 0, 0.35);
    const h = 5 + 7 * k;
    p.poly([[0, GROUND], [2, GROUND - h], [-2, GROUND - h * 0.55]], C[6], 1);
    p.poly([[-1, GROUND], [0, GROUND - h * 0.7], [-2, GROUND - h * 0.3]], C[5], 1);
    p.glow(0, GROUND - h * 0.4, 9, C[5], 0.55 * k);
  }

  // 火床：三层压扁椭圆叠出「整片在烧」的实体（只有火舌没有床 = 一圈蜡烛）
  if (grow > 0.02) {
    const flick = 1 + 0.04 * Math.sin(t * 13) + 0.03 * Math.sin(t * 21);
    p.ellipse(0, GROUND, R0 * 0.94 * flick, R0 * 0.31 * flick, C[1], 1);
    p.ellipse(0, GROUND - 1, R0 * 0.74 * flick, R0 * 0.24, C[2], 1);
    p.ellipse(0, GROUND - 1, R0 * 0.50, R0 * 0.17, C[3], 1);
    if (heat > 0.55) p.ellipse(0, GROUND - 1, R0 * 0.28, R0 * 0.10, C[4], 1);
  }

  // 火舌：沿椭圆分布，底部要宽并互相重叠，才连成一片
  for (let i = 0; i < FLAMES.length; i++) {
    const f = FLAMES[i];
    const rr = R0 * f.rk;
    const x = Math.cos(f.a) * rr;
    const y = GROUND + Math.sin(f.a) * rr * 0.34;
    const flick = 0.75 + 0.25 * Math.sin(t * 9 + f.ph);
    const h = 13 * f.hk * flick * heat * (0.45 + 0.55 * grow);
    if (h < 1.2) continue;
    const w = 3.6 + 1.4 * f.hk;
    p.poly([[x - w, y], [x, y - h], [x + w, y]], C[2], 1);
    p.poly([[x - w * 0.66, y], [x + 0.2, y - h * 0.74], [x + w * 0.66, y]], C[4], 1);
    if (heat > 0.5) p.poly([[x - w * 0.3, y], [x + 0.1, y - h * 0.46], [x + w * 0.3, y]], C[6], 1);
  }

  // 内部余烬 + 上升火星
  if (heat > 0.2) embers(p, 0, GROUND - 2, R0 * 1.5, 8, C, t, 0.9 * heat);

  // 熄灭：烟往上走，火舌退成暗红余烬
  if (fade > 0) {
    for (let i = 0; i < 5; i++) {
      const ph = (u * 0.6 + rnd(i, 8)) % 1;
      p.disc(Math.cos(rnd(i, 9) * TAU) * R0 * 0.7, GROUND - 6 - ph * 20, 5 + ph * 6,
        hex('#4a4442'), 0.30 * fade * (1 - ph));
    }
  }
}

// ─────────────────────────────────────────────────────────────
// 9 · 旋转刀轮：巨型锯片横滚 + 火花 + 撞边折返
// ─────────────────────────────────────────────────────────────
function drawSaw(p, t) {
  const D = 3.0;
  const u = wrap(t, D);
  const C = EL.chrome;
  const SPAN = 36, Y = GROUND - 12;

  // 去 / 回：0~0.5 去，0.5~1 回（撞边折返）
  const ph = u * 2;
  const go = ph < 1 ? ease.inOutSine(ph) : 1 - ease.inOutSine(ph - 1);
  const x = -SPAN + 2 * SPAN * go;
  const dir = ph < 1 ? 1 : -1;

  // 地面投影
  p.ellipse(x, GROUND + 1, 13, 4, INKC, 0.35);
  // 切痕：走过的路径留一道暗痕
  p.line(Math.max(-SPAN, x - 34 * dir), GROUND - 2, x, GROUND - 2, C[1], 1);

  // 锯片：外齿 + 盘体 + 轴心
  const a0 = t * 14 * dir;
  const teeth = 12, rOut = 13, rIn = 9.5;
  for (let i = 0; i < teeth; i++) {
    const a = a0 + (i / teeth) * TAU;
    const a2 = a + (TAU / teeth) * 0.5;
    p.poly([
      [x + Math.cos(a) * rIn, Y + Math.sin(a) * rIn],
      [x + Math.cos(a - 0.10) * rOut, Y + Math.sin(a - 0.10) * rOut],
      [x + Math.cos(a + 0.10) * rOut, Y + Math.sin(a + 0.10) * rOut],
      [x + Math.cos(a2) * rIn, Y + Math.sin(a2) * rIn],
    ], C[5], 1);
    p.line(x + Math.cos(a) * rIn, Y + Math.sin(a) * rIn, x + Math.cos(a) * rOut, Y + Math.sin(a) * rOut, C[3], 1);
  }
  p.ellipse(x, Y, rIn, rIn, C[3], 1);
  p.ellipse(x - rIn * 0.25, Y - rIn * 0.25, rIn * 0.6, rIn * 0.5, C[4], 1);
  p.ellipse(x, Y, 3, 3, INKC, 1);
  p.ellipse(x, Y, 1.6, 1.6, C[6], 1);
  // 高速旋转的残影弧
  p.glowRing(x, Y, rIn + 1.5, 1, C[4], 0.28);

  // 火花：从切线方向甩出
  for (let i = 0; i < 9; i++) {
    const phh = (t * 3 + rnd(i)) % 1;
    const ang = rnd(i, 2) * TAU;
    const dist = 12 + phh * 22;
    p.dot(
      Math.round(x + Math.cos(ang) * dist),
      Math.round(Y + Math.sin(ang) * dist + phh * phh * 12),
      phh < 0.4 ? WHITE : C[5], 1 - phh,
    );
  }
  // 撞边折返的瞬间：一击火星团
  const bounce = Math.min(Math.abs(ph - 1), Math.abs(ph - 1));
  if (bounce < 0.05) {
    p.glow(x, Y, 18, C[6], 0.5);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * TAU;
      p.dot(Math.round(x + Math.cos(a) * 14), Math.round(Y + Math.sin(a) * 14), WHITE, 0.9);
    }
  }
}

// ─────────────────────────────────────────────────────────────
// 卡片清单（顺序按 02 册 3.1 的空间占位表，不让两个技能占同一格）
// ─────────────────────────────────────────────────────────────
const SKILLS = [
  { id: 'thermo', name: '温压弹', el: '火系 · 点→圆（落点）', mech: '弹头升空 → 火红拖尾 → 两段火爆',
    read: '看得见「飞过去 → 炸开两下」，与干冰弹的冷调形成第一眼区分', draw: (p, t) => drawThermo(p, t), D: 3.2 },
  { id: 'dryice', name: '干冰弹', el: '冰系 · 点→小圆（落点）', mech: '冰弹 + 冷雾尾 → 霜环扩散 + 冰封',
    read: '全程无火：霜点、冰棱、冻结块，冷调压到底', draw: (p, t) => drawDryice(p, t), D: 2.8 },
  { id: 'thunder', name: '电磁天雷', el: '能量系 · 点→圆（空降）', mech: '积云蓄电 → 折线雷劈下 → 电环 + 爬电',
    read: '从天上下来，不是从枪口出来——方向语言与弹道类完全分开', draw: (p, t) => drawThunder(p, t), D: 2.8 },
  { id: 'vehicle', name: '装甲车', el: '物理系 · 实体（纵向）', mech: '履带推进 + 车身抖动 + 扬尘 → 撞击',
    read: '一辆会动的车，不是一团光；慢所以有压迫感', draw: (p, t) => drawVehicle(p, t, false), D: 3.6 },
  { id: 'vehicle-heavy', name: '重型装甲车', el: '物理系 · 实体（纵向·升级档）', mech: '同一条演出：车体放大 34% + 双联炮 + 侧裙反应装甲 + 撞角',
    read: '与标准型同一个动作，但更大、更方、更硬', draw: (p, t) => drawVehicle(p, t, true), D: 3.6 },
  { id: 'beam', name: '高能射线', el: '能量系 · 线（持续）', mech: '发生器 → 持续光束 → 脉冲 + 打点灼烧',
    read: '一根站着不动的光，脉冲=多段伤害的可视化', draw: (p, t) => drawBeam(p, t), D: 2.6 },
  { id: 'laser', name: '制导激光', el: '能量系 · 面（扇面扫射）', mech: '窄扇面左右扫 + 扫痕 + 到边小爆',
    read: '一个会动的面，和「一根线」的高能射线明确分开', draw: (p, t) => drawLaser(p, t), D: 2.8 },
  { id: 'turret', name: '哨戒机', el: '物理系 · 实体（定点）', mech: '三脚架 + 转塔锁敌 + 连点射 + 命中火花',
    read: '会自己打，炮管跟着目标转——「兜底」这件事看得见', draw: (p, t) => drawTurret(p, t), D: 2.6 },
  { id: 'flamezone', name: '燃烧地带', el: '区域 · 面（封锁地面）', mech: '中心起燃 → 扩散到半径 → 持续 → 慢慢熄灭',
    read: '起/扩/烧/灭四段都要看见，熄灭是慢慢褪不是瞬间消失', draw: (p, t) => drawFlamezone(p, t), D: 4.0 },
  { id: 'saw', name: '旋转刀轮', el: '物理系 · 实体（横向）', mech: '巨型锯片横滚 + 火花 + 撞边折返',
    read: '唯一横向作用的技能：画面上是「横着扫过去」', draw: (p, t) => drawSaw(p, t), D: 3.0 },
];

export const SKILL_EFFECTS = SKILLS.map((c) => ({
  id: c.id, name: c.name, spec: c.el, mech: c.mech,
  read: c.read,
  source: '内核新写（技能演出 v1：出手→飞行→命中→残留）',
  demoHook: `skill.id === '${c.id}' → drawSkill()`,
  mod: makeFx(frameMeta(c.name, W, H, {
    desc: `${c.el}｜${c.mech}`, tags: ['skill', c.id], duration: c.D, loop: true, fps: 30, oy: H / 2,
  }), c.draw),
}));
