// 要塞射击 Web Demo —— 渲染层（Canvas2D）+ 主循环 + 输入
// 只读取 combat-core 的 world 状态来画，只调用其函数来改变状态。渲染方案可整体替换为 WebGL/Pixi，
// 游戏规则一行不动（这正是内核与渲染解耦的目的）。
//
// 第 6 步「状态头顶图标」在此落地：每个敌人头顶按激活状态画一组彩色小图标。

import {
  createWorld, update, castSkill, manualReload, WORLD, PLAYER, ENEMY_TYPES, SKILLS,
} from './combat-core.mjs';
import { has } from '../status/status-system.mjs';

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const DPR = Math.min(window.devicePixelRatio || 1, 2); // 12 册硬指标：DPR≤2 控内存

let world = createWorld();
let lastT = performance.now();
let acc = 0;
const STEP = 1000 / 60; // 固定步长 16.67ms，手感与帧率解耦
let fps = 60, fpsAccum = 0, fpsFrames = 0;

// 技能按钮布局（竖屏底部，触控 + 键盘）
const SKILL_ORDER = ['freeze', 'burn', 'shock'];
const buttons = SKILL_ORDER.map((id, i) => ({
  id, x: 80 + i * 145, y: WORLD.H - 34, r: 26,
}));

function resize() {
  const scale = Math.min(window.innerWidth / WORLD.W, window.innerHeight / WORLD.H);
  canvas.style.width = `${WORLD.W * scale}px`;
  canvas.style.height = `${WORLD.H * scale}px`;
  canvas.width = Math.round(WORLD.W * DPR);
  canvas.height = Math.round(WORLD.H * DPR);
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
}
window.addEventListener('resize', resize);
resize();

// ── 输入 ──
const KEY_SKILL = { '1': 'freeze', '2': 'burn', '3': 'shock' };

window.addEventListener('keydown', (e) => {
  if (e.code === 'Space') { e.preventDefault(); togglePause(); return; }
  if (e.code === 'Enter') { if (world.gameOver || !world.running) startGame(); return; }
  if (e.key === 'r' || e.key === 'R') { manualReload(world); return; }
  const sk = KEY_SKILL[e.key];
  if (sk) castSkill(world, sk);
});

function canvasToLogical(clientX, clientY) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: (clientX - rect.left) / rect.width * WORLD.W,
    y: (clientY - rect.top) / rect.height * WORLD.H,
  };
}

canvas.addEventListener('pointerdown', (e) => {
  const p = canvasToLogical(e.clientX, e.clientY);
  if (!world.started) { startGame(); return; }
  if (world.gameOver) { startGame(); return; }
  // 技能按钮命中？
  for (const b of buttons) {
    if ((p.x - b.x) ** 2 + (p.y - b.y) ** 2 <= b.r * b.r) { castSkill(world, b.id); return; }
  }
});

function startGame() { world = createWorld(); world.running = true; world.started = true; lastT = performance.now(); acc = 0; }
function togglePause() { if (world.gameOver) return; world.running = !world.running; if (world.running) lastT = performance.now(); }

// ── 主循环（固定步长累加器）──
function frame(now) {
  const dt = Math.min(now - lastT, 100); // 防止切后台后巨步
  lastT = now;
  acc += dt;
  while (acc >= STEP) { update(world, STEP); acc -= STEP; }

  // FPS 统计
  fpsAccum += dt; fpsFrames++;
  if (fpsAccum >= 500) { fps = Math.round((fpsFrames * 1000) / fpsAccum); fpsAccum = 0; fpsFrames = 0; }

  render();
  requestAnimationFrame(frame);
}

// ── 渲染 ──
function render() {
  ctx.clearRect(0, 0, WORLD.W, WORLD.H);
  drawBackground();
  drawRings();
  drawEnemies();
  drawBullets();
  drawParticles();
  drawFortress();
  drawFloaters();
  drawHUD();
  if (!world.started) drawStartOverlay();
  if (world.gameOver) drawGameOver();
}

function drawBackground() {
  const g = ctx.createLinearGradient(0, 0, 0, WORLD.H);
  g.addColorStop(0, '#0b1020');
  g.addColorStop(1, '#16203a');
  ctx.fillStyle = g; ctx.fillRect(0, 0, WORLD.W, WORLD.H);
  // 战场纵向车道提示
  ctx.strokeStyle = 'rgba(255,255,255,0.04)'; ctx.lineWidth = 1;
  for (let x = 60; x < WORLD.W; x += 60) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, WORLD.H); ctx.stroke(); }
  // 要塞警戒线
  ctx.strokeStyle = 'rgba(120,200,255,0.25)'; ctx.setLineDash([6, 6]);
  ctx.beginPath(); ctx.moveTo(0, WORLD.H - 24); ctx.lineTo(WORLD.W, WORLD.H - 24); ctx.stroke();
  ctx.setLineDash([]);
}

