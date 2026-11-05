// 概念图总目录 —— 分门别类，供 fx-preview.html 消费。
//
// 关键：所有条目无论是「现成借鉴」还是「内核新写」，都是同一个 pure effect 模块形态，
// 都由同一个 makeRenderer() 走 createFrame → createFx → composite 管线渲染。
// 所以画廊里看到的每一帧，就是 demo 里将要用到的那一段代码，不是另做的一张图。

import { createFrame, clearFrame, createFx, composite } from '../../vendor/pixelfx/src/core/index.js';
import { PAL } from '../../vendor/pixelfx/src/core/color.js';
import { ENEMY_EFFECTS, DEATH_EFFECTS } from './enemies.mjs';
import { GEAR_EFFECTS } from './equipment.mjs';
import { GRADE_EFFECTS } from './grades.mjs';
import { WEAPON_EFFECTS, BULLET_EFFECTS, BULLET_ATTR_EFFECTS, WEAPON_BLAST_EFFECTS } from './weapons.mjs';
import { SKILL_EFFECTS } from './skills.mjs';
import { ACTOR_EFFECTS } from './misc.mjs';

// ── 原库现成特效（直接借鉴 / 只换 palette，不改一行源码） ──
import * as fxSlime from '../../vendor/pixelfx/src/fx/critters/slime.js';
import * as fxCoin from '../../vendor/pixelfx/src/fx/pickups/coin-spin.js';
import * as fxGem from '../../vendor/pixelfx/src/fx/pickups/gem-spin.js';
import * as fxShard from '../../vendor/pixelfx/src/fx/pickups/crystal-shard.js';
import * as fxLevelUp from '../../vendor/pixelfx/src/fx/ui/level-up.js';
import * as fxDmg from '../../vendor/pixelfx/src/fx/ui/damage-number.js';
import * as fxCritNum from '../../vendor/pixelfx/src/fx/ui/crit-number.js';
import * as fxHit from '../../vendor/pixelfx/src/fx/impacts/hit-spark.js';
import * as fxCritHit from '../../vendor/pixelfx/src/fx/impacts/crit-hit.js';
import * as fxFrost from '../../vendor/pixelfx/src/fx/ice/frost-nova.js';
import * as fxFireRing from '../../vendor/pixelfx/src/fx/fire/fire-ring.js';
import * as fxBolt from '../../vendor/pixelfx/src/fx/lightning/lightning-strike.js';
import * as fxPoof from '../../vendor/pixelfx/src/fx/spawn/poof.js';
import * as fxBoom from '../../vendor/pixelfx/src/fx/explosions/small-explosion.js';

const borrowed = (id, name, mod, o = {}) => ({
  id, name,
  spec: o.spec ?? mod.meta?.desc ?? '',
  mech: o.mech ?? '',
  read: o.read ?? '原库帧动画，未改源码',
  source: `现成借鉴 · ${o.from ?? id}`,
  demoHook: o.hook ?? `createFx(${id}) → 战斗层`,
  opts: o.opts ?? {},
  mod,
});

const ORIGINAL_SLIME = borrowed('ref-slime', '原库绿色史莱姆（对照）', fxSlime, {
  from: 'critters/slime', spec: 'loop 1.8s · 112×88',
  mech: '全部 8 种敌人由它的 squash→hop→splat→wobble 骨架派生',
  read: '绿色 / 无核心 / 标准一跳',
  hook: '参考蓝本，不直接进场',
});

const CURRENCY = [
  borrowed('coin', '金币', fxCoin, { from: 'pickups/coin-spin', spec: '通关掉落 · 技能升级资源', mech: '升级主货币', read: '旋转金币 + 闪白', hook: 'onKill() → loot("coin")' }),
  borrowed('skill-shard', '技能碎片', fxShard, { from: 'pickups/crystal-shard', spec: '通关掉落 · 技能升级资源', mech: '升级双货币之一', read: '冰蓝晶体自旋', opts: { palette: PAL.ice }, hook: 'onKill() → loot("shard")' }),
  borrowed('common-shard', '通用碎片', fxShard, { from: 'pickups/crystal-shard（重着色）', spec: '武器碎片溢出转化', mech: '碎片闭环的兜底货币', read: '灰白晶体，仅换 palette', opts: { palette: PAL.stone }, hook: '碎片溢出 → 通用碎片' }),
  borrowed('weapon-shard', '武器碎片', fxShard, { from: 'pickups/crystal-shard（重着色）', spec: '武器解锁专用碎片', mech: '兑换只做武器解锁，不做抽卡', read: '橙红晶体，仅换 palette', opts: { palette: PAL.fire }, hook: '关卡奖励 → 武器解锁' }),
  borrowed('gem', '宝石', fxGem, { from: 'pickups/gem-spin', spec: '宝石界面参考 / 镶嵌延后', mech: '本期只做界面，不做镶嵌', read: '紫宝石自旋 + 切面高光', opts: { palette: PAL.arcane }, hook: '装备界面 → gem icon' }),
  borrowed('gear-mat', '装备分解材料', fxGem, { from: 'pickups/gem-spin（重着色）', spec: '装备分解产出', mech: '装备闭环，强化/镶嵌延后', read: '金色宝石，仅换 palette', opts: { palette: PAL.gold }, hook: '装备分解 → 材料' }),
];

