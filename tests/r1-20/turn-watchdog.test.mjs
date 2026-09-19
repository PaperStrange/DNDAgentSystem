// R1-20 回合制修复 —— 看门狗按「玩家级手动/自动」装配（无服务器 / 无浏览器 / 无 LLM）
//
// 背景：原实现只有房间级 room.mode，看门狗用 room.mode 判定 ⇒ auto 房间里自行切到手动的
// 玩家仍被 8 秒强制结束回合（用户看到的「另一个角色仍然会行动」）。
// 修复：新增玩家级 this.manual；看门狗改判「该玩家」状态：
//   手动+在线 → 0（一直等待）；自动+在线 → 8000；离线 → 2500（断线防死锁）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeGame } from '../r1-1/_fixture.mjs';

// 捕获看门狗装配的超时值（不真正触发计时器）
// 包装 _armTurnWatchdog：每次装配前先清空记录，这样「不装配」与「装配了」可区分
function armCapture(g) {
  g.__armed = null;
  g.turnTimer = null;
  g.later = (ms, fn) => { g.__armed = { ms, fn }; return 1; };
  const realArm = g._armTurnWatchdog.bind(g);
  g._armTurnWatchdog = (pid) => { g.__armed = null; g.turnTimer = null; return realArm(pid); };
}

function twoPlayers({ mode = 'auto' } = {}) {
  const g = makeGame({ mode });
  g.addPlayer({ pid: 'A' });
  g.addPlayer({ pid: 'B' });
  // 模拟 Game 构造器：按房间模式初始化玩家级手动状态
  g.manual = new Map([['A', mode === 'manual'], ['B', mode === 'manual']]);
  g.isPlayerOnline = () => true;
  // fixture 是纯对象（非 Game 实例），补齐 game.mjs 上的 isPlayerTurn
  g.isPlayerTurn = (pid) => !!(g.turn && g.turn.playerId === pid && g.state === 'playing');
  armCapture(g);
  return { g };
}

// ---------------- G1：看门狗判定（核心） ----------------

test('R1-20 G1: 手动+在线 → 不装配超时（一直等待）', () => {
  const { g } = twoPlayers();
  g.manual.set('A', true);
  g.__real._startPlayerTurn('A');
  assert.equal(g.turn.playerId, 'A');
  assert.equal(g.__armed, null, '手动在线不得装配任何超时计时器');
  assert.equal(g.turnTimer, null);
});

test('R1-20 G1: 自动+在线 → 8000ms（不变）', () => {
  const { g } = twoPlayers();
  g.manual.set('A', false);
  g.__real._startPlayerTurn('A');
  assert.ok(g.__armed, '自动在线应装配计时器');
  assert.equal(g.__armed.ms, 8000);
});

test('R1-20 G4: 手动+离线 → 2500ms（断线防死锁保留）', () => {
  const { g } = twoPlayers();
  g.manual.set('A', true);
  g.isPlayerOnline = () => false;
  g.__real._startPlayerTurn('A');
  assert.ok(g.__armed);
  assert.equal(g.__armed.ms, 2500);
});

test('R1-20 G4: 自动+离线 → 2500ms', () => {
  const { g } = twoPlayers();
  g.manual.set('A', false);
  g.isPlayerOnline = () => false;
  g.__real._startPlayerTurn('A');
  assert.equal(g.__armed.ms, 2500);
});

test('R1-20 看门狗触发后确实推进回合（未卡住）', () => {
  const { g } = twoPlayers();
  g.manual.set('A', false);
  g._endTurn = g.__real._endTurn; // 让看门狗回调真正推进
  g.__real._startPlayerTurn('A');
  assert.equal(g.__armed.ms, 8000);
  g.__armed.fn(); // 模拟 8 秒到点
  assert.ok(g.calls.log.some(s => s.includes('未行动，回合自动跳过')), '应打出「回合自动跳过」日志');
  assert.ok(g.calls.startPlayerTurn.includes('B'), '应推进到下一座位 B');
});

// ---------------- G2：玩家级状态通道 ----------------

