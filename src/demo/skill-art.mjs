// 9 个技能的「世界级美术」—— 概念图 skills.mjs 演出的 Canvas2D 移植版。
//
// 设计纪律（与概念区完全一致）：
//   · 每个技能是一段演出，统一四拍：出手 → 飞行/展开 → 命中 → 残留。
//   · 硬形体用 poly/rect/ellipse（a=1）；半透明只用 disc（真 blend）。
//   · 光一律走加色（glow/glowLine/glowRing/beam，globalCompositeOperation='lighter'）。
//   · 一个技能一个主色系 + 一个白核；地面元素压扁成椭圆（ry ≈ rx × 0.34）。
//
// 与概念区的唯一差别：p 后端从 pixelfx 帧换成 Canvas2D ctx，且演出按「世界实体」驱动
// （位置 / 朝向 / 尺寸 / 生命周期），而不是概念图里那个居中的自循环舞台。
// 这样视觉逐像素对齐概念图，又能正确贴合玩法（光束朝向、装甲车位置、刀轮圆心、落雷点）。

const TAU = Math.PI * 2;
const INK = '#080e14';
const WHITE = '#ffffff';

const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
const wrap = (v, m) => ((v % m) + m) % m;
const seg = (u, a, b) => clamp((u - a) / (b - a || 1e-9));
const lerp = (a, b, t) => a + (b - a) * t;
// 只移植本模块用得到的缓动；完整集合见概念区 pixel-lib.mjs
const ease = { outQuad: (t) => 1 - (1 - t) * (1 - t) };

// ── 主色系（显式 7 档，与概念区 EL 一致）──────────────────────────────
const R = (l) => l;
const EL = {
  fire:   R(['#1a0603', '#3d0d05', '#7a1e08', '#c43a0c', '#f2681a', '#ffa64a', '#fff0c8']),
  ice:    R(['#071a2e', '#0d3355', '#16618f', '#2a9bd4', '#66cdf0', '#b8ecff', '#f0feff']),
  volt:   R(['#0d0a24', '#1e1652', '#3a2c96', '#5f4ad6', '#8b7af0', '#c0b4ff', '#f2eeff']),
  steel:  R(['#0e1318', '#1a222b', '#2b3644', '#41505f', '#5d6e80', '#8b9aa8', '#c6cfd9']),
  olive:  R(['#161a0e', '#232a15', '#343d1d', '#4a5527', '#5f6d33', '#7a8a45', '#a3b268']),
  camp:   R(['#0f1209', '#191e0d', '#252c12', '#333d19', '#44511f', '#5a6a2b', '#7d8f3f']),
  track:  R(['#0a0b0d', '#15171a', '#23262b', '#34383e', '#474c54', '#5f656e', '#838a94']),
  chev:   R(['#3d2a00', '#6b4a05', '#9c6d0a', '#c99512', '#e8bf3a', '#ffe480', '#fffbd8']),
  cyan:   R(['#04161c', '#08303c', '#0d5566', '#158a9e', '#35c2d4', '#8ee8f2', '#e0feff']),
  laser:  R(['#1f1805', '#43350a', '#7a6110', '#b8911a', '#e8c23c', '#ffe680', '#fffce0']),
  chrome: R(['#0b0d10', '#1b1f24', '#2e343c', '#4a525c', '#6f7a86', '#a8b3bf', '#e8eef5']),
};
const COL = {
  redLight: '#ff8a6a', redDark: '#c8402e',
};

// 稳定伪随机（同帧重放一致）
const rnd = (i, s = 1) => { const x = Math.sin(i * 12.9898 + s * 78.233) * 43758.5453; return x - Math.floor(x); };

// ─────────────────────────────────────────────────────────────
// Canvas2D 版 p 画笔（签名与 pixel-lib 一致）
// ─────────────────────────────────────────────────────────────
class P {
  constructor(ctx) { this.c = ctx; }
  reset() { this.c.globalCompositeOperation = 'source-over'; this.c.globalAlpha = 1; }

