// 14 册 §四 / §五 / §九 —— 全局共享怪物状态系统（引擎无关核心）
// 对外只暴露 7+ 个函数：apply / has / read / readByTag / tick / clear / clearAll / onDeath / snapshot
// 外加装甲车硬门禁与击退几何两个派生接口。
//
// 设计纪律（14 册二·三）：
//   1. 单一真相源 —— 状态只挂敌人实体，技能只"申请施加"，不许自己存档
//   2. 施加与结算分离 —— 来源不知谁读，读者不知谁施加
//   3. 抗性是打折不是作废 —— 折后系数有下限，永不归零
//
// 时间单位统一毫秒（既定规则）。DoT 进 tick 时 perMs = dps / 1000。

import {
  STATUS_DEFS, MAGNITUDE_TYPES, resolveResistance, isTagBlocked,
  MAG_FLOOR, FREEZE_DR_WINDOW_MS, FREEZE_DR_STEP, FREEZE_DR_MAX_COUNT,
} from './status-config.mjs';

// 创建一个怪物宿主。真实 demo 里这是怪物实体；这里只要求有 targetType 与时钟。
export function makeEnemy(targetType = 'normal') {
  return {
    targetType,
    _now: 0,                 // 毫秒时钟，供 freeze DR 窗口判定（demo 用真实时间推进）
    _st: {
      instances: new Map(),  // id -> Instance[]
      freezeDR: { count: 0, lastEnd: -Infinity },
    },
    _dotAccum: 0,            // 本 tick 累计灼烧伤害，由 demo 取走去扣血
  };
}

function mk(id, def, magnitude, remainingMs, source) {
  return {
    id, magnitude, remainingMs,
    sourceId: source.sourceId,
    sourceLevel: source.sourceLevel,
    stackPolicy: def.stackPolicy,
    tags: def.tags,
  };
}

function pushInstance(enemy, inst) {
  const arr = enemy._st.instances.get(inst.id) || [];
  arr.push(inst);
  enemy._st.instances.set(inst.id, arr);
}

// apply —— 施加的唯一入口：抗性 → 下限 → 叠加策略 → 写入（14 册 §五 顺序）
export function apply(enemy, id, magnitude, durationMs, source = { sourceId: 'unknown', sourceLevel: 1, displaceType: 'normal' }) {
  const def = STATUS_DEFS[id];
  if (!def) throw new Error(`未知状态 id: ${id}`);

  // ① 抗性打折（tag 级屏蔽优先，不走乘法器）
  if (isTagBlocked(enemy.targetType, source.displaceType || 'normal')) return false;
  const res = resolveResistance(enemy.targetType, def.category);
  let mag = magnitude * res.mag;
  let dur = durationMs * res.dur;

  // ② 下限保护（幅度类；保险丝）
  if (MAGNITUDE_TYPES.has(def.category) && magnitude > 0 && res.mag < MAG_FLOOR) {
    mag = magnitude * MAG_FLOOR;
  }

  // ③ / ④ 叠加策略 + 写入（一次性击退不参与时长门槛）
  if (id === 'freeze') return applyFreeze(enemy, def, mag, dur, source);
  if (def.category === 'knock') {
    if (dur <= 0) dur = 1; // 一次性，无需 tick；给 1ms 仅占位
    pushInstance(enemy, mk(id, def, mag, dur, source));
    return true;
  }
  if (dur <= 0) return false;

  if (def.stackPolicy === 'NON_STACKABLE') {
    if ((enemy._st.instances.get(id) || []).length > 0) return false; // 不可叠加：已有则忽略
    pushInstance(enemy, mk(id, def, mag, dur, source));
    return true;
  }
  if (def.stackPolicy === 'MAX_ONLY') {
    const arr = enemy._st.instances.get(id) || [];
    const exist = arr.find((i) => i.sourceId === source.sourceId);
    if (exist) { exist.magnitude = Math.max(exist.magnitude, mag); exist.remainingMs = dur; }
    else pushInstance(enemy, mk(id, def, mag, dur, source));
    return true;
  }
  // INDEPENDENT（burn / knock 之外的多实例并存）
  pushInstance(enemy, mk(id, def, mag, dur, source));
  return true;
}

