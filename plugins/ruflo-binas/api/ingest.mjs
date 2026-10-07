// POST /api/ingest?floor=default  (header x-binas-key; body: one event, an array, or JSON lines)
// Hooks and other writers send events here. Everything is normalized before it touches the table.
import { normalize } from '../src/events.mjs';
import { neonClient, ensureSchema, insertEvents } from '../src/cloud/neon.mjs';
import { floorOf, keyOk, keyFrom, expectedKey, json, readBody, parseBody, queryOf } from '../src/cloud/http.mjs';

export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') return json(res, 405, { error: 'POST only' });
    const q = queryOf(req); req.query = q;
    if (!keyOk(keyFrom(req), expectedKey(floorOf(q)))) return json(res, 401, { error: 'floor key required', hint: 'send x-binas-key' });
    const raw = parseBody(await readBody(req));
    const events = raw.map(normalize).filter(Boolean);
    if (!events.length) return json(res, 400, { error: 'no valid events', received: raw.length });
    if (!process.env.DATABASE_URL) return json(res, 503, { error: 'database not connected', hint: 'set DATABASE_URL to a Neon connection string' });
    const sql = neonClient(process.env.DATABASE_URL);
    await ensureSchema(sql);
    const inserted = await insertEvents(sql, floorOf(q), events);
    return json(res, 200, { inserted, skipped: raw.length - events.length });
  } catch (e) { return json(res, 500, { error: String(e && e.message || e).slice(0, 300) }); }
}
