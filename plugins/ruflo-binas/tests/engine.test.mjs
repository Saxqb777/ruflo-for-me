import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createEngine, roomForRole, makeSlots, KINDS } from '../web/engine.js';
import { parseLines } from '../src/events.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const demo = () => parseLines(readFileSync(join(HERE, '..', 'demo', 'shift-014.jsonl'), 'utf8'));

test('roles map to rooms; unknown roles go to the build floor', () => {
  assert.equal(roomForRole('coordinator'), '101');
  assert.equal(roomForRole('Researcher'), '102');
  assert.equal(roomForRole('system-architect'), '103');
  assert.equal(roomForRole('tester'), '104');
  assert.equal(roomForRole('security-auditor'), '105');
  assert.equal(roomForRole('release'), '202');
  assert.equal(roomForRole('coder'), '201');
  assert.equal(roomForRole(''), '201');
  assert.equal(makeSlots().length, 17);
});

test('the demo shift folds: 12 agents at desks, 3 shipments, a block, no NaN anywhere', () => {
  const eng = createEngine(); const evs = demo();
  assert.ok(evs.length >= 60);
  evs.forEach((e) => assert.ok(eng.push(e), `push failed for ${e.kind}`));
  const b = eng.bounds();
  assert.equal(eng.agents.size, 12);
  assert.equal(eng.agents.get('QN').slot.room, '101');
  assert.equal(eng.agents.get('RL').slot.room, '202');
  assert.equal(new Set([...eng.agents.values()].map((a) => a.slot.id)).size, 12, 'every agent has its own desk');
  const end = eng.view(b.t1 + 10000);
  assert.equal(end.shipped, 3);
  assert.equal(end.blocked, 0);
  let sawBlock = false, sawMoving = false;
  for (let t = b.t0; t <= b.t1 + 8000; t += 250) {
    const v = eng.view(t);
    if (v.blocked) sawBlock = true;
    for (const p of v.papers) if (p.pos) { assert.ok(Number.isFinite(p.pos.x + p.pos.y + p.pos.z), 'finite positions'); if (p.pos.moving) sawMoving = true; }
    assert.ok(v.door >= 0 && v.door <= 1);
  }
  assert.ok(sawBlock && sawMoving);
  assert.ok(eng.feed.length >= evs.length - 12, 'every non-join event writes a feed line');
});

test('live-style events: unknown agents and papers are created on the fly', () => {
  const eng = createEngine(); const t = 1_000_000;
  assert.ok(eng.push({ t, kind: 'start', agent: 'me-ab12', role: 'coordinator', paper: 'p1', text: 'reading' }));
  assert.ok(eng.push({ t: t + 10, kind: 'handoff', agent: 'me-ab12', to: 'researcher.ab12.1', toRole: 'researcher', paper: 'p1.1', text: 'look into it' }));
  assert.ok(eng.push({ t: t + 20, kind: 'block', agent: 'me-ab12', text: 'permission · Bash' }));
  assert.equal(eng.agents.get('researcher.ab12.1').slot.room, '102');
  const v = eng.view(t + 1000);
  assert.equal(v.blocked, 1);
  assert.equal(v.notes.length, 1);
  assert.ok(eng.push({ t: t + 2000, kind: 'unblock', agent: 'me-ab12' }));
  assert.equal(eng.view(t + 2500).blocked, 0);
  assert.ok(eng.push({ t: t + 3000, kind: 'ship', agent: 'me-ab12', paper: 'p1', text: 'git push' }));
  assert.equal(eng.view(t + 30000).shipped, 1);
  assert.ok(eng.push({ t: t + 4000, kind: 'leave', agent: 'researcher.ab12.1' }));
  assert.ok(eng.view(t + 5000).agents.find((a) => a.id === 'researcher.ab12.1').gone);
  assert.equal(eng.push({ t: t, kind: 'nope' }), false);
  assert.equal(eng.push({ kind: 'start' }), false);
  assert.ok(KINDS.includes('join'));
});

test('a full room overflows to the build floor instead of failing', () => {
  const eng = createEngine(); const t = 5;
  for (let i = 0; i < 4; i++) eng.push({ t, kind: 'join', agent: 'r' + i, role: 'researcher' });
  const rooms = [0, 1, 2, 3].map((i) => eng.agents.get('r' + i).slot.room);
  assert.deepEqual(rooms, ['102', '102', '201', '201']);
});
