// 向僵尸开炮 · 主武器加成卡（3.2.1 七张）校准 Monte Carlo  v2
// 关键修正：建模"持续敌流"——敌人被击杀后立刻在同位补位，密度恒定。
// 这样武器的每发都打在活敌上，过杀浪费被基线/卡两套公平抵消，能干净隔离"卡本身的额外贡献"。
//
// 模型假设（草案，待 11 册 canonical 基准替换；本校准看"比率/相对"结论，对绝对基准不敏感）：
//   - 主子弹伤害 B = 100（= 第1章全局基准；武器个性倍率不在本次范围，固定 B 即可，因卡效果都是 B 的百分比）
//   - 只变射速 R（弹道/双发不在本批 7 卡内）
//   - 敌人 HP 以"发数"表示（hEff = 等效生命 / B）：坦克=40发，普通/紧簇=4发，蜂群=0.75发（1发死）
//   - 玩家瞄准：每发打当前血量最高的活敌（greedy）
//   - 持续敌流：每 tick 末，hp<=0 的敌人在原位补位（hp 重置满），代表不断涌来的尸潮
//
// 输出：每个 (场景 x 武器 x 卡) 的 额外贡献% 与 3.2.1 硬约束 PASS/FAIL；外加 温压弹 基准对照。

const B = 100;

const WEAPONS = {
  rifle:   { name: 'rifle',   cn: '突击步枪', R: 1.7 },
  smg:     { name: 'smg',     cn: '冲锋枪',   R: 6.0 },
  gatling: { name: 'gatling', cn: '加特林',   R: 10.0 }, // 峰值射速（压力测试）
};

// hEff: 敌人等效生命（发数）。返回 [{x,y,hp,max}]；hp 实际 = hEff × B
function place(kind) {
  const mk = (hits, x, y) => ({ x, y, hp: hits * B, max: hits * B });
  if (kind === 'single') return [mk(40, 0, 0)]; // 坦克：40 发
  if (kind === 'cluster') {
    // 紧簇 3x3 网格 间距 30px（30px 内约 4 个邻居，40px 内 8 个）→ 模拟"贴脸尸群"
    const out = [];
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) out.push(mk(4, i * 30, j * 30)); // 普通敌：4 发
    return out;
  }
  // swarm：蜂群铺开，间距 70px（远超 35px 爆炸半径）→ 1 发死
  const out = [];
  for (let i = -2; i <= 2; i++) for (let j = -1; j <= 0; j++) out.push(mk(0.75, i * 70, j * 70)); // 蜂群：0.75 发
  return out;
}

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

// 一次主子弹命中后，卡的"额外伤害意图"（不含主子弹 B），返回 [{e,d}] 或 [{e,dot,dur}]
function cardExtra(card, target, enemies, rng) {
  const hits = [];
  const add = (e, d) => { if (e && e.hp > 0) hits.push({ e, d }); };
  if (card === 'fire') { add(target, { dot: 0.12 * B, dur: 2.0 }); return hits; }
  if (card === 'explosion' || card === 'explosion_range') {
    const radius = card === 'explosion_range' ? 70 : 35;
    for (const e of enemies) if (e !== target && e.hp > 0 && dist(e, target) <= radius) add(e, 0.25 * B);
    return hits;
  }
  if (card === 'split' || card === 'split_dmg' || card === 'split_boom') {
    const k = 2 + Math.floor(rng() * 3); // 随机 2-4
    const subDmg = (card === 'split_dmg' ? 0.26 : 0.20) * B;
    const others = enemies.filter((e) => e !== target && e.hp > 0).sort((a, b) => dist(a, target) - dist(b, target));
    for (let s = 0; s < k; s++) {
      const e = others[s]; if (!e) break;
      add(e, subDmg);
      if (card === 'split_boom') for (const o of enemies) if (o !== e && o.hp > 0 && dist(o, e) <= 25) add(o, 0.06 * B);
    }
    return hits;
  }
  return hits;
}

function simulate(weapon, enemies0, card, T = 30) {
  const enemies = enemies0.map((e) => ({ ...e }));
  const R = weapon.R;
  const dt = 0.1;
  let t = 0, fireAcc = 0, total = 0;
  const dot = new Map();
  const rng = mulberry32(98765);

  while (t < T) {
    // DoT 结算
    for (const e of enemies) {
      const st = dot.get(e); if (!st || !st.length) continue;
      for (const s of st) { if (s.dur > 0) { const d = s.rate * dt; total += Math.min(e.hp, d); e.hp -= Math.min(e.hp, d); s.dur -= dt; } }
      dot.set(e, st.filter((s) => s.dur > 0));
    }
    // 开火
    fireAcc += dt;
    while (fireAcc >= 1 / R) {
      fireAcc -= 1 / R;
      const alive = enemies.filter((e) => e.hp > 0);
      if (!alive.length) break;
      alive.sort((a, b) => b.hp - a.hp);
      const target = alive[0];
      const d = Math.min(target.hp, B); total += d; target.hp -= d; // 主子弹
      if (card) {
        const extra = cardExtra(card, target, enemies, rng);
        for (const h of extra) {
          if (h.d && h.d.dot) { const st = dot.get(h.e) || []; st.push({ rate: h.d.dot, dur: h.d.dur }); dot.set(h.e, st); }
          else { const r = Math.min(h.e.hp, h.d); total += r; h.e.hp -= r; }
        }
      }
    }
    // 持续敌流：补位
    for (const e of enemies) if (e.hp <= 0) { e.hp = e.max; dot.set(e, []); }
    t += dt;
  }
  return total; // 30s 内对该敌流造成的全部伤害
}

