// 武器模块 · 第三版
//
// 用户反馈（2026-11-05）：
//   ① 6 把枪「过于像素化、该平滑的地方不平滑」→ Q4 A：保留硬剪影，只柔化明暗与高光
//   ② 双发应「一前一后」不是并排；去掉追踪、弹射；子弹效果暂不新增
//   ③ 命中分裂的子子弹「朝向要改变向四周」；加伤害卡不改子弹外观、两张数值卡删除；
//      子子弹爆炸与主子弹共用同一个爆炸效果，只是范围小很多
//   ④ 枪口闪光改按原库 impacts/hit-spark 的火花语言；榴弹炮爆炸直接复用原库 small-explosion 但压短时长
// Q1 B：06 册「弹射」弹道卡一并标记作废（02 册「弹射电弧」是技能质变卡，不受影响）。
//
// 名称与机制照 06 册：武器表(二) / 弹道卡(3.2) / 子弹属性卡(3.2.1)。
// 纪律：equipment.mjs 装备部分一行不动；本文件只属于「武器模块」。

import {
  fit, clamp, wrap, smooth, ease, sparkle, TAU,
} from '../../vendor/pixelfx/src/core/index.js';
import { Grid, toss } from '../../vendor/pixelfx/src/fx/critters/_lib.js';
import * as fxHitSpark from '../../vendor/pixelfx/src/fx/impacts/hit-spark.js';
import * as fxSmallBoom from '../../vendor/pixelfx/src/fx/explosions/small-explosion.js';
import { RAMPS, frameMeta, INK } from './pixel-lib.mjs';
import { tierRings, tierCracks, tierFx } from './tiers.mjs';

const W = 112, H = 88;

// Q4 A：主体走真半透明 blend（Grid.draw 对 a<1 用 p.blend，不产生 Bayer 网点），
// 1px 方向性描边仍保持不透明 → 硬剪影留住，内部明暗柔化。
const box = (g, x, y, w, h, c, a = 0.94) =>
  g.shade(x, y, x + w, y + h, (px, py, o) => { o.a = a; return c; });

/** 真半透明超椭圆（逐点 blend，不产生 Bayer 网点）。 */
function softShape(p, cx, cy, rx, ry, c, a, n = 2) {
  if (a <= 0 || rx <= 0 || ry <= 0) return;
  const X = Math.ceil(rx), Y = Math.ceil(ry);
  for (let y = -Y; y <= Y; y++)
    for (let x = -X; x <= X; x++) {
      const d = Math.pow(Math.abs(x) / rx, n) + Math.pow(Math.abs(y) / ry, n);
      if (d > 1) continue;
      p.blend(cx + x, cy + y, c, a * clamp(1 - 0.18 * d));
    }
}

// ─────────────────────────────────────────────────────────────
// 一、枪体：6 把型号，剪影完全不动（Q4 A），只改整体着色
// ─────────────────────────────────────────────────────────────

const GUNS = [
  { id: 'assault', name: '突击步枪', spec: '单发 · 中射速 · 中弹夹', mech: '新手默认 / 全维同步，无短板',
    shape: '标准步枪：中枪管 + 直弹匣 + 伸缩托 + 提把光学', motion: '稳定匀速点射，轻微后坐',
    r: RAMPS.green, D: 1.6, shots: 5, flashWin: 0.16, recoilPx: 2, kind: 'assault' },
  { id: 'smg', name: '冲锋枪', spec: '单发 · 极高射速 · 小弹夹', mech: '触发频率高 / 换弹最频繁',
    shape: '极短枪管 + 超长直弹匣 + 折叠托 + 顶部导轨', motion: '高频连闪 + 抛壳 + 强抖',
    r: RAMPS.volt, D: 1.4, shots: 14, flashWin: 0.30, recoilPx: 2.5, kind: 'smg' },
  { id: 'shotgun', name: '霰弹枪', spec: '一次多弹丸 · 短射程', mech: '每颗弹丸独立触发 / 越近越强',
    shape: '上下双粗管 + 可滑泵动护木 + 管式弹仓 + 木托', motion: '每发后泵动一次 + 6 颗扇形弹丸',
    r: RAMPS.fire, D: 1.8, shots: 2, flashWin: 0.14, recoilPx: 3, kind: 'shotgun' },
  { id: 'grenade', name: '榴弹炮', spec: '单发 · 自带爆炸 · 射速极慢', mech: '天生 AOE / 漏怪率高',
    shape: '超粗炮口 + 短炮身 + 侧面装填口 + 肩托提把', motion: '装填→发射→大后坐→炮口冲击环（1 发/周期）',
    r: RAMPS.bomb, D: 2.2, shots: 1, flashWin: 0.12, recoilPx: 5, kind: 'grenade' },
  { id: 'precision', name: '精确步枪', spec: '单发 · 高伤 · 长射程 · 天然穿透', mech: '单体极强 / 前半场统治',
    shape: '超长枪管 + 大瞄准镜 + 两脚架 + 直拉栓', motion: '单发→拉栓→贯穿全屏的穿透线',
    r: RAMPS.ice, D: 2.0, shots: 2, flashWin: 0.10, recoilPx: 2, kind: 'precision' },
  { id: 'gatling', name: '加特林', spec: '射速随时间递增', mech: '越打越猛 / 换弹后重新提速',
    shape: '旋转 6 管端面 + 垂挂弹链 + 双握把（无枪托）', motion: '起转→管组旋转→射速递增→停转',
    r: RAMPS.gold, D: 2.4, shots: 12, flashWin: 0.34, recoilPx: 1, kind: 'gatling' },
];

