// R1-22 车卡加点显示修复 · 行为探针（回归防线）
// 覆盖卡片「补充用例场景」中无法用纯单测覆盖的界面行为：
//   A) 载入已有角色（重进/重连后）剩余点数不为负、数值正确、种族加成可见、最终值不二次叠加
//   B) 剩余点数恰为 0 时显示 "0"（不是 -0 / 空白）
//   C) 边界值：基础值到下限 8 / 上限 15 时按钮禁用
//   D) 换种族后剩余点数与种族加成即时刷新
//   E) 多角色切换不串号
//   F) 异常输入被服务端拒绝且有反馈
// 用法：node tools/r1-22-chargen-points-probe.mjs
//   端口默认 3110（绝不占用 3000——用户正在 3000 做人工验收）；可用 PROBE_PORT 覆盖。
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';

const PORT = Number(process.env.PROBE_PORT || 3110);
const SHOTS = 'e2e-shots';
mkdirSync(SHOTS, { recursive: true });
const dataDir = mkdtempSync(join(tmpdir(), 'dnd-r122-'));
const log = (...a) => console.log('[r1-22]', ...a);
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

const COLORS = { skin: '#e8b88a', hair: '#4a2a18', outfit: '#304878', eye: '#2860a0', accent: '#c8a030' };

// 读取车卡加点面板的结构化快照（原始界面取值）
function readChargen(page) {
  return page.evaluate(() => {
    const pool = document.querySelector('.pool-info')?.textContent || '';
    const m = pool.match(/剩余点数：\s*(-?\d+)\s*\/\s*(\d+)/);
    const rows = [...document.querySelectorAll('.stat-row')].map(r => {
      const btns = r.querySelectorAll('button');
      return {
        label: r.querySelector('label')?.textContent || '',
        val: (r.querySelector('.sr-val')?.childNodes[0]?.textContent || '').trim(),
        bonus: (r.querySelector('.sr-bonus')?.textContent || '').trim(),
        mod: (r.querySelector('.sr-mod')?.textContent || '').trim(),
        minusDisabled: btns[0] ? btns[0].disabled : null,
        plusDisabled: btns[1] ? btns[1].disabled : null,
      };
    });
    return { pool, remaining: m ? Number(m[1]) : null, poolMax: m ? Number(m[2]) : null, rows };
  });
}

