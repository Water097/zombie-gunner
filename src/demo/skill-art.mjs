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
export class P {
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
/**
 * 折线辉光：逐段 glowLine，整条是**折的**，不是一条直线。
 * 用来替代「笔直的粗辉光柱」—— 后者会被读成激光/发射源（用户明确要求去掉那根白线）。
 */
function boltGlow(p, x0, y0, x1, y1, col, w, a, seed, amp) {
  const n = 7;
  let px = x0, py = y0;
  for (let i = 1; i <= n; i++) {
    const t = i / n;
    const jx = i === n ? 0 : (rnd(seed + i) - 0.5) * amp * 2;
    const nx = x0 + (x1 - x0) * t + jx;
    const ny = y0 + (y1 - y0) * t + (rnd(seed + i, 2) - 0.5) * amp * 0.6;
    p.glowLine(px, py, nx, ny, w, col, a);
    px = nx; py = ny;
  }
}

/** 子弹头（ogive）：尖端用 pow 次曲线平滑过渡到弹体全宽，是圆弧锥，不是圆球也不是直边三角。 */
function ogive(p, tip, shoulder, bw, col, pow, side = 0) {
  const N = 6, pts = [[0, tip]];
  const s = side || 1;
  for (let i = 1; i <= N; i++) {
    const t = i / N;
    pts.push([s * bw * Math.pow(t, pow), tip + (shoulder - tip) * t]);
  }
  if (!side) {
    for (let i = N; i >= 1; i--) {
      const t = i / N;
      pts.push([-bw * Math.pow(t, pow), tip + (shoulder - tip) * t]);
    }
  } else {
    pts.push([0, shoulder]);
  }
  p.poly(pts, col, 1);
}

// 1 · 干冰弹 / 温压弹 —— 严格照参考图（2026-11-12 二次修正）
//   ✅ 圆柱弹体（四层明暗）＋ 子弹头 ogive ＋ 后部小尾翼 ＋ 尾喷口 ＋ 向后喷的尾焰
//   ✅ 温压 = 深灰钢弹体 + 橙红子弹头 +「只有一点点」的小尾翼
//   ✅ 干冰 = 冰蓝弹体 + 白色尖锥子弹头 + 两侧稍大的三角尾翼
//   ❌ 不加任何漂浮在弹体旁的雪花 / 火焰三角：那是**图标背景装饰**，搬到游戏里
//      就变成「跟着弹体飞」，不符合物理（用户明确指出）。
// 局部 -y = 弹头；rotate(ang + π/2) 把弹头贴到速度方向。
export function drawSkillShots(ctx, world, time) {
  const p = new P(ctx);
  for (const s of world.skillShots) {
    const isIce = s.id === 'freeze';
    const C = isIce ? EL.ice : EL.fire;
    const M = isIce ? EL.ice : EL.steel;
    const ang = Math.atan2(s.vy, s.vx);
    ctx.save(); ctx.translate(s.x, s.y); ctx.rotate(ang + Math.PI / 2);
    const r = Math.max(5, s.radius);
    const bw = r * 0.82;
    const tip = -r * 2.7;
    const shoulder = -r * 0.9;
    const bodyEnd = r * 1.3;
    const tail = r * 1.7;

    // ── 尾焰：唯一在弹体外的东西，从喷口向后喷（物理上合理）──
    trail(p, 0, tail + 1, 18, isIce ? 3 : 4.2, C, time * 3, { sway: 0 });

    // ── 后部小尾翼，都贴着弹体；温压只露出一点点 ──
    const fin = isIce ? r * 0.62 : r * 0.28;
    const finC = isIce ? C[3] : EL.steel[2], finHi = isIce ? C[5] : C[4];
    p.poly([[-bw, bodyEnd - 3], [-bw - fin, tail], [-bw, tail]], finC, 1);
    p.poly([[bw, bodyEnd - 3], [bw + fin, tail], [bw, tail]], finC, 1);
    p.poly([[-bw, bodyEnd - 3], [-bw - fin * 0.55, tail], [-bw, tail]], finHi, 1);
    p.poly([[bw, bodyEnd - 3], [bw + fin * 0.55, tail], [bw, tail]], finHi, 1);

    // ── 尾喷口 ──
    p.rect(-bw * 0.7, bodyEnd, bw * 1.4, 3, C[2], 1);
    p.rect(-bw * 0.4, bodyEnd + 1, bw * 0.8, 1.5, isIce ? C[6] : WHITE, 1);

    // ── 圆柱弹体：左受光 / 右压暗 / 中央高光 ──
    const bodyH = bodyEnd - shoulder;
    p.rect(-bw, shoulder, bw * 2, bodyH, M[2], 1);
    p.rect(-bw, shoulder, bw * 0.65, bodyH, M[4], 1);
    p.rect(bw * 0.5, shoulder, bw * 0.5, bodyH, M[1], 1);
    p.rect(-bw * 0.18, shoulder, bw * 0.3, bodyH, M[5], 1);
    p.rect(-bw, shoulder + bodyH * 0.46, bw * 2, 2, C[4], 1);   // 识别环带

    // ── 子弹头：干冰更尖 (0.68)，温压稍圆润 (0.45)，两者都不是圆球 ──
    const pow = isIce ? 0.68 : 0.45;
    ogive(p, tip, shoulder, bw, C[4], pow);
    ogive(p, tip, shoulder, bw, isIce ? C[6] : C[5], pow, -1);   // 左受光面
    p.line(0, tip + 1, 0, shoulder, isIce ? WHITE : C[6], 0.75); // 中央棱线
    p.dot(0, tip + 1, WHITE, 1);                                  // 尖端白核
    p.glow(0, tip + r * 0.9, r * 1.2, C[5], 0.30);
    ctx.restore();
  }
  p.reset();
}

// 2/3/4 · 电磁天雷三件套：落雷 + 雷暴区 + 链式电弧
//
// 落雷是**一段快速演出**，不是一张挂在那儿渐隐的静图（2026-11-12 修「闪电不动」）：
//   ① 闪现渐显(0~0.18)  积云 + 顶端微光
//   ② 落雷(0.18~0.42)   折线从云底向下「生长」，逐帧抖动，末端击中落点
//   ③ 命中(0.42~0.72)   白核 + 贴地椭圆电环扩散 + 爬电
//   ④ 消失(0.72~1)      闪电淡出、电环收掉、余电闪点熄灭
// 进度 k 取自实例自身 life/maxLife，所以实机 280ms 就是「快」，实验室拉长即可逐拍看清；
// 折线 seed 用逐帧变化的数，闪电才会「闪」，固定 seed 会画成一条不动的折线。
export function drawStrikes(ctx, world, time) {
  const p = new P(ctx); const C = EL.volt;
  const frame = Math.floor(time * 60);
  for (const s of world.strikes) {
    const k = clamp(1 - s.life / s.maxLife);          // 0→1 演出进度
    const GY = s.y, topY = GY - (s.minor ? 44 : 60);
    const w = s.minor ? 5 : 9;

    // ① 闪现渐显
    const cloud = seg(k, 0, 0.10) * (1 - seg(k, 0.30, 0.55));
    if (cloud > 0.02) {
      for (const [dx, dy, r] of [[-14, -6, 8], [0, -10, 11], [13, -7, 8]]) {
        p.disc(s.x + dx, topY + dy, r * (0.5 + 0.5 * cloud), C[1], 0.55 * cloud);
      }
      p.glow(s.x, topY - 4, s.minor ? 12 : 22, C[4], 0.10 + 0.30 * cloud);
    }

    // ② 落雷：三层**折线辉光**，从云底长到落点，逐帧抖动。
    // ⚠️ 2026-11-12 删掉笔直的 glowLine 光柱 + amp 仅 3.2 的近直线白色 arc：
    //    那两样叠起来会被读成「从发射源射下来的一道白线 / 激光」，用户明确不要。
    const boltK = seg(k, 0.18, 0.42);
    if (boltK > 0 && k < 0.80) {
      const endY = lerp(topY, GY, ease.outQuad(boltK));
      const fade = 1 - seg(k, 0.58, 0.80);
      const amp = s.minor ? 8 : 13;
      boltGlow(p, s.x, topY, s.x, endY, C[4], w, 0.26 * fade, frame, amp);
      boltGlow(p, s.x, topY, s.x, endY, C[6], w * 0.45, 0.65 * fade, frame + 7, amp * 0.8);
      // 内芯也用电紫，不用 WHITE —— 任何白色长折线都会被读成「一根白线」
      boltGlow(p, s.x, topY, s.x, endY, C[5], 1.6, 0.70 * fade, frame + 15, amp * 0.6);
      if (!s.minor) {
        boltGlow(p, s.x - 3, topY + (endY - topY) * 0.55, s.x - 10, Math.min(GY, endY + 12), C[4], 2, 0.5 * fade, frame + 3, 6);
        boltGlow(p, s.x + 3, topY + (endY - topY) * 0.70, s.x + 9, Math.min(GY, endY + 10), C[4], 2, 0.5 * fade, frame + 5, 6);
      }
    }

    // ③ 命中：白核 + 贴地椭圆电环 + 爬电
    if (k >= 0.42) {
      const hit = seg(k, 0.42, 0.72);
      if (hit < 0.5) { const cr = 5 * (1 - hit / 0.5) + 1; p.ellipse(s.x, GY, cr * 1.2, cr * 0.7, WHITE, 1 - hit / 0.5); }
      p.glow(s.x, GY, 24 * (1 - hit * 0.6), C[4], 0.45 * (1 - hit));
      if (hit < 0.85) {
        const rx = 4 + s.radius * 0.42 * ease.outQuad(hit);
        const col = hit < 0.35 ? C[6] : hit < 0.6 ? C[5] : C[3];
        groundRing(p, s.x, GY, rx, col, 1 - hit, hit < 0.35 ? 2 : 1);
        if (hit < 0.6) {
          for (let i = 0; i < 5; i++) {
            const ang = (i / 5) * TAU + 0.6, r0 = rx * 0.55, r1 = rx * 0.98;
            arc(p,
              s.x + Math.cos(ang) * r0, GY + Math.sin(ang) * r0 * GROUND_K,
              s.x + Math.cos(ang) * r1, GY + Math.sin(ang) * r1 * GROUND_K,
              C[5], frame + i * 13, 1.5);
          }
        }
      }
    }

    // ④ 余电闪点（逐帧闪，逐渐熄灭）
    if (k > 0.55) {
      const fade = 1 - seg(k, 0.72, 1);
      for (let i = 0; i < 3; i++) {
        if (rnd(i + frame, 6) > fade) continue;
        p.dot(Math.round(s.x + (rnd(i + frame, 2) - 0.5) * 16), Math.round(GY + (rnd(i + frame, 3) - 0.5) * 8), C[5], fade);
      }
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
    // ⚠️ 2026-11-12：删掉白色内芯 arc(..., WHITE, ...) —— 截图红框里那根
    //    「从落点往右下延伸的白色折线」就是它。现在整条电弧都是同色系紫色折线，
    //    端点只留一个白色**闪点**（点，不是线）。
    for (let i = 0; i < a.pts.length - 1; i++) {
      const x0 = a.pts[i].x, y0 = a.pts[i].y, x1 = a.pts[i + 1].x, y1 = a.pts[i + 1].y;
      boltGlow(p, x0, y0, x1, y1, C[3], 6, al * 0.28, i * 11 + 3, 8);
      boltGlow(p, x0, y0, x1, y1, C[5], 2.5, al * 0.60, i * 7 + 1, 6);
    }
    const last = a.pts[a.pts.length - 1];
    p.glow(last.x, last.y, 8, C[5], al * 0.5);
    p.dot(last.x, last.y, WHITE, al * 0.8);
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
// 枪口方向由「当前射击目标」决定（turretShots 的 tx/ty，或最近敌人），
// 不再用全局 time 左右摆 —— 用户反馈「摆来摆去」的根因。
// 形态 B「浮空哨戒无人机」（2026-11-12 用户从 4 个候选中选定）。
// 这两层是**唯一实现**：drawTurrets() 与候选页 turret-options.html 都调它，不存在第二套画法。
// base = 不随枪口旋转（地面影 / 推进光 / 能量翼）；head = 随 aim 旋转（环体 / 独眼 / 炮口 / 光束）。
export function drawDroneBase(p, t, a = 1) {
  const C = EL.cyan;
  const bob = Math.round(Math.sin(t * 3) * 2);
  p.ellipse(0, 37, 16, 4, INK, 0.28 * a);
  p.glow(0, 22, 16, C[4], (0.16 + 0.06 * Math.sin(t * 5)) * a);
  for (const s of [-1, 1]) {
    p.poly([[s * 10, -6 + bob], [s * 27, -13 + bob], [s * 31, -5 + bob], [s * 12, 2 + bob]], C[3], a);
    p.poly([[s * 12, -5 + bob], [s * 27, -12 + bob], [s * 27, -10 + bob], [s * 12, -3 + bob]], C[5], a);
    p.glowLine(s * 14, -6 + bob, s * 28, -11 + bob, 2, C[6], 0.45 * a);
  }
}
export function drawDroneHead(p, t, fire, a = 1) {
  const C = EL.cyan;
  const ch = fire > 0 && fire < 0.3 ? 1 - fire / 0.3 : 0.3 + 0.2 * Math.sin(t * 4);
  p.ellipse(0, -6, 13, 12, C[2], a);
  p.ellipse(0, -6, 10, 9, C[4], a);
  p.ellipse(0, -6, 7, 6, C[1], a);
  p.ellipse(0, -6, 4, 4, WHITE, (0.4 + 0.6 * ch) * a);
  p.glow(0, -6, 10 + 4 * ch, C[6], (0.25 + 0.4 * ch) * a);
  p.rect(-3, -20, 6, 5, C[3], a);
  p.rect(-2, -21, 4, 2, C[5], a);
  if (fire > 0 && fire < 0.2) {
    const k = 1 - fire / 0.2;
    p.beam(0, -20, 0, -54, 3, C[6], k * 0.8 * a);
    p.glow(0, -20, 8, WHITE, 0.5 * k * a);
  }
}

/** 枪口目标 + 开火相位。优先 turretShots，其次最近敌人；无目标朝上待机。 */
function turretTarget(world, t) {
  const my = t.y - 14;                         // 炮塔轴心
  let best = null, bd = Infinity;
  for (const sh of world.turretShots || []) {
    const d = Math.hypot(sh.x - t.x, sh.y - t.y);
    if (d < bd) { bd = d; best = sh; }
  }
  if (best && bd < 90 && Number.isFinite(best.tx)) {
    // 把 shot.life(120→0) 映射成候选形态的 fire(0→0.3) 演出进度
    const fire = 0.02 + 0.28 * (1 - Math.max(0, Math.min(1, best.life / 120)));
    return { aim: Math.atan2(best.ty - my, best.tx - t.x), fire };
  }
  let foe = null, fd = Infinity;
  for (const e of world.enemies || []) {
    if (!e.alive) continue;
    const d = Math.hypot(e.x - t.x, e.y - my);
    if (d < fd) { fd = d; foe = e; }
  }
  return { aim: foe ? Math.atan2(foe.y - my, foe.x - t.x) : -Math.PI / 2, fire: 0 };
}

export function drawTurrets(ctx, world, time) {
  const p = new P(ctx); const C = EL.cyan;
  // 弹道：青白能量束 + 命中火花（与无人机独眼/光束同一套语言）
  for (const sh of world.turretShots) {
    const a = Math.max(0, sh.life / 120);
    const ang = Math.atan2(sh.ty - sh.y, sh.tx - sh.x);
    const sx = sh.x + Math.cos(ang) * 16, sy = sh.y + Math.sin(ang) * 16;
    p.beam(sx, sy, sh.tx, sh.ty, 3, C[5], a * 0.7);
    p.beam(sx, sy, sh.tx, sh.ty, 1, WHITE, a * 0.9);
    p.disc(sh.tx, sh.ty, 4, WHITE, a * 0.9);
    p.glow(sh.tx, sh.ty, 10, C[6], 0.6 * a);
  }
  for (const t of world.turrets) {
    const a = Math.min(1, t.life / 800);
    const { aim, fire } = turretTarget(world, t);
    const sc = Math.max(0.6, Math.min(2, (t.r || 12) / 12));
    // 局部原点 = 炮塔轴心；head 用 rotate(aim + π/2) 把局部 -y 精确指向目标
    ctx.save(); ctx.translate(t.x, t.y - 14); ctx.scale(sc, sc);
    drawDroneBase(p, time, a);
    ctx.save(); ctx.rotate(aim + Math.PI / 2);
    drawDroneHead(p, time, fire, a);
    ctx.restore(); ctx.restore();
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