// 每种枪的轮廓。k = 本周期射击相位，rc = 后坐位移（向左为负）。以下一行未改。
const SHAPES = {
  assault(g, C, u, k, rc) {
    const x = -rc;
    box(g, x - 42, -3, 13, 9, C[2]); box(g, x - 42, -3, 13, 1, C[5]);
    box(g, x - 29, -7, 24, 14, C[3]); box(g, x - 29, -7, 24, 2, C[6]);
    box(g, x - 6, -3, 26, 5, C[4]); box(g, x - 6, -3, 26, 1, C[6]);
    box(g, x - 1, 2, 15, 4, C[2]);
    box(g, x - 17, 7, 7, 11, C[2]); box(g, x - 17, 7, 7, 1, C[5]);
    g.poly([[x - 27, 7], [x - 20, 7], [x - 22, 17], [x - 27, 17]], C[1]);
    box(g, x - 23, -12, 14, 3, C[2]);
    box(g, x - 20, -11, 7, 2, C[6]);
    g.line(x - 20, -9, x - 20, -7, C[2]); g.line(x - 12, -9, x - 12, -7, C[2]);
  },
  smg(g, C, u, k, rc) {
    const x = -rc;
    g.line(x - 42, -1, x - 29, -1, C[5]);
    box(g, x - 43, -4, 4, 8, C[3]);
    box(g, x - 28, -6, 19, 12, C[3]); box(g, x - 28, -6, 19, 2, C[6]);
    box(g, x - 9, -3, 11, 5, C[4]); box(g, x - 9, -3, 11, 1, C[6]);
    box(g, x - 26, -10, 17, 2, C[5]);
    box(g, x - 20, 6, 7, 17, C[2]);
    box(g, x - 20, 6, 7, 1, C[5]);
    for (let i = 0; i < 3; i++) box(g, x - 19, 10 + i * 4, 5, 1, C[4]);
    box(g, x - 7, 6, 4, 8, C[2]);
  },
  shotgun(g, C, u, k, rc) {
    const x = -rc;
    g.poly([[x - 44, -5], [x - 28, -7], [x - 26, 2], [x - 42, 6]], C[2]);
    box(g, x - 27, -6, 19, 13, C[3]); box(g, x - 27, -6, 19, 2, C[5]);
    box(g, x - 8, -6, 31, 4, C[4]); box(g, x - 8, -6, 31, 1, C[6]);
    box(g, x - 8, -1, 31, 4, C[3]); box(g, x - 8, -1, 31, 1, C[5]);
    box(g, x - 8, 4, 27, 3, C[2]);
    const slide = k < 0.5 ? k * 10 : (1 - k) * 10;
    box(g, x - 4 - slide, 7, 13, 5, C[5]);
    box(g, x - 4 - slide, 7, 13, 1, C[6]);
    for (let i = 0; i < 4; i++) g.line(x + i * 3 - slide, 9, x + i * 3 - slide, 11, C[2]);
  },
  grenade(g, C, u, k, rc) {
    const x = -rc;
    box(g, x - 40, -6, 13, 12, C[2]); box(g, x - 40, -6, 13, 1, C[5]);
    box(g, x - 27, -9, 31, 18, C[3]); box(g, x - 27, -9, 31, 2, C[5]);
    box(g, x - 2, -10, 10, 20, C[4]); box(g, x - 2, -10, 10, 1, C[6]);
    box(g, x + 6, -7, 3, 14, INK, 1);
    const open = u > 0.10 && u < 0.34 ? 1 : 0;
    box(g, x - 17, -13 + open * 3, 11, 4, C[5]);
    box(g, x - 15, -17, 12, 3, C[2]);
    g.line(x - 15, -14, x - 15, -9, C[2]); g.line(x - 3, -14, x - 3, -9, C[2]);
    box(g, x - 22, 9, 12, 5, C[2]);
  },
  precision(g, C, u, k, rc) {
    const x = -rc;
    box(g, x - 45, -4, 17, 9, C[2]); box(g, x - 45, -4, 17, 1, C[5]);
    box(g, x - 28, -6, 22, 12, C[3]); box(g, x - 28, -6, 22, 2, C[5]);
    box(g, x - 6, -3, 45, 5, C[4]); box(g, x - 6, -3, 45, 1, C[6]);
    box(g, x + 37, -4, 3, 7, C[2]);
    g.line(x + 2, 6, x + 10, 19, C[2]); g.line(x + 2, 6, x - 6, 19, C[2]);
    box(g, x - 19, -14, 19, 7, C[3]);
    box(g, x - 17, -12, 15, 3, C[6]); box(g, x + 1, -13, 3, 5, C[2]);
    g.line(x - 14, -7, x - 14, -6, C[2]); g.line(x - 5, -7, x - 5, -6, C[2]);
    const bolt = k < 0.5 ? k * 8 : (1 - k) * 8;
    box(g, x - 26 - bolt, -4, 7, 3, C[6]);
    box(g, x - 26 - bolt, -7, 2, 4, C[4]);
  },
  gatling(g, C, u, k, rc) {
    const x = -rc;
    box(g, x - 26, -9, 22, 18, C[3]); box(g, x - 26, -9, 22, 2, C[5]);
    const spin = u * TAU * 3;
    for (let i = 0; i < 3; i++) box(g, x - 4, -7 + i * 6, 26, 3, i === 0 ? C[5] : C[2]);
    for (let i = 0; i < 6; i++) {
      const a = spin + i * TAU / 6;
      g.ellipse(x + 24 + Math.cos(a) * 5, Math.sin(a) * 5, 2.2, 2.2, C[i % 2 ? 4 : 6], 1);
    }
    g.ellipse(x + 24, 0, 2, 2, INK, 1);
    for (let i = 0; i < 5; i++) box(g, x - 32 + i * 2, -9 - i * 3, 3, 3, C[4]);
    g.poly([[x - 20, 9], [x - 13, 9], [x - 15, 19], [x - 21, 19]], C[2]);
    g.poly([[x - 4, 9], [x + 3, 9], [x + 1, 19], [x - 5, 19]], C[2]);
  },
};

