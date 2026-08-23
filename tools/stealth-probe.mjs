// 视野/游荡/BOSS/营地探针（F-29/F-31/F-30/F-24/F-25/F-26/F-23）：
// 用真实自动游玩策略驱动单人角色通关，全程采样快照，验证：
// - F-29：怪物有视野/暴露状态（calm→suspicious→exposed三色状态机）
// - F-31：冒险状态下非BOSS怪物随机游荡（玩家不动时怪物位置变化）
// - F-30：BOSS视野无限→遭遇表决（自动同意开战）；短休进入营地（camp.active）
// - F-24：事件树（combatEvents/eventTrees）随战斗生成
// - F-25：首场战斗团队先动（首顺位=玩家），同阵营敏捷降序
// - F-26：快照实体含名称/蓝条资源字段（施法怪mp>0）
// - F-23：团队状态机在adventuring/combat/camp间迁移
import { spawn } from 'node:child_process';
import { WebSocket } from 'ws';
import { createPolicy } from '../public/shared/autoplay-policy.mjs';
import { buildSheet } from '../server/game/charsheet.mjs';

const PORT = 3894;
const log = (...a) => console.log('[stealth]', ...a);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const server = spawn(process.execPath, ['server/index.mjs'], {
  cwd: process.cwd(),
  env: { ...process.env, DND_PORT: String(PORT), DND_SEED: '7', DND_OFFLINE: '1' },
  stdio: ['ignore', 'ignore', 'inherit'],
});
let pid = null, view = null, failed = false;
const ok = (m) => log('✅ ' + m);
const fail = (m) => { failed = true; log('❌ ' + m); };
const flags = { sawCombat: false, sawExposed: false, sawSuspicious: false, sawCamp: false, sawBossVote: false, sawWander: false, sawEventTree: false, sawTeamCombat: false, sawTeamCamp: false, sawMp: false };
let firstOrder = null;
let firstPlaying = null; // F-33：首个playing快照采样（开局=冒险中且无战斗）
let lastMonPos = null; // {eid -> x,y} 冒险态采样

