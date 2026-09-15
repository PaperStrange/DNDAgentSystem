// R1-5：能力可用性判定（还原 R1-2 修复 + 可被真正验证的防回归）
//
// 背景：能力 id 形如 'f:dragonbreath'，服务端 charges 键为裸 id 'dragonbreath'。
// 09-13 用户 WIP 合并时 public/js/screens/game.mjs 整文件被覆盖，界面改回直查
// me.charges[a.id]（前缀导致恒为 0）→ 龙息/引导神力等按钮被误置灰。
// 既有 tests/r1-2-frontend/charge-key.test.mjs 只覆盖共享模块的 chargeKey/chargeOf，
// 不覆盖界面是否用了正确判定；而 screens/game.mjs 依赖 document/Canvas，无法在
// node:test 中实例化。故本次把判定抽成纯函数 abilityNoResource，在此做行为层断言。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { abilityNoResource, chargeKey, chargeOf } from '../../public/shared/autoplay-policy.mjs';

const chapter = (id) => ({ id, cost: 'chapter', name: '测试能力' });
const slot = (id) => ({ id, cost: 'slot', name: '测试法术' });

test('chapter 类：有次数 → 可用（去 f: 前缀后命中裸键）', () => {
  assert.equal(abilityNoResource({ charges: { dragonbreath: 1 } }, chapter('f:dragonbreath')), false);
});

test('chapter 类：次数为 0 → 不可用（负例）', () => {
  assert.equal(abilityNoResource({ charges: { channeldivinity: 0 } }, chapter('f:channeldivinity')), true);
});

test('chapter 类：charges 中无该键 → 不可用（负例）', () => {
  assert.equal(abilityNoResource({ charges: {} }, chapter('f:dragonbreath')), true);
});

test('chapter 类：me 无 charges 字段 → 不可用（负例，防 undefined 崩溃）', () => {
  assert.equal(abilityNoResource({}, chapter('f:dragonbreath')), true);
  assert.equal(abilityNoResource(undefined, chapter('f:dragonbreath')), true);
});

test('chapter 类：id 不带 f: 前缀同样命中裸键', () => {
  assert.equal(abilityNoResource({ charges: { dragonbreath: 2 } }, chapter('dragonbreath')), false);
});

test('chapter 类：带 f: 前缀若直查 charges[a.id] 会恒为 0 —— 本用例即守住该回归点', () => {
  const me = { charges: { dragonbreath: 1 } };
  const a = chapter('f:dragonbreath');
  // 直查的错误写法结果（用于说明，不参与断言）
  assert.equal(me.charges[a.id], undefined, '直查带前缀 id 拿不到值，这正是按钮被误置灰的根因');
  assert.equal(abilityNoResource(me, a), false, '正确实现必须判为可用');
});

test('slot 类：有 1 环法术位 → 可用；无或缺失 → 不可用（含负例）', () => {
  assert.equal(abilityNoResource({ slots: { '1': 2 } }, slot('s:healingword')), false);
  assert.equal(abilityNoResource({ slots: { '1': 0 } }, slot('s:healingword')), true);
  assert.equal(abilityNoResource({ slots: {} }, slot('s:healingword')), true);
  assert.equal(abilityNoResource({}, slot('s:healingword')), true);
});

test('其余 cost（武器攻击等）不受资源限制；a 缺失时保守判为不可用', () => {
  assert.equal(abilityNoResource({}, { id: 'w:longsword', cost: undefined }), false);
  assert.equal(abilityNoResource({}, undefined), true);
});

test('共享模块 chargeKey/chargeOf 行为不变（与既有 r1-2 用例对齐）', () => {
  assert.equal(chargeKey('f:dragonbreath'), 'dragonbreath');
  assert.equal(chargeOf({ charges: { dragonbreath: 1 } }, 'f:dragonbreath'), 1);
});

// 接线层：辅助校验，仅确认界面确实复用了共享纯函数（不作为唯一判据）
test('界面必须复用 abilityNoResource，不得内联直查 me.charges[a.id]（辅助）', () => {
  const src = readFileSync(new URL('../../public/js/screens/game.mjs', import.meta.url), 'utf8');
  const code = src.replace(/^\s*\/\/.*$/gm, ''); // 去掉整行注释，避免注释文本造成误判
  assert.match(code, /abilityNoResource\(/, '界面应调用 abilityNoResource');
  assert.doesNotMatch(code, /me\.charges\[/, '界面不应再直查 me.charges[...]');
});