const GRID = new Grid(-58, -42, W + 4, H + 4);

function drawMuzzle(p, C, cfg, u, ph, firing, rc) {
  const k = firing ? 1 - ph / cfg.flashWin : 0;
  const mx = cfg.kind === 'precision' ? 41 : cfg.kind === 'grenade' ? 9
    : cfg.kind === 'shotgun' ? 24 : cfg.kind === 'gatling' ? 27 : cfg.kind === 'smg' ? 3 : 21;
  const mxr = mx - rc;
  if (!firing) {
    if (cfg.kind === 'precision') p.glow(mxr - 8, -11, 5, C[6], 0.10);
    return;
  }
  switch (cfg.kind) {
    case 'assault':
      p.circle(mxr + 2, -0.5, 2 + 4 * k, C[6], 1); p.glow(mxr + 2, 0, 12, C[5], 0.35 * k);
      p.line(mxr + 4, 0, mxr + 22, 0, C[6], 1); p.glowLine(mxr + 4, 0, mxr + 22, 0, 3, C[5], 0.3 * k);
      break;
    case 'smg':
      p.circle(mxr + 2, 0, 1.5 + 3 * k, C[6], 1); p.glow(mxr + 2, 0, 9, C[5], 0.30 * k);
      p.line(mxr + 4, 0, mxr + 16, 0, C[6], 1);
      for (let i = 0; i < 2; i++) {
        const f = toss(-16, -4, -14 - i * 6, -30, ph * 0.35 + i * 0.05, 300, 20);
        softShape(p, f.x, f.y, 1.6, 1, C[5], 0.85);
      }
      break;
    case 'shotgun':
      p.circle(mxr + 3, -2, 3 + 6 * k, C[6], 1); p.glow(mxr + 3, -1, 18, C[5], 0.42 * k);
      for (let i = 0; i < 6; i++) {
        const an = -0.45 + (i / 5) * 0.9;
        p.glowLine(mxr + 4, -1, mxr + 24, -1 + Math.sin(an) * 26, 2, C[5], 0.32 * k);
        p.line(mxr + 4, -1, mxr + 22, -1 + Math.sin(an) * 24, C[6], 1);
      }
      break;
    case 'grenade': {
      p.circle(mxr + 3, 0, 4 + 8 * k, C[6], 1); p.glow(mxr + 3, 0, 26, C[5], 0.45 * k);
      p.glowRing(mxr + 3, 0, 8 + 20 * k, 3, C[4], 0.40 * k);
      const f = toss(mxr + 4, 0, 46, -34, ph * 1.6, 190, 16);
      softShape(p, f.x, f.y, 3.5, 3.5, C[5], 0.95, 4);
      if (f.landed) { p.glowRing(f.x, 16, 10 + 20 * k, 3, C[5], 0.35 * k); }
      break;
    }
    case 'precision':
      p.circle(mxr + 2, -0.5, 2 + 3 * k, C[6], 1);
      p.glowLine(mxr, 0, mxr + 60, 0, 5, C[5], 0.55 * k);
      p.line(mxr, 0, mxr + 62, 0, C[6], 1);
      p.glow(mxr + 2, 0, 14, C[5], 0.30 * k);
      break;
    case 'gatling': {
      const ramp = ease.inQuad(clamp(u * 1.4));
      p.circle(mxr + 3, 0, 1.5 + 3 * k * ramp, C[6], 1);
      p.glow(mxr + 3, 0, 8 + 6 * ramp, C[5], 0.30 * k * ramp);
      for (let i = 0; i < 3; i++) p.line(mxr + 4, -6 + i * 6, mxr + 18, -6 + i * 6, C[6], 0.9);
      break;
    }
  }
}

