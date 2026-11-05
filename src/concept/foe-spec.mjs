// 敌人剪影规范 —— 让敌人「在任何技能光效上都读得出来」
//
// 起因：同屏叠加测试里发现，燃烧地带一烧起来，站在火里的敌人就数不清了。
// 根因不是技能太亮，是**敌人没有自己的对比锚点**：它和背景都是暗的，一亮就被吃掉。
//
// 按参考图（`Desktop/新建文件夹/篮球僵尸…`）提炼出这套规范：
//
//   1. 头身比 1 : 2.4 —— 头高约占全身 41%，僵尸是「大头小身」，远看先看到头
//   2. 全轮廓 1px 深色描边（#0a0c10）—— 这是敌人唯一的对比锚点，任何光效下都保留
//   3. 肤色是唯一高饱和区（脏绿），衣物压到近黑 —— 亮底上「暗衣 + 亮头」永远可读
//   4. 身高 26px（画布 88 高时约占 1/3），体型差异靠肩宽 / 腿长 / 前倾做，不靠颜色
//   5. 所有敌人在同一套骨骼上做加减 —— 认得出是一族，又分得清是哪只
//
// 本文件产出 3 张卡：
//   ① 5 种体型并排（规范总览）
//   ② 同一具剪影压在 火 / 冰 / 雷 / 暗 四种底上（对比度压测）
//   ③ 受击 / 死亡反馈（闪白 → 描边亮 → 塌陷）

import { frameMeta, makeFx } from './pixel-lib.mjs';
import { hex } from '../../vendor/pixelfx/src/core/color.js';
import { Grid } from '../../vendor/pixelfx/src/fx/critters/_lib.js';
import { R, GROUND, rnd } from './skill-lib.mjs';
import { wrap, TAU } from '../../vendor/pixelfx/src/core/index.js';

const W = 112, H = 88;

const OUT = hex('#0a0c10');
const SKIN = R(['#2f4a2c', '#4e7345', '#6f9a63', '#a8c99a', '#d6ecc8']);
const CLOTH = R(['#12161d', '#1b2029', '#262d3a', '#343d4d', '#4a5568']);
const EYE = hex('#e8d24a');
const BONE = hex('#cfc7b4');

// 体型参数：head=头半径, sh=肩宽, torso=躯干高, leg=腿高, lean=前倾像素
const TYPES = [
  { id: 'normal', name: '普通', head: 5.6, sh: 8, torso: 10, leg: 6, lean: 0,
    note: '基准体型：直立、头最大、短腿' },
  { id: 'swift', name: '疾行', head: 5.0, sh: 7, torso: 9, leg: 9, lean: 2,
    note: '前倾 + 长腿：剪影重心往前压，一眼看出「它在冲」' },
  { id: 'armor', name: '装甲', head: 4.8, sh: 12, torso: 11, leg: 5, lean: 0,
    note: '宽肩厚躯干 + 更小的头：用「宽度」而不是「颜色」表达硬度' },
  { id: 'bomber', name: '自爆', head: 5.2, sh: 11, torso: 9, leg: 4, lean: 0,
    note: '圆腹 + 短腿：肚子鼓出来，天然和别的体型分开' },
  { id: 'ranged', name: '远程', head: 5.6, sh: 7, torso: 10, leg: 6, lean: -1,
    note: '单手持物：手上有块圆东西，读「远程」不用看颜色' },
];

const G = new Grid(-22, -36, 44, 42);   // 脚底 y=0，头顶 y≈-28

