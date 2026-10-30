// 14 册 §七 / §九 —— 状态系统单元测试
// 覆盖失败信号 A/B/E/F 与每一步完成标志。运行：node src/status/status-system.test.mjs
import assert from 'node:assert';
import {
  makeEnemy, apply, read, has, tick, clearAll, onDeath, snapshot,
  vehicleRammedMultiplier, applyKnockToPosition, getKnockDistance,
} from './status-system.mjs';

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); pass++; console.log('  \u2713', name); }
  catch (e) { fail++; console.error('  \u2717', name, '\n     ', e.message); }
}

console.log('步骤1：apply \u2192 tick \u2192 \u5230\u671f\u81ea\u52a8\u79fb\u9664');
t('施加 slow \u540e\u80fd\u8bfb\u5230', () => { const e = makeEnemy(); apply(e, 'slow', 0.5, 2000, { sourceId: 'frost' }); assert.strictEqual(read(e, 'slow'), 0.5); });
t('tick \u8d85\u8fc7\u65f6\u957f\u540e\u81ea\u52a8\u79fb\u9664', () => { const e = makeEnemy(); apply(e, 'slow', 0.5, 2000, { sourceId: 'frost' }); tick(e, 2100); assert.strictEqual(read(e, 'slow'), 0); });

console.log('步骤2：\u6297\u6027\u8868\u63a5\u5165 apply \u7b2c\u2460\u6b65');
t('\u88c5\u7532\u5175\u51cf\u901f\u5e45\u5ea6\u00d70.5 \u65f6\u957f\u4e0d\u6253\u6298', () => { const e = makeEnemy('armored'); apply(e, 'slow', 0.5, 2000, { sourceId: 'frost' }); assert.ok(Math.abs(read(e, 'slow') - 0.25) < 1e-9); });
t('\u5931\u8d25\u4fe1\u53f7D\uff1a\u540c\u6027\u4e24\u51cf\u901f\u6e90\u8bfb\u6570\u4e00\u81f4(\u5747\u00d70.5)', () => { const e = makeEnemy('armored'); apply(e, 'slow', 0.5, 2000, { sourceId: 'frost' }); apply(e, 'slow', 0.6, 2000, { sourceId: 'flame' }); assert.ok(Math.abs(read(e, 'slow') - 0.30) < 1e-9); });

console.log('步骤3\uff1aknock \u4e0e\u5883\u6212\u7ebf\u8054\u52a8');
t('\u88c5\u7532\u5175\u666e\u901a\u51fb\u9000\u4f4d\u79fb\u00d70.25', () => { const e = makeEnemy('armored'); apply(e, 'knock', 100, 0, { sourceId: 'vehicle', displaceType: 'normal' }); assert.ok(Math.abs(getKnockDistance(e) - 25) < 1e-9); });
t('\u88c5\u7532\u5175\u514d\u75ab\u51fb\u98de/force\u4f4d\u79fb(launch) \u2192 tag \u5c4f\u853d', () => { const e = makeEnemy('armored'); const ok = apply(e, 'knock', 100, 0, { sourceId: 'someSkill', displaceType: 'launch' }); assert.strictEqual(ok, false); assert.strictEqual(getKnockDistance(e), 0); });
t('applyKnockToPosition \u63a8\u56de\u5883\u6212\u7ebf', () => { const r = applyKnockToPosition(500, 80, 480); assert.strictEqual(r.crossedLine, true); assert.strictEqual(r.y, 420); });

console.log('步骤4\uff08\u786c\u95e8\u7981\uff09\uff1afreeze \u2192 \u88c5\u7532\u8f66 20\u7ea7 +200%');
t('\u5931\u8d25\u4fe1\u53f7A\uff1a\u65e0\u51bb\u7ed3\u65f6\u4e0d\u89e6\u53d1 x3', () => { const e = makeEnemy(); assert.strictEqual(vehicleRammedMultiplier(e, 20), 1.0); });
t('\u5931\u8d25\u4fe1\u53f7B\uff1a\u6709\u51bb\u7ed3\u65f6\u89e6\u53d1 x3', () => { const e = makeEnemy(); apply(e, 'freeze', 1.0, 1200, { sourceId: 'frost' }); assert.strictEqual(vehicleRammedMultiplier(e, 20), 3.0); });
t('\u7b49\u7ea720\u4ee5\u4e0b\u5373\u4f7f\u51bb\u7ed3\u4e5f\u4e0d\u89e6\u53d1', () => { const e = makeEnemy(); apply(e, 'freeze', 1.0, 1200, { sourceId: 'frost' }); assert.strictEqual(vehicleRammedMultiplier(e, 19), 1.0); });

console.log('步骤5\uff1aonDeath / snapshot\uff08\u5931\u8d25\u4fe1\u53f7 E/F\uff09');
t('snapshot \u8fd4\u56de\u6709\u6548\u5b9e\u4f8b', () => { const e = makeEnemy(); apply(e, 'slow', 0.5, 2000, { sourceId: 'frost' }); apply(e, 'burn', 10, 3000, { sourceId: 'fire' }); assert.strictEqual(snapshot(e).length, 2); });
t('\u5931\u8d25\u4fe1\u53f7E\uff1aonDeath \u6e05\u7a7a\u5168\u90e8(\u4e0d\u6b8b\u7559)', () => { const e = makeEnemy(); apply(e, 'burn', 10, 3000, { sourceId: 'fire' }); onDeath(e); assert.strictEqual(read(e, 'burn'), 0); assert.strictEqual(snapshot(e).length, 0); });
t('burn \u5728 tick \u4e2d\u7ed3\u7b97 DoT \u4f24\u5bb3', () => { const e = makeEnemy(); apply(e, 'burn', 100, 3000, { sourceId: 'fire' }); const dmg = tick(e, 100); assert.ok(Math.abs(dmg - 10) < 1e-9); });

console.log('\u8865\u5145\uff1afreeze DR \u9636\u68af / vuln \u4e0d\u53e0 / stun \u514d\u75ab\u94be');
t('freeze DR \u7b2c4\u6b21\u514d\u75ab', () => {
  const e = makeEnemy(); let ok;
  ok = apply(e, 'freeze', 1, 1200, { sourceId: 'frost' }); assert.strictEqual(ok, true);
  e._now = 2000; ok = apply(e, 'freeze', 1, 1200, { sourceId: 'frost' }); assert.strictEqual(ok, true);
  e._now = 4000; ok = apply(e, 'freeze', 1, 1200, { sourceId: 'frost' }); assert.strictEqual(ok, true);
  e._now = 6000; ok = apply(e, 'freeze', 1, 1200, { sourceId: 'frost' }); assert.strictEqual(ok, false);
});
t('vuln \u4e0d\u53ef\u53e0\u52a0', () => { const e = makeEnemy(); apply(e, 'vuln', 0.3, 3000, { sourceId: 'frost' }); const second = apply(e, 'vuln', 0.5, 3000, { sourceId: 'emp' }); assert.strictEqual(second, false); assert.strictEqual(read(e, 'vuln'), 0.3); });
t('stun \u671f\u95f4\u514d\u75ab\u65b0\u6655\u6668', () => { const e = makeEnemy(); apply(e, 'stun', 1, 2000, { sourceId: 'flame' }); const second = apply(e, 'stun', 1, 2000, { sourceId: 'other' }); assert.strictEqual(second, false); });

console.log(`\n\u7ed3\u679c\uff1a${pass} \u901a\u8fc7 / ${fail} \u5931\u8d25`);
process.exit(fail > 0 ? 1 : 0);
