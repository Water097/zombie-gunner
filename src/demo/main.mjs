// 要塞射击 Web Demo —— 渲染层（Canvas2D）+ 主循环 + 输入
// 只读取 combat-core 的 world 状态来画，只调用其函数来改变状态。渲染方案可整体替换为 WebGL/Pixi，
// 游戏规则一行不动（这正是内核与渲染解耦的目的）。
//
// UI 尺寸/形状/排布对齐参考原图（513×1080 实测后换算到 450×800）：
//   武器卡 = 横长条圆角矩形（83×22）：左机枪图标 + 左下「X级」+ 右下弹药「20/30」
//   技能槽 = 圆形（直径 36）竖排在武器卡正下方，右下角等级角标
//   要塞血条 = 底部长条（298×9）在要塞下方，血量数字在条右侧
//   宠物机器人 = 悬浮在要塞右侧，负责释放全部技能

import {
  createWorld, update, castSkill, manualReload, chooseCard, magSizeOf, petPos,
  WORLD, PLAYER, FORTRESS, ENEMY_TYPES, SKILLS, RUN,
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

// ── 右侧 UI（换算自参考原图）──
const CARD = { w: 83, h: 22, right: 20, y: 100, r: 4 };
const SKILL_R = 18;                 // 直径 36
const SKILL_CX = WORLD.W - 29;      // 圆心：右缘留 11
const SKILL_TOP = 134;              // 第一个圆心
const SKILL_STEP = 44;              // 间距（直径 36 + 间隙 8）
const PET = { w: 31, h: 22 };
const HP_BAR = { w: 298, h: 9, y: 750 };

function weaponCardRect() {
  return { x: WORLD.W - CARD.right - CARD.w, y: CARD.y, w: CARD.w, h: CARD.h };
}
// 技能圆：只画已学会的技能（开局一个都没有）
function skillCircles() {
  return Object.keys(world.skills).map((id, i) => ({
    id, cx: SKILL_CX, cy: SKILL_TOP + i * SKILL_STEP, r: SKILL_R,
  }));
}

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
window.addEventListener('keydown', (e) => {
  if (e.code === 'Space') { e.preventDefault(); togglePause(); return; }
  if (e.code === 'Enter') { if (world.gameOver || !world.running) startGame(); return; }
  if (e.key === 'r' || e.key === 'R') { manualReload(world); return; }
  // 选卡时 1/2/3 = 选第几张（界面不显示序号，键盘仍可用）
  if (world.cardPhase && ['1', '2', '3', '4'].includes(e.key)) { chooseCard(world, Number(e.key) - 1); return; }
  // 已学技能：数字键释放
  const learned = Object.keys(world.skills);
  const idx = Number(e.key) - 1;
  if (world.skills[learned[idx]]) castSkill(world, learned[idx]);
});

function canvasToLogical(clientX, clientY) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: (clientX - rect.left) / rect.width * WORLD.W,
    y: (clientY - rect.top) / rect.height * WORLD.H,
  };
}

// 选卡界面：横排（对齐参考原图），无序号
function cardRects() {
  const n = world.pendingCards.length;
  if (!n) return [];
  const margin = 14, gap = 10;
  const cardW = (WORLD.W - margin * 2 - gap * (n - 1)) / n;
  const cardH = 156;
  const y = 320;
  return world.pendingCards.map((c, i) => ({
    card: c, x: margin + i * (cardW + gap), y, w: cardW, h: cardH,
  }));
}

function insideRect(r, p) { return p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h; }

canvas.addEventListener('pointerdown', (e) => {
  const p = canvasToLogical(e.clientX, e.clientY);
  if (!world.started) { startGame(); return; }
  if (world.gameOver) { startGame(); return; }
  if (world.cardPhase) { // 选卡优先
    const rects = cardRects();
    for (let i = 0; i < rects.length; i++) if (insideRect(rects[i], p)) { chooseCard(world, i); return; }
    return;
  }
  // 武器卡 → 换弹
  if (insideRect(weaponCardRect(), p)) { manualReload(world); return; }
  // 技能圆 → 释放
  for (const c of skillCircles()) {
    if ((p.x - c.cx) ** 2 + (p.y - c.cy) ** 2 <= c.r * c.r) { castSkill(world, c.id); return; }
  }
});

