// R1-20 回合制修复 —— 端到端行为探针（2 人局，真实服务端）
//
// 覆盖：手动角色未结束回合时下一角色等待 / 手动玩家不再被看门狗跳过 / 自动角色仍正常 /
//       离线玩家仍被 2500ms 跳过 / 等待状态可见 / 顺序稳定性。
// 端口默认 3100（绝不占 3000）。用完即停。
// 说明：本探针在客户端运行时把 __S.pid 补成 view().game.me.pid（中和 R1-23「重连丢身份」干扰）。
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const PORT = Number(process.env.R120_PORT || 3100);
const SEED = Number(process.env.R120_SEED || 20240602);
const appRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const outDir = process.env.R120_OUT || join(appRoot, 'docs', 'qa', 'restart-sprint1', 'r1-20-turn-order-' + stamp);
mkdirSync(outDir, { recursive: true });
const transcript = [];
const log = (...a) => { const line = '[r1-20] ' + a.join(' '); transcript.push(line); console.log(line); };

const server = spawn(process.execPath, ['server/index.mjs'], {
  cwd: appRoot,
  env: { ...process.env, DND_PORT: String(PORT), DND_SEED: String(SEED), DND_OFFLINE: '1' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
server.stdout.on('data', (d) => transcript.push('[srv] ' + String(d).trim()));
server.stderr.on('data', (d) => transcript.push('[srv-err] ' + String(d).trim()));
let browser = null;
function cleanup() { try { server.kill(); } catch (e) {} try { browser && browser.close(); } catch (e) {} }
process.on('exit', cleanup);
process.on('SIGINT', () => { cleanup(); process.exit(1); });
process.on('SIGTERM', () => { cleanup(); process.exit(1); });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = {};

// ---------- 页面辅助 ----------
async function register(page, name) {
  await page.waitForSelector('.lobby-title', { timeout: 25000 });
  await page.waitForSelector('.dialog-overlay .auth-input', { timeout: 20000 });
  await page.click('.dialog-overlay .seg-btn:has-text("注册")');
  await page.fill('.dialog-overlay input[placeholder*="用户名"]', name);
  await page.fill('.dialog-overlay input[type="password"]', 'sim1234');
  await page.click('.dialog-overlay .btn.gold');
  await page.waitForSelector('.dialog-overlay', { state: 'detached', timeout: 12000 });
}

async function pickSheetAndSave(page, name) {
  await page.fill('input[placeholder="为你的角色起个名字"]', name);
  await page.locator('.opt-grid').nth(0).locator('.opt-card').first().click();
  await page.locator('.opt-grid').nth(1).locator('.opt-card').first().click();
  await sleep(400);
  await page.click('button:has-text("保存车卡")');
  await sleep(700);
}

async function ready(page) {
  await page.waitForSelector('button:has-text("准备就绪")');
  await page.click('button:has-text("准备就绪")');
}

async function dismissIntro(page) {
  const intro = page.locator('.overlay-card button:has-text("开始冒险")');
  for (let i = 0; i < 10; i++) {
    if (await intro.count()) { try { await intro.first().click(); } catch (e) {} return true; }
    await sleep(500);
  }
  return false;
}

// 中和 R1-23 干扰：重连路径下 store.pid 可能为 null，补成服务端下发的真实身份
async function neutralizePid(page) {
  return page.evaluate(() => {
    const gv = window.__e2e && window.__e2e.view && window.__e2e.view() && window.__e2e.view().game;
    const mePid = gv && gv.me && gv.me.pid;
    if (window.__S && mePid && window.__S.pid !== mePid) { const before = window.__S.pid; window.__S.pid = mePid; return { patched: true, before, after: mePid }; }
    return { patched: false, pid: window.__S && window.__S.pid, mePid };
  });
}

const snapshotOf = (page) => page.evaluate(() => {
  const gv = window.__e2e.view().game;
  const me = gv.entities.find((e) => e.eid === gv.me.eid);
  const waitEl = document.querySelector('.gt-wait');
  return {
    pid: gv.me.pid, state: gv.state, win: gv.win,
    mode: gv.mode, meManual: gv.me.manual,
    turn: gv.turn ? { playerId: gv.turn.playerId, kind: gv.turn.kind, actorEid: gv.turn.actorEid } : null,
    me: me ? { x: me.x, y: me.y } : null,
    autoplay: window.__e2e.debug().autoplay,
    lastAction: window.__e2e.debug().lastAction,
    waitText: waitEl ? waitEl.textContent : null,
    waitVisible: waitEl ? getComputedStyle(waitEl).display !== 'none' && !!waitEl.textContent : false,
    skipLogs: (gv.log || []).map((l) => l.text).filter((t) => t.includes('回合自动跳过')),
    turnLogs: (gv.log || []).map((l) => l.text).filter((t) => t.includes('的回合')),
  };
});

async function waitFor(page, fn, timeoutMs, stepMs = 400) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const v = await fn();
    if (v) return { ok: true, value: v, waitedMs: Date.now() - t0 };
    await sleep(stepMs);
  }
  return { ok: false, waitedMs: Date.now() - t0 };
}

// ---------- 主流程 ----------
async function main() {
  await sleep(1500);
  browser = await chromium.launch();
  const ctxA = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const ctxB = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const pageA = await ctxA.newPage();
  const pageB = await ctxB.newPage();
  const errors = [];
  pageA.on('pageerror', (e) => errors.push('A:' + e.message));
  pageB.on('pageerror', (e) => errors.push('B:' + e.message));

  // ---- 建房：A 创建（自动房间），B 加入 ----
  await pageA.goto('http://localhost:' + PORT + '/');
  await register(pageA, '甲玩家');
  await pageA.click('.persona-grid .persona-card:nth-child(2)');
  await pageA.click('.create-box .btn.gold');
  await pageA.waitForSelector('.room-code');
  const code = (await pageA.locator('.room-code').first().textContent()).replace(/[^A-Z0-9]/gi, '');
  log('房间码=' + code);

  await pageB.goto('http://localhost:' + PORT + '/');
  await register(pageB, '乙玩家');
  await pageB.fill('input[placeholder="房间码，如 AB3CD"]', code);
  await pageB.click('button:has-text("加入房间")');
  await pageB.waitForSelector('.room-code', { timeout: 15000 });
  log('B 已加入房间');

  // ---- 车卡 + 准备（B 先就绪，A 后就绪触发开局）----
  await pickSheetAndSave(pageB, '乙角色');
  await ready(pageB);
  await pickSheetAndSave(pageA, '甲角色');
  await ready(pageA);

  await pageA.waitForSelector('.screen-game', { timeout: 40000 });
  await pageB.waitForSelector('.screen-game', { timeout: 40000 });
  await sleep(1500);
  await dismissIntro(pageA);
  await dismissIntro(pageB);
  await sleep(1200);

  // 中和 R1-23 干扰
  results.pidNeutralize = { A: await neutralizePid(pageA), B: await neutralizePid(pageB) };
  log('中和 R1-23：A=' + JSON.stringify(results.pidNeutralize.A) + ' B=' + JSON.stringify(results.pidNeutralize.B));

  const a0 = await snapshotOf(pageA);
  const b0 = await snapshotOf(pageB);
  const pidA = a0.pid, pidB = b0.pid;
  log('进入冒险 A.pid=' + pidA + ' B.pid=' + pidB + ' mode=' + a0.mode);

  // ============ S1：手动 A 未结束回合 → 下一角色一直等待 ============
  // 等 A 的回合（首位）
  await waitFor(pageA, async () => { const s = await snapshotOf(pageA); return s.turn && s.turn.playerId === pidA; }, 15000);
  // A 切手动（点击真实按钮）
  await pageA.click('button:has-text("自动")');
  await sleep(1200);
  const aManual = await snapshotOf(pageA);
  results.s1_manualSet = { meManual: aManual.meManual, autoplay: aManual.autoplay, turn: aManual.turn };
  log('S1 A 已切手动：me.manual=' + aManual.meManual + ' autoplay=' + aManual.autoplay + ' turn=' + JSON.stringify(aManual.turn));

  const s1Start = { A: await snapshotOf(pageA), B: await snapshotOf(pageB) };
  const t0 = Date.now();
  await sleep(11000); // 远超旧实现的 8 秒阈值
  const s1End = { A: await snapshotOf(pageA), B: await snapshotOf(pageB) };
  const skippedA = s1End.A.skipLogs.some((t) => t.includes('甲角色'));
  results.s1 = {
    waitedMs: Date.now() - t0,
    turnAtStart: s1Start.A.turn, turnAfter11s: s1End.A.turn,
    turnStillA: !!s1End.A.turn && s1End.A.turn.playerId === pidA,
    aMoved: s1Start.A.me && s1End.A.me && (s1Start.A.me.x !== s1End.A.me.x || s1Start.A.me.y !== s1End.A.me.y),
    bMoved: s1Start.B.me && s1End.B.me && (s1Start.B.me.x !== s1End.B.me.x || s1Start.B.me.y !== s1End.B.me.y),
    aSkippedByWatchdog: skippedA,
    skipLogsA: s1End.A.skipLogs,
    bWaitText: s1End.B.waitText, bWaitVisible: s1End.B.waitVisible,
    bTurn: s1End.B.turn,
  };
  log('S1 结果：turnStillA=' + results.s1.turnStillA + ' aMoved=' + results.s1.aMoved + ' bMoved=' + results.s1.bMoved
    + ' aSkipped=' + results.s1.aSkippedByWatchdog + ' B等待文案="' + results.s1.bWaitText + '"');

  // A 结束回合 → 轮到 B（B 自动）→ B 应正常行动
  const posB0 = (await snapshotOf(pageB)).me;
  await pageA.evaluate(() => window.__S.net.send('game:endturn'));
  const bTurn = await waitFor(pageB, async () => { const s = await snapshotOf(pageB); return s.turn && s.turn.playerId === pidB; }, 12000);
  const bAct = await waitFor(pageB, async () => {
    const s = await snapshotOf(pageB);
    return s.me && posB0 && (s.me.x !== posB0.x || s.me.y !== posB0.y) ? s : null;
  }, 10000);
  results.s1_afterAEnd = {
    bGotTurn: bTurn.ok, bTurnWaitedMs: bTurn.waitedMs,
    bActed: bAct.ok, bActWaitedMs: bAct.waitedMs,
    bSnapshot: await snapshotOf(pageB),
  };
  log('S1 后续：B 拿到回合=' + bTurn.ok + ' B 自动行动=' + bAct.ok);

  // ============ S2：A 恢复自动 → 轮到时正常行动 ============
  await pageA.click('button:has-text("自动")'); // 切回自动
  await sleep(1000);
  const aAuto = await snapshotOf(pageA);
  results.s2_autoSet = { meManual: aAuto.meManual, autoplay: aAuto.autoplay };
  const posA0 = aAuto.me;
  const aAct = await waitFor(pageA, async () => {
    const s = await snapshotOf(pageA);
    return s.me && posA0 && (s.me.x !== posA0.x || s.me.y !== posA0.y) ? s : null;
  }, 14000);
  results.s2 = {
    meManual: aAuto.meManual, autoplay: aAuto.autoplay,
    aActed: aAct.ok, aActWaitedMs: aAct.waitedMs,
    posStart: posA0, posAfter: aAct.ok ? aAct.value.me : (await snapshotOf(pageA)).me,
  };
  log('S2 结果：A me.manual=' + results.s2.meManual + ' 自动行动=' + results.s2.aActed);

  // ============ S3：离线玩家仍被 2500ms 跳过（断线防死锁）============
  // 双方都切手动；把回合交到 B，然后关闭 B 的页面
  await pageA.evaluate(() => window.__S.net.send('game:autoplay', { on: false }));
  await pageB.evaluate(() => window.__S.net.send('game:autoplay', { on: false }));
  await sleep(600);
  // 结束 A 的回合直到轮到 B
  for (let i = 0; i < 6; i++) {
    const s = await snapshotOf(pageA);
    if (s.turn && s.turn.playerId === pidB) break;
    if (s.turn && s.turn.playerId === pidA) await pageA.evaluate(() => window.__S.net.send('game:endturn'));
    await sleep(600);
  }
  const beforeOffline = await snapshotOf(pageA);
  const skipCountBefore = beforeOffline.skipLogs.length;
  log('S3 断线前：turn=' + JSON.stringify(beforeOffline.turn) + '（期望 B）');
  await pageB.close(); // 断线
  const tOff = Date.now();
  const offlineSkip = await waitFor(pageA, async () => {
    const s = await snapshotOf(pageA);
    const newSkips = s.skipLogs.slice(skipCountBefore);
    const advanced = !s.turn || s.turn.playerId !== pidB;
    return (newSkips.some((t) => t.includes('乙角色')) || advanced) ? { s, newSkips, advanced } : null;
  }, 9000, 300);
  results.s3_offline = {
    waitedMs: Date.now() - tOff,
    skipped: offlineSkip.ok,
    newSkipLogs: offlineSkip.ok ? offlineSkip.value.newSkips : [],
    turnAfter: offlineSkip.ok ? offlineSkip.value.s.turn : null,
    advancedFromB: offlineSkip.ok ? offlineSkip.value.advanced : false,
  };
  log('S3 结果：B 离线后 ' + results.s3_offline.waitedMs + 'ms 内被跳过=' + results.s3_offline.skipped
    + ' 新跳过日志=' + JSON.stringify(results.s3_offline.newSkipLogs) + ' turn=' + JSON.stringify(results.s3_offline.turnAfter));

  // ============ S4：顺序稳定性（记录实际回合序列）============
  results.s4_order = { turnLogs: (await snapshotOf(pageA)).turnLogs.slice(-12) };

  results.errors = errors;
  writeFileSync(join(outDir, 'r1-20-evidence.json'), JSON.stringify({ runAt: new Date().toISOString(), port: PORT, seed: SEED, results }, null, 2), 'utf8');
  writeFileSync(join(outDir, 'r1-20-transcript.log'), transcript.join('\n'), 'utf8');
  log('证据：' + join(outDir, 'r1-20-evidence.json'));

  await browser.close();
  server.kill();
  process.exit(0);
}

main().catch((e) => { console.error('R1-20 PROBE CRASH:', e); transcript.push('CRASH: ' + (e && e.stack || e)); try { writeFileSync(join(outDir, 'r1-20-transcript.log'), transcript.join('\n'), 'utf8'); writeFileSync(join(outDir, 'r1-20-evidence.json'), JSON.stringify({ crash: String(e && e.stack || e), results }, null, 2), 'utf8'); } catch (_) {} cleanup(); process.exit(1); });
