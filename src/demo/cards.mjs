// 卡池（对齐 03 册「三族卡池」+ 08 册「加成卡体系」）
//
// 08 册硬纪律：每张卡必须带主语。判别标准——把卡面上的名词去掉后如果还成立，就是不合格的。
// 卡面文案纪律：必须说清"加的是哪一项"（「【子弹】+30%」是废文案，要写「【子弹】伤害 +30%」）。
// 08 册约束 3：同桶加算，不连乘（自带收益递减）。
//
// 开局状态（对齐参考视频）：**一个技能都没有**，只有主武器子弹。
// 技能要靠「学习技能卡」解锁；技能卡只出已学技能；放大器（破冰/助燃/导电体）要求对应技能已学。
//
// 不封顶（2026-10-30 用户推翻 03 册"武器卡 6 级封顶"）：
//   卡可以无限叠，但**某条线等级越高，它的卡出现概率越低**（自然收敛，不做硬上限）：
//     线等级 ≤8  → 权重 1.0
//     9~10 级    → 权重 0.9（降 10%）
//     >10 级     → 每多 1 级再降 5%（0.85 / 0.80 / …，下限 0.2）

export const MAX_LEVEL = 20; // 一局 20 次三选一（03 册）
export const MAX_SKILL_SLOTS = 4; // 一局最多 4 个技能（与 main.mjs 技能槽数一致；9 技能里每局选 4 条线）

// 经验曲线丙·修正版（2026-11-02 用户拍板：满级点从 17~18 波拉回「第 19 波中段」
// ——第 19 波的僵尸出一半时升到 Lv20）。前段锚点不变，只拉开 Lv12→20 的每级需求。
// 锚点（由 src/demo/balance-sim.mjs 按当前难度供给校准）：
//   · req(1)=20 → 第 1 波杀 2 只即升 Lv2；首个弹匣（~15s，≈140xp）内最多 Lv3
//   · 第 3 波末（供给≈858xp）→ Lv6（S(6)=478）
//   · 第 9 波末（供给≈3628xp）→ Lv12（S(12)=3043，第 9 波开局即到）
//   · 第 19 波中段（供给≈12408 + 半波≈490）→ Lv20（S(20)=12793）
// 表为「Lv → 升下一级所需 xp」；难度参数若再调，重跑 balance-sim 复核锚点。
// 经验曲线（2026-11-02 第三次重校）：出怪密度加大后击杀数上升约 1.6 倍，
// 供给整体抬高，原表导致第 9 波就 14 级（目标 12）。按新供给重新锚定：
//   · S(6)  ≈ 1500  → 第 3 波末（第 4 波开始供给 ≈1605）
//   · S(12) ≈ 8600  → 第 9 波末（第 10 波开始供给 ≈8729）
//   · S(20) ≈ 23400 → 第 19 波中段（第 19 波开始 ≈23220，波内过半满级）
// 形状：前 6 级陡（每级 +140 递增，20→580，前期升级快），Lv7 起趋于平台
// （每级 600→2050，后期每级约 1 波），末级回落 1500 把满级压在第 19 波中段。
// 难度参数若再调，重跑 `node src/demo/balance-sim.mjs --supply` 复核锚点。
export const XP_TABLE = [
  20, 70, 102, 138, 240, 590, 845, 890, 950, 1025, 1120,          // Lv1→11
  1700, 1850, 1950, 2050, 2150, 2250, 2400, 1350,                  // Lv12→20（末级回落：压第 19 波中段）
];
export function xpForLevel(level) { return XP_TABLE[Math.min(level, XP_TABLE.length) - 1] ?? XP_TABLE[XP_TABLE.length - 1]; }

// 某条线（武器 / 某个技能）的等级 → 该线卡片的出现权重
export function lineDecay(level) {
  if (level <= 8) return 1;
  if (level <= 10) return 0.9;
  return Math.max(0.2, 0.9 - (level - 10) * 0.05);
}

// 加成卡预算按等级分层解锁（08 册一节：防止前 5 级一次到顶）
export function bonusBudget(level) {
  if (level <= 6) return 2;
  if (level <= 13) return 4;
  return 6;
}

