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
  // F-33：开局=冒险中状态且无战斗（出生点安全筛选+怪物游荡不主动进入玩家视野）
  const startState = await m.page.evaluate(() => {
    const gv = window.__e2e.view().game;
    return { team: gv.team?.state, combat: gv.combat?.active, ch: gv.chapter?.id };
  });
  if (startState.team === 'adventuring' && !startState.combat) ok('F-33 开局=冒险中状态且无战斗（' + startState.ch + '）');
  else fail('F-33 开局状态异常：' + JSON.stringify(startState));
  const autoGold = await m.page.locator('button:has-text("自动")').first().evaluate(el => el.classList.contains('gold'));
  if (!autoGold) ok('手动模式自动游玩未开启（按钮无高亮）');
  else fail('手动模式自动游玩被错误开启');
  const pos0 = await m.page.evaluate(() => {
    const gv = window.__e2e.view().game;
    const me = gv.entities.find(e => e.eid === gv.me.eid);
    return { x: me.x, y: me.y, turn: gv.turn?.playerId };
  });
  await sleep(16500); // F-27：旧实现在线玩家15秒自动结束回合——等待超过该阈值验证不再发生
  const pos1 = await m.page.evaluate(() => {
    const gv = window.__e2e.view().game;
    const me = gv.entities.find(e => e.eid === gv.me.eid);
    return { x: me.x, y: me.y, turn: gv.turn?.playerId };
  });
  if (pos0.x === pos1.x && pos0.y === pos1.y) ok('手动模式16.5秒后角色未自动移动（位置 ' + pos1.x + ',' + pos1.y + '）');
  else fail('手动模式角色自动移动了：(' + pos0.x + ',' + pos0.y + ')→(' + pos1.x + ',' + pos1.y + ')');
  // F-33：16.5秒原地不动，怪物不得靠近逼战（游荡限界+不进入玩家视野）
  const noForced = await m.page.evaluate(() => {
    const gv = window.__e2e.view().game;
    return !gv.combat?.active && gv.team?.state === 'adventuring';
  });
  if (noForced) ok('F-33 手动模式16.5秒未被怪物逼战（仍处于冒险中）');
  else fail('F-33 手动模式被怪物逼战');
  // F-27：玩家回合只有点击按钮确认结束后才进入下一顺位（不允许超时自动结束；战斗触发导致的回合移交除外）
  const f27 = await m.page.evaluate(() => {
    const gv = window.__e2e.view().game;
    const logs = (gv.log || []).map(l => l.text);
    const autoSkipped = logs.some(t => t.includes('回合自动跳过'));
    const myTurnStill = gv.turn?.playerId === window.__S.pid;
    const combat = gv.combat?.active;
    return { autoSkipped, myTurnStill, combat, turnKind: gv.turn?.kind };
  });
  if (!f27.autoSkipped && (f27.myTurnStill || f27.combat)) ok('F-27 手动模式玩家回合未被超时自动结束（无「回合自动跳过」日志）');
  else fail('F-27 手动模式回合被自动结束：' + JSON.stringify(f27));
  // 16.5s等待期间可能触发视野遭遇：手动模式怪物回合需确认推进，清到回到自己回合再测门控
  await m.page.evaluate(async () => {
    const gv = () => window.__e2e.view().game;
    const net = window.__S.net;
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    for (let i = 0; i < 10; i++) {
      const g = gv();
      if (g.turn?.kind === 'monster') net.send('game:endturn');
      else if (g.turn?.playerId === window.__S.pid) break;
      await sleep(450);
    }
  });
  // F-28：手动模式不展示快捷键提示文字
  const hintHidden = await m.page.locator('.game-hint').evaluate(el => getComputedStyle(el).display === 'none');
  if (hintHidden) ok('F-28 手动模式快捷键提示文字已隐藏');
  else fail('F-28 手动模式快捷键提示文字未隐藏');
  // 严格回合制：怪物回合必须等待玩家确认推进（改用视野察觉触发战斗，避免玩家攻击秒杀怪物导致无敌方回合）
  const gate = await m.page.evaluate(async () => {
    const gv = () => window.__e2e.view().game;
    const net = window.__S.net;
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    // 靠近怪物但不攻击：由怪物视野察觉（察觉vs潜行判定）触发战斗，怪物得以存活
    for (let i = 0; i < 30; i++) {
      const g = gv();
      const me = g.entities.find(e => e.eid === g.me.eid);
      const f = g.entities.find(e => e.kind === 'monster' && !e.dead);
      if (!f) break;
      if (g.combat?.active) break;
      const d = Math.abs(me.x - f.x) + Math.abs(me.y - f.y);
      if (d > 1) {
        const step = { x: me.x, y: me.y };
        if (me.x < f.x) step.x++; else if (me.x > f.x) step.x--;
        else if (me.y < f.y) step.y++; else step.y--;
        net.send('game:move', step);
      }
      await sleep(400);
    }
    for (let i = 0; i < 20; i++) {
      if (gv().combat?.active) break;
      await sleep(700);
    }
    if (!gv().combat?.active) return { error: '视野察觉未触发战斗', combat: gv().combat };
    // 结束自己回合直到轮到怪物
    for (let i = 0; i < 8; i++) {
      const g3 = gv();
      if (g3.turn?.kind === 'monster') break;
      net.send('game:endturn');
      await sleep(500);
    }
    const g4 = gv();
    if (g4.turn?.kind !== 'monster') return { error: '未到达怪物回合', turn: g4.turn };
    const mon = g4.entities.find(e => e.eid === g4.turn.actorEid);
    const before = { x: mon.x, y: mon.y, logLen: g4.log.length };
    await sleep(2500); // 等待：怪物不得自动行动
    const g5 = gv();
    const mon2 = g5.entities.find(e => e.eid === g5.turn.actorEid);
    const during = { x: mon2.x, y: mon2.y, logLen: g5.log.length, stillMonsterTurn: g5.turn?.kind === 'monster' };
    net.send('game:endturn'); // 玩家确认推进
    await sleep(600);
    const g6 = gv();
    return { before, during, afterKind: g6.turn ? g6.turn.kind : null, logGrew: g6.log.length > during.logLen };
  });
  if (gate.error) fail('怪物回合测试失败：' + gate.error);
  else {
    if (gate.during.stillMonsterTurn && gate.during.x === gate.before.x && gate.during.y === gate.before.y && gate.during.logLen === gate.before.logLen) {
      ok('手动模式怪物回合等待确认（2.5秒未自动行动，位置/日志未变）');
    } else fail('怪物回合未等待确认：' + JSON.stringify(gate));
    if (gate.logGrew || gate.afterKind !== 'monster') ok('确认推进后怪物完成行动（日志+' + (gate.logGrew ? '有新增' : '0') + '，回合移交 ' + gate.afterKind + '）');
    else fail('推进后怪物未行动：' + JSON.stringify(gate));
  }
  await m.ctx.close();
  // 自动模式
  const a = await enterGame('auto');
  const badge2 = await a.page.locator('.badge').first().textContent();
  if (badge2.includes('自动')) ok('自动模式徽章正确：' + badge2.trim());
  else fail('自动模式徽章错误：' + badge2);
  const hintVisibleAuto = await a.page.locator('.game-hint').evaluate(el => getComputedStyle(el).display !== 'none');
  if (hintVisibleAuto) ok('F-28 自动模式快捷键提示正常展示');
  else fail('F-28 自动模式快捷键提示被隐藏');
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
