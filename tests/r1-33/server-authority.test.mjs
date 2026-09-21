// R1-33 Part 2 回归用例 —— 服务端角色权威（authorize 唯一判定点 + settle 双写写回）
//
// 覆盖：
//   G1 账号路径：首次提交即由服务端签发 characterId（口径 ① = A：首次成功提交即创建）
//   G2 level/xp「覆盖」语义 + **可观测**（overridden 列表；绝不静默）
//   G3 其余被锁字段仍严格拒改（race/class/stats/flex/name/background）
//   G4 外观 colors/look 仍可改
//   G5 验收③：直发 level:99 不被接受（两处存储都无 99）
//   G6 无账号 ⇒ 回退 R1-28 会话级锁（行为不变）
//   G7 验收①：_settleGrowth 双写 —— ①权威库 ②room.sheets（同房间下一局立即继承）
//   G8 验收②：**换新房间仍能继承**（陈旧本地副本被服务端权威覆盖，最关键的一条）
//   G9 边界：离场者不结算 / 无 characterId 跳过 / 死亡落 status='dead'
//
// 隔离：用 DND_DATA_DIR 指向临时目录（characters.json 落临时，绝不污染仓库 data/）。
// ⚠️ 必须在 import rooms.mjs（→ characters.mjs → paths.mjs 读 dataRoot）之前设好该环境变量。
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const DATA_DIR = mkdtempSync(join(tmpdir(), 'r1-33-p2-'));
process.env.DND_DATA_DIR = DATA_DIR;

const { Rooms } = await import('../../server/game/rooms.mjs');
const { getById } = await import('../../server/characters.mjs');

after(() => { try { rmSync(DATA_DIR, { recursive: true, force: true }); } catch { /* ignore */ } });

// 合法基础分配（22 点 ≤ 27）
const BASE = { STR: 15, DEX: 13, CON: 14, INT: 10, WIS: 10, CHA: 8 };
const RAW = (over = {}) => ({ name: '甲', raceId: 'human', classId: 'fighter', stats: { ...BASE }, flex: { STR: 1, CON: 1 }, level: 1, xp: 0, ...over });

let accSeq = 0;
const acct = () => 'acc' + (accSeq++) + '_' + Math.random().toString(36).slice(2, 6);

// 最小房间：可注入账号（account=null ⇒ 回退路径，等同 R1-28 夹具）
function mkRoom({ account = acct(), pid = 'p1', code = 'TEST' } = {}) {
  const rooms = new Rooms();
  const accounts = new Map([[pid, account]]);
  rooms.bindRegistry(
    (p) => p, (p) => true, () => { /* noop */ }, () => 0,
    (p) => null,                    // getPlayer（解冲突新增第 5 参；R1-33 测试不涉及踢人，无需解析）
    (p) => accounts.get(p) || null, // R1-33 Part 2：getAccount（解冲突后移至第 6 参）
  );
  const room = {
    code, hostId: pid, hostName: 'A', phase: 'prepare',
    members: [pid], sheets: new Map(), ready: new Set(), afterEnd: new Map(),
    confirmed: new Set(), confirmTimer: null, charIds: new Map(), lastTouched: Date.now(),
  };
  rooms.rooms.set(code, room);
  const player = { pid, name: 'A', roomCode: code };
  return { rooms, room, player };
}

const sheetOf = (room, pid = 'p1') => room.sheets.get(pid);

// ---------------------------------------------------------------------------
// G1：账号路径 —— 首次提交即创建（服务端签发 characterId）
// ---------------------------------------------------------------------------
test('G1 首次提交：服务端签发 characterId，绑定 room.charIds，落 room.sheets', async () => {
  const { rooms, room, player } = mkRoom();
  const r = await rooms.dispatch(player, { t: 'room:charsheet', sheet: RAW() });
  assert.ok(!r.err, '首次提交应被接受：' + (r.err || ''));
  assert.match(String(r.characterId), /^ch/, '应签发 ch* 角色 id');
  assert.equal(room.charIds.get('p1'), r.characterId, 'room.charIds 应绑定该角色');
  assert.ok(room.sheets.has('p1'), 'room.sheets 应已创建');
  assert.equal(room.sheets.get('p1').level, 1, '新建强制 level=1');
  assert.equal(room.sheets.get('p1').xp, 0, '新建强制 xp=0');
});

