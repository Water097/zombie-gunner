// 卡池（对齐 03 册「三族卡池」+ 08 册「加成卡体系」）
//
// 08 册硬纪律：每张卡必须带主语。判别标准——把卡面上的名词去掉后如果还成立，就是不合格的。
// 卡面文案纪律：必须说清"加的是哪一项"（「【子弹】+30%」是废文案，要写「【子弹】伤害 +30%」）。
// 08 册约束 3：同桶加算，不连乘（自带收益递减）。
//
// 开局状态（对齐参考视频）：**一个技能都没有**，只有主武器子弹。
// 技能要靠「学习技能卡」解锁；技能卡只出已学技能；放大器（破冰/助燃/导电体）要求对应技能已学。
//
// 不封顶（2026-10-30 用户推翻 03 册"武器卡 6 级封顶"）：
//   卡可以无限叠，但**某条线等级越高，它的卡出现概率越低**（自然收敛，不做硬上限）：
//     线等级 ≤8  → 权重 1.0
//     9~10 级    → 权重 0.9（降 10%）
//     >10 级     → 每多 1 级再降 5%（0.85 / 0.80 / …，下限 0.2）

export const MAX_LEVEL = 20; // 一局 20 次三选一（03 册）

// 经验曲线：线性（原 ×1.35 指数太陡，实测 24 波都到不了 20 级）
// 与刷怪量锁死（03 册一节）：目标 = 每波约升 1 级，第 19 波前后到 20 级，第 20 波收尾。
// 数值由 src/demo/balance-sim.mjs 无头模拟校准。
export const XP = { base: 162, step: 45 };
export function xpForLevel(level) { return Math.round(XP.base + (level - 1) * XP.step); }

// 某条线（武器 / 某个技能）的等级 → 该线卡片的出现权重
export function lineDecay(level) {
  if (level <= 8) return 1;
  if (level <= 10) return 0.9;
  return Math.max(0.2, 0.9 - (level - 10) * 0.05);
}

// 加成卡预算按等级分层解锁（08 册一节：防止前 5 级一次到顶）
export function bonusBudget(level) {
  if (level <= 6) return 2;
  if (level <= 13) return 4;
  return 6;
}

// ── 学习技能卡（入门卡）：开局没有任何技能，必须先学会才谈得上强化 ──
export const LEARN_CARDS = [
  { id: 'learn-freeze', kind: 'learn', target: 'freeze', name: '干冰弹', text: '学会【干冰弹】· 冰系穿透，冻结敌人' },
  { id: 'learn-burn', kind: 'learn', target: 'burn', name: '温压弹', text: '学会【温压弹】· 火系爆炸，灼烧敌人' },
  { id: 'learn-shock', kind: 'learn', target: 'shock', name: '电磁穿刺', text: '学会【电磁穿刺】· 雷击穿透，麻痹敌人' },
];

export const CARDS = [
  // ── 武器卡：只影响主武器线 ──
  { id: 'bullet-dmg', kind: 'weapon', target: 'weapon', name: '弹头改良', text: '【子弹】伤害 +60%',
    apply: (m) => { m.bulletDamage += 0.6; } },
  { id: 'bullet-rate', kind: 'weapon', target: 'weapon', name: '枪机轻量化', text: '【子弹】射速 +25%',
    apply: (m) => { m.fireRate += 0.25; } },
  { id: 'bullet-pierce', kind: 'weapon', target: 'weapon', name: '穿甲弹头', text: '【子弹】穿透 +1',
    apply: (m) => { m.pierceBonus += 1; } },

  // ── 技能卡：只出已学技能的卡（03 册：当局池只出你已学技能的卡）──
  { id: 'freeze-cd', kind: 'skill', target: 'freeze', name: '制冷回路', text: '【干冰弹】冷却 -25%',
    apply: (m) => { m.skillCdMul.freeze *= 0.75; } },
  { id: 'freeze-dur', kind: 'skill', target: 'freeze', name: '极寒延长', text: '【干冰弹】冻结时长 +1.0 秒',
    apply: (m) => { m.freezeDurBonus += 1000; } },
  { id: 'burn-radius', kind: 'skill', target: 'burn', name: '燃料增量', text: '【温压弹】爆炸半径 +30%',
    apply: (m) => { m.burnRadiusMul += 0.3; } },
  { id: 'burn-dmg', kind: 'skill', target: 'burn', name: '高温装药', text: '【温压弹】灼烧伤害 +60%',
    apply: (m) => { m.burnDmgMul += 0.6; } },
  { id: 'shock-cd', kind: 'skill', target: 'shock', name: '电容扩容', text: '【电磁】冷却 -25%',
    apply: (m) => { m.skillCdMul.shock *= 0.75; } },
  { id: 'shock-dur', kind: 'skill', target: 'shock', name: '过载电容', text: '【电磁】感电时长 +1.5 秒',
    apply: (m) => { m.shockDurBonus += 1500; } },

  // ── 加成卡 A 类：放大器（要求对应技能已学，否则是废卡）──
  { id: 'icebreak', kind: 'bonus', target: 'freeze', name: '破冰', text: '对【冻结】目标伤害 +30%',
    apply: (m) => { m.dmgVsFrozen += 0.3; } },
  { id: 'combust', kind: 'bonus', target: 'burn', name: '助燃', text: '对【燃烧】目标伤害 +35%',
    apply: (m) => { m.dmgVsBurn += 0.35; } },
  { id: 'conductor', kind: 'bonus', target: 'shock', name: '导电体', text: '对【感电】目标伤害 +25%',
    apply: (m) => { m.dmgVsShock += 0.25; } },
  { id: 'crossfire', kind: 'bonus', target: 'weapon', name: '交叉火力', text: '场上敌人 ≥8 时【子弹】伤害 +30%',
    apply: (m) => { m.crossfire += 0.3; } },

  // ── 加成卡 B 类：代价型 ──
  { id: 'highpressure', kind: 'bonus', target: 'weapon', name: '高压弹仓', text: '【子弹】伤害 +35%，换弹时间 +25%',
    apply: (m) => { m.bulletDamage += 0.35; m.reloadMul *= 1.25; } },
  { id: 'lightweight', kind: 'bonus', target: 'weapon', name: '轻量化', text: '【子弹】射速 +30%，伤害 -15%',
    apply: (m) => { m.fireRate += 0.3; m.bulletDamage *= 0.85; } },

  // ── 加成卡 C 类：资源型 ──
  { id: 'rapidlearn', kind: 'bonus', target: null, name: '快速学习', text: '经验获取 +25%',
    apply: (m) => { m.xpRate += 0.25; } },
];

