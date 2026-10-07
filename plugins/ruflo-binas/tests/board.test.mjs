import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createBoard, jobFromWork } from '../src/factory/board.mjs';
import { createRunner, childEnv } from '../src/factory/runner.mjs';
import { previewDeploy } from '../src/factory/preview.mjs';
import { shipJob } from '../src/factory/ship.mjs';
import { coordinatorPrompt, DESIGN_RULES } from '../src/factory/prompt.mjs';
import { readEvents } from '../src/log.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const FAKE = join(HERE, 'fixtures', 'fake-claude.mjs');
const tmp = () => mkdtempSync(join(tmpdir(), 'binas-board-'));
const PROJECT = { id: 'prj_x', floor: 't1', title: 'Tiny app', slug: 'tiny-app', brief: 'A tiny app.', kind: 'web', status: 'queued', repo: null, branch: 'main', sessionId: null, turns: 0, costUsd: 0 };

/** A fake cloud: /api/work serves a queue and records updates; /api/ingest records events per floor. */
function fakeCloud() {
  const cloud = { queue: [], updates: [], events: [], keys: [] };
  cloud.fetch = async (url, init = {}) => {
    const u = new URL(url); cloud.keys.push(init.headers['x-binas-key']);
    const body = init.body ? JSON.parse(init.body) : null;
    if (u.pathname === '/api/work' && init.method === 'GET') return { ok: true, status: 200, json: async () => ({ work: cloud.queue }) };
    if (u.pathname === '/api/work') { cloud.updates.push(body); return { ok: true, status: 200, json: async () => ({ turn: { id: body.turn } }) }; }
    if (u.pathname === '/api/ingest') { cloud.events.push(...body.map((e) => ({ ...e, floor: u.searchParams.get('floor') }))); return { ok: true, status: 200, json: async () => ({ inserted: body.length }) }; }
    return { ok: false, status: 404, json: async () => ({ error: 'nope' }) };
  };
  return cloud;
}

test('the board client: next pulls work with the key, update posts a turn patch, sendEvents never throws', async () => {
  const cloud = fakeCloud(); cloud.queue = [{ turn: { id: 1, n: 1, kind: 'request', text: 'x', budgetUsd: 2 }, project: PROJECT }];
  const board = createBoard({ url: 'https://binas.example/', key: 'k', fetchImpl: cloud.fetch });
  assert.equal(board.url, 'https://binas.example'); assert.equal(board.ingestUrl, 'https://binas.example/api/ingest');
  assert.equal((await board.next()).length, 1); assert.equal(cloud.keys[0], 'k');
  await board.update(1, { status: 'running' }); assert.deepEqual(cloud.updates[0], { turn: 1, status: 'running' });
  assert.equal(await board.sendEvents([{ t: 1, kind: 'join', agent: 'a' }], 't1'), true); assert.equal(cloud.events[0].floor, 't1');
  assert.equal(await createBoard({ url: 'https://down.example', key: 'k', fetchImpl: async () => { throw new Error('offline'); } }).sendEvents([{ t: 1, kind: 'join' }], 't1'), false);
  await assert.rejects(() => createBoard({ url: 'https://binas.example', key: 'k', fetchImpl: cloud.fetch }).update(1, {}), /nope/i).catch(() => {});
  assert.throws(() => createBoard({ url: '', key: '' }), /url and a key/);
});

test('jobFromWork: a request is a queued job under projects/<floor>/<slug>; an answer is an answered job that resumes', () => {
  const root = '/r';
  const j = jobFromWork({ turn: { id: 10, n: 1, kind: 'request', text: 'Build it.', budgetUsd: 2 }, project: PROJECT }, root);
  assert.equal(j.id, 'turn_10'); assert.equal(j.state, 'queued'); assert.equal(j.project.path, join(root, 'projects', 't1', 'tiny-app')); assert.equal(j.branch, 'main'); assert.equal(j.ship, 'branch'); assert.equal(j.cloud.followUp, false); assert.equal(j.budgetUsd, 2);
  const a = jobFromWork({ turn: { id: 11, n: 3, kind: 'answer', text: 'yes', budgetUsd: 2, note: 'Dark mode?' }, project: { ...PROJECT, sessionId: 'sess_1' } }, root);
  assert.equal(a.state, 'answered'); assert.deepEqual(a.answers[0].answer, 'yes'); assert.equal(a.answers[0].question, 'Dark mode?'); assert.equal(a.sessionId, 'sess_1');
  const f = jobFromWork({ turn: { id: 12, n: 5, kind: 'request', text: 'Make it blue.', budgetUsd: 2 }, project: { ...PROJECT, sessionId: 'sess_1', repo: 'https://github.com/o/r' } }, root);
  assert.equal(f.cloud.followUp, true); assert.equal(f.links.remote, 'https://github.com/o/r');
  assert.equal(jobFromWork({ turn: { id: 1, kind: 'request', text: 'x' }, project: { ...PROJECT, slug: '../evil', floor: '../x' } }, root).project.path, join(root, 'projects', 'x', 'evil'));
});

