// WebSocket 网络层：自动重连（token）+ 账户登录/注册/单点登录
const LS_TOKEN = 'dnd_token';
const LS_ACCOUNT = 'dnd_account';

export class Net {
  constructor() {
    this.ws = null;
    this.pid = null;
    this.token = localStorage.getItem(LS_TOKEN) || null;
    this.account = localStorage.getItem(LS_ACCOUNT) || null;
    this.name = localStorage.getItem('dnd_name') || '';
    this.onState = null; this.onHello = null; this.onKicked = null; this.onError = null; this.onEval = null; this.onBg = null;
    this.onAuthOk = null; this.onAuthError = null; this.onLogExport = null;
    this._reconnectTimer = null;
  }
  connect() {
    if (this.ws && this.ws.readyState === 1) return;
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(proto + '://' + location.host + '/ws');
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
        this.onHello && this.onHello(msg);
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
        if (msg.auth && this.onAuthError && !this.pid) { this.onAuthError(msg.msg); return; }
        this.onError && this.onError(msg.msg);
      } else if (msg.t === 's:kicked') {
        this.onKicked && this.onKicked();
      } else if (msg.t === 's:auth-kicked') {
        // 单点登录：本连接被新登录挤掉 → 清除本地凭证并回到登录态
        localStorage.removeItem(LS_TOKEN);
        localStorage.removeItem(LS_ACCOUNT);
        this.token = null; this.account = null;
        this.onError && this.onError(msg.msg || '账号已在其他位置登录');
        setTimeout(() => location.reload(), 1800);
      } else if (msg.t === 's:eval') {
        this.onEval && this.onEval(msg.eval);
      } else if (msg.t === 's:bg') {
        this.onBg && this.onBg(msg.text);
      } else if (msg.t === 's:log-export') {
        this.onLogExport && this.onLogExport(msg);
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
    this.token = null; this.account = null; this.pid = null;
    location.reload(); // 回到登录态大厅
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
