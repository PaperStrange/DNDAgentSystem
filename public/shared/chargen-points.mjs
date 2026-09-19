// R1-22：车卡「购点」计算的唯一真源。
// 服务端校验（charsheet.mjs）、客户端车卡界面（screens/room.mjs）与测试共用同一套公式，
// 杜绝「文案对、算法错」或「客户端与服务端各算各的」导致的剩余点数不一致。
//
// 既定规则（本卡不得改动）：基础值下限 8 / 上限 15，购点池 27；
// **种族加成与自由加点不计入购点**。
import { MIN_STAT, MAX_STAT, POINT_POOL } from './char-defs.mjs';

export const ATTR_KEYS = ['STR', 'DEX', 'CON', 'INT', 'WIS', 'CHA'];

// 购点花费：只累加「基础值」，即 Σ(base − MIN_STAT)。
// 传入的必须是基础值（不含种族加成、不含自由加点）——见 baseStatsOf()。
export function usedPoints(baseStats) {
  if (!baseStats || typeof baseStats !== 'object') return 0;
  let spent = 0;
  for (const k of ATTR_KEYS) {
    const v = Number(baseStats[k]);
    if (Number.isFinite(v)) spent += v - MIN_STAT;
  }
  return spent;
}

// 剩余点数 = 池 − 基础花费。任何合法加点状态下必然 ≥ 0。
export function remainingPoints(baseStats) {
  return POINT_POOL - usedPoints(baseStats);
}

// 从服务端 sheet 还原「基础值」（供界面编辑 / 重新计算剩余点数）：
//   1) 优先用显式 sheet.base —— R1-22 修复后服务端随 sheet 一并下发原始分配；
//   2) 回退：final − 种族加成 − 自由加点 —— 兼容未下发 base 的旧数据。
// 注意：sheet.stats 是**最终值**（已含种族加成+自由加点），绝不能直接当基础值算购点。
export function baseStatsOf(sheet, raceDef) {
  if (!sheet) return null;
  if (sheet.base && typeof sheet.base === 'object') {
    const out = {};
    for (const k of ATTR_KEYS) out[k] = Number(sheet.base[k]);
    return out;
  }
  const final = sheet.stats || {};
  const racial = (raceDef && raceDef.stats) || {};
  const flex = sheet.flex || {};
  const out = {};
  for (const k of ATTR_KEYS) {
    out[k] = (Number(final[k]) || MIN_STAT) - (Number(racial[k]) || 0) - (Number(flex[k]) || 0);
  }
  return out;
}

// 把自由加点对象 { STR:1, CON:2 } 展开成槽位数组 ['STR','CON','CON']（界面按槽位编辑）。
export function flexSlots(flex) {
  const out = [];
  for (const k of ATTR_KEYS) {
    const n = Math.max(0, Math.floor(Number(flex && flex[k]) || 0));
    for (let i = 0; i < n; i++) out.push(k);
  }
  return out;
}

// 槽位数组 → 自由加点对象（保存时使用）。
export function flexFromSlots(slots) {
  const out = {};
  for (const a of slots || []) out[a] = (out[a] || 0) + 1;
  return out;
}

export { MIN_STAT, MAX_STAT, POINT_POOL };
