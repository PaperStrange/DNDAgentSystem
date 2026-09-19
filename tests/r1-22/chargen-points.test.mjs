// R1-22：车卡加点显示修复的回归测试
// 覆盖：购点只算基础值（不含种族加成/自由加点）、服务端下发 base/flex、
//       载入已有角色的还原、边界值、0 的显示、以及「-3」这一用户报告的定量复现。
import { test } from 'node:test';
import assert from 'node:assert';
import { buildSheet } from '../../server/game/charsheet.mjs';
import { RACES, MAX_STAT, MIN_STAT, POINT_POOL } from '../../public/shared/char-defs.mjs';
import { usedPoints, remainingPoints, baseStatsOf, flexSlots, flexFromSlots, ATTR_KEYS } from '../../public/shared/chargen-points.mjs';

const elf = RACES.find(r => r.id === 'elf');
const human = RACES.find(r => r.id === 'human');
const halfelf = RACES.find(r => r.id === 'halfelf');

// 旧客户端逻辑（room.mjs 修复前）：直接把最终值当基础值算购点
const legacyRemaining = (finalStats) => POINT_POOL - usedPoints(finalStats);

// ---------------------------------------------------------------------------
// 1. 纯公式：购点只累加基础值
// ---------------------------------------------------------------------------
test('usedPoints 只按基础值求和，MIN_STAT=8 为基线', () => {
  assert.equal(usedPoints({ STR: 15, DEX: 15, CON: 15, INT: 10, WIS: 10, CHA: 10 }), 27);
  assert.equal(usedPoints({ STR: 8, DEX: 8, CON: 8, INT: 8, WIS: 8, CHA: 8 }), 0);
});

test('remainingPoints：0 显示为 0（不是 -0）', () => {
  const rem = remainingPoints({ STR: 15, DEX: 15, CON: 15, INT: 10, WIS: 10, CHA: 10 });
  assert.equal(rem, 0);
  assert.equal(String(rem), '0'); // 界面用字符串拼接，0 不得变成 '-0'
  assert.ok(!Object.is(rem, -0));
});

test('remainingPoints：空/非法输入回退为整池', () => {
  assert.equal(remainingPoints(null), POINT_POOL);
  assert.equal(remainingPoints(undefined), POINT_POOL);
});

// ---------------------------------------------------------------------------
// 2. 定量复现用户报告的「剩余点数：-3 / 27」
//    精灵种族加成 DEX+2/WIS+1（合计3）；基础值恰好用满 27 点是**合法**角色。
//    旧逻辑把服务端的最终值当基础值 ⇒ 27-(27+3) = -3。
// ---------------------------------------------------------------------------
test('复现：精灵满购点角色，旧逻辑剩余点数 = -3', () => {
  const base = { STR: 15, DEX: 15, CON: 15, INT: 10, WIS: 10, CHA: 10 };
  assert.equal(usedPoints(base), 27, '基础分配恰好 27 点，合法');
  const sheet = buildSheet({ name: 'KellyMi', raceId: 'elf', classId: 'fighter', stats: base, flex: {} });
  // 服务端 stats 是最终值（含种族加成）
  assert.deepEqual(sheet.stats, { STR: 15, DEX: 17, CON: 15, INT: 10, WIS: 11, CHA: 10 });
  assert.equal(legacyRemaining(sheet.stats), -3, '旧逻辑把种族加成算进购点 ⇒ -3（与用户所见吻合）');
});

test('修复：同一角色经 baseStatsOf 还原后，剩余点数 = 0（非负）', () => {
  const base = { STR: 15, DEX: 15, CON: 15, INT: 10, WIS: 10, CHA: 10 };
  const sheet = buildSheet({ name: 'KellyMi', raceId: 'elf', classId: 'fighter', stats: base, flex: {} });
  const restored = baseStatsOf(sheet, elf);
  assert.deepEqual(restored, base, '还原出的基础值必须与原始分配一致');
  assert.equal(usedPoints(restored), 27);
  assert.equal(remainingPoints(restored), 0, '修复后剩余点数不为负');
});

