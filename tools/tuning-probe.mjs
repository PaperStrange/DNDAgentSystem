// 难度调校探针（F-22/F-32）：
// 1) AI DM按规则书调校：离线公式确定性验证（等级差→HP/伤害调整，钳制范围）
// 2) 上章表现→下一章难度（离线公式：艰难降/轻松升）
// 3) 服务端快照下发调校参数+怪物实体数值按调校生效
// 4) NPC对话变体生效（greet/选项为字符串，覆盖全部NPC；在线失败降级离线变体）
import { spawn } from 'node:child_process';
import { WebSocket } from 'ws';
import { setSeed } from '../server/util.mjs';
import { Game } from '../server/game/game.mjs';
import { Director } from '../server/dm/director.mjs';
import { buildSheet } from '../server/game/charsheet.mjs';
import { DUNGEONS } from '../server/game/dungeon.mjs';

const log = (...a) => console.log('[tuning]', ...a);
let failed = false;
const ok = (m) => log('✅ ' + m);
const fail = (m) => { failed = true; log('❌ ' + m); };

// ---------- 单元级：离线公式（直接构造Game） ----------
setSeed(424242);
{
  const sheets = new Map();
  for (const [name, cls] of [['A', 'fighter'], ['B', 'cleric']]) {
    sheets.set(name, buildSheet({ name, raceId: 'human', classId: cls, stats: { STR: 15, DEX: 13, CON: 14, INT: 10, WIS: 10, CHA: 8 }, flex: { CON: 1 } }));
  }
  const director = new Director({ personaId: 'aldric', dungeon: { id: 'lmop' } });
  const g = new Game({ room: { code: 'T1', dungeonId: 'lmop' }, sheets, personaId: 'aldric', director });
  // 构造器已按序章等级上限把队伍升到Lv2——手工拉回Lv1验证公式（等级差→调校）
  for (const p of g.players.values()) p.level = 1;
  const prologue = DUNGEONS[0].chapters[0];
  const cave = DUNGEONS[0].chapters[5];
  // F-22：Lv1队伍进入序章（等级上限2）：hpMul=0.9 dmgMul=0.92（严格公式）
  const t0 = g.offlineTuningFor(prologue, null);
  if (t0.hpMul === 0.9 && t0.dmgMul === 0.92 && t0.countDelta === 0) ok('F-22 离线公式：Lv1队(上限2)生命×0.9 伤害×0.92');
  else fail('F-22 离线公式异常：' + JSON.stringify(t0));
  // 实际开局：序章自动升级到Lv2 → 与上限持平，无调校（不动点）
  for (const p of g.players.values()) p.level = 2;
  const tFlat = g.offlineTuningFor(prologue, null);
  if (tFlat.hpMul === 1 && tFlat.dmgMul === 1 && tFlat.countDelta === 0) ok('F-22 离线公式：等级持平=不动点(×1.0)');
  else fail('F-22 不动点异常：' + JSON.stringify(tFlat));
  // F-32：上一章表现艰难（倒地2+）→ 降难度（基础Lv1对终章上限4：HP×0.8/伤害×0.85 → 再降0.15/0.1，下限钳制0.7/0.8）
  const hard = g.offlineTuningFor(cave, { downs: 2, damageTaken: 30, restsUsed: 2, kills: 3, maxHpSum: 40 });
  if (hard.hpMul === 0.7 && hard.dmgMul === 0.8) ok('F-32 离线公式：上章艰难(倒地2) → HP×0.7 伤害×0.8');
  else fail('F-32 艰难降难度异常：' + JSON.stringify(hard));
  // F-32：等级达标（Lv4=终章上限）且游刃有余（无倒地、轻伤、击杀≥2）→ 适度升难度（+0.05，数量+1）
  for (const p of g.players.values()) p.level = 4;
  const easy = g.offlineTuningFor(cave, { downs: 0, damageTaken: 8, restsUsed: 0, kills: 3, maxHpSum: 40 });
  if (easy.hpMul === 1.05 && easy.dmgMul === 1 && easy.countDelta === 1) ok('F-32 离线公式：等级达标且上章轻松 → HP×1.05 数量+1');
  else fail('F-32 轻松升难度异常：' + JSON.stringify(easy));
  // F-32：等级未达标时即使游刃有余也不升难度（规则书：遭遇难度与队伍等级相称）
  for (const p of g.players.values()) p.level = 1;
  const under = g.offlineTuningFor(cave, { downs: 0, damageTaken: 8, restsUsed: 0, kills: 3, maxHpSum: 40 });
  if (under.hpMul === 0.8 && under.countDelta === 0) ok('F-32 离线公式：等级未达标只降不升（HP×0.8/数量+0）');
  else fail('F-32 等级门控异常：' + JSON.stringify(under));
  // 钳制：BOSS章数量增量恒为0、HP上限1.15
  const clampTest = g._clampTuning({ hpMul: 9, dmgMul: 9, countDelta: 9 }, true);
  if (clampTest.hpMul === 1.15 && clampTest.dmgMul === 1.15 && clampTest.countDelta === 0) ok('F-22 钳制：非法数值被拒绝（BOSS HP≤1.15/数量0）');
  else fail('F-22 钳制异常：' + JSON.stringify(clampTest));
  // 怪物工厂应用调校：手动设调校后新实体HP/伤害倍率生效
  g.tuning.chapters.prologue = { hpMul: 0.9, dmgMul: 0.92, countDelta: 0 };
  const m = g._monsterEntity('goblin', { def: 'goblin', squad: 'ambush', count: 4 }, 3, 3, 'ambush');
  if (m.maxHp <= 7 && m.attacks[0].dmgMul === 0.92) ok('F-22 实体工厂应用调校（HP=' + m.maxHp + '≤7、dmgMul=0.92）');
  else fail('F-22 实体工厂未应用调校：' + JSON.stringify({ hp: m.maxHp, mul: m.attacks[0].dmgMul }));
  g.closed = true;
}

