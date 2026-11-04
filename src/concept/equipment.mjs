// 武器类别（06 册 6 把型号）+ 装备类别（07 册 6 个部位）
// 名称全部取自已定稿文档，不改名、不发明第七把枪。
// 全部是 pure effect，createFx 可直接调用。

import {
  WHITE, INK, TAU, clamp, wrap, seg, RAMPS, C, step,
  frameMeta, makeFx,
} from './pixel-lib.mjs';

const W = 112, H = 80, DUR = 1.6;

// ── 武器：枪械轮廓 + 开火节奏，射速/弹丸数就是这把枪的「性格」 ──
const GUNS = [
  { id: 'assault', name: '突击步枪', spec: '单发·中射速·中弹夹', mech: '新手默认 / 全维同步，无短板',
    read: '中长枪管 + 匀速点射', accent: RAMPS.green, barrel: 22, shots: 5, pellets: 1, magH: 9 },
  { id: 'smg', name: '冲锋枪', spec: '单发·极高射速·小弹夹', mech: '触发频率高 / 换弹最频繁',
    read: '短枪身 + 密集连闪', accent: RAMPS.volt, barrel: 13, shots: 14, pellets: 1, magH: 11 },
  { id: 'shotgun', name: '霰弹枪', spec: '一次多弹丸·短射程', mech: '每颗弹丸独立触发 / 越近越强',
    read: '粗双管 + 扇形 5 弹丸', accent: RAMPS.fire, barrel: 18, shots: 2, pellets: 5, magH: 7 },
  { id: 'grenade', name: '榴弹炮', spec: '单发·自带爆炸·极慢', mech: '天生 AOE / 漏怪率高',
    read: '大口径炮口 + 落点爆闪', accent: RAMPS.bomb, barrel: 19, shots: 1, pellets: 1, magH: 8, heavy: true },
  { id: 'precision', name: '精确步枪', spec: '单发·高伤·长射程·天然穿透', mech: '单体极强 / 前半场统治',
    read: '最长枪管 + 瞄准镜 + 长穿透线', accent: RAMPS.ice, barrel: 31, shots: 2, pellets: 1, magH: 6, scope: true },
  { id: 'gatling', name: '加特林', spec: '射速随时间递增', mech: '越打越猛 / 换弹后重新提速',
    read: '旋转多管 + 逐渐加密的连闪', accent: RAMPS.gold, barrel: 22, shots: 10, pellets: 1, magH: 12, spin: true },
];

function drawGun(p, t, c) {
  const u = wrap(t, DUR) / DUR;
  const R = RAMPS.metal, A = c.accent;
  const recoil = Math.sin(u * TAU * c.shots) > 0.88 ? -2 : 0;
  const X = recoil;

  // 枪托
  p.rect(-30 + X, -3, 11, 8, R[2], 1);
  p.rect(-30 + X, -3, 11, 1, R[5], 1);
  p.poly([[-19 + X, 5], [-12 + X, 5], [-14 + X, 14], [-19 + X, 14]], R[1], 1);
  // 机匣
  p.rect(-19 + X, -7, 23, 12, R[3], 1);
  p.rect(-19 + X, -7, 23, 2, R[6], 1);
  p.rect(-19 + X, 4, 23, 1, R[1], 1);
  p.rect(-14 + X, -4, 6, 4, A[3], 1);
  // 弹匣
  p.rect(-9 + X, 5, 7, c.magH, R[2], 1);
  p.rect(-9 + X, 5, 7, 1, R[5], 1);
  p.rect(-7 + X, 7, 3, 2, A[4], 1);
  // 枪管
  const bw = c.heavy ? 8 : 5;
  p.rect(4 + X, -bw / 2, c.barrel, bw, R[4], 1);
  p.rect(4 + X, -bw / 2, c.barrel, 1, R[7], 1);
  p.rect(4 + X, bw / 2 - 1, c.barrel, 1, R[1], 1);
  if (c.spin) {
    const spin = u * TAU * 3;
    for (let i = 0; i < 3; i++) {
      const dy = Math.sin(spin + i * TAU / 3) * 3;
      p.rect(6 + X, -1 + dy, c.barrel - 3, 2, i === 0 ? R[7] : R[2], 1);
    }
  }
  if (c.scope) {
    p.rect(-2 + X, -12, 13, 4, R[3], 1);
    p.rect(1 + X, -11, 8, 2, A[6], 1);
    p.rect(-4 + X, -8, 2, 2, R[2], 1);
    p.rect(11 + X, -8, 2, 2, R[2], 1);
  }
  if (c.heavy) { p.rect(4 + X, -6, 6, 12, R[2], 1); p.rect(4 + X, -6, 6, 1, R[6], 1); }

  // 开火：枪口闪白 hero frame + 弹道（射速由 shots 决定，弹丸数由 pellets 决定）
  const ph = wrap(u * c.shots, 1);
  if (ph < 0.20) {
    const k = 1 - ph / 0.20;
    const mx = 4 + X + c.barrel;
    p.circle(mx + 2, 0, 2.5 + 5 * k, A[7], 0.90 * k);
    p.circle(mx + 2, 0, 1.5 + 2 * k, WHITE, 0.95 * k);
    p.glow(mx + 2, 0, 13 + 10 * k, A[5], 0.35 * k);
    if (c.pellets > 1) {
      for (let i = 0; i < c.pellets; i++) {
        const an = -0.42 + (i / (c.pellets - 1)) * 0.84;
        p.line(mx + 3, 0, mx + 20, Math.sin(an) * 20, A[6], 0.75 * k);
      }
    } else if (c.heavy) {
      const bx = mx + 16 + 14 * (1 - k), by = -6 + 10 * (1 - k);
      p.circle(bx, by, 3 + 5 * (1 - k), A[6], 0.9 * k);
      p.glow(bx, by, 12, A[5], 0.35 * k);
    } else {
      p.line(mx + 3, 0, mx + 24, 0, A[7], 0.85 * k);
      p.line(mx + 3, 0, mx + 16, 0, A[5], 0.55 * k);
    }
  }
}

export const WEAPON_EFFECTS = GUNS.map((c) => ({
  id: c.id, name: c.name, spec: c.spec, mech: c.mech, read: c.read,
  source: '内核新写', demoHook: `weapon.model === '${c.id}' → drawGun()`,
  mod: makeFx(frameMeta(c.name, W, H, {
    desc: `${c.spec}｜${c.mech}`, tags: ['weapon', c.id], duration: DUR, oy: H / 2,
  }), (p, t) => drawGun(p, t, c)),
}));

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