test('R1-20 G2: setAutoplay 切手动 → 撤销当前回合看门狗（不再跳过）', () => {
  const { g } = twoPlayers();
  g.manual.set('A', false);
  g.__real._startPlayerTurn('A');
  assert.equal(g.__armed.ms, 8000);
  const r = g.setAutoplay('A', false);
  assert.deepEqual(r, { ok: true, manual: true });
  assert.equal(g.isManualPlayer('A'), true);
  assert.equal(g.__armed, null, '切手动后应撤销超时计时器');
  assert.equal(g.turnTimer, null);
});

test('R1-20 G2: setAutoplay 切自动 → 当前回合重新装配 8000ms', () => {
  const { g } = twoPlayers();
  g.manual.set('A', true);
  g.__real._startPlayerTurn('A');
  assert.equal(g.__armed, null);
  const r = g.setAutoplay('A', true);
  assert.deepEqual(r, { ok: true, manual: false });
  assert.equal(g.__armed.ms, 8000);
});

test('R1-20 G2: setAutoplay 非本人回合不干扰当前回合', () => {
  const { g } = twoPlayers();
  g.manual.set('A', true); g.manual.set('B', true);
  g.__real._startPlayerTurn('A');
  const r = g.setAutoplay('B', true); // B 不是当前回合者
  assert.equal(r.ok, true);
  assert.equal(g.isManualPlayer('B'), false, 'B 的状态被改写');
  assert.equal(g.turn.playerId, 'A', 'A 的回合不受影响');
  assert.equal(g.__armed, null, 'A 仍为手动 → 不装配计时器');
  assert.equal(g.setAutoplay('ZZ', true).ok, false, '未知玩家应拒绝');
});

test('R1-20: 未登记玩家回退房间级模式（防御）', () => {
  const g = makeGame({ mode: 'manual' });
  g.addPlayer({ pid: 'A' });
  g.manual = new Map(); // 空表
  assert.equal(g.isManualPlayer('A'), true, 'manual 房默认手动');
  g.room.mode = 'auto';
  assert.equal(g.isManualPlayer('A'), false, 'auto 房默认自动');
});

// ---------------- 断线防死锁（notifyPresence） ----------------

test('R1-20 断线防死锁: 手动玩家断线 → 看门狗改为 2500ms；重连 → 撤销', () => {
  const { g } = twoPlayers();
  g.manual.set('A', true);
  g.__real._startPlayerTurn('A');
  assert.equal(g.__armed, null);
  g.isPlayerOnline = () => false; // 断线
  g.notifyPresence('A');
  assert.ok(g.__armed);
  assert.equal(g.__armed.ms, 2500, '断线后必须改为 2500ms，否则永久卡死');
  g.isPlayerOnline = () => true; // 重连
  g.notifyPresence('A');
  assert.equal(g.__armed, null, '重连后回到手动：不再跳过');
});

test('R1-20: notifyPresence 非当前回合者无副作用', () => {
  const { g } = twoPlayers();
  g.manual.set('A', true);
  g.__real._startPlayerTurn('A');
  g.notifyPresence('B');
  assert.equal(g.__armed, null);
  assert.equal(g.turnTimer, null);
});

// ---------------- 核心：行动权唯一 ----------------

test('R1-20 核心: 手动 A 未结束回合时，B 无法移动/结束回合（行动权唯一）', () => {
  const { g } = twoPlayers();
  g.manual.set('A', true); g.manual.set('B', false);
  g.__real._startPlayerTurn('A');
  assert.deepEqual(g.actMove('B', { x: 1, y: 0 }), { ok: false, msg: '不是你的回合' });
  assert.equal(g.actEndTurn('B').ok, false);
  assert.equal(g.turn.playerId, 'A', '回合仍归 A');
});

test('R1-20 核心: A 主动结束回合后，回合交给 B', () => {
  const { g } = twoPlayers();
  g.manual.set('A', true); g.manual.set('B', true);
  g._endTurn = g.__real._endTurn;
  g.__real._startPlayerTurn('A');
  const r = g.actEndTurn('A');
  assert.equal(r.ok, true);
  assert.deepEqual(g.calls.startPlayerTurn, ['B']);
});

// ---------------- 保留的合法跳过（§6.3） ----------------

test('R1-20 保留: 倒地玩家回合仍自动跳过（不卡住）', () => {
  const { g } = twoPlayers();
  g.players.get('A').downed = true;
  g.manual.set('A', true);
  g.__real._startPlayerTurn('A');
  assert.equal(g.calls.endTurn, 1, '倒地 → 死亡豁免后立即结束回合');
});

