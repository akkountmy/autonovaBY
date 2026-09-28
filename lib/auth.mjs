// Регистрация, вход, сессии. Пароли — scrypt, сессии — httpOnly cookie.
import crypto from 'node:crypto';
import { one, run, db } from './db.mjs';

const KEYLEN = 32;
export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, KEYLEN).toString('hex');
  return `scrypt$${salt}$${hash}`;
}
export function verifyPassword(password, stored) {
  const [scheme, salt, hash] = String(stored).split('$');
  if (scheme !== 'scrypt' || !salt || !hash) return false;
  const calc = crypto.scryptSync(password, salt, KEYLEN);
  const want = Buffer.from(hash, 'hex');
  return calc.length === want.length && crypto.timingSafeEqual(calc, want);
}

export const SESSION_DAYS = 30;

export function createSession(userId) {
  const token = crypto.randomBytes(24).toString('hex');
  const expires = new Date(Date.now() + SESSION_DAYS * 86400000).toISOString().slice(0, 19).replace('T', ' ');
  run('INSERT INTO sessions (token, user_id, expires_at) VALUES (?,?,?)', token, userId, expires);
  return token;
}

export function userByToken(token) {
  if (!token) return null;
  const row = one(`SELECT u.id, u.email, u.name, u.phone, u.city, u.role
                   FROM sessions s JOIN users u ON u.id = s.user_id
                   WHERE s.token = ? AND s.expires_at > datetime('now')`, token);
  return row || null;
}

export function destroySession(token) {
  if (token) run('DELETE FROM sessions WHERE token = ?', token);
}

export function parseCookies(req) {
  const raw = req.headers.cookie || '';
  const out = {};
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i;

export function register({ email, password, name, phone, city }) {
  email = String(email || '').trim().toLowerCase();
  if (!EMAIL_RE.test(email)) return { error: 'Укажите корректный e-mail' };
  if (String(password || '').length < 6) return { error: 'Пароль — не короче 6 символов' };
  if (!String(name || '').trim()) return { error: 'Укажите имя' };
  if (one('SELECT id FROM users WHERE email = ?', email)) return { error: 'Такой e-mail уже зарегистрирован' };
  const info = run('INSERT INTO users (email, name, phone, city, password_hash, role) VALUES (?,?,?,?,?,?)',
    email, String(name).trim(), String(phone || '').trim(), String(city || 'Гомель').trim(),
    hashPassword(password), 'user');
  const id = Number(info.lastInsertRowid);
  return { user: one('SELECT id, email, name, phone, city, role FROM users WHERE id = ?', id) };
}

export function login({ email, password }) {
  email = String(email || '').trim().toLowerCase();
  const u = one('SELECT * FROM users WHERE email = ?', email);
  if (!u || !verifyPassword(password, u.password_hash)) return { error: 'Неверный e-mail или пароль' };
  return { user: { id: u.id, email: u.email, name: u.name, phone: u.phone, city: u.city, role: u.role } };
}

export function cleanupSessions() {
  db.exec("DELETE FROM sessions WHERE expires_at <= datetime('now')");
}
