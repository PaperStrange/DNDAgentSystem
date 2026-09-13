// S3-1 PWA Service Worker：离线兜底（**网络优先**）+ 外壳预缓存
//
// 为什么不是「缓存优先」：游戏服务器就是本机/局域网里的同一个 Node 进程，
// 只要服务器在，网络永远比缓存新。此前的缓存优先策略会让「更新后的客户端」继续跑旧外壳
// （Windows 桌面版端口固定、原生壳 origin 固定、PWA 主屏应用 origin 固定时都会复现），
// 表现为「改了代码/发了新版，界面还是老的」。现在：先取网络 → 成功则顺手更新缓存 → 失败才回落到缓存。
const CACHE = 'dnd-shell-v2';
const SHELL = [
  './', './index.html', './manifest.webmanifest', './css/style.css',
  './js/app.mjs', './js/net.mjs', './js/pixel.mjs', './js/roster.mjs', './js/portraits.mjs',
  './js/screens/lobby.mjs', './js/screens/room.mjs', './js/screens/game.mjs',
  './shared/char-defs.mjs', './shared/autoplay-policy.mjs',
  './icons/icon-192.png', './icons/icon-512.png', './icons/apple-touch-icon.png',
];

self.addEventListener('install', (ev) => {
  // 预缓存失败不影响安装（游戏本体必须联网）
  ev.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL).catch(() => {})).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (ev) => {
  // 换版本号即清掉旧外壳缓存，避免新版发布后仍命中旧资源
  ev.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (ev) => {
  const req = ev.request;
  if (req.method !== 'GET') return;                       // POST/WS 升级等一律放行
  let url;
  try { url = new URL(req.url); } catch (e) { return; }
  if (url.origin !== self.location.origin) return;         // 跨域（局域网服务器地址）不介入
  if (url.pathname.endsWith('/ws')) return;                // WebSocket 握手不缓存
  if (req.cache === 'only-if-cached' && req.mode !== 'same-origin') return;

  ev.respondWith(
    fetch(req)
      .then(res => {
        if (res && res.ok && res.type === 'basic') {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {});
        }
        return res;
      })
      .catch(() => caches.match(req).then(hit => hit || caches.match('./index.html')))
  );
});
