// 装备类别 · 07 册 6 个部位（头肩 / 胸甲 / 腰带 / 鞋子 / 首饰 / 称号）
//
// 第二版（2026-11-05）：原版用 p.rect/p.poly/p.circle 的硬像素块拼接，既像素化又难辨认。
// 改法与武器侧一致——softShape 真半透明逐点填充（无 Bayer 网点）做平滑形体 +
// 三层明暗 + 加色 rim 光 + 柔和投影，把每个部位重画成一眼可辨的剪影。
// 武器模块在 weapons.mjs，本文件只属于「装备」。

import { INK, WHITE, TAU, wrap, clamp, RAMPS, frameMeta, makeFx } from './pixel-lib.mjs';

const W = 112, H = 80;

// ── 柔化画刷（与 weapons.mjs 同源：真半透明 blend，不产生网点噪点） ──
function softShape(p, cx, cy, rx, ry, c, a, n = 2) {
  if (a <= 0 || rx <= 0 || ry <= 0) return;
  const X = Math.ceil(rx), Y = Math.ceil(ry);
  for (let y = -Y; y <= Y; y++)
    for (let x = -X; x <= X; x++) {
      const d = Math.pow(Math.abs(x) / rx, n) + Math.pow(Math.abs(y) / ry, n);
      if (d > 1) continue;
      p.blend(cx + x, cy + y, c, a * clamp(1 - 0.12 * d));
    }
}

/** 实心环形（戒指 / 环带用），逐点 blend，无网点。 */
function fillRing(p, cx, cy, ro, ri, c, a) {
  const X = Math.ceil(ro);
  for (let y = -X; y <= X; y++)
    for (let x = -X; x <= X; x++) {
      const d = Math.hypot(x, y);
      if (d > ro || d < ri) continue;
      p.blend(cx + x, cy + y, c, a);
    }
}

/**
 * 三层明暗体：暗底 → 受光面 → 左上高光，叠加出平滑的金属/宝石质感（无网点）。
 * ox/oy 是光源偏移，负数 = 左上方打光。
 */
function shadeBody(p, cx, cy, rx, ry, R, o = {}) {
  const n = o.n ?? 2, a = o.a ?? 1, ox = o.ox ?? -1.5, oy = o.oy ?? -1.8;
  softShape(p, cx, cy, rx, ry, R[2], a, n);
  softShape(p, cx + ox, cy + oy, rx * 0.82, ry * 0.8, R[4], a * 0.9, n);
  softShape(p, cx + ox * 1.6, cy + oy * 1.6, rx * 0.5, ry * 0.5, R[6], a * 0.85, n);
}

/** 五芒星（称号铭牌用）：实暗衬底 + 亮填充，在压暗的旗面上保证高对比、不冲白。 */
function star(p, cx, cy, R, r, cOut, cIn) {
  const back = [];
  for (let i = 0; i < 10; i++) {
    const ang = -Math.PI / 2 + i * Math.PI / 5;
    const rad = (i % 2 ? r : R) * 1.22;
    back.push([cx + Math.cos(ang) * rad, cy + Math.sin(ang) * rad]);
  }
  p.poly(back, INK, 0.72);
  const pts = [];
  for (let i = 0; i < 10; i++) {
    const ang = -Math.PI / 2 + i * Math.PI / 5;
    const rad = i % 2 ? r : R;
    pts.push([cx + Math.cos(ang) * rad, cy + Math.sin(ang) * rad]);
  }
  p.poly(pts, cOut, 1);
  p.glow(cx, cy, 4, cIn, 0.35);
}