function drawGun(p, t, cfg) {
  const u = wrap(t, cfg.D) / cfg.D;
  const C = cfg.T ? cfg.T.body : fit(cfg.r, 7);   // 挂品级时整套配色由档位接管，剪影不动
  const ph = wrap(u * cfg.shots, 1);
  const firing = ph < cfg.flashWin;
  const rc = firing ? (1 - ph / cfg.flashWin) * cfg.recoilPx : 0;
  GRID.clear();
  SHAPES[cfg.kind](GRID, C, u, ph, rc);
  GRID.outline((x, y, nx, ny) => (ny < 0 && nx <= 0 ? C[3] : C[0]));
  tierRings(GRID, cfg.T);                         // 品级外缘光
  tierCracks(GRID, cfg.T, -14, 1, 9);             // 灾厄黑纹（落在机匣上，不在空处）
  GRID.draw(p);

  // Q4 A：剪影（outline）保持硬边不动；只用连续加色光带柔化内部明暗与金属高光。
  // 光带是加色过渡，不是硬色条，所以「该平滑的地方」平滑了，剪影分化没被糊掉。
  p.glowLine(-36, -2, 30, -2, 9, C[3], 0.16);
  p.glowLine(-4, -1, 26, -1, 4, C[5], 0.20);
  p.glow(-6, 0, 40, C[3], 0.14);
  p.glow(0, -7, 24, C[4], 0.10);
  p.glow(0, 7, 20, C[1], 0.08);

  drawMuzzle(p, C, cfg, u, ph, firing, rc);
  tierFx(p, cfg.T, t, { cx: 0, cy: 0, rx: 36, ry: 15 });   // 品级光效
}

/** 供品级对照卡复用：按型号 id + 品级画一把。 */
export function drawWeaponWithTier(p, t, gunId, T) {
  const cfg = GUNS.find((g) => g.id === gunId) ?? GUNS[0];
  drawGun(p, t, { ...cfg, T });
}

export const WEAPON_EFFECTS = GUNS.map((c) => ({
  id: c.id, name: c.name, spec: c.spec, mech: c.mech,
  read: `剪影 ${c.shape} / 节奏 ${c.motion}`,
  source: '内核新写（Grid 硬剪影 + 加色光柔化明暗）',
  demoHook: `weapon.model === '${c.id}' → drawGun()`,
  mod: {
    meta: frameMeta(c.name, W, H, {
      desc: `${c.shape}｜${c.motion}`, tags: ['weapon', c.id],
      duration: c.D, loop: true, fps: 30, oy: H / 2,
    }),
    draw: (p, t) => drawGun(p, t, c),
  },
}));

