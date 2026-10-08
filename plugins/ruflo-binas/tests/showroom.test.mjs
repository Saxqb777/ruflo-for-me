import test from 'node:test';
import assert from 'node:assert/strict';
import { sizeTurn, allowanceCheck, login, projects, turns, approvals, floors, work } from '../src/cloud/showroom.mjs';
import { hashPassword, signSession, passwordVersion } from '../src/cloud/auth.mjs';
import { serve } from '../src/cloud/serve.mjs';
import { monthStart, userInsertSql, SHOWROOM_SCHEMA } from '../src/cloud/store.mjs';

/** A scripted database: answers each query with the next canned row set and records every call. */
const scripted = (responses = []) => { const calls = []; const sql = async (query, params = []) => { calls.push({ query, params }); return responses.length ? responses.shift() : []; }; sql.calls = calls; return sql; };
const verbs = (sql) => sql.calls.map((c) => c.query.trim().replace(/\s+/g, ' ').slice(0, 26));
const HASH = hashPassword('tester-pass-1');
const OWNER = { id: '1', username: 'sax', display: 'Sax', role: 'owner', floor: 'main', allowance_usd: null, pass_hash: HASH };
const TESTER = { id: '2', username: 'tee', display: 'Tee', role: 'tester', floor: 'tee', allowance_usd: '25', pass_hash: HASH };
const ENV = { BINAS_SESSION_SECRET: 'x'.repeat(32) };
const NOW = Date.UTC(2026, 9, 7, 12);
const ctx = (o) => ({ method: 'GET', query: {}, body: {}, user: null, env: ENV, now: NOW, ...o });
const prow = (o = {}) => ({ id: 'prj_1', floor: 'tee', title: 'T', slug: 't', brief: 'b', kind: 'web', status: 'queued', repo: null, branch: 'main', session_id: null, preview_url: null, design: null, turns: '0', cost_usd: '0', created_at: '1', updated_at: '1', ...o });
const trow = (o = {}) => ({ id: '10', project_id: 'prj_1', floor: 'tee', n: '1', author: 'tee', kind: 'request', text: 'build it please now ok', options: null, size: 'full', budget_usd: '8', status: 'queued', session_id: null, cost_usd: null, links: null, note: null, created_at: '1', updated_at: '1', ...o });

test('sizeTurn: first turn is the full pipeline; small asks are small; big words or long text go full; caps are bounded', () => {
  assert.deepEqual(sizeTurn('anything', { first: true }), { size: 'full', budgetUsd: 8 });
  assert.deepEqual(sizeTurn('make the header blue'), { size: 'small', budgetUsd: 2 });
  assert.deepEqual(sizeTurn('add a login page with email'), { size: 'full', budgetUsd: 6 });
  assert.equal(sizeTurn('x'.repeat(601)).size, 'full');
  assert.deepEqual(sizeTurn('anything', { first: true, owner: true }), { size: 'full', budgetUsd: 20 }); assert.equal(sizeTurn('make the header blue', { owner: true }).budgetUsd, 3); assert.equal(sizeTurn('add a login page', { owner: true }).budgetUsd, 12);
  assert.equal(sizeTurn('tiny', { requested: 500 }).budgetUsd, 50); assert.equal(sizeTurn('tiny', { requested: 500, owner: true }).budgetUsd, 200); assert.equal(sizeTurn('tiny', { requested: 0.1 }).budgetUsd, 0.5);
  assert.ok(monthStart(NOW) === Date.UTC(2026, 9, 1));
  assert.ok(userInsertSql({ username: "o'x", floor: 'f', passHash: 'h' }).includes("'o''x'"));
  assert.equal(SHOWROOM_SCHEMA.filter((q) => q.startsWith('CREATE TABLE')).length, 3);
});

test('allowance: the owner and users without one always pass; a tester is held to the month', async () => {
  assert.equal((await allowanceCheck(scripted(), OWNER, 100, NOW)).ok, true);
  const sql = scripted([[{ used: '20' }]]);
  assert.deepEqual(await allowanceCheck(sql, TESTER, 6, NOW), { ok: false, usedUsd: 20, allowanceUsd: 25 });
  assert.deepEqual(sql.calls[0].params, ['tee', monthStart(NOW)]);
  assert.equal((await allowanceCheck(scripted([[{ used: '20' }]]), TESTER, 5, NOW)).ok, true);
});

