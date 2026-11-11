// 实验室参数中心 —— 引擎/DOM 无关，Node 可测。
//
// 纪律：默认 = 实机 SKILLS / tuning.DEFAULTS.player 的原值（不改实机行为）。
// 实验室里的改动**只作用于测试舞台**，不写 localStorage、不影响实机那一局。
// 参数 schema 由数值字段自动生成，所以 SKILLS 以后加字段会自动出现在面板里，不会漏。

import { SKILLS } from './combat-core.mjs';
import { DEFAULTS } from './tuning.mjs';

// 全量拷贝：color/name 等元数据也要保留给 UI；参数面板自己只筛数值字段。
const numericOf = (o) => ({ ...o });

/** id → 可编辑参数表；weapon → 武器参数表。 */
export const labParams = Object.create(null);
export const weaponParams = {
  ...DEFAULTS.player,
  // 实验室可见的子弹属性开关（实机由卡牌解锁，这里直接给开关）
  bulletFire: false, bulletExplode: false, doubleShot: false, scatter: 0, pierceTargets: 1,
};

const LAB_ONLY = {
  shock: { flashMs: 480, arcMs: 320 },   // 落雷/电弧演出时长：实机固定 280/220ms，实验室可调慢逐拍看清
};

export function initLabParams() {
  for (const [id, sk] of Object.entries(SKILLS)) labParams[id] = numericOf(sk);
  for (const [id, extra] of Object.entries(LAB_ONLY)) Object.assign(labParams[id], extra);
}
initLabParams();

/** S.freeze.speed 会读到 labParams.freeze.speed —— specs 保留原写法即可变成可编辑。 */
export const S = new Proxy({}, { get: (_, id) => labParams[id] ?? weaponParams });

// ── 中文标签 ────────────────────────────────────────────────
const LABEL = {
  cooldownMs: '冷却', durMs: '持续时间', lifeMs: '存在时间', tickMs: '伤害间隔',
  fireIntervalMs: '开火间隔', hitIntervalMs: '冲撞间隔', stormMs: '雷暴持续',
  stormTickMs: '雷暴落雷间隔', burnMs: '灼烧时长', slowMs: '减速时长',
  flashMs: '落雷演出时长', arcMs: '弹射电弧时长', reloadMs: '换弹耗时',
  dmg: '伤害', dmgTick: '每跳伤害', strikeDmg: '单发伤害', baseDamage: '每发伤害',
  speed: '速度', heavySpeedMul: '重型速度倍率', bulletSpeed: '子弹速度',
  radius: '弹体半径', r: '半径', strikeR: '打击半径', stormR: '雷暴半径',
  arcRange: '弹射射程', explodeR: '爆炸半径', range: '射程', len: '长度',
  halfWidth: '光束半宽', halfAngle: '扇面半角', sweepAmp: '扫动幅度',
  bodyW: '车宽', bodyH: '车高', bodyHeavyW: '重型车宽', bodyHeavyH: '重型车高',
  arcCount: '弹射数量', arcRatio: '弹射伤害比', stormDmgRatio: '雷暴伤害比',
  stormStrikeRRatio: '雷暴落雷半径比', knock: '击退', slowMag: '减速幅度',
  laneOffset: '车道间隔', pierce: '穿透', bulletPierce: '穿透数',
  magSize: '弹匣容量', bulletRadius: '子弹半径', scatter: '散射发数',
  pierceTargets: '命中穿透数', key: '按键',
};

const RANGE = {
  cooldownMs: [0, 30000, 500], durMs: [100, 20000, 100], lifeMs: [100, 20000, 100],
  stormMs: [100, 10000, 100], burnMs: [0, 8000, 100], slowMs: [0, 8000, 100],
  flashMs: [80, 2400, 20], arcMs: [60, 1600, 20],
  tickMs: [20, 2000, 20], fireIntervalMs: [30, 2000, 10], hitIntervalMs: [20, 1000, 10],
  stormTickMs: [40, 2000, 20], reloadMs: [0, 6000, 50],
  magSize: [1, 100, 1], bulletPierce: [0, 10, 1], pierce: [0, 10, 1], pierceTargets: [1, 6, 1],
  halfAngle: [0, 1.2, 0.01], sweepAmp: [0, 3.14, 0.05],
  heavySpeedMul: [0.1, 2, 0.05], arcRatio: [0, 2, 0.05], stormDmgRatio: [0, 2, 0.05],
  stormStrikeRRatio: [0, 2, 0.05], slowMag: [0, 1, 0.05],
  arcCount: [0, 8, 1], scatter: [0, 6, 1],
  bodyW: [10, 120, 2], bodyH: [20, 160, 2], bodyHeavyW: [10, 160, 2], bodyHeavyH: [20, 220, 2],
  radius: [1, 40, 1], r: [1, 60, 1], bulletRadius: [1, 20, 0.5],
  strikeR: [10, 240, 5], stormR: [10, 300, 5], arcRange: [10, 300, 5],
  explodeR: [0, 300, 5], range: [50, 1000, 10], len: [50, 1400, 10], halfWidth: [1, 40, 1],
  speed: [20, 1500, 10], bulletSpeed: [50, 2000, 10],
  baseDamage: [0, 500, 1], dmg: [0, 500, 1], dmgTick: [0, 500, 1], strikeDmg: [0, 500, 1],
  knock: [0, 120, 1], laneOffset: [0, 200, 2],
};

