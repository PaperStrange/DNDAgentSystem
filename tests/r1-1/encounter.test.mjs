// R1-1 (g)(h)(i)：怪物近战接近 / 自动开战首位先攻 / BOSS 逃跑上下文
import { test } from 'node:test';
import assert from 'node:assert';
import { makeGame } from './_fixture.mjs';
import { setSeed, manhattan } from '../../server/util.mjs';

// ---------- (g) _monsterAct：先移动再判定，进入攻击距离那一步要走上去 ----------
test('(g) range1 怪物在距离2：走到距离1并发起攻击', () => {
  const g = makeGame({ w: 12, h: 12 });
  const { e: pe } = g.addPlayer({ pid: 'p1', cls: 'fighter', x: 5, y: 7 });
  const m = g.addMonster({ eid: 'm1', x: 5, y: 5, speed: 6, attacks: [{ name: '爪击', range: 1, bonus: 3, dmg: '1d4' }] });
  assert.equal(manhattan(m, pe), 2);
  g.__real._monsterAct(m);
  assert.equal(manhattan(m, pe), 1, 'range1 怪物应真正逼近到距离1');
  assert.equal(m.x, 5);
  assert.equal(m.y, 6);
  assert.equal(g.calls.performAttack.length, 1, '进入射程后必须发起攻击');
  assert.equal(g.calls.performAttack[0].atkName, '爪击');
});

test('(g) range2 怪物在距离3：走到距离2并发起攻击', () => {
  const g = makeGame({ w: 12, h: 12 });
  const { e: pe } = g.addPlayer({ pid: 'p1', cls: 'fighter', x: 5, y: 8 });
  const m = g.addMonster({ eid: 'm1', x: 5, y: 5, speed: 6, attacks: [{ name: '长矛', range: 2, bonus: 3, dmg: '1d6' }] });
  assert.equal(manhattan(m, pe), 3);
  g.__real._monsterAct(m);
  assert.equal(manhattan(m, pe), 2, 'range2 怪物应走到距离2');
  assert.equal(g.calls.performAttack.length, 1);
});

test('(g) 已经在射程内：不移动，直接攻击', () => {
  const g = makeGame({ w: 12, h: 12 });
  const { e: pe } = g.addPlayer({ pid: 'p1', cls: 'fighter', x: 5, y: 6 });
  const m = g.addMonster({ eid: 'm1', x: 5, y: 5, speed: 6, attacks: [{ name: '爪击', range: 1, bonus: 3, dmg: '1d4' }] });
  g.__real._monsterAct(m);
  assert.equal(m.x, 5);
  assert.equal(m.y, 5, '已在射程内不应移动');
  assert.equal(g.calls.performAttack.length, 1);
});

test('(g) 移动步数不超过怪物速度', () => {
  const g = makeGame({ w: 20, h: 20 });
  g.addPlayer({ pid: 'p1', cls: 'fighter', x: 0, y: 18 });
  const m = g.addMonster({ eid: 'm1', x: 0, y: 0, speed: 2, attacks: [{ name: '爪击', range: 1, bonus: 3, dmg: '1d4' }] });
  g.__real._monsterAct(m);
  assert.equal(m.y, 2, '速度2最多走2步');
  assert.equal(g.calls.performAttack.length, 0, '仍够不着，不攻击');
});

// ---------- (h) 自动开战：先攻顺序首位真的先动 ----------
function setupInitiative(mode) {
  const g = makeGame({ w: 12, h: 12, mode });
  const { e: pe } = g.addPlayer({ pid: 'p1', cls: 'fighter', x: 1, y: 1 });
  const m = g.addMonster({ eid: 'm1', x: 6, y: 6, squad: 'sq1' });
  g._endTurn = g.__real._endTurn; // 需要真实的 _endTurn 推进先攻
  return { g, pe, m };
}

test('(h) 自动模式：_alertSquad 后首个被调度的是先攻顺序第一位（玩家）', () => {
  const { g, pe, m } = setupInitiative('auto');
  g.combatCount = 0; // 首场遭遇 → 团队先手，order = [player, monster]
  g.__real._alertSquad(m);
  assert.equal(g.combat.active, true);
  assert.deepEqual(g.combat.order, [pe.eid, m.eid], '先攻顺序：玩家在前');
  assert.equal(g.combat.idx, 0, 'idx 应停在 0（首位）');
  assert.deepEqual(g.calls.startPlayerTurn, ['p1'], '首个被调度的必须是 order[0]，不是 order[1]');
  assert.equal(g.calls.scheduleMonsterTurn.length, 0, '怪物不应抢在首位之前行动');
});

