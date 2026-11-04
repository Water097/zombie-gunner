// 敌人类别 · 8 种史莱姆（全部继承 critters/slime 的 squash → hop → splat → wobble 编排）
//
// 机制沿用 05 册已定稿的 8 种敌人，只换叫法与形态。
// 但「只换皮」会让玩家失去判断依据：原来靠轮廓读出的「哪个会炸 / 哪个远程 / 哪个要穿透」，
// 现在必须由 色相 + 体量 + 内部结构 + 动作频率 四层重新承担。下面每种都写明了读法。
//
// 全部是 pure effect，可被 createFx 直接调用；上 demo 时按 enemy.type 选模块即可。

import {
  WHITE, INK, TAU, clamp, wrap, seg, smooth, RAMPS, step,
  blob, eyes, groundShadow, hopPose, frameMeta, makeFx,
} from './pixel-lib.mjs';

const D = 1.8;

// 每层的用途：color=第一眼区分，size=威胁度，core=机制预告，motion=速度感
const CFG = {
  normal: {
    name: '普通史莱姆', mech: '基础推进 · 检验清群 DPS', read: '青绿 / 中等 / 无核心 / 标准一跳',
    r: RAMPS.green, width: 20, height: 15, hop: 16, kind: 'normal',
  },
  swift: {
    name: '疾行史莱姆', mech: '高速突进 · 压缩反应窗口', read: '荧光黄绿 / 最小 / 身后速度线 / 跳频 ×1.7',
    r: RAMPS.swift, width: 14, height: 11, hop: 12, duration: 1.05, kind: 'swift', drift: 5, driftFreq: 2,
  },
  armor: {
    name: '装甲史莱姆', mech: '高血厚甲 · 需穿甲 / 冻结×3', read: '钢灰 / 最大 / 横向装甲板+铆钉 / 慢重跳',
    r: RAMPS.armor, width: 26, height: 19, hop: 11, duration: 2.2, kind: 'armor',
  },
  bomber: {
    name: '自爆史莱姆', mech: '抵线自爆 · 必须单体速杀', read: '橙红 / 中等 / 体内黑色炸弹核+引信 / 落地前涨大闪白',
    r: RAMPS.bomb, width: 20, height: 15, hop: 15, kind: 'bomber',
  },
  ranged: {
    name: '远程史莱姆', mech: '站定 30% 处投掷 · 考验续航', read: '紫 / 中等 / 头顶悬浮法球 / 原地投掷弧线',
    r: RAMPS.ranged, width: 18, height: 14, hop: 7, kind: 'ranged',
  },
  swarm: {
    name: '蜂群史莱姆', mech: '数量压制 · 检验 AOE 覆盖', read: '金黄 / 极小 ×3 / 三团错相位弹跳',
    r: RAMPS.swarm, width: 9, height: 7, hop: 9, duration: 1.2, kind: 'swarm',
  },
  flyer: {
    name: '飞行史莱姆', mech: '无视地面阻挡 · 需对空', read: '半透水蓝 / 中等 / 两片薄翼 / 不落地持续悬浮',
    r: RAMPS.flyer, width: 18, height: 14, hop: 0, kind: 'flyer', floatAmp: 7,
  },
  splitter: {
    name: '分裂史莱姆', mech: '死亡分裂 · 需收尾清场', read: '粉 / 偏大 / 中缝双核 / 周期性一分为二',
    r: RAMPS.split, width: 23, height: 17, hop: 13, kind: 'splitter',
  },
};

function common(p, t, cfg, pose, cy) {
  const cx = cfg.drift ? Math.sin(pose.u * TAU * cfg.driftFreq) * cfg.drift : 0;
  groundShadow(p, cx, pose.rx, pose.lift, cfg.kind === 'flyer' ? 0.22 : 0.42);
  // 落地甩出的水滴（像素点，不是柔边）
  if (pose.land > 0.02 && cfg.kind !== 'flyer') {
    for (const s of [-1, 1]) {
      const k = pose.land;
      const dx = s * (pose.rx + 5 + 9 * (1 - k));
      const dy = -2 - 7 * Math.sin((1 - k) * Math.PI);
      p.dot(cx + dx, dy, cfg.r[Math.min(cfg.r.length - 2, 4)], 0.9 * k);
      p.dot(cx + dx * 1.25, dy - 2, cfg.r[3], 0.55 * k);
    }
  }
  return cx;
}

