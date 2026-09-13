// PWA 外壳更新探针：验证「服务器上的客户端更新后，浏览器/主屏应用不会继续跑旧外壳」
// 背景：Service Worker 若用缓存优先，会让人以为「改了代码没生效」——桌面版端口固定、原生壳与 PWA 主屏 origin 固定时都会踩到。
// 做法：注册 SW 并预热缓存 → 改动 public 下一个客户端文件 → 重新加载 → 断言页面拿到的是新内容。
// 用法：node tools/sw-cache-probe.mjs
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';

const PORT = Number(process.env.SW_PROBE_PORT || 3921);
const TARGET = join('public', 'js', 'screens', 'room.mjs');
const MARK = '\n// sw-cache-probe marker ' + Date.now() + '\n';
const SHOTS = 'e2e-shots';
mkdirSync(SHOTS, { recursive: true });
const dataDir = mkdtempSync(join(tmpdir(), 'dnd-sw-'));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const results = [];
const check = (n, ok, d) => { results.push(ok); console.log((ok ? '✅ ' : '❌ ') + n + (d ? ' — ' + d : '')); };

const server = spawn(process.execPath, ['server/index.mjs'], {
  env: { ...process.env, DND_PORT: String(PORT), DND_DATA_DIR: dataDir },
  stdio: ['ignore', 'pipe', 'pipe'],
});
server.stderr.on('data', d => process.stderr.write('[srv-err] ' + d));

const original = readFileSync(TARGET, 'utf8');

async function main() {
  await sleep(1500);
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await page.setDefaultTimeout(20000);
  await page.goto('http://localhost:' + PORT + '/');
  await page.waitForSelector('.lobby-title');

  // 等 SW 接管 + 外壳缓存建立
  const swReady = await page.evaluate(async () => {
    if (!('serviceWorker' in navigator)) return 'no-sw-support';
    const reg = await navigator.serviceWorker.ready.catch(() => null);
    if (!reg) return 'no-registration';
    for (let i = 0; i < 40 && !navigator.serviceWorker.controller; i++) await new Promise(r => setTimeout(r, 250));
    const keys = await caches.keys();
    return JSON.stringify({ active: !!reg.active, controlled: !!navigator.serviceWorker.controller, caches: keys });
  }).catch(e => 'err:' + e.message);
  check('Service Worker 已注册并接管页面', /dnd-shell/.test(String(swReady)), String(swReady));

  // 服务器端更新客户端文件（模拟发新版）
  writeFileSync(TARGET, original + MARK, 'utf8');
  await sleep(200);

  // 重新加载（等价于用户重开 PWA / 刷新页面）
  await page.reload();
  await page.waitForSelector('.lobby-title');
  let served = await page.evaluate(async () => {
    const res = await fetch('/js/screens/room.mjs', { cache: 'no-store' });
    return await res.text();
  });
  let fresh = served.includes(MARK.trim());
  if (!fresh) { // 老 SW 可能还占着控制权：等一次接管后再看（index.html 里有 controllerchange 自动刷新）
    await sleep(2500);
    await page.reload();
    await page.waitForSelector('.lobby-title');
    served = await page.evaluate(async () => (await fetch('/js/screens/room.mjs', { cache: 'no-store' })).text());
    fresh = served.includes(MARK.trim());
  }
  check('更新后页面取到新客户端代码（无旧外壳残留）', fresh, fresh ? '网络优先生效' : '仍命中旧缓存');

  // 还原文件并确认页面仍可用
  writeFileSync(TARGET, original, 'utf8');
  await page.reload();
  await page.waitForSelector('.lobby-title');
  const okLobby = await page.locator('.lobby-title').count();
  check('还原后页面正常加载', okLobby === 1);
  await page.screenshot({ path: SHOTS + '/sw-cache-probe.png' });

  const failed = results.filter(r => !r).length;
  console.log('\n===== SW 更新探针：' + (results.length - failed) + '/' + results.length + ' 通过 =====');
  await browser.close().catch(() => {});
  server.kill();
  await sleep(300);
  process.exit(failed ? 1 : 0);
}

main().catch(async e => {
  try { writeFileSync(TARGET, original, 'utf8'); } catch {}
  console.error('[probe] 异常', e);
  server.kill();
  process.exit(1);
});
