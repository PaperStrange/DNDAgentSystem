// ART-3-A1 §5：**确定性美术截图探针**（方向 B · HD-2D 光影）
// 目的：产出「改造前 vs 改造后」真机对比图，且满足可比性硬约束：
//   · 同视口 1440×900   · 同 seed（DND_SEED）   · 冻结时间（__e2e.setFixedTime）   · 已收敛（__e2e.settled）
// 设计要点：
//   · 车卡确定化——默认新角色 colors 取各 tone 数组第 0 项、look 全 0（room.mjs:274-275），故不点任何
//     随机按钮即得确定性外观（避免 Math.random 污染对比）。
//   · 冻结/光照钩子是**可选**的：旧分支（main）无 __e2e.setFixedTime / setLightMode ⇒ 探针自动降级为
//     「延迟后截图、仅 full」并如实记录（degraded=true），用于产出「改造前」图。
//   · 产物落 DND_SHOTS_DIR（默认 docs/art/shots），**绝不写 e2e-shots/**（后者 git 跟踪）。
//   · 每图输出 sha256 + 像素统计（distinctColors / 最常色覆盖）到 manifest.json，供报告取证。
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { chromium } from 'playwright';
import { join } from 'node:path';
// R1-34/R1-27 全员确认门的**唯一真源**（与 solo-probe / bots / e2e / ui-check 共用），
// 避免「只点单人确认框、漏点游戏内确认门 ⇒ 截图带确认覆盖层」（canvas-probe 的历史缺陷）。
import { CONFIRM_BUTTON_TEXT, isConfirmGate, isGameStarted, waitPagePhase } from '../simulate/confirm-gate.mjs';

const PORT = Number(process.env.DND_ART_PORT || 3899);
const SEED = Number(process.env.DND_SEED || 20240601);
const SHOTS = process.env.DND_SHOTS_DIR || 'docs/art/shots';
const TAG = process.env.DND_ART_TAG || 'after';       // after / before
const FREEZE = Number(process.env.DND_ART_FREEZE || 10000); // 冻结时间戳（ms），决定瓦片/粒子相位
const VW = 1440, VH = 900;                            // 硬约束：同视口
mkdirSync(SHOTS, { recursive: true });
const log = (...a) => console.log('[art-shot:' + TAG + ']', ...a);