test('login: who am I, sign in with a real hash, wrong password refused, change password re-signs the cookie', async () => {
  assert.equal((await login(ctx({}))).status, 401);
  assert.deepEqual((await login(ctx({ user: TESTER }))).body.user.username, 'tee');
  assert.equal((await login(ctx({ method: 'POST', env: {}, body: { username: 'tee', password: 'tester-pass-1' } }))).status, 503);
  assert.equal((await login(ctx({ method: 'POST', body: { username: '!', password: 'x' } }))).status, 400);
  assert.equal((await login(ctx({ method: 'POST', sql: scripted([[TESTER]]), body: { username: 'tee', password: 'nope-nope-nope' } }))).status, 401);
  assert.equal((await login(ctx({ method: 'POST', sql: scripted([[]]), body: { username: 'ghost', password: 'nope-nope-nope' } }))).status, 401);
  const ok = await login(ctx({ method: 'POST', sql: scripted([[TESTER]]), body: { username: 'TEE', password: 'tester-pass-1' } }));
  assert.equal(ok.status, 200); assert.equal(ok.body.user.floor, 'tee'); assert.ok(ok.headers['set-cookie'].startsWith('binas_session=')); assert.ok(!JSON.stringify(ok.body).includes('scrypt'));
  assert.ok((await login(ctx({ method: 'DELETE' }))).headers['set-cookie'].includes('Max-Age=0'));
  const sql = scripted([]);
  const ch = await login(ctx({ method: 'POST', user: TESTER, sql, body: { password: 'tester-pass-1', newPassword: 'brand-new-pass-2' } }));
  assert.equal(ch.status, 200); assert.ok(sql.calls[0].query.startsWith('UPDATE binas_users SET pass_hash')); assert.ok(sql.calls[0].params[1].startsWith('scrypt$'));
  assert.equal((await login(ctx({ method: 'POST', user: TESTER, sql: scripted(), body: { password: 'wrong-wrong-1', newPassword: 'brand-new-pass-2' } }))).status, 401);
  assert.equal((await login(ctx({ method: 'POST', user: TESTER, sql: scripted(), body: { password: 'tester-pass-1', newPassword: 'short' } }))).status, 400);
});

test('projects: a tester sees one floor, the owner every floor; opening one queues the first turn or parks it in the tray', async () => {
  let sql = scripted([[prow()], [trow()]]);
  const mine = await projects(ctx({ user: TESTER, sql })); assert.equal(mine.status, 200); assert.equal(mine.body.projects[0].latest.kind, 'request'); assert.deepEqual(sql.calls[0].params.slice(0, 1), ['tee']);
  sql = scripted([[]]); await projects(ctx({ user: OWNER, sql })); assert.ok(!sql.calls[0].query.includes('floor IN'), 'owner lists every floor');
  sql = scripted([[]]); await projects(ctx({ user: OWNER, sql, query: { floor: 'tee' } })); assert.deepEqual(sql.calls[0].params[0], 'tee');
  assert.equal((await projects(ctx({ method: 'POST', user: TESTER, sql: scripted(), body: { title: '', brief: 'x'.repeat(30) } }))).status, 400);
  assert.equal((await projects(ctx({ method: 'POST', user: TESTER, sql: scripted(), body: { title: 'T', brief: 'short' } }))).status, 400);
  sql = scripted([[{ used: '3' }], [], [{ id: '10' }], [prow()], [trow()]]);
  const opened = await projects(ctx({ method: 'POST', user: TESTER, sql, body: { title: 'Tiny app', brief: 'A tiny app for people who like tiny apps.', kind: 'web' } }));
  assert.equal(opened.status, 201); assert.equal(opened.body.approval, false); assert.equal(opened.body.project.title, 'T');
  assert.ok(verbs(sql)[0].startsWith('SELECT coalesce(sum') && verbs(sql)[1].startsWith('INSERT INTO binas_projects') && verbs(sql)[2].startsWith('INSERT INTO binas_turns'));
  assert.equal(sql.calls[1].params[6], 'queued'); assert.equal(sql.calls[1].params[3], 'tiny-app'); assert.equal(sql.calls[2].params[8], 8, 'first turn cap');
  sql = scripted([[{ used: '20' }], [], [{ id: '10' }], [{ id: '11' }], [prow({ status: 'approval' })], [trow({ status: 'approval' })]]);
  const parked = await projects(ctx({ method: 'POST', user: TESTER, sql, body: { title: 'Big', brief: 'A big thing that costs more than what is left.' } }));
  assert.equal(parked.status, 201); assert.equal(parked.body.approval, true); assert.equal(sql.calls[1].params[6], 'approval');
  assert.equal(sql.calls.filter((c) => c.query.startsWith('INSERT INTO binas_turns')).length, 2, 'the request and a note');
  assert.ok(sql.calls[3].params[5].includes("owner's tray"));
  sql = scripted([[], [{ id: '1' }], [prow()], [trow()]]);
  await projects(ctx({ method: 'POST', user: OWNER, sql, body: { title: 'O', brief: 'The owner opens one without an allowance check.' } }));
  assert.ok(!sql.calls[0].query.includes('coalesce(sum'), 'no allowance query for the owner');
});

