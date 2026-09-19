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
  await sleep(1100);
  const after = await page.evaluate(() => (window.__toasts || []).length);
  const toast = await page.evaluate(() => (window.__toasts || []).slice(-1)[0] || '');
  return { toast, newToast: after > before };
}
// 读取服务端已保存 sheet 的关键字段（用于证明「被接受后确实写入」/「被拒后未被改动」）
function readStored(page) {
  return page.evaluate(() => {
    const s = window.__S.view && window.__S.view.mySheet;
    return s ? { flex: s.flex, base: s.base, background: s.background, race: s.race, colors: s.colors, name: s.name, class: s.class, level: s.level, xp: s.xp } : null;
  });
}
// 用「当前服务端已存 sheet」构造一份等价 payload —— 作为「只改某字段」的基线，
// 避免硬编码值与真实存储漂移（R1-28 补充后 background 等也在锁内，硬编码会误判）。
function currentPayload(page) {
  return page.evaluate(() => {
    const s = window.__S.view && window.__S.view.mySheet;
    return s ? { name: s.name, raceId: s.race, classId: s.class, stats: s.base, flex: s.flex, level: s.level, xp: s.xp, background: s.background, colors: s.colors, look: s.look } : null;
  });
}
// 构造一个与给定 flex「确定不同」的自由加点分配（用于验证「改 flex ⇒ 拒绝」）。
// 取第一个属性，换成另一个尚未使用的属性；保持总点数不变。
function differentFlex(flex) {
  const all = ['STR', 'DEX', 'CON', 'INT', 'WIS', 'CHA'];
  const keys = Object.keys(flex || {});
  if (keys.length === 0) return { STR: 1 };
  const first = keys[0];
  const other = all.find(k => k !== first && !keys.includes(k)) || (first === 'STR' ? 'DEX' : 'STR');
  const out = { ...flex };
  delete out[first];
  out[other] = (out[other] || 0) + 1;
  return out;
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
    // 用「当前服务端已存 sheet」作基线（避免硬编码值与真实存储漂移）。
    const base = await currentPayload(page);
    log('F) 基线 payload（取自服务端已存 sheet）：', JSON.stringify(base));
    check('F) 基线 payload 非空（已创建角色的存储可读）', !!base, JSON.stringify(base));
    const resp = await sendSheet(page, { ...base, flex: differentFlex(base.flex) });
    log('直接改 flex 的服务端响应：', JSON.stringify(resp));
    check('F) 直接发协议消息改 flex ⇒ 服务端拒绝（带回执）', resp.newToast && /已创建|种族加点/.test(resp.toast), JSON.stringify(resp));
    // 同一角色、只改外观 colors/look ⇒ 应被接受（外观不在锁内）
    const okResp = await sendSheet(page, { ...base, colors: { ...base.colors, skin: '#123456' }, look: { ...base.look, hair: 5 } });
    log('只改外观 colors/look 的响应：', JSON.stringify(okResp));
    const storedAfterOk = await readStored(page);
    log('只改外观后服务端存储：', JSON.stringify(storedAfterOk));
    check('F) 只改外观（colors/look）⇒ 被接受（无新拒绝提示 + 服务端已写入）',
      !okResp.newToast && storedAfterOk && storedAfterOk.colors && storedAfterOk.colors.skin === '#123456',
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

    // 直发协议消息：改 raceId（其余不变）⇒ 服务端拒绝（贴原始响应）
    const raceResp = await sendSheet(page, { ...base, raceId: base.raceId === 'human' ? 'halfelf' : 'human' });
    log('直接改 raceId 的服务端响应：', JSON.stringify(raceResp));
    check('H) 直接发协议消息改 raceId（其余不变）⇒ 服务端拒绝', raceResp.newToast && /已创建|种族/.test(raceResp.toast), JSON.stringify(raceResp));

    // 换种族被拒后：race/flex/base 均不受影响（未引入新 bug）
    const storedAfterRace = await readStored(page);
    log('改 raceId 被拒后服务端存储：', JSON.stringify(storedAfterRace));
    check('H) 改 raceId 被拒后：种族仍为原值，flex/base 不受影响',
      storedAfterRace && storedAfterRace.race === base.raceId
        && JSON.stringify(storedAfterRace.flex) === JSON.stringify(base.flex)
        && JSON.stringify(storedAfterRace.base) === JSON.stringify(base.stats),
      JSON.stringify(storedAfterRace));

    // ===== I) 已创建角色：除「外观」外全锁（用户 2026-09-20 依审计裁定）=====
    // 基线取自服务端已存 sheet（base）；逐个字段直发协议消息，验证被点名拒绝。
    const fieldCases = [
      { label: '职业 classId', patch: { classId: base.classId === 'wizard' ? 'fighter' : 'wizard' }, expect: /职业/ },
      { label: '等级 level', patch: { level: base.level >= 4 ? 1 : base.level + 1 }, expect: /等级/ },
      { label: '经验 xp', patch: { xp: (base.xp || 0) + 99999 }, expect: /经验/ },
      { label: '属性 stats', patch: { stats: { ...base.stats, STR: base.stats.STR - 1, DEX: base.stats.DEX + 1 } }, expect: /属性/ },
      { label: '名字 name', patch: { name: base.name === '换个名' ? '锁甲' : '换个名' }, expect: /名字/ },
      { label: '背景 background', patch: { background: base.background === '新背景' ? '旧背景' : '新背景' }, expect: /背景/ },
      { label: '种族 raceId', patch: { raceId: base.raceId === 'human' ? 'halfelf' : 'human' }, expect: /种族/ },
      { label: '自由加点 flex', patch: { flex: differentFlex(base.flex) }, expect: /种族加点/ },
    ];
    for (const fc of fieldCases) {
      const beforeStored = await readStored(page);
      const r = await sendSheet(page, { ...base, ...fc.patch });
      const afterStored = await readStored(page);
      log('I) 改「' + fc.label + '」⇒ resp=' + JSON.stringify(r)
        + ' | storedBefore=' + JSON.stringify(beforeStored)
        + ' | storedAfter=' + JSON.stringify(afterStored));
      check('I) 已创建角色：改「' + fc.label + '」⇒ 服务端拒绝（点名该字段）',
        r.newToast && fc.expect.test(r.toast), JSON.stringify(r) + ' | storedAfter=' + JSON.stringify(afterStored));
      // 复位基线：把服务端存储改回 base（修复版：无差异 ⇒ 被接受且无副作用；
      // 修复前：可把被误改的字段重置，避免逐字段证据互相污染/串味）。
      await sendSheet(page, base);
    }
    // 外观 colors / look ⇒ 应被接受（不在锁内）
    // 注意：toast 检测易受「上一条拒绝 toast 尚未消失」干扰 ⇒ 以**服务端存储是否真的写入**为准。
    const beforeLook = await readStored(page);
    const lookResp = await sendSheet(page, { ...base, colors: { ...base.colors, skin: '#654321' }, look: { ...base.look, hair: 3 } });
    log('I) 改外观 colors/look ⇒', JSON.stringify(lookResp));
    await sleep(400);
    const afterLook = await readStored(page);
    log('I) 改外观前后 colors.skin：', (beforeLook && beforeLook.colors && beforeLook.colors.skin) + ' → ' + (afterLook && afterLook.colors && afterLook.colors.skin));
    check('I) 已创建角色：改外观 colors/look ⇒ 被接受（服务端已写入 skin=#654321）',
      !!afterLook && !!afterLook.colors && afterLook.colors.skin === '#654321',
      'toast=' + JSON.stringify(lookResp) + ' | stored=' + JSON.stringify(afterLook));

    // 前端控件：除外观外全部只读/禁用
    const ui = await page.evaluate(() => {
      const grids = document.querySelectorAll('.opt-grid');
      const raceCards = [...grids[0].querySelectorAll('.opt-card')];
      const classCards = [...grids[1].querySelectorAll('.opt-card')];
      const nameEl = document.querySelector('input[placeholder="为你的角色起个名字"]');
      const bgEl = document.querySelector('textarea');
      const statBtns = [...document.querySelectorAll('.stat-row .btn.small')];
      const flexSel = [...document.querySelectorAll('.stat-row select')];
      return {
        raceLocked: raceCards.length > 0 && raceCards.every(c => c.classList.contains('locked')),
        classLocked: classCards.length > 0 && classCards.every(c => c.classList.contains('locked')),
        nameReadOnly: !!(nameEl && nameEl.readOnly),
        bgReadOnly: !!(bgEl && bgEl.readOnly),
        statBtnsDisabled: statBtns.length > 0 && statBtns.every(b => b.disabled),
        flexDisabled: flexSel.length > 0 && flexSel.every(s => s.disabled),
      };
    });
    log('I) 前端控件状态：', JSON.stringify(ui));
    check('I) 前端：种族卡片锁', ui.raceLocked, JSON.stringify(ui));
    check('I) 前端：职业卡片锁', ui.classLocked, JSON.stringify(ui));
    check('I) 前端：名字只读', ui.nameReadOnly, JSON.stringify(ui));
    check('I) 前端：背景只读', ui.bgReadOnly, JSON.stringify(ui));
    check('I) 前端：属性 ± 按钮禁用', ui.statBtnsDisabled, JSON.stringify(ui));
    check('I) 前端：自由加点下拉禁用', ui.flexDisabled, JSON.stringify(ui));

    check('A–I) 无脚本错误', errors.length === 0, errors.slice(0, 2).join(' | '));
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
    // 新角色：种族/职业卡片、名字、背景均未被锁（别把好的也锁了）
    const preLock = await page.evaluate(() => {
      const anyCardLocked = [...document.querySelectorAll('.opt-card')].some(c => c.classList.contains('locked'));
      const nameEl = document.querySelector('input[placeholder="为你的角色起个名字"]');
      const bgEl = document.querySelector('textarea');
      return { anyCardLocked, nameReadOnly: !!(nameEl && nameEl.readOnly), bgReadOnly: !!(bgEl && bgEl.readOnly) };
    });
    check('G-pre) 载入前（新角色）：种族/职业卡片**未**锁定（新角色仍可自由换）', preLock.anyCardLocked === false, JSON.stringify(preLock));
    check('G-pre) 载入前（新角色）：名字/背景**未**只读', preLock.nameReadOnly === false && preLock.bgReadOnly === false, JSON.stringify(preLock));

    // 载入名册角色（首个 .cg-section select 即名册下拉）
    await page.selectOption('.cg-section select', { index: 1 });
    await sleep(1800);
    const g = await readChargen(page);
    log('载入名册角色后快照：', JSON.stringify(g));
    check('G) 载入已创建角色：自由加点下拉框被禁用（前端）', g.selects.length === 2 && g.selects.every(s => s.disabled === true), JSON.stringify(g.selects));
    check('G) 载入已创建角色：出现「已创建…已锁定」提示', g.notes.some(t => /已创建/.test(t)), JSON.stringify(g.notes));
    check('G) 载入已创建角色：剩余点数非负', g.remaining !== null && g.remaining >= 0, 'remaining=' + g.remaining);

    // 前端：载入名册角色后，除外观外全部只读/禁用
    const gUi = await page.evaluate(() => {
      const grids = document.querySelectorAll('.opt-grid');
      const raceCards = [...grids[0].querySelectorAll('.opt-card')];
      const classCards = [...grids[1].querySelectorAll('.opt-card')];
      const nameEl = document.querySelector('input[placeholder="为你的角色起个名字"]');
      const bgEl = document.querySelector('textarea');
      const statBtns = [...document.querySelectorAll('.stat-row .btn.small')];
      return {
        raceLocked: raceCards.length > 0 && raceCards.every(c => c.classList.contains('locked')),
        classLocked: classCards.length > 0 && classCards.every(c => c.classList.contains('locked')),
        nameReadOnly: !!(nameEl && nameEl.readOnly),
        bgReadOnly: !!(bgEl && bgEl.readOnly),
        statBtnsDisabled: statBtns.length > 0 && statBtns.every(b => b.disabled),
      };
    });
    log('G) 载入名册角色后前端控件：', JSON.stringify(gUi));
    check('G) 载入已创建角色：种族/职业卡片锁 + 名字/背景只读 + 属性按钮禁用',
      gUi.raceLocked && gUi.classLocked && gUi.nameReadOnly && gUi.bgReadOnly && gUi.statBtnsDisabled, JSON.stringify(gUi));

    // 服务端拒绝：直接发协议消息改 flex（基线取自服务端已存 sheet，避免硬编码漂移）
    const gBase = await currentPayload(page);
    log('G) 载入角色基线 payload：', JSON.stringify(gBase));
    const resp = await sendSheet(page, { ...gBase, flex: differentFlex(gBase.flex) });
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