// ─────────────────────────────────────────────────────────────
// 二、子弹与弹道（06 册 3.2，删除追踪 / 弹射后共 6 张）
// ─────────────────────────────────────────────────────────────

const BULLETS = [
  { id: 'main-bullet', name: '主子弹', desc: '基准弹道：白热核心 + 冷却拖尾', r: RAMPS.green, kind: 'main' },
  { id: 'double', name: '双发', desc: '2 颗同向、命中同一落点；一前一后纵列（并排是散射）', r: RAMPS.volt, kind: 'double' },
  { id: 'scatter', name: '散射', desc: '横向扇面铺开，给枪增加范围覆盖', r: RAMPS.gold, kind: 'scatter' },
  { id: 'pierce', name: '穿透', desc: '额外穿过 1 个目标，沿途 +10% 递减', r: RAMPS.ice, kind: 'pierce' },
  { id: 'pellets', name: '霰弹弹丸群', desc: '一次 6 颗，每颗独立触发效果', r: RAMPS.fire, kind: 'pellets' },
  { id: 'grenade-shell', name: '榴弹', desc: '抛物线飞行 + 落点 AOE', r: RAMPS.bomb, kind: 'shell' },
];

/** dir = 弹头朝向（弧度）。拖尾与核心都沿该方向，供 360° 分裂的子子弹使用。 */
function bulletAt(p, C, x, y, size = 3, a = 1, dir = 0) {
  const dx = Math.cos(dir), dy = Math.sin(dir);
  p.glow(x, y, size * 3.4, C[5], 0.34 * a);
  p.glowLine(x - dx * size * 4, y - dy * size * 4, x, y, size * 1.5, C[4], 0.40 * a);
  softShape(p, x, y, size, size * 0.7, C[6], 0.95 * a);
  softShape(p, x - dx * size * 0.9, y - dy * size * 0.9, size * 0.5, size * 0.35, C[5], 0.7 * a);
}

function drawBullet(p, t, c) {
  const D = 1.4, u = wrap(t, D) / D, C = fit(c.r, 7);
  const A = 1 - smooth(0.86, 1, u);
  const travel = ease.outQuad(clamp(u / 0.80));
  const x = -44 + 88 * travel;
  p.glow(40, 0, 12, C[3], 0.14);
  softShape(p, 40, 0, 5, 7, C[2], 0.55, 4);

  switch (c.kind) {
    case 'main':
      bulletAt(p, C, x, 0, 3, A);
      break;
    case 'double':
      // 一前一后纵列：第二颗在后 20px、略暗，两颗同向、命中同一落点
      bulletAt(p, C, x - 20, 0, 2.6, A * 0.82);
      bulletAt(p, C, x, 0, 2.6, A);
      break;
    case 'scatter':
      for (let i = 0; i < 3; i++) bulletAt(p, C, x, (i - 1) * 10 * travel, 2.4, A);
      break;
    case 'pierce':
      p.glowLine(-46, 0, x, 0, 4, C[5], 0.32 * A);
      bulletAt(p, C, x, 0, 3.2, A);
      if (x > 40) { p.glowRing(40, 0, 6 + 10 * (x - 40) / 20, 2, C[4], 0.3 * A); }
      break;
    case 'pellets':
      for (let i = 0; i < 6; i++) {
        const an = -0.5 + (i / 5) * 1.0;
        bulletAt(p, C, -44 + 80 * travel, Math.sin(an) * 24 * travel, 2, A);
      }
      break;
    case 'shell': {
      const f = toss(-44, -6, 62, -22, u * D, 90, 8);
      softShape(p, f.x, f.y, 4, 3, C[5], 0.95 * A, 4);
      p.glow(f.x, f.y, 10, C[4], 0.3 * A);
      if (f.landed) {
        const k = clamp((u - f.at / D) * 4);
        p.glowRing(f.x, 8, 6 + 26 * k, 3, C[5], 0.45 * A * (1 - k));
        p.glow(f.x, 8, 20, C[6], 0.4 * A * (1 - k));
      }
      break;
    }
  }
}

