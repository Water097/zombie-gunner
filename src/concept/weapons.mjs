// 武器模块 · 第二版
//
// 用户反馈：6 把枪「画风几乎一样，只改了某点颜色」；且武器模块要包含
// 子弹 / 分裂子弹 / 子弹属性 / 爆炸效果。
// 根因：上一版 6 把枪共用一个 drawGun()，只换 accent 与几个长度参数。
// 但 06 册里 6 把枪的差别恰恰是【弹道形态】，不是皮肤。
//
// 这一版：
//   · 每把枪独立的轮廓函数 + 独立的射击节奏（后坐/泵动/拉栓/起转/装填）
//   · 全部走 critters 的 Grid 内核（成片色阶 + 1px 方向性描边 + 真半透明），延续降噪纪律
//   · 名称与机制全部照 06 册：武器表(二) / 弹道卡(3.2) / 子弹属性卡(3.2.1)
//   · 4 个子组：枪体 / 子弹与弹道 / 子弹属性 / 爆炸与命中
//
// 纪律：equipment.mjs 的装备部分一行不动；本文件只属于「武器模块」。

import {
  fit, clamp, wrap, smooth, seg, ease, lerp, rng, sparkle, TAU,
} from '../../vendor/pixelfx/src/core/index.js';
import { Grid, toss } from '../../vendor/pixelfx/src/fx/critters/_lib.js';
import * as fxHitSpark from '../../vendor/pixelfx/src/fx/impacts/hit-spark.js';
import * as fxSmallBoom from '../../vendor/pixelfx/src/fx/explosions/small-explosion.js';
import { RAMPS, frameMeta, WHITE, INK } from './pixel-lib.mjs';

const W = 112, H = 88;

const box = (g, x, y, w, h, c, a = 1) =>
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
// 一、枪体：6 把型号，每把独立剪影
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

