// R1-31 回归用例 —— kickRoom 不清被踢者 roomCode + snapshotFor 不校验成员资格
//
// 缺陷（engineering-lead-2 在 R1-29 排查中发现；R1-27 复核 F2 独立复现）：
//   · Rooms.kickRoom 只把被踢者移出 members，**不清其 roomCode**；
//   · Rooms.snapshotFor 入口只认 player.roomCode、**不校验成员资格**；
//   ⇒ 被踢者（roomCode 陈旧）仍能拿到房间/局内快照；且能在 prepare 阶段直发
//     room:charsheet / room:ready 写回状态。修前依赖 index.mjs 调用侧兜底（本卡消除该依赖）。
//   附带：kickRoom 的 removePlayer 阶段集仅 playing|confirm ⇒ ended 阶段被踢者残留于 game.players。
//
// 修法（B + C + BL-30 守卫统一）：
//   B：抽 _removeMember(room,pid,{byKick,player}) 单一真源，leaveRoom/kickRoom 共用（含清 roomCode、
//      removePlayer 阶段集统一为 4 阶段 playing|intro|confirm|ended）；
//   C：snapshotFor 入口用 isMember 加成员资格护栏（非成员回落大厅视图）；
//   BL-30：room.confirmed 全部访问统一为 ?. 防御式。
//
// 本用例为 Node 级（直接驱动真实 Rooms，不 mock、不启服务），覆盖「被踢后再次请求快照」等验收点。
// DND_DATA_DIR 指向临时目录，避免 _endGame 落盘污染仓库 data/。
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const TMP = mkdtempSync(join(tmpdir(), 'r1-31-test-'));
process.env.DND_OFFLINE = '1';
process.env.DND_DATA_DIR = TMP;
// 记录所有构造的房间：结束时统一 _close（清 confirm 计时器与 game 计时器），
// 否则 R1-27 的 180s 确认门定时器 / 局内节拍器会阻止测试进程退出。
const CREATED = [];
after(() => {
  for (const { rooms, room } of CREATED) { try { rooms._close(room); } catch { /* ignore */ } }
  try { rmSync(TMP, { recursive: true, force: true }); } catch { /* ignore */ }
});

// 动态 import：确保 DND_DATA_DIR 在 paths.mjs 求值前已设置
const { Rooms } = await import('../../server/game/rooms.mjs');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const P = (pid) => ({ pid, name: pid, roomCode: null, account: 'a_' + pid });
const SHEET = (n) => ({ name: n, raceId: 'human', classId: 'wizard', stats: { STR: 8, DEX: 13, CON: 14, INT: 15, WIS: 10, CHA: 8 }, flex: { CON: 1 }, colors: {}, look: {}, background: 'x', level: 1, xp: 0 });

function mkRooms() {
  const rooms = new Rooms();
  const registry = new Map(); // pid -> player 对象（模拟 index.mjs 的 players 注册表）
  rooms.bindRegistry(
    (pid) => pid,
    () => true,
    () => {},
    () => 0,
    (pid) => registry.get(pid) || null, // R1-31：第 5 参「按 pid 取 player」
  );
  return { rooms, registry };
}
async function mkRoom(rooms, registry, pids) {
  const host = P(pids[0]);
  const { room } = rooms.createRoom(host, { dungeonId: 'lmop', personaId: 'aldric', mode: 'manual' });
  const players = {};
  for (const pid of pids) players[pid] = P(pid);
  players[pids[0]].roomCode = room.code;
  for (const pid of pids.slice(1)) { players[pid].roomCode = room.code; rooms.joinRoom(room.code, players[pid]); }
  for (const pid of pids) { registry.set(pid, players[pid]); rooms.setSheet(players[pid], SHEET(pid)); }
  CREATED.push({ rooms, room });
  return { room, players };
}
async function toPhase(rooms, room, target) {
  await rooms.startGame(room);
  let g = 0; while (room.phase !== 'confirm' && g++ < 400) await sleep(10);
  if (target === 'confirm') return;
  for (const pid of room.members.slice()) rooms.confirmStart({ pid, roomCode: room.code });
  g = 0; while (room.phase !== 'playing' && g++ < 400) await sleep(10);
  if (target === 'playing') return;
  if (target === 'ended') { room.game._endGame('defeat', 'test'); g = 0; while (room.phase !== 'ended' && g++ < 200) await sleep(10); }
}
const view = (rooms, p) => rooms.snapshotFor(p).view;

