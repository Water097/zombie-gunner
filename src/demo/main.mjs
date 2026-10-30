// 要塞射击 Web Demo —— 渲染层（Canvas2D）+ 主循环 + 输入
// 只读取 combat-core 的 world 状态来画，只调用其函数来改变状态。渲染方案可整体替换为 WebGL/Pixi，
// 游戏规则一行不动（这正是内核与渲染解耦的目的）。
//
// 第 6 步「状态头顶图标」在此落地：每个敌人头顶按激活状态画一组彩色小图标。

import {
  createWorld, update, castSkill, manualReload, chooseCard, magSizeOf,
  WORLD, PLAYER, FORTRESS, ENEMY_TYPES, SKILLS,
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

// 技能槽：右上角小圆（不挡画面，对齐参考录屏）；按钮变小
const SKILL_ORDER = ['freeze', 'burn', 'shock'];
const SKILL_R = 14;
const buttons = SKILL_ORDER.map((id, i) => ({
  id, x: WORLD.W - 22 - i * 36, y: 24, r: SKILL_R,
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
  // 选卡时数字键 = 选第几张
  if (world.cardPhase && ['1', '2', '3', '4'].includes(e.key)) { chooseCard(world, Number(e.key) - 1); return; }
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

// 选卡界面的卡面矩形（命中检测与绘制共用）
function cardRects() {
  const n = world.pendingCards.length;
  if (!n) return [];
  const cardW = WORLD.W - 72;
  const cardH = 82;
  const gap = 14;
  const totalH = n * cardH + (n - 1) * gap;
  const startY = (WORLD.H - totalH) / 2;
  return world.pendingCards.map((c, i) => ({
    card: c, x: 36, y: startY + i * (cardH + gap), w: cardW, h: cardH,
  }));
}

function inside(r, p) { return p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h; }

canvas.addEventListener('pointerdown', (e) => {
  const p = canvasToLogical(e.clientX, e.clientY);
  if (!world.started) { startGame(); return; }
  if (world.gameOver) { startGame(); return; }
  if (world.cardPhase) { // 选卡优先：点击卡面即选中
    const rects = cardRects();
    for (let i = 0; i < rects.length; i++) if (inside(rects[i], p)) { chooseCard(world, i); return; }
    return;
  }
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
  drawSkillShots();
  drawBullets();
  drawParticles();
  drawFortress();
  drawFloaters();
  drawHUD();
  if (world.cardPhase) drawCardOverlay();
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
  // 防线：敌人推进到此线即停住并持续攻击要塞
  ctx.strokeStyle = 'rgba(255,120,120,0.35)'; ctx.setLineDash([6, 6]);
  ctx.beginPath(); ctx.moveTo(0, FORTRESS.attackLine); ctx.lineTo(WORLD.W, FORTRESS.attackLine); ctx.stroke();
  ctx.setLineDash([]);
}

function drawFortress() {
  const p = world.player;
  const hurt = world.fortressFlash > 0;
  // 要塞墙体（位于玩家前方）
  ctx.fillStyle = hurt ? '#6b2b34' : '#2a3a5c';
  ctx.fillRect(0, p.y + 16, WORLD.W, WORLD.H - p.y - 16);
  // 基座
  ctx.fillStyle = hurt ? '#ff8a8a' : '#3a4f7a';
  ctx.beginPath(); ctx.arc(p.x, p.y, 30, 0, Math.PI * 2); ctx.fill();
  // 炮管（指向目标）
  ctx.save();
  ctx.translate(p.x, p.y); ctx.rotate(p.angle);
  ctx.fillStyle = '#9fc0ff';
  ctx.fillRect(0, -6, 34, 12);
  ctx.restore();
  // 核心
  ctx.fillStyle = hurt ? '#ffd6d6' : '#cfe3ff';
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
  const mag = magSizeOf(world);
  if (p.reloading) {
    const f = 1 - p.reloadTimer / PLAYER.reloadMs;
    ctx.fillStyle = '#ffd36e'; ctx.fillRect(bx, by, w * f, h);
  } else {
    ctx.fillStyle = p.ammo <= 3 ? '#ff5d5d' : '#7fe0ff';
    ctx.fillRect(bx, by, w * (p.ammo / mag), h);
  }
  ctx.fillStyle = '#cdd8ee'; ctx.font = '10px sans-serif'; ctx.textAlign = 'center';
  ctx.fillText(p.reloading ? '换弹中…' : `弹药 ${p.ammo}/${mag}`, p.x, by + 16);
}

function drawEnemies() {
  for (const e of world.enemies) {
    const x = e.x, y = e.y, r = e.radius;
    // 攻击姿态：停下攻击要塞（有攻击间隔与动作，不是撞上去就消失）
    if (e.attacking) {
      // 攻击动作：出手瞬间向前挥出一道爪击
      if (e.attackFlash > 0) {
        const a = Math.max(0, e.attackFlash / 220);
        ctx.globalAlpha = a;
        ctx.strokeStyle = '#ff6b6b'; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.moveTo(x - r, y + r); ctx.lineTo(x, y + r + 12); ctx.lineTo(x + r, y + r); ctx.stroke();
        ctx.globalAlpha = 1;
      }
      ctx.strokeStyle = 'rgba(255,107,107,0.75)'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(x, y, r + 5, 0, Math.PI * 2); ctx.stroke();
    }
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

// 技能弹道渲染：温压=飞行火球（落点爆炸）／干冰·电磁=朝敌飞行的发光拖尾
function drawSkillShots() {
  for (const s of world.skillShots) {
    if (s.id === 'burn') {
      ctx.fillStyle = s.color;
      ctx.beginPath(); ctx.arc(s.x, s.y, s.radius, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 0.35;
      ctx.beginPath(); ctx.arc(s.x, s.y, s.radius + 5, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 1;
    } else {
      const ang = Math.atan2(s.vy, s.vx);
      // 电磁速度已下调，这里把弹体拉长并加辉光，保证弹道看得见
      const len = s.id === 'shock' ? 34 : 20;
      ctx.save();
      ctx.translate(s.x, s.y); ctx.rotate(ang);
      ctx.globalAlpha = 0.3;
      ctx.fillStyle = s.color;
      ctx.beginPath();
      ctx.moveTo(-len, 0); ctx.lineTo(0, -s.radius - 3); ctx.lineTo(len * 0.4, 0); ctx.lineTo(0, s.radius + 3);
      ctx.closePath(); ctx.fill();
      ctx.globalAlpha = 0.95;
      ctx.beginPath();
      ctx.moveTo(-len * 0.8, 0); ctx.lineTo(0, -s.radius); ctx.lineTo(len * 0.3, 0); ctx.lineTo(0, s.radius);
      ctx.closePath(); ctx.fill();
      ctx.globalAlpha = 1;
      ctx.restore();
    }
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

  // 经验条（03 册：顶部蓝色长条 + 等级数字）
  const bx = 10, bw = WORLD.W - 20;
  ctx.fillStyle = 'rgba(0,0,0,0.45)'; ctx.fillRect(bx, 42, bw, 6);
  ctx.fillStyle = '#5aa9ff';
  ctx.fillRect(bx, 42, bw * Math.min(1, world.xp / world.xpNext), 6);
  ctx.fillStyle = '#cfe3ff'; ctx.font = 'bold 10px sans-serif'; ctx.textAlign = 'left';
  ctx.fillText(`Lv ${world.level}`, bx + 2, 58);

  // 要塞血条（敌人会持续攻击，不是撞一下就扣命）
  const fh = Math.max(0, world.fortressHp / world.fortressMaxHp);
  ctx.fillStyle = 'rgba(0,0,0,0.45)'; ctx.fillRect(bx, 64, bw, 6);
  ctx.fillStyle = fh > 0.5 ? '#7fe07f' : fh > 0.25 ? '#ffd36e' : '#ff5d5d';
  ctx.fillRect(bx, 64, bw * fh, 6);
  ctx.fillStyle = '#cfe3ff'; ctx.textAlign = 'right';
  ctx.fillText(`要塞 ${Math.ceil(world.fortressHp)}`, bx + bw - 2, 58);

  // 右上角小技能槽（不挡画面）
  for (const b of buttons) {
    const sk = SKILLS[b.id];
    const slot = world.skills[b.id];
    ctx.fillStyle = 'rgba(20,28,48,0.9)';
    ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = sk.color; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = sk.color; ctx.font = 'bold 11px sans-serif'; ctx.textAlign = 'center';
    ctx.fillText(sk.name[0], b.x, b.y + 4); // 小槽只画首字：冰/温/电
    // 冷却遮罩
    if (slot.cd > 0) {
      const frac = slot.cd / (sk.cooldownMs * world.mods.skillCdMul[b.id]);
      ctx.fillStyle = 'rgba(0,0,0,0.65)';
      ctx.beginPath(); ctx.moveTo(b.x, b.y);
      ctx.arc(b.x, b.y, b.r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.min(1, frac));
      ctx.closePath(); ctx.fill();
    }
  }

  // FPS
  ctx.fillStyle = 'rgba(160,200,255,0.7)'; ctx.font = '10px sans-serif'; ctx.textAlign = 'right';
  ctx.fillText(`${fps} FPS`, WORLD.W - 12, WORLD.H - 8);
}

// 选卡界面：升级时暂停战斗，三选一（08 册：每张卡带主语）
function drawCardOverlay() {
  ctx.fillStyle = 'rgba(6,10,20,0.86)'; ctx.fillRect(0, 0, WORLD.W, WORLD.H);
  ctx.fillStyle = '#eaf2ff'; ctx.textAlign = 'center'; ctx.font = 'bold 20px sans-serif';
  ctx.fillText(`升级！Lv ${world.level}`, WORLD.W / 2, 96);
  ctx.fillStyle = '#aeb9d0'; ctx.font = '12px sans-serif';
  ctx.fillText('选一张（点击卡面，或按 1 / 2 / 3）', WORLD.W / 2, 120);

  const rects = cardRects();
  rects.forEach((r, i) => {
    const kindColor = r.card.kind === 'weapon' ? '#ffe08a'
      : r.card.kind === 'skill' ? '#7fe0ff'
      : r.card.kind === 'function' ? '#7fe07f' : '#ffb3d9';
    ctx.fillStyle = 'rgba(24,32,54,0.98)';
    ctx.fillRect(r.x, r.y, r.w, r.h);
    ctx.strokeStyle = kindColor; ctx.lineWidth = 2;
    ctx.strokeRect(r.x, r.y, r.w, r.h);
    ctx.textAlign = 'left';
    ctx.fillStyle = kindColor; ctx.font = 'bold 15px sans-serif';
    ctx.fillText(`${i + 1}. ${r.card.name}`, r.x + 14, r.y + 28);
    ctx.fillStyle = '#e7eefc'; ctx.font = '13px sans-serif';
    ctx.fillText(r.card.text, r.x + 14, r.y + 54);
    ctx.fillStyle = '#8b98b4'; ctx.font = '10px sans-serif';
    const tag = r.card.kind === 'weapon' ? '武器卡' : r.card.kind === 'skill' ? '技能卡'
      : r.card.kind === 'function' ? '功能卡 · 一局一次' : '加成卡';
    ctx.fillText(tag, r.x + 14, r.y + 72);
  });
}

function drawStartOverlay() {
  ctx.fillStyle = 'rgba(6,10,20,0.78)'; ctx.fillRect(0, 0, WORLD.W, WORLD.H);
  ctx.fillStyle = '#eaf2ff'; ctx.textAlign = 'center';
  ctx.font = 'bold 26px sans-serif'; ctx.fillText('要塞射击 · Demo', WORLD.W / 2, WORLD.H / 2 - 40);
  ctx.font = '14px sans-serif'; ctx.fillStyle = '#aeb9d0';
  ctx.fillText('自动瞄准开火 · 击杀升级可选卡 · R 换弹', WORLD.W / 2, WORLD.H / 2);
  ctx.fillText('技能冷却好自动释放（1/2/3 可提前）', WORLD.W / 2, WORLD.H / 2 + 24);
  ctx.fillText('冻结装甲尸车可触发 ×3 硬门禁', WORLD.W / 2, WORLD.H / 2 + 48);
  ctx.fillStyle = '#7fe0ff'; ctx.font = 'bold 16px sans-serif';
  ctx.fillText('点击屏幕开始', WORLD.W / 2, WORLD.H / 2 + 94);
}

function drawGameOver() {
  ctx.fillStyle = 'rgba(6,10,20,0.82)'; ctx.fillRect(0, 0, WORLD.W, WORLD.H);
  ctx.fillStyle = '#ff6b6b'; ctx.textAlign = 'center'; ctx.font = 'bold 28px sans-serif';
  ctx.fillText('要塞失守', WORLD.W / 2, WORLD.H / 2 - 30);
  ctx.fillStyle = '#eaf2ff'; ctx.font = '16px sans-serif';
  ctx.fillText(`最终分数 ${world.score} · 击杀 ${world.killCount} · Lv ${world.level}`, WORLD.W / 2, WORLD.H / 2 + 6);
  ctx.fillStyle = '#7fe0ff'; ctx.font = 'bold 15px sans-serif';
  ctx.fillText('点击 / 回车 重新开始', WORLD.W / 2, WORLD.H / 2 + 48);
}

requestAnimationFrame(frame);