function drawFortress() {
  const p = world.player;
  // 基座
  ctx.fillStyle = '#2a3a5c';
  ctx.beginPath(); ctx.arc(p.x, p.y, 30, 0, Math.PI * 2); ctx.fill();
  // 炮管（指向目标）
  ctx.save();
  ctx.translate(p.x, p.y); ctx.rotate(p.angle);
  ctx.fillStyle = '#9fc0ff';
  ctx.fillRect(0, -6, 34, 12);
  ctx.restore();
  // 核心
  ctx.fillStyle = '#cfe3ff';
  ctx.beginPath(); ctx.arc(p.x, p.y, 12, 0, Math.PI * 2); ctx.fill();
  // 自动瞄准连线
  const tgt = world.enemies.find((e) => e.id === p.targetId);
  if (tgt) {
    ctx.strokeStyle = 'rgba(255,220,120,0.35)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(tgt.x, tgt.y); ctx.stroke();
    ctx.strokeStyle = 'rgba(255,220,120,0.9)';
    ctx.beginPath(); ctx.arc(tgt.x, tgt.y, tgt.radius + 6, 0, Math.PI * 2); ctx.stroke();
  }
  // 弹药条
  const w = 60, h = 6, bx = p.x - w / 2, by = p.y + 34;
  ctx.fillStyle = 'rgba(0,0,0,0.4)'; ctx.fillRect(bx, by, w, h);
  if (p.reloading) {
    const f = 1 - p.reloadTimer / PLAYER.reloadMs;
    ctx.fillStyle = '#ffd36e'; ctx.fillRect(bx, by, w * f, h);
  } else {
    ctx.fillStyle = p.ammo <= 6 ? '#ff5d5d' : '#7fe0ff';
    ctx.fillRect(bx, by, w * (p.ammo / PLAYER.magSize), h);
  }
  ctx.fillStyle = '#cdd8ee'; ctx.font = '10px sans-serif'; ctx.textAlign = 'center';
  ctx.fillText(p.reloading ? '换弹中…' : `弹药 ${p.ammo}/${PLAYER.magSize}`, p.x, by + 16);
}

function drawEnemies() {
  for (const e of world.enemies) {
    const x = e.x, y = e.y, r = e.radius;
    // 主体
    ctx.fillStyle = e.color;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    if (e.hitFlash > 0) { ctx.fillStyle = 'rgba(255,255,255,0.6)'; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); }
    // 状态描边
    if (has(e.st, 'freeze')) { ctx.strokeStyle = '#5ad1ff'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(x, y, r + 2, 0, Math.PI * 2); ctx.stroke(); }
    else if (has(e.st, 'stun')) { ctx.strokeStyle = '#c77dff'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(x, y, r + 2, 0, Math.PI * 2); ctx.stroke(); }
    else if (has(e.st, 'burn')) { ctx.strokeStyle = '#ff7a3c'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(x, y, r + 2, 0, Math.PI * 2); ctx.stroke(); }
    // 血条
    const bw = r * 2;
    ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillRect(x - r, y - r - 9, bw, 4);
    ctx.fillStyle = e.hp / e.maxHp > 0.35 ? '#7fe07f' : '#ff6b6b';
    ctx.fillRect(x - r, y - r - 9, bw * Math.max(0, e.hp / e.maxHp), 4);
    // 第 6 步：状态头顶图标（一组彩色小方块）
    drawStatusIcons(e, x - r, y - r - 22);
  }
}

const STATUS_ICON = [
  ['freeze', '#5ad1ff'], ['stun', '#c77dff'], ['burn', '#ff7a3c'],
  ['shock', '#ffe14d'], ['slow', '#6ec6ff'], ['vuln', '#ff4d6d'], ['knock', '#ffffff'],
];
function drawStatusIcons(e, x0, y) {
  let x = x0;
  for (const [id, col] of STATUS_ICON) {
    if (has(e.st, id)) {
      ctx.fillStyle = col;
      ctx.fillRect(x, y, 7, 7);
      x += 9;
    }
  }
}

