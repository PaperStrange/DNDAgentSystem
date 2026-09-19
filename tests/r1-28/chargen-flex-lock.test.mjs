// R1-28：「种族加点（自由加点 flex）可调性」的回归测试
// 覆盖：flex 等价比较、状态机（新角色可调 / 已创建锁定）、服务端对已创建角色改 flex 的拒绝、
//       购点规则与种族数值定义未被破坏（与 R1-22 交叉）、边界与反例。
import { test } from 'node:test';
import assert from 'node:assert';
import { Rooms } from '../../server/game/rooms.mjs';
import { buildSheet } from '../../server/game/charsheet.mjs';
import { RACES, MIN_STAT, MAX_STAT, POINT_POOL } from '../../public/shared/char-defs.mjs';
import { usedPoints, remainingPoints, normalizeFlex, flexEqual, ATTR_KEYS } from '../../public/shared/chargen-points.mjs';

const human = RACES.find(r => r.id === 'human');
const elf = RACES.find(r => r.id === 'elf');

// 合法基础分配（22 点 ≤ 27）
const BASE = { STR: 15, DEX: 13, CON: 14, INT: 10, WIS: 10, CHA: 8 };
const payload = (over = {}) => ({ name: '甲', raceId: 'human', classId: 'fighter', stats: { ...BASE }, flex: { STR: 1, CON: 1 }, level: 1, xp: 0, ...over });

// 构造一个最小房间（不启动服务器/不读 config/不调 LLM）
function mkRoom() {
  const rooms = new Rooms();
  const player = { pid: 'p1', name: 'A', roomCode: 'TEST' };
  rooms.rooms.set('TEST', {
    code: 'TEST', hostId: 'p1', hostName: 'A', phase: 'prepare',
    members: ['p1'], sheets: new Map(), ready: new Set(), afterEnd: new Map(),
    lastTouched: Date.now(),
  });
  return { rooms, player };
}

// ---------------------------------------------------------------------------
// 1. flex 等价比较（归一化）
// ---------------------------------------------------------------------------
test('normalizeFlex：只保留属性键上的正整数（抹掉 0/非法/未知键）', () => {
  assert.deepEqual(normalizeFlex({ STR: 1, CON: 2 }), { STR: 1, CON: 2 });
  assert.deepEqual(normalizeFlex({ STR: 1, DEX: 0, CON: -1, FOO: 3 }), { STR: 1 });
  assert.deepEqual(normalizeFlex(null), {});
  assert.deepEqual(normalizeFlex(undefined), {});
});

test('flexEqual：键序/0 值不影响等价判定', () => {
  assert.ok(flexEqual({ STR: 1, CON: 1 }, { CON: 1, STR: 1 }), '键序不同应等价');
  assert.ok(flexEqual({ STR: 1 }, { STR: 1, DEX: 0 }), '显式 0 与缺省应等价');
  assert.ok(flexEqual(null, {}), 'null 与空对象应等价');
  assert.ok(!flexEqual({ STR: 1 }, { STR: 2 }), '数值不同不等价');
  assert.ok(!flexEqual({ STR: 1, CON: 1 }, { STR: 1 }), '少一项不等价');
  assert.ok(!flexEqual({}, { CON: 1 }), '多一项不等价');
});

// ---------------------------------------------------------------------------
// 2. 状态机：新角色（尚未提交）→ 可提交任意合法 flex
// ---------------------------------------------------------------------------
test('新角色（未提交）：首次提交任意合法 flex 均被接受', async () => {
  const { rooms, player } = mkRoom();
  const r1 = await rooms.dispatch(player, { t: 'room:charsheet', sheet: payload({ flex: { STR: 1, CON: 1 } }) });
  assert.ok(!r1.err, '首次提交应被接受：' + (r1.err || ''));
  assert.deepEqual(rooms.rooms.get('TEST').sheets.get('p1').flex, { STR: 1, CON: 1 });
});

test('状态转换点：首次提交后 room.sheets 出现该玩家车卡（即「已创建」）', async () => {
  const { rooms, player } = mkRoom();
  assert.equal(rooms.rooms.get('TEST').sheets.has('p1'), false, '提交前：未创建');
  await rooms.dispatch(player, { t: 'room:charsheet', sheet: payload() });
  assert.equal(rooms.rooms.get('TEST').sheets.has('p1'), true, '提交后：已创建');
});