// ── 学习技能卡（入门卡）：开局没有任何技能，必须先学会才谈得上强化 ──
export const LEARN_CARDS = [
  { id: 'learn-freeze', kind: 'learn', target: 'freeze', name: '干冰弹', text: '学会【干冰弹】· 冰系穿透，冻结敌人' },
  { id: 'learn-burn', kind: 'learn', target: 'burn', name: '温压弹', text: '学会【温压弹】· 火系爆炸，灼烧敌人' },
  { id: 'learn-shock', kind: 'learn', target: 'shock', name: '电磁天雷', text: '学会【电磁天雷】· 随机降下闪电，范围感电' },
  { id: 'learn-vehicle', kind: 'learn', target: 'vehicle', name: '装甲车', text: '学会【装甲车】· 物理碾压，击退推回警戒线' },
  { id: 'learn-ray', kind: 'learn', target: 'ray', name: '高能射线', text: '学会【高能射线】· 能量系持续光束，锁敌输出' },
  { id: 'learn-laser', kind: 'learn', target: 'laser', name: '制导激光', text: '学会【制导激光】· 能量系窄扇面扫射，清线与覆盖' },
  { id: 'learn-turret', kind: 'learn', target: 'turret', name: '哨戒机', text: '学会【哨戒机】· 定点炮台自动兜底，不需瞄准' },
  { id: 'learn-flame', kind: 'learn', target: 'flame', name: '燃烧地带', text: '学会【燃烧地带】· 地面火区封锁，持续灼烧减速' },
  { id: 'learn-saw', kind: 'learn', target: 'saw', name: '旋转刀轮', text: '学会【旋转刀轮】· 横向滚刀，清越线者' },
];

