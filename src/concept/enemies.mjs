// 敌人类别 · 8 种史莱姆（第二版）
//
// 用户反馈：① 原库精致、看不出像素点，我们的太「噪」② 原库灵动，我们僵硬 ③ 全是圆球全在蹦跳。
// 根因：上一版把 8 种敌人塞进同一条 hop 骨架，只换颜色与贴片。
//
// 这一版直接复用原库 critters 的内核，不再自己造画刷：
//   · Grid.shade/outline/draw：主体 0.92 真半透明走 p.blend（不产生 Bayer 网点）、
//     3 档成片色 + 受光方向 + 1px 方向性描边 → 精致、看不出像素点
//   · spring / toss / curve / 抛物线 + 次级运动（气泡上浮、glint、水洼、水滴爬回）→ 灵动
//   · 每种独立的 halfW() 剪影 + 独立 motion() 运动模型 → 形状与运动按机制分化
// 降噪纪律：不撒孤立散点、不用 8 档硬色阶抖斑驳、不加黑色眼窝方框；半透明一律走 blend/glow。
//
// 纪律：本文件只属于「敌人类别」，不修改 pixel-lib.mjs 或其他类别。

import {
  fit, clamp, wrap, smooth, seg, ease, lerp, rng, sparkle, TAU,
} from '../../vendor/pixelfx/src/core/index.js';
import { Grid, spring, toss, curve, shift } from '../../vendor/pixelfx/src/fx/critters/_lib.js';
import { RAMPS, frameMeta } from './pixel-lib.mjs';

const W_CANVAS = 112, H_CANVAS = 96;

const CFG = {
  normal: {
    name: '普通史莱姆', mech: '基础推进 · 检验清群 DPS',
    shape: '圆顶软脚果冻', motion: '标准弹跳（抛物线 + 弹簧余震 + 水滴爬回）',
    r: RAMPS.green, W: 30, H: 22, hop: 24, D: 1.8, kind: 'normal', puddle: true,
  },
  swift: {
    name: '疾行史莱姆', mech: '高速突进 · 压缩反应窗口',
    shape: '扁平梭形 + 拉长拖影', motion: '贴地滑行 + 间歇冲刺（完全不跳）',
    r: RAMPS.swift, W: 36, H: 12, hop: 0, D: 1.1, kind: 'swift', puddle: true,
  },
  armor: {
    name: '装甲史莱姆', mech: '高血厚甲 · 需穿甲 / 冻结×3',
    shape: '方角硬壳 + 平底 + 装甲横带', motion: '沉重踏步（几乎不离地，左右摇摆 + 落地余震）',
    r: RAMPS.armor, W: 34, H: 23, hop: 3, D: 2.2, kind: 'armor', puddle: true,
  },
  bomber: {
    name: '自爆史莱姆', mech: '抵线自爆 · 必须单体速杀',
    shape: '带尖刺的球 + 顶部引信', motion: '原地膨胀脉动（越到周期末越涨大闪白，不跳）',
    r: RAMPS.bomb, W: 28, H: 26, hop: 0, D: 1.9, kind: 'bomber', puddle: true,
  },
  ranged: {
    name: '远程史莱姆', mech: '站定 30% 处投掷 · 考验续航',
    shape: '上窄下宽的钟形塔 + 底座', motion: '静置悬浮微动 + 投掷后坐（完全不跳）',
    r: RAMPS.ranged, W: 26, H: 28, hop: 0, D: 2.0, kind: 'ranged',
  },
  swarm: {
    name: '蜂群史莱姆', mech: '数量压制 · 检验 AOE 覆盖',
    shape: '3 个极小不规则团', motion: '群集乱飞（各自不同频率的 Lissajous，不整齐、不落地）',
    r: RAMPS.swarm, W: 13, H: 11, hop: 0, D: 1.6, kind: 'swarm',
  },
  flyer: {
    name: '飞行史莱姆', mech: '无视地面阻挡 · 需对空',
    shape: '水母伞盖 + 飘动触须', motion: '上下漂浮 + 伞缘脉动（不落地）',
    r: RAMPS.flyer, W: 30, H: 18, hop: 0, D: 2.2, kind: 'flyer',
  },
  splitter: {
    name: '分裂史莱姆', mech: '死亡分裂 · 需收尾清场',
    shape: '中间收腰的双瓣葫芦', motion: '左右分裂—合拢（横向运动，不是纵向跳）',
    r: RAMPS.split, W: 32, H: 24, hop: 0, D: 2.0, kind: 'splitter', puddle: true,
  },
};

