// 品级（Grade）视觉系统 —— 武器与装备共用的一套规则
//
// 06 册「稀有度六档」+ 07 册「装备品级」已经定了 6 档的语义与配色：
//   ① 普通(白) ② 精良(蓝) ③ 稀有(紫) ④ 史诗(粉) ⑤ 传说(金) ⑥ 灾厄(赤红+黑纹)
//
// 本模块只负责把「档位」翻译成视觉，不管玩法数值。核心纪律：
//
//   1. 剪影不动。升级只换配色与光效，形状一行不改 —— 玩家认得出是同一把枪 / 同一件甲。
//   2. 一个档 = 一套色阶（7 档明暗）+ 一个外缘色 + 一档光效预算。
//      颜色先于光效被读到：关掉光看颜色，6 档也必须分得清。
//   3. 光效层层加码，但只加在「该发光的地方」，不做全屏泛光：
//        白  无光
//        蓝  1 圈外缘光 + 1 个静光点
//        紫  外缘光 + 呼吸光 + 2 颗环绕粒子
//        粉  外缘光 + 呼吸光 + 4 颗环绕粒子 + 内层加色
//        金  双圈外缘光 + 4 颗 + 流光扫过 + 更强呼吸光
//        灾厄 双圈赤光 + 8 颗 + 流光 + 脉动光环 + 甲面黑纹
//   4. 灾厄的「黑纹」是唯一允许破坏甲面的东西（06 册原文：赤红 + 黑纹），
//      裂纹只落在已填充的像素上，不会画出轮廓外。
//
// 用法：
//   const T = TIERS[4];                       // 传说
//   PARTS[id](grid, T.body, T.accent);        // 本体 + 亮点都用档位色
//   grid.outline(() => INK);
//   tierRings(grid, T);                       // 外缘光（0/1/2 圈）
//   tierCracks(grid, T, cx, cy, r);           // 灾厄黑纹（其他档自动跳过）
//   grid.draw(p);
//   tierFx(p, T, t, { cx, cy, rx, ry });      // 呼吸光 / 环绕粒子 / 流光 / 脉动环

import { hex } from '../../vendor/pixelfx/src/core/color.js';
import { TAU, wrap } from '../../vendor/pixelfx/src/core/index.js';

const R = (list) => list.map(hex);
const brighten = (ramp, k = 2) => ramp.map((_, i) => ramp[Math.min(ramp.length - 1, i + k)]);

// 次级结构（扣具 / 鞋底 / 领口 / 铆钉 / 甲边）用的中性金属：
// 冷档用冷钢，暖档（粉/金/赤红）换成暖灰 —— 否则「赤红甲面 + 蓝灰镶边」会打架。
const STEEL_COOL = R(['#0e1318', '#1a222b', '#2b3644', '#41505f', '#5d6e80', '#8b9aa8', '#c6cfd9']);
const STEEL_WARM = R(['#14100f', '#241d1c', '#392e2c', '#514340', '#6d5c58', '#9a8884', '#cfc2bd']);

const BODY = {
  common:   R(['#101215', '#1e2226', '#30363c', '#454d55', '#5f6871', '#8b949e', '#c2c9d1']),
  fine:     R(['#0b1430', '#12224f', '#1c3d86', '#2f68c4', '#4f95e8', '#8fc4ff', '#d9ecff']),
  rare:     R(['#150a2c', '#26124f', '#3f1f86', '#6330c4', '#8f5ce8', '#c9a2ff', '#efe0ff']),
  epic:     R(['#2a0a20', '#4a1240', '#7a1f6a', '#b5309a', '#e055c4', '#ff9ae8', '#ffdcf6']),
  legend:   R(['#2b1605', '#4d2c08', '#86520c', '#c48412', '#f0b424', '#ffd85e', '#fff4c8']),
  calamity: R(['#0a0406', '#2a080c', '#5a1016', '#8f1a22', '#c42632', '#f04a52', '#ff9a9a']),
};

/**
 * rings  外缘光圈数（叠在 INK 描边外侧）
 * glowK  呼吸光强度
 * sparks 环绕粒子数
 * sweep  是否有流光扫过
 * crack  是否画甲面黑纹
 * aura   是否有脉动光环（灾厄专属）
 */
export const TIERS = [
  { id: 'common',   num: 1, name: '普通', color: '白',   body: BODY.common,   struct: STEEL_COOL, rings: 0, glowK: 0,    sparks: 0, sweep: false, crack: false, aura: false,
    note: '无修饰 · 只有实体与描边，靠剪影说话' },
  { id: 'fine',     num: 2, name: '精良', color: '蓝',   body: BODY.fine,     struct: STEEL_COOL, rings: 1, glowK: 0.16, sparks: 1, sweep: false, crack: false, aura: false,
    note: '一圈冷色外缘 + 一个静光点，开始「有能量」' },
  { id: 'rare',     num: 3, name: '稀有', color: '紫',   body: BODY.rare,     struct: STEEL_COOL, rings: 1, glowK: 0.28, sparks: 2, sweep: false, crack: false, aura: false,
    note: '外缘光 + 呼吸光，光开始「会动」' },
  { id: 'epic',     num: 4, name: '史诗', color: '粉',   body: BODY.epic,     struct: STEEL_WARM, rings: 1, glowK: 0.38, sparks: 4, sweep: false, crack: false, aura: false,
    note: '4 颗环绕粒子 + 内层加色，品质感分层' },
  { id: 'legend',   num: 5, name: '传说', color: '金',   body: BODY.legend,   struct: STEEL_WARM, rings: 2, glowK: 0.50, sparks: 4, sweep: true,  crack: false, aura: false,
    note: '双圈金边 + 流光扫过，整件东西在「反射」' },
  { id: 'calamity', num: 6, name: '灾厄', color: '赤红', body: BODY.calamity, struct: STEEL_WARM, rings: 2, glowK: 0.64, sparks: 8, sweep: true,  crack: true,  aura: true,
    note: '赤红脉动光环 + 甲面黑纹，唯一允许破坏形体的档' },
];