export const BULLET_EFFECTS = BULLETS.map((c) => ({
  id: c.id, name: c.name, spec: c.desc, mech: c.desc, read: c.desc,
  source: '内核新写（06 册 3.2 弹道卡）',
  demoHook: `${c.id} → bullet 渲染 / 命中判定`,
  mod: {
    meta: frameMeta(c.name, W, H, { desc: c.desc, tags: ['weapon', 'bullet', c.id], duration: 1.4, loop: true, fps: 30, oy: H / 2 }),
    draw: (p, t) => drawBullet(p, t, c),
  },
}));

// ─────────────────────────────────────────────────────────────
// 三、子弹属性与行为卡（06 册 3.2.1；删两张纯数值卡后共 5 张）
// ─────────────────────────────────────────────────────────────

const ATTRS = [
  { id: 'fire-head', name: '火属性弹头', desc: '灼烧 DoT 8%/s × 2.0s；只主子弹，子子弹不继承火', r: RAMPS.fire, kind: 'fire' },
  { id: 'blast-head', name: '爆炸弹头', desc: '命中 12% 伤害小爆炸，半径 35px；与主/子子弹共用同一爆炸表现', r: RAMPS.bomb, kind: 'blast' },
  { id: 'blast-range', name: '爆炸范围 +100%', desc: '修饰卡：35→70px；共用爆炸表现，只放大半径', r: RAMPS.gold, kind: 'range' },
  { id: 'split-hit', name: '命中分裂', desc: '360° 飞出 2-4 颗子子弹，弹头朝向随各自方向；基础伤害 20%，不递归', r: RAMPS.ice, kind: 'split' },
  { id: 'child-blast', name: '子子弹爆炸', desc: '与主子弹共用同一爆炸表现，仅半径缩到约 1/3；修饰卡，无分裂则休眠', r: RAMPS.arcane, kind: 'childblast' },
];

/**
 * 主子弹与子子弹共用的爆炸表现（用户：逻辑上都是子弹，只是一个 100%×1 颗、
 * 一个削减伤害×多颗）。R 是唯一差异：主弹 18 / 范围+100% 36 / 子子弹 7。
 */
function blastBurst(p, C, x, y, R, A, k) {
  p.glowRing(x, y, 2 + R * k, 2.5, C[5], 0.50 * A * (1 - k));
  p.glow(x, y, R * 0.85, C[6], 0.42 * A * (1 - k));
  for (let i = 0; i < 5; i++) {
    const an = i * TAU / 5 + k;
    const s = Math.max(0.6, 2 - 1.2 * k);
    softShape(p, x + Math.cos(an) * R * k, y + Math.sin(an) * R * k, s, s, C[5], 0.75 * A * (1 - k));
  }
}

function drawAttr(p, t, c) {
  const D = 1.5, u = wrap(t, D) / D, C = fit(c.r, 7);
  const A = 1 - smooth(0.88, 1, u);
  const travel = clamp(u / 0.32);
  const x = -40 + 76 * travel;
  const hit = u > 0.32, k = clamp((u - 0.32) / 0.68);
  softShape(p, 36, 0, 5, 8, C[2], 0.5, 4);

  // 飞行阶段：不同卡的子弹外观不同（不是靠「变大」表达加伤害）
  if (!hit) {
    switch (c.kind) {
      case 'fire':
        bulletAt(p, C, x, 0, 3.2, A);
        for (let i = 1; i <= 3; i++) p.glow(x - i * 5, Math.sin(u * 18 + i) * 2, 5 - i, C[4], 0.32 * A);
        break;
      case 'blast': case 'range':
        bulletAt(p, C, x, 0, 4, A);
        p.glowRing(x, 0, c.kind === 'range' ? 9 : 6, 1, C[5], 0.4 * A);
        break;
      case 'split':
        bulletAt(p, C, x, 0, 3, A);
        for (const s of [-1, 1]) softShape(p, x - 6, s * 4, 1.4, 1.4, C[5], 0.6 * A);
        break;
      case 'childblast':
        bulletAt(p, C, x, 0, 2.4, A);
        p.glowRing(x, 0, 5, 1, C[5], 0.35 * A);
        break;
    }
    return;
  }

  switch (c.kind) {
    case 'fire':
      for (let i = 0; i < 4; i++) {
        const fy = -8 - (k * 16 + i * 4) % 24;
        softShape(p, 36 + Math.sin(k * 9 + i) * 3, fy, 2 + i * 0.4, 3 + i * 0.5, C[5], 0.55 * A);
      }
      p.glow(36, -4, 16, C[4], 0.3 * A);
      break;
    case 'blast':
      blastBurst(p, C, 36, 0, 18, A, k);
      break;
    case 'range':
      blastBurst(p, C, 36, 0, 36, A, k);
      p.glowRing(36, 0, 36, 1, C[3], 0.35 * A);        // 半径指示环
      break;
    case 'split': {
      // 子子弹沿各自方向飞出，弹头朝向 = 该方向（不再统一朝右）
      for (let i = 0; i < 4; i++) {
        const an = i * TAU / 4 + 0.4, d = 6 + 32 * k;
        bulletAt(p, C, 36 + Math.cos(an) * d, Math.sin(an) * d, 1.8, A * (1 - k * 0.5), an);
      }
      p.glowRing(36, 0, 3 + 10 * k, 2, C[5], 0.35 * A * (1 - k));
      break;
    }
    case 'childblast': {
      // 与主子弹同构：先飞向目标、命中之后才爆炸（不在飞行中途炸）。
      // 主弹命中(0.32) → 子子弹飞向各自目标(0.32~0.62) → 命中后爆炸(0.62~1)。
      // 爆炸仍调主弹同一个 blastBurst()，只是半径缩到 7（伤害/范围小，但都是子弹）。
      const TARGETS = [{ x: 4, y: -20 }, { x: 4, y: 20 }, { x: 50, y: -4 }];
      for (const T of TARGETS) softShape(p, T.x, T.y, 3.5, 5, C[2], 0.42, 4);   // 各自的命中物体
      if (u < 0.62) {
        const e = ease.outCubic(clamp((u - 0.32) / 0.30));
        for (const T of TARGETS) {
          const an = Math.atan2(T.y, T.x - 36);
          bulletAt(p, C, 36 + (T.x - 36) * e, T.y * e, 1.8, A, an);
        }
      } else {
        const kb = clamp((u - 0.62) / 0.38);
        for (const T of TARGETS) blastBurst(p, C, T.x, T.y, 7, A, kb);
      }
      break;
    }
  }
}