// ── 剪影：v = 0 底 → 1 顶，返回该高度半宽。8 种各不相同 ──
function halfW(kind, v, W, t = 0) {
  if (v < 0 || v > 1) return -1;
  const hw = W / 2, q = 2 * v - 1;
  switch (kind) {
    case 'normal':
      return v >= 0.4 ? hw * Math.sqrt(Math.max(0, 1 - ((v - 0.4) / 0.6) ** 2))
        : hw * Math.sqrt(Math.max(0, 1 - 0.10 * (((0.4 - v) / 0.4) ** 2)));
    case 'swift':
      return hw * (0.30 + 0.70 * Math.sin(Math.PI * Math.pow(v, 0.72)));
    case 'armor': {
      const cut = 0.18;
      return v > 1 - cut ? hw * (1 - ((v - (1 - cut)) / cut) * 0.52) : hw * 0.97;
    }
    case 'bomber':
      return hw * Math.sqrt(Math.max(0, 1 - q * q)) * 0.95;
    case 'ranged':
      return hw * (0.38 + 0.62 * Math.pow(1 - v, 0.8));
    case 'flyer': {
      const pulse = 1 + 0.06 * Math.sin(t * TAU * 2);
      return v >= 0.32 ? hw * pulse * Math.sqrt(Math.max(0, 1 - (((v - 0.32) / 0.68) ** 2)))
        : hw * (0.22 + 0.26 * Math.sin((v / 0.32) * Math.PI));
    }
    case 'splitter': {
      const waist = 1 - 0.40 * Math.exp(-(((v - 0.52) / 0.13) ** 2));
      return hw * waist * Math.sqrt(Math.max(0, 1 - q * q * 0.30));
    }
    case 'swarm':
      return hw * Math.sqrt(Math.max(0, 1 - q * q));
    default:
      return hw;
  }
}

const inside = (P, x, y) => {
  const v = (P.yb - y) / P.H, hw = halfW(P.kind, v, P.W, P.t);
  return hw >= 0 && Math.abs(x - P.cx - P.lean * v * P.H) <= hw;
};

