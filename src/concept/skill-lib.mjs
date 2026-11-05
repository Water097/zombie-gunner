// 技能视觉的共用画刷 —— 9 个技能不再是「一个球换颜色」，而是各自一段完整的技能演出。
//
// 核心思路：技能 = 一次「事件」，不是一张「图标」。每个技能都按同一条叙事拆拍：
//
//   出手 → 飞行/展开 → 命中 → 残留
//
// 所以这里提供的不是图标零件，而是**演出零件**：
//   拖尾 / 火舌 / 爆点 / 冲击环 / 地面环 / 烟 / 碎屑 / 尘 / 电弧
//
// 纪律（沿用装备图标规范 v1 的光照与描边语言）：
//   1. 硬形体用 poly / rect / circle（a=1，硬边像素）；半透明只用 p.disc（真 blend，不产生 Bayer 网点）。
//   2. 光一律走加色（glow / glowLine / glowRing / light），不加 alpha 填充。
//   3. 一个技能只用一个主色系 + 一个白核；白核是「能量密度」的读数，不滥用。
//   4. 地面元素一律压扁成椭圆（ry ≈ rx * 0.34），这是俯视角的地面语言。

import { hex } from '../../vendor/pixelfx/src/core/color.js';
import { TAU, clamp } from '../../vendor/pixelfx/src/core/index.js';

export const R = (list) => list.map(hex);

// ── 摄像机（按参考图：约 3/4 俯视，不是全俯视，也不是正侧视）────────────
//   屏幕 y 同时承载「高度」和「纵深」，这是这类竖屏射击游戏的关键：
//     · 在地面上的东西（火区 / 电环 / 焦土）→ 压扁成椭圆，ry ≈ rx × 0.34
//     · 垂直于屏幕升起的东西（弹道 / 雷 / 光束 / 车）→ 沿屏幕 y 轴向上，不倾斜
//     · 立体物件（车 / 炮台）→ 顶面占大部分面积 + 底部露一条前脸/尾板，读作 3/4
//   所以这里只有一条「地面线」，没有地平线；越靠上 = 越远。
export const GROUND = 26;          // 地面线：技能落点默认落在这条线上
export const GROUND_K = 0.34;      // 地面椭圆的压扁比（所有地面元素共用）

// 稳定伪随机：同一帧重放位置一致，不会抖成噪点
export const rnd = (i, s = 1) => {
  const x = Math.sin(i * 12.9898 + s * 78.233) * 43758.5453;
  return x - Math.floor(x);
};

/**
 * 地面椭圆环（俯视角的地面语言）。
 * 按 x 逐列求 y，而不是按角度采样——按角度采样在扁平椭圆的两端会跳像素，画出来是虚线圈。
 */
export function groundRing(p, cx, cy, rx, c, a = 1, thick = 1) {
  const ry = Math.max(2, rx * GROUND_K);
  for (let i = -Math.round(rx); i <= Math.round(rx); i++) {
    const k = i / rx;
    const y = Math.round(ry * Math.sqrt(Math.max(0, 1 - k * k)));
    for (let d = 0; d < thick; d++) {
      p.dot(cx + i, cy - y - d, c, a);
      p.dot(cx + i, cy + y + d, c, a);
    }
  }
}

/** 空心冲击环（正面圆环，随扩散变细变淡）。同样按列求行，保证不断线。 */
export function shockRing(p, cx, cy, r, c, a) {
  const R = Math.max(1, Math.round(r));
  for (let i = -R; i <= R; i++) {
    const y = Math.round(Math.sqrt(Math.max(0, R * R - i * i)));
    p.dot(cx + i, cy - y, c, a);
    p.dot(cx + i, cy + y, c, a);
  }
}

/**
 * 火尾 / 能量尾：从 (x, y) 向下拖 len，带横向扰动、由细到粗到再变暗。
 * ramp 需 7 档；phase 传入时间让它扭动。
 */
export function trail(p, x, y, len, w, ramp, phase, o = {}) {
  const sway = o.sway ?? 0;
  for (let i = 0; i < len; i++) {
    const k = i / len;
    const taper = 1 - k * 0.92;
    const flick = 0.8 + 0.2 * Math.sin(phase * 16 + i * 1.1);
    // 像素级抖动：每行宽度和中心都抖一下，不然一条直柱会被读成几段「胶囊」
    const jitterW = 0.78 + 0.44 * rnd(i, 3);
    const jitterX = (rnd(i, 7) - 0.5) * 1.6;
    const ww = Math.max(1, w * taper * flick * jitterW);
    const xx = Math.round(x + Math.sin(phase * 6 + i * 0.5) * sway * k + jitterX * (0.3 + k));
    // 外焰（暗→中）铺一层，再用亮芯盖在中间
    const outer = k < 0.32 ? ramp[4] : k < 0.62 ? ramp[3] : k < 0.85 ? ramp[2] : ramp[1];
    p.rect(xx - ww / 2, y + i, ww, 1, outer, 1);
    if (k < 0.72) {
      const cw = Math.max(1, ww * 0.5);
      const core = k < 0.22 ? ramp[6] : k < 0.45 ? ramp[5] : ramp[4];
      p.rect(xx - cw / 2, y + i, cw, 1, core, 1);
    }
    if (rnd(i, 11) > 0.86) p.dot(xx + (rnd(i, 5) > 0.5 ? 1 : -1) * (ww * 0.6 + 1), y + i, ramp[2], 1);
  }
  p.glowLine(x, y + len * 0.15, x, y + len * 0.7, w * 1.3, ramp[4], 0.22);
}

/**
 * 爆炸：不规则外壳 → 热核 → 白核 → 碎片 → 转烟。
 * 关键是**别画成正圆**：四个偏移球叠出毛边，否则像 logo 不像爆炸。
 */
