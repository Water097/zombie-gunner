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
import { R, GROUND, GROUND_K, rnd, groundRing, shockRing, trail, blast, smoke, embers, scorch, arc } from './skill-lib.mjs';
import { drawFlameField, FLAME_RAMP } from './flame-field.mjs';

const W = 112, H = 88;

// ── 每个技能的主色系（显式 7 档；不经过 RAMPS，避免命名与实际色值错位）──
const EL = {
  fire:  R(['#1a0603', '#3d0d05', '#7a1e08', '#c43a0c', '#f2681a', '#ffa64a', '#fff0c8']),
  ice:   R(['#071a2e', '#0d3355', '#16618f', '#2a9bd4', '#66cdf0', '#b8ecff', '#f0feff']),
  volt:  R(['#0d0a24', '#1e1652', '#3a2c96', '#5f4ad6', '#8b7af0', '#c0b4ff', '#f2eeff']),
  steel: R(['#0e1318', '#1a222b', '#2b3644', '#41505f', '#5d6e80', '#8b9aa8', '#c6cfd9']),
  // 装甲车（按参考图：橄榄绿车体 + 深灰履带 + 黄色人字标）
  olive: R(['#161a0e', '#232a15', '#343d1d', '#4a5527', '#5f6d33', '#7a8a45', '#a3b268']),
  camp:  R(['#0f1209', '#191e0d', '#252c12', '#333d19', '#44511f', '#5a6a2b', '#7d8f3f']),
  track: R(['#0a0b0d', '#15171a', '#23262b', '#34383e', '#474c54', '#5f656e', '#838a94']),
  chev:  R(['#3d2a00', '#6b4a05', '#9c6d0a', '#c99512', '#e8bf3a', '#ffe480', '#fffbd8']),
  cyan:  R(['#04161c', '#08303c', '#0d5566', '#158a9e', '#35c2d4', '#8ee8f2', '#e0feff']),
  laser: R(['#1f1805', '#43350a', '#7a6110', '#b8911a', '#e8c23c', '#ffe680', '#fffce0']),
  ember: FLAME_RAMP,   // 与 flame-field.mjs 共用一份色阶（别再各写一套）
  chrome:R(['#0b0d10', '#1b1f24', '#2e343c', '#4a525c', '#6f7a86', '#a8b3bf', '#e8eef5']),
};

const INKC = hex('#080e14');
const seg = (t, a, b) => clamp((t - a) / (b - a || 1e-9));

