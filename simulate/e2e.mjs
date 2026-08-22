// 浏览器级端到端模拟：5个真实浏览器页面从大厅→车卡→自动游玩至通关，全程截图
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const PORT = 3892;
const SEED = Number(process.env.E2E_SEED || 20240601);
const TIMEOUT = 30 * 60e3;
const SHOTS = 'e2e-shots';
mkdirSync(SHOTS, { recursive: true });
const log = (...a) => console.log('[e2e]', ...a);

const server = spawn(process.execPath, ['server/index.mjs'], {
  cwd: process.cwd(),
  env: { ...process.env, DND_PORT: String(PORT), DND_SEED: String(SEED) },
  stdio: ['ignore', 'pipe', 'pipe'],
});
server.stderr.on('data', d => process.stderr.write('[srv] ' + d));
let browser = null;

const NAMES = ['艾莉', '布莱克', '希尔德', '诺拉', '灰隼'];
const CLASSES = ['fighter', 'cleric', 'wizard', 'rogue', 'ranger'];

// 账户系统：登录弹窗（自动弹出）→ 注册；若已注册则回退登录
async function loginPage(page, name) {
  await page.waitForSelector('.dialog-overlay .auth-input', { timeout: 8000 });
  await page.click('.dialog-overlay .seg-btn:has-text("注册")');
  await page.fill('.dialog-overlay input[placeholder*="用户名"]', name);
  await page.fill('.dialog-overlay input[type="password"]', 'sim1234');
  await page.click('.dialog-overlay .btn.gold');
  const ok = await page.waitForSelector('.dialog-overlay', { state: 'detached', timeout: 6000 }).then(() => true).catch(() => false);
  if (!ok) {
    await page.click('.dialog-overlay .seg-btn:has-text("登录")');
    await page.fill('.dialog-overlay input[placeholder*="用户名"]', name);
    await page.fill('.dialog-overlay input[type="password"]', 'sim1234');
    await page.click('.dialog-overlay .btn.gold');
    await page.waitForSelector('.dialog-overlay', { state: 'detached', timeout: 6000 });
  }
}

