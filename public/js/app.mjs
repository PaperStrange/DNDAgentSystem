// 应用入口：路由 + 全局状态
import { Net, resolveServer, saveServer, isNativeShell } from './net.mjs';
import { mountLobby } from './screens/lobby.mjs';
import { mountRoom } from './screens/room.mjs';
import { mountGame } from './screens/game.mjs';
import { migrateColors, migrateLook } from './pixel.mjs';

const S = {
  view: null, snapshot: null, pid: null, name: '', net: null,
  curScreen: null, curScreenName: null, account: null,
};
if (localStorage.getItem('dnd_account')) S.account = localStorage.getItem('dnd_account');
window.__S = S;

export const store = S;

let _lastToast = { msg: '', at: 0 };
export function toast(msg, isErr) {
  // R-22: 相同提示 1.5 秒内去重，避免错误刷屏
  const now = Date.now();
  if (msg === _lastToast.msg && now - _lastToast.at < 1500) return;
  _lastToast = { msg, at: now };
  const root = document.getElementById('toast-root');
  const el = document.createElement('div');
  el.className = 'toast' + (isErr ? ' err' : '');
  el.textContent = msg;
  root.appendChild(el);
  setTimeout(() => el.remove(), 3200);
}

export function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
}

// F-18：冒险卡片（藏书室）与账号绑定——未登录时藏书室内容为空
export function loadCards() {
  try {
    const acct = S.account || '';
    if (!acct) return []; // 未登录：藏书室为空
    const v = JSON.parse(localStorage.getItem('dnd_cards:' + acct) || '[]');
    if (!Array.isArray(v)) return [];
    return v.map(c => {
      if (!c) return c;
      if (c.colors) c.colors = migrateColors(c.colors);
      if (c.look) c.look = migrateLook(c.look);
      return c;
    });
  } catch (e) { return []; }
}
export function saveCard(record) {
  try {
    const acct = S.account || '';
    if (!acct) return; // 未登录不保存（游戏中建房必须登录，此路为防御）
    let cards = loadCards();
    cards = cards.filter(c => c && c.id !== record.id);
    cards.unshift(record);
    localStorage.setItem('dnd_cards:' + acct, JSON.stringify(cards.slice(0, 50)));
  } catch (e) { /* 存储失败静默 */ }
}
export function deleteCard(id) {
  try {
    const acct = S.account || '';
    if (!acct) return;
    const cards = loadCards().filter(c => c.id !== id);
    localStorage.setItem('dnd_cards:' + acct, JSON.stringify(cards));
  } catch (e) {}
}

// R-23: 客户端报错自查——未捕获错误/未处理Promise拒绝自动记录到本地环形缓冲（最多50条）
const ERR_KEY = 'dnd_errlog';
export function captureErr(src, msg) {
  try {
    const list = loadErrLog();
    list.unshift({ t: new Date().toLocaleString('zh-CN'), src, msg: String(msg).slice(0, 300) });
    localStorage.setItem(ERR_KEY, JSON.stringify(list.slice(0, 50)));
  } catch (e) { /* 静默 */ }
}
export function loadErrLog() {
  try { const v = JSON.parse(localStorage.getItem(ERR_KEY) || '[]'); return Array.isArray(v) ? v : []; } catch (e) { return []; }
}
export function clearErrLog() {
  try { localStorage.removeItem(ERR_KEY); } catch (e) {}
}
window.addEventListener('error', (e) => captureErr('脚本错误', (e.message || '未知错误') + ' @ ' + String(e.filename || '').split('/').pop() + ':' + e.lineno));
window.addEventListener('unhandledrejection', (e) => captureErr('异步错误', String(e.reason?.message || e.reason)));

const net = new Net();
S.net = net;
// 客户端打包适配（S3-1）：暴露给原生壳/诊断
window.__DND = { native: isNativeShell(), server: net.server };
net.onState = (view) => {
  S.view = view;
  S.snapshot = view;
  if (view.me) S.pid = view.me.pid;
  route(view);
};
net.onError = (msg) => toast(msg, true);
net.onKicked = () => { toast('你被房主移出了房间', true); };
net.onHello = (msg) => { S.account = msg.account || null; };
net.onAuthOk = () => { if (S.curScreen && S.curScreen.onAuthOk) S.curScreen.onAuthOk(); };
net.onAuthError = (msg) => { if (S.curScreen && S.curScreen.onAuthError) S.curScreen.onAuthError(msg); };
net.onEval = (ev) => { if (S.curScreen && S.curScreen.onEval) S.curScreen.onEval(ev); };
net.onBg = (text) => { if (S.curScreen && S.curScreen.onBg) S.curScreen.onBg(text); };
net.onLogExport = (m) => { if (S.curScreen && S.curScreen.onLogExport) S.curScreen.onLogExport(m); };

function route(view) {
  const name = view.view; // lobby | room | game
  if (S.curScreenName !== name) {
    const root = document.getElementById('screen-root');
    if (S.curScreen && S.curScreen.unmount) { try { S.curScreen.unmount(); } catch (e) {} }
    root.innerHTML = '';
    S.curScreen = null;
    // 关键修复：切换界面时清理所有挂在 body 上的覆盖层（结束弹窗/对话/开场），防止残留遮挡
    document.querySelectorAll('.dialog-overlay, .overlay-screen').forEach(n => n.remove());
    if (name === 'lobby') S.curScreen = mountLobby(root, view);
    else if (name === 'room') S.curScreen = mountRoom(root, view);
    else if (name === 'game') S.curScreen = mountGame(root, view);
    S.curScreenName = name;
  } else if (S.curScreen && S.curScreen.update) {
    S.curScreen.update(view);
  }
}

// 客户端打包适配（S3-1）：未配置服务器（原生壳首次启动）→ 连接引导页；否则正常连接
function mountConnect(root) {
  root.innerHTML = '';
  const box = el('div', 'connect-screen');
  const card = el('div', 'connect-card');
  card.appendChild(el('h2', '', '🎲 骰与篝火'));
  card.appendChild(el('div', 'muted', '联机跑团需要连接到一台运行游戏服务器的电脑（房主电脑）。'));
  card.appendChild(el('div', 'muted mt8', '手机与电脑请连接同一个 Wi-Fi，然后在电脑上执行 npm start 并填写电脑的局域网地址。'));
  const input = el('input', 'auth-input');
  input.placeholder = '例如 192.168.1.5:3000';
  input.value = (() => { try { return localStorage.getItem('dnd_server') || ''; } catch (e) { return ''; } })();
  input.onkeydown = (e) => { if (e.key === 'Enter') submit.click(); };
  card.appendChild(input);
  const err = el('div', 'auth-err', '');
  card.appendChild(err);
  const submit = el('button', 'btn gold big', '🔌 连接服务器');
  submit.style.width = '100%';
  submit.onclick = () => {
    const v = String(input.value || '').trim();
    if (!v) { err.textContent = '⚠️ 请填写服务器地址（电脑的 IP:端口）'; return; }
    err.textContent = '';
    saveServer(v);
    location.reload();
  };
  card.appendChild(submit);
  card.appendChild(el('div', 'muted mt8', '提示：浏览器直接访问 http://电脑IP:3000 也可以游玩；iOS/Android 壳应用与 PWA 均可指向同一地址。'));
  box.appendChild(card);
  root.appendChild(box);
}

if (!net.server) {
  // 原生壳未配置服务器：显示连接引导页（不启动路由）
  mountConnect(document.getElementById('screen-root'));
} else {
  net.connect();
}
setInterval(() => net.send('ping'), 25000);
