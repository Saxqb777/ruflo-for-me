// The Binas floor server: serves web/ and demo/, and streams the live feed as server-sent events.
// Zero dependencies, loopback only, GET only. /events sends the backlog (Binas log + Ruflo mission logs,
// sorted) as one `backlog` message, then every appended event as an `ev` message.
import { createServer } from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { dirname, extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readEvents, followEvents, logPath } from './log.mjs';
import { readMissions } from './adapters/missions.mjs';
import { CONTRACT, byTime } from './events.mjs';
import { makeJob, saveJob, listJobs, loadJob, answerJob, summarize } from './factory/jobs.mjs';

const readBody = (req) => new Promise((resolve) => { let d = ''; req.setEncoding('utf8'); req.on('data', (c) => { d += c; if (d.length > 1e6) req.destroy(); }); req.on('end', () => resolve(d)); req.on('error', () => resolve(d)); });
const sendJson = (res, status, body) => { res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); res.end(JSON.stringify(body)); };

const HERE = dirname(fileURLToPath(import.meta.url));
export const PLUGIN_ROOT = resolve(HERE, '..');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.jsonl': 'application/x-ndjson; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png' };

function serveFile(res, base, rel) {
  const file = resolve(base, '.' + rel.replace(/\\/g, '/'));
  if (!(file + sep).startsWith(resolve(base) + sep) && file !== resolve(base)) { res.writeHead(403); return res.end('forbidden'); }
  if (!existsSync(file) || !statSync(file).isFile()) { res.writeHead(404); return res.end('not found'); }
  res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache' });
  createReadStream(file).pipe(res);
}

const missionKey = (e) => `${e.t}|${e.kind}|${e.agent || ''}|${e.paper || ''}|${e.text || ''}`;

/** Start the server. Returns { server, port, close }. */
export function startServer({ root = process.cwd(), port = 4777, host = '127.0.0.1', demoDefault = false } = {}) {
  const clients = new Set();
  const seenMissions = new Set();
  const snapshot = () => {
    const missions = readMissions(root); missions.forEach((e) => seenMissions.add(missionKey(e)));
    return [...readEvents(root), ...missions].sort(byTime);
  };
  const broadcast = (e) => { const line = `event: ev\ndata: ${JSON.stringify(e)}\n\n`; for (const c of clients) c.write(line); };
  const stopFollow = followEvents(root, broadcast);
  const missionTimer = setInterval(() => {
    if (!clients.size) return;
    for (const e of readMissions(root)) { const k = missionKey(e); if (!seenMissions.has(k)) { seenMissions.add(k); broadcast(e); } }
  }, 2000);
  const heartbeat = setInterval(() => { for (const c of clients) c.write(': keep-alive\n\n'); }, 15000);

  const server = createServer(async (req, res) => {
    const url = new URL(req.url || '/', 'http://localhost');
    const p = url.pathname;
    /* the local job board: the page and the workshop share the job folder */
    if (p === '/api/jobs' && req.method === 'GET') return sendJson(res, 200, { jobs: listJobs(root).map(summarize) });
    if (p === '/api/jobs' && req.method === 'POST') { try { const body = JSON.parse(await readBody(req) || '{}'); const job = saveJob(root, makeJob(body, root)); return sendJson(res, 201, summarize(job)); } catch (e) { return sendJson(res, 400, { error: e.message }); } }
    if (p.startsWith('/api/jobs/') && req.method === 'GET') { const job = loadJob(root, p.slice(10)); return job ? sendJson(res, 200, job) : sendJson(res, 404, { error: 'no such job' }); }
    if (p === '/api/answer' && req.method === 'POST') { try { const body = JSON.parse(await readBody(req) || '{}'); return sendJson(res, 200, summarize(answerJob(root, body.jobId, body.text))); } catch (e) { return sendJson(res, 400, { error: e.message }); } }
    if (req.method !== 'GET') { res.writeHead(405); return res.end(); }
    if (p === '/' || p === '/index.html') {
      if (demoDefault && !url.searchParams.has('src')) { res.writeHead(302, { location: '/?src=demo' }); return res.end(); }
      return serveFile(res, join(PLUGIN_ROOT, 'web'), '/index.html');
    }
    if (p.startsWith('/web/')) return serveFile(res, join(PLUGIN_ROOT, 'web'), p.slice(4));
    if (p.startsWith('/demo/')) return serveFile(res, join(PLUGIN_ROOT, 'demo'), p.slice(5));
    if (p === '/api/info') {
      res.writeHead(200, { 'content-type': TYPES['.json'], 'cache-control': 'no-cache' });
      return res.end(JSON.stringify({ contract: CONTRACT, root, log: logPath(root), logExists: existsSync(logPath(root)), events: readEvents(root).length, missions: readMissions(root).length }));
    }
    if (p === '/events') {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive', 'x-accel-buffering': 'no' });
      res.write(`event: backlog\ndata: ${JSON.stringify(snapshot())}\n\n`);
      clients.add(res); req.on('close', () => clients.delete(res));
      return;
    }
    res.writeHead(404); res.end('not found');
  });

  return new Promise((resolveStart, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      const addr = server.address(); const actualPort = typeof addr === 'object' && addr ? addr.port : port;
      resolveStart({ server, port: actualPort, url: `http://${host}:${actualPort}/`, close: () => new Promise((r) => { stopFollow(); clearInterval(missionTimer); clearInterval(heartbeat); for (const c of clients) c.end(); server.close(() => r()); }) });
    });
  });
}
