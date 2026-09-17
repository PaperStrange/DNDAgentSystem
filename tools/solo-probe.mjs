// 单人体验探针（B-10/B-11）：
// 1) 单人准备就绪后不应自动开局（B-10）
// 2) 显式 room:start 后开局，序章怪物数量按1人队缩减、药水+3（B-11）
// 3) 用真实自动游玩策略驱动单人角色，验证其能存活通过序章（修复"1分钟团灭"）
// R1-14：连接层改用 tools/ws-client-guard.mjs（解析守卫/发送守卫/自动重连/token 续身份），
//   与 public/js/net.mjs 语义对齐；PORT=3897 不变（run-baseline.mjs 的 PORTS 依赖它）。
import { spawn } from 'node:child_process';
import { createPolicy } from '../public/shared/autoplay-policy.mjs';
import { buildSheet } from '../server/game/charsheet.mjs';
import { createGuardedSocket } from './ws-client-guard.mjs';

const PORT = 3897;
const log = (...a) => console.log('[solo]', ...a);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const server = spawn(process.execPath, ['server/index.mjs'], {
  cwd: process.cwd(),
  env: { ...process.env, DND_PORT: String(PORT), DND_SEED: process.env.DND_SEED ?? '7', DND_OFFLINE: '1', DND_DEBUG: '1' },
  stdio: ['ignore', 'ignore', 'inherit'],
});

let pid = null, view = null, token = null;
const policy = createPolicy();
let actionsSent = 0, lastChapter = null, failed = false;
let firstSoloStats = null; // 首个playing快照采样（防止策略秒杀导致断言竞态）
let lastNullLogAt = 0;     // R1-6b-D3 只读诊断：持续 null 日志节流
let nullSince = 0;         // R1-6b-D3 只读诊断：本次「无动作」起始时间（一旦发出动作即清零）

// R1-6b-D3 只读诊断：输出玩家资源对位（level/hp/maxHp/potion/shortrest/slots）。
// 仅 console.log，不触碰任何断言/判定/控制流。
function meDump(gv) {
  const p = gv?.players?.find(x => x.id === pid);
  const e = gv?.entities?.find(x => x.eid === gv?.me?.eid);
  return '[lv=' + (p?.level ?? '?') + ' hp=' + (e ? e.hp + '/' + e.maxHp : '?')
    + ' potion=' + (p?.items?.potion ?? '?') + ' shortrest=' + (gv?.me?.charges?.shortrest ?? '?')
    + ' slots=' + JSON.stringify(gv?.me?.slots ?? p?.slots ?? null) + ']';
}

function fail(msg) { failed = true; log('❌ ' + msg); }

