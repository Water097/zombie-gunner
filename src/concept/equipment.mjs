// 装备类别 · 07 册 6 个部位（头肩 / 胸甲 / 腰带 / 鞋子 / 首饰 / 称号）+ 部位总览图
//
// ── 第四版（2026-11-05 重做）─────────────────────────────────
// 第三版的病根不是配色，是几何函数：
//   const disc = (g, cx, cy, r, c) => g.ellipse(cx, cy, r, r, c);
// 但所有调用点都按 6 个参数传（cx, cy, rx, ry, color）→ color 被当成半径吃掉，
// 真正填进网格的是 9 / 17 这种色值，几乎全透明。结果 6 张图全是「空心轮廓」，
// 总览图的人形连头都没有（head 用 disc 画）。这就是「丑」的真实原因。
//
// 本版同时立一份装备图标规范（后续同类必须遵守）：
//   1. 几何：只用 矩形 / 椭圆 / 多边形 / 线 四种形，helper 全部显式签名，禁止色值当参数
//   2. 光向：统一左上打光——左/上用亮档，右/下用暗档，不出现第二光源
//   3. 明暗：每个材质固定 3 档（亮 / 中 / 暗），不用渐变插值
//   4. 描边：统一 1px INK 硬边（Grid.outline），不做半透明羽化
//   5. 材质：钢（次级结构：扣具/鞋底/领口/铆钉）/ 皮革 / 宝石 三种跨部位共用色阶
//   6. 识别：每部位一个主色相（蓝/钢蓝/皮革棕/翠绿/奥术紫/圣金）+ ①–⑥ 编号角标，
//      角标统一「深底 + 部位色环 + 白字」，不再出现 6 个白球
//   7. 尺度：主体控制在 60×60 以内、四周留白 ≥ 10px，缩略图下也读得清
//
// 武器模块在 weapons.mjs，本文件只属于「装备」。

import { wrap, TAU } from '../../vendor/pixelfx/src/core/index.js';
import { hex } from '../../vendor/pixelfx/src/core/color.js';
import { Grid } from '../../vendor/pixelfx/src/fx/critters/_lib.js';
import { frameMeta, makeFx, INK, WHITE } from './pixel-lib.mjs';
import { tierRings, tierCracks, tierFx } from './tiers.mjs';

const W = 112, H = 88;

// ── 材质色阶（显式 7 档，不经过 palettes/fit 重采样，避免命名与实际色值错位）──
const R = (list) => list.map(hex);
const MAT = {
  steel:   R(['#0e1318', '#1a222b', '#2b3644', '#41505f', '#5d6e80', '#8b9aa8', '#c6cfd9']),
  ice:     R(['#0d1b33', '#16305c', '#24509a', '#3b7fd6', '#6fb4f0', '#b3ddff', '#eaf7ff']),
  steelB:  R(['#0f1620', '#1a2536', '#2a3a52', '#3f5474', '#5c77a0', '#8ea9cd', '#d8e6f5']),
  leather: R(['#1d1208', '#3a2412', '#5e3a1c', '#8a5a2a', '#b8843f', '#dfb072', '#f6ddb0']),
  swift:   R(['#08170c', '#10300f', '#1b5216', '#2f8a20', '#57c22c', '#a3e870', '#e2ffc4']),
  arcane:  R(['#1a0d2e', '#331a58', '#562a92', '#7f42c8', '#a86ee8', '#d3a8ff', '#f1e0ff']),
  holy:    R(['#2b1a08', '#563a12', '#8f6520', '#c99a35', '#f0cf7a', '#fff0c0', '#fffdf2']),
  volt:    R(['#241a05', '#4d3408', '#8c5c0d', '#d6a01a', '#f2c94c', '#ffe89a', '#fffbe0']),
};

// 每部位：主色相 r + 点缀色 x
const GEAR = [
  { id: 'head',    num: 1, name: '头肩', axis: '生存 / 要塞血量',       r: MAT.ice,     x: MAT.volt },
  { id: 'chest',   num: 2, name: '胸甲', axis: '生存 / 减伤',           r: MAT.steelB,  x: MAT.volt },
  { id: 'belt',    num: 3, name: '腰带', axis: '节奏 / 换弹速度',       r: MAT.leather, x: MAT.steel },
  { id: 'boots',   num: 4, name: '鞋子', axis: '节奏 / 道具冷却',       r: MAT.swift,   x: MAT.steel },
  { id: 'trinket', num: 5, name: '首饰', axis: '机会 / 局内多一个选择', r: MAT.arcane,  x: MAT.arcane },
  { id: 'title',   num: 6, name: '称号', axis: '规则位 / 修改局内规则', r: MAT.holy,    x: MAT.holy },
];

