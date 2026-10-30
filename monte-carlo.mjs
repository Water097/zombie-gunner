// 要塞射击 · 数值 Monte Carlo 验证
// 用法: node monte-carlo.mjs [每关模拟局数，默认 1000]
// 验证三件事: ①一局升级次数是否落在 23-27 ②Build 区分度(p90/p10)是否 >3 ③各关通关率曲线是否合理

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const dir = dirname(fileURLToPath(import.meta.url));
const B = JSON.parse(readFileSync(join(dir, 'balance.json'), 'utf8'));
const RUNS = Number(process.argv[2] || 1000);

let seed = 20261029;
const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];

const SK = B.skills;
const skillIds = Object.keys(SK).filter((k) => k !== '_tiers');
const NUMERIC = new Set(['atk', 'rate', 'crit', 'hp', 'regen', 'xpGain']);

function maxLv(id) { return SK[id].maxLevel; }
function unlockedPool(playerLevel) {
  return skillIds.filter((id) => (SK[id].unlockPlayerLevel ?? 1) <= playerLevel);
}
function lvData(id, lv) {
  const s = SK[id];
  if (NUMERIC.has(id)) {
    const p = s.perLevel, out = {};
    for (const k of Object.keys(p)) out[k] = p[k] * lv;
    return out;
  }
  return s.levels[Math.min(lv, s.levels.length) - 1] || {};
}

// 计算 Build 的两个 DPS 口径
function calcBuild(state, weapon, outerAtk = 0) {
  let dmgMul = 1 + outerAtk, rateMul = 1, critMul = 1, aoe = 0, addDps = 0, slow = 0, hpMul = 0, regen = 0, xpMul = 0;
  for (const [id, lv] of Object.entries(state)) {
    if (!lv) continue;
    const d = lvData(id, lv);
    if (id === 'atk') { dmgMul *= 1 + d.dmg; continue; }
    if (id === 'rate') { rateMul *= 1 + d.rate; continue; }
    if (id === 'crit') { critMul *= 1 + Math.min(1, d.critRate) * (SK.crit.critDmg - 1); continue; }
    if (id === 'hp') { hpMul += d.hp; continue; }
    if (id === 'regen') { regen += d.regenPct; continue; }
    if (id === 'xpGain') { xpMul += d.xp; continue; }
    dmgMul *= (d.dmg ?? 1);
    aoe += (d.aoe ?? 0);
    if (d.addDps) addDps += d.addDps * (d.double ? 1.6 : 1);
    if (d.slow) slow = Math.max(slow, d.slow);
  }
  const single = weapon.dps * dmgMul * rateMul * critMul + weapon.dps * addDps * dmgMul;
  return { single, aoe, slow, hpMul, regen, xpMul, dmgMul, rateMul, critMul, addDps };
}

// 群体 DPS 模型: 每次射击的额外命中数受同屏密度饱和限制(上限 8)，避免 AOE 双重放大
function clearDps(build, onScreen) {
  const crowd = Math.min(1, onScreen / 12);
  const extraHits = Math.min(8, build.aoe * crowd);
  return build.single * (1 + extraHits) * (1 + build.slow * 0.5);
}

// 3 选 1
function drawCards(state, playerLevel) {
  const pool = unlockedPool(playerLevel).filter((id) => (state[id] || 0) < maxLv(id));
  if (pool.length === 0) return ['_generic', '_generic', '_generic'];
  const cards = [];
  const weighted = [];
  for (const id of pool) {
    const w = (state[id] || 0) > 0 ? B.draft.selectedWeight : B.draft.unselectedWeight;
    for (let i = 0; i < Math.round(w * 10); i++) weighted.push(id);
  }
  for (let i = 0; i < 2; i++) {
    let c = pick(weighted);
    let guard = 0;
    while (cards.includes(c) && guard++ < 20) c = pick(weighted);
    if (!cards.includes(c)) cards.push(c);
  }
  const P = Math.min(B.draft.anchorSlotMax, B.draft.anchorSlotBase + B.draft.anchorSlotPerPool * pool.length);
  if (rnd() < P) {
    const owned = pool.filter((id) => (state[id] || 0) > 0);
    if (owned.length) {
      owned.sort((a, b) => state[b] - state[a]);
      const c = owned[0];
      if (!cards.includes(c)) cards.push(c);
    }
  }
  let guard = 0;
  while (cards.length < 3 && guard++ < 30) {
    const c = pick(weighted);
    if (!cards.includes(c)) cards.push(c);
  }
  return cards;
}