const UI = [
  borrowed('level-up', 'LEVEL UP', fxLevelUp, { from: 'ui/level-up', spec: '20 级 / 每级一次三选一', mech: '光柱 + 逐字落下 + 角色 halo', read: '升级的仪式感反馈', hook: 'world.level 变化 → createFx' }),
  borrowed('damage-number', '伤害飘字', fxDmg, { from: 'ui/damage-number', spec: '普通伤害', mech: '弹出 → 落地挤压 → 上浮淡出', read: '白字 + 描边', hook: 'dealDamage() → addFloater' }),
  borrowed('crit-number', '暴击飘字', fxCritNum, { from: 'ui/crit-number', spec: '暴击 m=1.3~1.5 · 硬上限 25%', mech: '更大的字 + 星芒，与普通飘字分级', read: '红字 + 星芒', hook: 'dealDamage(crit) → addFloater' }),
];

const VFX = [
  borrowed('hit-spark', '命中火花', fxHit, { from: 'impacts/hit-spark', spec: '主武器命中', mech: '白热 hero frame → 火花 → 余晖', read: '快起慢收', hook: 'onHit() → createFx' }),
  borrowed('crit-hit', '暴击命中', fxCritHit, { from: 'impacts/crit-hit', spec: '暴击命中', mech: '比普通命中多一层冲击环与碎屑', read: '双层冲击', hook: 'onHit(crit) → createFx' }),
  borrowed('frost-nova', '冰系落点（干冰弹）', fxFrost, { from: 'ice/frost-nova', spec: '技能落点环范例', mech: '地面环 + 冰晶，远半/近半分层', read: '冰蓝扩散环', hook: 'castSkill("dryice") → createFx' }),
  borrowed('fire-ring', '火系落点（温压弹）', fxFireRing, { from: 'fire/fire-ring', spec: '技能落点环范例', mech: '爆炸火环 + 余烬', read: '橙红火环', hook: 'castSkill("thermo") → createFx' }),
  borrowed('lightning-strike', '空降落雷（电磁天雷）', fxBolt, { from: 'lightning/lightning-strike', spec: '锁敌空降范例', mech: '从天而降 + 落点感电', read: '蓝白折线', hook: 'castSkill("thunder") → createFx' }),
  borrowed('small-explosion', '小型爆炸（自爆兵）', fxBoom, { from: 'explosions/small-explosion', spec: '自爆兵抵线 / 榴弹炮', mech: '白热核心 → 碎片 → 烟尘', read: '暖橙爆闪', hook: 'bomberExplode() → createFx' }),
  borrowed('poof', '死亡柔烟', fxPoof, { from: 'spawn/poof', spec: '敌人死亡 / 生成', mech: '半透明烟团上升消散', read: '灰白烟团', hook: 'killEnemy() → createFx' }),
];

