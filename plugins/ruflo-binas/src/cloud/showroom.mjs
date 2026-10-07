// The showroom's handlers. Each takes a context { method, query, body, user, sql, env, now } and returns
// { status, body, headers? }. No request or response objects here, so every rule is testable with a fake sql.
import { hashPassword, verifyPassword, passwordVersion, signSession, sessionCookie, clearCookie, publicUser, passwordOk, usernameOk } from './auth.mjs';
import { floorOk } from './http.mjs';
import * as db from './store.mjs';

const short = (s, n) => { s = String(s || '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
const slugify = (s) => String(s || '').toLowerCase().trim().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'project';
const newProjectId = (now) => 'prj_' + now.toString(36) + Math.random().toString(36).slice(2, 6);
const reply = (status, body, headers) => ({ status, body, ...(headers ? { headers } : {}) });
const isOwner = (u) => !!u && u.role === 'owner';
const BIG_RE = /\b(add|build|create|new|another)\b[^.]{0,60}\b(page|feature|flow|screen|module|integration|auth|login|signup|payment|checkout|database|api|dashboard|admin|search|upload|email)\b|\b(redesign|rebuild|rewrite|refactor|migrate|integrate|overhaul)\b/i;

/** How big a turn is, and its spend cap. The first turn of a project is always the full pipeline. */
export function sizeTurn(text, { first = false, requested = null, owner = false } = {}) {
  const base = first ? { size: 'full', budgetUsd: 8 } : BIG_RE.test(String(text)) || String(text).length > 600 ? { size: 'full', budgetUsd: 6 } : { size: 'small', budgetUsd: 2 };
  const asked = Number(requested);
  if (Number.isFinite(asked) && asked > 0) base.budgetUsd = Math.min(owner ? 200 : 50, Math.max(0.5, asked));
  return base;
}
/** Whether a floor may add `budgetUsd` this month. Owners and users without an allowance always may. */
export async function allowanceCheck(sql, user, budgetUsd, now) {
  if (isOwner(user) || user.allowance_usd === null || user.allowance_usd === undefined) return { ok: true, usedUsd: null, allowanceUsd: null };
  const usedUsd = await db.monthUsage(sql, user.floor, now); const allowanceUsd = Number(user.allowance_usd);
  return { ok: usedUsd + budgetUsd <= allowanceUsd + 1e-9, usedUsd, allowanceUsd };
}
const projectStatusFor = (turnStatus) => ({ queued: 'queued', approval: 'approval', running: 'running', blocked: 'blocked', done: 'idle', failed: 'failed', rejected: 'idle' }[turnStatus] || 'idle');

/* ---- /api/login ---- */
export async function login(ctx) {
  const { method, body = {}, user, sql, env, now } = ctx;
  if (method === 'GET') return user ? reply(200, { user: publicUser(user) }) : reply(401, { error: 'sign in' });
  if (method === 'DELETE') return reply(200, { ok: true }, { 'set-cookie': clearCookie() });
  if (method !== 'POST') return reply(405, { error: 'GET, POST or DELETE' });
  if (!env.BINAS_SESSION_SECRET) return reply(503, { error: 'sessions are not configured', hint: 'set BINAS_SESSION_SECRET' });
  if (user && body.newPassword !== undefined) {
    if (!verifyPassword(body.password, user.pass_hash)) return reply(401, { error: 'current password is wrong' });
    if (!passwordOk(body.newPassword)) return reply(400, { error: 'a password needs 10 to 200 characters' });
    const hash = hashPassword(body.newPassword); await db.setPassword(sql, user.id, hash);
    return reply(200, { ok: true, user: publicUser(user) }, { 'set-cookie': sessionCookie(signSession({ uid: user.id, pv: passwordVersion(hash) }, env.BINAS_SESSION_SECRET, { now })) });
  }
  if (!usernameOk(body.username) || typeof body.password !== 'string') return reply(400, { error: 'username and password' });
  const u = await db.getUserByName(sql, body.username);
  if (!u || !verifyPassword(body.password, u.pass_hash)) return reply(401, { error: 'wrong username or password' });
  const token = signSession({ uid: u.id, pv: passwordVersion(u.pass_hash) }, env.BINAS_SESSION_SECRET, { now });
  return reply(200, { user: publicUser(u) }, { 'set-cookie': sessionCookie(token) });
}

/* ---- /api/projects ---- */
export async function projects(ctx) {
  const { method, query = {}, body = {}, user, sql, now } = ctx;
  if (method === 'GET') {
    const floors = isOwner(user) ? (query.floor && floorOk(query.floor) ? [query.floor] : null) : [user.floor];
    return reply(200, { projects: await db.listProjects(sql, floors) });
  }
  if (method !== 'POST') return reply(405, { error: 'GET or POST' });
  const title = short(body.title, 80); const brief = String(body.brief || '').trim().slice(0, 8000);
  if (!title) return reply(400, { error: 'a project needs a title' });
  if (brief.length < 20) return reply(400, { error: 'say more: what it is, who it is for, what done looks like' });
  const kind = db.PROJECT_KINDS.includes(body.kind) ? body.kind : 'web';
  const sized = sizeTurn(brief, { first: true, requested: body.budgetUsd, owner: isOwner(user) });
  const allow = await allowanceCheck(sql, user, sized.budgetUsd, now);
  const id = newProjectId(now); const status = allow.ok ? 'queued' : 'approval';
  await db.insertProject(sql, { id, floor: user.floor, title, slug: slugify(body.slug || title), brief, kind, status, branch: 'main' }, now);
  const turnId = await db.insertTurn(sql, { projectId: id, floor: user.floor, n: 1, author: user.username, kind: 'request', text: brief, ...sized, status }, now);
  if (!allow.ok) await db.insertTurn(sql, { projectId: id, floor: user.floor, n: 2, author: 'binas', kind: 'note', text: `This turn needs $${sized.budgetUsd.toFixed(2)} and your floor has $${Math.max(0, allow.allowanceUsd - allow.usedUsd).toFixed(2)} left this month. It is in the owner's tray.`, status: 'done' }, now + 1);
  return reply(201, { project: await db.getProject(sql, id), turn: await db.getTurn(sql, turnId), approval: !allow.ok });
}

/* ---- /api/turns ---- */
async function visibleProject(ctx, id) {
  const p = await db.getProject(ctx.sql, id); if (!p) return null;
  return isOwner(ctx.user) || p.floor === ctx.user.floor ? p : null;
}
export async function turns(ctx) {
  const { method, query = {}, body = {}, user, sql, now } = ctx;
  const p = await visibleProject(ctx, method === 'GET' ? query.project : body.project);
  if (!p) return reply(404, { error: 'no such project' });
  if (method === 'GET') return reply(200, { project: p, turns: await db.listTurns(sql, p.id) });
  if (method !== 'POST') return reply(405, { error: 'GET or POST' });
  const text = String(body.text || '').trim().slice(0, 8000); if (!text) return reply(400, { error: 'say something' });
  const last = await db.latestTurn(sql, p.id); const open = await db.openWork(sql, p.id);
  const n = (last ? last.n : 0) + 1;
  if (last && last.kind === 'ask' && last.status === 'open') {
    // an answer resumes the blocked turn: the ask closes, the answer is the new work
    const sized = sizeTurn(text, { requested: body.budgetUsd, owner: isOwner(user) }); const allow = await allowanceCheck(sql, user, sized.budgetUsd, now);
    const status = allow.ok ? 'queued' : 'approval';
    await db.updateTurn(sql, last.id, { status: 'done' }, now);
    if (open) await db.updateTurn(sql, open.id, { status: 'done' }, now);
    const id = await db.insertTurn(sql, { projectId: p.id, floor: p.floor, n, author: user.username, kind: 'answer', text, ...sized, status, note: last.text }, now);
    await db.updateProject(sql, p.id, { status: projectStatusFor(status) }, now);
    return reply(201, { turn: await db.getTurn(sql, id), approval: !allow.ok });
  }
  if (open) return reply(409, { error: `the floor is still on turn ${open.n} (${open.status}); wait for it to finish`, open });
  const sized = sizeTurn(text, { requested: body.budgetUsd, owner: isOwner(user) }); const allow = await allowanceCheck(sql, user, sized.budgetUsd, now);
  const status = allow.ok ? 'queued' : 'approval';
  const id = await db.insertTurn(sql, { projectId: p.id, floor: p.floor, n, author: user.username, kind: 'request', text, ...sized, status }, now);
  if (!allow.ok) await db.insertTurn(sql, { projectId: p.id, floor: p.floor, n: n + 1, author: 'binas', kind: 'note', text: `This turn needs $${sized.budgetUsd.toFixed(2)} and your floor has $${Math.max(0, allow.allowanceUsd - allow.usedUsd).toFixed(2)} left this month. It is in the owner's tray.`, status: 'done' }, now + 1);
  await db.updateProject(sql, p.id, { status: projectStatusFor(status) }, now);
  return reply(201, { turn: await db.getTurn(sql, id), approval: !allow.ok });
}

/* ---- /api/approvals (owner) ---- */
export async function approvals(ctx) {
  const { method, body = {}, user, sql, now } = ctx;
  if (!isOwner(user)) return reply(403, { error: 'owner only' });
  if (method === 'GET') return reply(200, { approvals: await db.pendingApprovals(sql) });
  if (method !== 'POST') return reply(405, { error: 'GET or POST' });
  const t = await db.getTurn(sql, body.turn); if (!t || t.status !== 'approval') return reply(404, { error: 'nothing waiting under that id' });
  const p = await db.getProject(sql, t.projectId);
  if (body.decision === 'approve') {
    const budgetUsd = Number(body.budgetUsd) > 0 ? Math.min(200, Number(body.budgetUsd)) : t.budgetUsd;
    await db.updateTurn(sql, t.id, { status: 'queued', budgetUsd }, now);
    await db.insertTurn(sql, { projectId: t.projectId, floor: t.floor, n: t.n + 1, author: 'binas', kind: 'note', text: `The owner approved turn ${t.n}${body.note ? ': ' + short(body.note, 300) : ''}.`, status: 'done' }, now);
    if (p) await db.updateProject(sql, p.id, { status: 'queued' }, now);
    return reply(200, { turn: await db.getTurn(sql, t.id) });
  }
  if (body.decision === 'reject') {
    await db.updateTurn(sql, t.id, { status: 'rejected' }, now);
    await db.insertTurn(sql, { projectId: t.projectId, floor: t.floor, n: t.n + 1, author: 'binas', kind: 'note', text: `The owner declined turn ${t.n}${body.note ? ': ' + short(body.note, 300) : ''}.`, status: 'done' }, now);
    if (p) await db.updateProject(sql, p.id, { status: 'idle' }, now);
    return reply(200, { turn: await db.getTurn(sql, t.id) });
  }
  return reply(400, { error: 'decision is approve or reject' });
}

/* ---- /api/floors (the Building view) ---- */
export async function floors(ctx) {
  const { user, sql, now } = ctx;
  const rows = await db.floorStats(sql, isOwner(user) ? null : [user.floor], now);
  return reply(200, { floors: rows, me: publicUser(user) });
}

/* ---- /api/work (the workshop, with the master key) ---- */
export async function work(ctx) {
  const { method, query = {}, body = {}, sql, now } = ctx;
  if (method === 'GET') {
    const floors = query.floor && query.floor !== 'all' && floorOk(query.floor) ? [query.floor] : null;
    return reply(200, { work: await db.nextWork(sql, floors, Number(query.limit) || 3) });
  }
  if (method !== 'POST') return reply(405, { error: 'GET or POST' });
  const t = await db.getTurn(sql, body.turn); if (!t || !db.WORK_KINDS.includes(t.kind)) return reply(404, { error: 'no such work turn' });
  const p = await db.getProject(sql, t.projectId); if (!p) return reply(404, { error: 'no such project' });
  const status = String(body.status || ''); const cost = Number(body.costUsd); const costUsd = Number.isFinite(cost) ? Number(cost.toFixed(4)) : undefined;
  const patch = { status, sessionId: body.sessionId || undefined, costUsd, note: body.progress ? short(body.progress, 300) : undefined };
  if (status === 'running') { if (t.status !== 'queued' && t.status !== 'running') return reply(409, { error: `turn is ${t.status}` }); await db.updateTurn(sql, t.id, patch, now); await db.updateProject(sql, p.id, { status: 'running', sessionId: body.sessionId || undefined, repo: body.repo || undefined, branch: body.branch || undefined }, now); }
  else if (status === 'blocked') {
    const q = body.question || {}; await db.updateTurn(sql, t.id, patch, now);
    await db.insertTurn(sql, { projectId: p.id, floor: p.floor, n: t.n + 1, author: 'binas', kind: 'ask', text: short(q.text || q.question || 'needs a decision', 400), options: Array.isArray(q.options) ? q.options.slice(0, 6).map((o) => short(o, 80)) : [], note: short(q.context, 300), status: 'open' }, now);
    await db.updateProject(sql, p.id, { status: 'blocked', sessionId: body.sessionId || undefined }, now);
  } else if (status === 'done') {
    const r = body.report || {}; await db.updateTurn(sql, t.id, { ...patch, links: body.links || {} }, now);
    await db.insertTurn(sql, { projectId: p.id, floor: p.floor, n: t.n + 1, author: 'binas', kind: 'report', text: short(r.summary || 'done', 2000), options: Array.isArray(r.whatChanged) ? r.whatChanged.slice(0, 12).map((o) => short(o, 200)) : [], note: [r.howToOpen ? 'Open: ' + short(r.howToOpen, 300) : '', Array.isArray(r.next) && r.next.length ? 'Next: ' + r.next.slice(0, 6).map((o) => short(o, 120)).join(' · ') : '', r.notes ? short(r.notes, 400) : ''].filter(Boolean).join('\n'), links: body.links || {}, status: 'done' }, now);
    await db.updateProject(sql, p.id, { status: 'idle', sessionId: body.sessionId || undefined, repo: body.repo || (body.links && body.links.remote) || undefined, previewUrl: body.links && body.links.preview ? body.links.preview : undefined, bumpTurns: true, addCost: costUsd || 0 }, now);
  } else if (status === 'failed') {
    await db.updateTurn(sql, t.id, patch, now);
    await db.insertTurn(sql, { projectId: p.id, floor: p.floor, n: t.n + 1, author: 'binas', kind: 'note', text: 'The turn failed: ' + short(body.error || 'no detail', 400), status: 'done' }, now);
    await db.updateProject(sql, p.id, { status: 'failed', sessionId: body.sessionId || undefined, bumpTurns: true, addCost: costUsd || 0 }, now);
  } else if (status === 'progress') { await db.updateTurn(sql, t.id, { note: patch.note }, now); }
  else return reply(400, { error: 'status is running, blocked, done, failed or progress' });
  return reply(200, { turn: await db.getTurn(sql, t.id), project: await db.getProject(sql, p.id) });
}
