// R-11：冒险者名册（localStorage）——车卡角色存档、角色状态（在世/已阵亡）、死亡角色禁止再次出战
export const ROSTER_KEY = 'dnd_roster';

export function loadRoster() {
  try {
    const v = JSON.parse(localStorage.getItem(ROSTER_KEY) || '[]');
    return Array.isArray(v) ? v : [];
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