test('closing a project withdraws its queued work and hides it from the list; nothing is deleted', async () => {
  let sql = scripted([[prow({ status: 'queued' })], [trow({ status: 'queued' })], [], [{ id: '2' }], [], [], [prow({ status: 'closed' })]]);
  const r = await projects(ctx({ method: 'DELETE', user: TESTER, sql, query: { project: 'prj_1' } }));
  assert.equal(r.status, 200); assert.equal(r.body.project.status, 'closed');
  assert.equal(sql.calls[2].params[1], 'rejected'); assert.equal(sql.calls[3].params[5], 'Project closed.'); assert.equal(sql.calls[4].params[1], 'closed');
  const flag = sql.calls[5]; assert.ok(flag.query.startsWith('INSERT INTO binas_events'), 'the floor is told'); assert.deepEqual([flag.params[2], flag.params[3], flag.params[15], flag.params[16]], ['unblock', 'job.prj_1', 'leave', 'job.prj_1']); assert.equal(flag.params[0], 'tee');
  assert.ok(sql.calls.every((c) => !/^DELETE/i.test(c.query)));
  assert.equal((await projects(ctx({ method: 'DELETE', user: TESTER, sql: scripted([[prow({ status: 'running' })]]), query: { project: 'prj_1' } }))).status, 409);
  sql = scripted([[prow({ status: 'running' })], [trow({ status: 'running' })], [], [{ id: '3' }], [], [], [prow({ status: 'closed' })]]);
  assert.equal((await projects(ctx({ method: 'DELETE', user: OWNER, sql, query: { project: 'prj_1' } }))).status, 200, 'the owner can close a stuck project'); assert.equal(sql.calls[2].params[1], 'failed');
  assert.equal((await projects(ctx({ method: 'DELETE', user: TESTER, sql: scripted([[prow({ floor: 'main' })]]), query: { project: 'prj_1' } }))).status, 404);
  sql = scripted([[]]); await projects(ctx({ user: TESTER, sql })); assert.ok(sql.calls[0].query.includes("status <> 'closed'"));
  sql = scripted([[]]); await projects(ctx({ user: TESTER, sql, query: { all: '1' } })); assert.ok(!sql.calls[0].query.includes("status <> 'closed'"));
});

