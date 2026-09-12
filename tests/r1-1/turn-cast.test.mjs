// R1-1 (e)：施法所有权校验、先校验后扣资源、BOSS 表决闸门
import { test } from 'node:test';
import assert from 'node:assert';
import { makeGame } from './_fixture.mjs';
import { setSeed } from '../../server/util.mjs';

test('(e) 战士施放未拥有的 s:firebolt 被拒绝且不扣任何资源', () => {
  const g = makeGame({ w: 16, h: 16 });
  const { p } = g.addPlayer({ pid: 'p1', cls: 'fighter', x: 5, y: 5, slots: { 1: 2 } });
  g.addMonster({ eid: 'm1', x: 5, y: 8 });
  const t = g.startTurn('p1');
  const r = g.actCast('p1', { spellId: 's:firebolt', targetEid: 'm1' });
  assert.equal(r.ok, false);
  assert.equal(r.undo, true);
  assert.match(r.msg, /未拥有的能力/);
  assert.equal(t.actionUsed, false, '不得消耗动作');
  assert.equal(p.slots[1], 2, '不得扣除法术位');
  assert.equal(p.stats.spellsCast, 0);
  assert.equal(g.calls.damage.length, 0, '不得造成伤害');
});

test('(e) 战士施放已拥有的特性 f:tactician 通过（等级3）', () => {
  const g = makeGame({ w: 16, h: 16 });
  g.addPlayer({ pid: 'p1', cls: 'fighter', x: 5, y: 5, level: 3 });
  const t = g.startTurn('p1');
  const r = g.actCast('p1', { spellId: 'f:tactician' });
  assert.equal(r.ok, true);
  assert.equal(t.actionUsed, true);
});

test('(e) 法师对射程内目标施放 magicmissile：扣法术位并结算伤害', () => {
  setSeed(11);
  const g = makeGame({ w: 16, h: 16 });
  const { p } = g.addPlayer({ pid: 'p1', cls: 'wizard', x: 5, y: 5, slots: { 1: 2 } });
  g.addMonster({ eid: 'm1', x: 5, y: 9, hp: 50 }); // 距离4 ≤ 12
  const t = g.startTurn('p1');
  const r = g.actCast('p1', { spellId: 's:magicmissile', targetEid: 'm1' });
  assert.equal(r.ok, true, r.msg);
  assert.equal(t.actionUsed, true, '合法施法消耗动作');
  assert.equal(p.slots[1], 1, '消耗1个1环法术位');
  assert.equal(p.stats.spellsCast, 1);
  assert.equal(g.calls.damage.length, 1);
  assert.equal(g.calls.damage[0].eid, 'm1');
});

test('(e) 法师戏法 firebolt 不扣法术位', () => {
  setSeed(13);
  const g = makeGame({ w: 16, h: 16 });
  const { p } = g.addPlayer({ pid: 'p1', cls: 'wizard', x: 5, y: 5, slots: { 1: 2 } });
  g.addMonster({ eid: 'm1', x: 5, y: 8, hp: 50 });
  const t = g.startTurn('p1');
  const r = g.actCast('p1', { spellId: 's:firebolt', targetEid: 'm1' });
  assert.equal(r.ok, true, r.msg);
  assert.equal(p.slots[1], 2, '戏法不扣法术位');
  assert.equal(t.actionUsed, true);
});

test('(e) 目标超出法术射程：不扣动作、不扣法术位、不结算', () => {
  const g = makeGame({ w: 40, h: 12 });
  const { p } = g.addPlayer({ pid: 'p1', cls: 'wizard', x: 0, y: 0, slots: { 1: 2 } });
  g.addMonster({ eid: 'm1', x: 30, y: 0 }); // 距离30 > firebolt 12
  const t = g.startTurn('p1');
  const r = g.actCast('p1', { spellId: 's:firebolt', targetEid: 'm1' });
  assert.equal(r.ok, false);
  assert.equal(r.undo, true);
  assert.match(r.msg, /射程/);
  assert.equal(t.actionUsed, false);
  assert.equal(p.slots[1], 2);
  assert.equal(g.calls.damage.length, 0);
});

