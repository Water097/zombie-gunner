// 敌人精灵层 —— 把概念图里的史莱姆（pixelfx effect）直接跑进 demo
//
// 这就是「概念图 → demo」的那条接法，四步都在这里：
//   ① 宿主画布整数倍放大：sprites 以 concept 坐标渲染，再按 scale 用 nearest 放大贴图
//   ② 固定步长 update：由主循环传 dt，逻辑与渲染同频
//   ③ back / front 两层：fx.draw(frame,'back'|'front') 各画一次
//   ④ 生命周期回收：敌人消失 → 实例从 Map 里删掉
//
// 渲染路径：createFrame → createFx → draw → composite → ImageData → putImageData → drawImage
// 全程复用同一个 frame / ImageData / 离屏 canvas，所以每帧成本只跟敌人数量线性相关。

import { createFrame, clearFrame, createFx, composite } from '../../vendor/pixelfx/src/core/index.js';
import { ENEMY_EFFECTS } from '../concept/enemies.mjs';

// 概念图画布是 112×96，但史莱姆本体只占中间 ~40×32。
// demo 里每帧要为每只敌人 putImageData，所以裁一块够用的 72×72 就够（省 50% 像素搬运）。
const FW = 72, FH = 72;
const OX = FW / 2, OY = FH - 16;  // 脚底原点（相对小画布）

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
const SCALE = {
  normal: 1.50, swift: 1.15, armor: 2.00, bomber: 1.55,
  ranged: 1.60, swarm: 1.05, flyer: 1.50, splitter: 1.90,
};

const MODS = new Map(ENEMY_EFFECTS.map((i) => [i.id, i.mod]));

export class EnemySprites {
  constructor() {
    this.frame = createFrame(FW, FH);
    this.img = new ImageData(FW, FH);
    this.cv = document.createElement('canvas');
    this.cv.width = FW; this.cv.height = FH;
    this.c2d = this.cv.getContext('2d');
    this.c2d.imageSmoothingEnabled = false;
    this.insts = new Map();   // enemyId → { fx, id }
    this.live = new Set();    // 本帧出现过的敌人 id（用于回收）
  }

  /** 把一个敌人渲染到共享离屏画布上，返回贴图参数；失败返回 null。 */
  bake(e, dt) {
    const id = TYPE_MAP[e.type] ?? 'normal';
    const mod = MODS.get(id);
    if (!mod) return null;
    let inst = this.insts.get(e.id);
    if (!inst) {
      inst = { fx: createFx(mod, { x: OX, y: OY }), id };
      this.insts.set(e.id, inst);
    }
    inst.fx.update(dt);
    clearFrame(this.frame);
    inst.fx.draw(this.frame, 'back');
    inst.fx.draw(this.frame, 'front');
    composite(this.frame, this.img.data, null);
    this.c2d.putImageData(this.img, 0, 0);
    return { scale: SCALE[id] ?? 1.4 };
  }

  /**
   * 画一具敌人。命中闪白**只加一圈描边环**，不给整体盖白光
   * （敌人剪影规范 v1：盖白光会跟爆炸糊在一起）。
   */
  draw(ctx, e, dt) {
    const b = this.bake(e, dt);
    if (!b) return false;
    this.live.add(e.id);
    const s = b.scale;
    const dx = e.x - OX * s, dy = e.y - OY * s;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.cv, dx, dy, FW * s, FH * s);

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

  /** 每帧末尾调用：把已经不在场的敌人实例回收掉。 */
  reap(enemies) {
    const alive = new Set();
    for (const e of enemies) alive.add(e.id);
    for (const id of this.insts.keys()) if (!alive.has(id)) this.insts.delete(id);
  }
}