test('the session never sees host tokens; with a board it gets the ingest url and the key', () => {
  const job = { id: 'turn_1', title: 'T', cloud: { projectId: 'prj_x', floor: 't1', turnId: 1 } };
  const env = childEnv(job, { PATH: '/bin', ANTHROPIC_API_KEY: 'a', VERCEL_TOKEN: 'v', GH_TOKEN: 'g', DATABASE_URL: 'd', BINAS_SESSION_SECRET: 's' }, { root: '/r', floor: null, board: { ingestUrl: 'https://b/api/ingest', key: 'k' } });
  for (const k of ['ANTHROPIC_API_KEY', 'VERCEL_TOKEN', 'GH_TOKEN', 'DATABASE_URL', 'BINAS_SESSION_SECRET']) assert.equal(env[k], undefined, k);
  assert.equal(env.BINAS_JOB, 'prj_x'); assert.equal(env.BINAS_FLOOR, 't1'); assert.equal(env.BINAS_INGEST_URL, 'https://b/api/ingest'); assert.equal(env.BINAS_KEY, 'k'); assert.equal(env.PATH, '/bin');
});

test('the prompt has a designer stage and the banned list for web; a follow-up resumes with sizing; cli skips the screen', () => {
  const job = { title: 'T', brief: 'B', branch: 'main', kind: 'web', project: { kind: 'new' } };
  const p = coordinatorPrompt(job);
  for (const s of ['"designer"', '"design-review"', 'DESIGN.md', 'banned list', DESIGN_RULES[4].slice(0, 30), 'whatChanged', 'howToOpen', 'The bar']) assert.ok(p.includes(s), s);
  const f = coordinatorPrompt(job, { followUp: 'Make the header blue.' });
  assert.ok(f.includes('Make the header blue.') && f.includes('resuming the same project') && f.includes('Size the work'));
  const c = coordinatorPrompt({ ...job, kind: 'cli' }); assert.ok(c.includes('INTERFACE.md') && !c.includes('"design-review": run'));
});

