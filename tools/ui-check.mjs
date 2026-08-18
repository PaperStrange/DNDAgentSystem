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
  // 账户系统：自动弹出的登录框 → 注册唯一账号
  const acct = '测试员' + (Date.now() % 1000000);
  await page.waitForSelector('.dialog-overlay .auth-input', { timeout: 8000 });
  await page.click('.dialog-overlay .seg-btn:has-text("注册")');
  await page.fill('.dialog-overlay input[placeholder*="用户名"]', acct);
  await page.fill('.dialog-overlay input[type="password"]', 'test1234');
  await page.click('.dialog-overlay .btn.gold');
  await page.waitForSelector('.dialog-overlay', { state: 'detached', timeout: 10000 });
  check('账户注册并自动登录', (await page.locator('.account-box .acct-name').textContent()).includes(acct), acct);
  // 创建房间（选第1位DM）
  await page.click('.persona-grid .persona-card:nth-child(1)');
  await page.click('.create-box .btn.gold');
  await page.waitForSelector('.room-code');
  // 车卡：人类 + 战士
  await page.fill('input[placeholder="为你的角色起个名字"]', '剑心');
  await page.locator('.opt-grid').nth(0).locator('.opt-card').first().click(); // 人类
  await page.locator('.opt-grid').nth(1).locator('.opt-card').first().click(); // 战士
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
  // R-2/R-12: 背景自由输入 + 随机按钮（要求≥150字）
  const bgArea = page.locator('textarea[placeholder*="来历"]');
  await bgArea.fill('生于山野，剑出如风。');
  check('R-2 背景可自由输入', (await bgArea.inputValue()).includes('山野'));
  await page.click('button:has-text("随机")');
  await page.waitForFunction(() => {
    const t = document.querySelector('textarea[placeholder*="来历"]');
    return t && t.value.replace(/\s/g, '').length >= 150;
  }, { timeout: 40000 });
  const bgAfter = await bgArea.inputValue();
  check('R-12 随机背景≥150字', bgAfter.replace(/\s/g, '').length >= 150, '字数=' + bgAfter.replace(/\s/g, '').length + ' 开头=' + bgAfter.slice(0, 18));
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
  // R-11: 保存车卡自动收入冒险者名册（状态=在世）
  const rosterAfterSave = await page.evaluate(() => JSON.parse(localStorage.getItem('dnd_roster') || '[]'));
  check('R-11 保存车卡自动收入名册', rosterAfterSave.some(e => e.name === '剑心' && e.status === 'alive'), '条目数=' + rosterAfterSave.length);
  check('R-11 车卡界面有读取角色下拉', (await page.locator('.cg-section select').first().locator('option').count()) >= 2);
  // R-14: 车卡界面战斗模式切换（房主）
  const segBtns = page.locator('.seg-btn');
  check('R-14 车卡界面有战斗模式选择器', (await segBtns.count()) === 2, '数量=' + await segBtns.count());
  await page.click('.seg-btn:has-text("手动战斗")');
  await page.waitForTimeout(700);
  check('R-14 切换到手动后高亮', (await page.locator('.seg-btn.sel').textContent()).includes('手动'));
  await page.click('.seg-btn:has-text("自动战斗")');
  await page.waitForTimeout(700);
  check('R-14 切回自动后高亮', (await page.locator('.seg-btn.sel').textContent()).includes('自动'));
  // B-10: 单人准备确认框（等待→取消→再准备→立即开始）
  await readyBtn.click();
  await page.waitForSelector('.dialog-overlay', { timeout: 5000 });
  const ovTxt = await page.locator('.dialog-overlay .dialog-box').textContent();
  check('B-10 单人准备弹出确认框', ovTxt.includes('立即开始') && ovTxt.includes('等待'), ovTxt.slice(0, 26));
  await page.click('.dialog-overlay button:has-text("继续等待")');
  await page.waitForTimeout(800);
  check('B-10 选择等待后仍在房间', await page.locator('.room-code').isVisible());
  await page.click('button:has-text("取消准备")');
  await page.waitForTimeout(600);
  await page.click('button:has-text("准备就绪")');
  await page.waitForSelector('.dialog-overlay', { timeout: 5000 });
  await page.click('.dialog-overlay button:has-text("立即开始")');
  await page.waitForSelector('.screen-game', { timeout: 20000 });
  check('B-10 确认后进入游戏', await page.locator('.screen-game').isVisible());
  // R-11: 阵亡标记（模拟冒险结束角色死亡）→ 名册状态→ 大厅展示 → 死亡角色不可再读取
  await page.evaluate(() => {
    const r = JSON.parse(localStorage.getItem('dnd_roster') || '[]');
    const e = r.find(x => x.name === '剑心');
    if (e) { e.status = 'dead'; localStorage.setItem('dnd_roster', JSON.stringify(r)); }
  });
  await page.evaluate(() => window.__S.net.send('room:leave'));
  await page.waitForSelector('.lobby-title', { timeout: 10000 });
  const rosterTxt = await page.locator('.panel:has(h4:has-text("冒险者名册"))').textContent();
  check('R-11 大厅名册显示已阵亡状态', rosterTxt.includes('剑心') && rosterTxt.includes('已阵亡'), rosterTxt.slice(0, 40));
  await page.click('.persona-grid .persona-card:nth-child(1)');
  await page.click('.create-box .btn.gold');
  await page.waitForSelector('.room-code');
  const rosterOpts = await page.locator('.cg-section select').first().locator('option').allTextContents();
  check('R-11 已阵亡角色不出现在读取列表', !rosterOpts.some(t => t.includes('剑心')), '选项=' + rosterOpts.join('/'));
  // 登录流程闭环：退出登录→按钮重新出现→登录框自动弹出→错误密码弹窗提示→重新登录成功
  await page.evaluate(() => window.__S.net.send('room:leave'));
  await page.waitForSelector('.lobby-title', { timeout: 10000 });
  await page.click('.account-box button:has-text("退出登录")');
  await page.waitForSelector('.lobby-title', { timeout: 10000 });
  check('退出登录后重新展示登录按钮', await page.locator('.account-box button:has-text("登录 / 注册")').isVisible());
  check('退出登录后登录框自动弹出', await page.locator('.dialog-overlay .auth-input').first().isVisible());
  await page.click('.dialog-overlay .seg-btn:has-text("登录")');
  await page.fill('.dialog-overlay input[placeholder*="用户名"]', acct);
  await page.fill('.dialog-overlay input[type="password"]', 'wrong-password');
  await page.click('.dialog-overlay .btn.gold');
  await page.waitForFunction(() => {
    const el = document.querySelector('.dialog-overlay .auth-err');
    return el && el.textContent.includes('密码不正确');
  }, { timeout: 8000 });
  check('错误密码在弹窗内红字提示', true);
  check('错误后提交按钮未卡死', !(await page.locator('.dialog-overlay .btn.gold').isDisabled()));
  await page.fill('.dialog-overlay input[type="password"]', 'test1234');
  await page.click('.dialog-overlay .btn.gold');
  await page.waitForSelector('.dialog-overlay', { state: 'detached', timeout: 10000 });
  check('重新登录成功（账户栏恢复）', (await page.locator('.account-box .acct-name').textContent()).includes(acct));
  log('\n结果: ' + pass + ' 通过 / ' + fail + ' 失败');
  await browser.close();
  server.kill();
  process.exit(fail ? 1 : 0);
}
main().catch(e => { console.error('UI CHECK CRASH:', e); server.kill(); process.exit(1); });
