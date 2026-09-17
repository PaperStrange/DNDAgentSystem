// R1-18 行为层验证：客户端移动前置校验
//
// 为什么必须有它：R1-18 卡片「验收反例 1」明令——**不得用动画遮罩掩盖闪烁**，要修的是
// **前置校验**；因此「改完不闪了」不算数，必须证明 **点击不可通行格时 game:move 根本没被发出**。
// 本测试把「看着不闪」升级为 **WS 出站帧拦截 + 断言**：在页面加载前劫持
// `WebSocket.prototype.send`，逐帧记录出站字符串，在 Node 侧解析并判定「是否发出了 game:move」。
//
// 手法：真实服务器 + 真实 Chromium + 真实对局（非 mock、非合成）。
// 端口：默认 3896 —— **不占 3000**（用户正在 3000 端口做人工验收）；可用 R1_18_PORT 覆盖。
// 输出：<R1_18_OUT_DIR>/r1-18-move-guard-test.json
//   （默认 <appRoot>/docs/qa/restart-sprint1/<stamp>/。docs/ 被 gitignore，
//    从 worktree 跑时用 R1_18_OUT_DIR 指向主检出，证据才落在主仓可见处。）
//
// 断言清单（与卡片验收标准逐条对应）：
//   T1  点击明确不可通行格（墙 # / 树 T / 水 ~ / 关着的门 D）→ **game:move 未发出** + 角色未移动 + 给出可见反馈
//   T2  点击可达格 → **game:move 已发出** 且角色确实移动（防过度拦截）；含多格（距离≥2）移动
//   T3  采样帧判定：插值收敛（无「持续未归位」卡死段）、moving=false、frame=0、相机 === f(焦点真实格)（R1-19 无回归）
//   T4  无 server/ 改动（在报告层用 git diff --stat 核验；本测试只在客户端跑）
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const PORT = Number(process.env.R1_18_PORT || 3896);
const SEED = Number(process.env.R1_18_SEED || 20240602);
const TILE = 16;
// 与服务端 blockMove=true 的字符集完全一致（server/game/dungeon.mjs:415-420）：
// 墙 # / 树 T / 关闭的门 D / 水 ~；地板 . / 草 g / 瓦砾 ^ 可通行。
const BLOCKED = '#TD~';
const appRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const outDir = process.env.R1_18_OUT_DIR || join(appRoot, 'docs', 'qa', 'restart-sprint1', stamp);
mkdirSync(outDir, { recursive: true });
const log = (...a) => console.log('[r1-18]', ...a);

const server = spawn(process.execPath, ['server/index.mjs'], {
  cwd: appRoot,
  env: { ...process.env, DND_PORT: String(PORT), DND_SEED: String(SEED) },
  stdio: ['ignore', 'pipe', 'pipe'],
});
server.stderr.on('data', (d) => process.stderr.write('[srv] ' + d));
let browser = null;
function cleanup() { try { server.kill(); } catch (e) { /* ignore */ } try { browser && browser.close(); } catch (e) { /* ignore */ } }
process.on('exit', cleanup);
process.on('SIGINT', () => { cleanup(); process.exit(1); });
process.on('SIGTERM', () => { cleanup(); process.exit(1); });

// ---------- 逐帧采样（页面内 rAF，避免 Playwright 往返丢帧） ----------
async function sampleFrames(page, frames) {
  await page.evaluate((n) => {
    window.__trace = [];
    window.__traceDone = false;
    let i = 0;
    const tick = () => {
      const v = window.__e2e && window.__e2e.view();
      const gv = v && v.game;
      if (gv) {
        const cam = window.__e2e.cam();
        const ents = gv.entities.map((e) => {
          const a = window.__e2e.animOf(e.eid);
          return {
            eid: e.eid, ex: e.x, ey: e.y,
            ax: a ? a.x : null, ay: a ? a.y : null,
            moving: a ? a.moving : null, frame: a ? a.frame : null,
          };
        });
        const focus = (gv.turn && gv.state === 'playing')
          ? gv.entities.find((e) => e.eid === gv.turn.actorEid)
          : (gv.me ? gv.entities.find((e) => e.eid === gv.me.eid) : null);
        const cv = document.getElementById('game-canvas');
        window.__trace.push({
          camx: cam.x, camy: cam.y, focus: focus ? focus.eid : null, ents,
          geom: { cw: cv.width, ch: cv.height, scale: window.__e2e.scale(), mapw: gv.map.w, maph: gv.map.h },
        });
      }
      if (++i < n) requestAnimationFrame(tick);
      else window.__traceDone = true;
    };
    requestAnimationFrame(tick);
  }, frames);
  await page.waitForFunction(() => window.__traceDone === true, null, { timeout: 120000 });
  return await page.evaluate(() => window.__trace);
}