  rect(x, y, w, h, col, a = 1) {
    const c = this.c; c.globalCompositeOperation = 'source-over'; c.globalAlpha = a;
    c.fillStyle = col; c.fillRect(x, y, w, h);
  }
  poly(pts, col, a = 1) {
    const c = this.c; c.globalCompositeOperation = 'source-over'; c.globalAlpha = a;
    c.fillStyle = col; c.beginPath();
    for (let i = 0; i < pts.length; i++) { const p = pts[i]; if (i) c.lineTo(p[0], p[1]); else c.moveTo(p[0], p[1]); }
    c.closePath(); c.fill();
  }
  line(x0, y0, x1, y1, col, a = 1) {
    const c = this.c; c.globalCompositeOperation = 'source-over'; c.globalAlpha = a;
    c.strokeStyle = col; c.lineWidth = 1; c.beginPath(); c.moveTo(x0, y0); c.lineTo(x1, y1); c.stroke();
  }
  dot(x, y, col, a = 1) { this.rect(x, y, 1, 1, col, a); }

  disc(x, y, r, col, a = 1) {
    const c = this.c; c.globalCompositeOperation = 'source-over'; c.globalAlpha = 1;
    const g = c.createRadialGradient(x, y, 0, x, y, Math.max(0.5, r));
    g.addColorStop(0, hexA(col, a)); g.addColorStop(1, hexA(col, 0));
    c.fillStyle = g; c.beginPath(); c.arc(x, y, Math.max(0.5, r), 0, TAU); c.fill();
  }
  ellipse(x, y, rx, ry, col, a = 1) {
    const c = this.c; c.globalCompositeOperation = 'source-over'; c.globalAlpha = a;
    c.fillStyle = col; c.beginPath(); c.ellipse(x, y, Math.max(0.5, rx), Math.max(0.5, ry), 0, 0, TAU); c.fill();
  }

  // 加色光系列：画完复位 composite，避免污染后续正常绘制
  glow(x, y, r, col, a = 1) {
    const c = this.c; c.globalCompositeOperation = 'lighter'; c.globalAlpha = 1;
    const g = c.createRadialGradient(x, y, 0, x, y, Math.max(0.5, r));
    g.addColorStop(0, hexA(col, a)); g.addColorStop(1, hexA(col, 0));
    c.fillStyle = g; c.beginPath(); c.arc(x, y, Math.max(0.5, r), 0, TAU); c.fill();
    c.globalCompositeOperation = 'source-over';
  }
  glowLine(x0, y0, x1, y1, w, col, a = 1) {
    const c = this.c; c.globalCompositeOperation = 'lighter'; c.globalAlpha = a;
    c.strokeStyle = col; c.lineWidth = w; c.lineCap = 'round';
    c.beginPath(); c.moveTo(x0, y0); c.lineTo(x1, y1); c.stroke();
    c.globalCompositeOperation = 'source-over';
  }
  glowRing(x, y, r, w, col, a = 1) {
    const c = this.c; c.globalCompositeOperation = 'lighter'; c.globalAlpha = a;
    c.strokeStyle = col; c.lineWidth = w; c.beginPath(); c.arc(x, y, Math.max(0.5, r), 0, TAU); c.stroke();
    c.globalCompositeOperation = 'source-over';
  }
  beam(x0, y0, x1, y1, w, col, a = 1) {
    const c = this.c; c.globalCompositeOperation = 'lighter'; c.globalAlpha = a;
    c.strokeStyle = col; c.lineCap = 'round';
    c.lineWidth = w * 1.6; c.beginPath(); c.moveTo(x0, y0); c.lineTo(x1, y1); c.stroke();
    c.lineWidth = w; c.beginPath(); c.moveTo(x0, y0); c.lineTo(x1, y1); c.stroke();
    c.globalCompositeOperation = 'source-over';
  }
}

