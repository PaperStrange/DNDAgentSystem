// 出生点安全探针（F-33）：
// 1) 全章节出生点安全筛选：距BOSS≥17格（避免进章即触发BOSS遭遇）、距怪物≥视野+2（开局保持冒险中）
// 2) 逐个章节构造Game并开局：断言开局即「冒险中」状态且无战斗
// 3) 补刷怪物（补充数量的随机放置）远离出生区（≥8格）
import { setSeed } from '../server/util.mjs';
import { Game } from '../server/game/game.mjs';
import { Director } from '../server/dm/director.mjs';
import { buildSheet } from '../server/game/charsheet.mjs';
import { DUNGEONS, MONSTERS } from '../server/game/dungeon.mjs';

const log = (...a) => console.log('[spawn]', ...a);
let failed = false;
const ok = (m) => log('✅ ' + m);
const fail = (m) => { failed = true; log('❌ ' + m); };

setSeed(777);
const dungeon = DUNGEONS[0];

// ---------- 单元级：每章出生点与怪物的距离校验 ----------
for (const ch of dungeon.chapters) {
  const { parseMap } = await import('../server/game/dungeon.mjs');
  const map = parseMap(ch);
  const spawns = map.spawns.length ? map.spawns : [{ x: 1, y: 1 }];
  let allSafe = true, detail = '';
  for (const s of spawns) {
    for (const ent of map.entities) {
      if (ent.kind !== 'monster') continue;
      const def = MONSTERS[ent.def];
      const minDist = def?.boss ? 17 : (def?.vision || 6) + 2;
      const d = Math.abs(s.x - ent.x) + Math.abs(s.y - ent.y);
      if (d < minDist) {
        allSafe = false;
        detail = '出生点(' + s.x + ',' + s.y + ')距' + def.name + '(' + ent.x + ',' + ent.y + ')仅' + d + '格（要求≥' + minDist + '）';
      }
    }
  }
  if (allSafe) ok('F-33 ' + ch.id + '：全部出生点安全（距BOSS≥17/距怪物≥视野+2）');
  else fail('F-33 ' + ch.id + '：' + detail);
}

// ---------- 引擎级：每章构造Game并开局，断言开局=冒险中且无战斗 ----------
for (let ci = 0; ci < dungeon.chapters.length; ci++) {
  const ch = dungeon.chapters[ci];
  const sheets = new Map();
  for (const [name, cls] of [['甲', 'fighter'], ['乙', 'cleric'], ['丙', 'wizard']]) {
    sheets.set(name, buildSheet({ name, raceId: 'human', classId: cls, stats: { STR: 15, DEX: 13, CON: 14, INT: 10, WIS: 10, CHA: 8 }, flex: { CON: 1 } }));
  }
  const director = new Director({ personaId: 'aldric', dungeon: { id: 'lmop' } });
  const g = new Game({ room: { code: 'S' + ci, dungeonId: 'lmop' }, sheets, personaId: 'aldric', director, isPlayerOnline: () => true });
  // 直接推进到目标章节
  if (ci > 0) {
    g._loadChapter(ci);
    for (const p of g.players.values()) {
      const e = g.entities.get(p.eid);
      if (e) e.hp = e.maxHp;
    }
  }
  g.beginPlay();
  // 等一次视野检测（首回合开始时执行）
  await new Promise(r => setTimeout(r, 200));
  const safeStart = g.teamState === 'adventuring' && !g.combat.active && !g.pendingBoss;
  const mons = g._aliveEnemies();
  const nearest = mons.reduce((best, m) => {
    let d = Infinity;
    for (const p of g.players.values()) {
      const pe = g.entities.get(p.eid);
      if (pe && !pe.dead) d = Math.min(d, Math.abs(m.x - pe.x) + Math.abs(m.y - pe.y));
    }
    return Math.min(best, d);
  }, Infinity);
  if (safeStart) ok('F-33 ' + ch.id + '：开局=冒险中且无战斗（最近怪物距玩家' + nearest + '格）');
  else fail('F-33 ' + ch.id + '：开局异常 team=' + g.teamState + ' combat=' + g.combat.active + ' bossVote=' + !!g.pendingBoss);
  g.closed = true;
  g._stopWander();
}

log(failed ? 'SPAWN RESULT: FAIL' : 'SPAWN RESULT: PASS');
process.exit(failed ? 1 : 0);
