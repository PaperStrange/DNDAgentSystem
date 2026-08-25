// S1-5 临时验证：构造Game→触发战斗/击杀/倒地，检查日志 imp 标签
import { setSeed } from '../server/util.mjs';
import { Game } from '../server/game/game.mjs';
import { Director } from '../server/dm/director.mjs';
import { buildSheet } from '../server/game/charsheet.mjs';

setSeed(42);
const sheets = new Map();
const party = [['A', 'fighter'], ['B', 'cleric']];
for (const [name, cls] of party) {
  sheets.set(name, buildSheet({ name, raceId: 'human', classId: cls, stats: { STR: 15, DEX: 13, CON: 14, INT: 10, WIS: 10, CHA: 8 }, flex: { CON: 1 } }));
}
const director = new Director({ personaId: 'aldric', dungeon: { id: 'lmop' } });
const g = new Game({ room: { code: 'T', dungeonId: 'lmop' }, sheets, personaId: 'aldric', director });
g.beginPlay();

const p0 = g.players.get('A');
const e0 = g.entities.get(p0.eid);
const foe = [...g.entities.values()].find(e => e.kind === 'monster');

// 触发战斗（近战相邻）
e0.x = foe.x; e0.y = Math.min(g.map.h - 2, foe.y + 1);
g.actAttack('A', { targetEid: foe.eid });

// 强制击杀怪物（另找一只存活怪物，确保重击伤害日志可产出）
const foe2 = [...g.entities.values()].find(e => e.kind === 'monster' && !e.dead && e !== foe) || foe;
foe2.hp = 1;
g._applyDamage(foe2, 99, e0, { type: '物理', crit: true });

// 强制玩家倒地
const pe = [...g.players.values()][1];
const peEnt = g.entities.get(pe.eid);
g._applyDamage(peEnt, 999, foe, { type: '物理' });

// 死亡豁免失败路径
pe.deathSaves = { s: 0, f: 2 };

const keys = g.log.filter(l => l.imp === 'key');
const minors = g.log.filter(l => l.imp === 'minor');
console.log('== imp=key (' + keys.length + ') ==');
for (const l of keys) console.log('  [' + l.kind + '] ' + l.text);
console.log('== imp=minor (' + minors.length + ') ==');
for (const l of minors.slice(0, 8)) console.log('  [' + l.kind + '] ' + l.text);

let fail = 0;
const must = (re, name) => {
  if (!keys.some(l => re.test(l.text))) { console.log('FAIL: 缺少关键日志 ' + name); fail++; }
};
must(/战斗开始/, '战斗开始');
must(/被击败/, '怪物被击败');
must(/倒下了/, '玩家倒地');
must(/受到.*重击/, '重击伤害');
if (!minors.length) { console.log('WARN: 无 minor 日志（可能全部命中为关键路径）'); }
if (!g.log.some(l => l.imp === 'minor' && /攻击/.test(l.text))) { console.log('WARN: 攻击骰未见 minor 样本'); }
console.log(fail === 0 ? 'S1-5 验证通过' : 'S1-5 验证失败: ' + fail + '项');
process.exit(fail === 0 ? 0 : 1);