function drawBullets() {
  for (const b of world.bullets) {
    ctx.fillStyle = 'rgba(255,224,138,0.4)';
    ctx.beginPath(); ctx.arc(b.x, b.y, b.radius + 3, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#ffe08a';
    ctx.beginPath(); ctx.arc(b.x, b.y, b.radius, 0, Math.PI * 2); ctx.fill();
  }
}

function drawParticles() {
  for (const p of world.particles) {
    ctx.globalAlpha = Math.max(0, p.life / p.maxLife);
    ctx.fillStyle = p.color;
    ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
  }
  ctx.globalAlpha = 1;
}

function drawRings() {
  for (const r of world.rings) {
    ctx.globalAlpha = Math.max(0, r.life / r.maxLife) * 0.7;
    ctx.strokeStyle = r.color; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(r.x, r.y, r.r, 0, Math.PI * 2); ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

function drawFloaters() {
  ctx.textAlign = 'center'; ctx.font = 'bold 12px sans-serif';
  for (const f of world.floaters) {
    ctx.globalAlpha = Math.max(0, f.life / f.maxLife);
    ctx.fillStyle = f.color;
    ctx.fillText(f.text, f.x, f.y);
  }
  ctx.globalAlpha = 1;
}

function drawHUD() {
  // 顶部信息条
  ctx.fillStyle = 'rgba(8,12,24,0.6)'; ctx.fillRect(0, 0, WORLD.W, 34);
  ctx.fillStyle = '#e7eefc'; ctx.font = 'bold 14px sans-serif'; ctx.textAlign = 'left';
  ctx.fillText(`分数 ${world.score}`, 12, 22);
  ctx.textAlign = 'center';
  ctx.fillText(`第 ${world.wave} 波`, WORLD.W / 2, 22);
  ctx.textAlign = 'right';
  ctx.fillStyle = world.lives <= 3 ? '#ff6b6b' : '#e7eefc';
  ctx.fillText(`要塞 ${world.lives}`, WORLD.W - 12, 22);
  // 右上角 FPS
  ctx.fillStyle = 'rgba(160,200,255,0.7)'; ctx.font = '10px sans-serif'; ctx.textAlign = 'right';
  ctx.fillText(`${fps} FPS`, WORLD.W - 12, 46);

  // 底部技能按钮
  for (const b of buttons) {
    const sk = SKILLS[b.id];
    const slot = world.skills[b.id];
    ctx.fillStyle = 'rgba(20,28,48,0.9)';
    ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = sk.color; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = sk.color; ctx.font = 'bold 13px sans-serif'; ctx.textAlign = 'center';
    ctx.fillText(sk.name, b.x, b.y - 2);
    ctx.fillStyle = '#aeb9d0'; ctx.font = '9px sans-serif';
    ctx.fillText(`[${sk.key || ''}]`, b.x, b.y + 11);
    // 冷却遮罩
    if (slot.cd > 0) {
      const frac = slot.cd / sk.cooldownMs;
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.beginPath(); ctx.moveTo(b.x, b.y);
      ctx.arc(b.x, b.y, b.r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * frac);
      ctx.closePath(); ctx.fill();
    }
  }
}

function drawStartOverlay() {
  ctx.fillStyle = 'rgba(6,10,20,0.78)'; ctx.fillRect(0, 0, WORLD.W, WORLD.H);
  ctx.fillStyle = '#eaf2ff'; ctx.textAlign = 'center';
  ctx.font = 'bold 26px sans-serif'; ctx.fillText('要塞射击 · Demo', WORLD.W / 2, WORLD.H / 2 - 40);
  ctx.font = '14px sans-serif'; ctx.fillStyle = '#aeb9d0';
  ctx.fillText('自动瞄准开火 · R 换弹 · 1/2/3 释放技能', WORLD.W / 2, WORLD.H / 2);
  ctx.fillText('冻结装甲尸车可触发 ×3 硬门禁', WORLD.W / 2, WORLD.H / 2 + 24);
  ctx.fillStyle = '#7fe0ff'; ctx.font = 'bold 16px sans-serif';
  ctx.fillText('点击屏幕开始', WORLD.W / 2, WORLD.H / 2 + 70);
}

function drawGameOver() {
  ctx.fillStyle = 'rgba(6,10,20,0.82)'; ctx.fillRect(0, 0, WORLD.W, WORLD.H);
  ctx.fillStyle = '#ff6b6b'; ctx.textAlign = 'center'; ctx.font = 'bold 28px sans-serif';
  ctx.fillText('要塞失守', WORLD.W / 2, WORLD.H / 2 - 30);
  ctx.fillStyle = '#eaf2ff'; ctx.font = '16px sans-serif';
  ctx.fillText(`最终分数 ${world.score} · 击杀 ${world.killCount}`, WORLD.W / 2, WORLD.H / 2 + 6);
  ctx.fillStyle = '#7fe0ff'; ctx.font = 'bold 15px sans-serif';
  ctx.fillText('点击 / 回车 重新开始', WORLD.W / 2, WORLD.H / 2 + 48);
}

requestAnimationFrame(frame);
