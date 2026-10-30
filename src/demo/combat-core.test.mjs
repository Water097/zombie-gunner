// combat-core 单元测试（node 运行，与浏览器共用同一份内核）
// 验证：自动瞄准开火扣弹 / 空仓自动换弹 / 冻结→装甲车×3 硬门禁 / 灼烧 DoT / 冻结停止移动
//
// 运行：node src/demo/combat-core.test.mjs

import { createWorld, update, castSkill, PLAYER, ENEMY_TYPES } from './combat-core.mjs';
import { makeEnemy, apply, has } from '../status/status-system.mjs';

let passed = 0, failed = 0;
function ok(name, cond) {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}`); }
}
function makeEnemyEntity(typeKey, x, y) {
  const t = ENEMY_TYPES[typeKey];
  return { id: 1, type: typeKey, ...t, x, y, hp: t.hp, maxHp: t.hp, st: makeEnemy(t.targetType), alive: true, hitFlash: 0 };
}

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
  ok('换弹完成补满弹匣', w.player.ammo === PLAYER.magSize && w.player.reloading === false);
}

console.log('— 硬门禁：冻结→装甲尸车 ×3 —');
{
  const w = createWorld(); w.running = true;
  const armored = makeEnemyEntity('armored', 225, 300);
  w.enemies.push(armored);
  // 施加冻结（与 干冰 技能同源）
  apply(armored.st, 'freeze', 1, 2500, { sourceId: 'skill-freeze', sourceLevel: 1, displaceType: 'normal' });
  ok('装甲尸车已进入冻结', has(armored.st, 'freeze'));
  // 放一颗与敌人重叠的子弹，单帧内必命中
  w.bullets.push({ x: 225, y: 300, vx: 0, vy: 0, damage: PLAYER.baseDamage, life: 100, radius: PLAYER.bulletRadius });
  const hpBefore = armored.hp;
  update(w, 16);
  const dealt = hpBefore - armored.hp;
  ok('冻结装甲受到伤害 = 基础×3', Math.abs(dealt - PLAYER.baseDamage * 3) < 1e-6);
}

console.log('— 对照：未冻结装甲只吃基础伤害 —');
{
  const w = createWorld(); w.running = true;
  const armored = makeEnemyEntity('armored', 225, 300);
  w.enemies.push(armored);
  w.bullets.push({ x: 225, y: 300, vx: 0, vy: 0, damage: PLAYER.baseDamage, life: 100, radius: PLAYER.bulletRadius });
  const hpBefore = armored.hp;
  update(w, 16);
  ok('未冻结装甲伤害 = 基础', Math.abs((hpBefore - armored.hp) - PLAYER.baseDamage) < 1e-6);
}

console.log('— 灼烧 DoT 持续扣血 —');
{
  const w = createWorld(); w.running = true;
  const e = makeEnemyEntity('zombie', 225, 100);
  w.enemies.push(e);
  apply(e.st, 'burn', 18, 3000, { sourceId: 'skill-burn', sourceLevel: 1, displaceType: 'normal' });
  const hpBefore = e.hp;
  update(w, 1000); // 1 秒应有约 18 点灼烧伤害
  ok('1 秒灼烧扣血约 18', (hpBefore - e.hp) > 15 && (hpBefore - e.hp) < 21);
}

console.log('— 冻结期间敌人停止移动 —');
{
  const w = createWorld(); w.running = true;
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
  // 正前方敌人（射程内），会被自动瞄准；给足血量避免被主武器打死
  const e = makeEnemyEntity('zombie', w.player.x, w.player.y - 150);
  e.hp = 999; e.maxHp = 999;
  w.enemies.push(e);
  // 隔离：屏蔽另外两技能自动释放（它们的击退会把目标推离干冰弹路径），只验证干冰弹
  w.skills.burn.cd = 1e9; w.skills.shock.cd = 1e9;
  const first = castSkill(w, 'freeze'); // 手动释放，生成飞行弹
  ok('首次释放生成技能弹', first === true && w.skillShots.length === 1);
  let applied = false;
  for (let i = 0; i < 60; i++) { update(w, 16); if (has(e.st, 'freeze')) { applied = true; break; } }
  ok('干冰弹飞行命中后施加冻结', applied);
  const second = castSkill(w, 'freeze'); // 冷却中
  ok('冷却中二次释放被拦截', second === false);
  ok('技能进入冷却', w.skills.freeze.cd > 0);
}

console.log('— 技能：温压弹落点爆炸施加灼烧 + 击退 —');
{
  const w = createWorld(); w.running = true;
  const e = makeEnemyEntity('zombie', w.player.x, w.player.y - 200);
  e.hp = 999; e.maxHp = 999;
  w.enemies.push(e);
  w.skills.freeze.cd = 1e9; w.skills.shock.cd = 1e9; // 隔离另外两技能
  castSkill(w, 'burn');
  let applied = false;
  for (let i = 0; i < 80; i++) { update(w, 16); if (has(e.st, 'burn')) { applied = true; break; } }
  ok('温压弹命中爆炸后施加灼烧', applied);
}

console.log('— 技能：冷却好且场上有敌人即自动释放 —');
{
  const w = createWorld(); w.running = true;
  const e = makeEnemyEntity('zombie', w.player.x, w.player.y - 150);
  w.enemies.push(e); // 三技能 cd 初始为 0
  update(w, 16); // 一帧内应自动释放全部就绪技能
  ok('自动释放生成技能弹', w.skillShots.length >= 1);
}

console.log('— 回归：子弹击杀触发 onDeath（修复宿主/包装分叉）—');
{
  const w = createWorld(); w.running = true; w.started = true;
  // 脆弱敌人置于射程内，让自动开火的子弹在若干帧后命中致死
  const frag = makeEnemyEntity('zombie', w.player.x, w.player.y - 200);
  frag.hp = 5; frag.maxHp = 5;
  w.enemies.push(frag);
  let threw = false, removed = false;
  try {
    for (let i = 0; i < 400; i++) { update(w, 16); if (!w.enemies.includes(frag)) { removed = true; break; } }
  } catch (err) { threw = true; console.log('    抛错:', err && err.message); }
  ok('击杀路径未抛异常（onDeath 收到宿主 .st）', !threw);
  ok('敌人被击杀并移除', removed);
}

console.log(`\n结果：${passed} 通过 / ${failed} 失败`);
process.exit(failed === 0 ? 0 : 1);