// ── 显式签名的几何 helper（绝不再允许「色值被当半径吃掉」）──
const box = (g, x, y, w, h, c, a = 0.96) =>
  g.shade(x, y, x + w, y + h, (px, py, o) => { o.a = a; return c; });
const ell = (g, cx, cy, rx, ry, c, a = 0.96) => g.ellipse(cx, cy, rx, ry, c, a);
const inPoly = (x, y, pts) => {
  let hit = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i], [xj, yj] = pts[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi || 1e-9) + xi) hit = !hit;
  }
  return hit;
};
const poly = (g, pts, c, a = 0.96) => {
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  g.shade(Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys), (px, py, o) => {
    if (!inPoly(px, py, pts)) return 0;
    o.a = a; return c;
  });
};
const hole = (g, cx, cy, rx, ry) => {
  g.shade(cx - rx, cy - ry, cx + rx, cy + ry, (x, y) => {
    const nx = (x - cx) / rx, ny = (y - cy) / ry;
    if (nx * nx + ny * ny <= 1) g.erase(Math.floor(x), Math.floor(y));
    return 0;
  });
};
const ring = (g, cx, cy, rx, ry, ri, c) =>
  g.shade(cx - rx, cy - ry, cx + rx, cy + ry, (x, y) => {
    const d = Math.hypot((x - cx) / rx, (y - cy) / ry);
    if (d > 1 || d < ri / rx) return 0;
    return c;
  });
function starPts(cx, cy, Rr, rr, n = 5) {
  const pts = [];
  for (let i = 0; i < 2 * n; i++) {
    const ang = -Math.PI / 2 + (i * Math.PI) / n;
    const rad = i % 2 ? rr : Rr;
    pts.push([cx + Math.cos(ang) * rad, cy + Math.sin(ang) * rad]);
  }
  return pts;
}

const GEAR_GRID = new Grid(-56, -44, W, H);
const MAP_GRID = new Grid(-56, -44, W, H);

