// 柔和卡通版特效内核 —— 纯 Canvas2D JS，零第三方依赖、零图片素材
//
// 借鉴 pixelfx 的「内核与编排」，不借鉴它的像素观感：
//   · 双缓冲 → color 用普通合成画实体/亮边，light 用 globalCompositeOperation='lighter' 画加色辉光
//   · 深→亮→白热 palette 色阶（端点保持，等价 fit()）→ 一个主色自动派生整套特效配色
//   · seeded Rng → 所有随机确定性、可复现、可测；绘制是状态的纯函数，天然帧率无关
//   · 相位编排 → 蓄力 → 白热 hero frame → 扩散 → 保持(星芒/余烬) → 消散，快起慢收
//   · back / front 分层 → 地面光板与环的远半在角色之后，光柱/文字/近半在前
// 不使用的：1px 像素网格、dither 网点、像素字体、硬边星芒 —— 那些属于硬像素风，
// 与本项目定稿的「柔和圆润卡通霓虹」冲突。这里全部用径向渐变 + 圆头笔触 + 柔边描边。
//
// 纪律：本文件是【渲染层】，只读 world 状态、不判断规则、不写 world。逻辑层一行不动。

const TAU = Math.PI * 2;

// ─────────────────────────────────────────────────────────────
// 一、引擎无关部分（色阶 / 随机 / 相位数学）—— 可被 Node 单测
// ─────────────────────────────────────────────────────────────

export function parseHex(h) {
  let s = String(h ?? '').trim().replace('#', '');
  if (s.length === 3) s = s[0] + s[0] + s[1] + s[1] + s[2] + s[2];
  if (!/^[0-9a-f]{6}$/i.test(s)) return [255, 216, 138]; // 非 hex 输入的安全回退（暖白）
  const v = parseInt(s.slice(0, 6), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

export function toHex(rgb) {
  return '#' + rgb.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('');
}

export function mixColor(a, b, t) {
  const A = parseHex(a), B = parseHex(b);
  return toHex(A.map((v, i) => v + (B[i] - v) * Math.max(0, Math.min(1, t))));
}

export function rgba(hex, a) {
  const [r, g, b] = parseHex(hex);
  return `rgba(${r},${g},${b},${Math.max(0, Math.min(1, a))})`;
}

export function luma(hex) {
  const [r, g, b] = parseHex(hex);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}

export function saturation(hex) {
  const [r, g, b] = parseHex(hex), mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  return mx === 0 ? 0 : (mx - mn) / mx;
}

// 纯白/灰没有色相，直接派生会得到一条灰阶（无生命力）。改用暖金白作主色。
const NEUTRAL = '#ffd98a';

// 深 → 中 → 亮 → 白热 的锚点；t=0 与 t=1 固定，等价 pixelfx 的 fit() 端点保持
const ANCHORS = [
  { t: 0.00, mul: 0.30, white: 0.00, cool: 0.10 },
  { t: 0.22, mul: 0.58, white: 0.00, cool: 0.05 },
  { t: 0.46, mul: 0.86, white: 0.04, cool: 0.00 },
  { t: 0.68, mul: 1.00, white: 0.18, cool: 0.00 },
  { t: 0.86, mul: 1.00, white: 0.62, cool: 0.00 },
  { t: 1.00, mul: 1.00, white: 1.00, cool: 0.00 },
];

/** 主色在色阶 t∈[0,1] 处的颜色（t=0 最深、t=1 白热）。 */
export function paletteStep(hex, t) {
  let base = String(hex ?? '');
  if (saturation(base) < 0.12 || luma(base) > 0.92) base = NEUTRAL;
  const u = Math.max(0, Math.min(1, t));
  let i = 0;
  while (i < ANCHORS.length - 2 && ANCHORS[i + 1].t < u) i++;
  const A = ANCHORS[i], B = ANCHORS[i + 1];
  const k = B.t === A.t ? 0 : (u - A.t) / (B.t - A.t);
  const mul = A.mul + (B.mul - A.mul) * k;
  const white = A.white + (B.white - A.white) * k;
  const cool = A.cool + (B.cool - A.cool) * k;
  let [r, g, b] = parseHex(base).map((v) => v * mul);
  r *= 1 - cool * 0.30; g *= 1 - cool * 0.08; b *= 1 + cool * 0.22; // 阴影略偏冷
  r += (255 - r) * white; g += (255 - g) * white; b += (255 - b) * white;
  return toHex([r, g, b]);
}

/** 生成 n 档色阶（默认 6）：[深, 暗, 中, 亮, 热, 白热]。 */
export function makePalette(hex, n = 6) {
  const len = Math.max(2, Math.floor(n));
  return Array.from({ length: len }, (_, i) => paletteStep(hex, i / (len - 1)));
}

/** seeded RNG（mulberry32）。同一 seed 必得同一序列。 */
export class Rng {
  constructor(seed = 1) { this.reset(seed); }
  reset(seed = 1) { this.s = (Number(seed) >>> 0) || 1; return this; }
  next() {
    let t = (this.s += 0x6D2B79F5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  range(a, b) { return a + (b - a) * this.next(); }
  int(a, b) { return Math.floor(this.range(a, b + 1)); }
  pick(arr) { return arr[Math.floor(this.next() * arr.length)]; }
  sign() { return this.next() < 0.5 ? -1 : 1; }
  chance(p) { return this.next() < p; }
}

export const clamp01 = (v) => Math.max(0, Math.min(1, v));
export const lerp = (a, b, t) => a + (b - a) * t;
/** 在 [a,b] 区间内的归一化进度，区间外钳到 0/1。 */
export const seg = (u, a, b) => (b <= a ? (u >= b ? 1 : 0) : clamp01((u - a) / (b - a)));
export const smooth = (a, b, u) => { const t = seg(u, a, b); return t * t * (3 - 2 * t); };

export const ease = {
  inQuad: (t) => t * t,
  outQuad: (t) => 1 - (1 - t) * (1 - t),
  outCubic: (t) => 1 - Math.pow(1 - t, 3),
  outExpo: (t) => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t)),
  inOutSine: (t) => -(Math.cos(Math.PI * t) - 1) / 2,
  outBack: (t) => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); },
};