export const BULLET_ATTR_EFFECTS = ATTRS.map((c) => ({
  id: c.id, name: c.name, spec: c.desc, mech: c.desc, read: c.desc,
  source: '内核新写（06 册 3.2.1 定稿卡名）',
  demoHook: `card '${c.id}' → 主子弹命中行为`,
  mod: {
    meta: frameMeta(c.name, W, H, { desc: c.desc, tags: ['weapon', 'bullet-attr', c.id], duration: 1.5, loop: true, fps: 30, oy: H / 2 }),
    draw: (p, t) => drawAttr(p, t, c),
  },
}));

// ─────────────────────────────────────────────────────────────
// 四、爆炸与命中（武器侧；含 2 张原库对照）
// ─────────────────────────────────────────────────────────────

function drawBlast(p, t, id) {
  const D = 0.9, u = clamp(t / D), C = fit(RAMPS.fire, 7);
  const A = 1 - smooth(0.55, 0.94, u);
  if (u >= 0.94) return;
  const flash = 1 - smooth(0, 0.10, u);
  if (flash > 0.02) { p.glow(0, 0, 30, C[6], 0.6 * flash); p.disc(0, 0, 10 * flash, C[6], 0.8 * flash); }
  const k = ease.outExpo(clamp(u / 0.7));
  switch (id) {
    case 'muzzle': {
      // 按原库 impacts/hit-spark 的火花语言重做：白热核心 + 短促四散火星。
      // 去掉原来的 5 条锥形长射线与冲击环（用户：别扭）。
      p.glow(0, 0, 12 + 6 * k, C[6], 0.45 * A);
      sparkle(p, 0, 0, 3 + 3 * k, C[6], C[5], 0.8 * A);
      for (let i = 0; i < 8; i++) {
        const an = i * TAU / 8 + 0.3, d = 4 + 14 * k;
        const sx = Math.cos(an) * d, sy = Math.sin(an) * d;
        p.glowLine(0, 0, sx, sy, 1.6, C[5], 0.28 * A);
        softShape(p, sx, sy, Math.max(0.5, 1.4 - 0.7 * k), Math.max(0.5, 1.4 - 0.7 * k), C[6], 0.8 * A);
      }
      break;
    }
    case 'pierce-trail': {
      // 弹头线性匀速贯穿（子弹本该恒速，不用缓动）；白色拖影拆成 12 段加色光带，越靠尾部越淡。
      // 命中圈：弹头「越过该 x 的瞬间」即触发，随弹头继续前进而扩散并淡出 —— 与物理直觉对齐，
      // 不再用独立时间轴（旧版按线性排的命中时刻、弹头却用 outCubic，导致圈迟到了近 0.2 个周期才出）。
      const HITS = [-24, 0, 24];
      const headX = -50 + 100 * clamp(u / 0.72);      // 线性；u=0.72 到达右界 x=50，之后停住表示出屏
      const TRAIL = 36, SEGS = 12;
      for (let i = 0; i < SEGS; i++) {
        const a0 = i / SEGS, a1 = (i + 1) / SEGS;
        p.glowLine(headX - TRAIL * (1 - a0), 0, headX - TRAIL * (1 - a1), 0,
          3.2, C[6], 0.55 * A * Math.pow(a1, 1.6));
      }
      softShape(p, headX, 0, 2.4, 1.8, C[6], 0.95 * A);
      p.glow(headX, 0, 9, C[6], 0.35 * A);
      for (const hx of HITS) {
        const past = headX - hx;                       // 弹头越过该点的像素距离
        if (past < 0) continue;                        // 还没打到
        const kh = clamp(past / 14);                   // 越过约 14px 内完成扩散淡出（越快越显得同步）
        p.glowRing(hx, 0, 3 + 14 * kh, 2, C[4], 0.45 * A * (1 - kh));
        p.glow(hx, 0, 12, C[6], 0.32 * A * (1 - kh));
      }
      break;
    }
  }
}