/** 按规范画一具敌人剪影（局部坐标：脚底 (0,0)）。state: 0 常态 / 1 受击 / 2 死亡 */
function figure(g, t, state = 0) {
  const h = t.head, sh = t.sh / 2, torso = t.torso, leg = t.leg, lean = t.lean;
  const skew = (y) => (y < -leg - torso ? lean : 0);   // 前倾只影响上半身

  const bodyY = -leg,           // 躯干底
        shoulderY = -leg - torso,
        headY = shoulderY - h + 1;

  // 死亡：整体压扁（高度 ×0.45）
  const squash = state === 2 ? 0.45 : 1;
  const Y = (y) => Math.round(y * squash);

  // 腿（两根，粗 2px，中间留缝）
  for (const s of [-1, 1]) {
    const lx = s * 2.6;
    g.shade(lx - 1, Y(-leg), lx + 1, Y(0), () => CLOTH[1]);
  }
  // 躯干（梯形：肩宽 → 腰窄）+ 圆肩
  const waist = sh * 0.76;
  g.shade(-sh, Y(shoulderY), sh, Y(bodyY), (x, y) => {
    const k = (y - Y(shoulderY)) / Math.max(1, Y(bodyY) - Y(shoulderY));
    const half = sh + (waist - sh) * k;
    return Math.abs(x) <= half ? CLOTH[2] : 0;
  });
  g.ellipse(0, Y(shoulderY), sh, 2.2, CLOTH[2]);           // 圆肩，避免「方块人」
  // 手臂
  for (const s of [-1, 1]) {
    const ax = s * (sh + 1.4);
    g.shade(ax - 1, Y(shoulderY + 1), ax + 1, Y(bodyY - 1), () => CLOTH[1]);
  }
  // 头（圆 + 头顶乱发）
  const hx = lean;
  g.ellipse(hx, Y(headY), h, h * 1.06, SKIN[2]);
  g.ellipse(hx - 1.4, Y(headY) - 1.4, h * 0.62, h * 0.58, SKIN[3]);   // 受光
  // 乱发：头顶三块
  for (let i = -1; i <= 1; i++) {
    g.ellipse(hx + i * h * 0.5, Y(headY) - h * 0.82, h * 0.42, h * 0.30, CLOTH[0]);
  }
  // 眼睛（黄色，唯一的高饱和点）
  for (const s of [-1, 1]) g.set(hx + s * h * 0.36, Y(headY) + 0.5, EYE, 1);

  // 体型附加件
  if (t.id === 'bomber') {
    g.ellipse(0, Y(bodyY) - 2, sh * 1.02, 3.4, CLOTH[3]);            // 圆腹
    g.ellipse(0, Y(bodyY) - 1, 2.2, 2.0, hex('#8a3a2a'));            // 肚上的炸弹
  }
  if (t.id === 'ranged') {
    g.ellipse(sh + 3.5, Y(shoulderY + 3), 2.4, 2.4, hex('#b4632e')); // 手上的球
  }
  if (t.id === 'armor') {
    for (let i = 0; i < 2; i++) {                                    // 肩甲块
      const s = i ? 1 : -1;
      g.shade(s * (sh - 1), Y(shoulderY) - 1, s * (sh + 2), Y(shoulderY + 3), () => CLOTH[4]);
    }
  }
  if (t.id === 'swift') {
    g.shade(-sh - 1, Y(shoulderY) - 1, -sh + 2, Y(shoulderY + 2), () => SKIN[1]); // 露出的肩
  }
}

/**
 * 把一具剪影画到画笔上。
 * 规范第 2 条：**描边必须在所有光效之后依然可见**，所以受击时描边会被提亮成白色，
 * 而不是整体盖一层白光（盖白光会让它和爆炸混在一起）。
 */
function putFoe(p, x, y, t, state = 0, tsec = 0) {
  G.clear();
  figure(G, t, state);
  G.outline((px, py, nx, ny) => (state === 1 ? hex('#ffffff') : ny > 0 ? OUT : hex('#06070a')));
  // 地面投影（只在没死的时候）
  if (state !== 2) p.ellipse(x, y + 1, t.sh * 0.55, 2, OUT, 0.42);
  G.draw(p, 1, x, y);

  // 受击：只提亮描边 + 小范围闪白，不给整只盖白光
  if (state === 1) p.disc(x, y - 12, 10, hex('#ffffff'), 0.14);
}

// ─────────────────────────────────────────────────────────────
// ① 规范总览：5 种体型并排 + 身高刻度 + 头身比标注
// ─────────────────────────────────────────────────────────────
function drawSpec(p, t) {
  const u = wrap(t, 3) / 3;
  // 地面
  p.rect(-52, GROUND, 104, 1, hex('#2a3140'), 1);
  p.rect(-52, GROUND + 1, 104, 1, hex('#141922'), 1);

  const xs = [-42, -21, 0, 21, 42];
  TYPES.forEach((tp, i) => {
    const bob = Math.round(Math.sin(u * TAU + i * 1.3) * 1);
    putFoe(p, xs[i], GROUND, tp, 0, t);
    // 序号
    p.text(String(i + 1), xs[i], GROUND + 5, hex('#8b9aa8'), { font: 'mini', align: 'center', a: 1 });
  });

  // 身高刻度（左侧 26px 标尺）
  p.rect(-50, GROUND - 26, 1, 26, hex('#3d4757'), 1);
  p.rect(-52, GROUND - 26, 3, 1, hex('#3d4757'), 1);
  p.rect(-52, GROUND, 3, 1, hex('#3d4757'), 1);
  p.text('26', -47, GROUND + 6, hex('#7c879a'), { font: 'mini' });

  // 头身比：底部一行说明（画布太小，不画括号了）
  p.text('HEAD 1:2.4', 8, GROUND + 12, hex('#b4623e'), { font: 'mini' });
}

