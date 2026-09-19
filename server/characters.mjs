// R1-33：服务端角色权威 —— 「已创建」的跨会话判定 + 锁定所需的最小权威
// 方案：docs/pm/reports/R1-33-服务端角色权威-方案-20260920.md
// - 独立文件 characters.json（与 accounts.json 分离；依据研究 §A「不在认证 JSON 内无限扩张」）
// - 原子落盘（写 .tmp → rename），错误可见
// - 「已创建」= 本文件存在该 characterId 且 accountId 匹配（不接受客户端标志位）
import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { dataRoot } from './paths.mjs';
import { uid } from './util.mjs';
import { buildSheet, MAX_LEVEL } from './game/charsheet.mjs';

const DATA_DIR = dataRoot;
const FILE = join(DATA_DIR, 'characters.json');

// 被锁字段（用户 2026-09-20 裁定「除外观全锁」）。外观 colors/look 不在此列 —— 保持可改。
export const LOCKED_FIELDS = ['name', 'raceId', 'classId', 'stats', 'flex', 'level', 'xp', 'background'];

function emptyDb() { return { schema: 1, characters: {}, byAccount: {}, importKeys: {} }; }

function load() {
  try {
    const j = JSON.parse(readFileSync(FILE, 'utf8'));
    if (!j || typeof j !== 'object') return emptyDb();
    if (!j.characters || typeof j.characters !== 'object') j.characters = {};
    if (!j.byAccount || typeof j.byAccount !== 'object') j.byAccount = {};
    if (!j.importKeys || typeof j.importKeys !== 'object') j.importKeys = {};
    return j;
  } catch (e) { return emptyDb(); }
}

function save(db) {
  try {
    if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
    const tmp = FILE + '.tmp';
    writeFileSync(tmp, JSON.stringify(db, null, 2));
    renameSync(tmp, FILE); // 原子替换：避免半写文件
  } catch (e) { console.error('[characters] 保存失败', e?.message || e); }
}

// 从 buildSheet 的结果抽出「被锁字段」。用 base（购点原值）而非 stats(final) —— 与 R1-22 基础值口径一致。
export function lockedOf(sheet) {
  return {
    name: sheet.name,
    raceId: sheet.race,
    classId: sheet.class,
    stats: { ...sheet.base },
    flex: { ...(sheet.flex || {}) },
    level: sheet.level,
    xp: sheet.xp,
    background: sheet.background,
  };
}

function eqObj(a, b) {
  const ka = Object.keys(a || {}).sort();
  const kb = Object.keys(b || {}).sort();
  if (ka.length !== kb.length) return false;
  for (let i = 0; i < ka.length; i++) {
    if (ka[i] !== kb[i] || (a || {})[ka[i]] !== (b || {})[kb[i]]) return false;
  }
  return true;
}

// 逐字段比对权威副本 vs 提交值；返回差异字段名（空数组 = 一致）
export function lockedDiff(recLocked, incoming) {
  const diff = [];
  for (const f of LOCKED_FIELDS) {
    const a = recLocked ? recLocked[f] : undefined;
    const b = incoming ? incoming[f] : undefined;
    if (f === 'stats' || f === 'flex') { if (!eqObj(a, b)) diff.push(f); }
    else if (a !== b) diff.push(f);
  }
  return diff;
}

// 归一化后的「原始车卡输入」：供上层（rooms.setSheet）重新 buildSheet 落 room.sheets
function rawFromLocked(locked, editable) {
  return {
    name: locked.name, raceId: locked.raceId, classId: locked.classId,
    stats: { ...locked.stats }, flex: { ...locked.flex },
    level: locked.level, xp: locked.xp, background: locked.background,
    colors: editable ? editable.colors : undefined,
    look: editable ? editable.look : undefined,
  };
}

function newRecord(account, locked, editable, origin, status) {
  return {
    characterId: uid('ch'), accountId: account,
    createdAt: Date.now(), updatedAt: Date.now(),
    origin, adventureCount: 0, version: 1,
    status: status === 'dead' ? 'dead' : 'alive',
    locked, editable: editable || {},
  };
}

