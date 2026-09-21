// WebSocket 网络层：自动重连（token）+ 账户登录/注册/单点登录
// S3-1 打包适配：服务器地址可配置（PWA/局域网/原生壳 Capacitor 均可指向电脑端服务器）
const LS_TOKEN = 'dnd_token';
const LS_ACCOUNT = 'dnd_account';
const LS_SERVER = 'dnd_server';

// 是否运行在原生壳（Capacitor/WebView）中——此时 location 不是游戏服务器，必须显式配置地址
export function isNativeShell() {
  try {
    if (location.protocol === 'capacitor:' || location.protocol === 'file:') return true;
    const cap = window.Capacitor;
    if (cap && typeof cap.isNativePlatform === 'function' && cap.isNativePlatform()) return true;
    if (cap && cap.getPlatform && cap.getPlatform() !== 'web') return true;
  } catch (e) { /* ignore */ }
  return false;
}

export function normalizeServer(v) {
  let s = String(v || '').trim();
  if (!s) return '';
  if (!/^https?:\/\//i.test(s)) s = 'http://' + s;
  return s.replace(/\/+$/, '');
}

// 服务器地址解析：URL参数 ?server= → 本地存储 → 同源（浏览器直接访问服务器时）；原生壳未配置则返回 null
export function resolveServer() {
  try {
    const q = new URLSearchParams(location.search).get('server');
    if (q) { const v = normalizeServer(q); if (v) { try { localStorage.setItem(LS_SERVER, v); } catch (e) {} return v; } }
  } catch (e) { /* ignore */ }
  let saved = '';
  try { saved = localStorage.getItem(LS_SERVER) || ''; } catch (e) {}
  if (saved) return normalizeServer(saved);
  if (!isNativeShell() && /^https?:$/.test(location.protocol)) return location.origin;
  return null;
}

export function saveServer(addr) {
  const v = normalizeServer(addr);
  try { if (v) localStorage.setItem(LS_SERVER, v); else localStorage.removeItem(LS_SERVER); } catch (e) {}
  return v;
}

export class Net {
  constructor(server = undefined) {
    this.ws = null;
    this.pid = null;
    this.server = server === undefined ? resolveServer() : normalizeServer(server); // S3-1：目标服务器基址（null=未配置）
    this.token = localStorage.getItem(LS_TOKEN) || null;
    this.account = localStorage.getItem(LS_ACCOUNT) || null;
    this.name = localStorage.getItem('dnd_name') || '';
    this.onState = null; this.onHello = null; this.onKicked = null; this.onError = null; this.onEval = null; this.onBg = null;
    this.onAuthOk = null; this.onAuthError = null; this.onLogExport = null;
    this.onCharacters = null; this.onRosterImport = null; // R1-33：账号角色列表 / 名册迁移回执
    this.characters = []; // R1-33：服务端下发的账号角色（s:hello.characters）
    this._reconnectTimer = null;
  }
  // 原生壳首启/切换服务器：保存地址后重连
  setServer(addr) {
    const v = saveServer(addr);
    if (!v) return false;
    this.server = v;
    try { if (this.ws) { this.ws.onclose = null; this.ws.close(); } } catch (e) {}
    this.ws = null;
    if (this._reconnectTimer) { clearTimeout(this._reconnectTimer); this._reconnectTimer = null; }
    this.connect();
    return true;
  }
  connect() {
    if (!this.server) return false; // 未配置服务器（原生壳首启）：由连接引导页引导填写
    if (this.ws && this.ws.readyState === 1) return true;
    const wsUrl = this.server.replace(/^http/i, 'ws').replace(/\/+$/, '') + '/ws';
    const ws = new WebSocket(wsUrl);
    this.ws = ws;
    ws.onopen = () => {
      if (this.token) ws.send(JSON.stringify({ t: 'hello', name: this.name || '冒险者', token: this.token, rename: true }));
      else ws.send(JSON.stringify({ t: 'hello' })); // 未登录：访客态（可浏览大厅，建房/加入需登录）
    };
    ws.onmessage = (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch { return; }
      if (msg.t === 's:hello') {
        this.pid = msg.pid;
        this.token = msg.token || msg.pid; // 秘密重连令牌（仅本人持有）
        this.name = msg.name;
        if (msg.account) { this.account = msg.account; localStorage.setItem(LS_ACCOUNT, this.account); }
        localStorage.setItem(LS_TOKEN, this.token);
        localStorage.setItem('dnd_name', this.name);
        // R1-33：账号角色列表（服务端权威）——用于重建/校验名册条目
        this.characters = Array.isArray(msg.characters) ? msg.characters : [];
        this.onHello && this.onHello(msg);
        this.onCharacters && this.onCharacters(this.characters);
        this.onAuthOk && this.onAuthOk(msg);
      } else if (msg.t === 's:state') {
        this.onState && this.onState(msg.view);
      } else if (msg.t === 's:error') {
        if (msg.auth) {
          // 凭证失效：清除本地旧令牌，避免刷新后再次走到失效路径
          localStorage.removeItem(LS_TOKEN);
          localStorage.removeItem(LS_ACCOUNT);
          this.token = null;
          this.account = null;
        }
        // 未登录（含访客态）时的认证错误 → 弹窗内红字提示（访客也有pid，不能以!pid判断）
        if (msg.auth && this.onAuthError && !this.account) { this.onAuthError(msg.msg); return; }
        this.onError && this.onError(msg.msg);
      } else if (msg.t === 's:kicked') {
        this.onKicked && this.onKicked();
      } else if (msg.t === 's:auth-kicked') {
        // 单点登录：本连接被新登录挤掉 → 清除本地凭证并回到登录态
        localStorage.removeItem(LS_TOKEN);
        localStorage.removeItem(LS_ACCOUNT);
        try { sessionStorage.removeItem('auth_prompted'); } catch (e) {}
        this.token = null; this.account = null;
        this.onError && this.onError(msg.msg || '账号已在其他位置登录');
        setTimeout(() => location.reload(), 1800);
      } else if (msg.t === 's:eval') {
        this.onEval && this.onEval(msg.eval);
      } else if (msg.t === 's:bg') {
        this.onBg && this.onBg(msg.text);
      } else if (msg.t === 's:log-export') {
        this.onLogExport && this.onLogExport(msg);
      } else if (msg.t === 's:roster-import') {
        this.onRosterImport && this.onRosterImport(msg); // R1-33：名册迁移回执
      } else if (msg.t === 'pong') { /* noop */ }
    };
    ws.onclose = () => {
      if (this._reconnectTimer) return;
      this._reconnectTimer = setTimeout(() => { this._reconnectTimer = null; this.connect(); }, 1500);
    };
    ws.onerror = () => {};
  }
  // 登录/注册（同一连接复用）
  login(account, password, isRegister) {
    if (!this.ws || this.ws.readyState !== 1) { this.onAuthError && this.onAuthError('与服务器连接中断，正在重连，请稍后再试'); this.connect(); return; }
    this.ws.send(JSON.stringify({ t: 'hello', action: isRegister ? 'register' : 'login', account, password }));
  }
  logout() {
    localStorage.removeItem(LS_TOKEN);
    localStorage.removeItem(LS_ACCOUNT);
    try { sessionStorage.removeItem('auth_prompted'); } catch (e) {}
    this.token = null; this.account = null; this.pid = null;
    location.reload(); // 回到登录态大厅（登录框自动弹出）
  }
  send(t, payload = {}) {
    if (!this.ws || this.ws.readyState !== 1) return false;
    this.ws.send(JSON.stringify({ t, ...payload }));
    return true;
  }
  setName(name) {
    this.name = name;
    localStorage.setItem('dnd_name', name);
    if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify({ t: 'hello', name, token: this.token, rename: true }));
  }
}
