import test from 'node:test';
import assert from 'node:assert/strict';
import { normalize, parseLines, toLine, parseTime, KINDS } from '../src/events.mjs';

test('normalize accepts ISO, epoch ms and epoch seconds', () => {
  assert.equal(normalize({ t: '2026-10-07T09:30:00.000Z', kind: 'start' }).t, Date.parse('2026-10-07T09:30:00.000Z'));
  assert.equal(normalize({ t: 1791365400000, kind: 'start' }).t, 1791365400000);
  assert.equal(normalize({ t: 1791365400, kind: 'start' }).t, 1791365400000);
  assert.equal(parseTime('nope'), null);
});

test('normalize maps aliases and verdicts, rejects unknown kinds', () => {
  assert.equal(normalize({ t: 1, kind: 'completed' }).kind, 'done');
  assert.equal(normalize({ t: 1, kind: 'done', verdict: 'fail' }).kind, 'fail');
  assert.equal(normalize({ t: 1, kind: 'BLOCKED' }).kind, 'block');
  assert.equal(normalize({ t: 1, kind: 'dance' }), null);
  assert.equal(normalize({ kind: 'start' }), null);
  assert.equal(normalize(null), null);
  for (const k of KINDS) assert.equal(normalize({ t: 1, kind: k, file: 'a.js' }).kind, k);
  assert.equal(normalize({ t: 1, kind: 'build' }), null, 'a build needs a file');
  assert.deepEqual(normalize({ t: 1, kind: 'build', agent: 'c', file: '\\src\\play.js', lines: '214.4' }), { t: 1000, kind: 'build', agent: 'c', file: 'src/play.js', lines: 214 });
  assert.equal(normalize({ t: 1, kind: 'build', file: 'x', lines: -3 }).lines, undefined);
});

test('normalize cleans strings: control characters out, caps applied', () => {
  const e = normalize({ t: 1, kind: 'start', agent: ' C1\u0007 ', text: 'x'.repeat(500), role: 'coder‮' });
  assert.equal(e.agent, 'C1');
  assert.equal(e.role, 'coder');
  assert.equal(e.text.length, 240);
  assert.ok(e.text.endsWith('…'));
});

test('parseLines skips junk and torn lines, toLine round-trips', () => {
  const good = { t: 1791365400000, kind: 'handoff', agent: 'A', to: 'B', paper: 'P1', text: 'hi' };
  const text = toLine(good) + 'not json\n' + '{"t":"bad","kind":"start"}\n' + toLine(good).slice(0, 20);
  const out = parseLines(text);
  assert.equal(out.length, 1);
  assert.deepEqual(out[0], good);
  assert.ok(toLine(good).includes('"contract":"binas.event/0.2"'));
});
