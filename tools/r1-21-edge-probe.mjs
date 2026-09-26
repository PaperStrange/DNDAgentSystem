// R1-21 独立复核 · 服务端状态机边界探针（只读产品代码，直接驱动 Rooms 状态机）
//
// 用法：R21_APP_ROOT=<worktree 路径> node tools/r1-21-edge-probe.mjs
// 输出：<R21_OUT_DIR>/r1-21-edge-<label>.json
//
// 覆盖（对抗性边界）：
//   T1 单人房不被「全员就绪」卡住 / T2 room:start 连点幂等
//   T3 未全员就绪不能开始 + 拒绝文案指名
//   T4 核心：A 回房不联动 B；未选择玩家不被拖走
//   T5 全员回房 → 重置 prepare
//   T6 全员 stay 的出口（无死房间）
//   T7 竞态：A 回房 vs B 离开（两种顺序都收敛）
//   T8 房主离开 → 转移（不解散）+ 剩余成员不卡死
//   T9 成员上限(5)/开局后拒绝加入 规则未动
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pathToFileURL } from 'node:url';

const APP_ROOT = process.env.R21_APP_ROOT || join(dirname(fileURLToPath(import.meta.url)), '..');
const LABEL = process.env.R21_LABEL || 'run';
const OUT_DIR = process.env.R21_OUT_DIR || join(APP_ROOT, 'docs', 'qa', 'restart-sprint1', 'r1-21-cr-evidence');
mkdirSync(OUT_DIR, { recursive: true });

const u = (p) => pathToFileURL(join(APP_ROOT, p)).href;
const { Rooms } = await import(u('server/game/rooms.mjs'));
const { buildSheet } = await import(u('server/game/charsheet.mjs'));
const { setSeed } = await import(u('server/util.mjs'));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, detail) => { results.push({ name, ok: !!ok, detail: String(detail) }); console.log((ok ? '✅ ' : '❌ ') + name + ' | ' + detail); };

const sheet = () => ({ name: 'X', raceId: 'human', classId: 'wizard', stats: { STR: 8, DEX: 13, CON: 14, INT: 15, WIS: 10, CHA: 8 }, flex: { CON: 1 } });

function mkRooms() {
  const rooms = new Rooms();
  const names = new Map();
  rooms.bindRegistry((pid) => names.get(pid) || pid, () => true, () => {}, () => 0);
  return { rooms, names };
}
const P = (pid) => ({ pid, name: pid, roomCode: null, account: 'a_' + pid });

async function mkRoom(rooms, code, pids, mode = 'manual') {
  const host = P(pids[0]);
  const { room } = rooms.createRoom(host, { dungeonId: 'lmop', personaId: 'aldric', mode });
  const players = {};
  for (const pid of pids) players[pid] = P(pid);
  host.roomCode = room.code;
  players[pids[0]].roomCode = room.code;
  for (const pid of pids.slice(1)) { players[pid].roomCode = room.code; rooms.joinRoom(room.code, players[pid]); }
  for (const pid of pids) rooms.setSheet(players[pid], sheet());
  return { room, players };
}
async function forceEnded(rooms, room) {
  await rooms.startGame(room);
  let guard = 0;
  while (room.phase !== 'playing' && guard++ < 100) await sleep(30);
  if (room.game && room.game.state !== 'playing') room.game.beginPlay();
  room.game._endGame('defeat', 'probe');
}

const out = { runAt: new Date().toISOString(), appRoot: APP_ROOT, label: LABEL, tests: [] };
const T = (id, desc, ok, detail) => { check('[' + id + '] ' + desc, ok, detail); out.tests.push({ id, desc, ok: !!ok, detail: String(detail) }); };

setSeed(20240521);

// ---------- T1/T2 单人房 ----------
{
  const { rooms } = mkRooms();
  const { room, players } = await mkRoom(rooms, 'S1', ['solo']);
  rooms._roomMsg(players['solo'], { t: 'room:ready', ready: true });
  T('T1a', '单人就绪后仍未自动开局（不被"全员就绪"卡住）', room.phase === 'prepare', 'phase=' + room.phase);
  const r2 = rooms._roomMsg(players['solo'], { t: 'room:start' });
  T('T1b', '单人可显式开局', room.phase === 'intro' || room.phase === 'playing', 'phase=' + room.phase + ' err=' + (r2.err || '-'));
  const g1 = room.game;
  const r3 = rooms._roomMsg(players['solo'], { t: 'room:start' });
  T('T2', 'room:start 连点幂等（第二次被拒、未开第二局）', !!r3.err && room.game === g1, 'err=' + (r3.err || '-'));
}

// ---------- T3 未全员就绪 ----------
{
  const { rooms } = mkRooms();
  const { room, players } = await mkRoom(rooms, 'M1', ['a', 'b']);
  rooms._roomMsg(players['a'], { t: 'room:ready', ready: true });
  const r = rooms._roomMsg(players['a'], { t: 'room:start' });
  T('T3a', '未全员就绪 room:start 被拒（判定未放宽）', !!r.err && room.phase === 'prepare', 'err=' + (r.err || '-') + ' phase=' + room.phase);
  T('T3b', '拒绝文案指名未就绪者', (r.err || '').includes('b'), 'err=' + (r.err || '-'));
  rooms._roomMsg(players['b'], { t: 'room:ready', ready: true });
  T('T3c', '全员就绪自动开局', room.phase !== 'prepare', 'phase=' + room.phase);
}

