// R1-28 车卡「种族加点（自由加点 flex）可调性」· 行为探针（回归防线）
// 覆盖卡片验收与「补充用例场景」：
//   A) 新角色：flex 可编辑（且不破坏购点规则——剩余点数非负）
//   B) flex:0 种族：无下拉，明示「固定值」
//   C) 换种族（新角色阶段）：可调性随状态正确切换
//   D) 保存后（已创建）：flex 只读（前端禁用 + 锁定提示）
//   E) 重进/刷新（同房间）：仍只读
//   F) 直接发协议消息改 flex：服务端拒绝（贴原始响应）
//   G) 载入已创建角色（名册）：flex 只读 + 服务端拒绝
// 用法：node tools/r1-28-flex-lock-probe.mjs
//   端口默认 3110（绝不占用 3000——用户正在 3000 做人工验收）；可用 PROBE_PORT 覆盖。
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';

const PORT = Number(process.env.PROBE_PORT || 3110);
const SHOTS = 'e2e-shots';
mkdirSync(SHOTS, { recursive: true });
const dataDir = mkdtempSync(join(tmpdir(), 'dnd-r128-'));
const log = (...a) => console.log('[r1-28]', ...a);
const sleep = ms => new Promise(r => setTimeout(r, ms));

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok });
  console.log((ok ? '✅ ' : '❌ ') + name + (detail ? ' — ' + detail : ''));
}

const server = spawn(process.execPath, ['server/index.mjs'], {
  env: { ...process.env, DND_PORT: String(PORT), DND_DATA_DIR: dataDir, DND_SEED: '20240601' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
server.stdout.on('data', d => process.stdout.write('[srv] ' + d));
server.stderr.on('data', d => process.stderr.write('[srv-err] ' + d));

// 就绪探测：必须确认**本次 spawn 的**服务已监听，否则（例如 3110 上残留了上一轮的旧服务）
// 浏览器会连到旧代码上，得到「假失败/假通过」。旧服务会因 EADDRINUSE 立即退出 ⇒ 这里 fail-fast。
async function waitForServer() {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) {
      throw new Error('本次服务进程已退出(code ' + server.exitCode + ')——端口 ' + PORT + ' 可能被残留进程占用；请先释放该端口再重试');
    }
    try {
      const r = await fetch('http://localhost:' + PORT + '/');
      if (r.status < 500) return;
    } catch { /* 尚未监听，继续等 */ }
    await sleep(250);
  }
  throw new Error('服务在 15s 内未就绪（端口 ' + PORT + '）');
}

const COLORS = { skin: '#e8b88a', hair: '#4a2a18', outfit: '#304878', eye: '#2860a0', accent: '#c8a030' };

// 读取加点面板：剩余点数 + 自由加点下拉框（值/禁用）+ 说明文案
function readChargen(page) {
  return page.evaluate(() => {
    const pool = document.querySelector('.pool-info')?.textContent || '';
    const m = pool.match(/剩余点数：\s*(-?\d+)\s*\/\s*(\d+)/);
    const flexRow = [...document.querySelectorAll('.stat-row')].find(r => r.querySelector('label')?.textContent === '自由加点');
    const selects = flexRow ? [...flexRow.querySelectorAll('select')].map(s => ({ value: s.value, disabled: s.disabled })) : [];
    const notes = [...document.querySelectorAll('.stat-note')].map(n => (n.textContent || '').trim());
    const raceSel = [...document.querySelectorAll('.opt-card.sel .oc-name')].map(n => n.textContent.trim());
    return { pool, remaining: m ? Number(m[1]) : null, flexRowPresent: !!flexRow, selects, notes, selected: raceSel };
  });
}

async function newUserPage(browser, tag) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  await page.addInitScript(() => {
    window.__toasts = [];
    const attach = () => new MutationObserver(() => {
      document.querySelectorAll('.toast').forEach(t => {
        const s = (t.textContent || '').trim();
        if (s && window.__toasts[window.__toasts.length - 1] !== s) window.__toasts.push(s);
      });
    }).observe(document.documentElement, { childList: true, subtree: true, characterData: true });
    if (document.documentElement) attach(); else document.addEventListener('DOMContentLoaded', attach);
  });
  await page.goto('http://localhost:' + PORT + '/');
  await page.setDefaultTimeout(20000);
  await page.waitForSelector('.lobby-title');
  const uname = tag + Date.now().toString(36).slice(-5);
  await page.waitForSelector('.dialog-overlay .auth-input');
  await page.click('.dialog-overlay .seg-btn:has-text("注册")');
  await page.fill('.dialog-overlay input[placeholder*="用户名"]', uname);
  await page.fill('.dialog-overlay input[type="password"]', 'probe1234');
  await page.click('.dialog-overlay .btn.gold');
  await page.waitForSelector('.dialog-overlay', { state: 'detached', timeout: 12000 });
  await page.waitForSelector('.persona-grid .persona-card', { timeout: 12000 });
  await page.locator('.persona-grid .persona-card').nth(1).click();
  await page.locator('.create-box .btn.gold').first().click();
  await page.waitForSelector('.room-code', { timeout: 15000 });
  return { page, ctx, errors };
}

