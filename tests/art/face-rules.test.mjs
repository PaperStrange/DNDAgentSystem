// ART-3-A1 §4.6「面部可辨识度验收规则」自动化验证（验证驱动：先立规则，再修实现）
// 依据：docs/art/ART-2-A1-美术圣经-B方向草案-20260923.md §4.2–4.6
// 说明：规则 1/2/3/4/5/7 可机检；规则 6（16 倍放大目视）为人工目视项，见截图证据。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HUMANOID, RACE_GRIDS, applyLook, spritePalette } from '../../public/js/pixel.mjs';

const RACES = ['human', 'elf', 'dwarf', 'halfling', 'halforc', 'dragonborn', 'gnome', 'halfelf'];
const relLum = (hex) => { const n = parseInt(hex.slice(1), 16); return 0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255); };
const lumDiff = (a, b) => { const la = relLum(a), lb = relLum(b); return Math.abs(la - lb) / Math.max(la, lb, 1e-9); };
const baseLook = () => ({ hair: 0, beard: 0, brow: 0, mouth: 0, marking: 0 });

// 规则 1：16px 去色测试（近似）——面部画布（rows1–7）必须承载全部部件像素
test('§4.6-1 去色可辨：面部 rows1–7 承载额高光/眉/眼/瞳/鼻/口 部件像素', () => {
  const g = HUMANOID;
  assert.ok(g[2].includes('T'), 'row2 缺额高光 T');
  assert.ok(g[4].includes('h') && g[4].includes('s'), 'row4 缺眉(h)+额中肤(s)');
  assert.ok(g[5].includes('e') && g[5].includes('p'), 'row5 缺眼白 e / 瞳孔 p');
  assert.ok(g[5].includes('S'), 'row5 缺鼻梁阴影 S');
  assert.ok(g[6].includes('S') && g[6].includes('s'), 'row6 缺鼻(S)+颊(s)');
  assert.ok(g[7].includes('q') || g[7].includes('d'), 'row7 缺口部 q/d');
});

// 规则 2：护目镜反例测试——不存在任何一行连续 ≥4px 眼白
test('§4.6-2 护目镜反例：任何行连续眼白 e < 4px（8 种族）', () => {
  for (const r of RACES) {
    for (const row of RACE_GRIDS[r]) {
      let run = 0, max = 0;
      for (const ch of row) { if (ch === 'e') { run++; if (run > max) max = run; } else run = 0; }
      assert.ok(max < 4, r + ' 行「' + row + '」连续眼白=' + max + 'px（须 <4）');
    }
  }
});

// 规则 3：瞳孔测试——p 与 o、p 与 e 明度差均 ≥45%
test('§4.6-3 瞳孔测试：瞳孔 p 与轮廓 o / 眼白 e 明度差均 ≥45%', () => {
  const pal = spritePalette('player', null, { skin: '#e8b88a', hair: '#4a2a18', outfit: '#8a3030' });
  assert.ok(lumDiff(pal.p, pal.o) >= 0.45, 'p vs o = ' + (lumDiff(pal.p, pal.o) * 100).toFixed(1) + '%（须≥45%）');
  assert.ok(lumDiff(pal.p, pal.e) >= 0.45, 'p vs e = ' + (lumDiff(pal.p, pal.e) * 100).toFixed(1) + '%（须≥45%）');
});

// 规则 4：嘴部反例测试——默认面部口行「中央」不含轮廓色 o（修 D3 的 o-s-o-s-o 格栅）
test('§4.6-4 嘴部反例：默认面部口行中央不含轮廓色 o', () => {
  const g = HUMANOID;
  const eyeRow = g.findIndex((row) => row.includes('e'));
  const mouthRow = eyeRow + 2;
  const mid = Math.floor(g[mouthRow].length / 2);
  const center = g[mouthRow].slice(mid - 2, mid + 2); // 口部中央 4px（下颌两侧的 o 属剪影，不计）
  assert.ok(!center.includes('o'), '口行「' + g[mouthRow] + '」中央「' + center + '」含 o');
});

// 规则 5：种族测试（近似）——8 种族网格两两不同
test('§4.6-5 种族测试（近似）：8 种族网格两两不同', () => {
  for (let i = 0; i < RACES.length; i++) for (let j = i + 1; j < RACES.length; j++) {
    assert.notEqual(RACE_GRIDS[RACES[i]].join('|'), RACE_GRIDS[RACES[j]].join('|'),
      RACES[i] + ' 与 ' + RACES[j] + ' 网格完全相同（§4.5 要求每族专属特征）');
  }
});

// 规则 7：捏脸有效测试——每一档发型/胡须/眉/唇/纹饰均产生可见差异
test('§4.6-7 捏脸有效：8 发型 / 5 胡须 / 4 眉 / 3 唇 / 4 纹饰 每档均与基准不同', () => {
  const pal = spritePalette('player', null, { skin: '#e8b88a', hair: '#4a2a18', outfit: '#8a3030' });
  const base = applyLook(HUMANOID, pal, baseLook()).grid.join('|');
  const ranges = { hair: 8, beard: 5, brow: 4, mouth: 3, marking: 4 };
  for (const [key, n] of Object.entries(ranges)) {
    for (let i = 1; i < n; i++) {
      const g = applyLook(HUMANOID, pal, { ...baseLook(), [key]: i }).grid.join('|');
      assert.notEqual(g, base, key + '=' + i + ' 与基准无差异（§4.6-7 要求每档可见）');
    }
  }
});