/** 相位节点（归一化时间），对齐 pixelfx 的「快起慢收」编排。 */
export const PHASE = { anticipate: 0.10, flash: 0.16, spread: 0.45, hold: 0.76 };

// ─────────────────────────────────────────────────────────────
// 二、绘制原语（柔边、圆头、加色辉光）
// ─────────────────────────────────────────────────────────────

/** light 缓冲的等价物：加色合成，越叠越亮，白热核心靠它。 */
function light(ctx, fn) {
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  fn();
  ctx.restore();
}

/** 柔和加色光晕（径向渐变，中心亮、边缘透明）。 */
export function softGlow(ctx, x, y, r, hex, a = 1) {
  if (a <= 0 || r <= 0) return;
  light(ctx, () => {
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, rgba(hex, a));
    g.addColorStop(0.42, rgba(hex, a * 0.34));
    g.addColorStop(1, rgba(hex, 0));
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
  });
}

/** 柔边实心圆（color 缓冲，普通合成）。squash<1 压成椭圆，用于地面光板。 */
export function softDisc(ctx, x, y, r, hex, a = 1, squash = 1) {
  if (a <= 0 || r <= 0) return;
  ctx.save();
  ctx.translate(x, y); ctx.scale(1, squash); ctx.translate(-x, -y);
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, rgba(hex, a));
  g.addColorStop(0.60, rgba(hex, a * 0.88));
  g.addColorStop(1, rgba(hex, 0));
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
  ctx.restore();
}