export const CARDS = [
  // ── 武器卡：只影响主武器线 ──
  { id: 'bullet-dmg', kind: 'weapon', target: 'weapon', name: '弹头改良', text: '【子弹】伤害 +60%',
    apply: (m) => { m.bulletDamage += 0.6; } },
  { id: 'bullet-rate', kind: 'weapon', target: 'weapon', name: '枪机轻量化', text: '【子弹】射速 +25%',
    apply: (m) => { m.fireRate += 0.25; } },
  // ── 弹道卡（06册3.2.0）：独立乘数不进%桶。只扣 1 tick、弹耗不变；
  //    N=(1+弹道)×(1+连发) 乘法；每颗弹丸伤害按降伤表衰减（每类型上限 3 层）──
  // 命名纪律（2026-11-02 澄清）：弹道 +1 是「散射」（横向铺开、落在不同线），
  // 「分裂子弹」在 06 册 §3.2.1 #4 里专指"命中后分裂出 2-4 颗子子弹"，是另一张卡（Demo 未实装）。
  // 曾有歧义：本卡原名"分裂子弹"但效果是弹道 +1，已改名避免与真分裂卡撞车。
  { id: 'bullet-spread', kind: 'weapon', target: 'weapon', name: '散射弹道', text: '【子弹】弹道 +1（横向铺开，覆盖面更宽）', maxStacks: 3,
    apply: (m) => { m.spreadLanes = Math.min(3, m.spreadLanes + 1); } },
  { id: 'bullet-double', kind: 'weapon', target: 'weapon', name: '连发', text: '【子弹】连发 +1（同向多一颗）', maxStacks: 3,
    apply: (m) => { m.doubleShot = Math.min(3, m.doubleShot + 1); } },
  { id: 'bullet-pierce', kind: 'weapon', target: 'weapon', name: '穿甲弹头', text: '【子弹】穿透 +1',
    apply: (m) => { m.pierceBonus += 1; } },

  // ── 子弹属性卡（06 册 §3.2.1）：命中行为，只作用主武器子弹，与 9 技能独立 ──
  // 纪律：① 显著弱于同名技能（这里是"每发都带的常驻弱版"）② 子子弹不继承火/爆炸 ③ 子子弹不再分裂
  // 全部一次性；带 once 的修饰卡由 eligible 保证"主卡在手才进池"，不占三选一位发废卡
  { id: 'bullet-fire', kind: 'weapon', target: 'weapon', name: '火属性弹头', once: true,
    text: '【子弹】命中附加灼烧：每秒 8% 子弹伤害，持续 2 秒',
    apply: (m) => { m.bulletFire = 1; } },
  { id: 'bullet-explode', kind: 'weapon', target: 'weapon', name: '爆炸弹头', once: true,
    text: '【子弹】命中产生小爆炸：12% 子弹伤害，半径 35',
    apply: (m) => { m.bulletExplode = 1; } },
  { id: 'bullet-explode-range', kind: 'weapon', target: 'weapon', name: '爆破增程', once: true,
    text: '【子弹】爆炸半径 ×2（35→70），子子弹爆炸同样受益',
    apply: (m) => { m.bulletExplodeMul = 2; } },
  { id: 'bullet-split', kind: 'weapon', target: 'weapon', name: '分裂子弹', once: true,
    text: '【子弹】命中分裂 2-4 颗子子弹（20% 伤害，锥角飞出 90）',
    apply: (m) => { m.bulletSplit = 1; } },
  { id: 'bullet-sub-dmg', kind: 'weapon', target: 'weapon', name: '子母弹强化', once: true,
    text: '【子弹】子子弹伤害 +30%（20%→26%）',
    apply: (m) => { m.subDmgMul = 1.3; } },
  { id: 'bullet-sub-boom', kind: 'weapon', target: 'weapon', name: '子子弹爆炸', once: true,
    text: '【子弹】子子弹命中爆炸：30% 子伤，半径 25',
    apply: (m) => { m.subExplode = 1; } },

  // ── 技能卡：只出已学技能的卡（03 册：当局池只出你已学技能的卡）──
  { id: 'freeze-cd', kind: 'skill', target: 'freeze', name: '制冷回路', text: '【干冰弹】冷却 -25%',
    apply: (m) => { m.skillCdMul.freeze *= 0.75; } },
  { id: 'freeze-dur', kind: 'skill', target: 'freeze', name: '极寒延长', text: '【干冰弹】冻结时长 +1.0 秒',
    apply: (m) => { m.freezeDurBonus += 1000; } },
  // 基础属性三角（2026-11-03 用户原则：伤害/冷却/数量每个技能各一张）
  { id: 'freeze-dmg', kind: 'skill', target: 'freeze', name: '冰锥强化', text: '【干冰弹】命中直接伤害 +60%',
    apply: (m) => { m.freezeDmgMul += 0.6; } },
  { id: 'freeze-count', kind: 'skill', target: 'freeze', name: '三连冰弹', text: '【干冰弹】每次多射 1 发（微散）', maxStacks: 2,
    apply: (m) => { m.freezeCount += 1; } },
  // 范围卡降幅（2026-11-03 用户拍板 B：范围是最强属性，+30% 太便宜 → +20%）
  { id: 'burn-radius', kind: 'skill', target: 'burn', name: '燃料增量', text: '【温压弹】爆炸半径 +20%',
    apply: (m) => { m.burnRadiusMul += 0.2; } },
  { id: 'burn-dmg', kind: 'skill', target: 'burn', name: '高温装药', text: '【温压弹】灼烧伤害 +60%',
    apply: (m) => { m.burnDmgMul += 0.6; } },
  // 基础属性三角：温压原先连直接伤害都没有（只有灼烧 DoT），这里补齐
  { id: 'burn-hit', kind: 'skill', target: 'burn', name: '高爆装药', text: '【温压弹】爆炸直接伤害 +60%',
    apply: (m) => { m.burnHitMul += 0.6; } },
  { id: 'burn-cd', kind: 'skill', target: 'burn', name: '快速装填', text: '【温压弹】冷却 -25%',
    apply: (m) => { m.skillCdMul.burn *= 0.75; } },
  { id: 'burn-count', kind: 'skill', target: 'burn', name: '双联装填', text: '【温压弹】每次多射 1 发（微散）', maxStacks: 2,
    apply: (m) => { m.burnCount += 1; } },
  // ── 电磁卡（天雷形态，2026-11-02 重定）：加伤害 / 减冷却 / 加感电范围 / 加闪电数量 / 加感电时长 ──
  { id: 'shock-dmg', kind: 'skill', target: 'shock', name: '高压雷球', text: '【电磁】闪电伤害 +60%',
    apply: (m) => { m.shockDmgMul += 0.6; } },
  { id: 'shock-cd', kind: 'skill', target: 'shock', name: '电容扩容', text: '【电磁】冷却 -25%',
    apply: (m) => { m.skillCdMul.shock *= 0.75; } },
  { id: 'shock-area', kind: 'skill', target: 'shock', name: '电场扩张', text: '【电磁】感电范围 +20%',
    apply: (m) => { m.shockRadiusMul += 0.2; } },
  { id: 'shock-count', kind: 'skill', target: 'shock', name: '引雷针', text: '【电磁】闪电数量 +1',
    apply: (m) => { m.shockCount += 1; } },
  { id: 'shock-dur', kind: 'skill', target: 'shock', name: '过载电容', text: '【电磁】感电时长 +1.5 秒',
    apply: (m) => { m.shockDurBonus += 1500; } },
  // 质变卡（对应局外 15 / 20 级节点，02 册 2.3）：一次性，拿过就不再进池
  { id: 'shock-arc', kind: 'skill', target: 'shock', name: '弹射电弧', once: true, text: '【电磁】闪电落点向附近 2 个敌人弹射电弧（40% 伤害）',
    apply: (m) => { m.shockArc = 1; } },
  { id: 'shock-storm', kind: 'skill', target: 'shock', name: '雷暴', once: true, text: '【电磁】落点形成雷雨区，2 秒内持续落小闪电',
    apply: (m) => { m.shockStorm = 1; } },

  // ── 装甲车卡（02 册 3.2 六格 + 12/15/18/20 局外节点）──
  // 正确投法：②冲撞次数是核心，①伤害几乎不点——靠位移不靠打。
  { id: 'vehicle-dmg', kind: 'skill', target: 'vehicle', name: '冲压装药', text: '【装甲车】冲撞伤害 +60%',
    apply: (m) => { m.vehicleDmgMul += 0.6; } },
  { id: 'vehicle-cd', kind: 'skill', target: 'vehicle', name: '引擎预热', text: '【装甲车】冷却 -20%',
    apply: (m) => { m.skillCdMul.vehicle *= 0.8; } },
  { id: 'vehicle-count', kind: 'skill', target: 'vehicle', name: '连续出击', text: '【装甲车】冲撞次数 +2', maxStacks: 2,
    apply: (m) => { m.vehicleCount += 2; } },
  { id: 'vehicle-slow', kind: 'skill', target: 'vehicle', name: '粘性履带', text: '【装甲车】减速持续 +4 秒',
    apply: (m) => { m.vehicleSlowBonus += 4000; } },
  { id: 'vehicle-vuln', kind: 'skill', target: 'vehicle', name: '破甲撞角', text: '【装甲车】撞击目标 6 秒内受伤 +20%',
    apply: (m) => { m.vehicleVuln = 1; } },
  { id: 'vehicle-knock', kind: 'skill', target: 'vehicle', name: '冲压装甲', text: '【装甲车】击退 +75%，10% 概率眩晕 1 秒',
    apply: (m) => { m.vehicleKnockMul += 0.75; m.vehicleStunChance += 0.1; } },
  // 2026-11-03 改：不再给范围（范围属性过强）→ 只放大模型，伤害 +80% 换行进 -20%
  { id: 'vehicle-heavy', kind: 'skill', target: 'vehicle', name: '重型装甲车', once: true, text: '【装甲车】车身放大，伤害 +80%，行进 -20%（碾压范围不变）',
    apply: (m) => { m.vehicleHeavy = 1; } },
  // 局外节点卡（对应 12 / 15 / 18 / 20 级，02 册 2.3）：一次性，拿过不再进池
  { id: 'vehicle-tar', kind: 'skill', target: 'vehicle', name: '粘性焦油', once: true, text: '【装甲车】撞击追加目标最大生命 3% 伤害',
    apply: (m) => { m.vehicleTar = 1; } },
  { id: 'vehicle-stun5', kind: 'skill', target: 'vehicle', name: '碾压眩晕', once: true, text: '【装甲车】5% 概率眩晕 2 秒',
    apply: (m) => { m.vehicleStun5 = 1; } },
  { id: 'vehicle-firstboom', kind: 'skill', target: 'vehicle', name: '冲撞爆破', once: true, text: '【装甲车】命中首个目标后小范围爆炸（200% 伤害）',
    apply: (m) => { m.vehicleFirstBoom = 1; } },
  { id: 'vehicle-frozen', kind: 'skill', target: 'vehicle', name: '冰冻碾碎', once: true, text: '【装甲车】碾过【冻结】单位伤害 +200%',
    apply: (m) => { m.vehicleLevel = 20; } },

  // ── 五技能卡（2026-11-03 补齐）：各技能「伤害 / 冷却 / 数量」三角 ──
  { id: 'ray-dmg', kind: 'skill', target: 'ray', name: '聚焦透镜', text: '【高能射线】伤害 +60%',
    apply: (m) => { m.rayDmgMul += 0.6; } },
  { id: 'ray-cd', kind: 'skill', target: 'ray', name: '能量回收', text: '【高能射线】冷却 -25%',
    apply: (m) => { m.skillCdMul.ray *= 0.75; } },
  { id: 'ray-count', kind: 'skill', target: 'ray', name: '多路并发', text: '【高能射线】光束 +1（微散）', maxStacks: 2,
    apply: (m) => { m.rayCount += 1; } },
  { id: 'laser-dmg', kind: 'skill', target: 'laser', name: '激光功率', text: '【制导激光】伤害 +60%',
    apply: (m) => { m.laserDmgMul += 0.6; } },
  { id: 'laser-cd', kind: 'skill', target: 'laser', name: '谐振充能', text: '【制导激光】冷却 -25%',
    apply: (m) => { m.skillCdMul.laser *= 0.75; } },
  { id: 'laser-range', kind: 'skill', target: 'laser', name: '广角扫描', text: '【制导激光】扫射长度 +25%',
    apply: (m) => { m.laserRangeMul += 0.25; } },
  { id: 'turret-dmg', kind: 'skill', target: 'turret', name: '穿甲弹芯', text: '【哨戒机】炮台伤害 +50%',
    apply: (m) => { m.turretDmgMul += 0.5; } },
  { id: 'turret-cd', kind: 'skill', target: 'turret', name: '快速部署', text: '【哨戒机】冷却 -25%',
    apply: (m) => { m.skillCdMul.turret *= 0.75; } },
  { id: 'turret-count', kind: 'skill', target: 'turret', name: '双联部署', text: '【哨戒机】+1 台炮台', maxStacks: 2,
    apply: (m) => { m.turretCount += 1; } },
  { id: 'flame-dmg', kind: 'skill', target: 'flame', name: '助燃剂', text: '【燃烧地带】每秒伤害 +60%',
    apply: (m) => { m.flameDmgMul += 0.6; } },
  { id: 'flame-cd', kind: 'skill', target: 'flame', name: '快速布设', text: '【燃烧地带】冷却 -25%',
    apply: (m) => { m.skillCdMul.flame *= 0.75; } },
  { id: 'flame-radius', kind: 'skill', target: 'flame', name: '区域蔓延', text: '【燃烧地带】区域半径 +20%',
    apply: (m) => { m.flameRadiusMul += 0.2; } },
  { id: 'saw-dmg', kind: 'skill', target: 'saw', name: '刀刃锐化', text: '【旋转刀轮】切割伤害 +60%',
    apply: (m) => { m.sawDmgMul += 0.6; } },
  { id: 'saw-cd', kind: 'skill', target: 'saw', name: '快速回收', text: '【旋转刀轮】冷却 -25%',
    apply: (m) => { m.skillCdMul.saw *= 0.75; } },
  { id: 'saw-count', kind: 'skill', target: 'saw', name: '多重刀轮', text: '【旋转刀轮】+1 个刀轮', maxStacks: 2,
    apply: (m) => { m.sawCount += 1; } },

  // ── 加成卡 A 类：放大器（要求对应技能已学，否则是废卡）──
  // 强度纪律：条件卡 ≈ 同类无条件卡的 1.5~2 倍（补偿覆盖率；条件越苛刻倍率越高）
  { id: 'icebreak', kind: 'bonus', target: 'freeze', name: '破冰', text: '对【冻结】目标伤害 +30%',
    apply: (m) => { m.dmgVsFrozen += 0.3; } },
  { id: 'combust', kind: 'bonus', target: 'burn', name: '助燃', text: '对【燃烧】目标伤害 +35%',
    apply: (m) => { m.dmgVsBurn += 0.35; } },
  { id: 'conductor', kind: 'bonus', target: 'shock', name: '导电体', text: '对【感电】目标伤害 +25%',
    apply: (m) => { m.dmgVsShock += 0.25; } },
  // ❌ 交叉火力已删除（2026-11-02 用户：场上敌人≥8 几乎常驻，等于白给+100%，超模）

  // ── 加成卡 B 类：代价型 ──
  // 代价卡定价纪律（2026-11-02 用户提出）：收益必须显著高于同类白给卡，否则是废卡。
  //   轻量化 +60% 射速 vs 枪机轻量化白给 +25% —— 溢价 +35% 才对得起 -15% 伤害。
  //   [PLACEHOLDER · 数值阶段统一复核全部代价卡]
  { id: 'highpressure', kind: 'bonus', target: 'weapon', name: '高压弹仓', text: '【子弹】伤害 +35%，换弹时间 +25%',
    apply: (m) => { m.bulletDamage += 0.35; m.reloadMul *= 1.25; } },
  { id: 'lightweight', kind: 'bonus', target: 'weapon', name: '轻量化', text: '【子弹】射速 +60%，伤害 -15%',
    apply: (m) => { m.fireRate += 0.6; m.bulletDamage *= 0.85; } },

  // ── 加成卡 C 类：资源型 ──
  // 快速学习（2026-11-02 用户拍板）：一局最多 2 张，且只在 10 级之前出现——
  // 防止它被无限叠加把经验供给推快、满级点漂移（实测 random 策略曾叠 3 张 ×1.75 倍经验）。
  { id: 'rapidlearn', kind: 'bonus', target: null, name: '快速学习', text: '经验获取 +25%',
    apply: (m) => { m.xpRate += 0.25; } },
];