const server = spawn(process.execPath, ['server/index.mjs'], {
  cwd: process.cwd(),
  env: { ...process.env, DND_PORT: String(PORT), DND_SEED: String(SEED), DND_OFFLINE: '1' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
server.stderr.on('data', d => process.stderr.write('[srv] ' + d));
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let browser = null;

// 等服务器就绪（并发任务下 3899 可能启动偏慢）——最多等 30s
async function waitServer(url, tries = 60) {
  for (let i = 0; i < tries; i++) {
    try { const r = await fetch(url); if (r.ok) return true; } catch (e) { /* 未就绪 */ }
    await sleep(500);
  }
  return false;
}

const manifest = { tag: TAG, seed: SEED, viewport: { w: VW, h: VH }, freezeMs: FREEZE, generatedAt: new Date().toISOString(), shots: [], errors: [], degraded: false };

async function shoot(page, name, extra = {}) {
  const path = join(SHOTS, name + '.png');
  await page.screenshot({ path });
  let stat = null;
  try {
    stat = await page.evaluate(async () => {
      const c = document.getElementById('game-canvas');
      if (!c || c.width < 50) return null;
      const ctx = c.getContext('2d');
      const d = ctx.getImageData(0, 0, c.width, c.height).data;
      const freq = new Map(); let total = 0, maxN = 0;
      for (let i = 0; i < d.length; i += 4) {
        const key = (d[i] << 16) | (d[i + 1] << 8) | d[i + 2];
        const n = (freq.get(key) || 0) + 1; freq.set(key, n); if (n > maxN) maxN = n; total++;
      }
      // ⭐ 判据复验用：对**画布像素**做 SHA-256（页面截图含日志时间戳等非画布元素 ⇒ 不可用于逐像素比对）
      let canvasSha = '';
      try {
        const bytes = new Uint8Array(d.buffer, d.byteOffset, d.byteLength);
        const digest = await crypto.subtle.digest('SHA-256', bytes);
        canvasSha = [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 16);
      } catch (e) { canvasSha = 'unavailable'; }
      // 诊断：游戏态（实体坐标/相机/浮字）
      const v = (window.__e2e && window.__e2e.view) ? window.__e2e.view() : null;
      const gv = v && v.game;
      const cam = (window.__e2e && window.__e2e.cam) ? window.__e2e.cam() : null;
      return {
        distinctColors: freq.size, dominantPct: +(100 * maxN / total).toFixed(2),
        canvasSha, canvasW: c.width, canvasH: c.height,
        ents: gv ? gv.entities.map(e => e.eid.slice(-5) + '@' + e.x + ',' + e.y).join('|') : '',
        cam: cam ? cam.x.toFixed(4) + ',' + cam.y.toFixed(4) : '',
        floaters: (window.__e2e && window.__e2e.floaters) ? window.__e2e.floaters().length : -1,
        autoplay: (window.__e2e && window.__e2e.debug) ? window.__e2e.debug().autoplay : '?',
      };
    });
  } catch (e) { /* 非游戏页（大厅/房间）无画布 */ }
  const sha = createHash('sha256').update(readFileSync(path)).digest('hex').slice(0, 16);
  const rec = { name, file: name + '.png', sha256_16: sha, ...extra, ...(stat || {}) };
  manifest.shots.push(rec);
  log('  📷 ' + name + '  sha=' + sha + (stat ? '  distinct=' + stat.distinctColors + ' 最常色=' + stat.dominantPct + '%' : '') + (stat && stat.cam ? '  canvasSha=' + stat.canvasSha + ' (' + stat.canvasW + 'x' + stat.canvasH + ')  cam=' + stat.cam + ' autoplay=' + stat.autoplay + '  ents=' + stat.ents : ''));
  return rec;
}

async function login(page, name) {
  await page.waitForSelector('.dialog-overlay .auth-input', { timeout: 8000 });
  await page.click('.dialog-overlay .seg-btn:has-text("注册")');
  await page.fill('.dialog-overlay input[placeholder*="用户名"]', name);
  await page.fill('.dialog-overlay input[type="password"]', 'art1234');
  await page.click('.dialog-overlay .btn.gold');
  const ok = await page.waitForSelector('.dialog-overlay', { state: 'detached', timeout: 6000 }).then(() => true).catch(() => false);
  if (!ok) {
    await page.click('.dialog-overlay .seg-btn:has-text("登录")');
    await page.fill('.dialog-overlay input[placeholder*="用户名"]', name);
    await page.fill('.dialog-overlay input[type="password"]', 'art1234');
    await page.click('.dialog-overlay .btn.gold');
    await page.waitForSelector('.dialog-overlay', { state: 'detached', timeout: 6000 });
  }
}

async function main() {
  const ready = await waitServer('http://localhost:' + PORT + '/');
  if (!ready) { console.error('ART-SHOT: 服务器未就绪（30s 超时）'); server.kill(); process.exit(3); }
  browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: VW, height: VH } });
  page.on('pageerror', e => manifest.errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') manifest.errors.push('console: ' + m.text()); });

  await page.goto('http://localhost:' + PORT + '/');
  await page.waitForSelector('.lobby-title');
  await shoot(page, '01-lobby', { scene: '大厅' });

  await login(page, 'artshot' + (Date.now() % 1000000));
  await page.click('.persona-grid .persona-card:nth-child(1)');
  await page.click('.create-box .btn.gold');
  await page.waitForSelector('.room-code');
  await shoot(page, '02-room', { scene: '房间' });

  // 车卡：**不点任何随机** ⇒ 默认 colors=tone[0]、look=全0（确定性）
  await page.fill('input[placeholder="为你的角色起个名字"]', '艺影');
  await page.locator('.opt-grid').nth(0).locator('.opt-card').first().click(); // 种族：人类
  await page.locator('.opt-grid').nth(1).locator('.opt-card').first().click(); // 职业：战士
  await page.waitForTimeout(400);
  await shoot(page, '03-chargen', { scene: '车卡' });
  await page.click('button:has-text("保存车卡")');
  await page.waitForTimeout(400);

  await page.click('button:has-text("准备就绪")');
  await page.waitForSelector('.dialog-overlay', { timeout: 5000 });
  await page.click('.dialog-overlay button:has-text("立即开始")');
  await page.waitForSelector('.screen-game', { timeout: 15000 });
  // R1-27 全员确认门：单人局也须在**真实界面**点「我已读完隐藏目标，确认开始」⇒ 否则截图被确认覆盖层遮挡
  await waitPagePhase(page, isConfirmGate, 30000, '全员确认门出现');
  const cbtn = page.locator('button:has-text("' + CONFIRM_BUTTON_TEXT + '")');
  await cbtn.first().waitFor({ state: 'visible', timeout: 30000 });
  await cbtn.first().click();
  await waitPagePhase(page, isGameStarted, 30000, '确认门放行（playing）');
  // ⭐ 判据复验关键：**立即关闭自动游玩**——否则单人对局会实时自行推进（实测 ~1.3s 内已换图/换实体），
  //    导致「同 seed 两次渲染」不可比。关掉后对局停在玩家回合，状态静止 ⇒ 冻结时间才真正冻结画面。
  await page.evaluate(() => { try { window.__e2e && window.__e2e.setAutoplay(false); } catch (e) {} });
  await page.waitForTimeout(1200);

  // 关闭开场覆盖层（若存在）
  const intro = page.locator('.overlay-card button:has-text("开始冒险")');
  if (await intro.count()) { await intro.first().click(); await page.waitForTimeout(800); }

  // 预热：等画布尺寸稳定（日志面板增长会触发 ResizeObserver ⇒ lightmap 尺寸重建的启动瞬态）
  let prevW = 0, prevH = 0;
  for (let i = 0; i < 12; i++) {
    const dim = await page.evaluate(() => { const c = document.getElementById('game-canvas'); return c ? [c.width, c.height] : [0, 0]; });
    if (dim[0] === prevW && dim[1] === prevH && dim[0] > 50) break;
    prevW = dim[0]; prevH = dim[1];
    await page.waitForTimeout(300);
  }

  // 冻结时间 + 等收敛（旧分支无钩子 ⇒ 降级）
  const hasFreeze = await page.evaluate(() => !!(window.__e2e && window.__e2e.setFixedTime));
  if (hasFreeze) {
    await page.evaluate((ms) => window.__e2e.setFixedTime(ms), FREEZE);
    const ok = await page.waitForFunction(() => window.__e2e && window.__e2e.settled(), null, { timeout: 8000 }).then(() => true).catch(() => false);
    manifest.frozen = true; manifest.settled = ok;
    log('冻结时间=' + FREEZE + 'ms  已收敛=' + ok);
    await page.waitForTimeout(300);
  } else {
    manifest.degraded = true; manifest.frozen = false;
    log('⚠️ 该分支无 __e2e.setFixedTime ⇒ 降级为实时截图（degraded=true）');
  }

  await shoot(page, '04-game-light-full', { scene: '游戏·光照完整' });

  const hasLight = await page.evaluate(() => !!(window.__e2e && window.__e2e.setLightMode));
  if (hasLight) {
    await page.evaluate(() => window.__e2e.setLightMode('dim'));
    await page.waitForTimeout(250);
    await shoot(page, '05-game-light-dim', { scene: '游戏·光照减弱' });
    await page.evaluate(() => window.__e2e.setLightMode('off'));
    await page.waitForTimeout(250);
    await shoot(page, '06-game-light-off', { scene: '游戏·光照关闭（对照）' });
    await page.evaluate(() => window.__e2e.setLightMode('full'));
    await page.waitForTimeout(250);
    // 「明度下限前/后」对照（取证 §2.4「环境底 #0d0a14」 vs §6.2 可读性下限）
    const hasFloor = await page.evaluate(() => !!(window.__e2e && window.__e2e.setAmbientFloor));
    if (hasFloor) {
      await page.evaluate(() => window.__e2e.setAmbientFloor(20)); // §2.4 字面（#0d0a14 的 max 通道 ≈20）
      await page.waitForTimeout(250);
      await shoot(page, '07-game-floor-2_4-low', { scene: '游戏·环境底=§2.4(#0d0a14 级)对照' });
      await page.evaluate(() => window.__e2e.setAmbientFloor(null)); // 恢复内置下限
      await page.waitForTimeout(200);
    }
    // 判据复验：同一次运行内**重复**采集 full ⇒ 区分「运行内稳定」与「跨运行微差」
    await page.evaluate(() => window.__e2e.setLightMode('full'));
    await page.waitForTimeout(400);
    await shoot(page, '08-game-light-full-repeat', { scene: '游戏·光照完整（重复采集·判据复验）' });
  }

  writeFileSync(join(SHOTS, 'manifest-' + TAG + '.json'), JSON.stringify(manifest, null, 2), 'utf8');
  log('错误数=' + manifest.errors.length + '（忽略无音频设备）');
  for (const e of manifest.errors.slice(0, 6)) log('  ⚠ ' + e);
  const realErrors = manifest.errors.filter(e => !e.includes('AudioContext') && !e.includes('WebAudio'));
  log('ART-SHOT ' + (realErrors.length === 0 ? 'OK' : 'ERRORS=' + realErrors.length));
  await browser.close(); server.kill();
  process.exit(realErrors.length === 0 ? 0 : 2);
}

function cleanup() { try { server.kill(); } catch (e) {} try { browser && browser.close(); } catch (e) {} }
process.on('exit', cleanup);
process.on('SIGINT', () => { cleanup(); process.exit(1); });
process.on('SIGTERM', () => { cleanup(); process.exit(1); });
main().catch(e => { console.error('ART-SHOT CRASH:', e); cleanup(); process.exit(1); });