function chooseCard(cards, state, weapon, strategy, outerAtk = 0) {
  const usable = cards.filter((c) => c !== '_generic');
  if (!usable.length) return null;
  if (strategy === 'random') return pick(usable);
  if (strategy === 'human') {
    const scored = usable.map((c) => {
      const b = calcBuild({ ...state, [c]: (state[c] || 0) + 1 }, weapon, outerAtk);
      return [c, clearDps(b, 6) * (1 + b.hpMul * 0.3)];
    }).sort((a, b) => b[1] - a[1]);
    return rnd() < 0.7 ? scored[0][0] : (scored[1] ? scored[1][0] : scored[0][0]);
  }
  if (strategy === 'greedy') {
    const owned = usable.filter((c) => (state[c] || 0) > 0);
    if (owned.length) { owned.sort((a, b) => state[b] - state[a]); return owned[0]; }
    return pick(usable);
  }
  let best = usable[0], bestVal = -1;
  for (const c of usable) {
    const probe = { ...state, [c]: (state[c] || 0) + 1 };
    const b = calcBuild(probe, weapon, outerAtk);
    const val = clearDps(b, 6) * (1 + b.hpMul * 0.3);
    if (val > bestVal) { bestVal = val; best = c; }
  }
  return best;
}

// 单局模拟
function simulate(level, playerLevel, weapon, strategy) {
  const lv = B.levels[level - 1];
  const state = {};
  let inLevel = 1, xp = 0, upgrades = 0;
  let maxHp = B.fortress.baseHp * (1 + 0.15 * (playerLevel - 1));
  if (lv.modifier?.includes('fortress hp -20%')) maxHp *= 0.8;
  let hp = maxHp;
  let peakOnScreen = 0;

  const hpGrow = lv.hpMul ?? (1 + B.levelHpGrowth * (level - 1));
  const outerAtk = Math.min(1.0, B.playerLevel.outerAtkPerLevel * (playerLevel - 1));
  const wp = { dps: weapon.dps * (1 + B.playerLevel.outerWeaponDpsPerLevel * (playerLevel - 1)) };

  for (let w = 0; w < B.waves.length; w++) {
    const wave = B.waves[w];
    const dur = wave.durationSec || B.session.waveDurationSec;
    let density = B.waveDensity[w];
    if (lv.modifier?.includes('density +10%')) density *= 1.1;
    if (lv.modifier?.includes('density +15%')) density *= 1.15;

    const count = B.waveBaseCount * density;
    const waveHpMul = 1 + B.waveHpGrowth * (w + 1);
    // 混合编成: 按 introWave 决定可用类型, 加权平均
    const types = Object.entries(B.zombies).filter(([k, z]) =>
      k !== 'boss' && k !== 'mini' && (z.introWave ?? 1) <= w + 1);
    let avgHp = 0, avgXp = 0, avgDmg = 0;
    for (const [k, z] of types) { avgHp += z.hp; avgXp += B.xp.zombieXp[k]; avgDmg += z.dmgToFortress; }
    avgHp = (avgHp / types.length) * waveHpMul * hpGrow;
    avgXp = avgXp / types.length;
    avgDmg = avgDmg / types.length;

    const onScreen = Math.max(1, count * 0.3);
    peakOnScreen = Math.max(peakOnScreen, onScreen);
    const build = calcBuild(state, wp, outerAtk);
    const dps = clearDps(build, onScreen);
    const hpNow = Math.max(1, maxHp * (1 + build.hpMul));

    let killed = (dps * dur) / avgHp;
    const cap = count;
    killed = Math.min(killed, cap * 1.5);
    const leaked = Math.max(0, cap - killed);
    hp -= leaked * avgDmg;

    if (wave.mini) {
      const miniHp = B.zombies.mini.hp * waveHpMul * hpGrow * (lv.modifier?.includes('mini hp +30%') ? 1.3 : 1);
      const canKill = (build.single * dur) / miniHp;
      if (canKill < wave.mini) hp -= wave.mini * B.zombies.mini.dmgToFortress * (1 - canKill / wave.mini);
      killed += wave.mini * Math.min(1, canKill / wave.mini);
    }
    if (wave.boss) {
      const bossHp = B.zombies.boss.hp * (1 + (hpGrow - 1) * (B.zombies.boss.hpGrowRatio ?? 1));
      const canKill = (build.single * dur) / bossHp;
      if (canKill < 1) hp -= 99999 * (1 - canKill);
      killed += 1 * Math.min(1, canKill);
    }

    let gained = killed * avgXp * (wave.xpBonus ? 1 + wave.xpBonus : 1) * (1 + build.xpMul);
    if (wave.mini) gained += wave.mini * B.xp.zombieXp.mini * Math.min(1, 1);
    xp += gained;
    hp += hpNow * build.regen * dur + hpNow * B.fortress.waveBreakHeal;
    hp = Math.min(hp, hpNow);

    if (globalThis.__DBG) console.log(`  w${w + 1} hp=${hp} killed=${killed} leaked=${leaked} avgHp=${avgHp} avgDmg=${avgDmg} xp=${xp} dur=${dur} dps=${dps}`);
    while (xp >= B.xp.levelCostBase * Math.pow(inLevel, B.xp.levelCostExp)) {
      xp -= B.xp.levelCostBase * Math.pow(inLevel, B.xp.levelCostExp);
      inLevel++; upgrades++;
      const cards = drawCards(state, playerLevel);
      const c = chooseCard(cards, state, wp, strategy, outerAtk);
      if (c) state[c] = (state[c] || 0) + 1;
    }
    if (hp <= 0) return { win: false, upgrades, hpLeft: 0, wave: w + 1, build, peakOnScreen, state };
  }
  const fb = calcBuild(state, wp, outerAtk);
  return { win: true, upgrades, hpLeft: hp / (maxHp * (1 + fb.hpMul)), wave: 20, build: fb, peakOnScreen, state };
}

