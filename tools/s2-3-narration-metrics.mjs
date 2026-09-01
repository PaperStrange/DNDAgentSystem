// S2-3 G-33 返工验证基线探针：文字量 / 语料覆盖 / 人设区分度 / 轮换不重复（离线确定性，无LLM/网络）
// 用法：node tools/s2-3-narration-metrics.mjs
// 证据输出：docs/qa/S2-3-harstem/evidence/metrics-baseline.json（docs/* 不入库，仅本地证据）
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PERSONAS } from '../server/dm/personas.mjs';
import { offlineNarrate, defaultVoice } from '../server/dm/narrator.mjs';

const CTX = { actor: '铁锤布罗克', target: '暗影蛛后', dmg: 12, n: 3, hp: 8, item: '治疗药水', place: '回声波洞穴', roll: 17 };
const COMBAT_EVENTS = ['combatStart', 'roundStart', 'attack', 'hit', 'miss', 'crit', 'fumble', 'down', 'death', 'kill', 'heal', 'victory', 'defeat'];

let pass = 0, fail = 0;
const problems = [];
const ok = (cond, msg) => { if (cond) pass++; else { fail++; problems.push(msg); } };

// ---- 1. 文字量：12人设×13战斗事件的填充后字数分布 ----
const lenStats = {};
let shortest = [];
for (const p of PERSONAS) {
  lenStats[p.id] = {};
  for (const ev of COMBAT_EVENTS) {
    const arr = p.voice[ev] || [];
    const rendered = arr.map((tpl, i) => offlineNarrate(p.id, ev, CTX, i));
    const lens = rendered.map(r => [...r].length);
    const min = Math.min(...lens), max = Math.max(...lens), mean = Math.round(lens.reduce((a, b) => a + b, 0) / lens.length);
    lenStats[p.id][ev] = { count: arr.length, min, mean, max };
    for (let i = 0; i < rendered.length; i++) if (lens[i] < 8) shortest.push(p.id + '.' + ev + '[' + i + '](' + lens[i] + '字)');
  }
}
ok(shortest.length === 0, '文字量：存在<8字的过短战斗语料：' + (shortest.slice(0, 8).join('，') || ''));

// ---- 2. 语料覆盖：12人设×13事件各≥5条；占位符全部可填充 ----
const short = [];
for (const p of PERSONAS) for (const ev of COMBAT_EVENTS) if ((p.voice[ev] || []).length < 5) short.push(p.id + '.' + ev + '(' + (p.voice[ev] || []).length + ')');
ok(PERSONAS.length === 12 && short.length === 0, '覆盖：12人设×13战斗事件语料<5条：' + (short.join('，') || ''));
const unfilled = [];
for (const p of PERSONAS) for (const ev of Object.keys(p.voice)) {
  (p.voice[ev] || []).forEach((tpl, i) => { if (/\{\w+\}/.test(offlineNarrate(p.id, ev, CTX, i))) unfilled.push(p.id + '.' + ev + '[' + i + ']'); });
}
ok(unfilled.length === 0, '占位符：存在未填充模板：' + (unfilled.slice(0, 8).join('，') || ''));

// ---- 3. 轮换不重复：同一事件连续5次旁白互异（F-37轮换机制） ----
const dupEvents = [];
for (const p of PERSONAS) for (const ev of COMBAT_EVENTS) {
  const set = new Set();
  for (let i = 0; i < 5; i++) set.add(offlineNarrate(p.id, ev, CTX, i));
  if (set.size < 5) dupEvents.push(p.id + '.' + ev + '(' + set.size + '/5)');
}
ok(dupEvents.length === 0, '轮换：连续5次出现重复：' + (dupEvents.slice(0, 8).join('，') || ''));