/** 影响演出/实体的参数 = 亮色；纯数值结算 = 暗色（诚实标注，不假装能看见伤害）。 */
const VISUAL = new Set([
  'speed', 'bulletSpeed', 'radius', 'r', 'bulletRadius', 'strikeR', 'stormR', 'arcRange',
  'explodeR', 'range', 'len', 'halfWidth', 'halfAngle', 'sweepAmp', 'durMs', 'lifeMs',
  'stormMs', 'flashMs', 'arcMs', 'cooldownMs', 'fireIntervalMs', 'hitIntervalMs',
  'stormTickMs', 'burnMs', 'slowMs', 'reloadMs', 'magSize', 'bulletPierce', 'pierce',
  'bodyW', 'bodyH', 'bodyHeavyW', 'bodyHeavyH', 'heavySpeedMul', 'arcCount', 'arcRatio',
  'scatter', 'pierceTargets', 'laneOffset',
]);

export const isVisual = (key) => VISUAL.has(key);
export const unitOf = (key) => /Ms$|ms$/.test(key) ? 'ms'
  : /Mul$|Ratio$|Mag$/.test(key) ? '×'
  : /Angle$|Amp$/.test(key) ? 'rad'
  : /Count$|Targets$|Size$|Pierce$|Num$/.test(key) ? '个'
  : /R$|Radius$|W$|H$|Len$|Range$|Width$|R$/.test(key) ? 'px' : '';

function rangeOf(key, v) {
  if (RANGE[key]) return RANGE[key];
  const a = Math.abs(v);
  if (a <= 1) return [0, 2, 0.01];
  if (a <= 20) return [0, Math.max(40, Math.ceil(v * 4)), 1];
  if (a <= 200) return [0, Math.max(400, Math.ceil(v * 4)), 5];
  return [0, Math.max(2000, Math.ceil(v * 4)), 50];
}

/** 生成某组的控件 schema（自动覆盖全部数值字段）。 */
export function paramSchema(group) {
  const obj = group === 'weapon' ? weaponParams : labParams[group];
  if (!obj) return [];
  return Object.entries(obj)
    .filter(([, v]) => typeof v === 'number')
    .map(([key, v]) => {
      const [min, max, step] = rangeOf(key, v);
      return { key, label: LABEL[key] ?? key, value: v, min, max, step, unit: unitOf(key), visual: isVisual(key) };
    });
}

export function boolSchema(group) {
  if (group !== 'weapon') return [];
  return [
    { key: 'bulletFire', label: '火属性弹头', value: weaponParams.bulletFire },
    { key: 'bulletExplode', label: '爆炸弹头', value: weaponParams.bulletExplode },
    { key: 'doubleShot', label: '双发（纵列）', value: weaponParams.doubleShot },
  ].map((x) => ({ ...x, value: weaponParams[x.key] }));
}

export function setParam(group, key, value) {
  const obj = group === 'weapon' ? weaponParams : labParams[group];
  if (obj && key in obj) obj[key] = value;
}

export function resetParams(group) {
  if (group === 'weapon') {
    Object.assign(weaponParams, DEFAULTS.player, { bulletFire: false, bulletExplode: false, doubleShot: false, scatter: 0, pierceTargets: 1 });
  } else if (SKILLS[group]) {
    labParams[group] = numericOf(SKILLS[group]);
    if (LAB_ONLY[group]) Object.assign(labParams[group], LAB_ONLY[group]);
  }
}

export function resetAll() {
  initLabParams();
  resetParams('weapon');
}

/**
 * 演出循环时长（秒）—— 由**当前参数**算，所以调「持续时间 / 速度 / 落雷时长」立刻改变循环节奏。
 * geom = { W, PET, FOE }，由调用方传入，避免本模块依赖舞台几何。
 */
export function durationOf(id, geom) {
  const p = id === 'weapon' ? weaponParams : labParams[id];
  if (!p) return 2;
  const { W, PET, FOE } = geom;
  switch (id) {
    case 'freeze': case 'burn':
      return Math.max(0.3, (PET.y - FOE.y + 120) / Math.max(p.speed, 60));
    case 'shock':
      // 基础天雷只演落雷（弹射/雷暴是节点卡），循环时长跟着落雷演出走
      return Math.max(0.5, p.flashMs / 1000 + 0.45);
    case 'vehicle': return Math.max(0.5, p.lifeMs / 1000);
    case 'ray': return Math.max(0.2, p.durMs / 1000);
    case 'laser': return Math.max(0.2, p.durMs / 1000);
    case 'turret': return Math.max(0.5, p.fireIntervalMs / 1000 * 6 + 0.4);
    case 'flame': return Math.max(0.5, p.lifeMs / 1000);
    case 'saw': return Math.max(0.4, (W + 44) / Math.max(p.speed, 50));
    case 'weapon': return Math.max(0.6,
      (p.magSize * p.fireIntervalMs + p.reloadMs) / 1000 + 0.3);
    default: return 2;
  }
}