// 每种枪的轮廓。k = 本周期射击相位，rc = 后坐位移（向左为负）。
const SHAPES = {
  assault(g, C, u, k, rc) {
    const x = -rc;
    box(g, x - 42, -3, 13, 9, C[2]); box(g, x - 42, -3, 13, 1, C[5]);
    box(g, x - 29, -7, 24, 14, C[3]); box(g, x - 29, -7, 24, 2, C[6]);
    box(g, x - 6, -3, 26, 5, C[4]); box(g, x - 6, -3, 26, 1, C[6]);
    box(g, x - 1, 2, 15, 4, C[2]);                       // 前护木
    box(g, x - 17, 7, 7, 11, C[2]); box(g, x - 17, 7, 7, 1, C[5]);
    g.poly([[x - 27, 7], [x - 20, 7], [x - 22, 17], [x - 27, 17]], C[1]);
    box(g, x - 23, -12, 14, 3, C[2]);                    // 提把光学
    box(g, x - 20, -11, 7, 2, C[6]);
    g.line(x - 20, -9, x - 20, -7, C[2]); g.line(x - 12, -9, x - 12, -7, C[2]);
  },
  smg(g, C, u, k, rc) {
    const x = -rc;
    g.line(x - 42, -1, x - 29, -1, C[5]);                // 折叠托细杆
    box(g, x - 43, -4, 4, 8, C[3]);
    box(g, x - 28, -6, 19, 12, C[3]); box(g, x - 28, -6, 19, 2, C[6]);
    box(g, x - 9, -3, 11, 5, C[4]); box(g, x - 9, -3, 11, 1, C[6]);
    box(g, x - 26, -10, 17, 2, C[5]);                    // 顶部导轨
    box(g, x - 20, 6, 7, 17, C[2]);                      // 超长弹匣（身份）
    box(g, x - 20, 6, 7, 1, C[5]);
    for (let i = 0; i < 3; i++) box(g, x - 19, 10 + i * 4, 5, 1, C[4]);
    box(g, x - 7, 6, 4, 8, C[2]);                        // 前握把
  },
  shotgun(g, C, u, k, rc) {
    const x = -rc;
    g.poly([[x - 44, -5], [x - 28, -7], [x - 26, 2], [x - 42, 6]], C[2]);   // 木托
    box(g, x - 27, -6, 19, 13, C[3]); box(g, x - 27, -6, 19, 2, C[5]);
    box(g, x - 8, -6, 31, 4, C[4]); box(g, x - 8, -6, 31, 1, C[6]);         // 上管
    box(g, x - 8, -1, 31, 4, C[3]); box(g, x - 8, -1, 31, 1, C[5]);         // 下管（双管身份）
    box(g, x - 8, 4, 27, 3, C[2]);                                           // 管式弹仓
    const slide = k < 0.5 ? k * 10 : (1 - k) * 10;
    box(g, x - 4 - slide, 7, 13, 5, C[5]);                                    // 泵动护木来回滑
    box(g, x - 4 - slide, 7, 13, 1, C[6]);
    for (let i = 0; i < 4; i++) g.line(x + i * 3 - slide, 9, x + i * 3 - slide, 11, C[2]);
  },
  grenade(g, C, u, k, rc) {
    const x = -rc;
    box(g, x - 40, -6, 13, 12, C[2]); box(g, x - 40, -6, 13, 1, C[5]);       // 肩托
    box(g, x - 27, -9, 31, 18, C[3]); box(g, x - 27, -9, 31, 2, C[5]);       // 粗炮身
    box(g, x - 2, -10, 10, 20, C[4]); box(g, x - 2, -10, 10, 1, C[6]);       // 超粗炮口
    box(g, x + 6, -7, 3, 14, INK);                                            // 炮口内膛
    const open = u > 0.10 && u < 0.34 ? 1 : 0;
    box(g, x - 17, -13 + open * 3, 11, 4, C[5]);                              // 侧面装填口开合
    box(g, x - 15, -17, 12, 3, C[2]);                                         // 提把
    g.line(x - 15, -14, x - 15, -9, C[2]); g.line(x - 3, -14, x - 3, -9, C[2]);
    box(g, x - 22, 9, 12, 5, C[2]);                                           // 握把
  },
  precision(g, C, u, k, rc) {
    const x = -rc;
    box(g, x - 45, -4, 17, 9, C[2]); box(g, x - 45, -4, 17, 1, C[5]);
    box(g, x - 28, -6, 22, 12, C[3]); box(g, x - 28, -6, 22, 2, C[5]);
    box(g, x - 6, -3, 45, 5, C[4]); box(g, x - 6, -3, 45, 1, C[6]);          // 最长枪管
    box(g, x + 37, -4, 3, 7, C[2]);                                           // 制退器
    g.line(x + 2, 6, x + 10, 19, C[2]); g.line(x + 2, 6, x - 6, 19, C[2]);   // 两脚架
    box(g, x - 19, -14, 19, 7, C[3]);                                         // 大瞄准镜
    box(g, x - 17, -12, 15, 3, C[6]); box(g, x + 1, -13, 3, 5, C[2]);
    g.line(x - 14, -7, x - 14, -6, C[2]); g.line(x - 5, -7, x - 5, -6, C[2]);
    const bolt = k < 0.5 ? k * 8 : (1 - k) * 8;
    box(g, x - 26 - bolt, -4, 7, 3, C[6]);                                    // 直拉栓后拉
    box(g, x - 26 - bolt, -7, 2, 4, C[4]);
  },
  gatling(g, C, u, k, rc) {
    const x = -rc;
    box(g, x - 26, -9, 22, 18, C[3]); box(g, x - 26, -9, 22, 2, C[5]);       // 机匣
    const spin = u * TAU * 3;
    for (let i = 0; i < 3; i++) box(g, x - 4, -7 + i * 6, 26, 3, i === 0 ? C[5] : C[2]);
    // 6 管端面（旋转）
    for (let i = 0; i < 6; i++) {
      const a = spin + i * TAU / 6;
      g.ellipse(x + 24 + Math.cos(a) * 5, Math.sin(a) * 5, 2.2, 2.2, C[i % 2 ? 4 : 6], 1);
    }
    g.ellipse(x + 24, 0, 2, 2, INK, 1);
    // 垂挂弹链
    for (let i = 0; i < 5; i++) box(g, x - 32 + i * 2, -9 - i * 3, 3, 3, C[4]);
    g.poly([[x - 20, 9], [x - 13, 9], [x - 15, 19], [x - 21, 19]], C[2]);    // 双握把
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
    if (cfg.kind === 'precision') p.glow(mxr - 8, -11, 5, C[6], 0.10);   // 瞄准镜反光常驻
    return;
  }
  switch (cfg.kind) {
    case 'assault':
      p.circle(mxr + 2, -0.5, 2 + 4 * k, C[6], 1); p.glow(mxr + 2, 0, 12, C[5], 0.35 * k);
      p.line(mxr + 4, 0, mxr + 22, 0, C[7] ?? C[6], 1); p.glowLine(mxr + 4, 0, mxr + 22, 0, 3, C[5], 0.3 * k);
      break;
    case 'smg':
      p.circle(mxr + 2, 0, 1.5 + 3 * k, C[6], 1); p.glow(mxr + 2, 0, 9, C[5], 0.30 * k);
      p.line(mxr + 4, 0, mxr + 16, 0, C[6], 1);
      // 抛壳
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
      p.glowLine(mxr, 0, mxr + 60, 0, 5, C[5], 0.55 * k);                  // 贯穿全屏
      p.line(mxr, 0, mxr + 62, 0, C[6], 1);
      p.glow(mxr + 2, 0, 14, C[5], 0.30 * k);
      break;
    case 'gatling': {
      const ramp = ease.inQuad(clamp(u * 1.4));                             // 射速递增
      p.circle(mxr + 3, 0, 1.5 + 3 * k * ramp, C[6], 1);
      p.glow(mxr + 3, 0, 8 + 6 * ramp, C[5], 0.30 * k * ramp);
      for (let i = 0; i < 3; i++) p.line(mxr + 4, -6 + i * 6, mxr + 18, -6 + i * 6, C[6], 0.9);
      break;
    }
  }
}

