// R1-30 探针：randomSheet 对「全部职业」生成合法 sheet 的验证装置
//
// 用法：node tools/r1-30-randomSheet-probe.mjs
// 环境：R130_N 迭代数（默认 500）
// 输出：控制台 + docs/qa/restart-sprint1/r1-30/r1-30-evidence.json + r1-30-transcript.log
//
// 说明：randomSheet 的种族/职业由 util.mjs 的种子 RNG 选取（pick(RACES) → pick(CLASSES)）。
// 本探针先用 setSeed(seed) 预测该 seed 会选中的职业，再复位同一种子调用 randomSheet，
// 从而把「失败」精确归因到具体职业 —— 这是「覆盖全部职业」的硬证据。
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setSeed, pick } from '../server/util.mjs';
import { randomSheet, CLASSES, RACES } from '../server/game/charsheet.mjs';
import { ATTRS } from '../server/rules/rulesdb.mjs';
import { usedPoints } from '../public/shared/chargen-points.mjs';
import { MIN_STAT, MAX_STAT, POINT_POOL } from '../public/shared/char-defs.mjs';

const N = Number(process.env.R130_N || 500);
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'docs/qa/restart-sprint1/r1-30');

const lines = [];
const log = (s) => { lines.push(s); console.log(s); };

// 预测 seed 选中的职业（消费 race 一次、再取 class）
function predictClass(seed) {
  setSeed(seed);
  pick(RACES);
  return pick(CLASSES).id;
}

const perClass = {};       // classId -> { ok, fail }
const errs = {};           // 错误信息 -> 次数
const witnesses = {};      // classId -> 首个成功的 seed
const samples = {};        // classId -> 样本（base/spent/race）
const rows = [];           // 全量逐 seed 结果（用于修复前后逐行对照）
let ok = 0, fail = 0;

for (let s = 1; s <= N; s++) {
  const clsId = predictClass(s);
  perClass[clsId] = perClass[clsId] || { ok: 0, fail: 0 };
  setSeed(s);
  try {
    const sh = randomSheet('t' + s);
    const bad = [];
    for (const a of ATTRS) {
      const v = sh.base[a];
      if (!Number.isInteger(v) || v < MIN_STAT || v > MAX_STAT) bad.push(a + '=' + String(v));
    }
    const spent = usedPoints(sh.base);
    if (bad.length || spent > POINT_POOL) {
      fail++; perClass[clsId].fail++;
      const key = 'INVALID[' + bad.join(',') + '] spent=' + spent;
      errs[key] = (errs[key] || 0) + 1;
      rows.push({ seed: s, cls: clsId, ok: false, err: key });
    } else {
      ok++; perClass[clsId].ok++;
      rows.push({ seed: s, cls: clsId, ok: true, race: sh.race, base: sh.base, spent });
      if (!witnesses[clsId]) {
        witnesses[clsId] = s;
        samples[clsId] = { seed: s, race: sh.race, class: sh.class, base: sh.base, spent };
      }
    }
  } catch (e) {
    fail++; perClass[clsId].fail++;
    const msg = (e && e.message) || String(e);
    errs[msg] = (errs[msg] || 0) + 1;
    rows.push({ seed: s, cls: clsId, ok: false, err: msg });
  }
}

const covered = CLASSES.filter(c => (perClass[c.id]?.ok || 0) > 0).map(c => c.id);
const coveredAll = covered.length === CLASSES.length;

log('== R1-30 randomSheet 全职业探针 ==');
log('N=' + N);
log('ok=' + ok + '  fail=' + fail);
log('errs=' + JSON.stringify(errs));
log('perClass=' + JSON.stringify(perClass));
log('classesAll=' + CLASSES.map(c => c.id).join(','));
log('classesCovered(成功)=' + covered.join(','));
log('coveredAll=' + coveredAll);
log('witnesses=' + JSON.stringify(witnesses));
for (const c of CLASSES) if (samples[c.id]) log('sample[' + c.id + ']=' + JSON.stringify(samples[c.id]));

mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'r1-30-evidence.json'), JSON.stringify({
  N, ok, fail, errs, perClass,
  classesAll: CLASSES.map(c => c.id),
  classesCovered: covered,
  coveredAll,
  witnesses, samples,
  rows,
}, null, 2));
writeFileSync(join(outDir, 'r1-30-transcript.log'), lines.join('\n') + '\n');
log('written: docs/qa/restart-sprint1/r1-30/r1-30-evidence.json');
