// 无头平衡模拟：跑完整一局，校准「经验曲线 ↔ 20 波结构」
// 目标（用户约定）：共 20 波、20 级；**第 19 波前后升到 20 级**，第 20 波用于收尾。
// 原 ×1.35 指数曲线太陡（实测 24 波还不到 20 级），改为线性后由此脚本校准 base/step。
//
// 运行：node src/demo/balance-sim.mjs

import { createWorld, update, chooseCard, RUN } from './combat-core.mjs';
import { XP, MAX_LEVEL } from './cards.mjs';

const STEP = 16;

// 模拟一个合理玩家：先学技能，再优先武器伤害，其次射速，再次技能强化
const PRIORITY = [
  'bullet-dmg', 'bullet-rate', 'bullet-pierce',
  'burn-dmg', 'freeze-dur', 'shock-dur',
  'burn-radius', 'freeze-cd', 'shock-cd',
  'combust', 'icebreak', 'conductor', 'crossfire',
  'highpressure', 'rapidlearn', 'lightweight',
];
function autoPick(world) {
  const cards = world.pendingCards;
  const learn = cards.find((c) => c.kind === 'learn');
  if (learn && Object.keys(world.skills).length < 3) return cards.indexOf(learn);
  for (const id of PRIORITY) {
    const i = cards.findIndex((c) => c.id === id);
    if (i >= 0) return i;
  }
  return 0;
}

function runOne(seedLabel) {
  const w = createWorld();
  w.running = true; w.started = true;
  const levelAtWave = {};       // 波次开始时的等级
  let lastWave = 0;
  let guard = 0;
  while (!w.gameOver && guard++ < 60000) {
    if (w.cardPhase) { chooseCard(w, autoPick(w)); continue; }
    if (w.wave !== lastWave) { levelAtWave[w.wave] = w.level; lastWave = w.wave; }
    update(w, STEP);
  }
  return {
    label: seedLabel,
    won: w.won,
    finalLevel: w.level,
    wave: w.wave,
    kills: w.killCount,
    fortressHp: Math.round(w.fortressHp),
    seconds: Math.round(w.time / 1000),
    levelAtWave,
  };
}

console.log(`经验曲线：xpNext = ${XP.base} + (Lv-1) × ${XP.step}   目标：Lv20 出现在第 19 波前后\n`);

const runs = [];
for (let i = 0; i < 5; i++) runs.push(runOne(`第 ${i + 1} 局`));

console.log('每波开始时的等级：');
for (const r of runs) {
  const seq = [];
  for (let wv = 1; wv <= RUN.maxWave; wv++) seq.push(r.levelAtWave[wv] ?? '-');
  console.log(`  ${r.label}: [${seq.join(' ')}]`);
}

console.log('\n汇总：');
for (const r of runs) {
  console.log(`  ${r.label}: ${r.won ? '通关' : '失守'} · 最终 Lv${r.finalLevel} · 到第 ${r.wave} 波 · 击杀 ${r.kills} · 要塞剩 ${r.fortressHp} · 用时 ${r.seconds}s`);
}

// 判定：第 19 波时的等级应 ≥19（即第 19 波前后到 20 级）
const at19 = runs.map((r) => r.levelAtWave[19] ?? r.finalLevel);
const avg19 = at19.reduce((a, b) => a + b, 0) / at19.length;
console.log(`\n第 19 波开始时的等级：${at19.join(', ')}  平均 ${avg19.toFixed(1)}（目标 ≈19，即第 19 波内升到 20）`);
const wins = runs.filter((r) => r.won).length;
console.log(`通关率：${wins}/${runs.length}`);
