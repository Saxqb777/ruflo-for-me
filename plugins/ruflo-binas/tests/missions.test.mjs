import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { mapMissionEvent, parseMissionLog, readMissions } from '../src/adapters/missions.mjs';

const me = (type, extra = {}) => ({ contract: 'ruflo.mission-event/1', seq: 1, missionId: 'msn_0123456789abcdef01234567', type, expectedRevision: null, revision: 1, principalId: 'user', channel: 'executor', requestId: null, requestDigest: null, policyDecisionRef: null, at: '2026-10-07T10:00:00.000Z', payload: {}, prevHash: '', hash: '', ...extra });

test('mission control events map onto the floor', () => {
  assert.equal(mapMissionEvent(me('mission.created', { payload: { title: 'Ship the fix' } }))[0].kind, 'arrive');
  assert.equal(mapMissionEvent(me('mission.created', { payload: { title: 'Ship the fix' } }))[0].text, 'Ship the fix');
  assert.equal(mapMissionEvent(me('executor.acknowledged', { payload: { executorId: 'exec-7' } }))[0].to, 'exec-7');
  assert.equal(mapMissionEvent(me('blocked', { payload: { reason: 'needs approval' } }))[0].kind, 'block');
  assert.equal(mapMissionEvent(me('resume.admitted'))[0].kind, 'unblock');
  assert.equal(mapMissionEvent(me('acceptance.passed'))[0].kind, 'done');
  assert.equal(mapMissionEvent(me('failure.verified'))[0].kind, 'fail');
  assert.equal(mapMissionEvent(me('cancel.settled'))[0].kind, 'fail');
  assert.deepEqual(mapMissionEvent(me('something.else')), []);
  assert.deepEqual(mapMissionEvent(me('blocked', { at: 'garbage' })), []);
  assert.deepEqual(mapMissionEvent(null), []);
});

test('parseMissionLog ignores a torn tail; readMissions walks only mission dirs', () => {
  const log = JSON.stringify(me('mission.created')) + '\n' + JSON.stringify(me('task.observed', { payload: { summary: 'running tests' } })) + '\n' + '{"contract":"ruflo.mission-ev';
  assert.equal(parseMissionLog(log).length, 2);
  const root = mkdtempSync(join(tmpdir(), 'binas-'));
  try {
    const good = join(root, '.claude-flow', 'missions', 'msn_0123456789abcdef01234567'); mkdirSync(good, { recursive: true }); writeFileSync(join(good, 'events.jsonl'), log);
    const bad = join(root, '.claude-flow', 'missions', 'not-a-mission'); mkdirSync(bad, { recursive: true }); writeFileSync(join(bad, 'events.jsonl'), log);
    const out = readMissions(root);
    assert.equal(out.length, 2);
    assert.equal(out[0].kind, 'arrive');
    assert.equal(out[1].text, 'running tests');
    assert.deepEqual(readMissions(join(root, 'nowhere')), []);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