test('(e) AOE 区域内没有敌人：不扣动作与法术位', () => {
  const g = makeGame({ w: 20, h: 20 });
  const { p } = g.addPlayer({ pid: 'p1', cls: 'wizard', x: 2, y: 2, slots: { 1: 2 } });
  g.addMonster({ eid: 'm1', x: 18, y: 18 });
  const t = g.startTurn('p1');
  const r = g.actCast('p1', { spellId: 's:burninghands', x: 2, y: 2 });
  assert.equal(r.ok, false);
  assert.equal(r.undo, true);
  assert.match(r.msg, /区域内没有敌人/);
  assert.equal(t.actionUsed, false);
  assert.equal(p.slots[1], 2);
});

test('(e) AOE 命中区域内敌人：扣法术位并结算', () => {
  setSeed(17);
  const g = makeGame({ w: 20, h: 20 });
  const { p } = g.addPlayer({ pid: 'p1', cls: 'wizard', x: 5, y: 5, slots: { 1: 2 } });
  g.addMonster({ eid: 'm1', x: 6, y: 6, hp: 50 });
  g.addMonster({ eid: 'm2', x: 5, y: 6, hp: 50 });
  const t = g.startTurn('p1');
  const r = g.actCast('p1', { spellId: 's:burninghands', x: 5, y: 6 });
  assert.equal(r.ok, true, r.msg);
  assert.equal(p.slots[1], 1);
  assert.deepEqual(g.calls.damage.map(d => d.eid).sort(), ['m1', 'm2']);
});

test('(e) 对未表决的 BOSS 施法：触发 _openBossVote，不造成伤害也不扣资源', () => {
  const g = makeGame({ w: 16, h: 16 });
  const { p } = g.addPlayer({ pid: 'p1', cls: 'wizard', x: 5, y: 5, slots: { 1: 2 } });
  g.addMonster({ eid: 'boss', x: 5, y: 8, hp: 80, boss: true, squad: 'bosssq' });
  const t = g.startTurn('p1');
  const r = g.actCast('p1', { spellId: 's:magicmissile', targetEid: 'boss' });
  assert.equal(r.ok, false);
  assert.equal(r.undo, true);
  assert.match(r.msg, /BOSS/);
  assert.deepEqual(g.calls.openBossVote.map(c => c.bossEid), ['boss'], '必须发起 BOSS 表决');
  assert.equal(g.calls.damage.length, 0, '表决前不得造成伤害');
  assert.equal(t.actionUsed, false, '不得消耗动作');
  assert.equal(p.slots[1], 2, '不得扣法术位');
});

test('(e) AOE 覆盖未表决 BOSS：同样先走表决', () => {
  const g = makeGame({ w: 20, h: 20 });
  const { p } = g.addPlayer({ pid: 'p1', cls: 'wizard', x: 5, y: 5, slots: { 1: 2 } });
  g.addMonster({ eid: 'boss', x: 6, y: 6, hp: 80, boss: true, squad: 'bosssq' });
  const t = g.startTurn('p1');
  const r = g.actCast('p1', { spellId: 's:burninghands', x: 6, y: 6 });
  assert.equal(r.ok, false);
  assert.deepEqual(g.calls.openBossVote.map(c => c.bossEid), ['boss']);
  assert.equal(g.calls.damage.length, 0);
  assert.equal(p.slots[1], 2);
});

test('(e) BOSS 已在当前战斗小队内：正常施法，不再表决', () => {
  setSeed(19);
  const g = makeGame({ w: 16, h: 16 });
  const { p } = g.addPlayer({ pid: 'p1', cls: 'wizard', x: 5, y: 5, slots: { 1: 2 } });
  g.addMonster({ eid: 'boss', x: 5, y: 8, hp: 80, boss: true, squad: 'bosssq' });
  g.combat = { active: true, round: 1, order: [], idx: 0, squads: new Set(['bosssq']) };
  const t = g.startTurn('p1');
  const r = g.actCast('p1', { spellId: 's:magicmissile', targetEid: 'boss' });
  assert.equal(r.ok, true, r.msg);
  assert.equal(g.calls.openBossVote.length, 0);
  assert.equal(p.slots[1], 1);
  assert.equal(g.calls.damage.length, 1);
});
