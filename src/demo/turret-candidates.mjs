// 哨戒机形态候选（2026-11-12）—— 4 个方案，都是「枪口固定对准目标」的版本。
//
// 拆两层：base = 不随枪口旋转的底座/地面投影；head = 随 aim 旋转的炮塔与炮管。
// 所有形态的枪口都画在局部 -y，配合 rotate(aim + π/2) 精确指向目标，不做时间摆动。
// fire = 0..1 射击相位（0~0.3 为开火瞬间），只用来做后坐 / 枪口焰 / 充能，不改变朝向。

import { P, drawDroneBase, drawDroneHead } from './skill-art.mjs';

const ST = ['#0e1318', '#1a222b', '#2b3644', '#41505f', '#5d6e80', '#8b9aa8', '#c6cfd9'];
const CY = ['#04161c', '#08303c', '#0d5566', '#158a9e', '#35c2d4', '#8ee8f2', '#e0feff'];
const VI = ['#0d0a24', '#1e1652', '#3a2c96', '#5f4ad6', '#8b7af0', '#c0b4ff', '#f2eeff'];
const GD = ['#1f1805', '#43350a', '#7a6110', '#b8911a', '#e8c23c', '#ffe680', '#fffce0'];
const OL = ['#161a0e', '#232a15', '#343d1d', '#4a5527', '#5f6d33', '#7a8a45', '#a3b268'];
const INK = '#080e14', WHITE = '#ffffff';
const TAU = Math.PI * 2;

// ── A · 双管机炮塔（军用硬派）──────────────────────────────
function aBase(p) {
  p.ellipse(0, 36, 22, 6, INK, 0.42);
  p.poly([[-18, 28], [18, 28], [22, 34], [-22, 34]], ST[2], 1);
  p.poly([[-16, 24], [16, 24], [18, 28], [-18, 28]], ST[4], 1);
  p.rect(-16, 26, 32, 2, ST[5], 1);
  p.rect(-4, 12, 8, 12, ST[3], 1); p.rect(-4, 12, 2, 12, ST[5], 1);
  p.rect(-27, 15, 11, 13, ST[2], 1); p.rect(-27, 15, 11, 2, ST[4], 1);
  for (let i = 0; i < 3; i++) p.dot(-24 + i * 3, 21, GD[4], 1);
  for (const x of [-14, 14]) p.dot(x, 30, ST[5], 1);
}
function aHead(p, t, fire) {
  const rc = fire > 0 && fire < 0.25 ? 3 * (1 - fire / 0.25) : 0;
  p.poly([[-13, -4], [13, -4], [10, -16], [-10, -16]], ST[3], 1);
  p.poly([[-13, -4], [13, -4], [13, -1], [-13, -1]], ST[2], 1);
  p.poly([[-10, -16], [10, -16], [8, -18], [-8, -18]], ST[5], 1);
  p.rect(-11, -12, 22, 2, ST[1], 1);
  for (const off of [-4, 4]) {
    p.rect(off - 2, -34 + rc, 4, 20, ST[2], 1);
    p.rect(off - 2, -34 + rc, 1, 20, ST[5], 1);
    p.rect(off - 2.5, -28 + rc, 5, 2, ST[4], 1);
    p.rect(off - 2.5, -23 + rc, 5, 2, ST[4], 1);
    p.rect(off - 1.5, -36 + rc, 3, 3, ST[5], 1);
  }
  p.dot(0, -10, CY[5], 1); p.glow(0, -10, 6, CY[4], 0.30);
  if (fire > 0 && fire < 0.18) {
    const a = 1 - fire / 0.18;
    for (const off of [-4, 4]) {
      p.poly([[off - 3, -36 + rc], [off, -46 + rc], [off + 3, -36 + rc]], GD[5], a);
      p.glow(off, -38 + rc, 8, GD[5], 0.5 * a);
    }
  }
}

