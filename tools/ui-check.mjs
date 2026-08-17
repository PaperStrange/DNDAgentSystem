// 车卡界面专项UI验证：加点边界/自由加点独立/背景随机/保存反馈/预览排版
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';

const PORT = 3893;
const server = spawn(process.execPath, ['server/index.mjs'], {
  cwd: process.cwd(),
  env: { ...process.env, DND_PORT: String(PORT) },
  stdio: ['ignore', 'pipe', 'pipe'],
});
const log = (...a) => console.log('[ui]', ...a);
let pass = 0, fail = 0;
const check = (name, ok, extra = '') => { log((ok ? '✅ ' : '❌ ') + name + (extra ? ' | ' + extra : '')); ok ? pass++ : fail++; };

async function main() {
  await new Promise(r => setTimeout(r, 1500));
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
  await page.goto('http://localhost:' + PORT + '/');
  await page.waitForSelector('.lobby-title');
  await page.fill('.name-box input', '测试员');
  await page.click('.name-box .btn');
  // 创建房间（选第1位DM）
  await page.click('.persona-grid .persona-card:nth-child(1)');
  await page.click('.create-box .btn.gold');
  await page.waitForSelector('.room-code');
  // 车卡：人类 + 战士
  await page.fill('input[placeholder="为你的角色起个名字"]', '剑心');
  await page.locator('.cg-section').nth(1).locator('.opt-card').first().click(); // 人类
  await page.locator('.cg-section').nth(2).locator('.opt-card').first().click(); // 战士
  await page.waitForTimeout(500);
  // 检查初始显示
  const statVals = await page.locator('.stat-row .sr-val').allTextContents();
  log('六维初始值:', statVals.join(','));
  // B-1: 连点减号20次，确认不低于下限8（仅统计含按钮的六维行）
  const rows = page.locator('.stat-row:has(button)');
  const rowCount = await rows.count();
  log('含按钮的属性行数:', rowCount);
  const minus0 = rows.nth(0).locator('button').nth(0);
  log('首行减号初始disabled:', await minus0.isDisabled());
  for (let i = 0; i < 20; i++) { if (await minus0.isEnabled()) await minus0.click(); else break; }
  const valAfter = await rows.nth(0).locator('.sr-val').textContent();
  check('B-1 加点下限8（连点20次不减破）', valAfter.includes('8') && !valAfter.includes('-'), '力量=' + valAfter);
  check('B-1 到达下限后减号禁用', await minus0.isDisabled());
  // B-2: 感知加2点，右侧应显示+2/最终值正确
  const wisRow = rows.nth(4); // WIS 感知
  const wisPlus = wisRow.locator('button').nth(1);
  const wisBefore = parseInt((await wisRow.locator('.sr-val').textContent()).replace(/[^0-9]/g, ''), 10);
  await wisPlus.click(); await wisPlus.click();
  const wisMod = await wisRow.locator('.sr-mod').textContent();
  check('B-2 感知+2后调整值正确', wisMod.includes('+' + Math.floor((wisBefore + 2 - 10) / 2)), '显示=' + wisMod.trim());
  // B-3: 人类双自由加点独立
  const flexSels = page.locator('.stat-row select');
  check('B-3 人类有2个自由加点槽位', (await flexSels.count()) === 2, '槽位数=' + await flexSels.count());
  await flexSels.nth(0).selectOption('WIS');
  const sel1 = await flexSels.nth(1).inputValue();
  await flexSels.nth(1).selectOption('CHA');
  const sel0after = await flexSels.nth(0).inputValue();
  check('B-3 改第2槽不影响第1槽', sel0after === 'WIS', '槽1=' + sel0after + ' 槽2=' + await flexSels.nth(1).inputValue());
  // R-2: 背景自由输入 + 随机按钮
  const bgArea = page.locator('textarea[placeholder*="来历"]');
  await bgArea.fill('生于山野，剑出如风。');
  check('R-2 背景可自由输入', (await bgArea.inputValue()).includes('山野'));
  await page.click('button:has-text("随机")');
  await page.waitForTimeout(6000);
  const bgAfter = await bgArea.inputValue();
  check('R-2 LLM随机背景返回', bgAfter.length > 5 && bgAfter !== '生于山野，剑出如风。', '背景=' + bgAfter.slice(0, 20));
  // 预览截图 + B-5 排版
  await page.screenshot({ path: 'e2e-shots/ui-chargen.png' });
  const labelVisible = await page.locator('.preview-label').isVisible();
  check('B-5 预览标签可见', labelVisible);
  // B-6: 保存车卡反馈
  await page.click('button:has-text("保存车卡")');
  await page.waitForTimeout(1200);
  const toastTxt = await page.locator('#toast-root').textContent();
  check('B-6 保存反馈toast出现', toastTxt.includes('车卡'), 'toast=' + toastTxt.slice(0, 30));
  await page.waitForTimeout(500);
  const readyBtn = page.locator('button:has-text("准备就绪")');
  check('B-6 保存成功后可准备', await readyBtn.isEnabled());
  log('\n结果: ' + pass + ' 通过 / ' + fail + ' 失败');
  await browser.close();
  server.kill();
  process.exit(fail ? 1 : 0);
}
main().catch(e => { console.error('UI CHECK CRASH:', e); server.kill(); process.exit(1); });
