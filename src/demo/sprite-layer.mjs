// 敌人精灵层 —— 把概念图里的史莱姆（pixelfx effect）直接跑进 demo
//
// 这就是「概念图 → demo」的那条接法，四步都在这里：
//   ① 宿主画布整数倍放大：sprites 以 concept 坐标渲染，再按 scale 用 nearest 放大贴图
//   ② 固定步长 update：由主循环传 dt，逻辑与渲染同频
//   ③ back / front 两层：fx.draw(frame,'back'|'front') 各画一次
//   ④ 生命周期回收：敌人消失 → 实例从 Map 里删掉
//
// 渲染路径：createFrame → createFx → draw → composite → ImageData → putImageData → drawImage
//
// ⚠️ 性能纪律（2026-11-11 重写根因）：
// 旧实现在「每只敌人每一帧」都重跑整条 pixelfx 管线（fx.update+draw×2+composite+putImageData）。
// 敌人一多，成本 = 敌人数 × 逐像素合成，直接把帧率压到 ~10FPS。
// 新实现：每种敌人类型**只在首次出现时烘焙 FRAMES 张静态帧**（一次性 pixelfx 渲染），
// 之后每只敌人每帧只做一张 drawImage 贴图。pixelfx 渲染从「每帧×每敌」降到「每类型一次」。
// 动画通过「按全局时钟取帧序列索引」还原，观感不变、开销近零。
// 切勿把烘焙挪回 per-enemy per-frame —— 这是上一版卡顿的根因。

import { createFrame, clearFrame, createFx, composite } from '../../vendor/pixelfx/src/core/index.js';
import { ENEMY_EFFECTS } from '../concept/enemies.mjs';

// 概念图画布是 112×96，但史莱姆本体只占中间 ~40×32。
// demo 里每帧要为每只敌人 putImageData，所以裁一块够用的 72×72 就够（省 50% 像素搬运）。
const FW = 72, FH = 72;
const OX = FW / 2, OY = FH - 16;  // 脚底原点（相对小画布）

// 每种类型烘焙的动画帧数。30 帧足够顺滑；8 类共 ~240 张 72×72 离屏画布 ≈ 5MB，可接受。
// 播放时按各类型的真实周期 dur 取帧，保留原设计的运动节奏（重/轻、快/慢不混为一拍）。
const FRAMES = 30;

// 规则敌人 type → 概念史莱姆 id
const TYPE_MAP = {
  zombie: 'normal',
  runner: 'swift',
  armored: 'armor',
  swarm: 'swarm',
  ranged: 'ranged',
  bomber: 'bomber',
  flyer: 'flyer',
  splitter: 'splitter',
};

// 每种的贴图缩放：让史莱姆的视觉宽度 ≈ 碰撞半径的 2 倍（碰撞判定不变，只改观感）
// 2026-11-05：normal 1.50 → 1.10，用户反馈普通史莱姆太大（1.50 时视觉宽 45px，
// 而它的碰撞半径只有 16）。1.10 正好 ≈ 2×半径，符合下面这条自己的约定。
const SCALE = {
  normal: 1.10, swift: 1.15, armor: 2.00, bomber: 1.55,
  ranged: 1.60, swarm: 1.05, flyer: 1.50, splitter: 1.90,
};

const MODS = new Map(ENEMY_EFFECTS.map((i) => [i.id, i.mod]));

export class EnemySprites {
  constructor() {
    // 烘焙用的共享离屏资源（多个类型顺序烘焙，彼此不冲突）
    this.frame = createFrame(FW, FH);
    this.img = new ImageData(FW, FH);
    this.cv = document.createElement('canvas');
    this.cv.width = FW; this.cv.height = FH;
    this.c2d = this.cv.getContext('2d');
    this.c2d.imageSmoothingEnabled = false;
    this.strips = new Map();   // id → { frames: canvas[], dur } | null（无此类型）
    this.phase = new Map();    // enemyId → 浮点相位偏移（仅观感：避免全体同拍）
  }

  /** 首次出现该类型时烘焙整段动画；之后直接从缓存取。 */
  _ensure(id) {
    if (this.strips.has(id)) return this.strips.get(id);
    const mod = MODS.get(id);
    if (!mod) { this.strips.set(id, null); return null; }
    const dur = mod.meta.duration ?? 1;
    const fx = createFx(mod, { x: OX, y: OY });
    const frames = new Array(FRAMES);
    for (let f = 0; f < FRAMES; f++) {
      fx.update(dur / FRAMES);
      clearFrame(this.frame);
      fx.draw(this.frame, 'back');
      fx.draw(this.frame, 'front');
      composite(this.frame, this.img.data, null);
      const c = document.createElement('canvas');
      c.width = FW; c.height = FH;
      const cc = c.getContext('2d');
      cc.imageSmoothingEnabled = false;
      cc.putImageData(this.img, 0, 0);
      frames[f] = c;
    }
    const strip = { frames, dur };
    this.strips.set(id, strip);
    return strip;
  }

  /** 画一具敌人。命中闪白**只加一圈描边环**，不给整体盖白光（敌人剪影规范 v1）。 */
  draw(ctx, e, clockSec) {
    const id = TYPE_MAP[e.type] ?? 'normal';
    const strip = this._ensure(id);
    if (!strip) return false;
    // 每敌一个相位偏移，避免几十只史莱姆齐刷刷同拍（纯观感，不改任何机制）
    let ph = this.phase.get(e.id);
    if (ph === undefined) { ph = Math.random() * FRAMES; this.phase.set(e.id, ph); }
    let idx = Math.floor((clockSec / strip.dur) * FRAMES + ph) % FRAMES;
    if (idx < 0) idx += FRAMES;
    const c = strip.frames[idx];
    const s = SCALE[id] ?? 1.4;
    const dx = e.x - OX * s, dy = e.y - OY * s;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(c, dx, dy, FW * s, FH * s);

    if (e.hitFlash > 0) {
      const a = Math.min(1, e.hitFlash / 160);
      ctx.save();
      ctx.globalAlpha = 0.55 * a;
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.ellipse(e.x, e.y - 10 * s * 0.7, 15 * s * 0.9, 13 * s * 0.8, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
    return true;
  }

  /** 每帧末尾调用：把已经不在场的敌人相位回收掉，避免 Map 随对局无限膨胀。 */
  reap(enemies) {
    const alive = new Set();
    for (const e of enemies) alive.add(e.id);
    for (const id of this.phase.keys()) if (!alive.has(id)) this.phase.delete(id);
  }
}