// ── 运动模型：每种独立，不再共用一条 hop ──
function motion(cfg, t) {
  const D = cfg.D, u = t / D, TAUu = u * TAU;
  const B = { kind: cfg.kind, t, D, u, cx: 0, by: 0, lean: 0, q: -1, age: 0, W: cfg.W, H: cfg.H };
  switch (cfg.kind) {
    case 'normal': {
      const T_SQ = 0.28 * D, T_UP = 0.47 * D, T_LIFT = 0.50 * D, T_LAND = 0.80 * D;
      const age = wrap(t - T_LAND, D);
      B.age = age;
      if (t >= T_LIFT && t < T_LAND) {
        const q = (t - T_LIFT) / (T_LAND - T_LIFT);
        B.q = q; B.by = -cfg.hop * 4 * q * (1 - q);
        const s = curve(q, [[0, 0.34], [0.4, 0.02], [0.55, -0.05], [0.85, 0.08], [1, 0.16]]);
        B.W = cfg.W / Math.sqrt(1 + s); B.H = cfg.H * (1 + s);
      } else if (t >= T_UP && t < T_LIFT) {
        const s = lerp(-0.30, 0.34, ease.outCubic(seg(t, T_UP, T_LIFT)));
        B.W = cfg.W / Math.sqrt(1 + s); B.H = cfg.H * (1 + s);
      } else if (t >= T_SQ && t < T_UP) {
        const k = seg(t, T_SQ, T_UP);
        const s = -0.30 * ease.inOutSine(k) + 0.016 * Math.sin(TAUu * 14) * smooth(0.55, 1, k);
        B.W = cfg.W / Math.sqrt(1 + s); B.H = cfg.H * (1 + s);
      } else {
        const s = age < 0.06 ? -0.44 : -0.44 * spring(age - 0.06, 2.1, 4.6);
        B.W = cfg.W / Math.sqrt(1 + s); B.H = cfg.H * (1 + s);
        B.lean = 0.07 * Math.exp(-age * 4) * Math.sin(age * TAU * 1.9);
        if (t < T_SQ) B.W *= 1 + 0.02 * Math.sin((t / T_SQ) * TAU);
      }
      break;
    }
    case 'swift': {
      const dash = Math.pow(Math.max(0, Math.sin(TAUu * 3)), 6);
      B.cx = 13 * Math.sin(TAUu) + 8 * dash;
      B.by = -1 - 1.5 * Math.abs(Math.sin(TAUu * 2));
      B.W = cfg.W * (1 + 0.22 * dash); B.H = cfg.H * (1 - 0.12 * dash);
      B.lean = 0.10 * Math.sin(TAUu * 3 + 0.6);
      break;
    }
    case 'armor': {
      const step = Math.sin(TAUu * 2), land = Math.max(0, Math.sin(TAUu * 2 - 0.9));
      B.cx = 3 * step; B.by = -cfg.hop * land;
      B.lean = 0.055 * step - 0.04 * spring(land * 0.5, 1.6, 5);
      B.H = cfg.H * (1 - 0.055 * land);
      break;
    }
    case 'bomber': {
      const grow = Math.pow(u, 1.6), pulse = 0.5 + 0.5 * Math.sin(TAUu * 4);
      const s = 0.10 * pulse + 0.30 * grow;
      B.W = cfg.W * (1 + s); B.H = cfg.H * (1 + s * 0.8);
      B.by = -1 - 1.5 * pulse; B.lean = 0.02 * Math.sin(TAUu * 3);
      break;
    }
    case 'ranged': {
      const throwU = wrap(u - 0.30, 1) / 0.42;
      const recoil = u > 0.30 && u < 0.72 ? Math.exp(-throwU * 7) : 0;
      B.by = -4 - 1.8 * Math.sin(TAUu * 1.5);
      B.cx = -3.5 * recoil; B.lean = 0.03 * Math.sin(TAUu) + 0.05 * recoil;
      break;
    }
    case 'swarm':
      B.by = -14 - 4 * Math.sin(TAUu * 2); B.cx = 5 * Math.sin(TAUu * 1.3);
      break;
    case 'flyer':
      B.by = -30 - 9 * Math.sin(TAUu); B.cx = 3 * Math.sin(TAUu * 0.7);
      B.W = cfg.W * (1 + 0.09 * Math.sin(TAUu * 2));
      B.H = cfg.H * (1 - 0.06 * Math.sin(TAUu * 2));
      B.lean = 0.05 * Math.sin(TAUu * 1.3);
      break;
    case 'splitter':
      B.by = -2 - 2 * Math.abs(Math.sin(TAUu));
      B.W = cfg.W * (1 + 0.06 * Math.sin(TAUu * 2));
      B.lean = 0.02 * Math.sin(TAUu);
      break;
  }
  B.yb = B.by - 1;
  return B;
}

