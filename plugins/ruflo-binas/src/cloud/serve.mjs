// The Vercel shim: turns a request into a showroom context and a handler's reply into a response.
// auth: 'user' (a valid session is required), 'optional' (session resolved if present), 'key' (the master key).
import { neonClient, ensureSchema } from './neon.mjs';
import { ensureShowroom, getUserById } from './store.mjs';
import { sessionFrom, passwordVersion } from './auth.mjs';
import { json, keyFrom, keyOk, parseBody, queryOf, readBody } from './http.mjs';

/** Resolve the signed-in user from the cookie, or null. A changed password ends older sessions. */
export async function userFrom(req, sql, env = process.env, now = Date.now()) {
  const s = sessionFrom(req, env.BINAS_SESSION_SECRET, now); if (!s) return null;
  const u = await getUserById(sql, s.uid); if (!u || passwordVersion(u.pass_hash) !== s.pv) return null;
  return u;
}

export async function serve(req, res, handler, { auth = 'user', env = process.env, now = Date.now() } = {}) {
  try {
    const query = queryOf(req); req.query = query; const method = String(req.method || 'GET').toUpperCase();
    if (auth === 'key' && !keyOk(keyFrom(req), env.BINAS_KEY)) return json(res, 401, { error: 'workshop key required', hint: 'send x-binas-key' });
    if (!env.DATABASE_URL) return json(res, 503, { error: 'database not connected', hint: 'set DATABASE_URL to a Neon connection string' });
    const body = method === 'GET' ? {} : (parseBody(await readBody(req))[0] || {});
    const sql = neonClient(env.DATABASE_URL); await ensureSchema(sql); await ensureShowroom(sql);
    const user = auth === 'key' ? null : await userFrom(req, sql, env, now);
    if (auth === 'user' && !user) return json(res, 401, { error: 'sign in' });
    const out = await handler({ method, query, body: body && typeof body === 'object' ? body : {}, user, sql, env, now, req });
    for (const [k, v] of Object.entries(out.headers || {})) res.setHeader(k, v);
    return json(res, out.status, out.body);
  } catch (e) { return json(res, 500, { error: String(e && e.message || e).slice(0, 300) }); }
}
