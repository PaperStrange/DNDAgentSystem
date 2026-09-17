// R1-14 连接层守卫：把探针的裸 WebSocket 封装为「与浏览器同语义」的健壮客户端。
// 对齐 public/js/net.mjs 的四条语义：
//   1. 解析守卫：JSON.parse 失败仅忽略该帧，连接不断（net.mjs:79）
//   2. 发送守卫：readyState !== 1 时 send 返回 false 且不抛（net.mjs:138-142）
//   3. 自动重连：close 后 1.5s 重连（net.mjs:120-123）
//   4. 错误监听：error 恒有监听者，避免 EventEmitter 无监听者时抛出（net.mjs:124）
// 另：每次 open（含重连）回调 onOpen(api)，供调用方带 token 重发 hello（net.mjs:73-76）。
//
// 位置说明：team-lead 原定路径为 tools/lib/ws-client-guard.mjs，但 .gitignore:17 的 `lib/`
//   规则会把该目录整体忽略（仓库当前 0 个 lib/ 下的受控文件），且硬约束「不改 .gitignore」。
//   故改放平级路径 tools/ws-client-guard.mjs（不被任何 ignore 规则命中，可正常入库）。
import { WebSocket } from 'ws';

export function createGuardedSocket({ url, log, onMessage, onOpen, reconnectDelayMs = 1500 } = {}) {
  const logger = typeof log === 'function' ? log : () => {};
  const delay = Number.isFinite(reconnectDelayMs) ? reconnectDelayMs : 1500;
  let ws = null;
  let reconnectTimer = null;
  let closedByUser = false;
  let reconnectCount = 0;

  const api = {
    // 发送守卫：非 OPEN 返回 false（不抛），语义同 net.mjs:138-142
    send(t, payload = {}) {
      if (!ws || ws.readyState !== 1) return false;
      try { ws.send(JSON.stringify({ t, ...payload })); return true; }
      catch (e) { logger('send异常: ' + (e && e.message ? e.message : e)); return false; }
    },
    close() {
      closedByUser = true;
      if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
      try { if (ws) ws.close(); } catch (e) {}
    },
    readyState() { return ws ? ws.readyState : 3; },
    reconnectCount() { return reconnectCount; },
  };

  function connect() {
    let sock;
    try { sock = new WebSocket(url); }
    catch (e) { logger('ws构造异常: ' + (e && e.message ? e.message : e)); return; }
    ws = sock;
    sock.on('open', () => { try { if (onOpen) onOpen(api); } catch (e) { logger('onOpen异常: ' + (e && e.message ? e.message : e)); } });
    sock.on('message', (raw) => {
      let m;
      // 解析守卫：坏帧忽略该帧，连接不断（net.mjs:79）
      try { m = JSON.parse(raw.toString()); } catch (e) { return; }
      try { if (onMessage) onMessage(m); } catch (e) { logger('onMessage异常: ' + (e && e.message ? e.message : e)); }
    });
    sock.on('error', () => {}); // 错误监听：避免无监听者抛出（net.mjs:124）
    sock.on('close', () => {
      if (closedByUser || reconnectTimer) return;
      reconnectTimer = setTimeout(() => { reconnectTimer = null; reconnectCount++; connect(); }, delay); // net.mjs:120-123
    });
  }

  connect();
  return api;
}
