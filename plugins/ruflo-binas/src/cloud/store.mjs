// The showroom's tables on Neon: users (one floor each), projects (one conversation each), turns (the messages).
// Every function takes the `sql` from neon.mjs. Rows come back as text and are typed here, never in handlers.
export const T_USERS = 'binas_users', T_PROJECTS = 'binas_projects', T_TURNS = 'binas_turns';
export const WORK_KINDS = ['request', 'answer'];
export const TURN_STATES = ['queued', 'approval', 'rejected', 'running', 'blocked', 'done', 'failed', 'open'];
export const PROJECT_KINDS = ['web', 'service', 'cli', 'other'];

export const SHOWROOM_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS ${T_USERS} (id bigserial PRIMARY KEY, username text NOT NULL UNIQUE, pass_hash text NOT NULL, role text NOT NULL DEFAULT 'tester', floor text NOT NULL UNIQUE, display text NOT NULL, allowance_usd numeric, created_at bigint NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS ${T_PROJECTS} (id text PRIMARY KEY, floor text NOT NULL, title text NOT NULL, slug text NOT NULL, brief text NOT NULL, kind text NOT NULL DEFAULT 'web', status text NOT NULL DEFAULT 'new', repo text, branch text, session_id text, preview_url text, design text, turns int NOT NULL DEFAULT 0, cost_usd numeric NOT NULL DEFAULT 0, created_at bigint NOT NULL, updated_at bigint NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS ${T_PROJECTS}_floor ON ${T_PROJECTS} (floor, updated_at)`,
  `CREATE TABLE IF NOT EXISTS ${T_TURNS} (id bigserial PRIMARY KEY, project_id text NOT NULL, floor text NOT NULL, n int NOT NULL, author text NOT NULL, kind text NOT NULL, text text NOT NULL, options text, size text, budget_usd numeric, status text NOT NULL, session_id text, cost_usd numeric, links text, note text, created_at bigint NOT NULL, updated_at bigint NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS ${T_TURNS}_project ON ${T_TURNS} (project_id, id)`,
  `CREATE INDEX IF NOT EXISTS ${T_TURNS}_status ON ${T_TURNS} (status, id)`,
];
const ensured = new Set();
export async function ensureShowroom(sql, key = 'default') { if (ensured.has(key)) return; for (const q of SHOWROOM_SCHEMA) await sql(q); ensured.add(key); }

const num = (v, d = 0) => (v === null || v === undefined || v === '' ? d : Number(v));
const opt = (v) => (v === null || v === undefined ? null : Number(v));
const js = (v, d) => { if (v === null || v === undefined || v === '') return d; if (typeof v === 'object') return v; try { return JSON.parse(v); } catch { return d; } };
const inList = (values, params) => values.map((v) => { params.push(v); return '$' + params.length; }).join(',');
const PROJECT_COLS = { title: 'title', status: 'status', repo: 'repo', branch: 'branch', sessionId: 'session_id', previewUrl: 'preview_url', design: 'design', turns: 'turns', costUsd: 'cost_usd', kind: 'kind' };
const TURN_COLS = { status: 'status', sessionId: 'session_id', costUsd: 'cost_usd', links: 'links', note: 'note', options: 'options', budgetUsd: 'budget_usd', size: 'size' };

export const projectRow = (r) => r && { id: r.id, floor: r.floor, title: r.title, slug: r.slug, brief: r.brief, kind: r.kind, status: r.status, repo: r.repo, branch: r.branch, sessionId: r.session_id, previewUrl: r.preview_url, design: r.design, turns: num(r.turns), costUsd: num(r.cost_usd), createdAt: num(r.created_at), updatedAt: num(r.updated_at) };
export const turnRow = (r) => r && { id: num(r.id), projectId: r.project_id, floor: r.floor, n: num(r.n), author: r.author, kind: r.kind, text: r.text, options: js(r.options, []), size: r.size, budgetUsd: opt(r.budget_usd), status: r.status, sessionId: r.session_id, costUsd: opt(r.cost_usd), links: js(r.links, {}), note: r.note, createdAt: num(r.created_at), updatedAt: num(r.updated_at) };

/* ---- users ---- */
export async function getUserByName(sql, username) { const r = await sql(`SELECT * FROM ${T_USERS} WHERE lower(username) = lower($1)`, [String(username || '')]); return r[0] || null; }
export async function getUserById(sql, id) { const r = await sql(`SELECT * FROM ${T_USERS} WHERE id = $1`, [Number(id) || 0]); return r[0] || null; }
export async function listUsers(sql) { return sql(`SELECT * FROM ${T_USERS} ORDER BY (role = 'owner') DESC, username`); }
export async function insertUser(sql, { username, passHash, role = 'tester', floor, display, allowanceUsd = null }, now = Date.now()) {
  const r = await sql(`INSERT INTO ${T_USERS} (username, pass_hash, role, floor, display, allowance_usd, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`, [username, passHash, role, floor, display || username, allowanceUsd, now]);
  return r[0] ? num(r[0].id) : null;
}
export async function setPassword(sql, id, passHash) { await sql(`UPDATE ${T_USERS} SET pass_hash = $2 WHERE id = $1`, [Number(id), passHash]); }

/* ---- projects ---- */
export async function insertProject(sql, p, now = Date.now()) {
  await sql(`INSERT INTO ${T_PROJECTS} (id, floor, title, slug, brief, kind, status, branch, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$9)`, [p.id, p.floor, p.title, p.slug, p.brief, p.kind, p.status || 'new', p.branch || null, now]);
  return p.id;
}
export async function getProject(sql, id) { const r = await sql(`SELECT * FROM ${T_PROJECTS} WHERE id = $1`, [String(id || '')]); return projectRow(r[0]); }
/** Projects on the given floors (null = every floor), newest activity first, each with its latest turn. */
export async function listProjects(sql, floors = null, limit = 100, { includeClosed = false } = {}) {
  const params = []; const conds = [];
  if (floors) conds.push(`floor IN (${inList(floors, params)})`);
  if (!includeClosed) conds.push(`status <> 'closed'`);
  const where = conds.length ? 'WHERE ' + conds.join(' AND ') : '';
  params.push(Math.min(500, Math.max(1, limit)));
  const rows = (await sql(`SELECT * FROM ${T_PROJECTS} ${where} ORDER BY updated_at DESC LIMIT $${params.length}`, params)).map(projectRow);
  if (!rows.length) return rows;
  const p2 = []; const latest = await sql(`SELECT DISTINCT ON (project_id) * FROM ${T_TURNS} WHERE project_id IN (${inList(rows.map((r) => r.id), p2)}) ORDER BY project_id, id DESC`, p2);
  const byProject = Object.fromEntries(latest.map((r) => [r.project_id, turnRow(r)]));
  return rows.map((r) => ({ ...r, latest: byProject[r.id] || null }));
}
export async function updateProject(sql, id, patch, now = Date.now()) {
  const params = [String(id)]; const sets = [];
  for (const [k, col] of Object.entries(PROJECT_COLS)) if (patch[k] !== undefined) { params.push(patch[k]); sets.push(`${col} = $${params.length}`); }
  if (patch.addCost) { params.push(Number(patch.addCost)); sets.push(`cost_usd = cost_usd + $${params.length}`); }
  if (patch.bumpTurns) sets.push('turns = turns + 1');
  params.push(now); sets.push(`updated_at = $${params.length}`);
  await sql(`UPDATE ${T_PROJECTS} SET ${sets.join(', ')} WHERE id = $1`, params);
}

/* ---- turns ---- */
export async function insertTurn(sql, t, now = Date.now()) {
  const r = await sql(`INSERT INTO ${T_TURNS} (project_id, floor, n, author, kind, text, options, size, budget_usd, status, session_id, cost_usd, links, note, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$15) RETURNING id`,
    [t.projectId, t.floor, t.n, t.author, t.kind, t.text, t.options ? JSON.stringify(t.options) : null, t.size || null, t.budgetUsd ?? null, t.status, t.sessionId || null, t.costUsd ?? null, t.links ? JSON.stringify(t.links) : null, t.note || null, now]);
  return r[0] ? num(r[0].id) : null;
}
export async function getTurn(sql, id) { const r = await sql(`SELECT * FROM ${T_TURNS} WHERE id = $1`, [Number(id) || 0]); return turnRow(r[0]); }
export async function listTurns(sql, projectId, limit = 400) { return (await sql(`SELECT * FROM ${T_TURNS} WHERE project_id = $1 ORDER BY id ASC LIMIT $2`, [String(projectId), limit])).map(turnRow); }
export async function latestTurn(sql, projectId) { const r = await sql(`SELECT * FROM ${T_TURNS} WHERE project_id = $1 ORDER BY id DESC LIMIT 1`, [String(projectId)]); return turnRow(r[0]); }
export async function openWork(sql, projectId) {
  const r = await sql(`SELECT * FROM ${T_TURNS} WHERE project_id = $1 AND kind IN ('request','answer') AND status IN ('queued','approval','running','blocked') ORDER BY id DESC LIMIT 1`, [String(projectId)]); return turnRow(r[0]);
}
export async function updateTurn(sql, id, patch, now = Date.now()) {
  const params = [Number(id)]; const sets = [];
  for (const [k, col] of Object.entries(TURN_COLS)) if (patch[k] !== undefined) { const v = patch[k]; params.push(v !== null && typeof v === 'object' ? JSON.stringify(v) : v); sets.push(`${col} = $${params.length}`); }
  params.push(now); sets.push(`updated_at = $${params.length}`);
  await sql(`UPDATE ${T_TURNS} SET ${sets.join(', ')} WHERE id = $1`, params);
}
/** Queued work on floors whose project is not already being worked, oldest first, with its project. */
export async function nextWork(sql, floors = null, limit = 3) {
  const params = []; const where = floors ? `AND t.floor IN (${inList(floors, params)})` : '';
  params.push(Math.min(20, Math.max(1, limit)));
  const rows = await sql(`SELECT t.*, p.title AS p_title, p.slug AS p_slug, p.brief AS p_brief, p.kind AS p_kind, p.status AS p_status, p.repo AS p_repo, p.branch AS p_branch, p.session_id AS p_session_id, p.preview_url AS p_preview_url, p.turns AS p_turns, p.cost_usd AS p_cost_usd, p.created_at AS p_created_at, p.updated_at AS p_updated_at FROM ${T_TURNS} t JOIN ${T_PROJECTS} p ON p.id = t.project_id WHERE t.status = 'queued' AND t.kind IN ('request','answer') AND p.status NOT IN ('running') ${where} ORDER BY t.id ASC LIMIT $${params.length}`, params);
  return rows.map((r) => ({ turn: turnRow(r), project: projectRow({ id: r.project_id, floor: r.floor, title: r.p_title, slug: r.p_slug, brief: r.p_brief, kind: r.p_kind, status: r.p_status, repo: r.p_repo, branch: r.p_branch, session_id: r.p_session_id, preview_url: r.p_preview_url, turns: r.p_turns, cost_usd: r.p_cost_usd, created_at: r.p_created_at, updated_at: r.p_updated_at }) }));
}
export async function pendingApprovals(sql) {
  const rows = await sql(`SELECT t.*, p.title AS p_title, u.username AS u_name, u.display AS u_display, u.allowance_usd AS u_allowance FROM ${T_TURNS} t JOIN ${T_PROJECTS} p ON p.id = t.project_id LEFT JOIN ${T_USERS} u ON u.floor = t.floor WHERE t.status = 'approval' ORDER BY t.id ASC LIMIT 100`);
  return rows.map((r) => ({ ...turnRow(r), projectTitle: r.p_title, user: { username: r.u_name, display: r.u_display, allowanceUsd: opt(r.u_allowance) } }));
}
export const monthStart = (now = Date.now()) => { const d = new Date(now); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1); };
const USED_SQL = `coalesce(sum(CASE WHEN status IN ('done','failed') THEN coalesce(cost_usd, 0) ELSE coalesce(budget_usd, 0) END), 0)`;
/** Dollars a floor has spent or reserved this month: finished turns at cost, open turns at their cap. */
export async function monthUsage(sql, floor, now = Date.now()) {
  const r = await sql(`SELECT ${USED_SQL} AS used FROM ${T_TURNS} WHERE floor = $1 AND kind IN ('request','answer') AND status NOT IN ('rejected','approval') AND created_at >= $2`, [floor, monthStart(now)]);
  return r[0] ? num(r[0].used) : 0;
}
/** The Building view: one row per user/floor with usage, counts and the last event seen. */
export async function floorStats(sql, floors = null, now = Date.now()) {
  const params = [monthStart(now)]; const where = floors ? `WHERE u.floor IN (${inList(floors, params)})` : '';
  const rows = await sql(`SELECT u.id, u.username, u.display, u.role, u.floor, u.allowance_usd,
    (SELECT count(*) FROM ${T_PROJECTS} p WHERE p.floor = u.floor) AS projects,
    (SELECT count(*) FROM ${T_PROJECTS} p WHERE p.floor = u.floor AND p.status IN ('running','blocked')) AS active,
    (SELECT count(*) FROM ${T_TURNS} t WHERE t.floor = u.floor AND t.status = 'approval') AS approvals,
    (SELECT max(t) FROM binas_events e WHERE e.floor = u.floor) AS last_event,
    (SELECT ${USED_SQL} FROM ${T_TURNS} t WHERE t.floor = u.floor AND t.kind IN ('request','answer') AND t.status NOT IN ('rejected','approval') AND t.created_at >= $1) AS used
    FROM ${T_USERS} u ${where} ORDER BY (u.role = 'owner') DESC, u.username`, params);
  return rows.map((r) => ({ user: { id: num(r.id), username: r.username, display: r.display, role: r.role }, floor: r.floor, allowanceUsd: opt(r.allowance_usd), usedUsd: num(r.used), projects: num(r.projects), active: num(r.active), approvals: num(r.approvals), lastEvent: opt(r.last_event) }));
}

/** The INSERT that adds a user, for the Neon SQL editor. Only the hash travels; the password never does. */
export function userInsertSql({ username, display, role = 'tester', floor, allowanceUsd = null, passHash }, now = Date.now()) {
  const q = (s) => `'${String(s).replace(/'/g, "''")}'`;
  return `INSERT INTO ${T_USERS} (username, pass_hash, role, floor, display, allowance_usd, created_at) VALUES (${q(username)}, ${q(passHash)}, ${q(role)}, ${q(floor)}, ${q(display || username)}, ${allowanceUsd === null ? 'NULL' : Number(allowanceUsd)}, ${now});`;
}
