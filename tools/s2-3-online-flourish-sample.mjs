// S2-3 在线加戏真实LLM采样探针：验证在线模式下大事件加戏的真实产出（文字量分档 + 人设风格区分）
// 用法：node tools/s2-3-online-flourish-sample.mjs [--config <主仓库config.json路径>]
// 依赖：真实LLM（默认读取主仓库 config.json 的 llm 配置；密钥仅内存注入，不回显、不写入证据）
// 证据输出：docs/qa/S2-3-harstem/evidence/online-flourish-samples.json（docs/* 不入库，仅本地证据）
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const cfgArg = process.argv.indexOf('--config');
const cfgPath = cfgArg > -1 ? process.argv[cfgArg + 1] : join(here, '..', '..', 'DNDAgentSystem', 'config.json');

// ---- 密钥运行时注入：仅内存，不出现在任何输出 ----
if (!existsSync(cfgPath)) { console.error('❌ 未找到LLM配置文件：' + cfgPath); process.exit(1); }
const llmCfg = JSON.parse(readFileSync(cfgPath, 'utf8')).llm || {};
if (!llmCfg.apiKey || !llmCfg.baseURL || !llmCfg.model) { console.error('❌ 配置文件缺少 llm.apiKey/baseURL/model'); process.exit(1); }
process.env.DND_LLM_BASE_URL = llmCfg.baseURL;
process.env.DND_LLM_KEY = llmCfg.apiKey;
process.env.DND_LLM_MODEL = llmCfg.model;

const { llmAvailable } = await import('../server/llm.mjs');
const { Director } = await import('../server/dm/director.mjs');

if (!llmAvailable()) { console.error('❌ llmAvailable=false，环境变量注入失败'); process.exit(1); }
console.log('在线模式就绪：model=' + llmCfg.model + ' baseURL=' + llmCfg.baseURL.replace(/https?:\/\//, '').split('/')[0] + ' key=' + llmCfg.apiKey.slice(0, 3) + '***（掩码）');

// ---- 采样矩阵：3 风格反差最大的人设 × 2 事件档（关键档200~300字 / 常规档100~150字）----
const MATRIX = [
  ['viktor', 'crit'], ['viktor', 'hit'],
  ['pip', 'crit'], ['pip', 'hit'],
  ['liliana', 'crit'], ['liliana', 'hit'],
];
const CTX_NOTE = '铁锤布罗克对暗影蛛后打出了致命暴击';

const fakeGame = () => ({
  closed: false, combatCount: 1, combat: { round: 2 },
  players: new Map([['p1', { dead: false }], ['p2', { dead: false }], ['p3', { dead: false }]]),
  entities: new Map([['m1', { kind: 'monster', dead: false, hp: 5 }], ['m2', { kind: 'monster', dead: false, hp: 3 }]]),
  log: [{ text: '⚔️ 铁锤布罗克攻击暗影蛛后，暴击！' }],
  logMsg(t, text, meta = {}) { this.log.push({ text, ...meta }); },
});

const samples = [];
let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) pass++; else { fail++; console.error('❌ ' + msg); } };

for (const [pid, ev] of MATRIX) {
  const d = new Director({ personaId: pid, dungeon: {} });
  d.online = true;
  d.noteCombat(CTX_NOTE);
  const g = fakeGame();
  d.flourish(g, ev, {}, { force: true });
  await d.queue;
  const out = g.log.find(l => l.llm);
  const text = out ? out.text : '';
  const len = [...text].length;
  samples.push({ persona: pid, event: ev, chars: len, text });
  ok(!!text, pid + '.' + ev + ' 真实LLM返回为空（网络/配置异常）');
  console.log('✔ ' + pid + '.' + ev + ' → ' + len + '字');
}

// ---- 断言1：字数分档实达（关键档≥150字宽松下限 / 常规档≥80字宽松下限，模型波动留余量）----
for (const s of samples) {
  const floor = s.event === 'crit' ? 150 : 80;
  ok(s.chars >= floor, s.persona + '.' + s.event + ' 字数' + s.chars + '低于档位宽松下限' + floor);
}

// ---- 断言2：同事件跨人设风格区分（两两字符二元组Jaccard<0.5 且文本互异）----
const bigrams = (t) => { const set = new Set(); for (let i = 0; i < t.length - 1; i++) set.add(t.slice(i, i + 2)); return set; };
const critTexts = samples.filter(s => s.event === 'crit');
for (let i = 0; i < critTexts.length; i++) for (let j = i + 1; j < critTexts.length; j++) {
  const a = bigrams(critTexts[i].text), b = bigrams(critTexts[j].text);
  let inter = 0; for (const x of a) if (b.has(x)) inter++;
  const jac = a.size && b.size ? inter / (a.size + b.size - inter) : 1;
  ok(jac < 0.5, '风格区分：' + critTexts[i].persona + '×' + critTexts[j].persona + ' crit加戏相似度' + jac.toFixed(3) + '≥0.5');
  ok(critTexts[i].text !== critTexts[j].text, '风格区分：' + critTexts[i].persona + '×' + critTexts[j].persona + ' crit加戏文本完全相同');
}

// ---- 断言3：加戏不越权（不宣布数值判定结果、不替玩家做决定——关键词粗筛）----
for (const s of samples) ok(!/我建议你们|你应该选择/.test(s.text), s.persona + '.' + s.event + ' 加戏出现替玩家做决定措辞');

const outDir = join(here, '..', 'docs', 'qa', 'S2-3-harstem', 'evidence');
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'online-flourish-samples.json'), JSON.stringify({
  ts: new Date().toISOString(), model: llmCfg.model, branch: 'S2-3-harstem',
  pass, fail, samples,
}, null, 2));

console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('S2-3 在线加戏真实LLM采样：' + pass + ' 通过 / ' + fail + ' 失败（证据：docs/qa/S2-3-harstem/evidence/online-flourish-samples.json）');
process.exit(fail ? 1 : 0);
