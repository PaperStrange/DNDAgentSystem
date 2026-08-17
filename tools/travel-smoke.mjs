// 出口传送单元测试：击杀全部序章怪物后，互动出口应传送到第一章
import { setSeed } from '../server/util.mjs';
import { Game } from '../server/game/game.mjs';
import { Director } from '../server/dm/director.mjs';
import { buildSheet } from '../server/game/charsheet.mjs';
setSeed(99);
const sheets = new Map();
sheets.set('A', buildSheet({ name: 'A', raceId: 'human', classId: 'fighter', stats: { STR: 15, DEX: 13, CON: 14, INT: 10, WIS: 10, CHA: 8 }, flex: { CON: 1 } }));
const director = new Director({ personaId: 'aldric', dungeon: { id: 'lmop' } });
const g = new Game({ room: { code: 'T', dungeonId: 'lmop' }, sheets, personaId: 'aldric', director });
g.beginPlay();
console.log('chapter:', g.chapter.id, 'state:', g.state);
// 直接杀光所有怪物
for (const e of g._aliveEnemies()) {
  const wasActive = g.combat.active;
  g._killMonster(e, g.players.get('A'));
  if (g.combat.active && !g._aliveEnemies().length) g._endCombat();
}
console.log('存活敌:', g._aliveEnemies().length, 'flags:', [...g.flags]);
console.log('deadSquads:', [...g.deadSquads]);
console.log('目标达成flag obj:clear_ambush =', g.flags.has('obj:clear_ambush'));
const exit = g.map.exit;
console.log('出口 @', JSON.stringify(exit));
// 把玩家移到出口旁
const p = g.players.get('A');
const e = g.entities.get(p.eid);
e.x = exit.x - 1; e.y = exit.y;
g.turn = { actorEid: e.eid, playerId: 'A', kind: 'player', moveLeft: 6, actionUsed: false, bonusUsed: false };
const res = g.actInteract('A', { tx: exit.x, ty: exit.y });
console.log('interact结果:', JSON.stringify(res));
console.log('当前chapter:', g.chapter.id, '（应为 ch1）');
process.exit(g.chapter.id === 'ch1' ? 0 : 1);
