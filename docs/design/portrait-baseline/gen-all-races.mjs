// 8 种族基准像生成管线 v1.0 — Hua（设计侧）
// 画布：32×40，缩放 12x，左上光源
// 输出：SVG + PNG（含完整性校验）
// 运行：node gen-all-races.mjs
import { writeFileSync, mkdirSync, existsSync, unlinkSync, statSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, 'output');
mkdirSync(OUT, { recursive: true });

const W = 32, H = 40, SCALE = 12;
const BG = '#1c1824';

// ==================== PNG 编码 ====================
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function hex2rgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function encodePNG(w, h, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6;
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    const off = y * w * 4;
    const dst = y * (w * 4 + 1) + 1;
    if (rgba.copy) rgba.copy(raw, dst, off, off + w * 4);
    else raw.set(rgba.subarray(off, off + w * 4), dst);
  }
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

// ==================== 网格工具 ====================
function makeGrid() { return Array.from({ length: H }, () => Array(W).fill('.')); }
function set(g, x, y, c) { if (x >= 0 && x < W && y >= 0 && y < H) g[y][x] = c; }
function span(g, x0, x1, y, c) { for (let x = x0; x <= x1; x++) set(g, x, y, c); }
function rect(g, x0, y0, x1, y1, c) { for (let y = y0; y <= y1; y++) span(g, x0, x1, y, c); }

function autoOutline(g) {
  const filled = (x, y) => x >= 0 && x < W && y >= 0 && y < H && g[y][x] !== '.';
  const out = g.map(r => r.slice());
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (g[y][x] !== '.' ) continue;
    if (filled(x-1,y) || filled(x+1,y) || filled(x,y-1) || filled(x,y+1)) out[y][x] = 'o';
  }
  return out;
}

// ==================== SVG 输出 ====================
function gridToSVG(g, palette) {
  const rects = [];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const c = g[y][x];
    if (c === '.') continue;
    const fill = palette[c];
    if (!fill) throw new Error(`未知字符 '${c}' @ (${x},${y})`);
    rects.push(`<rect x="${x*SCALE}" y="${y*SCALE}" width="${SCALE}" height="${SCALE}" fill="${fill}"/>`);
  }
  const vw = W * SCALE, vh = H * SCALE;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${vw}" height="${vh}" viewBox="0 0 ${vw} ${vh}" shape-rendering="crispEdges">
