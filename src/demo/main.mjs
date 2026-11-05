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
  createWorld, update, castSkill, manualReload, chooseCard, takeCard, magSizeOf, petPos,
  CARDS, WORLD, PLAYER, FORTRESS, ENEMY_TYPES, SKILLS, RUN,
} from './combat-core.mjs';
import { LEARN_CARDS } from './cards.mjs';
import { has } from '../status/status-system.mjs';
import { SoftFx, drawSoftParticles, drawSoftRings, drawSoftFloaters } from './soft-fx.mjs';
// 敌人精灵层（2026-11-05）：把概念图里的史莱姆直接跑进 demo，替换原几何占位
import { EnemySprites } from './sprite-layer.mjs';
// 火场精灵层（2026-11-05 试点）：燃烧地带改走 pixelfx，和概念图同一份实现
import { FlameSprites } from './flame-sprites.mjs';

const TAU = Math.PI * 2;
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const DPR = Math.min(window.devicePixelRatio || 1, 2); // 12 册硬指标：DPR≤2 控内存

let world = createWorld();
// 调试钩子（2026-11-05）：控制台可直接操作 world 验证表现，例如
//   __world.flames.push({x:180,y:300,r:72,life:5000,maxLife:5000,tickTimer:0,
//     dmgTick:22,burnMs:2000,slowMag:0.25,slowMs:1000,color:'#d1493a'})
// 只读不写、不参与玩法逻辑，纯为验证留的口子。
window.__world = () => world;
// 柔和卡通特效层（2026-11-04）：借 pixelfx 的加色辉光/色阶/相位编排，纯 Canvas2D JS 实现。
// 只读 world，不写 world；自建实例池由渲染层触发，逻辑层零改动。
const softFx = new SoftFx({ seed: 20261104, lootTarget: { x: 44, y: 22 } });
const enemySprites = new EnemySprites();
const flameSprites = new FlameSprites();
let lastDt = 1000 / 60;   // 精灵层用的步长（与固定步长同源）
let lastT = performance.now();
let acc = 0;
const STEP = 1000 / 60; // 固定步长 16.67ms，手感与帧率解耦
let fps = 60, fpsAccum = 0, fpsFrames = 0;
// 定制模式（2026-11-02）：开始界面选模式，游戏中按 C 打开卡池面板自选海克斯
let selectCustom = false;   // 开始界面当前高亮的模式
let panelTab = 'learn';     // 面板当前分类
let panelSub = 'freeze';    // 技能页的子分类（按技能分开，否则 21 张技能卡挤在一起）

// ── 右侧 UI（换算自参考原图）──
// 武器卡贴在经验条正下方（参考原图：经验条往下一格就是武器卡），技能圆竖排其下、互不重叠
const CARD = { w: 83, h: 22, right: 20, y: 56, r: 4 };
const SKILL_R = 18;                 // 直径 36
const SKILL_CX = WORLD.W - 29;      // 圆心：右缘留 11
const SKILL_TOP = 110;              // 第一个圆心（卡底 78 + 间隙 14 + 半径 18）
const SKILL_STEP = 44;              // 间距（直径 36 + 间隙 8）
const SKILL_SLOTS = 4;              // 技能槽共 4 个：未学/未满也显示占位框
const PET = { w: 31, h: 22 };
const HP_BAR = { w: 298, h: 9, y: 750 };

function weaponCardRect() {
  return { x: WORLD.W - CARD.right - CARD.w, y: CARD.y, w: CARD.w, h: CARD.h };
}
// 技能槽：固定 4 个。已学技能按【学习先后顺序】从上往下排（world.skills 是普通对象，
// 键的插入顺序 = 学习顺序）；未学的显示空占位框，排在学习槽之后。
function skillSlots() {
  const learned = Object.keys(world.skills); // 学习顺序
  const slots = [];
  for (let i = 0; i < SKILL_SLOTS; i++) {
    const id = learned[i] || null;
    slots.push({ id, learned: !!id, cx: SKILL_CX, cy: SKILL_TOP + i * SKILL_STEP, r: SKILL_R });
  }
  return slots;
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
  if (e.code === 'Enter') { if (world.gameOver || !world.running) startGame(world.customMode); return; }
  if (e.key === 'r' || e.key === 'R') { manualReload(world); return; }
  // 定制模式：C 开/关卡池面板（面板打开时 update 早退 = 战斗暂停）
  if (e.key === 'c' || e.key === 'C') {
    if (world.customMode && world.started && !world.gameOver && !world.cardPhase) {
      world.panelOpen = !world.panelOpen;
    }
    return;
  }
  // 定制模式测试开关（2026-11-03 用户要求：定制模式 = 纯测试模式）
  // F = 主武器停火/恢复（测技能时不被主武器抢人头）；G = 要塞无敌/恢复（局不会结束）
  if (world.customMode && world.started) {
    if (e.key === 'f' || e.key === 'F') { world.cheats.noFire = !world.cheats.noFire; return; }
    if (e.key === 'g' || e.key === 'G') { world.cheats.godFortress = !world.cheats.godFortress; return; }
  }
  // 选卡时 1/2/3 = 选第几张（界面不显示序号，键盘仍可用）
  if (world.cardPhase && ['1', '2', '3', '4'].includes(e.key)) { chooseCard(world, Number(e.key) - 1); return; }
  // 已学技能：数字键按槽位释放（槽位 = 学习顺序，1 = 最先学的技能）
  const idx = Number(e.key) - 1;
  const slot = skillSlots()[idx];
  if (slot && slot.learned) castSkill(world, slot.id);
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
  if (world.panelOpen) { handlePanelClick(p); return; }  // 面板优先
  if (!world.started) {                                 // 开始界面：先选模式
    for (const b of startButtons()) if (insideRect(b, p)) { startGame(b.mode === 'custom'); return; }
    return;
  }
  if (world.gameOver) { startGame(world.customMode); return; }
  if (world.cardPhase) { // 选卡优先
    const rects = cardRects();
    for (let i = 0; i < rects.length; i++) if (insideRect(rects[i], p)) { chooseCard(world, i); return; }
    return;
  }
  // 武器卡 → 换弹
  if (insideRect(weaponCardRect(), p)) { manualReload(world); return; }
  // 技能槽 → 释放（只认已学的）
  for (const c of skillSlots()) {
    if (c.learned && (p.x - c.cx) ** 2 + (p.y - c.cy) ** 2 <= c.r * c.r) { castSkill(world, c.id); return; }
  }
});

function startGame(custom = false) {
  world = createWorld();
  softFx.reset();                       // 重开一局：清掉上一局残留的升级/掉落特效
  world.customMode = !!custom;
  world.running = true; world.started = true;
  selectCustom = !!custom;
  panelTab = 'learn';
  lastT = performance.now(); acc = 0;
}
function togglePause() { if (world.gameOver) return; world.running = !world.running; if (world.running) lastT = performance.now(); }

// ── 主循环（固定步长累加器）──
function frame(now) {
  const dt = Math.min(now - lastT, 100);
  lastT = now;
  acc += dt;
  // 特效层跟随同一个固定步长推进 → 与帧率解耦、确定性（对齐 pixelfx 的 120Hz 细分思路）
  while (acc >= STEP) { update(world, STEP); softFx.update(STEP); acc -= STEP; }
  lastDt = dt;
  fpsAccum += dt; fpsFrames++;
  if (fpsAccum >= 500) { fps = Math.round((fpsFrames * 1000) / fpsAccum); fpsAccum = 0; fpsFrames = 0; }
  render();
  requestAnimationFrame(frame);
}

