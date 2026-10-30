// calibrate-pellet-economy.mjs
// 目的：用户二审确认「弹道 / 双发」是乘法叠加 N = (1+a)*(1+b)，
//       要求：选了 k 张这类卡，总收益应该 ≈ k 张普通加成卡，而不是 1 变 9 超模。
//       本脚本反解「每颗弹丸的伤害系数」表。
//
// 变量：
//   a = 弹道层数（散射，铺开到不同线）      b = 双发层数（同落点）
//   N = (1+a) * (1+b)    <- 乘法，用户确认
//   名义满载输出 T(k) = N * (每颗弹丸伤害)  <- 目标是每张卡贡献固定边际 g

const fmt = (x) => (Math.round(x * 10000) / 100).toFixed(2) + "%";

console.log("=== 0. N = (1+a)*(1+b)  [user-confirmed multiplicative] ===");
for (const [a, b] of [[0, 0], [1, 0], [0, 1], [1, 1], [2, 2], [3, 3], [3, 0], [0, 3]]) {
  console.log(`  弹道+${a}, 双发+${b}  ->  N = ${(1 + a) * (1 + b)}`);
}

// ---------- Option A: every card worth the SAME marginal g ----------
// 加第 k 张同类卡时，N 乘 (k+1)/k ... 实际是 (a+2)/(a+1)
// 令 [(a+2)/(a+1)] * p = 1+g  ->  p = (1+g)*(a+1)/(a+2)
// 累计每颗弹丸伤害 D(k) = (1+g)^k / (1+k)
console.log("\n=== Option A: flat marginal g per card (simple, MUST be capped) ===");
console.log("per-pellet damage factor for the k-th layer of a type: p_k = (1+g)*(k-1+1)/(k+1)");
for (const g of [0.20, 0.25, 0.30]) {
  console.log(`\n  -- g = +${fmt(g).replace("%", "")} per card --`);
  console.log("  layer k | p_k (this card) | cumulative per-pellet D(k) | nominal total T(k) | vs k normal cards");
  let D = 1;
  for (let k = 1; k <= 6; k++) {
    const p = (1 + g) * k / (k + 1);
    D *= p;
    const T = (1 + k) * D;
    console.log(
      `  ${k}`.padEnd(9),
      "| " + fmt(p).padEnd(15),
      "| " + fmt(D).padEnd(26),
      "| " + T.toFixed(3).padEnd(18),
      "| " + Math.pow(1 + g, k).toFixed(3)
    );
  }
  // where the mechanism breaks: p>1 means the "penalty" becomes a buff
  let breakK = null;
  for (let k = 1; k <= 12; k++) if ((1 + g) * k / (k + 1) >= 1) { breakK = k; break; }
  console.log(`  => p_k stops being a penalty at layer ${breakK} -> CAP this type at ${breakK - 1} layers`);
}

// ---------- Option B: diminishing marginal gains (monotonic, no break point) ----------
// 要求 p_k < 1 恒成立 -> g_k < 1/k
console.log("\n=== Option B: diminishing marginal g (monotonic penalty, no break point) ===");
const G = [0.30, 0.25, 0.20, 0.15, 0.12, 0.10];
console.log("layer k | g_k (marginal) | p_k = (1+g_k)*k/(k+1) | cumulative D(k) | nominal T(k)");
let D = 1, cumT = 1;
for (let k = 1; k <= 6; k++) {
  const gk = G[k - 1];
  const p = (1 + gk) * k / (k + 1);
  D *= p; cumT *= (1 + gk);
  console.log(
    `  ${k}`.padEnd(8),
    "| +" + fmt(gk).padEnd(14),
    "| " + fmt(p).padEnd(21),
    "| " + fmt(D).padEnd(15),
    "| " + cumT.toFixed(3),
    p < 1 ? "" : "  <-- NOT a penalty"
  );
}

// ---------- sanity: full mixed builds under Option B ----------
console.log("\n=== Option B applied to real combos (a scatter, b double) ===");
console.log("a,b".padEnd(8), "k".padEnd(4), "N".padEnd(6), "per-pellet D".padEnd(14), "nominal T".padEnd(11), "vs k cards");
const Dof = (k) => { let d = 1; for (let i = 1; i <= k; i++) d *= (1 + G[i - 1]) * i / (i + 1); return d; };
const Tof = (k) => { let t = 1; for (let i = 1; i <= k; i++) t *= (1 + G[i - 1]); return t; };
for (const [a, b] of [[0, 0], [1, 1], [2, 2], [3, 3], [3, 0], [0, 3], [2, 1]]) {
  const N = (1 + a) * (1 + b), k = a + b;
  console.log(`${a},${b}`.padEnd(8), String(k).padEnd(4), String(N).padEnd(6),
    fmt(Dof(a) * Dof(b)).padEnd(14), (N * Dof(a) * Dof(b)).toFixed(3).padEnd(11), Tof(k).toFixed(3));
}

// ---------- the catch: scatter only pays when there ARE extra targets ----------
// h = probability an extra scatter line actually has an enemy on it
console.log("\n=== Effective output vs scenario (hit-rate h on extra scatter lines) ===");
console.log("build".padEnd(14), "h=1 (crowd)".padEnd(14), "h=0.6 (mixed)".padEnd(15), "h=0 (single boss)");
for (const [a, b] of [[1, 1], [2, 2], [3, 0], [0, 3], [2, 1]]) {
  const dp = Dof(a) * Dof(b);
  const row = [1, 0.6, 0].map((h) => {
    const hits = (1 + b) * (1 + a * h);
    return (hits * dp).toFixed(3).padEnd(14);
  });
  console.log(`a=${a},b=${b}`.padEnd(14), ...row);
}
console.log("\n  -> scatter-heavy builds LOSE on single targets (extra lines find nobody);");
console.log("     that is intended: it buys coverage, not single-target power.");
console.log("     double-shot (b) never loses: all its pellets land on the same target.");