// 功能卡（事件卡）：不属于三族、不占加成卡预算。要塞血量首次跌破 50% 后，下一抽必现，一局仅一次。
export const MERCY_CARD = {
  id: 'mercy', kind: 'function', target: null, name: '要塞急救', text: '立即回复要塞最大血量 30%',
};

// 卡是否可进池
// 修饰卡 → 所需主卡（mods 字段）。主卡不在手时，修饰卡不进池。
const BULLET_TRAIT_REQ = {
  'bullet-explode-range': 'bulletExplode',
  'bullet-sub-dmg': 'bulletSplit',
  'bullet-sub-boom': 'bulletSplit',
};

function eligible(world, c) {
  if (c.kind === 'bonus' && world.bonusTaken >= bonusBudget(world.level)) return false;
  if (c.kind === 'skill' && !world.skills[c.target]) return false;              // 只出已学技能
  if (c.kind === 'bonus' && c.target && c.target !== 'weapon' && !world.skills[c.target]) return false; // 放大器要对应技能
  // 快速学习：一局最多 2 张，只在 10 级之前出现
  if (c.id === 'rapidlearn') {
    if (world.level >= 10) return false;
    if ((world.cardStacks.rapidlearn || 0) >= 2) return false;
  }
  // 一次性质变卡（弹射电弧 / 雷暴）：拿过就不再进池
  if (c.once && (world.cardStacks[c.id] || 0) >= 1) return false;
  // 子弹属性卡的修饰卡：主卡不在手就不进池（06 册说"修饰卡自身不生效"，
  // Demo 选择不发废卡——抽到一张不生效的卡比抽到弱卡更伤口碑）
  const traitReq = BULLET_TRAIT_REQ[c.id];
  if (traitReq && !world.mods?.[traitReq]) return false;
  // 有层数上限的卡（弹道 / 连发 各 3 层）：到顶后不再进池，避免发到"看不出效果"的废卡
  if (c.maxStacks && (world.cardStacks[c.id] || 0) >= c.maxStacks) return false;
  return true;
}