export const CATALOG = [
  { id: 'enemies', title: '敌人类别', sub: '机制沿用 05 册已定稿的 8 种敌人。第二版复用 critters 内核降噪，并按各自机制拆出独立剪影与运动模型：方壳 / 梭形 / 尖刺球 / 钟形塔 / 水母伞 / 三小团 / 双瓣葫芦——8 种里只有 1 种还在跳。', items: [ORIGINAL_SLIME, ...ENEMY_EFFECTS] },
  { id: 'enemy-death', title: '敌人类别 · 死亡效果', sub: 'one-shot 击杀反馈，8 种各自读得出不同信息。自爆故意做成「哑弹泄气」而不是爆炸，避免与「抵线自爆炸要塞」混淆。全部以空帧结束，可直接被 fx.done() 回收。', items: DEATH_EFFECTS },
  { id: 'weapons', title: '武器类别 · 6 把型号', sub: '第二版按弹道形态重画：每把独立剪影 + 独立射击节奏（后坐 / 泵动 / 拉栓 / 起转 / 装填），不再只换颜色。名称照抄 06 册；品级 6 档与型号正交，不额外画 36 把。⚠️ 本组用的是**型号识别色**（图鉴用，方便一眼认出是哪把）；游戏内实际配色由品级决定，见「品级对照」类别。', items: WEAPON_EFFECTS },
  { id: 'weapon-bullets', title: '武器类别 · 子弹与弹道', sub: '06 册 3.2：双发（一前一后纵列）/ 散射 / 穿透 + 基础弹种。追踪、弹射已按用户拍板移除（弹射连 06 册一并作废）。消耗模型：弹夹 = 扳机 tick，加弹道只改形态、不改换弹节奏。', items: BULLET_EFFECTS },
  { id: 'weapon-attrs', title: '武器类别 · 子弹属性', sub: '06 册 3.2.1 的 5 张视觉卡：火属性弹头 / 爆炸弹头 / 爆炸范围+100% / 命中分裂 / 子子弹爆炸。「子子弹伤害 20%」「+30%」是纯数值卡，不改子弹外观，已从概念图删除。主弹与子子弹共用同一爆炸表现，只差半径。', items: BULLET_ATTR_EFFECTS },
  { id: 'weapon-blasts', title: '武器类别 · 爆炸与命中', sub: '武器侧：枪口火花（按原库 hit-spark 火花语言）、精确步枪穿透余痕、榴弹炮落点爆炸（直接复用原库 small-explosion，时间轴 ×3 压到 1.8s）；末 2 张是原库对照。', items: WEAPON_BLAST_EFFECTS },
  { id: 'gear', title: '装备类别', sub: '07 册 6 个部位（头肩 / 胸甲 / 腰带 / 鞋子 / 首饰 / 称号）。第四版按「装备图标规范 v1」重画：统一左上光源 + 三档明暗 + 1px INK 描边 + 钢/皮革/宝石三材质共用色阶；每部位一个主色相（蓝/钢蓝/皮革棕/翠绿/奥术紫/圣金）+ ①–⑥ 编号角标。首图「装备部位总览」是人形居中、两侧编号槽位带引线定位。武器独立成系统不占格，同部位只能穿 1 件。⚠️ 本组用的是**部位识别色**（图鉴用）；游戏内实际配色由品级决定，见「品级对照」类别。', items: GEAR_EFFECTS },
  { id: 'tiers', title: '品级对照 · 6 档配色与光效', sub: '06 册六档（白/蓝/紫/粉/金/赤红+黑纹）落到视觉上：同一把枪、同一件甲，逐档升级**只换配色与光效，剪影一行不动**。首图是规范页（6 档色板 + 光效强度刻度）；其后 6 张突击步枪、6 张胸甲，用来验证「不看名字也能分出档」。光效层层加码：白无光 → 蓝 1 圈外缘+1 静光点 → 紫 呼吸光+2 粒子 → 粉 4 粒子+内层加色 → 金 双圈+流光 → 灾厄 双圈赤光+8 粒子+脉动环+甲面黑纹。', items: GRADE_EFFECTS },
  { id: 'skills', title: '技能类别', sub: '02 册 9 个技能。球体颜色读系别，中心符号读形态——避免 9 个发光球长一个样。局内 4 槽上限，一局只选 4 条线。', items: SKILL_EFFECTS },
  { id: 'currency', title: '货币与掉落', sub: '你没点名但概念图必须有的类别。3 种晶体是同一个原库特效换 palette 得到的，正好演示「重着色不改代码」。', items: CURRENCY },
  { id: 'actors', title: '角色 / 宠物 / 要塞', sub: '你没点名但绕不开的实体。库里只有特效、没有立绘，这三个是 Painter 从零写的像素帧动画。', items: ACTOR_EFFECTS },
  { id: 'ui', title: 'UI 与反馈', sub: '升级与飘字反馈。全部直接取原库，未改源码。', items: UI },
  { id: 'vfx', title: '战斗特效', sub: '命中、技能落点、爆炸、死亡。全部直接取原库，未改源码；上 demo 时按事件挂 createFx 即可。', items: VFX },
];

export const REFS = [
  ['impacts/hit-spark', '命中火花'],
  ['ice/frost-nova', '冰霜新星'],
  ['ui/damage-number', '伤害飘字'],
  ['ui/level-up', 'LEVEL UP'],
  ['pickups/coin-spin', '金币'],
  ['pickups/gem-spin', '宝石'],
];

/**
 * 把一个 pure effect 模块挂到一张 canvas 上。
 * 这段就是「上 demo 的接法」的最小完整版本：换宿主只需把这里的 ctx 换成战斗画布。
 */
export function makeRenderer(item) {
  const meta = item.mod.meta ?? {};
  const [w, h] = meta.size ?? [96, 88];
  const [ox, oy] = meta.origin ?? [w / 2, h - 10];
  const frame = createFrame(w, h);
  const img = new ImageData(w, h);
  const spawn = () => createFx(item.mod, { x: ox, y: oy, ...(item.opts ?? {}) });
  let inst = spawn();
  return {
    w, h,
    step(dt) {
      inst.update(dt);
      // one-shot 跑完自动重播，画廊里才能反复看
      if (!meta.loop && inst.done()) inst = spawn();
    },
    draw(ctx) {
      clearFrame(frame);
      inst.draw(frame, 'back');
      inst.draw(frame, 'front');
      composite(frame, img.data, null);   // null = 透明底，交给页面深色背景
      ctx.putImageData(img, 0, 0);
    },
  };
}
