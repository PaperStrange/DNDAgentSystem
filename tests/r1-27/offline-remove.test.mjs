// R1-27 F1 回归用例 —— 「离线自动移出阶段清单」必须为单一真源
//
// 缺陷（quality-lead 独立复核 CONCERNS·阻塞项 F1）：
//   server/index.mjs 的 ws.on('close') 里，「可自动移出阶段」清单被写了两遍——
//   外层（是否装配计时器）加了 'confirm'，内层（到点是否真的移出）漏加 'confirm'。
//   结果：确认门（confirm）阶段有人离线 >60s，计时器空转、离线者永不移出 ⇒
//   确认门被永久卡住（没人能确认 → 冒险无法开始）。
//
// 修法（按根因，不按症状）：抽单一真源常量 OFFLINE_REMOVABLE_PHASES，
//   外层「是否装配计时器」与内层「到点是否仍应移出」**共用同一判定**。
//
// 本用例独立复现（真服务端进程 + 真 WebSocket，不 mock、不 import 被测逻辑）：
//   G1 缺陷场景：confirm 阶段离线 → 到点移出，且剩余者确认后门放行（phase=playing）
//   G2 正对照  ：prepare 阶段离线 → 到点移出（原有行为不回归）
//   G3 反对照  ：playing 阶段离线 → **不得**移出（保留断线重连，阈值内可回座）
//   G4 结构守卫：离线移出判定为单一真源（防「两处各写一份」的根因复发）
//
// 用例不必真等 60s：以 DND_OFFLINE_REMOVE_MS 缩短阈值（生产默认 60e3 不变，
// 判定逻辑与生产完全一致，仅时长不同）。
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer as netCreateServer, connect as netConnect } from 'node:net';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocket } from 'ws';

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const REMOVE_MS = 1000; // 服务端离线移出阈值（缩短，见文件头）
const WAIT_MS = 8000;   // 等待条件成立的截止（含裕量）
const PW = 'Passw0rd!23';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SUF = Math.random().toString(36).slice(2, 8);
let seq = 0;
const uniq = () => 'u' + (seq++) + SUF; // 账户名（2~20 位，[A-Za-z0-9_]）

// 合法车卡（与 R1-27 F1 探针同款；buildSheet 接受）
const RAW = (name) => ({
  name, raceId: 'human', classId: 'fighter',
  stats: { STR: 15, DEX: 14, CON: 14, INT: 8, WIS: 10, CHA: 8 }, flex: {},
  colors: { skin: '#e8b48a', hair: '#3b2a1a', outfit: '#304878', eye: '#2860a0', accent: '#c8a030' },
  look: { hair: 0, beard: 0, brow: 0, mouth: 0, marking: 0 },
  background: 'R1-27 F1 回归', level: 1, xp: 0,
});

// ---------------- 服务端进程管理 ----------------
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
      if (Date.now() > deadline) {
        return rej(new Error('服务端未在 ' + ms + 'ms 内就绪\n--- server log ---\n' + serverLog));
      }
      setTimeout(tick, 150);
    };
    tick();
  });
}

