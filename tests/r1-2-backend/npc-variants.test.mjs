// R1-2：NPC 对话变体——results 必须是完整句子，不能只剩一个字
import test from 'node:test';
import assert from 'node:assert/strict';
import { NPC_VARIANTS, randomNpcVariants } from '../../server/dm/npc-variants.mjs';

const ALT = () => 0;    // r() < 0.5 → useAlt = true
const ORIG = () => 0.9; // r() < 0.5 → useAlt = false

test('useAlt=true：results 是完整字符串，与 NPC_VARIANTS 原文完全一致', () => {
  const out = randomNpcVariants(ALT);
  for (const [npcId, v] of Object.entries(NPC_VARIANTS)) {
    for (const [oid, expect] of Object.entries(v.results || {})) {
      const got = out[npcId].results[oid];
      assert.equal(typeof got, 'string', `${npcId}.${oid} 应为字符串`);
      assert.equal(got.length > 1, true, `${npcId}.${oid} 长度应 >1（不能是单字）`);
      assert.equal(got, expect, `${npcId}.${oid} 应与原文完全一致`);
    }
  }
});

test('useAlt=true：sildar 的 rescue 回复不再是单字"西"', () => {
  const out = randomNpcVariants(ALT);
  assert.equal(out.sildar.results.rescue, NPC_VARIANTS.sildar.results.rescue);
  assert.notEqual(out.sildar.results.rescue, '西');
  assert.equal(out.sildar.results.rescue.startsWith('西达尔重获自由！'), true);
});

test('useAlt=true：options 仍取数组首项，greet 仍取数组首项', () => {
  const out = randomNpcVariants(ALT);
  for (const [npcId, v] of Object.entries(NPC_VARIANTS)) {
    assert.equal(out[npcId].greet, v.greet[0]);
    for (const [oid, arr] of Object.entries(v.options || {})) {
      assert.equal(typeof out[npcId].options[oid], 'string');
      assert.equal(out[npcId].options[oid], arr[0]);
    }
  }
});

test('useAlt=false：greet/options/results 全部为 null', () => {
  const out = randomNpcVariants(ORIG);
  for (const [npcId, v] of Object.entries(NPC_VARIANTS)) {
    assert.equal(out[npcId].greet, null, `${npcId}.greet`);
    for (const oid of Object.keys(v.options || {})) {
      assert.equal(out[npcId].options[oid], null, `${npcId}.options.${oid}`);
    }
    for (const oid of Object.keys(v.results || {})) {
      assert.equal(out[npcId].results[oid], null, `${npcId}.results.${oid}`);
    }
  }
});