test('turns: visibility by floor, one open turn per project, an answer closes the open ask', async () => {
  assert.equal((await turns(ctx({ user: TESTER, sql: scripted([[prow({ floor: 'main' })]]), query: { project: 'prj_1' } }))).status, 404);
  assert.equal((await turns(ctx({ user: OWNER, sql: scripted([[prow({ floor: 'main' })], [trow()]]), query: { project: 'prj_1' } }))).status, 200);
  assert.equal((await turns(ctx({ method: 'POST', user: TESTER, sql: scripted([[prow()]]), body: { project: 'prj_1', text: '' } }))).status, 400);
  const busy = await turns(ctx({ method: 'POST', user: TESTER, sql: scripted([[prow({ status: 'running' })], [trow({ status: 'running' })], [trow({ status: 'running' })]]), body: { project: 'prj_1', text: 'and also this' } }));
  assert.equal(busy.status, 409); assert.match(busy.body.error, /turn 1/);
  let sql = scripted([[prow({ status: 'blocked' })], [trow({ id: '12', n: '2', kind: 'ask', author: 'binas', status: 'open', text: 'Dark mode?', options: '["yes","no"]' })], [trow({ status: 'blocked' })], [{ used: '3' }], [], [], [{ id: '13' }], [], [trow({ id: '13', n: '3', kind: 'answer', text: 'yes', status: 'queued' })]]);
  const ans = await turns(ctx({ method: 'POST', user: TESTER, sql, body: { project: 'prj_1', text: 'yes' } }));
  assert.equal(ans.status, 201); assert.equal(ans.body.turn.kind, 'answer');
  const v = verbs(sql); assert.equal(v.filter((x) => x.startsWith('UPDATE binas_turns')).length, 2, 'the ask and the blocked turn close');
  const ins = sql.calls.find((c) => c.query.startsWith('INSERT INTO binas_turns')); assert.equal(ins.params[4], 'answer'); assert.equal(ins.params[13], 'Dark mode?', 'the question rides along as the note');
  assert.equal(sql.calls[sql.calls.length - 2].params[1], 'queued', 'project status follows the turn');
  sql = scripted([[prow({ status: 'idle' })], [trow({ kind: 'report', author: 'binas', status: 'done' })], [], [{ used: '0' }], [{ id: '14' }], [], [trow({ id: '14', n: '2' })]]);
  const next = await turns(ctx({ method: 'POST', user: TESTER, sql, body: { project: 'prj_1', text: 'make the header blue' } }));
  assert.equal(next.status, 201); assert.equal(sql.calls[4].params[7], 'small'); assert.equal(sql.calls[4].params[8], 2);
});

test('approvals: owner only; approve queues the turn, reject parks the project', async () => {
  assert.equal((await approvals(ctx({ user: TESTER }))).status, 403);
  const list = await approvals(ctx({ user: OWNER, sql: scripted([[{ ...trow({ status: 'approval' }), p_title: 'T', u_name: 'tee', u_display: 'Tee', u_allowance: '25' }]]) }));
  assert.equal(list.body.approvals[0].user.display, 'Tee'); assert.equal(list.body.approvals[0].projectTitle, 'T');
  let sql = scripted([[trow({ status: 'approval' })], [prow({ status: 'approval' })], [], [], [], [trow({ status: 'queued' })]]);
  const ok = await approvals(ctx({ method: 'POST', user: OWNER, sql, body: { turn: 10, decision: 'approve', budgetUsd: 12 } }));
  assert.equal(ok.status, 200); assert.equal(sql.calls[2].params[1], 'queued'); assert.equal(sql.calls[2].params[2], 12); assert.ok(sql.calls[3].params[5].includes('approved turn 1')); assert.equal(sql.calls[4].params[1], 'queued');
  sql = scripted([[trow({ status: 'approval' })], [prow({ status: 'approval' })], [], [], [], [trow({ status: 'rejected' })]]);
  const no = await approvals(ctx({ method: 'POST', user: OWNER, sql, body: { turn: 10, decision: 'reject', note: 'too big for now' } }));
  assert.equal(no.status, 200); assert.equal(sql.calls[2].params[1], 'rejected'); assert.ok(sql.calls[3].params[5].includes('too big for now')); assert.equal(sql.calls[4].params[1], 'idle');
  assert.equal((await approvals(ctx({ method: 'POST', user: OWNER, sql: scripted([[trow({ status: 'queued' })]]), body: { turn: 10, decision: 'approve' } }))).status, 404);
  assert.equal((await approvals(ctx({ method: 'POST', user: OWNER, sql: scripted([[trow({ status: 'approval' })], [prow()]]), body: { turn: 10, decision: 'maybe' } }))).status, 400);
});