test('R1-20 保留: 被蛛网缠住的回合跳过', () => {
  const { g } = twoPlayers();
  g.entities.get('e_A').webSkip = true;
  g.manual.set('A', true);
  g.__real._startPlayerTurn('A');
  assert.equal(g.calls.endTurn, 1, '蛛网跳过本回合');
});

test('R1-20 保留: 营地期间不装配看门狗（F-30）', () => {
  const { g } = twoPlayers();
  g.manual.set('A', false); // 自动
  g.camp = { active: true, ownerPid: 'A' };
  g.__real._startPlayerTurn('A');
  assert.equal(g.__armed, null, '营地期间不设看门狗');
});

// ---------------- 补充用例场景 ----------------

test('R1-20 补充: 重复结束回合请求幂等（不得二次推进）', () => {
  const { g } = twoPlayers();
  g.manual.set('A', true); g.manual.set('B', true);
  g._endTurn = g.__real._endTurn;
  g.__real._startPlayerTurn('A');
  const before = g.calls.startPlayerTurn.length;
  assert.equal(g.actEndTurn('A').ok, true);
  const afterFirst = g.calls.startPlayerTurn.length;
  assert.equal(afterFirst, before + 1, '首次结束 → 推进一次');
  assert.equal(g.actEndTurn('A').ok, false, 'A 已非当前回合者');
  assert.equal(g.calls.startPlayerTurn.length, afterFirst, '重复请求不得再次推进');
});

test('R1-20 补充: 座位轮转顺序确定（同条件两次一致）', () => {
  const runOnce = () => {
    const g = makeGame({ mode: 'auto' });
    g.addPlayer({ pid: 'A' }); g.addPlayer({ pid: 'B' }); g.addPlayer({ pid: 'C' });
    const order = [];
    g._startPlayerTurn = (pid) => order.push(pid);
    g._nextSeatTurn('A'); g._nextSeatTurn('B'); g._nextSeatTurn('C');
    return order;
  };
  const r1 = runOnce(), r2 = runOnce();
  assert.deepEqual(r1, ['B', 'C', 'A']);
  assert.deepEqual(r1, r2, '同条件两次顺序必须一致');
});

test('R1-20 补充: 单人局严格回合制（结束回合后轮转回自己，不卡住）', () => {
  const g = makeGame({ mode: 'auto' });
  g.addPlayer({ pid: 'A' });
  g.manual = new Map([['A', true]]);
  const order = [];
  g._startPlayerTurn = (pid) => order.push(pid);
  g._nextSeatTurn('A');
  assert.deepEqual(order, ['A'], '单人局轮转回自己，规则一致且不卡死');
});

test('R1-20 保留: 怪物回合不装配玩家看门狗（回合交界不误跳）', () => {
  const { g } = twoPlayers();
  g.manual.set('A', false);
  g.turn = { actorEid: 'm1', kind: 'monster', round: 1 };
  g._armTurnWatchdog('A');
  assert.equal(g.turnTimer, null, '怪物回合不设玩家看门狗');
  assert.equal(g.__armed, null);
});

test('R1-20 保留: BOSS 表决期间不引入新的跳过（看门狗只按玩家状态）', () => {
  const { g } = twoPlayers();
  g.manual.set('A', true);
  g.pendingBoss = { bossEid: 'm1', votes: new Map() };
  g.__real._startPlayerTurn('A');
  assert.equal(g.__armed, null, '手动在线：仍不跳过（与表决无关）');
  assert.ok(g.pendingBoss, '表决状态保持');
});

test('R1-20 核心: 他回合内自动角色无行动可发（服务端拒绝越权，行动权唯一）', () => {
  const { g } = twoPlayers();
  g.manual.set('A', true); g.manual.set('B', false); // B 自动
  g.__real._startPlayerTurn('A');
  // B 是自动角色，但在 A 的回合，任何行动都必须被拒（服务端权威）
  assert.equal(g.actMove('B', { x: 1, y: 0 }).ok, false);
  assert.equal(g.actAttack('B', { targetEid: 'm1' }).ok, false);
  assert.equal(g.actDash('B').ok, false);
  assert.equal(g.turn.playerId, 'A');
});
