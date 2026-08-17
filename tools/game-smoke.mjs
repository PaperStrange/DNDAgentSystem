// 隔离冒烟测试：直接构造Game，触发战斗，观察回合推进（不经过网络）
import { setSeed } from '../server/util.mjs';
import { Game } from '../server/game/game.mjs';
import { Director } from '../server/dm/director.mjs';
import { buildSheet } from '../server/game/charsheet.mjs';
setSeed(12345);
const sheets = new Map();
const party = [['A', 'fighter'], ['B', 'cleric'], ['C', 'wizard'], ['D', 'rogue'], ['E', 'ranger']];
for (const [name, cls] of party) {
  sheets.set(name, buildSheet({ name, raceId: 'human', classId: cls, stats: { STR: 15, DEX: 13, CON: 14, INT: 10, WIS: 10, CHA: 8 }, flex: { CON: 1 } }));
}
const director = new Director({ personaId: 'aldric', dungeon: { id: 'lmop' } });
const g = new Game({ room: { code: 'TEST', dungeonId: 'lmop' }, sheets, personaId: 'aldric', director });
g.beginPlay();
console.log('开局 state=' + g.state + ' turn=' + JSON.stringify(g.turn));
const p0 = g.players.get('A');
const foe = [...g.entities.values()].find(e => e.kind === 'monster');
console.log('目标怪物 @(' + foe.x + ',' + foe.y + ')');
const e0 = g.entities.get(p0.eid);
e0.x = foe.x; e0.y = Math.min(g.map.h - 2, foe.y + 1);
const r = g.actAttack('A', { targetEid: foe.eid });
console.log('攻击结果:', JSON.stringify(r), '战斗:', JSON.stringify(g.combat.order.length) + '人参战');
let t = 0;
let lastRound = 0;
const iv = setInterval(() => {
  t += 500;
  // 驱动玩家回合：自动结束（验证回合循环、怪物AI、伤害、TPK）
  if (g.turn && g.turn.kind === 'player' && g.state === 'playing') {
    const pid = g.turn.playerId;
    // 若相邻有敌人则攻击，否则结束回合
    const pe = g.entities.get(g.turn.actorEid);
    const foe = [...g.entities.values()].find(e => e.kind === 'monster' && !e.dead && Math.abs(e.x - pe.x) + Math.abs(e.y - pe.y) <= 1);
    if (foe) g.actAttack(pid, { targetEid: foe.eid });
    else g.actEndTurn(pid);
  }
  if (g.combat.round !== lastRound) { lastRound = g.combat.round; console.log('--- 第' + lastRound + '回合 ---'); }
  if (t % 3000 === 0 || g.state !== 'playing') {
    const turnDesc = g.turn ? (g.turn.kind + ':' + (g.turn.playerId || g.turn.actorEid)) : '无';
    const alive = g._aliveEnemies().filter(x => !x.dead).length;
    console.log('t=' + t + 'ms round=' + g.combat.round + ' turn=' + turnDesc + ' 存活敌=' + alive + ' state=' + g.state);
    if (g.state === 'ended') {
      console.log('✅ 引擎全程推进至结束: kind=' + g.win.kind + ' reason=' + g.win.reason);
      console.log('日志条目数=' + g.log.length);
      clearInterval(iv);
      process.exit(0);
    }
  }
  if (t > 60000) { console.log('❌ 60秒未结束'); clearInterval(iv); process.exit(1); }
}, 500);
