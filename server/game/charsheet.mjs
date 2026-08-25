// 简化快速车卡：8种族 × 5职业，线性购点，自动派生属性（种族/职业数据共享自 public/shared/char-defs.mjs）
import { attrMod, ATTRS, SKILLS } from '../rules/rulesdb.mjs';
import { RACES, CLASSES, MAX_STAT, MIN_STAT, POINT_POOL } from '../../public/shared/char-defs.mjs';
export { RACES, CLASSES, MAX_STAT, MIN_STAT, POINT_POOL };

export function buildSheet({ name, raceId, classId, stats, flex = {}, colors = {}, background = '', look = {}, level = 1, xp = 0 }) {
  const race = RACES.find(r => r.id === raceId) || RACES[0];
  const cls = CLASSES.find(c => c.id === classId) || CLASSES[0];
  const final = { ...stats };
  for (const [k, v] of Object.entries(race.stats)) final[k] = (final[k] || 10) + v;
  for (const [k, v] of Object.entries(flex || {})) final[k] = (final[k] || 10) + (Number(v) || 0);
  for (const a of ATTRS) if (!final[a]) final[a] = 10;
  const mods = Object.fromEntries(ATTRS.map(a => [a, attrMod(final[a])]));
  const lv = Math.max(1, Number(level) || 1); // 跨冒险继承等级（5E：经验与成长随角色保留）
  const hp = cls.hitDie + mods.CON + (race.id === 'dwarf' ? 1 : 0) + (lv - 1) * (cls.hpPerLv + mods.CON + (race.id === 'dwarf' ? 1 : 0));
  const ac = cls.id === 'fighter' ? cls.ac : cls.ac + Math.min(mods.DEX, 2);
  const prof = 2;
  const main = cls.main;
  const meleeBonus = prof + mods[main] + (cls.id === 'fighter' ? 1 : 0);
  const skills = [...cls.skills, ...(race.skills || [])];
  return {
    name: name || '无名冒险者', icon: cls.icon, race: race.id, raceName: race.name, class: cls.id, className: cls.name,
    level: lv, xp: Number(xp) || 0,
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
  const order = ['DEX', 'CON', cls.main, 'WIS', 'CHA', 'STR'];
  for (const a of order) { const v = Math.min(MAX_STAT, MIN_STAT + Math.floor(pool / order.length) + (a === cls.main ? 2 : 0)); stats[a] = v; pool -= (v - MIN_STAT); }
  let p = pool; for (const a of ATTRS) { if (p <= 0) break; stats[a] += 1; p -= 1; }
  const flex = {};
  if (race.flex > 0) { const a = pick(['STR', 'DEX', 'CON', 'INT', 'WIS', 'CHA']); flex[a] = 1; if (race.flex > 1) { let b = pick(ATTRS.filter(x => x !== a)); flex[b] = 1; } }
  return buildSheet({ name: seedName, raceId: race.id, classId: cls.id, stats, flex });
}
