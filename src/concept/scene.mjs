// 同屏叠加测试 —— 单个技能好看不代表放在一起好看
//
// 这一组的用途不是「展示技能」，是**压力测试可读性**：
// 真实战斗里同屏会同时出现 3~5 个技能 + 一群敌人，
// 单看都清楚的东西叠在一起，很可能互相压暗、糊成一团、或者抢同一个视觉焦点。
//
// 每张图都遵守：
//   1. 复用 skills.mjs 里**同一批绘制函数**（不写第二套），用 withOffset 挪到左/右车道。
//   2. 画一个极低对比的地面 + 几个敌人剪影当参照物 —— 没有参照物就判断不出「读不读得出」。
//   3. 各技能的相位错开，模拟真实不同步的情况（不会所有技能同时到峰值）。
//
// 判断标准只有一条：**一眼能不能说出「场上正在发生哪几件事」**。

import { frameMeta, makeFx, INK } from './pixel-lib.mjs';
import { hex } from '../../vendor/pixelfx/src/core/color.js';
import { TAU, wrap } from '../../vendor/pixelfx/src/core/index.js';
import { R, GROUND, rnd, withOffset } from './skill-lib.mjs';
import { SKILL_DRAW } from './skills.mjs';

const W = 112, H = 88;

// 敌人剪影用的冷灰蓝（刻意压得比技能暗，只当参照物，不当主角）
const FOE = R(['#0b0f16', '#141b26', '#1e2a3a', '#2b3c52', '#3d5570', '#577493', '#8aa4c0']);

/** 战场底：一条竖向通道 + 极淡地砖线 + 两侧墙。对比度压到最低。 */
function battlefield(p, t) {
  // 地面
  p.rect(-56, -44, 112, 88, hex('#151821'), 1);
  // 地砖横向线（越远越密，暗示纵深）
  for (let i = 0; i < 9; i++) {
    const y = -40 + i * 10;
    p.rect(-56, y, 112, 1, hex('#1c202b'), 1);
  }
  for (let x = -48; x <= 48; x += 16) p.rect(x, -44, 1, 88, hex('#1a1e28'), 1);
  // 两侧墙（压暗）
  p.rect(-56, -44, 7, 88, hex('#0d1017'), 1);
  p.rect(49, -44, 7, 88, hex('#0d1017'), 1);
  p.rect(-49, -44, 1, 88, hex('#242a36'), 1);
  p.rect(48, -44, 1, 88, hex('#242a36'), 1);
  // 地面线
  p.rect(-49, GROUND, 98, 1, hex('#232833'), 1);
}

/** 敌人剪影（参照物）：只画形体 + 两点眼，不抢技能。 */
function foe(p, x, y, s = 1, hurt = 0) {
  p.ellipse(x, y + 1, 6 * s, 2 * s, INK, 0.45);
  p.poly([[x - 5 * s, y], [x - 4 * s, y - 9 * s], [x + 4 * s, y - 9 * s], [x + 5 * s, y]], FOE[2], 1);
  p.ellipse(x, y - 13 * s, 3.6 * s, 3.6 * s, FOE[3], 1);
  p.dot(Math.round(x - 1.3 * s), Math.round(y - 13 * s), FOE[0], 1);
  p.dot(Math.round(x + 1.3 * s), Math.round(y - 13 * s), FOE[0], 1);
  if (hurt > 0) p.disc(x, y - 8 * s, 9 * s, hex('#ffffff'), 0.22 * hurt);
}

const FOES = [
  [-30, -4, 1.0], [12, -14, 0.9], [30, 8, 1.1], [-8, -30, 0.85], [34, -28, 0.8],
];

/** 场景卡：skills = [{ id, ox, oy, phase, speed }] */
const scene = (id, name, spec, read, skills, D = 3.2) => ({
  id, name, spec, mech: `同屏：${skills.map((s) => s.id).join(' + ')}`,
  read,
  source: '内核新写（同屏叠加测试，复用技能绘制函数）',
  demoHook: '战斗层：各技能独立 update，共用同一帧缓冲',
  mod: makeFx(frameMeta(name, W, H, {
    desc: spec, tags: ['scene', id], duration: D, loop: true, fps: 30, oy: H / 2,
  }), (p, t) => {
    battlefield(p, t);
    for (const [fx, fy, fs] of FOES) foe(p, fx, fy, fs);
    for (const s of skills) {
      const tt = t * (s.speed ?? 1) + (s.phase ?? 0);
      const P = withOffset(p, s.ox ?? 0, s.oy ?? 0);
      SKILL_DRAW[s.id](P, tt);
    }
  }),
});

export const SCENE_EFFECTS = [
  scene('scene-a', '同屏 A · 火线压制', '燃烧地带 + 温压弹 + 旋转刀轮',
    '看三件事：地面在烧、空中有弹头飞过、横着有锯片扫 — 三者占的是三个不同的空间层',
    [
      { id: 'flamezone', ox: -6, oy: 4, phase: 0.8 },
      { id: 'thermo', ox: 16, oy: -2, phase: 0.0 },
      { id: 'saw', ox: 0, oy: 0, phase: 0.6, speed: 1.15 },
    ]),

  scene('scene-b', '同屏 B · 能量集结', '电磁天雷 + 高能射线 + 哨戒机',
    '难点是「全是亮线」：天雷竖着、光束竖着、炮台横着——如果分不开就说明亮度要分层',
    [
      { id: 'thunder', ox: 6, oy: 0, phase: 0.0, speed: 1.3 },
      { id: 'beam', ox: -38, oy: 0, phase: 0.5 },
      { id: 'turret', ox: 28, oy: 8, phase: 0.0, speed: 0.9 },
    ]),

  scene('scene-c', '同屏 C · 控场推进', '干冰弹 + 制导激光 + 装甲车',
    '冷色（冰）与暖色（激光）同屏 + 一辆实体车占住右车道：考验冷暖能不能分层',
    [
      { id: 'dryice', ox: -30, oy: 0, phase: 0.0 },
      { id: 'laser', ox: 20, oy: -4, phase: 0.4 },
      { id: 'vehicle', ox: 0, oy: 6, phase: 0.3, speed: 0.85 },
    ]),

  scene('scene-d', '同屏 D · 满配压测', '6 个技能同时在场（最坏情况）',
    '这一张就是要「糊」的：用来定一个上限——最多能同时挂几个技能还读得出',
    [
      { id: 'flamezone', ox: -18, oy: 6, phase: 1.2 },
      { id: 'thermo', ox: 20, oy: -4, phase: 0.2 },
      { id: 'thunder', ox: -2, oy: 0, phase: 0.0, speed: 1.6 },
      { id: 'saw', ox: 0, oy: 0, phase: 1.1, speed: 1.3 },
      { id: 'turret', ox: -34, oy: 10, phase: 0.3 },
      { id: 'beam', ox: 44, oy: 0, phase: 0.9 },
    ], 3.0),
];
