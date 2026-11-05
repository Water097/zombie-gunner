// 进阶特效 —— 消耗碎片升级，跨越一个品级的那一瞬间
//
// 我们没有开箱，只有「碎片 → 升级」。所以这里要做的不是抽卡仪式，
// 而是**一次明确的品质跃迁**：让玩家在 2 秒内看清三件事
//
//   ① 我花掉的碎片喂进去了（碎片向内汇聚 → 蓄力）
//   ② 东西变了（爆闪 → 冲击波 → 光柱，旧色被新色顶掉）
//   ③ 变成了哪一档（新档光效沉降 + 档名浮起）
//
// ── 时间轴（D = 1.9s，one-shot）──────────────────────────────
//   0.00–0.30  吸入：16 片碎屑从四周螺旋内收，颜色由「旧档」渐变到「新档」
//   0.30–0.42  蓄力：中心核点压缩变亮，碎屑全部消失
//   0.42–0.48  爆闪：整屏白，遮住换色那一帧（这是最关键的一步，别让玩家看见硬切）
//   0.48–0.78  冲击波 + 光柱：两圈错时冲击环外扩，竖光柱扫过全身
//   0.60–1.60  沉降：新档的外缘光 / 呼吸光 / 粒子全部接管，档名从下方浮起
//   1.60–1.90  停留
//
// ── 设计纪律 ─────────────────────────────────────────────────
//   · 特效只借用 tiers.mjs 的色阶与光效预算，**不另造一套颜色**——
//     否则「进阶特效的金」和「传说档的金」会不是同一个金。
//   · 武器与装备共用同一条时间轴，只换中间那个图标；差异只在图标尺寸。
//   · 灾厄（第 6 档）额外一段「黑纹蔓延」：从爆闪之后开始爬，到 1.3s 爬满。
//   · 全部是 t 的纯函数，`createFx(mod)` 直接进 demo，升级时 spawn 一次即可。

import { clamp, ease, seg, TAU, INK, frameMeta, makeFx } from './pixel-lib.mjs';
import { tierFx, tierById } from './tiers.mjs';
import { drawWeaponWithTier } from './weapons.mjs';
import { drawGearWithTier } from './equipment.mjs';
import { hex } from '../../vendor/pixelfx/src/core/color.js';

const W = 112, H = 88;
const D = 1.9;

const T_SUCK = 0.30, T_CHARGE = 0.42, T_BURST = 0.48, T_WAVE = 0.62, T_SETTLE = 0.80, T_TEXT = 1.02;

/** 稳定的伪随机：同一个 shard 每次重播位置一致，不会闪。 */
const rnd = (i, s = 1) => {
  const x = Math.sin(i * 12.9898 + s * 78.233) * 43758.5453;
  return x - Math.floor(x);
};

const CRACK = hex('#0a0406');
// 黑纹坐标必须落在该物件的实体上 —— 武器和装备的重心不在一处，各配一套，
// 否则裂纹会飘在半空（这是第一版踩过的坑）。
const CRACKS = {
  // 突击步枪：机匣 + 握把 + 弹匣一带（重心约 x -14, y 2）
  weapon: { cx: -14, cy: 2, lines: [
    [[-26, -4], [-20, 2], [-24, 9]],
    [[-20, 2], [-13, 6], [-10, 12]],
    [[-13, 6], [-7, 1]],
    [[-32, -2], [-27, 3]],
    [[-10, 12], [-15, 15]],
  ] },
  // 胸甲：甲面（重心 0, 0）
  gear: { cx: 0, cy: -1, lines: [
    [[-14, -9], [-8, -3], [-12, 4]],
    [[-8, -3], [-1, 1], [1, 9]],
    [[-1, 1], [7, 4], [12, 0]],
    [[1, 9], [-5, 13]],
    [[7, 4], [10, 11]],
  ] },
};