const off = (r) => Math.max(Math.abs(r.ax - r.ex), Math.abs(r.ay - r.ey));

// ---------- 分析 A：静置窗口尾部是否已归位（残差=0）+ moving=false + frame=0 ----------
function analyzeSettle(trace, minRun) {
  const perEnt = new Map();
  trace.forEach((f, i) => {
    for (const e of f.ents) {
      if (!perEnt.has(e.eid)) perEnt.set(e.eid, []);
      perEnt.get(e.eid).push({ i, ...e });
    }
  });
  const out = [];
  for (const [eid, rows] of perEnt) {
    const runs = [];
    let s = 0;
    for (let i = 1; i <= rows.length; i++) {
      const same = i < rows.length && rows[i].ex === rows[s].ex && rows[i].ey === rows[s].ey;
      if (!same) { runs.push([s, i - 1]); s = i; }
    }
    const windows = [];
    for (const [a, b] of runs) {
      const seg = rows.slice(a, b + 1);
      if (seg.length < minRun) continue;
      const offs = seg.map(off);
      const convAt = offs.findIndex((o) => o === 0);
      let rest = 0;
      for (let k = seg.length - 1; k >= 0; k--) {
        if (offs[k] === 0 && seg[k].moving === false && seg[k].frame === 0) rest++;
        else break;
      }
      windows.push({
        tile: { x: seg[0].ex, y: seg[0].ey },
        len: seg.length,
        rampFrames: convAt < 0 ? seg.length : convAt,
        converged: convAt >= 0,
        finalOffset: offs[offs.length - 1],
        maxOffset: Math.max(...offs),
        finalMoving: seg[seg.length - 1].moving,
        finalFrame: seg[seg.length - 1].frame,
        restFrames: rest,
        restStable: rest >= minRun,
      });
    }
    const tail = rows.slice(-minRun);
    out.push({
      eid, frames: rows.length, windows,
      transitions: Math.max(0, runs.length - 1),
      tailSettled: tail.every((r) => off(r) === 0 && r.moving === false && r.frame === 0),
    });
  }
  return out;
}

// ---------- 分析 A2：卡死段检测（旧 bug 的直接判据） ----------
function analyzeStuck(trace, threshold) {
  const perEnt = new Map();
  trace.forEach((f, i) => {
    for (const e of f.ents) {
      if (!perEnt.has(e.eid)) perEnt.set(e.eid, []);
      perEnt.get(e.eid).push({ i, ...e });
    }
  });
  const out = [];
  for (const [eid, rows] of perEnt) {
    let run = 0, best = 0, start = -1, cur = -1;
    for (const r of rows) {
      if (off(r) > 0) { if (run === 0) cur = r.i; run++; if (run > best) { best = run; start = cur; } }
      else run = 0;
    }
    out.push({ eid, maxStuckRun: best, atFrame: start, stuck: best >= threshold });
  }
  return out;
}

// ---------- 分析 B：位移时的逐帧推进序列 ----------
function analyzeTransitions(trace, max) {
  const byEid = new Map();
  trace.forEach((f, i) => {
    for (const e of f.ents) {
      if (!byEid.has(e.eid)) byEid.set(e.eid, []);
      byEid.get(e.eid).push({ i, ...e });
    }
  });
  const out = [];
  for (const [eid, rows] of byEid) {
    for (let i = 1; i < rows.length; i++) {
      if (rows[i].ex === rows[i - 1].ex && rows[i].ey === rows[i - 1].ey) continue;
      const win = rows.slice(i, i + 16);
      const axis = rows[i].ex !== rows[i - 1].ex ? 'x' : 'y';
      const seq = win.map((r) => (axis === 'x' ? r.ax : r.ay));
      const target = axis === 'x' ? rows[i].ex : rows[i].ey;
      out.push({
        eid, atFrame: rows[i].i, axis,
        from: { x: rows[i - 1].ex, y: rows[i - 1].ey },
        to: { x: rows[i].ex, y: rows[i].ey },
        target,
        seq,
        distinct: new Set(seq.map((v) => v.toFixed(4))).size,
        reached: seq.includes(target),
      });
      if (out.length >= max) return out;
    }
  }
  return out;
}

