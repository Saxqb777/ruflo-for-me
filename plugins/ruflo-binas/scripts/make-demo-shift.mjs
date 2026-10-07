// Generates demo/shift-014.jsonl: a recorded engineering shift at Binas Works, written as real Binas
// events with absolute timestamps. Deterministic: the schedule is clamped so a desk only starts work after
// its paper has physically arrived by tube, using the same geometry the page animates with.
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createEngine, tubePath, plen, SPEED, CHUTE, BELT, TRAY_Y } from '../web/engine.js';
import { toLine } from '../src/events.mjs';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'demo', 'shift-014.jsonl');
const BASE = Date.parse('2026-10-07T09:30:00.000Z');

const ROSTER = [['QN', 'coordinator'], ['R1', 'researcher'], ['R2', 'researcher'], ['AR', 'architect'], ['T1', 'tester'], ['T2', 'tester'], ['RV', 'reviewer'], ['C1', 'coder'], ['C2', 'coder'], ['C3', 'coder'], ['C4', 'coder'], ['RL', 'release']];
const PAPERS = { P1: 'Payments: retry webhook on 5xx', P2: 'Uploads: private files, signed links', P3: 'Dashboard: totals over the full query' };
const SCRIPT = [
  [0.6, 'arrive', { p: 'P1' }], [2.0, 'claim', { a: 'QN', p: 'P1', to: 'R1', text: 'needs research first' }],
  [5.0, 'start', { a: 'R1', p: 'P1', text: 'reading webhook retry + idempotency rules' }], [6.5, 'arrive', { p: 'P2' }],
  [8.0, 'claim', { a: 'QN', p: 'P2', to: 'AR', text: 'security, straight to drafting' }], [10.5, 'start', { a: 'AR', p: 'P2', text: 'drafting signed file reads, 15 min expiry' }],
  [12.5, 'done', { a: 'R1', p: 'P1', text: 'retry schedule + dedupe key' }], [13.0, 'handoff', { a: 'R1', p: 'P1', to: 'AR', text: 'research notes' }],
  [15.5, 'arrive', { p: 'P3' }], [17.0, 'claim', { a: 'QN', p: 'P3', to: 'C3', text: 'small fix, no design needed' }],
  [19.0, 'done', { a: 'AR', p: 'P2', text: 'plan: private store, signed GET, cleanup on delete' }], [19.5, 'handoff', { a: 'AR', p: 'P2', to: 'C1', text: 'file access plan' }],
  [20.0, 'start', { a: 'C3', p: 'P3', text: 'totals: sum the query, not the page' }], [23.0, 'start', { a: 'AR', p: 'P1', text: 'drafting webhook handler contract' }],
  [24.0, 'start', { a: 'C1', p: 'P2', text: 'private files + signed reads' }], [28.0, 'done', { a: 'AR', p: 'P1', text: 'contract ready' }],
  [28.5, 'handoff', { a: 'AR', p: 'P1', to: 'C2', text: 'webhook contract' }], [31.0, 'start', { a: 'C2', p: 'P1', text: 'webhook retry + idempotency key' }],
  [32.0, 'block', { a: 'C1', text: 'flip existing uploads to private too?' }], [33.5, 'done', { a: 'C3', p: 'P3', text: 'footer uses server total' }],
  [34.0, 'handoff', { a: 'C3', p: 'P3', to: 'T1', text: 'totals fix' }], [37.0, 'start', { a: 'T1', p: 'P3', text: 'testing totals across 3 pages' }],
  [41.0, 'fail', { a: 'T1', p: 'P3', text: 'summary card still sums the page' }], [41.5, 'handoff', { a: 'T1', p: 'P3', to: 'C3', text: 'back with repro' }],
  [44.0, 'unblock', { a: 'C1', text: 'yes, migrate existing uploads too' }], [45.0, 'start', { a: 'C3', p: 'P3', text: 'fix the summary card as well' }],
  [48.0, 'done', { a: 'C2', p: 'P1', text: 'handler + 3 unit tests' }], [48.5, 'handoff', { a: 'C2', p: 'P1', to: 'T2', text: 'ready for replay test' }],
  [51.0, 'start', { a: 'T2', p: 'P1', text: 'replaying 5xx webhooks' }], [51.5, 'done', { a: 'C3', p: 'P3', text: 'both totals fixed' }],
  [52.0, 'handoff', { a: 'C3', p: 'P3', to: 'T1', text: 'retest' }], [54.5, 'start', { a: 'T1', p: 'P3', text: 'retesting totals' }],
  [56.0, 'done', { a: 'C1', p: 'P2', text: 'migration + signed reads' }], [56.5, 'handoff', { a: 'C1', p: 'P2', to: 'T1', text: 'queue for test' }],
  [57.5, 'done', { a: 'T1', p: 'P3', text: 'pass' }], [58.0, 'handoff', { a: 'T1', p: 'P3', to: 'RV', text: 'for review' }],
  [60.0, 'start', { a: 'RV', p: 'P3', text: 'review: totals' }], [60.5, 'done', { a: 'T2', p: 'P1', text: 'no duplicate charges on retry' }],
  [61.0, 'handoff', { a: 'T2', p: 'P1', to: 'RV', text: 'for review' }], [61.5, 'start', { a: 'T1', p: 'P2', text: 'signed URLs expire at 15 min' }],
  [63.0, 'done', { a: 'RV', p: 'P3', text: 'approved' }], [63.5, 'handoff', { a: 'RV', p: 'P3', to: 'RL', text: 'release' }],
  [65.0, 'start', { a: 'RV', p: 'P1', text: 'review: webhook handler' }], [66.0, 'ship', { a: 'RL', p: 'P3' }],
  [68.5, 'done', { a: 'RV', p: 'P1', text: 'approved' }], [69.0, 'handoff', { a: 'RV', p: 'P1', to: 'RL', text: 'release' }],
  [70.0, 'done', { a: 'T1', p: 'P2', text: 'pass, expiry enforced' }], [70.5, 'handoff', { a: 'T1', p: 'P2', to: 'RV', text: 'for review' }],
  [72.0, 'ship', { a: 'RL', p: 'P1' }], [73.5, 'start', { a: 'RV', p: 'P2', text: 'security review: file access' }],
  [76.0, 'block', { a: 'RV', text: 'retention: purge old uploads after a year?' }], [82.0, 'unblock', { a: 'RV', text: 'yes, one year, then purge' }],
  [83.0, 'done', { a: 'RV', p: 'P2', text: 'approved with retention rule' }], [83.5, 'handoff', { a: 'RV', p: 'P2', to: 'RL', text: 'release' }],
  [86.0, 'ship', { a: 'RL', p: 'P2' }],
];

