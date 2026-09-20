// R1-33 Part 2 E2E 回归 —— 真服务端进程 + 真 WebSocket（覆盖 index.mjs 接线 + 退房重进 + 伪造协议消息）
//
// 与 tests/r1-33/server-authority.test.mjs（单元级）互补：本用例走**完整协议链路**
// （index.mjs 的 getAccount 绑定 → rooms.dispatch → setSheet → characters.authorize），
// 证明「服务端权威」在真实接线后仍成立，且跨房间/退房重进不被绕过（卡片反例 2 与必测边界）。
//
// 场景：
//   E1 建房 + 首次提交 → 服务端签发 characterId（快照 mySheet.characterId 可见）
//   E2 已创建角色：伪造协议消息改 classId ⇒ 服务端拒（快照仍为 fighter）
//   E3 退房 → 新建**另一个房间**：带同一 characterId 改 classId ⇒ 仍拒（跨房间锁定）
//   E4 新房间直发 level:99 ⇒ 拒
//   E5 新房间原样重交 ⇒ 通过，且继承服务端权威值（level=1）
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer as netCreateServer, connect as netConnect } from 'node:net';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocket } from 'ws';

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const PW = 'Passw0rd!23';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const BASE_STATS = { STR: 15, DEX: 13, CON: 14, INT: 10, WIS: 10, CHA: 8 };
const RAW = (over = {}) => ({
  name: '甲', raceId: 'human', classId: 'fighter',
  stats: { ...BASE_STATS }, flex: { STR: 1, CON: 1 },
  colors: { skin: '#e8b48a', hair: '#3b2a1a', outfit: '#304878', eye: '#2860a0', accent: '#c8a030' },
  look: { hair: 0, beard: 0, brow: 0, mouth: 0, marking: 0 },
  level: 1, xp: 0, ...over,
});

let child = null;
let PORT = 0;
let DATA_DIR = '';
let serverLog = '';

function freePort() {
  return new Promise((res, rej) => {
    const s = netCreateServer();
    s.on('error', rej);
    s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); });
  });
}
function waitPort(port, ms) {
  const deadline = Date.now() + ms;
  return new Promise((res, rej) => {
    const tick = () => {
      const s = netConnect(port, '127.0.0.1');
      s.once('connect', () => { s.destroy(); res(); });
      s.once('error', () => { s.destroy(); retry(); });
    };
    const retry = () => {
      if (Date.now() > deadline) return rej(new Error('服务端未就绪\n' + serverLog));
      setTimeout(tick, 150);
    };
    tick();
  });
}

before(async () => {
  PORT = await freePort();
  DATA_DIR = mkdtempSync(join(tmpdir(), 'r1-33-e2e-'));
  child = spawn(process.execPath, ['server/index.mjs'], {
    cwd: APP_ROOT,
    env: { ...process.env, DND_PORT: String(PORT), DND_DATA_DIR: DATA_DIR, DND_OFFLINE: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (d) => { serverLog += d.toString(); });
  child.stderr.on('data', (d) => { serverLog += d.toString(); });
  await waitPort(PORT, 15000);
});
after(async () => {
  if (child && child.exitCode === null) {
    const done = new Promise((r) => child.once('exit', r));
    try { child.kill(); } catch { /* ignore */ }
    await Promise.race([done, sleep(3000)]);
    if (child.exitCode === null) { try { child.kill('SIGKILL'); } catch { /* ignore */ } }
  }
  try { rmSync(DATA_DIR, { recursive: true, force: true }); } catch { /* ignore */ }
});

// ---------------- WS 客户端 ----------------
function connect(account) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket('ws://127.0.0.1:' + PORT + '/ws');
    const c = { ws, account, hello: null, lastState: null, errors: [] };
    const to = setTimeout(() => reject(new Error('连接超时')), 12000);
    ws.on('open', () => ws.send(JSON.stringify({ t: 'hello', action: 'register', account, password: PW })));
    ws.on('message', (raw) => {
      let m; try { m = JSON.parse(raw.toString()); } catch { return; }
      if (m.t === 's:hello') { c.hello = m; clearTimeout(to); resolve(c); }
      else if (m.t === 's:state') { c.lastState = m.view; }
      else if (m.t === 's:error') {
        if (m.auth) ws.send(JSON.stringify({ t: 'hello', action: 'login', account, password: PW }));
        else c.errors.push(m.msg);
      }
    });
    ws.on('error', (e) => { clearTimeout(to); reject(e); });
  });
}
const send = (c, t, p = {}) => c.ws.send(JSON.stringify({ t, ...p }));
const meSheet = (c) => (c.lastState && c.lastState.mySheet) || null;
const meMember = (c) => (c.lastState && Array.isArray(c.lastState.members)) ? c.lastState.members.find((m) => m.isMe) : null;

