// 概念图的共用像素画刷 —— 完全建立在 vendor/pixelfx 的 core 之上。
//
// 纪律：这里每一张「概念图」都是一个 pure effect 模块 { meta, draw(p, t, o) }，
// 和 pixelfx 自带 232 个特效走同一条 createFrame → createFx → composite 管线。
// 所以它不是 PNG，不是截图，不是只能看一眼的图：
// 把模块从画廊的 canvas 挪进 demo 的 render 循环，代码一行都不用改。
//
// 局部坐标约定：(0, 0) = 脚底中心，身体向 -y 方向画（与 pixelfx 的 ground/actor 约定一致）。

import { hex, ramp, PAL } from '../../vendor/pixelfx/src/core/index.js';

export const WHITE = hex('#ffffff');
export const INK = hex('#080e14');
export const TAU = Math.PI * 2;

export const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
export const wrap = (v, m) => ((v % m) + m) % m;
export const lerp = (a, b, t) => a + (b - a) * t;
export const seg = (u, a, b) => clamp((u - a) / (b - a || 1e-9));
export const smooth = (a, b, u) => { const t = seg(u, a, b); return t * t * (3 - 2 * t); };
export const ease = {
  inQuad: (t) => t * t,
  outQuad: (t) => 1 - (1 - t) * (1 - t),
  outExpo: (t) => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t)),
  inOutSine: (t) => -(Math.cos(Math.PI * t) - 1) / 2,
  outBack: (t) => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); },
};

/** hex 字符串数组 → 0xAABBGGRR 数值色阶（core 的 ramp）。 */
export const C = (list) => ramp(list);
/** 硬色阶取样：像素画是「选一档颜色」，不是渐变插值。 */
export const step = (r, t) => r[Math.max(0, Math.min(r.length - 1, Math.floor(t * r.length)))];

// 色阶是 8 种敌人的第一层可辨识信息：颜色必须先于形状被读出来。
export const RAMPS = {
  green:  C(PAL.heal),
  swift:  C(['#081608', '#16330c', '#2a5c12', '#4a8f18', '#76c924', '#a8ec48', '#ddff96', '#ffffff']),
  armor:  C(PAL.stone),
  bomb:   C(PAL.ember),
  ranged: C(PAL.arcane),
  swarm:  C(PAL.gold),
  flyer:  C(PAL.water),
  split:  C(['#180810', '#36122a', '#611f48', '#943070', '#c94a9a', '#f178c2', '#ffc2e6', '#ffffff']),
  gold:   C(PAL.gold),
  ice:    C(PAL.ice),
  fire:   C(PAL.fire),
  volt:   C(PAL.electric),
  arcane: C(PAL.arcane),
  shadow: C(PAL.shadow),
  holy:   C(PAL.holy),
  metal:  C(PAL.stone),
  blood:  C(PAL.blood),
};

/**
 * 果冻体：1px 深色硬边 + 左上打光的硬色阶 + 底部暗阶 + 两块方形高光。
 * 不用径向渐变——那是柔和版画刷，这里是像素风，明暗必须成「档」。
 */
export function blob(p, cx, cy, rx, ry, r, o = {}) {
  const a = o.alpha ?? 1;
  p.ellipse(cx, cy + 1, rx + 1.4, ry + 1.2, r[0], a);
  p.ellipse(cx, cy, rx, ry, (d, ang) => {
    const lit = 0.5 - 0.32 * Math.cos(ang) - 0.42 * Math.sin(ang);
    return step(r, clamp(lit * (1 - 0.50 * d) + 0.20));
  }, a);
  p.ellipse(cx, cy + ry * 0.56, rx * 0.82, ry * 0.28, (d) => step(r, 0.10 * (1 - d)), a * 0.92);
  if (!o.noGlint) {
    p.rect(cx - rx * 0.48, cy - ry * 0.52, Math.max(2, rx * 0.26), Math.max(2, ry * 0.15), r[r.length - 2], a * 0.95);
    p.rect(cx - rx * 0.30, cy - ry * 0.64, Math.max(1, rx * 0.10), Math.max(1, ry * 0.08), r[r.length - 1], a);
  }
}

/** 像素眼：白眼 + 深瞳 + 1px 高光；closed 时压成一条线（眨眼）。 */
export function eyes(p, cx, cy, sep = 7, o = {}) {
  const closed = !!o.closed;
  const h = closed ? 1 : 4, top = closed ? cy : cy - 2;
  for (const s of [-1, 1]) {
    const x = cx + s * sep - 2;
    p.rect(x, top, 4, h, INK, 1);
    if (!closed) {
      p.rect(x + 1, top + 0.5, 2, 3, WHITE, 1);
      p.rect(x + 2, top + 1, 1, 2, INK, 1);
      p.rect(x + 1, top + 0.5, 1, 1, WHITE, 1);
    }
  }
}

/** 落地投影：跳得越高，影子越淡越小。 */
export function groundShadow(p, cx, rx, lift, alpha = 0.42) {
  const k = clamp(Math.abs(lift) / 40);
  p.ellipse(cx, -1, rx * (1.05 - 0.30 * k), 3.2 - 1.2 * k, INK, alpha * (1 - 0.5 * k));
}

/**
 * 史莱姆跳跃相位（对齐 critters/slime 的编排）：
 * 蓄力压扁 → 拉伸起跳 → 空中圆润 → 落地甩水滴 → 弹性 wobble → 眨眼。
 * 所有敌人共用同一条骨架，靠 cfg 的颜色/体量/内部结构做机制区分。
 */
export function hopPose(t, D, cfg = {}) {
  const u = wrap(t, D) / D;
  const amp = cfg.hop ?? 16, w = cfg.width ?? 20, h = cfg.height ?? 15;
  let sx = 1, sy = 1, lift = 0, land = 0;
  if (u < 0.22) { const k = ease.outQuad(u / 0.22); sx = 1 + 0.26 * k; sy = 1 - 0.28 * k; }
  else if (u < 0.42) { const k = ease.outExpo((u - 0.22) / 0.20); sx = 1 - 0.16 * k; sy = 1 + 0.32 * k; lift = -amp * k; }
  else if (u < 0.62) { const k = (u - 0.42) / 0.20; lift = -amp; sx = 1 - 0.08 * Math.sin(k * Math.PI); sy = 1 + 0.16 * (1 - k); }
  else if (u < 0.78) { const k = (u - 0.62) / 0.16; lift = -amp * (1 - k * k); sx = 1 + 0.08 * k; sy = 1 - 0.08 * k; }
  else if (u < 0.88) { const k = (u - 0.78) / 0.10; sx = 1 + 0.30 * (1 - k); sy = 1 - 0.30 * (1 - k); land = 1 - k; }
  else { const k = (u - 0.88) / 0.12; const wob = Math.sin(k * Math.PI * 3) * Math.exp(-k * 4); sx = 1 + 0.06 * wob; sy = 1 - 0.06 * wob; }
  return { u, sx, sy, lift, land, rx: w * sx, ry: h * sy };
}

/** 标准 meta 工厂：origin 默认落在脚底，符合 pixelfx 约定。 */
export function frameMeta(name, w, h, o = {}) {
  return {
    name,
    desc: o.desc ?? '',
    tags: o.tags ?? [],
    size: [w, h],
    origin: [o.ox ?? Math.round(w / 2), o.oy ?? h - 10],
    duration: o.duration ?? 1.8,
    loop: o.loop ?? true,
    fps: o.fps ?? 24,
    options: o.options ?? {},
  };
}

export const makeFx = (meta, draw) => ({ meta, draw });