test('(h) 自动模式：怪物先攻时首个被调度的也是 order[0]（怪物）', () => {
  const g = makeGame({ w: 12, h: 12, mode: 'auto' });
  const { e: pe } = g.addPlayer({ pid: 'p1', cls: 'fighter', x: 1, y: 1 });
  const m = g.addMonster({ eid: 'm1', x: 6, y: 6, squad: 'sq1' });
  g.entities.get(m.eid).dex = 20;          // 怪物敏捷更高 → 敌方先动
  g.entities.get(pe.eid).dex = 5;
  g._endTurn = g.__real._endTurn;
  g.combatCount = 5;                        // 非首场 → 比较阵营敏捷
  g.__real._alertSquad(m);
  assert.deepEqual(g.combat.order, [m.eid, pe.eid], '先攻顺序：怪物在前');
  assert.equal(g.combat.idx, 0);
  assert.deepEqual(g.calls.scheduleMonsterTurn, [m.eid], '首个被调度的是 order[0]=怪物');
  assert.equal(g.calls.startPlayerTurn.length, 0);
});

test('(h) 手动模式：保留当前玩家回合，不立即调度下一位', () => {
  const { g, pe, m } = setupInitiative('manual');
  g.combatCount = 0;
  g.turn = { actorEid: pe.eid, playerId: 'p1', kind: 'player', moveLeft: 6, actionUsed: false, bonusUsed: false, round: 0 };
  g.__real._alertSquad(m);
  assert.equal(g.calls.startPlayerTurn.length, 0, '手动模式不应抢走当前玩家回合');
  assert.equal(g.calls.scheduleMonsterTurn.length, 0);
  assert.equal(g.calls.endTurn, 0);
  assert.equal(g.combat.idx, 0, '手动模式：idx 落在自己身上，_endTurn 后即下一位');
});

// ---------- (i) BOSS 逃跑：失败也要带回正确的 bossEid ----------
test('(i) 逃跑失败（d20<11）：_alertSquad 被调用且 bossEid 与原 BOSS 一致', () => {
  const g = makeGame({ w: 16, h: 16 });
  g.addPlayer({ pid: 'p1', cls: 'fighter', x: 1, y: 1 });
  const boss = g.addMonster({ eid: 'boss1', x: 8, y: 8, hp: 100, boss: true, squad: 'bosssq' });

  let failSeen = 0, fleeSeen = 0;
  for (let seed = 1; seed <= 120; seed++) {
    setSeed(seed);
    g.pendingBoss = { bossEid: boss.eid, votes: new Map() };
    g.calls.alertSquad = [];
    g.calls.fleeToCamp = [];
    const r = g.__real._resolveBossFlee();
    if (r.fled) {
      fleeSeen++;
      assert.equal(g.calls.fleeToCamp.length, 1, 'seed=' + seed + ' 逃跑成功应回营地');
      assert.equal(g.calls.alertSquad.length, 0);
    } else {
      failSeen++;
      assert.equal(g.calls.alertSquad.length, 1, 'seed=' + seed + ' 逃跑失败必须真的开战');
      assert.equal(g.calls.alertSquad[0].eid, 'boss1', '开战对象必须是原 BOSS（bossEid 未丢失）');
      assert.equal(g.calls.alertSquad[0].opts && g.calls.alertSquad[0].opts.bossFight, true);
      assert.equal(g.calls.fleeToCamp.length, 0);
    }
    assert.equal(g.pendingBoss, null, '表决结束后 pendingBoss 必须清空');
  }
  assert.ok(failSeen > 0 && fleeSeen > 0, '两种分支都应被覆盖（失败' + failSeen + '/成功' + fleeSeen + '）');
});

test('(i) _startBossCombat 显式传入 bossEid 时不再依赖 pendingBoss', () => {
  const g = makeGame({ w: 16, h: 16 });
  g.addPlayer({ pid: 'p1', cls: 'fighter', x: 1, y: 1 });
  const boss = g.addMonster({ eid: 'boss1', x: 8, y: 8, hp: 100, boss: true, squad: 'bosssq' });
  g.pendingBoss = null; // 上下文已丢失的典型场景
  g.__real._startBossCombat(boss.eid);
  assert.deepEqual(g.calls.alertSquad.map(c => c.eid), ['boss1']);
  assert.ok(g.bossRevealCd > 0, 'reveal cooldown 仍然保留');
});

test('(i) 逃跑成功：调用 _fleeToCamp 且不开战', () => {
  const g = makeGame({ w: 16, h: 16 });
  g.addPlayer({ pid: 'p1', cls: 'fighter', x: 1, y: 1 });
  const boss = g.addMonster({ eid: 'boss1', x: 8, y: 8, hp: 100, boss: true, squad: 'bosssq' });
  let done = false;
  for (let seed = 1; seed <= 200 && !done; seed++) {
    setSeed(seed);
    g.pendingBoss = { bossEid: boss.eid, votes: new Map() };
    g.calls.alertSquad = [];
    g.calls.fleeToCamp = [];
    const r = g.__real._resolveBossFlee();
    if (r.fled) {
      assert.equal(g.calls.fleeToCamp.length, 1);
      assert.equal(g.calls.alertSquad.length, 0);
      assert.equal(r.fled, true);
      done = true;
    }
  }
  assert.equal(done, true, '应能覆盖到逃跑成功的种子');
});