// ---------------------------------------------------------------------------
// 1. 被踢后 roomCode 为空 + 快照落 lobby（验收点 1/2，四阶段各测）
// ---------------------------------------------------------------------------
for (const phase of ['prepare', 'confirm', 'playing', 'ended']) {
  test('kickRoom@' + phase + '：被踢者 roomCode 被清空，且 snapshotFor 落 lobby（非 room/game）', async () => {
    const { rooms, registry } = mkRooms();
    const { room, players } = await mkRoom(rooms, registry, ['A', 'B']);
    if (phase !== 'prepare') await toPhase(rooms, room, phase);
    const B = players['B'];
    assert.notEqual(B.roomCode, null, '前置：被踢前 roomCode 指向房间');
    const res = rooms.kickRoom(players['A'], 'B');
    assert.equal(res.kicked, true, '踢人应成功');
    assert.equal(B.roomCode, null, '被踢后 roomCode 必须为空（修前为原房间码）');
    assert.equal(view(rooms, B), 'lobby', '被踢者快照必须落 lobby（修前为 room/game）');
    assert.ok(!room.members.includes('B'), '被踢者已移出 members');
  });
}

// ---------------------------------------------------------------------------
// 2. 被踢者直发协议被拒（验收点 3；修前 prepare 阶段被接受）
// ---------------------------------------------------------------------------
test('kickRoom 后被踢者直发 room:charsheet / room:ready ⇒ 被拒（修前 prepare 被接受）', async () => {
  const { rooms, registry } = mkRooms();
  const { room, players } = await mkRoom(rooms, registry, ['A', 'B']);
  rooms.kickRoom(players['A'], 'B');
  const B = players['B'];
  // 仅改外观（colors）——R1-28 允许，用于隔离「成员资格」这一变量
  const cs = await rooms.dispatch(B, { t: 'room:charsheet', sheet: { ...SHEET('B'), colors: { skin: '#123456' } } });
  const rd = await rooms.dispatch(B, { t: 'room:ready', ready: true });
  assert.ok(cs.err, '被踢者 room:charsheet 应被拒（修前被接受：{"room":true}）');
  assert.ok(rd.err, '被踢者 room:ready 应被拒（修前被接受：{"room":true}）');
  assert.equal(room.ready.has('B'), false, '被踢者不得写回 ready');
});

// ---------------------------------------------------------------------------
// 3. ended 阶段踢人后 game.players 无残留（阶段集统一）
// ---------------------------------------------------------------------------
test('kickRoom@ended：被踢者不再残留于 game.players（members 与 game.players 一致）', async () => {
  const { rooms, registry } = mkRooms();
  const { room, players } = await mkRoom(rooms, registry, ['A', 'B']);
  await toPhase(rooms, room, 'ended');
  assert.ok(room.game.players.has('B'), '前置：ended 阶段 B 在 game.players 中');
  rooms.kickRoom(players['A'], 'B');
  assert.equal(room.game.players.has('B'), false, '踢后 game.players 不得残留被踢者（修前残留）');
  assert.deepEqual([...room.game.players.keys()], room.members, 'game.players 应与 members 一致');
});

// ---------------------------------------------------------------------------
// 4. C 护栏（纵深防御）：陈旧 roomCode 的非成员 ⇒ 回落大厅
// ---------------------------------------------------------------------------
test('C 护栏：roomCode 陈旧但非成员 ⇒ snapshotFor 回落大厅（不依赖任何调用方清理）', async () => {
  const { rooms, registry } = mkRooms();
  const { room, players } = await mkRoom(rooms, registry, ['A', 'B']);
  // 手工制造「已移出 members 但 roomCode 未清」的陈旧态（模拟某条移除路径漏清）
  room.members = room.members.filter((p) => p !== 'B');
  players['B'].roomCode = room.code;
  const snap = rooms.snapshotFor(players['B']);
  assert.equal(snap.view, 'lobby', '护栏必须拦下非成员的陈旧 roomCode');
  assert.equal(players['B'].roomCode, null, '护栏应同时清掉陈旧 roomCode');
});

// ---------------------------------------------------------------------------
// 5. 回归反例：正常路径行为不变
// ---------------------------------------------------------------------------
test('回归：未踢成员取快照正常（room/prepare 与 game/playing）', async () => {
  const { rooms, registry } = mkRooms();
  const { room, players } = await mkRoom(rooms, registry, ['A', 'B']);
  assert.equal(view(rooms, players['A']), 'room', '房主准备阶段应见 room');
  rooms.kickRoom(players['A'], 'B'); // 踢掉 B，A 仍是成员
  assert.equal(view(rooms, players['A']), 'room', '踢人后房主快照不受影响');
});