// ── 身体：原库成片着色法；clear=false 供蜂群把三团叠进同一 Grid ──
function body(g, C, P, clear = true) {
  const yb = P.yb, half = P.W / 2 + 4;
  const cx = P.cx + P.lean * 0.45 * P.H, cy = yb - P.H * 0.5;
  const lx = cx - P.W * 0.24, ly = cy - P.H * 0.36;
  const lit = (x, y, k) => inside(P, lx + (x - lx) / k, ly + (y - ly) / k);
  if (clear) g.clear();
  g.shade(P.cx - half, yb - P.H - 2, P.cx + half, yb + 1, (x, y, o) => {
    if (!inside(P, x, y)) return 0;
    o.a = 0.92;                                   // 真半透明 → Grid.draw 走 p.blend，不出网点
    let i = lit(x, y, 0.42) ? 5 : lit(x, y, 0.7) ? 4 : 3;
    const v = (yb - y) / P.H;
    if (v < 0.3 && inside(P, x, y + 1.4)) i = !inside(P, x, y + 2.4) ? 5 : v < 0.2 ? 4 : i;
    if (!inside(P, x + 2, y + 2.4)) { i = 2; o.a = 1; }
    const ang = Math.atan2(y - cy, (x - cx) * (P.H / P.W));
    if (!inside(P, x - 1.6, y - 1.6) && inside(P, x - 0.7, y - 0.7) && ang > -2.75 && ang < -1.55) {
      i = ang > -2.45 && ang < -1.8 ? 6 : 5; o.a = 1;
    }
    if (i === 2 && inside(P, x + 1, y + 1.2) && !inside(P, x + 2, y + 2.4) && ang > 0.3 && ang < 1.5) i = 4;
    return C[i];
  });
  const hx = Math.round(cx - P.W * 0.27), hy = Math.round(cy - P.H * 0.14);
  if (inside(P, hx - 1, hy) && inside(P, hx + 1, hy + 1)) {
    g.set(hx, hy, C[6]); g.set(hx, hy + 1, C[5]);
  }
}

// 眼：原库竖线眼，随挤压眯/睁/闭/眨，不画黑色眼窝方框
function face(g, C, P, t) {
  const yb = P.yb, ev = 0.47, ey = Math.round(yb - P.H * ev);
  const ex = Math.max(3, Math.round(P.W * 0.16));
  const xc = Math.round(P.cx + P.lean * ev * P.H);
  const air = P.q >= 0;
  const shut = P.kind === 'normal' && P.age < 0.16 && !air;
  const bt = wrap(t + 0.12, P.D);
  const blink = bt > 0.22 && bt < 0.29;
  const wind = P.kind === 'normal' && t / P.D > 0.28 && t / P.D < 0.50 ? 1 : 0;
  const look = air ? (P.q < 0.45 ? -1 : P.q > 0.7 ? 1 : 0) : 0;
  const eh = clamp(Math.round(4 - wind * 2 + (air && P.q < 0.6 ? 1 : 0)), 1, 5);
  for (const side of [-1, 1]) {
    const x = xc + side * ex - (side > 0 ? 1 : 0);
    if (shut) { g.set(x, ey, C[0]); g.set(x + 1, ey + 1, C[0]); continue; }
    if (blink) { g.set(x, ey + 1, C[0]); g.set(x + 1, ey + 1, C[0]); continue; }
    const top = ey + 2 - eh + look;
    for (let k = 0; k < eh; k++) { g.set(x, top + k, C[0]); g.set(x + 1, top + k, C[0]); }
    g.set(x + (look > 0 ? 1 : 0), top + (look > 0 ? 1 : 0), C[6]);
    if (eh >= 4) g.set(x + 1, top + eh - 1, C[2]);
  }
  const my = Math.round(yb - P.H * 0.31);
  if (air && P.q < 0.75) { g.set(xc, my, C[0]); g.set(xc - 1, my, C[0]); }
  else if (!shut) { g.set(xc, my, C[1]); g.set(xc - 1, my, C[1]); }
}

