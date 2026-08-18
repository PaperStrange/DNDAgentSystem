// 迭代9探针（R-15/R-16/R-18）：2名玩家建房开局
// R-15: 非房主 game:speed/game:pause 被拒；房主暂停生效并广播
// R-18: game:say 出现在日志(kind=chat)且双方可见
// R-16: 战斗时快照含 combat.round/order，turn.actorEid 可定位
import { spawn } from 'node:child_process';
import { WebSocket } from 'ws';
import { buildSheet } from '../server/game/charsheet.mjs';

const PORT = 3899;
const log = (...a) => console.log('[iter9]', ...a);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let failed = false;
const fail = (m) => { failed = true; log('❌ ' + m); };
const ok = (m) => log('✅ ' + m);

const server = spawn(process.execPath, ['server/index.mjs'], {
  cwd: process.cwd(),
  env: { ...process.env, DND_PORT: String(PORT), DND_SEED: '11', DND_OFFLINE: '1', DND_DEBUG: '1' },
  stdio: ['ignore', 'ignore', 'inherit'],
});

function mkClient(name) {
  const c = { name, pid: null, view: null, errs: [], ws: null };
  c.connect = () => new Promise((res) => {
    const ws = new WebSocket('ws://localhost:' + PORT + '/ws');
    c.ws = ws;
    ws.on('message', (raw) => {
      const m = JSON.parse(raw.toString());
      if (m.t === 's:hello') { c.pid = m.pid; res(); }
      if (m.t === 's:state') c.view = m.view;
      if (m.t === 's:error') c.errs.push(m.msg);
    });
    ws.on('open', () => ws.send(JSON.stringify({ t: 'hello', name })));
  });
  c.send = (t, payload = {}) => c.ws.send(JSON.stringify({ t, ...payload }));
  return c;
}

const sheetOf = (name, cls) => buildSheet({ name, raceId: 'human', classId: cls, stats: { STR: 15, DEX: 13, CON: 14, INT: 10, WIS: 10, CHA: 8 }, flex: { CON: 1 }, colors: {}, background: '旅人' });

async function main() {
  await sleep(1300);
  const host = mkClient('房主'); const guest = mkClient('访客');
  await host.connect(); await guest.connect();
  host.send('lobby:create', { dungeonId: 'lmop', personaId: 'aldric' });
  await sleep(500);
  const code = host.view?.room?.code;
  guest.send('lobby:join', { code });
  await sleep(500);
  host.send('room:charsheet', { sheet: { name: '房主', raceId: 'human', classId: 'fighter', stats: { STR: 15, DEX: 13, CON: 14, INT: 10, WIS: 10, CHA: 8 }, flex: { CON: 1 }, colors: sheetOf('房主', 'fighter').colors, background: '旅人' } });
  guest.send('room:charsheet', { sheet: { name: '访客', raceId: 'human', classId: 'cleric', stats: { STR: 12, DEX: 10, CON: 14, INT: 10, WIS: 15, CHA: 10 }, flex: { CON: 1 }, colors: sheetOf('访客', 'cleric').colors, background: '旅人' } });
  await sleep(500);
  host.send('room:ready', { ready: true });
  guest.send('room:ready', { ready: true });
  for (let i = 0; i < 30; i++) { await sleep(500); if (host.view?.phase === 'playing' && guest.view?.phase === 'playing') break; }
  ok('2人全员就绪自动开局 phase=' + host.view?.phase);

  // R-15: 非房主调速/暂停被拒
  guest.send('game:speed', { speed: 4 });
  await sleep(400);
  if (guest.errs.some(e => e.includes('只有房主可以调整战斗速度'))) ok('R-15 非房主调速被拒（服务端强制）');
  else fail('R-15 非房主调速未被拒 errs=' + JSON.stringify(guest.errs));
  guest.send('game:pause', { paused: true });
  await sleep(400);
  if (guest.errs.some(e => e.includes('只有房主可以暂停'))) ok('R-15 非房主暂停被拒');
  else fail('R-15 非房主暂停未被拒');

  // R-15: 房主暂停生效并广播
  host.send('game:pause', { paused: true });
  await sleep(500);
  if (host.view?.game?.paused === true && guest.view?.game?.paused === true) ok('R-15 房主暂停生效并广播给所有玩家');
  else fail('R-15 暂停未广播 host=' + host.view?.game?.paused + ' guest=' + guest.view?.game?.paused);
  host.send('game:pause', { paused: false });
  await sleep(400);

  // R-18: 聊天
  host.send('game:say', { text: '大家好，我是房主' });
  guest.send('game:say', { text: '收到，一起加油' });
  await sleep(600);
  const hostChat = host.view?.game?.log?.filter(l => l.kind === 'chat').map(l => l.text) || [];
  const guestChat = guest.view?.game?.log?.filter(l => l.kind === 'chat').map(l => l.text) || [];
  if (hostChat.length === 2 && guestChat.length === 2 && hostChat.some(t => t.includes('我是房主')) && guestChat.some(t => t.includes('一起加油'))) ok('R-18 聊天双向可见（kind=chat）: ' + hostChat.join(' / '));
  else fail('R-18 聊天异常 host=' + JSON.stringify(hostChat) + ' guest=' + JSON.stringify(guestChat));

  // R-16: 等战斗开始后检查 combat.round/order/turn
  let sawCombat = false;
  for (let i = 0; i < 60; i++) {
    await sleep(1000);
    const gv = host.view?.game;
    if (gv?.combat?.active && gv.combat.order?.length) {
      sawCombat = true;
      ok('R-16 战斗快照含回合数=' + gv.combat.round + ' 顺序(' + gv.combat.order.length + '人): ' + gv.combat.order.map(eid => gv.entities.find(e => e.eid === eid)?.name || '?').join('>'));
      if (gv.turn?.actorEid && gv.combat.order.includes(gv.turn.actorEid)) ok('R-16 当前行动者可在顺序中定位: ' + gv.entities.find(e => e.eid === gv.turn.actorEid)?.name);
      else fail('R-16 turn.actorEid 无法定位');
      break;
    }
  }
  if (!sawCombat) fail('R-16 60秒内未进入战斗');

  log(failed ? 'ITER9 RESULT: FAIL' : 'ITER9 RESULT: PASS');
  server.kill();
  process.exit(failed ? 1 : 0);
}
main().catch(e => { console.error(e); server.kill(); process.exit(1); });
