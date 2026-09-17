// 安全回归测试：路径穿越/跨站WS劫持/令牌冒用/快照密钥泄漏
import { spawn } from 'node:child_process';
import { WebSocket } from 'ws';

const PORT = 3897;
const server = spawn(process.execPath, ['server/index.mjs'], {
  cwd: process.cwd(),
  env: { ...process.env, DND_PORT: String(PORT) },
  stdio: ['ignore', 'pipe', 'pipe'],
});
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0;
const check = (name, ok, extra = '') => { console.log((ok ? '✅ ' : '❌ ') + name + (extra ? ' | ' + extra : '')); ok ? pass++ : fail++; };

async function httpGet(path, headers = {}) {
  const res = await fetch('http://localhost:' + PORT + path, { headers });
  return res.status;
}

async function wsConnect(headers = {}) {
  return new Promise((resolve) => {
    const ws = new WebSocket('ws://localhost:' + PORT + '/ws', { headers });
    let done = false;
    const finish = (v) => { if (!done) { done = true; resolve(v); } };
    ws.on('open', () => finish({ ws, opened: true }));
    ws.on('close', (code) => finish({ closedCode: code }));
    ws.on('error', () => finish({ error: true }));
    setTimeout(() => finish({ timeout: true }), 3000);
  });
}
function wsMessage(ws) {
  return new Promise((resolve) => {
    ws.once('message', (raw) => resolve(JSON.parse(raw.toString())));
  });
}

async function main() {
  await sleep(1500);
  console.log('=== 1. 静态文件路径穿越防护 ===');
  check('GET / (首页) 200', (await httpGet('/')) === 200);
  check('GET /../config.json → 404', (await httpGet('/../config.json')) === 404);
  check('GET /..%2fconfig.json → 404', (await httpGet('/..%2fconfig.json')) === 404);
  check('GET /%2e%2e/config.json → 404', (await httpGet('/%2e%2e/config.json')) === 404);
  check('GET /config.json → 404（config不在public）', (await httpGet('/config.json')) === 404);
  check('GET /server/index.mjs → 404', (await httpGet('/server/index.mjs')) === 404);
  check('GET /package.json → 404', (await httpGet('/package.json')) === 404);
  check('GET /data/rules/starter.txt → 404', (await httpGet('/data/rules/starter.txt')) === 404);
  check('GET /js/app.mjs 200（正常资源可访问）', (await httpGet('/js/app.mjs')) === 200);

  console.log('=== 2. 跨站WebSocket劫持防护 ===');
  const evil = await wsConnect({ Origin: 'http://evil.example.com' });
  await sleep(600); // 服务器在握手完成后立即下发1008关闭帧
  check('恶意Origin被拒绝（服务器主动关闭连接）', evil.closedCode === 1008 || (evil.ws && evil.ws.readyState === 3), 'closedCode=' + evil.closedCode + ' readyState=' + (evil.ws ? evil.ws.readyState : '?'));
  const same = await wsConnect({ Origin: 'http://localhost:' + PORT });
  check('同源Origin允许连接', !!same.opened && same.ws.readyState === 1);
  if (same.ws) same.ws.close();
  const noOrigin = await wsConnect({});
  check('无Origin（机器人/原生客户端）允许连接', !!noOrigin.opened);

  console.log('=== 3. 秘密令牌与冒用防护 ===');
  const c1 = await wsConnect({});
  c1.ws.send(JSON.stringify({ t: 'hello', name: '甲' }));
  const hello1 = await wsMessage(c1.ws);
  check('新玩家获得随机秘密令牌（≠pid）', hello1.token && hello1.token !== hello1.pid && hello1.token.startsWith('tk_'), 'token前缀: ' + String(hello1.token).slice(0, 5));
  const pid1 = hello1.pid, token1 = hello1.token;
  // 房间创建
  c1.ws.send(JSON.stringify({ t: 'lobby:create', dungeonId: 'lmop', personaId: 'aldric' }));
  await sleep(400);
  // 冒用：伪造他人pid作为token
  const c2 = await wsConnect({});
  c2.ws.send(JSON.stringify({ t: 'hello', name: '冒名者', token: pid1 }));
  const hello2 = await wsMessage(c2.ws);
  check('伪造pid令牌无法冒用（分配新身份）', hello2.pid !== pid1, 'pid不同');
  c2.ws.close();
  // 正确令牌重连
  c1.ws.close();
  await sleep(300);
  const c3 = await wsConnect({});
  c3.ws.send(JSON.stringify({ t: 'hello', name: '甲', token: token1 }));
  const hello3 = await wsMessage(c3.ws);
  check('正确令牌重连恢复同一位玩家', hello3.pid === pid1, 'roomCode=' + hello3.roomCode);
  c3.ws.close();

  console.log('=== 4. 快照不泄漏密钥/令牌 ===');
  const c4 = await wsConnect({});
  c4.ws.send(JSON.stringify({ t: 'hello', name: '乙' }));
  await wsMessage(c4.ws);
  c4.ws.send(JSON.stringify({ t: 'lobby:join', code: 'NOPE' }));
  await sleep(300);
  // 收集几个快照并全文扫描
  const snapshots = [];
  c4.ws.on('message', (raw) => { const m = JSON.parse(raw.toString()); if (m.t === 's:state') snapshots.push(JSON.stringify(m.view)); });
  c4.ws.send(JSON.stringify({ t: 'ping' }));
  await sleep(500);
  const all = snapshots.join(' ');
  check('快照不含apiKey', !all.includes('apiKey') && !all.includes('sk-'));
  check('快照不含任何玩家的秘密令牌(tk_)', !all.includes('tk_'));
  c4.ws.close();

  console.log('=== 5. 消息洪泛限流 ===');
  const c5 = await wsConnect({});
  c5.ws.send(JSON.stringify({ t: 'hello', name: '丙' }));
  await wsMessage(c5.ws);
  let sent = 0;
  for (let i = 0; i < 500; i++) { c5.ws.send(JSON.stringify({ t: 'ping' })); sent++; }
  await sleep(300);
  check('500条/秒洪泛被限流（连接仍存活）', c5.ws.readyState === 1, '发送' + sent + '条，服务器丢弃超量部分');
  c5.ws.close();

  console.log('\n=== 结果: ' + pass + ' 通过 / ' + fail + ' 失败 ===');
  server.kill();
  process.exit(fail ? 1 : 0);
}
main().catch(e => { console.error('测试崩溃:', e); server.kill(); process.exit(1); });
