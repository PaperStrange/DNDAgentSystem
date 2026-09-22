// R1-35 回归：房间流程内「服务端签发的 characterId」回写本地名册 serverId。
//
// 背景：全仓写 serverId 原先只有 applyServerIds / restoreFromServer 两处，且都只在登录（s:hello）
// 触发；房间内拿到的 mySheet.characterId 从不回写 ⇒ ① 换房/重登后 loadedCharacterId 无从回落
// （服务端权威锁定失效、level/xp 掉回 1/0）；② page.reload() 时 restoreFromServer 因 have 命中不到
// 而 unshift 出**同名重复条目**（ui-check R-11 的下游症状）。
//
// 本用例在 Node 侧以 localStorage 垫片直接驱动客户端真源 public/js/roster.mjs，覆盖：
//   T1 保存后回写 ⇒ 重载不再产生同名重复条目（R-11 转绿的产品侧机理）
//   T2 反例4：回写只加 serverId 字段，**不删本地数据**（保留原卡与其它字段）
//   T3 反例3：bindServerId 与 applyServerIds **共用同一写入真源**（语义一致：写值 + 清 syncError + 幂等）
//   T4 换房场景：loadedCharacterId 可从名册 serverId 回落（服务端锁定的前提条件）
//   T5 回写不破坏在世过滤（阵亡角色仍被 aliveEntries 排除）
//
// 回归性：未修复版本（dda59a1）未导出 bindServerId ⇒ 本文件在链接期即失败（具名导出缺失）。
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  ROSTER_KEY, upsertEntry, restoreFromServer, loadRoster, aliveEntries,
  applyServerIds, bindServerId,
} from '../../public/js/roster.mjs';

// ---- localStorage 垫片（Node 无 DOM；roster.mjs 仅在调用期读写 localStorage）----
let mem = new Map();
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => { mem.set(k, String(v)); },
  removeItem: (k) => { mem.delete(k); },
};
beforeEach(() => { mem = new Map(); });

const SHEET = (over = {}) => ({
  name: '剑心', raceId: 'human', classId: 'fighter',
  stats: { STR: 15, DEX: 12, CON: 14, INT: 10, WIS: 13, CHA: 8 },
  flex: {}, colors: {}, background: '测试背景', look: {}, level: 1, xp: 0, ...over,
});
// 服务端角色列表条目（s:hello.characters 形态）
const srvChar = (cid, over = {}) => ({
  characterId: cid, status: 'alive',
  locked: { ...SHEET(), ...over }, editable: { colors: {}, look: {} },
});
const byName = (n) => loadRoster().filter((e) => e && e.name === n);

test('R1-35 T1：保存后回写 serverId ⇒ 重载不再产生同名重复条目（R-11 产品侧机理）', () => {
  const rid = upsertEntry(SHEET(), null);
  assert.equal(loadRoster().length, 1, '保存瞬间本地仅一条');
  assert.equal(loadRoster()[0].serverId, undefined, '保存瞬间尚无 serverId（服务端还未签发）');
  // 服务端签发 characterId → 房间流程回写（R1-35 新增路径）
  assert.equal(bindServerId(rid, 'ch-X'), true, '回写应报告变更');
  assert.equal(loadRoster()[0].serverId, 'ch-X', 'serverId 已落到本地条目');
  // page.reload() → s:hello 带 characters:[X] → restoreFromServer
  restoreFromServer([srvChar('ch-X')]);
  assert.equal(byName('剑心').length, 1, '★ 重载后不得出现同名重复条目');
  assert.equal(byName('剑心')[0].serverId, 'ch-X');
});

test('R1-35 T2（反例4）：回写只加 serverId，不删本地数据', () => {
  const rid = upsertEntry(SHEET({ background: '不可丢失的背景' }), null);
  bindServerId(rid, 'ch-Y');
  const e = loadRoster().find((x) => x.id === rid);
  assert.ok(e, '原条目必须保留（不得删）');
  assert.equal(e.background, '不可丢失的背景', '其它字段不得被破坏');
  assert.equal(e.status, 'alive');
  assert.equal(e.serverId, 'ch-Y');
});

test('R1-35 T3（反例3）：bindServerId 与 applyServerIds 共用同一写入真源（语义一致）', () => {
  const rid = upsertEntry(SHEET(), null);
  // 预置一条 syncError：两处写入都应清除它
  const seed = loadRoster(); seed[0].syncError = '旧错误'; localStorage.setItem(ROSTER_KEY, JSON.stringify(seed));
  // 批量路径
  const n = applyServerIds({ [rid]: 'ch-Z' });
  assert.equal(n, 1, 'applyServerIds 应写回 1 条');
  const afterBatch = loadRoster().find((x) => x.id === rid);
  assert.equal(afterBatch.serverId, 'ch-Z');
  assert.equal(afterBatch.syncError, undefined, 'applyServerIds 清 syncError（与单条同源）');
  // 单条路径幂等：同值不重复计入
  assert.equal(bindServerId(rid, 'ch-Z'), false, '同值回写应无变更（幂等）');
});

test('R1-35 T4：换房场景——loadedCharacterId 可从名册 serverId 回落', () => {
  const rid = upsertEntry(SHEET(), null);
  bindServerId(rid, 'ch-W');
  // 模拟换新房间：客户端从名册条目取 serverId 作为 loadedCharacterId 带出（room.mjs:377）
  const entry = loadRoster().find((x) => x.id === rid);
  assert.equal(entry.serverId, 'ch-W', '换房后仍能从名册取到 characterId ⇒ 服务端锁定可生效');
});

test('R1-35 T5：回写不破坏在世过滤（阵亡角色仍被排除）', () => {
  const rid = upsertEntry(SHEET(), null);
  bindServerId(rid, 'ch-V');
  const list = loadRoster(); list.find((x) => x.id === rid).status = 'dead';
  localStorage.setItem(ROSTER_KEY, JSON.stringify(list));
  assert.equal(byName('剑心').length, 1, '条目仍在（未删）');
  assert.equal(aliveEntries().filter((e) => e.name === '剑心').length, 0, '阵亡角色不出现在在世列表');
});