/** 黑纹：按进度逐段爬出，只落在已画的像素上由调用方保证。 */
function drawCrackProgress(p, k, set) {
  const { cx, cy, lines } = set;
  let budget = k * lines.length;
  for (const line of lines) {
    if (budget <= 0) break;
    const take = Math.min(1, budget);
    budget -= 1;
    for (let s = 1; s < line.length; s++) {
      const [x0, y0] = line[s - 1], [x1, y1] = line[s];
      const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)) || 1;
      for (let i = 0; i <= n * take; i++) {
        p.dot(Math.round(cx + x0 + ((x1 - x0) * i) / n), Math.round(cy + y0 + ((y1 - y0) * i) / n), CRACK, 0.9);
      }
    }
  }
}

/**
 * cfg = { drawIcon: (p, t, T) => void, from: tierId, to: tierId, label: string }
 */
function drawUpgrade(p, t, cfg) {
  const from = tierById(cfg.from), to = tierById(cfg.to);
  const ax = cfg.anchorX ?? 0;   // 视觉重心：武器偏左（枪身重心不在画布中心），胸甲居中

  // ── 1. 本体：爆闪之前是旧档，之后是新档（切换藏在白闪里）──
  cfg.drawIcon(p, cfg.iconT ?? 0.5, t < T_BURST ? from : to);

  // ── 2. 吸入：碎屑螺旋内收，颜色从旧档过渡到新档 ──
  if (t < T_CHARGE) {
    const k = ease.inQuad(clamp(t / T_SUCK));
    const N = 22;
    for (let i = 0; i < N; i++) {
      const a = (i / N) * TAU + t * 3.4 + rnd(i) * 0.7;
      const r0 = 52 + rnd(i, 2) * 12;
      const r = r0 * (1 - k) + 2;
      const al = (1 - k) * 0.85 + 0.15;
      const col = rnd(i, 3) > 0.45 ? to.body[5] : from.body[5];
      // 彗尾：沿半径往回排 3 点，越远越淡 → 有「吸」的方向感
      for (let tail = 0; tail < 3; tail++) {
        const rr = r + tail * (2 + 3 * k);
        const ax = Math.round(Math.cos(a) * rr), ay = Math.round(Math.sin(a) * rr * 0.74);
        p.dot(ax, ay, col, al * (1 - tail * 0.32));
      }
      // 每 4 片里挑一片做 2×2，避免「一盘散沙」
      if (i % 4 === 0) p.rect(Math.round(Math.cos(a) * r) - 1, Math.round(Math.sin(a) * r * 0.74) - 1, 2, 2, col, al * 0.9);
      if (to.num >= 4 && i % 3 === 0) p.glow(Math.round(Math.cos(a) * r), Math.round(Math.sin(a) * r * 0.74), 3, to.body[5], 0.10 * al);
    }
  }

  // ── 3. 蓄力：中心核点压缩变亮 ──
  if (t >= T_SUCK && t < T_BURST) {
    const k = seg(t, T_SUCK, T_BURST);
    p.glow(ax, 0, 8 + 14 * k, to.body[5], 0.55 + 0.5 * k);
    p.disc(ax, 0, 1.5 + 3 * k, to.body[6], 0.98);
    p.glowRing(ax, 0, 12 + 7 * k, 1.5, to.body[5], 0.55 * k);
    p.glowRing(ax, 0, 5 + 4 * k, 1, to.body[6], 0.7 * k);
  }

  // ── 4. 爆闪：整屏白，遮住「旧色 → 新色」的那一帧硬切 ──
  if (t >= T_BURST && t < T_BURST + 0.16) {
    const k = (t - T_BURST) / 0.16;
    // 必须用加色（p.light）：p.rect 的 alpha 走 Bayer 网点，白闪会变成棋盘格
    const a = Math.pow(1 - k, 2.2) * 1.7;
    const w = hex('#ffffff');
    for (let y = -44; y < 44; y++) for (let x = -56; x < 56; x++) p.light(x, y, w, a);
  }

  // ── 5. 冲击波：两圈错时外扩 ──
  for (const [delay, width, alpha] of [[0, 1.8, 0.9], [0.08, 1.1, 0.55]]) {
    const k = (t - T_BURST - delay) / 0.38;
    if (k <= 0 || k >= 1) continue;
    const r = 5 + ease.outQuad(k) * 46;
    p.glowRing(0, 0, r, width, to.body[5], (1 - k) * alpha);
  }

  // ── 6. 光柱：爆闪后一道竖光扫过，把视线钉在中心 ──
  if (t >= T_BURST && t < T_WAVE + 0.18) {
    const k = seg(t, T_BURST, T_WAVE + 0.18);
    const a = Math.sin(k * Math.PI) * 0.6;
    p.glowLine(ax, -44, ax, 44, 3, to.body[5], a);
    p.glowLine(ax, -44, ax, 44, 1, to.body[6], a * 0.85);
  }

  // ── 7. 沉降：新档自己的光效接管（外缘光 / 呼吸光 / 粒子 / 流光）──
  if (t >= T_BURST) {
    const k = seg(t, T_BURST, T_SETTLE);
    tierFx(p, to, t, { cx: 0, cy: 0, rx: 30 * (0.7 + 0.3 * k), ry: 22 * (0.7 + 0.3 * k) });
  }

  // ── 8. 灾厄：黑纹蔓延（这一档的专属收尾）──
  if (to.crack && t >= T_BURST + 0.12) {
    drawCrackProgress(p, seg(t, T_BURST + 0.12, 1.30), CRACKS[cfg.crackSet] ?? CRACKS.weapon);
  }

  // ── 9. 档名：从下方浮起 ──
  if (t >= T_TEXT) {
    const k = seg(t, T_TEXT, T_TEXT + 0.32);
    const y = Math.round(31 - 6 * ease.outQuad(k));
    p.text(cfg.label, 0, y + 1, hex('#000000'), { font: 'big', align: 'center', a: 0.55 * k });
    p.text(cfg.label, 0, y, to.body[6], { font: 'big', align: 'center', a: k });
  }
}

