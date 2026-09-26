// R1-F3 全灭结算补测 · 客户端端到端（真实服务器 + 真实 Chromium + 真实对局）
//
// 目的：用**可控方式**触发一次真实团灭，验证**结算行为**：
//   ① 全灭后 win.kind 是否为 'defeat'（贴原始值）
//   ② 结算界面是否如实呈现失败（弹窗标题/理由、冒险卡片内容）
//   ③ 是否有残留覆盖层挡住点击（F4 判据）
//   ④ 全灭后能否正常回到房间（不卡死）
//
// 触发方式（为什么选它）：
//   单人局选**法师**（hitDie=6，全职业最低血量）→ 进入战斗后**只结束回合、绝不攻击**
//   → 怪物每回合攻击玩家 → 玩家被打到 0 HP 即「倒地」；单人局唯一玩家倒地 ⇒ 服务端 `_checkTpk`
//   立即判 defeat（见引擎层补测 C1）。**全程无 AI、无真人操作、可重复**。
//   手动模式（room.mode='manual'）无回合看门狗，节奏完全由脚本 `game:endturn` 驱动，最可控。
//
// 端口：默认 3100（**不占 3000**）。
// 输出：<F3_OUT_DIR>/r1-f3-e2e-tpk.json
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const PORT = Number(process.env.F3_PORT || 3100);
const SEED = process.env.F3_SEED || '9';
const appRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = process.env.F3_OUT_DIR || join(appRoot, 'docs', 'qa', 'restart-sprint1', 'r1-f3-evidence');
mkdirSync(OUT_DIR, { recursive: true });
const log = (...a) => console.log('[f3-e2e]', ...a);

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

// 页面内：把「最接近某怪物的可走格」作为目标，返回从当前位置出发的第一步（BFS 绕过墙）
const nextStepTowardFoe = () => {
  const gv = window.__e2e.view().game;
  const me = gv.entities.find((e) => e.eid === gv.me.eid);
  const BLOCK = '#TD~';
  const W = gv.map.w, H = gv.map.h;
  const walk = (x, y) => { if (x < 0 || y < 0 || x >= W || y >= H) return false; const ch = gv.map.tiles[y][x]; return ch !== undefined && !BLOCK.includes(ch); };
  const foes = gv.entities.filter((e) => e.kind === 'monster' && !e.dead);
  if (!foes.length) return null;
  const q = [[me.x, me.y]];
  const prev = new Map();
  const seen = new Set([me.x + ',' + me.y]);
  let best = null, bestD = Infinity;
  while (q.length) {
    const [x, y] = q.shift();
    for (const f of foes) { const d = Math.abs(x - f.x) + Math.abs(y - f.y); if (d < bestD) { bestD = d; best = [x, y]; } }
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (!walk(nx, ny)) continue;
      const k = nx + ',' + ny;
      if (seen.has(k)) continue;
      seen.add(k); prev.set(k, [x, y]); q.push([nx, ny]);
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
    turn: gv.turn ? { kind: gv.turn.kind, playerId: gv.turn.playerId } : null,
    chapter: gv.chapter ? gv.chapter.id : null,
    me: me ? { x: me.x, y: me.y, hp: me.hp, maxHp: me.maxHp, downed: !!me.downed, dead: !!me.dead } : null,
    logTail: (gv.log || []).slice(-8).map((l) => l.text),
  };
};

const results = [];
const check = (name, ok, detail) => { results.push({ name, ok: !!ok, detail: detail || '' }); log((ok ? '✅ ' : '❌ ') + name + ' | ' + detail); };

