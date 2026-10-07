// The cloud job board as the workshop sees it: pull queued turns from /api/work, report back, and copy the
// floor's events to /api/ingest. One master key, sent as x-binas-key. Every call is small JSON over fetch.
import { join } from 'node:path';

export function createBoard({ url, key, floor = 'all', fetchImpl = globalThis.fetch, timeoutMs = 15000 } = {}) {
  if (!url || !key) throw new Error('the cloud board needs a url and a key');
  const base = String(url).replace(/\/+$/, '');
  async function call(method, path, body) {
    const r = await fetchImpl(base + path, { method, headers: { 'content-type': 'application/json', 'x-binas-key': key }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(timeoutMs) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(`cloud ${r.status}: ${j.error || 'request refused'}`);
    return j;
  }
  return {
    url: base, key, ingestUrl: base + '/api/ingest',
    /** Queued turns with their projects, oldest first. */
    next: async (limit = 3) => (await call('GET', `/api/work?floor=${encodeURIComponent(floor)}&limit=${limit}`)).work || [],
    /** Report a turn's state: running, blocked (+question), done (+report, links), failed (+error), progress. */
    update: (turnId, patch) => call('POST', '/api/work', { turn: turnId, ...patch }),
    /** Copy events to the cloud floor. Best effort: resolves false on any failure, never throws. */
    sendEvents: async (events, fl) => { try { if (!events.length) return false; await call('POST', `/api/ingest?floor=${encodeURIComponent(fl || 'default')}`, events); return true; } catch { return false; } },
  };
}

/** A cloud turn as a local job: the project lives under <root>/projects/<floor>/<slug> on its main branch. */
export function jobFromWork({ turn, project }, root) {
  const slug = String(project.slug || 'project').replace(/[^a-z0-9-]/g, '').slice(0, 40) || 'project';
  const floor = String(project.floor || 'default').replace(/[^a-z0-9_-]/gi, '').slice(0, 40) || 'default';
  const isAnswer = turn.kind === 'answer';
  return {
    id: 'turn_' + turn.id, title: project.title, brief: turn.text, kind: project.kind || 'web',
    project: { kind: 'new', path: join(root, 'projects', floor, slug), slug },
    ship: 'branch', autonomy: 'ask', budgetUsd: Math.min(200, Math.max(0.5, Number(turn.budgetUsd) || 5)), model: null,
    state: isAnswer ? 'answered' : 'queued', createdAt: Date.now(), startedAt: null, finishedAt: null,
    sessionId: project.sessionId || null, workdir: null, branch: project.branch || 'main',
    question: null, answers: isAnswer ? [{ t: Date.now(), question: turn.note || null, answer: turn.text }] : [],
    costUsd: 0, turns: 0, summary: null, links: project.repo ? { remote: project.repo } : {}, error: null, log: [],
    cloud: { turnId: turn.id, projectId: project.id, floor, n: turn.n, kind: turn.kind, followUp: !isAnswer && !!project.sessionId },
  };
}
