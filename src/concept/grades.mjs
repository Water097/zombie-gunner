// 品级对照 —— 同一把枪 / 同一件甲，逐档升级只换配色与光效
//
// 这一组不是「新装备」，是**证明规则成立**的对照表：
// 剪影一动不动，只把 tiers.mjs 里的档位色阶套上去，看 6 档能不能一眼分开。
//
//   第 1 张「品级色阶」：6 档色板 + 光效强度，作为规范页
//   第 2–7 张：突击步枪 × 6 档（武器侧）
//   第 8–13 张：胸甲 × 6 档（装备侧）
//
// 为什么只挑 1 把枪 + 1 件甲：
// 06 册已定「型号 × 品级正交」——6 型号 × 6 品级 = 36 把枪是内容量爆炸。
// 品级的视觉是**一套函数**，不是 36 张图。任何型号、任何部位挂上 TIERS[i] 就自动成立。

import { wrap, TAU } from '../../vendor/pixelfx/src/core/index.js';
import { frameMeta, makeFx, INK, WHITE } from './pixel-lib.mjs';
import { TIERS } from './tiers.mjs';
import { drawGearWithTier } from './equipment.mjs';
import { drawWeaponWithTier } from './weapons.mjs';

const W = 112, H = 88;

/** 规范页：6 档色板 + 光效强度（左低右高，一眼看出加码节奏）。 */
function drawScale(p, t) {
  const u = wrap(t, 3.2) / 3.2;
  const breath = 0.5 + 0.5 * Math.sin(u * TAU);
  const xs = [-44, -26.5, -9, 8.5, 26, 43.5];

  xs.forEach((x, i) => {
    const T = TIERS[i];
    // 色板：一条竖砖，三档明暗都要露出来
    p.rect(x - 6, -14, 13, 26, T.body[2], 1);
    p.rect(x - 6, -14, 13, 3, T.body[4], 1);
    p.rect(x - 6, -14, 2, 26, T.body[3], 1);
    p.rect(x - 6, 10, 13, 4, T.body[1], 1);
    p.rect(x - 6, -14, 13, 1, T.body[5], 1);

    // 档位光效：直接复用同一套预算（这里按小尺寸缩放）
    if (T.rings) p.glowRing(x, -1, 10, 1.2, T.body[5], 0.22 * T.rings);
    if (T.glowK) p.glow(x, -1, 10, T.body[4], T.glowK * 0.5 * (0.55 + 0.45 * breath));
    if (T.aura) p.glowRing(x, -1, 13, 1, T.body[6], 0.12 + 0.10 * breath);
    for (let s = 0; s < T.sparks; s++) {
      const a = t * 0.9 + (s * TAU) / Math.max(1, T.sparks);
      p.dot(Math.round(x + Math.cos(a) * 10), Math.round(-1 + Math.sin(a) * 14), T.body[5], 0.7);
    }

    // 档位编号 + 光效强度刻度
    p.text(String(T.num), x, -25, T.body[5], { font: 'mini', align: 'center', a: 1 });
    for (let b = 0; b < T.num; b++) p.rect(x - 5 + b * 2, 14, 1, 3, T.body[5], 0.9);
  });

  // 升级方向：单向箭头
  p.glowLine(-50, 28, 46, 28, 1, TIERS[5].body[3], 0.5);
  p.poly([[50, 28], [46, 25], [46, 31]], TIERS[5].body[4], 1);
}

const SCALE_ITEM = {
  id: 'tier-scale', name: '品级色阶', spec: '06 册六档：白 / 蓝 / 紫 / 粉 / 金 / 赤红+黑纹',
  mech: '档位决定本体色阶 + 外缘光圈数 + 粒子数 + 流光 / 黑纹',
  read: '颜色先于光效被读到：关掉光看颜色，6 档也要分得清',
  source: '内核新写（tiers.mjs 视觉系统）',
  demoHook: 'item.grade → TIERS[grade]',
  mod: {
    meta: frameMeta('品级色阶', W, H, { desc: '6 档色板 + 光效强度', tags: ['tier', 'legend'], duration: 3.2, loop: true, fps: 24, oy: H / 2 }),
    draw: (p, t) => drawScale(p, t),
  },
};

const tierCard = (kind, draw, targetId, label) =>
  TIERS.map((T) => ({
    id: `${kind}-${targetId}-${T.id}`,
    name: `${label} · ${T.name}`,
    spec: `品级 ${T.num}/6 · ${T.color}｜${T.note}`,
    mech: `剪影与 ${label} 普通档完全一致，只换 ${T.num} 档色阶与光效预算`,
    read: `外缘光 ${T.rings} 圈 / 呼吸光 ${T.glowK.toFixed(2)} / 环绕粒子 ${T.sparks}${T.sweep ? ' / 流光扫过' : ''}${T.crack ? ' / 甲面黑纹' : ''}`,
    source: '内核新写（品级系统 · 剪影复用）',
    demoHook: `${kind}.grade = ${T.num} → draw(${targetId}, TIERS[${T.num - 1}])`,
    mod: makeFx(frameMeta(`${label} · ${T.name}`, W, H, {
      desc: `品级 ${T.num}/6 · ${T.color}`, tags: ['tier', kind, T.id], duration: 2.4, oy: H / 2,
    }), (p, t) => draw(p, t, targetId, T)),
  }));

export const GRADE_EFFECTS = [
  SCALE_ITEM,
  ...tierCard('weapon', drawWeaponWithTier, 'assault', '突击步枪'),
  ...tierCard('gear', drawGearWithTier, 'chest', '胸甲'),
];