// ── 海克斯池算法（2026-11-02 用户拍板：方案四 = 软衰减 + 硬保底）──
// 目标：玩家可以偏科（越拿某方向越容易继续出），但**单次三选一绝不会被同一方向占满**，
//      永远至少有 1 张来自别的方向，保住"选择感"。
//   软衰减：某方向每拿 1 张卡，该方向后续出现权重 ×0.8（越吃越稀有，冷落方向相对变多）
//   硬保底：单次三选一，同一方向最多出现 2 张（3 张里必有 1 张异向）
const SOFT_DECAY = 0.8;          // 每拿 1 张同方向卡，权重乘子
const MAX_PER_CATEGORY = 2;      // 单次三选一同方向上限

// 卡的"方向"（软衰减与硬保底共用）：学习卡 / 武器线 / 各技能线 / 通用加成
function categoryOf(c) {
  if (c.kind === 'learn') return 'learn';
  return c.target || c.kind;     // weapon / freeze / burn / shock / bonus(通用)
}

// 该卡权重（受所属线等级衰减 × 软衰减）
function weightOf(world, c) {
  const lv = c.target ? (world.slotLevels[c.target] || 0) : 0;
  const taken = c.target ? (world.slotLevels[c.target] || 0) : (world.cardStacks[c.id] || 0);
  return lineDecay(lv) * Math.pow(SOFT_DECAY, taken);
}

