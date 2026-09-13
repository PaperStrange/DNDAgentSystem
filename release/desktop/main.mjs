// S3-1 Windows 桌面版（Electron）：内嵌游戏服务器 + 原生窗口，双击即玩
// - 自动选择空闲端口启动 server/index.mjs（HTTP 静态 + WebSocket 同进程）
// - 数据（账户库/冒险日志/用户配置）落到 userData 目录（DND_DATA_DIR），不写应用包内部
// - --smoke 自检模式：无界面启动→等待页面就绪→打印结果→退出（供自动化验证）
import { app, BrowserWindow, Menu, shell, dialog } from 'electron';
import { createServer } from 'node:net';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync } from 'node:fs';

const here = dirname(fileURLToPath(import.meta.url));
const appDir = join(here, '..', '..'); // 项目根目录（release/desktop/ 往上两级）
const SMOKE = process.argv.includes('--smoke');
const isDev = !app.isPackaged;

// 1) 选定空闲端口（避免与已运行的开发服务器冲突）
function freePort() {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const port = srv.address().port;
      srv.close(() => resolve(port));
    });
  });
}

// 2) 数据目录：打包后写 userData；开发时沿用项目 data/
const dataDir = isDev ? join(appDir, 'data') : join(app.getPath('userData'), 'data');
mkdirSync(dataDir, { recursive: true });
process.env.DND_DATA_DIR = dataDir;

let win = null;
let port = 0;

async function startServer() {
  port = Number(process.env.DND_DESKTOP_PORT || 0) || await freePort();
  process.env.DND_PORT = String(port);
  // 同进程内启动游戏服务器（server/index.mjs 顶层即监听）
  await import(new URL('../../server/index.mjs', import.meta.url).href);
  // 等待 HTTP 就绪
  const base = 'http://127.0.0.1:' + port + '/';
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(base, { method: 'GET' });
      if (res.ok) return base;
    } catch (e) { /* 还没起来 */ }
    await new Promise(r => setTimeout(r, 150));
  }
  throw new Error('服务器启动超时');
}

function buildMenu() {
  const template = [
    {
      label: '游戏',
      submenu: [
        { label: '重新加载', accelerator: 'F5', click: () => win && win.reload() },
        { label: '重新开始（清空本地登录态）', click: () => { if (win) { win.webContents.session.clearStorageData({ storages: ['localstorage'] }).then(() => win.reload()); } } },
        { type: 'separator' },
        { label: '退出', accelerator: 'Alt+F4', role: 'quit' },
      ],
    },
    {
      label: '查看',
      submenu: [
        { label: '全屏', accelerator: 'F11', click: () => win && win.setFullScreen(!win.isFullScreen()) },
        { label: '放大', role: 'zoomIn' }, { label: '缩小', role: 'zoomOut' }, { label: '重置缩放', role: 'resetZoom' },
        { type: 'separator' },
        { label: '开发者工具', accelerator: 'F12', click: () => win && win.webContents.toggleDevTools() },
      ],
    },
    {
      label: '帮助',
      submenu: [
        { label: '数据目录', click: () => shell.openPath(dataDir) },
        { label: '关于', click: () => dialog.showMessageBox(win, { type: 'info', title: '关于', message: '骰与篝火 · AI DM 像素跑团', detail: 'Windows 桌面版（内嵌服务器）\n端口：' + port + '\n数据目录：' + dataDir }) },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

async function createWindow(base) {
  win = new BrowserWindow({
    width: 1440, height: 900, minWidth: 1024, minHeight: 640,
    backgroundColor: '#14121a',
    title: '骰与篝火 · AI DM 像素跑团',
    show: !SMOKE,
    autoHideMenuBar: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false, backgroundThrottling: false },
  });
  win.on('closed', () => { win = null; });
  // 局域网地址提示：标题栏显示本机可分享的地址
  const { networkInterfaces } = await import('node:os');
  const ips = Object.values(networkInterfaces()).flat().filter(i => i && i.family === 'IPv4' && !i.internal).map(i => i.address);
  win.setTitle('骰与篝火 · 本机 ' + base + (ips.length ? ' · 局域网 http://' + ips[0] + ':' + port : ''));
  await win.loadURL(base);
  return win;
}

// 单实例：重复启动时聚焦已有窗口
if (!SMOKE && !app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });

  app.whenReady().then(async () => {
    try {
      const base = await startServer();
      await createWindow(base);
      buildMenu();
      if (SMOKE) {
        // 自检：等待大厅渲染完成（客户端首屏）
        const ok = await win.webContents.executeJavaScript(`
          new Promise((resolve) => {
            const t0 = Date.now();
            const tick = () => {
              if (document.querySelector('.lobby-title') || document.querySelector('.connect-screen')) return resolve(true);
              if (Date.now() - t0 > 15000) return resolve(false);
              setTimeout(tick, 200);
            };
            tick();
          })
        `).catch(() => false);
        const title = await win.webContents.executeJavaScript('document.title').catch(() => '');
        console.log('DESKTOP SERVER PORT: ' + port);
        console.log('DESKTOP PAGE TITLE: ' + title);
        console.log(ok ? 'DESKTOP SMOKE: PASS' : 'DESKTOP SMOKE: FAIL');
        app.exit(ok ? 0 : 1);
      }
    } catch (e) {
      console.error('[desktop] 启动失败', e);
      if (SMOKE) { console.log('DESKTOP SMOKE: FAIL'); app.exit(1); return; }
      dialog.showErrorBox('启动失败', '游戏服务器启动失败：' + (e?.message || e));
      app.quit();
    }
  });

  app.on('window-all-closed', () => app.quit()); // 关窗即退出（内嵌服务器随之关闭）
}
