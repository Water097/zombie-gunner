// soft-fx 单元测试（node 运行，与浏览器共用同一份渲染内核）
// 验证：色阶 / seeded 随机 / 相位数学的确定性与边界，以及【所有绘制路径】在假 Canvas ctx 上
//       不抛异常、不产生 NaN/Infinity 坐标、且每个实例都真的被分派绘制 ——
//       本地服务不可用时，以此替代实机崩溃检查。
//
// 运行：node src/demo/soft-fx.test.mjs

import {
  parseHex, toHex, mixColor, rgba, luma, saturation, paletteStep, makePalette,
  Rng, clamp01, lerp, seg, smooth, ease, PHASE,
  softGlow, softDisc, softRing, softCapsule, softStar, softText,
  drawSoftParticles, drawSoftRings, drawSoftFloaters, SoftFx,
} from './soft-fx.mjs';
import { createWorld, update } from './combat-core.mjs';

let passed = 0, failed = 0;
function ok(name, cond) {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}`); }
}

// ── 假 Canvas2D 上下文：所有方法 noop，但捕获任何 NaN/Infinity 数值入参或属性 ──
function makeCtx() {
  const issues = [];
  const grad = { addColorStop() {} };
  const bad = (v, where) => {
    if (typeof v === 'number' && !Number.isFinite(v)) issues.push(`${where}=${v}`);
  };
  const methods = [
    'save', 'restore', 'beginPath', 'closePath', 'arc', 'ellipse', 'fill', 'stroke',
    'moveTo', 'lineTo', 'translate', 'scale', 'setTransform', 'clearRect', 'fillRect',
    'strokeText', 'fillText', 'createLinearGradient', 'createRadialGradient',
  ];
  const base = {};
  for (const m of methods) {
    base[m] = (...args) => {
      args.forEach((a, i) => bad(a, `${m}[${i}]`));
      return m.startsWith('create') ? grad : undefined;
    };
  }
  base.__issues = issues;
  return new Proxy(base, {
    get(t, k) {
      if (k in t) return t[k];
      return (...args) => { args.forEach((a, i) => bad(a, `${String(k)}[${i}]`)); };
    },
    set(t, k, v) { bad(v, `set:${String(k)}`); t[k] = v; return true; },
  });
}

// 在 makeCtx 外面再包一层调用计数，用来验证「实例生成后真的触发了绘制」
function countingCtx() {
  const inner = makeCtx();
  let n = 0;
  const ctx = new Proxy(inner, {
    get(t, k) {
      const v = t[k];
      if (typeof v === 'function') return (...args) => { n++; return v(...args); };
      return v;
    },
  });
  return { ctx, count: () => n };
}

// ─────────────────────────────────────────────────────────────
console.log('— 颜色解析与色阶 —');
{
  ok('parseHex 6 位', JSON.stringify(parseHex('#7fe0ff')) === JSON.stringify([127, 224, 255]));
  ok('parseHex 3 位缩写', JSON.stringify(parseHex('#abc')) === JSON.stringify([170, 187, 204]));
  ok('parseHex 不带 #', JSON.stringify(parseHex('ff0000')) === JSON.stringify([255, 0, 0]));
  ok('parseHex 非法输入回退暖白', JSON.stringify(parseHex('nope')) === JSON.stringify([255, 216, 138]));
  ok('parseHex 空输入回退暖白', JSON.stringify(parseHex('')) === JSON.stringify([255, 216, 138]));
  ok('toHex 补零与四舍五入', toHex([0, 16, 12.6]) === '#00100d');
  ok('toHex 钳位越界通道', toHex([300, -5, 255]) === '#ff00ff');
  ok('mixColor t=0 返回 a', mixColor('#ff0000', '#0000ff', 0) === '#ff0000');
  ok('mixColor t=1 返回 b', mixColor('#ff0000', '#0000ff', 1) === '#0000ff');
  ok('mixColor t=0.5 取中值', mixColor('#ff0000', '#0000ff', 0.5) === '#800080');
  ok('mixColor t 越界钳位', mixColor('#ff0000', '#0000ff', 3) === '#0000ff' && mixColor('#ff0000', '#0000ff', -2) === '#ff0000');
  ok('rgba 格式正确', rgba('#7fe0ff', 0.5) === 'rgba(127,224,255,0.5)');
  ok('rgba alpha 钳到 [0,1]', rgba('#000000', 2) === 'rgba(0,0,0,1)' && rgba('#000000', -1) === 'rgba(0,0,0,0)');
  ok('luma 黑=0 / 白=1', Math.abs(luma('#000000')) < 1e-9 && Math.abs(luma('#ffffff') - 1) < 1e-9);
  ok('saturation 灰=0 / 纯红=1', saturation('#808080') === 0 && Math.abs(saturation('#ff0000') - 1) < 1e-9);

  const c = '#7fe0ff';
  const pal = makePalette(c, 6);
  ok('色阶 t=1 为白热 #ffffff', paletteStep(c, 1) === '#ffffff');
  ok('色阶 t=0 比主色更暗', luma(paletteStep(c, 0)) < luma(c));
  ok('makePalette 默认 6 档', pal.length === 6);
  ok('makePalette 首尾等于端点采样', pal[0] === paletteStep(c, 0) && pal[5] === paletteStep(c, 1));
  ok('色阶亮度单调递增', pal.every((v, i) => i === 0 || luma(v) >= luma(pal[i - 1]) - 1e-9));
  ok('makePalette n<2 钳到 2 档', makePalette(c, 1).length === 2 && makePalette(c, -5).length === 2);
  ok('中性白自动回退暖金（不派生灰阶）', saturation(paletteStep('#ffffff', 0.5)) > 0.05);
  ok('中性灰自动回退暖金', saturation(paletteStep('#808080', 0.5)) > 0.05);
  ok('色阶入参非法不崩', /^#[0-9a-f]{6}$/i.test(paletteStep('???', 0.7)));
}

// ─────────────────────────────────────────────────────────────
console.log('— seeded 随机（确定性） —');
{
  const a = new Rng(42), b = new Rng(42), c = new Rng(43);
  const sa = Array.from({ length: 32 }, () => a.next());
  const sb = Array.from({ length: 32 }, () => b.next());
  const sc = Array.from({ length: 32 }, () => c.next());
  ok('同 seed 得到同一序列', sa.every((v, i) => v === sb[i]));
  ok('不同 seed 得到不同序列', sc.some((v, i) => v !== sa[i]));
  ok('next() 值域 [0,1)', sa.every((v) => v >= 0 && v < 1));
  const r = new Rng(7);
  const s1 = [r.next(), r.next()];
  r.reset(7);
  const s2 = [r.next(), r.next()];
  ok('reset(seed) 可复现序列', s1[0] === s2[0] && s1[1] === s2[1]);
  ok('range / int / pick 落在区间内', (() => {
    const q = new Rng(9);
    return Array.from({ length: 200 }, () => q.range(5, 10)).every((v) => v >= 5 && v <= 10)
      && Array.from({ length: 200 }, () => q.int(1, 6)).every((v) => v >= 1 && v <= 6 && Number.isInteger(v))
      && Array.from({ length: 200 }, () => q.pick(['a', 'b', 'c'])).every((v) => ['a', 'b', 'c'].includes(v));
  })());
  ok('sign 只返回 ±1 / chance(1)=true / chance(0)=false', (() => {
    const q = new Rng(11);
    return Array.from({ length: 100 }, () => q.sign()).every((v) => v === -1 || v === 1)
      && q.chance(1) === true && q.chance(0) === false;
  })());
}

// ─────────────────────────────────────────────────────────────
console.log('— 相位与缓动数学 —');
{
  ok('clamp01 钳位', clamp01(-1) === 0 && clamp01(2) === 1 && clamp01(0.4) === 0.4);
  ok('lerp', lerp(10, 20, 0.25) === 12.5);
  ok('seg 区间外钳到 0/1 / 区间内归一化', seg(0, 0.2, 0.8) === 0 && seg(1, 0.2, 0.8) === 1 && Math.abs(seg(0.5, 0.2, 0.8) - 0.5) < 1e-9);
  ok('seg 退化区间 b<=a 不产生 NaN', seg(0.5, 0.5, 0.5) === 1 && seg(0.2, 0.5, 0.5) === 0);
  ok('smooth 端点 0/1 与中点 0.5', smooth(0, 1, 0) === 0 && smooth(0, 1, 1) === 1 && Math.abs(smooth(0, 1, 0.5) - 0.5) < 1e-9);
  ok('smooth 单调递增', Array.from({ length: 21 }, (_, i) => smooth(0, 1, i / 20)).every((v, i, arr) => i === 0 || v >= arr[i - 1] - 1e-9));
  const eps = 1e-9;
  ok('ease 各函数在 t=0 / t=1 端点正确',
    Math.abs(ease.inQuad(0)) < eps && Math.abs(ease.inQuad(1) - 1) < eps
    && Math.abs(ease.outQuad(0)) < eps && Math.abs(ease.outQuad(1) - 1) < eps
    && Math.abs(ease.outCubic(0)) < eps && Math.abs(ease.outCubic(1) - 1) < eps
    && Math.abs(ease.outExpo(0)) < eps && ease.outExpo(1) === 1
    && Math.abs(ease.inOutSine(0)) < eps && Math.abs(ease.inOutSine(1) - 1) < eps
    && Math.abs(ease.outBack(0)) < eps && Math.abs(ease.outBack(1) - 1) < eps);
  ok('outExpo / outCubic 全程有限', Array.from({ length: 101 }, (_, i) => i / 100).every((t) => Number.isFinite(ease.outExpo(t)) && Number.isFinite(ease.outCubic(t)) && Number.isFinite(ease.outBack(t))));
  ok('PHASE 相位递增且都在 (0,1)', PHASE.anticipate < PHASE.flash && PHASE.flash < PHASE.spread && PHASE.spread < PHASE.hold
    && Object.values(PHASE).every((v) => v > 0 && v < 1));
}

// ─────────────────────────────────────────────────────────────
console.log('— 绘制原语冒烟（假 ctx） —');
{
  const ctx = makeCtx();
  let threw = null;
  try {
    softGlow(ctx, 100, 80, 30, '#7fe0ff', 0.8);
    softDisc(ctx, 100, 80, 20, '#ff6b6b', 0.9, 0.3);
    softRing(ctx, 100, 80, 40, 3, '#ffd257', 0.9, 0.34, [Math.PI, Math.PI * 2]);
    softCapsule(ctx, 0, 0, 100, 80, 4, '#ffffff', 0.8);
    softStar(ctx, 100, 80, 20, '#ffffff', 0.9);
    softText(ctx, '-27', 100, 80, 17, '#ffd257', { alpha: 0.9, glow: 0.7, scaleX: 1.2, scaleY: 0.9 });
    // 零 alpha / 零半径应安全早退，不产生任何绘制调用
    softGlow(ctx, 0, 0, 10, '#fff', 0);
    softDisc(ctx, 0, 0, 0, '#fff', 1);
    softStar(ctx, 0, 0, 0, '#fff', 1);
    softRing(ctx, 0, 0, 10, 3, '#fff', 0);
  } catch (err) { threw = err; }
  ok('6 个绘制原语不抛异常', !threw);
  ok('6 个绘制原语无 NaN/Infinity 坐标', ctx.__issues.length === 0);
}

// ─────────────────────────────────────────────────────────────
console.log('— 读 world 状态的三个重绘函数（全生命周期） —');
{
  const ctx = makeCtx();
  const parts = Array.from({ length: 11 }, (_, i) => ({
    x: 100 + i * 3, y: 80 - i * 2, vx: 60, vy: -40,
    life: 420 * (1 - i / 10), maxLife: 420, color: i % 3 === 0 ? '#ffe08a' : '#7fe0ff', size: 3,
  }));
  const rings = Array.from({ length: 11 }, (_, i) => ({
    x: 100, y: 80, r: 8 + 90 * i / 10, maxR: 98,
    life: 420 * (1 - i / 10), maxLife: 420, color: '#7fe0ff',
  }));
  const floats = Array.from({ length: 11 }, (_, i) => ({
    x: 100, y: 80 - i * 2, text: i % 3 === 0 ? '暴击 ×3' : '-27',
    life: 700 * (1 - i / 10), maxLife: 700, color: '#ff6b6b',
  }));
  let threw = null;
  try { drawSoftParticles(ctx, parts); drawSoftRings(ctx, rings); drawSoftFloaters(ctx, floats); }
  catch (err) { threw = err; }
  ok('三函数覆盖 life=满→0 全程不抛异常', !threw);
  ok('三函数全程无 NaN/Infinity 坐标', ctx.__issues.length === 0);
  ok('三函数对空数组安全', (() => {
    const c2 = makeCtx();
    try { drawSoftParticles(c2, []); drawSoftRings(c2, []); drawSoftFloaters(c2, []); return c2.__issues.length === 0; }
    catch { return false; }
  })());

  // 容错：逻辑层数据缺字段时渲染层不得抛异常杀死 RAF（parseHex 有安全回退）
  const c3 = makeCtx();
  let t3 = null;
  try { drawSoftParticles(c3, [{ x: 1, y: 2 }]); drawSoftRings(c3, [{}]); drawSoftFloaters(c3, [{ text: 'x' }]); }
  catch (err) { t3 = err; }
  ok('数据缺字段时不抛异常（不会杀死 RAF 循环）', !t3);
}

// ─────────────────────────────────────────────────────────────
console.log('— SoftFx 状态机（触发 / 只读 / 生命周期） —');
{
  const stub = (o = {}) => ({
    started: true, level: 1, killCount: 0,
    player: { x: 160, y: 600 },
    rings: [{ x: 100, y: 300, r: 8, maxR: 60, life: 420, maxLife: 420, color: '#ffffff' }],
    ...o,
  });

  const fx = new SoftFx({ seed: 5 });
  fx.syncWorld(stub({ started: false }));
  ok('started=false 不触发特效且 prev 归零', fx.items.length === 0 && fx.prev.level === null);

  const w = stub();
  fx.syncWorld(w);
  ok('首帧只记录基线、不触发特效', fx.items.length === 0 && fx.prev.level === 1 && fx.prev.killCount === 0);

  w.level = 2; w.killCount = 3;
  const snapAfterEdit = JSON.stringify(w);
  fx.syncWorld(w);
  ok('syncWorld 不写 world（渲染层只读）', JSON.stringify(w) === snapAfterEdit && fx.items.length > 0 && w.level === 2 && w.rings.length === 1);
  ok('升级触发 levelUp 实例', fx.items.some((it) => it.kind === 'levelUp' && it.level === 2));
  const loots = fx.items.filter((it) => it.kind === 'loot');
  // 2026-11-05 用户要求：经验不要再从画面底部飘到顶部经验条，直接加经验即可。
  // 击杀不再触发 loot（货币与掉落本阶段不做）。下面改成反向验证，
  // 防止以后有人把这段不小心接回来。
  ok('击杀不再触发掉落特效（取消经验飞条）', loots.length === 0);
  ok('syncWorld 只产出升级特效', fx.items.every((it) => it.kind === 'levelUp'));
  ok('loot 通道本身仍可用（手动触发不报错）', (() => {
    fx.loot(100, 300, 'gem');
    return fx.items.some((it) => it.kind === 'loot' && it.lootKind === 'gem');
  })());

  const before = fx.items.length;
  fx.syncWorld(w); fx.syncWorld(w);
  ok('无变化时不在每帧重复触发', fx.items.length === before);

  const fx2 = new SoftFx({ seed: 6 });
  const w2 = stub(); fx2.syncWorld(w2); w2.killCount = 10; fx2.syncWorld(w2);
  ok('单帧大量击杀也不产生掉落（掉落本阶段不做）', fx2.items.filter((it) => it.kind === 'loot').length === 0);

  const fx3 = new SoftFx({ seed: 7 });
  fx3.levelUp(10, 20, 3); fx3.loot(1, 2, 'gem'); fx3.poof(3, 4);
  fx3.update(3000);
  ok('update 清掉过期实例', fx3.items.length === 0 && fx3.t === 3000);

  const fx4 = new SoftFx({ seed: 8 });
  for (let i = 0; i < 120; i++) fx4.loot(i, i, 'coin');
  ok('实例池上限 90（防内存膨胀）', fx4.items.length <= 90);
  fx4.reset();
  ok('reset 清空实例 / prev / 时间', fx4.items.length === 0 && fx4.prev.level === null && fx4.t === 0);
}

// ─────────────────────────────────────────────────────────────
console.log('— 全特效实例绘制贯穿冒烟（0→1 全周期） —');
{
  const ctx = makeCtx();
  const fx = new SoftFx({ seed: 20261104, lootTarget: { x: 44, y: 22 } });
  fx.levelUp(160, 560, 7);
  fx.loot(100, 400, 'coin');
  fx.loot(120, 420, 'shard');
  fx.loot(140, 430, 'gem');
  fx.poof(150, 440, '#8fe08f');
  let threw = null;
  try {
    for (let t = 0; t < 2600; t += 16) {
      fx.drawBack(ctx);
      fx.drawFront(ctx);
      fx.update(16);
    }
  } catch (err) { threw = err; }
  ok('升级 / 金币 / 碎片 / 宝石 / 柔烟 全周期绘制不抛异常', !threw);
  ok('全周期绘制无 NaN/Infinity 坐标', ctx.__issues.length === 0);
  ok('全周期结束后实例被回收', fx.items.length === 0);

  // 防回归：每个实例都必须真的触发绘制调用，不能「生成了却静默不画」
  // （曾因 _spawn 的 ...o 覆盖 kind 分派键导致全部掉落道具不可见）
  const probe = (spawn) => {
    const c = countingCtx();
    const f = new SoftFx({ seed: 20261104, lootTarget: { x: 44, y: 22 } });
    spawn(f);
    for (let t = 0; t < 600; t += 16) { f.update(16); f.drawBack(c.ctx); f.drawFront(c.ctx); }
    return c.count();
  };
  const empty = probe(() => {});
  ok('levelUp / coin / shard / gem / poof 五类实例均被分派绘制（无静默零绘制）',
    probe((f) => f.levelUp(160, 560, 7)) > empty
    && probe((f) => f.loot(100, 400, 'coin')) > empty
    && probe((f) => f.loot(120, 420, 'shard')) > empty
    && probe((f) => f.loot(140, 430, 'gem')) > empty
    && probe((f) => f.poof(150, 440, '#8fe08f')) > empty);
}

// ─────────────────────────────────────────────────────────────
console.log('— 真实 world 驱动冒烟（最接近实机） —');
{
  const ctx = makeCtx();
  const w = createWorld();
  w.running = true; w.started = true;
  const fx = new SoftFx({ seed: 20261104, lootTarget: { x: 44, y: 22 } });
  let threw = null;
  try {
    for (let i = 0; i < 900; i++) {
      update(w, 16);
      fx.update(16);
      fx.syncWorld(w);
      drawSoftParticles(ctx, w.particles);
      drawSoftRings(ctx, w.rings);
      drawSoftFloaters(ctx, w.floaters);
      fx.drawBack(ctx);
      fx.drawFront(ctx);
    }
    // 强制一次升级，验证真实 world 下 levelUp 的绘制链路
    w.level += 1;
    fx.syncWorld(w);
    for (let i = 0; i < 160; i++) { fx.update(16); fx.drawBack(ctx); fx.drawFront(ctx); }
  } catch (err) { threw = err; }
  ok('真实 world 900 帧 + 强制升级：不抛异常', !threw);
  ok('真实 world 全链路无 NaN/Infinity 坐标', ctx.__issues.length === 0);
  ok('渲染层实例池在真实 world 下有界', fx.items.length <= 90);
  ok('逻辑层世界状态未被渲染层写坏', Number.isFinite(w.level) && Number.isFinite(w.killCount) && Array.isArray(w.rings));
}

console.log(`\n结果：${passed} 通过 / ${failed} 失败`);
process.exit(failed === 0 ? 0 : 1);