function weightedPick(pool) {
  if (!pool.length) return null;
  const total = pool.reduce((s, it) => s + it.weight, 0);
  if (total <= 0) return pool[Math.floor(Math.random() * pool.length)].card;
  let r = Math.random() * total;
  for (const it of pool) { r -= it.weight; if (r <= 0) return it.card; }
  return pool[pool.length - 1].card;
}

// 三选一（03 册三节）
//  · 开局没技能 → 必带 1 张「学习技能卡」
//  · 否则至少 1 张非加成卡（保证深挖有路）
//  · 剩余次数不足时停发新技能卡（03 册停发公式简化：至少留 4 次给新技能成长）
export function rollCards(world) {
  const picks = [];
  const taken = (c) => picks.some((p) => p.id === c.id);
  const buildPool = (filter) => CARDS
    .concat(world.learnPool ? [] : [])
    .filter((c) => eligible(world, c) && (!filter || filter(c)))
    .map((c) => ({ card: c, weight: weightOf(world, c) }));

  const learnedCount = Object.keys(world.skills).length;
  const remaining = MAX_LEVEL - world.level;
  // 停发新技能卡：技能学满 4 槽（9 技能里一局最多选 4 条线）或剩余选择不足 4 次时不再发
  const canLearn = learnedCount < MAX_SKILL_SLOTS && remaining >= 4;

  // 方向计数（硬保底用）：本次三选一里每个方向已占几张
  const catCount = (c) => picks.filter((p) => categoryOf(p) === categoryOf(c)).length;

  // 学习技能卡池（未学的才进池）
  const learnPool = LEARN_CARDS
    .filter((c) => !world.skills[c.target])
    .map((c) => ({ card: c, weight: 1 }));

  // ① 开局一个技能都没有 → 先给技能
  if (learnedCount === 0 && learnPool.length) {
    const first = weightedPick(learnPool);
    if (first) picks.push(first);
  } else {
    // ② 硬保底：至少 1 张非加成卡（武器卡 / 已学技能卡）
    const core = buildPool((c) => c.kind !== 'bonus');
    const pick = weightedPick(core);
    if (pick) picks.push(pick);
  }

  // ③ 补齐到 3 张（可含学习卡，但受停发公式约束）
  //    硬保底：同方向最多 MAX_PER_CATEGORY 张；池子被方向约束榨干时才放宽
  let guard = 0;
  while (picks.length < 3 && guard++ < 80) {
    const rest = buildPool().concat(canLearn ? learnPool : []);
    const pool = rest.filter((it) => !taken(it.card));
    if (!pool.length) break;
    const relaxed = pool.filter((it) => catCount(it.card) < MAX_PER_CATEGORY);
    const c = weightedPick(relaxed.length ? relaxed : pool);
    if (c && !taken(c)) picks.push(c);
  }

  // 功能卡「要塞急救」：作为第 4 张保底卡出现，不挤占正常 3 张
  if (world.mercyArmed && !world.mercyUsed) {
    picks.push(MERCY_CARD);
    world.mercyUsed = true;
    world.mercyArmed = false;
  }
  return picks;
}