/** 柔边环：三层递减宽度叠出软边。arcRange=[起,止] 可只画半圈（远半/近半分层）。 */
export function softRing(ctx, x, y, r, w, hex, a = 1, squash = 1, arcRange = null) {
  if (a <= 0 || r <= 0) return;
  ctx.save();
  ctx.translate(x, y); ctx.scale(1, squash); ctx.translate(-x, -y);
  ctx.lineCap = 'round';
  const a0 = arcRange ? arcRange[0] : 0, a1 = arcRange ? arcRange[1] : TAU;
  for (const [k, al] of [[2.8, 0.16], [1.8, 0.34], [1, 0.92]]) {
    ctx.lineWidth = Math.max(0.4, w * k);
    ctx.strokeStyle = rgba(hex, a * al);
    ctx.beginPath(); ctx.ellipse(x, y, r, r, 0, a0, a1); ctx.stroke();
  }
  ctx.restore();
}

/** 圆头胶囊线（拖尾、光柱芯、星芒臂）。 */
export function softCapsule(ctx, x0, y0, x1, y1, w, hex, a = 1) {
  if (a <= 0) return;
  ctx.save();
  ctx.lineCap = 'round';
  for (const [k, al] of [[2.4, 0.20], [1, 0.90]]) {
    ctx.lineWidth = Math.max(0.4, w * k);
    ctx.strokeStyle = rgba(hex, a * al);
    ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
  }
  ctx.restore();
}

/** 四芒柔星（不用硬边尖角）。 */
export function softStar(ctx, x, y, arm, hex, a = 1) {
  if (a <= 0 || arm <= 0) return;
  softGlow(ctx, x, y, arm * 1.8, hex, a * 0.45);
  const w = Math.max(1.2, arm * 0.20);   // 圆润的胖星芒，不用像素风的细硬尖角
  softCapsule(ctx, x - arm, y, x + arm, y, w, hex, a);
  softCapsule(ctx, x, y - arm * 1.25, x, y + arm * 1.25, w, hex, a * 0.85);
  softDisc(ctx, x, y, Math.max(1.5, arm * 0.22), mixColor(hex, '#ffffff', 0.7), a);
}

/** 柔和文字：底部光晕 + 圆头描边 + 顶部高光，支持挤压拉伸。 */
export function softText(ctx, text, x, y, size, hex, o = {}) {
  const { alpha = 1, glow = 0.6, outline = 'rgba(10,18,28,0.86)', scaleX = 1, scaleY = 1, weight = 'bold' } = o;
  if (alpha <= 0) return;
  ctx.save();
  ctx.translate(x, y); ctx.scale(scaleX, scaleY); ctx.translate(-x, -y);
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.font = `${weight} ${size}px "PingFang SC","Microsoft YaHei",sans-serif`;
  softGlow(ctx, x, y, size * 0.95, hex, alpha * glow * 0.42);
  ctx.globalAlpha = alpha;
  ctx.lineJoin = 'round';
  ctx.lineWidth = Math.max(2, size * 0.24);
  ctx.strokeStyle = outline;
  ctx.strokeText(text, x, y);
  ctx.fillStyle = hex;
  ctx.fillText(text, x, y);
  ctx.fillStyle = rgba('#ffffff', 0.30);
  ctx.fillText(text, x, y - size * 0.07);
  ctx.restore();
}

/** 多边形（金币/碎片/宝石的柔边本体），用横向缩放模拟绕竖轴旋转。 */
function softPoly(ctx, x, y, pts, spin, hex, edge, a) {
  if (a <= 0 || spin <= 0.02) return;
  ctx.save();
  ctx.translate(x, y); ctx.scale(Math.max(0.06, spin), 1); ctx.translate(-x, -y);
  ctx.beginPath();
  pts.forEach(([px, py], i) => (i ? ctx.lineTo(x + px, y + py) : ctx.moveTo(x + px, y + py)));
  ctx.closePath();
  ctx.fillStyle = rgba(hex, a * 0.92); ctx.fill();
  ctx.lineJoin = 'round'; ctx.lineWidth = 1.6; ctx.strokeStyle = rgba(edge, a); ctx.stroke();
  ctx.restore();
}

// ─────────────────────────────────────────────────────────────
// 三、特效层：读 world 状态重绘（无自建状态，完全确定性）
// ─────────────────────────────────────────────────────────────