// ---------- 分析 C：相机是否收敛到由焦点真实格决定的值 ----------
function expectedCam(tx, ty, geom) {
  const vwT = geom.cw / geom.scale / TILE, vhT = geom.ch / geom.scale / TILE;
  let x = tx - vwT / 2 + .5, y = ty - vhT / 2 + .3;
  if (vwT >= geom.mapw) x = (geom.mapw - vwT) / 2; else x = Math.max(0, Math.min(x, geom.mapw - vwT));
  if (vhT >= geom.maph) y = (geom.maph - vhT) / 2; else y = Math.max(0, Math.min(y, geom.maph - vhT));
  return { x, y };
}

function analyzeCamera(trace, minRun, geom) {
  const key = (i) => {
    const f = trace[i];
    const fe = f.ents.find((e) => e.eid === f.focus);
    return f.focus + '|' + (fe ? fe.ex + ',' + fe.ey : 'x');
  };
  const out = [];
  let s = 0;
  for (let i = 1; i <= trace.length; i++) {
    const same = i < trace.length && key(i) === key(s);
    if (same) continue;
    if (i - s >= minRun) {
      const seg = trace.slice(s, i);
      const last = seg[seg.length - 1];
      const fe = last.ents.find((e) => e.eid === last.focus);
      const rawX = seg.map((f) => f.camx), rawY = seg.map((f) => f.camy);
      const tailX = rawX.slice(-minRun), tailY = rawY.slice(-minRun);
      const g = last.geom || geom;
      const exp = fe ? expectedCam(fe.ex, fe.ey, g) : null;
      out.push({
        frames: seg.length,
        focus: seg[0].focus,
        focusTile: fe ? { x: fe.ex, y: fe.ey } : null,
        camTailStable: new Set(tailX).size === 1 && new Set(tailY).size === 1,
        finalCam: { x: rawX[rawX.length - 1], y: rawY[rawY.length - 1] },
        expectedCam: exp,
        camMatchesExpected: !!exp
          && Math.abs(rawX[rawX.length - 1] - exp.x) < 1e-6
          && Math.abs(rawY[rawY.length - 1] - exp.y) < 1e-6,
        focusAnim: fe ? { x: fe.ax, y: fe.ay, moving: fe.moving } : null,
        focusConverged: !!fe && fe.ax === fe.ex && fe.ay === fe.ey,
      });
    }
    s = i;
  }
  return out;
}

async function login(page, name) {
  await page.waitForSelector('.dialog-overlay .auth-input', { timeout: 20000 });
  await page.click('.dialog-overlay .seg-btn:has-text("注册")');
  await page.fill('.dialog-overlay input[placeholder*="用户名"]', name);
  await page.fill('.dialog-overlay input[type="password"]', 'sim1234');
  await page.click('.dialog-overlay .btn.gold');
  const ok = await page.waitForSelector('.dialog-overlay', { state: 'detached', timeout: 8000 }).then(() => true).catch(() => false);
  if (!ok) {
    await page.click('.dialog-overlay .seg-btn:has-text("登录")');
    await page.fill('.dialog-overlay input[placeholder*="用户名"]', name);
    await page.fill('.dialog-overlay input[type="password"]', 'sim1234');
    await page.click('.dialog-overlay .btn.gold');
    await page.waitForSelector('.dialog-overlay', { state: 'detached', timeout: 8000 });
  }
}

const results = [];
const check = (name, ok, detail) => { results.push({ name, ok: !!ok, detail: detail || '' }); log((ok ? '✅ ' : '❌ ') + name + ' | ' + detail); };

