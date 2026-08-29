// 32x40 人类男性肖像基准样本 v0.1 — Hua（设计侧）
// 用途：捏脸系统视觉升级的全种族绘制基准 + 实现层像素规格
// 运行：node gen-baseline.mjs -> portrait-baseline-human-male-v0.1.svg
import { writeFileSync } from 'node:fs';

const W = 32, H = 40, SCALE = 12;

const PALETTE = {
  o: '#2a1a1a', // 描边
  s: '#e8b183', // 皮肤基色
  S: '#c17d55', // 皮肤阴影
  T: '#f7d3a8', // 皮肤高光
  h: '#5b3a24', // 头发基色
  H: '#8a5a33', // 头发高光
  d: '#4a2f1d', // 眉毛
  e: '#f5efe6', // 眼白
  i: '#4a6b8a', // 虹膜
  p: '#241812', // 瞳孔
  k: '#ffffff', // 眼部高光
  n: '#b06a45', // 鼻影/鼻孔
  m: '#b35a50', // 唇色
  M: '#8a3f38', // 唇部暗角
  E: '#d9a077', // 耳廓
  t: '#b97a50', // 耳廓内影
  u: '#3a5a8c', // 外衣
  U: '#5a7aac', // 外衣高光
};

const g = Array.from({ length: H }, () => Array(W).fill('.'));
const set = (x, y, c) => { if (x >= 0 && x < W && y >= 0 && y < H) g[y][x] = c; };
const span = (x0, x1, y, c) => { for (let x = x0; x <= x1; x++) set(x, y, c); };

// 头发主体
span(12, 19, 2, 'h');
span(10, 21, 3, 'h');
for (let y = 4; y <= 8; y++) span(8, 23, y, 'h');
span(10, 12, 5, 'H'); span(10, 11, 6, 'H'); set(11, 4, 'H'); // 左上受光高光

// 脸部
span(10, 21, 8, 's');
for (let y = 9; y <= 24; y++) span(9, 22, y, 's');
span(10, 21, 25, 's');
span(11, 20, 26, 's');
span(12, 19, 27, 's');

// 耳廓（脸部两侧外扩 2px）
for (let y = 14; y <= 16; y++) { span(6, 7, y, 'E'); span(24, 25, y, 'E'); }
set(7, 15, 't'); set(24, 15, 't');

// 颈部（下颏阴影 -> 基色）
span(13, 18, 28, 'S');
span(13, 18, 29, 's');
span(13, 18, 30, 's');

// 外衣（先画，颈部覆盖其上）
span(8, 23, 30, 'u');
for (let y = 31; y <= 39; y++) span(5, 26, y, 'u');
span(12, 19, 31, 'U');            // 领口高光
span(7, 8, 31, 'U'); span(7, 7, 32, 'U'); // 左肩受光

// 光影（光源左上）
span(12, 14, 9, 'T');              // 额头高光
for (let y = 11; y <= 23; y++) set(21, y, 'S'); // 右脸阴影带
span(19, 20, 25, 'S'); set(18, 26, 'S');        // 下颏阴影

// 鬓角
for (let y = 8; y <= 12; y++) { span(9, 10, y, 'h'); span(21, 22, y, 'h'); }

// 眉毛（男性较宽）
span(10, 13, 10, 'd'); span(18, 21, 10, 'd');

// 眼睛 3x2：上排 眼白/高光/眼白，下排 虹膜/瞳孔/虹膜
set(11, 11, 'e'); set(12, 11, 'k'); set(13, 11, 'e');
set(18, 11, 'e'); set(19, 11, 'k'); set(20, 11, 'e');
set(11, 12, 'i'); set(12, 12, 'p'); set(13, 12, 'i');
set(18, 12, 'i'); set(19, 12, 'p'); set(20, 12, 'i');

// 鼻子：鼻梁高光 + 右侧鼻影 + 鼻孔
for (let y = 15; y <= 17; y++) set(15, y, 'T');
for (let y = 15; y <= 17; y++) set(16, y, 'n');
span(15, 16, 18, 'n');
set(14, 19, 'n'); set(17, 19, 'n');
span(15, 16, 20, 'S');

// 嘴唇
span(13, 18, 21, 'm');
set(13, 22, 'M'); span(14, 17, 22, 'm'); set(18, 22, 'M');
span(14, 17, 23, 'S');

// 下颏高光
span(15, 16, 24, 'T');

// 轮廓描边：与填充像素四邻接的背景像素转为描边
const filled = (x, y) => x >= 0 && x < W && y >= 0 && y < H && g[y][x] !== '.';
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  if (g[y][x] === '.' && (filled(x - 1, y) || filled(x + 1, y) || filled(x, y - 1) || filled(x, y + 1))) g[y][x] = 'o';
}

const rects = [];
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  const c = g[y][x];
  if (c === '.') continue;
  const fill = PALETTE[c];
  if (!fill) throw new Error(`未知字符 '${c}' @ (${x},${y})`);
  rects.push(`<rect x="${x * SCALE}" y="${y * SCALE}" width="${SCALE}" height="${SCALE}" fill="${fill}"/>`);
}

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W * SCALE}" height="${H * SCALE}" viewBox="0 0 ${W * SCALE} ${H * SCALE}" shape-rendering="crispEdges">
<rect width="100%" height="100%" fill="#1c1824"/>
${rects.join('\n')}
</svg>`;

writeFileSync(new URL('./portrait-baseline-human-male-v0.1.svg', import.meta.url), svg);
console.log('OK: portrait-baseline-human-male-v0.1.svg (' + rects.length + ' pixels)');