// ---------------------------------------------------------------------------
// G2：level/xp「覆盖」+ 可观测
// ---------------------------------------------------------------------------
test('G2 level/xp：客户端值被服务端权威覆盖，且 overridden 可观测（绝不静默）', async () => {
  const { rooms, room, player } = mkRoom();
  const r1 = await rooms.dispatch(player, { t: 'room:charsheet', sheet: RAW() });
  const cid = r1.characterId;
  // 客户端带出陈旧/越权的 level=2 / xp=50（仍在合法范围 ⇒ 不被 buildSheet 拒，走覆盖）
  const r2 = await rooms.dispatch(player, { t: 'room:charsheet', sheet: RAW({ level: 2, xp: 50 }), characterId: cid });
  assert.ok(!r2.err, 'level/xp 差异不应拒改：' + (r2.err || ''));
  assert.deepEqual([...r2.overridden].sort(), ['level', 'xp'], '应回传被覆盖的字段（可观测）');
  assert.equal(sheetOf(room).level, 1, 'room.sheets 采用服务端权威 level（非客户端 2）');
  assert.equal(sheetOf(room).xp, 0, 'room.sheets 采用服务端权威 xp（非客户端 50）');
  assert.equal(getById(cid).locked.level, 1, '权威库 level 未被客户端污染');
  assert.equal(getById(cid).locked.xp, 0, '权威库 xp 未被客户端污染');
});

// ---------------------------------------------------------------------------
// G3：其余被锁字段仍严格拒改
// ---------------------------------------------------------------------------
test('G3 其余锁定字段：race/class/stats/flex/name/background 逐项拒改（账号路径）', async () => {
  const { rooms, room, player } = mkRoom();
  const { characterId } = await rooms.dispatch(player, { t: 'room:charsheet', sheet: RAW() });
  const cases = [
    ['raceId', RAW({ raceId: 'elf', flex: {} })],
    ['classId', RAW({ classId: 'wizard' })],
    ['stats', RAW({ stats: { ...BASE, STR: 14, DEX: 14 } })],
    ['flex', RAW({ flex: { DEX: 1, CON: 1 } })],
    ['name', RAW({ name: '换个名' })],
    ['background', RAW({ background: '新背景' })],
  ];
  for (const [field, sheet] of cases) {
    const r = await rooms.dispatch(player, { t: 'room:charsheet', sheet, characterId });
    assert.ok(r.err, field + ' 改动必须被拒绝');
    assert.match(r.err, new RegExp(field), '错误应点名被拒字段 ' + field + '（实际：' + r.err + '）');
  }
  // 已保存值原样保留
  assert.equal(sheetOf(room).race, 'human');
  assert.equal(sheetOf(room).class, 'fighter');
  assert.equal(sheetOf(room).name, '甲');
});

// ---------------------------------------------------------------------------
// G4：外观可改
// ---------------------------------------------------------------------------
test('G4 外观 colors/look：仍可改（不在锁内）', async () => {
  const { rooms, room, player } = mkRoom();
  const { characterId } = await rooms.dispatch(player, { t: 'room:charsheet', sheet: RAW() });
  const r = await rooms.dispatch(player, { t: 'room:charsheet', sheet: RAW({ colors: { skin: '#123456' }, look: { hair: 5 } }), characterId });
  assert.ok(!r.err, '外观应可改：' + (r.err || ''));
  assert.equal(sheetOf(room).look.hair, 5);
  assert.equal(sheetOf(room).colors.skin, '#123456');
});

// ---------------------------------------------------------------------------
// G5：验收③ —— 直发 level:99 不被接受
// ---------------------------------------------------------------------------
test('G5 验收③：直发 level:99 被拒，两处存储均无 99', async () => {
  const { rooms, room, player } = mkRoom();
  const { characterId } = await rooms.dispatch(player, { t: 'room:charsheet', sheet: RAW() });
  const bad = await rooms.dispatch(player, { t: 'room:charsheet', sheet: RAW({ level: 99 }), characterId });
  assert.ok(bad.err, 'level:99 必须被拒（越界，buildSheet 拒）');
  assert.equal(sheetOf(room).level, 1, 'room.sheets 无 99');
  assert.notEqual(getById(characterId).locked.level, 99, '权威库无 99');

  // 新角色直接 level:99 ⇒ 拒，且不产生任何角色
  const { rooms: rooms2, room: room2, player: p2 } = mkRoom();
  const bad2 = await rooms2.dispatch(p2, { t: 'room:charsheet', sheet: RAW({ level: 99 }) });
  assert.ok(bad2.err, '新角色 level:99 应被拒');
  assert.equal(room2.sheets.has('p1'), false, '被拒后不得落 room.sheets');
  assert.equal(room2.charIds.size, 0, '被拒后不得签发 characterId');
});

// ---------------------------------------------------------------------------
// G6：无账号 ⇒ 回退会话级锁（R1-28 行为不变）
// ---------------------------------------------------------------------------
test('G6 无账号回退：会话级锁仍生效（改 level ⇒ 拒，行为同 R1-28）', async () => {
  const { rooms, room, player } = mkRoom({ account: null });
  const r1 = await rooms.dispatch(player, { t: 'room:charsheet', sheet: RAW() });
  assert.ok(!r1.err, '首次提交应被接受');
  assert.equal(r1.characterId, undefined, '回退路径不签发 characterId');
  const r2 = await rooms.dispatch(player, { t: 'room:charsheet', sheet: RAW({ level: 4 }) });
  assert.ok(r2.err, '回退路径改 level 仍应被拒');
  assert.match(r2.err, /等级/);
  assert.equal(sheetOf(room).level, 1);
});

