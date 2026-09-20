// 简化快速车卡：8种族 × 5职业，线性购点，自动派生属性（种族/职业数据共享自 public/shared/char-defs.mjs）
import { attrMod, ATTRS, SKILLS } from '../rules/rulesdb.mjs';
import { RACES, CLASSES, MAX_STAT, MIN_STAT, POINT_POOL } from '../../public/shared/char-defs.mjs';
import { usedPoints } from '../../public/shared/chargen-points.mjs';
export { RACES, CLASSES, MAX_STAT, MIN_STAT, POINT_POOL };

export const MAX_LEVEL = 4;
const STAT_KEYS = ATTRS;

// R1-1：车卡入参合法性校验。非法输入一律拒绝（抛出明确错误），绝不让非法数值进入 sheet。
// 这只是当前阶段的输入防线，不是最终角色权威（角色权威/版本存储属于 R2-1）。
function assertValidSheetInput({ name, raceId, classId, stats, flex, level }) {
  if (typeof name !== 'string' || name.length < 1 || name.length > 20) throw new Error('名字非法（1~20个字符）');
  if (!RACES.some(r => r.id === raceId)) throw new Error('非法种族：' + raceId);
  if (!CLASSES.some(c => c.id === classId)) throw new Error('非法职业：' + classId);
  if (!stats || typeof stats !== 'object' || Array.isArray(stats)) throw new Error('属性点非法');
  const keys = Object.keys(stats);
  if (keys.length !== STAT_KEYS.length || keys.some(k => !STAT_KEYS.includes(k))) throw new Error('属性必须且只能包含 ' + STAT_KEYS.join('/'));
  let spent = 0;
  for (const k of STAT_KEYS) {
    const v = stats[k];
    if (!Number.isInteger(v) || v < MIN_STAT || v > MAX_STAT) throw new Error('属性 ' + k + ' 非法（需为 ' + MIN_STAT + '~' + MAX_STAT + ' 的整数）');
  }
  spent = usedPoints(stats); // R1-22：与客户端/测试共用同一公式，保证「文案=算法」
  if (spent > POINT_POOL) throw new Error('属性购点超出上限（' + spent + '>' + POINT_POOL + '）');
  const race = RACES.find(r => r.id === raceId);
  const flexKeys = Object.keys(flex || {});
  if (flexKeys.some(k => !STAT_KEYS.includes(k))) throw new Error('自由属性只能加在 ' + STAT_KEYS.join('/'));
  for (const k of flexKeys) {
    const v = flex[k];
    if (!Number.isInteger(v) || v < 0) throw new Error('自由属性 ' + k + ' 非法（需为非负整数）');
  }
  if (flexKeys.length > (race.flex || 0)) throw new Error('自由属性数量超出种族上限（' + race.name + '最多' + (race.flex || 0) + '项）');
  if (!Number.isInteger(level) || level < 1 || level > MAX_LEVEL) throw new Error('等级非法（需为 1~' + MAX_LEVEL + ' 的整数）');
}