// ---------------------------------------------------------------------------
// 3. 已创建角色：改 flex ⇒ 服务端拒绝（反例 3：不得只做前端禁用）
// ---------------------------------------------------------------------------
test('已创建角色：直接发协议消息改 flex ⇒ 服务端拒绝（贴原始响应）', async () => {
  const { rooms, player } = mkRoom();
  await rooms.dispatch(player, { t: 'room:charsheet', sheet: payload({ flex: { STR: 1, CON: 1 } }) });
  const r = await rooms.dispatch(player, { t: 'room:charsheet', sheet: payload({ flex: { DEX: 1, CON: 1 } }) });
  assert.ok(r.err, '改 flex 必须被拒绝');
  assert.match(r.err, /已创建|种族加点/, '错误信息应说明「已创建角色不能改种族加点」');
  // 已保存的 flex 原样保留（未被覆盖）
  assert.deepEqual(rooms.rooms.get('TEST').sheets.get('p1').flex, { STR: 1, CON: 1 });
});

test('已创建角色：flex 数量变化（1→0、1→2）同样被拒绝', async () => {
  const { rooms, player } = mkRoom();
  await rooms.dispatch(player, { t: 'room:charsheet', sheet: payload({ flex: { STR: 1, CON: 1 } }) });
  assert.ok((await rooms.dispatch(player, { t: 'room:charsheet', sheet: payload({ flex: { STR: 1 } }) })).err, '减少一项应被拒');
  assert.ok((await rooms.dispatch(player, { t: 'room:charsheet', sheet: payload({ flex: { STR: 1, CON: 1, DEX: 1 } }) })).err, '增加一项应被拒');
});

test('已创建角色：flex 不变（仅键序/0 值不同）⇒ 允许（其他字段可继续编辑）', async () => {
  const { rooms, player } = mkRoom();
  await rooms.dispatch(player, { t: 'room:charsheet', sheet: payload({ flex: { STR: 1, CON: 1 } }) });
  const r = await rooms.dispatch(player, { t: 'room:charsheet', sheet: payload({ flex: { CON: 1, STR: 1 }, background: '改了背景' }) });
  assert.ok(!r.err, 'flex 等价 + 仅改背景应被接受：' + (r.err || ''));
  assert.equal(rooms.rooms.get('TEST').sheets.get('p1').background, '改了背景');
});

test('已创建角色：改基础值但 flex 不变 ⇒ 允许（本卡只管种族加点；整组属性属 R1-24/R2-1）', async () => {
  const { rooms, player } = mkRoom();
  await rooms.dispatch(player, { t: 'room:charsheet', sheet: payload({ flex: { STR: 1, CON: 1 } }) });
  const r = await rooms.dispatch(player, { t: 'room:charsheet', sheet: payload({ stats: { ...BASE, STR: 14, DEX: 14 }, flex: { STR: 1, CON: 1 } }) });
  assert.ok(!r.err, 'flex 未变的基础值编辑应被接受（未越界到 R1-24）：' + (r.err || ''));
});

// ---------------------------------------------------------------------------
// 4. 既有行为未被破坏
// ---------------------------------------------------------------------------
test('非准备阶段仍拒绝改卡（原有守卫保留）', async () => {
  const { rooms, player } = mkRoom();
  rooms.rooms.get('TEST').phase = 'playing';
  const r = await rooms.dispatch(player, { t: 'room:charsheet', sheet: payload() });
  assert.match(r.err, /游戏已开始/);
});

test('非法输入仍被拒绝且带回执（R1-22 行为保留）', async () => {
  const { rooms, player } = mkRoom();
  const r = await rooms.dispatch(player, { t: 'room:charsheet', sheet: payload({ stats: { ...BASE, STR: 16 } }) });
  assert.ok(r.err, '超上限必须被拒');
});

test('flex:0 的种族带非空 flex ⇒ buildSheet 仍拒绝（种族数值定义未动）', () => {
  assert.throws(() => buildSheet({ name: 'x', raceId: 'elf', classId: 'fighter', stats: { ...BASE }, flex: { STR: 1 } }), /自由属性/);
  // 种族加成的数值定义逐字未变
  assert.deepEqual(elf.stats, { DEX: 2, WIS: 1 });
  assert.deepEqual(human.stats, {});
  assert.equal(human.flex, 2);
  assert.equal(elf.flex, 0);
});

