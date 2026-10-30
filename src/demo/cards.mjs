// 卡池（对齐 03 册「三族卡池」+ 08 册「加成卡体系」）
//
// 08 册硬纪律：每张卡必须带主语。判别标准——把卡面上的名词去掉后如果还成立，就是不合格的。
// 「子弹伤害 +60%」去掉"子弹"就不成立 → 合格；「伤害 +20%」去掉后仍成立 → 禁止（通用最优解）。
// 08 册约束 3：同桶加算，不连乘（自带收益递减）。
//
// 卡面文案纪律（03 册七节）：必须说清"加的是哪一项"。
// 「【子弹】+30%」是废文案——没说伤害还是射速；必须写成「【子弹】伤害 +30%」。
//
// 三族：
//   weapon 武器卡（不占槽）—— 只强化主武器线
//   skill  技能卡（占槽）  —— 只强化某一条技能线
//   bonus  加成卡（软上限）—— 跨线放大器，每张限定主语
//
// target：这张卡挂到哪个槽上计数（右上角武器/技能槽会显示该槽累计吃了几张卡）

// 加成卡预算按等级分层解锁（08 册一节：防止前 5 级一次到顶）
export function bonusBudget(level) {
  if (level <= 6) return 2;
  if (level <= 13) return 4;
  return 6;
}

export const CARDS = [
  // ── 武器卡：只影响主武器线 ──
  { id: 'bullet-dmg', kind: 'weapon', target: 'weapon', name: '弹头改良', text: '【子弹】伤害 +60%', maxStack: 3,
    apply: (m) => { m.bulletDamage += 0.6; } },
  { id: 'bullet-rate', kind: 'weapon', target: 'weapon', name: '枪机轻量化', text: '【子弹】射速 +25%', maxStack: 3,
    apply: (m) => { m.fireRate += 0.25; } },
  { id: 'bullet-pierce', kind: 'weapon', target: 'weapon', name: '穿甲弹头', text: '【子弹】穿透 +1', maxStack: 2,
    apply: (m) => { m.pierceBonus += 1; } },

  // ── 技能卡：只影响对应那条技能线 ──
  { id: 'freeze-cd', kind: 'skill', target: 'freeze', name: '制冷回路', text: '【干冰弹】冷却 -25%', maxStack: 2,
    apply: (m) => { m.skillCdMul.freeze *= 0.75; } },
  { id: 'freeze-dur', kind: 'skill', target: 'freeze', name: '极寒延长', text: '【干冰弹】冻结时长 +1.0 秒', maxStack: 2,
    apply: (m) => { m.freezeDurBonus += 1000; } },
  { id: 'burn-radius', kind: 'skill', target: 'burn', name: '燃料增量', text: '【温压弹】爆炸半径 +30%', maxStack: 2,
    apply: (m) => { m.burnRadiusMul += 0.3; } },
  { id: 'burn-dmg', kind: 'skill', target: 'burn', name: '高温装药', text: '【温压弹】灼烧伤害 +60%', maxStack: 2,
    apply: (m) => { m.burnDmgMul += 0.6; } },
  { id: 'shock-cd', kind: 'skill', target: 'shock', name: '电容扩容', text: '【电磁】冷却 -25%', maxStack: 2,
    apply: (m) => { m.skillCdMul.shock *= 0.75; } },
  { id: 'shock-dur', kind: 'skill', target: 'shock', name: '过载电容', text: '【电磁】感电时长 +1.5 秒', maxStack: 2,
    apply: (m) => { m.shockDurBonus += 1500; } },

  // ── 加成卡 A 类：放大器，每张只奖励一种配合（没点对应技能时它是废卡）──
  { id: 'icebreak', kind: 'bonus', target: 'freeze', name: '破冰', text: '对【冻结】目标伤害 +30%', maxStack: 2,
    apply: (m) => { m.dmgVsFrozen += 0.3; } },
  { id: 'combust', kind: 'bonus', target: 'burn', name: '助燃', text: '对【燃烧】目标伤害 +35%', maxStack: 2,
    apply: (m) => { m.dmgVsBurn += 0.35; } },
  { id: 'conductor', kind: 'bonus', target: 'shock', name: '导电体', text: '对【感电】目标伤害 +25%', maxStack: 2,
    apply: (m) => { m.dmgVsShock += 0.25; } },
  { id: 'crossfire', kind: 'bonus', target: 'weapon', name: '交叉火力', text: '场上敌人 ≥8 时【子弹】伤害 +30%', maxStack: 2,
    apply: (m) => { m.crossfire += 0.3; } },

  // ── 加成卡 B 类：代价型（带负面，天然免疫"通用最优解"）──
  // 弹匣容量已固定为 30（用户决定），故代价改为换弹时间，不再动弹匣
  { id: 'highpressure', kind: 'bonus', target: 'weapon', name: '高压弹仓', text: '【子弹】伤害 +35%，换弹时间 +25%', maxStack: 1,
    apply: (m) => { m.bulletDamage += 0.35; m.reloadMul *= 1.25; } },
  { id: 'lightweight', kind: 'bonus', target: 'weapon', name: '轻量化', text: '【子弹】射速 +30%，伤害 -15%', maxStack: 1,
    apply: (m) => { m.fireRate += 0.3; m.bulletDamage *= 0.85; } },

  // ── 加成卡 C 类：资源型（改的是"这一局你能做多少次选择"）──
  { id: 'rapidlearn', kind: 'bonus', target: null, name: '快速学习', text: '经验获取 +25%', maxStack: 2,
    apply: (m) => { m.xpRate += 0.25; } },
];

// 功能卡（事件卡）：不属于三族、不占加成卡预算。要塞血量首次跌破 50% 后，下一抽必现，一局仅一次。
export const MERCY_CARD = {
  id: 'mercy',
  kind: 'function',
  target: null,
  name: '要塞急救',
  text: '立即回复要塞最大血量 30%',
  maxStack: 1,
};

function pickOne(list) { return list[Math.floor(Math.random() * list.length)]; }

// 三选一（03 册三节）：至少 1 张已学技能/武器卡的强化；加成卡受预算约束；叠满的移出池
export function rollCards(world) {
  const budget = bonusBudget(world.level);
  const avail = CARDS.filter((c) => {
    if ((world.cardStacks[c.id] || 0) >= c.maxStack) return false; // 已叠满，移出池
    if (c.kind === 'bonus' && world.bonusTaken >= budget) return false;
    return true;
  });

  const picks = [];
  // 硬保底：至少 1 张非加成卡（保证"深挖某条线"永远有路）
  const core = avail.filter((c) => c.kind !== 'bonus');
  if (core.length) picks.push(pickOne(core));
  let guard = 0;
  while (picks.length < 3 && guard++ < 60) {
    const c = pickOne(avail);
    if (!picks.some((p2) => p2.id === c.id)) picks.push(c);
  }

  // 功能卡「要塞急救」：作为第 4 张保底卡出现，不挤占正常 3 张
  if (world.mercyArmed && !world.mercyUsed) {
    picks.push(MERCY_CARD);
    world.mercyUsed = true;
    world.mercyArmed = false;
  }
  return picks;
}
