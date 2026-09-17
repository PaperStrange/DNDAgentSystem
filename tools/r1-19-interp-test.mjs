// R1-19 行为层验证：精灵插值收敛 / moving 状态机 / 相机不偏移 / R1-18 交叉核验
//
// 为什么必须有它：R1-19 卡片「验收反例 2」明令——**不得只改 anim.lastX 的赋值时机而不
// 验证「插值是否真的逐帧推进到归位」；必须实测**。本测试把「改完看着不抖了」升级为
// **逐帧采样 + 断言**：直接读只读钩子 __e2e.animOf(eid) 的 {x,y,moving,frame} 与
// __e2e.cam()，在 Node 侧判定「收敛 / 抖动 / 偏移」。
//
// 手法：真实服务器 + 真实 Chromium + 真实对局（非 mock、非合成）。
// 端口：默认 3895 —— **不占 3000**（用户正在 3000 端口做人工验收）；可用 R1_19_PORT 覆盖。
// 输出：<R1_19_OUT_DIR>/r1-19-interp-test.json
//   （默认 <appRoot>/docs/qa/restart-sprint1/<stamp>/。docs/ 被 gitignore，
//    从 worktree 跑时用 R1_19_OUT_DIR 指向主检出，证据才落在主仓可见处。）
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const PORT = Number(process.env.R1_19_PORT || 3895);
const SEED = Number(process.env.R1_19_SEED || 20240601);
const TILE = 16;
const appRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const outDir = process.env.R1_19_OUT_DIR || join(appRoot, 'docs', 'qa', 'restart-sprint1', stamp);
mkdirSync(outDir, { recursive: true });
const log = (...a) => console.log('[r1-19]', ...a);

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
        // 每帧记录几何常量：地图/SCALE 会在换图（章节推进）时改变，一次性采集会失真
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

// ---------- 分析 A：静置窗口内「插值是否收敛到真实格 / moving 是否已停 / frame 是否已零」 ----------
// 关键：窗口以「服务器格不变」切分，而服务器格在移动被接受的那一刻就**立刻**跳到新格，
// 插值则在随后若干帧逐帧逼近。所以窗口**头部**天然含收敛斜坡（anim 落后于真实格是正常的），
// 断言必须看**窗口尾部是否已归位并保持**，而不是「整窗每一帧都在目标格」——后者对任何
// 正常插值都恒为假，是伪失败。旧 bug 的判据是：**窗口尾部永远不归位**（残差恒 > 0）。
const off = (r) => Math.max(Math.abs(r.ax - r.ex), Math.abs(r.ay - r.ey));

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
      const convAt = offs.findIndex((o) => o === 0); // 首次归位的相对帧
      let rest = 0;
      for (let k = seg.length - 1; k >= 0; k--) {
        if (offs[k] === 0 && seg[k].moving === false && seg[k].frame === 0) rest++;
        else break;
      }
      windows.push({
        tile: { x: seg[0].ex, y: seg[0].ey },
        len: seg.length,
        rampFrames: convAt < 0 ? seg.length : convAt, // 收敛耗时（帧）
        converged: convAt >= 0,
        finalOffset: offs[offs.length - 1],
        maxOffset: Math.max(...offs),
        finalMoving: seg[seg.length - 1].moving,
        finalFrame: seg[seg.length - 1].frame,
        restFrames: rest,                 // 尾部「已归位且 moving=false 且 frame=0」的连续帧数
        restStable: rest >= minRun,
      });
    }
    const tail = rows.slice(-minRun);
    out.push({
      eid, frames: rows.length, windows,
      transitions: Math.max(0, runs.length - 1), // 采样内发生的位移次数
      tailSettled: tail.every((r) => off(r) === 0 && r.moving === false && r.frame === 0),
    });
  }
  return out;
}

// ---------- 分析 A2：卡死段检测（旧 bug 的**直接**判据） ----------
// 旧实现：每次位移后插值只推进一帧，残差永久停在 0.7|dx|>0 ⇒ 从该次位移起「offset>0」
// 一直持续到采样结束（数百帧）。正常插值 ≤13 帧。故「连续 offset>0 段」长度是干净的分界。
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