/** 命中火花：白热核心 → 沿速度拉伸的亮尾 → 冷却变色 → 余晖消散。 */
export function drawSoftParticles(ctx, particles) {
  for (const p of particles) {
    const u = 1 - Math.max(0, p.life) / p.maxLife;       // 0→1，逻辑层已推进位置
    const pal = makePalette(p.color, 6);
    const c = pal[Math.min(5, Math.floor((1 - u) * 5.99))]; // 由白热冷却到深色
    const a = 1 - smooth(0.45, 1, u);
    const sp = Math.hypot(p.vx, p.vy);
    const ux = sp > 0 ? p.vx / sp : 0, uy = sp > 0 ? p.vy / sp : 0;
    const tail = Math.min(26, sp * 0.035) * (1 - u * 0.7);
    softGlow(ctx, p.x, p.y, p.size * 4.2 * (0.75 + 0.5 * (1 - u)), c, 0.58 * a);
    if (tail > 1) softCapsule(ctx, p.x, p.y, p.x - ux * tail, p.y - uy * tail, p.size * 1.3, c, 0.58 * a);
    const core = u < 0.10 ? mixColor(c, '#ffffff', 1 - u / 0.10) : c; // 白热 hero frame
    softDisc(ctx, p.x, p.y, p.size * (u < 0.10 ? 2.0 : 1.5), core, a);
  }
}

/** 冲击环：白热起手 + 远半暗 / 近半亮（纵深）+ 内亮细环 + 余晖。 */
export function drawSoftRings(ctx, rings) {
  for (const r of rings) {
    const u = 1 - Math.max(0, r.life) / r.maxLife;
    const pal = makePalette(r.color, 6);
    const a = 1 - smooth(0.55, 1, u);
    const white = u < 0.12 ? 1 - u / 0.12 : 0;
    softGlow(ctx, r.x, r.y, r.r * 1.5, pal[4], 0.16 * a);
    softRing(ctx, r.x, r.y, r.r, 3.5, pal[3], 0.45 * a, 0.34, [Math.PI, TAU]);          // 远半（上）
    softRing(ctx, r.x, r.y, r.r, 3.0, mixColor(pal[4], '#ffffff', white), 0.95 * a, 0.34, [0, Math.PI]); // 近半（下）
    softRing(ctx, r.x, r.y, r.r * 0.72, 1.6, mixColor(pal[5], '#ffffff', white * 0.5), 0.68 * a, 0.34);
  }
}

/** 伤害飘字：白帧 → 弹出放大 → 落地挤压(squash) → 上浮保持 → 淡出。 */
export function drawSoftFloaters(ctx, floaters) {
  for (const f of floaters) {
    const u = 1 - Math.max(0, f.life) / f.maxLife;
    const pal = makePalette(f.color, 6);
    const big = /×3|CRIT|暴击|急救/.test(f.text) || f.text.length > 4;
    const size = big ? 22 : 17;
    const pop = ease.outBack(seg(u, 0, 0.18));
    const squash = Math.exp(-Math.pow((u - 0.18) / 0.07, 2));
    const s = 0.65 + 0.45 * pop;
    const sx = s * (1 + 0.22 * squash), sy = s * (1 - 0.20 * squash);
    const flash = 1 - smooth(0, 0.07, u);
    const a = 1 - smooth(0.62, 1, u);
    const col = mixColor(pal[4], '#ffffff', flash);
    softGlow(ctx, f.x, f.y, size * 1.5, col, 0.38 * a + 0.5 * flash);
    if (flash > 0.05) softStar(ctx, f.x, f.y, size * 0.9, '#ffffff', flash * 0.8);
    softText(ctx, f.text, f.x, f.y, size, col, { alpha: a, glow: 0.7, scaleX: sx, scaleY: sy });
  }
}

// ─────────────────────────────────────────────────────────────
// 四、自建实例池（升级 / 掉落道具）—— 逻辑层没有对应数据，由渲染层触发
// ─────────────────────────────────────────────────────────────