function pct(arr, p) {
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(s.length * p))];
}

console.log(`=== Monte Carlo  runs=${RUNS}/关  seed=${seed} ===\n`);
const weapon = B.weapons[0];

for (const strategy of ['smart', 'human', 'greedy']) {
  if (strategy === 'smart') {
    for (const dbgLv of [1]) {
      globalThis.__DBG = true;
      const t = simulate(dbgLv, B.levels[dbgLv - 1].recLevel, weapon, 'smart');
      globalThis.__DBG = false;
      console.log(`DEBUG 关${dbgLv}:`, JSON.stringify({ win: t.win, upgrades: t.upgrades, wave: t.wave, hpLeft: t.hpLeft, state: t.state }));
    }
  }
  console.log(`--- 选卡策略: ${strategy} ---`);
  console.log('关卡  推荐等级  通关率   平均升级  剩余血量  clearDps p10/p50/p90(p90/p10)  平均同屏');
  for (const lvDef of B.levels) {
    const res = [];
    for (let i = 0; i < RUNS; i++) res.push(simulate(lvDef.id, lvDef.recLevel, weapon, strategy));
    const wins = res.filter((r) => r.win);
    const dps = res.map((r) => clearDps(r.build, r.peakOnScreen));
    const p10 = pct(dps, 0.1), p50 = pct(dps, 0.5), p90 = pct(dps, 0.9);
    const avgUp = res.reduce((a, r) => a + r.upgrades, 0) / res.length;
    const avgHp = wins.length ? wins.reduce((a, r) => a + r.hpLeft, 0) / wins.length : 0;
    const avgOn = res.reduce((a, r) => a + r.peakOnScreen, 0) / res.length;
    console.log(
      `${String(lvDef.id).padStart(3)}   ${String(lvDef.recLevel).padStart(6)}    ` +
      `${(wins.length / res.length * 100).toFixed(1).padStart(5)}%   ` +
      `${avgUp.toFixed(1).padStart(6)}    ${(avgHp * 100).toFixed(0).padStart(4)}%   ` +
      `${p10.toFixed(0).padStart(5)}/${p50.toFixed(0)}/${p90.toFixed(0)}  (${(p90 / Math.max(1, p10)).toFixed(2)}x)      ${avgOn.toFixed(0)}`
    );
  }
  console.log();
}

// Build 区分度: 关 10 smart 策略下的技能平均等级
console.log('--- 关 10 · smart 策略 · 技能平均等级 ---');
const stAvg = {};
const finalDps = [];
let cnt = 0;
for (let i = 0; i < RUNS; i++) {
  const r = simulate(10, 10, weapon, 'smart');
  finalDps.push(clearDps(r.build, r.peakOnScreen));
  for (const [k, v] of Object.entries(r.state)) stAvg[k] = (stAvg[k] || 0) + v;
  cnt++;
}
const rows = Object.entries(stAvg).map(([k, v]) => [k, v / cnt]).sort((a, b) => b[1] - a[1]);
for (const [k, v] of rows) if (v > 0.01) console.log(`  ${(SK[k].name || k).padEnd(8)} ${k.padEnd(10)} ${v.toFixed(2)}`);
console.log(`\n终局 clearDps: p10=${pct(finalDps, 0.1).toFixed(0)}  p50=${pct(finalDps, 0.5).toFixed(0)}  p90=${pct(finalDps, 0.9).toFixed(0)}  区分度=${(pct(finalDps, 0.9) / Math.max(1, pct(finalDps, 0.1))).toFixed(2)}x`);

console.log('\n说明: clearDps 口径 = singleDps*(1+aoe*densityFactor)*(1+slow*0.5)，densityFactor=min(8,1+0.35*同屏)');
