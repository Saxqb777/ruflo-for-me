// Neon over HTTP with no dependency: the same /sql endpoint the official serverless driver speaks.
// One table, binas_events, keyed by floor. Rows come back as text (Neon-Raw-Text-Output) and are typed here.
export const TABLE = 'binas_events';
export const COLUMNS = ['agent', 'role', 'name', 'paper', 'from', 'to', 'toRole', 'text', 'needs', 'source', 'file', 'lines'];
const COL_SQL = { agent: 'agent', role: 'role', name: 'name', paper: 'paper', from: '"from"', to: '"to"', toRole: 'to_role', text: 'text', needs: 'needs', source: 'source', file: 'file', lines: 'lines' };

export function neonClient(connectionString, fetchImpl = globalThis.fetch) {
  if (!connectionString) throw new Error('DATABASE_URL is not set');
  const u = new URL(connectionString);
  const endpoint = `https://${u.hostname}/sql`;
  return async function sql(query, params = []) {
    const r = await fetchImpl(endpoint, { method: 'POST', headers: { 'Neon-Connection-String': connectionString, 'Neon-Raw-Text-Output': 'true', 'Neon-Array-Mode': 'false', 'Content-Type': 'application/json' }, body: JSON.stringify({ query, params }) });
    if (!r.ok) { const t = await r.text().catch(() => ''); throw new Error(`neon ${r.status}: ${t.slice(0, 240)}`); }
    const j = await r.json(); return Array.isArray(j.rows) ? j.rows : [];
  };
}

export const SCHEMA_SQL = [
  `CREATE TABLE IF NOT EXISTS ${TABLE} (id bigserial PRIMARY KEY, floor text NOT NULL DEFAULT 'default', t bigint NOT NULL, kind text NOT NULL, agent text, role text, name text, paper text, "from" text, "to" text, to_role text, text text, needs text, source text, received_at timestamptz NOT NULL DEFAULT now())`,
  `CREATE INDEX IF NOT EXISTS ${TABLE}_floor_id ON ${TABLE} (floor, id)`,
  `ALTER TABLE ${TABLE} ADD COLUMN IF NOT EXISTS file text`,
  `ALTER TABLE ${TABLE} ADD COLUMN IF NOT EXISTS lines integer`,
];
const ensured = new Set();
export async function ensureSchema(sql, key = 'default') {
  if (ensured.has(key)) return;
  for (const q of SCHEMA_SQL) await sql(q);
  ensured.add(key);
}

/** Insert normalized events (see ../events.mjs). Returns the number inserted. */
export async function insertEvents(sql, floor, events) {
  if (!events.length) return 0;
  const cols = ['floor', 't', 'kind', ...COLUMNS.map((c) => COL_SQL[c])];
  const params = []; const tuples = [];
  for (const e of events.slice(0, 500)) {
    const vals = [floor, e.t, e.kind, ...COLUMNS.map((c) => (e[c] === undefined ? null : e[c]))];
    tuples.push('(' + vals.map((v) => { params.push(v); return '$' + params.length; }).join(',') + ')');
  }
  await sql(`INSERT INTO ${TABLE} (${cols.join(',')}) VALUES ${tuples.join(',')}`, params);
  return tuples.length;
}

/** Events after a cursor id, oldest first. Returns { events, cursor }. */
export async function listEvents(sql, floor, afterId = 0, limit = 2000) {
  const rows = await sql(`SELECT id, t, kind, ${COLUMNS.map((c) => COL_SQL[c] + (COL_SQL[c] === c ? '' : ' AS "' + c + '"')).join(', ')} FROM ${TABLE} WHERE floor = $1 AND id > $2 ORDER BY id ASC LIMIT $3`, [floor, Number(afterId) || 0, Math.min(5000, Math.max(1, Number(limit) || 2000))]);
  const events = rows.map((r) => { const e = { t: Number(r.t), kind: r.kind }; for (const c of COLUMNS) if (r[c] !== null && r[c] !== undefined) e[c] = c === 'lines' ? Number(r[c]) : r[c]; return e; });
  const cursor = rows.length ? Number(rows[rows.length - 1].id) : Number(afterId) || 0;
  return { events, cursor };
}

export async function countEvents(sql, floor) {
  const rows = await sql(`SELECT count(*) AS n FROM ${TABLE} WHERE floor = $1`, [floor]);
  return rows.length ? Number(rows[0].n) : 0;
}
