// GET /api/events?floor=default&after=<id>&limit=2000  (header x-binas-key)
// The cloud feed: events after a cursor, oldest first. Fails closed without a key; 503 without a database.
import { neonClient, ensureSchema, listEvents } from '../src/cloud/neon.mjs';
import { floorOf, keyOk, keyFrom, json, queryOf } from '../src/cloud/http.mjs';

export default async function handler(req, res) {
  try {
    if (req.method !== 'GET') return json(res, 405, { error: 'GET only' });
    const q = queryOf(req); req.query = q;
    if (!keyOk(keyFrom(req), process.env.BINAS_KEY)) return json(res, 401, { error: 'floor key required', hint: 'send x-binas-key' });
    if (!process.env.DATABASE_URL) return json(res, 503, { error: 'database not connected', hint: 'set DATABASE_URL to a Neon connection string' });
    const sql = neonClient(process.env.DATABASE_URL);
    await ensureSchema(sql);
    const out = await listEvents(sql, floorOf(q), q.after, q.limit);
    return json(res, 200, out);
  } catch (e) { return json(res, 500, { error: String(e && e.message || e).slice(0, 300) }); }
}
