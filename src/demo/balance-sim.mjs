// 无头平衡模拟：跑完整一局，校准「难度压迫感 ↔ 经验曲线 ↔ 海克斯选择质量」
//
// 三条校准目标（用户 2026-11-02 拍板）：
//  1. 经验曲线丙：第 1 波杀 2 只升 Lv2（第一个弹匣内不超过 Lv3）· 第 3 波 Lv6 · 第 9 波 Lv12 · 第 19 波内 Lv20
//  2. 压迫感：正确选卡的玩家能通关但要塞明显掉血；乱选的玩家应大概率失守
//  3. 海克斯选择质量必须"有意义"——smart 与 random 的通关率差就是选择价值的量化
//
// 运行：node src/demo/balance-sim.mjs [--supply]

import { createWorld, update, chooseCard, RUN, bulletsPerShot, pelletFactor } from './combat-core.mjs';
import { MAX_LEVEL } from './cards.mjs';

const STEP = 16;
// 每策略局数：默认 12（冒烟够用）；做正式校准必须放大样本——
// 24 局时通关率的二项标准差就有 ±2.2 局，单次结果无法区分 60% 与 80%。
// 用法：node src/demo/balance-sim.mjs --runs=100
const RUNS_PER_STRATEGY = (() => {
  const arg = process.argv.find((a) => a.startsWith('--runs='));
  const n = arg ? Number(arg.split('=')[1]) : 12;
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 12;
})();

// ── 选卡策略 ──
// smart：专精流——武器伤害为主轴，专注冰系一条线（干冰弹→极寒延长→制冷回路→破冰），
//        有对应放大器就吃。代表"正确选择海克斯"的玩家。
const SMART_PRIORITY = [
  'bullet-dmg', 'bullet-dmg',           // 伤害主轴（允许重复优先）
  'bullet-spread', 'bullet-double',     // 弹道卡（06册）：清群核心，正确玩家必拿
  'bullet-split',                        // 子弹属性卡（06册 §3.2.1）：分裂先立，修饰卡才有意义
  'bullet-explode',                      // 爆炸弹头：命中点 AOE
  'bullet-sub-boom', 'bullet-sub-dmg',   // 子子弹修饰（要有分裂才进池，排后面）
  'bullet-explode-range',
  'bullet-fire',                         // 火：单体 DoT，最弱的一档常驻
  'learn-freeze',                        // 专精冰系
  'icebreak',                            // 放大器直接跟线
  'freeze-dur', 'freeze-cd',
  'bullet-rate', 'bullet-pierce',
  'combust', 'conductor',                 // 其他放大器（拿了也不亏）
  'burn-dmg', 'shock-dur', 'burn-radius', 'freeze-cd',
  'highpressure', 'rapidlearn', 'lightweight',
];
function pickSmart(world) {
  const cards = world.pendingCards;
  const learn = cards.find((c) => c.kind === 'learn');
  if (learn && Object.keys(world.skills).length < 3) return cards.indexOf(learn);
  for (const id of SMART_PRIORITY) {
    const i = cards.findIndex((c) => c.id === id);
    if (i >= 0) return i;
  }
  return 0;
}
function pickRandom(world) {
  return Math.floor(Math.random() * world.pendingCards.length);
}
const STRATEGIES = { smart: pickSmart, random: pickRandom };

function runOne(strategy) {
  const w = createWorld();
  w.running = true; w.started = true;
  const levelAtWave = {};
  const xpAtWave = {};
  let lastWave = 0;
  let fortressMin = w.fortressHp;   // 过程最低血量：真正的压迫感指标
  let guard = 0;
  while (!w.gameOver && guard++ < 60000) {
    if (w.cardPhase) { chooseCard(w, STRATEGIES[strategy](w)); continue; }
    if (w.wave !== lastWave) {
      levelAtWave[w.wave] = w.level;
      xpAtWave[w.wave] = Math.round(w.xpGained);
      lastWave = w.wave;
    }
    update(w, STEP);
    if (w.fortressHp < fortressMin) fortressMin = w.fortressHp;
  }
  return {
    won: w.won, finalLevel: w.level, wave: w.wave, kills: w.killCount,
    xp: Math.round(w.xpGained), fortressHp: Math.round(w.fortressHp), fortressMin: Math.round(fortressMin),
    seconds: Math.round(w.time / 1000), levelAtWave, xpAtWave,
    dpsProxy: Math.round(w.mods.bulletDamage * w.mods.fireRate * bulletsPerShot(w.mods)
      * pelletFactor(w.mods.spreadLanes) * pelletFactor(w.mods.doubleShot) * 100) / 100,
    taken: w.cardStacks ? Object.entries(w.cardStacks).map(([k, v]) => `${k}×${v}`).join(' ') : '',
  };
}

function runStrategy(name) {
  const runs = [];
  for (let i = 0; i < RUNS_PER_STRATEGY; i++) runs.push(runOne(name));
  const wins = runs.filter((r) => r.won).length;
  const fhp = runs.filter((r) => r.won).map((r) => r.fortressMin);
  const avgFhp = fhp.length ? Math.round(fhp.reduce((a, b) => a + b, 0) / fhp.length) : '-';
  const losses = runs.filter((r) => !r.won).map((r) => `第${r.wave}波失守(Lv${r.finalLevel})`);
  console.log(`【${name}】通关 ${wins}/${runs.length} · 通关局过程最低要塞血 ${fhp.join(',') || '-'}（均 ${avgFhp}/300）${losses.length ? `\n    失守：${losses.join(' / ')}` : ''}`);
  for (const r of runs.slice(0, 3)) console.log(`    样本 DPS代理=${r.dpsProxy} 卡：${r.taken}`);
  return { runs, wins };
}

const smart = runStrategy('smart');
const random = runStrategy('random');

// ── 经验曲线校验（丙）：看 smart 局各波开始时的等级 ──
console.log('\nsmart 局各波开始时的等级（目标：第3波Lv6 / 第9波Lv12 / 第19波内Lv20）：');
for (const r of smart.runs) {
  const seq = [];
  for (let wv = 1; wv <= RUN.maxWave; wv++) seq.push(r.levelAtWave[wv] ?? '-');
  console.log(`  ${r.won ? '✓' : '✗'} [${seq.join(' ')}]`);
}
const lv3 = smart.runs.map((r) => r.levelAtWave[3] ?? r.finalLevel);
const lv9 = smart.runs.map((r) => r.levelAtWave[9] ?? r.finalLevel);
const lv19 = smart.runs.map((r) => r.levelAtWave[19] ?? r.finalLevel);
const avg = (a) => (a.reduce((x, y) => x + y, 0) / a.length).toFixed(1);
console.log(`\n第3波均 Lv${avg(lv3)}（目标 6）· 第9波均 Lv${avg(lv9)}（目标 12）· 第19波开始均 Lv${avg(lv19)}（19 波内满级 → 目标 <20 且第19波内到20）`);

// ── 供给表（曲线拟合用）──
if (process.argv.includes('--supply')) {
  console.log('\n经验供给（各波开始时累计 xp，smart 局平均）：');
  const pool = smart.runs.filter((r) => r.won);
  const use = pool.length ? pool : smart.runs;
  for (let wv = 1; wv <= RUN.maxWave; wv++) {
    const vals = use.map((r) => r.xpAtWave[wv]).filter((v) => v !== undefined);
    if (!vals.length) continue;
    console.log(`  wave ${String(wv).padStart(2)}: xp=${Math.round(vals.reduce((a, b) => a + b, 0) / vals.length)}`);
  }
}
