// 地图校验：检查所有章节地图的宽度、出生点、NPC/宝箱/怪物/出口的可达性
import { parseMap, DUNGEONS } from '../server/game/dungeon.mjs';

function bfsReachable(map, start, opts = {}) {
  const seen = new Set(), q = [start];
  seen.add(start.y * map.w + start.x);
  while (q.length) {
    const { x, y } = q.shift();
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= map.w || ny >= map.h) continue;
      const k = ny * map.w + nx;
      if (seen.has(k)) continue;
      const t = map.tiles[ny][nx];
      if (!t || t.blockMove) continue;
      seen.add(k);
      q.push({ x: nx, y: ny });
    }
  }
  return seen;
}
const key = (x, y, w) => y * w + x;

for (const d of DUNGEONS) {
  console.log('=== ' + d.name + ' ===');
  for (const ch of d.chapters) {
    const map = parseMap(ch);
    const issues = [];
    // 宽度检查
    const widths = [...new Set(ch.map.ascii.map(r => r.length))];
    if (widths.length > 1) issues.push('行宽不一致: ' + widths.join(','));
    if (!map.spawns.length) issues.push('无出生点');
    // 从所有出生点BFS
    const seen = new Set();
    for (const s of map.spawns.length ? map.spawns : [{ x: 1, y: 1 }]) {
      for (const k of bfsReachable(map, s)) seen.add(k);
    }
    for (const e of map.entities) {
      if (!seen.has(key(e.x, e.y, map.w))) issues.push('不可达实体: ' + e.kind + ' ' + e.def + ' @(' + e.x + ',' + e.y + ')');
    }
    for (const c of map.chests) if (!seen.has(key(c.x, c.y, map.w))) issues.push('不可达宝箱 @(' + c.x + ',' + c.y + ')');
    if (map.exit && !seen.has(key(map.exit.x, map.exit.y, map.w))) issues.push('不可达出口 @(' + map.exit.x + ',' + map.exit.y + ')');
    if (map.exit2 && !seen.has(key(map.exit2.x, map.exit2.y, map.w))) issues.push('不可达出口2 @(' + map.exit2.x + ',' + map.exit2.y + ')');
    console.log('  [' + ch.id + '] ' + map.w + 'x' + map.h + ' spawns:' + map.spawns.length + ' entities:' + map.entities.length + (issues.length ? ' ❌' : ' ✅'));
    for (const i of issues) console.log('    - ' + i);
  }
}
