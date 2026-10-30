// 14 册 §三 / §五 / §八·一 —— 状态注册表与抗性表（引擎无关，纯数据）
// 本文件只描述"有哪些状态、它们怎么叠加、目标怎么抵抗"，不含任何渲染代码。

// 状态定义。category 用于抗性表查表；tags 用于 UI / 抗性 / 图鉴按 tag 渲染
export const STATUS_DEFS = {
  slow:   { id: 'slow',   name: '减速', category: 'slow',    tags: ['SLOW'],                       stackPolicy: 'MAX_ONLY' },
  shock:  { id: 'shock',  name: '感电', category: 'slow',    tags: ['SLOW', 'AMPLIFY_MOVE'],       stackPolicy: 'MAX_ONLY' },
  freeze: { id: 'freeze', name: '冻结', category: 'hardCC',  tags: ['HARD_CC'],                    stackPolicy: 'REFRESH' },
  stun:   { id: 'stun',   name: '眩晕', category: 'hardCC',  tags: ['HARD_CC'],                    stackPolicy: 'NON_STACKABLE' },
  burn:   { id: 'burn',   name: '灼烧', category: 'dot',     tags: ['DOT'],                        stackPolicy: 'INDEPENDENT' },
  knock:  { id: 'knock',  name: '击退', category: 'knock',   tags: ['DISPLACE'],                   stackPolicy: 'INDEPENDENT' },
  vuln:   { id: 'vuln',   name: '易伤', category: 'amplify', tags: ['AMPLIFY'],                    stackPolicy: 'NON_STACKABLE' },
};

// 幅度类状态（折后系数下限 ×0.05 的生效范围）：slow 幅度 / vuln 放大 / knock 位移距离
export const MAGNITUDE_TYPES = new Set(['slow', 'amplify', 'knock']);

// 抗性表（14 册 §五），按 目标类型 × 状态类别 → {mag, dur}
//   装甲兵：减速幅度 x0.5 时长不打折；击退位移 x0.25（普通位移）；硬控不免疫
//   精英怪：减/击/控 全部 x0.40
//   Boss  ：全部 x0.10（04 册：不免疫控制，只给极低倍率）
const RESIST = {
  armored: { slow: { mag: 0.5, dur: 1.0 }, knock: { mag: 0.25, dur: 1.0 }, hardCC: { mag: 1.0, dur: 1.0 } },
  elite:   { slow: { mag: 0.4, dur: 0.4 }, knock: { mag: 0.4, dur: 0.4 },   hardCC: { mag: 0.4, dur: 0.4 } },
  boss:    { slow: { mag: 0.1, dur: 0.1 }, knock: { mag: 0.1, dur: 0.1 },   hardCC: { mag: 0.1, dur: 0.1 } },
};

export function resolveResistance(targetType, category) {
  if (targetType === 'normal' || !RESIST[targetType]) return { mag: 1.0, dur: 1.0 };
  return RESIST[targetType][category] || { mag: 1.0, dur: 1.0 };
}

// 装甲兵 tag 级屏蔽：免疫"击飞 / 强制位移"(launch)，普通位移(normal)仍生效（05 册）
// 注意：这是 tag 级屏蔽，不走乘法器，与折后下限是两回事
export function isTagBlocked(targetType, displaceType) {
  return targetType === 'armored' && displaceType === 'launch';
}

// 折后系数下限（14 册 §八·一）。保险丝，不是常规杠杆；当前无任何组合会触发
export const MAG_FLOOR = 0.05;

// 冻结 DR 阶梯（14 册 §八·一）：自上次冻结结束起 10s 窗口内，第 n 次时长 ×(1/2)^(n-1)
// 第 4 次起免疫。当前数值下根本触发不到第 2 档，纯预防性立规矩
export const FREEZE_DR_WINDOW_MS = 10000;
export const FREEZE_DR_STEP = 0.5;
export const FREEZE_DR_MAX_COUNT = 3; // 允许第 1/2/3 次，第 4 次起免疫
