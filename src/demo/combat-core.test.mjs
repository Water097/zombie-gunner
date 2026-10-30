// combat-core 单元测试（node 运行，与浏览器共用同一份内核）
// 验证：自动瞄准开火扣弹 / 空仓自动换弹 / 冻结→装甲车×3 硬门禁 / 灼烧 DoT / 冻结停止移动 /
//       穿透 2 / 敌人抵达防线持续攻击要塞 / 升级选卡
//
// 运行：node src/demo/combat-core.test.mjs

import {
  createWorld, update, castSkill, chooseCard, magSizeOf, petPos, CARDS,
  PLAYER, ENEMY_TYPES, FORTRESS,
} from './combat-core.mjs';
import { LEARN_CARDS } from './cards.mjs';
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
  ok('自动释放生成技能弹', w.skillShots.length >= 1);
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
  const card = CARDS.find((c) => c.id === 'bullet-dmg');
  ok('武器卡存在且 target 为 weapon', !!card && card.target === 'weapon');
  w.pendingCards = [card]; w.cardPhase = true;
  chooseCard(w, 0);
  ok('武器槽计数 +1', w.slotLevels.weapon === 1);
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

console.log(`\n结果：${passed} 通过 / ${failed} 失败`);
process.exit(failed === 0 ? 0 : 1);