// ── B · 浮空哨戒无人机（科幻）── 用户已选定，实现已定稿到 skill-art.mjs ──
// 这里直接复用导出的 drawDroneBase / drawDroneHead，不再复制一份画法。

// ── C · 棱镜激光塔（能量）──────────────────────────────────
function cBase(p, t) {
  p.ellipse(0, 36, 20, 6, INK, 0.40);
  p.poly([[-16, 30], [16, 30], [0, -6]], VI[2], 1);
  p.poly([[-16, 30], [0, -6], [0, 30]], VI[4], 1);
  p.poly([[16, 30], [0, -6], [6, 30]], VI[1], 1);
  p.line(0, -6, 0, 30, VI[5], 1);
  for (let i = 0; i < 4; i++) { const y = 10 + i * 5; p.line(-8 + i, y, 8 - i, y, VI[4], 0.6); }
  const a = t * 1.5;
  for (let i = 0; i < 8; i++) {
    const ang = a + (i * TAU) / 8;
    p.dot(Math.round(Math.cos(ang) * 20), Math.round(-8 + Math.sin(ang) * 7), GD[5], 0.8);
  }
  p.glowRing(0, -8, 20, 1, VI[5], 0.25);
}
function cHead(p, t, fire) {
  const bob = Math.round(Math.sin(t * 2) * 2);
  p.poly([[0, -30 + bob], [8, -18 + bob], [0, -12 + bob], [-8, -18 + bob]], GD[4], 1);
  p.poly([[0, -30 + bob], [0, -12 + bob], [-8, -18 + bob]], GD[6], 1);
  p.glow(0, -20 + bob, 14, GD[5], 0.30 + 0.2 * Math.sin(t * 4));
  if (fire > 0 && fire < 0.22) {
    const a = 1 - fire / 0.22;
    p.beam(0, -26 + bob, 0, -60, 2, GD[6], a);
    p.beam(0, -26 + bob, 0, -60, 0.8, WHITE, a);
    p.glow(0, -26 + bob, 10, WHITE, 0.6 * a);
  }
}

// ── D · 重炮炮台（厚重）────────────────────────────────────
function dBase(p) {
  p.ellipse(0, 36, 24, 7, INK, 0.42);
  for (const s of [-1, 1]) {
    p.line(s * 10, 20, s * 20, 34, ST[3], 1);
    p.line(s * 10, 21, s * 20, 35, ST[5], 1);
    p.rect(s * 20 - 2, 32, 4, 4, ST[4], 1);
  }
  p.rect(-15, 8, 30, 20, OL[3], 1);
  p.rect(-15, 8, 30, 2, OL[5], 1);
  p.rect(-15, 8, 3, 20, OL[5], 1);
  p.rect(12, 8, 3, 20, OL[1], 1);
  p.poly([[-15, 8], [-11, 3], [11, 3], [15, 8]], OL[4], 1);
  for (const x of [-11, 11]) for (const y of [12, 22]) p.dot(x, y, ST[5], 1);
}
function dHead(p, t, fire) {
  const rc = fire > 0 && fire < 0.25 ? 4 * (1 - fire / 0.25) : 0;
  p.ellipse(0, 0, 11, 7, OL[4], 1);
  p.ellipse(0, -1, 8, 5, OL[5], 1);
  p.rect(-5, -30 + rc, 10, 30, ST[2], 1);
  p.rect(-5, -30 + rc, 2, 30, ST[4], 1);
  p.rect(3, -30 + rc, 2, 30, ST[1], 1);
  p.rect(-7, -34 + rc, 14, 5, ST[3], 1);
  p.rect(-7, -34 + rc, 14, 1, ST[5], 1);
  for (const y of [-32, -30]) p.rect(-7, y + rc, 14, 1, INK, 0.8);
  if (fire > 0 && fire < 0.35) {
    const a = 1 - fire / 0.35;
    p.disc(-9, -36 + rc, 7 * a + 3, '#6b6357', 0.35 * a);
    p.disc(9, -38 + rc, 6 * a + 2, '#6b6357', 0.30 * a);
    p.glowRing(0, -34 + rc, 10 + 10 * fire, 2, GD[5], 0.4 * a);
    p.poly([[-6, -34 + rc], [0, -48 + rc], [6, -34 + rc]], GD[6], 0.8 * a);
  }
}

