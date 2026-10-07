import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { appendEvent, readEvents, followEvents, logPath } from '../src/log.mjs';
import { startServer, PLUGIN_ROOT } from '../src/server.mjs';

const tmp = () => mkdtempSync(join(tmpdir(), 'binas-'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test('appendEvent writes normalized lines that readEvents reads back; bad events are refused', () => {
  const root = tmp();
  try {
    assert.equal(appendEvent(root, { t: 1791365400000, kind: 'start', agent: 'me', text: 'hi' }), true);
    assert.equal(appendEvent(root, { kind: 'start' }), false);
    assert.equal(appendEvent(root, { t: 1791365401000, kind: 'completed', agent: 'me' }), true);
    const out = readEvents(root);
    assert.deepEqual(out.map((e) => e.kind), ['start', 'done']);
    assert.ok(existsSync(logPath(root)));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('followEvents sees lines appended after it started', async () => {
  const root = tmp();
  try {
    appendEvent(root, { t: 1, kind: 'join', agent: 'a' });
    const got = []; const stop = followEvents(root, (e) => got.push(e), { intervalMs: 50 });
    await sleep(80);
    appendEvent(root, { t: 2, kind: 'start', agent: 'a', text: 'x' });
    for (let i = 0; i < 40 && !got.length; i++) await sleep(50);
    stop();
    assert.equal(got.length, 1);
    assert.equal(got[0].kind, 'start');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('the hook entry appends events from a hook payload on stdin and never fails', () => {
  const root = tmp();
  try {
    const payload = JSON.stringify({ session_id: 'test-session-1', hook_event_name: 'UserPromptSubmit', prompt: 'hello floor', cwd: root });
    const r = spawnSync(process.execPath, [join(PLUGIN_ROOT, 'scripts', 'hook.mjs')], { input: payload, env: { ...process.env, CLAUDE_PROJECT_DIR: root }, encoding: 'utf8', timeout: 10000 });
    assert.equal(r.status, 0);
    assert.equal(r.stdout, '');
    const evs = readEvents(root);
    assert.deepEqual(evs.map((e) => e.kind), ['join', 'arrive', 'start']);
    assert.ok(existsSync(join(root, '.claude-flow', 'binas', 'state-testsession1.json')));
    const r2 = spawnSync(process.execPath, [join(PLUGIN_ROOT, 'scripts', 'hook.mjs')], { input: 'not json at all', env: { ...process.env, CLAUDE_PROJECT_DIR: root }, encoding: 'utf8', timeout: 10000 });
    assert.equal(r2.status, 0);
    assert.equal(r2.stdout, '');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('the server serves the page, the web files, the demo, info and an SSE backlog', async () => {
  const root = tmp();
  appendEvent(root, { t: 1791365400000, kind: 'start', agent: 'me', text: 'hi' });
  const s = await startServer({ root, port: 0 });
  try {
    const get = async (p) => { const r = await fetch(s.url.replace(/\/$/, '') + p); return { status: r.status, type: r.headers.get('content-type') || '', text: await r.text() }; };
    const home = await get('/'); assert.equal(home.status, 200); assert.ok(home.text.includes('BINAS'));
    const eng = await get('/web/engine.js'); assert.equal(eng.status, 200); assert.ok(eng.type.includes('javascript'));
    const demo = await get('/demo/shift-014.jsonl'); assert.equal(demo.status, 200); assert.ok(demo.text.split('\n').length > 60);
    assert.equal((await get('/web/../package.json')).status, 404);
    const info = JSON.parse((await get('/api/info')).text); assert.equal(info.events, 1); assert.equal(info.contract, 'binas.event/0.1');
    const post = async (p, body) => { const r = await fetch(s.url.replace(/\/$/, '') + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }); return { status: r.status, body: await r.json() }; };
    const bad = await post('/api/jobs', { title: 'x' }); assert.equal(bad.status, 400); assert.match(bad.body.error, /brief/);
    const made = await post('/api/jobs', { title: 'Board test', brief: 'Build a thing.', ship: 'branch' }); assert.equal(made.status, 201); assert.equal(made.body.state, 'queued'); assert.equal(made.body.ship, 'branch');
    const listed = JSON.parse((await get('/api/jobs')).text); assert.equal(listed.jobs.length, 1); assert.equal(listed.jobs[0].id, made.body.id);
    assert.equal((await get('/api/jobs/' + made.body.id)).status, 200); assert.equal((await get('/api/jobs/nope')).status, 404);
    const ans = await post('/api/answer', { jobId: made.body.id, text: 'yes' }); assert.equal(ans.status, 400); assert.match(ans.body.error, /not waiting/);
    const ctrl = new AbortController();
    const res = await fetch(s.url + 'events', { signal: ctrl.signal });
    const reader = res.body.getReader(); const { value } = await reader.read(); ctrl.abort();
    const chunk = new TextDecoder().decode(value);
    assert.ok(chunk.startsWith('event: backlog'));
    assert.ok(chunk.includes('"kind":"start"'));
  } finally { await s.close(); rmSync(root, { recursive: true, force: true }); }
});

test('the demo file on disk matches what the generator produces', () => {
  const r = spawnSync(process.execPath, ['-e', 'import("./scripts/make-demo-shift.mjs").then(m=>{process.stdout.write(JSON.stringify(m.buildDemo().map(e=>[e.t,e.kind,e.agent||"",e.paper||""])))})'], { cwd: PLUGIN_ROOT, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const generated = JSON.parse(r.stdout);
  const onDisk = readFileSync(join(PLUGIN_ROOT, 'demo', 'shift-014.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => { const e = JSON.parse(l); return [Date.parse(e.t), e.kind, e.agent || '', e.paper || '']; });
  assert.deepEqual(onDisk, generated);
});