// ---------------------------------------------------------------------------
// 3. 服务端下发 base/flex（界面据此还原，而非猜最终值）
// ---------------------------------------------------------------------------
test('buildSheet 下发 base（基础值）与 flex（自由加点）', () => {
  const base = { STR: 15, DEX: 13, CON: 14, INT: 10, WIS: 10, CHA: 8 };
  const flex = { CON: 1, DEX: 1 };
  const s = buildSheet({ name: '半精灵', raceId: 'halfelf', classId: 'fighter', stats: base, flex });
  assert.deepEqual(s.base, base, 'base 必须是原始基础值');
  assert.deepEqual(s.flex, flex, 'flex 必须是原始自由加点');
  // stats 仍是最终值：基础 + 种族(CHA+2) + 自由
  assert.equal(s.stats.CON, 15);
  assert.equal(s.stats.DEX, 14);
  assert.equal(s.stats.CHA, 10); // 8 + 种族2
  // base 不计入种族/自由：仍等于原始分配
  assert.equal(usedPoints(s.base), usedPoints(base));
});

test('baseStatsOf 回退：未下发 base 时用 final − 种族 − 自由 还原', () => {
  const base = { STR: 15, DEX: 15, CON: 15, INT: 10, WIS: 10, CHA: 10 };
  const s = buildSheet({ name: '精灵', raceId: 'elf', classId: 'fighter', stats: base, flex: {} });
  const legacySheet = { stats: s.stats }; // 模拟旧数据：只有 stats(=final)，没有 base/flex
  assert.deepEqual(baseStatsOf(legacySheet, elf), base);
});

test('baseStatsOf：人类（种族无加成，全在自由点）也能还原', () => {
  const base = { STR: 15, DEX: 13, CON: 14, INT: 10, WIS: 10, CHA: 8 };
  const flex = { STR: 1, CON: 1 };
  const s = buildSheet({ name: '人类', raceId: 'human', classId: 'fighter', stats: base, flex });
  assert.deepEqual(baseStatsOf(s, human), base);
  assert.deepEqual(baseStatsOf({ stats: s.stats, flex }, human), base, '旧数据（有 flex 无 base）也能还原');
});

// ---------------------------------------------------------------------------
// 4. 自由加点槽位换算
// ---------------------------------------------------------------------------
test('flexSlots / flexFromSlots 往返一致', () => {
  assert.deepEqual(flexSlots({ STR: 1, CON: 2 }), ['STR', 'CON', 'CON']);
  assert.deepEqual(flexSlots({}), []);
  assert.deepEqual(flexSlots(null), []);
  assert.deepEqual(flexFromSlots(['DEX', 'DEX', 'CHA']), { DEX: 2, CHA: 1 });
  assert.deepEqual(flexFromSlots([]), {});
});

// ---------------------------------------------------------------------------
// 5. 购点规则本身未被改动（27 / 8–15）
// ---------------------------------------------------------------------------
test('购点规则未变：恰好 27 点合法，28 点被拒', () => {
  const ok = { name: 'x', raceId: 'elf', classId: 'fighter', stats: { STR: 15, DEX: 15, CON: 15, INT: 10, WIS: 10, CHA: 10 }, flex: {} };
  assert.ok(buildSheet(ok), '27 点应合法');
  const bad = { ...ok, stats: { STR: 15, DEX: 15, CON: 15, INT: 11, WIS: 10, CHA: 10 } };
  assert.equal(usedPoints(bad.stats), 28);
  assert.throws(() => buildSheet(bad), /超出上限/, '28 点应被拒绝');
});

test('购点规则未变：基础值超上限 15 / 低于下限 8 被拒', () => {
  const base = { STR: 15, DEX: 15, CON: 15, INT: 10, WIS: 10, CHA: 10 };
  assert.throws(() => buildSheet({ name: 'x', raceId: 'elf', classId: 'fighter', stats: { ...base, STR: 16 }, flex: {} }), /非法/);
  assert.throws(() => buildSheet({ name: 'x', raceId: 'elf', classId: 'fighter', stats: { ...base, STR: 7 }, flex: {} }), /非法/);
});

test('边界：任一属性到下限 8 / 上限 15，剩余点数均非负', () => {
  for (const a of ATTR_KEYS) {
    const lo = Object.fromEntries(ATTR_KEYS.map(k => [k, MIN_STAT]));
    const hi = { ...lo, [a]: MAX_STAT };
    assert.ok(remainingPoints(lo) >= 0);
    assert.ok(remainingPoints(hi) >= 0);
    assert.equal(remainingPoints(hi), POINT_POOL - (MAX_STAT - MIN_STAT));
  }
});
