// 要塞射击 Demo —— 配置工作台（UI）
//
// 纯 DOM 浮层：右侧滑出面板 + 右上角齿轮按钮。每个控件是 SCHEMA 里的一项，
// 改动即写回 tuning（参数中心）、存 localStorage、并 notify 订阅者（main.mjs 会实时应用到 world）。
// 渲染层只管画，逻辑层只管读 tuning —— 面板本身不碰任何玩法状态。
//
// 注意：本文件在浏览器里被 main.mjs 引入并调用 initConfigPanel()；Node 无头环境不会加载它。

import { tuning, getPath, setPath, saveTuning, resetTuning, notify } from './tuning.mjs';

// ── 控件定义 ──
// group：分组标题；items：该组控件。
//   type: 'toggle' → 开关；缺省 → 滑块（min/max/step）
//   path：对应 tuning 的 "group.key"；label：中文名；note：小字提示；fmt：数值显示格式
const SCHEMA = [
  {
    group: '武器', icon: '🔫',
    items: [
      { path: 'player.baseDamage', label: '伤害', min: 1, max: 100, step: 1 },
      { path: 'player.fireIntervalMs', label: '开火间隔', min: 80, max: 1500, step: 10, note: '越小越快（ms）' },
      { path: 'player.bulletSpeed', label: '子弹速度', min: 200, max: 1600, step: 20 },
      { path: 'player.bulletPierce', label: '穿透', min: 0, max: 12, step: 1 },
      { path: 'player.magSize', label: '弹匣容量', min: 5, max: 60, step: 1 },
      { path: 'player.reloadMs', label: '换弹时间', min: 200, max: 5000, step: 50, note: 'ms' },
      { path: 'player.range', label: '射程', min: 200, max: 800, step: 10 },
    ],
  },
  {
    group: '要塞', icon: '🛡️',
    items: [
      { path: 'fortress.maxHp', label: '生命上限', min: 50, max: 1000, step: 10 },
      { path: 'fortress.regenPerSec', label: '缓回 / 秒', min: 0, max: 20, step: 1 },
    ],
  },
  {
    group: '敌人 / 波次', icon: '🧟',
    items: [
      { path: 'enemy.hpScaleMul', label: '敌人生命 ×', min: 0.2, max: 3, step: 0.1 },
      { path: 'enemy.spdScaleMul', label: '敌人速度 ×', min: 0.2, max: 3, step: 0.1 },
      { path: 'enemy.atkScaleMul', label: '敌人攻击 ×', min: 0.2, max: 3, step: 0.1 },
      { path: 'enemy.spawnIntervalTune', label: '出怪间隔 ×', min: 0.5, max: 2.5, step: 0.1, note: '>1 更稀疏' },
    ],
  },
  {
    group: '技能', icon: '✨',
    items: [
      { path: 'skills.dmgMul', label: '技能伤害 ×', min: 0.2, max: 4, step: 0.1 },
      { path: 'skills.cdMul', label: '技能冷却 ×', min: 0.2, max: 3, step: 0.1, note: '<1 冷却更短' },
    ],
  },
  {
    group: '特效', icon: '🎨',
    items: [
      { path: 'fx.enemyGlow', label: '敌人发光特效', type: 'toggle', note: '关 → 几何占位' },
      { path: 'fx.deathFx', label: '死亡爆裂粒子', type: 'toggle' },
      { path: 'fx.particles', label: '全局粒子', type: 'toggle', note: '含技能碎片' },
      { path: 'fx.floaters', label: '伤害飘字', type: 'toggle' },
    ],
  },
];

