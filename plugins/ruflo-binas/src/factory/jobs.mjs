// The job store: one JSON file per job under <root>/.claude-flow/binas/jobs/. A job is a paper on the floor.
// States: queued -> running -> blocked (a question for the owner) -> answered -> running -> done -> shipped,
// or failed. Writes are atomic (tmp + rename) so the runner and the server can both read safely.
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

export const JOBS_DIR = join('.claude-flow', 'binas', 'jobs');
export const STATES = ['queued', 'running', 'blocked', 'answered', 'done', 'shipped', 'failed'];
export const SHIP_MODES = ['pr', 'branch', 'none'];
export const AUTONOMY = ['ask', 'full'];
const SLUG_RE = /[^a-z0-9-]+/g;

export const jobsDir = (root) => join(root, JOBS_DIR);
export const slugify = (s) => String(s || '').toLowerCase().trim().replace(SLUG_RE, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'project';
export const newId = () => 'job_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const short = (s, n) => { s = String(s || '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; };

/** The peg on the floor: one per local job, one per cloud project (every turn of a project is the same peg). */
export function jobAgentId(job) { return 'job.' + (job.cloud && job.cloud.projectId ? job.cloud.projectId : job.id); }
export function jobAgentName(job) { return short(job.title, 10).toUpperCase(); }

/** Build a job from a loose request; validates and fills defaults. Throws on a bad request. */
export function makeJob(req, root) {
  const title = short(req.title, 80); if (!title) throw new Error('a job needs a title');
  const brief = String(req.brief || '').trim().slice(0, 8000); if (!brief) throw new Error('a job needs a brief: what to build and what done looks like');
  const ship = SHIP_MODES.includes(req.ship) ? req.ship : 'pr';
  const autonomy = AUTONOMY.includes(req.autonomy) ? req.autonomy : 'ask';
  const budgetUsd = Math.min(200, Math.max(0.5, Number(req.budgetUsd) || 5));
  const model = /^[a-z0-9.-]{2,40}$/i.test(String(req.model || '')) ? String(req.model) : null;
  let project;
  if (req.project && String(req.project).trim()) { const p = resolve(root, String(req.project).trim()); if (!existsSync(p)) throw new Error(`project path does not exist: ${p}`); project = { kind: 'existing', path: p, slug: slugify(p.split(/[\\/]/).pop()) }; }
  else { const slug = slugify(req.slug || title); project = { kind: 'new', path: join(root, 'projects', slug), slug }; }
  const id = newId();
  return { id, title, brief, project, ship, autonomy, budgetUsd, model, state: 'queued', createdAt: Date.now(), startedAt: null, finishedAt: null, sessionId: null, workdir: null, branch: 'binas/' + id, question: null, answers: [], costUsd: 0, turns: 0, summary: null, links: {}, error: null, log: [] };
}

export function saveJob(root, job) {
  const dir = jobsDir(root); mkdirSync(dir, { recursive: true, mode: 0o700 });
  const file = join(dir, job.id + '.json'); const tmp = file + '.tmp';
  job.updatedAt = Date.now(); writeFileSync(tmp, JSON.stringify(job, null, 2), { mode: 0o600 }); renameSync(tmp, file);
  return job;
}
export function loadJob(root, id) {
  const file = join(jobsDir(root), String(id).replace(/[^a-z0-9_]/gi, '') + '.json');
  if (!existsSync(file)) return null;
  try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return null; }
}
export function listJobs(root) {
  const dir = jobsDir(root); if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => { try { return JSON.parse(readFileSync(join(dir, f), 'utf8')); } catch { return null; } }).filter(Boolean).sort((a, b) => a.createdAt - b.createdAt);
}
export function note(job, text) { job.log.push({ t: Date.now(), text: short(text, 300) }); if (job.log.length > 200) job.log.splice(0, job.log.length - 200); }

/** Record the owner's answer; the runner resumes the session on its next pass. */
export function answerJob(root, id, text) {
  const job = loadJob(root, id); if (!job) throw new Error('no such job');
  if (job.state !== 'blocked') throw new Error(`job is ${job.state}, not waiting for an answer`);
  const answer = short(text, 2000); if (!answer) throw new Error('an answer needs text');
  job.answers.push({ t: Date.now(), question: job.question ? job.question.text : null, answer });
  job.question = null; job.state = 'answered'; note(job, `answered: ${answer}`);
  return saveJob(root, job);
}

export function summarize(job) {
  return { id: job.id, title: job.title, state: job.state, project: job.project, ship: job.ship, autonomy: job.autonomy, budgetUsd: job.budgetUsd, model: job.model, createdAt: job.createdAt, startedAt: job.startedAt, finishedAt: job.finishedAt, question: job.question, answers: job.answers.length, costUsd: job.costUsd, turns: job.turns, summary: job.summary, links: job.links, error: job.error, branch: job.branch, agent: jobAgentId(job), cloud: job.cloud || null };
}