// ---------------------------------------------------------------------------
// G7：验收① —— _settleGrowth 双写
// ---------------------------------------------------------------------------
test('G7 验收①：_settleGrowth 双写（权威库 + room.sheets），同房间下一局立即继承', async () => {
  const { rooms, room, player } = mkRoom();
  const { characterId } = await rooms.dispatch(player, { t: 'room:charsheet', sheet: RAW() });
  // 模拟一局结束：game.players 的 p.level 升到 2、xp=130（_levelUp 只改 p.level，不改 p.sheet.level）
  room.game = { players: new Map([['p1', { pid: 'p1', level: 2, xp: 130, dead: false }]]) };
  rooms._settleGrowth(room);
  // ①账号权威库
  const rec = getById(characterId);
  assert.equal(rec.locked.level, 2, '权威库 level 应写回 2');
  assert.equal(rec.locked.xp, 130, '权威库 xp 应写回 130');
  assert.equal(rec.adventureCount, 1, 'adventureCount +1');
  // ②room.sheets（同房间下一局 startGame 直接读它）
  assert.equal(sheetOf(room).level, 2, 'room.sheets level 应写回 2（同房间继承）');
  assert.equal(sheetOf(room).xp, 130, 'room.sheets xp 应写回 130');
});

// ---------------------------------------------------------------------------
// G8：验收② —— 换新房间仍能继承（最关键）
// ---------------------------------------------------------------------------
test('G8 验收②：换新房间，陈旧本地副本被服务端权威覆盖 ⇒ 仍能继承', async () => {
  const account = acct();
  // 房间 A：创建 + 结算升到 2 级 / 130xp
  const a = mkRoom({ account, code: 'ROOM_A' });
  const { characterId } = await a.rooms.dispatch(a.player, { t: 'room:charsheet', sheet: RAW() });
  a.room.game = { players: new Map([['p1', { pid: 'p1', level: 2, xp: 130, dead: false }]]) };
  a.rooms._settleGrowth(a.room);

  // 房间 B：**全新房间**，客户端只有陈旧副本（level:1,xp:0）+ 同一 characterId
  const b = mkRoom({ account, code: 'ROOM_B' });
  const r = await b.rooms.dispatch(b.player, { t: 'room:charsheet', sheet: RAW({ level: 1, xp: 0 }), characterId });
  assert.ok(!r.err, '换房间提交同一角色应被接受：' + (r.err || ''));
  assert.deepEqual([...r.overridden].sort(), ['level', 'xp'], '陈旧副本应被服务端权威覆盖');
  assert.equal(sheetOf(b.room).level, 2, '★ 新房间必须继承服务端权威等级 2（而非客户端 1）');
  assert.equal(sheetOf(b.room).xp, 130, '★ 新房间必须继承服务端权威经验 130');
  assert.equal(b.room.charIds.get('p1'), characterId, '新房间绑定同一角色');
});

// ---------------------------------------------------------------------------
// G9：边界 —— 离场者不结算 / 无 characterId 跳过 / 死亡落 status='dead'
// ---------------------------------------------------------------------------
test('G9 边界：离场者（不在 game.players）与无 characterId 者跳过 settle', async () => {
  const account = acct();
  const { rooms, room } = mkRoom({ account });
  const rA = await rooms.dispatch({ pid: 'p1', name: 'A', roomCode: 'TEST' }, { t: 'room:charsheet', sheet: RAW() });
  room.members = ['p1', 'p2']; // p2 无 characterId
  // p2 在冒险中离场 ⇒ 已从 game.players 删除；p1 在场
  room.game = { players: new Map([['p1', { pid: 'p1', level: 3, xp: 400, dead: false }]]) };
  assert.doesNotThrow(() => rooms._settleGrowth(room), '不得因缺 characterId / 离场者而抛错');
  assert.equal(getById(rA.characterId).locked.level, 3, '在场且已绑定的 p1 应结算');
});

test('G9 边界：死亡玩家落 status=dead', async () => {
  const { rooms, room, player } = mkRoom();
  const { characterId } = await rooms.dispatch(player, { t: 'room:charsheet', sheet: RAW() });
  room.game = { players: new Map([['p1', { pid: 'p1', level: 1, xp: 0, dead: true }]]) };
  rooms._settleGrowth(room);
  assert.equal(getById(characterId).status, 'dead', 'p.dead ⇒ status=dead');
});

// ---------------------------------------------------------------------------
// 快照：mySheet 带 characterId（供客户端 pushSheet 带出）
// ---------------------------------------------------------------------------
test('快照：mySheet 携带 characterId（服务端权威真源）', async () => {
  const { rooms, player } = mkRoom();
  const { characterId } = await rooms.dispatch(player, { t: 'room:charsheet', sheet: RAW() });
  const view = rooms.snapshotFor(player);
  assert.equal(view.view, 'room');
  assert.equal(view.mySheet.characterId, characterId);
  assert.equal(view.mySheet.level, 1);
});
