// Claude Code hook entry. Reads the hook payload from stdin, maps it to Binas events, appends them to
// .claude-flow/binas/events.jsonl, and keeps a small per-session correlation record beside it.
// It never blocks a tool: every failure is swallowed, nothing is printed to stdout, exit code is always 0.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { appendEvent, logDir } from '../src/log.mjs';
import { mapHook, emptyState } from '../src/adapters/claude-hooks.mjs';

function readStdin() {
  return new Promise((resolve) => {
    let data = ''; const done = () => resolve(data);
    const timer = setTimeout(done, 1500);
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (c) => { data += c; if (data.length > 1e6) { clearTimeout(timer); done(); } });
    process.stdin.on('end', () => { clearTimeout(timer); done(); });
    process.stdin.on('error', () => { clearTimeout(timer); done(); });
  });
}

(async () => {
  try {
    const raw = await readStdin(); if (!raw.trim()) return;
    const payload = JSON.parse(raw);
    // BINAS_LOG_ROOT wins: the factory routes a job's events to the floor's log, not the project's.
    const root = process.env.BINAS_LOG_ROOT || process.env.CLAUDE_PROJECT_DIR || payload.cwd || process.cwd();
    const dir = logDir(root); mkdirSync(dir, { recursive: true, mode: 0o700 });
    const sid = String(payload.session_id || 'solo').replace(/[^a-z0-9]/gi, '').slice(0, 24) || 'solo';
    const stateFile = join(dir, `state-${sid}.json`);
    const job = process.env.BINAS_JOB ? { id: process.env.BINAS_JOB, name: process.env.BINAS_JOB_NAME } : null;
    let state = emptyState(payload.session_id, job);
    if (existsSync(stateFile)) { try { const s = JSON.parse(readFileSync(stateFile, 'utf8')); if (s && s.v === 1) state = s; } catch { /* fresh */ } }
    const out = mapHook(payload, state, Date.now());
    for (const e of out.events) appendEvent(root, e);
    writeFileSync(stateFile, JSON.stringify(out.state), { encoding: 'utf8', mode: 0o600 });
    // Optional cloud copy: BINAS_INGEST_URL (…/api/ingest) + BINAS_KEY. Capped at 1.5 s, never fatal.
    let url = process.env.BINAS_INGEST_URL; const key = process.env.BINAS_KEY, floor = process.env.BINAS_FLOOR;
    if (url && key && out.events.length && typeof fetch === 'function') {
      if (floor) url += (url.includes('?') ? '&' : '?') + 'floor=' + encodeURIComponent(floor);
      try { await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', 'x-binas-key': key }, body: JSON.stringify(out.events), signal: AbortSignal.timeout(1500) }); } catch { /* best effort */ }
    }
  } catch (err) {
    if (process.env.BINAS_DEBUG === '1') process.stderr.write(`[binas hook] ${err && err.message}\n`);
  }
})();