function startGame() { world = createWorld(); world.running = true; world.started = true; lastT = performance.now(); acc = 0; }
function togglePause() { if (world.gameOver) return; world.running = !world.running; if (world.running) lastT = performance.now(); }

// ── 主循环（固定步长累加器）──
function frame(now) {
  const dt = Math.min(now - lastT, 100);
  lastT = now;
  acc += dt;
  while (acc >= STEP) { update(world, STEP); acc -= STEP; }
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
  drawPet();
  drawFloaters();
  drawHUD();
  if (world.cardPhase) drawCardOverlay();
  if (!world.started) drawStartOverlay();
  if (world.gameOver) drawGameOver();
}

function roundRect(x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function drawBackground() {
  const g = ctx.createLinearGradient(0, 0, 0, WORLD.H);
  g.addColorStop(0, '#0b1020');
  g.addColorStop(1, '#16203a');
  ctx.fillStyle = g; ctx.fillRect(0, 0, WORLD.W, WORLD.H);
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
  // 自动瞄准连线（主武器由要塞自己打）
  const tgt = world.enemies.find((e) => e.id === p.targetId);
  if (tgt) {
    ctx.strokeStyle = 'rgba(255,220,120,0.35)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(tgt.x, tgt.y); ctx.stroke();
    ctx.strokeStyle = 'rgba(255,220,120,0.9)';
    ctx.beginPath(); ctx.arc(tgt.x, tgt.y, tgt.radius + 6, 0, Math.PI * 2); ctx.stroke();
  }
  drawFortressHpBar();
}

// 要塞血条：在要塞下方，血量数字在条右侧（对齐参考原图）
function drawFortressHpBar() {
  const w = HP_BAR.w, h = HP_BAR.h, x = (WORLD.W - w) / 2 - 20, y = HP_BAR.y;
  const f = Math.max(0, world.fortressHp / world.fortressMaxHp);
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  roundRect(x, y, w, h, 3); ctx.fill();
  ctx.fillStyle = f > 0.5 ? '#4fd463' : f > 0.25 ? '#ffd36e' : '#ff5d5d';
  roundRect(x, y, w * f, h, 3); ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.16)'; ctx.lineWidth = 1;
  roundRect(x, y, w, h, 3); ctx.stroke();
  // 血量数字在条右侧
  ctx.fillStyle = '#7fe07f'; ctx.font = 'bold 12px sans-serif'; ctx.textAlign = 'left';
  ctx.fillText(`${Math.ceil(world.fortressHp)}`, x + w + 8, y + h - 1);
}

