import test from 'node:test';
import assert from 'node:assert/strict';
import { neonClient, insertEvents, listEvents, SCHEMA_SQL } from '../src/cloud/neon.mjs';
import { keyOk, parseBody, floorOf, keyFrom } from '../src/cloud/http.mjs';
import events from '../api/events.mjs';
import ingest from '../api/ingest.mjs';
import info from '../api/info.mjs';

const CONN = 'postgresql://user:pw@ep-cool-123-pooler.eu-central-1.aws.neon.tech/neondb?sslmode=require';
const fakeFetch = (rows = [], status = 200) => { const calls = []; const f = async (url, init) => { calls.push({ url, init, body: JSON.parse(init.body) }); return { ok: status < 400, status, json: async () => ({ rows }), text: async () => 'boom' }; }; f.calls = calls; return f; };
const req = (method, url, headers = {}, body) => ({ method, url, headers, body });
const res = () => ({ statusCode: 0, headers: {}, setHeader(k, v) { this.headers[k] = v; }, end(b) { this.body = JSON.parse(b); } });
const withEnv = async (vars, fn) => { const prev = {}; for (const k in vars) { prev[k] = process.env[k]; if (vars[k] === undefined) delete process.env[k]; else process.env[k] = vars[k]; } try { return await fn(); } finally { for (const k in prev) { if (prev[k] === undefined) delete process.env[k]; else process.env[k] = prev[k]; } } };

test('neonClient posts to the host /sql endpoint with the connection string header', async () => {
  const f = fakeFetch([{ n: '3' }]); const sql = neonClient(CONN, f);
  const rows = await sql('SELECT 1', []);
  assert.deepEqual(rows, [{ n: '3' }]);
  assert.equal(f.calls[0].url, 'https://ep-cool-123-pooler.eu-central-1.aws.neon.tech/sql');
  assert.equal(f.calls[0].init.headers['Neon-Connection-String'], CONN);
  assert.equal(f.calls[0].body.query, 'SELECT 1');
  await assert.rejects(() => neonClient(CONN, fakeFetch([], 500))('SELECT 1'), /neon 500/);
  assert.throws(() => neonClient(''), /DATABASE_URL/);
  assert.ok(SCHEMA_SQL[0].includes('CREATE TABLE IF NOT EXISTS binas_events'));
});

test('insertEvents is one parameterized multi-row insert; listEvents types the text rows', async () => {
  const f = fakeFetch(); const sql = neonClient(CONN, f);
  const n = await insertEvents(sql, 'default', [{ t: 1, kind: 'join', agent: 'me', role: 'coordinator' }, { t: 2, kind: 'start', agent: 'me', text: 'hi', from: 'x', to: 'y' }]);
  assert.equal(n, 2);
  const q = f.calls[0].body;
  assert.ok(q.query.startsWith('INSERT INTO binas_events'));
  assert.equal((q.query.match(/\$\d+/g) || []).length, 26);
  assert.equal(q.params.length, 26);
  assert.equal(q.params[0], 'default'); assert.equal(q.params[1], 1); assert.equal(q.params[2], 'join');
  assert.ok(q.query.includes('"from"') && q.query.includes('"to"') && q.query.includes('to_role'));
  const f2 = fakeFetch([{ id: '7', t: '1791365400000', kind: 'start', agent: 'me', role: null, name: null, paper: null, from: null, to: null, toRole: null, text: 'x', needs: null, source: 'hooks' }]);
  const out = await listEvents(neonClient(CONN, f2), 'default', 5, 100);
  assert.deepEqual(out, { events: [{ t: 1791365400000, kind: 'start', agent: 'me', text: 'x', source: 'hooks' }], cursor: 7 });
  assert.deepEqual(f2.calls[0].body.params, ['default', 5, 100]);
});

