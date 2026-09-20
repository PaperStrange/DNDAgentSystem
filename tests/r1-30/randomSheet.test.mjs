// R1-30：randomSheet 对「全部职业」生成合法 sheet 的回归测试
//
// 缺陷（修复前）：server/game/charsheet.mjs 的随机车卡处理次序硬编码为
//   ['DEX', 'CON', cls.main, 'WIS', 'CHA', 'STR']
// 当 cls.main 命中该数组中的固定项（STR / DEX / WIS）时，该项重复、INT 被漏掉
// ⇒ stats.INT 经 `+= 1` 后为 NaN ⇒ buildSheet 的属性校验直接抛异常。
// 实测：5 个职业中 4 个（战士/游荡者/牧师/游侠）失败，仅 main=INT 的法师可用。
//
// 修复：以 ATTRS（唯一权威清单）旋转派生处理次序，令 cls.main 恰在 index 2，
// 保证六项属性各出现一次（结构上消除「重复 main / 漏 INT」这类缺陷）。
//
// 本测试覆盖全部职业，断言：不抛异常 · 六项属性均为 8~15 的有限整数 · 购点不超池。
import { test } from 'node:test';
import assert from 'node:assert';
import { setSeed } from '../../server/util.mjs';
import { randomSheet, CLASSES } from '../../server/game/charsheet.mjs';
import { ATTRS } from '../../server/rules/rulesdb.mjs';
import { usedPoints } from '../../public/shared/chargen-points.mjs';
import { MIN_STAT, MAX_STAT, POINT_POOL } from '../../public/shared/char-defs.mjs';

// setSeed 使随机车卡完全确定（同一 seed 必得同一 race/class/属性）。
const N = 500;

function assertValidSheet(sh, ctx) {
  assert.ok(sh && typeof sh === 'object', ctx + '：应返回 sheet 对象');
  const keys = Object.keys(sh.base).sort();
  assert.deepEqual(keys, [...ATTRS].sort(), ctx + '：base 必须且只含六项属性，实为 ' + JSON.stringify(keys));
  for (const a of ATTRS) {
    const v = sh.base[a];
    assert.ok(
      Number.isInteger(v) && v >= MIN_STAT && v <= MAX_STAT,
      ctx + '：属性 ' + a + ' 必须为 ' + MIN_STAT + '~' + MAX_STAT + ' 的整数，实为 ' + String(v),
    );
  }
  const spent = usedPoints(sh.base);
  assert.ok(spent <= POINT_POOL, ctx + '：购点花费 ' + spent + ' 不得超过池 ' + POINT_POOL);
}

// 扫描确定性 seed，返回 classId -> { seed, sheet }；全程断言每个 sheet 合法。
function scanWitnesses() {
  const witnesses = {};
  for (let s = 1; s <= N; s++) {
    setSeed(s);
    const sh = randomSheet('t' + s); // 不抛异常即通过
    assertValidSheet(sh, 'seed=' + s + ' cls=' + sh.class);
    if (!witnesses[sh.class]) witnesses[sh.class] = { seed: s, sheet: sh };
  }
  return witnesses;
}

test('R1-30：扫描 ' + N + ' 个确定性 seed —— 全程不抛异常、每个 sheet 均合法、且覆盖全部职业', () => {
  const witnesses = scanWitnesses();
  for (const c of CLASSES) {
    assert.ok(
      witnesses[c.id],
      '必须覆盖职业 ' + c.id + '（' + c.name + '）；实际覆盖=' + Object.keys(witnesses).join(',') + '（原缺陷下仅 wizard 可用）',
    );
  }
  assert.equal(Object.keys(witnesses).length, CLASSES.length, '必须覆盖全部 ' + CLASSES.length + ' 个职业');
});

test('R1-30：每个职业逐一生成合法 sheet 并复现（含 main=STR 的战士）', () => {
  const witnesses = scanWitnesses();
  for (const c of CLASSES) {
    const w = witnesses[c.id];
    assert.ok(w, '未找到职业 ' + c.id + ' 的见证 seed');
    setSeed(w.seed);
    const sh = randomSheet('t' + w.seed);
    assert.equal(sh.class, c.id, 'seed=' + w.seed + ' 应稳定生成 ' + c.id);
    assertValidSheet(sh, 'cls=' + c.id + '（' + c.name + '）seed=' + w.seed);
  }
});

test('R1-30：main=STR（战士）生成含 INT 的完整六属性（回归本卡原始缺陷）', () => {
  const w = scanWitnesses().fighter;
  assert.ok(w, '未覆盖战士');
  setSeed(w.seed);
  const sh = randomSheet('fighter-regression');
  assert.equal(sh.class, 'fighter');
  assert.ok(
    Number.isInteger(sh.base.INT),
    'INT 必须是整数，不得为 NaN/undefined（原缺陷：order 漏 INT ⇒ NaN）',
  );
  assert.ok(sh.base.INT >= MIN_STAT && sh.base.INT <= MAX_STAT);
  assert.equal(Object.keys(sh.base).length, ATTRS.length, '六项属性必须齐备');
});

test('R1-30：购点规则未改（基础值 8–15、池 27、六项属性）', () => {
  assert.equal(MIN_STAT, 8);
  assert.equal(MAX_STAT, 15);
  assert.equal(POINT_POOL, 27);
  assert.equal(ATTRS.length, 6);
});
