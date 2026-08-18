// 画布渲染实测：缓冲尺寸 vs CSS尺寸（拉伸检测）+ 场景内容边界框（长条状检测）
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';

const PORT = 3894;
const server = spawn(process.execPath, ['server/index.mjs'], {
  cwd: process.cwd(),
  env: { ...process.env, DND_PORT: String(PORT) },
  stdio: ['ignore', 'pipe', 'pipe'],
});
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function main() {
  await sleep(1500);
  const browser = await chromium.launch();
  for (const vp of [{ w: 1600, h: 900 }, { w: 2560, h: 1080 }, { w: 1366, h: 768 }]) {
    const page = await browser.newPage({ viewport: { width: vp.w, height: vp.h } });
    await page.goto('http://localhost:' + PORT + '/');
    await page.waitForSelector('.lobby-title');
    // 账户系统：注册唯一账号并自动登录
    await page.waitForSelector('.dialog-overlay .auth-input', { timeout: 8000 });
    await page.click('.dialog-overlay .seg-btn:has-text("注册")');
    await page.fill('.dialog-overlay input[placeholder*="用户名"]', '探针' + (Date.now() % 1000000));
    await page.fill('.dialog-overlay input[type="password"]', 'probe1234');
    await page.click('.dialog-overlay .btn.gold');
    await page.waitForSelector('.dialog-overlay', { state: 'detached', timeout: 10000 });
    await page.click('.persona-grid .persona-card:nth-child(1)');
    await page.click('.create-box .btn.gold');
    await page.waitForSelector('.room-code');
    await page.fill('input[placeholder="为你的角色起个名字"]', '探针侠');
    await page.locator('.opt-grid').nth(0).locator('.opt-card').first().click();
    await page.locator('.opt-grid').nth(1).locator('.opt-card').first().click();
    await page.waitForTimeout(300);
    await page.click('button:has-text("保存车卡")');
    await page.waitForTimeout(500);
    await page.click('button:has-text("准备就绪")');
    // B-10: 单人准备后需在确认框中选择"立即开始"
    await page.waitForSelector('.dialog-overlay', { timeout: 5000 });
    await page.click('.dialog-overlay button:has-text("立即开始")');
    await page.waitForSelector('.screen-game', { timeout: 15000 });
    await page.waitForTimeout(2500);
    const data = await page.evaluate(() => {
      const c = document.getElementById('game-canvas');
      const rect = c.getBoundingClientRect();
      const ctx = c.getContext('2d');
      const img = ctx.getImageData(0, 0, c.width, c.height).data;
      // 内容边界框（非背景像素的列/行范围）
      let minX = 1e9, maxX = -1, minY = 1e9, maxY = -1, count = 0;
      for (let y = 0; y < c.height; y += 2) {
        for (let x = 0; x < c.width; x += 2) {
          const i = (y * c.width + x) * 4;
          const isBg = img[i] === 13 && img[i + 1] === 10 && img[i + 2] === 20;
          if (!isBg) {
            count++;
            if (x < minX) minX = x; if (x > maxX) maxX = x;
            if (y < minY) minY = y; if (y > maxY) maxY = y;
          }
        }
      }
      return {
        bufferW: c.width, bufferH: c.height,
        cssW: Math.round(rect.width), cssH: Math.round(rect.height),
        stretchX: Math.abs(c.width - rect.width) > 1 ? (rect.width / c.width).toFixed(3) : '1.000',
        stretchY: Math.abs(c.height - rect.height) > 1 ? (rect.height / c.height).toFixed(3) : '1.000',
        content: count ? { w: maxX - minX, h: maxY - minY, aspect: ((maxX - minX) / (maxY - minY)).toFixed(2) } : null,
      };
    });
    console.log('视口 ' + vp.w + 'x' + vp.h + ':', JSON.stringify(data));
    await page.screenshot({ path: 'e2e-shots/canvas-probe-' + vp.w + '.png' });
    await page.close();
  }
  await browser.close();
  server.kill();
  process.exit(0);
}
main().catch(e => { console.error('PROBE CRASH:', e); server.kill(); process.exit(1); });