test('回归：正常 leaveRoom 仍落 lobby 且清 roomCode（R1-21/R1-27 语义）', async () => {
  const { rooms, registry } = mkRooms();
  const { players } = await mkRoom(rooms, registry, ['A', 'B']);
  const r = rooms.leaveRoom(players['B']);
  assert.equal(r.left, true);
  assert.equal(players['B'].roomCode, null, '离开者 roomCode 清空');
  assert.equal(view(rooms, players['B']), 'lobby', '离开者落 lobby');
});

test('回归：结算 waiting（afterEnd=return）不被护栏误伤，仍拿 room/waiting', async () => {
  const { rooms, registry } = mkRooms();
  const { room, players } = await mkRoom(rooms, registry, ['A', 'B']);
  await toPhase(rooms, room, 'ended');
  rooms.returnToRoom(players['A']);
  const s = rooms.snapshotFor(players['A']);
  assert.equal(s.view, 'room', '已选择回房者应见 room');
  assert.equal(s.waiting, true, '并处于 waiting 态');
  assert.equal(view(rooms, players['B']), 'game', '未选择者仍见 game（不被拽，R1-29 语义）');
});

test('回归：R1-27 确认门——confirm 阶段踢人后仍停在 confirm，剩余者确认后放行 playing', async () => {
  const { rooms, registry } = mkRooms();
  const { room, players } = await mkRoom(rooms, registry, ['A', 'B']);
  await toPhase(rooms, room, 'confirm');
  rooms.kickRoom(players['A'], 'B');
  assert.equal(room.phase, 'confirm', '踢人后房间仍停在确认门（不自动开局）');
  assert.equal(room.confirmed.has('B'), false, '被踢者应从 confirmed 集合移除');
  rooms.confirmStart(players['A']);
  let g = 0; while (room.phase !== 'playing' && g++ < 200) await sleep(10);
  assert.equal(room.phase, 'playing', '剩余者确认后 _checkConfirmComplete 仍推进到 playing');
});

// ---------------------------------------------------------------------------
// 6. 结构守卫：防「两处清理各写一遍」根因复发（B）+ 护栏接线（C）+ 守卫风格统一（BL-30）
// ---------------------------------------------------------------------------
test('结构守卫 B：leaveRoom 与 kickRoom 共用 _removeMember（单一真源）', () => {
  const src = readFileSync(join(APP_ROOT, 'server/game/rooms.mjs'), 'utf8');
  assert.match(src, /_removeMember\s*\(\s*room\s*,\s*pid/, '应定义 _removeMember(room, pid, ...)');
  const calls = src.match(/this\._removeMember\(/g) || [];
  assert.ok(calls.length >= 2, 'leaveRoom 与 kickRoom 必须都调用 _removeMember（当前 ' + calls.length + ' 处）');
  // members 的 filter 移除只应出现在 _removeMember 一处（防「两处各写一遍」根因复发）
  const filters = src.match(/room\.members = room\.members\.filter\(/g) || [];
  assert.equal(filters.length, 1, 'members filter 移除应只在 _removeMember 中出现一次（当前 ' + filters.length + '）');
});

test('结构守卫 C：snapshotFor 入口使用 isMember 成员资格护栏', () => {
  const src = readFileSync(join(APP_ROOT, 'server/game/rooms.mjs'), 'utf8');
  const snap = src.slice(src.indexOf('snapshotFor(player)'));
  assert.match(snap, /if\s*\(!this\.isMember\(player\.pid,\s*room\)\)/, 'snapshotFor 必须用 isMember 加护栏');
});

test('结构守卫 BL-30：room.confirmed 全部访问统一为 ?. 防御式', () => {
  const src = readFileSync(join(APP_ROOT, 'server/game/rooms.mjs'), 'utf8');
  const bare = src.match(/room\.confirmed\.(?!\?)/g) || [];
  assert.equal(bare.length, 0, '不得存在裸 room.confirmed. 访问（应统一 ?.）：' + bare.length + ' 处');
  assert.ok((src.match(/room\.confirmed\?\./g) || []).length >= 6, '应存在多处 ?. 访问');
});

test('结构守卫：index.mjs 向 Rooms 注入 getPlayer（第 5 参），供 kickRoom 清 roomCode', () => {
  const src = readFileSync(join(APP_ROOT, 'server/index.mjs'), 'utf8');
  const start = src.indexOf('rooms.bindRegistry(');
  const call = src.slice(start, src.indexOf(');', start));
  assert.match(call, /players\.get\(pid\)\s*\|\|\s*null/, 'bindRegistry 应传入 (pid)=>players.get(pid)||null 解析器');
});
