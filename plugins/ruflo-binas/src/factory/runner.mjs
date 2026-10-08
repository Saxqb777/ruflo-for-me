// The workshop. Picks queued jobs (local, then the cloud board), prepares a repo or worktree, runs one headless
// Claude Code session per turn with the Ruflo pipeline prompt, the Binas hooks and a spend cap, parks on a
// binas-ask block, resumes with the owner's answer or the next message, ships, deploys a preview, and reports
// back to the board. Fuel is the machine's Claude login: any API key is stripped from the child environment
// unless the job says billing: "api". Tokens for push and deploy stay on the host; sessions never see them.
// Projects never live inside this plugin's folder: Claude Code treats a loaded plugin's files as sensitive and
// refuses to write there.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { listJobs, loadJob, saveJob, note, jobAgentId, jobAgentName } from './jobs.mjs';
import { coordinatorPrompt, newProjectClaudeMd, parseFence, ASK_FENCE, DONE_FENCE, BLOCKED_FENCE } from './prompt.mjs';
import { shipJob } from './ship.mjs';
import { previewDeploy } from './preview.mjs';
import { jobFromWork } from './board.mjs';
import { appendEvent } from '../log.mjs';

export const PLUGIN_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const DEFAULT_ALLOWED = ['Read', 'Edit', 'Write', 'MultiEdit', 'NotebookEdit', 'Glob', 'Grep', 'Agent', 'Task', 'TodoWrite', 'WebFetch', 'WebSearch',
  'Bash(npm *)', 'Bash(npx *)', 'Bash(pnpm *)', 'Bash(node *)', 'Bash(git add *)', 'Bash(git commit *)', 'Bash(git status*)', 'Bash(git diff*)', 'Bash(git log*)', 'Bash(git branch*)', 'Bash(ls *)', 'Bash(cat *)', 'Bash(mkdir *)', 'Bash(cp *)', 'Bash(mv *)'];
