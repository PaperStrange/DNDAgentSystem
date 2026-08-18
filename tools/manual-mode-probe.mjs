// 手动模式探针：选手动进入冒险后，玩家角色不得自动行动；徽章正确；自动模式下角色应自动行动
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';
const PORT = 3887;
const server = spawn(process.execPath, ['server/index.mjs'], {
  cwd: process.cwd(),
  env: { ...process.env, DND_PORT: String(PORT), DND_SEED: '9', DND_OFFLINE: '1' },
  stdio: ['ignore', 'ignore', 'inherit'],
});
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const log = (...a) => console.log('[manual]', ...a);
let failed = false;
const ok = (m) => log('✅ ' + m);
const fail = (m) => { failed = true; log('❌ ' + m); };

async function enterGame(mode) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await page.goto('http://localhost:' + PORT + '/');
  await page.waitForSelector('.lobby-title');
  await page.waitForSelector('.dialog-overlay .auth-input');
  await page.click('.dialog-overlay .seg-btn:has-text("注册")');
  await page.fill('.dialog-overlay input[placeholder*="用户名"]', (mode === 'manual' ? '手动家' : '自动家') + (Date.now() % 100000));
  await page.fill('.dialog-overlay input[type="password"]', 'mm1234');
  await page.click('.dialog-overlay .btn.gold');
  await page.waitForSelector('.dialog-overlay', { state: 'detached', timeout: 10000 });
  await page.click('.persona-grid .persona-card:nth-child(1)');
  await page.click('.create-box .btn.gold');
  await page.waitForSelector('.room-code');
  // 选战斗模式
  await page.click('.seg-btn:has-text("' + (mode === 'manual' ? '手动战斗' : '自动战斗') + '")');
  await page.waitForTimeout(500);
  await page.fill('input[placeholder="为你的角色起个名字"]', mode === 'manual' ? '手动侠' : '自动侠');
  await page.locator('.opt-grid').nth(0).locator('.opt-card').first().click();
  await page.locator('.opt-grid').nth(1).locator('.opt-card').first().click();
  await page.waitForTimeout(300);
  await page.click('button:has-text("保存车卡")');
  await page.waitForTimeout(500);
  await page.click('button:has-text("准备就绪")');
  await page.waitForSelector('.dialog-overlay', { timeout: 5000 });
  await page.click('.dialog-overlay button:has-text("立即开始")');
  await page.waitForSelector('.screen-game', { timeout: 20000 });
  await page.waitForTimeout(1200);
  return { ctx, page };
}

let browser;
async function main() {
  await sleep(1500);
  browser = await chromium.launch();
  // 手动模式
  const m = await enterGame('manual');
  const badge = await m.page.locator('.badge').first().textContent();
  if (badge.includes('手动')) ok('手动模式徽章正确：' + badge.trim());
  else fail('手动模式徽章错误：' + badge);
  const autoGold = await m.page.locator('button:has-text("自动")').first().evaluate(el => el.classList.contains('gold'));
  if (!autoGold) ok('手动模式自动游玩未开启（按钮无高亮）');
  else fail('手动模式自动游玩被错误开启');
  const pos0 = await m.page.evaluate(() => {
    const gv = window.__e2e.view().game;
    const me = gv.entities.find(e => e.eid === gv.me.eid);
    return { x: me.x, y: me.y, turn: gv.turn?.playerId };
  });
  await sleep(9000);
  const pos1 = await m.page.evaluate(() => {
    const gv = window.__e2e.view().game;
    const me = gv.entities.find(e => e.eid === gv.me.eid);
    return { x: me.x, y: me.y, turn: gv.turn?.playerId };
  });
  if (pos0.x === pos1.x && pos0.y === pos1.y) ok('手动模式9秒后角色未自动移动（位置 ' + pos1.x + ',' + pos1.y + '）');
  else fail('手动模式角色自动移动了：(' + pos0.x + ',' + pos0.y + ')→(' + pos1.x + ',' + pos1.y + ')');
  await m.ctx.close();
  // 自动模式
  const a = await enterGame('auto');
  const badge2 = await a.page.locator('.badge').first().textContent();
  if (badge2.includes('自动')) ok('自动模式徽章正确：' + badge2.trim());
  else fail('自动模式徽章错误：' + badge2);
  const posA0 = await a.page.evaluate(() => {
    const gv = window.__e2e.view().game;
    const me = gv.entities.find(e => e.eid === gv.me.eid);
    return { x: me.x, y: me.y };
  });
  await sleep(9000);
  const posA1 = await a.page.evaluate(() => {
    const gv = window.__e2e.view().game;
    const me = gv.entities.find(e => e.eid === gv.me.eid);
    return { x: me.x, y: me.y };
  });
  if (posA0.x !== posA1.x || posA0.y !== posA1.y) ok('自动模式角色自动行动（' + posA0.x + ',' + posA0.y + ')→(' + posA1.x + ',' + posA1.y + '）');
  else fail('自动模式角色未自动行动');
  await a.ctx.close();
  await browser.close();
  server.kill();
  log(failed ? 'MANUAL RESULT: FAIL' : 'MANUAL RESULT: PASS');
  process.exit(failed ? 1 : 0);
}
main().catch(e => { console.error('CRASH:', e); server.kill(); process.exit(1); });
