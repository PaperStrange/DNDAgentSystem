// R1-1 (c)(d)(f)：移动预算 / 攻击原子性 / 道具原子消耗
import { test } from 'node:test';
import assert from 'node:assert';
import { makeGame, blankMap } from './_fixture.mjs';
import { setSeed } from '../../server/util.mjs';

// ---------- (c) actMove：预算只按真正走过的格子扣 ----------
test('(c) 平地预算6、目标6格：走满6格且 moveLeft 归零', () => {
  const g = makeGame({ w: 12, h: 12 });
  const { e } = g.addPlayer({ pid: 'p1', cls: 'fighter', x: 0, y: 0 });
  const t = g.startTurn('p1');
  assert.equal(t.moveLeft, 6);
  const r = g.actMove('p1', { x: 6, y: 0 });
  assert.equal(r.ok, true);
  assert.equal(e.x, 6, '应该真的走到第6格');
  assert.equal(e.y, 0);
  assert.equal(t.moveLeft, 0, '6步平地应耗尽预算');
  assert.equal(r.path.length, 6, '返回路径长度=真正移动的格数');
});

test('(c) 困难地形每步扣2：预算6只能走3格困难地形', () => {
  const g = makeGame({ map: blankMap(12, 12, { difficult: [{ x: 1, y: 0 }, { x: 2, y: 0 }, { x: 3, y: 0 }] }) });
  const { e } = g.addPlayer({ pid: 'p1', cls: 'fighter', x: 0, y: 0 });
  const t = g.startTurn('p1');
  const r = g.actMove('p1', { x: 6, y: 0 });
  assert.equal(e.x, 3, '困难地形每步2点，预算6恰好走3格');
  assert.equal(t.moveLeft, 0);
  assert.equal(r.path.length, 3, '路径长度=实际移动格数，不含走不起的那一步');
});

test('(c) 预算不足以支付下一步困难地形时原地不动且不扣预算', () => {
  const g = makeGame({ map: blankMap(12, 12, { difficult: [{ x: 1, y: 0 }] }) });
  const { e } = g.addPlayer({ pid: 'p1', cls: 'fighter', x: 0, y: 0 });
  const t = g.startTurn('p1', { moveLeft: 1 });
  const r = g.actMove('p1', { x: 5, y: 0 });
  assert.equal(e.x, 0, '第一步就是困难地形(2点)，预算1不够→不动');
  assert.equal(e.y, 0);
  assert.equal(t.moveLeft, 1, '没有移动就不扣预算');
  assert.equal(r.path.length, 0);
});

test('(c) 路径长于预算时截断，且不会把预算扣成负数', () => {
  const g = makeGame({ w: 12, h: 12 });
  const { e } = g.addPlayer({ pid: 'p1', cls: 'fighter', x: 0, y: 0 });
  const t = g.startTurn('p1', { moveLeft: 4 });
  const r = g.actMove('p1', { x: 10, y: 0 });
  assert.equal(e.x, 4);
  assert.equal(t.moveLeft, 0);
  assert.ok(t.moveLeft >= 0, 'moveLeft 不能为负');
  assert.equal(r.path.length, 4);
});

// ---------- (d) actAttack：射程校验在消耗动作之前 ----------
test('(d) 目标超射程：ok:false 且 actionUsed 保持 false，不开战', () => {
  const g = makeGame({ w: 30, h: 12 });
  g.addPlayer({ pid: 'p1', cls: 'fighter', x: 0, y: 0 });
  g.addMonster({ eid: 'm1', x: 20, y: 0 }); // 曼哈顿距离20 > 长弓15
  const t = g.startTurn('p1');
  const r = g.actAttack('p1', { targetEid: 'm1' });
  assert.equal(r.ok, false);
  assert.equal(r.undo, true);
  assert.match(r.msg, /射程/);
  assert.equal(t.actionUsed, false, '非法攻击不得消耗动作');
  assert.equal(g.calls.alertSquad.length, 0, '够不着的目标不得触发开战');
  assert.equal(g.calls.damage.length, 0);
});

test('(d) 近战超距（距离2）同样不消耗动作', () => {
  const g = makeGame({ w: 12, h: 12 });
  g.addPlayer({ pid: 'p1', cls: 'wizard', x: 0, y: 0 }); // 法师只有匕首(range1)
  g.addMonster({ eid: 'm1', x: 2, y: 0 });
  const t = g.startTurn('p1');
  const r = g.actAttack('p1', { targetEid: 'm1' });
  assert.equal(r.ok, false);
  assert.equal(t.actionUsed, false);
});