// 核心：权威判定。
//  characterId 为空 ⇒ 新建角色（服务端签发 id；强制 level=1/xp=0）。
//  characterId 非空 ⇒ 读服务端权威副本，逐字段比对；有差异则拒绝（外观除外）。
// 返回 { err } 或 { raw, characterId, created }（raw 为归一化后的原始车卡输入）。
export function authorize(account, characterId, rawSheet) {
  if (!account) return { err: '请先登录账号' };
  let sheet;
  try { sheet = buildSheet(rawSheet || {}); }
  catch (e) { return { err: (e && e.message) ? e.message : '车卡数据非法，请检查属性与种族职业' }; }

  const db = load();
  if (characterId) {
    const rec = db.characters[characterId];
    if (!rec || rec.accountId !== account) return { err: '角色不存在或不属于当前账号' };
    const diff = lockedDiff(rec.locked, lockedOf(sheet));
    if (diff.length) return { err: '该角色已创建，不能修改：' + diff.join('、') };
    // 外观可改：仅更新 editable（不参与锁定）
    rec.editable = { colors: sheet.colors, look: sheet.look };
    rec.updatedAt = Date.now();
    rec.version = (rec.version || 1) + 1;
    save(db);
    return { raw: rawFromLocked(rec.locked, rec.editable), characterId, created: true };
  }

  // 新建：强制 level=1 / xp=0（研究 §A.6「不可直接认证无限等级和经验」）
  const locked = lockedOf(sheet);
  locked.level = 1;
  locked.xp = 0;
  const rec = newRecord(account, locked, { colors: sheet.colors, look: sheet.look }, 'fresh', 'alive');
  db.characters[rec.characterId] = rec;
  (db.byAccount[account] || (db.byAccount[account] = [])).push(rec.characterId);
  save(db);
  return { raw: rawFromLocked(locked, rec.editable), characterId: rec.characterId, created: true };
}

// 迁移：本地名册条目 → 服务端角色。
//  幂等键 importKeys[account:rosterId] ⇒ 重复导入返回同一 characterId（不产生重复角色）。
//  失败只回错误（不落盘、不删本地）；来源留痕 origin='imported-local'。
export function importEntry(account, rosterId, rawSheet) {
  if (!account) return { err: '请先登录账号' };
  if (!rosterId) return { err: '缺少名册条目 id' };
  const key = account + ':' + rosterId;
  const db = load();
  if (db.importKeys[key] && db.characters[db.importKeys[key]]) {
    return { characterId: db.importKeys[key], deduped: true };
  }
  let sheet;
  try { sheet = buildSheet(rawSheet || {}); }
  catch (e) { return { err: (e && e.message) ? e.message : '车卡数据非法' }; }
  const locked = lockedOf(sheet);
  // 本地历史卡不可信（研究 §A.6）：
  //  - level 由 buildSheet 校验（越界 ⇒ 上面已回明确原因；**不夹取、不伪造已验证等级**）；
  //  - xp 无值域校验 ⇒ 夹取到 >= 0。
  locked.xp = Math.max(0, Math.floor(Number(locked.xp) || 0));
  const status = (rawSheet && rawSheet.status === 'dead') ? 'dead' : 'alive';
  const rec = newRecord(account, locked, { colors: sheet.colors, look: sheet.look }, 'imported-local', status);
  db.characters[rec.characterId] = rec;
  (db.byAccount[account] || (db.byAccount[account] = [])).push(rec.characterId);
  db.importKeys[key] = rec.characterId;
  save(db);
  return { characterId: rec.characterId };
}

// 结算成长：level/xp/status 只允许服务端在结算时写（RD-007「版本变更只允许服务端合法成长/结算」）
export function settle(characterId, { level, xp, dead } = {}) {
  const db = load();
  const rec = db.characters[characterId];
  if (!rec) return { err: '角色不存在' };
  let changed = false;
  const lv = Math.floor(Number(level));
  if (Number.isFinite(lv) && lv >= 1 && lv <= MAX_LEVEL && lv !== rec.locked.level) { rec.locked.level = lv; changed = true; }
  const xp2 = Math.floor(Number(xp));
  if (Number.isFinite(xp2) && xp2 >= 0 && xp2 !== rec.locked.xp) { rec.locked.xp = xp2; changed = true; }
  if (dead === true && rec.status !== 'dead') { rec.status = 'dead'; changed = true; }
  rec.adventureCount = (rec.adventureCount || 0) + 1; // 每次结算 +1（RD-006「新卡」判据）
  rec.version = (rec.version || 1) + 1;
  rec.updatedAt = Date.now();
  save(db);
  return { ok: true, changed };
}

// 账号角色列表（登录时下发，供客户端重建/校验名册条目）。
// 含锁定数据 + 外观（重建条目所需）；**不含故事集**（冒险卡片归 R1-25）。
export function listByAccount(account) {
  if (!account) return [];
  const db = load();
  const out = [];
  for (const id of (db.byAccount[account] || [])) {
    const r = db.characters[id];
    if (!r) continue;
    out.push({ characterId: r.characterId, status: r.status, origin: r.origin, locked: r.locked, editable: r.editable });
  }
  return out;
}

export function getById(characterId) {
  const rec = load().characters[characterId];
  return rec ? JSON.parse(JSON.stringify(rec)) : null;
}
