// S1-4 回归探针：AI DM战斗描述增强——节流/每场战斗上限/字数分档/战况摘要/语料扩充
// 用法：node tools/s1-4-flourish-check.mjs（离线可跑：LLM请求被mock拦截，不发真实调用）
import { Director } from '../server/dm/director.mjs';
import { PERSONAS, personaById } from '../server/dm/personas.mjs';
import { offlineNarrate, defaultVoice } from '../server/dm/narrator.mjs';

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) { pass++; } else { fail++; console.error('❌ ' + msg); } };

// ---- mock LLM：拦截fetch，记录请求体 ----
const calls = [];
globalThis.fetch = async (url, opts) => {
  calls.push(JSON.parse(opts.body));
  return { ok: true, json: async () => ({ choices: [{ message: { content: '（mock旁白）' } }] }) };
};

const fakeGame = () => ({
  closed: false, combatCount: 1, combat: { round: 2 },
  players: new Map([['p1', { dead: false }], ['p2', { dead: false }], ['p3', { dead: true }], ['p4', { dead: false }]]),
  entities: new Map([
    ['m1', { kind: 'monster', dead: false, hp: 5 }],
    ['m2', { kind: 'monster', dead: false, hp: 1 }],
    ['m3', { kind: 'monster', dead: true, hp: 0 }],
  ]),
  log: [{ text: '⚔️ 战斗日志样例' }],
  logMsg(t, text) { this.log.push({ text }); },
});
const mkDirector = () => { const d = new Director({ personaId: 'vald', dungeon: {} }); d.online = true; return d; };
const lastUser = () => calls[calls.length - 1].messages.find(m => m.role === 'user').content;
const bypassThrottle = (d) => { d._lastFlourish = 0; };

// T1 节流：同一瞬间两次常规加戏只发一次
{
  calls.length = 0;
  const d = mkDirector(), g = fakeGame();
  d.flourish(g, 'hit'); d.flourish(g, 'hit');
  await d.queue;
  ok(calls.length === 1, 'T1 节流：4秒内常规加戏仅触发1次（实际' + calls.length + '）');
}

// T2 每场战斗常规加戏上限4次
{
  calls.length = 0;
  const d = mkDirector(), g = fakeGame();
  for (let i = 0; i < 6; i++) { bypassThrottle(d); d.flourish(g, 'hit'); }
  await d.queue;
  ok(calls.length === 4, 'T2 每场战斗常规加戏上限4次（实际' + calls.length + '）');
}

// T3 关键事件不受上限约束 + 字数分档 + 战况摘要注入
{
  calls.length = 0;
  const d = mkDirector(), g = fakeGame();
  for (let i = 0; i < 5; i++) { bypassThrottle(d); d.flourish(g, 'hit'); } // 4次进、第5次被上限拦截
  bypassThrottle(d);
  d.noteCombat('铁锤布罗克对暗影蛛后打出了致命暴击');
  d.flourish(g, 'crit', { actor: '铁锤布罗克', target: '暗影蛛后' });
  await d.queue;
  ok(calls.length === 5, 'T3 关键事件(crit)不受常规上限约束（实际' + calls.length + '）');
  ok(lastUser().includes('200~300字'), 'T3 关键回合字数档200~300字');
  const hitReq = calls[0].messages.find(m => m.role === 'user').content;
  ok(hitReq.includes('100~150字'), 'T3 常规回合字数档100~150字');
  ok(lastUser().includes('当前战况：第2回合，3/4名冒险者仍在战斗，敌方尚有2名敌人负隅顽抗'), 'T3 战况摘要含回合数+双方存活比例');
  ok(lastUser().includes('铁锤布罗克对暗影蛛后打出了致命暴击'), 'T3 战况摘要含最近关键事件（叙事化）');
  ok(!/剩余|HP|hp\d/.test(lastUser().match(/当前战况：[\s\S]*?。/)?.[0] || ''), 'T3 摘要不含精确数值');
}

// T4 新战斗重置计数
{
  calls.length = 0;
  const d = mkDirector(), g = fakeGame();
  for (let i = 0; i < 4; i++) { bypassThrottle(d); d.flourish(g, 'hit'); }
  g.combatCount = 2; g.combat.round = 1;
  bypassThrottle(d);
  d.flourish(g, 'hit');
  await d.queue;
  ok(calls.length === 5, 'T4 新一场战斗计数重置，可再次触发（实际' + calls.length + '）');
}

// T5 胜利旁白使用结束前快照（_endCombat后round=0、怪物清零）
{
  calls.length = 0;
  const d = mkDirector(), g = fakeGame();
  g.combat.round = 5;
  d.noteCombat('牧师莉娜倒下了，生死未卜');
  for (const e of g.entities.values()) { e.dead = true; e.hp = 0; } // 真实流程：怪物全灭才会触发_endCombat
  d.noteEncounterEnd(g); // 模拟_endCombat调用
  g.combat = { active: false, round: 0, order: [], idx: 0 };
  d.flourish(g, 'victory', {}, { force: true });
  await d.queue;
  ok(calls.length === 1 && lastUser().includes('第5回合'), 'T5 胜利旁白使用结束前快照回合数');
  ok(lastUser().includes('敌方已被全部击倒'), 'T5 胜利旁白摘要正确描述敌方全灭');
  ok(lastUser().includes('牧师莉娜倒下了，生死未卜'), 'T5 胜利旁白摘要保留关键时刻');
}

// T6 离线语料：12人设×13战斗事件各≥5条，defaultVoice战斗事件6条，轮换不重复
{
  const combatEvents = ['combatStart', 'roundStart', 'attack', 'hit', 'miss', 'crit', 'fumble', 'down', 'death', 'kill', 'heal', 'victory', 'defeat'];
  let short = [];
  for (const p of PERSONAS) for (const ev of combatEvents) if ((p.voice[ev] || []).length < 5) short.push(p.id + '.' + ev);
  ok(PERSONAS.length === 12 && short.length === 0, 'T6 12人设×13战斗事件语料≥5条（缺：' + (short.join(',') || '无') + '）');
  for (const ev of ['combatStart', 'roundStart', 'hit', 'miss', 'crit', 'fumble', 'down', 'death', 'kill', 'heal', 'victory', 'defeat']) {
    ok(defaultVoice(ev).length === 6, 'T6 defaultVoice.' + ev + '扩充至6条');
  }
  const set = new Set();
  for (let i = 0; i < 5; i++) set.add(offlineNarrate('vald', 'hit', { actor: 'A', target: 'B', dmg: 9 }, i));
  ok(set.size === 5, 'T6 人设语料轮换连续5次不重复');
  const t = offlineNarrate('vald', 'hit', { actor: '铁砧', target: '地精', dmg: 12 }, 0);
  ok(!t.includes('{'), 'T6 模板占位符全部填充（' + t + '）');
}

// T7 人设风格差异抽查（瓦尔德硬朗短句 vs 莉莉安娜诗意）
{
  const v = personaById('vald').voice.crit[2] || '';
  const l = personaById('liliana').voice.crit[2] || '';
  ok(v && l && v !== l, 'T7 不同人设同一事件语料互异（瓦尔德：' + v.slice(0, 12) + '… / 莉莉安娜：' + l.slice(0, 12) + '…）');
}

console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('S1-4 flourish回归探针：' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