const LOOT_PAL = { coin: '#ffd257', shard: '#7fe0ff', gem: '#c79bff' };

export class SoftFx {
  constructor({ seed = 20261104, lootTarget = { x: 44, y: 22 } } = {}) {
    this.rng = new Rng(seed);
    this.items = [];
    this.lootTarget = lootTarget;
    this.prev = { level: null, killCount: null };
    this.t = 0;
  }

  reset() {
    this.items.length = 0;
    this.prev = { level: null, killCount: null };
    this.t = 0;
  }

  /** 由主循环按固定步长推进（毫秒）。 */
  update(dtMs) {
    this.t += dtMs;
    for (const it of this.items) it.t += dtMs;
    this.items = this.items.filter((it) => it.t < it.dur);
  }

  _spawn(kind, x, y, o = {}) {
    const seed = this.rng.int(1, 1e9);
    // kind 是 _drawItem 的分派键，必须放在 ...o 之后：否则 o 里的同名字段
    // （例如道具子类型 kind）会把它覆盖，实例会「生成了却静默不画」。
    this.items.push({ ...o, kind, x, y, t: 0, dur: o.dur ?? 1200, seed });
    if (this.items.length > 90) this.items.splice(0, this.items.length - 90); // 上限保护
  }

  levelUp(x, y, level) { this._spawn('levelUp', x, y, { dur: 2400, level }); }
  loot(x, y, kind = 'coin') { this._spawn('loot', x, y, { dur: 1200, lootKind: kind }); }
  poof(x, y, color = '#8fe08f') { this._spawn('poof', x, y, { dur: 760, color }); }

  /** 每帧侦测 world 变化来触发特效：只读，不写 world。 */
  syncWorld(world) {
    if (!world.started) { this.prev = { level: null, killCount: null }; return; }
    const lv = world.level, kc = world.killCount;
    if (this.prev.level !== null && lv > this.prev.level) {
      this.levelUp(world.player.x, world.player.y - 26, lv);
    }
    if (this.prev.killCount !== null && kc > this.prev.killCount) {
      const n = Math.min(3, kc - this.prev.killCount);
      // 击杀点：逻辑层 killEnemy 会 addRing，取最后一个环的坐标，避免改动逻辑层
      const last = world.rings[world.rings.length - 1];
      for (let i = 0; i < n; i++) {
        const x = last ? last.x + this.rng.range(-14, 14) : world.player.x + this.rng.range(-60, 60);
        const y = last ? last.y + this.rng.range(-10, 10) : world.player.y - this.rng.range(60, 160);
        this.loot(x, y, this.rng.pick(['coin', 'coin', 'shard', 'gem']));
      }
    }
    this.prev = { level: lv, killCount: kc };
  }

  /** 都在角色之后：地面光板、环的远半。 */
  drawBack(ctx) {
    for (const it of this.items) this._drawItem(ctx, it, 'back');
  }

  /** 都在最上层（含 HUD 之上）：光柱、文字、道具。 */
  drawFront(ctx) {
    for (const it of this.items) this._drawItem(ctx, it, 'front');
  }

  _drawItem(ctx, it, layer) {
    const u = clamp01(it.t / it.dur);
    const rng = new Rng(it.seed); // 每次从同一 seed 重放 → 绘制是纯函数，确定性
    if (it.kind === 'levelUp') return this._levelUp(ctx, it, u, rng, layer);
    if (it.kind === 'loot') return this._loot(ctx, it, u, rng, layer);
    if (it.kind === 'poof') return this._poof(ctx, it, u, rng, layer);
  }

