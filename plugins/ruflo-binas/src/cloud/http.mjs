// Shared bits for the Vercel functions: key check, body reading, JSON replies. Framework-free.
import { createHash, timingSafeEqual } from 'node:crypto';

const FLOOR_RE = /^[a-z0-9][a-z0-9_-]{0,39}$/i;
export const floorOf = (q) => { const f = String((q && q.floor) || 'default'); return FLOOR_RE.test(f) ? f : 'default'; };

export function keyOk(given, expected) {
  if (!expected) return false;
  const a = createHash('sha256').update(String(given || '')).digest(), b = createHash('sha256').update(String(expected)).digest();
  return timingSafeEqual(a, b);
}
export function keyFrom(req) {
  const h = req.headers || {}; const auth = String(h.authorization || '');
  if (h['x-binas-key']) return String(h['x-binas-key']);
  if (/^bearer /i.test(auth)) return auth.slice(7).trim();
  return req.query && req.query.key ? String(req.query.key) : '';
}

export function json(res, status, body) {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  res.end(JSON.stringify(body));
}

/** Body as text: Vercel may have parsed it already (object or string), else read the stream. */
export async function readBody(req) {
  if (req.body !== undefined && req.body !== null) return typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
  return new Promise((resolve) => { let d = ''; req.setEncoding && req.setEncoding('utf8'); req.on('data', (c) => { d += c; if (d.length > 2e6) req.destroy(); }); req.on('end', () => resolve(d)); req.on('error', () => resolve(d)); });
}

/** Accept a JSON object, a JSON array, or JSON lines; return raw objects. */
export function parseBody(text) {
  const s = String(text || '').trim(); if (!s) return [];
  try { const v = JSON.parse(s); return Array.isArray(v) ? v : [v]; } catch { /* maybe JSON lines */ }
  const out = []; for (const line of s.split('\n')) { const l = line.trim(); if (!l) continue; try { out.push(JSON.parse(l)); } catch { /* skip */ } }
  return out;
}

export function queryOf(req) {
  if (req.query && typeof req.query === 'object') return req.query;
  try { return Object.fromEntries(new URL(req.url || '/', 'http://x').searchParams); } catch { return {}; }
}