// ── 6 个部位的剪影：每个重画成一眼可辨的形态 ──
function glyphFor(id) {
  return (p, cx, cy, R, A) => {
    switch (id) {
      case 'head': {                                  // 头肩：头盔（面甲 + 顶冠）+ 两侧护肩
        p.glow(cx, cy + 3, 18, INK, 0.16);
        shadeBody(p, cx - 18, cy + 14, 9, 7, R, { ox: -1, oy: -1, n: 2.2 });
        shadeBody(p, cx + 18, cy + 14, 9, 7, R, { ox: -1, oy: -1, n: 2.2 });
        p.glowRing(cx - 18, cy + 14, 9, 1.4, A[5], 0.32);
        p.glowRing(cx + 18, cy + 14, 9, 1.4, A[5], 0.32);
        shadeBody(p, cx, cy - 3, 16, 15, R, { ox: -2, oy: -2 });
        softShape(p, cx - 4, cy - 7, 8, 8, R[6], 0.85, 2);            // 头盔高光（提亮）
        p.glowRing(cx, cy - 3, 16, 1.6, A[5], 0.38);
        softShape(p, cx, cy + 6, 12, 4, INK, 0.8);    // 面甲暗缝
        p.glowLine(cx - 10, cy + 6, cx + 10, cy + 6, 2.2, A[6], 0.7);  // HUD 面甲光
        p.glow(cx, cy + 6, 13, A[5], 0.45);
        softShape(p, cx, cy - 15, 4, 5, A[6], 0.9);    // 顶冠
        break;
      }
      case 'chest': {                                  // 胸甲：躯干剪影（宽肩→收腰→微展髋）+ 强 V 领 + 高对比甲片刻线 + 金黄核
        p.glow(cx, cy + 3, 20, INK, 0.16);
        p.poly([[cx - 14, cy - 12], [cx + 14, cy - 12], [cx + 10, cy - 1], [cx + 8, cy + 9],
                [cx + 12, cy + 15], [cx - 12, cy + 15], [cx - 8, cy + 9], [cx - 10, cy - 1]], R[2], 1);  // 躯干多边形
        softShape(p, cx, cy - 2, 11, 11, R[3], 0.9, 2);              // 板甲面（受光区）
        softShape(p, cx - 3, cy - 6, 7, 8, R[5], 0.85, 2);           // 左上受光
        softShape(p, cx - 4, cy - 8, 4, 5, R[6], 0.85, 2);           // 高光
        p.poly([[cx - 8, cy - 13], [cx + 8, cy - 13], [cx, cy - 3]], INK, 0.78);  // 强 V 领（深 notch）
        p.glowLine(cx, cy - 3, cx, cy + 14, 2.4, A[7], 0.75);          // 中缝（亮刻线，加粗）
        p.glowLine(cx - 1, cy - 3, cx - 1, cy + 14, 1.5, R[0], 0.55);// 中缝暗影
        p.glowLine(cx - 9, cy + 1, cx - 2, cy + 10, 2.4, A[7], 0.62); // 左胸片
        p.glowLine(cx + 9, cy + 1, cx + 2, cy + 10, 2.4, A[7], 0.62); // 右胸片
        p.glowLine(cx - 8, cy + 11, cx + 8, cy + 11, 2.4, A[7], 0.62);// 腰线
        softShape(p, cx, cy + 3, 3.4, 3.4, A[6], 1);                 // 能量核（金黄 accent）
        p.glow(cx, cy + 3, 7, A[5], 0.5);
        p.glowRing(cx, cy + 3, 3.4, 1.3, A[7], 0.6);
        break;
      }
      case 'belt': {                                   // 腰带：横带（提亮）+ 大金属扣 + 扣两侧实心暗孔（绘于扣后、避开口面）
        p.glow(cx, cy + 6, 22, INK, 0.16);
        softShape(p, cx, cy + 4, 22, 7, R[3], 1, 3);
        softShape(p, cx, cy + 3, 20, 5, R[5], 0.92, 3);
        softShape(p, cx, cy + 2, 17, 3, R[6], 0.85, 3);
        p.glowRing(cx, cy + 4, 22, 1.6, A[5], 0.4);
        softShape(p, cx, cy + 4, 9, 10, A[4], 1, 2.5);                // 扣外框（暗金）
        softShape(p, cx, cy + 4, 6.5, 7.5, A[6], 0.95, 2.5);          // 扣面（亮金）
        softShape(p, cx, cy + 4, 4, 5, INK, 0.7, 2.5);                // 扣眼
        p.glowLine(cx, cy - 5, cx, cy + 13, 2.2, A[7], 0.9);          // 扣针
        p.glowRing(cx, cy + 4, 9, 1.6, A[7], 0.6);
        for (const hx of [-17, -13, 13, 17]) softShape(p, cx + hx, cy + 4, 2.6, 2.6, INK, 1);  // 实心暗孔（每侧2个，落在带内实心区、避开扣）
        break;
      }
      case 'boots': {                                  // 鞋子：单只靴（竖直靴筒 + 向右外伸靴头 + 后跟 + 整条鞋底 + 束带）
        p.glow(cx, cy + 6, 22, INK, 0.16);
        softShape(p, cx - 4, cy - 2, 6, 14, R[2], 1, 2.2);            // 靴筒（竖直）
        softShape(p, cx - 5, cy - 5, 3, 11, R[6], 0.7, 2.2);          // 筒口高光
        softShape(p, cx + 5, cy + 12, 12, 7, R[4], 1, 2.2);           // 靴头（向右外伸）
        softShape(p, cx + 7, cy + 11, 8, 4, R[5], 0.85, 2.2);         // 靴头受光
        softShape(p, cx - 9, cy + 13, 4, 6, R[1], 1, 2);              // 鞋跟（左后）
        p.glowLine(cx - 12, cy + 18, cx + 17, cy + 18, 2.8, R[0], 0.8);  // 鞋底（整条）
        p.glowLine(cx - 7, cy + 1, cx - 1, cy + 1, 1.6, A[5], 0.6);   // 束带
        p.glowLine(cx - 7, cy + 6, cx - 1, cy + 6, 1.6, A[5], 0.6);
        p.glowRing(cx + 5, cy + 12, 12, 1.4, A[5], 0.3);
        break;
      }
      case 'trinket': {                                // 首饰：戒指 + 宝石
        p.glow(cx, cy + 6, 16, INK, 0.16);
        fillRing(p, cx, cy + 5, 12, 6.5, R[5], 1);                  // 戒环
        fillRing(p, cx, cy + 4, 10.5, 7.5, R[6], 0.85);             // 受光内圈
        p.glowRing(cx, cy + 5, 12, 1.5, A[6], 0.5);                 // rim
        const gy = cy - 9;
        p.poly([[cx, gy - 7], [cx + 5, gy], [cx, gy + 7], [cx - 5, gy]], A[6], 1);  // 宝石本体
        p.poly([[cx, gy - 7], [cx + 5, gy], [cx, gy]], A[7], 0.95);                 // 右上刻面
        p.poly([[cx, gy + 7], [cx + 5, gy], [cx, gy]], A[4], 0.9);                  // 右下刻面
        p.poly([[cx, gy - 7], [cx - 5, gy], [cx, gy]], A[5], 0.95);                 // 左上刻面
        softShape(p, cx - 1.5, gy - 2, 1.8, 2.2, WHITE, 0.85);                      // 高光
        p.glow(cx, gy, 12, A[5], 0.6);
        break;
      }
      default: {                                       // 称号：横幅 + 顶杆 + 五角星 + 缎带
        p.glow(cx, cy + 3, 18, INK, 0.16);
        p.poly([[cx - 13, cy + 6], [cx - 5, cy + 6], [cx - 9, cy + 18]], A[3], 0.95);  // 左缎带
        p.poly([[cx + 13, cy + 6], [cx + 5, cy + 6], [cx + 9, cy + 18]], A[3], 0.95);  // 右缎带
        softShape(p, cx, cy - 2, 14, 16, R[1], 1, 3);                 // 旗面深底（中心保持暗）
        softShape(p, cx, cy - 7, 11, 8, R[3], 0.9, 3);                // 仅上部受光，中心不亮
        p.glowRing(cx, cy - 2, 14, 1.6, A[5], 0.35);
        softShape(p, cx, cy - 16, 17, 3, R[6], 1, 2);                  // 顶杆
        p.glowLine(cx - 15, cy - 16, cx + 15, cy - 16, 2, R[7], 0.6);
        star(p, cx, cy - 1, 8.5, 3.6, A[6], A[4]);                     // 亮星 + 暗衬底，压暗背景托出
        break;
      }
    }
  };
}