const CSS = `
.zg-gear { position: fixed; top: 10px; right: 10px; z-index: 9999; width: 40px; height: 40px;
  border-radius: 50%; border: 1px solid rgba(90,209,255,0.5); background: rgba(12,18,30,0.85);
  color: #5ad1ff; font-size: 20px; cursor: pointer; display: flex; align-items: center; justify-content: center;
  box-shadow: 0 2px 12px rgba(0,0,0,0.5); transition: transform .15s, background .15s; }
.zg-gear:hover { background: rgba(20,30,48,0.95); transform: rotate(35deg); }
.zg-panel { position: fixed; top: 0; right: 0; z-index: 9998; width: 300px; max-width: 86vw; height: 100%;
  background: rgba(10,14,22,0.96); color: #dfe8f5; font-family: -apple-system,"PingFang SC","Microsoft YaHei",sans-serif;
  box-shadow: -4px 0 24px rgba(0,0,0,0.6); transform: translateX(105%); transition: transform .22s ease;
  display: flex; flex-direction: column; }
.zg-panel.open { transform: translateX(0); }
.zg-head { padding: 14px 16px 10px; border-bottom: 1px solid rgba(255,255,255,0.08);
  display: flex; align-items: center; justify-content: space-between; }
.zg-title { font-size: 15px; font-weight: 700; letter-spacing: .5px; }
.zg-title small { color: #7f93ad; font-weight: 400; font-size: 11px; margin-left: 6px; }
.zg-close { cursor: pointer; color: #8aa0bb; font-size: 20px; line-height: 1; padding: 2px 6px; }
.zg-close:hover { color: #fff; }
.zg-body { overflow-y: auto; padding: 6px 14px 18px; flex: 1; }
.zg-group { margin-top: 14px; }
.zg-group > h4 { margin: 0 0 8px; font-size: 12px; color: #5ad1ff; letter-spacing: 1px;
  display: flex; align-items: center; gap: 6px; opacity: .92; }
.zg-row { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin: 9px 0; }
.zg-label { font-size: 12.5px; color: #cdd8e8; flex: 0 0 auto; }
.zg-label small { display: block; color: #6f829a; font-size: 10px; margin-top: 1px; }
.zg-ctrl { display: flex; align-items: center; gap: 8px; flex: 1; justify-content: flex-end; }
.zg-val { font-size: 12px; color: #ffe14d; min-width: 42px; text-align: right; font-variant-numeric: tabular-nums; }
.zg-range { -webkit-appearance: none; appearance: none; width: 120px; height: 4px; border-radius: 3px;
  background: rgba(255,255,255,0.15); outline: none; }
.zg-range::-webkit-slider-thumb { -webkit-appearance: none; appearance: none; width: 14px; height: 14px;
  border-radius: 50%; background: #5ad1ff; cursor: pointer; box-shadow: 0 0 6px rgba(90,209,255,0.6); }
.zg-range::-moz-range-thumb { width: 14px; height: 14px; border: none; border-radius: 50%; background: #5ad1ff; cursor: pointer; }
/* 开关 */
.zg-switch { position: relative; width: 38px; height: 20px; flex: 0 0 auto; }
.zg-switch input { opacity: 0; width: 0; height: 0; }
.zg-track { position: absolute; inset: 0; border-radius: 20px; background: rgba(255,255,255,0.18);
  transition: background .15s; cursor: pointer; }
.zg-track::before { content: ''; position: absolute; left: 2px; top: 2px; width: 16px; height: 16px;
  border-radius: 50%; background: #fff; transition: transform .15s; }
.zg-switch input:checked + .zg-track { background: #2fbf71; }
.zg-switch input:checked + .zg-track::before { transform: translateX(18px); }
.zg-foot { padding: 10px 14px; border-top: 1px solid rgba(255,255,255,0.08); }
.zg-reset { width: 100%; padding: 9px; border: 1px solid rgba(255,107,107,0.5); border-radius: 6px;
  background: rgba(255,107,107,0.12); color: #ff9a9a; font-size: 13px; cursor: pointer; }
.zg-reset:hover { background: rgba(255,107,107,0.22); }
.zg-hint { font-size: 10.5px; color: #6f829a; margin-top: 8px; line-height: 1.5; }
`;

const controls = []; // { item, input, valEl }

function fmt(v) {
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : v.toFixed(1);
  return String(v);
}