test('(d) 合法攻击仍消耗动作并触发开战', () => {
  setSeed(7);
  const g = makeGame({ w: 12, h: 12 });
  g.addPlayer({ pid: 'p1', cls: 'fighter', x: 5, y: 5 });
  g.addMonster({ eid: 'm1', x: 5, y: 6 });
  const t = g.startTurn('p1');
  const r = g.actAttack('p1', { targetEid: 'm1' });
  assert.equal(r.ok, true);
  assert.equal(t.actionUsed, true, '合法攻击必须消耗动作');
  assert.deepEqual(g.calls.alertSquad.map(c => c.eid), ['m1'], '合法攻击正常开战');
});

// ---------- (f) actUseItem flask：坐标/命中校验通过后才扣资源 ----------
test('(f) 落点有怪：命中并扣道具与动作', () => {
  setSeed(3);
  const g = makeGame({ w: 14, h: 14 });
  const { p } = g.addPlayer({ pid: 'p1', cls: 'fighter', x: 5, y: 5, items: { flask: 2 } });
  g.addMonster({ eid: 'm1', x: 5, y: 6, hp: 40 });
  const t = g.startTurn('p1');
  const r = g.actUseItem('p1', { itemId: 'flask', x: 5, y: 6 });
  assert.equal(r.ok, true);
  assert.equal(t.actionUsed, true);
  assert.equal(p.items.flask, 1);
  assert.equal(g.calls.damage.length, 1);
  assert.equal(g.calls.damage[0].eid, 'm1');
});

test('(f) 落点无怪：ok:false 且动作与道具都不扣', () => {
  const g = makeGame({ w: 14, h: 14 });
  const { p } = g.addPlayer({ pid: 'p1', cls: 'fighter', x: 5, y: 5, items: { flask: 1 } });
  g.addMonster({ eid: 'm1', x: 12, y: 12 });
  const t = g.startTurn('p1');
  const r = g.actUseItem('p1', { itemId: 'flask', x: 1, y: 1 });
  assert.equal(r.ok, false);
  assert.equal(r.undo, true);
  assert.equal(t.actionUsed, false, '空砸不得消耗动作');
  assert.equal(p.items.flask, 1, '空砸不得消耗道具');
  assert.equal(g.calls.damage.length, 0);
});

test('(f) 超出8格：ok:false 且不扣资源', () => {
  const g = makeGame({ w: 20, h: 20 });
  const { p } = g.addPlayer({ pid: 'p1', cls: 'fighter', x: 0, y: 0, items: { flask: 1 } });
  g.addMonster({ eid: 'm1', x: 15, y: 0 });
  const t = g.startTurn('p1');
  const r = g.actUseItem('p1', { itemId: 'flask', x: 15, y: 0 });
  assert.equal(r.ok, false);
  assert.equal(r.undo, true);
  assert.equal(t.actionUsed, false);
  assert.equal(p.items.flask, 1);
});

test('(f) 没有坐标也没有 targetEid：拒绝且不扣资源', () => {
  const g = makeGame({ w: 14, h: 14 });
  const { p } = g.addPlayer({ pid: 'p1', cls: 'fighter', x: 5, y: 5, items: { flask: 1 } });
  const t = g.startTurn('p1');
  const r = g.actUseItem('p1', { itemId: 'flask' });
  assert.equal(r.ok, false);
  assert.equal(t.actionUsed, false);
  assert.equal(p.items.flask, 1);
});

test('(f) potion：目标无效时不消耗附赠动作与药水', () => {
  const g = makeGame({ w: 14, h: 14 });
  const { p } = g.addPlayer({ pid: 'p1', cls: 'fighter', x: 5, y: 5, items: { potion: 1 } });
  const t = g.startTurn('p1');
  const r = g.actUseItem('p1', { itemId: 'potion', targetEid: 'nobody' });
  assert.equal(r.ok, false);
  assert.equal(r.undo, true);
  assert.equal(t.bonusUsed, false);
  assert.equal(p.items.potion, 1);
});

test('(f) potion：对倒地队友仍可使用（hp0 未死目标）且正常扣药', () => {
  setSeed(5);
  const g = makeGame({ w: 14, h: 14 });
  const { p } = g.addPlayer({ pid: 'p1', cls: 'cleric', x: 5, y: 5, items: { potion: 1 } });
  const { e: allyE } = g.addPlayer({ pid: 'p2', cls: 'fighter', x: 5, y: 6 });
  g.startTurn('p1');
  allyE.hp = 0;
  const r = g.actUseItem('p1', { itemId: 'potion', targetEid: allyE.eid });
  assert.equal(r.ok, true);
  assert.equal(p.items.potion, 0);
  assert.equal(g.calls.heal.length, 1);
});