// 宠物机器人：所有技能都由它释放（玩家对象只管主武器射击与换弹）
function drawPet() {
  const pet = petPos(world);
  const bob = Math.sin(world.time / 260) * 3;
  const x = pet.x, y = pet.y + bob;
  const flash = world.petFlash > 0;
  // 悬浮阴影
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.beginPath(); ctx.ellipse(pet.x, pet.y + 14, 12, 4, 0, 0, Math.PI * 2); ctx.fill();
  if (flash) {
    ctx.globalAlpha = Math.max(0, world.petFlash / 320) * 0.8;
    ctx.fillStyle = '#ffffff';
    ctx.beginPath(); ctx.arc(x, y, 20, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 1;
  }
  // 机翼/螺旋桨
  ctx.strokeStyle = '#cfe3ff'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(x - 16, y - 6); ctx.lineTo(x - 9, y - 6); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(x + 9, y - 6); ctx.lineTo(x + 16, y - 6); ctx.stroke();
  // 机身（浅蓝青色圆润机体，对齐参考原图的无人机）
  ctx.fillStyle = flash ? '#eaf6ff' : '#7fd8e8';
  roundRect(x - PET.w / 2, y - PET.h / 2, PET.w, PET.h, 8); ctx.fill();
  ctx.strokeStyle = '#eaf6ff'; ctx.lineWidth = 1.5;
  roundRect(x - PET.w / 2, y - PET.h / 2, PET.w, PET.h, 8); ctx.stroke();
  // 眼睛（朝向当前目标）
  const tgt = world.enemies.find((e) => e.id === world.player.targetId);
  let ex = 0, ey = 0;
  if (tgt) { const a = Math.atan2(tgt.y - y, tgt.x - x); ex = Math.cos(a) * 3; ey = Math.sin(a) * 3; }
  ctx.fillStyle = '#0b1020';
  ctx.beginPath(); ctx.arc(x - 5 + ex, y + ey, 2.6, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(x + 5 + ex, y + ey, 2.6, 0, Math.PI * 2); ctx.fill();
}

function drawEnemies() {
  for (const e of world.enemies) {
    const x = e.x, y = e.y, r = e.radius;
    if (e.attacking) {
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
    ctx.fillStyle = e.color;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    if (e.hitFlash > 0) { ctx.fillStyle = 'rgba(255,255,255,0.6)'; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); }
    if (has(e.st, 'freeze')) { ctx.strokeStyle = '#5ad1ff'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(x, y, r + 2, 0, Math.PI * 2); ctx.stroke(); }
    else if (has(e.st, 'stun')) { ctx.strokeStyle = '#c77dff'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(x, y, r + 2, 0, Math.PI * 2); ctx.stroke(); }
    else if (has(e.st, 'burn')) { ctx.strokeStyle = '#ff7a3c'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(x, y, r + 2, 0, Math.PI * 2); ctx.stroke(); }
    const bw = r * 2;
    ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillRect(x - r, y - r - 9, bw, 4);
    ctx.fillStyle = e.hp / e.maxHp > 0.35 ? '#7fe07f' : '#ff6b6b';
    ctx.fillRect(x - r, y - r - 9, bw * Math.max(0, e.hp / e.maxHp), 4);
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
    if (has(e.st, id)) { ctx.fillStyle = col; ctx.fillRect(x, y, 7, 7); x += 9; }
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
      const len = s.id === 'shock' ? 34 : 20;
      ctx.save();
      ctx.translate(s.x, s.y); ctx.rotate(ang);
      ctx.globalAlpha = 0.3; ctx.fillStyle = s.color;
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
  ctx.fillText(`第 ${world.wave} / ${RUN.maxWave} 波`, WORLD.W / 2 - 40, 22);

  // 经验条（03 册：顶部蓝色长条 + 等级数字）
  const bx = 10, bw = WORLD.W - 130; // 右侧给武器卡让位
  ctx.fillStyle = 'rgba(0,0,0,0.45)'; ctx.fillRect(bx, 42, bw, 6);
  ctx.fillStyle = '#5aa9ff';
  ctx.fillRect(bx, 42, bw * Math.min(1, world.xp / world.xpNext), 6);
  ctx.fillStyle = '#cfe3ff'; ctx.font = 'bold 10px sans-serif'; ctx.textAlign = 'left';
  ctx.fillText(`Lv ${world.level}`, bx + 2, 58);

  drawWeaponCard();
  drawSkillSlots();

  ctx.fillStyle = 'rgba(160,200,255,0.7)'; ctx.font = '10px sans-serif'; ctx.textAlign = 'right';
  ctx.fillText(`${fps} FPS`, WORLD.W - 12, WORLD.H - 8);
}

// 武器卡：横长条圆角矩形（对齐参考原图）—— 左机枪图标 + 左下「X级」+ 右下弹药「剩余/弹匣」
function drawWeaponCard() {
  const r = weaponCardRect();
  const p = world.player;
  const mag = magSizeOf();
  ctx.fillStyle = 'rgba(22,30,50,0.92)';
  roundRect(r.x, r.y, r.w, r.h, CARD.r); ctx.fill();
  ctx.strokeStyle = '#ffe08a'; ctx.lineWidth = 1.5;
  roundRect(r.x, r.y, r.w, r.h, CARD.r); ctx.stroke();

  // 机枪图标（简笔：枪身 + 枪管 + 弹匣）
  const gx = r.x + 6, gy = r.y + 4;
  ctx.fillStyle = '#b9c4dc';
  ctx.fillRect(gx, gy + 2, 22, 5);          // 枪身
  ctx.fillRect(gx + 22, gy + 3, 10, 3);      // 枪管
  ctx.fillStyle = '#8b98b4';
  ctx.fillRect(gx + 5, gy + 7, 5, 4);        // 弹匣
  ctx.fillRect(gx + 14, gy + 7, 3, 3);       // 握把

  // 左下：武器等级
  ctx.fillStyle = '#ffd36e'; ctx.font = 'bold 9px sans-serif'; ctx.textAlign = 'left';
  ctx.fillText(`${world.slotLevels.weapon}级`, r.x + 6, r.y + r.h - 4);
  // 右下：弹药「剩余/弹匣」（对齐参考原图的 20/30）
  ctx.textAlign = 'right';
  if (p.reloading) {
    ctx.fillStyle = '#ffd36e'; ctx.font = 'bold 9px sans-serif';
    ctx.fillText('换弹中', r.x + r.w - 6, r.y + r.h - 4);
    const f = 1 - p.reloadTimer / (PLAYER.reloadMs * world.mods.reloadMul);
    ctx.fillStyle = '#ffd36e'; ctx.fillRect(r.x, r.y + r.h - 2, r.w * f, 2);
  } else {
    ctx.fillStyle = p.ammo <= 6 ? '#ff5d5d' : '#eaf2ff'; ctx.font = 'bold 11px sans-serif';
    ctx.fillText(`${p.ammo}/${mag}`, r.x + r.w - 6, r.y + r.h - 4);
  }
}

// 技能槽：圆形竖排在武器卡下方，右下角等级角标；只显示已学会的技能
function drawSkillSlots() {
  for (const c of skillCircles()) {
    const sk = SKILLS[c.id];
    const slot = world.skills[c.id];
    ctx.fillStyle = 'rgba(18,26,44,0.92)';
    ctx.beginPath(); ctx.arc(c.cx, c.cy, c.r, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = sk.color; ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.arc(c.cx, c.cy, c.r, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = sk.color; ctx.font = 'bold 16px sans-serif'; ctx.textAlign = 'center';
    ctx.fillText(sk.name[0], c.cx, c.cy + 6);
    // 冷却遮罩（自顶向下扫过）
    const full = sk.cooldownMs * world.mods.skillCdMul[c.id];
    if (slot.cd > 0) {
      const frac = Math.min(1, slot.cd / full);
      ctx.fillStyle = 'rgba(0,0,0,0.62)';
      ctx.beginPath();
      ctx.moveTo(c.cx, c.cy);
      ctx.arc(c.cx, c.cy, c.r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * frac);
      ctx.closePath(); ctx.fill();
    }
    // 右下角等级角标（对齐参考原图）
    const lv = world.slotLevels[c.id] || 0;
    const bxx = c.cx + c.r - 3, byy = c.cy + c.r - 3;
    ctx.fillStyle = '#0b1020';
    ctx.beginPath(); ctx.arc(bxx, byy, 8, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#eaf2ff'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(bxx, byy, 8, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = '#eaf2ff'; ctx.font = 'bold 9px sans-serif'; ctx.textAlign = 'center';
    ctx.fillText(String(lv), bxx, byy + 3);
  }
}

// 文字折行（横排卡片较窄，需要折行）
function wrapText(text, maxWidth) {
  ctx.font = '12px sans-serif';
  const lines = [];
  let cur = '';
  for (const ch of text) {
    if (ctx.measureText(cur + ch).width > maxWidth && cur) { lines.push(cur); cur = ch; }
    else cur += ch;
  }
  if (cur) lines.push(cur);
  return lines;
}

// 选卡界面：横排三张、无序号（对齐参考原图）
function drawCardOverlay() {
  ctx.fillStyle = 'rgba(6,10,20,0.88)'; ctx.fillRect(0, 0, WORLD.W, WORLD.H);
  ctx.fillStyle = '#eaf2ff'; ctx.textAlign = 'center'; ctx.font = 'bold 22px sans-serif';
  ctx.fillText(`升级！Lv ${world.level}`, WORLD.W / 2, 250);
  ctx.fillStyle = '#aeb9d0'; ctx.font = '12px sans-serif';
  ctx.fillText('选一张', WORLD.W / 2, 274);

  const rects = cardRects();
  rects.forEach((r) => {
    const kindColor = r.card.kind === 'weapon' ? '#ffe08a'
      : r.card.kind === 'skill' ? '#7fe0ff'
      : r.card.kind === 'learn' ? '#b6ff7a'
      : r.card.kind === 'function' ? '#7fe07f' : '#ffb3d9';
    ctx.fillStyle = 'rgba(24,32,54,0.98)';
    roundRect(r.x, r.y, r.w, r.h, 8); ctx.fill();
    ctx.strokeStyle = kindColor; ctx.lineWidth = 2;
    roundRect(r.x, r.y, r.w, r.h, 8); ctx.stroke();

    ctx.textAlign = 'center';
    ctx.fillStyle = kindColor; ctx.font = 'bold 15px sans-serif';
    ctx.fillText(r.card.name, r.x + r.w / 2, r.y + 32);
    // 效果文案折行
    ctx.fillStyle = '#e7eefc'; ctx.font = '12px sans-serif';
    const lines = wrapText(r.card.text, r.w - 18);
    lines.forEach((ln, i) => ctx.fillText(ln, r.x + r.w / 2, r.y + 62 + i * 18));
    // 类型标签
    ctx.fillStyle = '#8b98b4'; ctx.font = '10px sans-serif';
    const tag = r.card.kind === 'weapon' ? '武器卡' : r.card.kind === 'skill' ? '技能卡'
      : r.card.kind === 'learn' ? '学习技能' : r.card.kind === 'function' ? '功能卡 · 一局一次' : '加成卡';
    ctx.fillText(tag, r.x + r.w / 2, r.y + r.h - 14);
  });
}

function drawStartOverlay() {
  ctx.fillStyle = 'rgba(6,10,20,0.78)'; ctx.fillRect(0, 0, WORLD.W, WORLD.H);
  ctx.fillStyle = '#eaf2ff'; ctx.textAlign = 'center';
  ctx.font = 'bold 26px sans-serif'; ctx.fillText('要塞射击 · Demo', WORLD.W / 2, WORLD.H / 2 - 52);
  ctx.font = '14px sans-serif'; ctx.fillStyle = '#aeb9d0';
  ctx.fillText('开局只有主武器子弹，技能要靠选卡学会', WORLD.W / 2, WORLD.H / 2 - 22);
  ctx.fillText('武器只管射击与换弹（弹匣 30）· R 换弹', WORLD.W / 2, WORLD.H / 2 + 2);
  ctx.fillText('技能由右侧宠物机器人自动释放', WORLD.W / 2, WORLD.H / 2 + 26);
  ctx.fillText(`共 ${RUN.maxWave} 波 · 20 级 · 第 ${RUN.maxWave} 波收尾`, WORLD.W / 2, WORLD.H / 2 + 50);
  ctx.fillStyle = '#7fe0ff'; ctx.font = 'bold 16px sans-serif';
  ctx.fillText('点击屏幕开始', WORLD.W / 2, WORLD.H / 2 + 96);
}

function drawGameOver() {
  ctx.fillStyle = 'rgba(6,10,20,0.82)'; ctx.fillRect(0, 0, WORLD.W, WORLD.H);
  const won = world.won;
  ctx.fillStyle = won ? '#7fe07f' : '#ff6b6b'; ctx.textAlign = 'center'; ctx.font = 'bold 28px sans-serif';
  ctx.fillText(won ? '守住了！' : '要塞失守', WORLD.W / 2, WORLD.H / 2 - 30);
  ctx.fillStyle = '#eaf2ff'; ctx.font = '16px sans-serif';
  ctx.fillText(`分数 ${world.score} · 击杀 ${world.killCount} · Lv ${world.level} · 第 ${world.wave} 波`, WORLD.W / 2, WORLD.H / 2 + 6);
  ctx.fillStyle = '#7fe0ff'; ctx.font = 'bold 15px sans-serif';
  ctx.fillText('点击 / 回车 重新开始', WORLD.W / 2, WORLD.H / 2 + 48);
}

requestAnimationFrame(frame);