async function spendAll(page) {
  for (let n = 0; n < 80; n++) {
    const clicked = await page.evaluate(() => {
      for (const r of document.querySelectorAll('.stat-row')) {
        const plus = r.querySelectorAll('button')[1];
        if (plus && !plus.disabled) { plus.click(); return true; }
      }
      return false;
    });
    if (!clicked) break;
  }
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

async function main() {
  await sleep(1500);
  const browser = await chromium.launch();

  // ===== 场景 A/B/C/D =====
  {
    const { page, errors } = await newUserPage(browser, 'r122');
    // 精灵(种族 DEX+2/WIS+1) + 战士
    await page.locator('.opt-grid').nth(0).locator('.opt-card').nth(1).click();
    await page.locator('.opt-grid').nth(1).locator('.opt-card').nth(0).click();
    await sleep(300);

    // 用满 27 点基础值
    await spendAll(page);
    const spent = await readChargen(page);
    log('满购点快照：', JSON.stringify(spent));
    check('B) 剩余点数用满时显示 0（非 -0/空白）', spent.remaining === 0 && !/-0/.test(spent.pool), 'pool="' + spent.pool + '"');

    // 记录 DEX 行（种族+2）与 WIS 行（种族+1）
    const dexRow = spent.rows.find(r => r.label === '敏捷');
    check('D-pre) 精灵 DEX 行显示种族加成 +2', /种族\+2/.test(dexRow?.bonus || ''), JSON.stringify(dexRow));
    check('A-pre) DEX 最终值 = 基础 + 种族（无二次叠加）', /→ 17/.test(dexRow?.mod || ''), JSON.stringify(dexRow));

    // 填名 + 保存
    await page.fill('input[placeholder="为你的角色起个名字"]', 'KellyMi');
    await page.locator('button:has-text("保存车卡")').click();
    await sleep(1500);

    // ===== A) 重进/重连（刷新页面 → 服务端恢复房间 → 载入已有角色）=====
    await page.reload();
    await page.waitForSelector('.room-code', { timeout: 20000 });
    await page.waitForSelector('.pool-info', { timeout: 15000 });
    await sleep(400);
    const loaded = await readChargen(page);
    log('重进后快照：', JSON.stringify(loaded));
    check('A) 重进/重连后剩余点数不为负', loaded.remaining !== null && loaded.remaining >= 0, 'remaining=' + loaded.remaining);
    check('A) 重进/重连后剩余点数正确 = 0（修复前为 -3）', loaded.remaining === 0, 'remaining=' + loaded.remaining);
    const dexLoaded = loaded.rows.find(r => r.label === '敏捷');
    check('A) 重进后 DEX 行种族加成可见（+2 种族+2）', /种族\+2/.test(dexLoaded?.bonus || ''), JSON.stringify(dexLoaded));
    check('A) 重进后 DEX 基础值=15（未被当成含加成的最终值）', dexLoaded?.val === '15', JSON.stringify(dexLoaded));
    check('A) 重进后 DEX 最终值仍为 17（未二次叠加成 19）', /→ 17/.test(dexLoaded?.mod || ''), JSON.stringify(dexLoaded));

    // ===== C) 边界值：满购点时 + 全禁用；MIN 处 − 禁用 =====
    const full = await readChargen(page);
    check('C) 剩余 0 时全部 + 按钮禁用', full.rows.every(r => r.plusDisabled === true), JSON.stringify(full.rows.map(r => r.plusDisabled)));
    // 把 DEX 降到下限 8，验证 − 禁用
    for (let i = 0; i < 10; i++) {
      await page.evaluate(() => {
        const r = [...document.querySelectorAll('.stat-row')].find(x => x.querySelector('label')?.textContent === '敏捷');
        const minus = r?.querySelectorAll('button')[0];
        if (minus && !minus.disabled) minus.click();
      });
    }
    const low = await readChargen(page);
    const dexLow = low.rows.find(r => r.label === '敏捷');
    check('C) 基础值到下限 8 时 − 按钮禁用', dexLow?.val === '8' && dexLow?.minusDisabled === true, JSON.stringify(dexLow));
    check('C) 降低基础值后剩余点数回滚（不为负）', low.remaining !== null && low.remaining >= 0 && low.remaining > 0, 'remaining=' + low.remaining);

    // ===== D) 换种族即时刷新 =====
    await page.locator('.opt-grid').nth(0).locator('.opt-card').nth(2).click(); // 矮人 CON+2/STR+1
    await sleep(300);
    const dwarf = await readChargen(page);
    log('换矮人后快照：', JSON.stringify(dwarf));
    const conRow = dwarf.rows.find(r => r.label === '体质');
    check('D) 换种族后种族加成即时刷新（矮人 体质 种族+2）', /种族\+2/.test(conRow?.bonus || ''), JSON.stringify(conRow));
    check('D) 换种族后剩余点数重算且非负', dwarf.remaining !== null && dwarf.remaining >= 0, 'remaining=' + dwarf.remaining);

    check('A/B/C/D) 无脚本错误', errors.length === 0, errors.slice(0, 2).join(' | '));
    await page.screenshot({ path: SHOTS + '/r1-22-chargen-points.png' });
    await page.close();
  }

  // ===== E) 多角色切换不串号 =====
  {
    const { page } = await newUserPage(browser, 'r122m');
    // 直接注入两名差异明显的名册角色，再用下拉切换
    await page.evaluate((colors) => {
      const mk = (id, name, raceId, classId, stats, flex) => ({ id, name, raceId, classId, stats, flex, colors, background: '', status: 'alive', createdAt: Date.now(), updatedAt: Date.now() });
      localStorage.setItem('dnd_roster', JSON.stringify([
        mk('ro_A', '角色甲', 'elf', 'fighter', { STR: 15, DEX: 15, CON: 15, INT: 10, WIS: 10, CHA: 10 }, {}),                 // 用满 27
        mk('ro_B', '角色乙', 'halfelf', 'rogue', { STR: 10, DEX: 15, CON: 14, INT: 10, WIS: 10, CHA: 8 }, { CHA: 1, DEX: 1 }), // 19 点 + 自由2
      ]));
    }, COLORS);
    await page.reload();
    await page.waitForSelector('.room-code', { timeout: 20000 });
    await page.waitForSelector('.cg-section select', { timeout: 15000 });

    const pick = async (idx) => {
      await page.selectOption('.cg-section select', { index: idx });
      await sleep(600);
      return readChargen(page);
    };
    const a = await pick(1); // 第一项角色（默认选项 index0 为占位）
    const b = await pick(2);
    log('角色甲快照：', JSON.stringify(a));
    log('角色乙快照：', JSON.stringify(b));
    check('E) 角色甲剩余点数=0 且非负', a.remaining === 0, 'remaining=' + a.remaining);
    check('E) 角色乙剩余点数=8 且非负', b.remaining === 8, 'remaining=' + b.remaining);
    check('E) 两角色不串号（甲≠乙）', a.remaining !== b.remaining, a.remaining + ' vs ' + b.remaining);
    const aDex = a.rows.find(r => r.label === '敏捷');
    const bDex = b.rows.find(r => r.label === '敏捷');
    check('E) 甲为精灵（DEX 种族+2）', /种族\+2/.test(aDex?.bonus || ''), JSON.stringify(aDex));
    check('E) 乙为半精灵（DEX 自由+1，无 DEX 种族）', /自由\+1/.test(bDex?.bonus || '') && !/种族/.test(bDex?.bonus || ''), JSON.stringify(bDex));
    const bCha = b.rows.find(r => r.label === '魅力');
    check('E) 乙魅力行同时显示 种族+2 与 自由+1（三者可分辨）', /种族\+2/.test(bCha?.bonus || '') && /自由\+1/.test(bCha?.bonus || ''), JSON.stringify(bCha));
    await page.close();
  }

  // ===== F) 异常输入被拒 =====
  {
    const { page } = await newUserPage(browser, 'r122f');
    await page.locator('.opt-grid').nth(0).locator('.opt-card').nth(1).click();
    await page.locator('.opt-grid').nth(1).locator('.opt-card').nth(0).click();
    await sleep(300);
    const sendBad = (stats) => page.evaluate((s) => {
      window.__S.net.send('room:charsheet', { sheet: { name: '异常', raceId: 'elf', classId: 'fighter', stats: s, flex: {} } });
    }, stats);
    const full = { STR: 15, DEX: 15, CON: 15, INT: 15, WIS: 15, CHA: 15 };
    await sendBad(full);            // 42 点：超购
    await sleep(500);
    await sendBad({ STR: 15, DEX: 15, CON: 15, INT: 10, WIS: 10, CHA: 7 }); // 低于下限
    await sleep(500);
    await sendBad({ STR: 15, DEX: 15, CON: 15, INT: 10, WIS: 10, CHA: 10.5 }); // 小数
    await sleep(700);
    const toasts = await page.evaluate(() => window.__toasts || []);
    log('异常输入提示：', JSON.stringify(toasts));
    check('F) 异常输入被拒且有反馈（超购/越界/小数）', toasts.some(t => /超出上限|非法/.test(t)), JSON.stringify(toasts));
    await page.close();
  }

  const failed = results.filter(r => !r.ok);
  console.log('\n===== R1-22 车卡加点探针：' + (results.length - failed.length) + '/' + results.length + ' 通过 =====');
  if (failed.length) console.log('失败项：\n  - ' + failed.map(f => f.name).join('\n  - '));
  await browser.close().catch(() => {});
  server.kill();
  await sleep(300);
  process.exit(failed.length ? 1 : 0);
}

main().catch(async e => { console.error('[r1-22] 探针异常', e); server.kill(); process.exit(1); });
