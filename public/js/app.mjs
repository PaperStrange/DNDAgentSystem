// 应用入口：路由 + 全局状态
import { Net } from './net.mjs';
import { mountLobby } from './screens/lobby.mjs';
import { mountRoom } from './screens/room.mjs';
import { mountGame } from './screens/game.mjs';

const S = {
  view: null, snapshot: null, pid: null, name: '', net: null,
  curScreen: null, curScreenName: null,
};
window.__S = S;

export const store = S;

export function toast(msg, isErr) {
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

const net = new Net();
S.net = net;
net.onState = (view) => {
  S.view = view;
  S.snapshot = view;
  if (view.me) S.pid = view.me.pid;
  route(view);
};
net.onError = (msg) => toast(msg, true);
net.onKicked = () => { toast('你被房主移出了房间', true); };
net.onHello = () => {};
net.onEval = (ev) => { if (S.curScreen && S.curScreen.onEval) S.curScreen.onEval(ev); };
net.onBg = (text) => { if (S.curScreen && S.curScreen.onBg) S.curScreen.onBg(text); };

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

net.connect();
setInterval(() => net.send('ping'), 25000);
