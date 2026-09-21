// R1-34 · R1-27「全员确认门」的**唯一真源**（single source of truth）
//
// 背景（为什么需要这个模块）：
//   R1-27 把房间状态机改为  ready → _checkAutoStart → startGame → phase='confirm'
//   → 全员确认（room:confirm）→ _beginPlay（phase='playing'）。
//   三个 SOP 基线工具（tools/solo-probe.mjs、simulate/bots.mjs、simulate/e2e.mjs）此前各自
//   「只发 room:ready / room:start，然后等 phase==='playing'」，**未跟进 confirm 门** ⇒ 永远等不到开局。
//   本项目已多次因「同一事实写两遍」出缺陷（R1-27-F1 阶段清单 / R1-31 清理逻辑 / BL-30 夹具 vs createRoom / 本次）。
//   ⇒ 本模块把「确认门」的协议契约与驱动逻辑集中一处，三处共用，杜绝再写第三遍。
//
// 真源事实（与产品代码对齐；改产品时必须同步此处）：
//   · 确认消息名  = 'room:confirm'    —— server/game/rooms.mjs `_roomMsg` → `confirmStart()`
//                                        public/js/screens/game.mjs:1147 `net.send('room:confirm')`
//   · 确认门阶段  = 'confirm'          —— server/game/rooms.mjs `snapshotFor()`（phase==='confirm' ⇒ view.phase='confirm'）
//   · 门后已开局  = 'playing'          —— `_beginPlay()` 置 room.phase='playing' 且 game.state='playing'
//   · 确认按钮文案 = '我已读完隐藏目标，确认开始' —— public/js/screens/game.mjs:1146（浏览器级工具据此点击真实界面）
//
// 关键语义（务必与「修前」区分）：
//   R1-27 之前，'intro' 曾是「开局前覆盖层」的稳定态，故旧断言写作 `phase==='playing' || phase==='intro'`。
//   R1-27 之后，'intro' 退化为 **startGame 到 _enterConfirm 之间的瞬态**（始终会转入 'confirm'），
//   不再是「已开局」。因此「已开局」的**唯一判据是 'playing'**（_beginPlay 之后）。
//   若仍把 'intro' 当作已开局，驱动会在瞬态 intro 上误判「已放行」而不发确认 ⇒ 假绿。故此处只认 'playing'。

export const CONFIRM_MSG = 'room:confirm';
export const CONFIRM_PHASE = 'confirm';
export const STARTED_PHASE = 'playing';
export const CONFIRM_BUTTON_TEXT = '我已读完隐藏目标，确认开始';

/** 当前 phase 是否处于「全员确认门」（需发送确认 / 在界面上点击确认）。 */
export function isConfirmGate(phase) { return phase === CONFIRM_PHASE; }

/** 当前 phase 是否表示确认门已放行、对局已真正开始（_beginPlay 之后，game.state='playing'）。 */
export function isGameStarted(phase) { return phase === STARTED_PHASE; }

/**
 * 通用「确认门」驱动器（socket 类工具共用：tools/solo-probe.mjs、simulate/bots.mjs）。
 * 轮询 phase：
 *   · 一旦进入 confirm 门 ⇒ 调用 sendConfirm()（**只发一次**；服务端 room.confirmed 为 Set，重复也幂等）；
 *   · 一旦进入 playing（确认门放行、真正开局）⇒ 返回 started=true；
 *   · 超时 ⇒ 返回 started=false（附 lastPhase 供诊断），绝不伪造/绕过。
 *
 * @param {object}   o
 * @param {() => (string|undefined)} o.getPhase        读取当前 view.phase
 * @param {() => (void|Promise<void>)} o.sendConfirm   发送确认（各工具用自己的 socket / Bot.send）
 * @param {(ms:number) => Promise<void>} o.wait        等待函数
 * @param {number}  [o.timeoutMs=30000]  超时（默认 30s，远大于确认门正常耗时）
 * @param {number}  [o.pollMs=250]       轮询间隔
 * @returns {Promise<{started:boolean, sentConfirm:boolean, lastPhase:(string|undefined)}>}
 */
export async function driveConfirmGate({ getPhase, sendConfirm, wait, timeoutMs = 30000, pollMs = 250 }) {
  const t0 = Date.now();
  let sentConfirm = false;
  let lastPhase;
  while (Date.now() - t0 < timeoutMs) {
    const phase = getPhase();
    lastPhase = phase;
    if (isConfirmGate(phase) && !sentConfirm) { await sendConfirm(); sentConfirm = true; }
    if (isGameStarted(phase)) return { started: true, sentConfirm, lastPhase: phase };
    await wait(pollMs);
  }
  return { started: false, sentConfirm, lastPhase };
}

/**
 * 浏览器级工具共用：轮询页面 phase 直到谓词满足（page 需提供 evaluate(fn) 与 waitForTimeout(ms)，即 Playwright Page）。
 * 供 simulate/e2e.mjs 与 tools/ui-check.mjs 共用，避免「等 confirm / 等 playing」各写一遍。
 * 谓词由调用方从本模块传入（isConfirmGate / isGameStarted），保证判据同源。
 *
 * @param {object} page
 * @param {(phase:(string|null)) => boolean} predicate
 * @param {number} timeoutMs
 * @param {string} label  超时诊断标签
 * @returns {Promise<string|null>} 命中的 phase
 */
export async function waitPagePhase(page, predicate, timeoutMs, label) {
  const t0 = Date.now();
  let last = null;
  while (Date.now() - t0 < timeoutMs) {
    last = await page.evaluate(() => (window.__e2e && window.__e2e.view() ? window.__e2e.view().phase : null)).catch(() => null);
    if (predicate(last)) return last;
    await page.waitForTimeout(250);
  }
  throw new Error('等待超时: ' + label + '（最后 phase=' + last + '）');
}
