// 复现验证：浏览器带失效令牌访问 → 页面必须正常渲染大厅并弹出登录框（不能空白）
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';
const PORT = 3890;
const server = spawn(process.execPath, ['server/index.mjs'], {
  cwd: process.cwd(),
  env: { ...process.env, DND_PORT: String(PORT), DND_SEED: '1', DND_OFFLINE: '1' },
  stdio: ['ignore', 'ignore', 'inherit'],
});
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let failed = false;
const ok = (m) => console.log('✅ ' + m);
const fail = (m) => { failed = true; console.log('❌ ' + m); };
async function main() {
  await sleep(1500);
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  // 注入旧版本的失效令牌，模拟老玩家刷新页面
  await page.addInitScript(() => {
    localStorage.setItem('dnd_token', 'tk_deadbeefdeadbeefdeadbeef');
    localStorage.setItem('dnd_account', '老玩家');
  });
  await page.goto('http://localhost:' + PORT + '/');
  try {
    await page.waitForSelector('.lobby-title', { timeout: 8000 });
    ok('带失效令牌访问 → 大厅正常渲染（无空白页）');
  } catch (e) { fail('带失效令牌访问 → 页面空白'); }
  try {
    await page.waitForSelector('.dialog-overlay .auth-input', { timeout: 5000 });
    ok('登录框自动弹出，可重新登录');
  } catch (e) { fail('登录框未弹出'); }
  const tokenNow = await page.evaluate(() => localStorage.getItem('dnd_token'));
  ok('本地失效令牌已自动清除', !tokenNow || tokenNow !== 'tk_deadbeefdeadbeefdeadbeef', '当前token=' + (tokenNow || 'null'));
  await browser.close();
  server.kill();
  console.log(failed ? 'STALE-TOKEN RESULT: FAIL' : 'STALE-TOKEN RESULT: PASS');
  process.exit(failed ? 1 : 0);
}
main().catch(e => { console.error('CRASH:', e); server.kill(); process.exit(1); });