const pickRace = (page, idx) => page.locator('.opt-grid').nth(0).locator('.opt-card').nth(idx).click();
const pickClass = (page, idx) => page.locator('.opt-grid').nth(1).locator('.opt-card').nth(idx).click();

// 直接发协议消息（绕过界面）。
// 返回 { toast, newToast }：newToast 表示「本次发送**新**冒出了一条 toast」——
// 只有新 toast 才代表本次被拒；若沿用旧 toast 会误判（把「被接受、无提示」当成「上一条拒绝」）。
async function sendSheet(page, sheet) {
  const before = await page.evaluate(() => (window.__toasts || []).length);
  await page.evaluate((s) => { window.__S.net.send('room:charsheet', { sheet: s }); }, sheet);
  await sleep(700);
  const after = await page.evaluate(() => (window.__toasts || []).length);
  const toast = await page.evaluate(() => (window.__toasts || []).slice(-1)[0] || '');
  return { toast, newToast: after > before };
}
// 读取服务端已保存 sheet 的关键字段（用于证明「被接受后确实写入」/「被拒后未被改动」）
function readStored(page) {
  return page.evaluate(() => {
    const s = window.__S.view && window.__S.view.mySheet;
    return s ? { flex: s.flex, base: s.base, background: s.background, race: s.race } : null;
  });
}