// freeze：REFRESH（刷新时长不叠层数）+ DR 阶梯（防无限续冰）
function applyFreeze(enemy, def, mag, dur, source) {
  const dr = enemy._st.freezeDR;
  if (enemy._now - dr.lastEnd < FREEZE_DR_WINDOW_MS) dr.count += 1; else dr.count = 1;
  if (dr.count > FREEZE_DR_MAX_COUNT) return false; // 第 4 次起免疫
  dur = dur * Math.pow(FREEZE_DR_STEP, dr.count - 1);
  dr.lastEnd = enemy._now + dur;
  enemy._st.instances.set('freeze', [mk('freeze', def, mag, dur, source)]); // 覆盖旧实例
  return true;
}

// read —— 返回该状态当前有效幅度（多实例取最大值），无则 0
export function read(enemy, id) {
  const arr = enemy._st.instances.get(id) || [];
  let max = 0;
  for (const i of arr) if (i.remainingMs > 0 && i.magnitude > max) max = i.magnitude;
  return max;
}

export function has(enemy, id) { return read(enemy, id) > 0; }

// readByTag —— 按 tag 批量读（状态图标 / 抗性 UI / 图鉴）
export function readByTag(enemy, tag) {
  const out = [];
  for (const arr of enemy._st.instances.values()) {
    for (const i of arr) {
      if (i.remainingMs > 0 && i.tags.includes(tag)) out.push({ id: i.id, magnitude: i.magnitude });
    }
  }
  return out;
}

// tick —— 统一递减；burn 在此结算 DoT；到期自动移除；knock 不参与
export function tick(enemy, dtMs) {
  enemy._dotAccum = 0;
  enemy._now += dtMs;
  for (const [id, arr] of enemy._st.instances) {
    for (let k = arr.length - 1; k >= 0; k--) {
      const inst = arr[k];
      if (inst.id === 'knock') continue; // 一次性，不参与 tick
      inst.remainingMs -= dtMs;
      if (id === 'burn') enemy._dotAccum += inst.magnitude * (dtMs / 1000); // perMs = dps / 1000
      if (inst.remainingMs <= 0) arr.splice(k, 1);
    }
    if (arr.length === 0) enemy._st.instances.delete(id);
  }
  return enemy._dotAccum; // 本 tick 总灼烧伤害，demo 取走去扣血
}

export function clear(enemy, id) { enemy._st.instances.delete(id); }
export function clearAll(enemy) { enemy._st.instances.clear(); }

// onDeath —— 必须调用：一次性清空，防止 DoT 打到已死目标（失败信号 E）
export function onDeath(enemy) { clearAll(enemy); }

// snapshot —— 供 UI / 图鉴 / 存档（P4 长局可续：读档按 remainingMs 恢复），失败信号 F
export function snapshot(enemy) {
  const out = [];
  for (const [id, arr] of enemy._st.instances) {
    for (const i of arr) {
      if (i.remainingMs > 0) out.push({ id, magnitude: i.magnitude, remainingMs: i.remainingMs, sourceId: i.sourceId });
    }
  }
  return out;
}

// ── 派生接口 ───────────────────────────────────────────────

// 装甲车 20 级「碾过冰冻单位 伤害 +200%」——本册硬门禁（失败信号 A / B）
// 装甲车只读 has('freeze')，不关心谁施加的冰冻：这正是跨技能联动成立的技术原因
export function vehicleRammedMultiplier(enemy, vehicleLevel) {
  if (vehicleLevel >= 20 && has(enemy, 'freeze')) return 3.0; // 1 + 200%
  return 1.0;
}

// 击退几何（04 册警戒线）：敌人沿"远离要塞"方向（向上，y 减小）推 distance
// 返回是否推回警戒线上方。y 向下增大，要塞在底部；敌方从顶部 spawn 向底部推进
export function applyKnockToPosition(y, distance, lineY) {
  const newY = y - distance;
  return { y: newY, crossedLine: newY < lineY };
}

// 取当前击退位移（一次性，demo 结算后即 clear 掉 knock）
export function getKnockDistance(enemy) {
  const arr = enemy._st.instances.get('knock') || [];
  let d = 0;
  for (const i of arr) if (i.magnitude > d) d = i.magnitude;
  return d;
}