const HOST_ONLY = ['ANTHROPIC_API_KEY', 'VERCEL_TOKEN', 'VERCEL_TEAM_ID', 'GH_TOKEN', 'GITHUB_TOKEN', 'NEON_API_KEY', 'DATABASE_URL', 'BINAS_SESSION_SECRET'];
/** A question that is really the machine talking. It goes to the owner as a snag, never to a user as a question. */
export const MACHINE_RE = /permission|denied|allowed ?tools|session setting|cannot write|could not write|can't write|write tool|bash tool|the shell|sandbox|exit code|stack trace|ENOENT|EACCES|not allowed to|sensitive file|refused/i;
export const SNAG = 'The floor hit a snag and stopped. The owner has been told.';
const short = (s, n) => { s = String(s || '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
const git = (args, cwd) => { const r = spawnSync('git', args, { cwd, encoding: 'utf8' }); return { ok: r.status === 0, out: (r.stdout || '').trim(), err: (r.stderr || '').trim() }; };

export const insidePlugin = (p) => { const r = resolve(p); return r === PLUGIN_ROOT || r.startsWith(PLUGIN_ROOT + sep); };
/** Where projects and the log live: the current directory, unless that is inside the plugin, then ~/binas. */
export function defaultRoot(cwd = process.cwd(), home = homedir(), env = process.env) {
  if (env.BINAS_HOME) return resolve(env.BINAS_HOME);
  return insidePlugin(cwd) ? join(home, 'binas') : resolve(cwd);
}
export const PLUGIN_ROOT_ERROR = 'projects cannot live inside the Binas plugin folder: Claude Code refuses to write there. Run from another folder, or pass --root (default ~/binas).';

/** The command line for one turn. Pure, so the docker and plain shapes can be asserted in tests. */
export function composeCommand(job, prompt, { claude = { bin: 'claude', prefixArgs: [] }, sandbox = 'none', image = 'ghcr.io/anthropics/claude-code:latest', resume = false } = {}) {
  const args = ['-p', prompt, '--output-format', 'stream-json', '--verbose', '--max-budget-usd', String(job.budgetUsd)];
  if (job.model) args.push('--model', job.model);
  if (resume && job.sessionId) args.push('--resume', job.sessionId);
  if (job.autonomy === 'full') args.push('--dangerously-skip-permissions'); else args.push('--permission-mode', 'acceptEdits', '--allowedTools', DEFAULT_ALLOWED.join(','));
  if (sandbox === 'docker') {
    const envFlags = ['BINAS_LOG_ROOT', 'BINAS_JOB', 'BINAS_JOB_NAME', 'BINAS_FLOOR', 'BINAS_INGEST_URL', 'BINAS_KEY'].flatMap((k) => ['-e', k]);
    return { cmd: 'docker', args: ['run', '--rm', '-i', '--network', 'bridge', '-v', `${job.workdir}:/work`, '-v', `${join(homedir(), '.claude')}:/root/.claude`, '-v', `${PLUGIN_ROOT}:/binas:ro`, '-w', '/work', ...envFlags, image, 'claude', ...args, '--plugin-dir', '/binas'] };
  }
  return { cmd: claude.bin, args: [...(claude.prefixArgs || []), ...args, '--plugin-dir', PLUGIN_ROOT] };
}

/** The session's environment: host-only tokens removed, the floor's log and job identity added. */
export function childEnv(job, base, { root, floor, board = null }) {
  const env = { ...base };
  for (const k of HOST_ONLY) if (!(k === 'ANTHROPIC_API_KEY' && job.billing === 'api')) delete env[k];
  env.BINAS_LOG_ROOT = root; env.BINAS_JOB = job.cloud ? job.cloud.projectId : job.id; env.BINAS_JOB_NAME = jobAgentName(job);
  const fl = job.cloud ? job.cloud.floor : floor; if (fl) env.BINAS_FLOOR = fl;
  if (board) { env.BINAS_INGEST_URL = board.ingestUrl; env.BINAS_KEY = board.key; }
  delete env.CLAUDE_PROJECT_DIR;
  return env;
}

/** Make the place the session works in: a fresh repo for a new project, a worktree + branch for an existing one. */
export function prepareWorkdir(job, root) {
  if (insidePlugin(job.project.path) || insidePlugin(root)) throw new Error(PLUGIN_ROOT_ERROR);
  if (job.project.kind === 'new') {
    const p = job.project.path; mkdirSync(p, { recursive: true });
    if (!existsSync(join(p, '.git'))) {
      if (!git(['init', '-q'], p).ok) throw new Error('git init failed');
      git(['symbolic-ref', 'HEAD', 'refs/heads/main'], p);
      writeFileSync(join(p, 'CLAUDE.md'), newProjectClaudeMd(job)); writeFileSync(join(p, 'README.md'), `# ${job.title}\n\n${job.brief}\n`); writeFileSync(join(p, '.gitignore'), 'node_modules/\n.env\n.env.*\ndist/\n.claude-flow/\n.vercel/\n');
      git(['add', '-A'], p); git(['-c', 'user.name=Binas', '-c', 'user.email=binas@local', 'commit', '-q', '-m', 'binas: open the project'], p);
    }
    const b = git(['rev-parse', '--verify', '--quiet', job.branch], p).ok ? git(['checkout', '-q', job.branch], p) : git(['checkout', '-q', '-b', job.branch], p);
    if (!b.ok) throw new Error('could not switch to ' + job.branch + ': ' + b.err);
    return p;
  }
  const src = job.project.path;
  if (!git(['rev-parse', '--is-inside-work-tree'], src).ok) throw new Error('existing project must be a git repository: ' + src);
  const dir = join(root, '.claude-flow', 'binas', 'work', job.id);
  if (existsSync(dir)) return dir;
  mkdirSync(dirname(dir), { recursive: true });
  const exists = git(['rev-parse', '--verify', '--quiet', job.branch], src).ok;
  const w = exists ? git(['worktree', 'add', '-q', dir, job.branch], src) : git(['worktree', 'add', '-q', '-b', job.branch, dir], src);
  if (!w.ok) throw new Error('worktree failed: ' + w.err);
  return dir;
}

/** Run one headless session; resolves with { sessionId, result, cost, turns, isError, stderr }. */
export function runSession({ cmd, args, cwd, env, onLine = () => {}, timeoutMs = 2 * 3600 * 1000 }) {
  return new Promise((resolveP) => {
    const child = spawn(cmd, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let buf = '', stderr = '', sessionId = null, final = null;
    const timer = setTimeout(() => { try { child.kill('SIGTERM'); } catch { /* gone */ } }, timeoutMs);
    child.stdout.on('data', (d) => { buf += d; const lines = buf.split('\n'); buf = lines.pop() || '';
      for (const line of lines) { const s = line.trim(); if (!s) continue; let m; try { m = JSON.parse(s); } catch { continue; }
        if (m.type === 'system' && m.subtype === 'init' && m.session_id) sessionId = m.session_id;
        if (m.type === 'result') { final = m; if (m.session_id) sessionId = m.session_id; }
        onLine(m); } });
    child.stderr.on('data', (d) => { stderr += d; if (stderr.length > 20000) stderr = stderr.slice(-20000); });
    child.on('error', (e) => { stderr += '\n' + e.message; });
    child.on('close', (code) => { clearTimeout(timer);
      resolveP({ sessionId, result: final ? String(final.result || '') : '', cost: final ? Number(final.total_cost_usd || final.cost_usd || 0) : 0, turns: final ? Number(final.num_turns || 0) : 0, isError: final ? !!final.is_error : true, exitCode: code, stderr: stderr.trim() }); });
  });
}

export function createRunner({ root, claude, sandbox = 'none', image, floor = null, env = process.env, log = () => {}, ship = shipJob, run = runSession, board = null, preview = previewDeploy } = {}) {
  root = resolve(root || defaultRoot());
  if (insidePlugin(root)) throw new Error(PLUGIN_ROOT_ERROR);
  const ev = (job, kind, extra = {}) => { const e = { t: Date.now(), kind, agent: jobAgentId(job), role: 'coordinator', name: jobAgentName(job), source: 'factory', ...extra }; appendEvent(root, e); if (board) board.sendEvents([e], job.cloud ? job.cloud.floor : floor); };
  const say = (job, text) => { note(job, text); log(`[${job.id}] ${text}`); };
  const sync = async (job, patch) => { if (!job.cloud || !board) return; try { await board.update(job.cloud.turnId, { sessionId: job.sessionId || undefined, costUsd: job.costUsd, ...patch }); } catch (e) { say(job, 'cloud board not updated: ' + e.message); } };
  /** A failed turn: the technical reason stays with the owner (terminal, board detail); the user reads a plain line. */
  const fail = async (job, error, plain = SNAG) => { job.state = 'failed'; job.error = short(error, 400); job.finishedAt = Date.now(); saveJob(root, job); ev(job, 'fail', { paper: job.id, text: short(plain, 90) }); say(job, 'snag: ' + job.error); await sync(job, { status: 'failed', error: job.error, plain: short(plain, 300) }); return job; };

  async function session(job, opts) {
    const prompt = coordinatorPrompt(job, opts);
    const { cmd, args } = composeCommand(job, prompt, { claude, sandbox, image, resume: opts.resume });
    return run({ cmd, args, cwd: job.workdir, env: childEnv(job, env, { root, floor, board }), onLine: (m) => { if (m.type === 'assistant' && m.message && Array.isArray(m.message.content)) { const t = m.message.content.find((c) => c.type === 'text'); if (t) { say(job, short(t.text, 160)); sync(job, { status: 'progress', progress: short(t.text, 200) }); } } } });
  }

  async function turn(job, { resume = false, answer = null, followUp = null } = {}) {
    job.state = 'running'; job.startedAt = job.startedAt || Date.now(); saveJob(root, job);
    await sync(job, { status: 'running', repo: job.links.remote || undefined, branch: job.branch });
    let out = await session(job, { resume, resumeAnswer: answer, followUp });
    if (out.isError && resume && /session|resume|conversation/i.test(out.stderr + ' ' + out.result)) { say(job, 'could not resume the old session; starting fresh with the context'); job.sessionId = null; out = await session(job, { resume: false, resumeAnswer: answer, followUp: followUp || job.brief }); }
    job.sessionId = out.sessionId || job.sessionId; job.costUsd = Number((job.costUsd + out.cost).toFixed(4)); job.turns += out.turns; job.lastResult = short(out.result, 4000);
    if (out.isError) return fail(job, out.stderr || out.result || `exit ${out.exitCode}`);
    const blocked = parseFence(out.result, BLOCKED_FENCE);
    if (blocked) return fail(job, blocked.detail || blocked.reason || blocked.raw || 'blocked', blocked.reason || SNAG);
    const ask = parseFence(out.result, ASK_FENCE);
    if (ask) {
      const text = short(ask.question || ask.raw || 'needs a decision', 400); const context = short(ask.context, 300);
      if (MACHINE_RE.test(text + ' ' + context)) return fail(job, `the floor asked a machine question: ${text} ${context}`.trim());
      const given = Array.isArray(ask.options) ? ask.options.map((o) => short(o, 80)).filter(Boolean).slice(0, 4) : [];
      job.state = 'blocked'; job.question = { text, options: given.length ? given : ['Yes, go ahead'], recommended: given.length >= 2, context, askedAt: Date.now() }; saveJob(root, job);
      ev(job, 'block', { text: job.question.text, needs: job.question.options.join(' / ') }); say(job, 'needs an answer: ' + job.question.text);
      await sync(job, { status: 'blocked', question: job.question }); return job;
    }
    const done = parseFence(out.result, DONE_FENCE) || { summary: short(out.result, 300), notes: 'the session ended without a binas-done block' };
    job.summary = done; job.state = 'done'; job.finishedAt = Date.now(); saveJob(root, job); ev(job, 'done', { paper: job.id, text: short(done.summary, 90) });
    const shipped = ship(job, { env }); job.links = { ...job.links, ...shipped.links }; job.shipMode = shipped.mode; shipped.notes.forEach((n) => say(job, n));
    const pv = env.BINAS_NO_PREVIEW === '1' ? { url: null, notes: ['live links are off on this workshop'] } : await preview(job, { env }); if (pv.url) job.links.preview = pv.url; pv.notes.forEach((n) => say(job, n));
    if (!pv.url && (job.kind || 'web') === 'web') done.notes = [done.notes, pv.notes[pv.notes.length - 1]].filter(Boolean).join(' · ');
    job.state = 'shipped'; saveJob(root, job);
    ev(job, 'ship', { paper: job.id, text: job.links.preview || shipped.links.pr || shipped.links.remote || `branch ${job.branch}` });
    await sync(job, { status: 'done', report: done, links: job.links, repo: job.links.remote || undefined });
    return job;
  }

  async function runJob(job) {
    try { job.workdir = prepareWorkdir(job, root); saveJob(root, job); }
    catch (e) { return fail(job, e.message); }
    const followUp = job.cloud && job.cloud.followUp && job.sessionId ? job.brief : null;
    ev(job, 'join'); ev(job, 'arrive', { paper: job.id, to: jobAgentId(job), text: followUp ? short(job.brief, 80) : job.title }); ev(job, 'start', { paper: job.id, text: followUp ? 'reading your message' : 'reading the brief' });
    say(job, `started in ${job.workdir} on ${job.branch}`);
    return turn(job, followUp ? { resume: true, followUp } : {});
  }
  async function resumeJob(job) {
    if (!job.workdir) { try { job.workdir = prepareWorkdir(job, root); saveJob(root, job); } catch (e) { return fail(job, e.message); } }
    const last = job.answers[job.answers.length - 1];
    if (job.cloud) ev(job, 'join');
    ev(job, 'unblock', { text: short(last ? last.answer : 'yes', 120) }); ev(job, 'start', { paper: job.id, text: 'continuing with your answer' });
    return turn(job, { resume: true, answer: last });
  }
  /** Pull the next cloud turn that is not on file yet and save it as a local job. */
  async function pullCloud() {
    if (!board) return null;
    for (const w of await board.next()) { const id = 'turn_' + w.turn.id; if (loadJob(root, id)) continue; const job = saveJob(root, jobFromWork(w, root)); say(job, `pulled from the cloud board (floor ${job.cloud.floor}, turn ${w.turn.n})`); return job; }
    return null;
  }
  /** Jobs left "running" by a stopped workshop are snags, not ghosts: they fail with a plain note and free the project. */
  async function sweep() {
    const stale = listJobs(root).filter((j) => j.state === 'running');
    for (const j of stale) await fail(loadJob(root, j.id), 'the workshop was stopped in the middle of this turn', 'The floor was interrupted before it finished. Send your message again and it continues from where it got to.');
    return stale.length;
  }

  let swept = false;
  /** One pass: resume an answered job, else start the oldest queued one, else pull one from the cloud. */
  async function tick() {
    if (!swept) { swept = true; await sweep(); }
    const jobs = listJobs(root);
    const answered = jobs.find((j) => j.state === 'answered'); if (answered) return resumeJob(loadJob(root, answered.id));
    const queued = jobs.find((j) => j.state === 'queued'); if (queued) return runJob(loadJob(root, queued.id));
    const pulled = await pullCloud(); if (pulled) return pulled.state === 'answered' ? resumeJob(pulled) : runJob(pulled);
    return null;
  }
  let timer = null, busy = false;
  function start(pollMs = 3000) { const loop = async () => { if (busy) return; busy = true; try { await tick(); } catch (e) { log('runner error: ' + e.message); } finally { busy = false; } }; loop(); timer = setInterval(loop, pollMs); return () => clearInterval(timer); }
  return { tick, runJob, resumeJob, pullCloud, sweep, start, root };
}
