// 要塞射击 Demo —— 配置工作台（参数中心）
//
// 这是「可调参数」的唯一真相源：combat-core（玩法逻辑）与 main.mjs（渲染层）都从这里读实时值，
// 不再写死在 PLAYER / SKILLS / FORTRESS 等常量里。面板（config-panel.mjs）只负责把 UI 改动写回
// 这个对象并存到 localStorage；逻辑层完全不碰 DOM，保持引擎无关（Node 无头模拟也能 import）。
//
// 设计约定：
//   - 字段名与 combat-core 的旧常量一一对应，默认值 = 旧常量，保证「不调参 = 原行为」。
//   - 所有滑块都是「倍率 / 绝对值」分离：enemy.*ScaleMul 是乘在波次成长曲线上的额外倍率，
//     不是覆盖；这样调参不会改变「第 20 波比第 1 波难」的相对形状，只整体抬压/减压。

const STORAGE_KEY = 'zombie-gunner.tuning.v1';

// ── 默认参数（= 旧硬编码值，改这里不会影响未调参时的行为）──
export const DEFAULTS = {   // 实验室需要一份纯默认值（不受 localStorage 影响）
  player: {
    baseDamage: 20,       // 每发基础伤害（原 PLAYER.baseDamage）
    fireIntervalMs: 500,  // 开火间隔（原 PLAYER.fireIntervalMs，越小越快）
    bulletSpeed: 700,     // 子弹速度 px/s（原 PLAYER.bulletSpeed）
    bulletPierce: 2,      // 初始穿透（原 PLAYER.bulletPierce）
    magSize: 30,          // 弹匣容量（原 PLAYER.magSize）
    reloadMs: 1600,       // 换弹耗时（原 PLAYER.reloadMs）
    range: 560,           // 自动瞄准射程（原 PLAYER.range）
    bulletRadius: 5,      // 子弹半径（原 PLAYER.bulletRadius）
  },
  fortress: {
    maxHp: 300,           // 要塞生命上限（原 FORTRESS.maxHp）
    regenPerSec: 2,       // 常驻缓回/秒（原 FORTRESS.regenPerSec）
  },
  enemy: {
    hpScaleMul: 1,        // 敌人生命额外倍率（乘在波次 hpScale 上）
    spdScaleMul: 1,       // 敌人速度额外倍率
    atkScaleMul: 1,       // 敌人攻击额外倍率
    spawnIntervalTune: 1.2, // 出怪间隔倍率（原 SPAWN_INTERVAL_TUNE，>1 更稀疏）
  },
  skills: {
    dmgMul: 1,            // 技能伤害通用倍率（不含主武器子弹）
    cdMul: 1,             // 技能冷却通用倍率（<1 冷却更短）
  },
  fx: {
    enemyGlow: true,      // 敌人发光特效（关 → 用几何占位代替史莱姆精灵）
    deathFx: true,        // 死亡爆裂粒子
    particles: true,      // 全局粒子层（含技能碎片）
    floaters: true,       // 伤害飘字
  },
};

// 深拷贝一份默认，用于重置（避免引用共享污染）
function clone(o) { return JSON.parse(JSON.stringify(o)); }

export const tuning = clone(DEFAULTS);

const subscribers = new Set();
export function subscribe(fn) {
  subscribers.add(fn);
  return () => subscribers.delete(fn);
}
export function notify() { for (const fn of subscribers) fn(tuning); }

// 浅合并（按 group → key 两层）已保存的值，缺字段保持默认
function deepAssign(target, src) {
  for (const g of Object.keys(src)) {
    if (!target[g]) continue;
    for (const k of Object.keys(src[g])) {
      if (k in target[g]) target[g][k] = src[g][k];
    }
  }
}

export function loadTuning() {
  try {
    const raw = (typeof localStorage !== 'undefined') && localStorage.getItem(STORAGE_KEY);
    if (raw) deepAssign(tuning, JSON.parse(raw));
  } catch { /* 损坏的存档直接忽略，回退默认 */ }
}

export function saveTuning() {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(STORAGE_KEY, JSON.stringify(tuning));
  } catch { /* 隐私模式等写不进，忽略 */ }
}

export function resetTuning() {
  const d = clone(DEFAULTS);
  for (const g of Object.keys(d)) for (const k of Object.keys(d[g])) tuning[g][k] = d[g][k];
  saveTuning();
  notify();
}

// 按 "player.baseDamage" 路径读/写（面板用）
export function getPath(path) {
  const [g, k] = path.split('.');
  return tuning[g][k];
}
export function setPath(path, value) {
  const [g, k] = path.split('.');
  tuning[g][k] = value;
}

// 把当前 tuning 应用到一局运行中（实时生效项：要塞上限 / 弹匣容量）
// 其余项（武器伤害/射速/敌人缩放等）由 combat-core 每次读取时直接取 tuning，无需这里同步。
export function applyTuningToWorld(world) {
  if (!world) return;
  const newMax = tuning.fortress.maxHp;
  if (world.fortressMaxHp !== newMax) {
    world.fortressMaxHp = newMax;
    if (world.fortressHp > newMax) world.fortressHp = newMax;
  }
  const newMag = tuning.player.magSize;
  if (newMag > world.player.ammo) world.player.ammo = newMag; // 弹匣变大即补满差额
}
