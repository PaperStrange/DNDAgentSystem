// 像素渲染引擎：程序化tileset + 角色/怪物像素画（全部代码绘制，无图片资源）
export const TILE = 16; // 逻辑像素

function hash2(x, y, seed = 0) {
  let h = (x * 374761393 + y * 668265263 + seed * 1442695041) | 0;
  h = (h ^ (h >>> 13)) | 0;
  h = Math.imul(h, 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

export function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

// 颜色工具：明暗调整（主题色板派生）
function tintC(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  const f = (v) => Math.max(0, Math.min(255, v + amt));
  return '#' + [f((n >> 16) & 255), f((n >> 8) & 255), f(n & 255)].map(c => c.toString(16).padStart(2, '0')).join('');
}

// ---------- 瓦片 ----------
// 坐标约定：x,y 为**格子索引**（与调用方一致），函数内部换算为像素坐标。
// 修复：此前直接以索引当像素绘制，导致所有瓦片堆叠在左上角、地图全黑。
// theme: 剧情主题色板 {grass,floor,wall,water,rubble}（AI按章节生成，离线有默认主题）
export function drawTile(ctx, type, x, y, t = 0, theme = null) {
  const hx = x, hy = y; // 保留原始索引用于确定性纹理哈希
  ctx.save();
  ctx.translate(x * TILE, y * TILE);
  x = 0; y = 0;
  const th = theme || {};
  const C = {
    grass: th.grass || '#4f7c43', floor: th.floor || '#7d7d8a', wall: th.wall || '#4a4a56',
    water: th.water || '#3b6ea5', rubble: th.rubble || '#6e6250',
  };
  const r = () => hash2(hx, hy, 1), r2 = () => hash2(hx, hy, 2), r3 = () => hash2(hx, hy, 3);
  switch (type) {
    case 'g': { // grass
      ctx.fillStyle = r() > .5 ? C.grass : tintC(C.grass, 8);
      ctx.fillRect(x, y, TILE, TILE);
      ctx.fillStyle = tintC(C.grass, -12);
      for (let i = 0; i < 6; i++) ctx.fillRect(x + Math.floor(r2() * 14) + 1, y + Math.floor(r3() * 14) + 1, 1, 1);
      ctx.fillStyle = tintC(C.grass, 22);
      for (let i = 0; i < 4; i++) ctx.fillRect(x + Math.floor(r3() * 15), y + Math.floor(r2() * 15), 1, 1);
      break;
    }
    case '.': { // stone floor
      ctx.fillStyle = C.floor;
      ctx.fillRect(x, y, TILE, TILE);
      ctx.fillStyle = tintC(C.floor, -12);
      for (let i = 0; i < 7; i++) ctx.fillRect(x + Math.floor(r() * 15), y + Math.floor(r2() * 15), 1, 1);
      ctx.fillStyle = tintC(C.floor, 14);
      for (let i = 0; i < 3; i++) ctx.fillRect(x + Math.floor(r3() * 15), y + Math.floor(r() * 15), 1, 1);
      ctx.fillStyle = 'rgba(0,0,0,.15)';
      if (r2() > .6) ctx.fillRect(x, y + 14, TILE, 2);
      break;
    }
    case '#': { // wall
      ctx.fillStyle = C.wall;
      ctx.fillRect(x, y, TILE, TILE);
      ctx.fillStyle = tintC(C.wall, -12);
      for (let i = 0; i < 4; i++) ctx.fillRect(x + 1 + i * 4, y, 2, TILE);
      ctx.fillStyle = tintC(C.wall, 14);
      ctx.fillRect(x, y, TILE, 2);
      ctx.fillStyle = tintC(C.wall, 5);
      ctx.fillRect(x, y + 7, TILE, 2);
      ctx.fillRect(x + 7, y, 2, TILE);
      ctx.fillStyle = 'rgba(0,0,0,.25)';
      ctx.fillRect(x, y + TILE - 2, TILE, 2);
      break;
    }
    case '~': { // water
      ctx.fillStyle = C.water;
      ctx.fillRect(x, y, TILE, TILE);
      ctx.fillStyle = tintC(C.water, -10);
      const off = Math.floor(t / 12) % 2;
      for (let i = 0; i < 3; i++) ctx.fillRect(x + ((i * 6 + off + Math.floor(r() * 2)) % 16), y + 4 + i * 4, 3, 1);
      ctx.fillStyle = tintC(C.water, 16);
      for (let i = 0; i < 3; i++) ctx.fillRect(x + ((i * 5 + off) % 16), y + 2 + i * 5, 2, 1);
      break;
    }
    case '^': { // rubble
      ctx.fillStyle = C.rubble;
      ctx.fillRect(x, y, TILE, TILE);
      ctx.fillStyle = tintC(C.rubble, -12);
      for (let i = 0; i < 8; i++) ctx.fillRect(x + Math.floor(r() * 15), y + Math.floor(r2() * 15), 2, 1);
      ctx.fillStyle = tintC(C.rubble, 14);
      for (let i = 0; i < 4; i++) ctx.fillRect(x + Math.floor(r3() * 15), y + Math.floor(r() * 15), 1, 1);
      break;
    }
    case 'T': { // tree
      ctx.fillStyle = r() > .5 ? '#4f7c43' : '#57894a';
      ctx.fillRect(x, y, TILE, TILE);
      ctx.fillStyle = '#5d4328';
      ctx.fillRect(x + 6, y + 8, 4, 6);
      ctx.fillStyle = '#2f5a2c';
      ctx.fillRect(x + 2, y + 1, 12, 9);
      ctx.fillRect(x + 1, y + 3, 14, 5);
      ctx.fillStyle = '#3c6e38';
      ctx.fillRect(x + 3, y + 2, 10, 6);
      ctx.fillStyle = '#4d8a48';
      ctx.fillRect(x + 5, y + 2, 4, 3);
      ctx.fillStyle = 'rgba(0,0,0,.2)';
      ctx.fillRect(x + 1, y + 14, 14, 2);
      break;
    }
    case 'D': { // door (closed)
      ctx.fillStyle = '#7d7d8a';
      ctx.fillRect(x, y, TILE, TILE);
      ctx.fillStyle = '#7a5a2e';
      ctx.fillRect(x + 2, y + 1, 12, 14);
      ctx.fillStyle = '#8f6c3a';
      ctx.fillRect(x + 3, y + 2, 10, 12);
      ctx.fillStyle = '#5d4328';
      ctx.fillRect(x + 4, y + 4, 2, 8);
      ctx.fillRect(x + 10, y + 4, 2, 8);
      ctx.fillStyle = '#e8c15a';
      ctx.fillRect(x + 11, y + 7, 2, 2);
      break;
    }
    case 'c': { // chest (closed)
      ctx.fillStyle = '#7d7d8a';
      ctx.fillRect(x, y, TILE, TILE);
      ctx.fillStyle = '#7a4a24';
      ctx.fillRect(x + 2, y + 5, 12, 9);
      ctx.fillStyle = '#96602e';
      ctx.fillRect(x + 3, y + 6, 10, 2);
      ctx.fillStyle = '#5d3a1c';
      ctx.fillRect(x + 2, y + 5, 12, 2);
      ctx.fillStyle = '#e8c15a';
      ctx.fillRect(x + 7, y + 8, 2, 3);
      break;
    }
    case 'o': { // chest opened
      ctx.fillStyle = '#7d7d8a';
      ctx.fillRect(x, y, TILE, TILE);
      ctx.fillStyle = '#5d3a1c';
      ctx.fillRect(x + 2, y + 5, 12, 9);
      ctx.fillStyle = '#7a4a24';
      ctx.fillRect(x + 2, y + 5, 12, 2);
      ctx.fillStyle = '#2b2018';
      ctx.fillRect(x + 3, y + 7, 10, 7);
      break;
    }
    case 'f': { // campfire (animated)
      ctx.fillStyle = '#4a4438';
      ctx.fillRect(x, y, TILE, TILE);
      ctx.fillStyle = '#5d4328';
      ctx.fillRect(x + 4, y + 11, 8, 2);
      ctx.fillRect(x + 3, y + 12, 10, 2);
      const flick = Math.sin(t / 5) * 1.2 + Math.sin(t / 3.1) * .8;
      ctx.fillStyle = '#e07030';
      ctx.fillRect(x + 6, y + 4 + Math.floor(flick), 4, 7);
      ctx.fillStyle = '#f0a040';
      ctx.fillRect(x + 7, y + 6 + Math.floor(flick / 2), 2, 4);
      ctx.fillStyle = '#ffe9a0';
      ctx.fillRect(x + 7, y + 8, 2, 2);
      break;
    }
    case 'k': { // rock
      ctx.fillStyle = '#7d7d8a';
      ctx.fillRect(x, y, TILE, TILE);
      ctx.fillStyle = '#6e6e7a';
      ctx.fillRect(x + 3, y + 6, 10, 8);
      ctx.fillStyle = '#85858f';
      ctx.fillRect(x + 5, y + 7, 5, 4);
      ctx.fillStyle = '#5c5c66';
      ctx.fillRect(x + 3, y + 12, 10, 2);
      break;
    }
    case 'b': { // barrel
      ctx.fillStyle = '#7d7d8a';
      ctx.fillRect(x, y, TILE, TILE);
      ctx.fillStyle = '#8a5f2e';
      ctx.fillRect(x + 3, y + 2, 10, 12);
      ctx.fillStyle = '#a3733a';
      ctx.fillRect(x + 4, y + 2, 2, 12);
      ctx.fillStyle = '#5d4328';
      ctx.fillRect(x + 2, y + 3, 1, 10);
      ctx.fillRect(x + 13, y + 3, 1, 10);
      ctx.fillStyle = '#4a3820';
      ctx.fillRect(x + 3, y + 5, 10, 1);
      ctx.fillRect(x + 3, y + 9, 10, 1);
      break;
    }
    case 'y': { // crystal
      ctx.fillStyle = '#5a4a72';
      ctx.fillRect(x, y, TILE, TILE);
      ctx.fillStyle = '#a06ae0';
      ctx.fillRect(x + 6, y + 2, 4, 10);
      ctx.fillStyle = '#c08cf0';
      ctx.fillRect(x + 7, y + 2, 1, 8);
      ctx.fillStyle = '#7a48b8';
      ctx.fillRect(x + 5, y + 3, 1, 8);
      ctx.fillRect(x + 10, y + 4, 2, 2);
      ctx.fillRect(x + 4, y + 5, 2, 2);
      break;
    }
    case 'x': { // exit portal / stairs (animated)
      ctx.fillStyle = '#4a4438';
      ctx.fillRect(x, y, TILE, TILE);
      const glow = Math.floor(2 + Math.sin(t / 6) * 1.5);
      ctx.fillStyle = '#7a48b8';
      ctx.fillRect(x + 3, y + 2, 10, 12);
      ctx.fillStyle = '#a06ae0';
      ctx.fillRect(x + 4, y + 3, 8, 10);
      ctx.fillStyle = '#d8b8ff';
      ctx.fillRect(x + 7, y + 7, 2, 4);
      ctx.fillStyle = 'rgba(216,184,255,.35)';
      ctx.fillRect(x + 4 + glow, y + 3, 2, 10);
      break;
    }
    case 'z': { // forge (final)
      ctx.fillStyle = '#4a4438';
      ctx.fillRect(x, y, TILE, TILE);
      const pulse = Math.floor(2 + Math.sin(t / 4) * 2);
      ctx.fillStyle = '#8a6a3a';
      ctx.fillRect(x + 3, y + 3, 10, 10);
      ctx.fillStyle = '#ffb020';
      ctx.fillRect(x + 6, y + 6, 4, 4);
      ctx.fillStyle = '#fff0c0';
      ctx.fillRect(x + 7, y + 7, 2, 2);
      ctx.fillStyle = 'rgba(255,176,32,.4)';
      ctx.fillRect(x + 2 + pulse, y + 2, 2, 12);
      break;
    }
    default: {
      ctx.fillStyle = '#101018';
      ctx.fillRect(x, y, TILE, TILE);
    }
  }
  ctx.restore();
}

// ---------- 精灵 ----------
// 通用人形 12x16，字符: o描边 s皮肤 S皮肤阴影 h头发 H头发高光 u上衣 U上衣高光
// d深色/腰带 w金属/牙 e眼白 p瞳孔
const HUMANOID = [
  '....oooo....',
  '...osssso...',
  '..osssssso..',
  '..ohhhHHho..',
  '..ohhhhhho..',
  '..osepoesho..',
  '...ososo....',
  '....oooo....',
  '..ouuuuuuo..',
  '.oUuuuuuuo..',
  '.oUuuuuuuo..',
  '.oUuuuuuuo..',
  '.oUduwwduo..',
  '..ouuuuuuo..',
  '..oouooouo..',
  '..oddoooddo.',
];
// 种族特征网格（R-3）：不同种族有专属造型
const RACE_GRIDS = {
  human: HUMANOID,
  elf: [
    '....oooo....',
    '...osssso...',
    '..osssssso..',
    '.oohhhHHhoo.',
    '.oohhhhhhoo.',
    '..osepoesho..',
    '...osssso...',
    '....oooo....',
    '..ouuuuuuo..',
    '.oUuuuuuuo..',
    '.oUuuuuuuo..',
    '.oUuuuuuuo..',
    '.oUduuuduo..',
    '..ouuuuuuo..',
    '..oouooouo..',
    '..oddoooddo.',
  ],
  dwarf: [
    '....oooo....',
    '...osssso...',
    '..osssssso..',
    '..ohhhHHho..',
    '..ohhhhhho..',
    '..osepoesho..',
    '..ohhhhhho..',
    '..ohhhhhho..',
    '.oouuuuuuo..',
    '.oUuuuuuuo..',
    '.oUuuuuuuo..',
    '.oUuuuuuuo..',
    '.oUduuuduo..',
    '..ouuuuuuo..',
    '..oddoooddo.',
    '............',
  ],
  halfling: [
    '....oooo....',
    '...osssso...',
    '..osssssso..',
    '..ohhhhhho..',
    '..ohHHhhho..',
    '..osepoesho..',
    '...osssso...',
    '....oooo....',
    '..ouuuuuuo..',
    '.oUuuuuuuo..',
    '.oUuuuuuuo..',
    '.oUuuuuuuo..',
    '.oUduuuduo..',
    '..ouuuuuuo..',
    '..oddoooddo.',
    '............',
  ],
  halforc: [
    '....oooo....',
    '...osssso...',
    '..osssssso..',
    '..ohhhhhho..',
    '..ohhhHHho..',
    '..osepoesho..',
    '..oswsswso..',
    '....oooo....',
    '..ouuuuuuo..',
    '.oUuuuuuuo..',
    '.oUuuuuuuo..',
    '.oUuuuuuuo..',
    '.oUduuuduo..',
    '..ouuuuuuo..',
    '..oouooouo..',
    '..oddoooddo.',
  ],
  dragonborn: [
    '....oooo....',
    '.o..osso..o.',
    '..osssssso..',
    '..osssssso..',
    '..osssssso..',
    '..osepoesho..',
    '..osssssso..',
    '....oooo....',
    '..ouuuuuuo..',
    '.oUuuuuuuo..',
    '.oUuuuuuuo..',
    '.oUuuuuuuo..',
    '.oUduuuduo..',
    '..ouuuuuuo..',
    '..oouooouo..',
    '..oddoooddo.',
  ],
  gnome: [
    '.....oo.....',
    '....ohho....',
    '...ohhhho...',
    '..ohhhhhho..',
    '..ohhhHHho..',
    '..osepoesho..',
    '...osssso...',
    '....oooo....',
    '..ouuuuuuo..',
    '.oUuuuuuuo..',
    '.oUuuuuuuo..',
    '.oUuuuuuuo..',
    '.oUduuuduo..',
    '..ouuuuuuo..',
    '..oddoooddo.',
    '............',
  ],
  halfelf: [
    '....oooo....',
    '...osssso...',
    '..osssssso..',
    '..ohhhHHho..',
    '.oohhhhhhoo.',
    '..osepoesho..',
    '...osssso...',
    '....oooo....',
    '..ouuuuuuo..',
    '.oUuuuuuuo..',
    '.oUuuuuuuo..',
    '.oUuuuuuuo..',
    '.oUduuuduo..',
    '..ouuuuuuo..',
    '..oouooouo..',
    '..oddoooddo.',
  ],
};
const WOLF = [
  '....oo........',
  '...oooo..oo...',
  '..oooooo.ooo..',
  '.ooooooo.ooo..',
  '.oo.oooooooo..',
  'oo.ooooooooo..',
  'ooooooooooooo.',
  '.ooooooooooo..',
  '..oo.ooooo.oo.',
  '.....oo..oo...',
  '.....oo..oo...',
];
const SPIDER = [
  '......oo......',
  '....oooooo....',
  '...o.oooo.o...',
  '..oo.oooo.oo..',
  '.oo.oooooo.oo.',
  'oo.oooooooo.oo',
  'oo.oooooooo.oo',
  '.oo.oooooo.oo.',
  '..oo..oo..oo..',
  '...o..oo..o...',
  '....o.oo.o....',
];
const SKELETON = [
  '....oooo....',
  '...owwwwo...',
  '..owwowwwo..',
  '..owwowwwo..',
  '..owwowwwo..',
  '..owooooow..',
  '...owwwwo...',
  '....oooo....',
  '..oddoddo...',
  '..owwwwwwo..',
  '..oowwwwoo..',
  '...owwwo....',
  '...owwwo....',
  '..oowwoo....',
  '..ow..wo....',
  '..ow..wo....',
];

const CLASS_TWEAK = {
  // F-21：职业头饰不再遮住发色行（保留第4~5行头发），头盔饰条用饰色U展示，颜色区分更明显
  fighter: (g) => [g[0], g[1], '..oUUUUUo..', '..owwwwwo..', g[4], g[5], g[6], g[7], '.owuuuuuwo.', g[9], g[10], g[11], g[12], g[13], g[14], g[15]],
  wizard: (g) => ['....ouuo....', '...ouUUuo...', '..ouuuuuuo..', '..ouuuuuuo..', g[4], g[5], g[6], g[7], '..ouuuuuuo..', '.ouduuuuduo.', '.ouuuuuuuuo.', '.ouuuuuuuuo.', '.ouduuuduo..', '..ouuuuuuo..', '..oouooouo..', '..oouooouo..'],
  rogue: (g) => [g[0], g[1], '..ohhhhhho..', '..ohhhHHho..', '..ohhhhhho..', g[5], g[6], g[7], '..ouuuuuuo..', '.ouuuuuuuuo.', '.ouuuuuuuuo.', '.ouuuuuuuuo.', '.ouduuuduo..', '..ouuuuuuo..', '..oouooouo..', '..oouooouo..'],
  cleric: (g) => [g[0], g[1], '..oddddddo..', '..oddddddo..', g[4], g[5], g[6], g[7], '..ouuuuuuo..', '.oduuuuuudo.', '.ouuuuuuuuo.', '.ouuuuuuuuo.', '.oduuuudo..', '..ouuuuuuo..', '..oouooouo..', '..oouooouo..'],
  ranger: (g) => [g[0], g[1], '..ohhhhhho..', '..ohhhHHho..', '..ohhhhhho..', g[5], g[6], g[7], '..ouuuuuuo..', '.ouuuuuuuuo.', '.ouuuuuuuuo.', '.ouuuuuuuuo.', '.ouduuuduo..', '..ouuuuuuo..', '..oouooouo..', '..oouooouo..'],
};

// S1-3：色板全面升级——相邻色明度差≥12%，1px像素尺度肉眼可辨
export const SKIN_TONES = ['#f5d0a8', '#e8b88a', '#d4a06a', '#b8844e', '#986838', '#7a5028', '#5c3818', '#42260e']; // 8色·明度均匀梯度
export const HAIR_TONES = ['#1a1210', '#4a2a18', '#8a4a22', '#c8882e', '#e8d060', '#c83030', '#3060a0', '#60a048', '#b0b0b8', '#e8e0e8']; // 10色·高色相区分度
export const OUTFIT_TONES = ['#8a3030', '#c05040', '#c87830', '#c8a838', '#8a6848', '#5a4030', '#304878', '#4878a8', '#387858', '#58a868', '#684890', '#484858']; // 12色·冷暖分组
export const EYE_TONES = ['#2860a0', '#48a048', '#c89030', '#9050b0', '#c83838', '#d0d0d8', '#383838', '#886848']; // 8色
export const ACCENT_TONES = ['#c8a030', '#c0c0c8', '#b87838', '#c05050', '#5088c0', '#50b888', '#9868b8', '#484848']; // 8色·金属+宝石

function lighten(hex, amt = 38) {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.min(255, ((n >> 16) & 255) + amt), g = Math.min(255, ((n >> 8) & 255) + amt), b = Math.min(255, (n & 255) + amt);
  return '#' + [r, g, b].map(c => c.toString(16).padStart(2, '0')).join('');
}
// 为任意基础调色板补齐阴影/高光/瞳孔
function withShades(pal) {
  return {
    ...pal,
    S: pal.S || shade(pal.s || '#e8b88a'),
    H: pal.H || lighten(pal.h || '#5b3a1e'),
    U: pal.U || lighten(pal.u || '#4a6b8a'),
    p: pal.p || '#2a2430',
  };
}

const PALETTES = {
  player: (colors) => withShades({ o: '#2a2430', s: colors.skin, h: colors.hair, u: colors.outfit, d: shade(colors.outfit), w: '#cfd6e4', e: '#f0f0f0' }),
  goblin: { o: '#2a2430', s: '#7a9a3a', h: '#5a7a2a', u: '#6a4a2e', d: '#4a3a22', w: '#cfd6e4', e: '#ffd040' },
  wolf: { o: '#2a2430', s: '#6a6a72', h: '#6a6a72', u: '#4a4a52', d: '#3a3a42', w: '#cfd6e4', e: '#ffd040' },
  klarg: { o: '#2a2430', s: '#8a6a3a', h: '#5a4322', u: '#6a4a2e', d: '#4a3a22', w: '#cfd6e4', e: '#ff4040' },
  ruffian: { o: '#2a2430', s: '#e8b88a', h: '#3a2a1a', u: '#a02a2a', d: '#6a1a1a', w: '#cfd6e4', e: '#f0f0f0' },
  glasstaff: { o: '#2a2430', s: '#e8c8a0', h: '#8a8a98', u: '#4a3a7a', d: '#332a5a', w: '#cfd6e4', e: '#80e0ff' },
  hobgoblin: { o: '#2a2430', s: '#c88a4a', h: '#4a3a2a', u: '#7a2a2a', d: '#5a1a1a', w: '#8a8a98', e: '#ffd040' },
  bugbear: { o: '#2a2430', s: '#a07840', h: '#6a4a22', u: '#6a4a2e', d: '#4a3a22', w: '#cfd6e4', e: '#ffd040' },
  grol: { o: '#2a2430', s: '#9a7038', h: '#5a3a1a', u: '#8a5a2a', d: '#6a4020', w: '#e8c15a', e: '#ff2020' },
  doppelganger: { o: '#2a2430', s: '#d8d0c0', h: '#a8a8b0', u: '#7a7a88', d: '#5a5a66', w: '#cfd6e4', e: '#ff40ff' },
  skeleton: { o: '#2a2430', s: '#e8e0d0', h: '#e8e0d0', u: '#d8d0c0', d: '#4a3a3a', w: '#f0f0f0', e: '#ff4040' },
  zombie: { o: '#2a2430', s: '#8a9a6a', h: '#5a6a3a', u: '#5a5a4a', d: '#3a3a30', w: '#cfd6e4', e: '#ffd040' },
  giantspider: { o: '#2a2430', s: '#3a3a4a', h: '#3a3a4a', u: '#4a4a5a', d: '#2a2a3a', w: '#cfd6e4', e: '#ff2020' },
  nezznar: { o: '#2a2430', s: '#7a6a8a', h: '#e8e8f0', u: '#3a2a5a', d: '#2a1a4a', w: '#cfd6e4', e: '#ff40a0' },
  barthen: { o: '#2a2430', s: '#e8b88a', h: '#8a5a2e', u: '#7a5a2e', d: '#5a3a1e', w: '#cfd6e4', e: '#f0f0f0' },
  toblen: { o: '#2a2430', s: '#e8b88a', h: '#5b3a1e', u: '#8a6a3a', d: '#6a4a2a', w: '#cfd6e4', e: '#f0f0f0' },
  linene: { o: '#2a2430', s: '#f0c8a0', h: '#c88a2e', u: '#6a6a78', d: '#4a4a56', w: '#a8a8b8', e: '#f0f0f0' },
  galaelle: { o: '#2a2430', s: '#f0c8a0', h: '#e8e8f0', u: '#e8e0c8', d: '#b8b098', w: '#e8c15a', e: '#80a0ff' },
  oldhag: { o: '#2a2430', s: '#c0a080', h: '#a8a8b0', u: '#3a3a4a', d: '#2a2a3a', w: '#cfd6e4', e: '#c0ffc0' },
  sildar: { o: '#2a2430', s: '#e8b88a', h: '#5b3a1e', u: '#6a7a8a', d: '#4a5a6a', w: '#a8b8c8', e: '#80c0ff' },
  gundren: { o: '#2a2430', s: '#e8b88a', h: '#c84848', u: '#8a5a2e', d: '#6a4020', w: '#cfd6e4', e: '#80c0ff' },
  prisoner: { o: '#2a2430', s: '#d8b088', h: '#5b3a1e', u: '#8a8a7a', d: '#6a6a5a', w: '#cfd6e4', e: '#f0f0f0' },
};
function shade(hex) {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.max(0, ((n >> 16) & 255) - 40), g = Math.max(0, ((n >> 8) & 255) - 40), b = Math.max(0, (n & 255) - 40);
  return '#' + [r, g, b].map(c => c.toString(16).padStart(2, '0')).join('');
}

const MONSTER_GRID = { goblin: null, wolf: WOLF, skeleton: SKELETON, giantspider: SPIDER, nezznar: null };

export function spritePalette(kind, defKey, colors) {
  if (kind === 'player') return PALETTES.player(colors || { skin: SKIN_TONES[0], hair: HAIR_TONES[0], outfit: OUTFIT_TONES[0] });
  const base = PALETTES[defKey] || PALETTES.goblin;
  return withShades(base);
}

// S1-1：捏脸系统扩展——8发型/5胡须/4眉型/3唇部/4纹饰，通用像素变换
export function applyLook(grid, palette, look) {
  const rows = grid.map(r => r.split(''));
  if (look.eye) palette = { ...palette, e: look.eye };
  if (look.accent) palette = { ...palette, U: look.accent };
  const hairRows = [];
  for (let i = 0; i < rows.length; i++) if (rows[i].filter(c => c === 'h' || c === 'H').length >= 3) hairRows.push(i);
  const eyeRow = rows.findIndex(r => r.includes('e'));
  const mouthRow = eyeRow >= 0 ? eyeRow + 1 : -1;
  if (hairRows.length) {
    const first = hairRows[0], last = hairRows[hairRows.length - 1];
    const cols = [];
    for (const i of hairRows) rows[i].forEach((c, j) => { if ((c === 'h' || c === 'H') && !cols.includes(j)) cols.push(j); });
    const center = Math.floor((cols[0] + cols[cols.length - 1]) / 2);
    const leftCol = cols[0];
    const rightCol = cols[cols.length - 1];
    const hairStyle = look.hair || 0;
    if (hairStyle === 1) { // 长发：两侧垂下
      for (let k = 1; k <= 2; k++) {
        const r = last + k;
        if (r < rows.length) {
          if (rows[r][leftCol - 1] !== undefined) rows[r][leftCol - 1] = 'h';
          if (rows[r][rightCol + 1] !== undefined) rows[r][rightCol + 1] = 'h';
        }
      }
    } else if (hairStyle === 2) { // 发髻：额前盘发
      const r = first - 1;
      if (r >= 0) for (let c = center - 1; c <= center + 1; c++) if (rows[r][c] !== undefined && rows[r][c] !== 'o') rows[r][c] = 'h';
    } else if (hairStyle === 3) { // 短发：头发换肤色
      for (let i = 0; i < rows.length; i++) for (let c = 0; c < rows[i].length; c++) if (rows[i][c] === 'h' || rows[i][c] === 'H') rows[i][c] = 's';
    } else if (hairStyle === 4) { // 马尾：右侧竖线 row last+1 到 last+4
      for (let k = 1; k <= 4; k++) {
        const r = last + k;
        if (r < rows.length && rightCol + 1 < rows[r].length) rows[r][rightCol + 1] = 'h';
      }
    } else if (hairStyle === 5) { // 双辫：两侧各一列
      for (let k = 1; k <= 4; k++) {
        const r = last + k;
        if (r < rows.length) {
          if (leftCol - 1 >= 0) rows[r][leftCol - 1] = 'h';
          if (rightCol + 1 < rows[r].length) rows[r][rightCol + 1] = 'h';
        }
      }
    } else if (hairStyle === 6) { // 蓬松：左右各扩1px
      for (const i of hairRows) {
        if (leftCol - 1 >= 0 && rows[i][leftCol - 1] === '.') rows[i][leftCol - 1] = 'h';
        if (rightCol + 1 < rows[i].length && rows[i][rightCol + 1] === '.') rows[i][rightCol + 1] = 'h';
      }
    } else if (hairStyle === 7) { // 背头：发色行后移，露出额头
      for (const i of hairRows) {
        for (let c = rows[i].length - 1; c > 0; c--) {
          if (rows[i][c] === 'h' || rows[i][c] === 'H') {
            rows[i][c] = rows[i][c - 1] === 'h' || rows[i][c - 1] === 'H' ? rows[i][c] : 's';
          }
        }
        if (rows[i][cols[0]] === 'h' || rows[i][cols[0]] === 'H') rows[i][cols[0]] = 's';
      }
    }
  }
  // S1-1：胡须扩展（5种）
  const beardType = look.beard || 0;
  if (beardType > 0 && eyeRow >= 0) {
    const mid = Math.floor(rows[eyeRow].length / 2);
    if (beardType === 1) { // 短须：row eyeRow+1 中央3-4px
      const r = mouthRow;
      if (r > 0 && r < rows.length) for (let c = mid - 1; c <= mid + 1; c++) if (rows[r][c] !== undefined && rows[r][c] !== '.' && rows[r][c] !== 'o') rows[r][c] = 'h';
    } else if (beardType === 2) { // 长须：row eyeRow+1 到 eyeRow+3 中央4-5px
      for (let k = 1; k <= 3; k++) {
        const r = eyeRow + k;
        if (r < rows.length) { const w = k <= 2 ? 2 : 1; for (let c = mid - w; c <= mid + w; c++) if (rows[r][c] !== undefined && rows[r][c] !== '.' && rows[r][c] !== 'o') rows[r][c] = 'h'; }
      }
    } else if (beardType === 3) { // 络腮：两侧+中央连接
      for (let k = 0; k <= 2; k++) {
        const r = eyeRow + k;
        if (r < rows.length) {
          for (let c = mid - 3; c <= mid - 1; c++) if (rows[r][c] !== undefined && rows[r][c] !== '.' && rows[r][c] !== 'o') rows[r][c] = 'h';
          for (let c = mid + 1; c <= mid + 3; c++) if (rows[r][c] !== undefined && rows[r][c] !== '.' && rows[r][c] !== 'o') rows[r][c] = 'h';
          if (k >= 1) for (let c = mid - 1; c <= mid + 1; c++) if (rows[r][c] !== undefined && rows[r][c] !== '.' && rows[r][c] !== 'o') rows[r][c] = 'h';
        }
      }
    } else if (beardType === 4) { // 山羊胡：仅下巴尖端
      const r1 = eyeRow + 2;
      const r2 = eyeRow + 3;
      if (r1 < rows.length) for (let c = mid - 1; c <= mid; c++) if (rows[r1][c] !== undefined && rows[r1][c] !== '.' && rows[r1][c] !== 'o') rows[r1][c] = 'h';
      if (r2 < rows.length) if (rows[r2][mid] !== undefined && rows[r2][mid] !== '.' && rows[r2][mid] !== 'o') rows[r2][mid] = 'h';
    }
  }
  // S1-1：眉型（4种）——修改眼睛上方一行
  const browType = look.brow || 0;
  if (browType > 0 && eyeRow > 0) {
    const browRow = eyeRow - 1;
    if (browType === 1) { // 粗眉：眼上方发色加粗
      for (let c = 0; c < rows[browRow].length; c++) if (rows[browRow][c] === 's') rows[browRow][c] = 'h';
    } else if (browType === 2) { // 细眉：仅保留眼睛正上方
      for (let c = 0; c < rows[browRow].length; c++) {
        if (rows[browRow][c] === 's') {
          const isAboveEye = (c > 0 && rows[eyeRow][c - 1] === 'e') || rows[eyeRow][c] === 'e' || (c < rows[eyeRow].length - 1 && rows[eyeRow][c + 1] === 'e');
          if (!isAboveEye) rows[browRow][c] = '.';
        }
      }
    } else if (browType === 3) { // 伤疤眉：左侧加饰色点
      if (rows[browRow][3] !== undefined && rows[browRow][3] !== 'o') rows[browRow][3] = 'U';
    }
  }
  // S1-1：唇部（3种）——修改嘴部行中央
  const mouthType = look.mouth || 0;
  if (mouthType > 0 && mouthRow > 0 && mouthRow < rows.length) {
    const mid = Math.floor(rows[mouthRow].length / 2);
    if (mouthType === 1) { // 微笑：嘴角上移
      if (rows[mouthRow][mid - 2] !== undefined && rows[mouthRow][mid - 2] === 's') rows[mouthRow][mid - 2] = 'o';
      if (rows[mouthRow][mid + 2] !== undefined && rows[mouthRow][mid + 2] === 's') rows[mouthRow][mid + 2] = 'o';
      if (mouthRow > 0) {
        if (rows[mouthRow - 1][mid - 2] !== undefined && rows[mouthRow - 1][mid - 2] === 'o') rows[mouthRow - 1][mid - 2] = 's';
        if (rows[mouthRow - 1][mid + 2] !== undefined && rows[mouthRow - 1][mid + 2] === 'o') rows[mouthRow - 1][mid + 2] = 's';
      }
    } else if (mouthType === 2) { // 严肃：嘴角拉平
      if (rows[mouthRow][mid - 2] !== undefined && rows[mouthRow][mid - 2] !== '.' && rows[mouthRow][mid - 2] !== 'o') rows[mouthRow][mid - 2] = 's';
      if (rows[mouthRow][mid + 2] !== undefined && rows[mouthRow][mid + 2] !== '.' && rows[mouthRow][mid + 2] !== 'o') rows[mouthRow][mid + 2] = 's';
    }
  }
  // S1-1：面部纹饰（4种）——饰色U点缀
  const markingType = look.marking || 0;
  if (markingType > 0) {
    const mid = Math.floor(rows[0].length / 2);
    if (markingType === 1 && rows[2]) { // 额纹
      if (rows[2][mid] !== undefined && rows[2][mid] !== 'o') rows[2][mid] = 'U';
    } else if (markingType === 2) { // 颊纹
      const cheekRow = eyeRow >= 0 ? eyeRow + 1 : 5;
      if (cheekRow < rows.length) {
        if (rows[cheekRow][3] !== undefined && rows[cheekRow][3] !== 'o' && rows[cheekRow][3] !== '.') rows[cheekRow][3] = 'U';
        const rc = rows[cheekRow].length - 4;
        if (rows[cheekRow][rc] !== undefined && rows[cheekRow][rc] !== 'o' && rows[cheekRow][rc] !== '.') rows[cheekRow][rc] = 'U';
      }
    } else if (markingType === 3) { // 下巴纹
      const chinRow = eyeRow >= 0 ? eyeRow + 2 : 7;
      if (chinRow < rows.length && rows[chinRow][mid] !== undefined && rows[chinRow][mid] !== 'o' && rows[chinRow][mid] !== '.') rows[chinRow][mid] = 'U';
    }
  }
  return { grid: rows.map(r => r.join('')), palette };
}

// 在canvas上绘制一个精灵（逻辑像素），(dx,dy)为左上角，scale=缩放
// race: 玩家种族（决定种族特征网格），cls: 职业（决定头饰/服装），look: 捏脸（发型/胡须/瞳色/饰色）
export function drawSprite(ctx, kind, defKey, palette, dx, dy, { dir = 'down', frame = 0, scale = 1, bob = 0, cls = null, race = null, look = null } = {}) {
  let grid;
  let offsetX = 0, offsetY = 0;
  if (kind === 'player' || MONSTER_GRID[defKey] === null) {
    const base = (race && RACE_GRIDS[race]) ? RACE_GRIDS[race] : HUMANOID;
    grid = cls && CLASS_TWEAK[cls] ? CLASS_TWEAK[cls](base) : base;
    offsetX = 2;
    // 小体型种族微缩（半身人/侏儒）
    if (race === 'halfling' || race === 'gnome') scale = scale * 0.92;
  } else {
    grid = MONSTER_GRID[defKey] || HUMANOID;
    if (defKey === 'wolf') offsetX = 0;
    else if (defKey === 'spider' || defKey === 'giantspider') offsetX = 0;
    else offsetX = 2;
  }
  const gw = grid[0].length, gh = grid.length;
  // 朝上：脸部行替换为头发（背面）
  if (dir === 'up' && (kind === 'player' || MONSTER_GRID[defKey] === null)) {
    grid = grid.map((row, i) => (i === 5 ? row.replace(/e/g, 'h') : row));
  }
  // 捏脸变换（发型/胡须/瞳色/饰色）
  if (look) {
    const lk = applyLook(grid, palette, look);
    grid = lk.grid;
    palette = lk.palette;
  }
  const flip = dir === 'left';
  ctx.save();
  ctx.translate(dx, dy);
  if (scale !== 1) ctx.scale(scale, scale);
  if (flip) { ctx.translate(16, 0); ctx.scale(-1, 1); }
  const bo = bob ? (frame % 2) : 0;
  ctx.translate(offsetX, -bo);
  // F-21: 轮廓只描在剪影外侧——从画布边缘洪泛空格子，只给「与实心相邻的外部空格」描边；
  // 内部间隙（如手臂与躯干之间）保持透明，轮廓干净不糊成一团
  const filled = new Set();
  for (let y = 0; y < gh; y++) {
    const row = grid[y];
    for (let x = 0; x < row.length; x++) if (row[x] !== '.') filled.add(y * 32 + x);
  }
  const outside = new Set();
  const queue = [];
  for (let y = 0; y < gh; y++) {
    for (let x = 0; x < gw; x++) {
      const k = y * 32 + x;
      if (filled.has(k)) continue;
      if (x === 0 || y === 0 || x === gw - 1 || y === gh - 1) { outside.add(k); queue.push(k); }
    }
  }
  while (queue.length) {
    const k = queue.pop();
    const x = k % 32, y = Math.floor(k / 32);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= gw || ny >= gh) continue;
      const nk = ny * 32 + nx;
      if (filled.has(nk) || outside.has(nk)) continue;
      outside.add(nk); queue.push(nk);
    }
  }
  ctx.fillStyle = palette.o || '#1a1626';
  for (const k of outside) {
    const x = k % 32, y = Math.floor(k / 32);
    const nb = (y > 0 && filled.has((y - 1) * 32 + x)) || (y < gh - 1 && filled.has((y + 1) * 32 + x)) ||
               (x > 0 && filled.has(y * 32 + x - 1)) || (x < gw - 1 && filled.has(y * 32 + x + 1));
    if (nb) ctx.fillRect(x, y, 1, 1);
  }
  for (let y = 0; y < gh; y++) {
    const row = grid[y];
    for (let x = 0; x < row.length; x++) {
      const ch = row[x];
      if (ch === '.') continue;
      const col = palette[ch];
      if (!col) continue;
      ctx.fillStyle = col;
      ctx.fillRect(x, y, 1, 1);
    }
  }
  ctx.restore();
}

// 缓存单个精灵为离屏canvas（用于预览）
export function spriteToCanvas(kind, defKey, palette, cls, race, look = null) {
  const c = makeCanvas(16, 18);
  const ctx = c.getContext('2d');
  drawSprite(ctx, kind, defKey, palette, 0, 0, { cls, race, look });
  return c;
}
