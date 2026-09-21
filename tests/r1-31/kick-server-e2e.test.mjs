// R1-31 端到端回归（真实服务端进程 + 真实 WebSocket）——验证 index.mjs 侧接线：
//   房主踢人 ⇒ 被踢者收到 s:kicked 且随后 s:state 落 lobby（而非陈旧房间/局内视图）。
// 这是 Node 级用例无法覆盖的一环：Rooms 依赖 index.mjs 注入的 getPlayer(pid) 才能清 roomCode。
// 端口用 0（临时分配），不占固定端口；DND_DATA_DIR 指向临时目录。
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
const SUF = Math.random().toString(36).slice(2, 8);
let seq = 0;
const uniq = () => 'k' + (seq++) + SUF;

const RAW = (name) => ({
  name, raceId: 'human', classId: 'fighter',
  stats: { STR: 15, DEX: 14, CON: 14, INT: 8, WIS: 10, CHA: 8 }, flex: {},
  colors: { skin: '#e8b48a', hair: '#3b2a1a', outfit: '#304878', eye: '#2860a0', accent: '#c8a030' },
  look: { hair: 0, beard: 0, brow: 0, mouth: 0, marking: 0 },
  background: 'R1-31 e2e', level: 1, xp: 0,
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
  DATA_DIR = mkdtempSync(join(tmpdir(), 'r1-31-e2e-'));
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

function connect(name) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket('ws://127.0.0.1:' + PORT + '/ws');
    const c = { ws, name, hello: null, lastState: null, kicked: false, errors: [] };
    const to = setTimeout(() => reject(new Error('连接超时：' + name)), 12000);
    ws.on('open', () => ws.send(JSON.stringify({ t: 'hello', action: 'register', account: name, password: PW })));
    ws.on('message', (raw) => {
      let m; try { m = JSON.parse(raw.toString()); } catch { return; }
      if (m.t === 's:hello') { c.hello = m; clearTimeout(to); resolve(c); }
      else if (m.t === 's:state') { c.lastState = m.view; }
      else if (m.t === 's:kicked') { c.kicked = true; }
      else if (m.t === 's:error') {
        if (m.auth) ws.send(JSON.stringify({ t: 'hello', action: 'login', account: name, password: PW }));
        else c.errors.push(m.msg);
      }
    });
    ws.on('error', (e) => { clearTimeout(to); reject(e); });
  });
}
const send = (c, t, p = {}) => c.ws.send(JSON.stringify({ t, ...p }));
function waitState(c, pred, ms, tag) {
  const deadline = Date.now() + ms;
  return new Promise((res, rej) => {
    const tick = () => {
      if (c.lastState && pred(c.lastState)) return res(c.lastState);
      if (Date.now() > deadline) return rej(new Error('等待超时 [' + tag + ']：view=' + c.lastState?.view + ' members=' + (c.lastState?.members || []).length + '\n' + serverLog));
      setTimeout(tick, 80);
    };
    tick();
  });
}

test('R1-31 e2e：房主踢人 ⇒ 被踢者收 s:kicked 且落 lobby（不拿陈旧房间/局内视图）', async () => {
  const host = await connect(uniq());
  const guest = await connect(uniq());
  send(host, 'lobby:create', { dungeonId: 'lmop', personaId: 'aldric', mode: 'manual' });
  const st = await waitState(host, (v) => v.room && v.room.code, 12000, 'create');
  const code = st.room.code;
  send(guest, 'lobby:join', { code });
  await waitState(guest, (v) => v.view === 'room', 12000, 'join');
  send(host, 'room:charsheet', { sheet: RAW('H_' + code) });
  send(guest, 'room:charsheet', { sheet: RAW('G_' + code) });
  await sleep(400);

  // 前置：房主可见 2 名成员，并取得客人 pid
  const room = await waitState(host, (v) => v.members && v.members.length === 2, 12000, 'two-members');
  const guestPid = room.members.find((m) => m.pid !== host.hello.pid).pid;
  assert.ok(guestPid, '应能取得客人 pid');

  send(host, 'room:kick', { targetPid: guestPid });
  // 被踢者：收到 s:kicked
  const deadline = Date.now() + 8000;
  while (!guest.kicked && Date.now() < deadline) await sleep(50);
  assert.equal(guest.kicked, true, '被踢者必须收到 s:kicked');
  // 被踢者：随后快照落 lobby（index.mjs 用注入的 getPlayer 清了 roomCode）
  const gv = await waitState(guest, (v) => v.view === 'lobby', 8000, 'victim-lobby');
  assert.equal(gv.view, 'lobby', '被踢者应落 lobby（修前可能拿到陈旧房间视图）');
  // 房主：成员数降为 1
  const hv = await waitState(host, (v) => v.members && v.members.length === 1, 8000, 'host-1');
  assert.equal(hv.members.length, 1, '房主视图成员数应为 1');
  host.ws.close(); guest.ws.close();
});
