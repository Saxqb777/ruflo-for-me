// Binas event contract v0.1: one JSON object per line.
//   { "t": "2026-10-07T09:31:07.000Z", "kind": "start", "agent": "C1", "role": "coder",
//     "paper": "P2", "to": "C1", "text": "private blobs + signed reads", "source": "claude-hooks" }
// `t` (ISO string or epoch ms) and `kind` are required; everything else is optional.
// Strings are trimmed, stripped of control and bidi characters, and capped, because the log is data
// written by hooks and other processes and the page draws it.
import { KINDS, CONTRACT } from '../web/engine.js';

export { KINDS, CONTRACT };

const ALIAS = { failed: 'fail', complete: 'done', completed: 'done', finished: 'done', blocked: 'block', unblocked: 'unblock', resumed: 'unblock', shipped: 'ship', released: 'ship', joined: 'join', spawned: 'join', left: 'leave', assigned: 'claim', began: 'start', started: 'start' };
const CAP = { agent: 48, paper: 64, text: 240, role: 40, name: 40, to: 48, from: 48, toRole: 40, needs: 160, source: 32 };
const CONTROL = /[\u0000-\u001F\u007F​-‏‪-‮⁦-⁩]/g;

export function clean(v, cap) {
  if (v === null || v === undefined) return undefined;
  const s = String(v).replace(CONTROL, '').trim();
  if (!s) return undefined;
  return s.length > cap ? s.slice(0, cap - 1) + '…' : s;
}

export function parseTime(t) {
  if (typeof t === 'number' && Number.isFinite(t)) return t > 1e11 ? Math.round(t) : Math.round(t * 1000);
  if (typeof t === 'string') { const ms = Date.parse(t); if (Number.isFinite(ms)) return ms; const n = Number(t); if (Number.isFinite(n)) return parseTime(n); }
  return null;
}

/** Normalize an untrusted object into an engine event, or return null when it cannot be one. */
export function normalize(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const t = parseTime(raw.t ?? raw.time ?? raw.at ?? raw.ts);
  let kind = clean(raw.kind ?? raw.type ?? raw.event, 24);
  if (t === null || !kind) return null;
  kind = kind.toLowerCase(); kind = ALIAS[kind] || kind;
  if (kind === 'done' && String(raw.verdict || '').toLowerCase() === 'fail') kind = 'fail';
  if (!KINDS.includes(kind)) return null;
  const e = { t, kind };
  for (const k of Object.keys(CAP)) { const v = clean(raw[k], CAP[k]); if (v !== undefined) e[k] = v; }
  if (!e.agent && typeof raw.who === 'string') e.agent = clean(raw.who, CAP.agent);
  if (!e.text && typeof raw.title === 'string') e.text = clean(raw.title, CAP.text);
  return e;
}

/** Parse JSON lines; bad or torn lines are skipped, never fatal. */
export function parseLines(text) {
  const out = [];
  for (const line of String(text || '').split('\n')) {
    const s = line.trim(); if (!s) continue;
    try { const e = normalize(JSON.parse(s)); if (e) out.push(e); } catch { /* skip */ }
  }
  return out;
}

export function toLine(e) {
  const o = { ...e, t: new Date(e.t).toISOString(), contract: CONTRACT };
  return JSON.stringify(o) + '\n';
}

export const byTime = (a, b) => a.t - b.t;