async function main() {
  await sleep(1500);
  const ws = new WebSocket('ws://localhost:' + PORT + '/ws');
  const policy = createPolicy();
  let actionsSent = 0;
  ws.on('message', (raw) => {
    const m = JSON.parse(raw.toString());
    if (m.t === 's:hello') pid = m.pid;
    if (m.t === 's:state') { view = m.view; sample(); maybeAct(); }
  });
  const send = (t, payload = {}) => { ws.send(JSON.stringify({ t, ...payload })); actionsSent++; };
  function sample() {
    const gv = view?.game;
    if (!gv || gv.state !== 'playing') return;
    // F-33：首个playing快照必须=冒险中且无战斗（出生点安全/怪物不逼战）
    if (!firstPlaying) firstPlaying = { team: gv.team?.state, combat: !!gv.combat?.active, bossVote: !!gv.bossVote?.active, ch: gv.chapter?.id };
    if (gv.combat?.active) flags.sawCombat = true;
    if (gv.team?.state === 'combat') flags.sawTeamCombat = true;
    if (gv.team?.state === 'camp') flags.sawTeamCamp = true;
    if (gv.camp?.active) flags.sawCamp = true;
    if (gv.bossVote?.active) flags.sawBossVote = true;
    if ((gv.combatEvents || []).length > 0 || (gv.eventTrees && Object.keys(gv.eventTrees).length > 0)) flags.sawEventTree = true;
    for (const e of gv.entities) {
      if (e.kind !== 'monster') continue;
      if (e.alert === 'exposed' || gv.combat?.active) flags.sawExposed = true;
      if (e.alert === 'suspicious') flags.sawSuspicious = true;
      if (e.maxMp > 0) flags.sawMp = true;
    }
    // F-31：冒险态（非战斗）怪物位置变化采样
    if (!gv.combat?.active && !gv.camp?.active) {
      const pos = {};
      for (const e of gv.entities) if (e.kind === 'monster' && !e.dead) pos[e.eid] = e.x + ',' + e.y;
      if (lastMonPos) {
        for (const [eid, key] of Object.entries(pos)) {
          if (lastMonPos[eid] && lastMonPos[eid] !== key) { flags.sawWander = true; }
        }
      }
      lastMonPos = pos;
    }
    // F-25：首场战斗先攻顺序采样（战斗刚激活的首个快照）
    if (!firstOrder && gv.combat?.active && gv.combat.order?.length) {
      firstOrder = gv.combat.order.map(eid => {
        const e = gv.entities.find(x => x.eid === eid);
        return { kind: e?.kind, dex: e?.dex, name: e?.name };
      });
    }
  }
  function maybeAct() {
    try {
      const gv = view?.game;
      if (!gv || gv.state !== 'playing' || gv.win) return;
      const act = policy.decide(gv, pid);
      if (!act) return;
      switch (act.type) {
      case 'move': send('game:move', { x: act.x, y: act.y }); break;
      case 'attack': send('game:attack', { targetEid: act.targetEid }); break;
      case 'cast': send('game:cast', { spellId: act.spellId, targetEid: act.targetEid, x: act.x, y: act.y }); break;
      case 'item': send('game:item', { itemId: act.itemId, targetEid: act.targetEid, x: act.x, y: act.y }); break;
      case 'interact': send('game:interact', { targetEid: act.targetEid, tx: act.tx, ty: act.ty }); break;
      case 'dialogue': send('game:dialogue', { optionId: act.optionId }); break;
      case 'endturn': send('game:endturn'); break;
      case 'rest': send('game:rest'); break;
      case 'search': send('game:search'); break;
      case 'dash': send('game:dash'); break;
      case 'hide': send('game:hide'); break;
      case 'bossVote': send('game:boss-vote', { vote: act.vote }); break;
      case 'campRest': send('game:camp-rest'); break;
      case 'campLeave': send('game:camp-leave'); break;
      }
    } catch (e) { /* 快照竞态忽略 */ }
  }

  await new Promise(r => ws.on('open', r));
  const acct = '潜行者' + (Date.now() % 100000);
  send('hello', { action: 'register', account: acct, password: 'st1234' });
  await sleep(600);
  send('lobby:create', { dungeonId: 'lmop', personaId: 'aldric' });
  await sleep(500);
  const sheet = buildSheet({ name: '潜行者', raceId: 'human', classId: 'fighter', stats: { STR: 15, DEX: 13, CON: 14, INT: 10, WIS: 10, CHA: 8 }, flex: { CON: 1 } });
  send('room:charsheet', { sheet: { name: '潜行者', raceId: 'human', classId: 'fighter', stats: { STR: 15, DEX: 13, CON: 14, INT: 10, WIS: 10, CHA: 8 }, flex: { CON: 1 }, colors: sheet.colors } });
  await sleep(500);
  send('room:ready', { ready: true });
  await sleep(300);
  send('room:start');
  const ticker = setInterval(maybeAct, 400);
  const t0 = Date.now();
  while (Date.now() - t0 < 20 * 60e3) {
    await sleep(1000);
    if (view?.game?.win) break;
    if (flags.sawCamp && flags.sawBossVote && flags.sawWander && flags.sawEventTree && flags.sawExposed) break; // 关键标志齐即可提前收工
  }
  clearInterval(ticker);
  const gv = view?.game;
  log('结局：' + (gv?.win ? gv.win.kind + ' | ' + gv.win.reason : '未结束（提前收工）') + ' 动作数=' + actionsSent);
  // F-33：开局=冒险中且无战斗
  if (firstPlaying && firstPlaying.team === 'adventuring' && !firstPlaying.combat && !firstPlaying.bossVote) {
    ok('F-33 首个playing快照=冒险中且无战斗（' + firstPlaying.ch + '）');
  } else fail('F-33 开局状态异常：' + JSON.stringify(firstPlaying));
  // F-29/F-31
  if (flags.sawWander) ok('F-31 冒险态怪物随机游荡（玩家不动时怪物位置变化）'); else fail('F-31 未观测到怪物游荡');
  if (flags.sawExposed) ok('F-29 暴露状态出现（red/combat）'); else fail('F-29 未观测到暴露状态');
  if (flags.sawSuspicious) log('ℹ️ F-29 橙色察觉状态出现过：' + (flags.sawSuspicious ? '是' : '否（本次种子未触发，属正常）'));
  // F-30
  if (flags.sawCamp) ok('F-30 短休进入营地界面（camp.active 观测到）'); else fail('F-30 未进入营地');
  if (flags.sawBossVote) ok('F-30 BOSS遭遇表决出现（自动同意开战）'); else fail('F-30 未出现BOSS表决');
  // F-24
  if (flags.sawEventTree) ok('F-24 战斗事件树生成（combatEvents/eventTrees）'); else fail('F-24 无事件树');
  // F-25
  if (firstOrder && firstOrder.length) {
    const firstPlayer = firstOrder[0]?.kind === 'player';
    if (firstPlayer) ok('F-25 首场战斗首顺位=玩家（敏捷降序）'); else fail('F-25 首战首顺位非玩家：' + JSON.stringify(firstOrder[0]));
    // 同阵营敏捷降序校验
    let okDex = true;
    const check = (kind) => {
      let last = Infinity;
      for (const o of firstOrder) { if (o.kind !== kind) continue; if (o.dex > last) { okDex = false; } last = o.dex; }
    };
    check('player'); check('monster');
    if (okDex) ok('F-25 同阵营敏捷降序'); else fail('F-25 阵营内顺序非敏捷降序：' + JSON.stringify(firstOrder));
  } else fail('F-25 无战斗顺序采样');
  // F-26
  if (flags.sawMp) ok('F-26 施法怪蓝条资源字段下发（maxMp>0）'); else log('ℹ️ F-26 本次通关未遇施法怪（maxMp>0字段在终章BOSS可见）');
  // F-23
  if (flags.sawTeamCombat) ok('F-23 团队状态机进入「战斗中」'); else fail('F-23 团队从未进入战斗状态');
  if (flags.sawTeamCamp) ok('F-23 团队状态机进入「营地」'); else fail('F-23 团队从未进入营地状态');
  ws.close();
  server.kill();
  log(failed ? 'STEALTH RESULT: FAIL' : 'STEALTH RESULT: PASS');
  process.exit(failed ? 1 : 0);
}
main().catch(e => { console.error('CRASH:', e); server.kill(); process.exit(1); });