async function main() {
  await new Promise((r) => setTimeout(r, 1500));
  browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

  // ★ 在页面脚本运行前劫持 WebSocket.send，逐帧记录出站帧（R1-18 的核心取证手段）
  await page.addInitScript(() => {
    window.__wsSent = [];
    const orig = WebSocket.prototype.send;
    WebSocket.prototype.send = function (data) {
      try { if (typeof data === 'string') window.__wsSent.push(data); } catch (e) { /* ignore */ }
      return orig.apply(this, arguments);
    };
  });

  await page.goto('http://localhost:' + PORT + '/');
  await page.waitForSelector('.lobby-title');
  await login(page, '前置校验甲');
  log('登录完成');

  await page.click('.persona-grid .persona-card:nth-child(2)');
  await page.click('.create-box .btn.gold');
  await page.waitForSelector('.room-code');
  // ★ 选手动战斗：手动模式在线玩家回合**无看门狗**（server turn.mjs:47 timeoutMs=0），
  //   否则自动模式 8 秒后回合自动跳过（turn.mjs:41-54），T2/T3 会与计时器赛跑导致偶发伪阴性。
  await page.click('.seg-btn:has-text("手动战斗")');
  await page.waitForTimeout(500);
  log('房间已创建（手动战斗）');

  await page.fill('input[placeholder="为你的角色起个名字"]', '前置校验甲');
  await page.locator('.opt-grid').nth(0).locator('.opt-card').first().click();
  await page.locator('.opt-grid').nth(1).locator('.opt-card').first().click();
  await page.waitForTimeout(500);
  await page.click('button:has-text("保存车卡")');
  await page.waitForTimeout(700);

  await page.waitForSelector('button:has-text("准备就绪")');
  await page.click('button:has-text("准备就绪")');
  // 单人确认框文案随模式不同（"立即开始冒险" / "立即开始"）；用子串匹配兼容两者
  const startBtn = page.locator('button:has-text("立即开始")').first();
  await startBtn.waitFor({ timeout: 10000 });
  await startBtn.click();
  await page.waitForSelector('.screen-game', { timeout: 30000 });
  log('对局开始（单人）');
  await page.waitForTimeout(1500);

  const introBtn = page.locator('.overlay-card button:has-text("开始冒险")');
  if (await introBtn.count()) { await introBtn.first().click(); }
  await page.waitForTimeout(600);
  await page.bringToFront();

  const hookOk = await page.evaluate(() => !!(window.__e2e && window.__e2e.floaters && window.__e2e.animOf));
  check('T0 只读钩子就绪（animOf / floaters）', hookOk, 'hookOk=' + hookOk);

  const modeInfo = await page.evaluate(() => ({
    mode: window.__e2e.view().game?.mode,
    roomMode: window.__e2e.view().room?.mode,
    dbg: window.__e2e.debug(),
  }));
  log('模式=' + JSON.stringify(modeInfo));

  const geom = await page.evaluate(() => {
    const c = document.getElementById('game-canvas');
    const gv = window.__e2e.view().game;
    return { cw: c.width, ch: c.height, scale: window.__e2e.scale(), mapw: gv.map.w, maph: gv.map.h };
  });
  log('几何常量=' + JSON.stringify(geom));

  // 关闭自动游玩：只有玩家点击才会发出 game:move（排除自动策略干扰）
  await page.evaluate(() => { if (window.__e2e) window.__e2e.setAutoplay(false); });

  const readPos = () => page.evaluate(() => {
    const gv = window.__e2e.view().game;
    const me = gv.entities.find((e) => e.eid === gv.me.eid);
    return { x: me.x, y: me.y };
  });
  const getSent = () => page.evaluate(() => (window.__wsSent || []).slice());
  const movesFrom = (frames, fromIdx) => frames.slice(fromIdx)
    .map((f) => { try { return JSON.parse(f); } catch (e) { return null; } })
    .filter((m) => m && m.t === 'game:move');

  const waitMyTurn = async (tries) => {
    for (let i = 0; i < tries; i++) {
      const d = await page.evaluate(() => (window.__e2e ? window.__e2e.debug() : null));
      if (d && d.pid && d.turnPid && d.pid === d.turnPid) return true;
      await page.waitForTimeout(500);
    }
    return false;
  };

  let myTurn = await waitMyTurn(240);
  log('轮到我方回合：' + myTurn);

  // ================= T1：点击明确不可通行格 → game:move 未发出 =================
  let t1 = { ran: false, reason: 'not-my-turn', cases: [] };
  if (myTurn) {
    // 视口内每种阻挡字符各取最近一格（墙 # / 树 T / 水 ~ / 关着的门 D）
    const info = await page.evaluate((BLOCKED) => {
      const gv = window.__e2e.view().game;
      const me = gv.entities.find((e) => e.eid === gv.me.eid);
      const cam = window.__e2e.cam(), S = window.__e2e.scale();
      const c = document.getElementById('game-canvas'), r = c.getBoundingClientRect();
      const vwT = c.width / S / 16, vhT = c.height / S / 16;
      const x0 = Math.floor(cam.x), y0 = Math.floor(cam.y);
      const found = {};
      for (let y = y0; y < y0 + vhT + 1; y++) {
        for (let x = x0; x < x0 + vwT + 1; x++) {
          if (x < 0 || y < 0 || x >= gv.map.w || y >= gv.map.h) continue;
          const ch = gv.map.tiles[y][x];
          if (BLOCKED.includes(ch)) {
            const d = Math.abs(x - me.x) + Math.abs(y - me.y);
            if (!found[ch] || d < found[ch].d) found[ch] = { x, y, ch, d };
          }
        }
      }
      const px = (t) => ({ clientX: r.left + (t.x + 0.5 - cam.x) * 16 * S, clientY: r.top + (t.y + 0.5 - cam.y) * 16 * S });
      return { me: { x: me.x, y: me.y }, tiles: Object.values(found).map((t) => ({ ...t, px: px(t) })) };
    }, BLOCKED);
    log('T1 视口内不可通行格样本=' + JSON.stringify(info.tiles.map((t) => ({ ch: t.ch, x: t.x, y: t.y, d: t.d }))));

    for (const t of info.tiles) {
      if (!(await waitMyTurn(20))) break;
      await page.evaluate(() => { if (window.__e2e && window.__e2e.clearPending) window.__e2e.clearPending(); });
      const sentBefore = (await getSent()).length;
      const before = await readPos();
      await page.mouse.click(t.px.clientX, t.px.clientY);
      await page.waitForTimeout(300); // 浮动文字在 1200ms 内存在，先取证
      const floaters = await page.evaluate(() => (window.__e2e && window.__e2e.floaters ? window.__e2e.floaters() : null));
      await page.waitForTimeout(1200);
      const sentAfter = await getSent();
      const newMoves = movesFrom(sentAfter, sentBefore);
      const after = await readPos();
      const caseRec = {
        ch: t.ch, tile: { x: t.x, y: t.y }, dist: t.d,
        before, after,
        moved: after.x !== before.x || after.y !== before.y,
        newMovesCount: newMoves.length,
        newMoveFrames: newMoves,
        floaters: floaters,
        feedbackShown: !!(floaters && floaters.some((f) => f.text === '那里过不去')),
      };
      t1.cases.push(caseRec);
      log('T1 点 ' + t.ch + '(' + t.x + ',' + t.y + ') → game:move 新帧=' + newMoves.length + ' 移动=' + caseRec.moved + ' 反馈=' + caseRec.feedbackShown);
      await page.waitForTimeout(400);
    }
    t1.ran = t1.cases.length > 0;
    if (!t1.ran) t1.reason = 'no-blocked-tile-in-viewport';
  }
  check('T1 视口内找到至少一种不可通行格样本（前提）', t1.ran,
    t1.ran ? '样本=' + t1.cases.map((c) => c.ch).join(',') : '原因=' + t1.reason);
  if (t1.ran) {
    const allNoSend = t1.cases.every((c) => c.newMovesCount === 0);
    check('T1-a 点击不可通行格 → game:move 未发出（逐格核验）', allNoSend,
      t1.cases.map((c) => c.ch + ':新帧=' + c.newMovesCount).join('；')
      + '｜原始出站帧样本=' + JSON.stringify(t1.cases[0].newMoveFrames));
    const allNoMove = t1.cases.every((c) => c.moved === false);
    check('T1-b 点击不可通行格 → 角色未移动（服务器状态不变）', allNoMove,
      t1.cases.map((c) => c.ch + ':' + JSON.stringify(c.before) + '→' + JSON.stringify(c.after)).join('；'));
    const allFeedback = t1.cases.every((c) => c.feedbackShown);
    check('T1-c 点击不可通行格 → 给出可见反馈（浮动文字「那里过不去」）', allFeedback,
      t1.cases.map((c) => c.ch + ':' + JSON.stringify(c.floaters)).join('；'));
  }

  // ================= T2：可达格仍然正常（防过度拦截） =================
  let t2 = { ran: false, reason: 'not-my-turn', cases: [] };
  if (myTurn) {
    // T2-a：相邻可通行格
    if (await waitMyTurn(20)) {
      await page.evaluate(() => { if (window.__e2e && window.__e2e.clearPending) window.__e2e.clearPending(); });
      const ctl = await page.evaluate((BLOCKED) => {
        const gv = window.__e2e.view().game;
        const me = gv.entities.find((e) => e.eid === gv.me.eid);
        const cam = window.__e2e.cam(), S = window.__e2e.scale();
        const c = document.getElementById('game-canvas'), r = c.getBoundingClientRect();
        const occupied = new Set(gv.entities.filter((e) => !e.dead && e.hp > 0).map((e) => e.x + ',' + e.y));
        const walk = (x, y) => {
          if (x < 0 || y < 0 || x >= gv.map.w || y >= gv.map.h) return false;
          const ch = gv.map.tiles[y][x];
          return ch !== undefined && !BLOCKED.includes(ch);
        };
        let t = null;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const x = me.x + dx, y = me.y + dy;
          if (walk(x, y) && !occupied.has(x + ',' + y)) { t = { x, y }; break; }
        }
        const px = t ? { clientX: r.left + (t.x + 0.5 - cam.x) * 16 * S, clientY: r.top + (t.y + 0.5 - cam.y) * 16 * S } : null;
        return { me: { x: me.x, y: me.y }, tile: t, px };
      }, BLOCKED);
      if (ctl.tile && ctl.px) {
        const sentBefore = (await getSent()).length;
        await page.mouse.click(ctl.px.clientX, ctl.px.clientY);
        await page.waitForTimeout(1500);
        const sentAfter = await getSent();
        const newMoves = movesFrom(sentAfter, sentBefore);
        const after = await readPos();
        const rec = {
          kind: 'adjacent', from: ctl.me, clickedTile: ctl.tile, after,
          moved: after.x !== ctl.me.x || after.y !== ctl.me.y,
          sentMoveWithTile: newMoves.some((m) => m.x === ctl.tile.x && m.y === ctl.tile.y),
          newMovesCount: newMoves.length, newMoveFrames: newMoves,
        };
        t2.cases.push(rec);
        t2.ran = true;
        log('T2-a 点相邻可通行格 ' + JSON.stringify(ctl.tile) + ' ' + JSON.stringify(ctl.me) + '→' + JSON.stringify(after) + ' 发出=' + rec.newMovesCount);
      }
    }

    // T2-b：多格（距离≥2）可达格——直线两格皆可通行且无实体占位 ⇒ 必然可达（不依赖寻路，避开「可达但被墙隔开」的伪阴性）
    if (await waitMyTurn(20)) {
      await page.evaluate(() => { if (window.__e2e && window.__e2e.clearPending) window.__e2e.clearPending(); });
      const ctl = await page.evaluate((BLOCKED) => {
        const gv = window.__e2e.view().game;
        const me = gv.entities.find((e) => e.eid === gv.me.eid);
        const cam = window.__e2e.cam(), S = window.__e2e.scale();
        const c = document.getElementById('game-canvas'), r = c.getBoundingClientRect();
        const occupied = (x, y) => gv.entities.some((e) => !e.dead && e.hp > 0 && e.x === x && e.y === y);
        const walk = (x, y) => {
          if (x < 0 || y < 0 || x >= gv.map.w || y >= gv.map.h) return false;
          const ch = gv.map.tiles[y][x];
          return ch !== undefined && !BLOCKED.includes(ch);
        };
        let t = null;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const x1 = me.x + dx, y1 = me.y + dy, x2 = me.x + 2 * dx, y2 = me.y + 2 * dy;
          if (walk(x1, y1) && walk(x2, y2) && !occupied(x1, y1) && !occupied(x2, y2)) { t = { x: x2, y: y2, mid: { x: x1, y: y1 } }; break; }
        }
        const px = t ? { clientX: r.left + (t.x + 0.5 - cam.x) * 16 * S, clientY: r.top + (t.y + 0.5 - cam.y) * 16 * S } : null;
        return { me: { x: me.x, y: me.y }, tile: t, px };
      }, BLOCKED);
      if (ctl.tile && ctl.px) {
        const sentBefore = (await getSent()).length;
        await page.mouse.click(ctl.px.clientX, ctl.px.clientY);
        // 点击后立刻逐帧采样：捕获「移动 + 插值收敛」全过程，用于 T3
        const trace = await sampleFrames(page, 150);
        const sentAfter = await getSent();
        const newMoves = movesFrom(sentAfter, sentBefore);
        const after = await readPos();
        const rec = {
          kind: 'multitile', from: ctl.me, clickedTile: ctl.tile, after,
          moved: after.x !== ctl.me.x || after.y !== ctl.me.y,
          manhattan: Math.abs(after.x - ctl.me.x) + Math.abs(after.y - ctl.me.y),
          sentMoveWithTile: newMoves.some((m) => m.x === ctl.tile.x && m.y === ctl.tile.y),
          newMovesCount: newMoves.length, newMoveFrames: newMoves,
        };
        t2.cases.push(rec);
        t2.ran = true;
        t2.trace = trace;
        log('T2-b 点多格可通行格 ' + JSON.stringify(ctl.tile) + ' ' + JSON.stringify(ctl.me) + '→' + JSON.stringify(after) + ' 曼哈顿位移=' + rec.manhattan + ' 发出=' + rec.newMovesCount);
      }
    }
  }
  check('T2 执行了可达格点击样本（前提）', t2.ran, t2.ran ? '样本数=' + t2.cases.length : '原因=' + t2.reason);
  if (t2.ran) {
    const allSent = t2.cases.every((c) => c.newMovesCount >= 1 && c.sentMoveWithTile);
    check('T2-a 点击可达格 → game:move 已发出（目标格一致，防过度拦截）', allSent,
      t2.cases.map((c) => c.kind + ':新帧=' + c.newMovesCount + ' 含目标格=' + c.sentMoveWithTile + ' ' + JSON.stringify(c.newMoveFrames)).join('；'));
    const allMoved = t2.cases.every((c) => c.moved === true);
    check('T2-b 点击可达格 → 角色确实移动（可达性未被误拦）', allMoved,
      t2.cases.map((c) => c.kind + ':' + JSON.stringify(c.from) + '→' + JSON.stringify(c.after) + (c.manhattan != null ? '(曼哈顿=' + c.manhattan + ')' : '')).join('；'));
    const multi = t2.cases.find((c) => c.kind === 'multitile');
    check('T2-c 多格移动（距离≥2）确实发生（≥2 步位移）', !!multi && multi.manhattan >= 2,
      multi ? '曼哈顿位移=' + multi.manhattan + '，' + JSON.stringify(multi.from) + '→' + JSON.stringify(multi.after) : '未执行多格样本');
  }

  // ================= T3：R1-19 无回归（插值收敛 / 无卡死 / 相机不偏移） =================
  let t3 = { ran: false, reason: 'no-trace' };
  if (t2.trace && t2.trace.length) {
    const trace = t2.trace;
    const settle = analyzeSettle(trace, 15);
    const stuck = analyzeStuck(trace, 40);
    const transitions = analyzeTransitions(trace, 6);
    const camera = analyzeCamera(trace, 15, geom);
    const allWindows = settle.flatMap((s) => s.windows);
    const anySettled = allWindows.length > 0;
    const allConverged = anySettled && allWindows.every((w) => w.converged && w.finalOffset === 0);
    const allMovingFalse = anySettled && allWindows.every((w) => w.finalMoving === false);
    const allFrameZero = anySettled && allWindows.every((w) => w.finalFrame === 0 && w.restStable);
    const worstStuck = stuck.reduce((m, s) => Math.max(m, s.maxStuckRun), 0);
    const camStable = camera.filter((c) => c.camTailStable);
    const camExact = camera.filter((c) => c.camMatchesExpected);
    const progressed = transitions.find((t) => t.distinct >= 3 && t.reached);
    t3 = {
      ran: true, frames: trace.length,
      windowCount: allWindows.length, anySettled,
      maxFinalOffset: allWindows.length ? Math.max(...allWindows.map((w) => w.finalOffset)) : null,
      maxRamp: allWindows.length ? Math.max(...allWindows.map((w) => w.rampFrames)) : null,
      allConverged, allMovingFalse, allFrameZero,
      worstStuck, stuckThreshold: 40,
      cameraWindows: camera.length, camStableCount: camStable.length, camExactCount: camExact.length,
      progressed: !!progressed,
      progressedSeq: progressed ? progressed.seq.slice(0, 10) : null,
      camera, transitions, stuck,
    };
    check('T3-a 静置窗口尾部 anim 已归位到真实格（残差=0）', allConverged,
      anySettled ? '窗口数=' + allWindows.length + '；最大末帧残差=' + t3.maxFinalOffset + '；最长收敛=' + t3.maxRamp + ' 帧' : '无静置窗口');
    check('T3-b 静置窗口尾部 moving=false 且 frame=0（无抖动）', allMovingFalse && allFrameZero,
      'moving 非 false 窗口=' + allWindows.filter((w) => w.finalMoving !== false).length + '；frame≠0 或静止尾不足窗口=' + allWindows.filter((w) => !(w.finalFrame === 0 && w.restStable)).length);
    check('T3-c 无「持续未归位」卡死段（最长 offset>0 连续段 < 40 帧）', stuck.length > 0 && stuck.every((s) => !s.stuck),
      '实体数=' + stuck.length + '；最长未归位连续段=' + worstStuck + ' 帧');
    check('T3-d 相机 === f(焦点真实格)（R1-19 相机偏移不回归）', camera.length > 0 && camExact.length === camera.length,
      camera.length ? '窗口=' + camera.length + '，公式吻合=' + camExact.length + '，尾部稳定=' + camStable.length : '无窗口');
    check('T3-e 移动后插值逐帧推进且到达目标（≥3 个不同值）', !!progressed,
      progressed ? progressed.axis + ' 轴序列=' + progressed.seq.slice(0, 10).map((v) => (v == null ? 'null' : v.toFixed(3))).join(' → ') + '（目标=' + progressed.target + '）' : '未捕获逐帧推进');
  } else {
    check('T3 R1-19 无回归采样未执行', false, '原因=' + t3.reason);
  }

  // ================= T4-info（信息性，不计入通过率）：服务端对「直接请求移动到不可通行格」的原始行为 =================
  // 绕过客户端前置校验，直接 net.send('game:move', 阻挡格)，观察服务端是否移动角色、移到哪。
  // 目的：**如实量化过度拦截面**——即「加了前置校验后，哪些原本会发生的行为被拦掉」。
  // 判据来源（只读）：server/util.mjs:87-99 findPath 在目标不可直达时「退而求其次」取目标周围
  // 代价最低的可达邻格 ⇒ 点击「有可通行邻格的阻挡格」时，服务端原本可能把角色走到障碍前最后一格。
  let t4info = { ran: false, reason: 'not-my-turn' };
  if (await waitMyTurn(20)) {
    await page.evaluate(() => { if (window.__e2e && window.__e2e.clearPending) window.__e2e.clearPending(); });
    const probe = await page.evaluate((BLOCKED) => {
      const gv = window.__e2e.view().game;
      const me = gv.entities.find((e) => e.eid === gv.me.eid);
      const walk = (x, y) => {
        if (x < 0 || y < 0 || x >= gv.map.w || y >= gv.map.h) return false;
        const ch = gv.map.tiles[y][x];
        return ch !== undefined && !BLOCKED.includes(ch);
      };
      let pick = null;
      for (let y = 0; y < gv.map.h && !pick; y++) {
        for (let x = 0; x < gv.map.w && !pick; x++) {
          if (!BLOCKED.includes(gv.map.tiles[y][x])) continue;
          const hasWalkNbr = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => walk(x + dx, y + dy));
          if (hasWalkNbr) pick = { x, y, ch: gv.map.tiles[y][x] };
        }
      }
      return { me: { x: me.x, y: me.y }, pick };
    }, BLOCKED);
    if (probe.pick) {
      const before = await readPos();
      await page.evaluate((t) => window.__S.net.send('game:move', { x: t.x, y: t.y }), probe.pick);
      await page.waitForTimeout(1600);
      const after = await readPos();
      const afterTile = await page.evaluate(() => {
        const gv = window.__e2e.view().game;
        const me = gv.entities.find((e) => e.eid === gv.me.eid);
        return gv.map.tiles[me.y][me.x];
      });
      t4info = {
        ran: true, pick: probe.pick, before, after,
        moved: after.x !== before.x || after.y !== before.y,
        landedOnBlocked: BLOCKED.includes(afterTile),
        afterTile,
        note: '直接（绕过前置校验）请求移动到阻挡格，观察服务端原始行为；用于量化过度拦截面，不参与通过判定',
      };
      log('T4-info 直接移动到阻挡格 ' + probe.pick.ch + '(' + probe.pick.x + ',' + probe.pick.y + ') → ' + JSON.stringify(after)
        + ' 移动=' + t4info.moved + ' 落点字符=' + afterTile + ' 落在阻挡格=' + t4info.landedOnBlocked);
    } else {
      t4info = { ran: false, reason: 'no-blocked-tile-with-walkable-neighbor' };
    }
  }

  // ================= 页面错误冒烟 =================
  const realErrors = errors.filter((e) => !e.includes('AudioContext') && !e.includes('WebAudio'));
  check('T3-f 真实对局无新增页面错误（忽略无音频设备）', realErrors.length === 0,
    '错误数=' + realErrors.length + (realErrors.length ? '：' + realErrors.slice(0, 3).join(' | ') : ''));

  const passed = results.filter((r) => r.ok).length;
  const payload = {
    runAt: new Date().toISOString(),
    test: 'R1-18 客户端移动前置校验（不可通行格不发 game:move / 可达格不误拦 / R1-19 无回归）',
    port: PORT, seed: SEED,
    blockedChars: BLOCKED,
    total: results.length, passed,
    results,
    geom,
    t1, t2: { ran: t2.ran, cases: t2.cases }, t3, t4info,
    pageErrors: realErrors,
  };
  const outFile = join(outDir, 'r1-18-move-guard-test.json');
  writeFileSync(outFile, JSON.stringify(payload, null, 2), 'utf8');
  log('');
  log('R1-18 行为验证：' + passed + '/' + results.length + ' 通过');
  log('证据：' + outFile);

  await browser.close();
  server.kill();
  process.exit(passed === results.length ? 0 : 1);
}

main().catch((e) => { console.error('R1-18 CRASH:', e); cleanup(); process.exit(1); });
