// Users and sessions with no dependency: scrypt for passwords, an HMAC-signed cookie for sessions.
// A password is never stored or logged; a session carries the user id, a password version and an expiry.
import { createHash, createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { cookieOf, cookieHeader } from './http.mjs';

export const SESSION_COOKIE = 'binas_session';
export const SESSION_TTL_MS = 30 * 24 * 3600 * 1000;
const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 32 };
const USERNAME_RE = /^[a-z0-9][a-z0-9_.-]{1,31}$/i;
const b64u = (buf) => Buffer.from(buf).toString('base64url');
const unb64u = (s) => Buffer.from(String(s || ''), 'base64url');

export const usernameOk = (u) => USERNAME_RE.test(String(u || ''));
export const passwordOk = (p) => typeof p === 'string' && p.length >= 10 && p.length <= 200;

/** `scrypt$N$salt$hash`, all base64url. */
export function hashPassword(password, salt = randomBytes(16)) {
  if (!passwordOk(password)) throw new Error('a password needs 10 to 200 characters');
  const hash = scryptSync(password.normalize('NFKC'), salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p });
  return `scrypt$${SCRYPT.N}$${b64u(salt)}$${b64u(hash)}`;
}
export function verifyPassword(password, stored) {
  try {
    const [algo, n, salt, hash] = String(stored || '').split('$'); if (algo !== 'scrypt' || !salt || !hash) return false;
    const want = unb64u(hash); const got = scryptSync(String(password || '').normalize('NFKC'), unb64u(salt), want.length, { N: Number(n) || SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p });
    return got.length === want.length && timingSafeEqual(got, want);
  } catch { return false; }
}
/** A short tag of the stored hash, carried in the session so a password change ends old sessions. */
export const passwordVersion = (stored) => createHash('sha256').update(String(stored || '')).digest('base64url').slice(0, 8);

/** A readable one-time password: four groups of four, no ambiguous letters. */
export function newPassword() {
  const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789'; const bytes = randomBytes(16); let s = '';
  for (let i = 0; i < 16; i++) { s += alphabet[bytes[i] % alphabet.length]; if (i % 4 === 3 && i < 15) s += '-'; }
  return s;
}

function sign(payload, secret) { return createHmac('sha256', String(secret)).update(payload).digest('base64url'); }
export function signSession({ uid, pv }, secret, { now = Date.now(), ttlMs = SESSION_TTL_MS } = {}) {
  if (!secret || String(secret).length < 16) throw new Error('BINAS_SESSION_SECRET is not set (16+ characters)');
  const payload = b64u(JSON.stringify({ uid: Number(uid), pv: String(pv || ''), exp: now + ttlMs }));
  return `${payload}.${sign(payload, secret)}`;
}
export function verifySession(token, secret, now = Date.now()) {
  try {
    if (!secret || !token) return null;
    const [payload, sig] = String(token).split('.'); if (!payload || !sig) return null;
    const want = Buffer.from(sign(payload, secret)); const got = Buffer.from(sig);
    if (want.length !== got.length || !timingSafeEqual(want, got)) return null;
    const s = JSON.parse(unb64u(payload).toString('utf8'));
    return Number.isFinite(s.exp) && s.exp > now && Number.isFinite(s.uid) ? s : null;
  } catch { return null; }
}
export const sessionFrom = (req, secret, now) => verifySession(cookieOf(req, SESSION_COOKIE), secret, now);
export const sessionCookie = (token) => cookieHeader(SESSION_COOKIE, token, SESSION_TTL_MS / 1000);
export const clearCookie = () => cookieHeader(SESSION_COOKIE, '', 0);

/** What a user looks like outside the database. Never the hash. */
export function publicUser(u) {
  if (!u) return null;
  return { id: Number(u.id), username: u.username, display: u.display, role: u.role, floor: u.floor, allowanceUsd: u.allowance_usd === null || u.allowance_usd === undefined ? null : Number(u.allowance_usd) };
}