// 温压弹孤立基准（持续敌流）：每 6.2s 一次，直伤 240 + AOE 192@120
function wenyaDps(enemies0, T = 62) {
  const enemies = enemies0.map((e) => ({ ...e }));
  const dt = 0.1; let t = 0, cd = 0, total = 0;
  while (t < T) {
    cd -= dt;
    if (cd <= 0) {
      cd = 6.2;
      const alive = enemies.filter((e) => e.hp > 0);
      if (alive.length) {
        alive.sort((a, b) => b.hp - a.hp);
        const p = alive[0];
        let r = Math.min(p.hp, 240); total += r; p.hp -= r;
        for (const e of alive) if (e !== p && dist(e, p) <= 120) { const rr = Math.min(e.hp, 192); total += rr; e.hp -= rr; }
      }
    }
    for (const e of enemies) if (e.hp <= 0) e.hp = e.max;
    t += dt;
  }
  return total / T;
}

function mulberry32(a) { return function () { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

const CARDS = [
  { id: 'fire',            name: 'fire (火属性弹头)',         cap: 15 },
  { id: 'explosion',       name: 'explosion (爆炸弹头)',       cap: 20 },
  { id: 'explosion_range', name: 'explosion+100% (爆炸范围)',  cap: 30 },
  { id: 'split',           name: 'split (命中分裂)',           cap: 30 },
  { id: 'split_dmg',       name: 'split+30% (子子弹+30%)',     cap: 30 },
  { id: 'split_boom',      name: 'split-boom (子子弹爆炸)',    cap: 30 },
];
const SCENARIOS = [
  { id: 'single',  name: 'single tank (40 hits)' },
  { id: 'cluster', name: 'tight cluster (8@30px)' },
  { id: 'swarm',   name: 'swarm spread (10@70px)' },
];

console.log('=== weapon bonus cards calibration v2 (steady stream) ===');
console.log('B=' + B + '  sim=30s  fireRate: rifle 1.7 / smg 6 / gatling 10\n');

const wyCluster = wenyaDps(place('cluster'));
console.log('[baseline] wenya (warm-pressure) isolated cluster DPS ~= ' + wyCluster.toFixed(0) + ' (direct 240 + AOE 192@120 per 6.2s, steady stream)\n');

for (const sc of SCENARIOS) {
  console.log('== scenario: ' + sc.name + ' ==');
  console.log('card \\ weapon'.padEnd(22) + 'rifle'.padStart(10) + 'smg'.padStart(10) + 'gatling'.padStart(10) + '  cap');
  const base = {};
  for (const wk of Object.values(WEAPONS)) base[wk.name] = simulate(wk, place(sc.id), null, 30);
  for (const c of CARDS) {
    const cells = [];
    let breach = false;
    for (const wk of Object.values(WEAPONS)) {
      const tot = simulate(wk, place(sc.id), c.id, 30);
      const extra = tot - base[wk.name];
      const pct = extra / (B * wk.R * 30) * 100;
      const ok = pct <= c.cap; if (!ok) breach = true;
      cells.push((pct.toFixed(1) + '%' + (ok ? '' : '!')).padStart(10));
    }
    console.log(c.name.padEnd(18) + '  ' + cells.join('') + '   <' + c.cap + '%' + (breach ? '  BREACH' : ''));
  }
  console.log('(! = breach 3.2.1 hard cap; number = extra contribution % of main-weapon DPS)\n');
}

// 子子弹+30% 相对分裂（cluster, rifle）
{
  const b = simulate(WEAPONS.rifle, place('cluster'), 'split', 30) - simulate(WEAPONS.rifle, place('cluster'), null, 30);
  const u = simulate(WEAPONS.rifle, place('cluster'), 'split_dmg', 30) - simulate(WEAPONS.rifle, place('cluster'), null, 30);
  console.log('[relative] split+30%: split extra ' + (b / (B * 1.7 * 30) * 100).toFixed(1) + '% -> ' + (u / (B * 1.7 * 30) * 100).toFixed(1) + '% (target +30%)');
}
// 爆炸 vs 温压弹（cluster）
{
  for (const wk of [WEAPONS.rifle, WEAPONS.gatling]) {
    const extra = (simulate(wk, place('cluster'), 'explosion', 30) - simulate(wk, place('cluster'), null, 30)) / 30;
    console.log('[dilution risk] explosion cluster extra DPS: ' + wk.cn + ' ~= ' + extra.toFixed(0) + '  vs wenya ' + wyCluster.toFixed(0) + ' (' + (extra / wyCluster * 100).toFixed(0) + '%)');
  }
}