before(async () => {
  PORT = await freePort();
  DATA_DIR = mkdtempSync(join(tmpdir(), 'r1-27-f1-'));
  child = spawn(process.execPath, ['server/index.mjs'], {
    cwd: APP_ROOT,
    env: {
      ...process.env,
      DND_PORT: String(PORT),
      DND_DATA_DIR: DATA_DIR,           // 账户/日志落临时目录，绝不污染仓库 data/
      DND_OFFLINE_REMOVE_MS: String(REMOVE_MS),
      DND_OFFLINE: '1',                 // 无 LLM：开场走离线模板，开局确定性
    },
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

// ---------------- WebSocket 客户端 ----------------
const BASE = () => 'ws://127.0.0.1:' + PORT + '/ws';

function connect(name) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(BASE());
    const c = { ws, name, hello: null, lastState: null, errors: [] };
    const to = setTimeout(() => reject(new Error('连接超时：' + name)), 12000);
    ws.on('open', () => ws.send(JSON.stringify({ t: 'hello', action: 'register', account: name, password: PW })));
    ws.on('message', (raw) => {
      let m; try { m = JSON.parse(raw.toString()); } catch { return; }
      if (m.t === 's:hello') { c.hello = m; clearTimeout(to); resolve(c); }
      else if (m.t === 's:state') { c.lastState = m.view; }
      else if (m.t === 's:error') {
        if (m.auth) ws.send(JSON.stringify({ t: 'hello', action: 'login', account: name, password: PW }));
        else c.errors.push(m.msg);
      }
    });
    ws.on('error', (e) => { clearTimeout(to); reject(e); });
  });
}
const send = (c, t, p = {}) => c.ws.send(JSON.stringify({ t, ...p }));
const members = (c) => (c.lastState && Array.isArray(c.lastState.members)) ? c.lastState.members.length : -1;

function waitState(c, pred, ms, tag) {
  const deadline = Date.now() + ms;
  return new Promise((res, rej) => {
    const tick = () => {
      if (c.lastState && pred(c.lastState)) return res(c.lastState);
      if (Date.now() > deadline) {
        return rej(new Error(
          '等待超时 [' + tag + ']：phase=' + c.lastState?.phase +
          ' view=' + c.lastState?.view + ' members=' + members(c) +
          (c.errors.length ? ' clientErrors=' + c.errors.join('|') : '') +
          '\n--- server log ---\n' + serverLog
        ));
      }
      setTimeout(tick, 80);
    };
    tick();
  });
}

// 建房 → 双人车卡（ready=true 时两人就绪 → 触发全员确认门，phase=confirm）
// 用 manual 模式：避免自动战斗/游荡在后台搅动状态，用例更确定。
async function pair({ ready }) {
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
  if (ready) {
    send(host, 'room:ready', { ready: true });
    send(guest, 'room:ready', { ready: true });
    await waitState(host, (v) => v.phase === 'confirm', 20000, 'to-confirm');
  }
  return { host, guest, code };
}

// ---------------- G1：缺陷场景（本用例的核心复现） ----------------

test('R1-27 F1 G1（缺陷场景）：confirm 阶段离线 >阈值 ⇒ 移出，且确认门放行', async () => {
  const { host, guest } = await pair({ ready: true });
  assert.equal(host.lastState.phase, 'confirm', '前置：应处于全员确认门');
  assert.equal(members(host), 2, '确认门起始应有 2 名成员');

  guest.ws.close(); // 一名成员离线（无法确认隐藏目标）
  const after = await waitState(host, (v) => v.members.length === 1, WAIT_MS, 'G1-remove');
  assert.equal(after.members.length, 1, 'confirm 阶段离线者应在阈值后被移出（F1 缺陷点：修复前此处为 2）');
  assert.equal(after.phase, 'confirm', '移出后房间仍停在确认门（等待剩余者确认，不自动开局）');

  send(host, 'room:confirm'); // 剩余者确认
  const play = await waitState(host, (v) => v.phase === 'playing', WAIT_MS, 'G1-release');
  assert.equal(play.phase, 'playing', '离线者移出后，剩余者确认应放行确认门、冒险开始');
  host.ws.close();
});

// ---------------- G2：正对照（原有行为不回归） ----------------

test('R1-27 F1 G2（正对照）：prepare 阶段离线 >阈值 ⇒ 移出', async () => {
  const { host, guest } = await pair({ ready: false });
  assert.equal(host.lastState.phase, 'prepare', '前置：应处于准备阶段');

  guest.ws.close();
  const after = await waitState(host, (v) => v.members.length === 1, WAIT_MS, 'G2-remove');
  assert.equal(after.members.length, 1, 'prepare 阶段离线者应在阈值后被移出（原有行为不得回归）');
  host.ws.close();
});

// ---------------- G3：反对照（不得过度移出） ----------------

test('R1-27 F1 G3（反对照）：playing 阶段离线 ⇒ 不得自动移出（保留断线重连）', async () => {
  const { host, guest } = await pair({ ready: true });
  send(host, 'room:confirm');
  send(guest, 'room:confirm');
  await waitState(host, (v) => v.phase === 'playing', WAIT_MS, 'G3-to-playing');

  guest.ws.close();
  await sleep(REMOVE_MS + 1500); // 超过移出阈值
  assert.equal(members(host), 2, 'playing 阶段离线者必须保留席位（断线重连依赖此席位）');
  host.ws.close();
});

// ---------------- G4：结构守卫（防根因复发） ----------------

test('R1-27 F1 G4（结构守卫）：离线移出阶段判定为单一真源', () => {
  const src = readFileSync(join(APP_ROOT, 'server/index.mjs'), 'utf8');
  const norm = src.replace(/\s+/g, ' ');

  // 缺陷根因：外层/内层各写一份阶段清单（曾经外层含 confirm、内层漏 confirm）
  assert.ok(!norm.includes("room.phase === 'prepare' || room.phase === 'ended'"),
    '不得回归「阶段清单写两遍」的旧模式（F1 根因）');

  // 单一真源：一处定义（且 confirm 必须在内）+ 至少两处引用（外层装配 / 内层到点）
  assert.match(norm, /const OFFLINE_REMOVABLE_PHASES = new Set\(\[[^\]]*'confirm'[^\]]*\]\)/,
    '应存在单一 OFFLINE_REMOVABLE_PHASES 常量，且 confirm 在其内');
  const refs = src.match(/OFFLINE_REMOVABLE_PHASES\.has\(/g) || [];
  assert.ok(refs.length >= 2,
    '外层装配与内层到点必须都引用同一常量（当前引用数 ' + refs.length + '）');
});