/** 通用史莱姆绘制 + 各型特化。 */
function drawSlime(p, t, cfg) {
  const dur = cfg.duration ?? D;
  const pose = hopPose(t, dur, cfg);
  const u = pose.u;
  let cx = common(p, t, cfg, pose, 0);

  // 飞行型：不下地，整体上下浮 + 薄翼
  let floatY = 0;
  if (cfg.kind === 'flyer') {
    floatY = -10 - Math.sin(u * TAU) * cfg.floatAmp;
    pose.lift = 0;
  }
  const cy = -pose.ry + pose.lift + floatY;

  const blink = u > 0.90 && u < 0.96;
  const bodyAlpha = cfg.kind === 'flyer' ? 0.86 : 1;

  // 身后速度线（疾行）
  if (cfg.kind === 'swift') {
    for (let i = 0; i < 3; i++) {
      const yy = cy - 4 + i * 5;
      p.line(cx - pose.rx - 4, yy, cx - pose.rx - 12 - 4 * Math.sin(u * TAU * 2 + i), yy,
        cfg.r[3], 0.35 + 0.3 * Math.sin(u * TAU * 2 + i));
    }
  }

  // 飞行翼（半透明 + 抖动）
  if (cfg.kind === 'flyer') {
    const flap = Math.sin(u * TAU * 3) * 3;
    for (const s of [-1, 1]) {
      p.poly([
        [cx + s * (pose.rx - 2), cy - 3],
        [cx + s * (pose.rx + 15), cy - 9 - flap],
        [cx + s * (pose.rx + 11), cy + 3 - flap],
        [cx + s * (pose.rx - 1), cy + 4],
      ], cfg.r[4], 0.55);
      p.line(cx + s * (pose.rx + 2), cy - 2, cx + s * (pose.rx + 13), cy - 7 - flap, cfg.r[6], 0.7);
    }
  }

  // 蜂群：三小团错相位（同一套骨架，只改相位与位置）
  if (cfg.kind === 'swarm') {
    const offs = [[-13, 0.00], [1, 0.33], [12, 0.66]];
    for (const [dx, ph] of offs) {
      const q = hopPose(t + ph * dur, dur, cfg);
      const yy = -q.ry + q.lift;
      blob(p, cx + dx, yy, q.rx, q.ry, cfg.r, { alpha: 0.98 });
      eyes(p, cx + dx, yy - 1, 3, { closed: q.u > 0.93 });
    }
    return;
  }

  blob(p, cx, cy, pose.rx, pose.ry, cfg.r, { alpha: bodyAlpha });

  // 分裂型：中缝 + 双核 + 周期性分离
  if (cfg.kind === 'splitter') {
    const sep = 2 + 4 * Math.max(0, Math.sin(u * TAU));
    p.line(cx, cy - pose.ry * 0.8, cx, cy + pose.ry * 0.7, cfg.r[0], 0.85);
    for (const s of [-1, 1]) {
      p.circle(cx + s * (5 + sep), cy - 1, 2.6, cfg.r[6], 0.9);
      p.glow(cx + s * (5 + sep), cy - 1, 5, cfg.r[5], 0.22);
      eyes(p, cx + s * (5 + sep), cy - 4, 2.5, { closed: blink });
    }
    return;
  }

  // 装甲型：横向硬板 + 铆钉 + 顶部护脊
  if (cfg.kind === 'armor') {
    p.rect(cx - pose.rx * 0.82, cy - 3, pose.rx * 1.64, 5, cfg.r[2], 1);
    p.rect(cx - pose.rx * 0.82, cy - 3, pose.rx * 1.64, 1, cfg.r[5], 1);
    p.rect(cx - pose.rx * 0.82, cy + 2, pose.rx * 1.64, 1, cfg.r[0], 1);
    for (const s of [-1, 1]) p.dot(cx + s * pose.rx * 0.62, cy - 1, cfg.r[6], 1);
    p.rect(cx - 5, cy - pose.ry - 2, 10, 3, cfg.r[3], 1);
    eyes(p, cx, cy - pose.ry * 0.42, 6, { closed: blink });
    return;
  }

  // 自爆型：体内炸弹核 + 引信火花；越接近落地越亮越大（预警 = 机制信息）
  if (cfg.kind === 'bomber') {
    const warn = clamp(seg(u, 0.56, 0.84));
    const pulse = 0.5 + 0.5 * Math.sin(u * TAU * 5);
    const cr = 4 + 2.2 * warn + 1.2 * pulse;
    p.circle(cx, cy + 1, cr + 1, INK, 0.9);
    p.circle(cx, cy + 1, cr, step(cfg.r, 0.35 + 0.55 * warn * pulse), 1);
    p.glow(cx, cy + 1, 9 + 7 * warn, cfg.r[5], 0.18 + 0.42 * warn);
    p.rect(cx - 1, cy + 1 - cr - 3, 2, 3, cfg.r[2], 1);
    const fx = cx + 1, fy = cy + 1 - cr - 4;
    for (let i = 0; i < 3; i++) {
      const an = u * TAU * 7 + i * 2.1;
      p.dot(fx + Math.cos(an) * (2 + warn * 2), fy + Math.sin(an) * (2 + warn * 2), cfg.r[7], 0.9);
    }
    p.glow(fx, fy, 5, cfg.r[6], 0.35 * (0.5 + warn));
    eyes(p, cx, cy - pose.ry * 0.5, 6, { closed: blink });
    return;
  }

  // 远程型：头顶悬浮法球 + 周期性投掷弧线
  if (cfg.kind === 'ranged') {
    const throwU = wrap(u - 0.30, 1) / 0.42;
    const active = u > 0.30 && u < 0.72;
    const oy = cy - pose.ry - 8 - Math.sin(u * TAU * 2) * 2;
    if (!active) {
      p.circle(cx, oy, 4, cfg.r[5], 0.95);
      p.circle(cx - 1, oy - 1, 1.5, WHITE, 0.9);
      p.glow(cx, oy, 9, cfg.r[4], 0.28);
    }
    if (active) {
      const k = clamp(throwU);
      const bx = cx + 26 * k, by = oy + 16 * Math.sin(k * Math.PI);
      p.line(cx, oy, bx, by, cfg.r[4], 0.25);
      p.circle(bx, by, 3.2, cfg.r[6], 1);
      p.glow(bx, by, 7, cfg.r[5], 0.3);
    }
  }

  eyes(p, cx, cy - pose.ry * 0.38, cfg.kind === 'swift' ? 4 : 6, { closed: blink });

  // 受击/落地的 1~2 帧白热 hero frame（像素风靠整体闪白，不靠渐变）
  if (pose.land > 0.86 && cfg.kind !== 'flyer') {
    p.ellipse(cx, cy, pose.rx * 0.9, pose.ry * 0.85, cfg.r[7], 0.30);
    p.glow(cx, cy, 14, cfg.r[6], 0.22);
  }
}

function build(id) {
  const cfg = CFG[id];
  const dur = cfg.duration ?? D;
  const w = 96, h = 88;
  const meta = frameMeta(cfg.name, w, h, {
    desc: `${cfg.mech}｜读法：${cfg.read}`,
    tags: ['enemy', 'slime', id],
    duration: dur, loop: true, fps: 24, oy: h - 14,
  });
  return makeFx(meta, (p, t) => drawSlime(p, t, cfg));
}

export const ENEMY_EFFECTS = Object.keys(CFG).map((id) => {
  const cfg = CFG[id];
  return {
    id, name: cfg.name, mech: cfg.mech, read: cfg.read,
    source: '内核新写（骨架借鉴 critters/slime）',
    demoHook: `enemy.type === '${id}' → drawEnemyBody()`,
    mod: build(id),
  };
});