// ---------------------------------------------------------------------------
// 5. 与 R1-22 交叉：购点规则未被破坏（剩余点数不为负；不得复现 -3）
// ---------------------------------------------------------------------------
test('购点规则未变：27/8–15；已创建角色改 flex 被拒后剩余点数仍不为负', async () => {
  assert.equal(POINT_POOL, 27);
  assert.equal(MIN_STAT, 8);
  assert.equal(MAX_STAT, 15);
  const { rooms, player } = mkRoom();
  await rooms.dispatch(player, { t: 'room:charsheet', sheet: payload({ flex: { STR: 1, CON: 1 } }) });
  const rejected = await rooms.dispatch(player, { t: 'room:charsheet', sheet: payload({ flex: { DEX: 1, CON: 1 } }) });
  assert.ok(rejected.err);
  const sheet = rooms.rooms.get('TEST').sheets.get('p1');
  // 剩余点数只由 base 计算，且非负（R1-22 的 -3 不得复现）
  const rem = remainingPoints(sheet.base);
  assert.ok(rem >= 0, '剩余点数必须非负，实为 ' + rem);
  assert.equal(usedPoints(sheet.base), 22);
  assert.equal(rem, POINT_POOL - 22);
});

test('边界：所有属性取下限/上限时剩余点数均非负', () => {
  for (const a of ATTR_KEYS) {
    const lo = Object.fromEntries(ATTR_KEYS.map(k => [k, MIN_STAT]));
    const hi = { ...lo, [a]: MAX_STAT };
    assert.ok(remainingPoints(lo) >= 0);
    assert.ok(remainingPoints(hi) >= 0);
  }
});

// ---------------------------------------------------------------------------
// 6. 卡片场景：「结束冒险后留在房间」——重置回准备阶段后锁定仍生效
// ---------------------------------------------------------------------------
test('重置回准备阶段（_resetToPrepare）不清空 room.sheets ⇒ 已创建锁定仍生效', async () => {
  const { rooms, player } = mkRoom();
  const room = rooms.rooms.get('TEST');
  await rooms.dispatch(player, { t: 'room:charsheet', sheet: payload({ flex: { STR: 1, CON: 1 } }) });
  assert.equal(room.sheets.has('p1'), true, '提交后已创建');

  // 模拟「冒险结束 → 全员回到房间 → 房间重置」
  rooms._resetToPrepare(room);
  assert.equal(room.phase, 'prepare', '重置后回到准备阶段');
  assert.equal(room.sheets.has('p1'), true, '重置**不**清空已提交车卡（否则锁定会在换局后丢失）');

  // 重置后仍拒绝改 flex（正是用户报告的场景：结束冒险后留在房间）
  const r = await rooms.dispatch(player, { t: 'room:charsheet', sheet: payload({ flex: { DEX: 1, CON: 1 } }) });
  assert.ok(r.err, '重置后改 flex 仍应被拒');
  assert.match(r.err, /已创建|种族加点/);
});

// ---------------------------------------------------------------------------
// 7. §6-3：锁定按「玩家/稳定身份」判定，不按名字
// ---------------------------------------------------------------------------
test('两名玩家各自独立：A 已创建被锁，B 未提交仍可自由提交 flex', async () => {
  const { rooms } = mkRoom();
  const room = rooms.rooms.get('TEST');
  room.members = ['p1', 'p2'];
  const a = { pid: 'p1', name: '同名', roomCode: 'TEST' };
  const b = { pid: 'p2', name: '同名', roomCode: 'TEST' };
  await rooms.dispatch(a, { t: 'room:charsheet', sheet: payload({ flex: { STR: 1, CON: 1 } }) });
  // B 与 A 同名，但从未提交 ⇒ 仍可自由提交（不因同名被误锁）
  const rb = await rooms.dispatch(b, { t: 'room:charsheet', sheet: payload({ flex: { DEX: 1, CHA: 1 } }) });
  assert.ok(!rb.err, 'B 首次提交应被接受（不因与 A 同名被误锁）：' + (rb.err || ''));
  assert.deepEqual(room.sheets.get('p2').flex, { DEX: 1, CHA: 1 });
  // A 仍被锁
  assert.ok((await rooms.dispatch(a, { t: 'room:charsheet', sheet: payload({ flex: { DEX: 1, CHA: 1 } }) })).err, 'A 应仍被锁');
});
