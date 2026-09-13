// 车卡流程探针（回归防线）：
//  1) 新用户两种填写顺序都必须能保存车卡：先选种族职业后填名字 / 先填名字后选种族职业
//     —— 老板在 PC 端遇到的「填好名字+加点+背景却无法保存车卡」就是保存按钮状态没随名字更新导致的
//  2) 车卡界面不再显示「种族立绘」区块
//  3) 外观区不再有「预设」页签（预设会给出与所选种族不符的外观）
//  4) 保存后可准备 → 单人确认框「立即开始冒险」→ 进入游戏
// 用法：node tools/chargen-probe.mjs
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';

const PORT = Number(process.env.PROBE_PORT || 3911);
const SHOTS = 'e2e-shots';
mkdirSync(SHOTS, { recursive: true });
const dataDir = mkdtempSync(join(tmpdir(), 'dnd-chargen-'));
const log = (...a) => console.log('[probe]', ...a);
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
  await page.setDefaultTimeout(15000);
  await page.waitForSelector('.lobby-title');
  const uname = tag + Date.now().toString(36).slice(-5);
  await page.waitForSelector('.dialog-overlay .auth-input');
  await page.click('.dialog-overlay .seg-btn:has-text("注册")');
  await page.fill('.dialog-overlay input[placeholder*="用户名"]', uname);
  await page.fill('.dialog-overlay input[type="password"]', 'probe1234');
  await page.click('.dialog-overlay .btn.gold');
  const ok = await page.waitForSelector('.dialog-overlay', { state: 'detached', timeout: 10000 }).then(() => true).catch(() => false);
  check('[' + tag + '] 新用户注册进入大厅', ok, uname);
  await page.waitForSelector('.persona-grid .persona-card', { timeout: 10000 });
  log('[' + tag + '] 大厅人设卡片数=' + await page.locator('.persona-grid .persona-card').count());
  await page.locator('.persona-grid .persona-card').nth(1).click();
  await page.locator('.create-box .btn.gold').first().click();
  await page.waitForSelector('.room-code', { timeout: 15000 });
  log('[' + tag + '] 已进入房间');
  return { page, ctx, errors };
}

async function spendPoints(page, budget = 20) {
  let added = 0;
  for (let n = 0; n < budget; n++) {
    let clicked = false;
    const rows = page.locator('.stat-row');
    const count = await rows.count();
    for (let i = 0; i < count && !clicked; i++) {
      const plus = rows.nth(i).locator('button').last();
      try {
        if (await plus.isDisabled({ timeout: 1500 })) continue;
        await plus.click({ timeout: 4000 });
        clicked = true; added++;
      } catch { /* 节点被重渲染替换，继续尝试下一个 */ }
    }
    if (!clicked) break;
  }
  log('加点次数=' + added);
  return added;
}