// ---------- 网络级：开房后快照含调校参数 + NPC对话变体 ----------
const PORT = 3895;
const server = spawn(process.execPath, ['server/index.mjs'], {
  cwd: process.cwd(),
  env: { ...process.env, DND_PORT: String(PORT), DND_SEED: '424242', DND_OFFLINE: '1' },
  stdio: ['ignore', 'ignore', 'inherit'],
});
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
async function main() {
  await sleep(1500);
  const ws = new WebSocket('ws://localhost:' + PORT + '/ws');
  let pid = null, view = null;
  ws.on('message', (raw) => {
    const m = JSON.parse(raw.toString());
    if (m.t === 's:hello') pid = m.pid;
    if (m.t === 's:state') view = m.view;
  });
  const send = (t, p = {}) => ws.send(JSON.stringify({ t, ...p }));
  await new Promise(r => ws.on('open', r));
  const acct = '调校员' + (Date.now() % 100000);
  send('hello', { action: 'register', account: acct, password: 'tn1234' });
  await sleep(600);
  send('lobby:create', { dungeonId: 'lmop', personaId: 'aldric' });
  await sleep(500);
  const sheet = buildSheet({ name: '调校侠', raceId: 'human', classId: 'fighter', stats: { STR: 15, DEX: 13, CON: 14, INT: 10, WIS: 10, CHA: 8 }, flex: { CON: 1 } });
  send('room:charsheet', { sheet: { name: '调校侠', raceId: 'human', classId: 'fighter', stats: { STR: 15, DEX: 13, CON: 14, INT: 10, WIS: 10, CHA: 8 }, flex: { CON: 1 }, colors: sheet.colors } });
  await sleep(500);
  send('room:ready', { ready: true });
  await sleep(300);
  send('room:start');
  for (let i = 0; i < 30; i++) { await sleep(500); if (view?.game?.state === 'playing') break; }
  const gv = view?.game;
  if (gv && gv.tuning) {
    // 序章：队伍已自动升级到Lv2（等级上限2）→ 不动点×1.0；城堡（上限3）→ 0.9/0.92
    const t = gv.tuning.prologue;
    if (t && t.hpMul === 1 && t.dmgMul === 1) ok('F-22 开局快照下发调校参数（序章等级持平=×1.0不动点）');
    else fail('F-22 序章调校参数异常：' + JSON.stringify(t));
    const tc = gv.tuning.castle;
    if (tc && tc.hpMul === 0.9 && tc.dmgMul === 0.92) ok('F-22 快照城堡章调校（Lv2对上限3：HP×0.9 伤害×0.92）');
    else fail('F-22 城堡章调校异常：' + JSON.stringify(tc));
    const mon = gv.entities.find(e => e.kind === 'monster');
    if (mon && mon.maxHp < 7) ok('F-22 开局怪物按调校生成（HP=' + mon.maxHp + '<7，单人缩放）');
    else fail('F-22 开局怪物HP未按调校：' + JSON.stringify(mon));
    const tuneLog = gv.log.some(l => l.text.includes('难度调校'));
    if (tuneLog) ok('F-22 调校日志写入冒险日志');
    else fail('F-22 缺少调校日志');
  } else fail('F-22 快照无tuning');
  // F-32：NPC对话变体（离线随机变体结构完整：覆盖全部NPC/选项/回复）
  {
    const { randomNpcVariants } = await import('../server/dm/npc-variants.mjs');
    const { NPCS } = await import('../server/game/dungeon.mjs');
    const variants = randomNpcVariants(() => 0.1); // 固定rnd<0.5 → 全部采用备用文案
    const ids = Object.keys(NPCS);
    let okNpcs = 0;
    for (const id of ids) {
      const n = NPCS[id];
      const v = variants[id];
      const greetOk = typeof v?.greet === 'string' && v.greet.trim().length > 10;
      const optOk = n.options.every(o => typeof v?.options?.[o.id] === 'string' && v.options[o.id].trim().length > 0);
      const resOk = n.options.filter(o => o.result?.log).every(o => typeof v?.results?.[o.id] === 'string' && v.results[o.id].trim().length > 0);
      if (greetOk && optOk && resOk) okNpcs++;
    }
    if (okNpcs === ids.length) ok('F-32 NPC对话变体结构完整（' + okNpcs + '位NPC：greet/选项/回复变体齐备）');
    else fail('F-32 NPC对话变体异常：' + okNpcs + '/' + ids.length);
  }
  // F-23：状态机字段
  if (gv?.team && gv.team.state && gv.me?.states) ok('F-23 快照含团队状态(' + gv.team.state + ')与玩家状态机');
  else fail('F-23 快照缺状态机字段');
  ws.close();
  server.kill();
  log(failed ? 'TUNING RESULT: FAIL' : 'TUNING RESULT: PASS');
  process.exit(failed ? 1 : 0);
}
main().catch(e => { console.error('CRASH:', e); server.kill(); process.exit(1); });