  /** LEVEL UP：蓄力 → 白热闪光 → 光柱+上升环 → 逐字落下 → 星芒保持 → 消散。 */
  _levelUp(ctx, it, u, rng, layer) {
    const REL = 0.13, GONE = 0.52, TXT = 0.28;
    const pal = makePalette('#ffd257', 6);
    const fade = 1 - smooth(0.80, 1, u);
    const flash = 1 - smooth(REL, REL + 0.055, u);
    const { x, y } = it;

    if (layer === 'back') {
      const k = seg(u, 0, REL) * 0.7 + (u > REL ? 1 - smooth(GONE - 0.10, GONE + 0.15, u) : 0);
      softDisc(ctx, x, y, 34 + 18 * k, pal[4], 0.30 * fade, 0.28);
      softGlow(ctx, x, y, 70 * Math.max(0.3, k), pal[4], 0.22 * fade);
      if (u < REL) {
        const rr = 8 + 54 * (1 - ease.inQuad(seg(u, 0, REL))); // 蓄力：环向内收拢
        softRing(ctx, x, y, rr, 2.5, pal[4], 0.5 * fade, 0.30, [Math.PI, TAU]);
      }
      for (let i = 0; i < 3; i++) {                            // 上升环远半
        const h = u - REL - i * 0.07;
        if (h > 0 && h < 0.5) {
          softRing(ctx, x, y - 90 * h, 12 + 34 * h, 2, pal[4], 0.45 * (1 - h * 2) * fade, 0.30, [Math.PI, TAU]);
        }
      }
      return;
    }

    // 光柱：从脚底窜起，末端收回（对齐 pixelfx 的 column / plate）
    if (u > REL && u < GONE) {
      const k = 1 - smooth(GONE - 0.12, GONE, u);
      const top = y - 105 * ease.outExpo(seg(u, REL, REL + 0.12));
      const bot = y - 105 * ease.inQuad(seg(u, GONE - 0.14, GONE));
      const w = 10 + 6 * (1 - k);
      light(ctx, () => {
        const g = ctx.createLinearGradient(0, top, 0, bot);
        g.addColorStop(0, rgba(pal[5], 0));
        g.addColorStop(0.35, rgba(pal[4], 0.30 * k * fade));
        g.addColorStop(1, rgba(pal[5], 0.55 * k * fade));
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.moveTo(x - w, top); ctx.lineTo(x + w, top);
        ctx.lineTo(x + w * 1.4, bot); ctx.lineTo(x - w * 1.4, bot);
        ctx.closePath(); ctx.fill();
      });
      softCapsule(ctx, x, top, x, bot, 4, mixColor(pal[5], '#ffffff', 0.5), 0.5 * k * fade);
    }
    for (let i = 0; i < 3; i++) {                              // 上升环近半
      const h = u - REL - i * 0.07;
      if (h > 0 && h < 0.5) {
        softRing(ctx, x, y - 90 * h, 12 + 34 * h, 2.2, pal[5], 0.75 * (1 - h * 2) * fade, 0.30, [0, Math.PI]);
      }
    }
    if (flash > 0) {                                           // 白热 hero frame（1~2 帧强闪，但不过曝）
      softGlow(ctx, x, y - 20, 78, '#ffffff', 0.52 * flash);
      softStar(ctx, x, y - 16, 44, '#ffffff', flash * 0.85);
    }

    const chars = [...'LEVEL UP!'];                            // 逐字落下 + 落地挤压
    if (u > TXT) {
      const cw = 13;
      for (let i = 0; i < chars.length; i++) {
        const born = TXT + i * 0.035;
        if (u < born) continue;
        const d = seg(u, born, born + 0.14);
        const drop = (1 - ease.outBack(d)) * 26;
        const sq = Math.exp(-Math.pow((u - born - 0.14) / 0.05, 2));
        const ca = 1 - smooth(0.86, 1, u);
        const cx = x + (i - (chars.length - 1) / 2) * cw;
        softText(ctx, chars[i], cx, y - 62 - drop, 19,
          mixColor(pal[4], '#ffffff', 0.25 + 0.5 * (1 - d)),
          { alpha: ca, glow: 0.6, scaleX: 1 + 0.20 * sq, scaleY: 1 - 0.18 * sq });
      }
    }
    if (u > 0.42) softText(ctx, `Lv ${it.level}`, x, y - 34, 12, pal[5], { alpha: fade, glow: 0.4 });

    if (u > 0.45 && u < 0.82) {                                // 保持期星芒
      for (let i = 0; i < 5; i++) {
        const px = x + rng.range(-58, 58), py = y - 62 + rng.range(-18, 18);
        const tw = 0.5 + 0.5 * Math.sin(u * 22 + i * 2.1);
        softStar(ctx, px, py, 3 + 4 * tw, pal[5], 0.5 * tw * fade);
      }
    }
  }