// 内部气泡上浮（次级运动）
function bubbleIn(g, C, P, t) {
  const POP = 0.40;
  if (t > POP) return;
  const v = lerp(0.18, 0.86, ease.inQuad(t / POP));
  const hw = halfW(P.kind, v, P.W, P.t);
  const x = P.cx + P.lean * v * P.H - hw * lerp(0.35, 0.05, t / POP);
  const y = P.yb - v * P.H;
  if (!inside(P, x, y)) return;
  g.set(x, y, C[6]); g.set(x + 1, y, C[5]); g.set(x, y + 1, C[5]);
}

// 每种敌人的专属装饰（成片、克制，不撒孤立噪点）
function decor(g, P, C, cfg) {
  const yb = P.yb, u = P.u;
  switch (cfg.kind) {
    case 'armor': {
      const y = Math.round(yb - P.H * 0.42);
      g.line(P.cx - P.W * 0.36, y, P.cx + P.W * 0.36, y, C[2], 1);
      g.line(P.cx - P.W * 0.36, y - 1, P.cx + P.W * 0.36, y - 1, C[5], 1);
      for (const s of [-1, 1]) {
        g.set(Math.round(P.cx + s * P.W * 0.28), y, C[6]);
        g.set(Math.round(P.cx + s * P.W * 0.28) + 1, y, C[4]);
      }
      break;
    }
    case 'bomber': {
      for (let i = 0; i < 6; i++) {
        const a = u * TAU * 0.15 + i * TAU / 6;
        const sx = P.cx + Math.cos(a) * P.W * 0.47;
        const sy = yb - P.H * 0.5 - Math.sin(a) * P.H * 0.47;
        g.set(Math.round(sx), Math.round(sy), C[2]);
        g.set(Math.round(sx + Math.cos(a) * 2), Math.round(sy - Math.sin(a) * 2), C[4]);
      }
      const top = Math.round(yb - P.H);
      g.line(P.cx, top - 2, P.cx, top - 5, C[2], 1);
      g.set(P.cx, top - 6, C[6]);
      const cr = 4 + 2.4 * Math.pow(u, 1.6);
      g.ellipse(P.cx, yb - P.H * 0.42, cr, cr, (nx, ny) => {
        const d = Math.hypot(nx, ny);
        return d > 0.72 ? C[0] : d > 0.38 ? C[3] : C[6];
      }, 1);
      break;
    }
    case 'splitter':
      g.line(P.cx, yb - P.H * 0.86, P.cx, yb - P.H * 0.14, C[1], 1);
      for (const s of [-1, 1]) g.set(Math.round(P.cx + s * 5), Math.round(yb - P.H * 0.5), C[6]);
      break;
    case 'ranged':
      g.line(P.cx - P.W * 0.42, yb, P.cx + P.W * 0.42, yb, C[2], 1);
      break;
    default: break;
  }
}

// 水洼（back 层）：成片低 dome，不是散点
function puddle(p, P, C) {
  const R = P.W / 2 + 3 + 6 * Math.exp(-P.age * 5), hp = 2.2;
  for (let x = Math.floor(-R); x <= Math.ceil(R); x++) {
    const d = Math.abs(x + 0.5) / R;
    if (d > 1) continue;
    const top = -1 - Math.round(Math.sqrt(1 - d * d) * hp);
    for (let y = top; y <= 0; y++) p.px(P.cx + x, y, y === top ? C[5] : C[2]);
  }
  p.glow(P.cx, -2, R * 1.3 + 6, C[4], 0.10);
}