function hexA(hex, a) {
  const h = hex.replace('#', '');
  const r = parseInt(h.substring(0, 2), 16), g = parseInt(h.substring(2, 4), 16), b = parseInt(h.substring(4, 6), 16);
  return `rgba(${r},${g},${b},${a})`;
}

// ─────────────────────────────────────────────────────────────
// 共用演出零件（移植自 skill-lib.mjs）
// ─────────────────────────────────────────────────────────────
const GROUND_K = 0.34;

// 地面椭圆环（俯视角地面语言）
function groundRing(p, cx, cy, rx, c, a = 1, thick = 1) {
  const ry = Math.max(2, rx * GROUND_K);
  for (let i = -Math.round(rx); i <= Math.round(rx); i++) {
    const k = i / rx;
    const y = Math.round(ry * Math.sqrt(Math.max(0, 1 - k * k)));
    for (let d = 0; d < thick; d++) { p.dot(cx + i, cy - y - d, c, a); p.dot(cx + i, cy + y + d, c, a); }
  }
}

// 火尾 / 能量尾
function trail(p, x, y, len, w, ramp, phase, o = {}) {
  const sway = o.sway ?? 0;
  for (let i = 0; i < len; i++) {
    const k = i / len;
    const taper = 1 - k * 0.92;
    const flick = 0.8 + 0.2 * Math.sin(phase * 16 + i * 1.1);
    const jitterW = 0.78 + 0.44 * rnd(i, 3);
    const jitterX = (rnd(i, 7) - 0.5) * 1.6;
    const ww = Math.max(1, w * taper * flick * jitterW);
    const xx = Math.round(x + Math.sin(phase * 6 + i * 0.5) * sway * k + jitterX * (0.3 + k));
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

// 注：概念区 skill-lib.mjs 还有 blast/smoke/embers/scorch（温压弹命中爆炸的残留演出）。
// demo 的命中反馈由 soft-fx 的 rings/particles 承担，这里只画弹体飞行段，故不移植那几件。
function arc(p, x0, y0, x1, y1, c, seed = 0, amp = 4) {
  const n = 6; let px = x0, py = y0;
  for (let i = 1; i <= n; i++) {
    const t = i / n;
    const jx = i === n ? 0 : (rnd(seed + i) - 0.5) * amp * 2;
    const nx = x0 + (x1 - x0) * t + jx;
    const ny = y0 + (y1 - y0) * t + (rnd(seed + i, 2) - 0.5) * amp;
    p.line(px, py, nx, ny, c, 1); px = nx; py = ny;
  }
}

// ═════════════════════════════════════════════════════════════
// 以下 9 段：世界级（按 world 实体驱动），视觉对齐概念图
// ═════════════════════════════════════════════════════════════

// 1 · 温压弹：弹头升空（火红拖尾）→ 接触即爆
export function drawSkillShots(ctx, world, time) {
  const p = new P(ctx);
  for (const s of world.skillShots) {
    // 逻辑层技能 id：freeze=干冰弹（冰系），burn=温压弹（火系）
    const isIce = s.id === 'freeze';
    const C = isIce ? EL.ice : EL.fire;
    const ang = Math.atan2(s.vy, s.vx);
    ctx.save(); ctx.translate(s.x, s.y); ctx.rotate(ang);
    const r = s.radius;
    // 拖尾
    trail(p, 0, r + 4, 22, 5, C, time * 3, { sway: 0 });
    if (isIce) {
      // 冰晶弹：菱形晶体
      p.poly([[0, -r - 4], [r * 0.6, -r], [0, r * 0.7], [-r * 0.6, -r]], C[4], 1);
      p.poly([[0, -r - 4], [-r * 0.6, -r], [0, -r]], C[6], 1);
      p.poly([[0, -r - 4], [r * 0.6, -r], [0, -r]], WHITE, 1);
      p.poly([[0, -r], [r * 0.6, -r], [0, r * 0.7]], C[3], 1);
      p.poly([[0, -r], [-r * 0.6, -r], [0, r * 0.7]], C[5], 1);
    } else {
      // 火弹：白尖 + 橙身 + 尾翼
      p.poly([[0, -r - 6], [r * 0.5, -r], [r * 0.5, r], [-r * 0.5, r], [-r * 0.5, -r]], C[5], 1);
      p.poly([[0, -r - 6], [r * 0.35, -r], [-r * 0.35, -r]], WHITE, 1);
      p.rect(-r * 0.6, r - 1, r * 1.2, 2, C[2], 1);
    }
    p.glow(0, 0, r * 2.2 + 6, C[4], 0.3);
    ctx.restore();
  }
  p.reset();
}

// 2/3/4 · 电磁天雷三件套：落雷 + 雷暴区 + 链式电弧
export function drawStrikes(ctx, world, time) {
  const p = new P(ctx); const C = EL.volt;
  for (const s of world.strikes) {
    const a = Math.max(0, s.life / s.maxLife);
    const w = s.minor ? 5 : 9;
    // 从屏幕顶劈下到落点
    const topY = s.y - 60;
    p.glowLine(s.x, topY, s.x, s.y, w, C[6], a * 0.3);
    arc(p, s.x, topY, s.x, s.y, C[6], 7, 7);
    arc(p, s.x, topY, s.x, s.y, WHITE, 16, 4);
    if (!s.minor) arc(p, s.x - 4, topY + 20, s.x - 10, s.y - 4, C[4], 3, 5);
    // 落点：贴地椭圆电环（概念图 thunder 的核心读法：扩散是压扁椭圆，不是悬空正圆）
    const k = 1 - Math.max(0, s.life / s.maxLife);
    if (k < 0.85) {
      const rx = 4 + s.radius * 0.42 * ease.outQuad(k);
      const col = k < 0.35 ? C[6] : k < 0.6 ? C[5] : C[3];
      groundRing(p, s.x, s.y, rx, col, a, k < 0.35 ? 2 : 1);
    }
    p.glow(s.x, s.y, s.radius * 1.2, C[4], 0.4 * a);
    p.ellipse(s.x, s.y, 4, 2.8, WHITE, a);
    p.dot(s.x, s.y, WHITE, a);
    // 余电闪点
    const rk = seg(wrap(time, 1.0), 0.0, 0.5);
    for (let i = 0; i < 3; i++) {
      if (rnd(i + Math.floor(time * 30), 6) < rk) continue;
      p.dot(Math.round(s.x + (rnd(i, 2) - 0.5) * 16), Math.round(s.y + (rnd(i, 3) - 0.5) * 8), C[5], a);
    }
  }
  p.reset();
}

export function drawStorms(ctx, world, time) {
  const p = new P(ctx); const C = EL.volt; const t = time;
  for (const s of world.storms) {
    const a = Math.max(0, s.life / s.maxLife);
    // 区域底色
    p.disc(s.x, s.y, s.r, C[3], 0.10 * a);
    // 呼吸虚线圈
    const pulse = 0.5 + 0.5 * Math.sin(t * 8);
    ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = (0.28 + 0.22 * pulse) * a;
    ctx.strokeStyle = C[4]; ctx.lineWidth = 2; ctx.setLineDash([6, 8]);
    ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, TAU); ctx.stroke();
    ctx.setLineDash([]); ctx.restore();
    // 雨丝
    ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 0.32 * a;
    ctx.strokeStyle = C[5]; ctx.lineWidth = 1; ctx.beginPath();
    for (let i = 0; i < 18; i++) {
      const dx = (((i * 73) % 100) / 100 * 2 - 1) * s.r;
      const half = Math.sqrt(Math.max(0, s.r * s.r - dx * dx));
      if (half <= 2) continue;
      const phase = ((i * 37) % 100) / 100;
      const py = s.y - half + ((phase + t * 1.7) % 1) * half * 2;
      const px = s.x + dx;
      ctx.moveTo(px, py); ctx.lineTo(px - 1.5, py + 9);
    }
    ctx.stroke(); ctx.restore();
  }
  p.reset();
}

export function drawArcs(ctx, world) {
  const p = new P(ctx); const C = EL.volt;
  for (const a of world.arcs) {
    const al = Math.max(0, a.life / a.maxLife);
    p.glowLine(a.pts[0].x, a.pts[0].y, a.pts[a.pts.length - 1].x, a.pts[a.pts.length - 1].y, 6, C[4], al * 0.35);
    // 折线芯
    for (let i = 0; i < a.pts.length - 1; i++) arc(p, a.pts[i].x, a.pts[i].y, a.pts[i + 1].x, a.pts[i + 1].y, WHITE, i + 1, 5);
    p.glow(a.pts[a.pts.length - 1].x, a.pts[a.pts.length - 1].y, 8, C[5], al * 0.5);
  }
  p.reset();
}

// 5 · 高能射线：发生器 + 脉冲光束 + 打点灼烧（按 world.beams）
export function drawBeams(ctx, world, time) {
  const p = new P(ctx); const C = EL.cyan;
  for (const b of world.beams) {
    // 演出时钟用「这道光束自己的存活时间」，不能用全局 world.time
    // （否则每 2.6s 整条光束会周期性熄灭，与实体生命周期脱节）
    const bt = (b.maxLife - b.life) / 1000;
    const fin = Math.min(1, bt / 0.18);                 // 发生器启动淡入
    const a = Math.max(0, b.life / b.maxLife) * fin;
    const tx = b.x + Math.cos(b.ang) * b.len, ty = b.y + Math.sin(b.ang) * b.len;
    const pulse = 0.55 + 0.45 * Math.max(0, Math.sin((bt / 0.42) * TAU));
    const w = (b.halfWidth * 2) * (0.6 + 0.4 * pulse);
    // 光束本体
    p.beam(b.x, b.y, tx, ty, w * 0.7, C[3], a * 0.5);
    p.beam(b.x, b.y, tx, ty, w * 0.4, C[5], a);
    p.beam(b.x, b.y, tx, ty, w * 0.14, C[6], a);
    p.beam(b.x, b.y, tx, ty, 1, WHITE, a);
    // 能量节点
    for (let i = 1; i < 4; i++) { const nx = lerp(b.x, tx, i / 4), ny = lerp(b.y, ty, i / 4); p.rect(nx - 2, ny - 1, 4, 2, C[6], a * (0.5 + 0.5 * pulse)); }
    // 发生器
    p.rect(b.x - 10, b.y - 5, 20, 10, EL.steel[2], a);
    p.rect(b.x - 10, b.y - 5, 20, 2, EL.steel[4], a);
    p.rect(b.x - 4, b.y - 2.5, 8, 5, C[3], a);
    p.rect(b.x - 3, b.y - 1.5, 6, 2, WHITE, 0.9 * a);
    p.glow(b.x, b.y, 14, C[4], 0.45 * a);
    // 打点灼烧
    p.disc(tx, ty, 6, C[6], 0.9 * a);
    p.glow(tx, ty, 16, C[5], 0.35 * a);
  }
  p.reset();
}

// 6 · 制导激光：窄扇面左右扫 + 扫痕 + 终点爆（按 world.sweeps）
//
// ⚠️ 坐标系纪律（2026-11-11 修复）：内核 `ang0` 是标准 atan2 角（0=+x，PI/2=+y），
// 命定判定用 dx=cos(ang), dy=sin(ang)。概念图那套「0=正上」的 x=sin/y=-cos 换算
// 整体差 90°，直接搬会让朝上的激光画成朝左/左下扫（用户看到的「往底部扫射」）。
// 扇面半角也必须直接取 s.halfAngle（判定同值），否则又变成「所见非所受」。
export function drawSweeps(ctx, world) {
  const p = new P(ctx); const C = EL.laser;
  for (const s of world.sweeps) {
    const a = Math.max(0, s.life / s.maxLife);
    const phase = Math.sin((s.t / 1000) * Math.PI * 1.1);   // 与内核扫动同相位
    const sweep = s.ang0 + phase * s.sweepAmp;
    const half = s.halfAngle;
    const tip = (ang, len) => [s.x + Math.cos(ang) * len, s.y + Math.sin(ang) * len];
    const [ex0, ey0] = tip(sweep - half, s.range), [ex1, ey1] = tip(sweep + half, s.range);
    const [ix0, iy0] = tip(sweep - half, s.range * 0.82), [ix1, iy1] = tip(sweep + half, s.range * 0.82);
    p.poly([[s.x, s.y], [ex0, ey0], [ex1, ey1]], C[2], a * 0.5);
    p.poly([[s.x, s.y], [ix0, iy0], [ix1, iy1]], C[3], a * 0.6);
    p.line(s.x, s.y, ex0, ey0, C[5], a);
    p.line(s.x, s.y, ex1, ey1, C[5], a);
    const [mx, my] = tip(sweep, s.range);
    p.line(s.x, s.y, mx, my, C[6], a);
    p.glowLine(s.x, s.y, mx, my, 6, C[4], 0.35 * a);
    // 发射器：跟着当前扫射角转（局部 -y = 炮口方向）
    ctx.save(); ctx.translate(s.x, s.y); ctx.rotate(sweep + Math.PI / 2);
    p.rect(-9, -4, 18, 9, EL.steel[2], a);
    p.rect(-9, -4, 18, 2, EL.steel[4], a);
    p.poly([[-5, 0], [5, 0], [3, -6], [-3, -6]], C[3], a);
    p.glow(0, 0, 12, C[4], 0.4 * a);
    ctx.restore();
    // 终点爆：扫到最左/最右端点时才出现（与扫动同相位，别用另一条 sin 曲线）
    if (Math.abs(phase) > 0.93) { p.disc(mx, my, 7, C[6], 0.8 * a); p.glow(mx, my, 14, C[5], 0.5 * a); }
  }
  p.reset();
}

// 7 · 哨戒机：底座炮塔 + 转塔锁敌 + 连点射（按 world.turrets + turretShots）
export function drawTurrets(ctx, world, time) {
  const p = new P(ctx); const C = EL.steel;
  for (const sh of world.turretShots) {
    const a = Math.max(0, sh.life / 120);
    p.glowLine(sh.x, sh.y, sh.tx, sh.ty, 2, '#cfe3ff', a * 0.9);
    if (a > 0.5) { p.disc(sh.tx, sh.ty, 4, WHITE, (a - 0.5) * 2); p.glow(sh.tx, sh.ty, 10, '#cfe3ff', 0.6 * (a - 0.5) * 2); }
  }
  for (const t of world.turrets) {
    const a = Math.min(1, t.life / 800);
    const aim = -1.5 + Math.sin(time * 4) * 0.8;
    p.ellipse(t.x, t.y + 2, 14 * (t.r / 18), 5 * (t.r / 18), INK, 0.4 * a);
    p.line(t.x - 2, t.y - 4, t.x - 11, t.y + 2, C[2], a);
    p.line(t.x + 2, t.y - 4, t.x + 11, t.y + 2, C[2], a);
    p.line(t.x, t.y - 4, t.x, t.y + 2, C[2], a);
    p.rect(t.x - 9, t.y - 10, 18, 7, C[3], a);
    p.rect(t.x - 9, t.y - 10, 18, 2, C[5], a);
    p.ellipse(t.x, t.y - 14, 9 * (t.r / 18), 8 * (t.r / 18), C[4], a);
    p.ellipse(t.x - 2, t.y - 16, 5 * (t.r / 18), 4 * (t.r / 18), C[5], a);
    const bx = Math.cos(aim), by = Math.sin(aim);
    for (const off of [-2.5, 2.5]) {
      p.line(t.x + off * 0.5, t.y - 14, t.x + bx * 16 + off * 0.5, t.y - 14 + by * 16, C[2], a);
      p.line(t.x + off * 0.5, t.y - 15, t.x + bx * 16 + off * 0.5, t.y - 15 + by * 16, C[5], a);
    }
    p.dot(t.x, t.y - 14, Math.sin(time * 12) > 0 ? COL.redLight : C[6], a);
  }
  p.reset();
}

// 8 · 燃烧地带已走 flame-sprites（概念图同源），这里不再重画。

// 9 · 旋转刀轮：巨型锯片横滚 + 火花（按 world.saws）
export function drawSaws(ctx, world, time) {
  const p = new P(ctx); const C = EL.chrome;
  for (const s of world.saws) {
    const Y = s.y;
    const a0 = s.spin * 14;
    const teeth = 12, rOut = s.r, rIn = s.r * 0.73;
    p.ellipse(s.x, Y + 1, 13, 4, INK, 0.35);
    for (let i = 0; i < teeth; i++) {
      const a = a0 + (i / teeth) * TAU;
      const a2 = a + (TAU / teeth) * 0.5;
      p.poly([
        [s.x + Math.cos(a) * rIn, Y + Math.sin(a) * rIn],
        [s.x + Math.cos(a - 0.10) * rOut, Y + Math.sin(a - 0.10) * rOut],
        [s.x + Math.cos(a + 0.10) * rOut, Y + Math.sin(a + 0.10) * rOut],
        [s.x + Math.cos(a2) * rIn, Y + Math.sin(a2) * rIn],
      ], C[5], 1);
      p.line(s.x + Math.cos(a) * rIn, Y + Math.sin(a) * rIn, s.x + Math.cos(a) * rOut, Y + Math.sin(a) * rOut, C[3], 1);
    }
    p.ellipse(s.x, Y, rIn, rIn, C[3], 1);
    p.ellipse(s.x - rIn * 0.25, Y - rIn * 0.25, rIn * 0.6, rIn * 0.5, C[4], 1);
    p.ellipse(s.x, Y, 3, 3, INK, 1);
    p.ellipse(s.x, Y, 1.6, 1.6, C[6], 1);
    p.glowRing(s.x, Y, rIn + 1.5, 1, C[4], 0.28);
    for (let i = 0; i < 9; i++) {
      const phh = (time * 3 + rnd(i)) % 1;
      const ang = rnd(i, 2) * TAU;
      const dist = 12 + phh * 22;
      p.dot(Math.round(s.x + Math.cos(ang) * dist), Math.round(Y + Math.sin(ang) * dist + phh * phh * 12), phh < 0.4 ? WHITE : C[5], 1 - phh);
    }
  }
  p.reset();
}

// 装甲车：方盒子 + 履带滚动 + 迷彩 + 黄色识别标（按 world.vehicles）
export function drawVehicles(ctx, world, time) {
  const p = new P(ctx);
  for (const v of world.vehicles) {
    if (v.ramp > 0) continue;
    const a = Math.min(1, v.life / 400);
    const heavy = v.heavy ?? (v.h > 60);
    const w = v.w, h = v.h;
    const x = v.x, y = v.y;
    const HW = w * 0.5, TW = w * 0.18, L = h;
    const top = -L / 2, bot = L / 2;   // 已在 translate(x,y)+rotate(π) 内，用局部坐标
    const OL = EL.olive, TR = EL.track, CV = EL.chev;
    const K = heavy ? 1.26 : 1.0;

    // 不翻转：实体 vy = -speed 向上碾，概念图的车头也在 top 侧，两者一致。
    ctx.save(); ctx.translate(x, y);
    // 地面投影
    p.ellipse(0, L / 2 + 2, w * 0.30, w * 0.10, INK, 0.42 * a);
    // 扬尘
    for (let i = 0; i < 6; i++) { const ph = (time * 1.2 + rnd(i)) % 1; p.disc((rnd(i, 2) - 0.5) * w * 0.65, bot0(L) + 1 + ph * 9, 2.5 + ph * 3.5, '#5d543c', 0.26 * (1 - ph) * a); }
    // 履带
    const scroll = (time * 16) % 6;
    for (const s of [-1, 1]) {
      const tx = s * (HW / 2 + TW / 2);
      p.rect(tx - TW / 2, top + 1, TW, L - 2, TR[2], a);
      p.rect(tx - TW / 2, top + 1, 2, L - 2, TR[3], a);
      p.rect(tx + TW / 2 - 1, top + 1, 1, L - 2, TR[1], a);
      for (let i = -1; i < Math.ceil(L / 6) + 1; i++) {
        const yy = Math.round(top + 3 + i * 6 + scroll);
        if (yy > top + 2 && yy < bot - 2) p.rect(tx - TW / 2 + 1, yy, TW - 1, 2, TR[1], a);
      }
      p.rect(tx - TW / 2, top + 1, TW, 1, TR[4], a);
    }
    // 车体
    p.rect(-HW / 2, top + 3, HW, L - 6, OL[3], a);
    p.rect(-HW / 2, top + 3, 3, L - 6, OL[4], a);
    p.rect(HW / 2 - 2, top + 3, 2, L - 6, OL[2], a);
    const camo = [[-6, -10, 5, 3], [5, -4, 4, 3], [-3, 6, 5, 3], [6, 11, 3, 2], [-8, 14, 3, 2]];
    for (const [dx, dy, rx, ry] of camo) p.ellipse(dx * K, dy * K, rx * K, ry * K, EL.camp[3], a);
    p.rect(-HW / 2 + 3, top + 5, HW - 6, L * 0.52, OL[5], a);
    p.rect(-HW / 2 + 3, top + 5, HW - 6, 1, OL[6], a);
    p.poly([[-HW / 2, top + 6], [-HW / 2 + 3, top + 1], [HW / 2 - 3, top + 1], [HW / 2, top + 6]], OL[4], a);
    p.rect(-6 * K, top + 4, 12 * K, 2, EL.camp[0], a);
    for (const s2 of [-1, 1]) { p.rect(s2 * 7 * K - 2, top + 7, 5, 5, OL[2], a); p.rect(s2 * 7 * K - 2, top + 7, 5, 1, OL[6], a); }
    p.rect(-9 * K, top + 15 * K, 4, 10 * K, CV[4], a);
    p.rect(-9 * K, top + 15 * K, 1, 10 * K, CV[6], a);
    p.rect(-HW / 2, bot - 7, HW, 7, OL[2], a);
    p.rect(-HW / 2, bot - 7, HW, 1, OL[1], a);
    for (const s of [-1, 1]) { p.rect(s * 6 * K - 1, bot - 5, 3, 2, COL.redDark, a); p.dot(s * 6 * K, bot - 5, COL.redLight, a); }
    for (let i = 0; i < 2; i++) { const cy3 = Math.round(bot - 6 - i * 3); p.poly([[-4 * K, cy3], [0, cy3 - 3], [4 * K, cy3], [4 * K, cy3 + 1], [0, cy3 - 2], [-4 * K, cy3 + 1]], CV[4], a); }
    p.rect(-HW / 2 - 2, bot - 2, HW + 4, 3, TR[3], a);
    if (heavy) {
      for (const s of [-1, 1]) for (let i = 0; i < 3; i++) { const by = top + 6 + i * ((L - 14) / 3); p.rect(s * (HW / 2 + 1) - (s > 0 ? 4 : 0), by, 4, 7, EL.camp[2], a); p.rect(s * (HW / 2 + 1) - (s > 0 ? 4 : 0), by, 4, 1, OL[4], a); }
      p.rect(-6, top + 2, 12, 3, TR[4], a); p.rect(-1, top - 4, 2, 7, TR[3], a);
    }
    // 车头撞角（亮黄警示条在行进方向 front = top 侧）
    p.rect(-HW / 2 + 2, top + 1, HW - 4, 3, CV[4], a);
    ctx.restore();
  }
  p.reset();
}
function bot0(L) { return L / 2; } // 占位（扬尘在车后，旋转后已处理）