export function blast(p, x, y, maxR, k, ramp, o = {}) {
  if (k <= 0 || k >= 1) return;
  const grow = 1 - Math.pow(1 - k, 2.2);
  const r = maxR * grow;
  const lobes = o.lobes ?? [[0, 0, 1], [0.38, -0.28, 0.70], [-0.44, 0.16, 0.64], [0.10, 0.42, 0.52]];

  // 外壳（最暗一档）：四个偏移球叠出不规则轮廓
  for (const [dx, dy, s] of lobes) p.ellipse(x + dx * r, y + dy * r, r * s, r * s, ramp[1], 1);
  // 中层
  for (const [dx, dy, s] of lobes) p.ellipse(x + dx * r * 0.9, y + dy * r * 0.9, r * s * 0.78, r * s * 0.78, ramp[3], 1);
  // 热核
  for (const [dx, dy, s] of lobes) p.ellipse(x + dx * r * 0.8, y + dy * r * 0.8, r * s * 0.52, r * s * 0.52, ramp[5], 1);
  // 白核：前 45% 都在，越早越亮越大
  if (k < 0.55) {
    const w = 0.34 - 0.20 * (k / 0.55);
    p.ellipse(x, y, r * w, r * w, hex('#fffaf0'), 1);
  }
  p.glow(x, y, r * 1.45, ramp[5], 0.50 * (1 - k * 0.7));

  // 转烟：后期用灰盖住，越盖越厚
  if (k > 0.40) {
    const g = clamp((k - 0.40) / 0.55);
    p.disc(x, y, r * 0.90, hex('#2b2b31'), 0.42 * g);
    p.disc(x - r * 0.2, y - r * 0.35, r * 0.70, hex('#43434b'), 0.32 * g);
  }

  // 碎片：短条纹，不是圆点
  const n = o.debris ?? 9;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU + rnd(i) * 0.6;
    const d0 = maxR * (0.45 + 0.9 * k) * (0.7 + rnd(i, 2) * 0.6);
    const d1 = d0 + 2 + 3 * (1 - k);
    const px = x + Math.cos(a) * d0, py = y + Math.sin(a) * d0 * 0.85 + 14 * k * k;
    if (k < 0.92) p.line(px, py, px + Math.cos(a) * (d1 - d0), py + Math.sin(a) * (d1 - d0) * 0.85, i % 3 ? ramp[4] : ramp[6], 1);
  }
}

/** 烟团：慢速上飘、边缘淡。 */
export function smoke(p, x, y, r, a) {
  if (a <= 0.02) return;
  p.disc(x, y, r, hex('#2b2b31'), a * 0.50);
  p.disc(x - r * 0.3, y - r * 0.2, r * 0.7, hex('#43434b'), a * 0.30);
}

/** 余烬：随机跳动的亮点。 */
export function embers(p, x, y, spread, n, ramp, t, a = 1) {
  for (let i = 0; i < n; i++) {
    const ph = rnd(i, 3) * TAU;
    const life = (t * 0.7 + rnd(i, 5)) % 1;
    const px = Math.round(x + (rnd(i, 7) - 0.5) * spread);
    const py = Math.round(y - life * 26 + Math.sin(t * 6 + ph) * 2);
    if (life > 0.85) continue;
    p.dot(px, py, life < 0.4 ? ramp[5] : ramp[3], a * (1 - life));
  }
}

/** 地面焦痕：一圈压扁的暗色，作为「这里被烧过」的痕迹。 */
export function scorch(p, cx, r, a = 0.55) {
  p.ellipse(cx, GROUND, r, r * GROUND_K, hex('#1a1210'), a);
}

/** 电弧：两点之间的折线，带 1 段分叉。 */
export function arc(p, x0, y0, x1, y1, c, seed = 0, amp = 4) {
  const n = 6;
  let px = x0, py = y0;
  for (let i = 1; i <= n; i++) {
    const t = i / n;
    const jx = i === n ? 0 : (rnd(seed + i) - 0.5) * amp * 2;
    const nx = x0 + (x1 - x0) * t + jx;
    const ny = y0 + (y1 - y0) * t + (rnd(seed + i, 2) - 0.5) * amp;
    p.line(px, py, nx, ny, c, 1);
    px = nx; py = ny;
  }
}


// ─────────────────────────────────────────────────────────────
// 同屏叠加用：给画笔加一个平移偏移
// 技能都写在自己的坐标系里（以画面中心为原点），同屏时要能挪到左/右车道，
// 所以这里包一层 proxy，只改坐标参数，不动任何绘制逻辑。
// ─────────────────────────────────────────────────────────────
export function withOffset(p, dx, dy) {
  const P2 = (x, y) => [x + dx, y + dy];
  return new Proxy(p, {
    get(target, key) {
      const v = target[key];
      if (typeof v !== 'function') return v;
      switch (key) {
        case 'dot': case 'glow':
          return (x, y, ...r) => v.call(target, x + dx, y + dy, ...r);
        case 'rect':
          return (x, y, w, h, ...r) => v.call(target, x + dx, y + dy, w, h, ...r);
        case 'ellipse': case 'circle': case 'disc': case 'glowRing':
          return (x, y, ...r) => v.call(target, x + dx, y + dy, ...r);
        case 'line': case 'glowLine': case 'beam':
          return (x0, y0, x1, y1, ...r) => v.call(target, x0 + dx, y0 + dy, x1 + dx, y1 + dy, ...r);
        case 'poly': case 'polyline':
          return (pts, ...r) => v.call(target, pts.map(([x, y]) => P2(x, y)), ...r);
        default:
          return v.bind(target);
      }
    },
  });
}