// 4 颗水滴：抛物线飞出 → 落地 → 爬回本体（数量克制，是运动不是噪点）
function droplets(p, P, C, cfg) {
  if (P.kind !== 'normal' && P.kind !== 'armor') return;
  const age = P.kind === 'normal' ? P.age : wrap(P.t - P.D * 0.78, P.D);
  if (age > 0.75) return;
  const G = 640;
  for (let i = 0; i < 4; i++) {
    const r = rng(11, i, 7);
    const a = -Math.PI / 2 + r.range(-1.0, 1.0);
    const x0 = Math.sin(a + Math.PI / 2) * (P.W * 0.42);
    const f = toss(x0, -2, Math.cos(a) * r.range(48, 78), Math.sin(a) * r.range(48, 78), age, G, -1);
    if (f.landed) {
      const home = Math.sign(f.lx || 1) * (P.W / 2 - 2);
      const u = seg(age - f.at, 0, 0.5);
      const x = lerp(f.lx + P.cx, P.cx + home, ease.inOutSine(u));
      p.px(Math.round(x), -1, C[5]); p.px(Math.round(x), 0, C[3]);
      if (u >= 1) continue;
    } else {
      p.px(Math.round(P.cx + f.x), Math.round(f.y), C[5]);
      p.px(Math.round(P.cx + f.x), Math.round(f.y) + 1, C[4]);
    }
    p.glow(P.cx + (f.landed ? f.lx : f.x), f.landed ? -1 : f.y, 4, C[4], 0.20);
  }
}