async function main() {
  await sleep(1500);
  const browser = await chromium.launch();

  // ---- 场景 1：先选种族/职业，最后才填名字（老板遇到的顺序）----
  {
    const { page, errors } = await newUserPage(browser, 'order1');
    log('步骤1：选种族');
    await page.locator('.opt-grid').nth(0).locator('.opt-card').first().click();
    log('步骤2：选职业');
    await page.locator('.opt-grid').nth(1).locator('.opt-card').first().click();
    await sleep(300);
    log('步骤3：加点');
    const added = await spendPoints(page);
    log('步骤4：填背景');
    await page.fill('textarea', '来自北境矿镇的年轻战士，为寻找失踪的兄长踏上旅途。');
    log('步骤5：填名字');
    await page.fill('input[placeholder="为你的角色起个名字"]', '顺序甲');
    await sleep(250);
    log('步骤6：检查保存按钮');
    const saveBtn = page.locator('button:has-text("保存车卡")');
    const disabled = await saveBtn.isDisabled();
    check('[先种族职业→后名字] 保存车卡按钮可用', !disabled, 'disabled=' + disabled + '（加点' + added + '次）');
    if (!disabled) {
      await saveBtn.click();
      await sleep(1200);
      const sheet = (await page.locator('.member-card .mc-sheet').first().textContent().catch(() => '')).trim();
      check('[先种族职业→后名字] 服务端已接受车卡', /·/.test(sheet) && !/尚未车卡/.test(sheet), sheet);
    } else {
      check('[先种族职业→后名字] 服务端已接受车卡', false, '按钮禁用，无法提交');
    }

    // 车卡界面不应再有种族立绘 / 预设页签
    const portraitNodes = await page.locator('.cg-portrait, .cg-portrait-wrap, .cg-portrait-label').count();
    check('车卡界面已移除「种族立绘」', portraitNodes === 0, 'portrait nodes=' + portraitNodes);
    const presetTabs = await page.locator('.look-tabs button:has-text("预设")').count();
    const presetCards = await page.locator('.preset-card, .preset-grid').count();
    check('外观区已移除「预设」页签', presetTabs === 0 && presetCards === 0, 'tabs=' + presetTabs + ' cards=' + presetCards);
    const lookTabs = (await page.locator('.look-tabs button').allTextContents()).map(s => s.trim());
    check('外观区保留颜色/发型/面部页签', ['颜色', '发型', '面部'].every(t => lookTabs.includes(t)), JSON.stringify(lookTabs));

    // 准备 → 单人确认框 → 开局
    const readyBtn = page.locator('button:has-text("准备就绪")');
    if (await readyBtn.count()) {
      await readyBtn.first().click();
      await sleep(500);
      const goBtn = page.locator('.dialog-box button:has-text("立即开始冒险")');
      const hasDialog = await goBtn.count();
      check('[单人] 准备后弹出确认框', hasDialog > 0);
      if (hasDialog) {
        await goBtn.first().click();
        const started = await page.waitForSelector('.screen-game', { timeout: 45000 }).then(() => true).catch(() => false);
        check('[单人] 确认后成功进入游戏', started);
      }
    }
    check('[先种族职业→后名字] 无脚本错误', errors.length === 0, errors.slice(0, 2).join(' | '));
    await page.screenshot({ path: SHOTS + '/chargen-probe-order1.png' });
    await page.close();
  }

  // ---- 场景 2：先填名字，再选种族/职业（原本就能用，防回归）----
  {
    const { page, errors } = await newUserPage(browser, 'order2');
    await page.fill('input[placeholder="为你的角色起个名字"]', '顺序乙');
    await page.locator('.opt-grid').nth(0).locator('.opt-card').first().click();
    await page.locator('.opt-grid').nth(1).locator('.opt-card').first().click();
    await sleep(300);
    await spendPoints(page);
    await page.fill('textarea', '第二个顺序的背景故事。');
    await sleep(200);
    const saveBtn = page.locator('button:has-text("保存车卡")');
    const disabled = await saveBtn.isDisabled();
    check('[先名字→后种族职业] 保存车卡按钮可用', !disabled, 'disabled=' + disabled);
    if (!disabled) {
      await saveBtn.click();
      await sleep(1200);
      const sheet = (await page.locator('.member-card .mc-sheet').first().textContent().catch(() => '')).trim();
      check('[先名字→后种族职业] 服务端已接受车卡', /·/.test(sheet) && !/尚未车卡/.test(sheet), sheet);
    }
    check('[先名字→后种族职业] 无脚本错误', errors.length === 0, errors.slice(0, 2).join(' | '));
    await page.close();
  }

  // ---- 场景 3：非 flex 种族（精灵）+ 半精灵（flex 2）都能保存 ----
  for (const [idx, raceName] of [[1, '精灵'], [7, '半精灵']]) {
    const { page } = await newUserPage(browser, 'race' + idx);
    await page.fill('input[placeholder="为你的角色起个名字"]', raceName + '测试');
    await page.locator('.opt-grid').nth(0).locator('.opt-card').nth(idx).click();
    await page.locator('.opt-grid').nth(1).locator('.opt-card').first().click();
    await sleep(300);
    await spendPoints(page);
    await page.locator('button:has-text("保存车卡")').click();
    await sleep(1200);
    const sheet = (await page.locator('.member-card .mc-sheet').first().textContent().catch(() => '')).trim();
    check('[' + raceName + '] 车卡可保存', /·/.test(sheet) && !/尚未车卡/.test(sheet), sheet);
    const toasts = await page.evaluate(() => window.__toasts || []);
    check('[' + raceName + '] 无服务端拒绝提示', !toasts.some(t => /非法|超出|失败/.test(t)), JSON.stringify(toasts));
    await page.close();
  }

  const failed = results.filter(r => !r.ok);
  console.log('\n===== 车卡探针：' + (results.length - failed.length) + '/' + results.length + ' 通过 =====');
  await browser.close().catch(() => {});
  server.kill();
  await sleep(300);
  process.exit(failed.length ? 1 : 0);
}

main().catch(async e => { console.error('[probe] 异常', e); server.kill(); process.exit(1); });
