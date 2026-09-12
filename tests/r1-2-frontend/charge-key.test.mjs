// R1-2：能力 id 带 'f:' 前缀，服务端 charges 键为裸 id，查询前必须去前缀
import test from 'node:test';
import assert from 'node:assert/strict';
import { chargeKey, chargeOf } from '../../public/shared/autoplay-policy.mjs';

test('chargeKey 去掉 f: 前缀，其余 id 原样返回', () => {
  assert.equal(chargeKey('f:dragonbreath'), 'dragonbreath');
  assert.equal(chargeKey('f:channeldivinity'), 'channeldivinity');
  assert.equal(chargeKey('dragonbreath'), 'dragonbreath');
  assert.equal(chargeKey('s:healingword'), 's:healingword');
});

test('chargeOf 命中裸 id 键，未命中/无 charges 返回 0', () => {
  const me = { charges: { dragonbreath: 1, channeldivinity: 0 } };
  assert.equal(chargeOf(me, 'f:dragonbreath'), 1);
  assert.equal(chargeOf(me, 'f:channeldivinity'), 0);
  assert.equal(chargeOf(me, 'f:tactician'), 0);
  assert.equal(chargeOf({ charges: {} }, 'f:dragonbreath'), 0);
  assert.equal(chargeOf({}, 'f:dragonbreath'), 0);
});