function drawGun(p, t, cfg) {
  const u = wrap(t, cfg.D) / cfg.D, C = fit(cfg.r, 7);
  const ph = wrap(u * cfg.shots, 1);
  const firing = ph < cfg.flashWin;
  const rc = firing ? (1 - ph / cfg.flashWin) * cfg.recoilPx : 0;
  GRID.clear();
  SHAPES[cfg.kind](GRID, C, u, ph, rc);
  GRID.outline((x, y, nx, ny) => (ny < 0 && nx <= 0 ? C[3] : C[0]));
  GRID.draw(p);
  p.glow(-6, 0, 34, C[3], 0.14);
  drawMuzzle(p, C, cfg, u, ph, firing, rc);
}

export const WEAPON_EFFECTS = GUNS.map((c) => ({
  id: c.id, name: c.name, spec: c.spec, mech: c.mech,
  read: `剪影 ${c.shape} / 节奏 ${c.motion}`,
  source: '内核新写（Grid 剪影 + 独立射击节奏）',
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
// 二、子弹与弹道（06 册 3.2 弹道卡 + 基础弹种）
// ─────────────────────────────────────────────────────────────

const BULLETS = [
  { id: 'main-bullet', name: '主子弹', desc: '基准弹道：白热核心 + 冷却拖尾', r: RAMPS.green, kind: 'main' },
  { id: 'double', name: '双发', desc: '2 颗同向、命中同一落点；扣 1 tick 射 2 颗', r: RAMPS.volt, kind: 'double' },
  { id: 'scatter', name: '散射', desc: '横向扇面铺开，给枪增加范围覆盖', r: RAMPS.gold, kind: 'scatter' },
  { id: 'pierce', name: '穿透', desc: '额外穿过 1 个目标，沿途 +10% 递减', r: RAMPS.ice, kind: 'pierce' },
  { id: 'homing', name: '追踪', desc: '轻微修正弹道，弯向目标', r: RAMPS.arcane, kind: 'homing' },
  { id: 'ricochet', name: '弹射', desc: '命中后弹向附近另一个目标', r: RAMPS.swift, kind: 'ricochet' },
  { id: 'pellets', name: '霰弹弹丸群', desc: '一次 6 颗，每颗独立触发效果', r: RAMPS.fire, kind: 'pellets' },
  { id: 'grenade-shell', name: '榴弹', desc: '抛物线飞行 + 落点 AOE', r: RAMPS.bomb, kind: 'shell' },
];

function bulletAt(p, C, x, y, size = 3, a = 1) {
  p.glow(x, y, size * 3.4, C[5], 0.34 * a);
  p.glowLine(x - size * 4, y, x, y, size * 1.5, C[4], 0.40 * a);
  softShape(p, x, y, size, size * 0.7, C[6], 0.95 * a);
  softShape(p, x - size * 0.9, y, size * 0.5, size * 0.35, C[5], 0.7 * a);
}

function drawBullet(p, t, c) {
  const D = 1.4, u = wrap(t, D) / D, C = fit(c.r, 7);
  const A = 1 - smooth(0.86, 1, u);
  const travel = ease.outQuad(clamp(u / 0.80));
  const x = -44 + 88 * travel;
  // 目标标记（画面右侧），让「命中」有落点
  p.glow(40, 0, 12, C[3], 0.14);
  softShape(p, 40, 0, 5, 7, C[2], 0.55, 4);

  switch (c.kind) {
    case 'main':
      bulletAt(p, C, x, 0, 3, A);
      break;
    case 'double':
      bulletAt(p, C, x, -3, 2.6, A); bulletAt(p, C, x, 3, 2.6, A);
      break;
    case 'scatter':
      for (let i = 0; i < 3; i++) bulletAt(p, C, x, (i - 1) * 10 * travel, 2.4, A);
      break;
    case 'pierce':
      p.glowLine(-46, 0, x, 0, 4, C[5], 0.32 * A);
      bulletAt(p, C, x, 0, 3.2, A);
      if (x > 40) { p.glowRing(40, 0, 6 + 10 * (x - 40) / 20, 2, C[4], 0.3 * A); }
      break;
    case 'homing': {
      const yy = 12 * Math.sin(travel * Math.PI) * (1 - travel) - 12 * (1 - travel);
      for (let i = 0; i < 8; i++) {
        const q = i / 8, px = -44 + 88 * travel * q;
        const py = 12 * Math.sin(travel * q * Math.PI) * (1 - travel * q) - 12 * (1 - travel * q);
        p.dot(px, py, C[4], 0.35 * A);
      }
      bulletAt(p, C, x, yy, 2.8, A);
      break;
    }
    case 'ricochet': {
      bulletAt(p, C, x, 0, 2.8, A);
      const back = clamp((travel - 0.55) / 0.45);
      if (back > 0) {
        const bx = 40 - 26 * back, by = -18 * Math.sin(back * Math.PI);
        p.glowLine(40, 0, bx, by, 3, C[5], 0.3 * A);
        bulletAt(p, C, bx, by, 2.2, A * (1 - back * 0.4));
      }
      break;
    }
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
// 三、子弹属性与行为卡（06 册 3.2.1 的 7 张，名称照抄）
// ─────────────────────────────────────────────────────────────

const ATTRS = [
  { id: 'fire-head', name: '火属性弹头', desc: '灼烧 DoT 8%/s × 2.0s；只主子弹，子子弹不继承火', r: RAMPS.fire, kind: 'fire' },
  { id: 'blast-head', name: '爆炸弹头', desc: '命中 12% 伤害小爆炸，半径 35px；只主子弹', r: RAMPS.bomb, kind: 'blast' },
  { id: 'blast-range', name: '爆炸范围 +100%', desc: '修饰卡：35→70px；无爆炸源则休眠', r: RAMPS.gold, kind: 'range' },
  { id: 'split-hit', name: '命中分裂', desc: '360° 飞出 2-4 颗子子弹，基础伤害 20%；不递归', r: RAMPS.ice, kind: 'split' },
  { id: 'child-20', name: '子子弹伤害 20%', desc: '分裂卡固有基础值（非独立生效）', r: RAMPS.armor, kind: 'child20' },
  { id: 'child-30', name: '子子弹伤害 +30%', desc: '修饰卡：20%→26%；无分裂则休眠', r: RAMPS.volt, kind: 'child30' },
  { id: 'child-blast', name: '子子弹爆炸', desc: '修饰卡：子子弹命中 25px 小爆；无分裂则休眠', r: RAMPS.arcane, kind: 'childblast' },
];

function drawAttr(p, t, c) {
  const D = 1.5, u = wrap(t, D) / D, C = fit(c.r, 7);
  const A = 1 - smooth(0.88, 1, u);
  const travel = clamp(u / 0.32);
  const x = -40 + 76 * travel;
  const hit = u > 0.32, k = clamp((u - 0.32) / 0.68);
  softShape(p, 36, 0, 5, 8, C[2], 0.5, 4);              // 目标

  // 飞行阶段也要读得出属性：不同卡的子弹外观本就不同，不只是命中之后
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
      case 'child20':
        bulletAt(p, C, x, 0, 2, A);
        break;
      case 'child30':
        bulletAt(p, C, x, 0, 2.8, A);
        p.glow(x, 0, 9, C[6], 0.28 * A);
        break;
      case 'childblast':
        bulletAt(p, C, x, 0, 2.4, A);
        p.glowRing(x, 0, 5, 1, C[5], 0.35 * A);
        break;
    }
    return;
  }

  switch (c.kind) {
    case 'fire':                                          // 灼烧：目标身上持续小火
      for (let i = 0; i < 4; i++) {
        const fy = -8 - (k * 16 + i * 4) % 24;
        softShape(p, 36 + Math.sin(k * 9 + i) * 3, fy, 2 + i * 0.4, 3 + i * 0.5, C[5], 0.55 * A);
      }
      p.glow(36, -4, 16, C[4], 0.3 * A);
      break;
    case 'blast': case 'range': {                        // 命中即小爆；range 环更大
      const R = c.kind === 'range' ? 34 : 18;
      p.glowRing(36, 0, 4 + R * k, 3, C[5], 0.5 * A * (1 - k));
      p.glow(36, 0, R * 0.8, C[6], 0.45 * A * (1 - k));
      for (let i = 0; i < 5; i++) {
        const an = i * TAU / 5 + k;
        softShape(p, 36 + Math.cos(an) * R * k, Math.sin(an) * R * k * 0.6, 2, 2, C[5], 0.7 * A * (1 - k));
      }
      if (c.kind === 'range') p.glowRing(36, 0, R, 1, C[3], 0.35 * A); // 半径指示
      break;
    }
    case 'split': {                                       // 360° 子子弹
      for (let i = 0; i < 4; i++) {
        const an = i * TAU / 4 + 0.4;
        const d = 6 + 32 * k;
        bulletAt(p, C, 36 + Math.cos(an) * d, Math.sin(an) * d * 0.7, 1.8, A * (1 - k * 0.5));
      }
      p.glowRing(36, 0, 3 + 10 * k, 2, C[5], 0.35 * A * (1 - k));
      break;
    }
    case 'child20': case 'child30': {                     // 子子弹大小/亮度差异
      const big = c.kind === 'child30';
      for (let i = 0; i < 3; i++) {
        const an = i * TAU / 3 + 0.5, d = 8 + 26 * k;
        softShape(p, 36 + Math.cos(an) * d, Math.sin(an) * d * 0.7,
          big ? 3.2 : 2.2, big ? 2.4 : 1.6, big ? C[6] : C[4], 0.9 * A);
        p.glow(36 + Math.cos(an) * d, Math.sin(an) * d * 0.7, big ? 7 : 4, C[5], 0.25 * A);
      }
      break;
    }
    case 'childblast': {                                  // 每颗子子弹带小爆
      for (let i = 0; i < 3; i++) {
        const an = i * TAU / 3 + 0.5, d = 8 + 26 * k;
        const bx = 36 + Math.cos(an) * d, by = Math.sin(an) * d * 0.7;
        p.glowRing(bx, by, 2 + 8 * k, 2, C[5], 0.4 * A * (1 - k));
        p.glow(bx, by, 6, C[6], 0.25 * A * (1 - k));
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
    case 'muzzle':                                        // 枪口闪光：锥形 + 冲击环
      p.glow(0, 0, 22 + 10 * k, C[5], 0.4 * A);
      for (let i = 0; i < 5; i++) {
        const an = -0.5 + (i / 4) * 1.0;
        p.glowLine(0, 0, Math.cos(an) * (12 + 22 * k), Math.sin(an) * (12 + 22 * k), 3, C[6], 0.35 * A);
      }
      p.glowRing(0, 0, 6 + 16 * k, 2, C[4], 0.35 * A);
      break;
    case 'grenade-boom':                                  // 榴弹落点大爆
      p.glowRing(0, 0, 6 + 40 * k, 4, C[5], 0.5 * A);
      p.glow(0, 0, 34, C[5], 0.35 * A);
      for (let i = 0; i < 8; i++) {
        const an = i * TAU / 8, d = 8 + 34 * k;
        softShape(p, Math.cos(an) * d, Math.sin(an) * d * 0.65, 3 - 1.5 * k, 3 - 1.5 * k, C[6], 0.8 * A);
      }
      for (let i = 0; i < 4; i++) softShape(p, Math.sin(u * 7 + i) * 6, -10 - 16 * k - i * 5, 4 + i, 4 + i, C[2], 0.25 * A);
      break;
    case 'pierce-trail':                                  // 穿透余痕：贯穿线 + 沿途两处命中环
      p.glowLine(-50, 0, 50, 0, 6, C[5], 0.45 * A);
      p.line(-50, 0, 50, 0, C[6], 1);
      for (const hx of [-16, 18]) {
        p.glowRing(hx, 0, 3 + 14 * k, 2, C[4], 0.4 * A);
        p.glow(hx, 0, 12, C[6], 0.3 * A);
      }
      break;
  }
}

export const WEAPON_BLAST_EFFECTS = [
  ...[
    { id: 'muzzle', name: '枪口闪光', desc: '按枪口形态分锥形；3 级里程碑换特效', kind: 'muzzle' },
    { id: 'grenade-boom', name: '榴弹炮落点爆炸', desc: '天生 AOE；半径显著大于武器加成卡的小爆', kind: 'grenade-boom' },
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
