// R1-5：rooms.mjs 分发层必须把客户端传入的落点 x,y 透传给 actUseItem
// 背景：R1-1 曾修复此透传，但 09-13 用户 WIP 合并时整文件被覆盖，透传丢失，
// 而既有测试只覆盖 actUseItem 本身（tests/r1-1/charsheet.test.mjs），不覆盖分发层，
// 因此 63/63 全绿却功能未修。本测试即为补上该缺口。
import test from 'node:test';
import assert from 'node:assert/strict';
import { Rooms } from '../../server/game/rooms.mjs';

// 构造一个只记录入参的假 game，避免启动真实房间/AI/计时器
function fakeRooms() {
  const rooms = new Rooms();
  const calls = [];
  const game = {
    actUseItem: (pid, arg) => { calls.push({ fn: 'actUseItem', pid, arg }); return { ok: true }; },
    actCast: (pid, arg) => { calls.push({ fn: 'actCast', pid, arg }); return { ok: true }; },
    actMove: (pid, arg) => { calls.push({ fn: 'actMove', pid, arg }); return { ok: true }; },
  };
  rooms.rooms.set('TEST', { code: 'TEST', game });
  return { rooms, calls, player: { pid: 'p1', roomCode: 'TEST' } };
}

test('game:item 透传 x,y 到 actUseItem', async () => {
  const { rooms, calls, player } = fakeRooms();
  await rooms._gameMsg(player, { t: 'game:item', itemId: 'flask', x: 7, y: 9 });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].fn, 'actUseItem');
  assert.equal(calls[0].arg.itemId, 'flask');
  assert.equal(calls[0].arg.x, 7, 'x 必须透传，否则火焰瓶永远取不到落点');
  assert.equal(calls[0].arg.y, 9, 'y 必须透传，否则火焰瓶永远取不到落点');
});

test('game:item 未带坐标时 x,y 为 undefined，不伪造坐标', async () => {
  const { rooms, calls, player } = fakeRooms();
  await rooms._gameMsg(player, { t: 'game:item', itemId: 'flask', targetEid: 'e1' });
  assert.equal(calls[0].arg.targetEid, 'e1');
  assert.equal(calls[0].arg.x, undefined);
  assert.equal(calls[0].arg.y, undefined);
});

test('game:item 落点为 (0,0) 时必须原样透传，不能被当作空值吞掉', async () => {
  // 边界：0 是合法坐标。若实现写成 msg.x || undefined 之类的假值判断，会把 (0,0) 吞成 undefined，
  // 导致地图左上角无法作为落点。本用例守住该边界。
  const { rooms, calls, player } = fakeRooms();
  await rooms._gameMsg(player, { t: 'game:item', itemId: 'flask', x: 0, y: 0 });
  assert.equal(calls[0].arg.x, 0, 'x=0 是合法坐标，必须透传');
  assert.equal(calls[0].arg.y, 0, 'y=0 是合法坐标，必须透传');
});

test('game:cast 同样透传 x,y（防止同类回退）', async () => {
  const { rooms, calls, player } = fakeRooms();
  await rooms._gameMsg(player, { t: 'game:cast', spellId: 's:firebolt', x: 3, y: 4 });
  assert.equal(calls[0].arg.spellId, 's:firebolt');
  assert.equal(calls[0].arg.x, 3);
  assert.equal(calls[0].arg.y, 4);
});
