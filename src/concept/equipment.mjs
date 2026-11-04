// 装备类别 · 07 册 6 个部位（头肩 / 胸甲 / 腰带 / 鞋子 / 首饰 / 称号）
//
// 武器模块已迁至 weapons.mjs（第二版按弹道形态重画并扩展到子弹/属性/爆炸）。
// 本文件只保留装备，代码与上一版一致，未做任何改动。
// 名称全部取自已定稿文档；武器独立成系统，不占装备格。

import { INK, TAU, wrap, RAMPS, frameMeta, makeFx } from './pixel-lib.mjs';

const W = 112, H = 80;

// ── 装备：6 个部位的像素图标 + 稀有度边框 + 扫光 ──
function glyphFor(id) {
  return (p, x, y, R, A) => {
    switch (id) {
      case 'head':                                    // 头肩：头盔 + 两侧护肩
        p.rect(x - 11, y - 13, 22, 15, R[4], 1);
        p.rect(x - 11, y - 13, 22, 3, A[5], 1);
        p.rect(x - 9, y - 5, 18, 5, INK, 1);
        p.rect(x - 7, y - 4, 5, 3, A[6], 1);
        p.rect(x + 2, y - 4, 5, 3, A[6], 1);
        p.rect(x - 18, y + 2, 9, 8, R[3], 1);
        p.rect(x + 9, y + 2, 9, 8, R[3], 1);
        p.rect(x - 18, y + 2, 9, 1, A[6], 1);
        p.rect(x + 9, y + 2, 9, 1, A[6], 1);
        break;
      case 'chest':                                   // 胸甲：板甲 + 中央能量核
        p.poly([[x - 14, y - 12], [x + 14, y - 12], [x + 12, y + 13], [x, y + 17], [x - 12, y + 13]], R[4], 1);
        p.poly([[x - 12, y - 10], [x + 12, y - 10], [x + 10, y + 10], [x, y + 14], [x - 10, y + 10]], R[2], 1);
        p.rect(x - 12, y - 10, 24, 2, A[6], 1);
        p.circle(x, y + 1, 4, A[6], 1);
        p.glow(x, y + 1, 9, A[5], 0.3);
        break;
      case 'belt':                                    // 腰带：横带 + 金属扣
        p.rect(x - 18, y - 5, 36, 10, R[3], 1);
        p.rect(x - 18, y - 5, 36, 2, A[6], 1);
        p.rect(x - 18, y + 3, 36, 1, INK, 1);
        p.rect(x - 6, y - 8, 12, 16, R[5], 1);
        p.rect(x - 4, y - 6, 8, 12, INK, 1);
        p.rect(x - 2, y - 4, 4, 8, A[6], 1);
        break;
      case 'boots':                                   // 鞋子：一双靴
        for (const s of [-1, 1]) {
          const bx = x + s * 10 - 7;
          p.rect(bx, y - 12, 13, 17, R[3], 1);
          p.rect(bx - 3, y + 4, 19, 6, R[5], 1);
          p.rect(bx, y - 12, 13, 2, A[6], 1);
          p.rect(bx + 1, y - 5, 11, 2, INK, 1);
          p.dot(bx + 9, y + 1, A[7], 1);
        }
        break;
      case 'trinket':                                 // 首饰：戒指 + 宝石
        p.ring(x, y + 2, 13, 4, R[6], 1);
        p.ring(x, y + 2, 9, 1, R[2], 1);
        p.poly([[x, y - 15], [x + 7, y - 8], [x, y - 1], [x - 7, y - 8]], A[6], 1);
        p.poly([[x, y - 13], [x + 4, y - 8], [x, y - 4], [x - 4, y - 8]], A[7], 1);
        p.glow(x, y - 8, 14, A[5], 0.34);
        break;
      default:                                        // 称号：铭牌卷轴 + 像素字条
        p.rect(x - 19, y - 10, 38, 20, R[4], 1);
        p.rect(x - 17, y - 8, 34, 16, R[1], 1);
        p.rect(x - 17, y - 8, 34, 2, A[6], 1);
        p.rect(x - 13, y - 2, 20, 2, A[6], 1);
        p.rect(x - 10, y + 3, 14, 2, A[4], 1);
        p.rect(x - 21, y - 12, 4, 24, R[6], 1);
        p.rect(x + 17, y - 12, 4, 24, R[6], 1);
        break;
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
  const bob = Math.sin(u * TAU) * 1.5;
  const R = c.r, A = c.a;
  p.rect(-27, -29 + bob, 54, 58, INK, 1);
  p.rect(-26, -28 + bob, 52, 56, A[2], 1);
  p.rect(-24, -26 + bob, 48, 52, R[1], 1);
  for (const [gx, gy] of [[-25, -27], [21, -27], [-25, 23], [21, 23]]) {
    p.rect(gx, gy + bob, 4, 4, A[5], 1);
    p.dot(gx + 1, gy + 1 + bob, A[7], 1);
  }
  p.glow(0, 16 + bob, 22, A[4], 0.16);
  glyphFor(c.id)(p, 0, bob, R, A);
  const sx = -24 + 62 * wrap(u + 0.15, 1);
  p.rect(sx, -26 + bob, 2, 52, A[7], 0.16);
}

export const GEAR_EFFECTS = GEAR.map((c) => ({
  id: c.id, name: c.name, spec: c.axis, mech: c.axis, read: '像素图标 + 稀有度边框 + 扫光',
  source: '内核新写', demoHook: `gear.slot === '${c.id}' → drawGearIcon()`,
  mod: makeFx(frameMeta(c.name, W, H, {
    desc: `${c.axis}｜6 部位之一，同部位只能穿 1 件`, tags: ['gear', c.id], duration: 2.0, oy: H / 2,
  }), (p, t) => drawGear(p, t, c)),
}));