// ─────────────────────────────────────────────────────────────
// 6 个部位剪影（只画形体，描边由 drawGear 统一加）
// 光向固定左上：亮档在左/上，暗档在右/下。
// ─────────────────────────────────────────────────────────────
const PARTS = {
  // ① 头肩：全盔（眉檐 + 双眼缝 + 鼻梁 + 顶冠鳍）+ 三片层叠钢护肩 + 钢领轭
  head(g, C, X, S = MAT.steel) {
    for (const s of [-1, 1]) {                 // 护肩：本体同蓝色（同一套甲），钢边只做外缘
      poly(g, [[s * 11, 2], [s * 26, 1], [s * 30, 8], [s * 28, 18], [s * 11, 19]], C[3]);
      poly(g, [[s * 11, 2], [s * 26, 1], [s * 27, 5], [s * 11, 6]], C[5]);       // 顶面受光
      poly(g, [[s * 11, 16], [s * 28, 15], [s * 28, 18], [s * 11, 19]], C[1]);   // 底缘暗
      poly(g, [[s * 26, 1], [s * 30, 8], [s * 28, 18], [s * 26, 16]], S[4]);     // 外缘钢边
      box(g, s * 18 - 1, 9, 2, 2, S[6]);       // 铆钉
    }
    g.outline(INK);
    poly(g, [[-13, 10], [13, 10], [10, 22], [-10, 22]], S[3]);      // 领轭
    poly(g, [[-13, 10], [-4, 10], [-6, 22], [-10, 22]], S[4]);      // 轭左受光
    ell(g, 0, -12, 15, 12, C[3]);                                   // 穹顶
    box(g, -14, -12, 28, 16, C[3]);                                 // 盔身
    ell(g, 0, 3, 14, 6, C[3]);                                      // 下颌圆
    ell(g, -4, -17, 10, 6, C[4]);                                   // 穹顶受光
    ell(g, -7, -20, 5, 3, C[5]);                                    // 高光
    ell(g, 7, 0, 6, 8, C[2]);                                       // 右下暗面
    box(g, -16, -8, 32, 3, C[4]);                                   // 眉檐
    box(g, -14, -5, 28, 9, C[1]);                                   // 面甲凹槽
    box(g, -11, -3, 9, 3, X[3]);  box(g, 2, -3, 9, 3, X[3]);        // 左右眼缝
    box(g, -11, -3, 9, 1, X[5]);  box(g, 2, -3, 9, 1, X[5]);        // 眼缝高光
    box(g, -2, -6, 5, 12, C[4]);                                    // 鼻梁
    box(g, -2, -6, 1, 12, C[5]);                                    // 鼻梁亮棱
    box(g, -12, 6, 24, 3, C[2]);                                    // 下颌线
    poly(g, [[-2, -32], [3, -32], [5, -13], [-1, -13]], X[3]);      // 顶冠鳍
    poly(g, [[-2, -32], [0, -32], [0, -13], [-1, -13]], X[5]);      // 冠鳍亮棱
    box(g, -3, -34, 8, 3, X[4]);                                    // 冠座
  },

  // ② 胸甲：整块板甲（挖领口 + 腋窝）+ 中央脊 + 腹甲 + 仪表灯
  chest(g, C, X, S = MAT.steel) {
    // 整块甲体（钢边）→ 内嵌甲面自带 V 领缺口 → 分面缝 + 中央脊
    const OUT = [[-25, -15], [25, -15], [25, 4], [20, 18], [-20, 18], [-25, 4]];
    poly(g, OUT.map(([x, y]) => [x + 2, y + 2]), S[1]);                     // 右下厚度面
    poly(g, OUT, S[3]);                                                     // 外钢边
    poly(g, [[-22, -12], [-9, -12], [-5, -7], [0, -3], [5, -7], [9, -12], [22, -12], [22, 3], [18, 15], [-18, 15], [-22, 3]], C[3]);
    poly(g, [[-22, -12], [-9, -12], [-5, -7], [0, -3], [-5, -1], [-19, 1], [-22, 3]], C[4]);  // 左受光
    poly(g, [[0, -3], [5, -7], [9, -12], [22, -12], [22, 3], [19, 1], [5, -1]], C[2]);        // 右暗面
    g.line(-9, -12, -5, -7, C[0]); g.line(-5, -7, 0, -3, C[0]);             // 领口内衬暗线
    g.line(9, -12, 5, -7, C[0]);  g.line(5, -7, 0, -3, C[0]);
    box(g, -25, -15, 50, 2, S[5]);                                          // 肩线亮
    box(g, -18, 0, 36, 2, C[1]);                                            // 上下分面缝
    box(g, -17, 9, 34, 2, C[1]);                                            // 腹甲棱
    box(g, -1, -1, 2, 13, C[1]);                                            // 中缝
    box(g, -1, -1, 1, 13, C[2]);
    for (let i = 0; i < 3; i++) box(g, 11, -9 + i * 3, 8, 1, C[1]);         // 右上排气槽
    box(g, 11, 5, 7, 6, C[0]);                                              // 仪表灯座
    box(g, 12, 6, 5, 4, X[3]);
    box(g, 13, 7, 3, 2, X[6]);
    for (const s of [-1, 1]) {                                              // 铆钉
      box(g, s * 19 - 1, -14, 2, 2, S[0]);
      box(g, s * 15 - 1, 15, 2, 2, S[0]);
    }
    g.outline(INK);
  },

  // ③ 腰带：皮革带（缝线 + 调节孔）+ 细框钢扣（扣针自顶梁垂下）
  belt(g, C, X) {
    const S = X;
    box(g, -40, -9, 76, 18, C[3]);                                  // 带体
    box(g, -40, -9, 76, 3, C[5]);                                   // 上沿受光
    box(g, -40, 7, 76, 2, C[1]);                                    // 下沿暗
    for (const x0 of [-40, 14]) box(g, x0, -6, 26, 1, C[2]);        // 压线（扣区两端，不进扣内）
    for (let x = -37; x <= 11; x += 6) box(g, x, -5, 1, 1, C[1]);   // 左段缝脚
    for (let x = 17; x <= 33; x += 6) box(g, x, -5, 1, 1, C[1]);    // 右段缝脚
    for (let x = -37; x <= 11; x += 6) box(g, x, 4, 1, 1, C[1]);
    for (let x = 17; x <= 33; x += 6) box(g, x, 4, 1, 1, C[1]);
    box(g, -13, -13, 26, 3, S[5]);                                  // 扣上梁
    box(g, -13, 11, 26, 3, S[3]);                                   // 扣下梁
    box(g, -13, -13, 3, 27, S[4]);                                  // 扣左柱
    box(g, 10, -13, 3, 27, S[2]);                                   // 扣右柱
    box(g, -1, -10, 2, 18, S[6]);                                   // 扣针
    box(g, -1, -10, 1, 18, S[5]);
    box(g, -4, -14, 8, 4, S[5]);                                    // 针轴座（压在上梁）
    box(g, -4, -14, 8, 1, S[6]);
    for (const x of [20, 27, 34]) {                                 // 调节孔：暗孔 + 上沿受光
      box(g, x, -2, 3, 4, C[0]);
      box(g, x, -3, 3, 1, C[5]);
    }
    poly(g, [[33, -9], [40, -9], [40, 9], [33, 9]], C[4]);           // 带尾受光段
    box(g, 38, -9, 2, 18, C[2]);                                     // 带尾端点
  },

  // ④ 鞋子：侧视长靴（折边筒口 + 气眼鞋带 + 束扣 + 圆鞋头 + 钢底 + 后跟）
  boots(g, C, X) {
    const S = X;
    box(g, -16, -29, 21, 30, C[3]);                                  // 靴筒
    box(g, -16, -29, 6, 30, C[4]);                                   // 筒左受光
    box(g, -17, -31, 23, 3, C[4]);                                   // 折边
    box(g, -17, -31, 23, 1, C[5]);
    box(g, -16, -28, 21, 1, C[1]);                                   // 折边投影
    for (let y = -23; y <= -7; y += 4) {                             // 侧缝走线
      box(g, -14, y, 1, 2, C[1]);
      box(g, 3, y, 1, 2, C[1]);
    }
    box(g, -16, -3, 21, 4, S[3]);                                    // 束带
    box(g, -16, -3, 21, 1, S[5]);
    box(g, -6, -6, 9, 5, S[5]);                                      // 束扣框
    box(g, -4, -5, 5, 3, S[1]);                                      // 扣眼
    poly(g, [[-16, 1], [3, 1], [6, 9], [-18, 9]], C[3]);             // 脚背
    poly(g, [[-16, 1], [3, 1], [1, 4], [-16, 4]], C[4]);             // 脚背受光
    box(g, -18, 7, 34, 9, C[3]);                                     // 脚掌
    ell(g, 16, 11, 7, 5, C[3]);                                      // 圆鞋头
    ell(g, 15, 17, 9, 3, C[1]);                                      // 侧下暗
    ell(g, 14, 8, 5, 2, C[5]);                                       // 鞋头高光
    box(g, -20, 15, 44, 5, S[2]);                                    // 钢底
    box(g, -20, 15, 44, 1, S[4]);
    box(g, -20, 19, 44, 1, S[0]);
    box(g, -20, 11, 7, 5, S[2]);                                     // 后跟块
    box(g, -20, 11, 7, 1, S[4]);
  },

  // ⑤ 首饰：指环（带孔）+ 宽六边宝石（台面 / 侧刻面 / 亭部）+ 双爪 + 戒台
  trinket(g, C, X, S = MAT.steel) {
    ell(g, 0, 10, 16, 15, C[2]);                                     // 环体
    ell(g, 0, 10, 16, 15, C[3]);
    hole(g, 0, 10, 9, 8);                                            // 指孔
    ring(g, 0, 10, 16, 15, 13, C[2]);                                // 外缘暗
    ring(g, 0, 10, 13, 12, 11, C[1]);                                // 内缘暗
    g.shade(-17, -5, 1, 8, (x, y) => {                               // 左上受光弧
      const d = Math.hypot(x / 16, (y - 10) / 15);
      if (d > 1 || d < 0.80 || y > 4) return 0;
      return C[5];
    });
    box(g, -10, -7, 20, 5, C[1]);                                    // 戒台
    box(g, -10, -7, 20, 1, C[4]);
    poly(g, [[0, -23], [9, -14], [0, -4], [-9, -14]], X[3]);            // 菱形宝石主体
    poly(g, [[0, -23], [-9, -14], [0, -14]], X[5]);                     // 左上刻面（受光）
    poly(g, [[0, -23], [9, -14], [0, -14]], X[3]);                      // 右上刻面
    poly(g, [[-9, -14], [0, -14], [0, -4]], X[1]);                      // 左下刻面（暗）
    poly(g, [[9, -14], [0, -14], [0, -4]], X[2]);                       // 右下刻面
    g.line(0, -23, 0, -4, X[6]);                                        // 中棱高光
    g.line(-9, -14, 0, -23, X[6]);                                      // 左上棱高光
    box(g, -1, -24, 2, 2, S[5]);                                        // 上镶爪
  },

  // ⑥ 称号：绶带勋章（顶杆 + 双侧斜切绶带 + 章体 + 五角星）
  title(g, C, X, S = MAT.steel) {
    poly(g, [[-18, -35], [-6, -31], [-2, -6], [-13, -6]], C[3]);     // 左绶带
    poly(g, [[-18, -35], [-15, -35], [-12, -9], [-13, -6]], C[4]);   // 左带外缘受光
    poly(g, [[-13, -30], [-7, -29], [-4, -9], [-11, -9]], C[2]);     // 左带内折暗
    poly(g, [[6, -31], [18, -35], [13, -6], [2, -6]], C[2]);         // 右绶带
    poly(g, [[6, -31], [3, -31], [1, -9], [2, -6]], C[1]);           // 右带内折暗
    box(g, -19, -37, 38, 3, S[4]);                                   // 顶杆
    box(g, -19, -37, 38, 1, S[6]);
    ell(g, 0, 9, 18, 17, C[2]);                                      // 章体底
    ell(g, 0, 9, 17, 16, C[3]);                                      // 章体
    ell(g, -5, 3, 10, 7, C[4]);                                      // 左上受光
    ring(g, 0, 9, 17, 16, 14, C[1]);                                 // 章体暗缘
    ring(g, 0, 9, 13, 12, 12, C[4]);                                 // 内圈亮线
    poly(g, starPts(0, 9, 10, 4.4), C[6]);                           // 五角星
    poly(g, starPts(0, 9, 6, 2.6), C[3]);                            // 星心压暗
  },
};