// ── 渲染 ──
function render() {
  ctx.clearRect(0, 0, WORLD.W, WORLD.H);
  ctx.lineJoin = 'round'; ctx.lineCap = 'round'; // 全局柔边笔触（2026-11-04 画风落地）
  softFx.syncWorld(world);   // 只读侦测升级/击杀，触发柔和特效
  drawBackground();
  softFx.drawBack(ctx);      // back 层：地面光板 / 环远半，在角色之后（纵深）
  drawStorms();
  drawFlames();     // 地面火区（在敌人之下）
  drawRings();
  drawStrikes();
  drawArcs();
  drawVehicles();
  drawEnemies();
  drawEnemyShots();
  drawBeams();      // 光束/激光/炮台/刀轮在敌人之上
  drawSweeps();
  drawTurrets();
  drawSaws();
  drawSkillShots();
  drawBullets();
  drawParticles();
  drawFortress();
  drawPet();
  drawFloaters();
  drawHUD();
  if (world.cardPhase) drawCardOverlay();
  if (world.panelOpen) drawCardPanel();
  if (!world.started) drawStartOverlay();
  if (world.gameOver) drawGameOver();
  softFx.drawFront(ctx);     // front 层：光柱 / 逐字标题 / 掉落道具，叠在最上
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

// ── 柔和霓虹画笔（2026-11-04 画风落地：Q版 / 软描边 / 平滑渐变 / 温和辉光）──
// 依据《向僵尸开炮》参考：不要多色硬勾边、不要碎线；描边改为深青柔边，体块用径向渐变，
// 眼睛/武器/能量做柔和辉光。只影响渲染，不动任何游戏逻辑。
const OUTLINE = 'rgba(10,20,24,0.9)'; // 深青柔边（非纯黑，避免发凶）
function hexToRgb(h) {
  h = h.replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const n = parseInt(h, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}
// amt>0 向白提亮，amt<0 压暗
function shade(hex, amt) {
  const { r, g, b } = hexToRgb(hex);
  const cl = (v) => Math.max(0, Math.min(255, Math.round(v)));
  if (amt >= 0) return `rgb(${cl(r + (255 - r) * amt)},${cl(g + (255 - g) * amt)},${cl(b + (255 - b) * amt)})`;
  const f = 1 + amt;
  return `rgb(${cl(r * f)},${cl(g * f)},${cl(b * f)})`;
}
// 柔和果冻体：深青柔边 + 径向渐变 + 顶部高光（squash 纵向压扁比例）
function softBlob(x, y, r, color, squash = 1) {
  ctx.fillStyle = OUTLINE;
  ctx.beginPath(); ctx.ellipse(x, y, r + 1.6, r * squash + 1.6, 0, 0, Math.PI * 2); ctx.fill();
  const g = ctx.createRadialGradient(x - r * 0.32, y - r * 0.4 * squash, Math.max(1, r * 0.15), x, y, r * 1.08);
  g.addColorStop(0, shade(color, 0.32));
  g.addColorStop(0.62, color);
  g.addColorStop(1, shade(color, -0.32));
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.ellipse(x, y, r, r * squash, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.14)';
  ctx.beginPath(); ctx.ellipse(x - r * 0.28, y - r * 0.42 * squash, r * 0.44, r * 0.26, -0.5, 0, Math.PI * 2); ctx.fill();
}
// 柔和发光眼：外圈低透明辉光 + 亮芯 + 高光点
function glowEyes(x, y, dx, r, color) {
  for (const sx of [-1, 1]) {
    const ex = x + sx * dx, ey = y;
    ctx.globalAlpha = 0.3;
    ctx.fillStyle = color;
    ctx.beginPath(); ctx.arc(ex, ey, r * 1.9, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 1;
    ctx.beginPath(); ctx.arc(ex, ey, r, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.beginPath(); ctx.arc(ex - r * 0.28, ey - r * 0.28, r * 0.42, 0, Math.PI * 2); ctx.fill();
  }
}

// 战场底（2026-11-05 按参考图重做）：中间一条砖石通道，两侧石墙，底部要塞门。
// 静态部分预渲染到离屏 canvas（2x 超采样防糊），每帧只 blit + 画动态的攻势提示线。
let bgCache = null;

function buildBackground() {
  const cv = document.createElement('canvas');
  cv.width = WORLD.W * 2; cv.height = WORLD.H * 2;
  const g = cv.getContext('2d');
  g.scale(2, 2);

  const WALL_W = 46;
  const laneX0 = WALL_W, laneX1 = WORLD.W - WALL_W;

  // 底色
  g.fillStyle = '#0c1018'; g.fillRect(0, 0, WORLD.W, WORLD.H);

  // ── 通道：暖棕砖石（低对比，别抢技能）──
  g.fillStyle = '#241d15'; g.fillRect(laneX0, 0, laneX1 - laneX0, WORLD.H);
  const BW = 23, BH = 12;
  for (let row = 0, y = -BH; y < WORLD.H + BH; row++, y += BH) {
    const off = row % 2 ? BW / 2 : 0;
    for (let x = laneX0 - BW; x < laneX1 + BW; x += BW) {
      const bx = x + off, by = y;
      // 砖块色差（确定性 hash，不引入随机）
      const h = Math.abs(Math.sin((bx * 12.9898 + by * 78.233))) % 1;
      const v = 0.9 + h * 0.22;
      g.fillStyle = `rgb(${Math.round(54 * v)},${Math.round(43 * v)},${Math.round(31 * v)})`;
      g.fillRect(bx + 0.5, by + 0.5, BW - 1, BH - 1);
      // 上沿一点受光
      g.fillStyle = 'rgba(255,220,170,0.045)';
      g.fillRect(bx + 0.5, by + 0.5, BW - 1, 1);
      // 下沿阴影
      g.fillStyle = 'rgba(0,0,0,0.32)';
      g.fillRect(bx + 0.5, by + BH - 2, BW - 1, 1.5);
    }
  }
  // 通道中央通气：远处更暗（纵深）
  const depth = g.createLinearGradient(0, 0, 0, WORLD.H);
  depth.addColorStop(0, 'rgba(4,7,12,0.72)');
  depth.addColorStop(0.5, 'rgba(4,7,12,0.22)');
  depth.addColorStop(1, 'rgba(0,0,0,0.45)');
  g.fillStyle = depth; g.fillRect(laneX0, 0, laneX1 - laneX0, WORLD.H);

  // ── 两侧石墙 ──
  for (const side of [0, 1]) {
    const x0 = side ? laneX1 : 0;
    g.fillStyle = '#191d26'; g.fillRect(x0, 0, WALL_W, WORLD.H);
    // 石块纹理
    for (let y = 0; y < WORLD.H; y += 30) {
      for (let i = 0; i < 2; i++) {
        const bw = WALL_W / 2 - 2;
        const bx = x0 + 2 + i * (WALL_W / 2);
        const v = 0.85 + (Math.abs(Math.sin(y * 0.7 + i * 3.1)) % 1) * 0.3;
        g.fillStyle = `rgb(${Math.round(30 * v)},${Math.round(35 * v)},${Math.round(45 * v)})`;
        g.fillRect(bx, y + 2, bw, 26);
      }
    }
    // 靠近通道的内沿亮线（受光）
    g.fillStyle = 'rgba(140,170,200,0.10)';
    g.fillRect(side ? laneX1 - 2 : laneX0, 0, 2, WORLD.H);
    // 外沿压暗
    g.fillStyle = 'rgba(0,0,0,0.45)';
    g.fillRect(side ? WORLD.W - 10 : 0, 0, 10, WORLD.H);
  }

  // 顶部渐隐（远处雾）
  const top = g.createLinearGradient(0, 0, 0, 150);
  top.addColorStop(0, 'rgba(5,8,14,0.85)');
  top.addColorStop(1, 'rgba(5,8,14,0)');
  g.fillStyle = top; g.fillRect(0, 0, WORLD.W, 150);

  return cv;
}

function drawBackground() {
  if (!bgCache) bgCache = buildBackground();
  ctx.drawImage(bgCache, 0, 0, WORLD.W, WORLD.H);

  // 动态：敌人推进到此线停住的警戒线（柔和红虚线）
  ctx.strokeStyle = 'rgba(255,120,120,0.20)'; ctx.setLineDash([7, 9]); ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(46, FORTRESS.attackLine); ctx.lineTo(WORLD.W - 46, FORTRESS.attackLine); ctx.stroke();
  ctx.setLineDash([]);
}

function drawFortress() {
  const p = world.player;
  const hurt = world.fortressFlash > 0;
  const wallTop = p.y + 16;
  // 要塞墙体（工业暖橙调，纵向渐变，软边）
  const wg = ctx.createLinearGradient(0, wallTop, 0, WORLD.H);
  wg.addColorStop(0, hurt ? '#7a3a3a' : '#37474f');
  wg.addColorStop(1, hurt ? '#482226' : '#1e2a30');
  ctx.fillStyle = wg; ctx.fillRect(0, wallTop, WORLD.W, WORLD.H - wallTop);
  // 顶部金属条（暖橙高光）
  ctx.fillStyle = hurt ? '#ff9a9a' : '#c8792f';
  ctx.fillRect(0, wallTop, WORLD.W, 4);
  ctx.fillStyle = 'rgba(255,255,255,0.10)';
  ctx.fillRect(0, wallTop + 4, WORLD.W, 3);
  // 墙面板缝
  ctx.strokeStyle = 'rgba(0,0,0,0.25)'; ctx.lineWidth = 1;
  for (let x = 40; x < WORLD.W; x += 60) { ctx.beginPath(); ctx.moveTo(x, wallTop + 6); ctx.lineTo(x, WORLD.H); ctx.stroke(); }

  // 青色能量护罩（半圆罩在炮手后方，半透明）
  const sg = ctx.createRadialGradient(p.x, p.y, 10, p.x, p.y, 68);
  sg.addColorStop(0, 'rgba(90,230,220,0.00)');
  sg.addColorStop(0.72, 'rgba(90,230,220,0.10)');
  sg.addColorStop(1, 'rgba(90,230,220,0.00)');
  ctx.fillStyle = sg;
  ctx.beginPath(); ctx.arc(p.x, p.y, 68, Math.PI, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = 'rgba(120,240,230,0.32)'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(p.x, p.y, 68, Math.PI * 1.06, Math.PI * 1.94); ctx.stroke();

  // 炮手底座（圆润机械台）
  ctx.fillStyle = '#26343c';
  ctx.beginPath(); ctx.ellipse(p.x, p.y + 10, 34, 16, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#37505c';
  ctx.beginPath(); ctx.ellipse(p.x, p.y + 6, 28, 12, 0, 0, Math.PI * 2); ctx.fill();

  // 炮手：果冻体 + 头盔 + 发光面罩
  softBlob(p.x, p.y - 2, 15, '#5b7486', 1.05);
  ctx.fillStyle = '#6f8a9c';
  ctx.beginPath(); ctx.arc(p.x, p.y - 12, 11, Math.PI, Math.PI * 2); ctx.fill();
  ctx.fillStyle = hurt ? '#ffb3b3' : '#8ff0ff';
  ctx.globalAlpha = 0.9;
  roundRect(p.x - 7, p.y - 14, 14, 5, 2.5); ctx.fill();
  ctx.globalAlpha = 1;

  // 主武器炮管（朝目标角度，软边）
  ctx.save();
  ctx.translate(p.x, p.y - 4); ctx.rotate(p.angle);
  ctx.fillStyle = OUTLINE;
  roundRect(-2, -6, 36, 12, 4); ctx.fill();
  ctx.fillStyle = '#8fa6b6';
  roundRect(0, -5, 32, 10, 3); ctx.fill();
  ctx.fillStyle = '#cfe3ff';
  roundRect(24, -2, 8, 4, 2); ctx.fill();
  ctx.restore();

  // 胸口能量核心
  ctx.fillStyle = 'rgba(120,240,230,0.25)';
  ctx.beginPath(); ctx.arc(p.x, p.y + 2, 9, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#aef6ef';
  ctx.beginPath(); ctx.arc(p.x, p.y + 2, 4, 0, Math.PI * 2); ctx.fill();

  // 自动瞄准连线（主武器由要塞自己打）
  const tgt = world.enemies.find((e) => e.id === p.targetId);
  if (tgt) {
    ctx.strokeStyle = 'rgba(255,220,120,0.20)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(p.x, p.y - 4); ctx.lineTo(tgt.x, tgt.y); ctx.stroke();
    ctx.strokeStyle = 'rgba(255,220,120,0.75)';
    ctx.beginPath(); ctx.arc(tgt.x, tgt.y, tgt.radius * ENEMY_VIS + 6, 0, Math.PI * 2); ctx.stroke();
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
// 2026-11-04 画风落地：蓝灰机械猫（猫耳 + 青色面罩 + 小爪 + 尾巴光点），对齐参考图
function drawPet() {
  const pet = petPos(world);
  const bob = Math.sin(world.time / 260) * 3;
  const x = pet.x, y = pet.y + bob;
  const flash = world.petFlash > 0;
  // 悬浮阴影
  ctx.fillStyle = 'rgba(0,0,0,0.30)';
  ctx.beginPath(); ctx.ellipse(pet.x, pet.y + 15, 13, 4, 0, 0, Math.PI * 2); ctx.fill();
  if (flash) {
    ctx.globalAlpha = Math.max(0, world.petFlash / 320) * 0.7;
    ctx.fillStyle = '#bffcff';
    ctx.beginPath(); ctx.arc(x, y, 22, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 1;
  }
  // 猫耳
  ctx.fillStyle = '#5f7488';
  for (const sx of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(x + sx * 7, y - 8);
    ctx.lineTo(x + sx * 3, y - 16);
    ctx.lineTo(x + sx * 11, y - 13);
    ctx.closePath(); ctx.fill();
  }
  // 机身（蓝灰圆润果冻体）
  softBlob(x, y, 11, flash ? '#cfeaff' : '#7f97a8', 0.95);
  // 面罩（青色发光底盘）
  ctx.fillStyle = 'rgba(120,240,230,0.22)';
  ctx.beginPath(); ctx.arc(x, y - 1, 9, 0, Math.PI * 2); ctx.fill();
  // 眼睛（朝向当前目标）
  const tgt = world.enemies.find((e) => e.id === world.player.targetId);
  let ex = 0, ey = 0;
  if (tgt) { const a = Math.atan2(tgt.y - y, tgt.x - x); ex = Math.cos(a) * 2.2; ey = Math.sin(a) * 2.2; }
  ctx.fillStyle = '#7ff0e6';
  ctx.beginPath(); ctx.arc(x - 4 + ex, y - 2 + ey, 2.2, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(x + 4 + ex, y - 2 + ey, 2.2, 0, Math.PI * 2); ctx.fill();
  // 小爪
  ctx.strokeStyle = '#5f7488'; ctx.lineWidth = 2; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(x - 9, y + 6); ctx.lineTo(x - 12, y + 10); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(x + 9, y + 6); ctx.lineTo(x + 12, y + 10); ctx.stroke();
  // 尾巴光点
  ctx.fillStyle = 'rgba(127,240,230,0.7)';
  ctx.beginPath(); ctx.arc(x + 13, y + 4, 2.2, 0, Math.PI * 2); ctx.fill();
}

// 敌人专属外形（2026-11-04 二版重做）：
// 一版被用户对照概念图指出"就是个带高光的球，完全不像僵尸"——
// 根因：造型全塞进碰撞半径 r 里，一个圆 + 高光点读不出结构。
// 二版改为真正的 Q 版造型：大头小身 + 发光眼/嘴 + 短手 + 破衣，各型加专属特征；
// 视觉尺寸按碰撞半径放大 ENEMY_VIS 倍（碰撞判定不变，仍用 e.radius）。
// 三版（2026-11-04）：用户二轮对照概念图仍判"完全不是一个东西"——补齐概念图的
// 五官与质感：大椭圆眼（外辉/虹膜/深瞳/高光）、张嘴小牙、斑驳皮肤、破布撕边+补丁、
// 带手的短臂、头身比再向大头倾斜，比例放大到 1.45。
const ENEMY_VIS = 1.45;

// 衣服：圆角矩形渐变 + 破布撕边下摆（4 片垂布三角）+ 补丁
function zombieBody(x, y, w, h, color) {
  ctx.fillStyle = OUTLINE;
  roundRect(x - w / 2 - 1.5, y - h / 2 - 1.5, w + 3, h + 3, w * 0.42); ctx.fill();
  const g = ctx.createLinearGradient(0, y - h / 2, 0, y + h / 2);
  g.addColorStop(0, shade(color, 0.14));
  g.addColorStop(1, shade(color, -0.28));
  ctx.fillStyle = g;
  roundRect(x - w / 2, y - h / 2, w, h, w * 0.42); ctx.fill();
  // 破布下摆：撕边垂布
  const hemY = y + h / 2;
  ctx.fillStyle = shade(color, -0.5);
  for (let i = 0; i < 4; i++) {
    const px = x - w / 2 + (w / 4) * i + w / 8;
    ctx.beginPath();
    ctx.moveTo(px - w / 9, hemY - 1);
    ctx.lineTo(px, hemY + h * 0.14);
    ctx.lineTo(px + w / 9, hemY - 1);
    ctx.closePath(); ctx.fill();
  }
  // 补丁（带缝线）
  ctx.fillStyle = shade(color, 0.32);
  roundRect(x - w * 0.34, y - h * 0.08, w * 0.3, h * 0.24, 2); ctx.fill();
  ctx.strokeStyle = 'rgba(10,18,14,0.5)'; ctx.lineWidth = 1;
  roundRect(x - w * 0.34, y - h * 0.08, w * 0.3, h * 0.24, 2); ctx.stroke();
}
// 短臂：向外斜垂 + 深色描边 + 手
function zombieArms(x, y, w, R, skin) {
  ctx.lineCap = 'round';
  for (const sx of [-1, 1]) {
    const ax = x + sx * (w / 2 - R * 0.04), ay = y - R * 0.18;
    const hx = x + sx * (w / 2 + R * 0.3), hy = y + R * 0.12;
    ctx.strokeStyle = OUTLINE; ctx.lineWidth = R * 0.16 + 2.4;
    ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(hx, hy); ctx.stroke();
    ctx.strokeStyle = skin; ctx.lineWidth = R * 0.16;
    ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(hx, hy); ctx.stroke();
    ctx.fillStyle = skin;
    ctx.beginPath(); ctx.arc(hx, hy, R * 0.12, 0, Math.PI * 2); ctx.fill();
  }
}
// 头：果冻体 + 斑驳暗斑（腐烂质感）
function zombieHead(x, headY, headR, skin) {
  softBlob(x, headY, headR, skin, 0.95);
  ctx.fillStyle = 'rgba(25,40,22,0.22)';
  ctx.beginPath(); ctx.arc(x - headR * 0.42, headY - headR * 0.34, headR * 0.2, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(x + headR * 0.46, headY - headR * 0.12, headR * 0.14, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(x + headR * 0.12, headY + headR * 0.62, headR * 0.16, 0, Math.PI * 2); ctx.fill();
}
// 脸：大椭圆眼（外辉/虹膜/深瞳/高光）+ 张嘴小牙（twin=true 左右两张脸）
function zombieFace(x, headY, headR, eyeColor, twin = false) {
  const er = headR * 0.24, ey = headY + headR * 0.08;
  const drawEye = (ex) => {
    ctx.globalAlpha = 0.3; ctx.fillStyle = eyeColor;
    ctx.beginPath(); ctx.arc(ex, ey, er * 1.8, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 1;
    ctx.fillStyle = 'rgba(18,26,22,0.9)';
    ctx.beginPath(); ctx.ellipse(ex, ey, er * 1.18, er * 1.3, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = eyeColor;
    ctx.beginPath(); ctx.ellipse(ex, ey, er, er * 1.1, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#0c1512';
    ctx.beginPath(); ctx.ellipse(ex, ey + er * 0.12, er * 0.45, er * 0.55, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.95)';
    ctx.beginPath(); ctx.arc(ex - er * 0.34, ey - er * 0.4, er * 0.28, 0, Math.PI * 2); ctx.fill();
  };
  if (twin) { drawEye(x - headR * 0.52); drawEye(x + headR * 0.52); }
  else { drawEye(x - headR * 0.4); drawEye(x + headR * 0.4); }
  // 张开的小嘴 + 两颗小牙
  const my = headY + headR * 0.52;
  ctx.fillStyle = 'rgba(22,16,18,0.85)';
  ctx.beginPath(); ctx.ellipse(x, my, headR * 0.28, headR * 0.16, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#ded8c2';
  ctx.fillRect(x - headR * 0.13, my - headR * 0.13, headR * 0.09, headR * 0.09);
  ctx.fillRect(x + headR * 0.04, my - headR * 0.13, headR * 0.09, headR * 0.09);
}

function drawEnemyBody(e, x, y, r) {
  const R = r * ENEMY_VIS;
  const skin = e.color;
  const cloth = shade(skin, -0.45);
  switch (e.type) {
    case 'armored': { // 装甲尸车（对齐参考「双头僵尸」）：宽车体 + 装甲横带铆钉 + 双头
      const bw = R * 1.66, bh = R * 1.12, by = y + R * 0.42;
      zombieBody(x, by, bw, bh, skin);
      zombieArms(x, by, bw * 0.92, R * 0.95, skin);
      ctx.fillStyle = shade(skin, 0.3);
      roundRect(x - bw * 0.4, by - bh * 0.16, bw * 0.8, bh * 0.3, 3); ctx.fill();
      ctx.strokeStyle = OUTLINE; ctx.lineWidth = 1.2;
      roundRect(x - bw * 0.4, by - bh * 0.16, bw * 0.8, bh * 0.3, 3); ctx.stroke();
      ctx.fillStyle = shade(skin, -0.35);
      for (const sx of [-1, 0, 1]) { ctx.beginPath(); ctx.arc(x + sx * bw * 0.26, by, 2.2, 0, Math.PI * 2); ctx.fill(); }
      for (const sx of [-1, 1]) {
        const hx = x + sx * R * 0.48, hy = y - R * 0.72, hr = R * 0.42;
        zombieHead(hx, hy, hr, skin);
        zombieFace(hx, hy, hr, '#8ff0ff');
      }
      return;
    }
    case 'ranged': { // 远程尸（对齐参考「篮球僵尸」）：站姿 + 双手怀里抱发光球
      const hr = R * 0.62, hy = y - R * 0.58;
      zombieBody(x, y + R * 0.5, R * 0.74, R * 0.9, cloth);
      zombieArms(x, y + R * 0.5, R * 0.74, R * 0.95, skin);
      ctx.fillStyle = 'rgba(90,209,255,0.32)';
      ctx.beginPath(); ctx.arc(x, y + R * 0.18, R * 0.26, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#7fe6ff';
      ctx.beginPath(); ctx.arc(x, y + R * 0.18, R * 0.15, 0, Math.PI * 2); ctx.fill();
      zombieHead(x, hy, hr, skin);
      zombieFace(x, hy, hr, '#d9ccff');
      return;
    }
    case 'bomber': { // 自爆尸：圆肚 + 胸前炸弹桶（临线脉动核心 = 危险信号）
      const hr = R * 0.6, hy = y - R * 0.58;
      ctx.fillStyle = OUTLINE;
      ctx.beginPath(); ctx.arc(x, y + R * 0.42, R * 0.62 + 1.5, 0, Math.PI * 2); ctx.fill();
      const bg = ctx.createRadialGradient(x - R * 0.2, y + R * 0.26, R * 0.1, x, y + R * 0.42, R * 0.66);
      bg.addColorStop(0, shade(skin, 0.2)); bg.addColorStop(1, shade(skin, -0.3));
      ctx.fillStyle = bg;
      ctx.beginPath(); ctx.arc(x, y + R * 0.42, R * 0.62, 0, Math.PI * 2); ctx.fill();
      const prox = Math.max(0, Math.min(1, (y - 360) / (FORTRESS.attackLine - 360)));
      ctx.fillStyle = '#3a2b28';
      roundRect(x - R * 0.22, y + R * 0.04, R * 0.44, R * 0.4, R * 0.12); ctx.fill();
      ctx.fillStyle = `rgba(255,232,120,${0.45 + prox * 0.5})`;
      ctx.beginPath(); ctx.arc(x, y + R * 0.24, R * 0.13, 0, Math.PI * 2); ctx.fill();
      zombieHead(x, hy, hr, skin);
      zombieFace(x, hy, hr, '#ffd27e');
      return;
    }
    case 'flyer': { // 飞行尸：半透明软翼 + 悬浮小身（无腿）
      ctx.fillStyle = 'rgba(143,208,232,0.5)';
      ctx.beginPath(); ctx.ellipse(x - R * 0.72, y + R * 0.08, R * 0.46, R * 0.22, 0.5, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.ellipse(x + R * 0.72, y + R * 0.08, R * 0.46, R * 0.22, -0.5, 0, Math.PI * 2); ctx.fill();
      const hr = R * 0.6, hy = y - R * 0.38;
      zombieBody(x, y + R * 0.4, R * 0.62, R * 0.68, shade(skin, -0.2));
      zombieArms(x, y + R * 0.4, R * 0.62, R * 0.85, skin);
      zombieHead(x, hy, hr, skin);
      zombieFace(x, hy, hr, '#cfeeff');
      return;
    }
    case 'splitter': { // 分裂尸：双脸 + 头身中缝（提示会裂）
      const hr = R * 0.66, hy = y - R * 0.58;
      zombieBody(x, y + R * 0.52, R * 0.84, R * 0.92, cloth);
      zombieArms(x, y + R * 0.52, R * 0.84, R, skin);
      zombieHead(x, hy, hr, skin);
      ctx.strokeStyle = 'rgba(35,55,20,0.7)'; ctx.lineWidth = Math.max(1.5, R * 0.06); ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(x, hy - hr); ctx.lineTo(x, y + R * 0.98); ctx.stroke();
      zombieFace(x, hy, hr, '#cfee8a', true);
      return;
    }
    case 'swarm': { // 蜂群：极小金团（数量即血条，画不出造型）
      ctx.fillStyle = 'rgba(201,168,58,0.3)';
      ctx.beginPath(); ctx.arc(x, y, r * 2, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = skin;
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      ctx.beginPath(); ctx.arc(x - r * 0.3, y - r * 0.3, r * 0.4, 0, Math.PI * 2); ctx.fill();
      return;
    }
    case 'runner': { // 疾行尸（对齐参考「迅捷鬣狗」）：瘦削 + 身后速度线
      const hr = R * 0.55, hy = y - R * 0.5;
      zombieBody(x, y + R * 0.42, R * 0.6, R * 0.8, cloth);
      zombieArms(x, y + R * 0.42, R * 0.6, R * 0.85, skin);
      ctx.strokeStyle = 'rgba(255,255,255,0.5)'; ctx.lineWidth = 2; ctx.lineCap = 'round';
      for (let i = 0; i < 2; i++) {
        const cy = y - R * (1.0 + i * 0.28);
        ctx.beginPath();
        ctx.moveTo(x - R * 0.3, cy - 4); ctx.lineTo(x - R * 0.62, cy); ctx.lineTo(x - R * 0.3, cy + 4);
        ctx.stroke();
      }
      zombieHead(x, hy, hr, skin);
      zombieFace(x, hy, hr, '#ffe896');
      return;
    }
    default: { // 普通僵尸：青绿大头 + 带手短臂 + 破布衣
      const hr = R * 0.68, hy = y - R * 0.58;
      zombieBody(x, y + R * 0.52, R * 0.8, R * 0.92, cloth);
      zombieArms(x, y + R * 0.52, R * 0.8, R, skin);
      zombieHead(x, hy, hr, skin);
      zombieFace(x, hy, hr, '#6fe8d0');
      return;
    }
  }
}

function drawEnemies() {
  for (const e of world.enemies) {
    const x = e.x, y = e.y, r = e.radius;
    const R = r * ENEMY_VIS; // 视觉基准（造型/血条/状态环都按视觉尺寸走）
    if (e.attacking) {
      if (e.attackFlash > 0) {
        const a = Math.max(0, e.attackFlash / 220);
        ctx.globalAlpha = a;
        ctx.strokeStyle = '#ff6b6b'; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.moveTo(x - R * 0.7, y + R * 0.9); ctx.lineTo(x, y + R * 1.5); ctx.lineTo(x + R * 0.7, y + R * 0.9); ctx.stroke();
        ctx.globalAlpha = 1;
      }
      ctx.strokeStyle = 'rgba(255,107,107,0.75)'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(x, y, R + 4, 0, Math.PI * 2); ctx.stroke();
    }
    // 史莱姆精灵（概念图直接跑）；渲染失败才退回几何占位
    if (!enemySprites.draw(ctx, e, lastDt / 1000)) drawEnemyBody(e, x, y, r);
    const stCol = has(e.st, 'freeze') ? '#5ad1ff' : has(e.st, 'stun') ? '#c77dff' : has(e.st, 'burn') ? '#ff7a3c' : null;
    if (stCol) {
      ctx.globalAlpha = 0.22; ctx.fillStyle = stCol;
      ctx.beginPath(); ctx.arc(x, y, R + 7, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 1;
      ctx.strokeStyle = stCol; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(x, y, R + 3, 0, Math.PI * 2); ctx.stroke();
    }
    // 血条（圆角柔边，头顶上方）
    const bw = Math.max(14, R * 1.5), by = y - R * 1.45 - 6;
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    roundRect(x - bw / 2, by, bw, 4, 2); ctx.fill();
    ctx.fillStyle = e.hp / e.maxHp > 0.35 ? '#8fe08f' : '#ff7a7a';
    roundRect(x - bw / 2, by, Math.max(0, bw * (e.hp / e.maxHp)), 4, 2); ctx.fill();
    drawStatusIcons(e, x - r, by - 10);
  }
  enemySprites.reap(world.enemies);
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

function drawEnemyShots() {
  // 远程尸喷吐的弹丸（打要塞）：暗紫发光小球，与玩家子弹橙黄区分
  for (const s of world.enemyShots) {
    if (s.dead) continue;
    ctx.fillStyle = 'rgba(157,142,196,0.28)';
    ctx.beginPath(); ctx.arc(s.x, s.y, s.radius + 4, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#b9a8e0';
    ctx.beginPath(); ctx.arc(s.x, s.y, s.radius, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.beginPath(); ctx.arc(s.x - s.radius * 0.3, s.y - s.radius * 0.3, s.radius * 0.4, 0, Math.PI * 2); ctx.fill();
  }
}

// ── 五技能渲染（2026-11-03 补齐）──
function drawBeams() {
  for (const b of world.beams) {
    const a = Math.max(0, b.life / b.maxLife);
    const ex = b.x + Math.cos(b.ang) * b.len, ey = b.y + Math.sin(b.ang) * b.len;
    ctx.globalAlpha = 0.22 * a; ctx.strokeStyle = b.color; ctx.lineWidth = b.halfWidth * 2;
    ctx.beginPath(); ctx.moveTo(b.x, b.y); ctx.lineTo(ex, ey); ctx.stroke();
    ctx.globalAlpha = 0.9 * a; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(b.x, b.y); ctx.lineTo(ex, ey); ctx.stroke();
    ctx.globalAlpha = 1;
  }
}
function drawSweeps() {
  for (const s of world.sweeps) {
    const a = Math.max(0, s.life / s.maxLife);
    const ang = s.ang0 + Math.sin((s.t / 1000) * Math.PI * 1.1) * s.sweepAmp;
    ctx.globalAlpha = 0.16 * a; ctx.fillStyle = s.color;
    ctx.beginPath(); ctx.moveTo(s.x, s.y);
    ctx.arc(s.x, s.y, s.range, ang - s.halfAngle, ang + s.halfAngle); ctx.closePath(); ctx.fill();
    ctx.globalAlpha = 0.85 * a; ctx.strokeStyle = s.color; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(s.x, s.y);
    ctx.lineTo(s.x + Math.cos(ang) * s.range, s.y + Math.sin(ang) * s.range); ctx.stroke();
    ctx.globalAlpha = 1;
  }
}
function drawTurrets() {
  for (const s of world.turretShots) {
    ctx.globalAlpha = Math.max(0, s.life / 120);
    ctx.strokeStyle = '#cfe3ff'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(s.x, s.y); ctx.lineTo(s.tx, s.ty); ctx.stroke();
    ctx.globalAlpha = 1;
  }
  for (const t of world.turrets) {
    const a = Math.min(1, t.life / 800);
    ctx.globalAlpha = 0.06 * a; ctx.strokeStyle = t.color; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(t.x, t.y, t.range, 0, Math.PI * 2); ctx.stroke();
    ctx.globalAlpha = a;
    ctx.fillStyle = '#1a2233'; ctx.beginPath(); ctx.arc(t.x, t.y, t.r, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = t.color; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(t.x, t.y, t.r, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = t.color; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(t.x, t.y); ctx.lineTo(t.x, t.y - t.r - 7); ctx.stroke();
    ctx.globalAlpha = 1;
  }
}
// ── 燃烧地带（2026-11-05 试点：改走 pixelfx 渲染路径）────────────────────────
// 不再在 demo 里手绘：火场由 src/concept/flame-field.mjs 画，和概念图是同一份代码。
// 这里只负责「调用 + 贴到世界坐标」。以前那套 Canvas2D 手绘已删除，
// 想回看请查 git 历史（commit b63dcc9）。
function drawFlames() {
  for (const f of world.flames) flameSprites.draw(ctx, f, lastDt / 1000);
  flameSprites.reap(world.flames);
}

function drawSaws() {
  for (const s of world.saws) {
    ctx.save(); ctx.translate(s.x, s.y); ctx.rotate(s.spin / 80);
    ctx.fillStyle = 'rgba(207,216,227,0.20)';
    ctx.beginPath(); ctx.arc(0, 0, s.r + 2, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = s.color; ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.arc(0, 0, s.r, 0, Math.PI * 2); ctx.stroke();
    for (let i = 0; i < 8; i++) {
      const a = (Math.PI * 2 * i) / 8;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * s.r * 0.4, Math.sin(a) * s.r * 0.4);
      ctx.lineTo(Math.cos(a) * s.r, Math.sin(a) * s.r);
      ctx.stroke();
    }
    ctx.restore();
  }
}

function drawBullets() {
  // 子弹属性卡的可视化（06 册 §3.2.1）：带火 → 橙红，带爆炸 → 外圈黄环，子子弹 → 小颗偏黄白
  const fire = world.mods.bulletFire, boom = world.mods.bulletExplode;
  for (const b of world.bullets) {
    if (b.isSub) {
      ctx.fillStyle = 'rgba(255,207,92,0.30)';
      ctx.beginPath(); ctx.arc(b.x, b.y, b.radius + 2, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#ffe9b0';
      ctx.beginPath(); ctx.arc(b.x, b.y, b.radius, 0, Math.PI * 2); ctx.fill();
      continue;
    }
    ctx.fillStyle = fire ? 'rgba(255,110,60,0.38)' : 'rgba(255,224,138,0.4)';
    ctx.beginPath(); ctx.arc(b.x, b.y, b.radius + 3, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = fire ? '#ff7a3c' : '#ffe08a';
    ctx.beginPath(); ctx.arc(b.x, b.y, b.radius, 0, Math.PI * 2); ctx.fill();
    if (boom) {
      ctx.strokeStyle = 'rgba(255,200,80,0.85)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(b.x, b.y, b.radius + 1.5, 0, Math.PI * 2); ctx.stroke();
    }
  }
}

function drawVehicles() {
  for (const v of world.vehicles) {
    if (v.ramp > 0) continue; // 还没进场
    const a = Math.min(1, v.life / 400);
    // 判定框 = 模型尺寸（重型车物理一致地一起放大）
    const w = v.w, h = v.h;
    const x = v.x - w / 2, y = v.y - h / 2;
    ctx.globalAlpha = 0.14 * a;
    ctx.fillStyle = v.color;
    roundRect(x, y, w, h, 6); ctx.fill();
    // 碾压判定描边（判定 = 模型，物理一致）
    ctx.globalAlpha = 0.55 * a;
    ctx.strokeStyle = '#e9c46a'; ctx.lineWidth = 1.2;
    roundRect(x, y, w, h, 6); ctx.stroke();
    // 尾尘（车后拖一条扬尘）
    ctx.globalAlpha = 0.22 * a;
    ctx.fillStyle = '#c9c2a8';
    ctx.beginPath(); ctx.ellipse(v.x, v.y + h * 0.55, w * 0.45, h * 0.28, 0, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = a;
    // 履带（左右两条深色带 + 分段）
    ctx.fillStyle = '#2f3a28';
    ctx.fillRect(x - 3, y + 4, 5, h - 8);
    ctx.fillRect(x + w - 2, y + 4, 5, h - 8);
    ctx.fillStyle = '#4a5a3c';
    for (let i = 0; i < 5; i++) {
      const ty = y + 6 + i * ((h - 12) / 5);
      ctx.fillRect(x - 3, ty, 5, 3);
      ctx.fillRect(x + w - 2, ty, 5, 3);
    }
    // 车体
    ctx.fillStyle = v.color;
    roundRect(x, y, w, h, 6); ctx.fill();
    // 车体高光/阴影，做出立体感
    ctx.fillStyle = 'rgba(255,255,255,0.14)';
    roundRect(x + 3, y + 3, w - 6, h * 0.32, 4); ctx.fill();
    ctx.fillStyle = 'rgba(0,0,0,0.22)';
    roundRect(x + 3, y + h * 0.66, w - 6, h * 0.3, 4); ctx.fill();
    // 炮管（朝上，指向行进方向）
    ctx.fillStyle = '#3d4a33';
    ctx.fillRect(v.x - 3, y - 12, 6, 14);
    // 车头撞角（亮黄警示条）
    ctx.fillStyle = '#e9c46a';
    ctx.fillRect(x + 2, y + 1, w - 4, 3);
  }
  ctx.globalAlpha = 1;
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
      const len = 20;
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

// 电磁天雷：从屏幕顶落下的锯齿闪电柱 + 落点电光圈（280ms 渐隐）
// 雷雨区（20 级「雷暴」）：半透明区域底色 + 呼吸虚线圈 + 区内雨丝
function drawStorms() {
  for (const s of world.storms) {
    const a = Math.max(0, s.life / s.maxLife);
    const t = world.time / 1000;
    // 区域底色
    ctx.globalAlpha = 0.10 * a;
    ctx.fillStyle = s.color;
    ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2); ctx.fill();
    // 呼吸虚线圈（提示"这里在下雷雨"）
    const pulse = 0.5 + 0.5 * Math.sin(t * 8);
    ctx.globalAlpha = (0.28 + 0.22 * pulse) * a;
    ctx.strokeStyle = s.color; ctx.lineWidth = 2;
    ctx.setLineDash([6, 8]);
    ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2); ctx.stroke();
    ctx.setLineDash([]);
    // 雨丝：18 列，按时间向下滚，裁剪在圆内
    ctx.globalAlpha = 0.32 * a;
    ctx.strokeStyle = s.color; ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 0; i < 18; i++) {
      const dx = (((i * 73) % 100) / 100 * 2 - 1) * s.r;
      const half = Math.sqrt(Math.max(0, s.r * s.r - dx * dx));
      if (half <= 2) continue;
      const phase = ((i * 37) % 100) / 100;
      const py = s.y - half + ((phase + t * 1.7) % 1) * half * 2;
      const px = s.x + dx;
      ctx.moveTo(px, py);
      ctx.lineTo(px - 1.5, py + 9);
    }
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

function drawArcs() {
  for (const a of world.arcs) {
    const al = Math.max(0, a.life / a.maxLife);
    // 外层辉光
    ctx.globalAlpha = al * 0.35;
    ctx.strokeStyle = a.color; ctx.lineWidth = 6; ctx.lineJoin = 'round';
    ctx.beginPath();
    for (let i = 0; i < a.pts.length; i++) { const p = a.pts[i]; if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y); }
    ctx.stroke();
    // 内芯
    ctx.globalAlpha = al * 0.9;
    ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 2;
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

function drawStrikes() {
  for (const s of world.strikes) {
    const a = Math.max(0, s.life / s.maxLife);
    const w = s.minor ? 5 : 9; // 雷雨区的次级落雷画细一点，不与主闪电抢视线
    // 外层辉光（粗、半透明黄）
    ctx.globalAlpha = a * 0.35;
    ctx.strokeStyle = s.color; ctx.lineWidth = w; ctx.lineJoin = 'round';
    ctx.beginPath();
    for (let i = 0; i < s.bolt.length; i++) {
      const p = s.bolt[i];
      if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y);
    }
    ctx.stroke();
    // 内芯（细、白亮）
    ctx.globalAlpha = a * 0.95;
    ctx.strokeStyle = '#ffffff'; ctx.lineWidth = s.minor ? 2 : 3;
    ctx.stroke();
    // 落点电光：填充渐隐圆 + 冲击亮斑
    ctx.globalAlpha = a * 0.22;
    ctx.fillStyle = s.color;
    ctx.beginPath(); ctx.arc(s.x, s.y, s.radius, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = a * 0.9;
    ctx.beginPath(); ctx.arc(s.x, s.y, s.minor ? 5 : 8, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 1;
  }
}

// 以下三个函数保留原名与调用点，实现换成柔和卡通版重绘（读 world 状态、纯函数、帧率无关）。
// 编排对齐 pixelfx：白热 hero frame → 扩散/弹出 → 冷却/挤压 → 余晖消散，快起慢收。
function drawParticles() { drawSoftParticles(ctx, world.particles); }
function drawRings() { drawSoftRings(ctx, world.rings); }
function drawFloaters() { drawSoftFloaters(ctx, world.floaters); }

function drawHUD() {
  // 顶部信息条
  ctx.fillStyle = 'rgba(8,12,24,0.6)'; ctx.fillRect(0, 0, WORLD.W, 34);
  ctx.fillStyle = '#e7eefc'; ctx.font = 'bold 14px sans-serif'; ctx.textAlign = 'left';
  ctx.fillText(`分数 ${world.score}`, 12, 22);
  // 定制模式测试开关状态（F/G）
  if (world.customMode && world.started) {
    ctx.font = 'bold 11px sans-serif';
    ctx.fillStyle = world.cheats.noFire ? '#ff9a3c' : 'rgba(160,190,230,0.75)';
    ctx.fillText(`主武器${world.cheats.noFire ? '关' : '开'}(F)`, 110, 22);
    ctx.fillStyle = world.cheats.godFortress ? '#7fe07f' : 'rgba(160,190,230,0.75)';
    ctx.fillText(`要塞无敌${world.cheats.godFortress ? '开' : '关'}(G)`, 178, 22);
  }
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

  // 定制模式常驻提示（左下，避开右侧武器/技能槽与底部血条）
  if (world.customMode) {
    ctx.textAlign = 'left'; ctx.font = 'bold 10px sans-serif';
    ctx.fillStyle = world.panelOpen ? '#7fe0ff' : 'rgba(127,224,255,0.7)';
    ctx.fillText('定制模式 · 按 C 自选海克斯', 12, WORLD.H - 26);
  }
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

// 技能槽：圆形竖排在武器卡下方，共 4 个；未学的画空占位框（参考原图的暗色空圆）
function drawSkillSlots() {
  for (const c of skillSlots()) {
    if (!c.learned) {
      // 空占位框：暗底 + 虚线描边，无文字无角标
      ctx.fillStyle = 'rgba(14,20,36,0.75)';
      ctx.beginPath(); ctx.arc(c.cx, c.cy, c.r, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = 'rgba(90,110,150,0.55)'; ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 4]);
      ctx.beginPath(); ctx.arc(c.cx, c.cy, c.r, 0, Math.PI * 2); ctx.stroke();
      ctx.setLineDash([]);
      continue;
    }
    const sk = SKILLS[c.id];
    const slot = world.skills[c.id];
    ctx.fillStyle = 'rgba(18,26,44,0.92)';
    ctx.beginPath(); ctx.arc(c.cx, c.cy, c.r, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = sk.color; ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.arc(c.cx, c.cy, c.r, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = sk.color; ctx.font = 'bold 16px sans-serif'; ctx.textAlign = 'center';
    ctx.fillText(sk.name[0], c.cx, c.cy + 6);
    // 冷却遮罩（自顶向下扫过）+ 剩余秒数（冷却卡"看得见"的关键）
    const full = sk.cooldownMs * world.mods.skillCdMul[c.id];
    if (slot.cd > 0) {
      const frac = Math.min(1, slot.cd / full);
      ctx.fillStyle = 'rgba(0,0,0,0.62)';
      ctx.beginPath();
      ctx.moveTo(c.cx, c.cy);
      ctx.arc(c.cx, c.cy, c.r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * frac);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#eaf2ff'; ctx.font = 'bold 9px sans-serif'; ctx.textAlign = 'center';
      ctx.fillText((slot.cd / 1000).toFixed(1), c.cx, c.cy + 18);
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
  ctx.fillText('选择海克斯强化', WORLD.W / 2, 274);

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
  ctx.fillText('技能由右侧宠物机器人自动释放 · 升级三选一 = 海克斯', WORLD.W / 2, WORLD.H / 2 + 26);
  ctx.fillText(`共 ${RUN.maxWave} 波 · 20 级 · 第 ${RUN.maxWave} 波收尾`, WORLD.W / 2, WORLD.H / 2 + 50);
  // 两种模式（2026-11-02 用户要求）：正常 / 定制（自选海克斯，用于测 build）
  const b1 = startButtons();
  for (const b of b1) {
    const on = (b.mode === 'custom') === !!selectCustom;
    ctx.fillStyle = on ? 'rgba(90,169,255,0.22)' : 'rgba(255,255,255,0.06)';
    roundRect(b.x, b.y, b.w, b.h, 8); ctx.fill();
    ctx.strokeStyle = on ? '#5aa9ff' : 'rgba(160,190,240,0.35)';
    ctx.lineWidth = on ? 2 : 1;
    roundRect(b.x, b.y, b.w, b.h, 8); ctx.stroke();
    ctx.fillStyle = on ? '#cfe3ff' : '#aeb9d0';
    ctx.font = 'bold 15px sans-serif'; ctx.textAlign = 'center';
    ctx.fillText(b.label, b.x + b.w / 2, b.y + 22);
    ctx.font = '10px sans-serif'; ctx.fillStyle = 'rgba(174,185,208,0.8)';
    ctx.fillText(b.sub, b.x + b.w / 2, b.y + 38);
  }
  ctx.fillStyle = '#7fe0ff'; ctx.font = 'bold 14px sans-serif'; ctx.textAlign = 'center';
  ctx.fillText(selectCustom ? '点击「定制模式」开始 → 游戏中按 C 自选海克斯' : '点击「标准模式」开始', WORLD.W / 2, WORLD.H / 2 + 150);
}

// 开始界面的两个模式按钮
function startButtons() {
  const w = 176, h = 50, gap = 14;
  const y = WORLD.H / 2 + 66;
  return [
    { mode: 'normal', label: '标准模式', sub: '正常三选一 · 靠抽卡', x: WORLD.W / 2 - w - gap / 2, y, w, h },
    { mode: 'custom', label: '定制模式', sub: '自选海克斯 · 测 build', x: WORLD.W / 2 + gap / 2, y, w, h },
  ];
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
  ctx.fillStyle = 'rgba(160,190,240,0.7)'; ctx.font = '11px sans-serif';
  ctx.fillText(world.customMode ? '当前：定制模式（重开仍是定制）' : '当前：标准模式', WORLD.W / 2, WORLD.H / 2 + 74);
}

// ── 定制模式：卡池面板（自选海克斯，2026-11-02 用户要求）──
// 存在的意义：正常模式只能靠随机三选一，想验证"分裂+爆炸"或"某个技能专精"到底怎样，
// 得一局一局碰运气。这里给出面即用的自选面板，面板打开时战斗暂停，关掉继续。
const PANEL = { x: 14, y: 44, w: WORLD.W - 28, h: 700 };
const PANEL_TABS = [
  { id: 'learn', label: '学习' },
  { id: 'weapon', label: '武器' },
  { id: 'skill', label: '技能' },
  { id: 'bonus', label: '加成' },
];

// 技能页再按技能分子页（2026-11-03 用户要求：一堆技能卡混在一起不好找）
const PANEL_SUBS = [
  { id: 'freeze', label: '干冰' },
  { id: 'burn', label: '温压' },
  { id: 'shock', label: '电磁' },
  { id: 'vehicle', label: '装甲' },
  { id: 'ray', label: '高能' },
  { id: 'laser', label: '制导' },
  { id: 'turret', label: '哨戒' },
  { id: 'flame', label: '燃烧' },
  { id: 'saw', label: '刀轮' },
];

function panelList() {
  if (panelTab === 'learn') return LEARN_CARDS;
  if (panelTab === 'skill') return CARDS.filter((c) => c.kind === 'skill' && c.target === panelSub);
  return CARDS.filter((c) => c.kind === panelTab);
}

function panelSubRects() {
  const w = (PANEL.w - 24) / PANEL_SUBS.length - 6;
  return PANEL_SUBS.map((t, i) => ({
    sub: t, x: PANEL.x + 12 + i * (w + 6), y: PANEL.y + 78, w, h: 24,
  }));
}

function panelTabRects() {
  const w = (PANEL.w - 24) / PANEL_TABS.length - 6;
  return PANEL_TABS.map((t, i) => ({
    tab: t, x: PANEL.x + 12 + i * (w + 6), y: PANEL.y + 46, w, h: 26,
  }));
}

function panelCardRects() {
  const list = panelList();
  const cw = (PANEL.w - 24 - 8) / 2, ch = 46, gy = 6;
  const y0 = PANEL.y + (panelTab === 'skill' ? 114 : 84); // 技能页多一行子 tab
  return list.map((c, i) => ({
    card: c,
    x: PANEL.x + 12 + (i % 2) * (cw + 8),
    y: y0 + Math.floor(i / 2) * (ch + gy),
    w: cw, h: ch,
  }));
}

function handlePanelClick(p) {
  for (const t of panelTabRects()) if (insideRect(t, p)) { panelTab = t.tab.id; return; }
  if (panelTab === 'skill') {
    for (const t of panelSubRects()) if (insideRect(t, p)) { panelSub = t.sub.id; return; }
  }
  for (const r of panelCardRects()) {
    if (!insideRect(r, p)) continue;
    takeCard(world, r.card);
    return;
  }
}

// 按实测宽度截断（中文按字数截断会溢出卡片，必须量宽度）
function fitText(text, maxW) {
  if (ctx.measureText(text).width <= maxW) return text;
  let s = text;
  while (s.length > 1 && ctx.measureText(s + '…').width > maxW) s = s.slice(0, -1);
  return s + '…';
}

function drawCardPanel() {
  ctx.fillStyle = 'rgba(3,6,14,0.86)'; ctx.fillRect(0, 0, WORLD.W, WORLD.H);
  ctx.fillStyle = '#101a2e';
  ctx.strokeStyle = 'rgba(120,170,255,0.35)'; ctx.lineWidth = 1;
  roundRect(PANEL.x, PANEL.y, PANEL.w, PANEL.h, 12); ctx.fill(); ctx.stroke();

  ctx.textAlign = 'left';
  ctx.fillStyle = '#eaf2ff'; ctx.font = 'bold 15px sans-serif';
  ctx.fillText('定制模式 · 自选海克斯', PANEL.x + 12, PANEL.y + 24);
  ctx.fillStyle = 'rgba(160,190,240,0.75)'; ctx.font = '10px sans-serif';
  ctx.fillText('点卡片立即获得 · C 关闭（战斗已暂停）', PANEL.x + 12, PANEL.y + 38);

  for (const t of panelTabRects()) {
    const on = t.tab.id === panelTab;
    ctx.fillStyle = on ? 'rgba(90,169,255,0.25)' : 'rgba(255,255,255,0.05)';
    roundRect(t.x, t.y, t.w, t.h, 6); ctx.fill();
    ctx.fillStyle = on ? '#cfe3ff' : '#8b97ad';
    ctx.font = on ? 'bold 12px sans-serif' : '12px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(t.tab.label, t.x + t.w / 2, t.y + 17);
  }

  if (panelTab === 'skill') {
    for (const t of panelSubRects()) {
      const on = t.sub.id === panelSub;
      ctx.fillStyle = on ? 'rgba(127,224,255,0.18)' : 'rgba(255,255,255,0.04)';
      roundRect(t.x, t.y, t.w, t.h, 5); ctx.fill();
      ctx.fillStyle = on ? '#7fe0ff' : '#7b879e';
      ctx.font = on ? 'bold 11px sans-serif' : '11px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(t.sub.label, t.x + t.w / 2, t.y + 16);
      // 每页张数（方便判断还有多少没拿）
      const n = CARDS.filter((c) => c.kind === 'skill' && c.target === t.sub.id).length;
      ctx.textAlign = 'right';
      ctx.font = '8px sans-serif';
      ctx.fillStyle = 'rgba(150,175,210,0.55)';
      ctx.fillText(String(n), t.x + t.w - 4, t.y + 16);
    }
  }
  for (const r of panelCardRects()) {
    const c = r.card;
    const stacks = world.cardStacks[c.id] || 0;
    const learned = c.kind === 'learn' && !!world.skills[c.target];
    const maxed = learned || (c.once && stacks >= 1) || (c.maxStacks && stacks >= c.maxStacks);
    ctx.fillStyle = maxed ? 'rgba(255,255,255,0.04)'
      : (c.kind === 'skill' ? 'rgba(90,169,255,0.10)' : 'rgba(255,255,255,0.07)');
    roundRect(r.x, r.y, r.w, r.h, 6); ctx.fill();
    ctx.strokeStyle = maxed ? 'rgba(120,140,170,0.22)' : 'rgba(140,180,240,0.30)';
    ctx.lineWidth = 1; roundRect(r.x, r.y, r.w, r.h, 6); ctx.stroke();

    ctx.textAlign = 'left';
    ctx.fillStyle = maxed ? 'rgba(190,200,215,0.45)' : '#e7eefc';
    ctx.font = 'bold 11px sans-serif';
    ctx.fillText(fitText(c.name, r.w - 42), r.x + 7, r.y + 15);
    ctx.fillStyle = maxed ? 'rgba(170,180,200,0.35)' : 'rgba(180,200,230,0.78)';
    ctx.font = '9px sans-serif';
    ctx.fillText(fitText(c.text, r.w - 14), r.x + 7, r.y + 29);
    if (stacks > 0 || learned) {
      ctx.textAlign = 'right';
      ctx.fillStyle = maxed ? 'rgba(150,165,185,0.6)' : '#7fe0ff';
      ctx.font = 'bold 9px sans-serif';
      ctx.fillText(learned ? '已学' : `×${stacks}`, r.x + r.w - 7, r.y + 15);
    }
  }
}

requestAnimationFrame(frame);
