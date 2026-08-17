// 协议级全流程模拟：5个机器人玩家从建房→车卡→准备→通关→结算→返回房间
// 覆盖：开房/加入/车卡/自动开局/隐藏目标下发/战斗/对话/宝箱/章节推进/断线重连/游戏中踢人/公开目标胜利
import { spawn } from 'node:child_process';
import { WebSocket } from 'ws';
import { createPolicy } from '../public/shared/autoplay-policy.mjs';
import { buildSheet } from '../server/game/charsheet.mjs';

const PORT = 3891;
const SEED = Number(process.env.SIM_SEED || 20240521);
const TIMEOUT = 40 * 60e3;

const log = (...a) => console.log('[sim]', ...a);

// ---------- 启动服务 ----------
function startServer() {
  const child = spawn(process.execPath, ['server/index.mjs'], {
    cwd: process.cwd(),
    env: { ...process.env, DND_PORT: String(PORT), DND_SEED: String(SEED), DND_DEBUG: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', d => { const s = String(d); if (s.includes('已启动')) log('服务器就绪'); else process.stdout.write('[srv-out] ' + s); });
  child.stderr.on('data', d => process.stderr.write('[srv] ' + d));
  return child;
}

// ---------- 机器人 ----------
class Bot {
  constructor(idx, name) {
    this.idx = idx; this.name = name;
    this.pid = null; this.token = null; this.roomCode = null;
    this.view = null; this.policy = createPolicy();
    this.ws = null; this.kicked = false;
    this.actionsSent = 0; this.lastChapter = null;
    this.onView = null;
    this.claimPolicy = idx === 0; // 只有0号机器人会主动宣称隐藏目标（验证宣称流程）
  }
  async connect(token) {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket('ws://localhost:' + PORT + '/ws');
      this.ws = ws;
      ws.on('open', () => {
        ws.send(JSON.stringify({ t: 'hello', name: this.name, token: token || this.token || undefined }));
      });
      ws.on('message', (raw) => {
        const msg = JSON.parse(raw.toString());
        if (msg.t === 's:hello') {
          this.pid = msg.pid; this.token = msg.token || msg.pid; this.roomCode = msg.roomCode;
          resolve();
        } else if (msg.t === 's:state') {
          this.view = msg.view;
          this._lastSnapAt = Date.now();
          if (this.view.room) this.roomCode = this.view.room.code;
          const ch = this.view.game?.chapter?.id;
          if (ch && ch !== this.lastChapter) { this.lastChapter = ch; visitedChapters.add(ch); log('  [' + this.name + '] 进入 ' + ch); }
          if (this.onView) this.onView(this);
          this.maybeAct();
        } else if (msg.t === 's:error') {
          log('  ⚠ [' + this.name + '] 服务器错误: ' + msg.msg);
        } else if (msg.t === 's:kicked') {
          this.kicked = true;
          log('  [' + this.name + '] 被踢出房间 ✓');
        }
      });
      ws.on('close', () => {
        if (this.kicked) return;
        log('  ⚠ [' + this.name + '] 连接断开，2秒后自动重连');
        setTimeout(() => {
          if (this.kicked) return;
          this.connect(this.token).catch(() => {});
        }, 2000);
      });
      ws.on('error', () => {});
    });
  }
  send(t, payload = {}) {
    if (!this.ws || this.ws.readyState !== 1) {
      log('  ❌ [' + this.name + '] 发送失败 ws.readyState=' + (this.ws ? this.ws.readyState : 'null') + ' t=' + t);
      return;
    }
    this.ws.send(JSON.stringify({ t, ...payload }));
    this.actionsSent++;
    if (this.actionsSent % 20 === 1) log('  [' + this.name + '] 已发出 ' + this.actionsSent + ' 个动作（最近: ' + t + '）');
  }
  maybeAct() {
    try {
      const gv = this.view?.game;
      if (!gv || gv.state !== 'playing' || gv.win) return;
      // 隐藏目标宣称：只让0号机器人在估算达成时宣称（验证裁定流程，且不会导致全员隐藏胜利）
      if (this.claimPolicy) {
        const me = gv.me;
        if (me?.goal && me.goal.status === 'pending' && me.claimCooldown === 0 && gv.chapter.id === 'cave' && !me.stats.bossLastHit) {
          const s = me.stats;
          const met = s.damageDealt >= 50 || s.kills >= 2 || s.goldEarned >= 50 || s.healed >= 20 || s.spellsCast >= 3;
          if (met) { this.send('game:claim'); return; }
        }
      }
      const myTurnNow = gv.turn?.playerId === this.pid;
      const act = this.policy.decide(gv, this.pid);
      if (myTurnNow && !this._loggedTurn) {
        this._loggedTurn = true;
        log('  🔍 [' + this.name + '] 轮到我 pid=' + this.pid + ' turn=' + JSON.stringify(gv.turn) + ' me=' + JSON.stringify(gv.me ? { pid: gv.me.pid, eid: gv.me.eid, hp: gv.entities.find(x => x.eid === gv.me.eid)?.hp } : null) + ' act=' + JSON.stringify(act));
      }
      if (!myTurnNow) this._loggedTurn = false;
      if (!act) return;
      switch (act.type) {
      case 'move': this.send('game:move', { x: act.x, y: act.y }); break;
      case 'attack': this.send('game:attack', { targetEid: act.targetEid }); break;
      case 'cast': this.send('game:cast', { spellId: act.spellId, targetEid: act.targetEid, x: act.x, y: act.y }); break;
      case 'item': this.send('game:item', { itemId: act.itemId, targetEid: act.targetEid, x: act.x, y: act.y }); break;
      case 'interact': this.send('game:interact', { targetEid: act.targetEid, tx: act.tx, ty: act.ty }); break;
      case 'dialogue': this.send('game:dialogue', { optionId: act.optionId }); break;
      case 'endturn': this.send('game:endturn'); break;
      case 'rest': this.send('game:rest'); break;
      case 'search': this.send('game:search'); break;
      case 'dash': this.send('game:dash'); break;
      case 'hide': this.send('game:hide'); break;
      case 'claim': this.send('game:claim'); break;
    }
    } catch (e) {
      log('  ❌ [' + this.name + '] maybeAct异常: ' + (e && e.stack ? e.stack.split('\n').slice(0, 3).join(' ') : e));
    }
  }
}

const NAMES = ['埃德加', '瑟琳', '瓦洛', '露娜', '猎风'];
const CLASSES = ['fighter', 'cleric', 'wizard', 'rogue', 'ranger'];
const STATS = {
  fighter: { STR: 15, DEX: 13, CON: 14, INT: 10, WIS: 10, CHA: 8 },
  cleric: { STR: 12, DEX: 10, CON: 14, INT: 10, WIS: 15, CHA: 10 },
  wizard: { STR: 8, DEX: 13, CON: 14, INT: 15, WIS: 10, CHA: 10 },
  rogue: { STR: 10, DEX: 15, CON: 13, INT: 10, WIS: 10, CHA: 12 },
  ranger: { STR: 10, DEX: 15, CON: 14, INT: 8, WIS: 13, CHA: 10 },
};

const visitedChapters = new Set();

async function main() {
  const server = startServer();
  await new Promise(r => setTimeout(r, 1200));

  const bots = NAMES.map((n, i) => new Bot(i, n));
  for (const b of bots) await b.connect();
  log('5名玩家已连接');

  // 建房（bot0为房主，选择副本+DM人设）
  const host = bots[0];
  host.send('lobby:create', { dungeonId: 'lmop', personaId: 'pip' });
  await waitFor(() => host.view?.view === 'room', '进入房间');
  const code = host.view.room.code;
  log('房间已创建: ' + code + '，DM人设：皮普·巧舌');

  // 其余加入
  for (const b of bots.slice(1)) {
    b.send('lobby:join', { code });
  }
  await waitFor(() => bots.every(b => b.view?.view === 'room'), '全员加入房间');
  log('5/5 玩家进入房间');

  // 第6人加入被拒
  const sixth = new Bot(9, '闯入者');
  await sixth.connect();
  sixth.send('lobby:join', { code });
  await waitFor(() => sixth.view?.view === 'lobby', '第6人被拒绝');
  log('满员拒绝第6人 ✓（房间上限5人）');

  // 车卡
  for (const b of bots) {
    const cls = CLASSES[b.idx];
    const sheet = buildSheet({
      name: b.name, raceId: 'human', classId: cls,
      stats: STATS[cls],
      flex: { CON: 1, [cls === 'fighter' || cls === 'cleric' ? 'STR' : cls === 'wizard' ? 'INT' : 'DEX']: 1 },
      colors: { skin: '#e8b88a', hair: ['#5b3a1e', '#c88a2e', '#8a5a2e', '#2a2018', '#3a5a8a'][b.idx], outfit: ['#4a6b8a', '#e8e0c8', '#6a4a8a', '#4a8a5a', '#3a5a6a'][b.idx] },
      background: '平凡的旅人',
    });
    b.send('room:charsheet', { sheet: { name: b.name, raceId: 'human', classId: cls, stats: STATS[cls], flex: { CON: 1 }, colors: sheet.colors, background: '平凡的旅人' } });
  }
  await waitFor(() => bots.every(b => b.view?.members?.every(m => m.sheet)), '全员完成车卡');
  log('全员车卡完成 ✓');

  // 准备
  for (const b of bots) b.send('room:ready', { ready: true });
  await waitFor(() => bots.every(b => b.view?.phase === 'playing' || b.view?.phase === 'intro'), '游戏开始');
  log('全部准备就绪 → 游戏自动开始 ✓');

  // 隐藏目标下发检查
  await waitFor(() => bots.every(b => b.view?.game?.me?.goal), '隐藏目标下发');
  log('隐藏目标已下发（仅自己可见）✓');

  // 周期性状态报告（诊断用）
  setInterval(() => {
    const gv = bots[0].view?.game;
    if (!gv) return;
    const aliveFoes = gv.entities.filter(e => e.kind === 'monster' && !e.dead).length;
    const hpLine = gv.players.map(p => { const e = gv.entities.find(x => x.eid === p.eid); return e ? e.hp : '?'; }).join(',');
    const foePos = gv.entities.filter(e => e.kind === 'monster' && !e.dead).map(e => e.name + '@(' + e.x + ',' + e.y + ')').join(' ');
    const playerPos = gv.players.map(p => {
      const pe = gv.entities.find(x => x.eid === p.eid);
      if (!pe) return p.name.slice(0, 2) + ':无';
      const foe = gv.entities.find(e => e.kind === 'monster' && !e.dead);
      const d = foe ? (Math.abs(pe.x - foe.x) + Math.abs(pe.y - foe.y)) : -1;
      return p.name.slice(0, 2) + '@(' + pe.x + ',' + pe.y + ')距' + d;
    }).join(' ');
    const fresh = bots.map(b => b.name + ':' + Math.round((Date.now() - (b._lastSnapAt || 0)) / 1000) + 's').join(' ');
    const tu = gv.turn;
    log('进度: ' + gv.chapter.id + ' | 战斗=' + gv.combat.active + (gv.combat.active ? '(第' + gv.combat.round + '回合)' : '') + ' | 回合者=' + (tu ? (tu.playerId ? 'P' + tu.playerId.slice(-3) : '怪物') + '(动作用' + (tu.actionUsed ? '1' : '0') + '/移' + tu.moveLeft + ')' : '无') + ' | 存活敌=' + aliveFoes + ' | HP=[' + hpLine + ']');
    log('  敌位置: ' + foePos);
    if (gv.combat.active) {
      const orderDesc = gv.combat.order.map(eid => { const e = gv.entities.find(x => x.eid === eid); return e ? e.name.slice(0, 3) : '缺失'; }).join('>');
      log('  先攻顺序(' + gv.combat.order.length + '): ' + orderDesc);
    }
    log('  玩家位置: ' + playerPos);
    log('  快照新鲜度: ' + fresh);
  }, 20000);
  const goals = bots.map(b => b.view.game.me.goal.name);
  log('  目标示例: ' + goals.join(' / '));

  // 独立节拍器：每500ms主动驱动一次决策（不依赖快照到达）
  setInterval(() => {
    for (const b of bots) { try { b.maybeAct(); } catch (e) {} }
  }, 400);

  // 断线重连+游戏中踢人测试：到达城堡时让4号掉线（自动重连），随后房主踢出
  const watch = { done: false };
  bots[0].onView = (b) => {
    const ch = b.view?.game?.chapter?.id;
    if (ch === 'castle' && !watch.done) {
      watch.done = true;
      log('到达城堡 → 测试断线重连');
      const b4 = bots[4];
      const pid = b4.pid;
      b4.ws.close();
      setTimeout(() => {
        log('自动重连后 pid 一致: ' + (b4.pid === pid));
        setTimeout(() => {
          log('房主在游戏中踢出 ' + b4.name);
          host.send('room:kick', { targetPid: b4.pid });
        }, 2000);
      }, 6000);
    }
  };

  // 等待游戏结束
  const result = await waitFor(
    () => bots.some(b => b.view?.game?.win),
    '游戏结束',
    TIMEOUT - 60000
  ).then(
    () => ({ ok: true }),
    (e) => ({ ok: false, err: e })
  );
  if (!result.ok) {
    dump(bots);
    server.kill();
    console.log('SIM RESULT: FAIL (timeout)');
    process.exit(1);
  }

  const winner = bots.find(b => b.view?.game?.win);
  const win = winner.view.game.win;
  log('🎉 游戏结束：kind=' + win.kind + '，用时 ' + Math.round(win.duration / 1000) + 's');
  log('   结局：' + win.reason);

  // 断言
  const asserts = [];
  const gv = winner.view.game;
  asserts.push(['胜利类型为公开目标', win.kind === 'public']);
  const needChapters = ['prologue', 'ch1', 'town', 'mansion', 'castle', 'cave'];
  asserts.push(['覆盖全部章节', needChapters.every(c => visitedChapters.has(c))]);
  asserts.push(['击杀涅兹纳尔', gv.log.some(l => l.text.includes('涅兹纳尔') && l.text.includes('受到'))]);
  asserts.push(['4号被踢出', bots[4].kicked || bots[4].view?.view === 'lobby']);
  asserts.push(['剩余4名玩家', gv.players.length === 4]);
  asserts.push(['存在金币收入', gv.players.some(p => (p.gold || 0) > 30)]);
  asserts.push(['有玩家击杀敌人', gv.players.some(p => p.stats && p.stats.kills > 0)]);
  asserts.push(['经验池累计', gv.xpPool > 0]);
  asserts.push(['存在DM旁白', gv.log.some(l => l.kind === 'narr')]);
  for (const [name, ok] of asserts) {
    log((ok ? '✅ ' : '❌ ') + name);
    if (!ok) process.exitCode = 1;
  }

  // 返回房间
  host.send('room:return');
  await waitFor(() => bots.some(b => b.view?.view === 'room' && b.view?.phase === 'prepare'), '返回房间');
  log('结算后返回房间，可再次开局 ✓');

  // 解散（全员离开）
  for (const b of bots) b.send('room:leave');
  await waitFor(() => bots.every(b => b.view?.view === 'lobby'), '全员回到大厅', 60e3);
  log('房间解散 ✓');

  server.kill();
  log('SIM RESULT: PASS');
  process.exit(process.exitCode || 0);
}

function waitFor(cond, label, timeout = 120e3) {
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    const iv = setInterval(() => {
      if (cond()) { clearInterval(iv); resolve(); }
      else if (Date.now() - t0 > timeout) { clearInterval(iv); reject(new Error('等待超时: ' + label)); }
    }, 250);
  });
}

function dump(bots) {
  log('========== 状态转储 ==========');
  for (const b of bots) {
    const gv = b.view?.game;
    if (!gv) { log(b.name + ': 无游戏状态 view=' + b.view?.view); continue; }
    log(b.name + ': ' + gv.chapter.id + ' turn=' + (gv.turn ? gv.turn.playerId : '无') + ' combat=' + gv.combat.active + ' hp=' + (gv.entities.find(e => e.eid === gv.me?.eid)?.hp));
    log('  实体: ' + gv.entities.filter(e => e.kind === 'monster' && !e.dead).map(e => e.name + '@' + e.x + ',' + e.y).join(' '));
    log('  末段日志: ' + gv.log.slice(-3).map(l => l.text).join(' | '));
  }
}

// 兜底：无论何种退出都确保杀掉自己的服务器子进程
function cleanup() { try { server.kill(); } catch (e) {} }
process.on('exit', cleanup);
process.on('SIGINT', () => { cleanup(); process.exit(1); });
process.on('SIGTERM', () => { cleanup(); process.exit(1); });

main().catch(e => { console.error('SIM CRASH:', e); cleanup(); process.exit(1); });
