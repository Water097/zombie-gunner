// 燃烧地带 · 火场（pixelfx 实现）
//
// 为什么单独抽一个文件：这是「概念图 = demo」的第一块试点。
// 以前 demo 里的火焰是 Canvas2D 手绘一套、概念图是 pixelfx 画另一套，
// 两边永远对不齐；现在两边都只调这一份 drawFlameField。
//
// 画法上保留了「不贴纸」的四条（来自 demo 那一版的实测）：
//   1) 按「归一化距离 + 确定性散列」逐 2px 格上色 → 边缘天然啃缺、内部斑驳
//   2) 砖缝按世界相位压暗线（phase 由调用方按 f.y 算，才和背景砖对齐）
//   3) 纵深压暗只作用最上沿一条（整片压暗会发灰、像脏）
//   4) 火舌散列分布、高度差 3 倍，并允许溢出椭圆边界（边缘才「毛」）
// 另外中心热斑随燃烧呼吸：没有它，火床只是一块烧红的饼。

import { hex } from '../../vendor/pixelfx/src/core/color.js';

const TAU = Math.PI * 2;
const clamp = (v, a = 0, b = 1) => (v < a ? a : v > b ? b : v);

// 七档火色（与 02 册「火系」一致；2026-11-05 提亮过一次，暗红压得太死）
export const FLAME_RAMP = [
  '#1c0906', '#3f1109', '#6f1d0d', '#a83013', '#dd5218', '#ff8a34', '#ffd08a',
].map(hex);

const hash2 = (a, b, s) => {
  const v = Math.sin(a * 12.9898 + b * 78.233 + s * 37.719) * 43758.5453;
  return v - Math.floor(v);
};

const smoothstep = (v) => { const t = clamp(v); return t * t * (3 - 2 * t); };

/**
 * 画一片火场。原点 (0,0) = 火区椭圆中心，y 向上为负。
 *
 * o.r     火区半径（像素，demo 直接用玩法半径）
 * o.dur   整段演出的长度（秒）：起燃 16% → 持续 → 熄灭 20%
 * o.t     当前时间（秒），内部自己归一化
 * o.phase 砖缝相位：传 ((-y) % brick + brick) % brick，横线就会和背景砖对齐
 * o.brick 砖缝行高（0 = 不画砖缝，概念卡片用）
 * o.seed  散列种子（同一时刻多片火不长得一样）
 */
