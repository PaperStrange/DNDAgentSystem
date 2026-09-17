// R1-14 行为层测试：对 tools/lib/ws-client-guard 施加三种连接故障，逐条断言。
//   T1 坏帧：服务器发非法 JSON 帧 + 合法帧 → 不抛、不崩、合法帧仍被处理。
//   T2 断线自愈：服务器强制断开 → 客户端 ~1.5s 内自动重连（计数 ≥1），重连后继续收帧。
//   T3 半断线发送：非 OPEN 时 send() 返回 false 且不抛；重连后 send() 返回 true。
// 自带真实 ws 服务器，端口用 OS 分配的临时空闲端口（不写死、不碰 3891-3898）。
// 输出：<R1_14_OUT_DIR>/r1-14-guard-test.json（默认 <appRoot>/docs/qa/restart-sprint1/<stamp>/）。
//   —— 证据目录默认落在「主检出」的 docs/qa 下（docs/ 被 gitignore，worktree 内无 docs/）；
//      从 worktree 运行时用环境变量 R1_14_OUT_DIR 指向主检出。
import { WebSocketServer } from 'ws';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createGuardedSocket } from './ws-client-guard.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const appRoot = join(here, '..');
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const outDir = process.env.R1_14_OUT_DIR || join(appRoot, 'docs', 'qa', 'restart-sprint1', stamp);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok: !!ok, detail: detail == null ? '' : String(detail) });
  console.log((ok ? '✅ ' : '❌ ') + name + (detail == null ? '' : ' | ' + detail));
};

async function startServer() {
  const wss = new WebSocketServer({ port: 0, host: '127.0.0.1' });
  await new Promise((r) => wss.once('listening', r));
  return { wss, port: wss.address().port };
}
async function stopServer(wss) {
  for (const c of wss.clients) { try { c.terminate(); } catch (e) {} }
  await new Promise((r) => wss.close(r));
}
async function waitFor(fn, timeoutMs = 4000, stepMs = 20) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) { if (fn()) return Date.now() - t0; await sleep(stepMs); }
  return -1;
}

// ---------- T1 坏帧 ----------
async function t1() {
  const { wss, port } = await startServer();
  const sockets = [];
  wss.on('connection', (c) => sockets.push(c));
  const got = [];
  const s = createGuardedSocket({ url: 'ws://127.0.0.1:' + port, log: () => {}, onMessage: (m) => got.push(m) });
  const connected = await waitFor(() => sockets.length >= 1);
  let crashed = false;
  try {
    sockets[0].send('这不是JSON{{{ 坏帧');
    sockets[0].send(JSON.stringify({ t: 'ok', n: 1 }));
  } catch (e) { crashed = true; }
  await sleep(300);
  const sawOk = got.some((m) => m && m.t === 'ok' && m.n === 1);
  check('T1 坏帧后不抛异常且合法帧仍被处理', connected >= 0 && !crashed && sawOk,
    'connected=' + (connected >= 0) + ' crashed=' + crashed + ' got=' + JSON.stringify(got));
  s.close();
  await stopServer(wss);
}

// ---------- T2 断线自愈 ----------
async function t2() {
  const { wss, port } = await startServer();
  const sockets = [];
  wss.on('connection', (c) => sockets.push(c));
  const got = [];
  const s = createGuardedSocket({ url: 'ws://127.0.0.1:' + port, log: () => {}, onMessage: (m) => got.push(m) });
  await waitFor(() => sockets.length >= 1);
  sockets[0].send(JSON.stringify({ t: 'f', n: 1 }));
  await sleep(100);
  const t0 = Date.now();
  try { sockets[0].terminate(); } catch (e) { try { sockets[0].close(); } catch (e2) {} }
  const elapsed = await waitFor(() => sockets.length >= 2, 5000);
  const reconnected = elapsed >= 0;
  if (reconnected) { sockets[1].send(JSON.stringify({ t: 'f', n: 2 })); await sleep(200); }
  const sawAfter = got.some((m) => m && m.t === 'f' && m.n === 2);
  check('T2 断线后自动重连（计数 ≥1，~1.5s）', reconnected && s.reconnectCount() >= 1,
    'elapsed=' + elapsed + 'ms reconnectCount=' + s.reconnectCount());
  check('T2 重连后仍能继续收帧', sawAfter, 'got=' + JSON.stringify(got));
  s.close();
  await stopServer(wss);
}

// ---------- T3 半断线发送 ----------
async function t3() {
  const { wss, port } = await startServer();
  const sockets = [];
  wss.on('connection', (c) => sockets.push(c));
  const s = createGuardedSocket({ url: 'ws://127.0.0.1:' + port, log: () => {} });
  await waitFor(() => sockets.length >= 1);
  // 服务端断开 → 客户端进入非 OPEN
  try { sockets[0].terminate(); } catch (e) {}
  await waitFor(() => s.readyState() !== 1, 2000);
  const rs = s.readyState();
  let threw = false, ret = null;
  try { ret = s.send('x', { a: 1 }); } catch (e) { threw = true; }
  check('T3 非 OPEN 时 send 返回 false 且不抛', ret === false && !threw,
    'ret=' + ret + ' threw=' + threw + ' readyState=' + rs);
  await waitFor(() => sockets.length >= 2, 5000);
  const ret2 = s.send('x', { a: 2 });
  check('T3 重连后 send 返回 true', ret2 === true, 'ret2=' + ret2 + ' conns=' + sockets.length);
  s.close();
  await stopServer(wss);
}

async function main() {
  const t0 = Date.now();
  for (const [name, fn] of [['T1', t1], ['T2', t2], ['T3', t3]]) {
    try { await fn(); }
    catch (e) { check(name + ' 执行异常', false, (e && e.message ? e.message : e)); }
  }
  const passed = results.filter((r) => r.ok).length;
  const payload = { runAt: new Date().toISOString(), test: 'R1-14 guard behavior', total: results.length, passed, results };
  mkdirSync(outDir, { recursive: true });
  const outFile = join(outDir, 'r1-14-guard-test.json');
  writeFileSync(outFile, JSON.stringify(payload, null, 2), 'utf8');
  console.log('\nR1-14 守卫测试：' + passed + '/' + results.length + ' 通过（用时 ' + ((Date.now() - t0) / 1000).toFixed(1) + 's）');
  console.log('证据：' + outFile);
  process.exit(passed === results.length ? 0 : 1);
}
main().catch((e) => { console.error('TEST CRASH:', e); process.exit(1); });
