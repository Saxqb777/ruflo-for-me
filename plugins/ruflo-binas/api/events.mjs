// GET /api/events?floor=default&after=<id>&limit=2000
// The cloud feed: events after a cursor, oldest first. A floor key, the master key, or a signed-in user whose
// floor it is (the owner: any floor). Fails closed without one of those; 503 without a database.
import { neonClient, ensureSchema, listEvents } from '../src/cloud/neon.mjs';
import { floorOf, keyOkFor, keyFrom, json, queryOf } from '../src/cloud/http.mjs';
import { userFrom } from '../src/cloud/serve.mjs';

export default async function handler(req, res) {
  try {
    if (req.method !== 'GET') return json(res, 405, { error: 'GET only' });
    const q = queryOf(req); req.query = q; const floor = floorOf(q);
    const byKey = keyOkFor(keyFrom(req), floor, process.env);
    if (!byKey && !process.env.BINAS_SESSION_SECRET) return json(res, 401, { error: 'floor key required', hint: 'send x-binas-key' });
    if (!process.env.DATABASE_URL) return json(res, 503, { error: 'database not connected', hint: 'set DATABASE_URL to a Neon connection string' });
    const sql = neonClient(process.env.DATABASE_URL);
    await ensureSchema(sql);
    if (!byKey) { const u = await userFrom(req, sql, process.env); if (!u || (u.role !== 'owner' && u.floor !== floor)) return json(res, 401, { error: 'floor key or sign-in required', hint: 'send x-binas-key or sign in' }); }
    const out = await listEvents(sql, floor, q.after, q.limit);
    return json(res, 200, out);
  } catch (e) { return json(res, 500, { error: String(e && e.message || e).slice(0, 300) }); }
}