test('floors: the owner sees the building, a tester only their own floor', async () => {
  let sql = scripted([[{ id: '1', username: 'sax', display: 'Sax', role: 'owner', floor: 'main', allowance_usd: null, projects: '2', active: '1', approvals: '0', snags: '1', last_event: '5', used: '1.5' }]]);
  const all = await floors(ctx({ user: OWNER, sql })); assert.equal(all.body.floors[0].usedUsd, 1.5); assert.equal(all.body.floors[0].snags, 1); assert.equal(all.body.floors[0].allowanceUsd, null); assert.ok(!sql.calls[0].query.includes('WHERE u.floor'));
  sql = scripted([[]]); await floors(ctx({ user: TESTER, sql })); assert.ok(sql.calls[0].query.includes('WHERE u.floor IN')); assert.equal(sql.calls[0].params[1], 'tee'); assert.ok(sql.calls[0].query.includes("p.status <> 'closed') AS projects"), 'closed projects are not counted');
});

test('work: the workshop pulls queued turns with their projects and reports each state back', async () => {
  const joined = { ...trow(), p_title: 'T', p_slug: 't', p_brief: 'b', p_kind: 'web', p_status: 'queued', p_repo: null, p_branch: 'main', p_session_id: 'sess', p_preview_url: null, p_turns: '1', p_cost_usd: '0.5', p_created_at: '1', p_updated_at: '1' };
  let sql = scripted([[joined]]);
  const next = await work(ctx({ sql, query: { floor: 'all' } })); assert.equal(next.body.work[0].project.title, 'T'); assert.equal(next.body.work[0].project.sessionId, 'sess'); assert.equal(next.body.work[0].turn.budgetUsd, 8); assert.ok(!sql.calls[0].query.includes('t.floor IN'));
  sql = scripted([[]]); await work(ctx({ sql, query: { floor: 'tee' } })); assert.ok(sql.calls[0].query.includes('t.floor IN')); assert.equal(sql.calls[0].params[0], 'tee');
  assert.equal((await work(ctx({ method: 'POST', sql: scripted([[]]), body: { turn: 99, status: 'running' } }))).status, 404);
  assert.equal((await work(ctx({ method: 'POST', sql: scripted([[trow()], [prow()]]), body: { turn: 10, status: 'dancing' } }))).status, 400);
  sql = scripted([[trow()], [prow()], [], [], [trow({ status: 'running' })], [prow({ status: 'running' })]]);
  assert.equal((await work(ctx({ method: 'POST', sql, body: { turn: 10, status: 'running', sessionId: 's1', branch: 'main' } }))).status, 200);
  assert.equal(sql.calls[2].params[1], 'running'); assert.equal(sql.calls[2].params[2], 's1'); assert.ok(sql.calls[3].query.includes('session_id'));
  sql = scripted([[trow({ status: 'running' })], [prow({ status: 'running' })], [], [{ id: '11' }], [], [trow({ status: 'blocked' })], [prow({ status: 'blocked' })]]);
  await work(ctx({ method: 'POST', sql, body: { turn: 10, status: 'blocked', question: { text: 'Dark mode?', options: ['yes', 'no'], context: 'palette' } } }));
  const ask = sql.calls[3]; assert.equal(ask.params[4], 'ask'); assert.equal(ask.params[5], 'Dark mode?'); assert.equal(ask.params[6], '["yes","no"]'); assert.equal(ask.params[9], 'open'); assert.equal(ask.params[12], '{"recommended":false}'); assert.equal(sql.calls[4].params[1], 'blocked');
  sql = scripted([[trow({ status: 'running' })], [prow({ status: 'running' })], [], [{ id: '12' }], [], [trow({ status: 'done' })], [prow({ status: 'idle' })]]);
  const done = await work(ctx({ method: 'POST', sql, body: { turn: 10, status: 'done', costUsd: 0.1234567, sessionId: 's1', report: { summary: 'Built.', whatChanged: ['a', 'b'], howToOpen: 'open index.html', next: ['c'] }, links: { preview: 'https://p.vercel.app', remote: 'https://github.com/x/y' } } }));
  assert.equal(done.status, 200); assert.equal(sql.calls[2].params[3], 0.1235); const rep = sql.calls[3]; assert.equal(rep.params[4], 'report'); assert.equal(rep.params[5], 'Built.'); assert.equal(rep.params[6], '["a","b"]'); assert.ok(rep.params[13].includes('Open: open index.html') && rep.params[13].includes('Next: c'));
  assert.ok(sql.calls[4].query.includes('turns = turns + 1') && sql.calls[4].query.includes('cost_usd = cost_usd +')); assert.ok(sql.calls[4].params.includes('https://p.vercel.app'));
  sql = scripted([[trow({ status: 'running' })], [prow({ status: 'running' })], [], [{ id: '13' }], [], [trow({ status: 'failed' })], [prow({ status: 'failed' })]]);
  await work(ctx({ method: 'POST', sql, body: { turn: 10, status: 'failed', error: 'exit 3', plain: 'The floor was interrupted.' } })); assert.equal(sql.calls[3].params[5], 'The floor was interrupted.'); assert.ok(sql.calls[3].params[13].includes('detail: exit 3')); assert.equal(sql.calls[4].params[1], 'failed');
  sql = scripted([[trow({ status: 'running' })], [prow({ status: 'running' })], [], [{ id: '13' }], [], [trow({ status: 'failed' })], [prow({ status: 'failed' })]]);
  await work(ctx({ method: 'POST', sql, body: { turn: 10, status: 'failed', error: 'exit 3' } })); assert.ok(sql.calls[3].params[5].includes('hit a snag'), 'no plain line given: the default one');
  sql = scripted([[trow({ status: 'running' })], [prow({ status: 'running' })], [], [trow()], [prow()]]);
  await work(ctx({ method: 'POST', sql, body: { turn: 10, status: 'progress', progress: 'reading the brief' } })); assert.ok(sql.calls[2].query.startsWith('UPDATE binas_turns SET note'));
});