// 功能卡（事件卡）：不属于三族、不占加成卡预算。要塞血量首次跌破 50% 后，下一抽必现，一局仅一次。
export const MERCY_CARD = {
  id: 'mercy', kind: 'function', target: null, name: '要塞急救', text: '立即回复要塞最大血量 30%',
};

// 卡是否可进池
function eligible(world, c) {
  if (c.kind === 'bonus' && world.bonusTaken >= bonusBudget(world.level)) return false;
  if (c.kind === 'skill' && !world.skills[c.target]) return false;              // 只出已学技能
  if (c.kind === 'bonus' && c.target && c.target !== 'weapon' && !world.skills[c.target]) return false; // 放大器要对应技能
  return true;
}

// 该卡权重（受所属线等级衰减）
function weightOf(world, c) {
  const lv = c.target ? (world.slotLevels[c.target] || 0) : 0;
  return lineDecay(lv);
}

function weightedPick(pool) {
  if (!pool.length) return null;
  const total = pool.reduce((s, it) => s + it.weight, 0);
  if (total <= 0) return pool[Math.floor(Math.random() * pool.length)].card;
  let r = Math.random() * total;
  for (const it of pool) { r -= it.weight; if (r <= 0) return it.card; }
  return pool[pool.length - 1].card;
}

// 三选一（03 册三节）
//  · 开局没技能 → 必带 1 张「学习技能卡」
//  · 否则至少 1 张非加成卡（保证深挖有路）
//  · 剩余次数不足时停发新技能卡（03 册停发公式简化：至少留 4 次给新技能成长）
export function rollCards(world) {
  const picks = [];
  const taken = (c) => picks.some((p) => p.id === c.id);
  const buildPool = (filter) => CARDS
    .concat(world.learnPool ? [] : [])
    .filter((c) => eligible(world, c) && (!filter || filter(c)))
    .map((c) => ({ card: c, weight: weightOf(world, c) }));

  const learnedCount = Object.keys(world.skills).length;
  const remaining = MAX_LEVEL - world.level;
  const canLearn = learnedCount < 3 && remaining >= 4;

  // 学习技能卡池（未学的才进池）
  const learnPool = LEARN_CARDS
    .filter((c) => !world.skills[c.target])
    .map((c) => ({ card: c, weight: 1 }));

  // ① 开局一个技能都没有 → 先给技能
  if (learnedCount === 0 && learnPool.length) {
    const first = weightedPick(learnPool);
    if (first) picks.push(first);
  } else {
    // ② 硬保底：至少 1 张非加成卡（武器卡 / 已学技能卡）
    const core = buildPool((c) => c.kind !== 'bonus');
    const pick = weightedPick(core);
    if (pick) picks.push(pick);
  }

  // ③ 补齐到 3 张（可含学习卡，但受停发公式约束）
  let guard = 0;
  while (picks.length < 3 && guard++ < 80) {
    const rest = buildPool().concat(canLearn ? learnPool : []);
    const pool = rest.filter((it) => !taken(it.card));
    if (!pool.length) break;
    const c = weightedPick(pool);
    if (c && !taken(c)) picks.push(c);
  }

  // 功能卡「要塞急救」：作为第 4 张保底卡出现，不挤占正常 3 张
  if (world.mercyArmed && !world.mercyUsed) {
    picks.push(MERCY_CARD);
    world.mercyUsed = true;
    world.mercyArmed = false;
  }
  return picks;
}