// ── 光效：只做「材质该发光的地方」，范围小、不糊 ──
const GLOWS = {
  head:    (p, X, b) => { p.glowLine(-11, -2 + b, -2, -2 + b, 1.5, X[4], 0.5); p.glowLine(2, -2 + b, 11, -2 + b, 1.5, X[4], 0.5); },
  chest:   (p, X, b) => { p.glow(13, 7 + b, 7, X[4], 0.34); },
  belt:    () => {},
  boots:   () => {},
  trinket: (p, X, b) => { p.glow(0, -12 + b, 8, X[4], 0.26); },
  title:   (p, X, b) => { p.glow(0, 9 + b, 12, X[5], 0.26); },
};

/** ①–⑥ 角标：深底 + 部位色环 + 白字（全类别统一） */
function drawBadge(p, num, C) {
  const bx = -45, by = -33;
  p.disc(bx, by, 9, INK, 1);
  p.disc(bx, by, 7, C[1], 1);
  p.glowRing(bx, by, 8, 1.6, C[5], 0.55);
  p.text(String(num), bx, by - 2, WHITE, { font: 'mini', align: 'center', a: 1 });
}

function drawGear(p, t, c, T = null) {
  const u = wrap(t, 2.4) / 2.4;
  const bob = Math.round(Math.sin(u * TAU) * 1.2);
  // 品级覆盖配色（剪影一行不动）：本体色阶与亮点色都换成档位色
  const C = T ? T.body : c.r;
  const X = T ? T.accent : c.x;
  GEAR_GRID.clear();
  PARTS[c.id](GEAR_GRID, C, X, T ? T.struct : MAT.steel);
  GEAR_GRID.outline(() => INK);                  // 1px 硬边
  tierRings(GEAR_GRID, T);                       // 品级外缘光（0/1/2 圈）
  tierCracks(GEAR_GRID, T, 0, -2, 20);           // 灾厄黑纹（其他档自动跳过）
  GEAR_GRID.draw(p, 1, 0, bob);
  GLOWS[c.id](p, X, bob);
  tierFx(p, T, t, { cx: 0, cy: bob, rx: 32, ry: 24 });
  drawBadge(p, c.num, T ? T.accent : c.r);
}

