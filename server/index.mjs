// 服务入口：静态文件 + WebSocket + 玩家注册表
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, extname, dirname, resolve, sep } from 'node:path';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { config } from './config.mjs';
import { setSeed, uid } from './util.mjs';
import { Rooms, MAX_PLAYERS } from './game/rooms.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pub = resolve(root, 'public');
if (config.seed !== null && config.seed !== undefined) { setSeed(config.seed); console.log('[init] 随机种子:', config.seed); }

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.ico': 'image/x-icon', '.svg': 'image/svg+xml', '.txt': 'text/plain; charset=utf-8', '.md': 'text/markdown; charset=utf-8' };

const rooms = new Rooms();
const players = new Map(); // pid -> {pid, name, ws, roomCode, online, token}
const newToken = () => 'tk_' + randomBytes(18).toString('hex'); // 秘密重连令牌（绝不通过快照外发）
// 安全：config 永不外发；令牌只经 s:hello 发送给持有者本人

rooms.bindRegistry(
  (pid) => players.get(pid)?.name || pid,
  (pid) => players.get(pid)?.online ?? true,
  broadcastRoom
);

function send(pid, obj) {
  const p = players.get(pid);
  if (p && p.ws && p.ws.readyState === 1) p.ws.send(JSON.stringify(obj));
}
function broadcastRoom(room) {
  if (!room) return;
  for (const pid of room.members) {
    const p = players.get(pid);
    if (!p || p.ws?.readyState !== 1) continue;
    p.ws.send(JSON.stringify({ t: 's:state', view: rooms.snapshotFor(p) }));
  }
}
function sendErr(pid, msg) { send(pid, { t: 's:error', msg }); }

function handleMsg(player, raw) {
  let msg;
  try { msg = JSON.parse(raw); } catch { return; }
  if (process.env.DND_DEBUG) console.log('[msg]', player.pid.slice(-4), msg.t, msg.targetEid ? 'target=' + msg.targetEid.slice(-4) : '');
  if (msg.t === 'ping') return send(player.pid, { t: 'pong' });
  Promise.resolve(rooms.dispatch(player, msg)).then((res) => {
    if (!res) return;
    if (process.env.DND_DEBUG && (msg.t === 'game:move' || msg.t === 'game:cast' || msg.t === 'game:attack')) {
      console.log('[disp]', player.pid.slice(-4), msg.t, 'err=' + (res.err || ''), 'ok=' + !!res.ok);
    }
    if (res.err) {
      sendErr(player.pid, res.err);
      return;
    }
    if (res.kicked) {
      const victim = players.get(res.victimPid || player.pid);
      if (victim) {
        victim.roomCode = null;
        send(victim.pid, { t: 's:kicked' });
        send(victim.pid, { t: 's:state', view: rooms.snapshotFor(victim) });
      }
    }
    if (res.left) {
      send(player.pid, { t: 's:state', view: rooms.snapshotFor(player) });
      if (res.room) broadcastRoom(res.room);
      return;
    }
    // 有状态变化的动作后广播
    const room = rooms.roomOf(player);
    if (room) broadcastRoom(room);
    if (res.room && player.roomCode !== res.room.code) {
      player.roomCode = res.room.code;
      broadcastRoom(res.room);
    }
  }).catch(e => {
    console.error('[server] dispatch error', e);
  });
}

const server = createServer(async (req, res) => {
  try {
    let path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (path === '/') path = '/index.html';
    // 安全：路径规范化后必须严格位于 public 目录内（防目录穿越/前缀混淆）
    const file = resolve(pub, '.' + path);
    if (!(file === pub || file.startsWith(pub + sep)) || !existsSync(file) || !(await import('node:fs/promises')).stat(file).then(s => s.isFile()).catch(() => false)) {
      res.writeHead(404); res.end('Not Found'); return;
    }
    const ext = extname(file).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(await readFile(file));
  } catch (e) { res.writeHead(404); res.end('Not Found'); }
});

