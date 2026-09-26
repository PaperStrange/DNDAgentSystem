// R1-21 独立复核 · 行为补测（真实服务器 + 真实 Chromium）
//
// 用法：R21_APP_ROOT=<worktree 路径> R21_PORT=<空闲端口> node tools/r1-21-review-test.mjs
// 输出：<R21_OUT_DIR>/r1-21-review-<label>.json
//
// 覆盖：
//   A) 子问题A「不点也开局」：A 就绪 + B 不点 ⇒ 是否开局？（主检出 1f1dc3c 与分支 d9003e4 都跑）
//   B) 子问题B「回房联动」：房主点「回到房间」⇒ 其他人视图是否被拽走？（同上都跑）
//   C) 单人房不被「全员就绪」卡住
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const APP_ROOT = process.env.R21_APP_ROOT || join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.R21_PORT || 3110);
const LABEL = process.env.R21_LABEL || 'run';
const OUT_DIR = process.env.R21_OUT_DIR || join(APP_ROOT, 'docs', 'qa', 'restart-sprint1', 'r1-21-cr-evidence');
mkdirSync(OUT_DIR, { recursive: true });
const log = (...a) => console.log('[r21]', ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const server = spawn(process.execPath, ['server/index.mjs'], {
  cwd: APP_ROOT,
  env: { ...process.env, DND_PORT: String(PORT), DND_SEED: '9', DND_OFFLINE: '1' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let addrInUse = false;
server.stderr.on('data', (d) => { const s = String(d); if (s.includes('EADDRINUSE')) addrInUse = true; process.stderr.write('[srv] ' + s); });
let browser = null;
const cleanup = () => { try { server.kill(); } catch (e) {} try { browser && browser.close(); } catch (e) {} };
process.on('exit', cleanup);
process.on('SIGINT', () => { cleanup(); process.exit(1); });
process.on('SIGTERM', () => { cleanup(); process.exit(1); });

const readView = (page) => page.evaluate(() => {
  const v = window.__S.view || {};
  return {
    screen: v.view, phase: v.phase, waiting: !!v.waiting, waitingFor: v.waitingFor || null, myAfterEnd: v.myAfterEnd || null,
    members: (v.members || []).map((m) => ({ name: m.name, ready: !!m.ready, isHost: !!m.isHost, isMe: !!m.isMe })),
    win: v.win ? v.win.kind : null,
    reminders: [...document.querySelectorAll('.muted')].map((n) => n.textContent).filter((t) => t && (t.includes('就绪') || t.includes('等待') || t.includes('未就绪'))),
    pid: window.__S.pid,
  };
});

const nextStepTowardFoe = () => {
  const gv = window.__e2e && window.__e2e.view && window.__e2e.view().game;
  if (!gv) return null;
  const me = gv.entities.find((e) => e.eid === gv.me.eid);
  const BLOCK = '#TD~'; const W = gv.map.w, H = gv.map.h;
  const walk = (x, y) => { if (x < 0 || y < 0 || x >= W || y >= H) return false; const ch = gv.map.tiles[y][x]; return ch !== undefined && !BLOCK.includes(ch); };
  const foes = gv.entities.filter((e) => e.kind === 'monster' && !e.dead);
  if (!foes.length) return null;
  const q = [[me.x, me.y]]; const prev = new Map(); const seen = new Set([me.x + ',' + me.y]);
  let best = null, bestD = Infinity;
  while (q.length) {
    const [x, y] = q.shift();
    for (const f of foes) { const d = Math.abs(x - f.x) + Math.abs(y - f.y); if (d < bestD) { bestD = d; best = [x, y]; } }
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const nx = x + dx, ny = y + dy; if (!walk(nx, ny)) continue; const k = nx + ',' + ny; if (seen.has(k)) continue; seen.add(k); prev.set(k, [x, y]); q.push([nx, ny]); }
  }
  if (!best) return null;
  let cur = best; const path = [cur];
  while (prev.has(cur.join(','))) { cur = prev.get(cur.join(',')); path.push(cur); }
  path.reverse();
  return path[1] ? { x: path[1][0], y: path[1][1] } : null;
};

async function register(page, name) {
  await page.goto('http://localhost:' + PORT + '/');
  await page.waitForSelector('.lobby-title');
  await page.waitForSelector('.dialog-overlay .auth-input', { timeout: 20000 });
  await page.click('.dialog-overlay .seg-btn:has-text("注册")');
  await page.fill('.dialog-overlay input[placeholder*="用户名"]', name);
  await page.fill('.dialog-overlay input[type="password"]', 'r21pass1');
  await page.click('.dialog-overlay .btn.gold');
  await page.waitForSelector('.dialog-overlay', { state: 'detached', timeout: 12000 });
}
async function buildWizard(page, cname) {
  await page.fill('input[placeholder="为你的角色起个名字"]', cname);
  await page.locator('.opt-grid:not(.cols3) .opt-card').first().click();
  await page.locator('.opt-grid.cols3 .opt-card').nth(1).click();
  await page.waitForTimeout(350);
  await page.click('button:has-text("保存车卡")');
  await page.waitForTimeout(600);
}

async function main() {
  await sleep(1500);
  if (addrInUse) throw new Error('端口 ' + PORT + ' 被占用（EADDRINUSE）——必须连自己启动的服务器');
  browser = await chromium.launch();
  const out = { runAt: new Date().toISOString(), appRoot: APP_ROOT, port: PORT, label: LABEL, tests: {} };

  const ctxA = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const ctxB = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const A = await ctxA.newPage(); const B = await ctxB.newPage();
  const errs = [];
  for (const p of [A, B]) p.on('pageerror', (e) => errs.push('pageerror: ' + e.message));

  // ---- 建局：A 建房，B 加入 ----
  await register(A, 'R21甲' + (Date.now() % 10000));
  await A.click('.persona-grid .persona-card:nth-child(1)');
  await A.click('.create-box .btn.gold');
  await A.waitForSelector('.room-code');
  await A.click('.seg-btn:has-text("手动战斗")');
  await A.waitForTimeout(300);
  const codeRaw = (await A.locator('.room-code').textContent()) || '';
  const code = (codeRaw.match(/[A-Z0-9]{4,6}/) || [codeRaw.trim()])[0];
  await register(B, 'R21乙' + (Date.now() % 10000));
  await B.fill('.join-box input', code);
  await B.click('.join-box button:has-text("加入房间")');
  await B.waitForSelector('.room-code', { timeout: 12000 });
  await buildWizard(A, '甲法师'); await buildWizard(B, '乙法师');
  log('房间就绪 code=' + code);

  // ================= A) A 就绪 + B 不点 ⇒ 是否开局？ =================
  await A.click('button:has-text("准备就绪")');
  await sleep(6000);
  const aA = await readView(A); const aB = await readView(B);
  const aStarted = (aA.screen === 'game') || (aB.screen === 'game');
  out.tests.A = {
    desc: 'A 就绪 + B 不点 ⇒ 是否开局',
    aReadyNotStart: !aStarted,
    A: aA, B: aB,
    verdict: aStarted ? 'REPRODUCED（不点也开局）' : 'NOT-REPRODUCED（未开局，符合预期）',
  };
  log('A 结果：' + out.tests.A.verdict + ' | A.screen=' + aA.screen + ' B.screen=' + aB.screen + ' | A提醒=' + JSON.stringify(aA.reminders));

  // ================= B) 开局 → 打到全灭 → 房主回房 ⇒ 他人是否被拽？ =================
  // B 也准备 ⇒ 全员就绪自动开局
  await B.click('button:has-text("准备就绪")');
  for (const p of [A, B]) await p.waitForSelector('.screen-game', { timeout: 30000 });
  await sleep(1200);
  for (const p of [A, B]) {
    await p.evaluate(() => { if (window.__e2e && window.__e2e.setAutoplay) window.__e2e.setAutoplay(false); });
    const ib = p.locator('.overlay-card button:has-text("开始冒险"), .overlay-card button:has-text("聆听命运")');
    if (await ib.count()) await ib.first().click().catch(() => {});
  }
  await sleep(600);
  log('对局开始（2 人法师/手动），驱动至全灭…');
  const t0 = Date.now();
  for (let i = 0; i < 500; i++) {
    let done = false;
    for (const p of [A, B]) {
      const st = await p.evaluate(() => { const gv = window.__e2e && window.__e2e.view && window.__e2e.view().game; return gv ? { state: gv.state, win: !!gv.win, combat: !!(gv.combat && gv.combat.active) } : null; }).catch(() => null);
      if (!st) { done = true; continue; }
      if (st.win) { done = true; continue; }
      if (st.state !== 'playing') continue;
      if (st.combat) await p.evaluate(() => window.__S.net.send('game:endturn')).catch(() => {});
      else { const s = await p.evaluate(nextStepTowardFoe).catch(() => null); if (s) await p.evaluate((x) => window.__S.net.send('game:move', x), s).catch(() => {}); }
    }
    if (done) break;
    if (Date.now() - t0 > 200000) break;
    await sleep(350);
  }
  await sleep(1500);
  const bBefore = { A: await readView(A), B: await readView(B) };
  log('结算态：A.screen=' + bBefore.A.screen + '/' + bBefore.A.phase + ' B.screen=' + bBefore.B.screen + '/' + bBefore.B.phase);

  // 房主 A 点「回到房间」（分支按钮文案「🏠 回到房间」；主检出为「🏠 返回房间」——两种都试）
  const backSel = '.overlay-card button:has-text("回到房间"), .overlay-card button:has-text("返回房间")';
  await A.click(backSel, { timeout: 8000 });
  await sleep(2500);
  const bAfter = { A: await readView(A), B: await readView(B) };
  // 判定：B 是否被拽走（主检出缺陷 = B 也被拉到 room/prepare）
  const bDragged = bAfter.B.screen === 'room';
  out.tests.B = {
    desc: '房主 A 点回房 ⇒ B 视图是否被联动拽走',
    before: bBefore, after: bAfter,
    bDragged, aAfterScreen: bAfter.A.screen, aWaiting: bAfter.A.waiting,
    verdict: bDragged ? 'REPRODUCED（他人被联动拽回）' : 'FIXED/OK（他人视图不受影响）',
  };
  log('B 结果：' + out.tests.B.verdict + ' | B.after=' + bAfter.B.screen + '/' + bAfter.B.phase + ' A.after=' + bAfter.A.screen + '/' + bAfter.A.phase + ' waiting=' + bAfter.A.waiting);

  // B 也回房 ⇒ 应重置 prepare
  if (bAfter.B.screen === 'game') {
    await B.click(backSel, { timeout: 8000 }).catch(() => {});
    await sleep(2500);
  }
  const bFinal = { A: await readView(A), B: await readView(B) };
  out.tests.B_final = { desc: '双方都回房 ⇒ 是否重置 prepare', A: bFinal.A, B: bFinal.B, bothPrepare: bFinal.A.phase === 'prepare' && bFinal.B.phase === 'prepare' };
  log('B-final：A=' + bFinal.A.screen + '/' + bFinal.A.phase + ' B=' + bFinal.B.screen + '/' + bFinal.B.phase);

  out.pageErrors = errs.filter((e) => !e.includes('AudioContext') && !e.includes('WebAudio'));
  const f = join(OUT_DIR, 'r1-21-review-' + LABEL + '.json');
  writeFileSync(f, JSON.stringify(out, null, 2), 'utf8');
  log('证据：' + f);
  await browser.close(); server.kill();
  process.exit(0);
}
main().catch((e) => { console.error('R1-21 REVIEW CRASH:', e); cleanup(); process.exit(1); });
