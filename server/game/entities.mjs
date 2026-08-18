// 实体系统（架构迁移第一步）：实体=纯数据（组件式），工厂+空间查询与行为逻辑分离
// 后续新实体类型只需在这里新增工厂，不改动回合/战斗等其他系统
import { uid, pick } from '../util.mjs';
import { MONSTERS, NPCS } from './dungeon.mjs';

export function installEntities(game) {
  game._randomWalkable = function () {
    const list = [];
    for (let y = 1; y < this.map.h - 1; y++) for (let x = 1; x < this.map.w - 1; x++) {
      const t = this.map.tiles[y][x];
      if (!t.blockMove && !this.entitiesAt(x, y).length) list.push({ x, y });
    }
    return pick(list) || { x: 1, y: 1 };
  };
  game.entitiesAt = function (x, y) {
    const out = [];
    for (const e of this.entities.values()) if (e.x === x && e.y === y && !e.dead) out.push(e);
    return out;
  };
  game.pathMap = function (forPlayer = true) {
    return { w: this.map.w, h: this.map.h, tiles: this.map.tiles, _entityAt: (x, y) => {
      const list = this.entitiesAt(x, y);
      if (!list.length) return null;
      if (forPlayer) return list.find(e => e.kind === 'monster') || null; // 玩家路径：只有怪物挡路
      return list[0]; // 怪物路径：任何实体都挡路
    } };
  };
  game._playerEntity = function (p, x, y) {
    const s = p.sheet;
    return { eid: uid('pl'), kind: 'player', name: s.name, icon: s.className[0], x, y, hp: p.sheet.hp, maxHp: s.maxHp,
      ac: s.ac, speed: s.speed, faction: 'party', playerId: p.pid, level: p.level, size: 1, downed: p.downed, dead: p.dead,
      initiative: s.initiative, stats: s.stats, mods: s.mods };
  };
  game._monsterEntity = function (defKey, meta, x, y, squad) {
    const m = MONSTERS[defKey];
    const hp = Math.max(1, Math.round(m.hp * (this.partyHpScale || 1))); // B-11：小队<4人时怪物生命按比例下调
    return { eid: uid('mo'), kind: 'monster', defKey, name: m.name, icon: m.icon, x, y, hp, maxHp: hp,
      ac: m.ac, speed: m.speed, faction: 'foe', squad: squad, size: m.size || 1, downed: false, dead: false,
      attacks: m.attacks.map(a => ({ ...a })), boss: !!m.boss, finalBoss: !!m.finalBoss, undead: !!m.undead,
      gold: m.gold, xp: m.xp, lootKey: meta.lootKey || null, webSkip: false, prone: false, desc: m.desc };
  };
  game._npcEntity = function (defKey, x, y) {
    const n = NPCS[defKey];
    return { eid: uid('np'), kind: 'npc', npcId: defKey, name: n.name, icon: n.icon, x, y, hp: 1, maxHp: 1, size: 1, faction: 'neutral' };
  };
}
