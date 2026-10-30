// calibrate-upgrade-reward.mjs
// 目的：把 02 册 2.2 的升级奖励「每级暴击伤害增幅 +1.0%」折算成真实 DPS 倍率，
//       校验它能否落在 07 册七·五给「技能升级奖励」分配的 x1.15 预算内。
//
// 关键约束（来自 06 册，不是我编的）：
//   R1 暴击率只由武器决定，卡池不提供裸暴击率 -> 暴击率是「有界的外部变量」
//   基础暴击率：精确15 / 榴弹12 / 突击10 / 霰弹8 / 冲锋6 / 加特林5 （%）
//   暴击率硬上限：25%（未来新枪也不许超过）
//
// 所以这个折算不是纯代数：它是 有效倍率 = 1 + c * B，c 由枪决定。

// ---------- 参数区 ----------
const CRIT_RATES = [
  ["precise rifle", 0.15],
  ["grenade", 0.12],
  ["assault", 0.10],
  ["shotgun", 0.08],
  ["smg", 0.06],
  ["gatling", 0.05],
  ["future cap", 0.25],
];

// 每级给多少暴击伤害（Excel 原值 1.0%）
const PER_LEVEL = 0.01;

// 参与这项奖励的技能数：9 个里 8 个有（制导激光=无）
const SKILLS_WITH_REWARD = 8;
// 每个技能从 LV1 升到 LV20 = 19 次升级（LV1 本身不计）
const STEPS_PER_SKILL = 19;
const MAX_STEPS = SKILLS_WITH_REWARD * STEPS_PER_SKILL; // 152

// 快照：玩家在养成曲线上累计投入了多少次「技能升级」
const SNAPSHOTS = [
  ["early  lv~5 x2 skills", 8],
  ["early-mid  lv10 x2", 18],
  ["mid  lv20 x3", 57],
  ["late  lv20 x6", 114],
  ["END   lv20 x8 (all)", MAX_STEPS],
];

// 暴击基础倍率（不含奖励）：主流做法 crit = 2x
const BASE_CRIT_MULT = 2.0;

// ---------- 1. 解析网格：投了多少 -> 攒了多少暴伤 -> 每把枪的有效倍率 ----------
console.log("=== 1. accrued crit-damage bonus B = steps * 1.0% ===");
console.log("steps".padEnd(8), "B".padEnd(8), ...CRIT_RATES.map(([n]) => n.padStart(14)));
for (const [label, steps] of SNAPSHOTS) {
  const B = steps * PER_LEVEL;
  const row = CRIT_RATES.map(([, c]) => (1 + c * B).toFixed(3).padStart(14));
  console.log(String(steps).padEnd(8), (B * 100).toFixed(0).padEnd(8) + "%", ...row);
}

// ---------- 2. 反解：要卡在预算 x1.15 内，B 最多能有多少 ----------
console.log("\n=== 2. max allowed B for a target budget (eff = 1 + c*B) ===");
const TARGETS = [1.15, 1.12, 1.10];
console.log("gun".padEnd(16), ...TARGETS.map((t) => ("B@x" + t.toFixed(2)).padStart(12)), "   steps@+.01/ea");
for (const [name, c] of CRIT_RATES) {
  const cells = TARGETS.map((t) => (((t - 1) / c) * 100).toFixed(0).padStart(11) + "%");
  const stepsAt115 = Math.floor((TARGETS[0] - 1) / c / PER_LEVEL);
  console.log(name.padEnd(16), ...cells, "   ", stepsAt115);
}

// ---------- 3. 若按最坏情况（未来 25% 暴击枪）也要守住 x1.15 ----------
console.log("\n=== 3. worst-case bound (future cap c=25%) ===");
const C_MAX = 0.25;
for (const t of TARGETS) {
  const Bmax = (t - 1) / C_MAX;
  const perStep = Bmax / MAX_STEPS;
  console.log(
    "target x" + t.toFixed(2),
    "-> B_max =", (Bmax * 100).toFixed(0) + "%",
    "| per-level must be <=", (perStep * 100).toFixed(3) + "%",
    "| vs Excel 1.0% =", (perStep / PER_LEVEL).toFixed(2) + "x"
  );
}

// ---------- 4. Monte Carlo：过杀（overkill）会吃掉多少暴伤收益 ----------
// 场景：向一个 HP=H 的目标连续射击，命中伤害 1（暴击则 base mult + B）。
// 指标：击杀所需发数的期望比 TTK(0)/TTK(B)。过杀越多，暴伤越浪费。
function ttkTrials(B, H, trials) {
  let sum = 0;
  for (let t = 0; t < trials; t++) {
    let hp = H, shots = 0;
    while (hp > 0 && shots < 100000) {
      const isCrit = Math.random() < 0.10; // 取突击步枪 10%
      hp -= isCrit ? BASE_CRIT_MULT + B : 1;
      shots++;
    }
    sum += shots;
  }
  return sum / trials;
}

console.log("\n=== 4. Monte Carlo: effective gain vs target HP (c=10%, includes overkill) ===");
const TRIALS = 40000;
const Btest = MAX_STEPS * PER_LEVEL; // 满投资 152%
const base = {};
for (const H of [1, 2, 3, 5, 10, 40, 200]) base[H] = ttkTrials(0, H, TRIALS);
console.log("HP".padEnd(8), "TTK(0)".padEnd(10), "TTK(maxB)".padEnd(12), "eff. mult".padEnd(12), "theory".padEnd(10));
for (const H of [1, 2, 3, 5, 10, 40, 200]) {
  const withB = ttkTrials(Btest, H, TRIALS);
  const eff = base[H] / withB;
  console.log(
    String(H).padEnd(8),
    base[H].toFixed(2).padEnd(10),
    withB.toFixed(2).padEnd(12),
    eff.toFixed(3).padEnd(12),
    (1 + 0.10 * Btest).toFixed(3).padEnd(10)
  );
}

// ---------- 5. 结论候选：三种把 B 压回预算的改法 ----------
console.log("\n=== 5. three ways to fit the budget ===");
console.log("A) lower per-level  : +0.40%/lv -> END B = " + (MAX_STEPS * 0.004 * 100).toFixed(0) + "%");
console.log("   eff @c=15% = " + (1 + 0.15 * MAX_STEPS * 0.004).toFixed(3) +
            " | @c=25% = " + (1 + 0.25 * MAX_STEPS * 0.004).toFixed(3));
console.log("B) hard cap B<=60%  : early keeps +1.0%/lv, hits ceiling at step " + Math.ceil(0.60 / PER_LEVEL));
console.log("C) keep 1.0% but only MAIN-3 skills count -> B = " + (3 * STEPS_PER_SKILL * PER_LEVEL * 100).toFixed(0) + "%");
console.log("   eff @c=15% = " + (1 + 0.15 * 3 * STEPS_PER_SKILL * PER_LEVEL).toFixed(3) +
            " | @c=25% = " + (1 + 0.25 * 3 * STEPS_PER_SKILL * PER_LEVEL).toFixed(3));

console.log("\n=== 6. IMPORTANT side effect: gun disparity (same account-wide investment) ===");
console.log("gun".padEnd(16), "eff @B=60%".padEnd(12), "eff @B=152%");
for (const [name, c] of CRIT_RATES) {
  console.log(name.padEnd(16), (1 + c * 0.60).toFixed(3).padEnd(12), (1 + c * 1.52).toFixed(3));
}