// ---- 4. 人设区分度：字符二元组签名两两Jaccard ----
const strip = (s) => s.replace(/\{\w+\}/g, '×');
const bigrams = (p) => {
  const set = new Set();
  for (const ev of Object.keys(p.voice)) for (const tpl of p.voice[ev]) {
    const t = strip(tpl);
    for (let i = 0; i < t.length - 1; i++) set.add(t.slice(i, i + 2));
  }
  return set;
};
const sigs = PERSONAS.map(p => ({ id: p.id, set: bigrams(p) }));
let maxSim = 0, maxPair = '', sumSim = 0, pairCnt = 0;
for (let i = 0; i < sigs.length; i++) for (let j = i + 1; j < sigs.length; j++) {
  const a = sigs[i].set, b = sigs[j].set;
  let inter = 0; for (const g of a) if (b.has(g)) inter++;
  const jac = inter / (a.size + b.size - inter);
  sumSim += jac; pairCnt++;
  if (jac > maxSim) { maxSim = jac; maxPair = sigs[i].id + '×' + sigs[j].id; }
}
ok(maxSim < 0.30, '区分度：最高两两签名相似度 ' + maxSim.toFixed(3) + '（' + maxPair + '）超过阈值0.30');

// ---- 5. 跨人设同事件语料重复（完全同串视为风格同质化） ----
const crossDup = [];
for (const ev of COMBAT_EVENTS) {
  const seen = new Map();
  for (const p of PERSONAS) for (const tpl of (p.voice[ev] || [])) {
    if (seen.has(tpl)) crossDup.push(ev + '：' + seen.get(tpl) + '↔' + p.id);
    else seen.set(tpl, p.id);
  }
}
ok(crossDup.length === 0, '跨人设重复语料：' + (crossDup.slice(0, 8).join('，') || ''));

// ---- 6. 离线模式单场战斗旁白文字量（模拟5回合遭遇，轮换取词） ----
const simCombat = [];
let totalChars = 0, totalLines = 0;
const pick = (pid, ev) => { const t = offlineNarrate(pid, ev, CTX, simCombat.length); simCombat.push(t); totalChars += [...t].length; totalLines++; };
const demoPersona = 'morgrave';
pick(demoPersona, 'combatStart');
for (let r = 1; r <= 5; r++) {
  pick(demoPersona, 'roundStart');
  pick(demoPersona, 'attack');
  pick(demoPersona, r === 3 ? 'crit' : (r % 2 ? 'hit' : 'miss'));
}
pick(demoPersona, 'kill'); pick(demoPersona, 'victory');
const perLine = Math.round(totalChars / totalLines);

// ---- 汇总 ----
const overall = {};
for (const p of PERSONAS) {
  const all = COMBAT_EVENTS.flatMap(ev => {
    const s = lenStats[p.id][ev]; return Array(s.count).fill(s.mean);
  });
  overall[p.id] = { avgLen: Math.round(all.reduce((a, b) => a + b, 0) / all.length) };
}
const report = {
  ts: new Date().toISOString(),
  base: 'main@9a7aa80 (S2-5 ECS迁移后)',
  pass, fail, problems,
  metrics: {
    personas: PERSONAS.length,
    combatEvents: COMBAT_EVENTS.length,
    lenStats,
    perPersonaAvgLen: overall,
    signatureSimilarity: { max: +maxSim.toFixed(3), maxPair, avg: +(sumSim / pairCnt).toFixed(3) },
    crossPersonaDupCount: crossDup.length,
    rotationDuplicates: dupEvents.length,
    offlineSimCombat: { persona: demoPersona, lines: totalLines, totalChars, avgCharsPerLine: perLine },
    defaultVoiceCombatCounts: Object.fromEntries(COMBAT_EVENTS.map(ev => [ev, defaultVoice(ev).length])),
  },
};
const outDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'docs', 'qa', 'S2-3-harstem', 'evidence');
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'metrics-baseline.json'), JSON.stringify(report, null, 2));
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('S2-3 G-33 基线度量：' + pass + ' 通过 / ' + fail + ' 失败');
if (problems.length) console.log('问题：\n' + problems.map(p => '❌ ' + p).join('\n'));
console.log('人设平均语料长度：' + Object.entries(overall).map(([k, v]) => k + '=' + v.avgLen).join(' '));
console.log('签名相似度 max=' + maxSim.toFixed(3) + '(' + maxPair + ') avg=' + (sumSim / pairCnt).toFixed(3));
console.log('离线模拟战斗（' + demoPersona + '）：' + totalLines + '行/' + totalChars + '字，行均' + perLine + '字');
process.exit(fail ? 1 : 0);
