// 复现瑟琳卡住之谜：cave章节，(18,4)出生点，用完整策略循环驱动
import { setSeed } from '../server/util.mjs';
import { Game } from '../server/game/game.mjs';
import { Director } from '../server/dm/director.mjs';
import { buildSheet } from '../server/game/charsheet.mjs';
import { createPolicy } from '../public/shared/autoplay-policy.mjs';

setSeed(20240521);
const sheets = new Map();
for (const [n, c] of [['A', 'fighter'], ['B', 'cleric'], ['C', 'wizard'], ['D', 'rogue'], ['E', 'ranger']]) {
  sheets.set(n, buildSheet({ name: n, raceId: 'human', classId: c, stats: { STR: 15, DEX: 13, CON: 14, INT: 10, WIS: 10, CHA: 8 }, flex: { CON: 1 } }));
}
const director = new Director({ personaId: 'aldric', dungeon: { id: 'lmop' } });
const g = new Game({ room: { code: 'T', dungeonId: 'lmop' }, sheets, personaId: 'aldric', director });
g.chapterIdx = 5;
g._loadChapter(5);
for (const [pid, p] of g.players) { g._levelUp(p, 3); }
g.beginPlay();
// 记录瑟琳位置
const selin = g.players.get('B');
const selinE = g.entities.get(selin.eid);
console.log('瑟琳出生点: (' + selinE.x + ',' + selinE.y + ')');
// 驱动：所有玩家回合用策略，怪物回合自然进行
const policy = createPolicy();
let t = 0, selinMoves = 0;
const iv = setInterval(() => {
  t += 300;
  if (g.state !== 'playing') { console.log('游戏状态: ' + g.state); clearInterval(iv); process.exit(0); }
  const turn = g.turn;
  if (!turn || turn.kind !== 'player') return;
  const pid = turn.playerId;
  const view = g.snapshotFor(pid);
  const act = policy.decide(view, pid);
  if (!act) return;
  if (pid === 'B') selinMoves++;
  if (act.type === 'attack') g.actAttack(pid, { targetEid: act.targetEid });
  else if (act.type === 'move') {
    const before = g.entities.get(g.players.get(pid).eid);
    const r = g.actMove(pid, { x: act.x, y: act.y });
    if (pid === 'B') {
      console.log('t=' + t + ' 瑟琳@(' + before.x + ',' + before.y + ') move→(' + act.x + ',' + act.y + ') 结果:' + (r.ok ? 'ok 现在(' + before.x + ',' + before.y + ')' : 'FAIL ' + r.msg));
    }
  }
  else if (act.type === 'cast') g.actCast(pid, { spellId: act.spellId, targetEid: act.targetEid, x: act.x, y: act.y });
  else if (act.type === 'item') g.actUseItem(pid, { itemId: act.itemId, targetEid: act.targetEid, x: act.x, y: act.y });
  else if (act.type === 'interact') g.actInteract(pid, { targetEid: act.targetEid, tx: act.tx, ty: act.ty });
  else if (act.type === 'dialogue') g.actDialogueOption(pid, { optionId: act.optionId });
  else if (act.type === 'endturn') g.actEndTurn(pid);
  else if (act.type === 'rest') g.actShortRest(pid);
  else if (act.type === 'search') g.actSearch(pid);
  if (t > 40000) { console.log('40秒结束 瑟琳移动次数: ' + selinMoves); clearInterval(iv); process.exit(0); }
}, 300);
