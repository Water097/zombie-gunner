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

// 经验曲线丙·修正版（2026-11-02 用户拍板：满级点从 17~18 波拉回「第 19 波中段」
// ——第 19 波的僵尸出一半时升到 Lv20）。前段锚点不变，只拉开 Lv12→20 的每级需求。
// 锚点（由 src/demo/balance-sim.mjs 按当前难度供给校准）：
//   · req(1)=20 → 第 1 波杀 2 只即升 Lv2；首个弹匣（~15s，≈140xp）内最多 Lv3
//   · 第 3 波末（供给≈858xp）→ Lv6（S(6)=478）
//   · 第 9 波末（供给≈3628xp）→ Lv12（S(12)=3043，第 9 波开局即到）
//   · 第 19 波中段（供给≈12408 + 半波≈490）→ Lv20（S(20)=12793）
// 表为「Lv → 升下一级所需 xp」；难度参数若再调，重跑 balance-sim 复核锚点。
export const XP_TABLE = [
  20, 58, 85, 115, 200, 280, 400, 420, 450, 485, 530,    // Lv1→11
  1000, 1100, 1150, 1200, 1250, 1300, 1350, 1100,        // Lv12→20（末级 1100：压在第 19 波中段满级）
];
export function xpForLevel(level) { return XP_TABLE[Math.min(level, XP_TABLE.length) - 1] ?? XP_TABLE[XP_TABLE.length - 1]; }

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
  // 强度纪律：条件卡 ≈ 同类无条件卡的 1.5~2 倍（补偿覆盖率；条件越苛刻倍率越高）
  { id: 'icebreak', kind: 'bonus', target: 'freeze', name: '破冰', text: '对【冻结】目标伤害 +30%',
    apply: (m) => { m.dmgVsFrozen += 0.3; } },
  { id: 'combust', kind: 'bonus', target: 'burn', name: '助燃', text: '对【燃烧】目标伤害 +35%',
    apply: (m) => { m.dmgVsBurn += 0.35; } },
  { id: 'conductor', kind: 'bonus', target: 'shock', name: '导电体', text: '对【感电】目标伤害 +25%',
    apply: (m) => { m.dmgVsShock += 0.25; } },
  { id: 'crossfire', kind: 'bonus', target: 'weapon', name: '交叉火力', text: '场上敌人 ≥8 时【子弹】伤害 +100%',
    apply: (m) => { m.crossfire += 1.0; } },

  // ── 加成卡 B 类：代价型 ──
  // 代价卡定价纪律（2026-11-02 用户提出）：收益必须显著高于同类白给卡，否则是废卡。
  //   轻量化 +60% 射速 vs 枪机轻量化白给 +25% —— 溢价 +35% 才对得起 -15% 伤害。
  //   [PLACEHOLDER · 数值阶段统一复核全部代价卡]
  { id: 'highpressure', kind: 'bonus', target: 'weapon', name: '高压弹仓', text: '【子弹】伤害 +35%，换弹时间 +25%',
    apply: (m) => { m.bulletDamage += 0.35; m.reloadMul *= 1.25; } },
  { id: 'lightweight', kind: 'bonus', target: 'weapon', name: '轻量化', text: '【子弹】射速 +60%，伤害 -15%',
    apply: (m) => { m.fireRate += 0.6; m.bulletDamage *= 0.85; } },

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

// ── 海克斯池算法（2026-11-02 用户拍板：方案四 = 软衰减 + 硬保底）──
// 目标：玩家可以偏科（越拿某方向越容易继续出），但**单次三选一绝不会被同一方向占满**，
//      永远至少有 1 张来自别的方向，保住"选择感"。
//   软衰减：某方向每拿 1 张卡，该方向后续出现权重 ×0.8（越吃越稀有，冷落方向相对变多）
//   硬保底：单次三选一，同一方向最多出现 2 张（3 张里必有 1 张异向）
const SOFT_DECAY = 0.8;          // 每拿 1 张同方向卡，权重乘子
const MAX_PER_CATEGORY = 2;      // 单次三选一同方向上限

// 卡的"方向"（软衰减与硬保底共用）：学习卡 / 武器线 / 各技能线 / 通用加成
function categoryOf(c) {
  if (c.kind === 'learn') return 'learn';
  return c.target || c.kind;     // weapon / freeze / burn / shock / bonus(通用)
}

// 该卡权重（受所属线等级衰减 × 软衰减）
function weightOf(world, c) {
  const lv = c.target ? (world.slotLevels[c.target] || 0) : 0;
  const taken = c.target ? (world.slotLevels[c.target] || 0) : (world.cardStacks[c.id] || 0);
  return lineDecay(lv) * Math.pow(SOFT_DECAY, taken);
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

  // 方向计数（硬保底用）：本次三选一里每个方向已占几张
  const catCount = (c) => picks.filter((p) => categoryOf(p) === categoryOf(c)).length;

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
  //    硬保底：同方向最多 MAX_PER_CATEGORY 张；池子被方向约束榨干时才放宽
  let guard = 0;
  while (picks.length < 3 && guard++ < 80) {
    const rest = buildPool().concat(canLearn ? learnPool : []);
    const pool = rest.filter((it) => !taken(it.card));
    if (!pool.length) break;
    const relaxed = pool.filter((it) => catCount(it.card) < MAX_PER_CATEGORY);
    const c = weightedPick(relaxed.length ? relaxed : pool);
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