export const CANDIDATES = [
  {
    id: 'A', name: '双管机炮塔', style: '军用硬派 · 最贴参考',
    read: '六边形装甲底座 + 低矮炮塔 + 双联炮管 + 侧面弹链箱；开火时炮管后坐、枪口双焰。',
    pros: ['剪影最厚实，容易一眼认出「炮台」', '双管 + 散热环把「连点射」画出来了', '冷钢色阶与装甲车同一套语言'],
    base: aBase, head: aHead,
  },
  {
    id: 'B', name: '浮空哨戒无人机', style: '科幻 · 最轻最灵',
    read: '环形悬浮主体 + 中央独眼 + 两侧能量翼 + 底部推进光；开火时独眼充能并射出细光束。',
    pros: ['和「地面炮台」彻底拉开差异', '独眼 = 锁敌读得最清楚', '浮空 + 呼吸光最有高级感'],
    base: drawDroneBase, head: drawDroneHead,
  },
  {
    id: 'C', name: '棱镜激光塔', style: '能量 · 最抢眼',
    read: '三棱锥塔身 + 悬浮棱镜 + 旋转蓄能环 + 电路纹；开火时棱镜爆闪打出一道细激光。',
    pros: ['竖向剪影，和光束类技能不撞型', '旋转蓄能环自带「一直在工作」的动感', '紫金配色在暗背景里最跳'],
    base: cBase, head: cHead,
  },
  {
    id: 'D', name: '重炮炮台', style: '厚重 · 最有分量',
    read: '方形装甲箱 + 液压支架 + 粗炮管 + 炮口制退器；开火时烟尘、冲击环、炮口焰三件套。',
    pros: ['体量最大，符合「兜底重火力」定位', '开火反馈最猛（烟尘 + 冲击环）', '橄榄绿与现有装甲车素材同源'],
    base: dBase, head: dHead,
  },
];

/** 供候选页调用：画一帧。aim 固定朝上（目标在正上方），枪口不摆动。 */
export function drawCandidate(ctx, cand, t, aim = -Math.PI / 2) {
  const W = 240, H = 200;
  ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
  ctx.fillStyle = '#0c1018'; ctx.fillRect(0, 0, W, H);
  // 战场参照：目标方向虚线 + 目标敌人
  ctx.strokeStyle = 'rgba(255,210,87,0.40)'; ctx.lineWidth = 1; ctx.setLineDash([4, 6]);
  ctx.beginPath(); ctx.moveTo(120, 132); ctx.lineTo(120, 30); ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = '#1a2430'; ctx.strokeStyle = '#3a4b5c'; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.arc(120, 26, 11, 0, TAU); ctx.fill(); ctx.stroke();
  ctx.fillStyle = '#4a6076'; ctx.fillRect(116, 24, 2, 2); ctx.fillRect(122, 24, 2, 2);
  ctx.fillStyle = 'rgba(255,210,87,0.75)'; ctx.font = '10px monospace'; ctx.textAlign = 'center';
  ctx.fillText('目标', 120, 12);

  const p = new P(ctx);
  const fire = (t % 0.9) < 0.3 ? (t % 0.9) / 0.3 : 0;
  ctx.save(); ctx.translate(120, 132);
  cand.base(p, t);
  ctx.save(); ctx.rotate(aim + Math.PI / 2);   // 枪口精确指向目标
  cand.head(p, t, fire);
  ctx.restore(); ctx.restore();
  p.reset();
}