const wss = new WebSocketServer({ server, path: '/ws' });
wss.on('connection', (ws, req) => {
  // 安全：跨站WebSocket劫持防护 —— 浏览器请求必须同源
  const origin = req.headers.origin;
  if (origin) {
    try {
      const u = new URL(origin);
      const host = String(req.headers.host || '');
      if (u.host !== host && u.host !== 'localhost:' + config.port && u.host !== '127.0.0.1:' + config.port) {
        ws.close(1008, 'origin-not-allowed');
        return;
      }
    } catch { ws.close(1008, 'origin-not-allowed'); return; }
  }
  // 安全：连接级消息限流（防洪泛拖垮服务器）
  ws._rate = { count: 0, window: Date.now() };
  let pid = null;
  ws.on('message', (raw) => {
    const now = Date.now();
    if (now - ws._rate.window > 1000) { ws._rate.window = now; ws._rate.count = 0; }
    ws._rate.count++;
    if (ws._rate.count > 60) return; // 超过60条/秒直接丢弃
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }
    if (msg.t === 'hello') {
      const name = String(msg.name || '冒险者').slice(0, 16);
      // 秘密令牌重连/改名：令牌只由本人持有，快照中绝不外发
      if (msg.token) {
        const old = [...players.values()].find(p => p.token === msg.token);
        if (old) {
          if (old.ws && old.ws !== ws && old.ws.readyState === 1) { try { old.ws.close(); } catch (e) {} }
          pid = old.pid;
          old.ws = ws; old.online = true;
          if (msg.rename && name) old.name = name;
          ws.__pid = pid;
          send(pid, { t: 's:hello', pid, name: old.name, roomCode: old.roomCode, token: old.token });
          if (old.roomCode) { const r = rooms.rooms.get(old.roomCode); if (r) broadcastRoom(r); }
          else send(pid, { t: 's:state', view: rooms.snapshotFor(old) });
          return;
        }
      }
      pid = uid('p');
      ws.__pid = pid;
      const token = newToken();
      players.set(pid, { pid, name, ws, roomCode: null, online: true, token });
      send(pid, { t: 's:hello', pid, name, roomCode: null, token });
      send(pid, { t: 's:state', view: rooms.snapshotFor(players.get(pid)) });
      return;
    }
    if (!pid) return;
    const p = players.get(pid);
    if (!p || !p.online || p.ws !== ws) return;
    handleMsg(p, raw.toString());
  });
  ws.on('close', () => {
    if (!pid) return;
    const p = players.get(pid);
    if (!p || p.ws !== ws) return; // 旧连接被替换时忽略其关闭事件
    p.online = false;
    p.ws = null;
    // 断线保留10分钟，房间游戏照常；房间大厅中离线1分钟后移除
    const room = rooms.roomOf(p);
    if (room) {
      if (room.phase === 'prepare' || room.phase === 'ended') {
        setTimeout(() => {
          const pp = players.get(pid);
          if (pp && !pp.online && pp.roomCode === room.code && (room.phase === 'prepare' || room.phase === 'ended')) {
            rooms.leaveRoom(pp);
            broadcastRoom(room);
          }
        }, 60e3);
      } else {
        broadcastRoom(room);
      }
    }
    setTimeout(() => {
      const pp = players.get(pid);
      if (pp && !pp.online && !pp.roomCode) players.delete(pp);
    }, 600e3);
  });
  ws.on('error', () => {});
});

// 全局异常兜底：记录而非崩溃（单个房间的错误不应拖垮整个服务器）
process.on('uncaughtException', (e) => { console.error('[server] uncaughtException:', e?.stack || e); });
process.on('unhandledRejection', (e) => { console.error('[server] unhandledRejection:', e?.stack || e); });

setInterval(() => rooms.sweep(), 300e3);

server.listen(config.port, () => {
  console.log('🎲 DNDAgentSystem 已启动: http://localhost:' + config.port);
  console.log('   副本：凡杜尔失落矿坑 | AI DM人设：12位 | 离线DM模式：' + (!config.llm?.apiKey ? '开启(未配置LLM)' : 'LLM已配置'));
});