async function main() {
  await sleep(1500);
  // 端口守卫：若本机已有服务占用该端口，本探针会连到「别人的服务器」⇒ 结果不可信。必须硬失败。
  if (addrInUse) throw new Error('端口 ' + PORT + ' 已被占用（EADDRINUSE）——请换空闲端口重跑（本探针必须连自己启动的服务器）');
  browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

  await page.goto('http://localhost:' + PORT + '/');
  await page.waitForSelector('.lobby-title');
  await page.waitForSelector('.dialog-overlay .auth-input', { timeout: 20000 });
  await page.click('.dialog-overlay .seg-btn:has-text("注册")');
  await page.fill('.dialog-overlay input[placeholder*="用户名"]', 'F3甲' + (Date.now() % 100000));
  await page.fill('.dialog-overlay input[type="password"]', 'f3pass1');
  await page.click('.dialog-overlay .btn.gold');
  await page.waitForSelector('.dialog-overlay', { state: 'detached', timeout: 12000 });
  log('登录完成');

  // 建房（手动战斗）
  await page.click('.persona-grid .persona-card:nth-child(1)');
  await page.click('.create-box .btn.gold');
  await page.waitForSelector('.room-code');
  await page.click('.seg-btn:has-text("手动战斗")');
  await page.waitForTimeout(400);
  log('房间已创建（手动战斗）');

  // 车卡：人类 + 法师（最低血量，最快被打倒）
  await page.fill('input[placeholder="为你的角色起个名字"]', 'F3法师');
  await page.locator('.opt-grid:not(.cols3) .opt-card').first().click();          // 种族：人类
  await page.locator('.opt-grid.cols3 .opt-card').nth(1).click();                // 职业：法师
  await page.waitForTimeout(400);
  await page.click('button:has-text("保存车卡")');
  await page.waitForTimeout(700);
  await page.click('button:has-text("准备就绪")');
  const startBtn = page.locator('button:has-text("立即开始")').first();
  await startBtn.waitFor({ timeout: 10000 });
  await startBtn.click();
  await page.waitForSelector('.screen-game', { timeout: 30000 });
  log('对局开始（单人 / 法师 / 手动）');
  await page.waitForTimeout(1200);

  // 关闭自动游玩（确保只有脚本驱动）
  await page.evaluate(() => { if (window.__e2e && window.__e2e.setAutoplay) window.__e2e.setAutoplay(false); });
  // 关闭开场覆盖层
  const introBtn = page.locator('.overlay-card button:has-text("开始冒险"), .overlay-card button:has-text("聆听命运")');
  if (await introBtn.count()) { await introBtn.first().click().catch(() => {}); }
  await page.waitForTimeout(500);
  await page.bringToFront();

  const startState = await page.evaluate(readState);
  log('开局状态=' + JSON.stringify({ chapter: startState.chapter, me: startState.me, combat: startState.combat }));

  // ================= 驱动：走向怪物 → 只结束回合（不攻击）→ 被打倒 =================
  let defeated = false;
  let ended = false;
  let steps = 0, endturns = 0;
  const t0 = Date.now();
  for (let i = 0; i < 400 && !defeated; i++) {
    const st = await page.evaluate(readState);
    if (st.win) { defeated = true; break; }
    if (st.state !== 'playing') { ended = true; break; }
    if (Date.now() - t0 > 180000) break; // 3 分钟硬上限
    if (st.combat) {
      await page.evaluate(() => window.__S.net.send('game:endturn'));
      endturns++;
    } else {
      const step = await page.evaluate(nextStepTowardFoe);
      if (step) { await page.evaluate((s) => window.__S.net.send('game:move', s), step); steps++; }
    }
    await page.waitForTimeout(350);
  }
  const driveMs = Date.now() - t0;
  const finalState = await page.evaluate(readState);
  log('驱动结束：win=' + JSON.stringify(finalState.win) + ' steps=' + steps + ' endturns=' + endturns + ' 用时=' + driveMs + 'ms');

  // ================= 断言 ①：win.kind === 'defeat' =================
  const win = finalState.win;
  check('① 全灭后 win.kind === "defeat"（贴原始值）', win && win.kind === 'defeat', 'win=' + JSON.stringify(win));

  // ================= 断言 ②：结算界面如实呈现失败 =================
  const settle = await page.evaluate(() => {
    const ovs = [...document.querySelectorAll('.overlay-screen')];
    const ov = ovs[0] || null;
    const card = ov ? ov.querySelector('.overlay-card') : null;
    const h2 = card ? card.querySelector('h2') : null;
    const ovText = card ? card.querySelector('.ov-text') : null;
    const acTitle = card ? card.querySelector('.ac-title') : null;
    const acLines = card ? [...card.querySelectorAll('.ac-line')].map((n) => n.textContent) : [];
    const btns = card ? [...card.querySelectorAll('button')].map((b) => b.textContent.trim()) : [];
    return {
      overlayCount: ovs.length,
      title: h2 ? h2.textContent.trim() : null,
      reason: ovText ? ovText.textContent.trim() : null,
      acTitle: acTitle ? acTitle.textContent.trim() : null,
      acLines,
      buttons: btns,
    };
  });
  log('结算界面=' + JSON.stringify(settle));
  check('②-标题 结算标题为「💀 冒险失败」', settle.title === '💀 冒险失败', 'title=' + JSON.stringify(settle.title));
  check('②-理由 结算理由为服务端 defeat reason', !!settle.reason && settle.reason === (win && win.reason), 'reason=' + JSON.stringify(settle.reason));
  check('②-卡片 冒险卡片含「折戟沉沙」失败结局', settle.acLines.some((l) => l.includes('折戟沉沙')), 'acLines=' + JSON.stringify(settle.acLines));

  // ================= 断言 ③：残留覆盖层挡住点击（F4 判据） =================
  const f4 = await page.evaluate(() => {
    const ovs = [...document.querySelectorAll('.overlay-screen')];
    const dialogs = [...document.querySelectorAll('.dialog-overlay')];
    const backBtn = [...document.querySelectorAll('.overlay-card button')].find((b) => b.textContent.includes('返回房间'));
    let clickable = null;
    if (backBtn) {
      const r = backBtn.getBoundingClientRect();
      const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      clickable = { topIsButton: top === backBtn || backBtn.contains(top), topEl: top ? top.tagName + (top.className ? '.' + String(top.className).split(' ')[0] : '') : null };
    }
    return { overlayScreenCount: ovs.length, dialogOverlayCount: dialogs.length, backBtnClickable: clickable };
  });
  log('F4 覆盖层检查=' + JSON.stringify(f4));
  check('③-无残留 结算时仅 1 个 .overlay-screen、0 个 .dialog-overlay', f4.overlayScreenCount === 1 && f4.dialogOverlayCount === 0, 'overlayScreen=' + f4.overlayScreenCount + ' dialogOverlay=' + f4.dialogOverlayCount);
  check('③-可点击 「返回房间」按钮位于最上层（未被覆盖层挡住）', !!(f4.backBtnClickable && f4.backBtnClickable.topIsButton), JSON.stringify(f4.backBtnClickable));

  // ================= 断言 ④：全灭后能正常回到房间（不卡死） =================
  let returnOk = false, returnDetail = '';
  try {
    await page.click('.overlay-card button:has-text("返回房间")', { timeout: 5000 });
    await page.waitForTimeout(2500);
    const after = await page.evaluate(() => ({
      gameGone: !document.querySelector('.screen-game'),
      overlayGone: document.querySelectorAll('.overlay-screen').length === 0,
      screens: [...document.querySelectorAll('[class*="screen-"]')].map((n) => String(n.className).split(' ').find((c) => c.startsWith('screen-'))).filter(Boolean),
      hasRoomCode: !!document.querySelector('.room-code'),
    }));
    returnOk = (after.gameGone || after.screens.includes('screen-room') || after.screens.includes('screen-lobby'));
    returnDetail = JSON.stringify(after);
    log('返回后=' + returnDetail);
  } catch (e) {
    returnDetail = 'click 失败：' + e.message;
  }
  check('④ 全灭后点「返回房间」能离开结算、不卡死', returnOk, returnDetail);

  // ================= 页面错误冒烟 =================
  const realErrors = errors.filter((e) => !e.includes('AudioContext') && !e.includes('WebAudio'));
  check('页面无新增错误（忽略无音频设备）', realErrors.length === 0, '错误数=' + realErrors.length + (realErrors.length ? '：' + realErrors.slice(0, 3).join(' | ') : ''));

  const passed = results.filter((r) => r.ok).length;
  const payload = {
    runAt: new Date().toISOString(),
    test: 'R1-F3 全灭结算补测（单人 / 法师 / 手动模式）',
    port: PORT, seed: SEED, driveMs, steps, endturns,
    startState, finalState,
    settle, f4,
    results,
    total: results.length, passed,
    pageErrors: realErrors,
  };
  const outFile = join(OUT_DIR, 'r1-f3-e2e-tpk.json');
  writeFileSync(outFile, JSON.stringify(payload, null, 2), 'utf8');
  log('');
  log('R1-F3 E2E：' + passed + '/' + results.length + ' 通过');
  log('证据：' + outFile);
  await browser.close();
  server.kill();
  process.exit(passed === results.length ? 0 : 1);
}
main().catch((e) => { console.error('R1-F3 CRASH:', e); cleanup(); process.exit(1); });
