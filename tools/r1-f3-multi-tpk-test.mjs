// R1-F3 全灭结算补测 · 客户端端到端（多人：2 名玩家）
//
// 目的：在**真实多人局**里触发团灭，验证结算行为（win.kind=defeat / 结算界面 / 无残留覆盖层 / 可回房）。
// 触发方式：两名玩家都选**法师**（最低血量），进入战斗后**只结束回合、绝不攻击**，
//   直到两人全部倒地 ⇒ 服务端 `_checkTpk` 判 defeat（引擎层补测 C2/C3 已证「全员倒地即全灭」）。
//
// 端口：默认 3118（**不占 3000**）。输出：<F3_OUT_DIR>/r1-f3-multi-tpk.json
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const PORT = Number(process.env.F3_PORT || 3118);
const SEED = process.env.F3_SEED || '9';
const appRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = process.env.F3_OUT_DIR || join(appRoot, 'docs', 'qa', 'restart-sprint1', 'r1-f3-evidence');
mkdirSync(OUT_DIR, { recursive: true });
const log = (...a) => console.log('[f3-multi]', ...a);

const server = spawn(process.execPath, ['server/index.mjs'], {
  cwd: appRoot,
  env: { ...process.env, DND_PORT: String(PORT), DND_SEED: String(SEED), DND_OFFLINE: '1' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let addrInUse = false;
server.stderr.on('data', (d) => { const s = String(d); if (s.includes('EADDRINUSE')) addrInUse = true; process.stderr.write('[srv] ' + s); });
let browser = null;
const cleanup = () => { try { server.kill(); } catch (e) { /* ignore */ } try { browser && browser.close(); } catch (e) { /* ignore */ } };
process.on('exit', cleanup);
process.on('SIGINT', () => { cleanup(); process.exit(1); });
process.on('SIGTERM', () => { cleanup(); process.exit(1); });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const nextStepTowardFoe = () => {
  const gv = window.__e2e.view().game;
  const me = gv.entities.find((e) => e.eid === gv.me.eid);
  const BLOCK = '#TD~';
  const W = gv.map.w, H = gv.map.h;
  const walk = (x, y) => { if (x < 0 || y < 0 || x >= W || y >= H) return false; const ch = gv.map.tiles[y][x]; return ch !== undefined && !BLOCK.includes(ch); };
  const foes = gv.entities.filter((e) => e.kind === 'monster' && !e.dead);
  if (!foes.length) return null;
  const q = [[me.x, me.y]]; const prev = new Map(); const seen = new Set([me.x + ',' + me.y]);
  let best = null, bestD = Infinity;
  while (q.length) {
    const [x, y] = q.shift();
    for (const f of foes) { const d = Math.abs(x - f.x) + Math.abs(y - f.y); if (d < bestD) { bestD = d; best = [x, y]; } }
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy; if (!walk(nx, ny)) continue; const k = nx + ',' + ny;
      if (seen.has(k)) continue; seen.add(k); prev.set(k, [x, y]); q.push([nx, ny]);
    }
  }
  if (!best) return null;
  let cur = best; const path = [cur];
  while (prev.has(cur.join(','))) { cur = prev.get(cur.join(',')); path.push(cur); }
  path.reverse();
  return path[1] ? { x: path[1][0], y: path[1][1] } : null;
};
const readState = () => {
  const gv = window.__e2e.view().game;
  const me = gv.entities.find((e) => e.eid === gv.me.eid);
  return {
    state: gv.state,
    win: gv.win ? { kind: gv.win.kind, reason: gv.win.reason, duration: gv.win.duration } : null,
    combat: !!(gv.combat && gv.combat.active),
    me: me ? { x: me.x, y: me.y, hp: me.hp, downed: !!me.downed, dead: !!me.dead } : null,
    players: (gv.players || []).map((p) => ({ name: p.name, dead: !!p.dead })),
  };
};

const results = [];
const check = (name, ok, detail) => { results.push({ name, ok: !!ok, detail: detail || '' }); log((ok ? '✅ ' : '❌ ') + name + ' | ' + detail); };

async function register(page, name) {
  await page.goto('http://localhost:' + PORT + '/');
  await page.waitForSelector('.lobby-title');
  await page.waitForSelector('.dialog-overlay .auth-input', { timeout: 20000 });
  await page.click('.dialog-overlay .seg-btn:has-text("注册")');
  await page.fill('.dialog-overlay input[placeholder*="用户名"]', name);
  await page.fill('.dialog-overlay input[type="password"]', 'f3pass1');
  await page.click('.dialog-overlay .btn.gold');
  await page.waitForSelector('.dialog-overlay', { state: 'detached', timeout: 12000 });
}
async function buildWizard(page, cname) {
  await page.fill('input[placeholder="为你的角色起个名字"]', cname);
  await page.locator('.opt-grid:not(.cols3) .opt-card').first().click();
  await page.locator('.opt-grid.cols3 .opt-card').nth(1).click();
  await page.waitForTimeout(400);
  await page.click('button:has-text("保存车卡")');
  await page.waitForTimeout(600);
}

async function main() {
  await sleep(1500);
  if (addrInUse) throw new Error('端口 ' + PORT + ' 已被占用（EADDRINUSE）——请换空闲端口重跑');
  browser = await chromium.launch();
  const ctxA = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const ctxB = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const A = await ctxA.newPage();
  const B = await ctxB.newPage();
  const errors = [];
  for (const p of [A, B]) { p.on('pageerror', (e) => errors.push('pageerror: ' + e.message)); p.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); }); }

  // A 建房
  await register(A, 'F3甲' + (Date.now() % 10000));
  await A.click('.persona-grid .persona-card:nth-child(1)');
  await A.click('.create-box .btn.gold');
  await A.waitForSelector('.room-code');
  await A.click('.seg-btn:has-text("手动战斗")');
  await A.waitForTimeout(300);
  const codeRaw = (await A.locator('.room-code').textContent()) || '';
  const code = (codeRaw.match(/[A-Z0-9]{4,6}/) || [codeRaw.trim()])[0];
  log('房间码=' + code + ' (raw=' + JSON.stringify(codeRaw) + ')');

  // B 加入
  await register(B, 'F3乙' + (Date.now() % 10000));
  await B.fill('.join-box input', code);
  await B.click('.join-box button:has-text("加入房间")');
  await B.waitForSelector('.room-code', { timeout: 12000 });
  log('B 已加入房间');

  // 双方车卡（法师）
  await buildWizard(A, 'F3甲法师');
  await buildWizard(B, 'F3乙法师');
  await A.waitForTimeout(600);

  // 双方准备 —— 多人房「全部成员准备后自动开局」（room.mjs:97），无需点开始按钮
  await A.click('button:has-text("准备就绪")');
  await B.click('button:has-text("准备就绪")');
  for (const p of [A, B]) { await p.waitForSelector('.screen-game', { timeout: 30000 }); }
  await sleep(1200);
  for (const p of [A, B]) {
    await p.evaluate(() => { if (window.__e2e && window.__e2e.setAutoplay) window.__e2e.setAutoplay(false); });
    const ib = p.locator('.overlay-card button:has-text("开始冒险"), .overlay-card button:has-text("聆听命运")');
    if (await ib.count()) await ib.first().click().catch(() => {});
  }
  await sleep(600);
  log('对局开始（2 人 / 法师 / 手动）');

  // 驱动：两个玩家都「走向怪物 → 只结束回合」
  let defeated = false, steps = 0, endturns = 0;
  const t0 = Date.now();
  for (let i = 0; i < 500 && !defeated; i++) {
    for (const p of [A, B]) {
      const st = await p.evaluate(readState).catch(() => null);
      if (!st) continue;
      if (st.win) { defeated = true; break; }
      if (st.state !== 'playing') continue;
      if (st.combat) { await p.evaluate(() => window.__S.net.send('game:endturn')).catch(() => {}); endturns++; }
      else { const s = await p.evaluate(nextStepTowardFoe).catch(() => null); if (s) { await p.evaluate((x) => window.__S.net.send('game:move', x), s).catch(() => {}); steps++; } }
    }
    if (Date.now() - t0 > 240000) break;
    await sleep(350);
  }
  const driveMs = Date.now() - t0;
  const finalA = await A.evaluate(readState).catch(() => null);
  log('驱动结束：win=' + JSON.stringify(finalA && finalA.win) + ' steps=' + steps + ' endturns=' + endturns + ' 用时=' + driveMs + 'ms');

  const win = finalA && finalA.win;
  check('① 多人全灭后 win.kind === "defeat"（贴原始值）', win && win.kind === 'defeat', 'win=' + JSON.stringify(win));

  const settle = await A.evaluate(() => {
    const ovs = [...document.querySelectorAll('.overlay-screen')];
    const ov = ovs[0] || null; const card = ov ? ov.querySelector('.overlay-card') : null;
    const h2 = card ? card.querySelector('h2') : null;
    const ovText = card ? card.querySelector('.ov-text') : null;
    const acLines = card ? [...card.querySelectorAll('.ac-line')].map((n) => n.textContent) : [];
    const statRows = card ? [...card.querySelectorAll('.stat-table tr')].map((tr) => tr.textContent) : [];
    const btns = card ? [...card.querySelectorAll('button')].map((b) => b.textContent.trim()) : [];
    return { overlayCount: ovs.length, title: h2 ? h2.textContent.trim() : null, reason: ovText ? ovText.textContent.trim() : null, acLines, statRows, buttons: btns };
  });
  log('结算界面=' + JSON.stringify(settle));
  check('②-标题 结算标题为「💀 冒险失败」', settle.title === '💀 冒险失败', 'title=' + JSON.stringify(settle.title));
  check('②-理由 结算理由为服务端 defeat reason', !!settle.reason && settle.reason === (win && win.reason), 'reason=' + JSON.stringify(settle.reason));
  check('②-卡片 冒险卡片含「折戟沉沙」失败结局', settle.acLines.some((l) => l.includes('折戟沉沙')), 'acLines=' + JSON.stringify(settle.acLines));
  check('②-多人 结算表格含两名玩家', settle.statRows.length >= 2, 'statRows=' + JSON.stringify(settle.statRows));

  const f4 = await A.evaluate(() => {
    const ovs = [...document.querySelectorAll('.overlay-screen')];
    const dialogs = [...document.querySelectorAll('.dialog-overlay')];
    const backBtn = [...document.querySelectorAll('.overlay-card button')].find((b) => b.textContent.includes('返回房间'));
    let clickable = null;
    if (backBtn) { const r = backBtn.getBoundingClientRect(); const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); clickable = { topIsButton: top === backBtn || backBtn.contains(top), topEl: top ? top.tagName + (top.className ? '.' + String(top.className).split(' ')[0] : '') : null }; }
    return { overlayScreenCount: ovs.length, dialogOverlayCount: dialogs.length, backBtnClickable: clickable };
  });
  log('F4 覆盖层检查=' + JSON.stringify(f4));
  check('③-无残留 结算时仅 1 个 .overlay-screen、0 个 .dialog-overlay', f4.overlayScreenCount === 1 && f4.dialogOverlayCount === 0, 'overlayScreen=' + f4.overlayScreenCount + ' dialogOverlay=' + f4.dialogOverlayCount);
  check('③-可点击 「返回房间」按钮位于最上层', !!(f4.backBtnClickable && f4.backBtnClickable.topIsButton), JSON.stringify(f4.backBtnClickable));

  let returnOk = false, returnDetail = '';
  try {
    await A.click('.overlay-card button:has-text("返回房间")', { timeout: 5000 });
    await A.waitForTimeout(2500);
    const after = await A.evaluate(() => ({ gameGone: !document.querySelector('.screen-game'), overlayGone: document.querySelectorAll('.overlay-screen').length === 0, screens: [...document.querySelectorAll('[class*="screen-"]')].map((n) => String(n.className).split(' ').find((c) => c.startsWith('screen-'))).filter(Boolean) }));
    returnOk = after.gameGone || after.screens.includes('screen-room') || after.screens.includes('screen-lobby');
    returnDetail = JSON.stringify(after);
  } catch (e) { returnDetail = 'click 失败：' + e.message; }
  check('④ 多人全灭后点「返回房间」能离开结算、不卡死', returnOk, returnDetail);

  const realErrors = errors.filter((e) => !e.includes('AudioContext') && !e.includes('WebAudio'));
  check('页面无新增错误（忽略无音频设备）', realErrors.length === 0, '错误数=' + realErrors.length + (realErrors.length ? '：' + realErrors.slice(0, 3).join(' | ') : ''));

  const passed = results.filter((r) => r.ok).length;
  const payload = { runAt: new Date().toISOString(), test: 'R1-F3 全灭结算补测（多人 2 人 / 法师 / 手动）', port: PORT, seed: SEED, roomCode: code, driveMs, steps, endturns, finalA, settle, f4, results, total: results.length, passed, pageErrors: realErrors };
  const outFile = join(OUT_DIR, 'r1-f3-multi-tpk.json');
  writeFileSync(outFile, JSON.stringify(payload, null, 2), 'utf8');
  log('');
  log('R1-F3 多人 E2E：' + passed + '/' + results.length + ' 通过');
  log('证据：' + outFile);
  await browser.close(); server.kill();
  process.exit(passed === results.length ? 0 : 1);
}
main().catch((e) => { console.error('R1-F3-MULTI CRASH:', e); cleanup(); process.exit(1); });
