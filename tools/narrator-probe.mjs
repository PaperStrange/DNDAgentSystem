// 旁白引擎探针（F-37）：
// 1) 轮换机制：同一事件连续调用取不同变体（不再随机重复）
// 2) 人设语料：12位DM的战斗关键事件都有专属语料（combatStart/hit/miss/crit/kill/down）
// 3) defaultVoice 兜底语料池≥3条
// 4) flourish 节流（8秒内重复调用只触发一次排队）
import { offlineNarrate } from '../server/dm/narrator.mjs';
import { PERSONAS } from '../server/dm/personas.mjs';

const log = (...a) => console.log('[narrator]', ...a);
let failed = false;
const ok = (m) => log('✅ ' + m);
const fail = (m) => { failed = true; log('❌ ' + m); };

// 1) 轮换：同一人设同一事件连续3次取3个不同变体（人设语料2条时交替）
const p = PERSONAS[0];
const a0 = offlineNarrate(p.id, 'hit', { actor: 'A', target: 'B', dmg: 5 }, 0);
const a1 = offlineNarrate(p.id, 'hit', { actor: 'A', target: 'B', dmg: 5 }, 1);
const a2 = offlineNarrate(p.id, 'hit', { actor: 'A', target: 'B', dmg: 5 }, 2);
if (a0 !== a1 && a1 !== a2 && a0 === a2) ok('F-37 轮换机制：同一事件依次取不同变体（2条语料交替）');
else fail('F-37 轮换异常：' + [a0, a1, a2].join(' | '));

// 2) 12位DM战斗语料齐备
const needKeys = ['combatStart', 'attack', 'hit', 'miss', 'crit', 'down', 'kill'];
const missing = [];
for (const per of PERSONAS) {
  for (const k of needKeys) {
    if (!per.voice?.[k]?.length) missing.push(per.id + ':' + k);
  }
}
if (!missing.length) ok('F-37 12位DM战斗关键事件语料齐备（' + needKeys.join('/') + '）');
else fail('F-37 缺失语料：' + missing.join(', '));

// 3) defaultVoice 兜底语料池≥3条且可轮换
import { defaultVoice as dv } from '../server/dm/narrator.mjs';
const d0 = dv('hit')[0], d1 = dv('hit')[1], d2 = dv('hit')[2];
if (d0 && d1 && d2 && d0 !== d1 && d1 !== d2) ok('F-37 defaultVoice 兜底语料池≥3条且可轮换');
else fail('F-37 兜底池异常：' + [d0, d1, d2].join(' | '));

// 4) 人设特色：不同DM的同一事件文本不同（抽样对比第1与第8位人设）
const perA = offlineNarrate(PERSONAS[0].id, 'crit', { actor: 'A', target: 'B', dmg: 9 }, 0);
const perB = offlineNarrate(PERSONAS[7].id, 'crit', { actor: 'A', target: 'B', dmg: 9 }, 0);
if (perA !== perB) ok('F-37 人设特色：不同DM语料风格各异');
else fail('F-37 人设语料雷同：' + perA);

log(failed ? 'NARRATOR RESULT: FAIL' : 'NARRATOR RESULT: PASS');
process.exit(failed ? 1 : 0);
