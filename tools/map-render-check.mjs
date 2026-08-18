// 地图渲染回归（F-12）：进入序章后断言瓦片真实铺满画布（非暗像素占比>50%），
// 防止"瓦片堆叠左上角/地图全黑"回归（根因：drawTile坐标契约，已修复）
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';
const PORT = 3885;
const server = spawn(process.execPath, ['server/index.mjs'], {
  cwd: process.cwd(),
  env: { ...process.env, DND_PORT: String(PORT), DND_SEED: '2', DND_OFFLINE: '1' },
  stdio: ['ignore', 'ignore', 'inherit'],
});
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
async function main() {
  await sleep(1500);
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto('http://localhost:' + PORT + '/');
  await page.waitForSelector('.lobby-title');
  await page.waitForSelector('.dialog-overlay .auth-input');
  await page.click('.dialog-overlay .seg-btn:has-text("注册")');
  await page.fill('.dialog-overlay input[placeholder*="用户名"]', '采样' + (Date.now() % 100000));
  await page.fill('.dialog-overlay input[type="password"]', 's1234');
  await page.click('.dialog-overlay .btn.gold');
  await page.waitForSelector('.dialog-overlay', { state: 'detached', timeout: 10000 });
  await page.click('.persona-grid .persona-card:nth-child(1)');
  await page.click('.create-box .btn.gold');
  await page.waitForSelector('.room-code');
  await page.fill('input[placeholder="为你的角色起个名字"]', '采样侠');
  await page.locator('.opt-grid').nth(0).locator('.opt-card').first().click();
  await page.locator('.opt-grid').nth(1).locator('.opt-card').first().click();
  await page.waitForTimeout(300);
  await page.click('button:has-text("保存车卡")');
  await page.waitForTimeout(500);
  await page.click('button:has-text("准备就绪")');
  await page.waitForSelector('.dialog-overlay', { timeout: 5000 });
  await page.click('.dialog-overlay button:has-text("立即开始")');
  await page.waitForSelector('.screen-game', { timeout: 20000 });
  const errs = [];
  page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
  const introBtn = page.locator('.overlay-card button');
  if (await introBtn.count()) await introBtn.first().click();
  await page.waitForTimeout(2500);
  const data = await page.evaluate(() => {
    const gv = window.__e2e.view().game;
    const c = document.getElementById('game-canvas');
    const ctx = c.getContext('2d');
    const img = ctx.getImageData(0, 0, c.width, c.height).data;
    const theme = gv.map.theme;
    // 统计与主题色接近的像素
    const near = (hex, tol) => {
      const n = parseInt(hex.slice(1), 16);
      const tr = (n >> 16) & 255, tg = (n >> 8) & 255, tb = n & 255;
      let cnt = 0;
      for (let i = 0; i < img.length; i += 4) {
        if (Math.abs(img[i] - tr) <= tol && Math.abs(img[i + 1] - tg) <= tol && Math.abs(img[i + 2] - tb) <= tol) cnt++;
      }
      return cnt;
    };
    // 非近黑像素占比
    let nonDark = 0;
    for (let i = 0; i < img.length; i += 4) {
      if (img[i] + img[i + 1] + img[i + 2] > 60) nonDark++;
    }
    const total = img.length / 4;
    return { theme, nonDarkPct: (nonDark / total * 100).toFixed(1), totalPx: total };
  });
  console.log('theme:', JSON.stringify(data.theme));
  console.log('非暗像素占比:', data.nonDarkPct + '%');
  // 采样tiles数组与画布中心像素
  const diag = await page.evaluate(() => {
    const gv = window.__e2e.view().game;
    const c = document.getElementById('game-canvas');
    const ctx = c.getContext('2d');
    const img = ctx.getImageData(Math.floor(c.width / 2), Math.floor(c.height / 2), 1, 1).data;
    const tileRow = gv.map.tiles[Math.floor(gv.map.h / 2)] || [];
    return { center: [img[0], img[1], img[2]], tileSample: tileRow.slice(0, 26).join(''), mapSize: gv.map.w + 'x' + gv.map.h };
  });
  console.log('诊断:', JSON.stringify(diag));
  // 低分辨率色彩网格：每40px采样分类
  const grid = await page.evaluate(() => {
    const c = document.getElementById('game-canvas');
    const ctx = c.getContext('2d');
    const step = 40;
    const out = [];
    for (let y = step / 2; y < c.height; y += step) {
      let row = '';
      for (let x = step / 2; x < c.width; x += step) {
        const d = ctx.getImageData(x, y, 1, 1).data;
        const r = d[0], g = d[1], b = d[2];
        const lum = r + g + b;
        if (lum < 45) row += ' ';
        else if (g > r + 25 && g > b + 15) row += 'G'; // 草地绿
        else if (r > b + 20 && g > b + 10 && r > 80) row += 'F'; // 棕褐地面
        else if (b > r + 25) row += 'W'; // 蓝水
        else if (r < 90 && g < 90 && b < 110) row += 'd'; // 暗灰
        else row += 'o';
      }
      out.push(row);
    }
    return out;
  });
  console.log('画布色彩网格:');
  console.log(grid.join('\n'));
  console.log('浏览器错误:', errs.length ? errs.slice(0, 5).join(' || ') : '无');
  const pct = parseFloat(data.nonDarkPct);
  if (pct > 50) { console.log('MAP RENDER: PASS（非暗像素' + pct + '%）'); } else { console.log('MAP RENDER: FAIL（非暗像素仅' + pct + '%）'); process.exit(1); }
  // 精确RGB采样 + 手动画红方块验证getImageData可用性
  const exact = await page.evaluate(() => {
    const c = document.getElementById('game-canvas');
    const ctx = c.getContext('2d');
    const out = [];
    for (let y = 100; y <= 700; y += 120) {
      const row = [];
      for (let x = 100; x <= 1000; x += 120) {
        const d = ctx.getImageData(x, y, 1, 1).data;
        row.push('(' + d[0] + ',' + d[1] + ',' + d[2] + ')');
      }
      out.push('y' + y + ': ' + row.join(' '));
    }
    // 手动绘制红色方块到画布并读回
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#ff0000';
    ctx.fillRect(0, 0, 10, 10);
    const check = ctx.getImageData(5, 5, 1, 1).data;
    return { samples: out, redCheck: [check[0], check[1], check[2]] };
  });
  console.log('精确采样:');
  console.log(exact.samples.join('\n'));
  console.log('红色方块验证:', JSON.stringify(exact.redCheck), '(应为255,0,0)');
  const camInfo = await page.evaluate(() => {
    const c = document.getElementById('game-canvas');
    const gv = window.__e2e.view().game;
    const cam = window.__e2e.cam();
    const sc = window.__e2e.scale();
    const me = gv.entities.find(e => e.eid === gv.me.eid);
    // 手动重放：在玩家位置画一个品红色块
    const ctx = c.getContext('2d');
    ctx.setTransform(sc, 0, 0, sc, -cam.x * 16 * sc, -cam.y * 16 * sc);
    ctx.fillStyle = '#ff00ff';
    ctx.fillRect(me.x * 16, me.y * 16, 32, 32);
    const sx = Math.round((me.x - cam.x) * 16 * sc);
    const sy = Math.round((me.y - cam.y) * 16 * sc);
    const d = ctx.getImageData(Math.max(0, sx + 8), Math.max(0, sy + 8), 1, 1).data;
    return { cam, scale: sc, cw: c.width, ch: c.height, me: { x: me.x, y: me.y }, screenXY: [sx, sy], readback: [d[0], d[1], d[2]] };
  });
  console.log('相机/缩放:', JSON.stringify(camInfo));
  // RAF活性测试：画品红块→等1秒→看是否被下一帧覆盖（覆盖=RAF活着；残留=RAF已死）
  const rafAlive = await page.evaluate(async () => {
    const c = document.getElementById('game-canvas');
    const ctx = c.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#ff00ff';
    ctx.fillRect(0, 0, 60, 60);
    await new Promise(r => setTimeout(r, 1200));
    const d = ctx.getImageData(30, 30, 1, 1).data;
    return [d[0], d[1], d[2]];
  });
  console.log('品红残留(255,0,255=RAF已死 / 13,10,20=RAF活着覆盖):', JSON.stringify(rafAlive));
  const counters = await page.evaluate(() => ({ frames: window.__frames || 0, tiles: window.__tilesDrawn || 0, cw: document.getElementById('game-canvas').width, drawW: window.__drawCanvasW, count: document.querySelectorAll('#game-canvas').length }));
  console.log('帧计数:', JSON.stringify(counters), '(tiles>0说明瓦片循环在执行)');
  // 浏览器内直接调用drawTile验证
  const dt = await page.evaluate(async () => {
    const px = await import('/js/pixel.mjs');
    const c = document.getElementById('game-canvas');
    const ctx = c.getContext('2d');
    const gv = window.__e2e.view().game;
    const cam = window.__e2e.cam();
    const sc = window.__e2e.scale();
    ctx.setTransform(sc, 0, 0, sc, -cam.x * 16 * sc, -cam.y * 16 * sc);
    px.drawTile(ctx, '.', 8, 8, 0, gv.map.theme);
    const sx = Math.round((8 - cam.x) * 16 * sc + 20);
    const sy = Math.round((8 - cam.y) * 16 * sc + 20);
    const d = ctx.getImageData(sx, sy, 1, 1).data;
    return { screen: [sx, sy], read: [d[0], d[1], d[2]], expect: gv.map.theme.floor };
  });
  console.log('浏览器内drawTile:', JSON.stringify(dt));
  const minimal = await page.evaluate(() => {
    const c = document.getElementById('game-canvas');
    const ctx = c.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#7a6a4a';
    const fs1 = ctx.fillStyle;
    ctx.fillRect(200, 200, 40, 40);
    const d1 = ctx.getImageData(220, 220, 1, 1).data;
    ctx.setTransform(3, 0, 0, 3, 100, 100);
    ctx.fillStyle = '#123456';
    ctx.fillRect(10, 10, 16, 16);
    const d2 = ctx.getImageData(100 + 30 + 24, 100 + 30 + 24, 1, 1).data;
    return { fs1, d1: [d1[0], d1[1], d1[2]], d2: [d2[0], d2[1], d2[2]] };
  });
  console.log('最小fill测试:', JSON.stringify(minimal));
  const traced = await page.evaluate(async () => {
    const px = await import('/js/pixel.mjs');
    const c = document.getElementById('game-canvas');
    const ctx = c.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const calls = [];
    const orig = ctx.fillRect.bind(ctx);
    ctx.fillRect = function (x, y, w, h) { calls.push([String(ctx.fillStyle).slice(0, 20), x, y, w, h]); return orig(x, y, w, h); };
    px.drawTile(ctx, '.', 0, 0, 0);
    px.drawTile(ctx, '.', 0, 0, 0, { floor: '#7a6a4a' });
    ctx.fillRect = orig;
    return { callCount: calls.length, first: calls.slice(0, 4), themed: calls.filter(c => c[0].includes('7a6a4a')).length };
  });
  console.log('drawTile调用追踪:', JSON.stringify(traced));
  await browser.close();
  server.kill();
  process.exit(0);
}
main().catch(e => { console.error('CRASH:', e); server.kill(); process.exit(1); });