test('serve: 503 without a database, 401 without the key or a session, the user rides into the handler', async () => {
  const res = () => ({ statusCode: 0, headers: {}, setHeader(k, v) { this.headers[k] = v; }, end(b) { this.body = JSON.parse(b); } });
  const req = (headers = {}, method = 'GET') => ({ method, url: '/api/x', headers, body: method === 'GET' ? undefined : '{}' });
  const CONN = 'postgresql://u:p@ep-x-pooler.us-east-1.aws.neon.tech/binas?sslmode=require';
  let r = res(); await serve(req(), r, async () => ({ status: 200, body: {} }), { env: {} }); assert.equal(r.statusCode, 503);
  r = res(); await serve(req(), r, async () => ({ status: 200, body: {} }), { auth: 'key', env: { BINAS_KEY: 'm', DATABASE_URL: CONN } }); assert.equal(r.statusCode, 401);
  const rows = []; const orig = globalThis.fetch;
  globalThis.fetch = async (url, init) => { const q = JSON.parse(init.body).query; return { ok: true, status: 200, json: async () => ({ rows: /^CREATE/.test(q) ? [] : (rows.shift() || []) }) }; };
  try {
    r = res(); await serve(req(), r, async () => ({ status: 200, body: {} }), { env: { DATABASE_URL: CONN, ...ENV } }); assert.equal(r.statusCode, 401, 'no cookie');
    const tok = signSession({ uid: 2, pv: passwordVersion(HASH) }, ENV.BINAS_SESSION_SECRET); rows.push([TESTER]);
    r = res(); let seen = null; await serve(req({ cookie: 'binas_session=' + tok }), r, async (c) => { seen = c.user; return { status: 200, body: { hi: c.user.username }, headers: { 'x-t': '1' } }; }, { env: { DATABASE_URL: CONN, ...ENV } });
    assert.equal(r.statusCode, 200); assert.equal(r.body.hi, 'tee'); assert.equal(r.headers['x-t'], '1'); assert.equal(seen.floor, 'tee');
    rows.push([{ ...TESTER, pass_hash: hashPassword('changed-pass-9') }]);
    r = res(); await serve(req({ cookie: 'binas_session=' + tok }), r, async () => ({ status: 200, body: {} }), { env: { DATABASE_URL: CONN, ...ENV } }); assert.equal(r.statusCode, 401, 'a changed password ends the session');
    r = res(); await serve(req({ 'x-binas-key': 'm' }, 'POST'), r, async (c) => ({ status: 200, body: { m: c.method, u: c.user } }), { auth: 'key', env: { BINAS_KEY: 'm', DATABASE_URL: CONN } }); assert.equal(r.body.m, 'POST'); assert.equal(r.body.u, null);
  } finally { globalThis.fetch = orig; }
});
