// R1-5：前端能力次数键接线（还原 R1-2 修复并补上防回归）
// 背景：能力 id 形如 'f:dragonbreath'，服务端 charges 键为裸 id 'dragonbreath'。
// 09-13 用户 WIP 合并时 public/js/screens/game.mjs 整文件被覆盖，
// 界面改回直接查 me.charges[a.id]（恒为 0）→ 龙息/引导神力等按钮被误置灰。
// 既有 tests/r1-2-frontend/charge-key.test.mjs 只覆盖共享模块的 chargeKey/chargeOf，
// 不覆盖界面是否真的调用了它 —— 本测试补上该缺口。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { chargeKey, chargeOf } from '../../public/shared/autoplay-policy.mjs';

const SRC = new URL('../../public/js/screens/game.mjs', import.meta.url);
const src = readFileSync(SRC, 'utf8');

test('chargeOf 对 f: 前缀 id 命中裸键（行为层）', () => {
  const me = { charges: { dragonbreath: 1, channeldivinity: 0 } };
  assert.equal(chargeOf(me, 'f:dragonbreath'), 1);
  assert.equal(chargeOf(me, 'f:channeldivinity'), 0);
  assert.equal(chargeKey('f:dragonbreath'), 'dragonbreath');
});

test('界面 chapter 类能力可用性必须经 chargeOf 判定，不得直查 charges[a.id]（接线层）', () => {
  // 说明：screens/game.mjs 是闭包式 UI 模块（依赖 document/Canvas），
  // 无法在 node:test 中实例化，故对"是否调用了正确判定"做源码契约断言。
  // 这不是替实现细节背书，而是守住本次真实回归点：用法而不是算法。
  assert.match(src, /import\s*\{[^}]*\bchargeOf\b[^}]*\}\s*from\s*'\.\.\/\.\.\/shared\/autoplay-policy\.mjs'/,
    '必须从 shared/autoplay-policy.mjs 导入 chargeOf');
  assert.match(src, /a\.cost === 'chapter' && chargeOf\(me, a\.id\) <= 0/,
    'chapter 类能力必须用 chargeOf(me, a.id) 判定资源');
  assert.doesNotMatch(src.replace(/^\s*\/\/.*$/gm, ''), /me\.charges\[a\.id\]/,
    '禁止再用 me.charges[a.id] 直查（前缀会导致恒为 0）');
});
