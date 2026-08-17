// 最小WS探针：1名玩家建房→车卡→准备→开局后连续发送endturn，验证消息链路
import { spawn } from 'node:child_process';
import { WebSocket } from 'ws';

const PORT = 3895;
const server = spawn(process.execPath, ['server/index.mjs'], {
  cwd: process.cwd(),
  env: { ...process.env, DND_PORT: String(PORT), DND_SEED: '7', DND_DEBUG: '1' },
  stdio: ['ignore', 'inherit', 'inherit'],
});
const log = (...a) => console.log('[probe]', ...a);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function main() {
  await sleep(1200);
  const ws = new WebSocket('ws://localhost:' + PORT + '/ws');
  let pid = null, view = null, sent = 0;
  ws.on('message', (raw) => {
    const m = JSON.parse(raw.toString());
    if (m.t === 's:hello') { pid = m.pid; log('hello pid=' + pid); }
    if (m.t === 's:state') { view = m.view; }
  });
  await new Promise(r => ws.on('open', r));
  ws.send(JSON.stringify({ t: 'hello', name: '探针' }));
  await sleep(600);
  ws.send(JSON.stringify({ t: 'lobby:create', dungeonId: 'lmop', personaId: 'aldric' }));
  await sleep(600);
  const code = view?.room?.code;
  log('房间:', code, 'phase:', view?.phase);
  ws.send(JSON.stringify({ t: 'room:charsheet', sheet: { name: '探针侠', raceId: 'human', classId: 'fighter', stats: { STR: 15, DEX: 13, CON: 14, INT: 10, WIS: 10, CHA: 8 }, flex: { CON: 1 }, colors: {}, background: '旅人' } }));
  await sleep(500);
  ws.send(JSON.stringify({ t: 'room:ready', ready: true }));
  await sleep(800);
  log('phase now:', view?.phase, 'game state:', view?.game?.state);
  // 连续发送 endturn（无论是否自己回合，观察服务器是否收到）
  for (let i = 0; i < 6; i++) {
    const myTurn = view?.game?.turn?.playerId === pid;
    ws.send(JSON.stringify({ t: 'game:endturn' }));
    sent++;
    await sleep(700);
    log('i=' + i + ' sent=' + sent + ' myTurn=' + myTurn + ' turnNow=' + (view?.game?.turn?.playerId || '无') + ' round=' + view?.game?.combat?.round);
  }
  log('DONE');
  server.kill();
  process.exit(0);
}
main().catch(e => { console.error(e); server.kill(); process.exit(1); });