export function buildDemo() {
  const eng = createEngine();
  const events = [];
  const emit = (t, kind, o) => { const e = { t: BASE + Math.round(t * 1000), kind, source: 'demo', ...o }; events.push(e); return e; };
  for (const [id, role] of ROSTER) { emit(0, 'join', { agent: id, role, name: id }); eng.push({ t: BASE, kind: 'join', agent: id, role, name: id }); }
  const W = (id) => eng.agents.get(id).slot.W;
  const free = Object.fromEntries(ROSTER.map(([id]) => [id, 0])); const ready = {};
  const tube = (a, b) => plen(tubePath(W(a).station, W(b).station)) / SPEED.tube;
  for (const [t0, kind, o] of SCRIPT) {
    let t = t0;
    if (kind === 'arrive') {
      const tr = W('QN').tray; const d = plen([CHUTE, { x: tr.x, y: 1.3, z: CHUTE.z }, { x: tr.x, y: TRAY_Y, z: tr.z }]) / SPEED.slide;
      emit(t, 'arrive', { paper: o.p, to: 'QN', text: PAPERS[o.p] }); ready[o.p] = t + d; continue;
    }
    t = Math.max(t, free[o.a] || 0, o.p ? (ready[o.p] || 0) : 0);
    if (kind === 'claim' || kind === 'handoff') { emit(t, kind, { agent: o.a, to: o.to, paper: o.p, text: o.text }); ready[o.p] = t + tube(o.a, o.to); free[o.a] = t + 0.5; }
    else if (kind === 'start') emit(t, 'start', { agent: o.a, paper: o.p, text: o.text });
    else if (kind === 'block') emit(t, 'block', { agent: o.a, text: o.text });
    else if (kind === 'unblock') emit(t, 'unblock', { agent: o.a, text: o.text });
    else if (kind === 'done' || kind === 'fail') { emit(t, kind, { agent: o.a, paper: o.p, text: o.text }); free[o.a] = t + 1.0; }
    else if (kind === 'ship') { const tr = W('RL').tray; const d = plen([{ x: tr.x, y: TRAY_Y, z: tr.z }, ...BELT]) / SPEED.belt; emit(t, 'ship', { agent: o.a, paper: o.p, text: PAPERS[o.p] }); free[o.a] = t + d; }
  }
  events.sort((a, b) => a.t - b.t);
  return events;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const events = buildDemo();
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, events.map(toLine).join(''));
  const span = (events[events.length - 1].t - events[0].t) / 1000;
  process.stdout.write(`wrote ${events.length} events over ${span.toFixed(1)}s to ${OUT}\n`);
}
