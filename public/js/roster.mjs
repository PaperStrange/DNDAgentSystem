// R-11：冒险者名册（localStorage）——车卡角色存档、角色状态（在世/已阵亡）、死亡角色禁止再次出战
import { migrateColors, migrateLook } from './pixel.mjs';
export const ROSTER_KEY = 'dnd_roster';

export function loadRoster() {
  try {
    const v = JSON.parse(localStorage.getItem(ROSTER_KEY) || '[]');
    if (!Array.isArray(v)) return [];
    return v.map(e => {
      if (!e) return e;
      if (e.colors) e.colors = migrateColors(e.colors);
      if (e.look) e.look = migrateLook(e.look);
      return e;
    });
  } catch (e) { return []; }
}

function save(list) {
  try { localStorage.setItem(ROSTER_KEY, JSON.stringify(list.slice(0, 50))); } catch (e) { /* 存储失败静默 */ }
}

// 保存/更新一名角色：带rosterId则更新原条目；否则新建条目（状态=在世）
export function upsertEntry(sheet, rosterId) {
  const list = loadRoster();
  const now = Date.now();
  if (rosterId) {
    const e = list.find(x => x.id === rosterId);
    if (e && e.status !== 'dead') {
      Object.assign(e, { ...sheet, status: 'alive', updatedAt: now });
      save(list);
      return e.id;
    }
  }
  const id = 'ro_' + Math.random().toString(36).slice(2, 10) + now.toString(36);
  list.unshift({ id, ...sheet, status: 'alive', createdAt: now, updatedAt: now });
  save(list);
  return id;
}

// 冒险结束时调用：角色成长跨冒险保留（5E规则：经验值随持续冒险累积，达到阈值即升级）
export function updateProgression(name, level, xp) {
  const list = loadRoster();
  const cands = list.filter(x => x.name === name && x.status !== 'dead');
  if (!cands.length) return;
  const newest = cands.sort((a, b) => b.updatedAt - a.updatedAt)[0];
  newest.level = Math.max(1, Number(level) || 1);
  newest.xp = Number(xp) || 0;
  newest.updatedAt = Date.now();
  save(list);
}

// 冒险结束时调用：将同名且最新的在世角色标记为已阵亡（死亡=永久，不可再出战）
export function markDeathByName(name) {
  const list = loadRoster();
  const cands = list.filter(x => x.name === name && x.status === 'alive');
  if (!cands.length) return;
  cands.sort((a, b) => b.updatedAt - a.updatedAt)[0].status = 'dead';
  save(list);
}

// 可出战的在世角色（死亡角色不返回 → 无法被读取 → 禁止参与下一次冒险）
export function aliveEntries() {
  return loadRoster().filter(x => x.status !== 'dead');
}

// ---------- R1-33：服务端角色权威的客户端侧 ----------
// 名册条目可携带：
//   serverId    —— 服务端签发的 characterId（「已创建」的引用；有它 ⇒ 服务端权威锁定生效）
//   syncError   —— 迁移失败原因（**保留原卡**，不删）
//   restored    —— 由服务端列表重建（清缓存/换设备场景）

// 待迁移条目：本地有、尚无 serverId
export function pendingImports() {
  return loadRoster().filter(e => e && e.id && !e.serverId);
}

export function findByServerId(serverId) {
  if (!serverId) return null;
  return loadRoster().find(e => e && e.serverId === serverId) || null;
}

// 写入 serverId 的**唯一真源**（R1-35）：把服务端签发的 characterId 落到列表中的条目。
// 只加字段 + 清 syncError，**非破坏**（不动其它字段、不删条目）。返回是否确有变更。
// applyServerIds（批量迁移回执）与 bindServerId（房间流程单条回写）都经此 ⇒ 写入语义只有一份。
function _bindServerId(list, rosterId, characterId) {
  if (!rosterId || !characterId) return false;
  const e = list.find(x => x && x.id === rosterId);
  if (!e || e.serverId === characterId) return false;
  e.serverId = characterId;
  delete e.syncError;
  return true;
}

// 迁移回执：把 serverId 写回本地条目（只加字段，非破坏）
export function applyServerIds(map) {
  if (!map) return 0;
  const list = loadRoster();
  let n = 0;
  for (const e of list) {
    if (!e || !e.id) continue;
    if (_bindServerId(list, e.id, map[e.id])) n++;
  }
  if (n) save(list);
  return n;
}

// R1-35：房间流程内拿到服务端签发的 characterId 时，把它回写到**指定本地条目**的 serverId。
// 与 applyServerIds 共用同一写入真源（_bindServerId）——**不新写第二份写入逻辑**。
// 效果：① 换房/重登后 loadedCharacterId 有 serverId 可回落（服务端权威锁定生效）；
//       ② restoreFromServer 的 have 集合能命中 ⇒ 不再 unshift 同名条目（消除重复）。
export function bindServerId(rosterId, characterId) {
  if (!rosterId || !characterId) return false;
  const list = loadRoster();
  const changed = _bindServerId(list, rosterId, String(characterId));
  if (changed) save(list);
  return changed;
}

// 迁移失败项：保留原卡 + 记原因（绝不删）
export function markSyncErrors(errors) {
  if (!Array.isArray(errors) || !errors.length) return 0;
  const list = loadRoster();
  let n = 0;
  for (const er of errors) {
    const e = list.find(x => x && x.id === er.rosterId);
    if (e) { e.syncError = er.reason || '迁移失败'; n++; }
  }
  if (n) save(list);
  return n;
}

// 由服务端角色列表重建本地条目（清缓存/换设备/无痕场景）。
// 仅补齐「本地没有该 serverId」的角色；已有条目不动。返回新增条数。
export function restoreFromServer(characters) {
  if (!Array.isArray(characters) || !characters.length) return 0;
  const list = loadRoster();
  const have = new Set(list.filter(e => e && e.serverId).map(e => e.serverId));
  let n = 0;
  for (const c of characters) {
    if (!c || !c.characterId || have.has(c.characterId)) continue;
    const L = c.locked || {}, E = c.editable || {};
    const now = Date.now();
    list.unshift({
      id: 'ro_srv_' + c.characterId,
      serverId: c.characterId,
      name: L.name, raceId: L.raceId, classId: L.classId,
      stats: { ...(L.stats || {}) }, flex: { ...(L.flex || {}) },
      level: L.level || 1, xp: L.xp || 0, background: L.background || '',
      colors: { ...(E.colors || {}) }, look: { ...(E.look || {}) },
      status: c.status === 'dead' ? 'dead' : 'alive',
      createdAt: now, updatedAt: now, restored: true,
    });
    have.add(c.characterId);
    n++;
  }
  if (n) save(list);
  return n;
}

