// 1.2 + 1.3 数值配平：把"武器独占机制"和"4 部位攻击词条"两条草案落进 ×2.0 账。
// 跑两项：(A) 装备 4 部位攻击词条 Monte Carlo 聚合倍率 vs 装备预算 ×1.30
//        (B) 6 把枪灾厄独占机制的有效倍率 vs 武器品级预算 ×1.22（进而 vs 总账 ×2.0）
// 结论用文字打印，供人工落回 06 / 07 册。

const N = 200000;

// ---------- (A) 装备 4 部位攻击词条 ----------
// 技能：elem=元素，coeffSlot=该技能系数词条落在哪个部位（head/belt/shoe）
const skills = {
  温压弹:   { elem: '火',   coeffSlot: 'head' },
  干冰弹:   { elem: '冰',   coeffSlot: 'belt' },
  电磁穿刺: { elem: '电',   coeffSlot: 'belt' },
  高能射线: { elem: '能量', coeffSlot: 'shoe' },
  燃烧地带: { elem: '燃烧', coeffSlot: 'shoe' },
};
const skillNames = Object.keys(skills);

// 每个部位的攻击词条选项（kind: global / elem / coeff）
const pools = {
  head: [
    { kind: 'coeff', skill: '温压弹', v: 0.10 },
    { kind: 'elem',  elem: '火',   v: 0.08 },
    { kind: 'elem',  elem: '冰',   v: 0.06 },
    { kind: 'elem',  elem: '物理', v: 0.06 },
  ],
  chest: [
    { kind: 'global', v: 0.10 },
    { kind: 'elem',   elem: '能量', v: 0.08 },
  ],
  belt: [
    { kind: 'coeff', skill: '电磁穿刺', v: 0.10 },
    { kind: 'elem',  elem: '电',   v: 0.07 },
    { kind: 'coeff', skill: '干冰弹',   v: 0.10 },
  ],
  shoe: [
    { kind: 'elem',   elem: '能量', v: 0.08 },
    { kind: 'coeff', skill: '高能射线', v: 0.10 },
    { kind: 'elem',  elem: '燃烧', v: 0.10 },
  ],
};

// 给定一组技能权重，为 4 个部位各自选最优词条，返回组合倍率
function bestLoadout(weights) {
  const total = skillNames.reduce((s, k) => s + weights[k], 0);
  const gains = {}; // per slot -> array of {opt, gain}
  for (const slot of ['head', 'chest', 'belt', 'shoe']) {
    let best = null, bestGain = -1;
    for (const opt of pools[slot]) {
      let gain = 0;
      for (const k of skillNames) {
        let c = 0;
        if (opt.kind === 'global') c = opt.v;
        else if (opt.kind === 'elem' && skills[k].elem === opt.elem) c = opt.v;
        else if (opt.kind === 'coeff' && opt.skill === k) c = opt.v;
        gain += weights[k] * c;
      }
      if (gain > bestGain) { bestGain = gain; best = opt; }
    }
    gains[slot] = best;
  }
  // 算每个技能的实际倍率
  let agg = 0;
  for (const k of skillNames) {
    let m = 1;
    for (const slot of ['head', 'chest', 'belt', 'shoe']) {
      const o = gains[slot];
      if (o.kind === 'global') m *= (1 + o.v);
      else if (o.kind === 'elem' && skills[k].elem === o.elem) m *= (1 + o.v);
      else if (o.kind === 'coeff' && o.skill === k) m *= (1 + o.v);
    }
    agg += (weights[k] / total) * m;
  }
  return agg;
}

// 采样：随机 1~4 个技能，随机权重
function randPortfolio() {
  const k = 1 + Math.floor(Math.random() * 4);
  const picked = [...skillNames].sort(() => Math.random() - 0.5).slice(0, k);
  const w = {};
  let s = 0;
  for (const name of picked) { w[name] = Math.random(); s += w[name]; }
  for (const name of picked) w[name] /= s;
  // 未选技能权重 0
  for (const name of skillNames) if (!(name in w)) w[name] = 0;
  return w;
}

const samples = [];
for (let i = 0; i < N; i++) samples.push(bestLoadout(randPortfolio()));
samples.sort((a, b) => a - b);
const mean = samples.reduce((s, v) => s + v, 0) / N;
const pct = (p) => samples[Math.floor(p * N)];
// 极端：纯专精（单技能最优）与纯通用（4 技能各吃一个系数槽）
const specialist = bestLoadout({ 温压弹: 1, 干冰弹: 0, 电磁穿刺: 0, 高能射线: 0, 燃烧地带: 0 });
const generalist = bestLoadout({ 温压弹: 0.25, 干冰弹: 0.25, 电磁穿刺: 0.25, 高能射线: 0.25, 燃烧地带: 0 });