// ---------- T4 核心：A 回房不联动 B ----------
{
  const { rooms } = mkRooms();
  const { room, players } = await mkRoom(rooms, 'M2', ['a', 'b']);
  await forceEnded(rooms, room);
  T('T4a', '结束后 phase=ended', room.phase === 'ended', 'phase=' + room.phase);
  rooms.returnToRoom(players['a']);
  const vA = rooms.snapshotFor(players['a']);
  const vB = rooms.snapshotFor(players['b']);
  T('T4b', 'A 回房后 A 本人视图=room/waiting', vA.view === 'room' && vA.waiting === true, 'view=' + vA.view + ' waiting=' + vA.waiting);
  T('T4c', '⭐ B 视图未被联动，仍 game/ended', vB.view === 'game' && vB.phase === 'ended', 'view=' + vB.view + ' phase=' + vB.phase);
  T('T4d', 'A 的 waitingFor 指名 B', (vA.waitingFor || []).includes('b'), 'waitingFor=' + JSON.stringify(vA.waitingFor));
  T('T5', '未做选择的玩家(B)不被静默拖走', vB.view === 'game', 'view=' + vB.view);
  rooms.returnToRoom(players['b']);
  T('T5b', '全员回房 → 重置 prepare', room.phase === 'prepare' && room.game === null, 'phase=' + room.phase + ' game=' + (room.game ? 'set' : 'null'));
}

// ---------- T6 全员 stay 的出口 ----------
{
  const { rooms } = mkRooms();
  const { room, players } = await mkRoom(rooms, 'M3', ['a', 'b']);
  await forceEnded(rooms, room);
  rooms.stayAfterEnd(players['a']); rooms.stayAfterEnd(players['b']);
  T('T6a', '全员 stay 时 phase 仍 ended（房间存活）', room.phase === 'ended', 'phase=' + room.phase);
  const vA = rooms.snapshotFor(players['a']);
  T('T6b', 'stay 玩家仍见 game/ended（持有回房按钮）', vA.view === 'game', 'view=' + vA.view);
  rooms.returnToRoom(players['a']);
  const vA2 = rooms.snapshotFor(players['a']);
  T('T6c', 'stay 后仍可回房 → A room/waiting', vA2.view === 'room' && vA2.waiting, 'view=' + vA2.view + ' waiting=' + vA2.waiting);
  rooms.returnToRoom(players['b']);
  T('T6d', '全员回房 → 重置 prepare（出口有效，非死房间）', room.phase === 'prepare', 'phase=' + room.phase);
}

// ---------- T7 竞态：A 回房 vs B 离开（两种顺序） ----------
{
  const { rooms } = mkRooms();
  const { room, players } = await mkRoom(rooms, 'M4', ['a', 'b']);
  await forceEnded(rooms, room);
  rooms.returnToRoom(players['a']);
  T('T7a', '顺序1：A 回房后仍 ended（未凑齐）', room.phase === 'ended', 'phase=' + room.phase);
  rooms.leaveRoom(players['b']);
  T('T7b', '顺序1：B 离开后剩余 A 全回房 → 重置 prepare', room.phase === 'prepare', 'phase=' + room.phase);
}
{
  const { rooms } = mkRooms();
  const { room, players } = await mkRoom(rooms, 'M5', ['a', 'b']);
  await forceEnded(rooms, room);
  rooms.leaveRoom(players['b']);
  T('T7c', '顺序2：B 先离开 → 未重置（A 未回房）', room.phase === 'ended', 'phase=' + room.phase);
  rooms.returnToRoom(players['a']);
  T('T7d', '顺序2：A 回房 → 重置 prepare（两序收敛一致）', room.phase === 'prepare', 'phase=' + room.phase);
}

// ---------- T8 房主离开 → 转移 ----------
{
  const { rooms } = mkRooms();
  const { room, players } = await mkRoom(rooms, 'M6', ['a', 'b']);
  await forceEnded(rooms, room);
  rooms.leaveRoom(players['a']);
  T('T8a', '房主离开 → hostId 转移给 B', room.hostId === 'b', 'hostId=' + room.hostId);
  T('T8b', '房主离开 → 房间未解散', rooms.rooms.has(room.code), 'exists=' + rooms.rooms.has(room.code));
  rooms.returnToRoom(players['b']);
  T('T8c', '剩余成员回房 → 重置 prepare（不卡死）', room.phase === 'prepare', 'phase=' + room.phase);
}

// ---------- T9 成员上限 / 加入规则 ----------
{
  const { rooms } = mkRooms();
  const { room } = await mkRoom(rooms, 'L1', ['h', 'p1', 'p2', 'p3', 'p4']);
  T('T9a', '成员上限仍为 5（满员时 5 人）', room.members.length === 5, 'members=' + room.members.length);
  const extra = P('x'); extra.roomCode = room.code;
  const rj = rooms.joinRoom(room.code, extra);
  T('T9b', '满员(5) 拒绝加入', !!rj.err, 'err=' + (rj.err || '-'));
  await forceEnded(rooms, room);
  const extra2 = P('y'); extra2.roomCode = room.code;
  const rj2 = rooms.joinRoom(room.code, extra2);
  T('T9c', '开局后拒绝加入（加入规则未动）', !!rj2.err, 'err=' + (rj2.err || '-'));
}

const pass = out.tests.filter((t) => t.ok).length;
out.summary = { total: out.tests.length, pass, fail: out.tests.length - pass };
const f = join(OUT_DIR, 'r1-21-edge-' + LABEL + '.json');
writeFileSync(f, JSON.stringify(out, null, 2), 'utf8');
console.log('[r1-21-edge] ' + pass + '/' + out.tests.length + ' PASS');
console.log('[r1-21-edge] 证据：' + f);
process.exit(pass === out.tests.length ? 0 : 1);