// 亮点色 = 同色阶上移两档（不是另配一个杂色，保证每档内部只有一套颜色语言）
for (const T of TIERS) {
  T.accent = brighten(T.body, 2);
  T.edge = T.body[5];
}

export const tierById = (id) => TIERS.find((t) => t.id === id) ?? TIERS[0];

/** 外缘光：在 INK 描边之外再叠 1~2 圈档位色（Grid.outline 只写空单元，所以是往外扩）。 */
export function tierRings(g, T) {
  if (!T || T.rings <= 0) return;
  for (let i = 0; i < T.rings; i++) {
    const col = T.body[Math.min(6, 4 + i)];
    g.outline(() => col, i === 0 ? 0.85 : 0.4);
  }
}

/** 甲面黑纹：只在已填充的像素上走线，描边外不会出现碎点。 */
export function tierCracks(g, T, cx, cy, R0) {
  if (!T || !T.crack) return;
  const line = (x0, y0, x1, y1) => {
    const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)) || 1;
    for (let i = 0; i <= n; i++) {
      const x = Math.round(x0 + ((x1 - x0) * i) / n);
      const y = Math.round(y0 + ((y1 - y0) * i) / n);
      if (g.get(x, y)) g.set(x, y, hex('#0a0406'), 0.92);
    }
  };
  const s = R0 / 20;
  line(cx - 2 * s, cy - R0 * 0.9, cx + 0.5 * s, cy - R0 * 0.35);
  line(cx + 0.5 * s, cy - R0 * 0.35, cx - 3 * s, cy + R0 * 0.2);
  line(cx + 0.5 * s, cy - R0 * 0.35, cx + 4 * s, cy + R0 * 0.15);
  line(cx + 4 * s, cy + R0 * 0.15, cx + 6 * s, cy + R0 * 0.75);
  line(cx - 6 * s, cy + R0 * 0.55, cx - 2 * s, cy + R0 * 0.85);
}

/**
 * 档位光效。o = { cx, cy, rx, ry } 本地包围盒（可省略，默认画布中心）。
 * 全部是时间的纯函数，接进 demo 不用改一行。
 */
export function tierFx(p, T, t, o = {}) {
  if (!T || T.num <= 1) return;
  const cx = o.cx ?? 0, cy = o.cy ?? 0, rx = o.rx ?? 30, ry = o.ry ?? 22;
  const D = 2.6, u = wrap(t, D) / D;
  const breath = 0.5 + 0.5 * Math.sin(u * TAU);          // 0..1 呼吸
  const k = T.glowK;

  // 1) 呼吸光：藏在形体后面的加色光，只让边缘「透」出来
  p.glow(cx, cy, Math.max(rx, ry) * (1.05 + 0.10 * breath), T.body[4], k * (0.35 + 0.30 * breath));

  // 2) 灾厄：脉动光环（刻意压淡，是氛围不是选中框）
  if (T.aura) {
    const rr = Math.max(rx, ry) * (1.30 + 0.08 * breath);
    p.glowRing(cx, cy, rr, 1, T.body[5], 0.10 + 0.08 * breath);
    p.glow(cx, cy, rr * 0.95, T.body[4], 0.10 + 0.06 * breath);
  }

  // 3) 流光：一条横光自上而下扫过（只在大档出现）
  if (T.sweep) {
    const sy = cy - ry * 1.1 + ((t * 0.55) % 1) * ry * 2.2;
    p.glowLine(cx - rx * 1.15, sy, cx + rx * 1.15, sy, 1, T.body[6], 0.10);
    p.glowLine(cx - rx * 0.8, sy + 1, cx + rx * 0.8, sy + 1, 2, T.body[5], 0.06);
  }

  // 4) 环绕粒子：档越高越多、越亮
  if (T.sparks > 0) {
    const spin = t * 0.55;
    for (let i = 0; i < T.sparks; i++) {
      const a = spin + (i * TAU) / T.sparks;
      const px = Math.round(cx + Math.cos(a) * rx * 1.06);
      const py = Math.round(cy + Math.sin(a) * ry * 1.10);
      p.dot(px, py, T.body[5], 0.55 + 0.35 * breath);
      if (T.num >= 4) {
        p.dot(px, py - 1, T.body[6], 0.30 + 0.25 * breath);
        p.glow(px, py, 4, T.body[5], 0.10 + 0.10 * breath);
      }
    }
  }
}

/** 图例卡用：一个档位的色板条（7 档明暗）。 */
export function tierSwatches(T) {
  return T.body;
}
