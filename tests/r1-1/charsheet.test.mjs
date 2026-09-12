// R1-1 (a)(b)：车卡入参合法性 + 道具使用坐标透传
import { test } from 'node:test';
import assert from 'node:assert';
import { buildSheet } from '../../server/game/charsheet.mjs';
import { makeGame } from './_fixture.mjs';

const GOOD = {
  name: '阿斯特', raceId: 'human', classId: 'fighter',
  stats: { STR: 15, DEX: 13, CON: 14, INT: 10, WIS: 10, CHA: 8 },
  flex: { CON: 1 },
};
const clone = (o) => JSON.parse(JSON.stringify(o));
const reject = (patch, why) => {
  const input = { ...clone(GOOD), ...patch };
  assert.throws(() => buildSheet(input), /.*/, why);
};

test('(a) buildSheet 接受合法车卡', () => {
  const s = buildSheet(clone(GOOD));
  assert.equal(s.class, 'fighter');
  assert.equal(s.race, 'human');
  assert.equal(s.level, 1);
  assert.ok(s.maxHp > 0 && s.ac > 0);
});

test('(a) level=99 被拒绝', () => reject({ level: 99 }, 'level 超出 1..4'));
test('(a) level=0 / 非整数被拒绝', () => { reject({ level: 0 }); reject({ level: 2.5 }); });
test('(a) level=4 合法', () => assert.equal(buildSheet({ ...clone(GOOD), level: 4 }).level, 4));

test('(a) 属性超过上限被拒绝', () => {
  reject({ stats: { STR: 16, DEX: 13, CON: 14, INT: 10, WIS: 10, CHA: 8 } }, 'STR=16 > MAX_STAT');
});
test('(a) 属性低于下限被拒绝', () => {
  reject({ stats: { STR: 7, DEX: 13, CON: 14, INT: 10, WIS: 10, CHA: 8 } }, 'STR=7 < MIN_STAT');
});
test('(a) 属性非整数被拒绝', () => {
  reject({ stats: { STR: 13.5, DEX: 13, CON: 14, INT: 10, WIS: 10, CHA: 8 } });
});
test('(a) 购点超出 27 被拒绝', () => {
  reject({ stats: { STR: 15, DEX: 15, CON: 15, INT: 15, WIS: 15, CHA: 15 } }, '全15=42点 > 27');
  reject({ stats: { STR: 15, DEX: 15, CON: 15, INT: 15, WIS: 14, CHA: 10 } }, '合计28点 > 27');
});
test('(a) 刚好 27 点合法', () => {
  assert.ok(buildSheet({ ...clone(GOOD), stats: { STR: 15, DEX: 15, CON: 15, INT: 10, WIS: 10, CHA: 10 } }), '7+7+7+2+2+2=27 恰好用满');
});
test('(a) 属性键非法/缺失被拒绝', () => {
  reject({ stats: { STR: 15, DEX: 13, CON: 14, INT: 10, WIS: 10, CHA: 8, LCK: 3 } }, '多余键');
  reject({ stats: { STR: 15, DEX: 13, CON: 14, INT: 10, WIS: 10 } }, '缺 CHA');
  reject({ stats: 'nope' });
});

test('(a) flex 数量超出种族上限被拒绝', () => {
  reject({ raceId: 'elf', flex: { STR: 1 } }, '精灵 flex=0');
  reject({ raceId: 'dwarf', flex: { STR: 1, DEX: 1 } }, '矮人 flex=0');
  reject({ raceId: 'human', flex: { STR: 1, DEX: 1, CON: 1 } }, '人类 flex=2，给了3项');
});
test('(a) flex 合法：人类2项 / 半精灵2项 / 精灵0项', () => {
  assert.ok(buildSheet({ ...clone(GOOD), raceId: 'human', flex: { STR: 1, CON: 1 } }));
  assert.ok(buildSheet({ ...clone(GOOD), raceId: 'halfelf', flex: { DEX: 1, CHA: 1 } }));
  assert.ok(buildSheet({ ...clone(GOOD), raceId: 'elf', flex: {} }));
});
test('(a) flex 键非法或非负整数被拒绝', () => {
  reject({ flex: { LCK: 1 } }, '非六属性');
  reject({ flex: { CON: -1 } }, '负数');
  reject({ flex: { CON: 1.5 } }, '非整数');
});

test('(a) 非法 raceId / classId 被拒绝', () => {
  reject({ raceId: 'dragon' }, '不存在的种族不再静默回退');
  reject({ classId: 'bard' }, '不存在的职业不再静默回退');
});
test('(a) 非法 name 被拒绝', () => {
  reject({ name: '' });
  reject({ name: 'a'.repeat(21) });
  reject({ name: 123 });
});

test('(b) actUseItem 接收并使用 x,y（优先于 targetEid）', () => {
  const g = makeGame({ w: 14, h: 14 });
  g.addPlayer({ pid: 'p1', cls: 'fighter', x: 6, y: 6, items: { flask: 1 } });
  g.addMonster({ eid: 'mA', x: 2, y: 2 });
  g.addMonster({ eid: 'mB', x: 9, y: 9 });
  g.startTurn('p1');
  const r = g.actUseItem('p1', { itemId: 'flask', targetEid: 'mA', x: 9, y: 9 });
  assert.equal(r.ok, true, '落点 (9,9) 有怪，应命中');
  assert.deepEqual(g.calls.damage.map(d => d.eid), ['mB'], 'x,y 优先于 targetEid：只有 mB 受伤');
  assert.equal(g.players.get('p1').items.flask, 0);
});
