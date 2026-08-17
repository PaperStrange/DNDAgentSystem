// 隔离复现：城镇章1名打手vs5玩家，驱动与机器人完全一致的策略循环
import { setSeed } from '../server/util.mjs';
import { Game } from '../server/game/game.mjs';
import { Director } from '../server/dm/director.mjs';
import { buildSheet } from '../server/game/charsheet.mjs';
import { createPolicy } from '../public/shared/autoplay-policy.mjs';

setSeed(20240521);
const sheets = new Map();
const party = [['A', 'fighter'], ['B', 'cleric'], ['C', 'wizard'], ['D', 'rogue'], ['E', 'ranger']];
for (const [name, cls] of party) {
  sheets.set(name, buildSheet({ name, raceId: 'human', classId: cls, stats: { STR: 15, DEX: 13, CON: 14, INT: 10, WIS: 10, CHA: 8 }, flex: { CON: 1 } }));
}
const director = new Director({ personaId: 'aldric', dungeon: { id: 'lmop' } });
const g = new Game({ room: { code: 'T', dungeonId: 'lmop' }, sheets, personaId: 'aldric', director });
// 直接加载城镇章（索引2）
g.chapterIdx = 2;
g._loadChapter(2);
// 升级到2级模拟正常进度
for (const [pid, p] of g.players) { g._levelUp(p, 2); }
g.beginPlay();

// 找到打手并让玩家围上去
const foes = g._aliveEnemies();
console.log('打手数:', foes.length);
const foe = foes[0];
// 传送到距离打手约10-15格的远点（复现真实模拟的追击场景）
const spots = [];
for (let dy = -12; dy <= 12; dy++) for (let dx = -12; dx <= 12; dx++) {
  const x = foe.x + dx, y = foe.y + dy;
  const t = g.map.tiles[y] && g.map.tiles[y][x];
  if (t && !t.blockMove && (Math.abs(dx) + Math.abs(dy)) >= 8 && (Math.abs(dx) + Math.abs(dy)) <= 14) spots.push({ x, y });
}
let si = 0;
for (const [pid, p] of g.players) {
  const e = g.entities.get(p.eid);
  const s = spots[si++ % spots.length];
  e.x = s.x; e.y = s.y;
  console.log(p.name + ' 传送到 (' + e.x + ',' + e.y + ') 打手@(' + foe.x + ',' + foe.y + ') 距离=' + (Math.abs(e.x - foe.x) + Math.abs(e.y - foe.y)));
}
const policy = createPolicy();
let attacks = 0, moves = 0, endturns = 0, t = 0;
const iv = setInterval(() => {
  t += 400;
  const turn = g.turn;
  if (!turn || turn.kind !== 'player') {
    // 等怪物回合自然结束
    return;
  }
  const pid = turn.playerId;
  const view = g.snapshotFor(pid);
  const act = policy.decide(view, pid);
  if (!act) return;
  if (act.type === 'attack') { attacks++; g.actAttack(pid, { targetEid: act.targetEid }); }
  else if (act.type === 'move') { moves++; const r = g.actMove(pid, { x: act.x, y: act.y }); if (!r.ok) { console.log('move失败: ' + r.msg + ' ' + pid + ' -> ' + act.x + ',' + act.y); } }
  else if (act.type === 'endturn') { endturns++; g.actEndTurn(pid); }
  else if (act.type === 'cast') { g.actCast(pid, { spellId: act.spellId, targetEid: act.targetEid, x: act.x, y: act.y }); }
  else if (act.type === 'item') { g.actUseItem(pid, { itemId: act.itemId, targetEid: act.targetEid, x: act.x, y: act.y }); }
  if (t % 5000 === 0) {
    const alive = g._aliveEnemies().length;
    const pos = g.players.get(pid) ? (() => { const e = g.entities.get(g.players.get(pid).eid); return e ? e.name + '@(' + e.x + ',' + e.y + ') 距打手' + (Math.abs(e.x - foe.x) + Math.abs(e.y - foe.y)) : '?'; })() : '?';
    console.log('t=' + t + ' 攻击' + attacks + ' 移动' + moves + ' 结束' + endturns + ' 存活敌=' + alive + ' | ' + pos);
  }
  if (!g._aliveEnemies().length) {
    console.log('✅ 打手被消灭！攻击' + attacks + ' 移动' + moves);
    clearInterval(iv);
    process.exit(0);
  }
  if (t > 45000) {
    console.log('❌ 45秒未消灭：攻击' + attacks + ' 移动' + moves + ' 结束' + endturns);
    for (const [pid, p] of g.players) { const e = g.entities.get(p.eid); console.log('  ' + p.name + '@(' + e.x + ',' + e.y + ') hp=' + e.hp); }
    clearInterval(iv);
    process.exit(1);
  }
}, 400);
