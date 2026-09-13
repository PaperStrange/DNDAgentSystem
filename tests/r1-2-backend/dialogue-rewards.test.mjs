// R1-2：对话奖励生效——治疗/武器强化以 option 级字段为准（dungeon.mjs 中 heal / cost.upgrade）
// 纯内存测试：不启动服务、不读配置、不调用 LLM。
import test from 'node:test';
import assert from 'node:assert/strict';
import { installDialogue } from '../../server/game/systems/dialogue.mjs';

function makeGame({ gold = 100, hp = 10, maxHp = 20 } = {}) {
  const ent = { eid: 'e1', kind: 'player', playerId: 'p1', name: '测试者', x: 0, y: 0, hp, maxHp };
  const p = {
    pid: 'p1', eid: 'e1', name: '测试者', gold, keys: [], items: {},
    sheet: { hp, maxHp, upgradeWeapon: false },
    stats: { npcTalks: 0, talkTags: [], goldEarned: 0, healed: 0, rescues: [] },
  };
  const g = {
    players: new Map([['p1', p]]),
    entities: new Map([['e1', ent]]),
    flags: new Set(),
    keys: new Set(),
    dialogues: new Map(),
    logs: [],
    npcTextOf: (_id, _kind, _oid, fallback) => fallback,
    _campGuard: () => null,
    addClue() {},
    narrate() {},
    logMsg(...a) { this.logs.push(a.join(' ')); },
    _checkChapterObjective() {},
    _checkPublicWin() {},
    _heal(target, amount) { // 与 combat.mjs:383 一致：clamp 到 maxHp
      target.hp = Math.max(0, Math.min(target.maxHp, target.hp + amount));
      p.stats.healed += amount;
      p.sheet.hp = target.hp;
    },
  };
  installDialogue(g);
  return { g, p, ent };
}

function openDialogue(g, npcId) {
  const npcE = { eid: 'n1', npcId, name: npcId, kind: 'npc', x: 0, y: 0 };
  g.entities.set('n1', npcE);
  g._openDialogue(g.players.get('p1'), npcE);
  return npcE;
}

test('toblen 热汤：HP +5', () => {
  const { g, p, ent } = makeGame({ gold: 100, hp: 5, maxHp: 20 });
  openDialogue(g, 'toblen');
  const r = g.actDialogueOption('p1', { optionId: 'heal' });
  assert.equal(r.ok, true);
  assert.equal(ent.hp, 10, '5 + 5 = 10');
});

test('toblen 热汤：不超过 maxHp（hp = maxHp - 2 时封顶）', () => {
  const { g, ent } = makeGame({ gold: 100, hp: 18, maxHp: 20 });
  openDialogue(g, 'toblen');
  const r = g.actDialogueOption('p1', { optionId: 'heal' });
  assert.equal(r.ok, true);
  assert.equal(ent.hp, 20, '18 + 5 应被 clamp 到 20');
});

test('galaelle 神恩：HP +10', () => {
  const { g, ent } = makeGame({ gold: 100, hp: 4, maxHp: 25 });
  openDialogue(g, 'galaelle');
  assert.equal(g.actDialogueOption('p1', { optionId: 'heal' }).ok, true);
  assert.equal(ent.hp, 14);
});

test('治疗选项 once：第二次选择不再加血', () => {
  const { g, p, ent } = makeGame({ gold: 100, hp: 5, maxHp: 20 });
  openDialogue(g, 'toblen');
  assert.equal(g.actDialogueOption('p1', { optionId: 'heal' }).ok, true);
  assert.equal(ent.hp, 10);
  // 重新开启对话（首次选择后 dialogues 已关闭），再次选择同一选项
  openDialogue(g, 'toblen');
  const r2 = g.actDialogueOption('p1', { optionId: 'heal' });
  assert.equal(r2.ok, false, 'once 选项第二次应被拒绝');
  assert.equal(r2.msg, '已经做过了');
  assert.equal(ent.hp, 10, 'HP 不应再次增加');
  assert.equal(p.gold, 100, '免费选项不扣金币');
});

test('linene 磨刀石：扣 80 金且 upgradeWeapon=true', () => {
  const { g, p } = makeGame({ gold: 100 });
  openDialogue(g, 'linene');
  const r = g.actDialogueOption('p1', { optionId: 'buy' });
  assert.equal(r.ok, true);
  assert.equal(p.gold, 20, '100 - 80');
  assert.equal(p.sheet.upgradeWeapon, true);
});

test('linene 磨刀石：金币不足则拒绝，零副作用', () => {
  const { g, p } = makeGame({ gold: 50 });
  openDialogue(g, 'linene');
  const r = g.actDialogueOption('p1', { optionId: 'buy' });
  assert.equal(r.ok, false);
  assert.equal(r.msg, '金币不足');
  assert.equal(p.gold, 50, '金币不应被扣');
  assert.equal(p.sheet.upgradeWeapon, false, '不应获得强化');
  assert.equal(g.flags.size, 0, '不应写入 once 标记');
});

test('linene 磨刀石：once 生效，第二次不再扣钱', () => {
  const { g, p } = makeGame({ gold: 200 });
  openDialogue(g, 'linene');
  assert.equal(g.actDialogueOption('p1', { optionId: 'buy' }).ok, true);
  assert.equal(p.gold, 120);
  openDialogue(g, 'linene');
  const r2 = g.actDialogueOption('p1', { optionId: 'buy' });
  assert.equal(r2.ok, false);
  assert.equal(p.gold, 120, '金币不应再次扣除');
  assert.equal(p.sheet.upgradeWeapon, true);
});

test('无效 optionId：返回错误且零副作用', () => {
  const { g, p, ent } = makeGame({ gold: 77, hp: 6, maxHp: 20 });
  openDialogue(g, 'toblen');
  const flagsBefore = g.flags.size;
  const r = g.actDialogueOption('p1', { optionId: 'no_such_option' });
  assert.equal(r.ok, false);
  assert.equal(r.msg, '选项无效');
  assert.equal(g.flags.size, flagsBefore, 'flags 无新增');
  assert.equal(p.gold, 77, '金币不变');
  assert.equal(ent.hp, 6, 'HP 不变');
  assert.equal(p.sheet.upgradeWeapon, false);
});