<rect width="100%" height="100%" fill="${BG}"/>
${rects.join('\n')}
</svg>`;
}

// ==================== PNG 输出 ====================
function gridToPNG(g, palette) {
  const rgba = Buffer.alloc(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const c = g[y][x];
    const off = (y * W + x) * 4;
    if (c === '.') {
      rgba[off] = 0; rgba[off+1] = 0; rgba[off+2] = 0; rgba[off+3] = 0;
    } else {
      const [r, gg, b] = hex2rgb(palette[c] || '#ff00ff');
      rgba[off] = r; rgba[off+1] = gg; rgba[off+2] = b; rgba[off+3] = 255;
    }
  }
  return encodePNG(W, H, rgba);
}

// ==================== 通用绘制模块 ====================
function drawFace(g, faceRows, skinBase, skinShadow, skinHighlight) {
  for (const [y, [x0, x1]] of Object.entries(faceRows)) span(g, x0, x1, +y, skinBase);
  return { skinBase, skinShadow, skinHighlight };
}

function drawHair(g, hairRows, hairBase, hairHighlight) {
  for (const [y, [x0, x1]] of Object.entries(hairRows)) span(g, x0, x1, +y, hairBase);
  // 高光默认左上
  const ys = Object.keys(hairRows).map(Number).sort((a,b) => a-b);
  if (ys.length >= 2) {
    const [x0] = hairRows[ys[1]];
    set(g, x0 + 1, ys[1], hairHighlight);
    set(g, x0 + 2, ys[1], hairHighlight);
  }
  if (ys.length >= 3) {
    const [x0] = hairRows[ys[2]];
    set(g, x0, ys[2], hairHighlight);
  }
}

function drawEarsNormal(g, y0, y1, skinBase, earBase, earInner) {
  for (let y = y0; y <= y1; y++) {
    span(g, 6, 7, y, earBase);
    span(g, 24, 25, y, earBase);
  }
  set(g, 7, y0 + 1, earInner);
  set(g, 24, y0 + 1, earInner);
}

function drawNeck(g, y0, y1, x0, x1, skinBase, skinShadow) {
  span(g, x0, x1, y0, skinShadow);
  for (let y = y0 + 1; y <= y1; y++) span(g, x0, x1, y, skinBase);
}

function drawBody(g, bodyRows, outfitBase, outfitHighlight) {
  for (const [y, [x0, x1]] of Object.entries(bodyRows)) span(g, x0, x1, +y, outfitBase);
  // 左肩高光
  const ys = Object.keys(bodyRows).map(Number).sort((a,b) => a-b);
  if (ys.length >= 2) {
    const [x0] = bodyRows[ys[1]];
    set(g, x0, ys[1], outfitHighlight);
    set(g, x0 + 1, ys[1], outfitHighlight);
  }
}

function drawEyes(g, y, lx, rx, eyeWhite, iris, pupil, highlight) {
  // 每眼 3x2：上排 白/高光/白，下排 虹膜/瞳孔/虹膜
  set(g, lx, y, eyeWhite); set(g, lx+1, y, highlight); set(g, lx+2, y, eyeWhite);
  set(g, rx, y, eyeWhite); set(g, rx+1, y, highlight); set(g, rx+2, y, eyeWhite);
  set(g, lx, y+1, iris); set(g, lx+1, y+1, pupil); set(g, lx+2, y+1, iris);
  set(g, rx, y+1, iris); set(g, rx+1, y+1, pupil); set(g, rx+2, y+1, iris);
}

function drawBrows(g, y, lx0, lx1, rx0, rx1, browColor) {
  span(g, lx0, lx1, y, browColor);
  span(g, rx0, rx1, y, browColor);
}

function drawNose(g, y0, y1, cx, noseShadow, noseHighlight, skinShadow) {
  for (let y = y0; y <= y1 - 2; y++) {
    set(g, cx, y, noseHighlight);
    set(g, cx + 1, y, noseShadow);
  }
  span(g, cx, cx + 1, y1 - 1, noseShadow);
  set(g, cx - 1, y1, noseShadow);
  set(g, cx + 2, y1, noseShadow);
  span(g, cx, cx + 1, y1 + 1, skinShadow);
}

function drawMouth(g, y, x0, x1, lipColor, lipDark, skinShadow) {
  span(g, x0, x1, y, lipColor);
  set(g, x0, y + 1, lipDark);
  span(g, x0 + 1, x1 - 1, y + 1, lipColor);
  set(g, x1, y + 1, lipDark);
  span(g, x0 + 1, x1 - 1, y + 2, skinShadow);
}

// ==================== 1. 人类男性 ====================
function drawHumanMale() {
  const g = makeGrid();
  const P = {
    o: '#2a1a1a', s: '#e8b183', S: '#c17d55', T: '#f7d3a8',
    h: '#5b3a24', H: '#8a5a33', d: '#4a2f1d',
    e: '#f5efe6', i: '#4a6b8a', p: '#241812', k: '#ffffff',
    n: '#b06a45', m: '#b35a50', M: '#8a3f38',
    E: '#d9a077', t: '#b97a50', u: '#3a5a8c', U: '#5a7aac',
  };
  // 头发
  drawHair(g, { 2: [12,19], 3: [10,21], 4: [8,23], 5: [8,23], 6: [8,23], 7: [8,23], 8: [8,23] }, P.h, P.H);
  // 脸
  drawFace(g, { 8: [10,21], 9: [9,22], 10: [9,22], 11: [9,22], 12: [9,22], 13: [9,22], 14: [9,22], 15: [9,22], 16: [9,22], 17: [9,22], 18: [9,22], 19: [9,22], 20: [9,22], 21: [9,22], 22: [9,22], 23: [9,22], 24: [9,22], 25: [10,21], 26: [11,20], 27: [12,19] }, P.s, P.S, P.T);
  // 耳
  drawEarsNormal(g, 14, 16, P.s, P.E, P.t);
  // 颈
  drawNeck(g, 28, 30, 13, 18, P.s, P.S);
  // 身体
  drawBody(g, { 30: [8,23], 31: [7,24], 32: [6,25], 33: [5,26], 34: [5,26], 35: [5,26], 36: [5,26], 37: [5,26], 38: [5,26], 39: [5,26] }, P.u, P.U);
  span(g, 12, 19, 31, P.U); // 领口高光
  // 光影
  span(g, 12, 14, 9, P.T); // 额头高光
  for (let y = 11; y <= 23; y++) set(g, 21, y, P.S); // 右脸阴影
  span(g, 19, 20, 25, P.S); set(g, 18, 26, P.S); // 下颏阴影
  // 鬓角
  for (let y = 8; y <= 12; y++) { span(g, 9, 10, y, P.h); span(g, 21, 22, y, P.h); }
  // 描边
  const g2 = autoOutline(g);
  // 五官（描边之上）
  drawBrows(g2, 10, 10, 13, 18, 21, P.d);
  drawEyes(g2, 11, 11, 18, P.e, P.i, P.p, P.k);
  drawNose(g2, 15, 19, 15, P.n, P.T, P.S);
  drawMouth(g2, 21, 13, 18, P.m, P.M, P.S);
  span(g2, 15, 16, 24, P.T); // 下颏高光
  return { grid: g2, palette: P };
}

// ==================== 2. 精灵 ====================
function drawElf() {
  const g = makeGrid();
  const P = {
    o: '#2a1a1a', s: '#f0c8a0', S: '#d0a078', T: '#fce8d8',
    h: '#c8c0d0', H: '#e8e0f0', d: '#a098a8',
    e: '#f5f0f0', i: '#48a060', p: '#1a2818', k: '#ffffff',
    n: '#c09070', m: '#c07068', M: '#985050',
    E: '#e0b890', t: '#c09870', u: '#3a6888', U: '#5888a8',
  };
  // 长发（银紫，覆盖两侧）
  drawHair(g, { 2: [11,20], 3: [9,22], 4: [8,23], 5: [7,24], 6: [7,24], 7: [7,24], 8: [7,24] }, P.h, P.H);
  // 脸（略窄下颌）
  drawFace(g, { 8: [10,21], 9: [9,22], 10: [9,22], 11: [9,22], 12: [9,22], 13: [9,22], 14: [9,22], 15: [9,22], 16: [9,22], 17: [9,22], 18: [9,22], 19: [9,22], 20: [9,22], 21: [9,22], 22: [9,22], 23: [9,22], 24: [9,22], 25: [10,21], 26: [11,20], 27: [12,19] }, P.s, P.S, P.T);
  // 尖耳
  for (let y = 13; y <= 18; y++) { span(g, 6, 7, y, P.E); span(g, 24, 25, y, P.E); }
  set(g, 5, 12, P.E); set(g, 5, 13, P.E); set(g, 4, 11, P.E);
  set(g, 26, 12, P.E); set(g, 26, 13, P.E); set(g, 27, 11, P.E);
  set(g, 3, 11, P.s); set(g, 28, 11, P.s); // 耳尖皮肤
  set(g, 6, 15, P.t); set(g, 25, 15, P.t); // 耳内影
  // 长发贴面鬓角
  for (let y = 8; y <= 18; y++) { set(g, 8, y, P.h); set(g, 23, y, P.h); }
  // 颈
  drawNeck(g, 28, 30, 13, 18, P.s, P.S);
  // 身体
  drawBody(g, { 30: [8,23], 31: [7,24], 32: [6,25], 33: [5,26], 34: [5,26], 35: [5,26], 36: [5,26], 37: [5,26], 38: [5,26], 39: [5,26] }, P.u, P.U);
  span(g, 12, 19, 31, P.U);
  // 光影
  span(g, 12, 14, 9, P.T);
  for (let y = 11; y <= 23; y++) set(g, 21, y, P.S);
  // 描边
  const g2 = autoOutline(g);
  // 五官
  drawBrows(g2, 10, 11, 13, 18, 20, P.d); // 略细
  drawEyes(g2, 11, 11, 18, P.e, P.i, P.p, P.k);
  drawNose(g2, 15, 19, 15, P.n, P.T, P.S);
  drawMouth(g2, 21, 14, 17, P.m, P.M, P.S); // 嘴略小
  span(g2, 15, 16, 24, P.T);
  return { grid: g2, palette: P };
}

// ==================== 3. 矮人 ====================
function drawDwarf() {
  const g = makeGrid();
  const P = {
    o: '#2a1a1a', s: '#d8a070', S: '#b07848', T: '#f0c8a0',
    h: '#8a4a22', H: '#b06a32', d: '#6a3a18',
    e: '#f5efe6', i: '#5a7040', p: '#1a2010', k: '#ffffff',
    n: '#a06840', m: '#a05848', M: '#804038',
    f: '#8a4a22', F: '#b06a32', // 胡须
    E: '#c89060', t: '#a87040', u: '#5a4838', U: '#7a6850',
  };
  // 秃顶 — 头顶皮肤露出
  drawFace(g, { 3: [11,20], 4: [9,22], 5: [8,23], 6: [8,23], 7: [8,23], 8: [8,23], 9: [9,22], 10: [9,22], 11: [9,22], 12: [9,22], 13: [9,22], 14: [9,22], 15: [9,22], 16: [9,22], 17: [9,22], 18: [9,22], 19: [9,22], 20: [9,22], 21: [9,22], 22: [9,22], 23: [9,22], 24: [9,22], 25: [9,22] }, P.s, P.S, P.T);
  // 侧发（仅两侧）
  for (let y = 5; y <= 14; y++) { set(g, 8, y, P.h); set(g, 9, y, P.h); set(g, 22, y, P.h); set(g, 23, y, P.h); }
  set(g, 8, 5, P.H); set(g, 9, 5, P.H); // 侧发高光
  // 耳
  drawEarsNormal(g, 13, 17, P.s, P.E, P.t);
  // 浓密络腮胡
  rect(g, 8, 19, 23, 19, P.f);
  rect(g, 8, 20, 23, 21, P.f);
  rect(g, 9, 22, 22, 23, P.f);
  rect(g, 9, 24, 22, 25, P.f);
  rect(g, 10, 26, 21, 27, P.f);
  rect(g, 11, 28, 20, 29, P.f);
  rect(g, 12, 30, 19, 31, P.f);
  // 胡须高光
  set(g, 12, 24, P.F); set(g, 13, 24, P.F); set(g, 19, 25, P.F); set(g, 20, 25, P.F);
  // 颈（被胡须覆盖，不需要额外绘制）
  // 身体
  drawBody(g, { 32: [8,23], 33: [7,24], 34: [6,25], 35: [5,26], 36: [5,26], 37: [5,26], 38: [5,26], 39: [5,26] }, P.u, P.U);
  span(g, 12, 19, 32, P.U);
  // 光影
  span(g, 13, 15, 4, P.T); // 秃顶高光
  for (let y = 10; y <= 22; y++) set(g, 21, y, P.S);
  // 描边
  const g2 = autoOutline(g);
  // 五官 — 双层浓眉
  drawBrows(g2, 10, 9, 14, 17, 22, P.d);
  drawBrows(g2, 11, 10, 13, 18, 21, P.d);
  drawEyes(g2, 13, 10, 18, P.e, P.i, P.p, P.k);
  // 大鼻子
  rect(g2, 14, 17, 17, 19, P.n);
  set(g2, 15, 17, P.T); // 鼻梁高光
  // 嘴在胡须中
  span(g2, 14, 17, 21, P.m);
  return { grid: g2, palette: P };
}

// ==================== 4. 半身人 ====================
function drawHalfling() {
  const g = makeGrid();
  const P = {
    o: '#2a1a1a', s: '#e8b888', S: '#c89060', T: '#f8d8b0',
    h: '#6a4020', H: '#9a6838', d: '#5a3818',
    e: '#f5efe6', i: '#5a8048', p: '#1a2810', k: '#ffffff',
    n: '#b08058', m: '#c06858', M: '#985048',
    r: '#e09888', // 腮红
    E: '#d8a878', t: '#b88858', u: '#6a5838', U: '#8a7850',
  };
  // 蓬松卷发
  drawHair(g, { 2: [10,21], 3: [8,23], 4: [7,24], 5: [7,24], 6: [7,24], 7: [8,23], 8: [8,23] }, P.h, P.H);
  set(g, 7, 3, P.H); set(g, 8, 3, P.H); set(g, 23, 4, P.H); // 额外蓬松高光
  // 脸（圆润，宽1px）
  drawFace(g, { 8: [10,21], 9: [9,22], 10: [9,22], 11: [9,22], 12: [9,22], 13: [9,22], 14: [9,22], 15: [9,22], 16: [9,22], 17: [9,22], 18: [9,22], 19: [9,22], 20: [9,22], 21: [9,22], 22: [9,22], 23: [9,22], 24: [9,22], 25: [10,21], 26: [11,20], 27: [12,19] }, P.s, P.S, P.T);
  // 耳
  drawEarsNormal(g, 14, 16, P.s, P.E, P.t);
  // 颈
  drawNeck(g, 28, 30, 13, 18, P.s, P.S);
  // 身体
  drawBody(g, { 30: [8,23], 31: [7,24], 32: [6,25], 33: [5,26], 34: [5,26], 35: [5,26], 36: [5,26], 37: [5,26], 38: [5,26], 39: [5,26] }, P.u, P.U);
  span(g, 12, 19, 31, P.U);
  // 光影
  span(g, 12, 14, 9, P.T);
  for (let y = 11; y <= 23; y++) set(g, 21, y, P.S);
  // 腮红
  set(g, 10, 17, P.r); set(g, 10, 18, P.r);
  set(g, 21, 17, P.r); set(g, 21, 18, P.r);
  // 描边
  const g2 = autoOutline(g);
  drawBrows(g2, 10, 10, 13, 18, 21, P.d);
  drawEyes(g2, 11, 11, 18, P.e, P.i, P.p, P.k);
  drawNose(g2, 15, 19, 15, P.n, P.T, P.S);
  drawMouth(g2, 21, 13, 18, P.m, P.M, P.S);
  span(g2, 15, 16, 24, P.T);
  return { grid: g2, palette: P };
}

// ==================== 5. 半兽人 ====================
function drawHalfOrc() {
  const g = makeGrid();
  const P = {
    o: '#2a1a1a', s: '#6a9850', S: '#4a7830', T: '#88b870',
    h: '#1a1a18', H: '#3a3a30', d: '#3a5828',
    e: '#e8e8d0', i: '#a03020', p: '#200808', k: '#ffffff',
    n: '#4a7828', m: '#804838', M: '#603028',
    w: '#e8e0d0', // 獠牙骨白
    b: '#3a5828', // 眉脊
    E: '#5a8838', t: '#406820', u: '#4a3828', U: '#6a5838',
  };
  // 短发
  drawHair(g, { 3: [11,20], 4: [9,22], 5: [8,23], 6: [8,23], 7: [8,23] }, P.h, P.H);
  // 脸（宽下颌）
  drawFace(g, { 7: [9,22], 8: [9,22], 9: [9,22], 10: [9,22], 11: [9,22], 12: [9,22], 13: [9,22], 14: [9,22], 15: [9,22], 16: [9,22], 17: [9,22], 18: [9,22], 19: [9,22], 20: [9,22], 21: [9,22], 22: [9,22], 23: [9,22], 24: [9,22], 25: [9,22], 26: [10,21], 27: [11,20] }, P.s, P.S, P.T);
  // 耳（略尖）
  for (let y = 13; y <= 16; y++) { span(g, 6, 7, y, P.E); span(g, 24, 25, y, P.E); }
  set(g, 5, 12, P.E); set(g, 26, 12, P.E); // 微尖
  set(g, 7, 14, P.t); set(g, 24, 14, P.t);
  // 颈
  drawNeck(g, 28, 30, 13, 18, P.s, P.S);
  // 身体
  drawBody(g, { 30: [8,23], 31: [7,24], 32: [6,25], 33: [5,26], 34: [5,26], 35: [5,26], 36: [5,26], 37: [5,26], 38: [5,26], 39: [5,26] }, P.u, P.U);
  span(g, 12, 19, 31, P.U);
  // 光影
  span(g, 12, 14, 9, P.T);
  for (let y = 10; y <= 24; y++) set(g, 21, y, P.S);
  // 描边
  const g2 = autoOutline(g);
  // 粗重眉脊
  span(g2, 9, 14, 10, P.b);
  span(g2, 17, 22, 10, P.b);
  // 眼睛（略小）
  drawEyes(g2, 12, 11, 18, P.e, P.i, P.p, P.k);
  drawNose(g2, 16, 20, 15, P.n, P.T, P.S);
  // 嘴
  span(g2, 13, 18, 22, P.m);
  set(g2, 13, 23, P.M); span(g2, 14, 17, 23, P.m); set(g2, 18, 23, P.M);
  // 獠牙
  set(g2, 13, 24, P.w); set(g2, 13, 25, P.w);
  set(g2, 18, 24, P.w); set(g2, 18, 25, P.w);
  return { grid: g2, palette: P };
}

// ==================== 6. 龙裔 ====================
function drawDragonborn() {
  const g = makeGrid();
  const P = {
    o: '#1a2a1a', s: '#708878', S: '#506858', T: '#98b8a0',
    c: '#587868', C: '#88a898', // 鳞片 / 鳞片高光
    d: '#405848', // 眉脊
    e: '#e0e0c8', i: '#c88820', p: '#201008', k: '#ffffff',
    n: '#506050', m: '#605048', M: '#483838',
    w: '#98a890', // 吻部高光
    E: '#607860', t: '#485848', u: '#3a4840', U: '#586858',
  };
  // 无发 — 头顶鳞片
  for (let y = 2; y <= 8; y++) span(g, 9, 22, y, P.s);
  // 鳞片纹理（头顶）
  set(g, 12, 3, P.c); set(g, 15, 3, P.c); set(g, 18, 3, P.c);
  set(g, 11, 5, P.c); set(g, 14, 5, P.c); set(g, 17, 5, P.c); set(g, 20, 5, P.c);
  set(g, 12, 7, P.C); set(g, 16, 7, P.C); // 高光鳞片
  // 脸（棱角，方下颌）
  drawFace(g, { 8: [10,21], 9: [9,22], 10: [9,22], 11: [9,22], 12: [9,22], 13: [9,22], 14: [9,22], 15: [9,22], 16: [9,22], 17: [9,22], 18: [9,22], 19: [9,22], 20: [9,22], 21: [9,22], 22: [9,22], 23: [9,22], 24: [9,22], 25: [10,21], 26: [11,20], 27: [11,20] }, P.s, P.S, P.T);
  // 面部鳞片
  set(g, 19, 15, P.c); set(g, 20, 16, P.c); set(g, 21, 17, P.c);
  set(g, 12, 9, P.C); set(g, 13, 10, P.C);
  // 小耳（后贴）
  for (let y = 13; y <= 15; y++) { set(g, 7, y, P.E); set(g, 24, y, P.E); }
  // 颈（带鳞片）
  drawNeck(g, 28, 30, 13, 18, P.s, P.S);
  set(g, 14, 29, P.c); set(g, 17, 29, P.c);
  // 身体
  drawBody(g, { 30: [8,23], 31: [7,24], 32: [6,25], 33: [5,26], 34: [5,26], 35: [5,26], 36: [5,26], 37: [5,26], 38: [5,26], 39: [5,26] }, P.u, P.U);
  span(g, 12, 19, 31, P.U);
  // 光影
  span(g, 12, 14, 9, P.T);
  for (let y = 11; y <= 23; y++) set(g, 21, y, P.S);
  // 描边
  const g2 = autoOutline(g);
  // 眉脊
  span(g2, 10, 13, 10, P.d);
  span(g2, 18, 21, 10, P.d);
  // 眼睛
  drawEyes(g2, 11, 11, 18, P.e, P.i, P.p, P.k);
  // 吻部（宽鼻结构）
  rect(g2, 14, 16, 17, 19, P.n);
  set(g2, 15, 16, P.w); set(g2, 15, 17, P.w); // 吻部高光
  set(g2, 14, 20, P.S); set(g2, 17, 20, P.S); // 吻底阴影
  // 嘴
  span(g2, 13, 18, 21, P.m);
  set(g2, 13, 22, P.M); span(g2, 14, 17, 22, P.m); set(g2, 18, 22, P.M);
  return { grid: g2, palette: P };
}

// ==================== 7. 侏儒 ====================
function drawGnome() {
  const g = makeGrid();
  const P = {
    o: '#2a1a1a', s: '#e8b090', S: '#c88868', T: '#f8d0b0',
    h: '#a83820', H: '#d05830', d: '#882818',
    e: '#f5efe6', i: '#4878a0', p: '#182030', k: '#ffffff',
    n: '#b07858', m: '#c06058', M: '#984848',
    r: '#e89088', // 腮红
    E: '#d8a080', t: '#b88060', u: '#5a6848', U: '#7a8860',
  };
  // 极蓬松野发
  drawHair(g, { 2: [9,22], 3: [7,24], 4: [6,25], 5: [6,25], 6: [7,24], 7: [7,24], 8: [8,23] }, P.h, P.H);
  set(g, 7, 2, P.H); set(g, 8, 2, P.H); set(g, 24, 3, P.H); set(g, 25, 4, P.H); // 蓬松高光
  // 脸（圆短）
  drawFace(g, { 8: [10,21], 9: [9,22], 10: [9,22], 11: [9,22], 12: [9,22], 13: [9,22], 14: [9,22], 15: [9,22], 16: [9,22], 17: [9,22], 18: [9,22], 19: [9,22], 20: [9,22], 21: [9,22], 22: [9,22], 23: [9,22], 24: [9,22], 25: [10,21], 26: [11,20], 27: [12,19] }, P.s, P.S, P.T);
  // 耳
  drawEarsNormal(g, 14, 16, P.s, P.E, P.t);
  // 颈
  drawNeck(g, 28, 30, 13, 18, P.s, P.S);
  // 身体
  drawBody(g, { 30: [8,23], 31: [7,24], 32: [6,25], 33: [5,26], 34: [5,26], 35: [5,26], 36: [5,26], 37: [5,26], 38: [5,26], 39: [5,26] }, P.u, P.U);
  span(g, 12, 19, 31, P.U);
  // 光影
  span(g, 12, 14, 9, P.T);
  for (let y = 11; y <= 23; y++) set(g, 21, y, P.S);
  // 腮红
  set(g, 10, 16, P.r); set(g, 10, 17, P.r);
  set(g, 21, 16, P.r); set(g, 21, 17, P.r);
  // 描边
  const g2 = autoOutline(g);
  // 大眼（4px 宽）
  drawBrows(g2, 10, 10, 13, 18, 21, P.d);
  // 左眼 4x2
  set(g2, 10, 11, P.e); set(g2, 11, 11, P.k); set(g2, 12, 11, P.e); set(g2, 13, 11, P.e);
  set(g2, 10, 12, P.i); set(g2, 11, 12, P.p); set(g2, 12, 12, P.i); set(g2, 13, 12, P.i);
  // 右眼 4x2
  set(g2, 18, 11, P.e); set(g2, 19, 11, P.e); set(g2, 20, 11, P.k); set(g2, 21, 11, P.e);
  set(g2, 18, 12, P.i); set(g2, 19, 12, P.i); set(g2, 20, 12, P.p); set(g2, 21, 12, P.i);
  drawNose(g2, 15, 19, 15, P.n, P.T, P.S);
  drawMouth(g2, 21, 13, 18, P.m, P.M, P.S);
  span(g2, 15, 16, 24, P.T);
  return { grid: g2, palette: P };
}

// ==================== 8. 半精灵 ====================
function drawHalfElf() {
  const g = makeGrid();
  const P = {
    o: '#2a1a1a', s: '#f0c098', S: '#d09870', T: '#fce0c8',
    h: '#7a5a40', H: '#b8a080', d: '#5a4030',
    e: '#f5f0e8', i: '#4888a0', p: '#1a2028', k: '#ffffff',
    n: '#b88868', m: '#b86860', M: '#905048',
    E: '#d8a880', t: '#b88860', u: '#3a5878', U: '#5878a0',
  };
  // 中长发（棕带银光泽）
  drawHair(g, { 2: [11,20], 3: [9,22], 4: [8,23], 5: [7,24], 6: [7,24], 7: [7,24], 8: [8,23] }, P.h, P.H);
  // 脸（略窄于人类）
  drawFace(g, { 8: [10,21], 9: [9,22], 10: [9,22], 11: [9,22], 12: [9,22], 13: [9,22], 14: [9,22], 15: [9,22], 16: [9,22], 17: [9,22], 18: [9,22], 19: [9,22], 20: [9,22], 21: [9,22], 22: [9,22], 23: [9,22], 24: [9,22], 25: [10,21], 26: [11,20], 27: [12,19] }, P.s, P.S, P.T);
  // 微尖耳（介于人类与精灵之间）
  for (let y = 13; y <= 17; y++) { span(g, 6, 7, y, P.E); span(g, 24, 25, y, P.E); }
  set(g, 5, 12, P.E); set(g, 5, 13, P.E); // 微尖
  set(g, 26, 12, P.E); set(g, 26, 13, P.E);
  set(g, 6, 15, P.t); set(g, 25, 15, P.t);
  // 中长鬓角
  for (let y = 8; y <= 14; y++) { set(g, 8, y, P.h); set(g, 23, y, P.h); }
  // 颈
  drawNeck(g, 28, 30, 13, 18, P.s, P.S);
  // 身体
  drawBody(g, { 30: [8,23], 31: [7,24], 32: [6,25], 33: [5,26], 34: [5,26], 35: [5,26], 36: [5,26], 37: [5,26], 38: [5,26], 39: [5,26] }, P.u, P.U);
  span(g, 12, 19, 31, P.U);
  // 光影
  span(g, 12, 14, 9, P.T);
  for (let y = 11; y <= 23; y++) set(g, 21, y, P.S);
  // 描边
  const g2 = autoOutline(g);
  drawBrows(g2, 10, 10, 13, 18, 21, P.d);
  drawEyes(g2, 11, 11, 18, P.e, P.i, P.p, P.k);
  drawNose(g2, 15, 19, 15, P.n, P.T, P.S);
  drawMouth(g2, 21, 13, 18, P.m, P.M, P.S);
  span(g2, 15, 16, 24, P.T);
  return { grid: g2, palette: P };
}

// ==================== 主流程 ====================
const RACES = [
  { id: 'human-male', name: '人类男性', fn: drawHumanMale },
  { id: 'elf', name: '精灵', fn: drawElf },
  { id: 'dwarf', name: '矮人', fn: drawDwarf },
  { id: 'halfling', name: '半身人', fn: drawHalfling },
  { id: 'half-orc', name: '半兽人', fn: drawHalfOrc },
  { id: 'dragonborn', name: '龙裔', fn: drawDragonborn },
  { id: 'gnome', name: '侏儒', fn: drawGnome },
  { id: 'half-elf', name: '半精灵', fn: drawHalfElf },
];

const results = [];
const errors = [];

for (const race of RACES) {
  try {
    const { grid, palette } = race.fn();

    // 统计像素
    let pixelCount = 0;
    const unknownChars = new Set();
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const c = grid[y][x];
      if (c !== '.') {
        pixelCount++;
        if (!palette[c]) unknownChars.add(`${c}@(${x},${y})`);
      }
    }

    if (unknownChars.size > 0) {
      throw new Error(`未映射字符: ${[...unknownChars].join(', ')}`);
    }
    if (pixelCount < 200) {
      throw new Error(`像素数不足: ${pixelCount} < 200`);
    }

    // 生成 SVG
    const svg = gridToSVG(grid, palette);
    const svgPath = join(OUT, `portrait-${race.id}-v1.0.svg`);
    writeFileSync(svgPath, svg);

    // 生成 PNG
    const png = gridToPNG(grid, palette);
    const pngPath = join(OUT, `portrait-${race.id}-v1.0.png`);
    writeFileSync(pngPath, png);

    // 完整性校验
    const svgStat = statSync(svgPath);
    const pngStat = statSync(pngPath);
    if (svgStat.size < 100 || pngStat.size < 100) {
      throw new Error(`文件过小: SVG=${svgStat.size}B, PNG=${pngStat.size}B`);
    }

    results.push({ id: race.id, name: race.name, pixels: pixelCount, svgSize: svgStat.size, pngSize: pngStat.size });
    console.log(`  OK: ${race.name} (${race.id}) — ${pixelCount} px, SVG ${svgStat.size}B, PNG ${pngStat.size}B`);
  } catch (err) {
    errors.push({ id: race.id, name: race.name, error: err.message });
    console.error(`  FAIL: ${race.name} (${race.id}) — ${err.message}`);
    // 清除残件
    for (const ext of ['svg', 'png']) {
      const p = join(OUT, `portrait-${race.id}-v1.0.${ext}`);
      if (existsSync(p)) unlinkSync(p);
    }
  }
}

console.log(`\n========== 生成报告 ==========`);
console.log(`成功: ${results.length}/${RACES.length}`);
if (errors.length > 0) {
  console.log(`失败: ${errors.length}`);
  for (const e of errors) console.log(`  - ${e.name}: ${e.error}`);
}
console.log(`输出目录: ${OUT}`);

if (errors.length > 0) {
  process.exit(1);
}