/**
 * 榴弹炮落点爆炸：直接复用原库 small-explosion（用户：源库精致得多），
 * 但把时间轴 ×3 压到 1.8s。原库 duration=5.4s 且是模拟型（有 create），
 * 所以包装 create 返回的 impl，update/draw 都乘 3 —— 完整保留
 * 白热核心→碎片→烟尘三段，不截断丢帧。
 */
const fastSmallBoom = {
  meta: { ...fxSmallBoom.meta, duration: fxSmallBoom.meta.duration / 3 },
  create(o) {
    const impl = fxSmallBoom.create(o);
    return {
      update(dt, opts) { if (impl.update) impl.update(dt * 3, opts); },
      drawBack(p, t, opts) { if (impl.drawBack) impl.drawBack(p, t * 3, opts); },
      draw(p, t, opts) { impl.draw(p, t * 3, opts); },
    };
  },
};

export const WEAPON_BLAST_EFFECTS = [
  ...[
    { id: 'muzzle', name: '枪口火花', desc: '按原库 impacts/hit-spark 的火花语言：白热核心 + 短促四散火星', kind: 'muzzle' },
    { id: 'pierce-trail', name: '精确步枪穿透余痕', desc: '贯穿全屏 + 沿途每目标 +10% 递减', kind: 'pierce-trail' },
  ].map((c) => ({
    id: c.id, name: c.name, spec: c.desc, mech: c.desc, read: c.desc,
    source: '内核新写（武器侧爆炸）',
    demoHook: `${c.id} → createFx 命中事件`,
    mod: {
      meta: frameMeta(c.name, W, H, { desc: c.desc, tags: ['weapon', 'blast', c.id], duration: 0.9, loop: false, fps: 30, oy: H / 2 }),
      draw: (p, t) => drawBlast(p, t, c.kind),
    },
  })),
  {
    id: 'grenade-boom', name: '榴弹炮落点爆炸',
    spec: '直接复用原库 small-explosion；时间轴 ×3 压到 1.8s，完整保留白热→碎片→烟尘',
    mech: '天生 AOE；与武器加成卡的小爆是两套尺度', read: '复用原库精致爆炸，仅压缩时长',
    source: '现成借鉴 · explosions/small-explosion（时间轴压缩）',
    demoHook: 'grenadeHit() → createFx(fastSmallBoom)',
    mod: fastSmallBoom,
  },
  {
    id: 'ref-hit-spark', name: '命中火花（原库对照）', spec: 'impacts/hit-spark', mech: '原库帧动画，未改源码',
    read: '对照像素密度与光效层次', source: '现成借鉴 · impacts/hit-spark',
    demoHook: 'onHit() → createFx', mod: fxHitSpark,
  },
  {
    id: 'ref-small-boom', name: '小型爆炸（原库对照）', spec: 'explosions/small-explosion', mech: '原库帧动画，未改源码',
    read: '对照爆炸的白热核心 → 碎片 → 烟尘', source: '现成借鉴 · explosions/small-explosion',
    demoHook: 'explode() → createFx', mod: fxSmallBoom,
  },
];