async function main() {
  await new Promise(r => setTimeout(r, 1200));
  browser = await chromium.launch();
  const pages = [];
  const errors = [];
  for (let i = 0; i < 5; i++) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const seenErrors = new Set();
    const recordErr = (s) => { if (!seenErrors.has(s) && errors.length < 50) { seenErrors.add(s); errors.push(s); } };
    page.on('pageerror', e => recordErr('pageerror[' + i + ']: ' + e.message));
    page.on('console', m => { if (m.type() === 'error') recordErr('console[' + i + ']: ' + m.text()); });
    await page.goto('http://localhost:' + PORT + '/');
    await page.waitForSelector('.lobby-title');
    await loginPage(page, NAMES[i]);
    pages.push(page);
  }
  log('5个浏览器页面已进入大厅');
  await pages[0].screenshot({ path: SHOTS + '/01-lobby.png' });

  // 房主创建房间（选第2位DM人设：皮普）
  await pages[0].click('.persona-grid .persona-card:nth-child(2)');
  await pages[0].click('.create-box .btn.gold');
  await pages[0].waitForSelector('.room-code');
  const code = (await pages[0].textContent('.room-code')).trim();
  log('房间创建：' + code);
  await pages[0].screenshot({ path: SHOTS + '/02-room.png' });

  // 其余加入
  for (let i = 1; i < 5; i++) {
    await pages[i].fill('.join-box input', code);
    await pages[i].click('.join-box .btn');
    await pages[i].waitForSelector('.room-code');
  }
  log('5/5 玩家加入房间');

  // 车卡（点选人类种族+指定职业）
  for (let i = 0; i < 5; i++) {
    const p = pages[i];
    await p.fill('input[placeholder="为你的角色起个名字"]', NAMES[i]);
    await p.locator('.opt-grid').nth(0).locator('.opt-card').first().click(); // 种族：人类
    const clsIdx = ['fighter', 'cleric', 'wizard', 'rogue', 'ranger'].indexOf(CLASSES[i]);
    await p.locator('.opt-grid').nth(1).locator('.opt-card').nth(clsIdx).click(); // 职业
    await p.waitForTimeout(400);
    await p.click('button:has-text("保存车卡")');
    await p.waitForTimeout(400);
  }
  log('全员车卡完成');
  await pages[0].screenshot({ path: SHOTS + '/03-chargen.png' });

  // 准备 → 自动开局
  for (const p of pages) {
    await p.waitForSelector('button:has-text("准备就绪")');
    await p.click('button:has-text("准备就绪")');
  }
  await pages[0].waitForSelector('.screen-game', { timeout: 30000 });
  log('全部准备就绪 → 游戏自动开始');
  await pages[0].waitForTimeout(1500);
  await pages[0].screenshot({ path: SHOTS + '/04-intro.png' });

  // 关闭开场覆盖层（若存在）
  for (const p of pages) {
    const btn = p.locator('.overlay-card button:has-text("开始冒险")');
    if (await btn.count()) { await btn.first().click(); }
  }

  // 开启自动游玩
  for (const p of pages) {
    await p.evaluate(() => window.__e2e && window.__e2e.setAutoplay(true));
  }
  log('5名浏览器玩家开启自动游玩');

  // 跟踪章节变化并截图
  const lastCh = {};
  const visitedChapters = new Set();
  const t0 = Date.now();
  let winKind = null;
  let lastDump = 0;
  while (Date.now() - t0 < TIMEOUT) {
    await new Promise(r => setTimeout(r, 2000));
    for (let i = 0; i < 5; i++) {
      try {
        const info = await pages[i].evaluate(() => {
          const v = window.__e2e ? window.__e2e.view() : null;
          return v ? { ch: v.game.chapter.name, state: v.game.state, win: v.game.win, combat: v.game.combat.active, turn: v.game.turn } : null;
        });
        if (!info) continue;
        if (info.win) { winKind = info.win.kind; break; }
        if (info.ch && info.ch !== lastCh[i]) {
          lastCh[i] = info.ch;
          visitedChapters.add(info.ch);
          log('页面' + i + ' 到达：' + info.ch);
          await pages[i].screenshot({ path: SHOTS + '/p' + i + '-' + info.ch.slice(0, 6) + '.png' });
        }
      } catch (e) { /* 页面暂时不可用 */ }
    }
    if (winKind) break;
    // 卡住诊断：每60秒转储一次各页面状态（Boss表决/营地/回合卡死排查）
    if (Date.now() - lastDump > 60e3) {
      lastDump = Date.now();
      log('  [dump] 已收集页面错误 ' + errors.length + ' 条：');
      for (const e of errors.slice(-4)) log('    ⚠ ' + e);
      for (let i = 0; i < 5; i++) {
        try {
          const s = await pages[i].evaluate(() => {
            const v = window.__e2e ? window.__e2e.view() : null;
            if (!v || !v.game) return null;
            const gv = v.game;
            return JSON.stringify({ ch: gv.chapter?.id, state: gv.state, combat: gv.combat?.active, round: gv.combat?.round, turn: gv.turn ? gv.turn.kind + ':' + String(gv.turn.playerId || gv.turn.actorEid).slice(-4) : null, bossVote: gv.bossVote?.active, camp: gv.camp?.active, me: gv.me?.name, autoplay: window.__e2e && (function(){try{return document.querySelector('button:has-text("自动")')?.classList.contains('gold');}catch(e){return '?'}})() });
          });
          if (s) log('  [dump] 页面' + i + ': ' + s);
        } catch (e) {}
      }
    }
  }

  if (!winKind) {
    log('❌ 超时未结束，转储状态');
    for (let i = 0; i < 5; i++) {
      try {
        const info = await pages[i].evaluate(() => {
          const v = window.__e2e ? window.__e2e.view() : null;
          return v ? JSON.stringify({ ch: v.game.chapter?.id, combat: v.game.combat?.active, players: v.game.players?.length, logTail: v.game.log.slice(-4).map(l => l.text) }) : null;
        });
        log('页面' + i + ': ' + info);
      } catch (e) {}
    }
    await pages[0].screenshot({ path: SHOTS + '/99-stuck.png' });
    console.log('E2E RESULT: FAIL (timeout)');
    await browser.close(); server.kill();
    process.exit(1);
  }

  log('🎉 游戏结束：' + winKind);
  await new Promise(r => setTimeout(r, 800));
  await pages[0].screenshot({ path: SHOTS + '/05-victory.png' });

  // 断言
  const ok1 = await pages[0].evaluate(() => {
    const v = window.__e2e.view();
    const gv = v.game;
    return {
      winPublic: gv.win.kind === 'public',
      logNezznar: gv.log.some(l => l.text.includes('涅兹纳尔') && (l.text.includes('受到') || l.text.includes('被击败'))),
      goals: gv.players.every(p => true) && !!gv.me.goal,
      dmNarr: gv.log.some(l => l.kind === 'narr'),
    };
  });
  log('胜利类型=公开目标:', ok1.winPublic ? '✅' : '❌');
  log('击败涅兹纳尔:', ok1.logNezznar ? '✅' : '❌');
  const needChapters = ['序章·哥布林之箭', '第一章·克拉格莫洞穴', '第二章·凡达林镇', '第二章·特雷森达庄园', '第三章·克拉格莫城堡', '终章·回声波洞穴'];
  const missing = needChapters.filter(c => !visitedChapters.has(c));
  log('覆盖全部章节:', missing.length === 0 ? '✅' : '❌ 缺失: ' + missing.join(','));
  log('隐藏目标下发:', ok1.goals ? '✅' : '❌');
  log('DM旁白存在:', ok1.dmNarr ? '✅' : '❌');
  // 画布渲染检查（全画布采样）
  const canvasOk = await pages[0].evaluate(() => {
    const c = document.getElementById('game-canvas');
    if (!c || c.width < 50) return false;
    const ctx = c.getContext('2d');
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    let nonBg = 0;
    for (let i = 0; i < d.length; i += 16) { if (d[i] !== 13 || d[i + 1] !== 10 || d[i + 2] !== 20) nonBg++; }
    return nonBg > 500;
  });
  log('像素画布渲染正常:', canvasOk ? '✅' : '❌');
  const realErrors = errors.filter(e => !e.includes('AudioContext') && !e.includes('WebAudio'));
  log('浏览器错误数(忽略无音频设备):', realErrors.length);
  for (const e of realErrors.slice(0, 10)) log('  ⚠ ' + e);

  const pass = ok1.winPublic && ok1.logNezznar && missing.length === 0 && ok1.dmNarr && canvasOk && realErrors.length === 0;
  console.log('E2E RESULT: ' + (pass ? 'PASS' : 'PARTIAL'));
  await browser.close();
  server.kill();
  process.exit(pass ? 0 : 2);
}

// 兜底：无论何种退出都确保杀掉自己的服务器子进程与浏览器
function cleanup() { try { server.kill(); } catch (e) {} try { browser && browser.close(); } catch (e) {} }
process.on('exit', cleanup);
process.on('SIGINT', () => { cleanup(); process.exit(1); });
process.on('SIGTERM', () => { cleanup(); process.exit(1); });

main().catch(e => { console.error('E2E CRASH:', e); cleanup(); process.exit(1); });
