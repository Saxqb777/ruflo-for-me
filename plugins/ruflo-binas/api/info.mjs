// GET /api/info — what this floor has, without secrets: is a key set, is a database connected, are sessions
// configured, how many events (with a key).
import { CONTRACT } from '../src/events.mjs';
import { neonClient, ensureSchema, countEvents } from '../src/cloud/neon.mjs';
import { floorOf, keyOkFor, keyFrom, expectedKey, json, queryOf } from '../src/cloud/http.mjs';

export default async function handler(req, res) {
  try {
    const q = queryOf(req); req.query = q; const floor = floorOf(q);
    const out = { contract: CONTRACT, keyConfigured: !!(expectedKey(floor) || process.env.BINAS_KEY), databaseConfigured: !!process.env.DATABASE_URL, sessionsConfigured: !!process.env.BINAS_SESSION_SECRET, floor };
    if (out.databaseConfigured && keyOkFor(keyFrom(req), floor, process.env)) {
      try { const sql = neonClient(process.env.DATABASE_URL); await ensureSchema(sql); out.events = await countEvents(sql, out.floor); out.database = 'ok'; }
      catch (e) { out.database = 'error'; out.databaseError = String(e && e.message || e).slice(0, 200); }
    }
    return json(res, 200, out);
  } catch (e) { return json(res, 500, { error: String(e && e.message || e).slice(0, 300) }); }
}
