// The Binas log: .claude-flow/binas/events.jsonl, append-only, one event per line, rotated once at 8 MB.
// Writers are short-lived hook processes; readers tolerate a torn last line.
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, statSync, openSync, readSync, closeSync, watchFile, unwatchFile } from 'node:fs';
import { join } from 'node:path';
import { normalize, parseLines, toLine } from './events.mjs';

export const LOG_DIR = join('.claude-flow', 'binas');
export const LOG_FILE = 'events.jsonl';
export const ROTATED_FILE = 'events.1.jsonl';
export const MAX_BYTES = 8 * 1024 * 1024;

export const logDir = (root) => join(root, LOG_DIR);
export const logPath = (root) => join(root, LOG_DIR, LOG_FILE);

export function appendEvent(root, raw) {
  const e = normalize(raw); if (!e) return false;
  const dir = logDir(root); mkdirSync(dir, { recursive: true, mode: 0o700 });
  const file = logPath(root);
  try { if (existsSync(file) && statSync(file).size > MAX_BYTES) renameSync(file, join(dir, ROTATED_FILE)); } catch { /* best effort */ }
  appendFileSync(file, toLine(e), { encoding: 'utf8', mode: 0o600 });
  return true;
}

export function readEvents(root) {
  const out = [];
  for (const f of [join(logDir(root), ROTATED_FILE), logPath(root)]) {
    if (!existsSync(f)) continue;
    try { out.push(...parseLines(readFileSync(f, 'utf8'))); } catch { /* skip */ }
  }
  return out;
}

/** Poll the log for appended bytes; calls onEvent(event) for each complete new line. Returns stop(). */
export function followEvents(root, onEvent, { intervalMs = 500 } = {}) {
  const file = logPath(root);
  let offset = existsSync(file) ? statSync(file).size : 0;
  let carry = '';
  const read = () => {
    if (!existsSync(file)) { offset = 0; carry = ''; return; }
    const size = statSync(file).size;
    if (size < offset) { offset = 0; carry = ''; }
    if (size === offset) return;
    const fd = openSync(file, 'r');
    try {
      const buf = Buffer.alloc(size - offset); readSync(fd, buf, 0, buf.length, offset); offset = size;
      const text = carry + buf.toString('utf8'); const lines = text.split('\n'); carry = lines.pop() || '';
      for (const e of parseLines(lines.join('\n'))) onEvent(e);
    } finally { closeSync(fd); }
  };
  watchFile(file, { interval: intervalMs, persistent: true }, read);
  const timer = setInterval(read, intervalMs * 2); // watchFile misses a file that appears later; the interval does not
  return () => { unwatchFile(file, read); clearInterval(timer); };
}
