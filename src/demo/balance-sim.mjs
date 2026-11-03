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
// smart：懂版本的玩家——学全 4 个技能（干冰/温压/电磁/装甲车），把放大器铺满。
//   关键修正（2026-11-03）：旧 priority 完全不含装甲车体系（11 张）与电磁大部分卡，
//   导致 smart 把资源压在干冰（对装甲 ×3 门禁失效）而放弃最强守线，反而被 random 的
//   "随手拿装甲车"地板反超。现把装甲车（Universal 守线，含装甲）/ 电磁 / 温压放大器
//   一并纳入，重建"会选卡"对"乱选"的领先。
const SMART_PRIORITY = [
  // 学全 4 技能：开局无技能先拿工具；装甲车是唯一对所有敌种（含装甲）生效的守线
  'learn-freeze', 'learn-burn', 'learn-vehicle', 'learn-shock',
  // 主武器伤害主轴（可重复优先，清群与补刀的基础）
  'bullet-dmg', 'bullet-dmg', 'bullet-dmg',
  // 装甲车：最强守线，优先补冷却/次数/重型，再伤害/击退/易伤/减速
  'vehicle-cd', 'vehicle-count', 'vehicle-heavy', 'vehicle-dmg', 'vehicle-knock', 'vehicle-vuln', 'vehicle-slow',
  // 干冰：AOE 减速（对软敌），补冷却/时长/伤害/数量 + 破冰放大器
  'freeze-cd', 'freeze-dur', 'freeze-dmg', 'freeze-count', 'icebreak',
  // 弹道清群（06 册）：散射/连发先立，分裂/爆炸/子子弹修饰随后
  'bullet-spread', 'bullet-double', 'bullet-split', 'bullet-explode', 'bullet-explode-range', 'bullet-sub-boom', 'bullet-sub-dmg',
  // 温压：AOE 伤害，补齐直接伤害/冷却/数量 + 燃料增量 + 助燃
  'burn-dmg', 'burn-hit', 'burn-cd', 'burn-count', 'burn-radius', 'combust',
  // 电磁：闪电伤害 + 感电，补伤害/冷却/数量/范围/时长/质变 + 导电体
  'shock-dmg', 'shock-cd', 'shock-count', 'shock-area', 'shock-dur', 'shock-arc', 'shock-storm', 'conductor',
  // 子弹特性 / 射速 / 穿透 / 代价卡（兜底）
  'bullet-fire', 'bullet-rate', 'bullet-pierce',
  'highpressure', 'rapidlearn', 'lightweight',
];
function pickSmart(world) {
  const cards = world.pendingCards;
  const learn = cards.find((c) => c.kind === 'learn');
  if (learn && Object.keys(world.skills).length < 4) return cards.indexOf(learn);
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