/** 供品级对照卡复用：按部位 id + 品级画一张。 */
export function drawGearWithTier(p, t, partId, T) {
  const c = GEAR.find((g) => g.id === partId) ?? GEAR[0];
  drawGear(p, t, c, T);
}

// ── 装备部位总览：人形居中，6 个编号槽位排在两侧列，引线指到部位 ──
const MAP_SLOTS = [
  { x: -38, y: -28, r: MAT.ice,     n: 1, lx: -13, ly: -28 },  // 头肩 → 头盔左侧
  { x: -40, y: -8,  r: MAT.steelB,  n: 2, lx: -18, ly: -8  },  // 胸甲 → 胸甲左侧
  { x: -40, y: 12,  r: MAT.leather, n: 3, lx: -12, ly: 12  },  // 腰带 → 腰部左侧
  { x: -38, y: 32,  r: MAT.swift,   n: 4, lx: -11, ly: 31  },  // 鞋子 → 左脚外侧
  { x: 38,  y: -18, r: MAT.arcane,  n: 5, lx: 19,  ly: -14 },  // 首饰（悬浮位）
  { x: 38,  y: 12,  r: MAT.holy,    n: 6, lx: 15,  ly: 6   },  // 称号（悬浮位）
];

function drawMap(p) {
  const S = MAT.steel, T = MAT.steelB;
  MAP_GRID.clear();
  box(MAP_GRID, -2, -20, 5, 5, S[2]);                                       // 颈
  ell(MAP_GRID, 0, -28, 8, 9, S[4]);                                        // 头
  ell(MAP_GRID, -2, -31, 5, 4, S[5]);
  poly(MAP_GRID, [[-12, -19], [12, -19], [9, 7], [-9, 7]], T[3]);           // 躯干
  poly(MAP_GRID, [[-12, -19], [-2, -19], [-2, 7], [-9, 7]], T[4]);          // 躯干左受光
  box(MAP_GRID, -19, -17, 6, 21, S[3]); box(MAP_GRID, 13, -17, 6, 21, S[3]); // 双臂
  box(MAP_GRID, -10, 7, 20, 5, S[2]);                                       // 胯
  box(MAP_GRID, -9, 11, 7, 20, S[3]); box(MAP_GRID, 2, 11, 7, 20, S[3]);    // 双腿
  box(MAP_GRID, -11, 30, 10, 4, S[1]); box(MAP_GRID, 1, 30, 10, 4, S[1]);   // 双脚
  MAP_GRID.outline(() => INK);
  MAP_GRID.draw(p, 1, 0, 0);

  for (const s of MAP_SLOTS) {
    const dx = s.lx - s.x, dy = s.ly - s.y, L = Math.hypot(dx, dy) || 1;
    p.glowLine(s.x + (dx / L) * 9, s.y + (dy / L) * 9, s.lx, s.ly, 1, MAT.steel[2], 0.85);
    p.disc(s.x, s.y, 9, INK, 1);
    p.disc(s.x, s.y, 7, s.r[3], 1);
    p.glowRing(s.x, s.y, 8, 1.6, s.r[5], 0.5);
    p.text(String(s.n), s.x, s.y - 2, WHITE, { font: 'mini', align: 'center', a: 1 });
  }
}

