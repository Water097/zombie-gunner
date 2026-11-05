// 火场精灵层 —— 燃烧地带走 pixelfx 渲染路径（2026-11-05 试点）
//
// 这是「概念图 = demo」的第一块：demo 不再用 Canvas2D 手绘火焰，
// 而是和概念图调同一个 drawFlameField，只在这里做「渲染到离屏画布 → 贴到世界坐标」。
// 以后技能都按这条路走，改效果只改概念层那一个文件。
//
// 与敌人精灵层的差别：火场是**地面区域**，尺寸随玩法半径变化，
// 所以画布按实例半径现做（不是固定 72×72），并且只画 front 一层。

import { createFrame, clearFrame, createFx, composite } from '../../vendor/pixelfx/src/core/index.js';
import { drawFlameField } from '../concept/flame-field.mjs';

// duration 给足：真正的归一化由 options.dur 控制（每片火按自己的 maxLife），
// 这里只是别让 createFx 把 t 提前 clamp 掉。
const MOD = {
  meta: { duration: 30, loop: false, options: {} },
  draw: (p, t, o) => drawFlameField(p, t, o),
};

const BRICK = 12;          // 与背景砖块行高一致（buildBackground 的 BH）

export class FlameSprites {
  constructor() {
    this.insts = new Map();  // flame 对象 → 实例（火焰是地面物体，对象引用本身即可当 key）
  }

  draw(ctx, f, dt) {
    let inst = this.insts.get(f);
    if (!inst) inst = this._make(f);
    inst.fx.update(Math.min(dt, 0.1));   // 卡帧时不要一次跳太多，免得火一下烧完

    clearFrame(inst.frame);
    inst.fx.draw(inst.frame, 'front');
    composite(inst.frame, inst.img.data, null);
    inst.c2d.putImageData(inst.img, 0, 0);

    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(inst.cv, Math.round(f.x - inst.ax), Math.round(f.y - inst.ay), inst.W, inst.H);
  }

  _make(f) {
    const R = f.r;
    const W = Math.ceil(R * 2.6);
    const H = Math.ceil(R * 2.4);
    const ax = W / 2;
    const ay = H * 0.58;               // 锚点 = 火区椭圆中心（上方留给火舌，下方留给光晕）

    const cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    const c2d = cv.getContext('2d');
    c2d.imageSmoothingEnabled = false;

    // 砖缝相位：让火场里的横线正好落在世界砖缝上（否则一眼看出是贴图）
    const phase = ((-f.y % BRICK) + BRICK) % BRICK;

    const fx = createFx(MOD, {
      x: ax, y: ay,
      r: R,
      dur: Math.max(0.4, f.maxLife / 1000),
      phase, brick: BRICK,
      seed: f.x * 0.031 + f.y * 0.017,
    });

    const inst = {
      W, H, ax, ay, fx, cv, c2d,
      frame: createFrame(W, H),
      img: new ImageData(W, H),
    };
    this.insts.set(f, inst);
    return inst;
  }

  /** 火焰对象被逻辑层移除后，把画布和 fx 一起回收。 */
  reap(flames) {
    const alive = new Set(flames);
    for (const k of this.insts.keys()) if (!alive.has(k)) this.insts.delete(k);
  }
}
