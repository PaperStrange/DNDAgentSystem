// R1-F3 全灭结算补测 · 引擎层（确定性、无网络）
//
// 目的：用**确定性**方式坐实「全灭 → win.kind='defeat'」的服务端语义，并回答关键口径问题：
//   「全灭」的判定是**全员 downed（倒地）** 还是 **全员 dead（阵亡）**？
//
// 手法：直接构造 Game（同 tools/game-smoke.mjs / town-fight-smoke.mjs 的既有做法），
//   通过**真实伤害管线** `_applyDamage` → `_downPlayer` → `_checkTpk` 触发，不 mock、不伪造 win。
// 只读既有产品代码；本脚本不修改任何产品代码。
//
// 输出：<OUT_DIR>/r1-f3-engine-tpk.json
import { setSeed } from '../server/util.mjs';
import { Game } from '../server/game/game.mjs';
import { Director } from '../server/dm/director.mjs';
import { buildSheet } from '../server/game/charsheet.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const OUT_DIR = process.env.F3_OUT_DIR || join(process.cwd(), 'docs', 'qa', 'restart-sprint1', 'r1-f3-evidence');
mkdirSync(OUT_DIR, { recursive: true });

const mkSheet = (name, cls) => buildSheet({
  name, raceId: 'human', classId: cls,
  stats: { STR: 15, DEX: 13, CON: 14, INT: 10, WIS: 10, CHA: 8 }, flex: { CON: 1 },
});
const mkGame = (code, party) => {
  const sheets = new Map(party.map(([n, c]) => [n, mkSheet(n, c)]));
  const director = new Director({ personaId: 'aldric', dungeon: { id: 'lmop' } });
  return new Game({ room: { code, dungeonId: 'lmop', mode: 'manual' }, sheets, personaId: 'aldric', director });
};
const snapWin = (g) => (g.win ? { kind: g.win.kind, reason: g.win.reason, duration: g.win.duration, at: g.win.at } : null);

const out = { runAt: new Date().toISOString(), cases: [] };

// ============ Case 1：单人 —— 只「倒地」不「阵亡」，是否即判 defeat ============
setSeed(20240521);
{
  const g = mkGame('C1', [['A', 'fighter']]);
  g.beginPlay();
  const p = g.players.get('A');
  const e = g.entities.get(p.eid);
  const foe = [...g.entities.values()].find((x) => x.kind === 'monster');
  e.hp = 1; // 只差 1 点即倒
  const before = { state: g.state, hp: e.hp, eDowned: !!e.downed, pDowned: !!p.downed, eDead: !!e.dead, pDead: !!p.dead, win: snapWin(g) };
  g._applyDamage(e, 999, foe, { type: '补测' }); // 走真实伤害管线
  const after = { state: g.state, hp: e.hp, eDowned: !!e.downed, pDowned: !!p.downed, eDead: !!e.dead, pDead: !!p.dead, win: snapWin(g) };
  out.cases.push({
    id: 'C1', desc: '单人：唯一玩家被打到 0 HP（倒地，未阵亡）→ 是否 defeat',
    before, after,
    verdict: after.win && after.win.kind === 'defeat' ? 'PASS' : 'FAIL',
    note: '若 after.pDowned=true 且 after.pDead=false 而 win.kind=defeat ⇒ 证明「全员倒地即全灭」，无需全员阵亡',
  });
}

// ============ Case 2：多人（2人）—— 只倒 1 人不得判 defeat；倒第 2 人才判 ============
setSeed(20240521);
{
  const g = mkGame('C2', [['A', 'fighter'], ['B', 'wizard']]);
  g.beginPlay();
  const foe = [...g.entities.values()].find((x) => x.kind === 'monster');
  const pa = g.players.get('A'), pb = g.players.get('B');
  const ea = g.entities.get(pa.eid), eb = g.entities.get(pb.eid);
  ea.hp = 1; eb.hp = 1;
  const s0 = { state: g.state, win: snapWin(g) };
  g._applyDamage(ea, 999, foe, { type: '补测' }); // 只倒 A
  const s1 = { state: g.state, aDowned: !!ea.downed, bDowned: !!eb.downed, win: snapWin(g) };
  g._applyDamage(eb, 999, foe, { type: '补测' }); // 再倒 B
  const s2 = { state: g.state, aDowned: !!ea.downed, bDowned: !!eb.downed, win: snapWin(g) };
  out.cases.push({
    id: 'C2', desc: '多人(2)：只倒 1 人应仍 playing；两人全倒才 defeat',
    s0, s1, s2,
    verdict: (s1.win === null && s1.state === 'playing' && s2.win && s2.win.kind === 'defeat') ? 'PASS' : 'FAIL',
    note: 's1.win=null 且 state=playing ⇒ 未过度触发；s2.win.kind=defeat ⇒ 全员倒地即全灭',
  });
}

// ============ Case 3：多人（2人）—— 一人「阵亡」一人「倒地」是否判全灭 ============
setSeed(20240521);
{
  const g = mkGame('C3', [['A', 'fighter'], ['B', 'wizard']]);
  g.beginPlay();
  const foe = [...g.entities.values()].find((x) => x.kind === 'monster');
  const pa = g.players.get('A'), pb = g.players.get('B');
  const ea = g.entities.get(pa.eid), eb = g.entities.get(pb.eid);
  eb.hp = 1;
  g._applyDamage(eb, 999, foe, { type: '补测' }); // B 倒地（非阵亡）
  const s1 = { state: g.state, aDowned: !!ea.downed, bDowned: !!eb.downed, win: snapWin(g) };
  g._killPlayer(pa); // A 直接阵亡（走真实 _killPlayer → _checkTpk）
  const s2 = { state: g.state, aDead: !!pa.dead, bDowned: !!pb.downed, win: snapWin(g) };
  out.cases.push({
    id: 'C3', desc: '多人(2)：A 阵亡 + B 倒地（无人站立）→ 是否 defeat',
    s1, s2,
    verdict: (s1.win === null && s2.win && s2.win.kind === 'defeat') ? 'PASS' : 'FAIL',
    note: '证明判定口径 = 「无人处于站立(!dead&&!downed)」，dead 与 downed 任一皆计入「倒下」',
  });
}

// ============ Case 4：win 载荷结构 ============
{
  const w = out.cases.find((c) => c.id === 'C1')?.after?.win;
  out.winPayloadShape = w ? { keys: Object.keys(w), kind: w.kind, reasonType: typeof w.reason, durationType: typeof w.duration } : null;
}

const pass = out.cases.filter((c) => c.verdict === 'PASS').length;
out.summary = { total: out.cases.length, pass, fail: out.cases.length - pass };
const file = join(OUT_DIR, 'r1-f3-engine-tpk.json');
writeFileSync(file, JSON.stringify(out, null, 2), 'utf8');
console.log('[f3-engine] ' + pass + '/' + out.cases.length + ' PASS');
console.log('[f3-engine] 证据：' + file);
process.exit(pass === out.cases.length ? 0 : 1);