function waitFor(fn, pred, ms, tag) {
  const deadline = Date.now() + ms;
  return new Promise((res, rej) => {
    const tick = () => {
      if (pred()) return res(true);
      if (Date.now() > deadline) return rej(new Error('等待超时 [' + tag + ']\n' + serverLog));
      setTimeout(tick, 80);
    };
    tick();
  });
}
// 等待「新增一条错误」且内容匹配
function waitError(c, re, ms, tag) {
  const n0 = c.errors.length;
  return waitFor(() => c.errors.length, () => c.errors.length > n0 && re.test(c.errors[c.errors.length - 1]), ms, tag)
    .then(() => c.errors[c.errors.length - 1]);
}

test('R1-33 Part 2 E2E：服务端权威（退房重进 / 跨房间 / 伪造协议消息）', async () => {
  const account = 'e2e_' + Math.random().toString(36).slice(2, 8);
  const c = await connect(account);

  // E1 建房 + 首次提交 → 签发 characterId
  send(c, 'lobby:create', { dungeonId: 'lmop', personaId: 'aldric', mode: 'manual' });
  await waitFor(() => c.lastState, () => c.lastState && c.lastState.room && c.lastState.room.code, 12000, 'create1');
  send(c, 'room:charsheet', { sheet: RAW() });
  await waitFor(() => c.lastState, () => meSheet(c) && meSheet(c).characterId, 12000, 'E1-mySheet');
  const cid = meSheet(c).characterId;
  assert.match(String(cid), /^ch/, 'E1：服务端应签发 characterId');
  assert.equal(meMember(c).sheet.class, 'fighter', 'E1：快照可见已创建车卡');

  // E2 伪造协议消息改 classId ⇒ 服务端拒（不依赖前端禁用）
  send(c, 'room:charsheet', { sheet: RAW({ classId: 'wizard' }) });
  const err2 = await waitError(c, /classId|职业/, 12000, 'E2-reject');
  assert.ok(err2, 'E2：改职业必须被服务端拒绝');
  await sleep(150);
  assert.equal(meMember(c).sheet.class, 'fighter', 'E2：已保存职业原样保留（未被伪造消息改写）');

  // E3 退房 → 新建另一房间：跨房间仍锁定
  send(c, 'room:leave');
  await waitFor(() => c.lastState, () => c.lastState && c.lastState.view === 'lobby', 12000, 'E3-leave');
  send(c, 'lobby:create', { dungeonId: 'lmop', personaId: 'aldric', mode: 'manual' });
  await waitFor(() => c.lastState, () => c.lastState && c.lastState.room && c.lastState.room.code, 12000, 'E3-create2');
  send(c, 'room:charsheet', { sheet: RAW({ classId: 'wizard' }), characterId: cid });
  const err3 = await waitError(c, /classId|职业/, 12000, 'E3-reject');
  assert.ok(err3, 'E3：★ 换新房间后改职业仍必须被拒（跨会话锁定）');

  // E4 新房间直发 level:99 ⇒ 拒
  send(c, 'room:charsheet', { sheet: RAW({ level: 99 }), characterId: cid });
  const err4 = await waitError(c, /等级/, 12000, 'E4-reject');
  assert.ok(err4, 'E4：level:99 必须被拒');

  // E5 原样重交 ⇒ 通过，并继承服务端权威值
  send(c, 'room:charsheet', { sheet: RAW(), characterId: cid });
  await waitFor(() => c.lastState, () => meSheet(c) && meSheet(c).characterId === cid, 12000, 'E5-accept');
  assert.equal(meSheet(c).level, 1, 'E5：新房间采用服务端权威 level=1');
  assert.equal(c.errors.length, 3, 'E5：此前恰好 3 次拒绝（E2/E3/E4），之后无新错误');
  c.ws.close();
});
