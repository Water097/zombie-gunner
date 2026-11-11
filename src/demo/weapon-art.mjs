// 主武器渲染层 —— 实机 main.mjs 与武器实验室共用同一份代码。
// 从 main.mjs 的 drawBullets() 抽出，逻辑一行未改；额外给实验室补了枪口焰/命中火花。

/** 子弹（06 册 §3.2.1 属性可视化）：带火 → 橙红，带爆炸 → 外圈黄环，子子弹 → 小颗偏黄白。 */
export function drawBullets(ctx, world) {
  const fire = world.mods?.bulletFire, boom = world.mods?.bulletExplode;
  for (const b of world.bullets || []) {
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

/** 枪口焰：开火后 ~90ms 的三角白焰 + 暖光。 */
export function drawMuzzleFlash(ctx, x, y, ang, a = 1) {
  if (a <= 0) return;
  ctx.save(); ctx.translate(x, y); ctx.rotate(ang + Math.PI / 2);
  ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = a;
  ctx.fillStyle = 'rgba(255,236,160,0.85)';
  ctx.beginPath(); ctx.moveTo(-5, 0); ctx.lineTo(0, -18); ctx.lineTo(5, 0); ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.beginPath(); ctx.moveTo(-2, 0); ctx.lineTo(0, -9); ctx.lineTo(2, 0); ctx.closePath(); ctx.fill();
  ctx.restore();
}

/** 命中火花：hits = [{x,y,life,maxLife}]，四散短线 + 白核。 */
export function drawHits(ctx, hits) {
  for (const h of hits || []) {
    const k = Math.max(0, 1 - h.life / h.maxLife);
    const a = 1 - k;
    ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = a;
    ctx.strokeStyle = '#ffe08a'; ctx.lineWidth = 2;
    ctx.beginPath();
    for (let i = 0; i < 7; i++) {
      const ang = (i / 7) * Math.PI * 2 + h.x * 0.01;
      const r0 = 3 + k * 10, r1 = r0 + 5;
      ctx.moveTo(h.x + Math.cos(ang) * r0, h.y + Math.sin(ang) * r0);
      ctx.lineTo(h.x + Math.cos(ang) * r1, h.y + Math.sin(ang) * r1);
    }
    ctx.stroke();
    ctx.globalAlpha = a * 0.8; ctx.fillStyle = '#ffffff';
    ctx.beginPath(); ctx.arc(h.x, h.y, 3 * a + 1, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }
}