// ─────────────────────────────────────────────────────────────
// 1 · 温压弹：弹头升空（火红拖尾）→ 落点两段火爆（燃料空气弹）
// ─────────────────────────────────────────────────────────────
function drawThermo(p, t) {
  const D = 1.55, T0 = 0.24;
  const u = wrap(t, D);
  const C = EL.fire;
  if (u > T0) scorch(p, 0, 30, 0.5);

  if (u < T0) {
    // 直线飞行：x 恒为 0，尾巴也是直的（不做横向摆动）
    const k = u / T0;
    const y = 40 - 52 * k;
    trail(p, 0, y + 7, 26, 6, C, u, { sway: 0 });
    // 弹体：白尖 + 橙身 + 尾翼
    p.poly([[0, y - 11], [3.5, y - 5], [3.5, y + 5], [-3.5, y + 5], [-3.5, y - 5]], C[5], 1);
    p.poly([[0, y - 11], [2.5, y - 6], [-2.5, y - 6]], WHITE, 1);
    p.rect(-4, y + 2, 9, 2, C[2], 1);
    p.line(-6, y + 6, -3.5, y - 2, C[2], 1);
    p.line(6, y + 6, 3.5, y - 2, C[2], 1);
    p.glow(0, y + 10, 11, C[4], 0.30);
    return;
  }

  // 接触即爆：一段，不延迟（06 册「燃料空气弹」是加成卡 ⑥，不加强时就是单段）
  const k1 = (u - T0) / 0.30;
  if (k1 < 1) blast(p, 0, -12, 24, k1, C, { debris: 12 });

  // 残留：火圈 + 余烟 + 余烬
  const after = seg(u, T0 + 0.22, D);
  if (after > 0) {
    smoke(p, -6, -12 - 16 * after, 18, 0.85 * (1 - after * 0.25));
    smoke(p, 9, -16 - 18 * after, 12, 0.60 * (1 - after * 0.35));
    for (let i = 0; i < 7; i++) {
      const ang = (i / 7) * TAU + 0.5;
      const rr = 18 + 4 * rnd(i);
      const x = Math.cos(ang) * rr, y = GROUND + Math.sin(ang) * rr * 0.34;
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
  const D = 1.55, T0 = 0.24;
  const u = wrap(t, D);
  const C = EL.ice;

  if (u < T0) {
    const k = u / T0;
    const y = 40 - 48 * k;
    // 冷雾尾：短晶须 + 雾点，不做成一条细线
    trail(p, 0, y + 8, 14, 3, C, u, { sway: 0 });
    for (let i = 0; i < 7; i++) {
      const ph = (u * 2.4 + rnd(i)) % 1;
      const px = Math.round((rnd(i, 2) - 0.5) * 9 * (0.4 + ph));
      const py = Math.round(y + 10 + ph * 16);
      p.dot(px, py, C[ph < 0.5 ? 6 : 4], 1);
    }
    p.glow(0, y + 12, 10, C[5], 0.26);
    // 冰弹：菱形晶体（白面 + 蓝面 + 亮棱）
    p.poly([[0, y - 10], [5, y - 2], [0, y + 7], [-5, y - 2]], C[4], 1);
    p.poly([[0, y - 10], [-5, y - 2], [0, y - 2]], C[6], 1);
    p.poly([[0, y - 10], [5, y - 2], [0, y - 2]], WHITE, 1);
    p.poly([[0, y - 2], [5, y - 2], [0, y + 7]], C[3], 1);
    p.poly([[0, y - 2], [-5, y - 2], [0, y + 7]], C[5], 1);
    return;
  }

  // 命中：霜环扩散 + 霜针生长
  const k = seg(u, T0, T0 + 0.34);
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
  const fb = seg(u, T0 + 0.06, T0 + 0.30);
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
  // 定位：精准打击单个目标，极快。形态 = 雷劈到**地面** → 沿地面向外扩散（升级树 ⑤ 感电范围）。
  // 注意：扩散是**贴地的压扁椭圆**，不是悬在空中的正圆——正圆会被读成「有个圈在转」。
  const D = 0.64;
  const T_HIT = 0.16;        // 雷落地
  const T_SPREAD = 0.36;     // 扩散结束
  const u = wrap(t, D);
  const C = EL.volt;
  const HX = 0, GY = GROUND - 4;      // 落点在地面线上

  // 云：只在顶上闪一下，0.45s 内散尽
  const cloudK = seg(u, 0, 0.09) * (1 - seg(u, 0.30, 0.54));
  if (cloudK > 0.02) {
    const puffs = [[-15, -32, 9], [-4, -35, 11], [9, -33, 10], [19, -31, 7]];
    for (const [cx, cy, r] of puffs) p.disc(cx, cy, r * (0.55 + 0.45 * cloudK), hex('#1e1734'), 0.92 * cloudK);
    p.ellipse(2, -28, 23, 5, hex('#1e1734'), 0.92 * cloudK);
    p.glow(0, -30, 20, C[4], 0.12 + 0.32 * cloudK);
  }

  // 落雷：一条主干 + 两条短分叉，劈到地面
  if (u >= T_HIT * 0.7 && u < T_HIT + 0.16) {
    const f = Math.floor(u * 90);
    const a2 = 1 - seg(u, T_HIT + 0.06, T_HIT + 0.16);
    p.line(1, -26, HX, GY, C[6], a2);
    arc(p, 1, -26, HX, GY, C[5], f, 2);
    arc(p, 1, -26, HX, GY, WHITE, f + 9, 1);
    arc(p, HX - 1, GY - 16, HX - 8, GY - 4, C[4], f + 3, 2);
    arc(p, HX + 1, GY - 12, HX + 7, GY - 2, C[4], f + 5, 2);
    p.glowLine(1, -26, HX, GY, 7, C[4], 0.5 * a2);
  }

  // 落地：小核 + 沿地面扩散的电环（压扁椭圆，快速推出去后消失）
  if (u >= T_HIT) {
    const k = seg(u, T_HIT, T_SPREAD);
    // 命中点白核：快速收缩消失
    if (k < 0.5) {
      const cr = 4 * (1 - k / 0.5) + 1;
      p.ellipse(HX, GY, cr * 1.2, cr * 0.7, WHITE, 1);
    }
    p.glow(HX, GY, 24 * (1 - k * 0.6), C[4], 0.45 * (1 - k));

    // 扩散：贴地椭圆环，推出去后**必须消失**（k 到 0.85 就彻底停止绘制）
    if (k < 0.85) {
      const rx = 4 + 26 * ease.outQuad(k);
      const col = k < 0.35 ? C[6] : k < 0.6 ? C[5] : C[3];
      groundRing(p, HX, GY, rx, col, 1, k < 0.35 ? 2 : 1);
      // 地面上向外爬的电弧：只在前 60% 存在
      if (k < 0.6) {
        for (let i = 0; i < 5; i++) {
          const ang = (i / 5) * TAU + 0.6;
          const r0 = rx * 0.55, r1 = rx * 0.98;
          const f2 = Math.floor(u * 55) + i * 13;
          arc(p,
            HX + Math.cos(ang) * r0, GY + Math.sin(ang) * r0 * GROUND_K,
            HX + Math.cos(ang) * r1, GY + Math.sin(ang) * r1 * GROUND_K,
            C[5], f2, 1.5);
        }
      }
    }
    // 余电：落点附近 3 个闪点，0.5s 内熄灭
    const rk = seg(u, T_SPREAD, T_SPREAD + 0.25);
    if (rk < 1) {
      for (let i = 0; i < 3; i++) {
        const f3 = Math.floor(u * 60) + i * 23;
        if (rnd(f3, 6) < rk) continue;
        p.dot(Math.round(HX + (rnd(f3, 2) - 0.5) * 16), Math.round(GY + (rnd(f3, 3) - 0.5) * 8), C[5], 1);
      }
    }
  }
}

// ─────────────────────────────────────────────────────────────
// 4 · 装甲车：履带推进 + 车身抖动 + 扬尘；重型版更大、更硬
// ─────────────────────────────────────────────────────────────
function drawVehicle(p, t, heavy) {
  // 按参考图重画：这是**方盒子装甲车**，不是坦克。
  // 橄榄绿车体 + 迷彩斑 + 两侧深灰履带 + 车顶黄色人字标 + 尾部两盏红灯。
  // 纪律（用户明确）：出发之后**只有履带在动，车身不动** —— 所以没有整车抖动。
  const D = 3.4;
  const u = wrap(t, D);
  const OL = EL.olive, TR = EL.track, CV = EL.chev;
  const K = heavy ? 1.26 : 1.0;

  const move = ease.outQuad(clamp(u / 2.2));
  const cy = 38 - 20 * move;              // 缓慢推进
  const x = 0, y = cy;
  const TW = 8 * K;                       // 履带宽
  const HW = 22 * K;                      // 车体宽
  const L = (heavy ? 40 : 34) * K;        // 车体长
  const full = HW + TW * 2;
  const top = y - L / 2, bot = y + L / 2;

  // 地面投影
  p.ellipse(x, GROUND + 2, full * 0.60, full * 0.20, INKC, 0.42);

  // 空气吸排：地面扬起薄尘（跟着车走，不抖）
  for (let i = 0; i < 6; i++) {
    const ph = (t * 1.2 + rnd(i)) % 1;
    p.disc(x + (rnd(i, 2) - 0.5) * full * 1.3, bot + 1 + ph * 9, 2.5 + ph * 3.5, hex('#5d543c'), 0.26 * (1 - ph));
  }

  // 履带（唯一会动的部分：纹路向下滚）
  const scroll = (t * 16) % 6;
  for (const s of [-1, 1]) {
    const tx = x + s * (HW / 2 + TW / 2);
    p.rect(tx - TW / 2, top + 1, TW, L - 2, TR[2], 1);
    p.rect(tx - TW / 2, top + 1, 2, L - 2, TR[3], 1);       // 左侧受光
    p.rect(tx + TW / 2 - 1, top + 1, 1, L - 2, TR[1], 1);
    for (let i = -1; i < Math.ceil(L / 6) + 1; i++) {
      const yy = Math.round(top + 3 + i * 6 + scroll);
      if (yy > top + 2 && yy < bot - 2) p.rect(tx - TW / 2 + 1, yy, TW - 1, 2, TR[1], 1);
    }
    p.rect(tx - TW / 2, top + 1, TW, 1, TR[4], 1);
  }

  // 车体：方盒（正面 + 侧面受光）
  p.rect(x - HW / 2, top + 3, HW, L - 6, OL[3], 1);
  p.rect(x - HW / 2, top + 3, 3, L - 6, OL[4], 1);           // 左受光
  p.rect(x + HW / 2 - 2, top + 3, 2, L - 6, OL[2], 1);       // 右压暗
  // 迷彩斑（固定几块，深橄榄）
  const camo = [[-6, -10, 5, 3], [5, -4, 4, 3], [-3, 6, 5, 3], [6, 11, 3, 2], [-8, 14, 3, 2]];
  for (const [dx, dy, rx, ry] of camo) {
    p.ellipse(x + dx * K, y + dy * K, rx * K, ry * K, EL.camp[3], 1);
  }

  // 车顶（比车侧亮一层，做出「顶面」而不是一块平皮）
  p.rect(x - HW / 2 + 3, top + 5, HW - 6, L * 0.52, OL[5], 1);
  p.rect(x - HW / 2 + 3, top + 5, HW - 6, 1, OL[6], 1);

  // 车头（上半：前倾装甲露出一条 + 观察窗）
  p.poly([[x - HW / 2, top + 6], [x - HW / 2 + 3, top + 1], [x + HW / 2 - 3, top + 1], [x + HW / 2, top + 6]], OL[4], 1);
  p.rect(x - 6 * K, top + 4, 12 * K, 2, EL.camp[0], 1);       // 观察窗（暗槽）

  // 车顶：两个舱盖 + 一条黄色识别条（人字标放在尾板，不放满整个车顶）
  for (const s2 of [-1, 1]) {
    p.rect(x + s2 * 7 * K - 2, top + 7, 5, 5, OL[2], 1);
    p.rect(x + s2 * 7 * K - 2, top + 7, 5, 1, OL[6], 1);
  }
  p.rect(x - 9 * K, top + 15 * K, 4, 10 * K, CV[4], 1);        // 左侧黄色识别条
  p.rect(x - 9 * K, top + 15 * K, 1, 10 * K, CV[6], 1);

  // 尾部：暗色尾板 + 两盏红灯 + 保险杠
  p.rect(x - HW / 2, bot - 7, HW, 7, OL[2], 1);
  p.rect(x - HW / 2, bot - 7, HW, 1, OL[1], 1);
  for (const s of [-1, 1]) {
    p.rect(x + s * 6 * K - 1, bot - 5, 3, 2, hex('#c8402e'), 1);
    p.dot(x + s * 6 * K, bot - 5, hex('#ff8a6a'), 1);
  }
  for (let i = 0; i < 2; i++) {                               // 尾板小号人字标
    const cy3 = Math.round(bot - 6 - i * 3);
    p.poly([[x - 4 * K, cy3], [x, cy3 - 3], [x + 4 * K, cy3], [x + 4 * K, cy3 + 1], [x, cy3 - 2], [x - 4 * K, cy3 + 1]], CV[4], 1);
  }
  p.rect(x - HW / 2 - 2, bot - 2, HW + 4, 3, TR[3], 1);        // 保险杠

  // 重型：侧裙反应装甲 + 车顶机枪
  if (heavy) {
    for (const s of [-1, 1]) {
      for (let i = 0; i < 3; i++) {
        const by = top + 6 + i * ((L - 14) / 3);
        p.rect(x + s * (HW / 2 + 1) - (s > 0 ? 4 : 0), by, 4, 7, EL.camp[2], 1);
        p.rect(x + s * (HW / 2 + 1) - (s > 0 ? 4 : 0), by, 4, 1, OL[4], 1);
      }
    }
    p.rect(x - 6, top + 2, 12, 3, TR[4], 1);                   // 顶部机炮座
    p.rect(x - 1, top - 4, 2, 7, TR[3], 1);
  }

  // 到位撞击：车头火星
  const hitK = seg(u, 2.1, 2.35);
  if (hitK > 0 && hitK < 1) {
    p.glow(x, top, 20, OL[6], 0.45 * (1 - hitK));
    for (let i = 0; i < 7; i++) {
      const a2 = -Math.PI / 2 + (i / 7 - 0.5) * 1.8;
      const d = 4 + hitK * 13;
      p.dot(Math.round(x + Math.cos(a2) * d), Math.round(top + Math.sin(a2) * d), i % 2 ? CV[5] : WHITE, 1);
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
  // 2026-11-05 试点：燃烧地带不再单独一套画法，直接调 flame-field.mjs 的同一份实现。
  // demo 也是调它 —— 「概念图 = demo」从这里开始。
  const D = 4.0;
  drawFlameField(p, wrap(t, D), {
    r: 26,
    dur: D,
    oy: GROUND,
    brick: 0,                 // 卡片里不画砖缝（画布没有砖背景）
    seed: 3,
  });
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
  { id: 'thermo', name: '温压弹', el: '火系 · 点→圆（落点）', mech: '弹头直线飞行 → 接触即爆（单段）→ 地面余火',
    read: '弹速对齐精准步枪（约 0.24s 贯穿全屏）；碰到就炸、爆点 0.30s 收掉（「两段爆」是加成卡 ⑥）', draw: (p, t) => drawThermo(p, t), D: 1.55 },
  { id: 'dryice', name: '干冰弹', el: '冰系 · 点→小圆（落点）', mech: '冰弹 + 冷雾尾 → 霜环扩散 + 冰封',
    read: '弹速同温压弹；全程无火：霜点、冰棱、冰晶簇，冷调压到底', draw: (p, t) => drawDryice(p, t), D: 1.55 },
  { id: 'thunder', name: '电磁天雷', el: '能量系 · 精准单点（空降）', mech: '积云瞬闪 → 一道雷精确劈中单点（1.15s 全程）',
    read: '快、准、只打一个点：不做大范围地环，命中是小核 + 电刺 + 紧环', draw: (p, t) => drawThunder(p, t), D: 1.15 },
  { id: 'vehicle', name: '装甲车', el: '物理系 · 实体（纵向）', mech: '方盒子装甲车缓慢推进（只有履带在滚，车身不动）→ 到位撞击',
    read: '橄榄绿 + 迷彩 + 深灰履带 + 黄色识别标（照参考图）；它是装甲车不是坦克', draw: (p, t) => drawVehicle(p, t, false), D: 3.4 },
  { id: 'vehicle-heavy', name: '重型装甲车', el: '物理系 · 实体（纵向·升级档）', mech: '同一条演出：车体 ×1.26 + 侧裙反应装甲 + 顶部机炮',
    read: '与标准型同一个动作，但更大、更方、更硬', draw: (p, t) => drawVehicle(p, t, true), D: 3.4 },
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

// 同屏测试要复用同一批绘制函数（不再写第二套），所以这里显式导出
export const SKILL_DRAW = {
  thermo: (p, t) => drawThermo(p, t),
  dryice: (p, t) => drawDryice(p, t),
  thunder: (p, t) => drawThunder(p, t),
  vehicle: (p, t) => drawVehicle(p, t, false),
  vehicleHeavy: (p, t) => drawVehicle(p, t, true),
  beam: (p, t) => drawBeam(p, t),
  laser: (p, t) => drawLaser(p, t),
  turret: (p, t) => drawTurret(p, t),
  flamezone: (p, t) => drawFlamezone(p, t),
  saw: (p, t) => drawSaw(p, t),
};

export const SKILL_EFFECTS = SKILLS.map((c) => ({
  id: c.id, name: c.name, spec: c.el, mech: c.mech,
  read: c.read,
  source: '内核新写（技能演出 v1：出手→飞行→命中→残留）',
  demoHook: `skill.id === '${c.id}' → drawSkill()`,
  mod: makeFx(frameMeta(c.name, W, H, {
    desc: `${c.el}｜${c.mech}`, tags: ['skill', c.id], duration: c.D, loop: true, fps: 30, oy: H / 2,
  }), c.draw),
}));