function build(id) {
  const cfg = CFG[id];
  const C7 = fit(cfg.r, 7);
  const G = new Grid(-56, -80, W_CANVAS, 88);
  const meta = frameMeta(cfg.name, W_CANVAS, H_CANVAS, {
    desc: `${cfg.shape}｜${cfg.motion}`,
    tags: ['enemy', 'slime', id],
    duration: cfg.D, loop: true, fps: 30, oy: H_CANVAS - 14,
  });
  const poseAt = (t) => motion(cfg, shift(t, cfg.D, 1));

  const draw = (p, t) => {
    const P = poseAt(t), C = C7, yb = P.yb;

    // 蜂群：三团画进同一 Grid，各自不同相位
    if (cfg.kind === 'swarm') {
      G.clear();
      const offs = [[-14, 0.00, 1.0], [1, 0.37, 1.4], [13, 0.71, 0.8]];
      for (const [dx, ph, f] of offs) {
        const save = { cx: P.cx, by: P.by, yb: P.yb, H: P.H };
        Object.assign(P, {
          cx: P.cx + dx, by: P.by + 5 * Math.sin(P.u * TAU * f + ph * TAU),
          H: P.H * (0.85 + 0.2 * f),
        });
        P.yb = P.by - 1;
        body(G, C, P, false);
        face(G, C, P, (t + ph * cfg.D) % cfg.D);
        Object.assign(P, save);
      }
      G.outline((x, y, nx, ny) => (ny < 0 && nx <= 0 ? C[1] : C[0]));
      G.draw(p);
      p.glow(P.cx, -6, 26, C[4], 0.16);
      return;
    }

    body(G, C, P);
    face(G, C, P, t);
    bubbleIn(G, C, P, t);
    decor(G, P, C, cfg);
    G.outline((x, y, nx, ny) => (ny < 0 && nx <= 0 && y < yb - P.H * 0.5 ? C[1] : C[0]));
    G.draw(p);

    const cx = P.cx + P.lean * P.H * 0.4, cy = yb - P.H * 0.45;

    if (cfg.kind === 'flyer') {                     // 触须：不透明细线 + 加色柔光（不 dither）
      for (let i = 0; i < 4; i++) {
        const bx = P.cx + (i - 1.5) * 6;
        const sway = Math.sin(t * TAU * 1.6 + i * 0.8) * 3;
        const ex = bx + sway, ey = yb + 9 + 3 * Math.sin(t * TAU + i);
        p.line(bx, yb - P.H * 0.25, ex, ey, C[4], 1);
        p.glowLine(bx, yb - P.H * 0.25, ex, ey, 3, C[5], 0.20);
      }
      p.glow(cx, cy + 3, 18, C[5], 0.20);
    }

    if (cfg.kind === 'ranged') {                    // 法球 + 投掷弧线
      const throwU = wrap(P.u - 0.30, 1) / 0.42;
      const active = P.u > 0.30 && P.u < 0.72;
      const oy = yb - P.H - 8 - Math.sin(t * TAU * 1.5) * 2;
      if (!active) {
        p.disc(P.cx, oy, 4, C[5], 0.95);
        p.disc(P.cx - 1, oy - 1, 1.5, C[6], 0.9);
        p.glow(P.cx, oy, 9, C[4], 0.28);
      } else {
        const k = clamp(throwU);
        const bx = P.cx + 26 * k, by = oy + 16 * Math.sin(k * Math.PI);
        p.glowLine(P.cx, oy, bx, by, 3, C[4], 0.30);
        p.circle(bx, by, 3.2, C[6], 1);
        p.glow(bx, by, 7, C[5], 0.30);
      }
    }

    if (cfg.kind === 'bomber') {                    // 核心涨大 + 闪白预警（1 个亮点）
      const warn = Math.pow(P.u, 1.8);
      p.glow(P.cx, yb - P.H * 0.42, 10 + 12 * warn, C[5], 0.16 + 0.34 * warn);
      if (P.u > 0.86) p.disc(P.cx, yb - P.H * 0.42, 3 + 4 * warn, C[6], 0.35 * (P.u - 0.86) / 0.14);
      const fy = yb - P.H - 6;
      p.px(P.cx, fy, C[6]);
      p.glow(P.cx, fy, 5, C[5], 0.30);
    }

    if (cfg.kind === 'swift') {                     // 拖影用加色光，不用 dither 椭圆
      const dash = Math.pow(Math.max(0, Math.sin(P.u * TAU * 3)), 6);
      for (let i = 1; i <= 2; i++) {
        const ox = P.cx - i * (7 + 6 * dash);
        p.glow(ox, yb - P.H * 0.5, 9 + 5 * dash, C[3], 0.20 - i * 0.05);
      }
    }

    if (cfg.kind === 'splitter') {                  // 两瓣横向拉开，用柔光带表达
      const sep = 3 + 7 * Math.max(0, Math.sin(P.u * TAU));
      p.glow(P.cx - sep, yb - P.H * 0.5, 8, C[4], 0.18);
      p.glow(P.cx + sep, yb - P.H * 0.5, 8, C[4], 0.18);
    }

    if (cfg.kind === 'normal' && P.q > 0.4 && P.q < 0.64) {
      const k = Math.sin(Math.PI * seg(P.q, 0.4, 0.64));
      sparkle(p, P.cx - P.W * 0.21, yb - P.H * 0.8, 1 + 2.5 * k, C[6], C[5], 0.5 * k);
    }

    // 环境加色光：把硬边缘糊进背景，这是「看不出像素点」的关键（对齐原库的多层底光）
    p.glow(P.cx * 0.5, -14, 52, C[3], 0.18);
    p.glow(cx * 0.6, yb - P.H * 0.32, 54, C[3], 0.30);
    p.glow(cx, cy, 28 + P.W * 0.35, C[4], 0.24);
    p.glow(cx, cy + 3, 16, C[5], 0.18);

    droplets(p, P, C, cfg);
  };

  const drawBack = (p, t) => {
    const P = poseAt(t), C = C7;
    if (cfg.puddle) puddle(p, P, C);
    else p.glow(P.cx, -2, 22, C[3], 0.10);
    if (cfg.kind === 'armor') {
      const land = Math.max(0, Math.sin(P.u * TAU * 2 - 0.9));
      p.glowRing(P.cx, -1, 8 + 14 * land, 2.5, C[2], 0.35 * land);
    }
  };

  return { meta, draw, drawBack };
}

export const ENEMY_EFFECTS = Object.keys(CFG).map((id) => {
  const c = CFG[id];
  return {
    id, name: c.name,
    spec: `${c.shape} · ${c.motion}`,
    mech: c.mech,
    read: `形态 ${c.shape} / 运动 ${c.motion}`,
    source: '内核新写（复用 critters Grid/spring/toss 内核）',
    demoHook: `enemy.type === '${id}' → drawEnemyBody()`,
    mod: build(id),
  };
});
