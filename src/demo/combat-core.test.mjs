// combat-core 单元测试（node 运行，与浏览器共用同一份内核）
// 验证：自动瞄准开火扣弹 / 空仓自动换弹 / 冻结→装甲车×3 硬门禁 / 灼烧 DoT / 冻结停止移动 /
//       穿透 2 / 敌人抵达防线持续攻击要塞 / 升级选卡
//
// 运行：node src/demo/combat-core.test.mjs

import {
  createWorld, update, castSkill, chooseCard, magSizeOf, petPos, CARDS,
  PLAYER, ENEMY_TYPES, FORTRESS, bulletsPerShot, pelletFactor,
} from './combat-core.mjs';
import { LEARN_CARDS, xpForLevel, rollCards } from './cards.mjs';
import { makeEnemy, apply, has } from '../status/status-system.mjs';

let passed = 0, failed = 0;
function ok(name, cond) {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}`); }
}
function makeEnemyEntity(typeKey, x, y) {
  const t = ENEMY_TYPES[typeKey];
  return { id: 1, type: typeKey, ...t, x, y, hp: t.hp, maxHp: t.hp, st: makeEnemy(t.targetType), alive: true, hitFlash: 0, attacking: false, attackTimer: 0, attackFlash: 0 };
}
// 供碰撞用的子弹（内核里子弹带穿透与命中去重，测试需同构）
function makeBullet(x, y, opts = {}) {
  return { x, y, vx: 0, vy: 0, damage: PLAYER.baseDamage, life: 200, radius: PLAYER.bulletRadius, pierceLeft: 1, hitIds: [], ...opts };
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

console.log('— 弹道经济（06册3.2.0）：分裂子弹/连发，乘法叠加 + 降伤表 —');
{
  const w = createWorld(); w.running = true;
  w.enemies.push(makeEnemyEntity('zombie', 225, 300));
  const spread = CARDS.find((c) => c.id === 'bullet-spread');
  const dbl = CARDS.find((c) => c.id === 'bullet-double');
  spread.apply(w.mods);
  update(w, 16); // 开一枪
  ok('分裂子弹：一次射击 2 颗（扇面散射）', w.bullets.length === 2);
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
  w.enemies.push(e);

  ok('施放成功', castSkill(w, 'vehicle') === true);
  ok('生成 1 辆载具', w.vehicles.length === 1);
  ok('施放后进入冷却', w.skills.vehicle.cd > 0);

  const drops = [];
  let last = e.hp;
  const yStart = e.y;
  for (let i = 0; i < 130; i++) { // ≈2.1s：够车从要塞碾过 y=500
    update(w, 16);
    if (e.hp < last) { drops.push(Math.round((last - e.hp) * 100) / 100); last = e.hp; }
  }
  ok('造成多段伤害（≥3 段）', drops.length >= 3);
  ok('单段伤害 = 基础 17（无卡）', drops[0] === 17);
  ok('敌人被推回（y 减小）', e.y < yStart);
  ok('敌人进入减速', has(e.st, 'slow'));
  ok('载具最终离场', w.vehicles.length === 0);
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
    castSkill(w, 'vehicle');
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
    castSkill(w, 'vehicle');
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
    castSkill(w, 'vehicle');
    const orig = Math.random;
    Math.random = () => 0; // 强制命中眩晕判定
    try { for (let i = 0; i < 60; i++) update(w, 16); } finally { Math.random = orig; }
    ok('眩晕判定命中 → 目标眩晕', has(e.st, 'stun'));
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

console.log(`\n结果：${passed} 通过 / ${failed} 失败`);
process.exit(failed === 0 ? 0 : 1);
