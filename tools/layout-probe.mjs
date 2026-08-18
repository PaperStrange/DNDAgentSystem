// R-20 多分辨率布局探针：不同视口下大厅/房间/游戏三屏无横向溢出、关键元素可见
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';

const PORT = 3898;
const server = spawn(process.execPath, ['server/index.mjs'], {
  cwd: process.cwd(),
  env: { ...process.env, DND_PORT: String(PORT), DND_SEED: '5', DND_OFFLINE: '1' },
  stdio: ['ignore', 'ignore', 'inherit'],
});
const log = (...a) => console.log('[layout]', ...a);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let failed = false;
const check = (name, ok, extra = '') => { log((ok ? '✅ ' : '❌ ') + name + (extra ? ' | ' + extra : '')); if (!ok) failed = true; };

async function login(page, i) {
  await page.waitForSelector('.dialog-overlay .auth-input', { timeout: 8000 });
  await page.click('.dialog-overlay .seg-btn:has-text("注册")');
  await page.fill('.dialog-overlay input[placeholder*="用户名"]', '布局' + i + '_' + (Date.now() % 100000));
  await page.fill('.dialog-overlay input[type="password"]', 'lay1234');
  await page.click('.dialog-overlay .btn.gold');
  await page.waitForSelector('.dialog-overlay', { state: 'detached', timeout: 10000 });
}

async function noOverflow(page) {
  return page.evaluate(() => {
    const d = document.documentElement;
    return { sw: d.scrollWidth, iw: window.innerWidth, sh: d.scrollHeight, ih: window.innerHeight };
  });
}

async function main() {
  await sleep(1500);
  const browser = await chromium.launch();
  const vps = [{ w: 800, h: 600 }, { w: 1024, h: 768 }, { w: 1280, h: 720 }, { w: 1366, h: 768 }, { w: 1440, h: 900 }, { w: 1920, h: 1080 }, { w: 2560, h: 1440 }];
  for (let i = 0; i < vps.length; i++) {
    const vp = vps[i];
    const ctx = await browser.newContext({ viewport: { width: vp.w, height: vp.h } });
    const page = await ctx.newPage();
    await page.goto('http://localhost:' + PORT + '/');
    await page.waitForSelector('.lobby-title');
    await login(page, i);
    // 大厅
    let o = await noOverflow(page);
    check(vp.w + 'x' + vp.h + ' 大厅无横向溢出', o.sw <= o.iw + 1, 'scrollW=' + o.sw + ' innerW=' + o.iw);
    check(vp.w + 'x' + vp.h + ' 大厅建房面板可见', await page.locator('.create-box').isVisible());
    await page.screenshot({ path: 'e2e-shots/layout-' + vp.w + '-lobby.png' });
    // 房间
    await page.click('.persona-grid .persona-card:nth-child(1)');
    await page.click('.create-box .btn.gold');
    await page.waitForSelector('.room-code');
    o = await noOverflow(page);
    check(vp.w + 'x' + vp.h + ' 房间无横向溢出', o.sw <= o.iw + 1, 'scrollW=' + o.sw + ' innerW=' + o.iw);
    check(vp.w + 'x' + vp.h + ' 车卡保存按钮可见', await page.locator('button:has-text("保存车卡")').isVisible());
    await page.screenshot({ path: 'e2e-shots/layout-' + vp.w + '-room.png' });
    // 车卡+开局
    await page.fill('input[placeholder="为你的角色起个名字"]', '布局侠' + i);
    await page.locator('.opt-grid').nth(0).locator('.opt-card').first().click();
    await page.locator('.opt-grid').nth(1).locator('.opt-card').first().click();
    await page.waitForTimeout(300);
    await page.click('button:has-text("保存车卡")');
    await page.waitForTimeout(600);
    await page.click('button:has-text("准备就绪")');
    await page.waitForSelector('.dialog-overlay', { timeout: 5000 });
    await page.click('.dialog-overlay button:has-text("立即开始")');
    await page.waitForSelector('.screen-game', { timeout: 20000 });
    await page.waitForTimeout(1500);
    o = await noOverflow(page);
    check(vp.w + 'x' + vp.h + ' 游戏无横向溢出', o.sw <= o.iw + 1, 'scrollW=' + o.sw + ' innerW=' + o.iw);
    const canvasBox = await page.locator('#game-canvas').boundingBox();
    const inView = canvasBox && canvasBox.x >= -1 && canvasBox.x + canvasBox.width <= vp.w + 1;
    check(vp.w + 'x' + vp.h + ' 画布完整在视口内', !!inView, canvasBox ? ('x=' + Math.round(canvasBox.x) + ' w=' + Math.round(canvasBox.width)) : '无画布');
    check(vp.w + 'x' + vp.h + ' 侧栏(日志面板)可见', await page.locator('.game-side').isVisible());
    await page.screenshot({ path: 'e2e-shots/layout-' + vp.w + '-game.png' });
    await ctx.close();
  }
  await browser.close();
  server.kill();
  log(failed ? 'LAYOUT RESULT: FAIL' : 'LAYOUT RESULT: PASS');
  process.exit(failed ? 1 : 0);
}
main().catch(e => { console.error('LAYOUT CRASH:', e); server.kill(); process.exit(1); });
