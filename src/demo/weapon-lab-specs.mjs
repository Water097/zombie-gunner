// 武器实验室舞台 —— 与技能实验室共用 Stage 接口，渲染调用实机同一份 weapon-art.mjs。
//
// 不是「画一排子弹」：这里跑的是真实的**弹匣 / 开火间隔 / 换弹**状态机，
// 所以调 fireIntervalMs、magSize、reloadMs、bulletSpeed 都能在画面上直接看出差别。

import { LAB, drawBackdrop } from './skill-lab-specs.mjs';
import { weaponParams } from './lab-params.mjs';
import { drawBullets, drawMuzzleFlash, drawHits } from './weapon-art.mjs';

export function blankWeaponWorld() {
  return {
    bullets: [], hits: [], events: [],
    mods: { bulletFire: false, bulletExplode: false },
    lab: { ammo: weaponParams.magSize, shotTimer: 0, reloadLeft: 0, muzzle: 0, shots: 0, hits: 0, dmg: 0 },
  };
}

function fire(w, p) {
  const { PET } = LAB;
  const extra = p.scatter || 0;
  const n = (p.doubleShot ? 2 : 1) + extra;
  for (let i = 0; i < n; i++) {
    // 散射：绕正上方微散；双发：第二发往后挪 14px（06 册「一前一后纵列」，不是并排）
    const spread = extra && i >= (p.doubleShot ? 2 : 1)
      ? ((i - (p.doubleShot ? 2 : 1)) - (extra - 1) / 2) * 0.11 : 0;
    const dy = p.doubleShot && i === 1 ? 14 : 0;
    w.bullets.push({
      x: PET.x, y: PET.y - 12 + dy,
      vx: Math.sin(spread) * p.bulletSpeed,
      vy: -Math.cos(spread) * p.bulletSpeed,
      radius: p.bulletRadius,
      pierce: p.bulletPierce,
      hit: false, isSub: false,
    });
  }
}

export const WEAPON_SPEC = {
  id: 'weapon', name: '主武器', tag: '自动瞄准 · 弹匣 / 换弹', color: '#ffe08a',
  read: '从发射点自动向上开火 → 子弹飞行 → 命中目标火花 → 打空弹匣换弹。改「开火间隔 / 弹匣 / 换弹 / 弹速」立刻看得到节奏变化。',
  blank: blankWeaponWorld,
  make(w) {
    w.lab.ammo = weaponParams.magSize;
    w.lab.shotTimer = 0; w.lab.reloadLeft = 0; w.lab.muzzle = 0;
    w.lab.shots = 0; w.lab.hits = 0; w.lab.dmg = 0;
    w.bullets.length = 0; w.hits.length = 0;
  },
  tick(w, dt) {
    const p = weaponParams, L = w.lab;
    w.mods.bulletFire = !!p.bulletFire;
    w.mods.bulletExplode = !!p.bulletExplode;

    if (L.muzzle > 0) L.muzzle -= dt * 1000;
    for (const h of w.hits) h.life -= dt * 1000;
    w.hits = w.hits.filter((h) => h.life > 0);

    // 子弹推进 + 命中判定（到目标线算命中；穿透数决定火花团数）
    const alive = [];
    for (const b of w.bullets) {
      b.x += b.vx * dt; b.y += b.vy * dt;
      if (!b.hit && b.y <= LAB.FOE.y + 16) {
        b.hit = true;
        const n = Math.min(3, Math.max(1, p.pierceTargets));
        for (let i = 0; i < n; i++) {
          w.hits.push({ x: b.x + (i - (n - 1) / 2) * 9, y: LAB.FOE.y + i * 5, life: 260, maxLife: 260 });
        }
        L.hits++; L.dmg += p.baseDamage * n;
        w.events.push({ kind: 'bullet', dmg: p.baseDamage * n });   // 交给实验室的敌人受击层
        if (b.y > -30 && b.pierce > 0) { b.pierce--; b.hit = false; alive.push(b); }
        continue;
      }
      if (b.y > -30) alive.push(b);
    }
    w.bullets = alive;

    // 换弹状态
    if (L.reloadLeft > 0) {
      L.reloadLeft -= dt;
      if (L.reloadLeft <= 0) { L.reloadLeft = 0; L.ammo = p.magSize; }
      return;
    }
    // 开火
    L.shotTimer -= dt;
    if (L.shotTimer <= 0 && L.ammo > 0) {
      fire(w, p);
      L.ammo--; L.shots++;
      L.shotTimer = Math.max(0.01, p.fireIntervalMs / 1000);
      L.muzzle = 90;
      if (L.ammo <= 0) L.reloadLeft = Math.max(0, p.reloadMs / 1000);
    }
  },
  draw(c, w) {
    const p = weaponParams, L = w.lab;
    drawBullets(c, w);
    if (L.muzzle > 0) drawMuzzleFlash(c, LAB.PET.x, LAB.PET.y - 12, -Math.PI / 2, L.muzzle / 90);
    drawHits(c, w.hits);

    c.globalAlpha = 1; c.globalCompositeOperation = 'source-over';
    c.fillStyle = 'rgba(8,12,24,0.80)'; c.fillRect(0, 0, LAB.W, 30);
    c.font = 'bold 12px monospace'; c.textAlign = 'left'; c.fillStyle = '#e7eefc';
    c.fillText(`弹匣 ${L.ammo}/${p.magSize}`, 10, 20);
    c.fillText(`命中 ${L.hits}`, 132, 20);
    c.fillText(`累计 ${L.dmg}`, 218, 20);
    c.textAlign = 'right'; c.fillStyle = '#7fe0ff';
    c.fillText(`DPS≈${p.fireIntervalMs > 0 ? (p.baseDamage * 1000 / p.fireIntervalMs).toFixed(0) : 0}`, LAB.W - 10, 20);

    if (L.reloadLeft > 0) {
      const total = Math.max(0.001, p.reloadMs / 1000);
      const k = Math.max(0, Math.min(1, 1 - L.reloadLeft / total));
      c.fillStyle = 'rgba(0,0,0,0.65)'; c.fillRect(0, LAB.H - 16, LAB.W, 12);
      c.fillStyle = '#ffd257'; c.fillRect(0, LAB.H - 16, LAB.W * k, 12);
      c.fillStyle = '#0a1016'; c.font = 'bold 10px monospace'; c.textAlign = 'center';
      c.fillText(`换弹中 ${L.reloadLeft.toFixed(2)}s`, LAB.W / 2, LAB.H - 6);
    }
  },
  params: () => [],
};