const MAP_ITEM = {
  id: 'gear-map', name: '装备部位总览', spec: '07 册 6 部位在人形上的落点',
  mech: '①头肩 ②胸甲 ③腰带 ④鞋子 ⑤首饰(悬浮) ⑥称号(悬浮)；同部位只能穿 1 件',
  read: '人形居中 + 两侧编号色标槽位 + 引线定位，缩略图也分得清',
  source: '内核新写（Grid 人形 + 编号槽位）',
  demoHook: '装备界面 → 槽位高亮',
  mod: {
    meta: frameMeta('装备部位总览', W, H, { desc: '人形 + 6 编号槽位', tags: ['gear', 'map'], duration: 4, loop: true, fps: 24, oy: H / 2 }),
    draw: (p) => drawMap(p),
  },
};

export const GEAR_EFFECTS = [
  MAP_ITEM,
  ...GEAR.map((c) => ({
    id: c.id, name: c.name, spec: c.axis, mech: c.axis,
    read: '三档明暗 + 1px INK 描边 + 部位色编号角标（规范见文件头）',
    source: '内核新写（装备图标规范 v1）',
    demoHook: `gear.slot === '${c.id}' → drawGearIcon()`,
    mod: makeFx(frameMeta(c.name, W, H, {
      desc: `${c.axis}｜6 部位之一，同部位只能穿 1 件`, tags: ['gear', c.id], duration: 2.4, oy: H / 2,
    }), (p, t) => drawGear(p, t, c)),
  })),
];