  /** 掉落道具：闪白出现 → 悬浮旋转 → 拖尾飞向 HUD 分数 → 到达爆闪。 */
  _loot(ctx, it, u, rng, layer) {
    if (layer === 'back') return;
    const pal = makePalette(LOOT_PAL[it.lootKind] || LOOT_PAL.coin, 6);
    const appear = ease.outBack(seg(u, 0, 0.12));
    const a = (1 - smooth(0.88, 1, u)) * Math.max(0, appear);
    const spin = Math.abs(Math.cos(u * Math.PI * 3));           // 绕竖轴旋转
    const R = (it.lootKind === 'gem' ? 9 : 8) * Math.max(0, appear);
    let px = it.x, py = it.y;
    if (u < 0.42) {
      py = it.y - 8 * Math.sin(u * 8);
    } else {
      const k = ease.inOutSine(seg(u, 0.42, 0.88));
      px = lerp(it.x, this.lootTarget.x, k);
      py = lerp(it.y, this.lootTarget.y, k);
      softCapsule(ctx, px + 10, py + 6, px, py, 3, pal[4], 0.45 * a); // 飞行拖尾
    }
    if (u < 0.07) softGlow(ctx, px, py, R * 2.6, '#ffffff', 0.7 * (1 - u / 0.07));
    softGlow(ctx, px, py, R * 2.2, pal[4], 0.45 * a);

    if (it.lootKind === 'coin') {
      softDisc(ctx, px, py, R, pal[3], a);
      softRing(ctx, px, py, R * 0.62, 1.4, pal[5], a, 1);
      softStar(ctx, px, py, R * 0.42, '#fff8dc', 0.75 * a);
    } else if (it.lootKind === 'shard') {
      softPoly(ctx, px, py, [[0, -R], [R * 0.7, 0], [0, R * 0.85], [-R * 0.7, 0]], spin, pal[3], pal[5], a);
      softCapsule(ctx, px - R * 0.25, py - R * 0.4, px + R * 0.2, py + R * 0.35, 1, pal[5], 0.7 * a);
    } else {
      const pts = [];
      for (let i = 0; i < 6; i++) { const an = -Math.PI / 2 + i * TAU / 6; pts.push([Math.cos(an) * R, Math.sin(an) * R]); }
      softPoly(ctx, px, py, pts, spin, pal[3], pal[5], a);
      softCapsule(ctx, px - R * 0.6, py - R * 0.2, px + R * 0.6, py - R * 0.2, 1, pal[5], 0.8 * a);
      softCapsule(ctx, px, py - R * 0.7, px, py + R * 0.6, 1, pal[5], 0.6 * a);
    }
    if (u > 0.86) {                                            // 飞抵 HUD 的收集爆闪
      const k = 1 - smooth(0.86, 1, u);
      softStar(ctx, this.lootTarget.x, this.lootTarget.y, 14 * k, pal[5], k * 0.9);
    }
  }

  /** 敌人死亡柔烟（可选触发，柔边圆团上升消散）。 */
  _poof(ctx, it, u, rng, layer) {
    if (layer === 'back') return;
    const pal = makePalette(it.color, 6);
    const a = 1 - smooth(0.35, 1, u);
    for (let i = 0; i < 5; i++) {
      const an = rng.range(0, TAU), d = rng.range(4, 16) * (0.4 + u);
      const px = it.x + Math.cos(an) * d, py = it.y + Math.sin(an) * d - u * 22;
      softDisc(ctx, px, py, rng.range(6, 12) * (0.6 + u * 0.8), pal[2], 0.35 * a);
    }
    softGlow(ctx, it.x, it.y, 26, pal[4], 0.3 * a);
  }
}