export function buildSheet({ name, raceId, classId, stats, flex = {}, colors = {}, background = '', look = {}, level = 1, xp = 0 }) {
  assertValidSheetInput({ name, raceId, classId, stats, flex, level });
  const race = RACES.find(r => r.id === raceId);
  const cls = CLASSES.find(c => c.id === classId);
  const final = { ...stats };
  for (const [k, v] of Object.entries(race.stats)) final[k] = (final[k] || 10) + v;
  for (const [k, v] of Object.entries(flex || {})) final[k] = (final[k] || 10) + (Number(v) || 0);
  for (const a of ATTRS) if (!final[a]) final[a] = 10;
  const mods = Object.fromEntries(ATTRS.map(a => [a, attrMod(final[a])]));
  const lv = level; // 跨冒险继承等级（5E：经验与成长随角色保留；已校验为 1~MAX_LEVEL 的整数）
  const hp = cls.hitDie + mods.CON + (race.id === 'dwarf' ? 1 : 0) + (lv - 1) * (cls.hpPerLv + mods.CON + (race.id === 'dwarf' ? 1 : 0));
  const ac = cls.id === 'fighter' ? cls.ac : cls.ac + Math.min(mods.DEX, 2);
  const prof = 2;
  const main = cls.main;
  const meleeBonus = prof + mods[main] + (cls.id === 'fighter' ? 1 : 0);
  const skills = [...cls.skills, ...(race.skills || [])];
  return {
    name: name || '无名冒险者', icon: cls.icon, race: race.id, raceName: race.name, class: cls.id, className: cls.name,
    level: lv, xp: Number(xp) || 0,
    // R1-22：随 sheet 一并下发「基础值 + 自由加点」的原始分配。
    // 注意：stats(=final) 已含种族加成与自由加点，只能用于战斗/派生；界面算购点必须用 base。
    base: { ...stats }, flex: { ...(flex || {}) },
    background: background || '平凡的旅人', colors: { skin: '#e8b88a', hair: '#4a2a18', outfit: '#304878', eye: '#2860a0', accent: '#c8a030', ...colors },
    look: { hair: 0, beard: 0, brow: 0, mouth: 0, marking: 0, ...look },
    stats: final, mods, hp, maxHp: hp, ac, prof, mainAttr: main,
    attackBonus: meleeBonus, damageBonus: mods[main],
    speed: race.speed, skills, spells: cls.spells || [], weapons: cls.weapons,
    features: cls.features.map(f => ({ ...f })), raceFeatures: race.features.map(f => ({ ...f })),
    hitDie: cls.hitDie, hpPerLv: cls.hpPerLv, initiative: mods.DEX,
  };
}

export function levelUp(sheet, level) {
  const s = { ...sheet, level };
  s.maxHp = sheet.hitDie + sheet.mods.CON + (sheet.race === 'dwarf' ? 1 : 0) + (level - 1) * (sheet.hpPerLv + sheet.mods.CON + (sheet.race === 'dwarf' ? 1 : 0));
  s.hp = s.maxHp;
  s.prof = 2 + (level >= 3 ? 1 : 0);
  return s;
}

// 快捷随机车卡（模拟/演示用）
import { pick } from '../util.mjs';
export function randomSheet(seedName) {
  const race = pick(RACES), cls = pick(CLASSES);
  const stats = {};
  let pool = POINT_POOL;
  // R1-30：以 ATTRS（唯一权威清单）旋转派生处理次序 —— 令 cls.main 恰在 index 2（沿用原意图「主属性居中」），
  // 保证 6 项属性各出现一次。原硬编码 ['DEX','CON',cls.main,'WIS','CHA','STR'] 在 cls.main 命中
  // 固定项（STR/DEX/WIS…）时会重复该项、漏掉 INT ⇒ stats.INT 经下方 += 后为 NaN ⇒ buildSheet 校验抛异常。
  const mi = ATTRS.indexOf(cls.main);
  const shift = (mi - 2 + ATTRS.length) % ATTRS.length;
  const order = [...ATTRS.slice(shift), ...ATTRS.slice(0, shift)];
  for (const a of order) { const v = Math.min(MAX_STAT, MIN_STAT + Math.floor(pool / order.length) + (a === cls.main ? 2 : 0)); stats[a] = v; pool -= (v - MIN_STAT); }
  let p = pool; for (const a of ATTRS) { if (p <= 0) break; stats[a] += 1; p -= 1; }
  const flex = {};
  if (race.flex > 0) { const a = pick(['STR', 'DEX', 'CON', 'INT', 'WIS', 'CHA']); flex[a] = 1; if (race.flex > 1) { let b = pick(ATTRS.filter(x => x !== a)); flex[b] = 1; } }
  return buildSheet({ name: seedName, raceId: race.id, classId: cls.id, stats, flex });
}