function buildSlider(item) {
  const row = document.createElement('div'); row.className = 'zg-row';
  const lab = document.createElement('div'); lab.className = 'zg-label';
  lab.innerHTML = `${item.label}${item.note ? `<small>${item.note}</small>` : ''}`;
  const ctrl = document.createElement('div'); ctrl.className = 'zg-ctrl';
  const val = document.createElement('span'); val.className = 'zg-val'; val.textContent = fmt(getPath(item.path));
  const range = document.createElement('input');
  range.type = 'range';
  range.className = 'zg-range';
  range.min = item.min; range.max = item.max; range.step = item.step;
  range.value = getPath(item.path);
  range.addEventListener('input', () => {
    const v = Number(range.value);
    setPath(item.path, v);
    val.textContent = fmt(v);
    saveTuning();
    notify();
  });
  ctrl.appendChild(val); ctrl.appendChild(range);
  row.appendChild(lab); row.appendChild(ctrl);
  controls.push({ item, input: range, valEl: val });
  return row;
}

function buildToggle(item) {
  const row = document.createElement('div'); row.className = 'zg-row';
  const lab = document.createElement('div'); lab.className = 'zg-label';
  lab.innerHTML = `${item.label}${item.note ? `<small>${item.note}</small>` : ''}`;
  const sw = document.createElement('label'); sw.className = 'zg-switch';
  const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = !!getPath(item.path);
  const track = document.createElement('span'); track.className = 'zg-track';
  cb.addEventListener('change', () => {
    setPath(item.path, cb.checked);
    saveTuning();
    notify();
  });
  sw.appendChild(cb); sw.appendChild(track);
  row.appendChild(lab); row.appendChild(sw);
  controls.push({ item, input: cb, valEl: null });
  return row;
}

function syncControls() {
  for (const c of controls) {
    const v = getPath(c.item.path);
    if (c.item.type === 'toggle') c.input.checked = !!v;
    else { c.input.value = v; if (c.valEl) c.valEl.textContent = fmt(v); }
  }
}

export function initConfigPanel() {
  if (typeof document === 'undefined') return; // 非浏览器环境不挂载

  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);

  const gear = document.createElement('div');
  gear.className = 'zg-gear';
  gear.title = '配置工作台';
  gear.textContent = '⚙';
  document.body.appendChild(gear);

  const panel = document.createElement('div');
  panel.className = 'zg-panel';
  panel.innerHTML = `
    <div class="zg-head">
      <div class="zg-title">配置工作台 <small>实时生效 · 自动保存</small></div>
      <div class="zg-close" title="关闭">×</div>
    </div>
    <div class="zg-body"></div>
    <div class="zg-foot">
      <button class="zg-reset">恢复默认参数</button>
      <div class="zg-hint">参数存于浏览器本地（localStorage），下次打开自动还原。武器/要塞/技能改动即时生效，敌人缩放与出怪密度作用于后续波次。</div>
    </div>`;
  document.body.appendChild(panel);

  const body = panel.querySelector('.zg-body');
  for (const g of SCHEMA) {
    const grp = document.createElement('div'); grp.className = 'zg-group';
    const h = document.createElement('h4');
    h.innerHTML = `<span>${g.icon}</span>${g.group}`;
    grp.appendChild(h);
    for (const it of g.items) grp.appendChild(it.type === 'toggle' ? buildToggle(it) : buildSlider(it));
    body.appendChild(grp);
  }

  const open = () => { panel.classList.add('open'); syncControls(); };
  const close = () => panel.classList.remove('open');
  gear.addEventListener('click', () => panel.classList.contains('open') ? close() : open());
  panel.querySelector('.zg-close').addEventListener('click', close);

  panel.querySelector('.zg-reset').addEventListener('click', () => {
    resetTuning();   // 写回默认 + 存盘 + notify
    syncControls();  // 面板控件同步到新值
  });

  // 供 combat-core 的 notify 钩子：面板只负责 UI，世界应用由 main.mjs 注册
}
