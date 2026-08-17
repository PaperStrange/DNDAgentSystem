// 工具：骰子 / 种子随机 / 寻路 / 距离
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
let _rng = mulberry32((Date.now() ^ (Math.random() * 0xffffffff)) >>> 0);
export function setSeed(seed) { _rng = mulberry32(seed >>> 0); }
export const rnd = () => _rng();
export function pick(arr) { return arr[Math.floor(rnd() * arr.length)]; }
export function shuffle(arr) { const a = arr.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }

// 骰子：roll('2d6+3') / roll('d20') / rollD(20)
export function roll(expr) {
  const m = String(expr).trim().match(/^(\d*)d(\d+)([+-]\d+)?$/i);
  if (!m) throw new Error('bad dice expr: ' + expr);
  const n = m[1] ? parseInt(m[1], 10) : 1;
  const s = parseInt(m[2], 10);
  const mod = m[3] ? parseInt(m[3], 10) : 0;
  let total = mod, rolls = [];
  for (let i = 0; i < n; i++) { const v = 1 + Math.floor(rnd() * s); rolls.push(v); total += v; }
  return { expr, rolls, mod, total };
}
export const d20 = () => roll('d20');

export function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
export function dist(a, b) { return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y)); }
export function cheb(a, b) { return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y)); }
export function manhattan(a, b) { return Math.abs(a.x - b.x) + Math.abs(a.y - b.y); }
export function losClear(map, a, b) { // 简易直线视线（Bresenham），检查墙
  let x0 = a.x, y0 = a.y, x1 = b.x, y1 = b.y;
  const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  for (;;) {
    if (x0 === x1 && y0 === y1) return true;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x0 += sx; }
    if (e2 <= dx) { err += dx; y0 += sy; }
    if (x0 === x1 && y0 === y1) break;
    const t = map.tiles && map.tiles[y0] && map.tiles[y0][x0];
    if (t && t.blockSight) return false;
  }
  return true;
}

// BFS 寻路：返回 [ {x,y}... ] 不含起点，最多 budget 步；目标被实体占据时逼近到相邻格
// 全图BFS（地图小，无需预算截断搜索），路径按预算截断，绕墙正确
export function findPath(map, from, to, budget = 99, opts = {}) {
  const { passEntities = true, ignoreEntityId = null } = opts;
  const W = map.w, H = map.h;
  if (from.x === to.x && from.y === to.y) return [];
  const key = (x, y) => y * W + x;
  const start = key(from.x, from.y), goal = key(to.x, to.y);
  const prev = new Map(), cost = new Map([[start, 0]]);
  const q = [start], seen = new Set([start]);
  while (q.length) {
    const k = q.shift();
    if (k === goal) break;
    const c = cost.get(k);
    const x = k % W, y = Math.floor(k / W);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const nk = key(nx, ny);
      if (seen.has(nk)) continue;
      const t = map.tiles && map.tiles[ny] && map.tiles[ny][nx];
      if (!t || t.blockMove) continue;
      if (!passEntities) {
        let blocked = false;
        if (map._entityAt) {
          const occ = map._entityAt(nx, ny);
          if (occ && occ.eid !== ignoreEntityId && occ.kind !== 'prop') blocked = true;
        }
        if (blocked) continue;
      }
      seen.add(nk);
      cost.set(nk, c + 1);
      prev.set(nk, k);
      q.push(nk);
    }
  }
  // 目标不可直达（被实体占据/完全封闭）→ 退而求其次：目标周围代价最低的格子
  let targetKey = prev.has(goal) ? goal : null;
  if (!targetKey) {
    let bestN = null, bestC = Infinity;
    const gx = goal % W, gy = Math.floor(goal / W);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = gx + dx, ny = gy + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const nk = key(nx, ny);
      if (prev.has(nk) && cost.get(nk) < bestC) { bestC = cost.get(nk); bestN = nk; }
    }
    targetKey = bestN;
  }
  if (!targetKey) return [];
  // 回溯完整路径并按预算截断
  const path = [];
  let cur = targetKey;
  while (cur !== start && prev.has(cur)) { path.push({ x: cur % W, y: Math.floor(cur / W) }); cur = prev.get(cur); }
  path.reverse();
  return path.slice(0, budget);
}

export function uid(prefix = 'e') { return prefix + Date.now().toString(36) + Math.floor(rnd() * 46656).toString(36) + Math.floor(rnd() * 46656).toString(36); }
export function roomCode() { const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; let s = ''; for (let i = 0; i < 5; i++) s += chars[Math.floor(rnd() * chars.length)]; return s; }
export function fmtNum(n) { return n.toLocaleString('zh-CN'); }
export function delay(ms) { return new Promise(r => setTimeout(r, ms)); }