// ---------- 分析 B：移动瞬间的逐帧序列（证明「逐帧推进」而非「一步跳变/一帧即停」） ----------
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
      // 只取「实际变化的那根轴」——竖直移动时 ax 合法地保持不变，拿 ax 判推进会伪失败
      const axis = rows[i].ex !== rows[i - 1].ex ? 'x' : 'y';
      const seq = win.map((r) => (axis === 'x' ? r.ax : r.ay));
      const target = axis === 'x' ? rows[i].ex : rows[i].ey;
      out.push({
        eid, atFrame: rows[i].i, axis,
        from: { x: rows[i - 1].ex, y: rows[i - 1].ey },
        to: { x: rows[i].ex, y: rows[i].ey },
        target,
        seq,                                  // 变化轴的 anim 逐帧序列
        distinct: new Set(seq.map((v) => v.toFixed(4))).size,
        reached: seq.includes(target),
        axSeq: win.map((r) => r.ax), aySeq: win.map((r) => r.ay),
        frameSeq: win.map((r) => r.frame),
        movingSeq: win.map((r) => r.moving),
      });
      if (out.length >= max) return out;
    }
  }
  return out;
}

// ---------- 分析 C：相机在「焦点静置窗口」内是否收敛到「由焦点真实格决定」的值 ----------
// cameraPos() 是焦点 anim 的纯函数（clamp 后）。若旧 bug 让 anim 停在 30% 处，相机就会停在
// 一个**由「从哪来」决定**的错误值上——因此断言「相机 === f(焦点真实格)」是**非平凡**的
// 反例探针（焦点真实格相同 ⇒ 相机必须相同，且必须等于公式值）。
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
      const g = last.geom || geom; // 用该窗口**末帧**的几何常量（换图后 mapw/maph/SCALE 会变）
      const exp = fe ? expectedCam(fe.ex, fe.ey, g) : null;
      out.push({
        frames: seg.length,
        focus: seg[0].focus,
        focusTile: fe ? { x: fe.ex, y: fe.ey } : null,
        geom: g,
        camTailStable: new Set(tailX).size === 1 && new Set(tailY).size === 1, // 尾部连续 minRun 帧不动
        camX: [...new Set(rawX)], camY: [...new Set(rawY)], // 去重后序列（看收敛轨迹）
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

  await page.goto('http://localhost:' + PORT + '/');
  await page.waitForSelector('.lobby-title');
  await login(page, '插值甲');
  log('登录完成');

  await page.click('.persona-grid .persona-card:nth-child(2)');
  await page.click('.create-box .btn.gold');
  await page.waitForSelector('.room-code');
  log('房间已创建');

  await page.fill('input[placeholder="为你的角色起个名字"]', '插值甲');
  await page.locator('.opt-grid').nth(0).locator('.opt-card').first().click();
  await page.locator('.opt-grid').nth(1).locator('.opt-card').first().click();
  await page.waitForTimeout(500);
  await page.click('button:has-text("保存车卡")');
  await page.waitForTimeout(700);

  // B-10：单人点「准备就绪」弹确认框 → 走「立即开始冒险」
  await page.waitForSelector('button:has-text("准备就绪")');
  await page.click('button:has-text("准备就绪")');
  await page.waitForSelector('button:has-text("立即开始冒险")', { timeout: 10000 });
  await page.click('button:has-text("立即开始冒险")');
  await page.waitForSelector('.screen-game', { timeout: 30000 });
  log('对局开始（单人）');
  await page.waitForTimeout(1500);

  const introBtn = page.locator('.overlay-card button:has-text("开始冒险")');
  if (await introBtn.count()) { await introBtn.first().click(); }
  await page.waitForTimeout(600);
  await page.bringToFront();

  // 采集相机公式所需的几何常量（canvas 缓冲尺寸 / SCALE / 地图尺寸），用于独立重算期望相机
  const geom = await page.evaluate(() => {
    const c = document.getElementById('game-canvas');
    const gv = window.__e2e.view().game;
    return { cw: c.width, ch: c.height, scale: window.__e2e.scale(), mapw: gv.map.w, maph: gv.map.h };
  });
  log('几何常量=' + JSON.stringify(geom));

  // ================= Phase 1：T1 / T2（自动游玩下逐帧采样） =================
  await page.evaluate(() => { if (window.__e2e) window.__e2e.setAutoplay(true); });
  log('自动游玩开启，逐帧采样 400 帧…');
  const trace1 = await sampleFrames(page, 400);
  log('采样完成：' + trace1.length + ' 帧');

  const settle = analyzeSettle(trace1, 15);
  const transitions = analyzeTransitions(trace1, 6);
  const camera = analyzeCamera(trace1, 15, geom);
  const stuck = analyzeStuck(trace1, 40);

  const allWindows = settle.flatMap((s) => s.windows);
  const anySettled = allWindows.length > 0;
  const movedEnts = settle.filter((s) => s.transitions >= 1);
  const maxFinalOff = allWindows.length ? Math.max(...allWindows.map((w) => w.finalOffset)) : NaN;
  const maxRamp = allWindows.length ? Math.max(...allWindows.map((w) => w.rampFrames)) : NaN;
  const multiFrameRamps = allWindows.filter((w) => w.rampFrames >= 2).length;

  // T1：静置窗口尾部 anim 必须已归位（=== 真实格），相机收敛到由焦点格决定的值
  check('T1-a 存在≥15帧的静置窗口（前提）', anySettled,
    '静置窗口数=' + allWindows.length + '；有位移的实体=' + movedEnts.length + '/' + settle.length);
  const allConverged = anySettled && allWindows.every((w) => w.converged && w.finalOffset === 0);
  check('T1-b 每个静置窗口尾部 anim 已归位到真实格（残差=0，非停在 30%）', allConverged,
    anySettled
      ? '窗口数=' + allWindows.length + '；最大末帧残差=' + maxFinalOff.toFixed(3)
        + '；最长收敛耗时=' + maxRamp + ' 帧；其中≥2帧收敛的窗口=' + multiFrameRamps + '（证明是逐帧逼近而非一步跳变）'
      : '无静置窗口');

  const camConverged = camera.filter((c) => c.focusConverged);
  const camStable = camera.filter((c) => c.camTailStable);
  const camExact = camera.filter((c) => c.camMatchesExpected);
  check('T1-c 焦点静置窗口尾部相机稳定（连续 15 帧不动）',
    camera.length > 0 && camStable.length === camera.length,
    '焦点静置窗口=' + camera.length + '，尾部稳定=' + camStable.length);
  check('T1-d 焦点 anim 已归位（anim === 焦点真实格）',
    camera.length > 0 && camConverged.length === camera.length,
    camera.length ? '焦点静置窗口=' + camera.length + '，已归位=' + camConverged.length : '无窗口');
  check('T1-e 相机 === f(焦点真实格)（非平凡反例：旧 bug 会停在由"从哪来"决定的错误值）',
    camera.length > 0 && camExact.length === camera.length,
    camera.length
      ? '窗口=' + camera.length + '，公式吻合=' + camExact.length
        + '；样例 final=' + JSON.stringify(camera[0].finalCam) + ' expected=' + JSON.stringify(camera[0].expectedCam)
      : '无窗口');

  // T2：静置窗口尾部 moving 必须 false、frame 必须 0（bob 不再逐帧交替 ⇒ 无抖动）
  const allMovingFalse = anySettled && allWindows.every((w) => w.finalMoving === false);
  check('T2-a 静置窗口尾部 anim.moving === false（状态机可靠归位）', allMovingFalse,
    anySettled ? '窗口数=' + allWindows.length + '；末帧 moving 非 false 的窗口=' + allWindows.filter((w) => w.finalMoving !== false).length : '无静置窗口');
  const allFrameZero = anySettled && allWindows.every((w) => w.finalFrame === 0 && w.restStable);
  check('T2-b 静置窗口尾部 frame === 0 且持续 ≥15 帧（bob 不再逐帧交替 ⇒ 无抖动）', allFrameZero,
    anySettled ? '窗口数=' + allWindows.length + '；末帧 frame≠0 或静止尾巴不足的窗口=' + allWindows.filter((w) => !(w.finalFrame === 0 && w.restStable)).length : '无静置窗口');
  // 端态检查：不存在「持续未归位」卡死段（旧 bug 的**直接**判据）
  const worstStuck = stuck.reduce((m, s) => Math.max(m, s.maxStuckRun), 0);
  check('T2-c 无「持续未归位」卡死段（最长 offset>0 连续段 < 40 帧；旧 bug 下恒达数百帧）',
    stuck.length > 0 && stuck.every((s) => !s.stuck),
    '实体数=' + stuck.length + '；最长未归位连续段=' + worstStuck + ' 帧（旧 bug 下该值≈采样总帧数）');

  // 收敛过程的逐帧证据（证明"逐帧推进"而非"一帧即停"）
  const progressed = transitions.find((t) => t.distinct >= 3 && t.reached);
  check('T2-d 移动后插值逐帧推进且到达目标（变化轴出现 ≥3 个不同值）',
    !!progressed,
    progressed
      ? progressed.axis + ' 轴序列=' + progressed.seq.slice(0, 10).map((v) => (v === null ? 'null' : v.toFixed(3))).join(' → ') + '（目标=' + progressed.target + '）'
      : (transitions.length ? '捕获 ' + transitions.length + ' 次位移，均未满足逐帧推进' : '未捕获移动事件'));

  // ================= Phase 2：T4（点击不可通行格 → 是否被渲染到墙上） =================
  await page.evaluate(() => { if (window.__e2e) window.__e2e.setAutoplay(false); });
  let myTurn = false;
  for (let i = 0; i < 240 && !myTurn; i++) {
    const d = await page.evaluate(() => (window.__e2e ? window.__e2e.debug() : null));
    if (d && d.pid && d.turnPid && d.pid === d.turnPid) myTurn = true;
    else await page.waitForTimeout(500);
  }
  log('轮到我方回合：' + myTurn);

  let t4 = { ran: false, reason: 'not-my-turn' };
  if (myTurn) {
    const readPos = () => page.evaluate(() => {
      const gv = window.__e2e.view().game;
      const me = gv.entities.find((e) => e.eid === gv.me.eid);
      return { x: me.x, y: me.y };
    });
    const waitMyTurn = async (tries) => {
      for (let i = 0; i < tries; i++) {
        const d = await page.evaluate(() => (window.__e2e ? window.__e2e.debug() : null));
        if (d && d.pid && d.turnPid && d.pid === d.turnPid) return true;
        await page.waitForTimeout(500);
      }
      return false;
    };

    // ---- 控制组（先做）：点一个「相对当前位置 d=1」的可通行邻格，证明点击确实送达 ----
    // 必须先于墙格测试：否则墙格点击本身可能让角色移动，使控制组目标格已被占用（伪阴性）。
    // 还需：重确认仍是我方回合（回合可能被看门狗/自动结束抢走）、清掉 pending 目标模式、
    // 排除被实体占位的格（否则 handleTap 会转成攻击/对话而非移动）、失败则换格重试。
    let control = null;
    for (let attempt = 0; attempt < 4 && !(control && control.moved); attempt++) {
      if (!(await waitMyTurn(20))) break;
      await page.evaluate(() => { if (window.__e2e && window.__e2e.clearPending) window.__e2e.clearPending(); });
      const ctl = await page.evaluate(() => {
        const gv = window.__e2e.view().game;
        const me = gv.entities.find((e) => e.eid === gv.me.eid);
        const cam = window.__e2e.cam(), S = window.__e2e.scale();
        const c = document.getElementById('game-canvas'), r = c.getBoundingClientRect();
        const occupied = new Set(gv.entities.filter((e) => !e.dead && e.hp > 0).map((e) => e.x + ',' + e.y));
        const cands = [];
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) {
          const x = me.x + dx, y = me.y + dy;
          if (x < 0 || y < 0 || x >= gv.map.w || y >= gv.map.h) continue;
          const ch = gv.map.tiles[y][x];
          if ((ch === '.' || ch === 'g') && !occupied.has(x + ',' + y)) cands.push({ x, y, d: Math.abs(dx) + Math.abs(dy) });
        }
        const t = cands[0] || null;
        const px = t ? { clientX: r.left + (t.x + 0.5 - cam.x) * 16 * S, clientY: r.top + (t.y + 0.5 - cam.y) * 16 * S } : null;
        return { me: { x: me.x, y: me.y }, tile: t, px, occupied: [...occupied].length };
      });
      if (!ctl.tile || !ctl.px) { control = { attempted: attempt + 1, reason: 'no-adjacent-free-walkable' }; break; }
      await page.mouse.click(ctl.px.clientX, ctl.px.clientY);
      await page.waitForTimeout(1800);
      const after = await readPos();
      const dbg = await page.evaluate(() => (window.__e2e ? window.__e2e.debug() : null));
      control = {
        attempt: attempt + 1, from: ctl.me, clickedTile: ctl.tile, after,
        moved: after.x !== ctl.me.x || after.y !== ctl.me.y,
        myTurnAfterClick: !!(dbg && dbg.pid && dbg.turnPid && dbg.pid === dbg.turnPid),
      };
      log('控制组#' + control.attempt + '：点相邻可通行格 ' + JSON.stringify(ctl.tile) + ' ' + JSON.stringify(ctl.me) + ' → ' + JSON.stringify(after));
      if (!control.moved) await page.waitForTimeout(900);
    }

    // ---- 墙格交叉核验：点最近墙格，采样 120 帧，看精灵是否被渲染到墙上 ----
    await waitMyTurn(20);
    await page.evaluate(() => { if (window.__e2e && window.__e2e.clearPending) window.__e2e.clearPending(); });
    const info = await page.evaluate(() => {
      const gv = window.__e2e.view().game;
      const me = gv.entities.find((e) => e.eid === gv.me.eid);
      const cam = window.__e2e.cam();
      const S = window.__e2e.scale();
      const c = document.getElementById('game-canvas');
      const r = c.getBoundingClientRect();
      const vwT = c.width / S / 16, vhT = c.height / S / 16;
      const x0 = Math.floor(cam.x), y0 = Math.floor(cam.y);
      const walls = [];
      for (let y = y0; y < y0 + vhT + 1; y++) {
        for (let x = x0; x < x0 + vwT + 1; x++) {
          if (x < 0 || y < 0 || x >= gv.map.w || y >= gv.map.h) continue;
          if (gv.map.tiles[y][x] === '#') walls.push({ x, y, d: Math.abs(x - me.x) + Math.abs(y - me.y) });
        }
      }
      walls.sort((a, b) => a.d - b.d);
      const w = walls[0] || null;
      const px = (t) => ({ clientX: r.left + (t.x + 0.5 - cam.x) * 16 * S, clientY: r.top + (t.y + 0.5 - cam.y) * 16 * S });
      return { me: { x: me.x, y: me.y }, cam: { x: cam.x, y: cam.y }, S, wall: w, wallPx: w ? px(w) : null };
    });
    log('墙格测试前我方格=' + JSON.stringify(info.me) + ' 最近墙格=' + JSON.stringify(info.wall));

    if (info.wall && info.wallPx) {
      const before = info.me;
      await page.mouse.click(info.wallPx.clientX, info.wallPx.clientY);
      const trace4 = await sampleFrames(page, 120);
      const myEid = await page.evaluate(() => window.__e2e.view().game.me.eid);
      const dbgW = await page.evaluate(() => (window.__e2e ? window.__e2e.debug() : null));
      const my = trace4.map((f) => f.ents.find((e) => e.eid === myEid)).filter(Boolean);
      // R1-18 现象的直接判据：精灵是否**任何一帧**被渲染在墙格上（服务器格或 anim 格命中墙格）
      const wall = info.wall;
      const serverOnWall = my.some((r) => r.ex === wall.x && r.ey === wall.y);
      const animOnWall = my.some((r) => r.ax === wall.x && r.ay === wall.y);
      const serverMoved = my.some((r) => r.ex !== before.x || r.ey !== before.y);
      const maxOff = Math.max(...my.map((r) => Math.max(Math.abs(r.ax - r.ex), Math.abs(r.ay - r.ey))));
      t4 = {
        ran: true, myEid, before, wall, control,
        myTurnAtWall: !!(dbgW && dbgW.pid && dbgW.turnPid && dbgW.pid === dbgW.turnPid),
        serverMoved, serverOnWall, animOnWall,
        maxOffsetDuringWindow: maxOff,
        animSettled: my.slice(-10).every((r) => r.ax === r.ex && r.ay === r.ey),
        note: '客户端全仓无任何乐观位移赋值（.x= 唯一命中即 R1-19 归位行）；服务器可能沿点击方向走到障碍前最后一格，但绝不进入墙格',
      };
    } else {
      t4 = { ran: true, reason: 'no-wall-in-viewport', me: info.me, control };
    }

    // T4 断言：R1-18 现象（点击不可通行格 → 角色被渲染到墙上）修好后是否复现
    if (t4.ran && t4.wall) {
      check('T4-a 点击墙格后服务器未把角色移入墙格', t4.serverOnWall === false,
        'serverOnWall=' + t4.serverOnWall + '，serverMoved=' + t4.serverMoved + '，点击时是否我方回合=' + t4.myTurnAtWall);
      check('T4-b 点击墙格后精灵未被渲染到墙格（R1-18 现象不复现）', t4.animOnWall === false,
        'animOnWall=' + t4.animOnWall + '，窗口内 anim 与真实格最大残差=' + t4.maxOffsetDuringWindow);
      check('T4-c 控制组：点击相邻可通行格确实发生位移（证明点击送达）',
        !!t4.control && t4.control.moved === true,
        t4.control ? '点击' + JSON.stringify(t4.control.clickedTile) + ' ' + JSON.stringify(t4.control.from) + '→' + JSON.stringify(t4.control.after) : '控制组未执行');
    } else {
      check('T4 交叉核验（点击墙格）未执行：非我方回合或视野内无墙格', false, JSON.stringify(t4));
    }
  }

  // ================= T3：真实对局冒烟（本测试本身就是真实对局；这里核页面错误） =================
  const realErrors = errors.filter((e) => !e.includes('AudioContext') && !e.includes('WebAudio'));
  check('T3 真实对局无新增页面错误（忽略无音频设备）', realErrors.length === 0, '错误数=' + realErrors.length + (realErrors.length ? '：' + realErrors.slice(0, 3).join(' | ') : ''));

  const passed = results.filter((r) => r.ok).length;
  const payload = {
    runAt: new Date().toISOString(),
    test: 'R1-19 插值收敛 / moving 状态机 / 相机偏移 / R1-18 交叉核验',
    port: PORT, seed: SEED,
    total: results.length, passed,
    results,
    geom,
    settle, camera, transitions, stuck, t4,
    pageErrors: realErrors,
  };
  const outFile = join(outDir, 'r1-19-interp-test.json');
  writeFileSync(outFile, JSON.stringify(payload, null, 2), 'utf8');
  log('');
  log('R1-19 行为验证：' + passed + '/' + results.length + ' 通过');
  log('证据：' + outFile);

  await browser.close();
  server.kill();
  process.exit(passed === results.length ? 0 : 1);
}

main().catch((e) => { console.error('R1-19 CRASH:', e); cleanup(); process.exit(1); });
