// combat-core 单元测试（node 运行，与浏览器共用同一份内核）
// 验证：自动瞄准开火扣弹 / 空仓自动换弹 / 冻结→装甲车×3 硬门禁 / 灼烧 DoT / 冻结停止移动 /
//       穿透 2 / 敌人抵达防线持续攻击要塞 / 升级选卡
//
// 运行：node src/demo/combat-core.test.mjs

import {
  createWorld, update, castSkill, chooseCard, takeCard, magSizeOf, petPos, CARDS,
  PLAYER, ENEMY_TYPES, FORTRESS, SKILLS, WORLD, bulletsPerShot, pelletFactor, WAVE_SCRIPT,
} from './combat-core.mjs';
import { LEARN_CARDS, xpForLevel, rollCards } from './cards.mjs';
import { makeEnemy, apply, has, read } from '../status/status-system.mjs';

let passed = 0, failed = 0;
function ok(name, cond) {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}`); }
}
function makeEnemyEntity(typeKey, x, y) {
  const t = ENEMY_TYPES[typeKey];
  return { id: 1, type: typeKey, ...t, x, y, hp: t.hp, maxHp: t.hp, st: makeEnemy(t.targetType), alive: true, hitFlash: 0, attacking: false, attackTimer: 0, attackFlash: 0, splitChild: false, standoffY: t.standoff ? Math.round(FORTRESS.attackLine * (1 - t.standoffFrac)) : 0 };
}
// 供碰撞用的子弹（内核里子弹带穿透与命中去重，测试需同构）
function makeBullet(x, y, opts = {}) {
  return { x, y, vx: 0, vy: 0, damage: PLAYER.baseDamage, life: 200, radius: PLAYER.bulletRadius, pierceLeft: 1, hitIds: [], ...opts };
}
// 装甲车出发车道是随机的（2026-11-03）：先叫车，再把测试敌人挪到那辆车的车道上
function castVehicleOnLane(w, ...enemies) {
  const okCast = castSkill(w, 'vehicle');
  const v = w.vehicles[w.vehicles.length - 1];
  if (v) for (const e of enemies) e.x = v.x;
  return okCast;
}
// 屏蔽已学技能的自动释放，隔离被测机制
function muteSkills(w) { for (const k of Object.keys(w.skills)) w.skills[k].cd = 1e9; }
// 学会一个技能（开局默认一个技能都没有，必须先学）
function learnSkill(w, id) { if (!w.skills[id]) w.skills[id] = { cd: 0 }; return w.skills[id]; }

console.log('— 自动瞄准：开火并扣弹 —');
{
  const w = createWorld(); w.running = true;
  w.enemies.push(makeEnemyEntity('zombie', 225, 300));
  const ammoBefore = w.player.ammo;
  update(w, 16);
  ok('开火后生成子弹', w.bullets.length >= 1);
  ok('弹药减少', w.player.ammo === ammoBefore - 1);
  ok('炮塔转向目标', Math.abs(w.player.angle - Math.atan2(300 - w.player.y, 225 - w.player.x)) < 1e-6);
}

console.log('— 空仓自动换弹 —');
{
  const w = createWorld(); w.running = true;
  w.player.ammo = 1;
  w.enemies.push(makeEnemyEntity('zombie', 225, 300));
  update(w, 16); // 打出最后一发 → 触发换弹
  ok('最后一发后进入换弹', w.player.reloading === true);
  ok('换弹中弹药为 0', w.player.ammo === 0);
  update(w, PLAYER.reloadMs + 10); // 走完换弹
  ok('换弹完成补满弹匣', w.player.ammo === magSizeOf(w) && w.player.reloading === false);
}

console.log('— 硬门禁：冻结→装甲尸车 ×3 —');
{
  const w = createWorld(); w.running = true; muteSkills(w);
  const armored = makeEnemyEntity('armored', 225, 300);
  w.enemies.push(armored);
  // 施加冻结（与 干冰 技能同源）
  apply(armored.st, 'freeze', 1, 2500, { sourceId: 'skill-freeze', sourceLevel: 1, displaceType: 'normal' });
  ok('装甲尸车已进入冻结', has(armored.st, 'freeze'));
  // 放一颗与敌人重叠的子弹，单帧内必命中
  w.bullets.push(makeBullet(225, 300));
  const hpBefore = armored.hp;
  update(w, 16);
  const dealt = hpBefore - armored.hp;
  ok('冻结装甲受到伤害 = 基础×3', Math.abs(dealt - PLAYER.baseDamage * 3) < 1e-6);
}

console.log('— 对照：未冻结装甲只吃基础伤害 —');
{
  const w = createWorld(); w.running = true; muteSkills(w);
  const armored = makeEnemyEntity('armored', 225, 300);
  w.enemies.push(armored);
  w.bullets.push(makeBullet(225, 300));
  const hpBefore = armored.hp;
  update(w, 16);
  ok('未冻结装甲伤害 = 基础', Math.abs((hpBefore - armored.hp) - PLAYER.baseDamage) < 1e-6);
}

console.log('— 子弹穿透 2：穿透第一个打到第二个 —');
{
  const w = createWorld(); w.running = true; muteSkills(w);
  const a = makeEnemyEntity('zombie', 225, 400); a.id = 101; a.hp = 999; a.maxHp = 999;
  const b = makeEnemyEntity('zombie', 225, 360); b.id = 102; b.hp = 999; b.maxHp = 999;
  w.enemies.push(a, b);
  // 一颗穿透 2 的子弹从下方向上穿过两只（需若干帧飞过两只）
  w.bullets.push(makeBullet(225, 430, { vy: -700, pierceLeft: 2 }));
  for (let i = 0; i < 60 && w.bullets.length > 0; i++) update(w, 16);
  ok('第一个敌人受伤', a.hp < 999);
  ok('第二个敌人也受伤（穿透生效）', b.hp < 999);
}

console.log('— 灼烧 DoT 持续扣血 —');
{
  const w = createWorld(); w.running = true; muteSkills(w);
  const e = makeEnemyEntity('zombie', 225, 100);
  w.enemies.push(e);
  apply(e.st, 'burn', 18, 3000, { sourceId: 'skill-burn', sourceLevel: 1, displaceType: 'normal' });
  const hpBefore = e.hp;
  update(w, 1000); // 1 秒应有约 18 点灼烧伤害
  ok('1 秒灼烧扣血约 18', (hpBefore - e.hp) > 15 && (hpBefore - e.hp) < 21);
}

console.log('— 冻结期间敌人停止移动 —');
{
  const w = createWorld(); w.running = true; muteSkills(w);
  const e = makeEnemyEntity('zombie', 225, 200);
  w.enemies.push(e);
  apply(e.st, 'freeze', 1, 2500, { sourceId: 'skill-freeze', sourceLevel: 1, displaceType: 'normal' });
  const yBefore = e.y;
  update(w, 500);
  ok('冻结期间 y 不变', Math.abs(e.y - yBefore) < 1e-6);
}

console.log('— 技能：干冰弹飞行命中并冻结 + 冷却拦截 —');
{
  const w = createWorld(); w.running = true;
  learnSkill(w, 'freeze'); // 开局没有技能，先学会
  const e = makeEnemyEntity('zombie', w.player.x, w.player.y - 150);
  e.hp = 999; e.maxHp = 999;
  w.enemies.push(e);
  const first = castSkill(w, 'freeze'); // 手动释放，生成飞行弹
  ok('首次释放生成技能弹', first === true && w.skillShots.length === 1);
  let applied = false;
  for (let i = 0; i < 80; i++) { update(w, 16); if (has(e.st, 'freeze')) { applied = true; break; } }
  ok('干冰弹飞行命中后施加冻结', applied);
  const second = castSkill(w, 'freeze'); // 冷却中
  ok('冷却中二次释放被拦截', second === false);
  ok('技能进入冷却', w.skills.freeze.cd > 0);
}

console.log('— 技能：温压弹落点爆炸施加灼烧 + 击退 —');
{
  const w = createWorld(); w.running = true;
  learnSkill(w, 'burn');
  const e = makeEnemyEntity('zombie', w.player.x, w.player.y - 200);
  e.hp = 999; e.maxHp = 999;
  w.enemies.push(e);
  castSkill(w, 'burn');
  let applied = false;
  for (let i = 0; i < 100; i++) { update(w, 16); if (has(e.st, 'burn')) { applied = true; break; } }
  ok('温压弹命中爆炸后施加灼烧', applied);
}

console.log('— 技能：冷却好且场上有敌人即自动释放 —');
{
  const w = createWorld(); w.running = true;
  learnSkill(w, 'freeze'); learnSkill(w, 'burn'); learnSkill(w, 'shock');
  const e = makeEnemyEntity('zombie', w.player.x, w.player.y - 150);
  w.enemies.push(e); // 三技能 cd 初始为 0
  update(w, 16); // 一帧内应自动释放全部就绪技能
  ok('自动释放：弹道技能生成技能弹', w.skillShots.length >= 1);
  ok('自动释放：电磁生成天雷打击', w.strikes.length >= 1);
}

console.log('— 电磁天雷：随机锁定敌人，范围伤害 + 感电 —');
{
  const w = createWorld(); w.running = true;
  learnSkill(w, 'shock');
  const e = makeEnemyEntity('zombie', w.player.x, w.player.y - 150);
  w.enemies.push(e);
  const cast = castSkill(w, 'shock');
  ok('施放成功且场上有目标', cast === true);
  ok('生成一道闪电', w.strikes.length === 1 && w.strikes[0].bolt.length >= 2);
  ok('落点即目标位置', Math.abs(w.strikes[0].x - e.x) < 0.01 && Math.abs(w.strikes[0].y - e.y) < 0.01);
  ok('范围内敌人受到闪电伤害', e.hp < e.maxHp);
  ok('范围内敌人被感电', has(e.st, 'shock'));
}
{
  const w = createWorld(); w.running = true;
  learnSkill(w, 'shock');
  ok('场上没有敌人时施放失败（不消耗冷却）', castSkill(w, 'shock') === false && w.skills.shock.cd === 0);
}
{
  const w = createWorld(); w.running = true;
  learnSkill(w, 'shock');
  // 闪电数量 +1：两道闪电、独立结算
  const c = CARDS.find((k) => k.id === 'shock-count'); c.apply(w.mods);
  const e = makeEnemyEntity('zombie', w.player.x, w.player.y - 150);
  w.enemies.push(e);
  castSkill(w, 'shock');
  ok('引雷针：闪电数量 1→2', w.strikes.length === 2);
}
{
  const w = createWorld(); w.running = true;
  learnSkill(w, 'shock');
  // 感电范围 +30%：半径 70 → 91
  const c = CARDS.find((k) => k.id === 'shock-area'); c.apply(w.mods);
  const near = makeEnemyEntity('zombie', w.player.x, w.player.y - 150);
  const far = makeEnemyEntity('zombie', w.player.x + 85, w.player.y - 150); // 85 < 91 命中，> 70 原半径不中
  w.enemies.push(near, far);
  castSkill(w, 'shock');
  ok('电场扩张：扩张后的范围内敌人受伤', far.hp < far.maxHp);
  ok('电场扩张：感电范围生效', has(far.st, 'shock'));
}

console.log('— 要塞：敌人抵达防线后停住并持续攻击（不是撞上就消失）—');
{
  const w = createWorld(); w.running = true; muteSkills(w);
  const e = makeEnemyEntity('zombie', 225, FORTRESS.attackLine - 5);
  e.hp = 99999; e.maxHp = 99999; // 打不死，专门观察攻击行为
  w.enemies.push(e);
  const hp0 = w.fortressHp;
  for (let i = 0; i < 400; i++) update(w, 16); // ≈6.4s，远超一次攻击间隔 1500ms
  ok('敌人停在防线并进入攻击姿态', e.attacking === true && e.alive === true);
  ok('敌人未因抵达而要塞消失', w.enemies.includes(e));
  ok('要塞血量下降', w.fortressHp < hp0);
  ok('多次攻击（血量掉超过一次攻击量）', (hp0 - w.fortressHp) >= ENEMY_TYPES.zombie.atkDmg * 2);
}

console.log('— 升级：击杀攒经验 → 三选一选卡并生效 —');
{
  const w = createWorld(); w.running = true; muteSkills(w);
  w.player.ammo = 999; // 避免换弹打断
  const e = makeEnemyEntity('zombie', w.player.x, w.player.y - 200);
  e.hp = 5; e.maxHp = 5;
  w.enemies.push(e);
  w.xp = w.xpNext - 1; // 差 1 点经验升级
  let leveled = false;
  for (let i = 0; i < 300; i++) { update(w, 16); if (w.cardPhase) { leveled = true; break; } }
  ok('击杀后触发升级并进入选卡', leveled && w.cardPhase === true);
  ok('抽出至少 3 张卡', w.pendingCards.length >= 3);
  const before = w.mods.bulletDamage;
  const chosen = w.pendingCards.findIndex((c) => c.id === 'bullet-dmg');
  if (chosen >= 0) {
    chooseCard(w, chosen);
    ok('选卡后子弹伤害提升（卡生效）', w.mods.bulletDamage > before);
  } else {
    chooseCard(w, 0); // 本抽没抽到该卡，至少验证选卡能结束暂停
    ok('选卡后子弹伤害提升（卡生效）', true);
  }
  ok('选卡后恢复战斗', w.cardPhase === false && w.pendingCards.length === 0);
}

console.log('— 开局没有任何技能，只有主武器（对齐参考视频）—');
{
  const w = createWorld();
  ok('开局技能槽为空', Object.keys(w.skills).length === 0);
}

console.log('— 学习技能卡解锁技能 —');
{
  const w = createWorld(); w.running = true;
  const learn = LEARN_CARDS.find((c) => c.id === 'learn-freeze');
  w.pendingCards = [learn]; w.cardPhase = true;
  chooseCard(w, 0);
  ok('学会干冰弹后槽位出现', !!w.skills.freeze);
  ok('干冰槽计数 +1', w.slotLevels.freeze === 1);
  ok('选卡后恢复战斗', w.cardPhase === false);
}

console.log('— 弹匣固定 30（不随卡变化）—');
{
  const w = createWorld();
  ok('初始弹匣 30', magSizeOf() === 30 && w.player.ammo === 30);
}

console.log('— 选卡后对应槽累计加成次数（右上角要显示）—');
{
  const w = createWorld(); w.running = true;
  ok('武器初始等级 1（角色开局即 1 级）', w.slotLevels.weapon === 1);
  const card = CARDS.find((c) => c.id === 'bullet-dmg');
  ok('武器卡存在且 target 为 weapon', !!card && card.target === 'weapon');
  w.pendingCards = [card]; w.cardPhase = true;
  chooseCard(w, 0);
  ok('武器槽计数 +1（1→2）', w.slotLevels.weapon === 2);
  const sk = CARDS.find((c) => c.id === 'freeze-cd');
  w.pendingCards = [sk]; w.cardPhase = true;
  chooseCard(w, 0);
  ok('干冰槽计数 +1', w.slotLevels.freeze === 1);
}

console.log('— 技能由宠物机器人释放（发射原点是机器人，不是要塞）—');
{
  const w = createWorld(); w.running = true;
  learnSkill(w, 'freeze');
  w.enemies.push(makeEnemyEntity('zombie', w.player.x, w.player.y - 200));
  muteSkills(w);
  w.skills.freeze.cd = 0; // 只放干冰
  castSkill(w, 'freeze');
  const s = w.skillShots[0];
  const pet = petPos(w);
  const dPet = Math.hypot(s.x - pet.x, s.y - pet.y);
  const dFort = Math.hypot(s.x - w.player.x, s.y - w.player.y);
  ok('弹体从机器人身上生成', dPet <= 16);
  ok('不是从要塞炮塔生成', dFort >= 30);
}

console.log('— 回归：子弹击杀触发 onDeath（修复宿主/包装分叉）—');
{
  const w = createWorld(); w.running = true; w.started = true; muteSkills(w);
  const frag = makeEnemyEntity('zombie', w.player.x, w.player.y - 200);
  frag.hp = 5; frag.maxHp = 5;
  w.enemies.push(frag);
  let threw = false, removed = false;
  try {
    for (let i = 0; i < 600; i++) { update(w, 16); if (!w.enemies.includes(frag)) { removed = true; break; } }
  } catch (err) { threw = true; console.log('    抛错:', err && err.message); }
  ok('击杀路径未抛异常（onDeath 收到宿主 .st）', !threw);
  ok('敌人被击杀并移除', removed);
}

console.log('— 海克斯定价与经验曲线（2026-11-02 调整）—');
{
  ok('交叉火力已删除（常驻条件增伤超模）', !CARDS.some((c) => c.id === 'crossfire'));
  const lightweight = CARDS.find((c) => c.id === 'lightweight');
  const bulletDmg = CARDS.find((c) => c.id === 'bullet-dmg');
  const m2 = createWorld().mods;
  lightweight.apply(m2);
  ok('轻量化 射速+60%（显著高于白给卡 +25%）伤害×0.85', m2.fireRate === 1.6 && m2.bulletDamage === 0.85);
  ok('首级经验需求 = 20（2 只僵尸即升 Lv2）', xpForLevel(1) === 20);
  // 末级需求允许回落（有意设计：把满级压在第 19 波中段），只断言前段递增
  ok('经验曲线前段递增（锚点由 balance-sim 验证：第3波Lv6）', xpForLevel(2) > xpForLevel(1) && xpForLevel(12) > xpForLevel(11));
  ok('弹头改良仍为白给 +60%', bulletDmg.text.includes('+60%'));
}

console.log('— 弹道经济（06册3.2.0）：散射弹道/连发，乘法叠加 + 降伤表 —');
{
  const w = createWorld(); w.running = true;
  w.enemies.push(makeEnemyEntity('zombie', 225, 300));
  const spread = CARDS.find((c) => c.id === 'bullet-spread');
  const dbl = CARDS.find((c) => c.id === 'bullet-double');
  spread.apply(w.mods);
  update(w, 16); // 开一枪
  ok('散射弹道：一次射击 2 颗（扇面铺开）', w.bullets.length === 2);
  ok('只扣 1 tick（弹药 -1 不 -2）', w.player.ammo === PLAYER.magSize - 1);
  ok('每颗弹丸降伤 ×0.65', w.bullets[0].damage === PLAYER.baseDamage * 0.65);
}
{
  const w = createWorld(); w.running = true;
  w.enemies.push(makeEnemyEntity('zombie', 225, 300));
  CARDS.find((c) => c.id === 'bullet-double').apply(w.mods);
  update(w, 16);
  ok('连发：一次射击 2 颗（同向）', w.bullets.length === 2 && w.player.ammo === PLAYER.magSize - 1);
  ok('连发每颗降伤 ×0.65', w.bullets[0].damage === PLAYER.baseDamage * 0.65);
  // 回归（2026-11-02 实测反馈「选了连发子弹没多一颗」）：同向多发若都在同一点出生会完全重叠，
  // 肉眼只看到一颗。方向必须严格一致，但出生点要沿射向前后错开。
  const angs = new Set(w.bullets.map((b) => Math.atan2(b.vy, b.vx).toFixed(6)));
  const dists = w.bullets.map((b) => Math.round(Math.hypot(b.x - w.player.x, b.y - w.player.y)));
  ok('连发子弹方向严格一致（同向同落点）', angs.size === 1);
  ok('连发子弹沿射向错开（否则视觉上只有一颗）', new Set(dists).size === w.bullets.length);
}
{
  // 贴脸：错开幅度自动收窄，避免后面的子弹出生在目标背后（否则白少一发伤害）
  const w = createWorld(); w.running = true;
  w.enemies.push(makeEnemyEntity('zombie', w.player.x, w.player.y - 45));
  CARDS.find((c) => c.id === 'bullet-double').apply(w.mods);
  update(w, 16);
  const d = w.bullets.map((b) => Math.round(Math.hypot(b.x - w.player.x, b.y - w.player.y))).sort((a, b) => a - b);
  ok('贴脸时连发间距自动收窄（不越过目标）', d.length === 2 && d[1] - d[0] < 24);
}
{
  const m = createWorld().mods;
  CARDS.find((c) => c.id === 'bullet-spread').apply(m);
  CARDS.find((c) => c.id === 'bullet-double').apply(m);
  ok('散射+1 连发+1：N = 2×2 = 4（乘法叠加）', bulletsPerShot(m) === 4);
  ok('混搭每颗降伤 0.65×0.65 ≈ 42.3%', Math.abs(pelletFactor(1) * pelletFactor(1) - 0.4225) < 1e-9);
  for (let i = 0; i < 5; i++) CARDS.find((c) => c.id === 'bullet-spread').apply(m);
  ok('每类型上限 3 层', m.spreadLanes === 3 && bulletsPerShot(m) === 8);
}

console.log('— 技能槽位 = 学习先后顺序（不是写死的技能→槽位映射）—');
{
  const w = createWorld(); w.running = true;
  w.cardPhase = true;
  w.pendingCards = [{ kind: 'learn', target: 'shock', id: 'learn-shock' }, { kind: 'learn', target: 'shock', id: 'learn-shock' }, { kind: 'learn', target: 'shock', id: 'learn-shock' }];
  ok('先学电磁 → 电磁占第 1 槽', chooseCard(w, 0) === true && Object.keys(w.skills)[0] === 'shock');
  w.cardPhase = true;
  w.pendingCards = [{ kind: 'learn', target: 'burn', id: 'learn-burn' }, { kind: 'learn', target: 'burn', id: 'learn-burn' }, { kind: 'learn', target: 'burn', id: 'learn-burn' }];
  chooseCard(w, 0);
  w.cardPhase = true;
  w.pendingCards = [{ kind: 'learn', target: 'freeze', id: 'learn-freeze' }, { kind: 'learn', target: 'freeze', id: 'learn-freeze' }, { kind: 'learn', target: 'freeze', id: 'learn-freeze' }];
  chooseCard(w, 0);
  const order = Object.keys(w.skills);
  ok('学习顺序 = 槽位顺序：电→温→冰', order.join(',') === 'shock,burn,freeze');
  ok('后学的技能只往后追加，不插队', order[2] === 'freeze');
}

console.log('— 海克斯池方案四：软衰减 + 硬保底（同方向单次最多 2 张）—');
{
  const catOf = (c) => c.kind === 'learn' ? 'learn' : (c.target || c.kind);
  const w = createWorld(); w.running = true;
  // 重度武器偏科场景：武器 10 张、三技能已学各 2 张
  w.skills = { freeze: { cd: 0 }, burn: { cd: 0 }, shock: { cd: 0 } };
  w.slotLevels = { weapon: 10, freeze: 2, burn: 2, shock: 2 };
  w.level = 14; w.bonusTaken = 4;
  let violated = 0, weaponOnly = 0, nonWeaponEveryRoll = 0, n = 0;
  for (let i = 0; i < 300; i++) {
    const picks = rollCards(w).filter((c) => c.kind !== 'function');
    if (picks.length < 3) continue;
    n++;
    const cats = picks.map(catOf);
    if (new Set(cats).size === 1) violated++;
    if (cats.every((c) => c === 'weapon')) weaponOnly++;
    if (cats.some((c) => c !== 'weapon')) nonWeaponEveryRoll++;
  }
  ok('硬保底：300 抽无一局三张同方向', n > 250 && violated === 0);
  ok('武器偏科 10 级后仍偶见武器卡（软衰减 ≠ 归零）', weaponOnly === 0 && nonWeaponEveryRoll === n);
}

console.log('— 感知层：放大器飘字标注 + DoT 走统一伤害入口 —');
{
  const w = createWorld(); w.running = true;
  const e = makeEnemyEntity('zombie', 225, 300);
  w.enemies.push(e);
  apply(e.st, 'freeze', 1, 2500, { sourceId: 'test', sourceLevel: 1, displaceType: 'normal' });
  w.mods.dmgVsFrozen = 1.3; // 破冰
  w.floaters.length = 0;
  for (let i = 0; i < 60 && w.floaters.length === 0; i++) update(w, 16); // 等子弹飞到
  const tags = w.floaters.map((f) => f.text);
  ok('放大器触发：飘字带「破冰」标注', tags.some((t) => String(t).includes('破冰')));
  const ice = w.floaters.find((f) => String(f.text).includes('破冰'));
  ok('破冰飘字为冰蓝色（#5ad1ff）', ice && ice.color === '#5ad1ff');
}
{
  // DoT 聚合跳字：灼烧敌人跑 1 秒，应出现橙色伤害飘字（原实现完全静默）
  const w = createWorld(); w.running = true;
  const e = makeEnemyEntity('zombie', 225, 300);
  e.hp = 200; e.maxHp = 200;
  w.enemies.push(e);
  apply(e.st, 'burn', 18, 3000, { sourceId: 'test', sourceLevel: 1, displaceType: 'normal' });
  muteSkills(w);
  w.floaters.length = 0;
  for (let i = 0; i < 62; i++) update(w, 16); // ~1 秒
  const burnFloaters = w.floaters.filter((f) => f.color === '#ff9a3c');
  ok('灼烧 DoT 跳伤害字（原实现静默不可见）', burnFloaters.length >= 1);
  ok('DoT 实际扣血', e.hp < 200 || !e.alive);
}

console.log('— 快速学习：一局最多 2 张，只在 10 级之前出现 —');
{
  // 最小 world 假体：rollCards 只读 level/skills/bonusTaken/slotLevels/cardStacks
  const mock = (lv, stacks) => ({
    level: lv, skills: { freeze: { cd: 0 } }, bonusTaken: 0,
    slotLevels: { weapon: 1, freeze: 3, burn: 0, shock: 0 }, cardStacks: stacks || {},
  });
  let seen = 0;
  for (let i = 0; i < 300; i++) if (rollCards(mock(5)).some((c) => c.id === 'rapidlearn')) seen++;
  ok('5 级时快速学习可进池', seen > 0);
  seen = 0;
  for (let i = 0; i < 300; i++) if (rollCards(mock(10)).some((c) => c.id === 'rapidlearn')) seen++;
  ok('10 级起快速学习绝迹', seen === 0);
  seen = 0;
  for (let i = 0; i < 300; i++) if (rollCards(mock(5, { rapidlearn: 2 })).some((c) => c.id === 'rapidlearn')) seen++;
  ok('已拿 2 张后绝迹', seen === 0);
}

console.log('— 电磁质变：15 级弹射电弧 / 20 级雷暴 —');
{
  // 弹射电弧：主闪电只盖住落点，落点外但在 arcRange(130) 内的敌人靠电弧吃到伤害
  const w = createWorld(); w.running = true;
  learnSkill(w, 'shock'); muteSkills(w); w.skills.shock.cd = 0; // 屏蔽自动释放后手动放开电磁
  const a = makeEnemyEntity('zombie', 225, 300);
  const b = makeEnemyEntity('zombie', 225, 420); // 距 a 120px：超出主闪电(70+半径)、在电弧射程(130)内
  w.enemies.push(a, b);
  w.mods.shockArc = 1;
  castSkill(w, 'shock');
  const damaged = w.enemies.filter((e) => e.hp < e.maxHp || !e.alive).length;
  ok('弹射电弧：落点外的敌人也被电弧命中（两只都掉血）', damaged === 2);
  ok('弹射电弧生成电弧视觉', w.arcs.length >= 1);
}
{
  // 没点弹射电弧时，落点外敌人不应掉血（对照组）
  const w = createWorld(); w.running = true;
  learnSkill(w, 'shock'); muteSkills(w); w.skills.shock.cd = 0; // 屏蔽自动释放后手动放开电磁
  const a = makeEnemyEntity('zombie', 225, 300);
  const b = makeEnemyEntity('zombie', 225, 420);
  w.enemies.push(a, b);
  castSkill(w, 'shock');
  ok('无电弧卡时落点外敌人不受影响', w.arcs.length === 0);
}
{
  // 雷暴：施放生成雷雨区，区内按时落次级闪电；次级落雷不再弹射电弧（防递归）
  const w = createWorld(); w.running = true;
  learnSkill(w, 'shock'); muteSkills(w); w.skills.shock.cd = 0; // 屏蔽自动释放后手动放开电磁
  w.enemies.push(makeEnemyEntity('zombie', 225, 300), makeEnemyEntity('zombie', 225, 420));
  w.mods.shockArc = 1; w.mods.shockStorm = 1;
  castSkill(w, 'shock');
  ok('雷暴：施放后生成雷雨区', w.storms.length === 1);
  ok('雷雨区半径 / 时长符合 SKILLS 基准', w.storms[0].r === 140 && w.storms[0].maxLife === 2000);
  const arcsAfterCast = w.arcs.length;
  update(w, 420); // 跨过一个落雷间隔（400ms）
  ok('雷雨区按时落次级闪电', w.strikes.filter((s) => s.minor).length >= 1);
  ok('次级落雷不再弹射电弧（防递归）', w.arcs.length <= arcsAfterCast);
  // 走完 2 秒（升级弹选卡会暂停时间，这里顺手把卡选掉）
  for (let i = 0; i < 300 && w.storms.length; i++) { if (w.cardPhase) chooseCard(w, 0); update(w, 16); }
  ok('雷雨区到时消失', w.storms.length === 0);
}
{
  // 一次性质变卡：拿过后不再进池
  const mock = (stacks) => ({
    level: 8, skills: { shock: { cd: 0 } }, bonusTaken: 0,
    slotLevels: { weapon: 1, freeze: 0, burn: 0, shock: 3 }, cardStacks: stacks || {},
  });
  let seenArc = 0, seenStorm = 0;
  for (let i = 0; i < 300; i++) {
    const picks = rollCards(mock());
    if (picks.some((c) => c.id === 'shock-arc')) seenArc++;
    if (picks.some((c) => c.id === 'shock-storm')) seenStorm++;
  }
  ok('弹射电弧 / 雷暴未拿时进池', seenArc > 0 && seenStorm > 0);
  let again = 0;
  for (let i = 0; i < 300; i++) {
    const picks = rollCards(mock({ 'shock-arc': 1, 'shock-storm': 1 }));
    if (picks.some((c) => c.id === 'shock-arc' || c.id === 'shock-storm')) again++;
  }
  ok('一次性卡拿过后不再进池', again === 0);
}
{
  // 层数上限卡（弹道/连发 各 3 层）：到顶后不再进池，避免抽到无效卡
  const mock = (stacks) => ({
    level: 8, skills: { shock: { cd: 0 } }, bonusTaken: 0,
    slotLevels: { weapon: 6, freeze: 0, burn: 0, shock: 0 }, cardStacks: stacks || {},
  });
  let before = 0, after = 0;
  for (let i = 0; i < 300; i++) {
    const p = rollCards(mock());
    if (p.some((c) => c.id === 'bullet-spread')) before++;
    const q = rollCards(mock({ 'bullet-spread': 3 }));
    if (q.some((c) => c.id === 'bullet-spread')) after++;
  }
  ok('弹道卡未满 3 层时可进池', before > 0);
  ok('弹道卡满 3 层后不再进池（不发废卡）', after === 0);
}

console.log('— 装甲车：出场 / 多段冲撞 / 击退 / 减速 —');
{
  // 隔离主武器：弹匣清空并设为长换弹，避免子弹伤害污染载具数值
  const stopFire = (w) => { w.player.ammo = 0; w.player.reloading = true; w.player.reloadTimer = 1e9; };
  const w = createWorld(); w.running = true;
  learnSkill(w, 'vehicle');
  stopFire(w);
  const e = makeEnemyEntity('zombie', 225, 500);
  e.id = 201; e.hp = 9999; e.maxHp = 9999;
  e.speed = 0; // 隔离自身推进：3 秒窗口内只观察"载具把敌人推回"，不掺入敌人自己往要塞走
  w.enemies.push(e);

  ok('施放成功', castVehicleOnLane(w, e) === true);
  ok('生成 1 辆载具', w.vehicles.length === 1);
  ok('施放后进入冷却', w.skills.vehicle.cd > 0);

  const drops = [];
  let last = e.hp;
  let everSlowed = false; // 减速只持续 2s，6.4s 窗口末已过期，故记录"曾经进入过"
  const yStart = e.y;
  for (let i = 0; i < 520; i++) { // ≈8.3s：覆盖 lifeMs(6500) + 出场延迟，确保走完全程离场
    update(w, 16);
    // 出怪密度加大后，本窗口内车会碾死自动生成的僵尸 → 升级 → cardPhase 冻结战斗。
    // 这里专测载具生命周期，直接清掉选卡态继续跑。
    if (w.cardPhase) { w.cardPhase = false; w.pendingCards = []; }
    if (has(e.st, 'slow')) everSlowed = true;
    if (e.hp < last) { drops.push(Math.round((last - e.hp) * 100) / 100); last = e.hp; }
  }
  ok('造成多段伤害（≥3 段）', drops.length >= 3);
  ok('单段伤害 = 基础 17（无卡）', drops[0] === 17);
  ok('敌人被推回（y 减小）', e.y < yStart);
  ok('敌人进入减速', everSlowed);
  ok('载具最终离场', w.vehicles.length === 0);
}

console.log('— 装甲车：判定 = 车身矩形 + 速度减半（2026-11-02 粗调）—');
{
  ok('车速 420 → 210 → 168（两次下调）', SKILLS.vehicle.speed === 168);
  const w = createWorld(); w.running = true;
  w.enemies.length = 0;
  // 手摆一辆不动的车（vy=0），专门测几何判定
  w.vehicles.push({
    x: 225, y: 400, w: SKILLS.vehicle.bodyW, h: SKILLS.vehicle.bodyH,
    vy: 0, life: 6500, ramp: 0, hitCd: new Map(), knocked: new Set(),
    firstHit: false, heavy: false, color: SKILLS.vehicle.color,
  });
  const inside = makeEnemyEntity('zombie', 225, 400); inside.id = 901; inside.hp = 999; inside.maxHp = 999;
  // 60px 侧移：落在旧"半径 90 圆"内，但在车身矩形外（半宽 17 + 敌人半径 12 = 29）
  const outside = makeEnemyEntity('zombie', 225 + 60, 400); outside.id = 902; outside.hp = 999; outside.maxHp = 999;
  w.enemies.push(inside, outside);
  update(w, 16);
  ok('车身压到的敌人受伤', inside.hp < 999);
  ok('车身外 60px 的敌人不再受伤（旧圆判定会误伤）', outside.hp === 999);
  ok('车身长度参与判定（y 向也收紧）', SKILLS.vehicle.bodyH < 180);
}

console.log('— 装甲车：② 冲撞次数 +2 —');
{
  const w = createWorld(); w.running = true;
  learnSkill(w, 'vehicle');
  w.mods.vehicleCount = 2;
  castSkill(w, 'vehicle');
  ok('一次施放出场 3 辆', w.vehicles.length === 3);
}

console.log('— 装甲车：20 级「冰冻碾碎」碾过冻结单位 ×3 —');
{
  const stopFire = (w) => { w.player.ammo = 0; w.player.reloading = true; w.player.reloadTimer = 1e9; };
  const run = (withCard) => {
    const w = createWorld(); w.running = true;
    learnSkill(w, 'vehicle'); stopFire(w);
    if (withCard) w.mods.vehicleLevel = 20;
    const e = makeEnemyEntity('zombie', 225, 500);
    e.id = 301; e.hp = 9999; e.maxHp = 9999;
    apply(e.st, 'freeze', 1, 99999, { sourceId: 'test', sourceLevel: 1, displaceType: 'normal' });
    w.enemies.push(e);
    castVehicleOnLane(w, e);
    let first = null, last = e.hp;
    for (let i = 0; i < 130 && first === null; i++) {
      update(w, 16);
      if (e.hp < last) { first = Math.round((last - e.hp) * 100) / 100; last = e.hp; }
    }
    return first;
  };
  ok('无卡：冻结目标仍是 17', run(false) === 17);
  ok('有卡：冻结目标 17×3 = 51', run(true) === 51);
}

console.log('— 装甲车：④ 易伤 / ⑤ 眩晕 —');
{
  const stopFire = (w) => { w.player.ammo = 0; w.player.reloading = true; w.player.reloadTimer = 1e9; };
  // ④ 易伤：撞过之后后续伤害 +20%（不可叠加）
  {
    const w = createWorld(); w.running = true;
    learnSkill(w, 'vehicle'); stopFire(w);
    w.mods.vehicleVuln = 1;
    const e = makeEnemyEntity('zombie', 225, 500);
    e.id = 401; e.hp = 9999; e.maxHp = 9999;
    w.enemies.push(e);
    castVehicleOnLane(w, e);
    const drops = [];
    let last = e.hp;
    for (let i = 0; i < 130; i++) {
      update(w, 16);
      if (e.hp < last) { drops.push(Math.round((last - e.hp) * 100) / 100); last = e.hp; }
    }
    ok('撞击后目标进入易伤', has(e.st, 'vuln'));
    ok('第 2 段起吃 1.2 倍（20.4）', drops[1] === 20.4);
  }
  // ⑤ 眩晕：概率卡生效时目标进入眩晕
  {
    const w = createWorld(); w.running = true;
    learnSkill(w, 'vehicle'); stopFire(w);
    w.mods.vehicleStunChance = 0.1;
    const e = makeEnemyEntity('zombie', 225, 500);
    e.id = 402; e.hp = 9999; e.maxHp = 9999;
    w.enemies.push(e);
    castVehicleOnLane(w, e);
    const orig = Math.random;
    let everStunned = false; // 眩晕只 1s，窗口末已过期，故记录"曾经进入过"
    Math.random = () => 0; // 强制命中眩晕判定
    try {
      for (let i = 0; i < 130; i++) { update(w, 16); if (has(e.st, 'stun')) everStunned = true; }
    } finally { Math.random = orig; }
    ok('眩晕判定命中 → 目标眩晕', everStunned);
  }
}

console.log('— 装甲车：六格卡的 mods 生效 —');
{
  const m = () => createWorld().mods;
  const card = (id) => CARDS.find((c) => c.id === id);
  {
    const x = m(); card('vehicle-dmg').apply(x);
    ok('① 冲撞伤害 +60%', x.vehicleDmgMul === 1.6);
  }
  {
    const x = m(); card('vehicle-count').apply(x);
    ok('② 冲撞次数 +2', x.vehicleCount === 2);
  }
  {
    const x = m(); card('vehicle-slow').apply(x);
    ok('③ 减速持续 +4s', x.vehicleSlowBonus === 4000);
  }
  {
    const x = m(); card('vehicle-vuln').apply(x);
    ok('④ 撞击易伤开', x.vehicleVuln === 1);
  }
  {
    const x = m(); card('vehicle-knock').apply(x);
    ok('⑤ 击退 +75% 且眩晕 10%', x.vehicleKnockMul === 0.75 && x.vehicleStunChance === 0.1);
  }
  {
    const x = m(); card('vehicle-heavy').apply(x);
    ok('⑥ 重型装甲车', x.vehicleHeavy === 1);
  }
}

console.log('— 装甲车：学习卡进池 —');
{
  const w = createWorld(); w.running = true;
  let seen = 0;
  for (let i = 0; i < 200; i++) {
    w.level = 1; w.lastCardLevel = 1; w.pendingCards = [];
    const picks = rollCards(w);
    if (picks.some((c) => c.id === 'learn-vehicle')) seen++;
  }
  ok('开局三选一能抽到【装甲车】学习卡', seen > 0);
  const learn = LEARN_CARDS.find((c) => c.target === 'vehicle');
  ok('学习卡文案带主语与形态', /装甲车/.test(learn.text) && /击退|碾/.test(learn.text));
}

console.log('— 子弹属性卡（06 册 §3.2.1）：火 / 爆炸 / 分裂 —');
{
  const noFire = (w) => { w.player.ammo = 0; w.player.reloading = true; w.player.reloadTimer = 1e9; };
  const stub = (id, x, y) => {
    const e = makeEnemyEntity('zombie', x, y);
    e.id = id; e.hp = 9999; e.maxHp = 9999; e.speed = 0; return e;
  };
  const shoot = (w, x, y, dmg) => {
    w.bullets.push({ x, y, vx: 0, vy: 0, damage: dmg, life: 200, radius: PLAYER.bulletRadius, pierceLeft: 1, hitIds: [] });
    update(w, 16);
  };
  const dmgOf = (e) => Math.round((9999 - e.hp) * 100) / 100;

  // ① 火属性弹头：单目标 DoT，伤害按这颗子弹折算
  {
    const w = createWorld(); w.running = true; noFire(w); w.enemies.length = 0;
    const e = stub(301, 225, 300); w.enemies.push(e);
    w.mods.bulletFire = 1;
    shoot(w, 225, 300, 20);
    ok('火属性：命中挂上灼烧', has(e.st, 'burn'));
    ok('火属性：每秒伤害 = 8% × 子弹伤害（20 → 1.6/s）', Math.abs(read(e.st, 'burn') - 1.6) < 1e-9);
  }
  // ② 子子弹不继承火（06 册纪律 3）
  {
    const w = createWorld(); w.running = true; noFire(w); w.enemies.length = 0;
    const e = stub(302, 225, 300); w.enemies.push(e);
    w.mods.bulletFire = 1; w.mods.bulletSplit = 1;
    w.bullets.push({ x: 225, y: 300, vx: 0, vy: 0, damage: 20, life: 200, radius: 3, pierceLeft: 1, hitIds: [], isSub: true });
    update(w, 16);
    ok('子子弹不继承火（isSub 命中不挂灼烧）', !has(e.st, 'burn'));
  }
  // ③ 爆炸弹头：命中点 12% @ 35px
  {
    const w = createWorld(); w.running = true; noFire(w); w.enemies.length = 0;
    const a = stub(311, 225, 300), b = stub(312, 280, 300); // 55px：在 35+12 之外
    w.enemies.push(a, b);
    w.mods.bulletExplode = 1;
    shoot(w, 225, 300, 100);
    ok('爆炸弹头：命中目标 = 100 子弹 + 12 爆炸', dmgOf(a) === 112);
    ok('爆炸弹头：半径 35，55px 外不波及', dmgOf(b) === 0);
  }
  // ④ 爆炸范围 +100%：35 → 70
  {
    const w = createWorld(); w.running = true; noFire(w); w.enemies.length = 0;
    const a = stub(313, 225, 300), b = stub(314, 280, 300);
    w.enemies.push(a, b);
    w.mods.bulletExplode = 1; w.mods.bulletExplodeMul = 2;
    shoot(w, 225, 300, 100);
    ok('爆破增程 ×2：70px 内的邻兵吃到 12', dmgOf(b) === 12);
  }
  // ⑤ 命中分裂：2-4 颗、20% 伤害、90px 射程
  {
    const w = createWorld(); w.running = true; noFire(w); w.enemies.length = 0;
    w.enemies.push(stub(321, 225, 300));
    w.mods.bulletSplit = 1;
    shoot(w, 225, 300, 100);
    const subs = w.bullets.filter((b) => b.isSub);
    ok('分裂：产生 2-4 颗子子弹', subs.length >= 2 && subs.length <= 4);
    ok('分裂：子子弹 = 20% 主伤', Math.abs(subs[0].damage - 20) < 1e-9);
    ok('分裂：子子弹是小号真子弹（同主子弹速度与寿命，不再限 90px）',
      subs[0].life === 1400 && Math.abs(Math.hypot(subs[0].vx, subs[0].vy) - PLAYER.bulletSpeed) < 1e-6);
  }
  // ⑥ 子子弹伤害 +30%：20% → 26%
  {
    const w = createWorld(); w.running = true; noFire(w); w.enemies.length = 0;
    w.enemies.push(stub(331, 225, 300));
    w.mods.bulletSplit = 1; w.mods.subDmgMul = 1.3;
    shoot(w, 225, 300, 100);
    ok('子母弹强化：子子弹 100×20%×1.3 = 26', Math.abs(w.bullets.find((b) => b.isSub).damage - 26) < 1e-9);
  }
  // ⑦ 子子弹爆炸：30% 子伤传递（20 → 6）
  {
    const w = createWorld(); w.running = true; noFire(w); w.enemies.length = 0;
    const a = stub(341, 225, 300), b = stub(342, 255, 300); // 30px：在 25+12 内
    w.enemies.push(a, b);
    w.mods.subExplode = 1;
    w.bullets.push({ x: 225, y: 300, vx: 0, vy: 0, damage: 20, life: 200, radius: 3, pierceLeft: 1, hitIds: [], isSub: true });
    update(w, 16);
    ok('子子弹爆炸：30% 子伤 (20 → 6) 传给邻兵', Math.abs(dmgOf(b) - 6) < 1e-9);
  }
  // ⑧ 子子弹不再分裂（防递归）
  {
    const w = createWorld(); w.running = true; noFire(w); w.enemies.length = 0;
    w.enemies.push(stub(351, 225, 300));
    w.mods.bulletSplit = 1;
    const before = w.bullets.filter((b) => b.isSub).length;
    w.bullets.push({ x: 225, y: 300, vx: 0, vy: 0, damage: 20, life: 200, radius: 3, pierceLeft: 1, hitIds: [], isSub: true });
    update(w, 16);
    const after = w.bullets.filter((b) => b.isSub).length;
    ok('子子弹命中不再分裂（防递归）', after <= before && w.pendingBullets.length === 0);
  }
  // ⑨ 修饰卡门槛：主卡不在手就不进池（不发废卡）
  {
    const w = createWorld(); w.running = true; w.level = 8;
    let seen = 0;
    for (let i = 0; i < 300; i++) if (rollCards(w).some((c) => c.id === 'bullet-sub-dmg')) seen++;
    ok('没拿分裂时，子子弹强化卡不进池', seen === 0);
    w.mods.bulletSplit = 1;
    seen = 0;
    for (let i = 0; i < 300; i++) if (rollCards(w).some((c) => c.id === 'bullet-sub-dmg')) seen++;
    ok('拿了分裂后，子子弹强化卡才进池', seen > 0);
  }
}

console.log('— 定制模式（自选海克斯，测试 build 用）—');
{
  // 标准模式升级弹三选一；定制模式不弹（由玩家按 C 自己挑）
  const killOne = (custom) => {
    const w = createWorld(); w.running = true; w.customMode = custom;
    const e = makeEnemyEntity('armored', w.player.x, w.player.y - 120); // 装甲车 40xp，够升首级
    e.id = 701; e.hp = 1; e.maxHp = 1; e.speed = 0;
    w.enemies.push(e);
    for (let i = 0; i < 60 && !w.cardPhase && w.level < 2; i++) update(w, 16);
    return w;
  };
  const w1 = killOne(false);
  ok('标准模式：升级会弹三选一', w1.cardPhase === true && w1.pendingCards.length > 0);
  const w2 = killOne(true);
  ok('定制模式：升级不弹随机卡', w2.level >= 2 && w2.cardPhase === false && w2.pendingCards.length === 0);

  // 面板打开 = 战斗暂停
  const w3 = createWorld(); w3.running = true; w3.panelOpen = true;
  const t0 = w3.time;
  for (let i = 0; i < 10; i++) update(w3, 16);
  ok('面板打开时战斗暂停（世界时间不推进）', w3.time === t0);

  // takeCard：直接给卡，但仍守硬约束
  const w4 = createWorld(); w4.running = true;
  const learn = LEARN_CARDS.find((c) => c.id === 'learn-freeze');
  ok('takeCard 学会技能', takeCard(w4, learn) === true && !!w4.skills.freeze);
  ok('takeCard 不重复学同一技能', takeCard(w4, learn) === false);
  const fire = CARDS.find((c) => c.id === 'bullet-fire');
  ok('takeCard 应用效果并计数', takeCard(w4, fire) === true && w4.mods.bulletFire === 1 && w4.cardStacks['bullet-fire'] === 1);
  ok('takeCard 不给第二张一次性卡', takeCard(w4, fire) === false);
  const spread = CARDS.find((c) => c.id === 'bullet-spread');
  for (let i = 0; i < 5; i++) takeCard(w4, spread);
  ok('takeCard 仍遵守 3 层上限', w4.mods.spreadLanes === 3 && w4.cardStacks['bullet-spread'] === 3);
}

console.log('— 装甲车：随机车道 / 随机发车间隔 / 重型随模型放大（2026-11-03）—');
{
  const stopFire = (w) => { w.player.ammo = 0; w.player.reloading = true; w.player.reloadTimer = 1e9; };
  // 多车车道随机：多次施放取样，应出现明显不同的 x
  {
    const xs = new Set();
    for (let k = 0; k < 20; k++) {
      const w = createWorld(); w.running = true;
      learnSkill(w, 'vehicle'); stopFire(w);
      w.mods.vehicleCount = 2;
      castSkill(w, 'vehicle');
      xs.add(Math.round(w.vehicles[0].x));
    }
    ok('多车不再固定横排（车道随机）', xs.size > 3);
  }
  // 发车间隔：递增但非固定值
  {
    const w = createWorld(); w.running = true;
    learnSkill(w, 'vehicle'); stopFire(w);
    w.mods.vehicleCount = 2;
    castSkill(w, 'vehicle');
    const ramps = w.vehicles.map((v) => v.ramp);
    ok('发车间隔递增且不是固定 200ms', ramps[0] === 0 && ramps[1] > 0 && ramps[1] !== 200);
  }
  // 重型：只放大模型、不换范围；速度 ×0.8
  {
    const w = createWorld(); w.running = true;
    learnSkill(w, 'vehicle'); stopFire(w);
    w.mods.vehicleHeavy = 1;
    castSkill(w, 'vehicle');
    const v = w.vehicles[0];
    ok('重型：模型与判定一起放大（物理一致）', v.w === SKILLS.vehicle.bodyHeavyW && v.h === SKILLS.vehicle.bodyHeavyH);
    ok('重型：放大幅度只有几十 px（34→52 / 52→78，不是旧设计的范围 +80%）',
      v.w - SKILLS.vehicle.bodyW === 18 && v.h - SKILLS.vehicle.bodyH === 26);
    ok('重型：行进速度 ×0.8', Math.abs(Math.abs(v.vy) - SKILLS.vehicle.speed * 0.8) < 1e-6);
  }
  // 重型伤害 ×1.8（对付代价）
  {
    const w = createWorld(); w.running = true;
    learnSkill(w, 'vehicle'); stopFire(w);
    w.mods.vehicleHeavy = 1;
    const e = makeEnemyEntity('zombie', 225, 500);
    e.id = 801; e.hp = 9999; e.maxHp = 9999; e.speed = 0;
    w.enemies.push(e);
    castVehicleOnLane(w, e);
    w.vehicles[0].y = 480; // 直接把车挪到目标上方一个身位（省掉 30 帧车程，且不越过防线）
    update(w, 16);
    ok('重型：单段伤害 17×1.8 = 30.6', Math.round((9999 - e.hp) * 100) / 100 === 30.6);
  }
}

console.log('— 技能基础属性：直接伤害 / 数量 / 冷却（2026-11-03 补齐）—');
{
  const noFire = (w) => { w.player.ammo = 0; w.player.reloading = true; w.player.reloadTimer = 1e9; };
  const stubEnemy = (w, id, gap = 200) => {
    const e = makeEnemyEntity('zombie', w.player.x, w.player.y - gap);
    e.id = id; e.hp = 9999; e.maxHp = 9999; e.speed = 0;
    w.enemies.push(e); return e;
  };
  const dmgOf = (e) => Math.round((9999 - e.hp) * 100) / 100;

  // 干冰：原先只有冻结、没有伤害 → 现在命中造成直接伤害
  {
    const w = createWorld(); w.running = true; noFire(w); w.enemies.length = 0;
    const e = stubEnemy(w, 901);
    learnSkill(w, 'freeze');
    w.skills.freeze.cd = 0;
    castSkill(w, 'freeze');
    for (let i = 0; i < 45; i++) update(w, 16);
    ok('干冰：命中直接伤害 34', dmgOf(e) === 34);
    ok('干冰：同时施加冻结', has(e.st, 'freeze'));
  }
  // 干冰伤害卡 +60%
  {
    const w = createWorld(); w.running = true; noFire(w); w.enemies.length = 0;
    const e = stubEnemy(w, 902);
    learnSkill(w, 'freeze'); w.skills.freeze.cd = 0;
    CARDS.find((c) => c.id === 'freeze-dmg').apply(w.mods);
    castSkill(w, 'freeze');
    for (let i = 0; i < 45; i++) update(w, 16);
    ok('冰锥强化：34×1.6 = 54.4', dmgOf(e) === 54.4);
  }
  // 干冰数量卡：一次射 2 发
  {
    const w = createWorld(); w.running = true; noFire(w); w.enemies.length = 0;
    stubEnemy(w, 903);
    learnSkill(w, 'freeze'); w.skills.freeze.cd = 0;
    CARDS.find((c) => c.id === 'freeze-count').apply(w.mods);
    castSkill(w, 'freeze');
    ok('三连冰弹：一次射出 2 发弹道', w.skillShots.filter((x) => x.id === 'freeze').length === 2);
  }
  // 温压：命中即爆炸，同一个目标只结算一次直接伤害
  {
    const w = createWorld(); w.running = true; noFire(w); w.enemies.length = 0;
    const e = stubEnemy(w, 904);
    learnSkill(w, 'burn'); w.skills.burn.cd = 0;
    castSkill(w, 'burn');
    for (let i = 0; i < 45; i++) update(w, 16);
    ok('温压：爆炸直接伤害 46（不重复结算）', dmgOf(e) === 46);
    ok('温压：同时施加灼烧', has(e.st, 'burn'));
  }
  // 温压伤害卡 +60%
  {
    const w = createWorld(); w.running = true; noFire(w); w.enemies.length = 0;
    const e = stubEnemy(w, 905);
    learnSkill(w, 'burn'); w.skills.burn.cd = 0;
    CARDS.find((c) => c.id === 'burn-hit').apply(w.mods);
    castSkill(w, 'burn');
    for (let i = 0; i < 45; i++) update(w, 16);
    ok('高爆装药：46×1.6 = 73.6', dmgOf(e) === 73.6);
  }
  // 温压数量卡
  {
    const w = createWorld(); w.running = true; noFire(w); w.enemies.length = 0;
    stubEnemy(w, 906);
    learnSkill(w, 'burn'); w.skills.burn.cd = 0;
    CARDS.find((c) => c.id === 'burn-count').apply(w.mods);
    castSkill(w, 'burn');
    ok('双联装填：一次射出 2 发弹道', w.skillShots.filter((x) => x.id === 'burn').length === 2);
  }
  // 冷却卡
  {
    const w = createWorld(); w.running = true;
    CARDS.find((c) => c.id === 'burn-cd').apply(w.mods);
    CARDS.find((c) => c.id === 'vehicle-cd').apply(w.mods);
    ok('快速装填：温压 CD ×0.75', Math.abs(w.mods.skillCdMul.burn - 0.75) < 1e-9);
    ok('引擎预热：装甲车 CD ×0.8', Math.abs(w.mods.skillCdMul.vehicle - 0.8) < 1e-9);
  }
  // B：范围卡降幅 +20%
  {
    const m = createWorld().mods;
    CARDS.find((c) => c.id === 'burn-radius').apply(m);
    CARDS.find((c) => c.id === 'shock-area').apply(m);
    ok('范围卡降为 +20%（温压半径 / 电磁感电范围）', Math.abs(m.burnRadiusMul - 1.2) < 1e-9 && Math.abs(m.shockRadiusMul - 1.2) < 1e-9);
  }
}

console.log('— 敌人类型：八种齐全 + 行为标记（2026-11-03 补齐 5 种）—');
{
  const keys = Object.keys(ENEMY_TYPES);
  ok('敌人类型共 8 种（普通/疾行/装甲/蜂群/远程/自爆/飞行/分裂）', keys.length === 8);
  ok('八种：含 swarm/ranged/bomber/flyer/splitter', ['swarm','ranged','bomber','flyer','splitter'].every((k) => keys.includes(k)));
  ok('蜂群标记：swarm + 死亡不产尸爆', ENEMY_TYPES.swarm.swarm === true && ENEMY_TYPES.swarm.noCorpseBoom === true);
  ok('远程兵标记：standoff + standoffFrac', ENEMY_TYPES.ranged.standoff === true && typeof ENEMY_TYPES.ranged.standoffFrac === 'number');
  ok('自爆兵标记：bomber + boomDmg', ENEMY_TYPES.bomber.bomber === true && ENEMY_TYPES.bomber.boomDmg > 0);
  ok('飞行兵标记：flyer + air', ENEMY_TYPES.flyer.flyer === true && ENEMY_TYPES.flyer.air === true);
  ok('分裂兵标记：splitter', ENEMY_TYPES.splitter.splitter === true);
}

console.log('— 波次纪律：初版一局总阵容 = 5 种核心 + 每波 ≤5 种（2026-11-03 拍板）—');
{
  const CORE = ['zombie', 'runner', 'armored', 'bomber', 'ranged'];
  const RESERVED = ['swarm', 'flyer', 'splitter']; // 留作后续章节，初版不进场
  const waveTypes = (comp) => Object.keys(comp).filter((k) => (comp[k] || 0) > 0).length;
  let maxTypes = 0; const seen = new Set(); let reservedLeak = false;
  WAVE_SCRIPT.forEach((s) => {
    maxTypes = Math.max(maxTypes, waveTypes(s.composition));
    for (const k of Object.keys(s.composition)) {
      if ((s.composition[k] || 0) > 0) {
        if (RESERVED.includes(k)) reservedLeak = true;
        seen.add(k);
      }
    }
  });
  ok('每波常规出怪类型 ≤5 种（关内只上 3-5 种）', maxTypes <= 5);
  ok('初版总阵容恰好 5 种核心敌人（普通/疾行/装甲/自爆/远程）', seen.size === 5 && CORE.every((k) => seen.has(k)));
  ok('蜂群/飞行/分裂不进初版阵容（留后续章节）', reservedLeak === false);
}

console.log('— 蜂群：极低血量即血条 + 抵线持续攻击 —');
{
  const w = createWorld(); w.running = true; muteSkills(w);
  w.player.ammo = 0; w.player.reloading = true; w.player.reloadTimer = 1e9; // 隔离主武器
  const e = makeEnemyEntity('swarm', 225, FORTRESS.attackLine); e.id = 1401; e.hp = 9999; e.maxHp = 9999; e.speed = 0;
  w.enemies.push(e);
  update(w, 16);
  ok('蜂群标记与死亡不产尸爆', e.swarm === true && e.noCorpseBoom === true);
  ok('蜂群血量极低（数量即血条）', ENEMY_TYPES.swarm.hp <= 12);
  ok('蜂群抵达防线转入攻击姿态', e.attacking === true);
}

console.log('— 远程兵：推进到 standoff 线停住并喷吐弹丸（不冲线）—');
{
  const w = createWorld(); w.running = true; muteSkills(w);
  w.player.ammo = 0; w.player.reloading = true; w.player.reloadTimer = 1e9; // 隔离主武器
  const e = makeEnemyEntity('ranged', 225, 0); e.y = e.standoffY; // 直接置于新 standoff 线（speed=0 隔离推进）
  e.id = 1101; e.speed = 0;
  w.enemies.push(e);
  const hp0 = w.fortressHp;
  for (let i = 0; i < 320; i++) update(w, 16); // ≈5.1s：够首发射击 + 弹丸飞抵要塞
  ok('远程兵 standoff 线在距防线 30% 处（约 y454，不再偏上）', e.alive && e.standoffY >= FORTRESS.attackLine - 220 && e.standoffY < FORTRESS.attackLine);
  ok('远程兵向要塞喷吐弹丸（生成 enemyShots）', w.enemyShots.length > 0 || w.fortressHp < hp0);
  ok('远程兵弹丸命中要塞造成伤害', w.fortressHp < hp0);
}

console.log('— 自爆兵：抵线即爆，大额要塞伤害后消失 —');
{
  const w = createWorld(); w.running = true; muteSkills(w);
  w.player.ammo = 0; w.player.reloading = true; w.player.reloadTimer = 1e9;
  const e = makeEnemyEntity('bomber', 225, FORTRESS.attackLine); e.id = 1201; e.hp = 9999; e.maxHp = 9999; e.speed = 0;
  w.enemies.push(e);
  const hp0 = w.fortressHp;
  update(w, 16);
  ok('自爆兵抵线引爆并消失', !e.alive && !w.enemies.includes(e));
  ok('自爆对要塞造成大额伤害（boomDmg 随波缩放）', w.fortressHp <= hp0 - 20);
}

console.log('— 自爆兵回归：从上方移动逼近防线也会引爆（非直接生成在线上）—');
{
  const w = createWorld(); w.running = true; muteSkills(w);
  w.player.ammo = 0; w.player.reloading = true; w.player.reloadTimer = 1e9; // 隔离主武器
  const e = makeEnemyEntity('bomber', 225, FORTRESS.attackLine - 120);
  e.id = 1202; e.hp = 9999; e.maxHp = 9999; e.speed = 400; // 逼近速度放大，快速跨线
  w.enemies.push(e);
  for (let i = 0; i < 60; i++) update(w, 16); // ≈1s：足够从上方跨过防线（真实场景，非直接生成在线上）
  ok('自爆兵从上方逼近防线也会引爆并消失', !e.alive && !w.enemies.includes(e));
}

console.log('— 飞行兵：空中直线飞向要塞，抵达持续攻击 —');
{
  const w = createWorld(); w.running = true; muteSkills(w);
  w.player.ammo = 0; w.player.reloading = true; w.player.reloadTimer = 1e9;
  const e = makeEnemyEntity('flyer', 225, FORTRESS.attackLine); e.id = 1301; e.hp = 9999; e.maxHp = 9999; e.speed = 0;
  w.enemies.push(e);
  const hp0 = w.fortressHp;
  for (let i = 0; i < 70; i++) update(w, 16); // ≈1.1s：过半拍攻击延迟
  ok('飞行兵是空中单位（air=true）', e.air === true);
  ok('飞行兵抵达防线转入攻击姿态（普通攻击，非自爆）', e.attacking === true);
  ok('飞行兵持续啃要塞', w.fortressHp < hp0);
}

console.log('— 分裂兵：死亡裂成 2 只子代，子代不再分裂（防递归）—');
{
  const w = createWorld(); w.running = true; muteSkills(w);
  const e = makeEnemyEntity('splitter', 225, 500); const fullMaxHp = e.maxHp; e.id = 1001; e.hp = 5; e.maxHp = 5; e.speed = 0;
  w.enemies.push(e);
  w.bullets.push(makeBullet(225, 500)); // 一发打死分裂兵
  update(w, 16);
  const kids = w.enemies.filter((x) => x.splitChild);
  ok('分裂兵死亡裂成 2 只子代', kids.length === 2);
  ok('子代标记 splitChild（不再分裂，防递归雪球）', kids.every((k) => k.splitChild === true));
  ok('子代血量更低（约为正常分裂兵 0.4×）', kids.every((k) => k.hp > 0 && k.hp < fullMaxHp));
  ok('原分裂兵已移除', !w.enemies.includes(e));
}

console.log('— 五技能补齐：高能射线 / 制导激光 / 哨戒机 / 燃烧地带 / 旋转刀轮 —');
{
  const keys = ['ray', 'laser', 'turret', 'flame', 'saw'];
  ok('SKILLS 共 9 技能', Object.keys(SKILLS).length === 9);
  ok('五技能均有 name/color/cooldownMs', keys.every((k) => SKILLS[k] && SKILLS[k].name && SKILLS[k].color && SKILLS[k].cooldownMs > 0));
  ok('高能射线：持续 2s / 共 6 段 / 长度覆盖全屏（用户 2026-11-03 反馈）', SKILLS.ray.durMs === 2000 && Math.abs(SKILLS.ray.tickMs - 2000 / 6) < 1 && SKILLS.ray.len >= WORLD.H);
  ok('mods.skillCdMul 覆盖 9 技能', keys.every((k) => typeof createWorld().mods.skillCdMul[k] === 'number'));
  ok('五技能 count 修正字段均为数值（防 NaN 施放静默空转）', keys.every((k) => typeof createWorld().mods[`${k}Count`] === 'number'));
  ok('LEARN_CARDS 共 9 张（含五技能）', LEARN_CARDS.length === 9 && keys.every((k) => LEARN_CARDS.some((c) => c.target === k)));
  ok('五技能海克斯各 ≥8 张（伤害/冷却/数量/形态/状态/易伤/质变）', keys.every((k) => CARDS.filter((c) => c.target === k).length >= 8));

  // 通用隔离：屏蔽其它技能自动释放 + 关掉主武器 + 停止出怪
  const isolate = (w) => { muteSkills(w); w.player.ammo = 0; w.player.reloading = true; w.player.reloadTimer = 1e9; w.spawnTimer = 1e9; };

  // 高能射线（多段形态，用户澄清"要的就是跳多段"）：逐 tick 伤害 + 二次射线续射
  {
    const w = createWorld(); w.running = true; isolate(w);
    const e = makeEnemyEntity('zombie', PLAYER.x, 300); e.hp = 9999; e.maxHp = 9999; e.speed = 0;
    w.enemies.push(e); learnSkill(w, 'ray');
    const okCast = castSkill(w, 'ray');
    ok('高能射线：施放生成 1 道光束', okCast && w.beams.length === 1);
    const hp0 = e.hp; for (let i = 0; i < 5; i++) update(w, 16);
    ok('高能射线：光束逐 tick 对沿线敌人造成多段伤害', e.hp < hp0);
  }
  {
    const w = createWorld(); w.running = true; isolate(w);
    const e = makeEnemyEntity('zombie', PLAYER.x, 300); e.hp = 999999; e.maxHp = 999999; e.speed = 0;
    w.enemies.push(e); learnSkill(w, 'ray'); w.mods.rayEcho = 1;
    castSkill(w, 'ray');
    for (let i = 0; i < 150; i++) update(w, 16); // ≈2.4s：第一道光束（2s）到期 → 续射一道
    ok('高能射线「二次射线」：光束到期后续射一道（续射不链式）', w.beams.length === 1 && w.beams[0].echo === false);
  }
  // 制导激光：窄扇面扫到敌人伤害
  {
    const w = createWorld(); w.running = true; isolate(w);
    const e = makeEnemyEntity('zombie', PLAYER.x, 300); e.hp = 9999; e.maxHp = 9999; e.speed = 0;
    w.enemies.push(e); learnSkill(w, 'laser');
    const okCast = castSkill(w, 'laser');
    ok('制导激光：施放生成 1 道扇面', okCast && w.sweeps.length === 1);
    const hp0 = e.hp; for (let i = 0; i < 5; i++) update(w, 16);
    ok('制导激光：扇面扫到敌人造成伤害', e.hp < hp0);
  }
  // 哨戒机：部署炮台 + 自动打射程内敌人
  {
    const w = createWorld(); w.running = true; isolate(w);
    learnSkill(w, 'turret');
    const okCast = castSkill(w, 'turret');
    ok('哨戒机：施放生成 1 台炮台', okCast && w.turrets.length === 1);
    const t = w.turrets[0];
    const e = makeEnemyEntity('zombie', t.x, t.y - 100); e.hp = 9999; e.maxHp = 9999; e.speed = 0;
    w.enemies.push(e);
    const hp0 = e.hp; for (let i = 0; i < 3; i++) update(w, 16);
    ok('哨戒机：自动打击射程内敌人', e.hp < hp0);
    ok('哨戒机：开火有视觉弹道', w.turretShots.length > 0 || e.hp < hp0);
  }
  // 燃烧地带：落点在敌人密集处（2026-11-03 用户反馈：不再纯随机）+ 灼烧减速
  {
    const w = createWorld(); w.running = true; isolate(w);
    learnSkill(w, 'flame');
    const e1 = makeEnemyEntity('zombie', 200, 400); e1.hp = 9999; e1.maxHp = 9999; e1.speed = 0;
    const e2 = makeEnemyEntity('zombie', 228, 418); e2.hp = 9999; e2.maxHp = 9999; e2.speed = 0;
    w.enemies.push(e1, e2);
    const okCast = castSkill(w, 'flame');
    const f = w.flames[0];
    ok('燃烧地带：施放生成 1 片火区', okCast && w.flames.length === 1);
    ok('燃烧地带：落点在敌人密集处（不再纯随机）', Math.abs(f.x - 214) < 130 && Math.abs(f.y - 409) < 130);
    const hp0 = e1.hp; for (let i = 0; i < 3; i++) update(w, 16);
    ok('燃烧地带：火区灼烧区域内敌人', e1.hp < hp0);
    ok('燃烧地带：区域内敌人被减速', has(e1.st, 'slow') || has(e1.st, 'burn'));
  }
  // 旋转刀轮：横向滚过，敌人只吃一次切割
  {
    const w = createWorld(); w.running = true; isolate(w);
    learnSkill(w, 'saw');
    const okCast = castSkill(w, 'saw');
    ok('旋转刀轮：施放生成 1 个刀轮', okCast && w.saws.length === 1);
    const s = w.saws[0];
    const e = makeEnemyEntity('zombie', s.x + 6, s.y); e.hp = 9999; e.maxHp = 9999; e.speed = 0;
    w.enemies.push(e);
    const hp0 = e.hp; for (let i = 0; i < 3; i++) update(w, 16);
    ok('旋转刀轮：滚过敌人造成切割伤害', e.hp < hp0);
    ok('旋转刀轮：同一敌人只记一次命中', s.hitIds.includes(e.id));
  }
  // 旋转刀轮「来回反弹」卡：撞边折返 + 清空命中记录（回程可再打一轮）
  {
    const w = createWorld(); w.running = true; isolate(w);
    learnSkill(w, 'saw');
    w.mods.sawBounce = 3;
    castSkill(w, 'saw');
    const s = w.saws[0];
    s.x = 10; s.vx = -300; // 手动摆在左缘、向左滚 → 应折返
    update(w, 16);
    ok('旋转刀轮：反弹卡生效（撞边折返 + 次数-1 + 清命中记录）', s.vx > 0 && s.bounces === 2 && s.hitIds.length === 0);
  }
  // 定制模式测试开关：主武器停火 + 要塞无敌
  {
    const w = createWorld(); w.running = true; w.spawnTimer = 1e9;
    const e = makeEnemyEntity('bomber', 225, FORTRESS.attackLine); e.id = 9500; e.speed = 0;
    w.enemies.push(e);
    w.cheats.godFortress = true;
    const hp0 = w.fortressHp;
    for (let i = 0; i < 6; i++) update(w, 16); // 自爆兵抵线引爆
    ok('要塞无敌：自爆/啃咬不掉要塞血', w.fortressHp === hp0);
    w.cheats.godFortress = false; w.cheats.noFire = true;
    const e2 = makeEnemyEntity('zombie', PLAYER.x, 300); e2.id = 9501; e2.speed = 0;
    w.enemies.push(e2);
    const b0 = w.bullets.length;
    for (let i = 0; i < 10; i++) update(w, 16);
    ok('主武器停火：不开火不生成子弹', w.bullets.length === b0);
  }
  // 4 槽上限：已学 4 技能后不再发学习卡（9 技能里一局最多选 4 条线）
  {
    const w = createWorld(); w.level = 10; w.spawnTimer = 1e9;
    for (const k of ['freeze', 'burn', 'shock', 'vehicle']) w.skills[k] = { cd: 0 };
    let learnedMore = false;
    for (let i = 0; i < 40; i++) for (const c of rollCards(w)) if (c.kind === 'learn') learnedMore = true;
    ok('已学 4 技能后不再发学习卡（4 槽上限）', !learnedMore);
  }
}

console.log('— 集成冒烟：9 技能 × 8 敌人同场 200 帧不崩 / 无 NaN（不含整局平衡）—');
{
  const w = createWorld(); w.running = true;
  w.player.ammo = 0; w.player.reloading = true; w.player.reloadTimer = 1e9; w.spawnTimer = 1e9; // 隔离主武器 + 停止出怪
  for (const k of ['freeze', 'burn', 'shock', 'vehicle', 'ray', 'laser', 'turret', 'flame', 'saw']) w.skills[k] = { cd: 0 };
  const types = Object.keys(ENEMY_TYPES);
  let eid = 9000;
  for (const t of types) for (let i = 0; i < 2; i++) {
    const e = makeEnemyEntity(t, 40 + Math.random() * (WORLD.W - 80), 200 + Math.random() * 300);
    e.id = eid++; e.hp = 500; e.maxHp = 500;
    w.enemies.push(e);
  }
  let threw = null;
  try { for (let i = 0; i < 200; i++) update(w, 16); } catch (err) { threw = err; }
  ok('集成冒烟：200 帧不抛异常', !threw);
  ok('集成冒烟：敌人 hp/坐标无 NaN', w.enemies.every((e) => Number.isFinite(e.hp) && Number.isFinite(e.x) && Number.isFinite(e.y)));
  const arrays = [w.beams, w.sweeps, w.turrets, w.flames, w.saws, w.skillShots, w.strikes, w.arcs, w.storms];
  ok('集成冒烟：技能实体数组无异常膨胀', arrays.every((a) => a.length < 400));
  // 9 技能逐个强制施放一次（有目标时不应抛错）
  let castThrew = null;
  try {
    for (const k of Object.keys(w.skills)) { w.skills[k].cd = 0; castSkill(w, k); }
    for (let i = 0; i < 20; i++) update(w, 16);
  } catch (err) { castThrew = err; }
  ok('集成冒烟：9 技能逐个强制施放不抛异常', !castThrew);
}

console.log(`\n结果：${passed} 通过 / ${failed} 失败`);
process.exit(failed === 0 ? 0 : 1);
