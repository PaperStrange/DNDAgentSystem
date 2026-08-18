// 账户系统测试：注册/登录/错误提示/单点登录挤掉旧会话/令牌重连/未登录禁建房
import { spawn } from 'node:child_process';
import { WebSocket } from 'ws';
import { writeFileSync, appendFileSync } from 'node:fs';

const PORT = 3896;
const OUT = 'tools/_auth_out.log';
try { writeFileSync(OUT, ''); } catch (e) {}
const log = (...a) => { const s = '[auth] ' + a.join(' '); try { appendFileSync(OUT, s + '\n'); } catch (e) {} console.log(s); };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let failed = false;
const ok = (m) => log('✅ ' + m);
const fail = (m) => { failed = true; log('❌ ' + m); };

const server = spawn(process.execPath, ['server/index.mjs'], {
  cwd: process.cwd(),
  env: { ...process.env, DND_PORT: String(PORT), DND_SEED: '3', DND_OFFLINE: '1' },
  stdio: ['ignore', 'ignore', 'inherit'],
});

function client() {
  const c = { hello: null, msgs: [], closed: false, closeCode: null, ws: null };
  c.connect = () => new Promise((res) => {
    const ws = new WebSocket('ws://localhost:' + PORT + '/ws');
    c.ws = ws;
    ws.on('message', (raw) => {
      const m = JSON.parse(raw.toString());
      c.msgs.push(m);
      if (m.t === 's:hello') c.hello = m;
    });
    ws.on('close', (code) => { c.closed = true; c.closeCode = code; });
    ws.on('error', () => {});
    ws.on('open', () => res()); // 连接就绪即可发送（消息通过 msgs 收集）
  });
  c.send = (o) => c.ws.send(JSON.stringify(o));
  c.lastErr = () => [...c.msgs].reverse().find(m => m.t === 's:error')?.msg;
  c.state = () => [...c.msgs].reverse().find(m => m.t === 's:state')?.view;
  return c;
}

const WATCHDOG = setTimeout(() => { log('❌ 看门狗超时'); server.kill(); process.exit(2); }, 30000);

async function main() {
  await sleep(1200);
  const uname = '测试员' + (Date.now() % 100000);
  const pw = 'test1234';

  const a = client();
  await a.connect();
  a.send({ t: 'hello' }); // 访客态
  await sleep(400);

  // 未登录建房被拒（友好提示）
  a.send({ t: 'lobby:create', dungeonId: 'lmop', personaId: 'aldric' });
  await sleep(400);
  if (String(a.lastErr()).includes('请先登录')) ok('未登录建房被拒并给出友好提示');
  else fail('未登录建房未被拒 err=' + a.lastErr());

  // 注册：非法用户名/短密码的友好错误
  a.send({ t: 'hello', action: 'register', account: 'x', password: pw });
  await sleep(300);
  if (String(a.lastErr()).includes('用户名需2~20位')) ok('注册用户名规则提示友好');
  else fail('注册规则提示异常 err=' + a.lastErr());
  a.send({ t: 'hello', action: 'register', account: uname, password: '12' });
  await sleep(300);
  if (String(a.lastErr()).includes('密码长度需4~64位')) ok('注册密码规则提示友好');
  else fail('注册密码规则提示异常 err=' + a.lastErr());

  // 正常注册 → s:hello 含 account 与 token
  a.send({ t: 'hello', action: 'register', account: uname, password: pw });
  await sleep(600);
  if (a.hello && a.hello.account === uname && a.hello.token && a.hello.token.startsWith('tk_')) ok('注册成功并下发会话（account+token）');
  else fail('注册未成功 hello=' + JSON.stringify(a.hello));

  // 重复注册 → 友好提示
  const dup = client();
  await dup.connect();
  dup.send({ t: 'hello', action: 'register', account: uname, password: pw });
  await sleep(400);
  if (String(dup.lastErr()).includes('已被注册')) ok('重复注册给出友好提示');
  else fail('重复注册提示异常 err=' + dup.lastErr());

  // 错误密码 → 友好提示
  dup.send({ t: 'hello', action: 'login', account: uname, password: 'wrong!' });
  await sleep(400);
  if (String(dup.lastErr()).includes('密码不正确')) ok('错误密码给出友好提示');
  else fail('错误密码提示异常 err=' + dup.lastErr());

  // 单点登录：dup 正常登录 → 挤掉 a 的会话
  dup.send({ t: 'hello', action: 'login', account: uname, password: pw });
  await sleep(800);
  const kicked = a.msgs.find(m => m.t === 's:auth-kicked');
  if (kicked && /其他位置|其他会话/.test(String(kicked.msg))) ok('旧连接收到单点登录挤掉通知: ' + String(kicked.msg).slice(0, 34));
  else fail('旧连接未收到挤掉通知 msgs=' + JSON.stringify(a.msgs.map(m => m.t)));
  await sleep(400);
  if (a.closed) ok('旧连接已被服务器关闭（单点登录生效）');
  else fail('旧连接未被关闭');

  // 旧令牌重连 → 被要求重新登录
  const ghost = client();
  await ghost.connect();
  ghost.send({ t: 'hello', token: a.hello.token, name: uname });
  await sleep(400);
  if (String(ghost.lastErr()).includes('登录状态已失效')) ok('旧令牌重连被拒绝并提示重新登录');
  else fail('旧令牌重连未被拒 err=' + ghost.lastErr());

  // 新会话令牌重连 → 恢复身份
  const re = client();
  await re.connect();
  re.send({ t: 'hello', token: dup.hello.token, name: uname });
  await sleep(600);
  if (re.hello && re.hello.pid === dup.hello.pid) ok('新会话令牌重连恢复身份');
  else fail('令牌重连失败 hello=' + JSON.stringify(re.hello));

  // 登录后建房成功
  re.send({ t: 'lobby:create', dungeonId: 'lmop', personaId: 'aldric' });
  await sleep(500);
  if (re.state()?.view === 'room') ok('登录后建房成功');
  else fail('登录后建房失败 view=' + re.state()?.view);

  log(failed ? 'AUTH RESULT: FAIL' : 'AUTH RESULT: PASS');
  clearTimeout(WATCHDOG);
  server.kill();
  process.exit(failed ? 1 : 0);
}
main().catch(e => { console.error(e); server.kill(); process.exit(1); });