export function drawFlameField(p, t, o = {}) {
  const R = o.r ?? 26;
  const dur = o.dur ?? 4;
  const u = clamp(t / dur);
  const phase = o.phase ?? 0;
  const brick = o.brick ?? 0;
  const seed = o.seed ?? 0;
  const oy = o.oy ?? 0;          // 纵向偏移（概念卡片的原点在画布中心，地面线还要再下移）
  const C = FLAME_RAMP;

  const grow = smoothstep(u / 0.16);                       // 起燃：从一点铺开
  const fade = u > 0.80 ? 1 - (u - 0.80) / 0.20 : 1;       // 熄灭：后 20% 收掉
  if (grow <= 0.01 || fade <= 0.01) return;

  // 熄灭时范围也收一点：只降亮度会读成「变透明」，不是「烧完了」
  const rx = R * (0.36 + 0.64 * grow) * (0.74 + 0.26 * fade);
  const ry = rx * 0.34;
  const beat = 0.5 + 0.5 * Math.sin(t * 7.2);

  // ── 火床：逐 2px 格上色 ──────────────────────────────
  const CELL = 2;
  const spanX = rx * 1.20, spanY = ry * 1.20;
  for (let gy = -spanY; gy <= spanY; gy += CELL) {
    const ny = gy / ry;
    for (let gx = -spanX; gx <= spanX; gx += CELL) {
      const nx = gx / rx;
      const d = Math.sqrt(nx * nx + ny * ny);
      if (d > 1.20) continue;
      const h = hash2(gx, gy, seed);
      let lv;
      if (d > 1.06) { if (h > 0.52) continue; lv = 0; }      // 焦土：只留薄薄一圈烤痕
      else if (d > 0.94) lv = h > 0.50 ? 1 : 0;              // 炭边（暗红掺黑）
      else if (d > 0.78) lv = h > 0.55 ? 3 : 2;
      else if (d > 0.58) lv = h > 0.42 ? 4 : 3;
      else if (d > 0.34) lv = h > 0.50 ? 5 : 4;
      else lv = h > 0.40 ? 6 : 5;                            // 中心压到最亮两档
      if (h > 0.96) lv = Math.min(6, lv + 1);                // 零星亮点
      if (gy < -ry * 0.72 && lv > 2) lv -= 1;                // 纵深：只压最上沿
      lv -= Math.round((1 - fade) * 2.2);                    // 熄灭时逐档冷下去（是「烧完」不是「变透明」）
      p.rect(gx, oy + gy, CELL, CELL, C[Math.max(0, lv)], 1);
    }
  }

  // ── 砖缝透出：按世界相位压横线 ────────────────────────
  if (brick > 0) {
    const start = Math.ceil((-ry - phase) / brick) * brick + phase;
    for (let yy = start; yy <= ry; yy += brick) {
      const k = 1 - Math.abs(yy / ry);
      if (k <= 0) continue;
      const hw = rx * Math.sqrt(Math.max(0, 1 - (yy / ry) ** 2));
      if (hw < 2) continue;
      for (let gx = -hw; gx < hw; gx += CELL) p.rect(gx, oy + yy, CELL, 1, hex('#0a0604'), 1);
    }
  }

  // ── 中心热斑：随燃烧呼吸的高温区 ──────────────────────
  p.glow(0, oy, rx * (0.52 + 0.08 * beat), C[5], (0.30 + 0.20 * beat) * fade * grow);
  p.glow(-rx * 0.18, oy - ry * 0.1, rx * 0.26, C[6], (0.26 + 0.16 * beat) * fade * grow);
  p.glow(rx * 0.22, oy + ry * 0.06, rx * 0.22, C[6], (0.16 + 0.12 * beat) * fade * grow);

  // ── 火舌：散列分布、高度差 3 倍、允许溢出边界 ─────────
  const n = 18;
  for (let i = 0; i < n; i++) {
    const h1 = hash2(i * 13.7 + seed * 0.09, i * 4.3 + seed * 0.05, seed);
    const h2 = hash2(i * 2.9 + 5.1, i * 8.1 + 3.7, seed + 11);
    const ang = h1 * TAU;
    const rk = Math.pow(h2, 1.35) * 1.14;
    const x = Math.cos(ang) * rx * rk;
    const y = Math.sin(ang) * ry * rk;
    const flick = 0.66 + 0.34 * Math.sin(t * 5.6 + i * 1.7);
    const hh = Math.min(R * 0.42, 26) * flick * fade * (0.35 + 0.90 * (1 - Math.min(1, rk))) * (0.5 + 0.5 * grow);
    if (hh < 1.6) continue;
    const w = 2.2 + 2.3 * h2;
    const wy = oy + y;
    p.poly([[x - w, wy + 1], [x, wy - hh], [x + w, wy + 1]], C[3], 1);
    p.poly([[x - w * 0.52, wy + 1], [x + 0.3, wy - hh * 0.60], [x + w * 0.52, wy + 1]], C[5], 1);
    if (hh > 6) p.poly([[x - w * 0.22, wy + 1], [x + 0.2, wy - hh * 0.32], [x + w * 0.22, wy + 1]], C[6], 1);
  }

  // ── 地面热辉：把周围砖也烤亮一点（融合感的来源之一）────
  // 必须沿椭圆排一圈小 glow：单个大 glow 是正圆，在扁火区外会上下多出一大坨，
  // 反而读成「外面套了一圈红光」。
  for (let i = -2; i <= 2; i++) {
    const gx = i * rx * 0.21;
    p.glow(gx, oy, rx * 0.42, C[4], 0.11 * fade);
  }
}