const card = (id, name, spec, fromId, toId, label, icon, extra = {}) => {
  const to = tierById(toId), from = tierById(fromId);
  return {
    id, name, spec,
    mech: `消耗碎片：${from.name} → ${to.name}（品级 ${from.num} → ${to.num}）`,
    read: '碎屑内收 → 蓄力 → 爆闪（换色藏在白闪里）→ 冲击波/光柱 → 新档光效沉降 → 档名浮起',
    source: '内核新写（进阶特效 v1，时间轴共用）',
    demoHook: `upgrade(); → createFx(${id}) · 图标换成任意 item`,
    ...extra,
    mod: makeFx(frameMeta(name, W, H, {
      desc: spec, tags: ['upgrade', id], duration: D, loop: false, fps: 30, oy: H / 2,
    }), (p, t) => drawUpgrade(p, t, {
      drawIcon: (p2, t2, T) => (icon === 'weapon'
        ? drawWeaponWithTier(p2, t2, 'assault', T)
        : drawGearWithTier(p2, t2, 'chest', T)),
      from: fromId, to: toId, label, iconT: icon === 'weapon' ? 0.16 : 0.5, crackSet: icon,
      anchorX: icon === 'weapon' ? -12 : 0,
    })),
  };
};

export const UPGRADE_EFFECTS = [
  card('up-weapon', '武器进阶 · 紫 → 金', '稀有 → 传说｜武器侧，标准进阶',
    'rare', 'legend', 'LEGEND', 'weapon'),
  card('up-gear', '装备进阶 · 蓝 → 紫', '精良 → 稀有｜装备侧，同一条时间轴',
    'fine', 'rare', 'RARE', 'gear'),
  card('up-calamity', '灾厄进阶 · 金 → 赤红', '传说 → 灾厄｜额外「黑纹蔓延」收尾',
    'legend', 'calamity', 'CALAMITY', 'weapon'),
];