async function main() {
  await sleep(1300);
  const acct = '独行侠' + (Date.now() % 100000);

  // R1-14：连接层走守卫客户端。首次 open 用账号注册；重连 open 用 token 续同一身份
  //   （token 捕获 + 重发 hello 对齐 public/js/net.mjs:74-82 与 server/index.mjs:209-221）。
  const sock = createGuardedSocket({
    url: 'ws://localhost:' + PORT + '/ws',
    log: (...a) => log(...a),
    onMessage: (m) => {
      if (m.t === 's:hello') { pid = m.pid; token = m.token || m.pid; }
      if (m.t === 's:state') {
        view = m.view;
        const ch = view.game?.chapter?.id;
        if (ch && ch !== lastChapter) { lastChapter = ch; log('进入 ' + ch + '（存活敌人 ' + (view.game.entities.filter(e => e.kind === 'monster').length) + '） ' + meDump(view.game)); }
        if (!firstSoloStats && view.game?.state === 'playing' && view.game.chapter?.id === 'prologue') {
          const mons = view.game.entities.filter(e => e.kind === 'monster');
          firstSoloStats = { count: mons.length, hps: mons.map(e => e.maxHp) };
        }
        maybeAct();
      }
    },
    onOpen: (s) => {
      if (token) s.send('hello', { name: '独行侠', token, rename: true });
      else s.send('hello', { action: 'register', account: acct, password: 'solo1234' });
    },
  });
  // 游戏动作发送：沿用原语义（仅动作计入 actionsSent；setup 消息不计，保持动作数含义不变）
  const send = (t, payload = {}) => { if (sock.send(t, payload)) actionsSent++; };

  function maybeAct() {
    try {
      const gv = view?.game;
      if (!gv || gv.state !== 'playing' || gv.win) return;
      const myTurnNow = gv.turn?.playerId === pid;
      const act = policy.decide(gv, pid);
      if (!act) {
        // R1-6b-D3 只读诊断：只记录「本回合持续无动作 ≥2s」的疑似空转。
        // 200ms 节流造成的瞬时 null 不计（否则整局上百条噪声淹没信号）。仅日志，不改控制流。
        if (myTurnNow) {
          if (!nullSince) nullSince = Date.now();
          const dur = Date.now() - nullSince;
          if (dur >= 2000 && Date.now() - lastNullLogAt > 2000) {
            lastNullLogAt = Date.now();
            log('decide=null 持续' + (dur / 1000).toFixed(1) + 's（本回合无动作，疑似空转）turn=' + JSON.stringify(gv.turn) + ' state=' + gv.state + ' win=' + !!gv.win + ' me.pid=' + (gv.me?.pid) + ' pid=' + pid);
          }
        }
        return;
      }
      nullSince = 0; // 有动作发出 → 清零持续计时
      switch (act.type) {
      case 'move': send('game:move', { x: act.x, y: act.y }); break;
      case 'attack': send('game:attack', { targetEid: act.targetEid }); break;
      case 'cast': send('game:cast', { spellId: act.spellId, targetEid: act.targetEid, x: act.x, y: act.y }); break;
      case 'item': send('game:item', { itemId: act.itemId, targetEid: act.targetEid, x: act.x, y: act.y }); break;
      case 'interact': send('game:interact', { targetEid: act.targetEid, tx: act.tx, ty: act.ty }); break;
      case 'dialogue': send('game:dialogue', { optionId: act.optionId }); break;
      case 'endturn': send('game:endturn'); break;
      // P0-1（R1-6a）：策略会返回 claim，本探针此前没有该分支且无 default，
      // 动作被静默丢弃 → 每回合空转 → 活锁（seed42 用满 20 分钟仍停 ch1）。
      // 注意：仅补此分支会把「卡住」变成「第 1 章就通关」，必须与 P0-2 一同生效。
      case 'claim': send('game:claim'); break;
      case 'rest': send('game:rest'); break;
      case 'search': send('game:search'); break;
      case 'dash': send('game:dash'); break;
      case 'hide': send('game:hide'); break;
      case 'bossVote': send('game:boss-vote', { vote: act.vote }); break; // F-30：BOSS表决自动同意
      case 'campRest': send('game:camp-rest'); break;                    // F-30：营地恢复
      case 'campLeave': send('game:camp-leave'); break;                  // F-30：营地返回
      default: log('未处理动作:' + (act && act.type)); break;             // R1-6b-D3 只读诊断：暴露被静默丢弃的动作
      }
    } catch (e) { log('decide异常: ' + (e && e.message ? e.message : e)); } // R1-6b-D3 只读诊断：不再静默吞异常
  }

  // 等待首次注册完成（拿到 pid；对应原「await ws.on('open') + register + sleep(500)」）
  for (let i = 0; i < 40 && !pid; i++) await sleep(100);

  sock.send('lobby:create', { dungeonId: 'lmop', personaId: 'aldric' });
  await sleep(500);
  log('建房完成，phase=' + view?.phase);

  const sheet = buildSheet({ name: '独行侠', raceId: 'human', classId: 'fighter', stats: { STR: 15, DEX: 13, CON: 14, INT: 10, WIS: 10, CHA: 8 }, flex: { CON: 1 }, colors: {}, background: '独行旅人' });
  sock.send('room:charsheet', { sheet: { name: '独行侠', raceId: 'human', classId: 'fighter', stats: { STR: 15, DEX: 13, CON: 14, INT: 10, WIS: 10, CHA: 8 }, flex: { CON: 1 }, colors: sheet.colors, background: '独行旅人' } });
  await sleep(500);

  // B-10 断言1：单人准备就绪后不应自动开局
  sock.send('room:ready', { ready: true });
  await sleep(900);
  if (view?.phase === 'prepare' && !view?.game) log('B-10 ✓ 单人准备后未自动开局（phase=prepare，等待确认）');
  else fail('B-10 ✗ 单人准备后意外开局 phase=' + view?.phase);

  // B-10 断言2：显式 room:start 后开局
  sock.send('room:start', {});
  for (let i = 0; i < 20; i++) {
    await sleep(500);
    if (view?.phase === 'playing' || view?.phase === 'intro') break;
  }
  if (view?.phase === 'playing' || view?.phase === 'intro') log('B-10 ✓ 确认后显式开局成功（phase=' + view.phase + '）');
  else fail('B-10 ✗ 显式开局失败 phase=' + view?.phase);

  // B-11 断言：怪物数量缩减 + 药水+3
  for (let i = 0; i < 40; i++) {
    if (view?.game?.state === 'playing') break;
    await sleep(500);
  }
  const gv = view?.game;
  if (gv && firstSoloStats) {
    const me = gv.players.find(p => p.id === pid);
    log('序章怪物数=' + firstSoloStats.count + '（hp:' + firstSoloStats.hps.join('/') + '） 药水=' + (me?.items?.potion));
    if (firstSoloStats.count === 1) log('B-11 ✓ 单人队序章怪物缩减为1只（原4只）');
    else fail('B-11 ✗ 序章怪物数异常=' + firstSoloStats.count);
    if (firstSoloStats.hps.every(h => h < 7)) log('B-11 ✓ 怪物生命按单人队下调（' + firstSoloStats.hps[0] + '<7）');
    else fail('B-11 ✗ 怪物生命未下调 hps=' + firstSoloStats.hps.join(','));
    if (me?.items?.potion === 3) log('B-11 ✓ 单人开局药水+3');
    else fail('B-11 ✗ 药水数异常=' + me?.items?.potion);
  } else fail('B-11 ✗ 无游戏快照');

  // 驱动独行侠直到通关或结束（固定种子，可复现；验证单人全程可玩、不再1分钟团灭）
  const ticker = setInterval(maybeAct, 400);
  const t0 = Date.now();
  let reachedCh1At = null;
  while (Date.now() - t0 < 20 * 60e3) {
    await sleep(1000);
    if (lastChapter === 'ch1' && !reachedCh1At) { reachedCh1At = Date.now() - t0; log('B-11 ✓ 单人通过序章进入第一章（用时 ' + Math.round(reachedCh1At / 1000) + ' 秒，动作数=' + actionsSent + '）'); }
    if (view?.game?.win) break;
  }
  clearInterval(ticker);
  const win = view?.game?.win;
  if (win) log('单人冒险结局：kind=' + win.kind + ' | ' + win.reason + '（总用时 ' + Math.round((Date.now() - t0) / 60000) + ' 分钟） ' + meDump(view?.game));
  if (win && win.kind !== 'defeat') log('B-11 ✓ 单人完整通关（' + win.kind + '），动作数=' + actionsSent);
  else if (win?.kind === 'defeat') fail('B-11 ✗ 单人团灭：' + win?.reason);
  else fail('B-11 ✗ 超时未通关（最后章节=' + lastChapter + ' state=' + view?.game?.state + '）');

  log(failed ? 'SOLO RESULT: FAIL' : 'SOLO RESULT: PASS');
  server.kill();
  process.exit(failed ? 1 : 0);
}
main().catch(e => { console.error(e); server.kill(); process.exit(1); });