test('a cloud turn runs end to end: pulled, asked, answered on the board, resumed, shipped, previewed, reported', async () => {
  const root = tmp(); const cloud = fakeCloud(); const log = [];
  try {
    const board = createBoard({ url: 'https://binas.example', key: 'master', fetchImpl: cloud.fetch });
    cloud.queue = [{ turn: { id: 10, n: 1, kind: 'request', text: 'A tiny app.', budgetUsd: 2, note: null }, project: PROJECT }];
    const runner = createRunner({ root, claude: { bin: process.execPath, prefixArgs: [FAKE] }, board, log: (l) => log.push(l), env: { PATH: process.env.PATH, ANTHROPIC_API_KEY: 'sk-x', VERCEL_TOKEN: 'v' }, preview: (job) => ({ url: 'https://tiny-app.vercel.app', notes: ['fake preview of ' + job.project.slug] }) });
    const first = await runner.tick();
    assert.equal(first.id, 'turn_10'); assert.equal(first.state, 'blocked'); assert.equal(first.cloud.projectId, 'prj_x');
    assert.ok(existsSync(join(root, 'projects', 't1', 'tiny-app', 'CLAUDE.md')));
    assert.deepEqual(cloud.updates.map((u) => u.status), ['running', 'progress', 'blocked']);
    assert.equal(cloud.updates[2].question.text, 'Dark mode by default?'); assert.equal(cloud.updates[2].sessionId, 'sess_fake_1'); assert.equal(cloud.updates[0].branch, 'main');
    cloud.queue = []; assert.equal(await runner.tick(), null, 'a blocked turn is not re-pulled');
    cloud.queue = [{ turn: { id: 11, n: 3, kind: 'answer', text: 'yes', budgetUsd: 2, note: 'Dark mode by default?' }, project: { ...PROJECT, sessionId: 'sess_fake_1', status: 'queued' } }];
    const second = await runner.tick();
    assert.equal(second.id, 'turn_11'); assert.equal(second.state, 'shipped'); assert.equal(second.links.preview, 'https://tiny-app.vercel.app'); assert.equal(second.links.branch, 'main');
    assert.ok(readFileSync(join(root, 'projects', 't1', 'tiny-app', 'built.txt'), 'utf8').includes('budget 2'));
    const done = cloud.updates.find((u) => u.status === 'done'); assert.equal(done.turn, 11); assert.equal(done.report.summary, 'A tiny app with dark mode by default.'); assert.equal(done.links.preview, 'https://tiny-app.vercel.app'); assert.equal(done.costUsd, 0.02);
    const kinds = readEvents(root).map((e) => e.kind);
    assert.deepEqual(kinds, ['join', 'arrive', 'start', 'block', 'join', 'unblock', 'start', 'done', 'ship']);
    assert.ok(readEvents(root).every((e) => e.agent === 'job.prj_x' || e.kind === 'arrive'), 'one peg per project across turns');
    assert.ok(cloud.events.length >= 9 && cloud.events.every((e) => e.floor === 't1'), 'every floor event reaches the cloud floor');
    assert.equal(readEvents(root).find((e) => e.kind === 'ship').text, 'https://tiny-app.vercel.app');
    assert.ok(log.some((l) => /pulled from the cloud board/.test(l)) && log.some((l) => /fake preview of tiny-app/.test(l)));
    cloud.queue = [{ turn: { id: 11, n: 3, kind: 'answer', text: 'yes', budgetUsd: 2 }, project: PROJECT }]; assert.equal(await runner.tick(), null, 'a turn already on file is skipped');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('preview and ship are honest without tokens and parse the URL with them; a new repo is created when the owner is set', () => {
  const okExec = (cmd, args) => ({ ok: true, out: cmd === 'npx' ? 'Production: https://tiny-app-abc.vercel.app [1s]' : cmd === 'git' && args[0] === 'remote' ? 'git@github.com:sax/t1-tiny-app.git' : cmd === 'git' && args[0] === 'rev-parse' ? 'abc123' : '', err: '', status: 0 });
  const root = tmp();
  try {
    const job = { title: 'T', kind: 'web', workdir: root, branch: 'main', ship: 'branch', project: { slug: 'tiny-app' }, cloud: { floor: 't1' } };
    assert.equal(previewDeploy(job, { exec: okExec, env: {} }).url, null);
    assert.equal(previewDeploy({ ...job, kind: 'cli' }, { exec: okExec, env: { VERCEL_TOKEN: 'v' } }).notes[0], 'no screen, no preview');
    assert.match(previewDeploy(job, { exec: okExec, env: { VERCEL_TOKEN: 'v' } }).notes[0], /nothing deployable/);
    writeFileSync(join(root, 'index.html'), '<!doctype html>');
    const pv = previewDeploy(job, { exec: okExec, env: { VERCEL_TOKEN: 'v' } }); assert.equal(pv.url, 'https://tiny-app-abc.vercel.app');
    assert.match(previewDeploy(job, { exec: () => ({ ok: false, out: '', err: 'Error: not logged in', status: 1 }), env: { VERCEL_TOKEN: 'v' } }).notes[0], /preview deploy failed/);
    let remoteKnown = false; const calls = [];
    const exec = (cmd, args) => { calls.push(cmd + ' ' + args.join(' ')); if (cmd === 'git' && args[0] === 'remote') return remoteKnown ? okExec(cmd, args) : { ok: false, out: '', err: 'no such remote', status: 2 }; if (cmd === 'gh' && args[1] === 'create') { remoteKnown = true; return { ok: true, out: 'https://github.com/sax/t1-tiny-app', err: '', status: 0 }; } return okExec(cmd, args); };
    const s = shipJob(job, { exec, env: { BINAS_GITHUB_OWNER: 'sax' } });
    assert.equal(s.mode, 'branch'); assert.equal(s.links.remote, 'https://github.com/sax/t1-tiny-app'); assert.ok(calls.some((c) => c.startsWith('gh repo create sax/t1-tiny-app --private')));
    assert.ok(s.notes.includes('pushed main'));
    const noOwner = shipJob(job, { exec: (cmd, args) => (cmd === 'git' && args[0] === 'remote' ? { ok: false, out: '', err: '', status: 2 } : okExec(cmd, args)), env: {} });
    assert.ok(noOwner.notes.some((n) => /no git remote/.test(n)));
  } finally { rmSync(root, { recursive: true, force: true }); }
});