test('key check is constant-time-equal and fails closed; bodies parse as object, array or JSON lines', () => {
  assert.equal(keyOk('abc', 'abc'), true);
  assert.equal(keyOk('abd', 'abc'), false);
  assert.equal(keyOk('', ''), false);
  assert.equal(keyOk('x', undefined), false);
  assert.equal(parseBody('{"a":1}').length, 1);
  assert.equal(parseBody('[{"a":1},{"b":2}]').length, 2);
  assert.equal(parseBody('{"a":1}\nnot json\n{"b":2}\n').length, 2);
  assert.equal(parseBody('').length, 0);
  assert.equal(floorOf({ floor: 'team-a_1' }), 'team-a_1');
  assert.equal(floorOf({ floor: '../x' }), 'default');
  assert.equal(keyFrom({ headers: { authorization: 'Bearer k1' } }), 'k1');
  assert.equal(keyFrom({ headers: { 'x-binas-key': 'k2' }, query: { key: 'k3' } }), 'k2');
});

test('events: 401 without the key, 503 without a database, 200 with both', async () => {
  await withEnv({ BINAS_KEY: 'secret', DATABASE_URL: undefined }, async () => {
    let r = res(); await events(req('GET', '/api/events', {}), r); assert.equal(r.statusCode, 401);
    r = res(); await events(req('GET', '/api/events', { 'x-binas-key': 'secret' }), r); assert.equal(r.statusCode, 503);
    r = res(); await events(req('POST', '/api/events', { 'x-binas-key': 'secret' }), r); assert.equal(r.statusCode, 405);
  });
  await withEnv({ BINAS_KEY: 'secret', DATABASE_URL: CONN }, async () => {
    const orig = globalThis.fetch; globalThis.fetch = fakeFetch([{ id: '1', t: '5', kind: 'join', agent: 'a', role: null, name: null, paper: null, from: null, to: null, toRole: null, text: null, needs: null, source: null }]);
    try { const r = res(); await events(req('GET', '/api/events?after=0&floor=default', { 'x-binas-key': 'secret' }), r); assert.equal(r.statusCode, 200); assert.equal(r.body.cursor, 1); assert.equal(r.body.events[0].kind, 'join'); }
    finally { globalThis.fetch = orig; }
  });
  await withEnv({ BINAS_KEY: undefined }, async () => { const r = res(); await events(req('GET', '/api/events', { 'x-binas-key': 'anything' }), r); assert.equal(r.statusCode, 401, 'no key configured means nobody gets in'); });
});

test('ingest: normalizes, refuses junk, inserts with a database', async () => {
  await withEnv({ BINAS_KEY: 'secret', DATABASE_URL: CONN }, async () => {
    let r = res(); await ingest(req('GET', '/api/ingest', { 'x-binas-key': 'secret' }), r); assert.equal(r.statusCode, 405);
    r = res(); await ingest(req('POST', '/api/ingest', {}, '{"t":1,"kind":"start"}'), r); assert.equal(r.statusCode, 401);
    r = res(); await ingest(req('POST', '/api/ingest', { 'x-binas-key': 'secret' }, '{"kind":"dance"}'), r); assert.equal(r.statusCode, 400);
    const orig = globalThis.fetch; const f = fakeFetch(); globalThis.fetch = f;
    try { r = res(); await ingest(req('POST', '/api/ingest', { 'x-binas-key': 'secret' }, [{ t: 1, kind: 'start', agent: 'me' }, { t: 2, kind: 'nope' }]), r); assert.equal(r.statusCode, 200); assert.deepEqual(r.body, { inserted: 1, skipped: 1 }); assert.ok(f.calls.some((c) => c.body.query.startsWith('INSERT'))); }
    finally { globalThis.fetch = orig; }
  });
});

test('info never leaks and reports configuration honestly', async () => {
  await withEnv({ BINAS_KEY: undefined, DATABASE_URL: undefined }, async () => {
    const r = res(); await info(req('GET', '/api/info', {}), r);
    assert.equal(r.statusCode, 200); assert.equal(r.body.keyConfigured, false); assert.equal(r.body.databaseConfigured, false); assert.equal(r.body.events, undefined);
    assert.ok(!JSON.stringify(r.body).includes('postgresql://'));
  });
});