const GEAR = [
  { id: 'head', name: '头肩', axis: '生存 / 要塞血量', r: RAMPS.armor, a: RAMPS.ice },
  { id: 'chest', name: '胸甲', axis: '生存 / 减伤', r: RAMPS.armor, a: RAMPS.volt },
  { id: 'belt', name: '腰带', axis: '节奏 / 换弹速度', r: RAMPS.metal, a: RAMPS.gold },
  { id: 'boots', name: '鞋子', axis: '节奏 / 道具冷却', r: RAMPS.metal, a: RAMPS.swift },
  { id: 'trinket', name: '首饰', axis: '机会 / 局内多一个选择', r: RAMPS.gold, a: RAMPS.arcane },
  { id: 'title', name: '称号', axis: '规则位 / 修改局内规则', r: RAMPS.holy, a: RAMPS.holy },
];

function drawGear(p, t, c) {
  const u = wrap(t, 2.0) / 2.0;
  const bob = Math.sin(u * TAU) * 1.4;
  const R = c.r, A = c.a;
  const cx = 0, cy = bob;
  // 精炼卡片面板（圆角矩形超椭圆 + 双层 rim 光 + 四角铆钉 + 扫光）
  softShape(p, cx, cy, 27, 29, A[1], 0.92, 4);
  softShape(p, cx, cy, 25, 27, A[2], 0.85, 4);
  p.glowRing(cx, cy, 26, 2, A[4], 0.45);
  p.glowRing(cx, cy, 24, 1.2, A[6], 0.4);
  for (const [gx, gy] of [[-23, -25], [23, -25], [-23, 25], [23, 25]]) {
    p.glow(gx, gy + cy, 5, A[6], 0.55);
    p.blend(gx, gy + cy, A[7], 0.9);
  }
  glyphFor(c.id)(p, cx, cy, R, A);
  const sx = -25 + 64 * wrap(u + 0.15, 1);
  p.glowLine(sx, -27 + cy, sx, 27 + cy, 3, A[7], 0.16);
}

export const GEAR_EFFECTS = GEAR.map((c) => ({
  id: c.id, name: c.name, spec: c.axis, mech: c.axis, read: '柔化剪影 + 三层明暗 + 加色 rim 光',
  source: '内核新写（softShape 柔化，对齐武器侧）',
  demoHook: `gear.slot === '${c.id}' → drawGearIcon()`,
  mod: makeFx(frameMeta(c.name, W, H, {
    desc: `${c.axis}｜6 部位之一，同部位只能穿 1 件`, tags: ['gear', c.id], duration: 2.0, oy: H / 2,
  }), (p, t) => drawGear(p, t, c)),
}));