console.log('=== (A) 装备 4 部位攻击词条 · 聚合倍率分布（目标预算 ×1.30） ===');
console.log(`样本 ${N}  均值 ${mean.toFixed(4)}  p50 ${pct(.5).toFixed(4)}  p90 ${pct(.9).toFixed(4)}  p99 ${pct(.99).toFixed(4)}  最大 ${samples[N-1].toFixed(4)}`);
console.log(`纯专精(单技能最优) ${specialist.toFixed(4)}  纯通用(4技能各吃系数槽) ${generalist.toFixed(4)}`);
console.log(`预算 ×1.30 → 均值余量 ${(1.30/mean - 1).toFixed(1)}%  最大超预算? ${samples[N-1] > 1.30 ? '是 +'+((samples[N-1]/1.30-1)*100).toFixed(1)+'%' : '否'}`);

// ---------- (B) 武器灾厄独占机制 有效倍率（基于明确假设的估计） ----------
// 假设：各枪 tier1→5（基础数值+2词条槽+性格上限）增长 = ×1.13；独占机制(tier6)为额外倍率 M。
// 武器品级总账 = 1.13 × M；当前账本分配武器品级 ×1.22 → 理想 M≈1.079。
const TIER15 = 1.13;
const drafted = { // 经验草案的有效 DPS 倍率（假设见注释），待真机 playtest
  '突击步枪': { M: 1.18, note: '层数5→8(+3层×5%≈+15%) + 每5层随机主场+15%，估 ×1.18' },
  '冲锋枪':   { M: 1.25, note: '消除换弹真空(~15-20% uptime) + W2前6发+35%转常驻(~+10%)，估 ×1.25' },
  '霰弹枪':   { M: 1.35, note: '近距判定25%→50%射程(翻倍覆盖) + +40%改每弹丸，估 ×1.35' },
  '精确步枪': { M: 1.15, note: '穿透+2 + 远距保档 + 每穿透目标+10%递减，单体/群估 ×1.15' },
  '榴弹炮':   { M: 1.45, note: '弹夹5→8(+60%) + 每发按首发+50%，估 ×1.45' },
  '加特林':   { M: 1.20, note: '换弹不清射速层，保住 ramp，估 ×1.20' },
};
console.log('\n=== (B) 武器灾厄独占机制 · 有效倍率 vs 武器预算 ×1.22 ===');
console.log(`假设 tier1→5 增长 = ×${TIER15}；武器总账 = 1.13×M；账本分配武器 ×1.22 ⇒ 理想 M≈1.079`);
let sumM = 0;
for (const [gun, d] of Object.entries(drafted)) {
  const weaponTotal = TIER15 * d.M;
  console.log(`  ${gun.padEnd(6)} 草稿 M=${d.M.toFixed(2)} → 武器总账 ×${weaponTotal.toFixed(3)}  ${weaponTotal>1.22?'⚠️超×1.22':'✓'}  (${d.note})`);
  sumM += d.M;
}
const avgM = sumM / 6;
const weaponTotal = TIER15 * avgM;
console.log(`平均 M=${avgM.toFixed(3)} → 武器平均总账 ×${weaponTotal.toFixed(3)}  (账本 ×1.22)`);

// 推进到总账 ×2.0：装备×1.30 / 等级×1.10 / 技能×1.114
const ledger = { weapon: weaponTotal, level: 1.10, skill: 1.114, gear: 1.30 };
const total = ledger.weapon * ledger.level * ledger.skill * ledger.gear;
console.log(`\n总账(草案独占不削) = ${ledger.weapon.toFixed(3)}×1.10×1.114×1.30 = ×${total.toFixed(3)}  ${total>2.0?'⚠️超 ×2.0！':'✓ 未超'}`);

// 推荐：削 3 个最强的独占到 ~×1.15，并把账本重分（武器×1.30 / 装备×1.20）
const trimmed = { '突击步枪':1.16,'冲锋枪':1.13,'霰弹枪':1.15,'精确步枪':1.15,'榴弹炮':1.18,'加特林':1.15 };
let s2=0; for(const v of Object.values(trimmed)) s2+=v;
const avgM2 = s2/6; const weaponTotal2 = TIER15*avgM2;
const total2 = weaponTotal2 * 1.10 * 1.114 * 1.20;
console.log(`\n推荐方案：独占削到 ~×1.15（avg M=${avgM2.toFixed(3)}）→ 武器总账 ×${weaponTotal2.toFixed(3)}；账本重分 武器×1.30/等级×1.10/技能×1.114/装备×1.20`);
console.log(`推荐总账 = ${weaponTotal2.toFixed(3)}×1.10×1.114×1.20 = ×${total2.toFixed(3)}  ${total2>2.0?'⚠️超':'✓ 未超（留余量）'}`);
console.log('削减后独占：', Object.entries(trimmed).map(([g,v])=>`${g}×${v}`).join('  '));