// ─────────────────────────────────────────────────────────────
// ② 对比度压测：同一具剪影压在 4 种技能光效底上
// ─────────────────────────────────────────────────────────────
function drawContrast(p, t) {
  const u = wrap(t, 3) / 3;
  const cells = [
    { x: -28, y: -10, label: 'FIRE', bg: ['#a83013', '#dd5218', '#ff8a34'] },
    { x: 28, y: -10, label: 'ICE', bg: ['#16618f', '#2a9bd4', '#b8ecff'] },
    { x: -28, y: 22, label: 'VOLT', bg: ['#3a2c96', '#8b7af0', '#f2eeff'] },
    { x: 28, y: 22, label: 'DARK', bg: ['#181c24', '#232936', '#2e3546'] },
  ];
  for (const c of cells) {
    // 底色块
    p.rect(c.x - 22, c.y - 16, 44, 32, hex(c.bg[0]), 1);
    p.ellipse(c.x, c.y + 6, 20, 7, hex(c.bg[1]), 1);
    // 光斑（模拟技能亮度）
    p.glow(c.x, c.y + 2, 22, hex(c.bg[2]), 0.35 + 0.2 * Math.sin(u * TAU));
    // 同一具剪影
    putFoe(p, c.x, c.y + 14, TYPES[0], 0, t);
    p.text(c.label, c.x - 20, c.y - 15, hex('#aab4c2'), { font: 'mini' });
  }
}

// ─────────────────────────────────────────────────────────────
// ③ 受击 / 死亡反馈：三帧对照
// ─────────────────────────────────────────────────────────────
function drawHit(p, t) {
  const u = wrap(t, 2.4) / 2.4;
  const xs = [-34, 0, 34];
  p.rect(-52, GROUND, 104, 1, hex('#2a3140'), 1);

  // 0.0–0.33 常态 / 0.33–0.66 受击 / 0.66–1 死亡
  const phase = Math.floor(u * 3);
  xs.forEach((x, i) => {
    // 让三帧同时出现（示意），但只有当前帧是「活的」
    putFoe(p, x, GROUND, TYPES[i === 1 ? 2 : 0], i === 2 ? 2 : 0, t);
  });
  // 中间那具做受击演示
  putFoe(p, xs[1], GROUND, TYPES[0], phase === 1 ? 1 : 0, t);

  p.text('HIT', xs[1] - 8, GROUND + 5, hex('#ffd98a'), { font: 'mini' });
  p.text('DEAD', xs[2] - 10, GROUND + 5, hex('#6b7585'), { font: 'mini' });
  p.text('IDLE', xs[0] - 10, GROUND + 5, hex('#6b7585'), { font: 'mini' });
}

const card = (id, name, spec, read, draw) => ({
  id, name, spec, mech: read,
  read: '剪影规范 v1：头身比 1:2.4 / 1px 深描边 / 肤色为唯一高饱和区 / 体型靠宽度与倾角区分',
  source: '内核新写（按参考图提炼）',
  demoHook: '敌人生成 → drawFoe(type)',
  mod: makeFx(frameMeta(name, W, H, {
    desc: spec, tags: ['foe', id], duration: 3, loop: true, fps: 24, oy: H / 2,
  }), draw),
});

export const FOE_SPEC_EFFECTS = [
  card('foe-spec', '敌人剪影规范 · 5 种体型', '普通 / 疾行 / 装甲 / 自爆 / 远程',
    '同一套骨骼做加减：肩宽、腿长、前倾、附加件——不靠颜色区分', drawSpec),
  card('foe-contrast', '敌人剪影 · 对比度压测', '同一具剪影压在 火 / 冰 / 雷 / 暗 四种底上',
    '判据：四种底上都必须能一眼数出「这里有一个人」', drawContrast),
  card('foe-hit', '敌人剪影 · 受击与死亡', '描边提亮闪白 / 死亡压扁',
    '受击只提亮描边、不盖白光——盖白光会跟爆炸糊在一起', drawHit),
];
