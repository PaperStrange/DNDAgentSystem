// 账户系统：注册/登录（scrypt哈希存储）+ 单点登录会话（同一账号新登录挤掉旧会话）
// 数据落盘 data/accounts.json（已 gitignore，密码只存盐+哈希，绝不存明文）
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scryptSync, randomBytes, timingSafeEqual } from 'node:crypto';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const DATA_DIR = join(root, 'data');
const FILE = join(DATA_DIR, 'accounts.json');

export const USERNAME_RULE = '用户名需2~20位，可用字母/数字/中文/下划线/连字符';
export const PASSWORD_RULE = '密码长度需4~64位';

function load() {
  try { return JSON.parse(readFileSync(FILE, 'utf8')); } catch (e) { return {}; }
}
function save(db) {
  try {
    if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
    writeFileSync(FILE, JSON.stringify(db, null, 2));
  } catch (e) { console.error('[accounts] 保存账户失败', e?.message || e); }
}

function hashPassword(pw, salt) {
  return scryptSync(String(pw), salt, 32).toString('hex');
}

export function registerAccount(username, password) {
  const name = String(username || '').trim();
  const pw = String(password || '');
  if (!/^[\w\u4e00-\u9fa5-]{2,20}$/.test(name)) return { err: USERNAME_RULE };
  if (pw.length < 4 || pw.length > 64) return { err: PASSWORD_RULE };
  const db = load();
  if (db[name]) return { err: '该用户名已被注册，请直接登录或换一个名字' };
  const salt = randomBytes(16).toString('hex');
  db[name] = { salt, hash: hashPassword(pw, salt), createdAt: Date.now() };
  save(db);
  return { ok: true };
}

export function verifyAccount(username, password) {
  const name = String(username || '').trim();
  const rec = load()[name];
  if (!rec) return { err: '账号不存在，请先注册' };
  const h = Buffer.from(hashPassword(String(password || ''), rec.salt), 'hex');
  const stored = Buffer.from(rec.hash, 'hex');
  if (h.length !== stored.length || !timingSafeEqual(h, stored)) return { err: '密码不正确，请重试' };
  return { ok: true };
}