async function main() {
  await waitForServer();
  const browser = await chromium.launch();

  // ===== A) 新角色：flex 可编辑（不破坏购点规则）=====
  {
    const { page, errors } = await newUserPage(browser, 'r128a');
    await pickRace(page, 0); // 人类（flex:2）
    await pickClass(page, 0); // 战士
    await sleep(400);
    const a = await readChargen(page);
    log('新角色（人类）快照：', JSON.stringify(a));
    check('A) 新角色：出现 2 个自由加点下拉框', a.selects.length === 2, 'count=' + a.selects.length);
    check('A) 新角色：自由加点下拉框可编辑（未禁用）', a.selects.every(s => s.disabled === false), JSON.stringify(a.selects));
    check('A) 新角色：剩余点数非负（购点规则未破坏）', a.remaining !== null && a.remaining >= 0, 'remaining=' + a.remaining);
    check('A) 新角色：无「已创建锁定」提示', !a.notes.some(t => /已创建/.test(t)), JSON.stringify(a.notes));

    // 改一个自由加点下拉框 → 应生效（数值/派生随之变化，且不占购点）
    const remBefore = a.remaining;
    await page.evaluate(() => {
      const row = [...document.querySelectorAll('.stat-row')].find(r => r.querySelector('label')?.textContent === '自由加点');
      const sel = row.querySelectorAll('select')[0];
      sel.value = 'CHA'; sel.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await sleep(300);
    const a2 = await readChargen(page);
    check('A) 新角色：改自由加点生效（下拉框值已改）', a2.selects[0]?.value === 'CHA', JSON.stringify(a2.selects));
    check('A) 新角色：改自由加点不影响剩余点数（自由加点不计入购点）', a2.remaining === remBefore, remBefore + ' → ' + a2.remaining);

    // ===== B) flex:0 种族：无下拉 + 固定值提示 =====
    await pickRace(page, 1); // 精灵（flex:0）
    await sleep(300);
    const b = await readChargen(page);
    log('新角色（精灵）快照：', JSON.stringify(b));
    check('B) flex:0 种族：无自由加点下拉框', b.flexRowPresent === false, 'flexRowPresent=' + b.flexRowPresent);
    check('B) flex:0 种族：明示「属性加成是固定值」', b.notes.some(t => /固定值/.test(t)), JSON.stringify(b.notes));

    // ===== C) 换种族（新角色阶段）：可调性随状态正确切换 =====
    await pickRace(page, 0); // 回到人类（flex:2）
    await sleep(300);
    const c = await readChargen(page);
    check('C) 换种族 human→elf→human：下拉框重新出现且可编辑', c.selects.length === 2 && c.selects.every(s => !s.disabled), JSON.stringify(c.selects));
    check('C) 换种族后剩余点数非负', c.remaining !== null && c.remaining >= 0, 'remaining=' + c.remaining);

    // ===== D) 保存后（已创建）：flex 只读 =====
    await page.fill('input[placeholder="为你的角色起个名字"]', '锁甲');
    await page.locator('button:has-text("保存车卡")').click();
    await sleep(1800);
    const d = await readChargen(page);
    log('保存后快照：', JSON.stringify(d));
    const dStored = await page.evaluate(() => { const s = window.__S.view && window.__S.view.mySheet; return s ? { flex: s.flex, base: s.base } : null; });
    log('D) 服务端已保存 sheet（flex/base）：', JSON.stringify(dStored));
    check('D) 保存后（已创建）：自由加点下拉框被禁用', d.selects.length === 2 && d.selects.every(s => s.disabled === true), JSON.stringify(d.selects));
    check('D) 保存后：出现「已创建…已锁定」提示', d.notes.some(t => /已创建/.test(t) && /锁定/.test(t)), JSON.stringify(d.notes));

    // ===== E) 重进/刷新（同房间）：仍只读 =====
    await page.reload();
    await page.waitForSelector('.room-code', { timeout: 20000 });
    await page.waitForSelector('.pool-info', { timeout: 15000 });
    await sleep(600);
    const e = await readChargen(page);
    log('重进后快照：', JSON.stringify(e));
    check('E) 重进后：自由加点下拉框仍被禁用', e.selects.length === 2 && e.selects.every(s => s.disabled === true), JSON.stringify(e.selects));
    check('E) 重进后：剩余点数非负（R1-22 的 -3 未复现）', e.remaining !== null && e.remaining >= 0, 'remaining=' + e.remaining);

    // ===== F) 直接发协议消息改 flex：服务端拒绝 =====
    const baseStats = { STR: 15, DEX: 13, CON: 14, INT: 10, WIS: 10, CHA: 8 };
    const resp = await sendSheet(page, { name: '锁甲', raceId: 'human', classId: 'fighter', stats: baseStats, flex: { DEX: 1, CON: 1 }, level: 1, xp: 0 });
    log('直接改 flex 的服务端响应：', JSON.stringify(resp));
    check('F) 直接发协议消息改 flex ⇒ 服务端拒绝（带回执）', resp.newToast && /已创建|种族加点/.test(resp.toast), JSON.stringify(resp));
    // 同一角色、flex 不变、只改背景 ⇒ 应被接受（未越界）
    const okResp = await sendSheet(page, { name: '锁甲', raceId: 'human', classId: 'fighter', stats: baseStats, flex: { STR: 1, CON: 1 }, background: '改了背景', level: 1, xp: 0 });
    log('flex 不变改背景的响应：', JSON.stringify(okResp));
    const storedAfterOk = await readStored(page);
    log('flex 不变改背景后服务端存储：', JSON.stringify(storedAfterOk));
    check('F) flex 不变（仅改背景）⇒ 被接受（无新拒绝提示 + 服务端已写入背景）',
      !okResp.newToast && storedAfterOk && storedAfterOk.background === '改了背景',
      JSON.stringify(okResp) + ' | stored=' + JSON.stringify(storedAfterOk));

    // ===== H) 已创建角色：种族身份锁定（用户裁定补充）=====
    // 种族卡片状态（第一组 .opt-grid 即种族网格）
    const raceCards = await page.evaluate(() => {
      const grid = document.querySelectorAll('.opt-grid')[0];
      return [...grid.querySelectorAll('.opt-card')].map(c => ({
        name: (c.querySelector('.oc-name')?.textContent || '').trim(),
        locked: c.classList.contains('locked'),
        pe: getComputedStyle(c).pointerEvents,
      }));
    });
    log('已创建角色·种族卡片：', JSON.stringify(raceCards.map(c => ({ n: c.name, locked: c.locked, pe: c.pe }))));
    check('H) 已创建角色：所有种族卡片被锁定（locked 类 + pointer-events:none）',
      raceCards.length > 0 && raceCards.every(c => c.locked && c.pe === 'none'),
      JSON.stringify(raceCards.slice(0, 2)));

    // 真实点击另一个种族卡片 ⇒ 选中不变（pointer-events:none 生效）
    const selBefore = await page.evaluate(() => [...document.querySelectorAll('.opt-grid')[0].querySelectorAll('.opt-card.sel .oc-name')].map(n => n.textContent.trim()));
    await page.locator('.opt-grid').nth(0).locator('.opt-card').nth(1).click({ force: true }).catch(() => {});
    await sleep(300);
    const selAfter = await page.evaluate(() => [...document.querySelectorAll('.opt-grid')[0].querySelectorAll('.opt-card.sel .oc-name')].map(n => n.textContent.trim()));
    check('H) 已创建角色：点击其他种族卡片不改变选中', JSON.stringify(selBefore) === JSON.stringify(selAfter), JSON.stringify(selBefore) + ' → ' + JSON.stringify(selAfter));

    // 直发协议消息：改 raceId（flex 不变）⇒ 服务端拒绝（贴原始响应）
    const raceResp = await sendSheet(page, { name: '锁甲', raceId: 'halfelf', classId: 'fighter', stats: baseStats, flex: { STR: 1, CON: 1 }, level: 1, xp: 0 });
    log('直接改 raceId 的服务端响应：', JSON.stringify(raceResp));
    check('H) 直接发协议消息改 raceId（flex 不变）⇒ 服务端拒绝', raceResp.newToast && /已创建|种族/.test(raceResp.toast), JSON.stringify(raceResp));

    // 换种族被拒后：种族/flex/base 均不受影响（未引入新 bug）
    const storedAfterRace = await readStored(page);
    log('改 raceId 被拒后服务端存储：', JSON.stringify(storedAfterRace));
    check('H) 改 raceId 被拒后：种族仍为 human，flex/base 不受影响',
      storedAfterRace && storedAfterRace.race === 'human'
        && JSON.stringify(storedAfterRace.flex) === JSON.stringify({ STR: 1, CON: 1 })
        && JSON.stringify(storedAfterRace.base) === JSON.stringify(baseStats),
      JSON.stringify(storedAfterRace));

    check('A–H) 无脚本错误', errors.length === 0, errors.slice(0, 2).join(' | '));
    await page.screenshot({ path: SHOTS + '/r1-28-flex-lock.png' });
    await page.close();
  }

  // ===== G) 载入已创建角色（名册）：flex 只读 + 服务端拒绝 =====
  {
    const { page, errors } = await newUserPage(browser, 'r128g');
    // 注入一名半精灵（flex:2）名册角色，再通过下拉载入
    await page.evaluate((colors) => {
      const mk = (id, name, raceId, classId, stats, flex) => ({ id, name, raceId, classId, stats, flex, colors, background: '', status: 'alive', createdAt: Date.now(), updatedAt: Date.now() });
      localStorage.setItem('dnd_roster', JSON.stringify([
        mk('ro_g', '旧角色', 'halfelf', 'rogue', { STR: 10, DEX: 15, CON: 14, INT: 10, WIS: 10, CHA: 8 }, { CHA: 1, DEX: 1 }),
      ]));
    }, COLORS);
    await page.reload();
    await page.waitForSelector('.room-code', { timeout: 20000 });
    await page.waitForSelector('.cg-section select', { timeout: 15000 });

    const pre = await readChargen(page);
    check('G-pre) 载入前（新角色）：无锁定提示', !pre.notes.some(t => /已创建/.test(t)), JSON.stringify(pre.notes));
    // 新角色：种族卡片未被锁定（别把好的也锁了）
    const preRaceLocked = await page.evaluate(() => {
      const grid = document.querySelectorAll('.opt-grid')[0];
      return [...grid.querySelectorAll('.opt-card')].some(c => c.classList.contains('locked'));
    });
    check('G-pre) 载入前（新角色）：种族卡片**未**锁定（新角色仍可自由换种族）', preRaceLocked === false, 'anyLocked=' + preRaceLocked);

    // 载入名册角色（首个 .cg-section select 即名册下拉）
    await page.selectOption('.cg-section select', { index: 1 });
    await sleep(1800);
    const g = await readChargen(page);
    log('载入名册角色后快照：', JSON.stringify(g));
    check('G) 载入已创建角色：自由加点下拉框被禁用（前端）', g.selects.length === 2 && g.selects.every(s => s.disabled === true), JSON.stringify(g.selects));
    check('G) 载入已创建角色：出现「已创建…已锁定」提示', g.notes.some(t => /已创建/.test(t)), JSON.stringify(g.notes));
    check('G) 载入已创建角色：剩余点数非负', g.remaining !== null && g.remaining >= 0, 'remaining=' + g.remaining);

    // 服务端拒绝：直接发协议消息改 flex
    const resp = await sendSheet(page, { name: '旧角色', raceId: 'halfelf', classId: 'rogue', stats: { STR: 10, DEX: 15, CON: 14, INT: 10, WIS: 10, CHA: 8 }, flex: { STR: 1, CON: 1 }, level: 1, xp: 0 });
    log('载入后直接改 flex 的服务端响应：', JSON.stringify(resp));
    check('G) 载入已创建角色后直接改 flex ⇒ 服务端拒绝', resp.newToast && /已创建|种族加点/.test(resp.toast), JSON.stringify(resp));

    check('G) 无脚本错误', errors.length === 0, errors.slice(0, 2).join(' | '));
    await page.close();
  }

  const failed = results.filter(r => !r.ok);
  console.log('\n===== R1-28 种族加点可调性探针：' + (results.length - failed.length) + '/' + results.length + ' 通过 =====');
  if (failed.length) console.log('失败项：\n  - ' + failed.map(f => f.name).join('\n  - '));
  await browser.close().catch(() => {});
  server.kill();
  await sleep(300);
  process.exit(failed.length ? 1 : 0);
}

main().catch(async e => { console.error('[r1-28] 探针异常', e); server.kill(); process.exit(1); });
